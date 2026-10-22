/**
 * manager-briefing.js — موجز المدير المباشر (كل التفاصيل الحية من السستم)
 * ────────────────────────────────────────────────────────────────────────────
 * مبيعات الكاشيرية اليوم + مصاريف اليوم + نواقص المخزن + أصناف ستنفد (تنبؤ
 * باستهلاك 14 يوم عبر الوصفات) + حضور اليوم + معلقات تحتاج قرارًا.
 * GET /api/manager/briefing?date=YYYY-MM-DD (admin/manager)
 */
'use strict';

const CASHIER_DEPTS = ['ys_cc_1', 'ys_cc_3', 'ys_cc_4', 'ys_cc_5', 'ys_cc_45', 'ys_cc_6', 'ys_cc_9'];

function todayRiyadh() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDaysSafe(iso, n) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

async function collectBriefing(pool, date) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : todayRiyadh();
    const yesterday = addDaysSafe(day, -1);
    const [
        cashiers, cashierTotal, pos, expenses, stock, forecast, att, pending,
        cashiersY, posY, expensesY, payments, week, purchases, topItems, purchasesY,
        cashiersYDetail, weekDaily, syncHealth,
    ] = await Promise.all([
        // كل الإيرادات الحقيقية من جدول revenues لذلك اليوم (بلا ys_b4_ext - بيع خارجي من YaraSoft)
        pool.query(
            `SELECT r."deptId" AS code, COALESCE(d.name, m.display_ar, r."deptId") AS name,
                    COUNT(*)::int AS invoices, COALESCE(SUM(r.amount),0)::float AS total
               FROM revenues r
                LEFT JOIN departments d ON d.code = r."deptId"
                LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar FROM yarasoft_revenue_map WHERE active = true ORDER BY dept_code, id) m ON m.dept_code = r."deptId"
               WHERE r.date = $1 AND r."deptId" != 'ys_b4_ext'
               GROUP BY r."deptId", d.name, m.display_ar ORDER BY total DESC`,
            [day]),
        pool.query(
            `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(amount),0)::float AS total
               FROM revenues WHERE date = $1 AND "deptId" != 'ys_b4_ext'`, [day]),
        pool.query(
            `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(total_amount),0)::float AS total
               FROM pos_orders WHERE status IN ('issued','reported') AND (created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date`, [day]),
        pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::float AS total FROM expenses
              WHERE LEFT(COALESCE(date,''),10) = $1
                AND COALESCE("adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`, [day]),
        pool.query(
            `SELECT id, name, unit, COALESCE(qty,0)::float AS qty, COALESCE("minQty",0)::float AS min_qty
               FROM inventory
              WHERE COALESCE(qty,0) <= COALESCE("minQty",0)
              ORDER BY (COALESCE(qty,0) - COALESCE("minQty",0)) LIMIT 50`),
        pool.query(
            `WITH use14 AS (
               SELECT pi.inventory_id, SUM(oi.quantity * pi.quantity_per_unit * (1 + pi.waste_percent/100)) / 14 AS avg_day
                 FROM pos_order_items oi
                 JOIN pos_orders o ON o.id = oi.order_id AND o.status IN ('issued','reported')
                  AND o.created_at >= NOW() - INTERVAL '14 days'
                 JOIN pos_product_ingredients pi ON pi.product_id = oi.product_id
                GROUP BY pi.inventory_id
             )
             SELECT i.id, i.name, i.unit, COALESCE(i.qty,0)::float AS qty,
                    ROUND(u.avg_day::numeric, 2)::float AS avg_day,
                    ROUND((COALESCE(i.qty,0) / NULLIF(u.avg_day,0))::numeric, 1)::float AS days_cover
               FROM inventory i JOIN use14 u ON u.inventory_id = i.id
              WHERE COALESCE(i.qty,0) > 0 AND u.avg_day > 0
                AND COALESCE(i.qty,0) / NULLIF(u.avg_day,0) < 3
              ORDER BY days_cover LIMIT 20`),
        pool.query(
            `SELECT COUNT(DISTINCT "employeeId")::int AS with_record,
                    COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS checked_in,
                    COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL AND "checkOut" IS NULL)::int AS missing_out,
                    COUNT(*) FILTER (WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL)::int AS missing_in
               FROM attendance WHERE LEFT(COALESCE(date,''),10) = $1`, [day]),
        Promise.all([
            pool.query(`SELECT COUNT(*)::int AS c FROM "leaveRequests" WHERE status = 'pending'`).catch(() => ({ rows: [{ c: 0 }] })),
            pool.query(`SELECT COUNT(*)::int AS c FROM yarasoft_unmapped_sections WHERE resolved = false`).catch(() => ({ rows: [{ c: 0 }] })),
            pool.query(`SELECT COUNT(*)::int AS c FROM yarasoft_review_items WHERE resolved = false`).catch(() => ({ rows: [{ c: 0 }] })),
            pool.query(`SELECT COUNT(*)::int AS c FROM pos_shift_sessions WHERE status = 'open'`).catch(() => ({ rows: [{ c: 0 }] })),
        ]).then(([a, b, c, d]) => ({
            leavesPending: a.rows[0].c, unmappedSections: b.rows[0].c,
            reviewItems: c.rows[0].c, openShifts: d.rows[0].c,
        })),
        // مقارنة أمس + طرق الدفع + أسبوع — كلها حقيقية من قاعدة البيانات
        pool.query(
            `SELECT COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS invoices
               FROM revenues WHERE date = $1 AND "deptId" != 'ys_b4_ext'`, [yesterday]),
        pool.query(
            `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(total_amount),0)::float AS total
               FROM pos_orders WHERE status IN ('issued','reported') AND (created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date`, [yesterday]),
        pool.query(
            `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses
              WHERE LEFT(COALESCE(date,''),10) = $1
                AND COALESCE("adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`, [yesterday]),
        pool.query(
            `SELECT p.method AS method, COALESCE(SUM(p.amount),0)::float AS amount, COUNT(*)::int AS count
               FROM pos_invoice_payments p JOIN pos_orders o ON o.id = p.order_id
              WHERE p.direction = 'in' AND o.status IN ('issued','reported')
                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date
              GROUP BY p.method ORDER BY amount DESC`, [day]),
        pool.query(
            `SELECT COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS invoices
               FROM revenues WHERE date >= $1 AND "deptId" != 'ys_b4_ext'`,
            [addDaysSafe(day, -6)]),
        // مشتريات اليوم الحية (فواتير الشراء الفعلية)
        pool.query(
            `SELECT COUNT(*)::int AS n, COALESCE(SUM("totalAmount"),0)::float AS total
               FROM "purchaseInvoices" WHERE LEFT(COALESCE(date,''),10) = $1`, [day]),
        // الأعلى مبيعًا اليوم (أصناف POS الفعلية)
        pool.query(
            `SELECT COALESCE(p.name_ar, p.name_en, 'صنف ' || oi.product_id) AS name,
                    SUM(oi.quantity)::float AS qty, COALESCE(SUM(oi.line_total),0)::float AS total
               FROM pos_order_items oi
               JOIN pos_orders o ON o.id = oi.order_id AND o.status IN ('issued','reported')
               LEFT JOIN pos_products p ON p.id = oi.product_id
              WHERE (o.created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date
              GROUP BY 1 ORDER BY 3 DESC LIMIT 3`, [day]),
        pool.query(
            `SELECT COUNT(*)::int AS n, COALESCE(SUM("totalAmount"),0)::float AS total
                FROM "purchaseInvoices" WHERE LEFT(COALESCE(date,''),10) = $1`, [yesterday]),
        // تفاصيل أمس لكل قسم (دلتا كل كاشير على حدة)
        pool.query(
            `SELECT r."deptId" AS code, COUNT(*)::int AS invoices, COALESCE(SUM(r.amount),0)::float AS total
               FROM revenues r WHERE r.date = $1 AND r."deptId" != 'ys_b4_ext' GROUP BY r."deptId"`, [yesterday]),
        // منحنى 7 أيام (للـ sparkline)
        pool.query(
            `SELECT r.date AS day, COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS invoices
               FROM revenues r WHERE r.date >= $1 AND r.date <= $2 AND "deptId" != 'ys_b4_ext' GROUP BY 1 ORDER BY 1`,
            [addDaysSafe(day, -6), day]),
        // صحة المزامنة الحية: البصمة + يارا سوفت
        Promise.all([
            pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE enabled AND status = 'online')::int AS online FROM attendance_devices`).catch(() => ({ rows: [{ total: 0, online: 0 }] })),
            pool.query(`SELECT status, COUNT(*)::int AS n FROM invoice_import_log WHERE updated_at >= NOW() - INTERVAL '24 hours' GROUP BY 1`).catch(() => ({ rows: [] })),
            pool.query(`SELECT COUNT(*)::int AS c FROM attendance_logs WHERE "attendanceTime" >= $1::date`, [day]).catch(() => ({ rows: [{ c: 0 }] })),
        ]).then(([d, l, p]) => ({
            zkTotal: d.rows[0].total, zkOnline: d.rows[0].online,
            ysLog: Object.fromEntries(l.rows.map((x) => [x.status, x.n])),
            punchesToday: p.rows[0].c,
        })),
    ]);
    const out = stock.rows.filter((r) => Number(r.qty) <= 0);
    return {
        day, yesterday, generatedAt: new Date().toISOString(),
        cashiers: cashiers.rows,
        cashiersTotal: cashierTotal.rows[0],
        pos: pos.rows[0],
        expenses: expenses.rows[0],
        stockOut: out,
        stockLow: stock.rows.filter((r) => Number(r.qty) > 0),
        forecast: forecast.rows,
        attendance: att.rows[0],
        pending,
        cashiersY: cashiersY.rows[0],
        posY: posY.rows[0],
        expensesY: expensesY.rows[0],
        payments: payments.rows,
        week: week.rows[0],
        purchases: purchases.rows[0],
        topItems: topItems.rows,
        purchasesY: purchasesY.rows[0],
        cashiersYDetail: Object.fromEntries(cashiersYDetail.rows.map((r) => [r.code, r])),
        weekDaily: weekDaily.rows,
        syncHealth: syncHealth,
    };
}

/** منحنى نصي من القيم: ▁▂▃▄▅▆▇█ */
function sparkline(vals) {
    const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const nums = (vals || []).map(Number);
    const mx = Math.max(...nums, 0);
    if (!mx) {return bars[0].repeat(Math.max(nums.length, 1));}
    return nums.map((v) => bars[Math.min(7, Math.round((v / mx) * 7))]).join('');
}

/** نسخة عالمية لأمر واتساب «تقرير» — كل الأرقام حية 100% من PostgreSQL */
function formatWhatsapp(b) {
    const f = (n) => Number(n || 0).toLocaleString('en-US');
    const f1 = (n) => { const v = Math.abs(Number(n || 0)); return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
    const delta = (now, was) => {
        const d = Number(now || 0) - Number(was || 0);
        if (!was) {return Number(now) > 0 ? ' ▲جديد' : '';}
        return ` ${d >= 0 ? '▲' : '▼'}${f1((d / was) * 100)}%`;
    };
    const nowR = new Date(new Date().getTime() + 3 * 3600000);
    const hh = nowR.getUTCHours();
    const greet = hh < 12 ? '☀️ صباح الخير' : hh < 18 ? '🌤️ مساء النور' : '🌙 مساء الخير';
    let weekday = '';
    try { weekday = new Intl.DateTimeFormat('ar', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(new Date()); } catch (_) {}
    const fmtTime = (iso) => {
        try { return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); } catch (_) { return ''; }
    };
    const ct = Number(b.cashiersTotal?.total || 0);
    const ci = Number(b.cashiersTotal?.invoices || 0);
    const yt = Number(b.cashiersY?.total || 0);
    const exp = Number(b.expenses?.total || 0);
    const pur = Number(b.purchases?.total || 0);
    const net = ct + Number(b.pos?.total || 0) - exp;
    const netAfterBuy = net - pur;
    const medals = ['🥇', '🥈', '🥉'];
    const yd = b.cashiersYDetail || {};
    const lines = [
        `${greet} — تقرير الشرفه العالمي 🌍`,
        `📅 ${weekday} ${b.day} • وُلّد ${fmtTime(b.generatedAt)} بتوقيت الرياض`,
        `━━━━━━━━━━━━━━━`,
        `💰 المبيعات: ${f(ct)} ﷼ (${f(ci)} فاتورة)${delta(ct, yt)}`,
    ];
    const ranked = (b.cashiers || []).filter((c) => String(c.code) !== 'ys_cc_2' && String(c.code) !== 'ys_b4_ext').slice().sort((a, z) => Number(z.total) - Number(a.total));
    ranked.slice(0, 6).forEach((c, i) => {
        const y = yd[c.code] || { total: 0, invoices: 0 };
        lines.push(`${medals[i] || '▪'} ${c.name}: ${f(c.total)}${delta(Number(c.total), Number(y.total))} (${f(c.invoices)} ف)`);
    });
    if (!ranked.length) {lines.push(`▪ لا مبيعات مسجلة اليوم`);}
    else {
        const best = ranked[0];
        const share = ct > 0 ? Math.round((Number(best.total) / ct) * 100) : 0;
        lines.push(`🏆 كاشير اليوم: ${best.name} — ${f(best.total)} ﷼ (${share}% من اليوم)`);
    }
    // منحنى 7 أيام
    const wd = b.weekDaily || [];
    if (wd.length > 1) {
        const vals = wd.map((x) => Number(x.total));
        const bestDay = wd.reduce((m, x) => (Number(x.total) > Number(m.total) ? x : m), wd[0]);
        lines.push(`📊 7 أيام: ${sparkline(vals)} — الأعلى ${bestDay.day} (${f(bestDay.total)}) • الإجمالي ${f(b.week?.total)}`);
    } else {
        lines.push(`📈 إجمالي 7 أيام: ${f(b.week?.total)} ﷼ (${f(b.week?.invoices)} فاتورة)`);
    }
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`🏪 POS: ${f(b.pos?.invoices)} فاتورة = ${f(b.pos?.total)}${delta(Number(b.pos?.total), Number(b.posY?.total))}`);
    if ((b.payments || []).length) {
        const names = { cash: 'نقدي', card: 'شبكة', wallet: 'محفظة', mada: 'مدى', visa: 'فيزا' };
        lines.push(`💳 الدفع: ` + b.payments.map((p) => `${names[p.method] || p.method} ${f(p.amount)}`).join(' • '));
    }
    if ((b.topItems || []).length) {
        lines.push(`🔥 الأعلى مبيعًا: ` + b.topItems.map((t) => `${t.name} (${f(t.qty)})`).join(' • '));
    }
    lines.push(`🧾 مصاريف: ${f(exp)}${delta(exp, Number(b.expensesY?.total))} • 🛒 مشتريات: ${f(pur)} (${f(b.purchases?.n)} ف)${delta(pur, Number(b.purchasesY?.total))}`);
    lines.push(`✅ الصافي: ${f(net)} • بعد المشتريات: ${f(netAfterBuy)}`);
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`📦 المخزن: نافذ ${b.stockOut.length} • منخفض ${b.stockLow.length} • سينفد <3 أيام ${b.forecast.length}`);
    for (const s of (b.forecast || []).slice(0, 3)) {lines.push(`⚠ ${s.name} — يكفي ${s.days_cover} يوم`);}
    for (const s of (b.stockOut || []).slice(0, 3)) {lines.push(`⛔ نافذ: ${s.name}`);}
    if (!b.stockOut.length && !b.forecast.length) {lines.push(`✓ المخزون سليم — لا نواقص عاجلة`);}
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`👥 الحضور: حاضر ${b.attendance?.checked_in || 0} • نسي خروج ${b.attendance?.missing_out || 0} • نسي دخول ${b.attendance?.missing_in || 0}`);
    const sh = b.syncHealth || {};
    const ys = sh.ysLog || {};
    const stuck = Number(ys.NEEDS_MAPPING || 0) + Number(ys.FAILED || 0) + Number(ys.PROCESSING || 0);
    lines.push(`🔄 المزامنة: بصمة ${Number(sh.zkOnline || 0)}/${Number(sh.zkTotal || 0)} متصلة (${f(sh.punchesToday)} بصمة اليوم) • قاعدة الكاشير: مرحّل ${f(ys.COMPLETED || 0)}${stuck ? ` • ⚠ عالق ${stuck}` : ' ✓'}`);
    const p = b.pending || {};
    const pendTotal = Number(p.leavesPending || 0) + Number(p.unmappedSections || 0) + Number(p.reviewItems || 0) + Number(p.openShifts || 0);
    lines.push(pendTotal
        ? `📌 معلق (${pendTotal}): إجازات ${p.leavesPending} • أقسام ${p.unmappedSections} • مراجعة ${p.reviewItems} • ورديات ${p.openShifts}`
        : `📌 لا معلقات — كل شيء محسوم ✓`);
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`✓ مباشر من القاعدة لحظة التوليد — Karimerp`);
    return lines.join('\n').slice(0, 3900);
}

module.exports = { collectBriefing, formatWhatsapp, CASHIER_DEPTS };
