#!/usr/bin/env node
/**
 * security-gate.js — بوابة الأمان الإلزامية: أي تعديل أو إضافة يمرّ من هنا
 * ══════════════════════════════════════════════════════════════════════════
 * الفلسفة (نفس فلسفة lint-gate): لا نمنع التطور، نمنع **التدهور**.
 *   · ملف الأساس يسجّل حصّة كل ملف الحالي؛ أي ملف جديد أو زيادة في حصّة
 *     أي ملف = فشل. من يضيف كودًا خطرًا يجب أن يُصلحه أو يُخفّض حصّة
 *     ملف آخر في نفس التغيير — لا يُخالَص بالصمت.
 *   · القواعد الصفرية (zero-tolerance) لا تُأسَّس إطلاقًا: eval وnew Function
 *     وتسريب الأسرار تفشل مهما كان التاريخ.
 *
 * القواعد:
 *   1. no-eval         — eval / new Function (صفرية).
 *   2. sql-interp      — استعلام SQL بقالب نصي يحوي ${} (خطر حقن).
 *   3. shell-interp    — exec/spawn بقالب نصي يحوي ${} (خطر حقن أوامر).
 *   4. html-unescaped  — innerHTML يحقن ${} غير مغلّف بـesc() (خطر XSS).
 *   5. unguarded-route — مسار خلفي بلا مصادقة ولا حارس على الموجّه.
 *
 * ثوابت غير قابلة للتأسيس (invariants) تُفحص دائمًا:
 *   · gate:secrets        — scripts/check-secrets.js يجب أن ينجح.
 *   · gate:env-tracked    — لا يُتتبَّع أي .env (عدا .env.example ونحوه).
 *   · gate:suite-present  — حزم اختبارات الأمان الأساسية موجودة.
 *   · gate:wiring         — securityHeaders وauthLimiter موصولان فعليًا.
 *
 * ملفات مستثناة بقرار موثّق: البوابة نفسها واختبارها يحملان نصوص هجوم
 * نموذجية للقياس؛ تغطيتهما مُكلَّفة باختبار العضّ (bite test) في
 * tests/security-gate.test.js.
 *
 * التشغيل: node scripts/security-gate.js [--write-baseline] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'security-baseline.json');

/* استثناء موثّق: البوابة واختبارها يكتبان أنماط الهجوم نصيًا للقياس */
const SELF_EXCLUDE = new Set([
    'scripts/security-gate.js',
    'tests/security-gate.test.js',
]);

/* مجلدات لا تُفحص أبدًا */
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage', 'release',
    '.next', 'out', 'vendor', '.yarn', '.cache',
]);

/* جذور المسح: باقي الشجرة (docs/ tests/ database/) ليس كود تشغيل */
const SCAN_ROOTS = ['backend', 'frontend/app', 'scripts'];

/* قالب بيئي = ملف يبدأ بـ.env وينتهي بـexample/sample/template فقط */
function isEnvTemplate(base) {
    return /^\.env(\.|$)/.test(base) && /\.(example|sample|template)$/.test(base);
}

/* علامات المصادقة داخل سلسلة الوسائط قبل معالج المسار */
const AUTH_MARKERS = /jwtAuth|requireRole|deviceAuth|basicAuth|authLimiter|verifyToken|requireAuth|sessionGuard|\bGUARD\b|\w*[Gg]ate\b/;

/* حارس على مستوى الموجّه يسبق تعريف المسار (router.use(jwtAuth, ...) ) */
const ROUTER_GUARD = /router\.use\s*\(\s*\.{0,3}\s*(?:jwtAuth|requireRole|deviceAuth|basicAuth|authLimiter|verifyToken|requireAuth|sessionGuard|GUARD)/;

const RULES = {
    'no-eval': { zero: true, desc: 'eval / new Function' },
    'sql-interp': { zero: false, desc: 'SQL بقالب نصي يحوي ${}' },
    'shell-interp': { zero: false, desc: 'أوامر سطر أوامر بقالب نصي يحوي ${}' },
    'html-unescaped': { zero: false, desc: 'innerHTML بحقن ${} غير مغلّف بـesc()' },
    'unguarded-route': { zero: false, desc: 'مسار خلفي بلا مصادقة' },
};

/* ── أدوات مساعدة ──────────────────────────────────────────────────────── */

function relative(p) {
    return path.relative(ROOT, p).split(path.sep).join('/');
}

/** جمع ملفات .js القابلة للمسح باستثناء المجلدات المُستبعدة */
function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        return out;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
                walk(full, out);
            }
        } else if (e.isFile() && e.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * إزالة التعليقات مع الحفاظ على عدد الأسطر (ليتطابق ترقيم الأسطر).
 * آلة حالات: نص مفرد/مزدوج/قالب + تعليق سطر + تعليق متعدد الأسطر.
 * التعليقات داخل القوالب نص عادي — لا ندخل حالة التعليق منها.
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let mode = 'code'; // code | single | double | template | line | block
    while (i < n) {
        const c = src[i];
        const next = i + 1 < n ? src[i + 1] : '';
        if (mode === 'code') {
            if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
            if (c === "'") { mode = 'single'; }
            else if (c === '"') { mode = 'double'; }
            else if (c === '`') { mode = 'template'; }
            out += c; i += 1; continue;
        }
        if (mode === 'line') {
            if (c === '\n') { mode = 'code'; out += c; } else { out += ' '; }
            i += 1; continue;
        }
        if (mode === 'block') {
            if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
            out += c === '\n' ? '\n' : ' ';
            i += 1; continue;
        }
        // داخل نص: single | double | template
        if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) {
            mode = 'code';
        }
        out += c; i += 1;
    }
    return out;
}

/** رقم السطر (١-أساس) لمؤشر داخل النص المُنقّى — الأسطر محفوظة حرفيًا */
function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
        if (text[i] === '\n') { line += 1; }
    }
    return line;
}

/** نهاية النصي المسنَد: أول فاصلة منقوطة خلال N حرف وإلا حدّ N */
function stmtEnd(text, start, limit) {
    const semi = text.indexOf(';', start);
    return semi === -1 || semi > start + limit ? start + limit : semi;
}

/** محتوى القالب بين فتحة ` وإغلاقها الأولى (تقريب كافٍ للاكتشاف) */
function templateBody(text, backtickIdx) {
    const end = text.indexOf('`', backtickIdx + 1);
    return { body: text.slice(backtickIdx + 1, end === -1 ? text.length : end), end };
}

/** كل مواقع ${ داخل نطاق، ومحتوى كل منها حتى } المطابق الأول */
function interpolations(text, from, to) {
    const found = [];
    let idx = text.indexOf('${', from);
    while (idx !== -1 && idx < to) {
        const close = text.indexOf('}', idx + 2);
        const stop = close === -1 || close > to ? to : close;
        found.push({ idx, expr: text.slice(idx + 2, stop) });
        idx = text.indexOf('${', idx + 2);
    }
    return found;
}

/** هل التعبير مغلّف بـesc() أو مكافئ آمن موثّق؟ */
function isEscaped(expr) {
    return /^\s*esc\s*\(/.test(expr);
}

/* ── الماسحات ──────────────────────────────────────────────────────────── */

/** نص بحث → ملاحظات (rule, key, line) — النص يُنقّى من التعليقات أولًا */
function scanContent(relPath, rawContent) {
    const findings = [];
    const text = stripComments(rawContent);
    const isBackendRoutes = relPath.startsWith('backend/') && relPath !== 'backend/server.js';

    const push = (rule, index) => findings.push({ rule, key: relPath, line: lineOf(text, index) });

    // 1) no-eval — صفرية: أي إصابة تُبلَّغ دائمًا
    for (const re of [/\beval\s*\(/g, /new\s+Function\s*\(/g]) {
        re.lastIndex = 0;
        let m = re.exec(text);
        while (m) { push('no-eval', m.index); m = re.exec(text); }
    }

    // 2) sql-interp — .query(` ... ${ ... })
    const SQL_RE = /\.query\s*\(\s*`/g;
    let m = SQL_RE.exec(text);
    while (m) {
        const bt = m.index + m[0].length - 1;
        const { body } = templateBody(text, bt);
        if (body.includes('${')) { push('sql-interp', m.index); }
        m = SQL_RE.exec(text);
    }

    // 3) shell-interp — exec/spawn(... template literal يحوي ${}
    const SHELL_RE = /(?:^|[^.\w])(?:execSync|execFileSync|spawnSync|exec|spawn|execFile)\s*\(\s*`/g;
    m = SHELL_RE.exec(text);
    while (m) {
        const bt = m.index + m[0].length - 1;
        const { body } = templateBody(text, bt);
        if (body.includes('${')) { push('shell-interp', m.index); }
        m = SHELL_RE.exec(text);
    }

    // 4) html-unescaped — إسناد innerHTML يحوي ${} غير مغلّف بـesc()
    const HTML_RE = /innerHTML\s*[+]?=/g;
    m = HTML_RE.exec(text);
    while (m) {
        const end = stmtEnd(text, m.index, 1200);
        const parts = interpolations(text, m.index, end);
        if (parts.some((p) => !isEscaped(p.expr))) { push('html-unescaped', m.index); }
        m = HTML_RE.exec(text);
    }

    // 5) unguarded-route — تعريف مسار بلا علامة مصادقة وبلا حارس سابق
    if (isBackendRoutes) {
        const guards = [];
        const GUARD_RE = new RegExp(ROUTER_GUARD.source, 'g');
        let g = GUARD_RE.exec(text);
        while (g) { guards.push(g.index); g = GUARD_RE.exec(text); }

        const ROUTE_RE = /router\.(get|post|put|delete|patch|all)\s*\(\s*(['"`])([^'"`\n]+)\2/g;
        let r = ROUTE_RE.exec(text);
        while (r) {
            const method = r[1].toUpperCase();
            const routePath = r[3];
            // سلسلة الوسائط = من تعريف المسار حتى أول معالج (async/function)
            let segEnd = r.index + 400;
            const handler = /(?:async|function)\s*[(\w]/.exec(text.slice(r.index, segEnd));
            if (handler) { segEnd = r.index + handler.index; }
            const segment = text.slice(r.index, segEnd);
            const guarded = AUTH_MARKERS.test(segment)
                || guards.some((gi) => gi < r.index);
            if (!guarded) {
                findings.push({
                    rule: 'unguarded-route',
                    key: `${relPath}:::${method} ${routePath}`,
                    line: lineOf(text, r.index),
                });
            }
            r = ROUTE_RE.exec(text);
        }
    }

    return findings;
}

/* ── جمع كل الملفات ──────────────────────────────────────────────────── */

function collect() {
    const findings = {}; // rule → { key: { count, line } }
    let filesScanned = 0;
    for (const root of SCAN_ROOTS) {
        for (const file of walk(path.join(ROOT, root))) {
            const rel = relative(file);
            if (SELF_EXCLUDE.has(rel)) { continue; }
            let content;
            try {
                content = fs.readFileSync(file, 'utf8');
            } catch (_) {
                continue;
            }
            if (content.includes('\u0000')) { continue; } // ملف ثنائي
            filesScanned += 1;
            for (const f of scanContent(rel, content)) {
                const bucket = findings[f.rule] || (findings[f.rule] = {});
                const entry = bucket[f.key] || (bucket[f.key] = { count: 0, line: f.line });
                entry.count += 1;
            }
        }
    }
    return { findings, filesScanned };
}

/* ── الثوابت غير القابلة للتأسيس ─────────────────────────────────────── */

/* ملفات التحصين التي لا يجوز أن تختفي: حذفها = تعطيل بوابة سابقة */
const REQUIRED_SUITES = [
    'tests/security.test.js',
    'tests/security-rbac-hardening.test.js',
    'tests/phase1-security.test.js',
    'tests/security-round2-hardening.test.js',
    'tests/v2-security.test.js',
    'tests/password-recovery.test.js',
    'tests/user-password-policy.test.js',
    'tests/audit-chain.test.js',
    'tests/production-db-guard.test.js',
    'backend/middleware/security.js',
    'backend/rate-limiter.js',
    'backend/cashier-module/jwt-middleware.js',
    'scripts/check-secrets.js',
    'scripts/lint-gate.js',
    'scripts/type-ratchet.js',
];

function invariantViolations() {
    const out = [];

    // 1) بوابة الأسرار — أي سرّ مسرّب = فشل فوري
    const secrets = spawnSync(process.execPath, [path.join(__dirname, 'check-secrets.js')], {
        encoding: 'utf8',
    });
    if (secrets.status !== 0) {
        const last = String(secrets.stdout || secrets.stderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
        out.push(`gate:secrets — check-secrets.js فشل (رمز ${secrets.status}) ${last}`);
    }

    // 2) لا ملف بيئي (.env) متتبَّع في git — فشل مغلق عند تعذّر الفحص
    try {
        const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
            .split(/\r?\n/).filter(Boolean);
        for (const f of tracked) {
            const base = path.posix.basename(f);
            if (/^\.env(\.|$)/.test(base) && !isEnvTemplate(base)) {
                out.push(`gate:env-tracked — ملف بيئي حقيقي متتبَّع في git: ${f}`);
            }
        }
    } catch (e) {
        out.push(`gate:env-tracked — تعذّر git ls-files (${String(e.message).split('\n')[0]}) — لا يمكن إثبات نظافة الأسرار`);
    }

    // 3) حزم التحصين موجودة — حذف اختبار أمان = تعطيل بوابة
    for (const rel of REQUIRED_SUITES) {
        if (!fs.existsSync(path.join(ROOT, rel))) {
            out.push(`gate:suite-present — ملف تحصين مفقود: ${rel}`);
        }
    }

    // 4) التوصيل: رؤوس الأمان موصولة + حدّ تسجيل الدخول مفعّل
    try {
        const serverSrc = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
        if (!serverSrc.includes("require('./middleware/security')") || !serverSrc.includes('securityHeaders(')) {
            out.push('gate:wiring — securityHeaders من middleware/security غير موصول في server.js');
        }
        const authSrc = fs.readFileSync(path.join(ROOT, 'backend/cashier-module/index.js'), 'utf8');
        if (!/['"]\/api\/auth\/login['"]\s*,\s*authLimiter/.test(authSrc)) {
            out.push("gate:wiring — authLimiter غير موصول على POST /api/auth/login (حماية التrack-force مفقودة)");
        }
    } catch (e) {
        out.push(`gate:wiring — تعذّر قراءة ملفات التوصيل (${String(e.message).split('\n')[0]})`);
    }

    return out;
}

/* ── البوابة ─────────────────────────────────────────────────────────── */

function loadBaseline() {
    try {
        return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    } catch (_) {
        return {};
    }
}

/**
 * استثناءات موثقة بانتهاء صلاحية: `_exceptions` في ملف الأساس.
 * كل استثناء: { rule, file, count, owner, reference, reason, expires }.
 * القواعد الصفرية لا تُستثنى إطلاقًا، والاستثناء المنتهي يعود انتهاكًا.
 */
function findException(exceptions, rule, key, count, today) {
    const list = Array.isArray(exceptions) ? exceptions : [];
    return list.find((x) => x && x.rule === rule && x.file === key
        && Number(x.count) >= count && typeof x.expires === 'string' && x.expires >= today) || null;
}

/** تسطيح الملاحظات إلى عدّادات JSON قابلة للتخزين في الأساس */
function toCounts(findings) {
    const out = {};
    for (const [rule, bucket] of Object.entries(findings)) {
        out[rule] = {};
        for (const [key, val] of Object.entries(bucket)) {
            out[rule][key] = val.count;
        }
    }
    return out;
}

/**
 * تشغيل البوابة.
 * @param {{writeBaseline?: boolean, findings?: object, filesScanned?: number}} [opts]
 * @returns {{ok: boolean, violations: string[], notes: string[], wrote?: boolean}}
 */
function runGate(opts = {}) {
    const collected = opts.findings ? { findings: opts.findings, filesScanned: opts.filesScanned || 0 } : collect();
    const findings = collected.findings;
    const baseline = opts.baselineOverride || loadBaseline();
    const exceptions = baseline._exceptions;
    const today = new Date().toISOString().slice(0, 10);
    const violations = [];
    const notes = [];
    const baselineExists = fs.existsSync(BASELINE_FILE);

    if (!opts.writeBaseline && !baselineExists) {
        violations.push('security-baseline.json مفقود — شغّل node scripts/security-gate.js --write-baseline ثم راجع المخرجات قبل الدمج');
    }

    // وضع الكتابة يتجاوز مقارنات الحصص (القياس نفسه ليس فشلًا)،
    // لكن الثوابت أدناه تبقى إلزامية — لا يُأسَّس على انتهاك حقيقي.
    if (!opts.writeBaseline) {
    for (const [rule, def] of Object.entries(RULES)) {
        const bucket = findings[rule] || {};
        const base = baseline[rule] || {};
        for (const [key, val] of Object.entries(bucket)) {
            const allowed = base[key] || 0;
            if (def.zero) {
                if (val.count > 0) {
                    violations.push(`[${rule}] ${key}:${val.line} — قاعدة صفرية (${val.count}): ${def.desc}`);
                }
            } else if (val.count > allowed) {
                const ex = def.zero ? null : findException(exceptions, rule, key, val.count, today);
                if (ex) {
                    notes.push(`استثناء موثّق ساري حتى ${ex.expires}: [${rule}] ${key}:${val.line} (${val.count}) — ${ex.reference || ex.reason}`);
                } else {
                    const expired = !def.zero && Array.isArray(exceptions)
                        && exceptions.some((x) => x && x.rule === rule && x.file === key && Number(x.count) >= val.count);
                    violations.push(`[${rule}] ${key}:${val.line} — ${val.count} إصابة مقابل حصّة ${allowed}: ${def.desc}`
                        + (expired ? ' (استثناء منتهي الصلاحية — جدّده أو أصلح الكود)' : ''));
                }
            } else if (rule === 'unguarded-route' && !(baseline._reasons || {})[key]) {
                // مسار عام يحتاج سببًا موثّقًا — الحصّة وحدها لا تُعلّل العمومية
                violations.push(`[unguarded-route] ${key} — مسار عام بلا سبب موثّق في _reasons (أضف مصادقة أو وثّق لماذا هو عام)`);
            } else if (val.count < allowed) {
                notes.push(`حصّة انخفضت في ${key}: ${val.count} من ${allowed} — حدّث الأساس (--write-baseline)`);
            }
        }
        for (const key of Object.keys(base)) {
            if (!(key in bucket)) { notes.push(`حصّة صارت صفرًا في ${key} — حدّث الأساس (--write-baseline)`); }
        }
        }
    }

    const inv = invariantViolations();
    violations.push(...inv);

    const activeExceptions = Array.isArray(exceptions)
        ? exceptions.filter((x) => x && typeof x.expires === 'string' && x.expires >= today)
        : [];

    let wrote = false;
    if (opts.writeBaseline) {
        if (violations.length === 0) {
            // _reasons يدوي دائمًا — نكتبه من الأساس السابق ولا يُمسح بالكتابة
            const previous = loadBaseline();
            const payload = {
                _generated: new Date().toISOString(),
                ...(previous._reasons ? { _reasons: previous._reasons } : {}),
                ...(previous._exceptions ? { _exceptions: previous._exceptions } : {}),
                ...toCounts(findings),
            };
            fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
            wrote = true;
        }
    }

    return {
        ok: violations.length === 0,
        violations,
        notes,
        wrote,
        findings,
        filesScanned: collected.filesScanned,
        activeExceptions,
    };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (require.main === module) {
    const args = process.argv.slice(2);
    const writeBaseline = args.includes('--write-baseline');
    const res = runGate({ writeBaseline });

    if (args.includes('--json')) {
        console.log(JSON.stringify(res, null, 2));
    } else {
        console.log('SECURITY-GATE — بوابة الأمان');
        console.log(`  الملفات المفحوصة: ${res.filesScanned || 0}`);
        console.log(`  EXCEPTIONS: ${res.activeExceptions.length} active — استثناءات موثّقة سارية`);
        for (const ex of res.activeExceptions) {
            console.log(`    • [${ex.rule}] ${ex.file} (${ex.count}) حتى ${ex.expires} — ${ex.reference || ex.reason || ''}`);
        }
        for (const [rule, def] of Object.entries(RULES)) {
            const bucket = (res.findings && res.findings[rule]) || {};
            const n = Object.keys(bucket).length;
            console.log(`  ${rule.padEnd(16)} ${n} مفتاح — ${def.desc}`);
        }
        if (res.wrote) { console.log('  ✅ الأساس كُتِب: scripts/security-baseline.json'); }
        for (const v of res.violations) { console.log(`  ✗ ${v}`); }
        for (const n2 of res.notes.slice(0, 10)) { console.log(`  ⓘ ${n2}`); }
        console.log(res.ok ? 'SECURITY-GATE: خضراء' : `SECURITY-GATE: فشلت (${res.violations.length} إصابة)`);
    }
    process.exit(res.ok ? 0 : 1);
}

module.exports = { scanContent, runGate, stripComments, RULES };
