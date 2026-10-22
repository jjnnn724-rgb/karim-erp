#!/usr/bin/env node
/**
 * closing-gap-audit.js — كشف فجوة الإقفال والتسوية النقدية (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * لماذا هذا الملف: تبيّن المراجعة أن إقفال اليوم (Z) يُسجَّل بأصفار،
 * لأن المتجر يبيع من YaraSoft (ولا جلسات للصندوق في نقاط البيع المحلية)
 * ⇒ فالنقد الفعلي لا يُقارَن بالمتوقَّع أبدًا، ويبدو الإقفال «سليمًا» وهو
 * ليس مُثبتًا. هذا التدقيق يخرج التسوية الصحيحة (قراءة فقط).
 *
 * القيد الحاكم (قرار المالك 2026-10-22):
 *   · YaraSoft للقراءة فقط: لا كتابة ولا تعديل ولا حذف.
 *   · لا شيء يُكتب في أي جدول: هذا التقرير فقط (SELECT).
 *   · لا يُرحَّل أي قيد ولا يُفتح إقفال — يُعرض الفرق للمالك لقراره.
 *
 * التشغيل:  node scripts/closing-gap-audit.js [--days 16] [--from 2026-10-06]
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../backend/shared-pool');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Math.min(Math.max(Number(argOf('days', 16)) || 16, 1), 120);
const FROM = String(argOf('from', ''));

const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const fmt = (v) => money(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
    const riyadh = await pool.query("SELECT (NOW() AT TIME ZONE 'Asia/Riyadh')::date AS today");
    const rawToday = riyadh.rows[0].today;
    const today = rawToday instanceof Date ? rawToday.toISOString().slice(0, 10) : String(rawToday).slice(0, 10);
    const from = FROM || String(new Date(new Date(`${today}T00:00:00Z`).getTime() - (DAYS - 1) * 86400000).toISOString().slice(0, 10));

    console.log('════════════════════════════════════════════════════════════════');
    console.log(' كشف فجوة الإقفال والتسوية النقدية — قراءة فقط (بلا أي كتابة)');
    console.log(` الفترة: ${from} ← ${today}   (اليوم بالرياض)`);
    console.log('════════════════════════════════════════════════════════════════');

    // ١) حالة الإقفالات (Z) المسجَّلة
    const closes = await pool.query(`
        SELECT z_number, close_date::date AS day, total_expected, total_actual, total_variance
          FROM pos_day_closes WHERE close_date::date BETWEEN $1::date AND $2::date
         ORDER BY close_date DESC
    `, [from, today]);
    console.log(`\n【١】 الإقفالات (Z) المسجَّلة في الفترة: ${closes.rows.length}`);
    for (const c of closes.rows) {
        console.log(`   ${c.z_number} · ${String(c.day).slice(0, 10)} · متوقع ${fmt(c.total_expected)} · فعلي ${fmt(c.total_actual)} · فرق ${fmt(c.total_variance)}`);
    }
    if (!closes.rows.length) { console.log('   (لا إقفال مسجَّل في الفترة)'); }

    // ٢) التسوية النقدية من مرآة YaraSoft (قراءة فقط)
    const recon = await pool.query(`
        SELECT o.doc_date::date AS day,
               COUNT(*)::int AS invoices,
               COALESCE(SUM(o.total),0)::float AS gross,
               COALESCE(SUM(o.vat),0)::float AS vat,
               COALESCE(SUM(o.net),0)::float AS net,
               COALESCE(SUM(o.pay_cash),0)::float AS cash,
               COALESCE(SUM(o.pay_network),0)::float AS card,
               COALESCE(SUM(o.pay_credit),0)::float AS credit,
               COALESCE(SUM(o.pay_mobile),0)::float AS mobile
          FROM ys_mirror_orders o
         WHERE o.doc_date::date BETWEEN $1::date AND $2::date
         GROUP BY 1 ORDER BY 1
    `, [from, today]);
    console.log('\n【٢】 التسوية النقدية (من مرآة YaraSoft — المتوقَّع من البيع)');
    console.log('   اليوم        فواتير     إجمالي      ضريبة       صافي        نقد        شبكة        أخرى');
    const tot = { n: 0, gross: 0, cash: 0, card: 0 };
    for (const d of recon.rows) {
        const other = money(d.credit + d.mobile);
        console.log(`   ${String(d.day).slice(0, 10)}  ${String(d.invoices).padStart(5)}  ${fmt(d.gross).padStart(11)} ${fmt(d.vat).padStart(10)} ${fmt(d.net).padStart(11)} ${fmt(d.cash).padStart(11)} ${fmt(d.card).padStart(11)} ${fmt(other).padStart(9)}`);
        tot.n += d.invoices; tot.gross += d.gross; tot.cash += d.cash; tot.card += d.card;
    }
    console.log(`   الإجمالي      ${String(tot.n).padStart(5)}  ${fmt(tot.gross).padStart(11)} ${' '.repeat(10)} ${' '.repeat(11)} ${fmt(tot.cash).padStart(11)} ${fmt(tot.card).padStart(11)}`);

    // ٣) المصروفات التشغيلية (بلا حركات المخزون — فهي ليست مصروفًا)
    const exp = await pool.query(`
        SELECT date::date AS day, COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total
          FROM expenses
         WHERE date::date BETWEEN $1::date AND $2::date
           AND COALESCE("adjustmentType",'') NOT IN
               ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')
         GROUP BY 1 ORDER BY 1
    `, [from, today]);
    console.log('\n【٣】 المصروفات التشغيلية (بلا تحويل/صرف/جرد — تلك مخزون لا مصروف)');
    let expTot = 0;
    for (const d of exp.rows) { console.log(`   ${String(d.day).slice(0, 10)}  ${String(d.n).padStart(4)} عملية  ${fmt(d.total).padStart(12)}`); expTot += d.total; }
    console.log(`   الإجمالي: ${fmt(expTot)}`);

    // ٤) ما رحَّله الدليل فعليًا (للمقارنة)
    const gl = await pool.query(`
        SELECT e.date::date AS day, COUNT(DISTINCT e.id)::int AS entries,
               COALESCE(SUM(l.credit) FILTER (WHERE c.type = 'revenue'),0)::float AS revenue,
               COALESCE(SUM(l.debit)  FILTER (WHERE c.type IN ('cogs','expense')),0)::float AS cost
          FROM journal_entries e
          JOIN journal_lines l ON l.entry_id = e.id
          JOIN chart_of_accounts c ON c.code = l.account_code
         WHERE e.status = 'posted' AND e.date::date BETWEEN $1::date AND $2::date
         GROUP BY 1 ORDER BY 1
    `, [from, today]);
    const glMap = new Map(gl.rows.map((r) => [String(r.day).slice(0, 10), r]));
    console.log('\n【٤】 الدليل (ما رحَّله فعلًا) × التشغيل (YaraSoft) — الفرق = يوم غير مُرحَّل أو فرق ضريبة');
    console.log('   اليوم        إيراد الدليل   إيراد YS      فرق      قيد الدليل');
    let unposted = 0;
    for (const d of recon.rows) {
        const day = String(d.day).slice(0, 10);
        const g = glMap.get(day) || { revenue: 0, entries: 0 };
        const gap = money(g.revenue - d.gross);
        if (g.entries === 0) { unposted += 1; }
        console.log(`   ${day}  ${fmt(g.revenue).padStart(12)} ${fmt(d.gross).padStart(11)} ${fmt(gap).padStart(10)} ${String(g.entries).padStart(9)}`);
    }
    console.log(`   أيام بلا قيد في الدليل: ${unposted}`);

    // ٥) الخلاصة (قرار لا فعل)
    console.log('\n【٥】 الخلاصة (لقرار المالك — لم يُكتب شيء)');
    const cashDays = recon.rows.length;
    const closedDays = new Set(closes.rows.map((c) => String(c.day).slice(0, 10))).size;
    console.log(`   · أيام البيع في الفترة: ${cashDays}`);
    console.log(`   · أيام أُقفلت فعلًا (Z): ${closedDays}`);
    console.log(`   · نقد متوقَّع لم يُقارَن بصندوق حقيقي: ${cashDays - closedDays} يومًا (النقد المتوقَّع ${fmt(tot.cash)})`);
    console.log(`   · لعرض الفارق: صُرِّف يوم بـ«Z» بعد أن تعدّ الصندوق وتكتب المبلغ الفعلي.`);
    console.log('   · لم يُرحَّل أي قيد ولم يُفتح إقفال في هذا التقرير.');
    await pool.end();
})().catch((e) => { console.error('خطأ:', e.message); process.exit(1); });
