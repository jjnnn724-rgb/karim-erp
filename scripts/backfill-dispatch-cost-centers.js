#!/usr/bin/env node
'use strict';
/**
 * backfill-dispatch-cost-centers.js — تعبئة cost_center_code لقيود الصرف القديمة
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة: قيود الصرف المُرحّلة قبل إصلاح تطبيع رمز مركز التكلفة
 * (2026-10-26) بُنيت ببنود بلا cost_center_code. الأثر: تقرير
 * /accounting/profit-by-cost-center يقرأ الأستاذ فيرى كلفةً بلا مركز،
 * وربحية المركز لا تُطابق شاشة التكاليف التي تقرأ expenses الأصلية.
 *
 * الحل: كل بند بلا مركز في قيد source_type='dispatch' يأخذ مركز الإذن نفسه
 * (dispatches."deptCode") بعد تطبيع الرمز بالدالة الوحيدة في
 * backend/accounting-routes.js — نفس ما يفعله الترحيل الجديد حرفيًا.
 * لا يُلمس أي قيد آخر (إيراد يارا، فواتير الشراء، المصروفات اليدوية): تلك
 * قيود على مستوى الشركة لا تُنسب لقسم.
 *
 * الأمان:
 *   • معاينة افتراضية — لا كتابة إلا مع --apply.
 *   • fill-only: UPDATE … WHERE cost_center_code IS NULL (idempotent، ولا يكتب
 *     فوق مركز كُتب يدويًا).
 *   • معاملة واحدة لكل دفعة + تحقّق قبلي/بعدي أن إجمالي المدين لم يتغيّر.
 *   • الإذن بلا deptCode أو بلا صف dispatch يُبلَّغ عنه ولا يُخمَّن.
 *
 * الاستخدام:
 *   node scripts/backfill-dispatch-cost-centers.js
 *   node scripts/backfill-dispatch-cost-centers.js --apply
 */

const { pool } = require('../backend/shared-pool');
const { normalizeCostCenterCode, ensureCostCenters } = require('../backend/accounting-routes');

const APPLY = process.argv.includes('--apply');
const CHUNK = 400;

const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadPlan() {
    const { rows } = await pool.query(`
        SELECT e.id AS entry_id,
               e.source_id,
               e.date::text AS entry_date,
               d."deptCode" AS dept_code,
               COUNT(l.id)::int AS line_count,
               COALESCE(SUM(l.debit), 0)::numeric(14,2) AS debit
          FROM journal_entries e
          JOIN journal_lines l ON l.entry_id = e.id AND l.cost_center_code IS NULL
          LEFT JOIN dispatches d ON d.id::text = e.source_id
         WHERE e.status = 'posted' AND e.source_type = 'dispatch'
         GROUP BY e.id, e.source_id, e.date, d."deptCode"
         ORDER BY e.id`);
    return rows.map((r) => ({
        entryId: String(r.entry_id),
        sourceId: String(r.source_id ?? ''),
        date: String(r.entry_date || '').slice(0, 10),
        deptCode: r.dept_code ? String(r.dept_code) : null,
        costCenter: r.dept_code ? normalizeCostCenterCode(r.dept_code) : '',
        lineCount: Number(r.line_count) || 0,
        debit: Number(r.debit) || 0,
    }));
}

async function ledgerSnapshot() {
    const { rows } = await pool.query(`
        SELECT COUNT(l.id)::int AS lines,
               COUNT(l.id) FILTER (WHERE l.cost_center_code IS NULL)::int AS null_lines,
               COALESCE(SUM(l.debit), 0)::numeric(16,2) AS debit
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.status = 'posted' AND e.source_type = 'dispatch'`);
    const r = rows[0];
    return { lines: r.lines, nullLines: r.null_lines, debit: Number(r.debit) || 0 };
}

function summarize(plan) {
    const byDept = new Map();
    for (const row of plan) {
        if (!row.costCenter) {continue;}
        const cur = byDept.get(row.costCenter) || { entries: 0, lines: 0, debit: 0 };
        cur.entries += 1;
        cur.lines += row.lineCount;
        cur.debit += row.debit;
        byDept.set(row.costCenter, cur);
    }
    return [...byDept.entries()].sort((a, b) => b[1].debit - a[1].debit);
}

async function apply(plan) {
    const chunks = [];
    for (let i = 0; i < plan.length; i += CHUNK) {chunks.push(plan.slice(i, i + CHUNK));}
    let updated = 0;
    for (const chunk of chunks) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(
                `UPDATE journal_lines l
                    SET cost_center_code = x.cc
                   FROM UNNEST($1::bigint[], $2::text[]) AS x(entry_id, cc)
                  WHERE l.entry_id = x.entry_id
                    AND l.cost_center_code IS NULL`,
                [chunk.map((r) => r.entryId), chunk.map((r) => r.costCenter)]);
            await client.query('COMMIT');
            updated += res.rowCount || 0;
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
    }
    return updated;
}

async function main() {
    console.log(`[BACKFILL-CC] الوضع: ${APPLY ? 'تنفيذ (--apply)' : 'معاينة فقط — أضف --apply للكتابة'}`);

    const before = await ledgerSnapshot();
    const plan = await loadPlan();
    const resolvable = plan.filter((r) => r.costCenter);
    const orphans = plan.filter((r) => !r.costCenter);

    console.log(`[BACKFILL-CC] بنود صرف بلا مركز: ${before.nullLines} بندًا في ${plan.length} قيدًا · القيمة ${money(plan.reduce((s, r) => s + r.debit, 0))}`);
    console.log(`[BACKFILL-CC] قابلة للتعبئة: ${resolvable.length} قيدًا / ${resolvable.reduce((s, r) => s + r.lineCount, 0)} بندًا`);
    if (orphans.length) {
        console.log(`[BACKFILL-CC] تحذير: ${orphans.length} قيدًا بلا إذن مرجعي أو بلا deptCode — لن تُلمس:`);
        for (const row of orphans.slice(0, 20)) {
            console.log(`  - قيد ${row.entryId} (إذن ${row.sourceId || '؟'}) ${row.date} · ${money(row.debit)}`);
        }
    }
    for (const [code, agg] of summarize(resolvable)) {
        console.log(`  · ${code.padEnd(16)} ${String(agg.entries).padStart(4)} قيدًا · ${String(agg.lines).padStart(4)} بندًا · ${money(agg.debit)}`);
    }

    if (!resolvable.length) {
        console.log('[BACKFILL-CC] لا شيء لتعبئته — القيود مكتملة المراكز.');
        return;
    }
    if (!APPLY) {
        console.log('[BACKFILL-CC] لم تُكتب أي بيانات (معاينة).');
        return;
    }

    await ensureCostCenters([...new Set(resolvable.map((r) => r.costCenter))]);
    const updated = await apply(resolvable);

    const after = await ledgerSnapshot();
    const debitDelta = Math.round((after.debit - before.debit) * 100) / 100;
    console.log(`[BACKFILL-CC] تم تحديث ${updated} بندًا.`);
    console.log(`[BACKFILL-CC] بندًا بلا مركز الآن: ${after.nullLines} (كان ${before.nullLines}) · المدين ${money(after.debit)} (فرق ${money(debitDelta)})`);
    if (Math.abs(debitDelta) > 0.009) {
        console.error('[BACKFILL-CC] خطأ: تغيّر إجمالي المدين — راجع القيود فورًا.');
        process.exitCode = 2;
        return;
    }
    if (after.nullLines !== orphans.reduce((s, r) => s + r.lineCount, 0)) {
        console.error('[BACKFILL-CC] تحذير: بقي بنود بلا مركز أكثر/أقل من غير القابلة للتعبئة — راجع التقرير.');
        process.exitCode = 3;
    }
}

main()
    .catch((e) => { console.error(`[BACKFILL-CC] فشل: ${e.message}`); process.exitCode = 1; })
    .finally(() => pool.end().catch(() => {}));
