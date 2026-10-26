#!/usr/bin/env node
'use strict';
/**
 * reconcile-dispatch-ledger.js — كشف وترحيل أذون الصرف التي لم تصل إلى الأستاذ
 * ═══════════════════════════════════════════════════════════════════════
 * WHY
 *   ترحيل قيد الإذن (Dr 5000 تكلفة المخزون المصروف / Cr 1200 المخزون) يجري
 *   **بعد** COMMIT حركة المخزون والمصروف. فإذا فشل (كما حدث 2026-10-26:
 *   قيد `cost_centers_code_check` رفض أسماء الأقسام بأحرف صغيرة) بقي الإذن
 *   معتمدًا، والمخزون ناقصًا، ولا قيد في الدفتر — فرقٌ صامت بين دفتر المخزون
 *   ودفتر الأستاذ. هذا السكربت يكشف الفرق، ويرحّل الناقص عند الطلب فقط.
 *
 * USAGE
 *   node scripts/reconcile-dispatch-ledger.js            # تقرير فقط (افتراضي)
 *   node scripts/reconcile-dispatch-ledger.js --apply    # ترحيل الناقص
 *   node scripts/reconcile-dispatch-ledger.js --dept kitchen --since 2026-10-01
 *
 * SAFETY
 *   • بلا --apply لا يكتب شيئًا إطلاقًا.
 *   • الترحيل idempotent: postJournal يردّ القيد القائم بدل إنشاء ثانٍ
 *     (source_type='dispatch' + source_id=<id>).
 *   • لا يحذف ولا يعدّل أي قيد قائم، ولا يمسّ المخزون أو المصروفات.
 *   • الأذون بقيمة صفر تُتخطّى صراحةً (لا قيد بلا مبلغ).
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { pool } = require(path.join(ROOT, 'backend', 'shared-pool'));
const { postDispatchToLedger } = require(path.join(ROOT, 'backend', 'accounting-routes'));

const COSTED = ['approved', 'received', 'partially_received', 'closed'];

function arg(name) {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : null;
}
const APPLY = process.argv.includes('--apply');
const dept = arg('--dept');
const since = arg('--since');

async function main() {
    const params = [];
    const where = [`d.status = ANY($1::text[])`];
    params.push(COSTED);
    if (dept) { params.push(dept); where.push(`d."deptCode" = $${params.length}`); }
    if (since) { params.push(since); where.push(`d.date >= $${params.length}`); }

    const { rows } = await pool.query(`
        SELECT d.id, d.date, d.status, d."deptCode" AS dept,
               COALESCE(v.total, 0)::numeric(14,2) AS value
          FROM dispatches d
          LEFT JOIN LATERAL (
                SELECT SUM((x->>'approvedValue')::numeric) AS total
                  FROM jsonb_array_elements(COALESCE(d."approvedItems", '[]'::jsonb)) x
               ) v ON TRUE
         WHERE ${where.join(' AND ')}
           AND NOT EXISTS (
                SELECT 1 FROM journal_entries e
                 WHERE e.source_type = 'dispatch' AND e.source_id = d.id::text)
         ORDER BY d.date, d.id`, params);

    const zero = rows.filter((r) => !(Number(r.value) > 0));
    const todo = rows.filter((r) => Number(r.value) > 0);
    const total = todo.reduce((s, r) => s + Number(r.value), 0);

    console.log(`أذون معتمدة بلا قيد: ${rows.length}  (بقيمة: ${todo.length} / ${total.toFixed(2)})`);
    if (zero.length) { console.log(`  منها ${zero.length} بقيمة صفر — تُتخطّى (لا قيد بلا مبلغ).`); }
    todo.forEach((r) => console.log(`  #${r.id}  ${r.date}  ${r.status.padEnd(16)} ${String(r.dept || '?').padEnd(15)} ${Number(r.value).toFixed(2)}`));

    if (!APPLY) {
        console.log('\nتقرير فقط. للترحيل: أضف --apply');
        return 0;
    }
    if (!todo.length) { console.log('لا شيء ليُرحَّل.'); return 0; }

    let ok = 0;
    const failed = [];
    for (const r of todo) {
        try {
            const out = await postDispatchToLedger(r.id, {
                totalValue: Number(r.value), date: String(r.date), deptCode: r.dept,
            });
            if (out && out.skipped) { failed.push({ id: r.id, why: out.skipped }); continue; }
            ok += 1;
            console.log(`  ✓ #${r.id} ${out.replay ? '(قيد قائم)' : `(${out.entry && out.entry.entry_no})`}`);
        } catch (e) {
            failed.push({ id: r.id, why: e && (e.message || e.code) });
            console.log(`  ✗ #${r.id} ${e && (e.message || e.code)}`);
        }
    }
    console.log(`\nتم: ${ok}/${todo.length}`);
    if (failed.length) { console.log('فشل:', JSON.stringify(failed)); return 1; }
    return 0;
}

main()
    .then(async (code) => { await pool.end().catch(() => {}); process.exitCode = code; })
    .catch(async (e) => { console.error('ERR', e && (e.message || e)); await pool.end().catch(() => {}); process.exitCode = 1; });
