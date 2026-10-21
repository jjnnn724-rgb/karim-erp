// ────────────────────────────────────────────────────────────────────────────
// token-cleanup.test.js — Task 36 (التسليم): نظافة التوكنات — المنتهي/المُبطَل
// يُحذف، والنشط يبقى. اختبار على قاعدة حقيقية بصفوف موسومة وتنظيف ذاتي.
// ────────────────────────────────────────────────────────────────────────────
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../backend/cashier-module/db-pool');
const { purgeExpiredTokens } = require('../backend/cashier-module/token-cleanup');

afterAll(async () => {
    await pool.end().catch(() => {});
});

const TAG_JSON = JSON.stringify({ suite: 'zztest-token-cleanup' });

test('purgeExpiredTokens يحذف المنتهي والمُبطَل ويُبقي النشط', async () => {
    // تنظيف أي بقايا سابقة للوسم ثم إنشاء ثلاث صفوف: منتهٍ، مُبطَل، نشط
    await pool.query(`DELETE FROM pos_refresh_tokens WHERE device_info = $1::jsonb;`, [TAG_JSON]);
    const inserted = await pool.query(
        `INSERT INTO pos_refresh_tokens (user_id, token_hash, device_info, expires_at, revoked_at)
         VALUES (1, 'zztest-expired', $1::jsonb, CURRENT_TIMESTAMP + INTERVAL '7 days', NULL),
                (1, 'zztest-revoked', $1::jsonb, CURRENT_TIMESTAMP + INTERVAL '7 days', CURRENT_TIMESTAMP),
                (1, 'zztest-active',  $1::jsonb, CURRENT_TIMESTAMP + INTERVAL '7 days', NULL)
         RETURNING id;`,
        [TAG_JSON]
    );
    expect(inserted.rowCount).toBe(3);
    // قيد chk_pos_token_expiry (expires_at > issued_at): نجعل صف "المنتهي" منتهيًا
    // بعد الإدخال بإزاحة متسقة (انتهى قبل ساعتين، صدر قبل 4 ساعات)
    await pool.query(
        `UPDATE pos_refresh_tokens SET expires_at = CURRENT_TIMESTAMP - INTERVAL '2 hours',
            issued_at = CURRENT_TIMESTAMP - INTERVAL '4 hours'
          WHERE token_hash = 'zztest-expired';`
    );

    const purged = await purgeExpiredTokens(pool);
    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await pool.query(
        `SELECT token_hash FROM pos_refresh_tokens WHERE device_info = $1::jsonb;`,
        [TAG_JSON]
    );
    expect(remaining.rowCount).toBe(1);
    expect(remaining.rows[0].token_hash).toBe('zztest-active');

    // تنظيف ذاتي كامل
    await pool.query(`DELETE FROM pos_refresh_tokens WHERE device_info = $1::jsonb;`, [TAG_JSON]);
});
