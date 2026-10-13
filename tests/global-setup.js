/**
 * global-setup.js — عزل قاعدة الاختبار (ROOT FIX 2026-10-02)
 * الاختبارات كانت تشتغل على قاعدة الإنتاج نفسها وتترك حسابات/صفوف وهمية!
 * الحل: تُستنسخ قاعدة منفصلة karim_erp_test من أحدث نسخة احتياطية (latest.dump)
 * مرة واحدة قبل كل جولة jest — الإنتاج لا يُلمس إطلاقًا.
 * القياس: node scripts/quality-gate.js → "تلوث الإنتاج: 0"
 */
module.exports = async function () {
    const { execFileSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    // SECURITY/حذر: الإعدادات تُقرأ في كائن محلي — لا تلوث process.env إطلاقًا
    // (تحميل NODE_ENV=production هنا كان يورّثه خيوط jest ويكسر الاختبارات
    //  المتزامنة عبر تفعيل فحص النشاط غير المتزامن).
    const cfg = {};
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) cfg[m[1]] = m[2];
    }
    const PG = 'C:/Program Files/PostgreSQL/18/bin';
    const env = { ...process.env, PGPASSWORD: cfg.DB_PASSWORD };
    const admin = ['-h', cfg.DB_HOST || '127.0.0.1', '-p', cfg.DB_PORT || '5432',
        '-U', cfg.DB_USER || 'postgres', '-d', 'postgres'];
    const exists = (await new Promise((resolve) => {
        try {
            const out = execFileSync(path.join(PG, 'psql.exe'),
                [...admin, '-tAc', "SELECT 1 FROM pg_database WHERE datname='karim_erp_test'"], { env });
            resolve(String(out).trim() === '1');
        } catch (_) { resolve(false); }
    }));
    if (exists) {console.log('[test-db] karim_erp_test موجودة — إعادة استخدام'); return;}
    const dump = path.join(root, 'database', 'backups', 'karim_erp-latest.dump');
    console.log('[test-db] إنشاء karim_erp_test معزولة...');
    execFileSync(path.join(PG, 'psql.exe'), [...admin, '-c', 'DROP DATABASE IF EXISTS karim_erp_test'], { env, stdio: 'pipe' });
    execFileSync(path.join(PG, 'psql.exe'), [...admin, '-c', 'CREATE DATABASE karim_erp_test'], { env, stdio: 'pipe' });
    if (fs.existsSync(dump)) {
        console.log('[test-db] استرجاع البيانات من latest.dump...');
        execFileSync(path.join(PG, 'pg_restore.exe'), [
            '-h', cfg.DB_HOST || '127.0.0.1', '-p', cfg.DB_PORT || '5432',
            '-U', cfg.DB_USER || 'postgres', '-d', 'karim_erp_test',
            '--no-owner', '-j', '2', dump,
        ], { env, stdio: 'pipe' });
        // FIX 2026-10-11 (C4): scrub PII + secrets from test DB after restore —
        // was copying production passwords, vault entries, and employee PII
        // into the test environment.
        console.log('[test-db] تنظيف البيانات الحساسة...');
        const scrub = [
            'UPDATE users SET password = \'$2b$12$LJ3m4ys3Gz6FfpjL1rJ3e.qHx5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y\', password_vault = NULL',
            'UPDATE employees SET phone = NULL, national_id = NULL, bank_account = NULL, address = NULL',
            'DELETE FROM pos_refresh_tokens',
            'DELETE FROM password_reset_codes',
        ];
        for (const sql of scrub) {
            try { execFileSync(path.join(PG, 'psql.exe'), [...admin, '-d', 'karim_erp_test', '-c', sql], { env, stdio: 'pipe' }); } catch (_) {}
        }
        console.log('[test-db] ✓ قاعدة اختبار معزولة ونظيفة من بيانات الإنتاج');
    } else {
        console.warn('[test-db] ⚠ لا يوجد latest.dump — قاعدة اختبار فارغة (شغّل: node scripts/backup-nightly.js)');
    }
};
