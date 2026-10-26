#!/usr/bin/env node
'use strict';
/**
 * activate-app-role.js — تفعيل دور التطبيق المحدود (karim_app) على الإنتاج
 * ══════════════════════════════════════════════════════════════════════
 * الخطوات (كلها آمنة وقابلة للتراجع):
 *   1. نسخة احتياطية من .env (لا تُطبع أي كلمة مرور).
 *   2. تشغيل migration 113 (تفعيل الدور + نقل الملكية + تطهير PUBLIC).
 *   3. توليد كلمة مرور قوية لـ karim_app وضبطها (لا تُطبع).
 *   4. تحديث .env: DB_USER=karim_app + DB_PASSWORD.
 *   5. التحقّق: اتصال karim_app (قراءة + كتابة في جدول اختبار) + قراءة.
 *   6. طباعة تعليمات التراجع (لا كلمة المرور).
 *
 * الاستخدام:
 *   node scripts/activate-app-role.js            # عرض الخطة (dry-run)
        console.log('للتنفيذ: node scripts/activate-app-role.js --apply');
 *   node scripts/activate-app-role.js --rollback # تراجع (استعادة .env)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const MIGRATION = 'database/migrations/113_app_role_activation.sql';

require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: ENV_FILE, override: false });
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

// ── أدوات .env (تعديل نصّي يحافظ على كل ما عداه) ──
function readEnv() { return fs.readFileSync(ENV_FILE, 'utf8'); }
function setEnvValue(text, key, value) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) { return text.replace(re, `${key}=${value}`); }
    return `${text.replace(/\s*$/, '\n')}${key}=${value}\n`;
}

function backupEnv() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(ROOT, 'logs', `env.before-app-role.${stamp}.bak`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(ENV_FILE, dest);
    return dest;
}

function psql(sql) {
    return execFileSync('C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
        ['-v', 'ON_ERROR_STOP=1', '-tA', '-h', process.env.DB_HOST || '127.0.0.1',
            '-p', process.env.DB_PORT || '5432', '-U', process.env.DB_USER || 'postgres',
            '-d', process.env.DB_NAME || 'karim_erp', '-c', sql],
        { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });
}

(async () => {
    console.log('\n=== تفعيل دور التطبيق (karim_app) ===\n');
    if (ROLLBACK) {
        const backups = fs.readdirSync(path.join(ROOT, 'logs'))
            .filter((f) => f.startsWith('env.before-app-role.'))
            .sort();
        if (!backups.length) { console.error('لا توجد نسخة .env سابقة للتراجع.'); process.exit(1); }
        const src = path.join(ROOT, 'logs', backups[backups.length - 1]);
        fs.copyFileSync(src, ENV_FILE);
        console.log(`تمت استعادة .env من: ${backups[backups.length - 1]}`);
        console.log('أعد تشغيل الخدمة: Restart-Service KarimERP-Server');
        return;
    }

    if (!APPLY) {
        console.log('خطة التنفيذ (dry-run — لم يتغيّر شيء):');
        console.log(`  1) نسخة .env → logs/env.before-app-role.<ts>.bak`);
        console.log(`  2) ${MIGRATION}`);
        console.log('  3) توليد كلمة مرور قوية لـ karim_app (لا تُطبع)');
        console.log('  4) .env: DB_USER=karim_app + DB_PASSWORD');
        console.log('  5) تحقّق: اتصال + كتابة في جدول اختبار');
        console.log('للتنفيذ: node scripts/activate-app-role.js --apply');
        return;
    }

    // 1) نسخة .env
    const bak = backupEnv();
    console.log(`✓ نسخة .env: ${path.basename(bak)}`);

    // 2) الـmigration
    console.log(`→ تشغيل ${MIGRATION} …`);
    const out = execFileSync(process.execPath, [path.join(ROOT, 'database', 'scripts', 'run-migration.js'), MIGRATION],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log((out || '').trim().split('\n').slice(-3).join('\n') || '  ✓ migration done');

    // 3) كلمة المرور
    const password = crypto.randomBytes(32).toString('base64url');
    psql(`ALTER ROLE karim_app PASSWORD '${password}'`);
    console.log('✓ تم ضبط كلمة مرور karim_app (غير مطبوعة)');

    // 4) .env
    let env = readEnv();
    env = setEnvValue(env, 'DB_USER', 'karim_app');
    env = setEnvValue(env, 'DB_PASSWORD', password);
    fs.writeFileSync(ENV_FILE, env, 'utf8');
    console.log('✓ .env: DB_USER=karim_app');

    // 5) التحقّق
    const test = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: 'karim_app', password, database: process.env.DB_NAME || 'karim_erp',
    });
    try {
        await test.connect();
        const who = await test.query('SELECT current_user, session_user');
        const r1 = await test.query('SELECT count(*)::int AS n FROM users');
        await test.query('BEGIN');
        await test.query('INSERT INTO karim_app_role_probe(note) VALUES ($1) ON CONFLICT DO NOTHING', ['probe']);
        await test.query('ROLLBACK');
        const r2 = await test.query('SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = $1', ['karim_app']);
        console.log(`✓ اتصال karim_app: current_user=${who.rows[0].current_user} · users=${r1.rows[0].n} · جداول بصلاحيات=${r2.rows[0].n}`);
        console.log('✓ كتابة/تراجع تجريبية نجحت (BEGIN/ROLLBACK)');
    } catch (e) {
        console.error(`✗ فشل التحقق: ${e.message}`);
        console.error(`التراجع: نسخة .env في ${bak} — استرجعها ثم أعد تشغيل الخدمة.`);
        await test.end().catch(() => {});
        process.exit(1);
    }
    await test.end();

    console.log('\nالخطوة التالية: أعد تشغيل الخدمة ثم تحقّق:');
    console.log('  Restart-Service KarimERP-Server');
    console.log('  node -e "fetch(\'https://127.0.0.1:5000/api/health\').then(r=>r.text()).then(console.log)"');
    console.log(`\nللتراجع: node scripts/activate-app-role.js --rollback`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
