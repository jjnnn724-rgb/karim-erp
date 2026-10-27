/**
 * token-cleanup.js — Task 36 (التسليم): نظافة التوكنات الأوتوماتيكية.
 * ────────────────────────────────────────────────────────────────────────────
 * pos_refresh_tokens تراكمت 273 صفًا بلا أي تنظيف (35 منتهي وقت الفحص).
 * المنتهي/المُبطل لا قيمة له — يُحذف دوريًا:
 *   - أول تشغيل بعد 10 ثوانٍ من الإقلاع
 *   - ثم كل 6 ساعات (مؤقّت unref لا يمنع الخروج الرشيق)
 * الدورة نفسها (إصدار/تدوير/إبطال عند الخروج) قائمة في jwt-middleware —
 * هنا فقط تنظيف الجثث حتى لا ينتفخ الجدول بلا معنى.
 */

const { logger } = require('../logger');

/** @param {import('pg').Pool} pool مسبار اتصالات قاعدة البيانات */
async function purgeExpiredTokens(pool) {
  const res = await pool.query(
    `DELETE FROM pos_refresh_tokens
          WHERE revoked_at IS NOT NULL
             OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP);`
  );
  return res.rowCount || 0;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} [intervalMs]
 */
function startTokenCleanup(pool, intervalMs = 6 * 60 * 60 * 1000) {
  const run = () =>
    purgeExpiredTokens(pool)
      .then(count => {
        if (count > 0) {
          logger.info(`[token-cleanup] نُظفت ${count} صف توكن منتهٍ/مُبطَل`);
        }
      })
      .catch(err => logger.error(`[token-cleanup] فشل التنظيف: ${err.message}`));

  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, intervalMs);
  if (first.unref) {
    first.unref();
  }
  if (timer.unref) {
    timer.unref();
  }
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

module.exports = { purgeExpiredTokens, startTokenCleanup };
