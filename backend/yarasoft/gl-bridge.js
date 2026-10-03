'use strict';

/**
 * yarasoft/gl-bridge.js — جسر الإيراد اللحظي إلى الدفتر (R3 — قرار المالك 2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────
 * قرار المالك: مبيعات كاشير يارسوفت تصل لحظيًا (poll كل دقيقة) وتُرحَّل للدفتر
 * لحظيًا أيضًا — كل صف إيراد قيد مستقل idempotent بمفتاح (source_type,
 * source_id=رِقَم صف الإيراد) فلا ازدواج مهما أُعيد التشغيل.
 *
 * القيد: Dr 1000 (تحصيل نقدي عند الكاشير) · Cr 4000 (إيراد مبيعات) — المبالغ
 * صافية (NET_VAL من يارسوفت) فلا سطر ضريبة (ضريبة هذه الفواتير تعيش في
 * ora_e_invoices الإلكترونية).
 *
 * حدود الفترة التاريخية: YARASOFT_GL_CUTOVER (افتراضي 2026-10-03) — الصفوف
 * الأقدم منه لا تُرحَّل تلقائيًا (تجنّب تضخيم الصندوق اليومي بتاريخ شهر كامل)؛
 * لو أراد المالك الجسر الكامل للسجل: يضبط المتغير إلى 2026-09-08.
 * إيقاف الجسر كله: YARASOFT_GL_BRIDGE=false.
 */
const { logger } = require('../logger');

function bridgeEnabled() {
    return String(process.env.YARASOFT_GL_BRIDGE ?? 'true').trim().toLowerCase() !== 'false';
}
function cutoverDate() {
    return String(process.env.YARASOFT_GL_CUTOVER || '2026-10-03').slice(0, 10);
}

/** ترحيل صف إيراد واحد — idempotent (replay عند التكرار، لا ازدواج أبدًا) */
async function bridgeRevenueToGl(pool, { revenueId, source, amount, date }) {
    if (!bridgeEnabled()) {return { skipped: 'bridge_disabled' };}
    const amt = Number(amount);
    if (!(amt > 0)) {return { skipped: 'non_positive_amount' };}
    const day = String(date || '').slice(0, 10);
    if (day < cutoverDate()) {return { skipped: 'before_cutover', cutover: cutoverDate() };}
    const { postJournal } = require('../accounting-routes');
    const out = await postJournal(pool, {
        date: day,
        memo: `مبيعات كاشير يارسوفت — ${source || 'كاشير'}`,
        source_type: 'yarasoft_revenue',
        source_id: String(revenueId),
        lines: [
            { account_code: '1000', debit: amt, credit: 0, memo: 'تحصيل نقدي — كاشير يارسوفت' },
            { account_code: '4000', debit: 0, credit: amt, memo: 'إيراد مبيعات (صافي)' },
        ],
    });
    if (!out.replay) {logger.info(`[YARA-GL] إيراد #${revenueId} (${day}, ${amt}) → قيد ${out.entry.entry_no}`);}
    return out;
}

/** كاسح إصلاح: يرحّل أي صفوف إيراد غير مرحّلة (فشل لحظي/سقوط أثناء الترحيل) */
async function bridgeUnbridged(pool, { limit = 200 } = {}) {
    if (!bridgeEnabled()) {return { bridged: 0, skipped: 'bridge_disabled' };}
    const rows = (await pool.query(
        `SELECT r.id, r.source, r.amount, r.date
           FROM revenues r
          WHERE r.amount > 0 AND r.date >= $1
            AND NOT EXISTS (
                SELECT 1 FROM journal_entries je
                 WHERE je.source_type = 'yarasoft_revenue' AND je.source_id = CAST(r.id AS TEXT)
            )
          ORDER BY r.date, r.id LIMIT $2`, [cutoverDate(), limit])).rows;
    let bridged = 0;
    for (const row of rows) {
        try {
            const out = await bridgeRevenueToGl(pool, row);
            if (!out.skipped) {bridged++;}
        } catch (e) {
            logger.warn(`[YARA-GL] فشل جسر صف #${row.id}: ${e.message}`);
        }
    }
    if (bridged > 0) {logger.info(`[YARA-GL] sweep: رُحّل ${bridged} صف إيراد`);}
    return { bridged, scanned: rows.length };
}

module.exports = { bridgeRevenueToGl, bridgeUnbridged, bridgeEnabled, cutoverDate };
