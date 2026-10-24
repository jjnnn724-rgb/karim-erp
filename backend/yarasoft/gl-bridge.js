'use strict';

/**
 * yarasoft/gl-bridge.js — جسر الإيراد اللحظي إلى الدفتر (R3 — قرار المالك 2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────
 * قرار المالك: مبيعات كاشير يارسوفت تصل لحظيًا (poll كل دقيقة) وتُرحَّل للدفتر
 * لحظيًا أيضًا — كل صف إيراد قيد مستقل idempotent فلا ازدواج مهما أُعيد التشغيل.
 *
 * القيد: Dr 1000 (تحصيل نقدي عند الكاشير) · Cr 4000 (إيراد مبيعات) — المبالغ
 * صافية (NET_VAL من يارسوفت) فلا سطر ضريبة (ضريبة هذه الفواتير تعيش في
 * ora_e_invoices الإلكترونية).
 *
 * ═══ مفتاح الجسر (إصلاح 2026-10-24) ═══
 * المستورد يولِّد معرّف صف الإيراد عشوائيًا وقت الاستيراد
 * (importer.js: `Date.now()*1000 + rand`)، فأي إعادة استيراد لنفس الفاتورة
 * تُنتج معرّفًا جديدًا. حين كان الجسر مثبَّتًا على المعرّف كان ذلك يرحّل نفس
 * المبيعات مرتين (حدث فعلًا ليومي 5–6 أكتوبر: 1,447 قيدًا / 129,182.64).
 * المفتاح الآن هو external_ref — فريد بمؤشر قاعدة البيانات
 * (schema.js: uq_revenues_external_ref) وبنفس قوة منع الازدواج عند المستورد —
 * ويُقبل المعرّف القديم كمفتاح ثانوي في الفحص حتى لا يُعاد ترحيل ما رُحِّل قبل
 * الإصلاح. الصف الذي بلا مرجع (نادر: صفوف يدوية) يبقى على معرّفه.
 *
 * حدود الفترة التاريخية: YARASOFT_GL_CUTOVER (افتراضي 2026-10-01) — الصفوف
 * الأقدم تُرحَّل قيدًا افتتاحيًا مجمَّعًا (bridgePreBooksToGl) لا إيرادًا يوميًا،
 * لأن النظام لا يملك أي بيانات تكلفة/مخزون قبل 2026-10-04 فترحيلها إيرادًا
 * يُنتج قائمة دخل كاذبة. إيقاف الجسر كله: YARASOFT_GL_BRIDGE=false.
 */
const { logger } = require('../logger');

const SOURCE_TYPE = 'yarasoft_revenue';
const PREBOOK_SOURCE_TYPE = 'yarasoft_prebooks';
const DEFAULT_CUTOVER = '2026-10-01';

function bridgeEnabled() {
    return String(process.env.YARASOFT_GL_BRIDGE ?? 'true').trim().toLowerCase() !== 'false';
}
function cutoverDate() {
    return String(process.env.YARASOFT_GL_CUTOVER || DEFAULT_CUTOVER).slice(0, 10);
}

/** معرّف الجسر الثابت: المرجع الخارجي أولًا، وإلا معرّف الصف بمبادئة صريحة. */
function bridgeKeyOf({ externalRef, revenueId } = {}) {
    const ref = String(externalRef ?? '').trim();
    if (ref) {return ref;}
    const id = String(revenueId ?? '').trim();
    return id ? `id:${id}` : '';
}

/** المفاتيح التي قد يكون بها قيد سابق: المرجع الثابت + المعرّف (صريحًا وقديمًا). */
function bridgeKeysOf(row = {}) {
    const keys = [];
    const ref = String(row.externalRef ?? row.external_ref ?? '').trim();
    const id = String(row.revenueId ?? row.id ?? '').trim();
    if (ref) {keys.push(ref);}
    if (id) {keys.push(`id:${id}`, id);}
    return [...new Set(keys)];
}

/** هل رُحِّل هذا الصف فعلًا؟ يعيد القيد الموجود (مرحَّلًا كان أو ملغيًا). */
async function findBridged(pool, row = {}) {
    const keys = bridgeKeysOf(row);
    if (!keys.length) {return null;}
    return (await pool.query(
        `SELECT id, entry_no, status FROM journal_entries
          WHERE source_type = $1 AND source_id = ANY($2::text[])
          ORDER BY (status = 'posted')::int DESC, id LIMIT 1`,
        [SOURCE_TYPE, keys])).rows[0] || null;
}

/** ترحيل صف إيراد واحد — idempotent على المفتاح الثابت (replay، لا ازدواج أبدًا) */
async function bridgeRevenueToGl(pool, { revenueId, externalRef, source, amount, date }) {
    if (!bridgeEnabled()) {return { skipped: 'bridge_disabled' };}
    const amt = Number(amount);
    if (!(amt > 0)) {return { skipped: 'non_positive_amount' };}
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {return { skipped: 'invalid_date' };}
    const key = bridgeKeyOf({ externalRef, revenueId });
    // حارس صمت قاتل: الكاسح كان يمرّر row.id بينما التوقيع يقرأ revenueId،
    // فارْتُحل كل صف بمعرّف 'undefined' وأُعيد بث «replay» بلا أي قيد فعلي.
    if (!key || /^(undefined|null|NaN)$/i.test(key) || key === 'id:undefined') {
        return { skipped: 'missing_bridge_key', revenueId: String(revenueId ?? '') };
    }
    if (day < cutoverDate()) {return { skipped: 'before_cutover', cutover: cutoverDate() };}

    const existing = await findBridged(pool, { externalRef, revenueId });
    if (existing) {
        return existing.status === 'posted'
            ? { entry: existing, replay: true }
            : { entry: existing, skipped: 'previously_voided' };
    }

    const { postJournal } = require('../accounting-routes');
    const out = await postJournal(pool, {
        date: day,
        memo: `مبيعات كاشير يارسوفت — ${source || 'كاشير'}`,
        source_type: SOURCE_TYPE,
        source_id: key,
        lines: [
            { account_code: '1000', debit: amt, credit: 0, memo: 'تحصيل نقدي — كاشير يارسوفت' },
            { account_code: '4000', debit: 0, credit: amt, memo: 'إيراد مبيعات (صافي)' },
        ],
    });
    if (!out.replay) {logger.info(`[YARA-GL] إيراد ${key} (${day}, ${amt}) → قيد ${out.entry.entry_no}`);}
    return out;
}

/**
 * كاسح إصلاح: يرحّل أي صفوف إيراد غير مرحّلة (فشل لحظي/سقوط/فجوة بعد الإصلاح).
 * يدور حتى التجفيف —دورة قراءة واحدة بحدّ كانت تترك المئات معلّقة إلى الأبد.
 */
async function bridgeUnbridged(pool, { limit = 200, maxPasses = 40 } = {}) {
    if (!bridgeEnabled()) {return { bridged: 0, skipped: 'bridge_disabled' };}
    let bridged = 0;
    let scanned = 0;
    let passes = 0;
    let remaining = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
        passes++;
        const rows = (await pool.query(
            `SELECT r.id, r.source, r.amount, r.date, r.external_ref
               FROM revenues r
              WHERE r.amount > 0 AND LEFT(r.date, 10) >= $1
                AND NOT EXISTS (
                    SELECT 1 FROM journal_entries je
                     WHERE je.source_type = $3
                       AND (je.source_id = r.external_ref
                            OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                            OR je.source_id = CAST(r.id AS TEXT))
                )
              ORDER BY r.date, r.id LIMIT $2`, [cutoverDate(), limit, SOURCE_TYPE])).rows;
        scanned += rows.length;
        if (!rows.length) {remaining = 0; break;}
        let postedThisPass = 0;
        for (const row of rows) {
            try {
                const out = await bridgeRevenueToGl(pool, {
                    revenueId: row.id, externalRef: row.external_ref,
                    source: row.source, amount: row.amount, date: row.date,
                });
                if (!out.skipped) {postedThisPass++; bridged++;}
            } catch (e) {
                logger.warn(`[YARA-GL] فشل جسر صف #${row.id}: ${e.message}`);
            }
        }
        remaining = rows.length - postedThisPass;
        // الصفوف المرفوضة (غير مرحَّلة ولم تُبث) لا تختفي من الاستعلام — لا
        // تدوير أزلي: إن لم يُرحَّل شيء في دورة كاملة نتوقف وأبلغ المتبقي.
        if (!postedThisPass) {break;}
    }
    if (bridged > 0) {logger.info(`[YARA-GL] sweep: رُحّل ${bridged} صف إيراد في ${passes} دورة`);}
    if (remaining > 0) {logger.warn(`[YARA-GL] sweep: بقي ${remaining} صفًا بلا ترحيل (مرفوض/ملغى مسبقًا)`);}
    return { bridged, scanned, passes, remaining };
}

/**
 * الصفوف الأقدم من يوم التحول: قيد افتتاحي مجمَّع لكل شهر —
 * Dr 1000 صندوق · Cr 3100 أرباح محتجزة (لا 4000: لا تكلفة في تلك الشهور).
 */
async function bridgePreBooksToGl(pool, { month } = {}) {
    if (!bridgeEnabled()) {return { skipped: 'bridge_disabled' };}
    const m = String(month || cutoverDate().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(m)) {throw Object.assign(new Error('شهر غير صالح (YYYY-MM)'), { statusCode: 422 });}
    if (m >= cutoverDate().slice(0, 7)) {return { skipped: 'not_pre_book_month', cutover: cutoverDate() };}
    const agg = (await pool.query(
        `SELECT COALESCE(SUM(r.amount),0)::numeric(16,2) AS t, COUNT(*)::int AS n
           FROM revenues r
          WHERE r.amount > 0 AND LEFT(r.date, 7) = $1
            AND LEFT(r.date, 10) < $2
            AND NOT EXISTS (
                SELECT 1 FROM journal_entries je
                 WHERE je.source_type = $3
                   AND (je.source_id = r.external_ref
                        OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                        OR je.source_id = CAST(r.id AS TEXT))
            )`, [m, cutoverDate(), SOURCE_TYPE])).rows[0];
    const total = Number(agg.t);
    const count = Number(agg.n);
    if (!(total > 0)) {return { skipped: 'nothing_to_book', month: m };}

    const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const { postJournal } = require('../accounting-routes');
    const out = await postJournal(pool, {
        date: lastDay,
        memo: `إيراد ${m} قبل افتتاح الدفتر — يارسوفت (${count} حركة)`,
        source_type: PREBOOK_SOURCE_TYPE,
        source_id: `revenue:${m}`,
        lines: [
            { account_code: '1000', debit: total, credit: 0, memo: `نقدية محصَّلة قبل ${cutoverDate()}` },
            { account_code: '3100', debit: 0, credit: total, memo: 'أرباح فترات قبل الدفتر' },
        ],
    });
    if (!out.replay) {logger.info(`[YARA-GL] افتتاحي ${m}: ${total} (${count} حركة) → قيد ${out.entry.entry_no}`);}
    return { ...out, total, count, month: m };
}

module.exports = {
    bridgeRevenueToGl, bridgeUnbridged, bridgePreBooksToGl,
    bridgeEnabled, cutoverDate, bridgeKeyOf, bridgeKeysOf, findBridged,
    SOURCE_TYPE, PREBOOK_SOURCE_TYPE, DEFAULT_CUTOVER,
};
