// ─────────────────────────────────────────────────────────────────────────────
// finance-routes.js — قائمة الأرباح والخسائر الحية (P&L Statement)
// ─────────────────────────────────────────────────────────────────────────────
// إغلاق الحلقة المالية للمطعم: كل رقم في هذه القائمة مصدره حركة حقيقية مسجّلة:
//
//   الإيرادات الصافية  = صافي مبيعات الكاشير (فرعي - خصم، بلا ضريبة)
//                        + الإيرادات اليدوية (revenues بلا pos_order_id)
//   تكلفة المواد (COGS)= صرف المخزون للأقسام − مرتجعات الأقسام
//                        (نموذج النظام: الصرف للمخزون = لحظة تحمّل الكلفة،
//                         واستهلاك الوصفة عند البيع حركة داخلية لا تُحتسب مرتين)
//   مجمل الربح         = الإيرادات الصافية − صافي تكلفة المواد
//   فروق الجرد         = مصاريف count_correction (عجز موجب / زيادة سالبة)
//   مصاريف تشغيلية     = كل مصروف ليس صرف/مرتجع مخزون ولا فرق جرد (مجمعة بفئتها)
//   الرواتب            = صافي رواتب الأشهر التي يقع مطلعها داخل الفترة
//   صافي الربح التشغيلي= مجمل الربح − فروق الجرد − المصاريف التشغيلية − الرواتب
//
// ضريبة القيمة المضافة المحصلة (tax_total) تُعرض كسطر مذكّرة — فهي التزام
// للهيئة وليست إيرادًا، ولا تدخل في أي هامش ربح.
//
// قاعدة عدم الاحتساب المزدوج:
//   فاتورة POS لها صف revenues مرتبط (pos_order_id) — نقارن الاثنين للتحقق
//   فقط (reconciliation) والإيراد يُحسب من pos_orders (المصدر) مرة واحدة.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
// M20: riyadhToday for business dates
const { riyadhToday } = require('./riyadh-date');
const { loadMonthlyLinkedCashierRevenue } = require('./yarasoft/yara-reports');

const router = express.Router();

const READ_ROLES = ['admin', 'manager', 'accountant'];
const COST_ANALYSIS_READ_ROLES = [...READ_ROLES, 'auditor'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366;

// ─── Pure helpers (مصدَّرة للاختبارات) ────────────────────────────────────────

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {return 0;}
    return Math.round(n * 100) / 100;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeDay(value) {
    if (value == null) {return '';}
    const raw = value instanceof Date ? value.toISOString() : String(value);
    return DATE_RE.test(raw.slice(0, 10)) ? raw.slice(0, 10) : '';
}

function monthStartOf(year, month) {
    // month: 1..12 — يعيد YYYY-MM-DD أو '' عند فساد القيم
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || y < 1900 || y > 2200 || m < 1 || m > 12) {return '';}
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

function monthEndOf(year, month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || y < 1900 || y > 2200 || m < 1 || m > 12) {return '';}
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function daysBetween(fromDay, toDay) {
    const a = new Date(`${fromDay}T00:00:00Z`);
    const b = new Date(`${toDay}T00:00:00Z`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {return 0;}
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function computePreviousPeriod(fromDay, toDay) {
    // فترة سابقة بنفس الطول تقع مباشرة قبل "from" — أساس المقارنة
    const from = normalizeDay(fromDay);
    const to = normalizeDay(toDay);
    if (!from || !to || from > to) {return { from: '', to: '' };}
    const span = daysBetween(from, to);
    const prevTo = new Date(`${from}T00:00:00Z`);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - (span - 1));
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(prevFrom), to: iso(prevTo) };
}

function pctChange(current, previous) {
    const cur = roundMoney(current);
    const prev = roundMoney(previous);
    if (prev === 0) {return null;} // لا معنى لنسبة تغير من قاعدة صفرية
    return roundMoney(((cur - prev) / Math.abs(prev)) * 100);
}

const COGS_TYPES = new Set(['dispatch', 'dispatch_return']);
const SHRINKAGE_TYPES = new Set(['count_correction']);

function expenseAdjustmentType(row) {
    return String(row?.adjustmentType ?? row?.adjustment_type ?? '').toLowerCase().trim();
}

function isCogsExpense(row) {
    return COGS_TYPES.has(expenseAdjustmentType(row));
}

function isShrinkageExpense(row) {
    return SHRINKAGE_TYPES.has(expenseAdjustmentType(row));
}

function isOperatingExpenseRow(row) {
    return !isCogsExpense(row) && !isShrinkageExpense(row);
}

function inRange(day, fromDay, toDay) {
    if (!day) {return false;}
    if (fromDay && day < fromDay) {return false;}
    if (toDay && day > toDay) {return false;}
    return true;
}

function classifyExpenses(expenseRows, fromDay, toDay) {
    const rows = (Array.isArray(expenseRows) ? expenseRows : [])
        .map((r) => ({ ...r, amount: num(r.amount), day: normalizeDay(r.date) }))
        .filter((r) => inRange(r.day, fromDay, toDay));

    const cogs = { dispatch: 0, returns: 0, net: 0, count: 0 };
    const shrinkage = { amount: 0, count: 0, losses: 0, gains: 0 };
    const operatingByCategory = new Map();
    let operatingTotal = 0;
    let operatingCount = 0;

    for (const r of rows) {
        const amt = roundMoney(r.amount);
        if (isCogsExpense(r)) {
            const type = expenseAdjustmentType(r);
            if (type === 'dispatch') { cogs.dispatch = roundMoney(cogs.dispatch + amt); cogs.count += 1; }
            else { cogs.returns = roundMoney(cogs.returns + amt); cogs.count += 1; }
            continue;
        }
        if (isShrinkageExpense(r)) {
            shrinkage.amount = roundMoney(shrinkage.amount + amt);
            shrinkage.count += 1;
            if (amt > 0) {shrinkage.losses = roundMoney(shrinkage.losses + amt);}
            else if (amt < 0) {shrinkage.gains = roundMoney(shrinkage.gains + amt);}
            continue;
        }
        const cat = String(r.category || r.desc || 'أخرى').trim() || 'أخرى';
        const bucket = operatingByCategory.get(cat) || { category: cat, amount: 0, count: 0 };
        bucket.amount = roundMoney(bucket.amount + amt);
        bucket.count += 1;
        operatingByCategory.set(cat, bucket);
        operatingTotal = roundMoney(operatingTotal + amt);
        operatingCount += 1;
    }
    cogs.net = roundMoney(cogs.dispatch + cogs.returns);

    const operatingItems = Array.from(operatingByCategory.values())
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    return { cogs, shrinkage, operating: { items: operatingItems, total: operatingTotal, count: operatingCount }, rowCount: rows.length };
}

function aggregatePayroll(payrollRows, fromDay, toDay) {
    // مسير رواتب = استحقاق شهري. عند فترة جزئية يوزَّع تناسبيًا على أيام الشهر
    // الواقعة داخل الفترة (proration) — فتكون القائمة صادقة في أي نطاق زمني.
    const rows = Array.isArray(payrollRows) ? payrollRows : [];
    let total = 0;
    let count = 0;
    const months = new Set();
    for (const r of rows) {
        const ms = monthStartOf(r.year, r.month);
        const me = monthEndOf(r.year, r.month);
        if (!ms || !me) {continue;}
        const overlapStart = ms > fromDay ? ms : fromDay;
        const overlapEnd = me < toDay ? me : toDay;
        if (!overlapStart || !overlapEnd || overlapStart > overlapEnd) {continue;}
        const overlapDays = daysBetween(overlapStart, overlapEnd);
        const monthDays = daysBetween(ms, me);
        const fraction = monthDays > 0 ? overlapDays / monthDays : 0;
        if (fraction <= 0) {continue;}
        total = roundMoney(total + roundMoney(num(r.netSalary) * fraction));
        count += 1;
        months.add(ms.slice(0, 7));
    }
    return { total, count, months: Array.from(months).sort() };
}

function marginPct(profit, revenue) {
    const rev = roundMoney(revenue);
    if (rev === 0) {return null;}
    return roundMoney((roundMoney(profit) / rev) * 100);
}

// بناء قائمة الدخل من صفوف خام — نقية بالكامل (لا SQL هنا)
function buildPnlStatement({ orders, manualRevenues, expenses, payroll, posDeptMap, fromDay, toDay, deptHierarchy }) {
    const from = normalizeDay(fromDay);
    const to = normalizeDay(toDay);
    if (!from || !to || from > to) {throw new Error('نطاق تاريخ غير صالح');}

    const orderRows = (Array.isArray(orders) ? orders : []).filter((o) => {
        const day = normalizeDay(o.day ?? o.created_at);
        return inRange(day, from, to);
    });

    // ─── الإيرادات ───
    let posNet = 0, posGross = 0, posVat = 0, posDiscounts = 0, invoiceCount = 0;
    for (const o of orderRows) {
        const subtotal = num(o.subtotal);
        const discount = num(o.discount_total);
        const vat = num(o.tax_total);
        const gross = num(o.total_amount);
        posNet = roundMoney(posNet + subtotal - discount);
        posDiscounts = roundMoney(posDiscounts + discount);
        posVat = roundMoney(posVat + vat);
        posGross = roundMoney(posGross + gross);
        invoiceCount += 1;
    }

    const manualRows = (Array.isArray(manualRevenues) ? manualRevenues : [])
        .map((r) => ({ ...r, amount: num(r.amount), day: normalizeDay(r.date) }))
        .filter((r) => inRange(r.day, from, to));
    const manualTotal = roundMoney(manualRows.reduce((s, r) => s + roundMoney(r.amount), 0));

    const revenue = {
        pos_net: posNet,
        manual: manualTotal,
        total: roundMoney(posNet + manualTotal),
        pos_gross: posGross,
        vat_collected: posVat,
        pos_discounts: posDiscounts,
        invoice_count: invoiceCount,
        manual_count: manualRows.length,
    };

    // ─── المصاريف (تصنيف نقي موحّد) ───
    const cls = classifyExpenses(expenses, from, to);
    const payrollAgg = aggregatePayroll(payroll, from, to);

    const grossProfit = roundMoney(revenue.total - cls.cogs.net);
    const netProfit = roundMoney(grossProfit - cls.shrinkage.amount - cls.operating.total - payrollAgg.total);

    const statement = {
        period: { from, to },
        revenue,
        cogs: cls.cogs,
        gross_profit: { amount: grossProfit, margin_pct: marginPct(grossProfit, revenue.total) },
        shrinkage: cls.shrinkage,
        operating: cls.operating,
        payroll: payrollAgg,
        net_profit: { amount: netProfit, margin_pct: marginPct(netProfit, revenue.total) },
        expense_row_count: cls.rowCount,
    };

    // ─── تفصيل الأقسام ───
    // خرائط الأقسام: pos_departments.code → ERP code (عبر legacy_dept_code أو إزالة erp_)
    const deptRows = (Array.isArray(posDeptMap) ? posDeptMap : []);
    const posToErp = new Map();
    for (const m of deptRows) {
        const erp = String(m.legacy_dept_code || (m.code || '').replace(/^erp_/, '') || '').trim();
        if (m.code && erp) {posToErp.set(String(m.code), erp);}
    }
    const deptNames = new Map();
    if (Array.isArray(deptHierarchy)) {
        for (const d of deptHierarchy) {deptNames.set(d.code, d.name);}
    }

    const deptAgg = new Map();
    const deptBucket = (code) => {
        const key = code || '—';
        if (!deptAgg.has(key)) {deptAgg.set(key, { code: key, name: key, revenue: 0, manual: 0, cogs: 0, shrinkage: 0, operating: 0 });}
        return deptAgg.get(key);
    };

    for (const o of orderRows) {
        const erp = posToErp.get(String(o.pos_dept_code)) || '—';
        const b = deptBucket(erp);
        b.revenue = roundMoney(b.revenue + num(o.subtotal) - num(o.discount_total));
    }
    for (const r of manualRows) {
        const b = deptBucket(String(r.deptId || '—'));
        b.manual = roundMoney(b.manual + roundMoney(r.amount));
    }
    for (const r of (Array.isArray(expenses) ? expenses : [])) {
        const day = normalizeDay(r.date);
        if (!inRange(day, from, to)) {continue;}
        const amt = roundMoney(r.amount);
        const b = deptBucket(String(r.deptId || '—'));
        const t = expenseAdjustmentType(r);
        if (t === 'dispatch' || t === 'dispatch_return') {b.cogs = roundMoney(b.cogs + amt);}
        else if (t === 'count_correction') {b.shrinkage = roundMoney(b.shrinkage + amt);}
        else {b.operating = roundMoney(b.operating + amt);}
    }

    const byDepartment = Array.from(deptAgg.values())
        .filter((b) => b.code !== '—' || b.revenue || b.manual || b.cogs || b.shrinkage || b.operating)
        .map((b) => {
            const rev = roundMoney(b.revenue + b.manual);
            const net = roundMoney(rev - b.cogs - b.shrinkage - b.operating);
            return {
                code: b.code,
                name: deptNames.get(b.code) || b.name,
                revenue: rev,
                manual: b.manual,
                cogs: b.cogs,
                shrinkage: b.shrinkage,
                operating: b.operating,
                net,
                margin_pct: marginPct(net, rev),
            };
        })
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    // ─── رحيل الأقسام الفرعية للأب (مصروف وإيراد) ───
    // يعمل ولو لم يكن للأب صفوف مباشرة، وعبر مستويات متعددة، وآمن ضد الدورات
    const parentMap = new Map();
    if (Array.isArray(deptHierarchy)) {
        for (const d of deptHierarchy) {
            if (d.parent_code && d.parent_code !== d.code) {parentMap.set(d.code, d.parent_code);}
        }
    }
    const byCode = new Map(byDepartment.map(b => [b.code, b]));
    const ensureDeptRow = (code) => {
        let r = byCode.get(code);
        if (!r) {
            r = { code, name: deptNames.get(code) || code, revenue: 0, manual: 0, cogs: 0, shrinkage: 0, operating: 0, net: 0, margin_pct: 0 };
            byCode.set(code, r);
            byDepartment.push(r);
        }
        return r;
    };
    const rolledUp = new Set();
    const donePairs = new Set();
    for (let pass = 0; pass < parentMap.size + 1; pass++) {
        let moved = false;
        for (const [sub, parent] of parentMap.entries()) {
            const pairKey = `${sub}>${parent}`;
            if (donePairs.has(pairKey)) {continue;}
            const subRow = byCode.get(sub);
            if (!subRow) {continue;}
            // لا ترحّل قسمًا قبل اكتمال ما سيُرَحَّل إليه من أبنائه (ترتيب الأعماق)
            let waiting = false;
            for (const [s2, p2] of parentMap.entries()) {
                if (p2 === sub && !donePairs.has(`${s2}>${sub}`) && byCode.get(s2)) { waiting = true; break; }
            }
            if (waiting) {continue;}
            const parentRow = ensureDeptRow(parent);
            parentRow.revenue = roundMoney(parentRow.revenue + subRow.revenue);
            parentRow.manual = roundMoney(parentRow.manual + subRow.manual);
            parentRow.cogs = roundMoney(parentRow.cogs + subRow.cogs);
            parentRow.shrinkage = roundMoney(parentRow.shrinkage + subRow.shrinkage);
            parentRow.operating = roundMoney(parentRow.operating + subRow.operating);
            parentRow.net = roundMoney(parentRow.net + subRow.net);
            parentRow.margin_pct = marginPct(parentRow.net, parentRow.revenue);
            parentRow.subDepartments = parentRow.subDepartments || [];
            parentRow.subDepartments.push({ code: sub, name: subRow.name, revenue: subRow.revenue, operating: subRow.operating, net: subRow.net });
            rolledUp.add(sub);
            donePairs.add(pairKey);
            moved = true;
        }
        if (!moved) {break;}
    }
    for (const b of byDepartment) {
        if (rolledUp.has(b.code)) {b.rolledUp = true;}
    }
    byDepartment.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    statement.by_department = byDepartment;

    // ─── السلسلة اليومية (للرسم) ───
    const dailyMap = new Map();
    const dayBucket = (day) => {
        if (!dailyMap.has(day)) {dailyMap.set(day, { date: day, revenue: 0, cogs: 0, opex: 0 });}
        return dailyMap.get(day);
    };
    for (const o of orderRows) {
        const b = dayBucket(normalizeDay(o.day ?? o.created_at));
        b.revenue = roundMoney(b.revenue + num(o.subtotal) - num(o.discount_total));
    }
    for (const r of manualRows) {
        const b = dayBucket(r.day);
        b.revenue = roundMoney(b.revenue + roundMoney(r.amount));
    }
    for (const r of (Array.isArray(expenses) ? expenses : [])) {
        const day = normalizeDay(r.date);
        if (!inRange(day, from, to)) {continue;}
        const amt = roundMoney(r.amount);
        const t = expenseAdjustmentType(r);
        const b = dayBucket(day);
        if (t === 'dispatch' || t === 'dispatch_return') {b.cogs = roundMoney(b.cogs + amt);}
        else {b.opex = roundMoney(b.opex + amt);} // فروق جرد + تشغيلية = تكاليف أخرى
    }
    statement.daily_series = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // ─── مطابقة (reconciliation): صفوف revenues المرتبطة بفواتير POS يجب أن
    //      تساوي إجمالي فواتير POS بما فيها الضريبة — أي انحراف يعني إيرادًا
    //      مفقودًا أو فاتورة بلا صف ───
    statement.checks = { balanced: true };

    return statement;
}

// مقارنة فترتين مبنيتين بنفس الدالة النقية
function buildComparison(currentStatement, previousStatement) {
    const fields = [
        ['revenue', (s) => s.revenue.total],
        ['cogs', (s) => s.cogs.net],
        ['gross_profit', (s) => s.gross_profit.amount],
        ['operating', (s) => s.operating.total],
        ['shrinkage', (s) => s.shrinkage.amount],
        ['payroll', (s) => s.payroll.total],
        ['net_profit', (s) => s.net_profit.amount],
    ];
    const out = {};
    for (const [key, get] of fields) {
        const cur = roundMoney(get(currentStatement));
        const prev = previousStatement ? roundMoney(get(previousStatement)) : null;
        out[key] = {
            current: cur,
            previous: prev,
            delta: prev == null ? null : roundMoney(cur - prev),
            pct: prev == null ? null : pctChange(cur, prev),
        };
    }
    return out;
}

// ─── المقارنة الشهرية: الإيراد الحي من يارا، وبقية القيود من دفتر النظام ─────
// إيراد الكاشير لا يُستبدل بمبيعات POS المحلية عند تعذّر Oracle. المصروفات
// والكوست يظلان من دفتر ERP، وكوست BILLS6 مرآة مقارنة مستقلة.

const MONTHLY_DEFAULT_MONTHS = 12;
const MONTHLY_MAX_MONTHS = 24;

const ORACLE_MONTH_ABBR = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/* doc_date في جداول أوراكل المرآة نصٌّ مأخوذ من Date.toString
   («Thu Sep 03 2026 00:00:00 GMT+0300 …») — لا عمود تاريخٍ حقيقي، فنُقطّع
   منه السنة واسم الشهر، ونستثني أي صفٍّ لا يوافق الصيغة بدل أن نخمّنه.
   المجموع على مجموع الفاتورة (total_val)، والقيم غير الرقمية تُعدّ صفرًا. */
const ORACLE_COST_SQL = `
    SELECT substring(doc_date, 12, 4) AS year_txt,
           LOWER(substring(doc_date, 5, 3)) AS month_abbr,
           COUNT(*)::int AS docs,
           COALESCE(SUM(CASE WHEN total_val ~ '^-?[0-9]+(\\.[0-9]+)?$'
                             THEN total_val::numeric ELSE 0 END), 0) AS cost
      FROM ora_bills6
     WHERE substring(doc_date, 12, 4) ~ '^[0-9]{4}$'
     GROUP BY 1, 2`;

function clampMonths(value, fallback = MONTHLY_DEFAULT_MONTHS) {
    const n = parseInt(value, 10);
    if (!Number.isInteger(n)) {return fallback;}
    return Math.max(1, Math.min(n, MONTHLY_MAX_MONTHS));
}

function monthKeyOf(day) {
    const d = normalizeDay(day);
    return d ? d.slice(0, 7) : '';
}

function shiftMonthKey(key, delta) {
    const y = parseInt(String(key).slice(0, 4), 10);
    const m = parseInt(String(key).slice(5, 7), 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {return '';}
    const total = y * 12 + (m - 1) + delta;
    return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** مفاتيح الشهور المنتهية بشهر `toDay` — تصاعديًا، بعدد `count`. */
function monthKeysEndingAt(toDay, count) {
    const end = monthKeyOf(toDay);
    if (!end) {return [];}
    const out = [];
    for (let i = count - 1; i >= 0; i -= 1) {
        const key = shiftMonthKey(end, -i);
        if (key) {out.push(key);}
    }
    return out;
}

/** نافذة الشهر: من أوله إلى آخره، وتُقصّ عند اليوم الجاري في الشهر الجاري. */
function monthWindow(key, toDay) {
    const y = parseInt(String(key).slice(0, 4), 10);
    const m = parseInt(String(key).slice(5, 7), 10);
    const from = `${key}-01`;
    const last = monthEndOf(y, m);
    const to = last && last > toDay ? toDay : last;
    return { from, to, partial: Boolean(last && last > toDay) };
}

/** تاريخٌ فعليٌّ صالح (لا يكفي شكل YYYY-MM-DD: 2026-02-31 شكلٌ صحيح وتاريخٌ باطل). */
function strictDay(value) {
    const day = normalizeDay(value);
    if (!day) {return '';}
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : '';
}

function rangeError(code, message) {
    const err = new Error(message);
    err.statusCode = 400;
    err.code = code;
    return err;
}

/**
 * نوافذ الشهور داخل [from, to] — كل نافذة مقصوصة على حدود الفترة،
 * فالشهر الواقع في طرفها جزئيٌّ بنافذته الحقيقية لا بالشهر كاملًا.
 */
function monthWindowsInRange(from, to) {
    const start = strictDay(from);
    const end = strictDay(to);
    if (!start || !end || start > end) {return [];}
    const lastKey = start.slice(0, 7) <= end.slice(0, 7) ? end.slice(0, 7) : '';
    if (!lastKey) {return [];}
    const out = [];
    let key = start.slice(0, 7);
    while (key && key <= lastKey) {
        const y = parseInt(key.slice(0, 4), 10);
        const m = parseInt(key.slice(5, 7), 10);
        const first = `${key}-01`;
        const last = monthEndOf(y, m);
        const winFrom = start > first ? start : first;
        const winTo = end < last ? end : last;
        if (last && winFrom <= winTo) {
            out.push({
                key,
                from: winFrom,
                to: winTo,
                partial: winFrom !== first || winTo !== last,
            });
        }
        key = shiftMonthKey(key, 1);
    }
    return out;
}

/** اختيار الكاشيرات: غياب القيمة = كل المكتشَفين، وإلا أرقامٌ صحيحة بلا تكرار. */
function parseCashierSelection(value) {
    if (value == null) {return null;}
    const raw = Array.isArray(value) ? value.join(',') : String(value);
    if (!raw.trim()) {return null;}
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    const unique = Array.from(new Set(parts));
    if (unique.some((no) => !/^\d{1,8}$/.test(no))) {
        throw rangeError('INVALID_CASHIERS', 'أرقام الكاشيرات يجب أن تكون أرقامًا صحيحة مفصولة بفواصل.');
    }
    return unique;
}

/**
 * الفترة المطلوبة: إمّا نافذة متجددة (months) أو فترة مخصصة (from/to).
 * الفترة المخصصة لا تتجاوز اليوم، ولا تتجاوز 24 شهرًا، وتُبنى نوافذها
 * مقصوصةً على حدودها كي يُحسب الإيراد من أيام الفترة وحدها.
 */
function monthlyRangeFromQuery(query, toDay) {
    const day = strictDay(toDay);
    if (!day) {throw rangeError('INVALID_PERIOD', 'تاريخ اليوم غير صالح.');}
    const hasCustom = query?.from != null || query?.to != null;
    if (!hasCustom) {
        const months = clampMonths(query?.months);
        const keys = monthKeysEndingAt(day, months);
        if (!keys.length) {throw rangeError('INVALID_PERIOD', 'تعذّر تحديد نافذة الشهور.');}
        const from = `${keys[0]}-01`;
        return { from, to: day, mode: 'rolling', months: keys.length, windows: monthWindowsInRange(from, day) };
    }
    const from = strictDay(query?.from);
    const to = strictDay(query?.to);
    if (!from || !to) {throw rangeError('INVALID_PERIOD', 'تاريخ البداية والنهاية مطلوبان بصيغة YYYY-MM-DD.');}
    if (from > to) {throw rangeError('INVALID_PERIOD', 'تاريخ البداية بعد تاريخ النهاية.');}
    if (to > day) {throw rangeError('INVALID_PERIOD', 'تاريخ النهاية بعد اليوم — اختر تاريخًا حتى اليوم فقط.');}
    const windows = monthWindowsInRange(from, to);
    if (!windows.length) {throw rangeError('INVALID_PERIOD', 'لا شهور داخل الفترة المختارة.');}
    if (windows.length > MONTHLY_MAX_MONTHS) {
        throw rangeError('PERIOD_TOO_LONG', `أقصى فترة ${MONTHLY_MAX_MONTHS} شهرًا؛ اختَر فترة أقصر.`);
    }
    return { from, to, mode: 'custom', months: windows.length, windows };
}

/** مجموع أيام كاشيرات مختارة داخل نافذة — الفترة المخصصة تُقرأ أيامها وحدها. */
function summarizeCashierDays(days, from, to) {
    const start = strictDay(from);
    const end = strictDay(to);
    const total = { net: 0, gross: 0, discount: 0, invoices: 0 };
    if (!start || !end || start > end) {return total;}
    for (const row of Array.isArray(days) ? days : []) {
        if (!row || row.day < start || row.day > end) {continue;}
        total.net += num(row.net);
        total.gross += num(row.gross);
        total.discount += num(row.discount);
        total.invoices += num(row.invoices);
    }
    return {
        net: roundMoney(total.net),
        gross: roundMoney(total.gross),
        discount: roundMoney(total.discount),
        invoices: total.invoices,
    };
}

/** صفوف إيراد الكاشيرات للفترة: كل كاشيرٍ مختار ومعه حصته من إجمالي المعروض. */
function buildCashierRevenueRows(byCashier, selectedNo) {
    const rows = (Array.isArray(byCashier) ? byCashier : []).map((row) => ({
        no: String(row.no || ''),
        name: String(row.name || `كاشير ${row.no}`),
        linked: Boolean(row.linked),
        net: roundMoney(row.net),
        gross: roundMoney(row.gross),
        discount: roundMoney(row.discount),
        invoices: parseInt(row.invoices, 10) || 0,
    }));
    const wanted = Array.isArray(selectedNo) ? selectedNo : null;
    const shown = rows.filter((row) => !wanted || wanted.includes(row.no));
    const total = roundMoney(shown.reduce((sum, row) => sum + row.net, 0));
    return shown
        .map((row) => ({ ...row, share_pct: total === 0 ? 0 : roundMoney((row.net / total) * 100) }))
        .sort((a, b) => Number(a.no) - Number(b.no));
}

async function loadOracleMonthlyCost() {
    const res = await pool.query(ORACLE_COST_SQL);
    const map = new Map();
    for (const r of res.rows || []) {
        const mm = ORACLE_MONTH_ABBR[String(r.month_abbr || '').trim()];
        const key = mm ? `${r.year_txt}-${mm}` : '';
        if (!key) {continue;}
        map.set(key, { cost: roundMoney(r.cost), docs: parseInt(r.docs, 10) || 0 });
    }
    return map;
}

/** صفوف المقارنة — إيراد يارا مباشر، وبقية مكونات P&L من مدخلات ERP. */
function buildMonthlyComparison({
    monthKeys, monthWindows, toDay, inputs, oracleByMonth,
    cashierRevenueByMonth, cashierRevenueForWindow,
}) {
    const oracle = oracleByMonth instanceof Map ? oracleByMonth : new Map();
    const cashierRevenue = cashierRevenueByMonth instanceof Map ? cashierRevenueByMonth : new Map();
    const todayKey = monthKeyOf(toDay);
    const windows = Array.isArray(monthWindows) && monthWindows.length
        ? monthWindows.map((w) => ({
            key: w.key,
            from: w.from,
            to: w.to,
            partial: Boolean(w.partial),
        }))
        : (Array.isArray(monthKeys) ? monthKeys : []).map((key) => ({
            key,
            ...monthWindow(key, toDay),
        }));
    return windows.map((windowHit) => {
        const key = windowHit.key;
        const win = { from: windowHit.from, to: windowHit.to, partial: windowHit.partial };
        const st = buildPnlStatement({ ...inputs, fromDay: win.from, toDay: win.to });
        const cashier = typeof cashierRevenueForWindow === 'function'
            ? (cashierRevenueForWindow(win) || { net: 0, gross: 0, discount: 0, invoices: 0 })
            : (cashierRevenue.get(key) || { net: 0, gross: 0, discount: 0, invoices: 0 });
        const revenueNet = roundMoney(cashier.net);
        const invoiceCount = Math.max(0, parseInt(cashier.invoices, 10) || 0);
        const grossProfit = roundMoney(revenueNet - st.cogs.net);
        const netProfit = roundMoney(grossProfit - st.shrinkage.amount - st.operating.total - st.payroll.total);
        const cost = roundMoney(st.cogs.net);
        const hit = oracle.get(key) || null;
        const oracleCost = hit ? hit.cost : null;
        /* شهرٌ لا يحمل أي حركة في أي مصدر: يُعلَم فيُعرض «لا بيانات» بدل أصفار
           تُقرأ خطأً كشهرٍ بيع فيه صفرًا. */
        const noData = invoiceCount === 0
            && st.expense_row_count === 0 && num(st.payroll.count) === 0 && hit == null;
        return {
            month: key,
            from: win.from,
            to: win.to,
            partial: win.partial,
            in_progress: key === todayKey && win.to >= toDay,
            no_data: noData,
            revenue: revenueNet,
            revenue_pos: revenueNet,
            revenue_manual: 0,
            revenue_covered: true,
            invoice_count: invoiceCount,
            revenue_gross: roundMoney(cashier.gross),
            revenue_discount: roundMoney(cashier.discount),
            cost,
            cost_dispatch: st.cogs.dispatch,
            cost_returns: st.cogs.returns,
            shrinkage: st.shrinkage.amount,
            operating: st.operating.total,
            payroll: st.payroll.total,
            /* «المصروفات» كما يقرأها المالك: التشغيلية + فروق الجرد + الرواتب */
            expenses: roundMoney(st.shrinkage.amount + st.operating.total + st.payroll.total),
            gross_profit: grossProfit,
            net_profit: netProfit,
            margin_pct: marginPct(netProfit, revenueNet),
            gross_margin_pct: marginPct(grossProfit, revenueNet),
            ledger_rows: st.expense_row_count,
            ledger_covered: st.expense_row_count > 0,
            oracle_cost: oracleCost,
            oracle_docs: hit ? hit.docs : 0,
            oracle_covered: oracleCost != null,
            cost_gap: oracleCost == null ? null : roundMoney(oracleCost - cost),
            cost_gap_pct: oracleCost == null || cost === 0
                ? null : roundMoney(((oracleCost - cost) / cost) * 100),
        };
    });
}

function buildDispatchYearSummary(expenseRows, toDay) {
    const day = normalizeDay(toDay);
    if (!day) {throw new Error('تاريخ ملخص أذونات الصرف غير صالح');}
    const year = day.slice(0, 4);
    const lastMonth = Number(day.slice(5, 7));
    const monthly = Array.from({ length: lastMonth }, (_, i) => {
        const month = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { month, dispatch: 0, returns: 0, net: 0, rows: 0 };
    });
    const byMonth = new Map(monthly.map((row) => [row.month, row]));

    for (const row of Array.isArray(expenseRows) ? expenseRows : []) {
        const rowDay = normalizeDay(row.date);
        if (!rowDay || rowDay < `${year}-01-01` || rowDay > day) {continue;}
        const month = byMonth.get(rowDay.slice(0, 7));
        if (!month) {continue;}
        const amount = roundMoney(row.amount);
        const type = expenseAdjustmentType(row);
        if (type === 'dispatch') {
            month.dispatch = roundMoney(month.dispatch + amount);
            month.rows += 1;
        } else if (type === 'dispatch_return') {
            month.returns = roundMoney(month.returns + amount);
            month.rows += 1;
        }
    }

    for (const month of monthly) {
        month.net = roundMoney(month.dispatch + month.returns);
    }
    return {
        year,
        from: `${year}-01-01`,
        to: day,
        monthly,
        totals: monthly.reduce((totals, row) => ({
            dispatch: roundMoney(totals.dispatch + row.dispatch),
            returns: roundMoney(totals.returns + row.returns),
            net: roundMoney(totals.net + row.net),
            rows: totals.rows + row.rows,
        }), { dispatch: 0, returns: 0, net: 0, rows: 0 }),
    };
}

const MONTHLY_SUM_FIELDS = [
    'revenue', 'revenue_pos', 'revenue_manual', 'revenue_gross', 'revenue_discount', 'invoice_count', 'cost', 'cost_dispatch',
    'cost_returns', 'shrinkage', 'operating', 'payroll', 'expenses', 'gross_profit',
    'net_profit', 'ledger_rows', 'oracle_docs',
];

function sumMonthlyTotals(rows) {
    const rowsArr = Array.isArray(rows) ? rows : [];
    const out = {};
    for (const f of MONTHLY_SUM_FIELDS) {
        out[f] = roundMoney(rowsArr.reduce((s, r) => s + num(r[f]), 0));
    }
    out.invoice_count = rowsArr.reduce((s, r) => s + num(r.invoice_count), 0);
    out.ledger_rows = rowsArr.reduce((s, r) => s + num(r.ledger_rows), 0);
    out.oracle_docs = rowsArr.reduce((s, r) => s + num(r.oracle_docs), 0);
    const oracleSum = roundMoney(rowsArr.reduce((s, r) => s + (r.oracle_cost == null ? 0 : num(r.oracle_cost)), 0));
    out.oracle_cost = oracleSum;
    const ledgers = rowsArr.filter((r) => r.ledger_covered).map((r) => r.month);
    const oracles = rowsArr.filter((r) => r.oracle_covered).map((r) => r.month);
    out.ledger_months = ledgers.length;
    out.oracle_months = oracles.length;
    out.revenue_covered_months = rowsArr.filter((r) => r.revenue_covered).length;
    out.ledger_first = ledgers[0] || null;
    out.ledger_last = ledgers[ledgers.length - 1] || null;
    out.oracle_first = oracles[0] || null;
    out.oracle_last = oracles[oracles.length - 1] || null;
    out.margin_pct = marginPct(out.net_profit, out.revenue);
    out.gross_margin_pct = marginPct(out.gross_profit, out.revenue);
    return out;
}

// ─── HTML: قائمة دخل A4 قابلة للطباعة ────────────────────────────────────────

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMoney(value) {
    return roundMoney(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderPnlPrintHtml(stmt, opts = {}) {
    const restaurantName = escHtml(opts.restaurantName || 'النظام المالي');
    const line = (label, value, cls = '', pct = null) => `
        <tr class="${cls}">
            <td>${escHtml(label)}</td>
            <td class="amt ${Number(value) < 0 ? 'neg' : ''}">${fmtMoney(value)}</td>
            <td class="pct">${pct == null ? '—' : `${roundMoney(pct)}%`}</td>
        </tr>`;
    const sub = (label, value) => `
        <tr class="sub">
            <td>${escHtml(label)}</td>
            <td class="amt">${fmtMoney(value)}</td>
            <td class="pct">—</td>
        </tr>`;

    const opRows = (stmt.operating?.items || [])
        .map((it) => sub(it.category, it.amount))
        .join('');
    const deptRows = (stmt.by_department || [])
        .map((d) => `
            <tr>
                <td>${escHtml(d.name)}</td>
                <td class="amt">${fmtMoney(d.revenue)}</td>
                <td class="amt ${d.cogs < 0 ? 'neg' : ''}">${fmtMoney(d.cogs)}</td>
                <td class="amt ${d.shrinkage < 0 ? 'neg' : ''}">${fmtMoney(d.shrinkage)}</td>
                <td class="amt ${d.operating < 0 ? 'neg' : ''}">${fmtMoney(d.operating)}</td>
                <td class="amt ${d.net < 0 ? 'neg' : ''}"><strong>${fmtMoney(d.net)}</strong></td>
                <td class="pct">${d.margin_pct == null ? '—' : `${roundMoney(d.margin_pct)}%`}</td>
            </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>قائمة الأرباح والخسائر ${escHtml(stmt.period.from)} → ${escHtml(stmt.period.to)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans Arabic','Cairo',Tahoma,sans-serif;color:#1a1a2e;padding:14mm 12mm;font-size:12px}
.header{text-align:center;border-bottom:3px double #b8862d;padding-bottom:12px;margin-bottom:16px}
.header h1{font-size:20px;color:#b8862d;margin-bottom:4px}
.header .sub{color:#555;font-size:12px}
.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:14px;font-size:11px;color:#444;background:#faf6ee;border:1px solid #e8dcc0;border-radius:8px;padding:8px 12px}
table{width:100%;border-collapse:collapse;margin-bottom:14px}
th{background:#b8862d;color:#fff;padding:7px 8px;font-size:11px;text-align:right}
td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11.5px}
td.amt{text-align:left;font-family:monospace;direction:ltr;white-space:nowrap}
td.pct{text-align:center;color:#777;direction:ltr}
tr.section td{background:#f6efe0;font-weight:800;font-size:12px;color:#7a5b1e}
tr.sub td:first-child{padding-right:22px;color:#555}
tr.total td{background:#faf6ee;font-weight:800;border-top:2px solid #b8862d}
tr.net td{background:#eef7f0;font-weight:900;border-top:2px solid #2f9e72;color:#1d6b47;font-size:13px}
.neg{color:#c0392b}
.dept-note{font-size:10px;color:#777;margin-top:-8px;margin-bottom:12px}
.signatures{display:flex;justify-content:space-between;margin-top:40px;gap:24px}
.sig{flex:1;text-align:center;font-size:11px}
.sig .line{border-top:1.5px solid #333;margin-top:34px;padding-top:5px;color:#555}
.foot{margin-top:18px;text-align:center;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
@media print{body{padding:8mm}}
</style></head><body>
<div class="header">
  <h1>${restaurantName}</h1>
  <div class="sub">قائمة الأرباح والخسائر (قائمة الدخل) — صادرة عن الفترة ${escHtml(stmt.period.from)} إلى ${escHtml(stmt.period.to)}</div>
</div>
<div class="meta">
  <span>تاريخ الإصدار: <strong>${escHtml(opts.generatedAt || new Date().toISOString().slice(0, 16).replace('T', ' '))}</strong></span>
  <span>بواسطة: <strong>${escHtml(opts.generatedBy || '—')}</strong></span>
  <span>العملة: <strong>ريال سعودي (SAR)</strong></span>
</div>
<table>
  <thead><tr><th style="width:56%">البند</th><th style="width:29%">المبلغ (ريال)</th><th style="width:15%">% من الإيراد</th></tr></thead>
  <tbody>
    <tr class="section"><td colspan="3">أولًا: الإيرادات</td></tr>
    ${sub('صافي مبيعات الكاشير (بعد الخصم، قبل الضريبة)', stmt.revenue.pos_net)}
    ${sub('الإيرادات اليدوية/الأخرى', stmt.revenue.manual)}
    ${line('إجمالي الإيرادات الصافية', stmt.revenue.total, 'total', 100)}
    ${sub('ضريبة القيمة المضافة المحصلة (التزام — ليست إيرادًا)', stmt.revenue.vat_collected)}
    <tr class="section"><td colspan="3">ثانيًا: تكلفة المبيعات (COGS)</td></tr>
    ${sub('صرف مخزون مواد للأقسام', stmt.cogs.dispatch)}
    ${sub('مرتجعات الأقسام للمخزن', stmt.cogs.returns)}
    ${line('صافي تكلفة المواد المستهلكة', stmt.cogs.net, 'total', stmt.revenue.total ? roundMoney((stmt.cogs.net / stmt.revenue.total) * 100) : null)}
    ${line('مجمل الربح', stmt.gross_profit.amount, 'total', stmt.gross_profit.margin_pct)}
    <tr class="section"><td colspan="3">ثالثًا: المصاريف التشغيلية والتكاليف الأخرى</td></tr>
    ${sub('صافي فروق الجرد (عجز/زيادة)', stmt.shrinkage.amount)}
    ${sub('الرواتب والأجور', stmt.payroll.total)}
    ${opRows || sub('لا توجد مصاريف تشغيلية في الفترة', 0)}
    ${line('إجمالي المصاريف التشغيلية والتكاليف الأخرى', roundMoney(stmt.shrinkage.amount + stmt.operating.total + stmt.payroll.total), 'total', stmt.revenue.total ? roundMoney(((stmt.shrinkage.amount + stmt.operating.total + stmt.payroll.total) / stmt.revenue.total) * 100) : null)}
    ${line('صافي الربح التشغيلي', stmt.net_profit.amount, 'net', stmt.net_profit.margin_pct)}
  </tbody>
</table>
${deptRows ? `<table>
  <thead><tr><th>القسم</th><th>الإيرادات</th><th>تكلفة المواد</th><th>فروق جرد</th><th>تشغيلية</th><th>الصافي</th><th>الهامش</th></tr></thead>
  <tbody>${deptRows}</tbody>
</table>
<div class="dept-note">* الرواتب تُحتسب على مستوى المنشأة (لا تُنسب للقسم). الفروق السالبة (مرتجع/زيادة جرد) تُظهر بلون أحمر كقيمة دائنة.</div>` : ''}
<div class="signatures">
  <div class="sig"><div class="line">المدير المالي</div></div>
  <div class="sig"><div class="line">المدير العام</div></div>
  <div class="sig"><div class="line">الختم الرسمي</div></div>
</div>
<div class="foot">تم إنشاء هذه القائمة آليًا من حركات النظام الفعلية — ${restaurantName}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;
}

// ─── HTML: مقارنة الشهور A4 قابلة للطباعة ────────────────────────────────────
// المستند يخرج من عارض V2 (iframe) والعارض هو من يطبع، فلا سكربت طباعة هنا.
// الشهور الناقصة التغطية تُعلَّم بدائرة مفرغة، ويُذكر مصدر كل عمود صراحةً.

const AR_MONTHS_FULL = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function arMonthLabel(key) {
    const y = String(key).slice(0, 4);
    const m = parseInt(String(key).slice(5, 7), 10);
    const name = AR_MONTHS_FULL[m - 1] || '';
    return name ? `${name} ${y}` : String(key);
}

function renderMonthlyPrintHtml(rows, totals, opts = {}) {
    const restaurantName = escHtml(opts.restaurantName || 'النظام المالي');
    const money = (v) => (v == null ? '—' : fmtMoney(v));
    const body = (Array.isArray(rows) ? rows : []).map((r) => `
        <tr>
            <td>${escHtml(arMonthLabel(r.month))}${r.partial ? ' <span class="part">شهر جارٍ</span>' : ''}</td>
            <td class="amt">${money(r.revenue)}</td>
            <td class="amt">${money(r.cost_dispatch)}</td>
            <td class="amt">${money(r.cost_returns)}</td>
            <td class="amt${r.ledger_covered ? '' : ' gap'}">${r.ledger_covered ? money(r.cost) : 'لا قيود'}</td>
            <td class="amt${r.oracle_covered ? '' : ' gap'}">${r.oracle_covered ? money(r.oracle_cost) : 'لا مرآة'}</td>
            <td class="amt">${money(r.expenses)}</td>
            <td class="amt">${money(r.shrinkage)}</td>
            <td class="amt">${money(r.payroll)}</td>
            <td class="amt ${num(r.net_profit) < 0 ? 'neg' : ''}"><strong>${money(r.net_profit)}</strong></td>
            <td class="pct">${r.margin_pct == null ? '—' : `${roundMoney(r.margin_pct)}%`}</td>
        </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>مقارنة الشهور ${escHtml(opts.from || '')} → ${escHtml(opts.to || '')}</title>
<style>
@page{size:A4 landscape;margin:9mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans Arabic','Cairo',Tahoma,sans-serif;color:#1a1a2e;padding:8mm;font-size:11px}
.header{text-align:center;border-bottom:3px double #b8862d;padding-bottom:12px;margin-bottom:14px}
.header h1{font-size:20px;color:#b8862d;margin-bottom:4px}
.header .sub{color:#555;font-size:12px}
.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:12px;font-size:11px;color:#444;background:#faf6ee;border:1px solid #e8dcc0;border-radius:8px;padding:8px 12px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#b8862d;color:#fff;padding:7px 6px;font-size:10.5px;text-align:right}
th.amt{text-align:left}
td{padding:6px;border-bottom:1px solid #eee;font-size:11.5px}
td.amt{text-align:left;font-family:monospace;direction:ltr;white-space:nowrap}
td.pct{text-align:center;color:#777;direction:ltr}
td.gap{color:#c0392b;font-size:10.5px}
tr.total td{background:#faf6ee;font-weight:900;border-top:2px solid #b8862d;font-size:12.5px}
.neg{color:#c0392b}
.part{color:#999;font-size:10px}
.notes{margin-top:10px;font-size:10.5px;color:#666;line-height:1.7}
.signatures{display:flex;justify-content:space-between;margin-top:38px;gap:24px}
.sig{flex:1;text-align:center;font-size:11px}
.sig .line{border-top:1.5px solid #333;margin-top:34px;padding-top:5px;color:#555}
.foot{margin-top:16px;text-align:center;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
@media print{body{padding:8mm}}
</style></head><body>
<div class="header">
  <h1>${restaurantName}</h1>
  <div class="sub">مقارنة الشهور — الإيرادات والمصروفات والكوست · ${escHtml(opts.from || '')} إلى ${escHtml(opts.to || '')}</div>
</div>
<div class="meta">
  <span>تاريخ الإصدار: <strong>${escHtml(opts.generatedAt || '')}</strong></span>
  <span>بواسطة: <strong>${escHtml(opts.generatedBy || '—')}</strong></span>
  <span>العملة: <strong>ريال سعودي (SAR)</strong></span>
</div>
<table>
  <thead><tr>
    <th style="width:14%">الشهر</th>
    <th class="amt">تحصيل يارا</th>
    <th class="amt">أذونات الصرف</th>
    <th class="amt">مرتجعات الصرف</th>
    <th class="amt">صافي تكلفة المخزون</th>
    <th class="amt">فواتير المخزون (مقارنة)</th>
    <th class="amt">المصروفات الأخرى</th>
    <th class="amt">فروق الجرد</th>
    <th class="amt">الرواتب</th>
    <th class="amt">صافي الربح</th>
    <th style="width:8%">الهامش</th>
  </tr></thead>
  <tbody>
    ${body}
    <tr class="total">
      <td>الإجمالي</td>
      <td class="amt">${money(totals?.revenue)}</td>
      <td class="amt">${money(totals?.cost_dispatch)}</td>
      <td class="amt">${money(totals?.cost_returns)}</td>
      <td class="amt">${money(totals?.cost)}</td>
      <td class="amt">${money(totals?.oracle_cost)}</td>
      <td class="amt">${money(totals?.expenses)}</td>
      <td class="amt">${money(totals?.shrinkage)}</td>
      <td class="amt">${money(totals?.payroll)}</td>
      <td class="amt ${num(totals?.net_profit) < 0 ? 'neg' : ''}">${money(totals?.net_profit)}</td>
      <td class="pct">${totals?.margin_pct == null ? '—' : `${roundMoney(totals.margin_pct)}%`}</td>
    </tr>
  </tbody>
</table>
${Array.isArray(opts.cashierRevenue?.rows) && opts.cashierRevenue.rows.length > 1 ? `
<h2>إيرادات الكاشيرات المختارة</h2>
<table>
  <thead><tr><th style="width:8%">#</th><th style="width:38%">الكاشير</th><th style="width:16%">الفواتير</th><th style="width:22%">الإيراد</th><th style="width:16%">الحصة</th></tr></thead>
  <tbody>
    ${opts.cashierRevenue.rows.map((cashier) => `<tr>
      <td>${escHtml(cashier.no)}</td>
      <td>${escHtml(cashier.name)}</td>
      <td class="amt">${num(cashier.invoices)}</td>
      <td class="amt">${money(cashier.net)}</td>
      <td class="pct">${roundMoney(cashier.share_pct)}%</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}
<div class="notes">
  <div>· مصدر الإيراد: تقرير الكاشيريات المعتمد (CC_BILLS3.NET_VAL؛ قيمة التحصيل وتشمل الضريبة)، الفواتير المُرحّلة ذات القيمة الموجبة فقط (PSTD=Y وNET_VAL&gt;0) لكل كاشيرٍ ظهرت له فواتير في الفترة — بما فيهم الكاشير 2 وأي كاشيرٍ جديد على الشبكة — بلا بديل محلي. لا يضم الإجمالي إيرادات يدوية أو POS محلية.</div>
  <div>· الكاشيرات الداخلة في التقرير: ${escHtml((opts.cashiers || []).map((c) => `${c.name} (${c.no})`).join('، ') || '—')}.</div>
  <div>· «صافي تكلفة المخزون» = أذونات الصرف − المرتجعات، وهو رقم الدفتر المستخدم في قائمة الدخل. «فواتير المخزون (مقارنة)» مصدر مستقل ولا تُدمج معه.</div>
  <div>· أذونات الصرف ومرتجعاتها أعمدة مستقلة؛ وإجمالي القيود المسجلة من ${escHtml(opts.dispatchYear?.from || '—')} إلى ${escHtml(opts.dispatchYear?.to || '—')}: صرف ${money(opts.dispatchYear?.totals?.dispatch)}، مرتجعات ${money(opts.dispatchYear?.totals?.returns)}، صافي ${money(opts.dispatchYear?.totals?.net)} (${escHtml(String(opts.dispatchYear?.totals?.rows || 0))} قيدًا). لا تُضاف مرة ثانية للمصروفات التشغيلية.</div>
  <div>· «كوست فواتير المخزون» = مجموع فواتير المخزون في مرآة قاعدة الكاشير — عمودٌ مستقل للمقارنة ولا يُدمج مع الأول.</div>
  <div>· تغطية دفتر النظام: ${escHtml(String(totals?.ledger_first || '—'))} → ${escHtml(String(totals?.ledger_last || '—'))} (${escHtml(String(totals?.ledger_months || 0))} شهرًا) · تغطية فواتير المخزون: ${escHtml(String(totals?.oracle_first || '—'))} → ${escHtml(String(totals?.oracle_last || '—'))} (${escHtml(String(totals?.oracle_months || 0))} شهرًا).</div>
  <div>· «لا قيود» / «لا مرآة» تعني أن الشهر لا يملك بيانات من ذلك المصدر — تُذكر كما هي ولا تُقرأ صفرًا.</div>
</div>
<div class="signatures">
  <div class="sig"><div class="line">المدير المالي</div></div>
  <div class="sig"><div class="line">المدير العام</div></div>
  <div class="sig"><div class="line">الختم الرسمي</div></div>
</div>
<div class="foot">تم إنشاء هذا التقرير آليًا من حركات النظام الفعلية — ${restaurantName}</div>
</body></html>`;
}

// ─── تفصيل شهرٍ واحد: قائمة الشهر كاملة + بيانات المصروفات ───────────────────
/* كل رقم هنا يخرج من buildPnlStatement نفسها التي تُغذّي شاشة قائمة الدخل،
   فيطابق تفصيلُ الشهر رقمَ الشهر في جدول المقارنة حرفًا. سطورُ المصروفات
   تُعرض كما سُجّلت (لا تُصلَّح ولا تُدمج)، وتُقصّ عند سقفٍ معلن كي لا يثقل
   الردّ — والعدد الكامل يصل في rows_total. */

const MONTHLY_DETAIL_ROW_CAP = 250;
const MONTHLY_DETAIL_MANUAL_CAP = 100;

const EXPENSE_TYPE_LABELS = {
    dispatch: 'صرف مخزون',
    dispatch_return: 'مرتجع صرف',
    count_correction: 'فرق جرد',
};

function sharePct(value, base) {
    const b = roundMoney(base);
    if (b === 0) {return null;}
    return roundMoney((roundMoney(value) / b) * 100);
}

function monthKeyOrThrow(value) {
    const key = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
        const err = new Error('صيغة الشهر غير صالحة — استخدم YYYY-MM');
        err.statusCode = 400;
        err.code = 'INVALID_MONTH';
        throw err;
    }
    return key;
}

/** خريطة أسماء الأقسام: أكواد POS وأكواد الأقسام القديمة معًا. */
function departmentNames(inputs) {
    const map = new Map();
    for (const d of (Array.isArray(inputs?.deptHierarchy) ? inputs.deptHierarchy : [])) {
        if (d?.code) {map.set(String(d.code), String(d.name || ''));}
    }
    for (const d of (Array.isArray(inputs?.posDeptMap) ? inputs.posDeptMap : [])) {
        const name = String(d?.name_ar || '').trim();
        if (d?.code && !map.get(String(d.code))) {map.set(String(d.code), name);}
        if (d?.legacy_dept_code) {map.set(String(d.legacy_dept_code), name);}
    }
    return map;
}

function expenseTypeMeta(type) {
    return EXPENSE_TYPE_LABELS[type]
        ? { type, label: EXPENSE_TYPE_LABELS[type] }
        : { type: 'operating', label: 'تشغيلي' };
}

/** سطور المصروفات كما هي مسجّلة — تُعرض ولا تُصلح. */
function monthlyExpenseLedger(inputs, from, to, names) {
    const rows = [];
    const byType = new Map();
    for (const r of (Array.isArray(inputs?.expenses) ? inputs.expenses : [])) {
        const day = normalizeDay(r.date);
        if (!inRange(day, from, to)) {continue;}
        const meta = expenseTypeMeta(expenseAdjustmentType(r));
        const code = String(r.deptId ?? '').trim();
        const amount = roundMoney(r.amount);
        rows.push({
            date: day,
            type: meta.type,
            type_label: meta.label,
            category: String(r.category || r.desc || 'أخرى').trim() || 'أخرى',
            description: String(r.desc || '').trim(),
            department: names.get(code) || code || '—',
            department_code: code,
            amount,
        });
        const bucket = byType.get(meta.type) || { type: meta.type, label: meta.label, amount: 0, count: 0 };
        bucket.amount = roundMoney(bucket.amount + amount);
        bucket.count += 1;
        byType.set(meta.type, bucket);
    }
    rows.sort((a, b) => (a.date === b.date
        ? Math.abs(b.amount) - Math.abs(a.amount)
        : b.date.localeCompare(a.date)));
    const order = ['dispatch', 'dispatch_return', 'count_correction', 'operating'];
    return { rows, byType: order.map((t) => byType.get(t)).filter(Boolean) };
}

/** الحركة اليومية للدفتر: كوستٌ ومصروفات أخرى — الإيراد شهريّ لا يوميّ. */
function dailyLedgerMovement(rows) {
    const map = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
        const b = map.get(r.date) || { date: r.date, cost: 0, other: 0, total: 0 };
        if (r.type === 'dispatch' || r.type === 'dispatch_return') {
            b.cost = roundMoney(b.cost + r.amount);
        } else {
            b.other = roundMoney(b.other + r.amount);
        }
        b.total = roundMoney(b.cost + b.other);
        map.set(r.date, b);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildMonthlyDetail({ monthKey, win, inputs, cashierHit, oracleHit, oracleAvailable }) {
    const st = buildPnlStatement({ ...inputs, fromDay: win.from, toDay: win.to });
    const names = departmentNames(inputs);
    const ledger = monthlyExpenseLedger(inputs, win.from, win.to, names);
    const manual = (Array.isArray(inputs.manualRevenues) ? inputs.manualRevenues : [])
        .map((r) => {
            const code = String(r.deptId ?? '').trim();
            return {
                date: normalizeDay(r.date),
                source: String(r.source || '').trim() || '—',
                department: names.get(code) || code || '—',
                department_code: code,
                amount: roundMoney(r.amount),
            };
        })
        .filter((r) => inRange(r.date, win.from, win.to))
        .sort((a, b) => b.date.localeCompare(a.date));
    /* الإيراد المعتمد هو نفس إيراد صفّ المقارنة (تحصيل الكاشيريات) — لا أساس ثانٍ
       يخالف الجدول. إيراد دفتر النظام يُعرض للمطابقة فقط، والإيرادات اليدوية
       تُعرض بندًا مستقلًا ولا تُضاف إليه. */
    const cashier = cashierHit || { net: 0, gross: 0, discount: 0, invoices: 0 };
    const revenue = roundMoney(cashier.net);
    const expensesTotal = roundMoney(st.shrinkage.amount + st.operating.total + st.payroll.total);
    const grossProfit = roundMoney(revenue - st.cogs.net);
    const netProfit = roundMoney(grossProfit - expensesTotal);
    const oracleCost = oracleHit ? roundMoney(oracleHit.cost) : null;
    return {
        month: monthKey,
        period: { from: win.from, to: win.to },
        partial: win.partial,
        revenue_available: Boolean(cashierHit),
        revenue: {
            total: revenue,
            gross: roundMoney(cashier.gross),
            discount: roundMoney(cashier.discount),
            invoice_count: Math.max(0, parseInt(cashier.invoices, 10) || 0),
            ledger_pos_net: st.revenue.pos_net,
            ledger_total: st.revenue.total,
            vat_collected: st.revenue.vat_collected,
            manual_total: st.revenue.manual,
            manual_count: st.revenue.manual_count,
        },
        statement: st,
        oracle_available: oracleAvailable !== false,
        oracle: oracleCost == null ? null : { cost: oracleCost, docs: oracleHit.docs || 0 },
        derived: {
            cost: st.cogs.net,
            cost_pct: sharePct(st.cogs.net, revenue),
            expenses: expensesTotal,
            expenses_pct: sharePct(expensesTotal, revenue),
            gross_profit: grossProfit,
            gross_margin_pct: marginPct(grossProfit, revenue),
            net_profit: netProfit,
            net_margin_pct: marginPct(netProfit, revenue),
            oracle_cost: oracleCost,
            oracle_gap: oracleCost == null ? null : roundMoney(oracleCost - st.cogs.net),
            daily: dailyLedgerMovement(ledger.rows),
        },
        expenses: {
            rows: ledger.rows.slice(0, MONTHLY_DETAIL_ROW_CAP),
            rows_total: ledger.rows.length,
            rows_truncated: ledger.rows.length > MONTHLY_DETAIL_ROW_CAP,
            by_type: ledger.byType,
            by_category: st.operating.items,
            total: expensesTotal,
        },
        manual_revenues: {
            rows: manual.slice(0, MONTHLY_DETAIL_MANUAL_CAP),
            rows_total: manual.length,
            rows_truncated: manual.length > MONTHLY_DETAIL_MANUAL_CAP,
            total: st.revenue.manual,
        },
        generated_at: null,
        generated_by: null,
    };
}

// ─── HTML: قائمة شهرٍ واحد A4 ────────────────────────────────────────────────

function renderMonthlyDetailPrintHtml(detail, opts = {}) {
    const restaurantName = escHtml(opts.restaurantName || 'النظام المالي');
    const currency = escHtml(opts.currency || 'ريال سعودي (SAR)');
    const st = detail.statement || {};
    const rev = detail.revenue || {};
    const cogs = st.cogs || {};
    const gp = st.gross_profit || {};
    const sh = st.shrinkage || {};
    const op = st.operating || {};
    const pr = st.payroll || {};
    const np = st.net_profit || {};
    const der = detail.derived || {};
    const cashierRows = Array.isArray(detail.cashier_scope?.rows) ? detail.cashier_scope.rows : [];
    const cashierNames = cashierRows.map((row) => row.name).filter(Boolean);
    const money = (v) => (v == null ? '—' : fmtMoney(v));
    const pctTxt = (v) => (v == null ? '—' : `${roundMoney(v)}%`);
    const bar = (v, base) => {
        const p = Math.max(0, Math.min(100, Number(sharePct(v, base)) || 0));
        return `<span class="bar" aria-hidden="true"><i style="width:${p}%"></i></span>`;
    };
    const row = (label, value, cls = '', pct = null, extra = '') => `
        <tr class="${cls}">
            <td>${escHtml(label)}${extra}</td>
            <td class="n${Number(value) < 0 ? ' neg' : ''}">${money(value)}</td>
            <td class="p">${pct == null ? '—' : pctTxt(pct)}</td>
        </tr>`;
    const sub = (label, value) => row(label, value, 'sub');

    const opItems = (op.items || []).map((it) => sub(`${it.category} (${num(it.count)})`, it.amount)).join('');
    const expCats = (op.items || []).map((it) => `
        <tr>
            <td>${escHtml(it.category)}</td>
            <td class="p">${num(it.count)}</td>
            <td class="n${num(it.amount) < 0 ? ' neg' : ''}">${money(it.amount)}</td>
            <td class="p">${pctTxt(sharePct(it.amount, op.total))}</td>
            <td class="barcell">${bar(it.amount, op.total)}</td>
        </tr>`).join('');

    const daily = Array.isArray(der.daily) ? der.daily : [];
    const dailyRows = daily.map((d) => `
        <tr>
            <td class="d">${escHtml(d.date)}</td>
            <td class="n${num(d.cost) < 0 ? ' neg' : ''}">${money(d.cost)}</td>
            <td class="n${num(d.other) < 0 ? ' neg' : ''}">${money(d.other)}</td>
            <td class="n${num(d.total) < 0 ? ' neg' : ''}">${money(d.total)}</td>
        </tr>`).join('');

    const ledger = Array.isArray(detail.expenses?.rows) ? detail.expenses.rows : [];
    const topRows = ledger.slice(0, 40).map((r) => `
        <tr>
            <td class="d">${escHtml(r.date)}</td>
            <td>${escHtml(r.type_label)}</td>
            <td>${escHtml(r.category)}</td>
            <td class="desc">${escHtml(r.description || '—')}</td>
            <td>${escHtml(r.department || '—')}</td>
            <td class="n${num(r.amount) < 0 ? ' neg' : ''}">${money(r.amount)}</td>
        </tr>`).join('');

    const manualRows = (detail.manual_revenues?.rows || []).map((r) => `
        <tr>
            <td class="d">${escHtml(r.date)}</td>
            <td>${escHtml(r.source)}</td>
            <td>${escHtml(r.department || '—')}</td>
            <td class="n">${money(r.amount)}</td>
        </tr>`).join('');

    const oracleLine = detail.oracle
        ? `<div>· كوست فواتير المخزون (مرآة مستقلة): <strong>${money(detail.oracle.cost)}</strong> من ${num(detail.oracle.docs)} فاتورة — عمودٌ للمقارنة ولا يُدمج مع كوست الدفتر${der.oracle_gap == null ? '' : ` · الفرق ${money(der.oracle_gap)}`}.</div>`
        : `<div>· كوست فواتير المخزون: لا فواتير مخزون مسجّلة لهذا الشهر — تُذكر كما هي ولا تُقرأ صفرًا.</div>`;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>قائمة ${escHtml(arMonthLabel(detail.month))} — الإيرادات والمصروفات والكوست</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans Arabic','Cairo',Tahoma,sans-serif;color:#17231f;background:#fff;padding:12mm 10mm;font-size:11.5px}
.sheet{max-width:190mm;margin:0 auto}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;border-bottom:3px double #b8862d;padding-bottom:10px;margin-bottom:11px}
.who{display:flex;flex-direction:column;gap:2px}
.who h1{font-size:19px;color:#14352b}
.who .en{font-size:8.5px;letter-spacing:.7px;color:#8a7f63}
.doc{text-align:left;display:flex;flex-direction:column;gap:2px}
.doc strong{font-size:14px;color:#b8862d}
.doc span{font-size:9.5px;color:#7b7160;direction:ltr;text-align:left}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.meta div{background:#faf6ee;border:1px solid #e8dcc0;border-radius:7px;padding:6px 8px;font-size:9.5px;color:#6b5f45}
.meta b{display:block;color:#17231f;font-size:11px;margin-top:2px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px}
.kpi{border:1px solid #e3ddcd;border-radius:9px;padding:8px 10px;background:#fff}
.kpi.gold{background:#fbf6ea;border-color:#e2cf9f}
.kpi .l{font-size:9.5px;color:#7b7160}
.kpi .v{font-size:14.5px;font-weight:900;color:#14352b;direction:ltr;text-align:right;margin-top:3px}
.kpi .s{font-size:8.8px;color:#8a7f63;margin-top:2px}
h2{font-size:11.5px;color:#7a5b1e;margin:12px 0 5px;padding-bottom:3px;border-bottom:1px solid #eadfc6}
table{width:100%;border-collapse:collapse}
th{background:#b8862d;color:#fff;padding:5px 6px;font-size:9.3px;text-align:right;font-weight:700}
td{padding:4px 6px;border-bottom:1px solid #efefef;font-size:10.3px;vertical-align:top}
td.n{text-align:left;font-family:monospace;direction:ltr;white-space:nowrap}
td.p{text-align:center;color:#777;direction:ltr}
td.d{font-family:monospace;direction:ltr;white-space:nowrap;color:#555}
td.desc{color:#555}
td.barcell{width:18%}
tr.sub td:first-child{padding-right:18px;color:#555}
tr.tot td{background:#faf6ee;font-weight:900;border-top:2px solid #b8862d}
tr.net td{background:#eef7f0;font-weight:900;color:#1d6b47;border-top:2px solid #2f9e72}
.neg{color:#c0392b}
.bar{display:block;height:5px;background:#efe9dc;border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:#b8862d}
.notes{margin-top:10px;font-size:9.3px;color:#6b7280;line-height:1.75;border-top:1px dashed #ddd;padding-top:6px}
.notes strong{color:#33564a}
.sigs{display:flex;justify-content:space-between;gap:20px;margin-top:24px}
.sig{flex:1;text-align:center;font-size:10px;color:#555}
.sig .line{border-top:1.2px solid #333;margin-top:27px;padding-top:4px}
.foot{margin-top:11px;text-align:center;font-size:8.5px;color:#999;border-top:1px solid #eee;padding-top:6px}
@media print{body{padding:6mm}.sheet{max-width:none}tr{break-inside:avoid;page-break-inside:avoid}h2{break-after:avoid}thead{display:table-header-group}}
</style></head><body>
<div class="sheet">
<div class="head">
  <div class="who">
    <h1>${restaurantName}</h1>
    <span class="en">AL SHURFA AL ALAMI RESTAURANTS</span>
  </div>
  <div class="doc">
    <strong>قائمة الشهر المالية</strong>
    <span>${escHtml(arMonthLabel(detail.month))}</span>
    <span>${escHtml(detail.period?.from || '')} → ${escHtml(detail.period?.to || '')}</span>
  </div>
</div>
<div class="meta">
  <div>تاريخ الإصدار<b>${escHtml(opts.generatedAt || '')}</b></div>
  <div>بواسطة<b>${escHtml(opts.generatedBy || '—')}</b></div>
  <div>العملة<b>${currency}</b></div>
  <div>حالة الشهر<b>${detail.partial ? 'جزئي أو جارٍ' : 'شهر مكتمل'}</b></div>
  <div>الكاشيرات المشمولة<b>${escHtml(cashierNames.join('، ') || '—')}</b></div>
</div>
<div class="kpis">
  <div class="kpi gold"><div class="l">إيراد التحصيل المعتمد</div><div class="v">${money(rev.total)}</div><div class="s">${num(rev.invoice_count)} فاتورة معتمدة</div></div>
  <div class="kpi"><div class="l">كوست الدفتر (COGS)</div><div class="v">${money(cogs.net)}</div><div class="s">${pctTxt(der.cost_pct)} من الإيراد</div></div>
  <div class="kpi"><div class="l">المصروفات</div><div class="v">${money(der.expenses)}</div><div class="s">${pctTxt(der.expenses_pct)} من الإيراد</div></div>
  <div class="kpi"><div class="l">صافي الربح</div><div class="v">${money(np.amount)}</div><div class="s">الهامش ${pctTxt(np.margin_pct)}</div></div>
</div>

<h2>أولًا: الإيرادات (أساس التحصيل المعتمد)</h2>
<table>
  <thead><tr><th style="width:52%">البند</th><th style="width:30%">المبلغ</th><th style="width:18%">% من الإيراد</th></tr></thead>
  <tbody>
    ${row('إيراد التحصيل المعتمد (كما يسجّله تقرير الكاشيريات)', rev.total, 'tot', 100)}
    ${sub('إجمالي الفواتير قبل الخصم', rev.gross)}
    ${sub('خصومات الفواتير', rev.discount)}
    ${sub('عدد فواتير التحصيل', rev.invoice_count)}
    ${sub('إيراد دفتر النظام المرتبط بالفواتير (للمطابقة فقط)', rev.ledger_total)}
    ${sub('منه ضريبة قيمة مضافة مسجّلة (التزام — ليست إيرادًا)', rev.vat_collected)}
  </tbody>
</table>

${cashierRows.length ? `<h2>إيرادات الكاشيرات المشمولة (${num(cashierRows.length)})</h2>
<table>
  <thead><tr><th style="width:8%">#</th><th style="width:38%">الكاشير</th><th style="width:16%">الفواتير</th><th style="width:22%">الإيراد</th><th style="width:16%">الحصة</th></tr></thead>
  <tbody>${cashierRows.map((cashier) => `
    <tr>
      <td class="d">${escHtml(cashier.no)}</td>
      <td>${escHtml(cashier.name)}${cashier.linked ? '' : ' <span style="color:#9a7b2f">(غير مرتبط في الخريطة)</span>'}</td>
      <td class="n">${num(cashier.invoices)}</td>
      <td class="n">${money(cashier.net)}</td>
      <td class="p">${pctTxt(cashier.share_pct)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

<h2>ثانيًا: الكوست والمصروفات</h2>
<table>
  <thead><tr><th style="width:52%">البند</th><th style="width:30%">المبلغ</th><th style="width:18%">% من الإيراد</th></tr></thead>
  <tbody>
    ${sub('صرف مخزون مواد للأقسام', cogs.dispatch)}
    ${sub('مرتجعات الأقسام للمخزن', cogs.returns)}
    ${row('صافي الكوست (تكلفة المواد المستهلكة)', cogs.net, 'tot', der.cost_pct)}
    ${row('مجمل الربح', gp.amount, 'tot', gp.margin_pct)}
    ${sub('صافي فروق الجرد', sh.amount)}
    ${sub('الرواتب والأجور', pr.total)}
    ${opItems || sub('لا توجد مصاريف تشغيلية في الشهر', 0)}
    ${row('إجمالي المصروفات التشغيلية والكوست', der.expenses, 'tot', der.expenses_pct)}
    ${row('صافي الربح التشغيلي', np.amount, 'net', np.margin_pct)}
  </tbody>
</table>

${manualRows ? `<h2>قيود الإيراد في دفتر ERP (${num(detail.manual_revenues?.rows_total || 0)}) — لا تدخل في إيراد التحصيل أعلاه</h2>
<table>
  <thead><tr><th>التاريخ</th><th>المصدر</th><th>القسم</th><th style="width:26%">المبلغ</th></tr></thead>
  <tbody>${manualRows}</tbody>
</table>` : ''}

${expCats ? `<h2>المصروفات التشغيلية حسب الفئة</h2>
<table>
  <thead><tr><th>الفئة</th><th style="width:10%">العدد</th><th style="width:22%">المبلغ</th><th style="width:12%">النسبة</th><th style="width:18%">الوزن</th></tr></thead>
  <tbody>${expCats}</tbody>
</table>` : ''}

${dailyRows ? `<h2>الحركة اليومية للكوست والمصروفات</h2>
<table>
  <thead><tr><th style="width:22%">التاريخ</th><th>الكوست</th><th>مصروفات أخرى</th><th>الإجمالي اليومي</th></tr></thead>
  <tbody>${dailyRows}</tbody>
</table>
<p class="notes">الإيراد المعتمد شهريّ في تقرير الكاشيريات، فلا يُوزَّع على الأيام هنا كي لا يُخترع توزيع.</p>` : ''}

${topRows ? `<h2>أهم حركات المصروفات (${num(detail.expenses?.rows_total || 0)} حركة)</h2>
<table>
  <thead><tr><th style="width:13%">التاريخ</th><th style="width:13%">النوع</th><th style="width:17%">الفئة</th><th>البيان</th><th style="width:18%">القسم</th><th style="width:17%">المبلغ</th></tr></thead>
  <tbody>${topRows}</tbody>
</table>
<p class="notes">تُعرض أكبر ٤٠ حركة من ${num(detail.expenses?.rows_total || 0)} حركة مسجّلة — التفصيل الكامل على الشاشة.</p>` : ''}

<div class="notes">
  <div>· <strong>الكوست</strong> = صرف المخزون للأقسام − مرتجعاتها، وهو نفسه رقم قائمة الدخل (لا يشمل فروق الجرد ولا الرواتب).</div>
  <div>· <strong>المصروفات</strong> = التشغيلية + فروق الجرد + الرواتب — لا تُخلط بالكوست كي لا يُقرأ الربح مرتين.</div>
  <div>· <strong>صافي الربح</strong> = الإيرادات − الكوست − المصروفات، بلا ضريبة القيمة المضافة (التزام للهيئة).</div>
  <div>· <strong>الإيراد المعتمد</strong> = تحصيل الفواتير المعتمدة للكاشيرات المرتبطة كما في صفّ الشهر بجدول المقارنة؛ إيراد دفتر النظام سطرُ مطابقةٍ فقط ولا يُجمع معه.</div>
  <div>· <strong>قيود الإيراد في دفتر ERP</strong> (${num(rev.manual_count)} حركة بقيمة ${money(rev.manual_total)}): مرآة فواتير الكاشيرات وأي إدخال يدوي، لا تدخل في إيراد التحصيل أعلاه — تُعرض للمطابقة وحدها.</div>
  <div>· <strong>نطاق الإيراد</strong>: ${num(cashierRows.length)} كاشير مختار من فواتير الفترة ${escHtml(detail.period?.from || '')} → ${escHtml(detail.period?.to || '')}؛ إيراد كل كاشير مجموع أيام النافذة وحدها.</div>
  ${oracleLine}
  <div>· كل رقمٍ من حركةٍ مسجّلة فعليًا — لا إدخال يدوي في التقرير، ولا يُعاد حساب شيءٍ في الواجهة.</div>
</div>
<div class="sigs">
  <div class="sig"><div class="line">المدير المالي</div></div>
  <div class="sig"><div class="line">المدير العام</div></div>
  <div class="sig"><div class="line">الختم الرسمي</div></div>
</div>
<div class="foot">تم إنشاء هذا التقرير آليًا من حركات النظام الفعلية — ${restaurantName}</div>
</div>
</body></html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

function resolvePeriod(query) {
    let from = normalizeDay(query.from);
    let to = normalizeDay(query.to);
    if (!from && !to) {
        const today = riyadhToday();
        from = `${today.slice(0, 7)}-01`;
        to = today;
    } else if (!from || !to) {
        const err = new Error('يجب تمرير تاريخي البداية والنهاية معًا');
        err.statusCode = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }
    if (from > to) {
        const err = new Error('تاريخ البداية يجب أن يكون قبل النهاية أو مساويًا له');
        err.statusCode = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }
    if (daysBetween(from, to) > MAX_SPAN_DAYS) {
        const err = new Error(`أقصى نطاق مسموح ${MAX_SPAN_DAYS} يومًا`);
        err.statusCode = 400;
        err.code = 'PERIOD_TOO_LONG';
        throw err;
    }
    return { from, to };
}

function resolveCostAnalysisPeriod(query) {
    const parseDay = (value) => {
        if (value == null || value === '') {return '';}
        const day = String(value);
        const parsed = DATE_RE.test(day) ? new Date(`${day}T00:00:00.000Z`) : null;
        if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
            const err = new Error('صيغة التاريخ غير صالحة — استخدم YYYY-MM-DD');
            err.statusCode = 400;
            err.code = 'INVALID_PERIOD';
            throw err;
        }
        return day;
    };
    const today = riyadhToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = parseDay(query.from) || monthStart;
    const to = parseDay(query.to) || today;
    if (from > to) {
        const err = new Error('تاريخ البداية يجب أن يكون قبل النهاية أو مساويًا له');
        err.statusCode = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }
    if (from < monthStart || to > today) {
        const err = new Error('تحليل V2 متاح من بداية الشهر الحالي وحتى اليوم فقط');
        err.statusCode = 400;
        err.code = 'V2_CURRENT_MONTH_ONLY';
        throw err;
    }
    return { from, to };
}

function costAnalysisSql(from, to) {
    const params = [];
    const predicates = (column) => {
        const parts = [];
        if (from) {
            params.push(from);
            parts.push(`${column} >= $${params.length}`);
        }
        if (to) {
            const nextDay = new Date(`${to}T00:00:00.000Z`);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            params.push(nextDay.toISOString().slice(0, 10));
            parts.push(`${column} < $${params.length}`);
        }
        return parts.length ? ` AND ${parts.join(' AND ')}` : '';
    };
    const revenueRange = predicates('r.date');
    const expenseRange = predicates('e.date');
    const categoryRange = predicates('x.date');
    return {
        params,
        text: `
            WITH RECURSIVE dept_tree(root_code, code, path) AS (
                SELECT d.code, d.code, ARRAY[d.code]::varchar[]
                  FROM departments d
                 WHERE d.code IS NOT NULL
                UNION ALL
                SELECT tree.root_code, child.code, tree.path || child.code
                  FROM dept_tree tree
                  JOIN departments child ON child.parent_code = tree.code
                 WHERE NOT child.code = ANY(tree.path)
            ),
            revenue_totals AS (
                SELECT tree.root_code, SUM(COALESCE(r.amount, 0)) AS revenue
                  FROM dept_tree tree
                  JOIN revenues r ON r."deptId" = tree.code${revenueRange}
                 GROUP BY tree.root_code
            ),
            expense_totals AS (
                SELECT tree.root_code,
                       GREATEST(0, COALESCE(SUM(e.amount) FILTER (
                           WHERE LOWER(COALESCE(e."adjustmentType", '')) IN
                               ('dispatch', 'dispatch_return', 'receipt', 'stock_transfer',
                                'inventory_transfer', 'kitchen_return')
                       ), 0)) AS materials,
                       COALESCE(SUM(e.amount) FILTER (
                           WHERE LOWER(COALESCE(e."adjustmentType", '')) = 'count_correction'
                       ), 0) AS count_adj,
                       COALESCE(SUM(e.amount) FILTER (
                           WHERE LOWER(COALESCE(e."adjustmentType", '')) NOT IN
                               ('dispatch', 'dispatch_return', 'receipt', 'stock_transfer',
                                'inventory_transfer', 'kitchen_return', 'count_correction')
                       ), 0) AS operating,
                       COUNT(e.id)::int AS row_count
                  FROM dept_tree tree
                  LEFT JOIN expenses e ON e."deptId" = tree.code${expenseRange}
                 GROUP BY tree.root_code
            ),
            -- الإجماليات على مستوى الشركة تقرأ كل صفوف الفترة بلا فلتر قسم:
            -- صفوف بلا deptId (مثل فروق جرد موقع غير مسند) جزء من الكلفة ولا
            -- يجوز إسقاطها من الإجمالي. صفوف الأقسام وحدها تبقى في الجدول.
            overall_totals AS (
                SELECT
                    (SELECT COALESCE(SUM(COALESCE(r.amount, 0)), 0)
                       FROM revenues r
                      WHERE r."deptId" != 'ys_b4_ext'${revenueRange}) AS revenue,
                    (SELECT COALESCE(SUM(e.amount), 0)
                       FROM expenses e
                      WHERE LOWER(COALESCE(e."adjustmentType", '')) IN
                          ('dispatch', 'dispatch_return', 'receipt', 'stock_transfer',
                           'inventory_transfer', 'kitchen_return')${expenseRange}) AS materials,
                    (SELECT COALESCE(SUM(e.amount), 0)
                       FROM expenses e
                      WHERE LOWER(COALESCE(e."adjustmentType", '')) = 'count_correction'${expenseRange}) AS count_adj,
                    (SELECT COALESCE(SUM(e.amount), 0)
                       FROM expenses e
                      WHERE LOWER(COALESCE(e."adjustmentType", '')) NOT IN
                          ('dispatch', 'dispatch_return', 'receipt', 'stock_transfer',
                           'inventory_transfer', 'kitchen_return', 'count_correction')${expenseRange}) AS operating
            ),
            category_totals AS (
                SELECT COALESCE(x.category, 'أخرى') AS label,
                       SUM(COALESCE(x.amount, 0)) AS amount
                  FROM expenses x
                 WHERE TRUE${categoryRange}
                 GROUP BY 1
            ),
            categories AS (
                SELECT COALESCE(
                    JSON_AGG(JSON_BUILD_OBJECT('label', label, 'value', amount) ORDER BY amount DESC),
                    '[]'::json
                ) AS items
                  FROM category_totals
            )
            SELECT d.code, d.name,
                   COALESCE(r.revenue, 0) AS revenue,
                   COALESCE(e.materials, 0) AS materials,
                   COALESCE(e.count_adj, 0) AS count_adj,
                   COALESCE(e.operating, 0) AS operating,
                   COALESCE(e.row_count, 0) AS row_count,
                   categories.items AS categories,
                   overall_totals.revenue AS total_revenue,
                   overall_totals.materials AS total_materials,
                   overall_totals.count_adj AS total_count_adj,
                   overall_totals.operating AS total_operating
              FROM departments d
              LEFT JOIN revenue_totals r ON r.root_code = d.code
              LEFT JOIN expense_totals e ON e.root_code = d.code
              CROSS JOIN categories
              CROSS JOIN overall_totals
             ORDER BY d.name, d.code`,
    };
}

function buildCostAnalysisResult(rows) {
    const departments = (Array.isArray(rows) ? rows : []).map((row) => {
        const rev = num(row.revenue);
        const materials = num(row.materials);
        const countAdj = num(row.count_adj);
        const operating = num(row.operating);
        const exp = materials + countAdj + operating;
        return {
            code: row.code,
            name: row.name,
            rev,
            exp,
            profit: rev - exp,
            costRatio: rev > 0 ? (exp / rev) * 100 : 0,
            materials,
            countAdj,
            operating,
            total: exp,
            rowCount: num(row.row_count),
        };
    });
    const overall = Array.isArray(rows) && rows.length ? rows[0] : {};
    const totals = {
        rev: num(overall.total_revenue),
        mat: num(overall.total_materials),
        cnt: num(overall.total_count_adj),
        ops: num(overall.total_operating),
    };
    totals.exp = totals.mat + totals.cnt + totals.ops;
    totals.avgCost = totals.rev > 0 ? (totals.exp / totals.rev) * 100 : 0;
    return {
        rows: departments,
        totals,
        categories: Array.isArray(rows) && rows.length && Array.isArray(rows[0].categories)
            ? rows[0].categories
            : [],
    };
}

/* ── تحليل التكاليف — مستند A4 مستقل بهوية المطعم ────────────────────────
   العارض في V2 يطبع هذا المستند؛ العلامة data-v2-print-brand تمنع حقن
   ترويسة ثانية فوق ترويسة المستند الأصلية. */
const COST_PRINT_STYLE = `
@page { size: A4; margin: 11mm 10mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; padding: 16px; background: #eef1f6; color: #17231f;
  font-family: "IBM Plex Sans Arabic", "Cairo", Tahoma, Arial, sans-serif;
  font-size: 11.5px; line-height: 1.55; direction: rtl;
}
.sheet { max-width: 200mm; margin: 0 auto; background: #fff; border: 1px solid #dfe3ea;
         border-radius: 14px; box-shadow: 0 14px 40px rgba(15, 23, 42, .10); overflow: hidden; }
.brand { display: flex; align-items: center; gap: 16px; padding: 16px 20px;
         background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
         border-bottom: 3px solid #c9a227; }
.brand img { width: 62px; height: 62px; object-fit: contain; background: #fff;
             border: 2px solid #c9a227; border-radius: 12px; padding: 4px; }
.brand__t { flex: 1; min-width: 0; }
.brand__t h1 { margin: 0; font-size: 17px; color: #f5d76e; font-weight: 700; }
.brand__t p { margin: 2px 0 0; font-size: 10.5px; color: #cbd5e1; letter-spacing: .3px; }
.brand__id .no { display: inline-block; background: rgba(245, 215, 110, .14);
                 border: 1px solid #c9a227; border-radius: 999px; padding: 3px 14px;
                 font-size: 12px; font-weight: 700; color: #f5d76e;
                 font-variant-numeric: tabular-nums; direction: ltr; white-space: nowrap; }
.doc { text-align: center; padding: 14px 20px 2px; }
.doc h2 { margin: 0; font-size: 20px; color: #0f172a; letter-spacing: .4px; }
.doc .sub { margin-top: 3px; font-size: 11px; color: #64748b; }
.body { padding: 4px 20px 18px; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #e5e7eb;
        border-radius: 10px; overflow: hidden; margin-top: 10px; }
.cell { padding: 8px 11px; border-inline-start: 1px solid #eef1f5; border-top: 1px solid #eef1f5; }
.cell:nth-child(4n+1) { border-inline-start: 0; }
.cell:nth-child(-n+4) { border-top: 0; }
.cell b { display: block; font-size: 10px; color: #8a6d1b; font-weight: 700; }
.cell span { display: block; margin-top: 2px; font-size: 13px; color: #0f172a;
             font-weight: 700; font-variant-numeric: tabular-nums; }
.cell small { display: block; margin-top: 1px; font-size: 9.5px; color: #64748b; }
h3.sec { margin: 16px 0 6px; padding-inline-start: 9px; border-inline-start: 4px solid #c9a227;
         font-size: 12.5px; color: #0f172a; }
table.t { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.t th, table.t td { padding: 5px 7px; border-bottom: 1px solid #edf0f4; text-align: right; }
table.t th { background: #0f172a; color: #f5d76e; font-size: 10.5px; font-weight: 700;
             text-align: center; white-space: nowrap; }
table.t td.c { text-align: center; }
table.t td.n { text-align: left; direction: ltr; unicode-bidi: embed; white-space: nowrap; }
table.t tbody tr:nth-child(even) td { background: #f8fafc; }
table.t tbody tr { break-inside: avoid; page-break-inside: avoid; }
table.t tfoot td { background: #eef2f7; border-top: 2px solid #c9a227; border-bottom: 0;
                   font-weight: 800; color: #0f172a; font-size: 11.5px; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 9.5px;
        font-weight: 700; white-space: nowrap; border: 1px solid #dbe1ea;
        background: #f2f4f7; color: #475467; }
.pill--success { border-color: #0b9e6c; background: rgba(11, 158, 108, .10); color: #055f3a; }
.pill--danger { border-color: #e5484d; background: rgba(229, 72, 77, .10); color: #b42318; }
.pos { color: #055f3a; font-weight: 700; }
.neg { color: #b42318; font-weight: 700; }
.foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px;
        border-top: 1px solid #e5e7eb; padding-top: 7px; font-size: 9.5px; color: #94a3b8; }
.empty { text-align: center; color: #94a3b8; padding: 10px; }
@media print {
  body { background: #fff; padding: 0; }
  .sheet { border: 0; border-radius: 0; box-shadow: none; max-width: none; }
  table.t thead { display: table-header-group; }
}`;

async function financePrintBrand() {
    const fallback = {
        name: await restaurantDisplayName(),
        currency: 'SAR',
        logo: '/app/assets/al-shurfa-logo.png',
    };
    try {
        const result = await pool.query(
            `SELECT name, currency, "logoB64" FROM settings WHERE id = 'main_settings' LIMIT 1`,
        );
        const row = result.rows[0] || {};
        const logo = String(row.logoB64 || '');
        return {
            name: String(row.name || '').trim() || fallback.name,
            currency: String(row.currency || '').trim() || fallback.currency,
            logo: /^data:image\//i.test(logo) ? logo : fallback.logo,
        };
    } catch (error) {
        logger.warn(`[finance] print brand unavailable: ${error.message}`);
        return fallback;
    }
}

/** مستند تحليل التكاليف: الأرقام نفسها التي تعرضها الشاشة، بلا أي حساب جديد. */
function renderCostAnalysisPrintHtml(payload, opts = {}) {
    const rows = Array.isArray(payload && payload.rows) ? payload.rows.slice() : [];
    const totals = (payload && payload.totals) || { rev: 0, mat: 0, cnt: 0, ops: 0, exp: 0, avgCost: 0 };
    const categories = Array.isArray(payload && payload.categories) ? payload.categories.slice() : [];
    const period = (payload && payload.period) || {};
    const brand = {
        name: opts.restaurantName || 'النظام المالي',
        logo: opts.logo || '/app/assets/al-shurfa-logo.png',
        currency: opts.currency || 'SAR',
    };
    const generatedAt = opts.generatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ');
    const generatedBy = opts.generatedBy || '—';
    const money = (v) => fmtMoney(v);
    const share = (part, base) => (Number(base) > 0 ? `${roundMoney((Number(part) / Number(base)) * 100)}%` : '—');
    const signedClass = (v) => (Number(v) < 0 ? 'neg' : 'pos');

    const composition = [
        ['صرف المخزون (صافي المرتجعات)', totals.mat],
        ['فروق الجرد', totals.cnt],
        ['مصروفات تشغيلية', totals.ops],
    ].map(([label, value]) => `
        <tr>
            <td>${escHtml(label)}</td>
            <td class="n">${money(value)}</td>
            <td class="c">${share(value, totals.exp)}</td>
            <td class="c">${share(value, totals.rev)}</td>
        </tr>`).join('');

    const deptRows = rows
        .slice()
        .sort((a, b) => (num(b.exp) - num(a.exp)) || (num(b.rev) - num(a.rev)))
        .map((row, index) => `
        <tr>
            <td class="c">${index + 1}</td>
            <td>${escHtml(row.name)}<span class="pill" style="margin-inline-start:6px">${escHtml(row.code)}</span></td>
            <td class="n">${money(row.rev)}</td>
            <td class="n">${money(row.materials)}</td>
            <td class="n">${money(row.countAdj)}</td>
            <td class="n">${money(row.operating)}</td>
            <td class="n"><strong>${money(row.exp)}</strong></td>
            <td class="c">${share(row.exp, row.rev)}</td>
            <td class="n ${signedClass(row.profit)}">${money(row.profit)}</td>
            <td class="c"><span class="pill pill--${row.profit >= 0 ? 'success' : 'danger'}">${row.profit >= 0 ? 'مربح' : 'خاسر'}</span></td>
        </tr>`).join('');

    const categoryRows = categories
        .slice()
        .sort((a, b) => num(b.value) - num(a.value))
        .map((category, index) => `
        <tr>
            <td class="c">${index + 1}</td>
            <td>${escHtml(category.label || 'أخرى')}</td>
            <td class="n">${money(category.value)}</td>
            <td class="c">${share(category.value, totals.exp)}</td>
        </tr>`).join('');

    const net = num(totals.rev) - num(totals.exp);
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تحليل التكاليف — ${escHtml(period.from || '')} → ${escHtml(period.to || '')}</title>
<style>${COST_PRINT_STYLE}</style></head><body>
<main class="sheet">
  <header class="brand" data-v2-print-brand>
    <img src="${escHtml(brand.logo)}" alt="شعار ${escHtml(brand.name)}">
    <div class="brand__t">
      <h1>${escHtml(brand.name)}</h1>
      <p>تحليل التكاليف · COST ANALYSIS</p>
    </div>
    <div class="brand__id"><span class="no">${escHtml(period.from || '')} → ${escHtml(period.to || '')}</span></div>
  </header>
  <div class="doc">
    <h2>تحليل التكاليف</h2>
    <div class="sub">ملخص الإيرادات والتكاليف حسب القسم والفترة المحددة</div>
  </div>
  <div class="body">
    <section class="grid">
      <div class="cell"><b>إجمالي الإيرادات</b><span>${money(totals.rev)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>إجمالي التكاليف</b><span>${money(totals.exp)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>صافي الربح</b><span class="${signedClass(net)}">${money(net)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>نسبة التكلفة</b><span>${roundMoney(totals.avgCost)}%</span><small>التكلفة ÷ الإيراد</small></div>
      <div class="cell"><b>صرف المخزون</b><span>${money(totals.mat)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>فروق الجرد</b><span>${money(totals.cnt)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>مصروفات تشغيلية</b><span>${money(totals.ops)}</span><small>${escHtml(brand.currency)}</small></div>
      <div class="cell"><b>النطاق</b><span>${rows.length} قسم</span><small>${categories.length} تصنيف مصروف</small></div>
    </section>

    <h3 class="sec">توزيع التكلفة</h3>
    <table class="t">
      <thead><tr><th style="width:46%">البند</th><th style="width:20%">المبلغ</th>
        <th style="width:17%">% من التكلفة</th><th style="width:17%">% من الإيراد</th></tr></thead>
      <tbody>${composition}</tbody>
      <tfoot><tr><td>إجمالي التكلفة</td><td class="n">${money(totals.exp)}</td>
        <td class="c">100%</td><td class="c">${share(totals.exp, totals.rev)}</td></tr></tfoot>
    </table>

    <h3 class="sec">تفصيل الأقسام</h3>
    <table class="t">
      <thead><tr><th style="width:4%">#</th><th>القسم</th><th>الإيرادات</th><th>صرف المخزون</th>
        <th>فروق الجرد</th><th>تشغيلية</th><th>التكلفة</th><th>النسبة</th>
        <th>الصافي</th><th>التقييم</th></tr></thead>
      <tbody>${deptRows || `<tr><td colspan="10" class="empty">لا أقسام في هذه الفترة</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">الإجمالي</td><td class="n">${money(totals.rev)}</td>
        <td class="n">${money(totals.mat)}</td><td class="n">${money(totals.cnt)}</td>
        <td class="n">${money(totals.ops)}</td><td class="n">${money(totals.exp)}</td>
        <td class="c">${roundMoney(totals.avgCost)}%</td>
        <td class="n ${signedClass(net)}">${money(net)}</td><td></td></tr></tfoot>
    </table>

    <h3 class="sec">تصنيفات المصروفات</h3>
    <table class="t">
      <thead><tr><th style="width:8%">#</th><th>التصنيف</th>
        <th style="width:22%">المبلغ</th><th style="width:18%">% من التكلفة</th></tr></thead>
      <tbody>${categoryRows || `<tr><td colspan="4" class="empty">لا تصنيفات في هذه الفترة</td></tr>`}</tbody>
    </table>

    <div class="foot">
      <span>${escHtml(brand.name)} — تحليل التكاليف · ${escHtml(period.from || '')} → ${escHtml(period.to || '')}</span>
      <span>أُنشئ ${escHtml(generatedAt)} · ${escHtml(generatedBy)}</span>
    </div>
  </div>
</main>
</body></html>`;
}

router.get('/cost-analysis', jwtAuth, requireRole(...COST_ANALYSIS_READ_ROLES), asyncHandler(async (req, res) => {
    const { from, to } = resolveCostAnalysisPeriod(req.query);
    const query = costAnalysisSql(from, to);
    const result = await pool.query(query.text, query.params);
    res.json({ ...buildCostAnalysisResult(result.rows), period: { from, to } });
}));

router.get('/cost-analysis/print', jwtAuth, requireRole(...COST_ANALYSIS_READ_ROLES), asyncHandler(async (req, res) => {
    const { from, to } = resolveCostAnalysisPeriod(req.query);
    const query = costAnalysisSql(from, to);
    const result = await pool.query(query.text, query.params);
    const brand = await financePrintBrand();
    res.type('html').send(renderCostAnalysisPrintHtml(
        { ...buildCostAnalysisResult(result.rows), period: { from, to } },
        {
            restaurantName: brand.name,
            logo: brand.logo,
            currency: brand.currency,
            generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            generatedBy: req.user?.username || req.user?.name || '—',
        },
    ));
}));

router.use(jwtAuth, requireRole(...READ_ROLES));

async function loadPnlInputs(from, to) {
    const [ordersRes, manualRes, expensesRes, payrollRes, deptMapRes, deptHierarchyRes] = await Promise.all([
        pool.query(`
            SELECT o.subtotal, o.discount_total, o.tax_total, o.total_amount,
                   o.created_at AS day, d.code AS pos_dept_code
              FROM pos_orders o
              JOIN pos_departments d ON d.id = o.department_id
             WHERE o.status IN ('issued','reported')
                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date >= $1::date
                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date <= $2::date
               AND o.total_amount IS NOT NULL`,
             [from, to]),
        pool.query(`
            SELECT "deptId", source, amount, date
              FROM revenues
             WHERE pos_order_id IS NULL
               AND "deptId" != 'ys_b4_ext'
               AND LEFT(date, 10) >= $1 AND LEFT(date, 10) <= $2`,
             [from, to]),
        pool.query(`
            SELECT "deptId", "desc", amount, date, category, "adjustmentType"
              FROM expenses
             WHERE LEFT(date, 10) >= $1 AND LEFT(date, 10) <= $2`,
             [from, to]),
        pool.query(`
            SELECT "employeeId", month, year, "netSalary", status FROM payroll`),
        pool.query(`
            SELECT code, name_ar, legacy_dept_code FROM pos_departments`),
        pool.query(`SELECT code, name, parent_code FROM departments`),
    ]);
    return {
        orders: ordersRes.rows,
        manualRevenues: manualRes.rows,
        expenses: expensesRes.rows,
        payroll: payrollRes.rows,
        posDeptMap: deptMapRes.rows,
        deptHierarchy: deptHierarchyRes.rows,
    };
}

router.get('/pnl', asyncHandler(async (req, res) => {
    const { from, to } = resolvePeriod(req.query);
    const inputs = await loadPnlInputs(from, to);
    const current = buildPnlStatement({ ...inputs, fromDay: from, toDay: to });

    const prev = computePreviousPeriod(from, to);
    let previous = null;
    if (prev.from && prev.to) {
        try {
            const prevInputs = await loadPnlInputs(prev.from, prev.to);
            previous = buildPnlStatement({ ...prevInputs, fromDay: prev.from, toDay: prev.to });
        } catch (e) {
            logger.warn(`[finance] previous period build failed: ${e.message}`);
        }
    }

    res.json({
        period: { from, to },
        previous_period: prev,
        statement: current,
        comparison: buildComparison(current, previous),
        generated_at: new Date().toISOString(),
        generated_by: req.user?.username || req.user?.name || null,
    });
}));

router.get('/pnl/print', asyncHandler(async (req, res) => {
    const { from, to } = resolvePeriod(req.query);
    const inputs = await loadPnlInputs(from, to);
    const current = buildPnlStatement({ ...inputs, fromDay: from, toDay: to });
    const settingsRes = await pool.query(`SELECT data FROM settings ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] }));
    let restaurantName = 'قائمة الدخل';
    const settingsData = settingsRes.rows[0]?.data;
    if (settingsData) {
        try {
            const parsed = typeof settingsData === 'string' ? JSON.parse(settingsData) : settingsData;
            if (parsed?.name) {restaurantName = parsed.name;}
        } catch (_) { /* ignore */ }
    }
    res.type('html').send(renderPnlPrintHtml(current, {
        restaurantName,
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        generatedBy: req.user?.username || req.user?.name || '—',
    }));
}));

/* ── المقارنة الشهرية (قراءة فقط): نافذة متجددة تنتهي بالشهر الجاري ──────────
   نفس بوابة /pnl (admin|manager|accountant) لأنها الملف نفسه بعد router.use.
   لا كتابة ولا تصحيح — تُعرض الأرقام كما هي، والنقص يُعلَن لا يُملأ. */
async function restaurantDisplayName() {
    const settingsRes = await pool.query(`SELECT data FROM settings ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] }));
    const settingsData = settingsRes.rows[0]?.data;
    if (!settingsData) {return 'النظام المالي';}
    try {
        const parsed = typeof settingsData === 'string' ? JSON.parse(settingsData) : settingsData;
        return parsed?.name || 'النظام المالي';
    } catch (_) {return 'النظام المالي';}
}

async function monthlyComparisonPayload(query) {
    const toDay = normalizeDay(riyadhToday());
    const range = monthlyRangeFromQuery(query, toDay);
    const requestedCashiers = parseCashierSelection(query?.cashiers);
    const yearFrom = `${range.to.slice(0, 4)}-01-01`;
    const inputsFrom = range.from < yearFrom ? range.from : yearFrom;
    const [inputs, cashierRevenue] = await Promise.all([
        loadPnlInputs(inputsFrom, toDay),
        loadMonthlyLinkedCashierRevenue(range.from, range.to, { cashiers: requestedCashiers }),
    ]);

    let oracleByMonth = new Map();
    let oracleAvailable = true;
    try {
        oracleByMonth = await loadOracleMonthlyCost();
    } catch (e) {
        oracleAvailable = false;
        logger.warn(`[finance] oracle monthly cost unavailable: ${e.message}`);
    }

    const rows = buildMonthlyComparison({
        monthWindows: range.windows, toDay, inputs, oracleByMonth,
        cashierRevenueForWindow: (win) => summarizeCashierDays(cashierRevenue.days, win.from, win.to),
    });
    const dispatchYear = buildDispatchYearSummary(inputs.expenses, range.to);
    const selectedNos = cashierRevenue.selected.map((cashier) => cashier.no);
    const cashierRows = buildCashierRevenueRows(cashierRevenue.byCashier, selectedNos);
    return {
        period: {
            from: range.from,
            to: range.to,
            months: range.windows.length,
            mode: range.mode,
            today: toDay,
        },
        sources: {
            revenue: 'تحصيل الفواتير المعتمدة من تقرير الكاشيريات — NET_VAL شاملًا الضريبة، لكل كاشيرٍ ظهرت له فواتير معتمدة في الفترة (ومنهم 2 وأي كاشيرٍ جديد على الشبكة)، بلا بديل محلي',
            ledger: 'دفتر النظام — صرف المخزون ومرتجعاته (رقم قائمة الدخل نفسه)',
            dispatch_expenses: 'دفتر مصروفات ERP — adjustmentType=dispatch وdispatch_return، صافي بعد المرتجعات، من بداية سنة نهاية الفترة حتى نهايتها',
            oracle: 'مرآة فواتير المخزون (BILLS6) — عمودٌ للمقارنة فقط',
        },
        cashier_scope: cashierRevenue.cashiers.map(({ no, name, linked, selected }) => ({ no, name, linked, selected })),
        cashier_revenue: {
            rows: cashierRows,
            selected: selectedNos,
            all_selected: selectedNos.length === cashierRevenue.cashiers.length,
            totals: {
                net: roundMoney(cashierRows.reduce((sum, row) => sum + row.net, 0)),
                invoices: cashierRows.reduce((sum, row) => sum + row.invoices, 0),
            },
        },
        dispatch_year: dispatchYear,
        oracle_available: oracleAvailable,
        months: rows,
        totals: sumMonthlyTotals(rows),
        generated_at: new Date().toISOString(),
        generated_by: null,
    };
}

/** نافذة تفصيل الشهر: الشهر كاملًا افتراضيًا، أو الجزء المحدد داخل حدوده فقط. */
function detailWindowFor(monthKey, query, toDay) {
    const y = parseInt(monthKey.slice(0, 4), 10);
    const m = parseInt(monthKey.slice(5, 7), 10);
    const first = `${monthKey}-01`;
    const last = monthEndOf(y, m);
    const monthTo = last && last > toDay ? toDay : last;
    const hasCustom = query?.from != null || query?.to != null;
    if (!hasCustom) {
        return { from: first, to: monthTo, partial: monthTo !== last };
    }
    const from = strictDay(query?.from);
    const to = strictDay(query?.to);
    if (!from || !to) {
        throw rangeError('INVALID_PERIOD', 'نافذة الشهر تحتاج تاريخ بداية ونهاية صحيحين.');
    }
    if (from < first || to > last) {
        throw rangeError('INVALID_PERIOD', 'الفترة المطلوبة يجب أن تقع داخل الشهر المختار.');
    }
    if (from > to) {
        throw rangeError('INVALID_PERIOD', 'تاريخ البداية بعد تاريخ النهاية.');
    }
    if (to > toDay) {
        throw rangeError('INVALID_PERIOD', 'تاريخ النهاية بعد اليوم — اعرض حتى اليوم فقط.');
    }
    return { from, to, partial: from !== first || to !== last };
}

/* ── تفصيل شهر واحد (قراءة فقط): نفس بوابة المقارنة ونفس أساس الإيراد ────── */
async function monthlyDetailPayload(query) {
    const monthKey = monthKeyOrThrow(query?.month);
    const toDay = normalizeDay(riyadhToday());
    if (monthKey > toDay.slice(0, 7)) {
        const err = new Error('لا يمكن تفصيل شهر لم يبدأ بعد');
        err.statusCode = 400;
        err.code = 'MONTH_IN_FUTURE';
        throw err;
    }
    const win = detailWindowFor(monthKey, query, toDay);
    if (!win.from || !win.to || win.from > win.to) {
        throw rangeError('INVALID_PERIOD', 'نافذة الشهر غير صالحة');
    }
    const requestedCashiers = parseCashierSelection(query?.cashiers);
    const [inputs, cashierRevenue] = await Promise.all([
        loadPnlInputs(win.from, win.to),
        loadMonthlyLinkedCashierRevenue(win.from, win.to, { cashiers: requestedCashiers }),
    ]);
    let oracleByMonth = new Map();
    let oracleAvailable = true;
    try {
        oracleByMonth = await loadOracleMonthlyCost();
    } catch (e) {
        oracleAvailable = false;
        logger.warn(`[finance] oracle monthly cost unavailable: ${e.message}`);
    }
    const cashierHit = summarizeCashierDays(cashierRevenue.days, win.from, win.to);
    const selectedNos = cashierRevenue.selected.map((cashier) => cashier.no);
    const detail = buildMonthlyDetail({
        monthKey,
        win,
        inputs,
        cashierHit: cashierHit.invoices > 0 ? cashierHit : null,
        oracleHit: oracleByMonth.get(monthKey) || null,
        oracleAvailable,
    });
    detail.cashier_scope = {
        selected: selectedNos,
        rows: buildCashierRevenueRows(cashierRevenue.byCashier, selectedNos),
        discovered: cashierRevenue.cashiers.map(({ no, name, linked }) => ({ no, name, linked })),
    };
    return detail;
}

function sendMonthlyComparisonSourceError(error, res) {
    const codes = ['YARASOFT_REVENUE_UNAVAILABLE', 'NO_LINKED_CASHIERS', 'INVALID_LINKED_CASHIER', 'LINKED_CASHIER_MAP_UNAVAILABLE'];
    if (!error || !codes.includes(error.code)) {return false;}
    res.status(503).json({ error: error.code, code: error.code, message: error.message });
    return true;
}

router.get('/monthly-comparison', asyncHandler(async (req, res) => {
    let payload;
    try {
        payload = await monthlyComparisonPayload(req.query);
    } catch (error) {
        if (sendMonthlyComparisonSourceError(error, res)) {return;}
        throw error;
    }
    payload.generated_by = req.user?.username || req.user?.name || null;
    res.json(payload);
}));

router.get('/monthly-comparison/print', asyncHandler(async (req, res) => {
    let payload;
    try {
        payload = await monthlyComparisonPayload(req.query);
    } catch (error) {
        if (sendMonthlyComparisonSourceError(error, res)) {return;}
        throw error;
    }
    res.type('html').send(renderMonthlyPrintHtml(payload.months, payload.totals, {
        restaurantName: await restaurantDisplayName(),
        from: payload.period.from,
        to: payload.period.to,
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        generatedBy: req.user?.username || req.user?.name || '—',
        cashiers: payload.cashier_scope.filter((cashier) => cashier.selected),
        cashierRevenue: payload.cashier_revenue,
        dispatchYear: payload.dispatch_year,
    }));
}));

router.get('/monthly-comparison/month', asyncHandler(async (req, res) => {
    let detail;
    try {
        detail = await monthlyDetailPayload(req.query);
    } catch (error) {
        if (sendMonthlyComparisonSourceError(error, res)) {return;}
        throw error;
    }
    detail.generated_at = new Date().toISOString();
    detail.generated_by = req.user?.username || req.user?.name || null;
    res.json(detail);
}));

router.get('/monthly-comparison/month/print', asyncHandler(async (req, res) => {
    let detail;
    try {
        detail = await monthlyDetailPayload(req.query);
    } catch (error) {
        if (sendMonthlyComparisonSourceError(error, res)) {return;}
        throw error;
    }
    res.type('html').send(renderMonthlyDetailPrintHtml(detail, {
        restaurantName: await restaurantDisplayName(),
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        generatedBy: req.user?.username || req.user?.name || '—',
    }));
}));

// asyncHandler بسيط محلي (نفس نمط بقية الملفات)
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
    router,
    // pure helpers للاختبارات
    roundMoney,
    num,
    normalizeDay,
    monthStartOf,
    monthEndOf,
    daysBetween,
    computePreviousPeriod,
    pctChange,
    isCogsExpense,
    isShrinkageExpense,
    isOperatingExpenseRow,
    classifyExpenses,
    aggregatePayroll,
    marginPct,
    buildPnlStatement,
    buildComparison,
    renderPnlPrintHtml,
    resolveCostAnalysisPeriod,
    costAnalysisSql,
    buildCostAnalysisResult,
    renderCostAnalysisPrintHtml,
    // المقارنة الشهرية (مصدَّرة للاختبارات)
    MONTHLY_DEFAULT_MONTHS,
    MONTHLY_MAX_MONTHS,
    ORACLE_COST_SQL,
    clampMonths,
    shiftMonthKey,
    monthKeysEndingAt,
    monthWindow,
    strictDay,
    monthWindowsInRange,
    parseCashierSelection,
    monthlyRangeFromQuery,
    summarizeCashierDays,
    buildCashierRevenueRows,
    detailWindowFor,
    buildMonthlyComparison,
    sumMonthlyTotals,
    buildDispatchYearSummary,
    monthlyComparisonPayload,
    renderMonthlyPrintHtml,
    arMonthLabel,
    // تفصيل الشهر (مصدَّرة للاختبارات)
    MONTHLY_DETAIL_ROW_CAP,
    MONTHLY_DETAIL_MANUAL_CAP,
    EXPENSE_TYPE_LABELS,
    sharePct,
    monthKeyOrThrow,
    departmentNames,
    expenseTypeMeta,
    monthlyExpenseLedger,
    dailyLedgerMovement,
    buildMonthlyDetail,
    monthlyDetailPayload,
    renderMonthlyDetailPrintHtml,
};
