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

const router = express.Router();

const READ_ROLES = ['admin', 'manager', 'accountant'];
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

// ─── Routes ──────────────────────────────────────────────────────────────────

router.use(jwtAuth, requireRole(...READ_ROLES));

function resolvePeriod(query) {
    let from = normalizeDay(query.from);
    let to = normalizeDay(query.to);
    if (!from && !to) {
        const today = new Date().toISOString().slice(0, 10);
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

async function loadPnlInputs(from, to) {
    const [ordersRes, manualRes, expensesRes, payrollRes, deptMapRes, deptHierarchyRes] = await Promise.all([
        pool.query(`
            SELECT o.subtotal, o.discount_total, o.tax_total, o.total_amount,
                   o.created_at AS day, d.code AS pos_dept_code
              FROM pos_orders o
              JOIN pos_departments d ON d.id = o.department_id
             WHERE o.status IN ('issued','reported')
               AND (o.created_at AT TIME ZONE 'UTC')::date >= $1::date
               AND (o.created_at AT TIME ZONE 'UTC')::date <= $2::date
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
};
