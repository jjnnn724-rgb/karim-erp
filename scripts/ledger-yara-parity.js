#!/usr/bin/env node
'use strict';

/**
 * ledger-yara-parity.js — تسوية الدفتر مع مرآة يارسوفت (قرار المالك 2026-10-24)
 * ────────────────────────────────────────────────────────────────────────────
 * الهدف: إيراد الكاشير في الدفتر = إيراد الكاشير في المرآة رقمًا برقمًا، دون أي
 * كتابة على جداول يارسوفت (revenues/expenses تُقرأ فقط ولا تُمسّ أبدًا).
 *
 * ثلاث عمليات، كلها على journal_entries وحدها:
 *   1) إلغاء (status='void') القيود المزدوجة: صفّ إيراد رُحّل مرتين لأن المفتاح
 *      كان معرّفًا متغيّرًا يولّده المستورد عند كل استيراد (gl-bridge قبل إصلاح
 *      2026-10-24). يُلغى اليتيم الذي له توأم مطابق (نفس اليوم ونفس المبلغ) مرتبط
 *      بصفّ إيراد موجود — والإلغاء فردي (one-to-one) لا جماعي، فلا يُلغى قيد
 *      شرعي لصفّ حُذف من المرآة.
 *   2) ترحيل الفجوة: كل صفّ إيراد منذ YARASOFT_GL_CUTOVER بلا قيد يُرحَّل بقيد
 *      مستقل بمفتاحه الثابت (external_ref) عبر جسر الدفتر — idempotent.
 *   3) افتتاحي ما قبل الدفتر: الشهور الأقدم من التحول قيدٌ مجمَّع واحد لكل شهر
 *      (Dr 1000 · Cr 3100) لأن النظام لا يملك بيانات تكلفة قبلها.
 *
 * ثم تحقق قراءةً فقط: الفرق اليومي (مرآة مقابل دفتر) يجب أن يكون 0.00 لكل يوم.
 *
 * التشغيل:
 *   node scripts/ledger-yara-parity.js                        # معاينة — لا كتابة
 *   node scripts/ledger-yara-parity.js --apply --confirm-write=<DB_NAME>
 *   node scripts/ledger-yara-parity.js --rollback=<report.json> # رجوع لما سجّله التقرير
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
const { pool } = require('../backend/shared-pool');
const {
    bridgeUnbridged, bridgePreBooksToGl, cutoverDate, SOURCE_TYPE, PREBOOK_SOURCE_TYPE,
} = require('../backend/yarasoft/gl-bridge');

const APPLY = process.argv.includes('--apply');
const rollbackFile = argValue('--rollback=');
const dbName = process.env.DB_NAME || 'karim_erp';

function argValue(prefix) {
    const hit = process.argv.find((a) => String(a).startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
}

function money(v) {return Math.round(Number(v || 0) * 100) / 100;}
function fmt(n) {return money(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });}

/** بلغة SQL واحدة للمبلغ: دائن 4000 في قيود الإيراد (عملة الجسر الوحيدة). */
const LEDGER_AMT = `COALESCE((SELECT SUM(l.credit) FROM journal_lines l
                    WHERE l.entry_id = e.id AND l.account_code = '4000'), 0)`;

/**
 * المرشّحون للإلغاء: قيود إيراد يارسوفت المرحَّلة التي لا يقابلها صفّ إيراد،
 * أو الفائضة على صفّ واحد. المطابقة تُبنى في JS على قراءتين مفهرستين لأن
 * الفحص المتقاطع في SQL وحده كان يجعلها O(n²) على عشرين ألف قيد.
 */
async function findDuplicateCandidates() {
    const entries = (await pool.query(`
        SELECT e.id, e.entry_no, LEFT(e.date::text, 10) AS date, e.source_id, e.memo,
               ROUND(${LEDGER_AMT}::numeric, 2)::float8 AS amt
          FROM journal_entries e
         WHERE e.source_type = $1 AND e.status = 'posted'
         ORDER BY e.date, e.id`, [SOURCE_TYPE])).rows;

    const rows = (await pool.query('SELECT id, external_ref FROM revenues WHERE amount > 0')).rows;
    const revenueOf = new Map();
    for (const r of rows) {
        revenueOf.set(String(r.id), String(r.id));
        revenueOf.set(`id:${r.id}`, String(r.id));
        if (r.external_ref) {revenueOf.set(String(r.external_ref), String(r.id));}
    }

    const twinsByKey = new Map();
    const entriesPerRevenue = new Map();
    const orphans = [];
    for (const e of entries) {
        const revId = revenueOf.get(String(e.source_id));
        if (!revId) {orphans.push(e); continue;}
        const key = `${e.date}|${money(e.amt)}`;
        twinsByKey.set(key, (twinsByKey.get(key) || 0) + 1);
        if (!entriesPerRevenue.has(revId)) {entriesPerRevenue.set(revId, []);}
        entriesPerRevenue.get(revId).push(e);
    }

    const voids = [];
    const leftovers = [];
    for (const o of orphans) {
        // القيد بلا مفتاح (خلل الكاسح القديم) لا يمثّل أي صفّ — إلغاؤه مؤكد.
        if (String(o.source_id) === 'undefined') {voids.push({ ...o, reason: 'bogus_undefined_key' }); continue;}
        const key = `${o.date}|${money(o.amt)}`;
        const free = twinsByKey.get(key) || 0;
        // يتيم واحد لكل توأم: لا يُلغى قيد شرعي لمجرد أن مبلغًا مماثلًا تكرّر في اليوم.
        if (free > 0) {twinsByKey.set(key, free - 1); voids.push({ ...o, reason: 'duplicate_of_matched_entry' });} else {leftovers.push(o);}
    }
    for (const list of entriesPerRevenue.values()) {
        if (list.length < 2) {continue;}
        for (const extra of list.slice(1)) {voids.push({ ...extra, reason: 'surplus_entry_for_same_revenue_row' });}
    }
    return { voids, leftovers, orphanCount: orphans.length };
}

/** الفارق اليومي: مرآة مقابل دفتر (مرحَّل فقط) منذ يوم التحول. */
async function dailyParity() {
    return (await pool.query(`
        SELECT day, ROUND(SUM(mirror)::numeric, 2)::float8 AS mirror,
               ROUND(SUM(ledger)::numeric, 2)::float8 AS ledger
          FROM (
                SELECT LEFT(r.date, 10) AS day, r.amount::numeric AS mirror, 0::numeric AS ledger
                  FROM revenues r WHERE r.amount > 0 AND LEFT(r.date, 10) >= $1
                UNION ALL
                SELECT LEFT(e.date::text, 10), 0::numeric, ${LEDGER_AMT}::numeric
                  FROM journal_entries e
                 WHERE e.source_type = $2 AND e.status = 'posted' AND LEFT(e.date::text, 10) >= $1
          ) u GROUP BY day ORDER BY day`, [cutoverDate(), SOURCE_TYPE])).rows
        .map((r) => ({ ...r, diff: money(r.mirror - r.ledger) }));
}

async function preBookMonths() {
    return (await pool.query(`
        SELECT LEFT(r.date, 7) AS month, COUNT(*)::int AS n_rows,
               ROUND(SUM(r.amount)::numeric, 2)::float8 AS mirror
          FROM revenues r
         WHERE r.amount > 0 AND LEFT(r.date, 10) < $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type = $2
                              AND (je.source_id = r.external_ref
                                   OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                                   OR je.source_id = CAST(r.id AS TEXT)))
         GROUP BY 1 ORDER BY 1`, [cutoverDate(), SOURCE_TYPE])).rows;
}

async function voidEntries(list) {
    if (!list.length) {return [];}
    const ids = list.map((v) => String(v.id));
    const byId = new Map(list.map((v) => [String(v.id), v]));
    // حارس مزدوج: لا يُلغى إلا قيد إيراد يارسوفت المرحَّل — لا شيء آخر في الدفتر.
    // memo لا يُمسّ: قيدٌ مُلغى بهويته الأصلية يبقى للأثر (trg_fn_journal_posted_identity).
    const r = await pool.query(`
        UPDATE journal_entries e SET status = 'void'
          FROM (SELECT UNNEST($1::bigint[]) AS id) v
         WHERE e.id = v.id AND e.status = 'posted' AND e.source_type = $2
         RETURNING e.id, e.entry_no, e.memo`, [ids, SOURCE_TYPE]);
    return r.rows.map((row) => ({
        id: String(row.id), entry_no: row.entry_no, memo: row.memo,
        amount: byId.get(String(row.id))?.amt ?? null,
        reason: byId.get(String(row.id))?.reason ?? null,
    }));
}

async function rollback(file, confirm) {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.mode !== 'apply') {throw new Error('هذا التقرير معاينة ولم يكتب شيئًا — لا شيء للرجوع عنه');}
    if (confirm !== dbName) {throw new Error(`الرجوع يكتب في القاعدة: أعد التشغيل مع --rollback=<report.json> --confirm-write=${dbName}`);}
    const ids = (report.actions?.voided || []).map((v) => v.id);
    if (!ids.length) {console.log('لا قيود ملغاة في هذا التقرير.'); return ;}
    const restored = await pool.query(
        `UPDATE journal_entries e SET status = 'posted'
          FROM (SELECT UNNEST($1::bigint[]) AS id) v
         WHERE e.id = v.id AND e.status = 'void' AND e.source_type = $2 RETURNING e.id`,
        [ids, SOURCE_TYPE]);
    const created = (report.actions?.created_entries || []).map(String);
    const win = report.actions?.bridge_window || {};
    const revoided = await pool.query(
        `UPDATE journal_entries SET status = 'void'
          WHERE ((source_type = $2 AND created_at >= $4::timestamptz AND created_at <= $5::timestamptz)
                  OR (source_type = $3 AND source_id = ANY($1::text[])))
            AND status = 'posted' RETURNING id`,
        [created, SOURCE_TYPE, PREBOOK_SOURCE_TYPE, win.from || report.started_at, win.to || report.finished_at]);
    console.log(`رجوع: أُعيد ${restored.rows.length} قيدًا، أُلغي ${revoided.rows.length} قيدًا أنشأه التقرير.`);
}

(async () => {
    const started = new Date().toISOString();
    if (rollbackFile) {await rollback(rollbackFile, argValue('--confirm-write=')); await pool.end(); return;}
    if (APPLY && argValue('--confirm-write=') !== dbName) {
        console.error(`رفض الكتابة: أعد التشغيل مع --apply --confirm-write=${dbName}`);
        process.exitCode = 2; await pool.end(); return;
    }

    const report = {
        mode: APPLY ? 'apply' : 'dry_run',
        started_at: started,
        cutover: cutoverDate(),
        before: {}, after: {}, actions: { voided: [], created_entries: [] },
        needs_review: [],
    };

    // 0) صورة ما قبل الإصلاح
    report.before.daily = await dailyParity();
    report.before.prebook_months = await preBookMonths();
    const dup = await findDuplicateCandidates();
    report.before.duplicates = {
        orphan_entries: dup.voids.length + dup.leftovers.length,
        voidable: dup.voids.length,
        voidable_amount: money(dup.voids.reduce((s, v) => s + Number(v.amt || 0), 0)),
        needs_review: dup.leftovers.length,
        needs_review_amount: money(dup.leftovers.reduce((s, v) => s + Number(v.amt || 0), 0)),
    };
    report.needs_review = dup.leftovers;
    const unposted = (await pool.query(`
        SELECT COUNT(*)::int AS n_rows, COALESCE(SUM(r.amount), 0)::float8 AS amount
          FROM revenues r
         WHERE r.amount > 0 AND LEFT(r.date, 10) >= $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type = $2
                              AND (je.source_id = r.external_ref
                                   OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                                   OR je.source_id = CAST(r.id AS TEXT)))`,
    [cutoverDate(), SOURCE_TYPE])).rows[0];
    report.before.unposted = { n_rows: unposted.n_rows, amount: money(unposted.amount) };
    report.before.total_gap = money(report.before.daily.reduce((s, d) => s + d.diff, 0));

    if (!APPLY) {
        console.log('════ معاينة (لا كتابة) — أضف --apply --confirm-write=' + dbName + ' ════');
    }

    // 1) إلغاء المزدوجات
    if (dup.voids.length) {
        if (APPLY) {report.actions.voided = await voidEntries(dup.voids);} else {report.actions.voided = dup.voids;}
    }

    // 2) ترحيل فجوة أكتوبر عبر الجسر المُصلَّح (مفاتيح ثابتة)
    report.actions.created_entries = [];
    if (APPLY && Number(unposted.n_rows) > 0) {
        const from = new Date().toISOString();
        const drain = await bridgeUnbridged(pool, { limit: 200, maxPasses: 40 });
        report.actions.bridge = drain;
        report.actions.bridge_window = { from, to: new Date().toISOString() };
    }

    // 3) افتتاحي الشهور السابقة
    if (APPLY) {
        report.actions.prebooks = [];
        for (const m of report.before.prebook_months) {
            const out = await bridgePreBooksToGl(pool, { month: m.month });
            report.actions.prebooks.push({ month: m.month, total: out?.total ?? null, count: out?.count ?? null, skipped: out?.skipped ?? null });
            if (out?.total) {report.actions.created_entries.push(`revenue:${m.month}`);}
        }
    }

    // 4) التحقق
    report.after.daily = await dailyParity();
    report.after.duplicates = await findDuplicateCandidates().then((d) => ({ voidable: d.voids.length, needs_review: d.leftovers.length }));
    const afterUnposted = (await pool.query(`
        SELECT COUNT(*)::int AS n_rows, COALESCE(SUM(r.amount), 0)::float8 AS amount
          FROM revenues r
         WHERE r.amount > 0 AND LEFT(r.date, 10) >= $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type = $2
                              AND (je.source_id = r.external_ref
                                   OR je.source_id = ('id:' || CAST(r.id AS TEXT))
                                   OR je.source_id = CAST(r.id AS TEXT)))`,
    [cutoverDate(), SOURCE_TYPE])).rows[0];
    report.after.unposted = { n_rows: afterUnposted.n_rows, amount: money(afterUnposted.amount) };
    report.after.total_gap = money(report.after.daily.reduce((s, d) => s + d.diff, 0));
    report.after.opening_balance = (await pool.query(`
        SELECT e.source_id, e.date, ROUND(SUM(l.credit)::numeric, 2)::float8 AS amount
          FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
         WHERE e.source_type = $1 AND e.status = 'posted' AND l.account_code = '3100'
         GROUP BY 1, 2 ORDER BY 1`, [PREBOOK_SOURCE_TYPE])).rows;
    report.finished_at = new Date().toISOString();

    const outDir = argValue('--json=') || path.join(__dirname, '..', 'database', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `ledger-yara-parity-${started.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    // ════ ملخص ════
    console.log('\n════════ تكافؤ الدفتر مع يارسوفت ════════');
    console.log(`وضع التشغيل        : ${report.mode}${APPLY ? '' : '  (معاينة فقط — لم تُكتب أي بيانات)'}`);
    console.log(`يوم التحول         : ${report.cutover}`);
    console.log(`مزدوجات للإلغاء    : قبل ${report.before.duplicates.voidable} قيدًا / ${fmt(report.before.duplicates.voidable_amount)}`
        + `  → بعد ${report.after.duplicates.voidable}`);
    console.log(`يتطلب مراجعة       : ${report.before.duplicates.needs_review} قيدًا / ${fmt(report.before.duplicates.needs_review_amount)} (لا تُلغى تلقائيًا)`);
    console.log(`صفوف بلا قيد       : قبل ${report.before.unposted.n_rows} / ${fmt(report.before.unposted.amount)}`
        + `  → بعد ${report.after.unposted.n_rows} / ${fmt(report.after.unposted.amount)}`);
    console.log(`فجوة الفارق اليومي : قبل ${fmt(report.before.total_gap)}  → بعد ${fmt(report.after.total_gap)}`);
    for (const b of report.after.opening_balance) {console.log(`افتتاحي ${b.source_id}: ${b.date} / ${fmt(b.amount)}`);}
    const badDays = report.after.daily.filter((d) => Math.abs(d.diff) > 0.005);
    if (badDays.length) {
        console.log('\nأيام ما زالت غير متكافئة:');
        for (const d of badDays) {console.log(`  ${d.day}: مرآة ${fmt(d.mirror)} | دفتر ${fmt(d.ledger)} | فرق ${fmt(d.diff)}`);}
    } else {
        console.log('\n✓ كل يوم منذ التحول: إيراد الدفتر = إيراد المرآة (فرق 0.00).');
    }
    console.log(`\nالتقرير: ${outFile}`);

    if (badDays.length || (APPLY && report.after.unposted.n_rows > 0)) {process.exitCode = 1;}
    await pool.end();
})().catch(async (e) => {
    console.error('فشل السكربت:', e.message);
    try {await pool.end();} catch (_) {}
    process.exitCode = 1;
});
