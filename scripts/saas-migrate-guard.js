#!/usr/bin/env node
'use strict';
/**
 * scripts/saas-migrate-guard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * حارس مخصّص لترحيلات مرحلة SaaS فقط. لا يعدّل مشغّل الترحيلات المشترك،
 * ولا يُستدعى من أي مسار نشر قائم — بل هو بوابة اختيارية صريحة تُستخدم
 * لتطبيق ترحيلات العزل على نسخة منفصلة حتمًا.
 *
 * السياسة (كلها fails-closed):
 *   1. رفض NODE_ENV=production.
 *   2. رفض أي هدف اسمه karim_erp (الإنتاج) أو karim_erp_test (قاعدة الاختبار المشتركة).
 *   3. قبول أسماء تنتهي بـ _dev | _copy | _saas | _tenant فقط.
 *   4. رفض غياب تأكيد صريح --i-confirm-copy.
 *   5. رفض أي ملف ترحيل ليس اسماً بسيطًا NNN_*.sql داخل database/migrations،
 *      ورفض ملفات الرجوع (_down.sql).
 *   6. رفض تعارض DB_NAME المُعداد مع --target (منع أي التباس في الهدف).
 *   7. رفض أي مضيف غير loopback — نفس سياسة scripts/audit.js:64-82
 *      (assertIsolatedTarget) المعتمدة في المشروع.
 *
 * الاستخدام:
 *   node scripts/saas-migrate-guard.js \
 *     --target=karim_tenant_dev \
 *     --migration=155_tenants_foundation.sql \
 *     --i-confirm-copy [--dry-run]
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROD_DB = 'karim_erp';
const SHARED_TEST_DB = 'karim_erp_test';
const SAFE_SUFFIXES = ['_dev', '_copy', '_saas', '_tenant'];
// مطابق لقائمة المضيفين في scripts/audit.js:68 و tests/global-setup.js:18
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const RUNNER = path.join(ROOT, 'database', 'scripts', 'run-migration.js');

function parseArgs(argv) {
    const args = Object.create(null);
    for (const token of argv) {
        if (token.startsWith('--target=')) {args.target = token.slice('--target='.length).trim();}
        else if (token.startsWith('--migration=')) {args.migration = token.slice('--migration='.length).trim();}
        else if (token === '--i-confirm-copy') {args.confirm = true;}
        else if (token === '--dry-run') {args.dryRun = true;}
        else {return { error: `وسيط غير معروف: ${token}` };}
    }
    return { args };
}

/**
 * @param {{target?:string, migration?:string, confirm?:boolean, dryRun?:boolean}} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ok:true, target:string, migration:string, dryRun:boolean} | {ok:false, reason:string}}
 */
function validate(args, env) {
    if (env.NODE_ENV === 'production') {
        return { ok: false, reason: 'ممنوع: NODE_ENV=production — هذا الحارس للنسخ المنفصلة فقط.' };
    }

    const host = String(env.DB_HOST || '127.0.0.1').toLowerCase();
    if (!LOOPBACK_HOSTS.includes(host)) {
        return { ok: false, reason: `ممنوع: المضيف "${host}" ليس loopback (سياسة assertIsolatedTarget).` };
    }

    const target = String(args.target || '').trim();
    if (!target) {return { ok: false, reason: 'يلزم --target=<db> صريحًا (لا تخمين).' };}
    if (target === PROD_DB || target === SHARED_TEST_DB) {
        return { ok: false, reason: `ممنوع استهداف "${target}" — الإنتاج وقاعدة الاختبار المشتركة خارج النطاق.` };
    }
    if (!SAFE_SUFFIXES.some((suffix) => target.endsWith(suffix))) {
        return { ok: false, reason: `اسم القاعدة "${target}" لا ينتهي بأحد: ${SAFE_SUFFIXES.join(' | ')}` };
    }
    if (!args.confirm) {
        return { ok: false, reason: 'يلزم تأكيد صريح: --i-confirm-copy' };
    }

    const configured = String(env.DB_NAME || '').trim();
    if (configured && configured !== target) {
        return { ok: false, reason: `تعارض: DB_NAME="${configured}" بينما --target="${target}".` };
    }

    const migration = String(args.migration || '').trim();
    if (!migration) {return { ok: false, reason: 'يلزم --migration=<NNN_name.sql> صريحًا (ممنوع تشغيل كل المعلّق).' };}
    if (migration !== path.basename(migration) || migration.includes('\\') || migration.includes('/')) {
        return { ok: false, reason: 'اسم ملف الترحيل يجب أن يكون بسيطًا بلا مسارات.' };
    }
    if (!/^\d{3}_[A-Za-z0-9_]+\.sql$/.test(migration) || migration.endsWith('_down.sql')) {
        return { ok: false, reason: `اسم ترحيل غير صالح: "${migration}"` };
    }
    if (!fs.existsSync(path.join(MIGRATIONS_DIR, migration))) {
        return { ok: false, reason: `ملف الترحيل غير موجود: ${migration}` };
    }

    return { ok: true, target, migration, dryRun: Boolean(args.dryRun) };
}

function run(argv, env) {
    const parsed = parseArgs(argv);
    if (parsed.error) {return { code: 2, message: parsed.error };}

    const verdict = validate(parsed.args, env);
    if (!verdict.ok) {return { code: 3, message: verdict.reason };}

    const banner = [
        '════════════════════════════════════════════════════════════',
        '  حارس ترحيل SaaS — نسخة منفصلة فقط',
        `  الهدف:   ${verdict.target}`,
        `  الترحيل: ${verdict.migration}`,
        '  الإنتاج karim_erp لم يُستهدف. لا حذف ولا تعديل لترحيل قديم.',
        '════════════════════════════════════════════════════════════',
    ].join('\n');

    if (verdict.dryRun) {return { code: 0, message: `${banner}\n[DRY-RUN] تحققات نجحت — لم يُنفَّذ شيء.`, dryRun: true };}

    const child = spawnSync(process.execPath, [RUNNER, verdict.migration], {
        cwd: ROOT,
        env: { ...env, DB_NAME: verdict.target },
        stdio: 'inherit',
    });
    if (child.error) {return { code: 4, message: `فشل تشغيل المشغّل: ${child.error.message}` };}
    return { code: child.status == null ? 4 : child.status, message: banner, executed: true };
}

if (require.main === module) {
    const result = run(process.argv.slice(2), process.env);
    if (result.message) {console.log(result.message);}
    process.exitCode = result.code;
}

module.exports = { validate, parseArgs, run, SAFE_SUFFIXES, PROD_DB, SHARED_TEST_DB };
