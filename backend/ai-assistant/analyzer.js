/**
 * ai-assistant/analyzer.js — محرك التحليل المقارن: «وين الزيادة؟»
 * ══════════════════════════════════════════════════════════════════════
 * طلب المالك: «عايز مساعد يحلل المبيعات والمصاريف والكوست والمخازن وأذونات
 * الصرف — إيه اللي نقدر نقلله مقارنة بنفس الفترة من الشهر اللي فات أو
 * الأسبوع اللي فات + تنبيهات لأي زيادة».
 *
 * القاعدة الحاكمة: كل رقم هنا **حتمي** من القاعدة (لا نموذج، لا تقدير) —
 * المقارنة على أيام كاملة فقط (اليوم غير مكتمل فيُستبعد من الأساس)، ونفس
 * المدة للطرفين. الذكاء الاصطناعي (المحلي المجاني) خيار «اشرح» بصياغة
 * عربية فوق هذه الأرقام فقط — لا يغيّر رقمًا ولا يضيف حقيقة.
 *
 * الفترتان:
 *   • week  : آخر ٧ أيام كاملة (أمس وما قبله) مقابل الـ٧ السابقة لها
 *   • month : آخر ٣٠ يومًا كاملة مقابل الـ٣٠ السابقة لها
 * يوم اليوم ناقص (لم يكتمل بعد) فلا يدخل المقارنة.
 */
'use strict';

const { pool } = require('../shared-pool');
const { riyadhToday } = require('../riyadh-date');
const localLlm = require('./local-llm');
const { logger } = require('../logger');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;
const money = (v) => round2(v);
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

function addDays(iso, delta) {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

/** الفترتان: الحالية والسابقة — نفس الطول، أيام كاملة. */
function periods(range, custom) {
    const today = riyadhToday();
    const end = addDays(today, -1);   // آخر يوم كامل
    if (range === 'custom' && custom && /^\d{4}-\d{2}-\d{2}$/.test(String(custom.from || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(custom.to || ''))) {
        const from = String(custom.from);
        const to = String(custom.to);
        if (from > to) {
            return {
                current: { from: to, to: from },
                previous: { from: addDays(to, -(Math.round((Date.parse(from + 'T00:00:00Z') - Date.parse(to + 'T00:00:00Z')) / 86400000))), to: addDays(to, -1) },
                days: Math.max(1, Math.round((Date.parse(from + 'T00:00:00Z') - Date.parse(to + 'T00:00:00Z')) / 86400000) + 1),
                label: 'فترة مخصصة',
            };
        }
        const days = Math.max(1, Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1);
        const prevTo = addDays(from, -1);
        const prevFrom = addDays(prevTo, -(days - 1));
        return {
            current: { from, to },
            previous: { from: prevFrom, to: prevTo },
            days,
            label: 'فترة مخصصة',
        };
    }
    if (range === 'week') {
        return {
            current: { from: addDays(end, -6), to: end },
            previous: { from: addDays(end, -13), to: addDays(end, -7) },
            days: 7,
            label: 'آخر 7 أيام كاملة مقابل الـ7 السابقة',
        };
    }
    return {
        current: { from: addDays(end, -29), to: end },
        previous: { from: addDays(end, -59), to: addDays(end, -30) },
        days: 30,
        label: 'آخر 30 يومًا كاملة مقابل الـ30 السابقة',
    };
}

const deltaPct = (cur, prev) => {
    if (prev === 0) { return cur > 0 ? 100 : 0; }
    return ((cur - prev) / Math.abs(prev)) * 100;
};
const deltaOf = (cur, prev) => round2(num(cur) - num(prev));

/* ═══ تغطية موسّعة: كل موديولات النظام ═══ */

function purchasesQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS invoices,
                              round(sum("totalAmount")::numeric, 2) AS value,
                              round(sum("vat_total")::numeric, 2) AS vat
                         FROM "purchaseInvoices"
                        WHERE date BETWEEN $1 AND $2`, [from, to]);
}

function purchasesCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT date) FILTER (WHERE date BETWEEN $1 AND $2)::int AS cur_days,
        count(DISTINCT date) FILTER (WHERE date BETWEEN $3 AND $4)::int AS prev_days
        FROM "purchaseInvoices"
        WHERE date BETWEEN $3 AND $2`, [curFrom, curTo, prevFrom, prevTo]);
}

function purchasesTopSuppliersQuery(from, to) {
    return pool.query(`SELECT COALESCE(NULLIF("supplierName", ''), '—') AS supplier,
                              count(*)::int AS invoices,
                              round(sum("totalAmount")::numeric, 2) AS value
                         FROM "purchaseInvoices"
                        WHERE date BETWEEN $1 AND $2
                        GROUP BY 1 ORDER BY sum("totalAmount") DESC NULLS LAST LIMIT 5`, [from, to]);
}

function attendanceQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS rows,
                              count(*) FILTER (WHERE late)::int AS late,
                              count(*) FILTER (WHERE "checkIn" IS NULL)::int AS missing_in,
                              count(*) FILTER (WHERE "checkOut" IS NULL)::int AS missing_out
                         FROM attendance
                        WHERE date BETWEEN $1 AND $2`, [from, to]);
}

function attendanceCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT date) FILTER (WHERE date BETWEEN $1 AND $2)::int AS cur_days,
        count(DISTINCT date) FILTER (WHERE date BETWEEN $3 AND $4)::int AS prev_days
        FROM attendance
        WHERE date BETWEEN $3 AND $2`, [curFrom, curTo, prevFrom, prevTo]);
}

/** قيمة المخزون الحالية (لقطة — لا تاريخ لها، ليست مقارنة). */
function inventoryValueQuery() {
    return pool.query(`SELECT count(*)::int AS items,
                              round(sum(COALESCE(qty, 0) * COALESCE("avgCost", 0))::numeric, 2) AS value
                         FROM inventory WHERE COALESCE(qty, 0) > 0`);
}

/** لقطة «يحتاج قرارك الآن» — ما ينتظر الإدارة اليوم (ليست مقارنة). */
async function pendingSnapshot() {
    const [dispatches, prs, leaves, openShifts, lastClose, stockOut, belowMin] = await Promise.all([
        pool.query(`SELECT count(*)::int AS n FROM dispatches WHERE status IN ('pending', 'approved')`).catch(() => ({ rows: [{ n: 0 }] })),
        pool.query(`SELECT count(*)::int AS n FROM purchase_requests WHERE status NOT IN ('gm_approved', 'received', 'rejected')`).catch(() => ({ rows: [{ n: 0 }] })),
        pool.query(`SELECT count(*)::int AS n FROM "leaveRequests" WHERE status = 'pending'`).catch(() => ({ rows: [{ n: 0 }] })),
        pool.query(`SELECT count(*)::int AS n FROM pos_shift_sessions WHERE status = 'open'`).catch(() => ({ rows: [{ n: 0 }] })),
        pool.query('SELECT MAX(close_date) AS last_close FROM pos_day_closes').catch(() => ({ rows: [{}] })),
        pool.query('SELECT count(*)::int AS n FROM inventory WHERE COALESCE(qty, 0) < 0').catch(() => ({ rows: [{ n: 0 }] })),
        pool.query('SELECT count(*)::int AS n FROM inventory WHERE COALESCE(qty, 0) < COALESCE("minQty", 0) AND COALESCE("minQty", 0) > 0').catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    const lastCloseDay = lastClose.rows[0] && lastClose.rows[0].last_close;
    const lastCloseIso = lastCloseDay instanceof Date ? lastCloseDay.toISOString().slice(0, 10) : (lastCloseDay ? String(lastCloseDay).slice(0, 10) : null);
    const daysSinceClose = lastCloseIso ? Math.round((Date.now() - Date.parse(lastCloseIso + 'T00:00:00Z')) / 86400000) : null;
    return {
        dispatchesAwaiting: num(dispatches.rows[0] && dispatches.rows[0].n),
        purchaseRequestsAwaiting: num(prs.rows[0] && prs.rows[0].n),
        leavesAwaiting: num(leaves.rows[0] && leaves.rows[0].n),
        openShifts: num(openShifts.rows[0] && openShifts.rows[0].n),
        lastDayClose: lastCloseIso,
        daysSinceClose,
        negativeStockItems: num(stockOut.rows[0] && stockOut.rows[0].n),
        belowMinItems: num(belowMin.rows[0] && belowMin.rows[0].n),
    };
}

/* ─────────── التغطية: الأيام ببيانات فعلًا ─────────── */
function salesCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT (doc_date AT TIME ZONE 'Asia/Riyadh')::date)
            FILTER (WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date)::int AS cur_days,
        count(DISTINCT (doc_date AT TIME ZONE 'Asia/Riyadh')::date)
            FILTER (WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $3::date AND $4::date)::int AS prev_days
        FROM ys_mirror_orders
        WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $3::date AND $2::date`, [curFrom, curTo, prevFrom, prevTo]);
}

function revenuesCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT date) FILTER (WHERE date BETWEEN $1 AND $2)::int AS cur_days,
        count(DISTINCT date) FILTER (WHERE date BETWEEN $3 AND $4)::int AS prev_days
        FROM revenues
        WHERE date BETWEEN $3 AND $2`, [curFrom, curTo, prevFrom, prevTo]);
}

function expensesCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT date) FILTER (WHERE date BETWEEN $1 AND $2)::int AS cur_days,
        count(DISTINCT date) FILTER (WHERE date BETWEEN $3 AND $4)::int AS prev_days
        FROM expenses
        WHERE date BETWEEN $3 AND $2`, [curFrom, curTo, prevFrom, prevTo]);
}

function ledgerCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT business_date::date) FILTER (WHERE business_date::date BETWEEN $1::date AND $2::date)::int AS cur_days,
        count(DISTINCT business_date::date) FILTER (WHERE business_date::date BETWEEN $3::date AND $4::date)::int AS prev_days
        FROM inventory_ledger
        WHERE business_date::date BETWEEN $3::date AND $2::date`, [curFrom, curTo, prevFrom, prevTo]);
}

function dispatchesCoverageQuery(curFrom, curTo, prevFrom, prevTo) {
    return pool.query(`SELECT
        count(DISTINCT date) FILTER (WHERE date BETWEEN $1 AND $2)::int AS cur_days,
        count(DISTINCT date) FILTER (WHERE date BETWEEN $3 AND $4)::int AS prev_days
        FROM dispatches
        WHERE date BETWEEN $3 AND $2`, [curFrom, curTo, prevFrom, prevTo]);
}

/** أساس المقارنة: إجمالي المدة، أو معدل اليوم لو التغطية < 80% في أي طرف. */
function basisFor(daysCur, daysPrev, windowDays) {
    const cur = num(daysCur); const prev = num(daysPrev);
    if (cur <= 0 || prev <= 0) { return { mode: 'insufficient', curDays: cur, prevDays: prev, windowDays }; }
    const coverage = Math.min(cur / windowDays, prev / windowDays);
    return { mode: coverage >= 0.8 ? 'total' : 'per-day', curDays: cur, prevDays: prev, windowDays };
}

/** يحوّل إجمالي (current، previous) إلى مقارنة عادلة على أساس مغطّى. */
function fairDelta(cur, prev, basis) {
    if (!basis || basis.mode === 'total') {
        return { cur: round2(cur), prev: round2(prev), delta: deltaOf(cur, prev), deltaPct: round2(deltaPct(cur, prev)), perDay: false };
    }
    if (basis.mode === 'insufficient') {
        return { cur: round2(cur), prev: round2(prev), delta: 0, deltaPct: 0, perDay: true, insufficient: true };
    }
    const perDayCur = num(cur) / basis.curDays;
    const perDayPrev = num(prev) / basis.prevDays;
    const delta = (perDayCur - perDayPrev) * basis.curDays;
    return {
        cur: round2(cur), prev: round2(prev),
        delta: round2(delta),
        deltaPct: round2(deltaPct(perDayCur, perDayPrev)),
        perDay: true,
    };
}

/* ───────────────────────── استعلامات المصدر ───────────────────────── */

function salesQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS invoices,
                              round(sum(total)::numeric, 2) AS revenue,
                              round(sum(net)::numeric, 2) AS net,
                              round(sum(pay_cash)::numeric, 2) AS cash,
                              round(sum(pay_network)::numeric, 2) AS card
                         FROM ys_mirror_orders
                        WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`, [from, to]);
}

function salesDailyQuery(from, to) {
    return pool.query(`SELECT (doc_date AT TIME ZONE 'Asia/Riyadh')::date AS day,
                              count(*)::int AS invoices,
                              round(sum(total)::numeric, 2) AS revenue
                         FROM ys_mirror_orders
                        WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                        GROUP BY 1 ORDER BY 1`, [from, to]);
}

function revenuesQuery(from, to) {
    return pool.query(`SELECT round(sum(amount)::numeric, 2) AS total,
                              count(*)::int AS entries
                         FROM revenues
                        WHERE date BETWEEN $1 AND $2`, [from, to]);
}

function expensesQuery(from, to) {
    return pool.query(`SELECT COALESCE(NULLIF(category, ''), 'بدون تصنيف') AS category,
                              count(*)::int AS entries,
                              round(sum(amount)::numeric, 2) AS total
                         FROM expenses
                        WHERE date BETWEEN $1 AND $2
                        GROUP BY 1 ORDER BY sum(amount) DESC NULLS LAST`, [from, to]);
}

function expensesByDeptQuery(from, to) {
    return pool.query(`SELECT COALESCE(NULLIF("deptId", ''), 'بدون قسم') AS dept,
                              count(*)::int AS entries,
                              round(sum(amount)::numeric, 2) AS total
                         FROM expenses
                        WHERE date BETWEEN $1 AND $2
                        GROUP BY 1 ORDER BY sum(amount) DESC NULLS LAST LIMIT 8`, [from, to]);
}

function inventoryOutQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS moves,
                              round(sum(abs(total_cost))::numeric, 2) AS value,
                              round(sum(abs(total_cost)) FILTER (WHERE transaction_type = 'transfer_out')::numeric, 2) AS transfer_value,
                              round(sum(abs(quantity_delta)) FILTER (WHERE transaction_type = 'transfer_out')::numeric, 3) AS transfer_qty,
                              round(sum(abs(total_cost)) FILTER (WHERE reference_type IN ('dispatch', 'dispatch_receipt'))::numeric, 2) AS dispatch_value,
                              round(sum(abs(total_cost)) FILTER (WHERE transaction_type = 'count_correction')::numeric, 2) AS correction_value,
                              round(sum(abs(quantity_delta))::numeric, 3) AS out_qty
                         FROM inventory_ledger
                        WHERE business_date::date BETWEEN $1::date AND $2::date
                          AND quantity_delta < 0`, [from, to]);
}

function inventoryInQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS moves,
                              round(sum(total_cost)::numeric, 2) AS value
                         FROM inventory_ledger
                        WHERE business_date::date BETWEEN $1::date AND $2::date
                          AND transaction_type = 'purchase_receipt'`, [from, to]);
}

function dispatchesQuery(from, to) {
    return pool.query(`SELECT count(*)::int AS requests,
                              count(*) FILTER (WHERE status IN ('received', 'partially_received'))::int AS received,
                              count(*) FILTER (WHERE status IN ('pending', 'approved'))::int AS awaiting,
                              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                              round(sum(jsonb_array_length(items))::numeric, 0) AS items_count
                         FROM dispatches
                        WHERE date BETWEEN $1 AND $2`, [from, to]);
}

function dispatchesByDeptQuery(from, to) {
    return pool.query(`SELECT COALESCE(NULLIF("deptName", ''), 'بدون قسم') AS dept,
                              count(*)::int AS requests,
                              round(sum(jsonb_array_length(items))::numeric, 0) AS items
                         FROM dispatches
                        WHERE date BETWEEN $1 AND $2
                        GROUP BY 1 ORDER BY count(*) DESC LIMIT 10`, [from, to]);
}

/* ───────────────────────── تجميع التحليل ───────────────────────── */

function buildCategoryRows(curRows, prevRows, minAmount) {
    const prevMap = new Map(prevRows.map((r) => [r.category, r]));
    const names = new Set([...curRows.map((r) => r.category), ...prevRows.map((r) => r.category)]);
    const rows = [];
    for (const category of names) {
        const cur = round2((curRows.find((r) => r.category === category) || {}).total || 0);
        const prev = round2((prevMap.get(category) || {}).total || 0);
        if (cur < minAmount && prev < minAmount) {continue;}  // ضجيج الفئات الصغيرة
        rows.push({
            category,
            current: money(cur),
            previous: money(prev),
            delta: deltaOf(cur, prev),
            deltaPct: round2(deltaPct(cur, prev)),
        });
    }
    rows.sort((a, b) => b.current - a.current);
    return rows;
}

function buildDeptExpenseRows(curRows, prevRows) {
    const prevMap = new Map(prevRows.map((r) => [r.dept, r]));
    return curRows.map((r) => {
        const prev = (prevMap.get(r.dept) || {}).total || 0;
        return {
            dept: r.dept,
            current: money(r.total),
            previous: money(prev),
            delta: deltaOf(r.total, prev),
            deltaPct: round2(deltaPct(num(r.total), num(prev))),
        };
    });
}

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };

function buildAlerts({ analysis, alertPct, minCategory = 500 }) {
    const alerts = [];
    const push = (alert) => alerts.push(alert);
    const over = (pct) => num(pct) > alertPct;

    const s = analysis.sales;
    const tfair = {
        transferPct: num((analysis.warehouse || {}).transferDeltaPct),
        correctionPct: num((analysis.warehouse || {}).correctionDeltaPct),
        outPct: num((analysis.warehouse || {}).outValueDeltaPct),
    };
    const exp = analysis.expenses;
    const wh = analysis.warehouse;
    const dp = analysis.dispatches;

    // (1) المبيعات — الهبوط إنذار (والصعود خير، لا إنذار)
    if (num(s.prevRevenue) > 0 && deltaPct(s.curRevenue, s.prevRevenue) < -alertPct) {
        const pct = deltaPct(s.curRevenue, s.prevRevenue);
        push({
            id: 'sales-drop',
            severity: pct <= -10 ? 'high' : 'medium',
            area: 'المبيعات',
            direction: 'down',
            title: `انخفاض المبيعات ${Math.abs(pct).toFixed(1)}%`,
            detail: `المبيعات ${money(s.curRevenue)} ر.س مقابل ${money(s.prevRevenue)} ر.س — تراجع بمقدار ${money(Math.abs(deltaOf(s.curRevenue, s.prevRevenue)))} ر.س.`,
            current: s.curRevenue, previous: s.prevRevenue, deltaPct: round2(pct),
            action: 'راجع أسباب التراجع: الحملات؟ المنافس؟ الصيانة؟ واتصل بمشرفي الأقسام المتأثرة من جدول «الإيراد حسب القسم».',
        });
    }
    // (2) المصروفات الكلية
    const expPct = analysis.expenses.deltaPct !== undefined ? analysis.expenses.deltaPct : deltaPct(exp.curTotal, exp.prevTotal);
    if (exp.curTotal > 0 && expPct > alertPct) {
        push({
            id: 'expenses-up',
            severity: expPct > 15 ? 'high' : 'medium',
            area: 'المصاريف',
            direction: 'up',
            title: `ارتفاع المصروفات ${expPct.toFixed(1)}%`,
            detail: `المصروفات ${money(exp.curTotal)} ر.س مقابل ${money(exp.prevTotal)} ر.س — زيادة ${money(deltaOf(exp.curTotal, exp.prevTotal))} ر.س.`,
            current: money(exp.curTotal), previous: money(exp.prevTotal), deltaPct: round2(expPct),
            action: 'راجع أكبر الفئات والزيادة في جدول الفئات أدناه، ووافق أو ارفض البنود الجديدة قبل الترقيم.',
        });
    }
    // (3) مواد خام (الكوست المباشر)
    const materialsRow = analysis.expenseCategories.find((r) => r.category === 'مواد خام');
    if (materialsRow && num(materialsRow.current) > minCategory && materialsRow.deltaPct > alertPct) {
        push({
            id: 'materials-up',
            severity: materialsRow.deltaPct > 15 ? 'high' : 'medium',
            area: 'الكوست',
            direction: 'up',
            title: `ارتفاع مصاريف المواد الخام ${materialsRow.deltaPct.toFixed(1)}%`,
            detail: `مواد خام: ${money(materialsRow.current)} ر.س مقابل ${money(materialsRow.previous)} ر.س — زيادة ${money(materialsRow.delta)} ر.س.`,
            current: materialsRow.current, previous: materialsRow.previous, deltaPct: materialsRow.deltaPct,
            action: 'قارن أسعار آخر توريدة بآخر ٣ توريدات، وراجع كميات صرف المطبخ للمواد الأعلى تكلفة.',
        });
    }
    // (4) الاستهلاك من المخزن (transfer_out — الكوست الفعلي)
    const whPct = analysis.warehouse.transferDeltaPct !== undefined ? analysis.warehouse.transferDeltaPct : deltaPct(wh.curTransferValue, wh.prevTransferValue);
    if (wh.curTransferValue > 0 && whPct > alertPct) {
        push({
            id: 'warehouse-out-up',
            severity: whPct > 20 ? 'high' : 'medium',
            area: 'المخزن',
            direction: 'up',
            title: `زيادة صرف المخزن ${whPct.toFixed(1)}%`,
            detail: `قيمة المصروف من المخزن ${money(wh.curTransferValue)} ر.س مقابل ${money(wh.prevTransferValue)} ر.س (${num(wh.curTransferQty).toLocaleString('en-US')} وحدة مقابل ${num(wh.prevTransferQty).toLocaleString('en-US')} وحدة).`,
            current: money(wh.curTransferValue), previous: money(wh.prevTransferValue), deltaPct: round2(whPct),
            action: 'راجع أذونات الصرف المعلقة/المرفوضة والهالك، وتأكد أن الصرف الفعلي مطابق للطلب.',
        });
    }
    // (5) أذونات الصرف (الطلبات نفسها)
    const dpPct = analysis.dispatches.requestsDeltaPct !== undefined ? analysis.dispatches.requestsDeltaPct : deltaPct(dp.curRequests, dp.prevRequests);
    if (dp.curRequests > 0 && dpPct > alertPct) {
        push({
            id: 'dispatches-up',
            severity: dpPct > 25 ? 'high' : 'medium',
            area: 'أذونات الصرف',
            direction: 'up',
            title: `زيادة أذونات الصرف ${dpPct.toFixed(1)}%`,
            detail: `${dp.curRequests} إذن صرف مقابل ${dp.prevRequests} في الفترة السابقة — بنود ${dp.curItems ?? 0} مقابل ${dp.prevItems ?? 0}.`,
            current: dp.curRequests, previous: dp.prevRequests, deltaPct: round2(dpPct),
            action: 'راجع الأقسام الأعلى طلبًا في الجدول أدناه — قد تكون هناك طلبات مكررة أو صرف زائد عن الحاجة.',
        });
    }
    // (6) الهالك/عجز الجرد (count_correction)
    const corrPct = analysis.warehouse.correctionDeltaPct;
    if (wh.curCorrectionValue > 0 && corrPct > alertPct) {
        push({
            id: 'correction-up',
            severity: 'high',
            area: 'المخزن',
            direction: 'up',
            title: `ارتفاع تصحيحات الجرد ${corrPct.toFixed(1)}%`,
            detail: `قيمة التصحيحات ${money(wh.curCorrectionValue)} ر.س مقابل ${money(wh.prevCorrectionValue)} ر.س — عجز أو هدر يحتاج تحقيقًا.`,
            current: money(wh.curCorrectionValue), previous: money(wh.prevCorrectionValue), deltaPct: round2(corrPct),
            action: 'افحص آخر جرد: الكمية الفعلية مقابل النظام، وحدد الأصناف المتكررة والموظفين/الأقسام المعنية.',
        });
    }
    // (7) نسبة المصروفات من المبيعات
    const saleCurAvg = num(s.curAvgPerDay); const salePrevAvg = num(s.prevAvgPerDay);
    const ratioCur = saleCurAvg > 0 ? num(exp.curAvgPerDay) / saleCurAvg : 0;
    const ratioPrev = salePrevAvg > 0 ? num(exp.prevAvgPerDay) / salePrevAvg : 0;
    if (ratioCur > 0 && ratioPrev > 0 && ratioCur > ratioPrev + Math.abs(alertPct) / 100) {
        const ratioDeltaPts = (ratioCur - ratioPrev) * 100;
        push({
            id: 'ratio-up',
            severity: ratioDeltaPts > 5 ? 'high' : 'medium',
            area: 'الكوست',
            direction: 'up',
            title: `مصاريف المبيعات ارتفعت إلى ${(ratioCur * 100).toFixed(1)}%`,
            detail: `النسبة كانت ${(ratioPrev * 100).toFixed(1)}% — زيادة ${ratioDeltaPts.toFixed(1)} نقطة. المصروفات تنمو أسرع من المبيعات.`,
            current: round2(ratioCur * 100), previous: round2(ratioPrev * 100), deltaPct: round2(ratioPrev > 0 ? ((ratioCur - ratioPrev) / ratioPrev) * 100 : 100),
            action: 'جمّد الطلبات غير العاجلة حتى تراجع الفئات الأعلى زيادة، وطالب كل قسم بمبرر للزيادة.',
        });
    }
    // (7ب) المشتريات: زيادة الإنفاق
    const pu = analysis.purchases;
    const puPct = pu.deltaPct !== undefined ? pu.deltaPct : 0;
    if (pu.curValue > 0 && puPct > alertPct) {
        push({
            id: 'purchases-up',
            severity: puPct > 20 ? 'high' : 'medium',
            area: 'المشتريات',
            direction: 'up',
            title: `ارتفاع المشتريات ${puPct.toFixed(1)}%`,
            detail: `المشتريات ${money(pu.curValue)} ر.س (${pu.curInvoices} فاتورة) مقابل ${money(pu.prevValue)} ر.س.`,
            current: money(pu.curValue), previous: money(pu.prevValue), deltaPct: puPct,
            action: 'راجع أكبر الموردين في الجدول (هل ارتفعت الأسعار أم الكميات؟) وحاول التفاوض أو التقسيم على موردين.',
        });
    }
    // (7ج) الحضور: تدهور معدل التأخير أو الانصراف
    const at = analysis.attendance;
    if (at.curRows > 0 && at.lateRateCur > at.lateRatePrev + Math.abs(alertPct)) {
        const pts = round2(at.lateRateCur - at.lateRatePrev);
        push({
            id: 'attendance-late',
            severity: pts > 5 ? 'high' : 'medium',
            area: 'الحضور',
            direction: 'up',
            title: `التأخير ارتفع إلى ${at.lateRateCur.toFixed(1)}% (+${pts.toFixed(1)} نقطة)`,
            detail: `${at.curLate} سطر من ${at.curRows} فيه تأخير — مقابل ${at.prevLate} من ${at.prevRows} في الفترة السابقة.`,
            current: at.lateRateCur, previous: at.lateRatePrev, deltaPct: round2(at.lateRatePrev > 0 ? ((at.lateRateCur - at.lateRatePrev) / at.lateRatePrev) * 100 : 0),
            action: 'راجع أسماء المتأخرين المتكررين وطبّق سياسة الخصم التدريجي بعد التنبيه.',
        });
    }
    if (at.curRows > 0 && at.missOutCur > at.missOutPrev + Math.abs(alertPct)) {
        const pts = round2(at.missOutCur - at.missOutPrev);
        push({
            id: 'attendance-missing-out',
            severity: 'medium',
            area: 'الحضور',
            direction: 'up',
            title: `انصراف غير مسجل: ${at.curMissingOut} سطر (${at.missOutCur.toFixed(1)}%)`,
            detail: `مقارنة بـ${at.prevMissingOut} سطر في الفترة السابقة — سجلات ناقص تعني حضور غير موثوق للرواتب.`,
            current: at.missOutCur, previous: at.missOutPrev, deltaPct: round2(at.missOutPrev > 0 ? ((at.missOutCur - at.missOutPrev) / at.missOutPrev) * 100 : 100),
            action: 'طابق بصمات الأجهزة مع الجدول وصحّح السجلات قبل إقفال الشهر.',
        });
    }
    // (8) كل فئة مصاريف زادت — مرتبة بالأثر (delta الأعلى أولًا)، بحد 500 ر.س على الأقل
    const rising = analysis.expenseCategories
        .filter((r) => num(r.delta) >= minCategory && r.deltaPct > alertPct && r.category !== 'مواد خام')
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5);
    for (const row of rising) {
        push({
            id: `cat-${row.category}`,
            severity: row.deltaPct > 25 ? 'high' : 'medium',
            area: 'المصاريف',
            direction: 'up',
            title: `ارتفاع «${row.category}» ${row.deltaPct.toFixed(1)}%`,
            detail: `${money(row.current)} ر.س مقابل ${money(row.previous)} ر.س — زيادة ${money(row.delta)} ر.س.`,
            current: row.current, previous: row.previous, deltaPct: row.deltaPct,
            action: `راجع بنود «${row.category}» في سجل الصرف وحدد البند المسؤول عن الزيادة.`,
        });
    }

    alerts.sort((a, b) => (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0));
    return alerts;
}

/* ───────────────────────── الطلب الرئيسي ───────────────────────── */

/**
 * يبني تقرير المقارنة كاملًا.
 * @param {any} [dbPool]
 * @param {{range?: 'week'|'month', alertPct?: number}} [opts]
 */
async function buildAnalytics(dbPool, { range = 'week', alertPct = 0, from, to } = {}) {
    const p = dbPool || pool;
    const safeRange = range === 'month' || range === 'custom' ? range : 'week';
    const safeAlert = Math.min(50, Math.max(0, num(alertPct)));
    const { current, previous, days, label } = periods(safeRange, { from, to });

    const [curSales, prevSales, curDaily, curRev, prevRev,
        curExp, prevExp, curExpDept, prevExpDept,
        curOut, prevOut, curIn, prevIn,
        curDisp, prevDisp, curDispDept, prevDispDept,
        covSales, covRev, covExp, covLedger, covDisp,
        curPurch, prevPurch, covPurch, purchTop,
        curAtt, prevAtt, covAtt,
        invValue] = await Promise.all([
        salesQuery(current.from, current.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        salesQuery(previous.from, previous.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        salesDailyQuery(current.from, current.to).catch(() => ({ rows: [] })),
        revenuesQuery(current.from, current.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        revenuesQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        expensesQuery(current.from, current.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        expensesQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        expensesByDeptQuery(current.from, current.to).catch(() => ({ rows: [] })),
        expensesByDeptQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        inventoryOutQuery(current.from, current.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        inventoryOutQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        inventoryInQuery(current.from, current.to).catch(() => ({ rows: [] })),
        inventoryInQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        dispatchesQuery(current.from, current.to).catch((e) => ({ rows: [], error: String(e.message).slice(0, 120) })),
        dispatchesQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        dispatchesByDeptQuery(current.from, current.to).catch(() => ({ rows: [] })),
        dispatchesByDeptQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        salesCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        revenuesCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        expensesCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        ledgerCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        dispatchesCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        purchasesQuery(current.from, current.to).catch(() => ({ rows: [] })),
        purchasesQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        purchasesCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        purchasesTopSuppliersQuery(current.from, current.to).catch(() => ({ rows: [] })),
        attendanceQuery(current.from, current.to).catch(() => ({ rows: [] })),
        attendanceQuery(previous.from, previous.to).catch(() => ({ rows: [] })),
        attendanceCoverageQuery(current.from, current.to, previous.from, previous.to).catch(() => ({ rows: [{}] })),
        inventoryValueQuery().catch(() => ({ rows: [] })),
    ]);

    const cov = (r) => ({ cur: num(r.rows[0] && r.rows[0].cur_days), prev: num(r.rows[0] && r.rows[0].prev_days) });
    const covPurchD = cov(covPurch);
    const covAttD = cov(covAtt);
    const salesDays = cov(covSales); const revDays = cov(covRev); const expDays = cov(covExp);
    const ledgerDays = cov(covLedger); const dispDays = cov(covDisp);
    const windowDays = days;
    const purchBasis = basisFor(covPurchD.cur, covPurchD.prev, windowDays);
    const attBasis = basisFor(covAttD.cur, covAttD.prev, windowDays);
    const salesBasis = basisFor(salesDays.cur, salesDays.prev, windowDays);
    const revBasis = basisFor(revDays.cur, revDays.prev, windowDays);
    const expBasis = basisFor(expDays.cur, expDays.prev, windowDays);
    const ledgerBasis = basisFor(ledgerDays.cur, ledgerDays.prev, windowDays);
    const dispBasis = basisFor(dispDays.cur, dispDays.prev, windowDays);

    const s = (rows) => ({
        invoices: num(rows[0] && rows[0].invoices),
        revenue: round2(rows[0] && rows[0].revenue),
        net: round2(rows[0] && rows[0].net),
        cash: round2(rows[0] && rows[0].cash),
        card: round2(rows[0] && rows[0].card),
    });
    const cs = s(curSales.rows); const ps = s(prevSales.rows);
    const salesPerDay = (total, b) => (b.mode === 'per-day' && b.curDays > 0 ? round2(total / b.curDays) : (days > 0 ? round2(total / days) : 0));
    const salesPerDayPrev = (total, b) => (b.mode === 'per-day' && b.prevDays > 0 ? round2(total / b.prevDays) : (days > 0 ? round2(total / days) : 0));
    const salesFair = fairDelta(cs.revenue, ps.revenue, salesBasis);
    const invoicesFair = fairDelta(cs.invoices, ps.invoices, salesBasis);
    const ticketsFair = fairDelta(cs.invoices > 0 ? cs.revenue / cs.invoices : 0, ps.invoices > 0 ? ps.revenue / ps.invoices : 0, { mode: 'total' });

    const rev = (rows) => ({ total: round2(rows[0] && rows[0].total), entries: num(rows[0] && rows[0].entries) });
    const cr = rev(curRev.rows); const pr = rev(prevRev.rows);
    const revFair = fairDelta(cr.total, pr.total, revBasis);

    const expSum = (rows) => rows.reduce((acc, r) => ({
        total: round2(acc.total + num(r.total)),
        entries: acc.entries + num(r.entries),
    }), { total: 0, entries: 0 });
    const ce = expSum(curExp.rows || []); const pe = expSum(prevExp.rows || []);
    const expFair = fairDelta(ce.total, pe.total, expBasis);
    const expPerDay = (total, b) => (b.mode === 'per-day' && b.curDays > 0 ? round2(total / b.curDays) : (days > 0 ? round2(total / days) : 0));
    const expPerDayPrev = (total, b) => (b.mode === 'per-day' && b.prevDays > 0 ? round2(total / b.prevDays) : (days > 0 ? round2(total / days) : 0));

    // الفئات: لو التغطية غير متكافئة، نقايس السابق على عدد أيام الحالية
    const expScale = expBasis.mode === 'per-day' && expBasis.prevDays > 0 ? (expBasis.curDays / expBasis.prevDays) : 1;
    const prevExpScaled = (prevExp.rows || []).map((r) => ({ ...r, total: round2(num(r.total) * expScale) }));
    const expenseCategories = buildCategoryRows(curExp.rows || [], prevExpScaled, 500);
    const prevExpDeptScaled = (prevExpDept.rows || []).map((r) => ({ ...r, total: round2(num(r.total) * expScale) }));
    const expenseDepts = buildDeptExpenseRows(curExpDept.rows || [], prevExpDeptScaled);

    const inv = (rows) => ({
        moves: num(rows[0] && rows[0].moves),
        value: round2(rows[0] && rows[0].value),
        transferValue: round2(rows[0] && rows[0].transfer_value),
        transferQty: round2(rows[0] && rows[0].transfer_qty),
        dispatchValue: round2(rows[0] && rows[0].dispatch_value),
        correctionValue: round2(rows[0] && rows[0].correction_value),
        outQty: round2(rows[0] && rows[0].out_qty),
    });
    const co = inv(curOut.rows); const po = inv(prevOut.rows);
    const outFair = fairDelta(co.value, po.value, ledgerBasis);
    const transferFair = fairDelta(co.transferValue, po.transferValue, ledgerBasis);
    const correctionFair = fairDelta(co.correctionValue, po.correctionValue, ledgerBasis);
    const dispatchValueFair = fairDelta(co.dispatchValue, po.dispatchValue, ledgerBasis);

    const inn = (rows) => ({ moves: num(rows[0] && rows[0].moves), value: round2(rows[0] && rows[0].value) });
    const ci = inn(curIn.rows); const pi = inn(prevIn.rows);
    const inFair = fairDelta(ci.value, pi.value, ledgerBasis);

    const purch = (rows) => ({
        invoices: num(rows[0] && rows[0].invoices),
        value: round2(rows[0] && rows[0].value),
        vat: round2(rows[0] && rows[0].vat),
    });
    const cp = purch(curPurch.rows); const pp = purch(prevPurch.rows);
    const purchFair = fairDelta(cp.value, pp.value, purchBasis);

    const att = (rows) => ({
        rows: num(rows[0] && rows[0].rows),
        late: num(rows[0] && rows[0].late),
        missingIn: num(rows[0] && rows[0].missing_in),
        missingOut: num(rows[0] && rows[0].missing_out),
    });
    const ca = att(curAtt.rows); const pa = att(prevAtt.rows);
    const lateRateCur = ca.rows > 0 ? round2((ca.late / ca.rows) * 100) : 0;
    const lateRatePrev = pa.rows > 0 ? round2((pa.late / pa.rows) * 100) : 0;
    const missOutCur = ca.rows > 0 ? round2((ca.missingOut / ca.rows) * 100) : 0;
    const missOutPrev = pa.rows > 0 ? round2((pa.missingOut / pa.rows) * 100) : 0;

    const invOnHand = {
        items: num(invValue.rows[0] && invValue.rows[0].items),
        value: round2(invValue.rows[0] && invValue.rows[0].value),
    };

    const disp = (rows) => ({
        requests: num(rows[0] && rows[0].requests),
        received: num(rows[0] && rows[0].received),
        awaiting: num(rows[0] && rows[0].awaiting),
        rejected: num(rows[0] && rows[0].rejected),
        items: num(rows[0] && rows[0].items_count),
    });
    const cd = disp(curDisp.rows); const pd = disp(prevDisp.rows);
    const dispFair = fairDelta(cd.requests, pd.requests, dispBasis);

    const prevDeptMap = new Map((prevDispDept.rows || []).map((r) => [r.dept, r.requests]));
    const dispatchDepts = (curDispDept.rows || []).map((r) => ({
        dept: r.dept,
        requests: num(r.requests),
        previous: num(prevDeptMap.get(r.dept) || 0),
        items: num(r.items),
        deltaPct: round2(deltaPct(num(r.requests), num(prevDeptMap.get(r.dept) || 0))),
    }));

    const analysis = {
        sales: {
            curRevenue: cs.revenue, prevRevenue: ps.revenue,
            curInvoices: cs.invoices, prevInvoices: ps.invoices,
            curAvgTicket: cs.invoices > 0 ? round2(money(cs.revenue) / cs.invoices) : 0,
            prevAvgTicket: ps.invoices > 0 ? round2(money(ps.revenue) / ps.invoices) : 0,
            curCash: cs.cash, prevCash: ps.cash,
            curCard: cs.card, prevCard: ps.card,
            daily: (curDaily.rows || []).map((r) => ({ day: day(r.day), invoices: num(r.invoices), revenue: money(r.revenue) })),
            curAvgPerDay: salesPerDay(cs.revenue, salesBasis),
            prevAvgPerDay: salesPerDayPrev(ps.revenue, salesBasis),
            basis: salesBasis.mode,
            revenueDeltaPct: salesFair.deltaPct,
            invoicesDeltaPct: invoicesFair.deltaPct,
            avgTicketDeltaPct: ticketsFair.deltaPct,
        },
        accounting: {
            curRevenue: cr.total, prevRevenue: pr.total,
            curEntries: cr.entries, prevEntries: pr.entries,
            deltaPct: revFair.deltaPct,
        },
        expenses: {
            curTotal: ce.total, prevTotal: pe.total,
            curEntries: ce.entries, prevEntries: pe.entries,
            deltaPct: expFair.deltaPct,
            delta: expFair.delta,
            curAvgPerDay: expPerDay(ce.total, expBasis),
            prevAvgPerDay: expPerDayPrev(pe.total, expBasis),
            basis: expBasis.mode,
        },
        expenseCategories,
        expenseDepts,
        warehouse: {
            curOutMoves: co.moves, prevOutMoves: po.moves,
            curOutValue: co.value, prevOutValue: po.value,
            curTransferValue: co.transferValue, prevTransferValue: po.transferValue,
            transferDeltaPct: transferFair.deltaPct,
            correctionDeltaPct: correctionFair.deltaPct,
            dispatchValueDeltaPct: dispatchValueFair.deltaPct,
            curTransferQty: co.transferQty, prevTransferQty: po.transferQty,
            curDispatchValue: co.dispatchValue, prevDispatchValue: po.dispatchValue,
            curCorrectionValue: co.correctionValue, prevCorrectionValue: po.correctionValue,
            curOutQty: co.outQty, prevOutQty: po.outQty,
            outValueDeltaPct: outFair.deltaPct,
            delta: outFair.delta,
            basis: ledgerBasis.mode,
        },
        inventoryOnHand: invOnHand,
        pending: null,
        inbound: {
            curMoves: ci.moves, prevMoves: pi.moves,
            curValue: ci.value, prevValue: pi.value,
            deltaPct: inFair.deltaPct,
        },
        purchases: {
            curInvoices: cp.invoices, prevInvoices: pp.invoices,
            curValue: cp.value, prevValue: pp.value,
            curVat: cp.vat, prevVat: pp.vat,
            deltaPct: purchFair.deltaPct,
            basis: purchBasis.mode,
            topSuppliers: (purchTop.rows || []).map((r) => ({ supplier: r.supplier, invoices: num(r.invoices), value: money(r.value) })),
        },
        attendance: {
            curRows: ca.rows, prevRows: pa.rows,
            curLate: ca.late, prevLate: pa.late,
            curMissingIn: ca.missingIn, prevMissingIn: pa.missingIn,
            curMissingOut: ca.missingOut, prevMissingOut: pa.missingOut,
            lateRateCur, lateRatePrev, missOutCur, missOutPrev,
            basis: attBasis.mode,
        },
        dispatches: {
            curRequests: cd.requests, prevRequests: pd.requests,
            curReceived: cd.received, prevReceived: pd.received,
            curAwaiting: cd.awaiting, prevAwaiting: pd.awaiting,
            curRejected: cd.rejected, prevRejected: pd.rejected,
            curItems: cd.items, prevItems: pd.items,
            requestsDeltaPct: dispFair.deltaPct,
            basis: dispBasis.mode,
            byDept: dispatchDepts,
        },
    };

    // لقطة «يحتاج قرارك الآن» — بعد كل الحسابات حتى لا يؤخر البناء
    analysis.pending = await pendingSnapshot().catch(() => null);

    const alerts = buildAlerts({ analysis, alertPct: safeAlert });

    // فرص التخفيض: أكبر زيادة مطلقة في فئات المصاريف (ما يستحق الحل أولًا)
    const reductionTargets = expenseCategories
        .filter((r) => r.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5)
        .map((r) => ({
            area: r.category,
            increase: r.delta,
            increasePct: r.deltaPct,
            note: `وفر ${money(r.delta)} ر.س لو رجعت للمستوى السابق`,
        }));

    const dataGaps = [];
    if (num(curRev.rows[0] && 1) === 0 && (curRev.error || !curRev.rows.length)) {
        dataGaps.push('تعذّر قياس الإيرادات المحاسبية للفترة الحالية.');
    }
    if (curExp.error) {dataGaps.push(`تعذّر قياس المصروفات للفترة الحالية: ${curExp.error}`);}
    if (curOut.error) {dataGaps.push(`تعذّر قياس صرف المخزن: ${curOut.error}`);}
    if (curDisp.error) {dataGaps.push(`تعذّر قياس أذونات الصرف: ${curDisp.error}`);}

    const coverage = {
        sales: salesBasis, revenues: revBasis, expenses: expBasis, ledger: ledgerBasis, dispatches: dispBasis,
        purchases: purchBasis, attendance: attBasis,
    };
    const fairNotes = [];
    if (salesBasis.mode === 'per-day') {fairNotes.push('المبيعات: تغطية YaraSoft تبدأ 2026-09-25 — قورنت بمعدل اليوم لا بالإجمالي.');}
    if (expBasis.mode === 'per-day') {fairNotes.push('المصروفات تبدأ 2026-10-04 — قورنت بمعدل اليوم (الفترة السابقة أقصر من الحالية).');}
    if (ledgerBasis.mode === 'per-day') {fairNotes.push('حركات المخزن تبدأ 2026-10-03 — المقارنة بمعدل اليوم.');}
    if (dispBasis.mode === 'per-day') {fairNotes.push('أذونات الصرف تبدأ 2026-10-04 — المقارنة بمعدل اليوم.');}
    if (purchBasis.mode === 'per-day') {fairNotes.push('المشتريات تبدأ 2026-10-06 — المقارنة بمعدل اليوم.');}
    if (attBasis.mode === 'per-day') {fairNotes.push('الحضور غير مكتمل التغطية للفترة — المقارنة بمعدل اليوم.');}

    return {
        range: safeRange,
        coverage,
        fairNotes,
        rangeLabel: label,
        days,
        alertPct: safeAlert,
        current,
        previous,
        generatedAt: new Date().toISOString(),
        metrics: {
            sales: {
                current: money(cs.revenue), previous: money(ps.revenue), delta: deltaOf(cs.revenue, ps.revenue),
                deltaPct: analysis.sales.revenueDeltaPct, unit: 'ر.س', lowerIsBetter: false, basis: salesBasis.mode,
                label: 'صافي المبيعات', sub: `${cs.invoices} فاتورة (${analysis.sales.invoicesDeltaPct >= 0 ? '+' : ''}${analysis.sales.invoicesDeltaPct}%)`,
            },
            avgTicket: {
                current: money(analysis.sales.curAvgTicket), previous: money(analysis.sales.prevAvgTicket),
                delta: deltaOf(analysis.sales.curAvgTicket, analysis.sales.prevAvgTicket),
                deltaPct: analysis.sales.avgTicketDeltaPct, unit: 'ر.س', lowerIsBetter: false,
                label: 'متوسط الفاتورة', sub: '',
            },
            expenses: {
                current: money(ce.total), previous: money(pe.total), delta: deltaOf(ce.total, pe.total),
                deltaPct: analysis.expenses.deltaPct, unit: 'ر.س', lowerIsBetter: true, basis: expBasis.mode,
                label: 'المصروفات', sub: `${ce.entries} بند صرف`,
            },
            materials: {
                current: money((expenseCategories.find((r) => r.category === 'مواد خام') || {}).current || 0),
                previous: money((expenseCategories.find((r) => r.category === 'مواد خام') || {}).previous || 0),
                delta: (expenseCategories.find((r) => r.category === 'مواد خام') || {}).delta || 0,
                deltaPct: (expenseCategories.find((r) => r.category === 'مواد خام') || {}).deltaPct || 0,
                unit: 'ر.س', lowerIsBetter: true, label: 'مواد خام (كوست)', sub: '',
            },
            warehouseOut: {
                current: money(co.value), previous: money(po.value), delta: deltaOf(co.value, po.value),
                deltaPct: analysis.warehouse.outValueDeltaPct, unit: 'ر.س', lowerIsBetter: true, basis: ledgerBasis.mode,
                label: 'صرف المخزن (تكلفة)', sub: `${co.moves} حركة`,
            },
            dispatches: {
                current: cd.requests, previous: pd.requests, delta: cd.requests - pd.requests,
                deltaPct: analysis.dispatches.requestsDeltaPct, unit: 'إذن', lowerIsBetter: true, basis: dispBasis.mode,
                label: 'أذونات الصرف', sub: `${cd.received} مستلم · ${cd.awaiting} معلّق`,
            },
            purchases: {
                current: money(cp.value), previous: money(pp.value), delta: deltaOf(cp.value, pp.value),
                deltaPct: analysis.purchases.deltaPct, unit: 'ر.س', lowerIsBetter: true, basis: purchBasis.mode,
                label: 'المشتريات', sub: `${cp.invoices} فاتورة`,
            },
            attendance: {
                current: round2(lateRateCur), previous: round2(lateRatePrev), delta: round2(lateRateCur - lateRatePrev),
                deltaPct: round2(lateRatePrev > 0 ? ((lateRateCur - lateRatePrev) / lateRatePrev) * 100 : 0),
                unit: '%', lowerIsBetter: true, basis: attBasis.mode,
                label: 'معدل التأخير', sub: `${ca.rows} سطر حضور`,
            },
        },
        sales: analysis.sales,
        accounting: analysis.accounting,
        expenses: analysis.expenses,
        expenseCategories,
        expenseDepts,
        warehouse: analysis.warehouse,
        inbound: analysis.inbound,
        dispatches: analysis.dispatches,
        purchases: analysis.purchases,
        attendance: analysis.attendance,
        inventoryOnHand: analysis.inventoryOnHand,
        pending: analysis.pending,
        alerts,
        reductionTargets,
        dataGaps,
    };
}

/** ٥ دقائق كاش قصير (نفس نمط CFO) حتى لا يتعاد طلب اللوحة مع مزامنة YaraSoft. */
let cache = { at: 0, key: null, value: null };
const CACHE_MS = Number(process.env.ANALYZER_CACHE_MS || 60000);

async function cachedAnalytics(opts) {
    const key = JSON.stringify({ range: opts.range, alertPct: opts.alertPct, from: opts.from || null, to: opts.to || null });
    if (cache.key === key && cache.value && Date.now() - cache.at < CACHE_MS) {return cache.value;}
    const value = await buildAnalytics(undefined, opts);
    cache = { at: Date.now(), key, value };
    return value;
}

/* ───────────────────────── الشرح بالنموذج المحلي ───────────────────────── */

/**
 * يبني ملخصًا مضغوطًا للنموذج المحلي (CPU بطيء — سياقٌ صغير).
 * لا يُرسل إلا الأرقام المحسوبة هنا — لا أرقام مخزنة ولا زبائن.
 */
function compactFacts(report) {
    const m = report.metrics;
    const line = (label, cur, prev, pct) => `- ${label}: ${cur} مقابل ${prev} (${pct >= 0 ? '+' : ''}${pct}%)`;
    const alerts = report.alerts.slice(0, 6).map((a) => `  • ${a.title}${a.deltaPct !== undefined ? ` — ${a.deltaPct}%` : ''}`).join('\n');
    return [
        `الفترة الحالية: ${report.current.from} إلى ${report.current.to} (${report.days} يومًا). المقارنة: ${report.previous.from} إلى ${report.previous.to}.`,
        line('صافي المبيعات', m.sales.current + ' ر.س', m.sales.previous + ' ر.س', m.sales.deltaPct),
        line('متوسط الفاتورة', m.avgTicket.current, m.avgTicket.previous, m.avgTicket.deltaPct),
        line('المصروفات', m.expenses.current + ' ر.س', m.expenses.previous + ' ر.س', m.expenses.deltaPct),
        line('مواد خام (كوست)', m.materials.current + ' ر.س', m.materials.previous + ' ر.س', m.materials.deltaPct),
        line('صرف المخزن (تكلفة)', m.warehouseOut.current + ' ر.س', m.warehouseOut.previous + ' ر.س', m.warehouseOut.deltaPct),
        line('أذونات الصرف', String(m.dispatches.current), String(m.dispatches.previous), m.dispatches.deltaPct),
        report.alerts.length ? `التنبيهات:\n${alerts}` : 'لا تنبيهات — كل الأرقام ضمن الحدود.',
        report.reductionTargets.length
            ? `أكبر الزيادات في فئات المصاريف (فرص التخفيض):\n` + report.reductionTargets.map((t) => `  • ${t.area}: +${t.increase} ر.س (${t.increasePct}%)`).join('\n')
            : '',
    ].filter(Boolean).join('\n');
}

/**
 * يطلب من النموذج المحلي صياغة التقرير بالعربية الفصحى البسيطة.
 * إن لم يكن النموذج متاحًا ⇒ يرد بالحقائق المُنسقة (لا فشل صامت).
 */
async function explain(report) {
    const facts = compactFacts(report);
    const prompt = [
        'أنت مدير مالي لسلسلة مطاعم في السعودية.',
        'هذه حقائق مقاسة من نظام الشركة (لا تخمين ولا اختراع):',
        facts,
        '',
        'المطلوب: اكتب بالعربية 4 أجزاء قصيرة —',
        '(1) «الحقيقة»: ما الذي تغيّر فعلًا (٢–٣ أسطر بالأرقام أعلاه فقط).',
        '(2) «ما يستحق التخفيض»: أكبر بندين يمكن تقليلهما الآن وما الإجراء العملي لكلٍّ منهما.',
        '(3) «القراران»: إجراءان محددان هذا الأسبوع (مع الرقم الذي يبررهما).',
        '(4) «حدّ التنبيه»: اقترح نسبة تنبيه مناسبة لوضع الشركة.',
        'لا تذكر رقمًا لم يُذكر أعلاه. لا تتخطَّ ٢٢٠ كلمة.',
    ].join('\n');
    const started = Date.now();
    try {
        const available = await localLlm.available();
        if (!available) {
            return {
                text: 'النموذج المحلي غير متاح الآن — هذه الحقائق المقاسة مباشرة من النظام:\n\n' + facts,
                model: null, ms: Date.now() - started, fallback: true,
            };
        }
        const res = await localLlm.chat({
            system: 'أنت مدير مالي شرس ودقيق: لا تخمّن ولا تجمّل، وكل رقم من البيانات المرفقة فقط.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 380,
            temperature: 0.2,
        });
        return { text: res.text || facts, model: res.model || null, ms: Date.now() - started, fallback: false };
    } catch (e) {
        logger.warn({ err: e }, '[ai-assistant] explain failed — falling back to facts');
        return {
            text: 'تعذّر الوصول للنموذج المحلي — هذه الحقائق المقاسة مباشرة من النظام:\n\n' + facts,
            model: null, ms: Date.now() - started, fallback: true,
        };
    }
}

module.exports = { buildAnalytics, cachedAnalytics, explain, periods, addDays, deltaPct };
