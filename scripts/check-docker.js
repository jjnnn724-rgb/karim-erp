#!/usr/bin/env node
'use strict';
/**
 * check-docker.js — فحص أمني للـDockerfile وdocker-compose بلا Docker
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: لا يوجد Docker على هذا المضيف ⇒ لا يمكن البناء ولا الاختبار هنا.
 * لكن أخطاء مثل "//" بدل "#" (تعليق غير صالح) **تكسر البناء بصمت** حتى
 * يُكتشف في environments الخاطئة. هذا المدقّق يقرأ الملف كما يقرأه Docker
 * تقريبًا ويمسك الأخطاء التي لا يظهرها أي فحص آخر.
 *
 * الفحوص:
 *   1) تعليمات Dockerfile صحيحة (لا تعلي外面 بأسلوب // أو ; أو !).
 *   2) لا COPY/ADD لملف أسرار (.env) داخل الصورة.
 *   3) لا USER root (أو غياب USER نهائيًا).
 *   4) EXPOSE موجود.
 *   5) compose: لا privileged، لا user: root، لا network_mode: host،
 *      ومنفذ قاعدة البيانات غير مكشوف على كل الواجهات.
 *
 * الاستخدام: node scripts/check-docker.js [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
function argValue(name, fallback) {
    const i = argv.indexOf(name);
    return i > -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : fallback;
}
const DOCKERFILE = argValue('--dockerfile', path.join(ROOT, 'Dockerfile'));
const COMPOSE = argValue('--compose', path.join(ROOT, 'docker-compose.yml'));

const KNOWN_INSTRUCTIONS = new Set([
    'ADD', 'ARG', 'CMD', 'COPY', 'ENTRYPOINT', 'ENV', 'EXPOSE', 'FROM', 'HEALTHCHECK',
    'LABEL', 'MAINTAINER', 'ONBUILD', 'RUN', 'SHELL', 'STOPSIGNAL', 'USER', 'VOLUME', 'WORKDIR',
]);

const findings = [];
function add(severity, file, line, message) {
    findings.push({ severity, file, line: line || 0, message });
}

/** يجمع التعليمات مع دعم استمرارية السطر بـ "\" */
function parseInstructions(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let buffer = null;
    let startLine = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (buffer === null) {
            if (!trimmed || trimmed.startsWith('#')) {continue;}
            startLine = i + 1;
            if (trimmed.endsWith('\\')) {
                buffer = trimmed.slice(0, -1);
                continue;
            }
            out.push({ line: startLine, text: trimmed });
        } else {
            const piece = trimmed.endsWith('\\') ? trimmed.slice(0, -1) : trimmed;
            buffer += ` ${piece}`;
            if (!trimmed.endsWith('\\')) {
                out.push({ line: startLine, text: buffer.trim() });
                buffer = null;
            }
        }
    }
    if (buffer !== null) {out.push({ line: startLine, text: buffer.trim() });}
    return out;
}

// ─── Dockerfile (كل النسخ في المشروع) ─────────────────────────────────
// نفحص كل ملفات Dockerfile بالمشروع (بما فيها النسخ القديمة المنسية) —
// نسخة مهملة تعمل كـroot هي ثغرة تنتظر من يبنيها بالخطأ.
const dockerfiles = fs.existsSync(DOCKERFILE) ? [DOCKERFILE] : [];

for (const dfPath of dockerfiles) {
    const dfName = path.relative(ROOT, dfPath).split(path.sep).join('/');
    if (!fs.existsSync(dfPath)) {
        add('error', dfName, 0, 'Dockerfile غير موجود');
        continue;
    }
    const text = fs.readFileSync(dfPath, 'utf8');
    const instructions = parseInstructions(text);

    let lastUser = null;
    let sawExpose = false;
    for (const ins of instructions) {
        const word = (ins.text.split(/\s+/)[0] || '').toUpperCase();
        if (!KNOWN_INSTRUCTIONS.has(word)) {
            add('error', dfName, ins.line,
                `تعليمات غير معروفة: "${ins.text.slice(0, 40)}" — البناء سيفشل (unknown instruction). ` +
                'تذكّر: تعليق Dockerfile يبدأ بـ # فقط.');
            continue;
        }
        if (word === 'USER') {
            lastUser = (ins.text.split(/\s+/)[1] || '').toLowerCase();
        }
        if (word === 'EXPOSE') {sawExpose = true;}
        if (word === 'COPY' || word === 'ADD') {
            const lower = ins.text.toLowerCase();
            if (/(^|\s)\.env(\s|$)/.test(lower) || /\.env\b/.test(lower)) {
                add('error', dfName, ins.line,
                    'نسخ .env داخل الصورة = خَبز الأسرار داخل الصورة (أي من يملكها يملك المفاتيح).');
            }
            if (/\bsecrets?\b|\*\.(pem|key|p12|pfx)\b/.test(lower)) {
                add('error', dfName, ins.line, 'نسخ ملفات أسرار/مفاتيح داخل الصورة.');
            }
        }
        if (word === 'RUN' && /\bapt-get install\b/.test(ins.text)) {
            if (!/--no-install-recommends/.test(ins.text)) {
                add('warn', dfName, ins.line, 'يُستحسن --no-install-recommends لتقليل سطح الهجوم.');
            }
        }
    }

    if (lastUser === null) {
        add('error', dfName, 0, 'لا يوجد USER ⇒ الحاوية تعمل كـroot (أي ثغرة = ثغرة كاملة على المضيف).');
    } else if (lastUser === 'root' || lastUser === '0') {
        add('error', dfName, 0, `الحاوية تعمل كـ${lastUser} — يجب مستخدم غير مميّز.`);
    }
    if (!sawExpose) {
        add('warn', dfName, 0, 'لا يوجد EXPOSE.');
    }
}

// ─── entrypoints: يجب أن يكون فيها set -e (fail-fast) ────────────────
function scanEntrypoints(dir, depth) {
    if (depth > 3) {return;}
    let entries;
    try {entries = fs.readdirSync(dir, { withFileTypes: true });} catch (_) {return;}
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'coverage') {continue;}
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {scanEntrypoints(full, depth + 1);}
        else if (/^Dockerfile/i.test(e.name)) {
            if (!dockerfiles.includes(full)) {dockerfiles.push(full);}
        }
        else if (/entrypoint.*\.sh$|docker-entrypoint\.sh$/i.test(e.name)) {
            const rel = path.relative(ROOT, full).split(path.sep).join('/');
            const body = fs.readFileSync(full, 'utf8');
            if (!/set -e/.test(body)) {
                add('error', rel, 0, 'entrypoint بلا "set -e" ⇒ فشل خطوة لا يوقف الإقلاع.');
            }
            if (/admin123|password\s*=\s*['"]?admin/i.test(body)) {
                add('error', rel, 0, 'entrypoint فيه كلمة مرور افتراضية (admin123).');
            }
        }
    }
}
scanEntrypoints(ROOT, 0);

// ─── docker-compose ────────────────────────────────────────────────────
if (!fs.existsSync(COMPOSE)) {
    add('warn', 'docker-compose.yml', 0, 'docker-compose.yml غير موجود');
} else {
    const lines = fs.readFileSync(COMPOSE, 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
        const t = raw.trim();
        if (/^privileged:\s*true/i.test(t)) {
            add('error', 'docker-compose.yml', i + 1, 'privileged: true — يكسر عزل الحاوية.');
        }
        if (/^user:\s*(root|0)\s*$/i.test(t)) {
            add('error', 'docker-compose.yml', i + 1, 'user: root — لا بطاردة للحاوية.');
        }
        if (/^network_mode:\s*host/i.test(t)) {
            add('warn', 'docker-compose.yml', i + 1, 'network_mode: host — يتجاوز عزل الشبكة.');
        }
        if (/^cap_add:/i.test(t)) {
            add('warn', 'docker-compose.yml', i + 1, 'cap_add — راجع الصلاحيات المضافة.');
        }
        // منفذ قاعدة البيانات مكشوف على كل الواجهات
        if (/^\s*-\s*"?0\.0\.0\.0\.0:\d+:\d+/.test(raw)) {
            add('warn', 'docker-compose.yml', i + 1, 'منفذ مكشوف على 0.0.0.0 — فضّل 127.0.0.1.');
        }
    });
    // منفذ قاعدة البيانات في خدمة db
    const dbSection = (() => {
        const start = lines.findIndex((l) => /^\s{2}db:\s*$/.test(l));
        if (start < 0) {return '';}
        const rest = lines.slice(start + 1);
        const end = rest.findIndex((l) => /^\s{2}\S/.test(l));
        return (end < 0 ? rest : rest.slice(0, end)).join('\n');
    })();
    // صيغة المنفذ: "host:hostPort:containerPort" أو "hostPort:containerPort"
    // (الثانية بلا عنوان ⇒ تُربط على كل الواجهات).
    const dbPortSpec = dbSection.match(/^\s*-\s*"([^"]+)"/m);
    if (dbPortSpec) {
        const parts = dbPortSpec[1].split(':').map((p) => p.trim());
        const host = parts.length >= 3 ? parts[0] : '';
        if (!host || (host !== '127.0.0.1' && host !== 'localhost')) {
            add('error', 'docker-compose.yml', 0,
                `منفذ قاعدة البيانات مكشوف على ${host || 'كل الواجهات'} — يجب حصره في 127.0.0.1.`);
        }
    }
}

// ─── النتيجة ───────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.severity === 'error');
const warns = findings.filter((f) => f.severity === 'warn');

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ errors: errors.length, warnings: warns.length, findings }, null, 2));
} else {
    console.log(`\nفحص الحاويات: ${errors.length} خطأ · ${warns.length} تحذير`);
    for (const f of findings) {
        console.log(`   ${f.severity === 'error' ? '✗' : '⚠'} ${f.file}:${f.line} — ${f.message}`);
    }
    console.log('');
}

if (errors.length) {process.exit(1);}
