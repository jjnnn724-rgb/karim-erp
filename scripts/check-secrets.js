#!/usr/bin/env node
/**
 * check-secrets.js — كاشف الأسرار المسرّبة في الشجرة المتتبَّعة
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا: تسرّبت أسرار حقيقية إلى المستودع عبر سكربتات (نسخ احتياطي،
 * تدقيق ZATCA، استعادة). أزالتُها من الشجرة، لكن أي تسرّب جديد يجب أن
 * يُوقفه CI فورًا — لا بعد months.
 *
 * القواعد:
 *   · لا يطبع أي سر كامل — معاينة مقنّعة (أول حرفين + الطول) فقط.
 *   · يفحص الملفات **المتتبَّعة في git** فقط (git ls-files).
 *   · قائمة استثناء صريحة (scripts/check-secrets.allow.json) للسلّمات
 *     المقصودة (قيم نموذجية، fixtures اصطناعية).
 *   · أي finding = فشل (exit 1) → يُربط بـ CI.
 *
 * التشغيل: node scripts/check-secrets.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOW_FILE = path.join(ROOT, 'scripts', 'check-secrets.allow.json');

// أنماط قيمة يبدو أنها سر: إسناد اسم + سلسلة نصية
const ASSIGN_RE = /\b([A-Za-z_$][\w$]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|credential)[A-Za-z_$]*)\s*[:=]\s*['"`]([^'"`\n]{4,})['"`]/gi;
// أنماط أسرار معروفة الشكل
const PATTERNS = [
    { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'jwt-literal', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    { name: 'basic-auth-literal', re: /Basic\s+[A-Za-z0-9+/]{16,}={0,2}/g },
    { name: 'pgpassword-literal', re: /PGPASSWORD\s*=\s*['"`]([^'"`\n]{6,})['"`]/gi },
    { name: 'postgres-url-password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/gi },
];

// قيم لا تُعدّ أسراراً (نماذج/ documentation)
const SAFE_VALUES = new Set([
    'replace-me', 'changeme', 'your-password-here', 'your_secret_here', 'xxx', 'todo',
    'example', 'placeholder', 'null', 'undefined', 'true', 'false', 'none',
]);
const SAFE_PATTERNS = [
    /^replace-me/i, /^your[-_]/i, /^<.*>$/, /^\$\{/, /^process\.env/, /^\{.*\}$/,
    /^\*+$/, /^x+$/i, /^changeme/i, /^\.\.\.$/, /^TODO/i, /^FIXME/i,
    /example/i, /placeholder/i, /^dummy/i, /^test[-_]?only$/i, /^fake/i, /^sample/i,
    /^KARIM_/, /^REDACTED$/i, /^\$\{.*\}$/,
];

/**
 * هل القيمة "شكل سر"؟ نطلب: بلا مسافات، بلا حروف غير ASCII (رسائل عربية)،
 * طول كافٍ، وخلط أحرف/رموز. هذا يستبعدFalse positives كثيرة:
 * `$DB_PASSWORD` (توسيف)، و`'بيانات الدخول غير صحيحة'` (رسالة).
 */
function looksLikeCredential(value) {
    const v = String(value).trim();
    if (v.length < 8) {return false;}
    if (/\s/.test(v)) {return false;}
    if (/[^\x20-\x7E]/.test(v)) {return false;}               // غير ASCII (رسائل عربية)
    if (/^\$/.test(v)) {return false;}                       // توسيف شِل
    if (/^<.+>$/.test(v)) {return false;}
    if (!/[A-Za-z]/.test(v)) {return false;}                  // لا بد من حرف
    if (!/[0-9]/.test(v) && !/[_\-!@#$%^&*]/.test(v)) {return false;}
    return true;
}

function isSafe(value) {
    const v = String(value).trim();
    if (!v) {return true;}
    if (SAFE_VALUES.has(v.toLowerCase())) {return true;}
    if (SAFE_PATTERNS.some((re) => re.test(v))) {return true;}
    // قالب ديناميكي: القيمة تُولَّد وقت التشغيل (crypto.randomBytes等)
    if (v.includes('${')) {return true;}
    return !looksLikeCredential(v);
}

function redact(value) {
    const v = String(value);
    return `${v.slice(0, 2)}…(len=${v.length})`;
}

function loadAllow() {
    if (!fs.existsSync(ALLOW_FILE)) {return [];}
    try {
        const data = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'));
        return Array.isArray(data) ? data : (data.allow || []);
    } catch (_) {return [];}
}

function isAllowed(relPath, rule, snippet) {
    return loadAllow().some((entry) => {
        if (typeof entry === 'string') {return relPath.includes(entry);}
        if (entry && entry.path && entry.path !== relPath) {return false;}
        if (entry && entry.rule && entry.rule !== rule) {return false;}
        if (entry && entry.snippet && !String(snippet).includes(entry.snippet)) {return false;}
        return true;
    });
}

function trackedFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
}

function scan() {
    const findings = [];
    for (const rel of trackedFiles()) {
        const abs = path.join(ROOT, rel);
        let stat;
        try { stat = fs.statSync(abs); } catch (_) { continue; }
        if (!stat.isFile() || stat.size > 3 * 1024 * 1024) {continue;}
        if (/\.(png|jpg|jpeg|gif|ico|exe|dll|zip|gz|7z|mp4|woff2?|ttf|pdf|db|sqlite)$/i.test(rel)) {continue;}
        let text;
        try { text = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
        const lines = text.split('\n');

        lines.forEach((line, idx) => {
            ASSIGN_RE.lastIndex = 0;
            let m;
            while ((m = ASSIGN_RE.exec(line))) {
                const name = m[1];
                const value = m[2];
                if (isSafe(value)) {continue;}
                if (isAllowed(rel, 'assignment', name)) {continue;}
                findings.push({ file: rel, line: idx + 1, rule: 'assignment', name, preview: redact(value) });
            }
            for (const p of PATTERNS) {
                p.re.lastIndex = 0;
                let hit;
                while ((hit = p.re.exec(line))) {
                    // توسيف متغيّر (PGPASSWORD="$DB_PASSWORD") ليس سرًا
                    const captured = hit.length > 1 ? hit[1] : hit[0];
                    if (p.name === 'pgpassword-literal' && String(captured).trim().startsWith('$')) {continue;}
                    if (isAllowed(rel, p.name, hit[0])) {continue;}
                    findings.push({ file: rel, line: idx + 1, rule: p.name, name: p.name, preview: redact(hit[0]) });
                }
            }
        });
    }
    return findings;
}

const findings = scan();
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(findings, null, 2));
} else {
    console.log(`\nأسرار في الملفات المتتبَّعة: ${findings.length}\n`);
    for (const f of findings) {
        console.log(`  ${f.file}:${f.line}  [${f.rule}] ${f.name} = ${f.preview}`);
    }
    if (findings.length) {
        console.log('\nللتحقق من قيمة: افتح الملف بنفسك — هذا التقرير لا يطبع أي سر.');
        console.log('للاستثناء المقصود: أضف مدخلاً في scripts/check-secrets.allow.json');
    }
    console.log('');
}
process.exit(findings.length ? 1 : 0);
