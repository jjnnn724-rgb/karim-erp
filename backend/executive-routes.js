/**
 * executive-routes.js — موجز المدير: طلب واحد، كل الأرقام حقيقية
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: لوحة الإدارة تحتاج أرقامًا كثيرة، وكثرة الطلبات تُبطئ الواجهة.
 * فكل ما تعرضه اللوحة يجيء في **طلب واحد** من دفتر القيود (الحقيقة
 * المحاسبية) + قراءات التشغيل (الإقفال والورديات والمخزون) — لا رقم
 * مخترع ولا تقدير.
 *
 * الحارس: الأرقام من PostgreSQL فقط؛ وما لم يتوفّر يُsaid صراحةً.
 * ولا كتابة هنا إطلاقًا (قراءة فقط) — التعديل يمرّ عبر مسارات النظام.
 */
'use strict';

const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { asyncHandler } = require('./errors/error-handler');
const { pool } = require('./shared-pool');
const { riyadhToday } = require('./riyadh-date');

const router = express.Router();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

router.get('/summary', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const day = riyadhToday();
    const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 31);
    const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);

    const [
        series, kpi, cash, aging, topDepts, topItems, close, shifts, stock, pending, journals,
    ] = await Promise.all([
        // سلسلة ١٤ يومًا: إيراد/تكلفة/صافي من القيود المُرحَّلة
        pool.query(`
            SELECT e.date::date AS day,
                   COALESCE(SUM(l.credit) FILTER (WHERE c.type = 'revenue'), 0)::float AS revenue,
                   COALESCE(SUM(l.debit)  FILTER (WHERE c.type IN ('cogs','expense')), 0)::float AS cost,
                   COALESCE(SUM(l.credit) FILTER (WHERE c.type = 'revenue'), 0)::float
                   - COALESCE(SUM(l.debit) FILTER (WHERE c.type IN ('cogs','expense')), 0)::float AS net
              FROM journal_entries e
              JOIN journal_lines l ON l.entry_id = e.id
              JOIN chart_of_accounts c ON c.code = l.account_code
             WHERE e.status = 'posted' AND e.date >= $1::date AND e.date <= $2::date
             GROUP BY e.date::date ORDER BY e.date::date`, [from, day]),
        // أرقام اليوم من الدليل
        pool.query(`
            SELECT
              COALESCE(SUM(l.credit) FILTER (WHERE c.type = 'revenue'), 0)::float AS revenue,
              COALESCE(SUM(l.debit)  FILTER (WHERE c.type = 'cogs'), 0)::float AS cogs,
              COALESCE(SUM(l.debit)  FILTER (WHERE c.type = 'expense'), 0)::float AS expenses,
              COUNT(DISTINCT e.id)::int AS entries
            FROM journal_entries e
            JOIN journal_lines l ON l.entry_id = e.id
            JOIN chart_of_accounts c ON c.code = l.account_code
           WHERE e.status = 'posted' AND e.date = $1::date`, [day]),
        // النقد: أرصدة حسابات النقد في الدليل
        pool.query(`
            SELECT c.code, c.name_ar, COALESCE(SUM(l.debit),0)::float - COALESCE(SUM(l.credit),0)::float AS balance
              FROM chart_of_accounts c
              LEFT JOIN journal_lines l ON l.account_code = c.code
              LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
             WHERE c.type = 'asset' AND c.code LIKE '10%'
             GROUP BY c.code, c.name_ar ORDER BY c.code`, []),
        // الذمم: مدينون/دائنون من الدليل
        pool.query(`
            SELECT c.code, c.name_ar, c.type,
                   COALESCE(SUM(l.debit),0)::float - COALESCE(SUM(l.credit),0)::float AS balance
              FROM chart_of_accounts c
              JOIN journal_lines l ON l.account_code = c.code
              JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
             WHERE c.type IN ('asset','liability') AND (c.code LIKE '13%' OR c.code LIKE '2%')
             GROUP BY c.code, c.name_ar, c.type ORDER BY ABS(COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0)) DESC LIMIT 8`, []),
        // الإيراد حسب القسم (من إيرادات التشغيل)
        pool.query(`
            SELECT COALESCE(d.name, m.display_ar, r."deptId") AS name, COALESCE(SUM(r.amount),0)::float AS total
              FROM revenues r
              LEFT JOIN departments d ON d.code = r."deptId"
              LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar FROM yarasoft_revenue_map WHERE active = true ORDER BY dept_code, id) m ON m.dept_code = r."deptId"
             WHERE r.date = $1 AND r."deptId" != 'ys_b4_ext'
             GROUP BY 1 ORDER BY total DESC LIMIT 8`, [day]),
        // الأعلى مبيعًا (من فواتير نقاط البيع)
        pool.query(`
            SELECT COALESCE(i.name_ar, oi.product_name) AS name, SUM(oi.quantity)::float AS qty, SUM(oi.line_total)::float AS total
              FROM pos_order_items oi
              JOIN pos_orders o ON o.id = oi.order_id AND o.status IN ('issued','reported')
              LEFT JOIN pos_products i ON i.id = oi.product_id
             WHERE (o.created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date
             GROUP BY 1 ORDER BY total DESC LIMIT 8`, [day]),
        // الإقفال
        pool.query('SELECT z_number, close_date, total_expected, total_actual, total_variance FROM pos_day_closes ORDER BY close_date DESC LIMIT 1', []),
        pool.query("SELECT COUNT(*)::int AS n FROM pos_shift_sessions WHERE status = 'open'", []),
        pool.query('SELECT COUNT(*)::int AS n FROM inventory WHERE COALESCE(qty,0) < 0', []),
        pool.query(`SELECT (SELECT COUNT(*)::int FROM yarasoft_review_items WHERE resolved = false) AS reviews,
                           (SELECT COUNT(*)::int FROM "leaveRequests" WHERE status = 'pending') AS leaves`, []),
        pool.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE status = 'posted' AND date = $1::date`, [day]),
    ]);

    const s = series.rows || [];
    const k = kpi.rows[0] || {};
    const revenueToday = round2(k.revenue);
    const cogsToday = round2(k.cogs);
    const expensesToday = round2(k.expenses);
    const netToday = round2(revenueToday - cogsToday - expensesToday);
    const cashTotal = round2((cash.rows || []).reduce((a, r) => a + Number(r.balance || 0), 0));

    // الإنذارات: كلها مقيسة، وكلٌّ منها يحمل أين يُعالَج.
    const alerts = [];
    const lastClose = (close.rows || [])[0] || null;
    const closeDay = lastClose
        ? (lastClose.close_date instanceof Date ? lastClose.close_date.toISOString().slice(0, 10) : String(lastClose.close_date).slice(0, 10))
        : null;
    const sinceClose = closeDay
        ? Math.round((new Date(`${day}T00:00:00Z`) - new Date(`${closeDay}T00:00:00Z`)) / 86400000)
        : null;
    if (!lastClose || sinceClose > 0) {
        alerts.push({
            severity: 'high', key: 'no_close',
            title: lastClose ? `لا إقفال منذ ${sinceClose} يوم` : 'لا إقفال مسجَّل',
            detail: 'نقد الكاش غير محسوب — كل هامش يُبنى قبل الإقفال غير مُثبت.',
            action: { label: 'إقفال اليوم', screen: 'cfo' },
        });
    }
    if (Number((shifts.rows[0] || {}).n || 0) > 0) {
        alerts.push({
            severity: 'high', key: 'open_shift',
            title: `${(shifts.rows[0] || {}).n} وردية مفتوحة`,
            detail: 'نقد لم يُقفل بعد.',
            action: { label: 'الورديات', screen: 'cashier-monitor' },
        });
    }
    if (Number((stock.rows[0] || {}).n || 0) > 0) {
        alerts.push({
            severity: 'medium', key: 'negative_stock',
            title: `${(stock.rows[0] || {}).n} صنف رصيده سالب`,
            detail: 'استهلاك بلا صرف — تكلفة البضاعة المباعة غير موثوقة. (عرض فقط — لا تعديل على الأصناف.)',
            action: { label: 'المخزون', screen: 'inventory-inquiry' },
        });
    }
    const pend = pending.rows[0] || {};
    if (Number(pend.reviews || 0) > 0) {
        alerts.push({
            severity: 'medium', key: 'reviews',
            title: `${pend.reviews} مراجعة معلّقة`,
            detail: 'أرقام الفروع غير مكتملة حتى تُحسم.',
            action: { label: 'المراجعات', screen: 'cfo' },
        });
    }
    if (Number(pend.leaves || 0) > 0) {
        alerts.push({
            severity: 'low', key: 'leaves',
            title: `${pend.leaves} إجازة بانتظار الاعتماد`,
            detail: 'أثرها على الرواتب لم يُعتمد بعد.',
            action: { label: 'الإجازات', screen: 'leaves' },
        });
    }
    const order = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);

    res.json({
        day, from, days,
        kpi: {
            revenue: revenueToday,
            cogs: cogsToday,
            expenses: expensesToday,
            net: netToday,
            margin: revenueToday > 0 ? round2((netToday / revenueToday) * 100) : null,
            cash: cashTotal,
            entries: Number(k.entries || 0),
            openShifts: Number((shifts.rows[0] || {}).n || 0),
            negativeStock: Number((stock.rows[0] || {}).n || 0),
            lastClose: lastClose ? {
                z: lastClose.z_number,
                date: lastClose.close_date instanceof Date ? lastClose.close_date.toISOString().slice(0, 10) : String(lastClose.close_date).slice(0, 10),
                variance: round2(lastClose.total_variance),
                since: sinceClose,
            } : null,
        },
        series: s.map((r) => ({
            day: String(r.day).slice(0, 10),
            revenue: round2(r.revenue), cost: round2(r.cost), net: round2(r.net),
        })),
        cash: (cash.rows || []).map((r) => ({ code: r.code, name: r.name_ar, balance: round2(r.balance) })),
        aging: (aging.rows || []).map((r) => ({ code: r.code, name: r.name_ar, type: r.type, balance: round2(r.balance) })),
        topDepts: (topDepts.rows || []).map((r) => ({ name: r.name, total: round2(r.total) })),
        topItems: (topItems.rows || []).map((r) => ({ name: r.name, qty: round2(r.qty), total: round2(r.total) })),
        alerts,
        postedToday: Number((journals.rows[0] || {}).n || 0),
    });
}));

module.exports = { router };
