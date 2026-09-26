// issue-reset-code.js — طوارئ: إصدار رمز استعادة من سيرفر النظام نفسه
// ─────────────────────────────────────────────────────────────────────────────
// الوصول الفيزيائي للسيرفر = التفويض (لا يعمل عبر الشبكة، ولا يحتاج حسابًا
// مسجل دخول). يُستخدم عندما لا يتوفر مدير داخل النظام لإصدار رمز.
// الاستخدام: node scripts/issue-reset-code.js <username>
// الرمز: 6 أرقام، 10 دقائق، استخدام واحد — يُدخل في شاشة الدخول «نسيت كلمة المرور؟».
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
    const username = String(process.argv[2] || '').trim();
    if (!username) {
        console.error('Usage: node scripts/issue-reset-code.js <username>');
        process.exit(2);
    }
    const c = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await c.connect();
    const u = (await c.query(
        'SELECT id, username, name, active FROM users WHERE username = $1 LIMIT 1',
        [username]
    )).rows[0];
    if (!u || !u.active) {
        console.error('USER_NOT_FOUND: لا يوجد حساب نشط بهذا الاسم.');
        await c.end();
        process.exit(1);
    }
    await c.query('DELETE FROM pos_password_reset_codes WHERE user_id = $1 AND used_at IS NULL', [u.id]);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const hash = crypto.createHash('sha256').update(code, 'utf8').digest('hex');
    await c.query(
        'INSERT INTO pos_password_reset_codes (user_id, code_hash, expires_at, created_by) VALUES ($1, $2, $3, NULL)',
        [u.id, hash, new Date(Date.now() + 10 * 60 * 1000)]
    );
    console.log(`CODE for @${u.username} (${u.name || 'بدون اسم'}): ${code}`);
    console.log('صالح 10 دقائق — استخدام واحد — يُدخل في شاشة الدخول «نسيت كلمة المرور؟»');
    await c.end();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
