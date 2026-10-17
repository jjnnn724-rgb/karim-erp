/**
 * V2 — Reports repository (الباب الوحيد إلى /api/pos/reports/sales + /api/settings/main_settings)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /pos/reports/sales?start_date&end_date&group_by&department_id&cashier_id
 *     (shift-routes.js:938 · mounted at /api/pos by cashier-module/index.js:52
 *      · read gate = cashier|manager|admin|auditor|accountant, same line)
 *       start_date / end_date   إلزاميان بصيغة YYYY-MM-DD — غيابهما 422 (:124-134)
 *       start_date > end_date   422 INVALID_DATE_RANGE (:942-944)
 *       group_by                كل قيمها المخزّنة: department | cashier | item
 *                               غير ذلك 422 INVALID_GROUP_BY، وافتراضيها department (:946-949)
 *       department_id/cashier_id عدد صحيح موجب أو غائب — غيرها 422 (:136-142,:951-952)
 *     ما يُعدّ: `o.status IN ('issued','reported')` لا غير (:957) — المرتجعات
 *     والملغاة ليست في هذا التقرير، وهي قاعدة الخادم وليست تصفية هنا.
 *     دور الكاشير محصور في نفسه في SQL (:968-971) والخادم يعكس ذلك في
 *     `filters.cashier_id` (:1138) — الشاشة تعرضه ولا تقرر شيئًا.
 *     المغلّف: { start_date, end_date, group_by, filters, summary, rows } (:1132-1142)
 *     الأرقام تصل أرقامًا JS لا نصوصًا: coerceNumericRecord (:145-159)
 *     الترتيب من الخادم: net_sales ثم invoice_count ثم الاسم تصاعديًا (:1055,:1092)
 *     بُعد الأصناف مقيد: `LIMIT 200` في SQL نفسه (:1121) — لا `total` يعود،
 *     فالحصر يُستنتج من وصول 200 صفة ويُعلَن، لا يُدارى.
 *     summary: invoice_count, net_sales, subtotal_sales, discount_total,
 *              tax_total, items_qty, unique_items, avg_ticket,
 *              payment_methods (jsonb: طريقة → مبلغ) (:1007-1016)
 *   GET /settings/main_settings — صفّ الإعدادات الوحيد (server.js:1529-1541،
 *     حرسه jwtAuth فقط لأن settings ليست في sensitiveReadEntities :1240،
 *     وpublicEntityRow لا يكتم منه شيئًا :1211-1215). العمود `currency`
 *     معرّف في schema-registry.js:517-528. هذا هو مصدر وحدة المال: القيمة
 *     التي يطبعها النظام نفسه (core/utils.js:25) — لا رمز مخترع هنا.
 *
 * WHY MONEY IS ALLOWED HERE AND NOT ON SCREEN 03
 *   A money figure without its unit is a guess. This door reads the unit from
 *   the same stored row the legacy app prints, so every amount on this screen
 *   carries the restaurant's own currency. When that read fails the screen
 *   says so and shows bare numbers — it never decorates a figure with «ج.م»
 *   or «ر.س» from a literal in this file.
 *
 * THIS FILE NEVER WRITES. No POST/PUT/DELETE here by construction.
 */

import { apiFetch } from '../../core/api.js?v=4.9.145';

/** The server's own grouping enum (shift-routes.js:947) — nothing else is sent. */
export const GROUP_BY = ['department', 'cashier', 'item'];

/** The five periods the legacy report page offers (features/reports.js:42-47),
 *  kept as the same five keys so the two shells never disagree about a name. */
export const PERIODS = ['today', 'week', 'month', 'year', 'custom'];

/** Payment-method names copied from the app's own vocabulary
 *  (features/reports.js:158). An unknown method keeps its stored key. */
export const PAYMENT_METHOD_AR = {
    cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', bank: 'تحويل', credit: 'آجل',
};

/** 200 is written into the item SQL (shift-routes.js:1121) — the only way to
 *  know the server stopped early is to count what came back. */
const ITEM_CAP = 200;

/* ── Dates ─────────────────────────────────────────────────────────────── */

/** Local calendar day, never toISOString(): the legacy page had to fix a
 *  report that shifted the day backwards before 03:00 local in UTC+3
 *  (features/reports.js:77-79). Same rule, same reason. */
export function localDateOnly(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) {return '';}
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Period → the two dates the server demands. `now` is injectable so the
 * week/month/year edges are testable without waiting for a calendar.
 * @returns {{startDate:string, endDate:string, label:string}}
 */
export function periodRange(period, custom = {}, now = new Date()) {
    const today = localDateOnly(now);
    if (period === 'today') {
        return { startDate: today, endDate: today, label: 'اليوم' };
    }
    if (period === 'week') {
        // Sunday-start, exactly the legacy rule (features/reports.js:80).
        const start = new Date(now.getTime());
        start.setDate(now.getDate() - now.getDay());
        return { startDate: localDateOnly(start), endDate: today, label: 'هذا الأسبوع' };
    }
    if (period === 'month') {
        return { startDate: `${today.slice(0, 8)}01`, endDate: today, label: 'هذا الشهر' };
    }
    if (period === 'year') {
        return { startDate: `${today.slice(0, 4)}-01-01`, endDate: today, label: 'هذا العام' };
    }
    const startDate = String(custom.startDate ?? '').trim();
    const endDate = String(custom.endDate ?? '').trim();
    return { startDate, endDate, label: 'فترة مخصصة' };
}

/* ── The one door ──────────────────────────────────────────────────────── */

/**
 * @param {{startDate?:string, endDate?:string, groupBy?:string,
 *          departmentId?:number|string|null, cashierId?:number|string|null}} opts
 * @returns {Promise<{startDate:string,endDate:string,groupBy:string,
 *          filters:{departmentId:*, cashierId:*}, summary:object,
 *          rows:object[], capped:boolean}>}
 */
export async function fetchSalesReport(opts = {}) {
    const startDate = String(opts.startDate ?? '').trim();
    const endDate = String(opts.endDate ?? '').trim();
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        throw new Error('التاريخ مطلوب بصيغة YYYY-MM-DD — من الخادم نفسه (shift-routes.js:126).');
    }
    if (startDate > endDate) {
        throw new Error('بداية الفترة بعد نهايتها — الخادم يرفض هذا (INVALID_DATE_RANGE).');
    }
    const groupBy = String(opts.groupBy ?? 'department').trim();
    if (!GROUP_BY.includes(groupBy)) {
        throw new Error(`بُعد تجميع غير معروف — القيم المتاحة: ${GROUP_BY.join('، ')}.`);
    }

    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, group_by: groupBy });
    // The server 422s on anything but a positive integer (:136-142), so a
    // blank or junk id is dropped here instead of being sent.
    for (const [key, value] of [['department_id', opts.departmentId], ['cashier_id', opts.cashierId]]) {
        const n = Number.parseInt(value, 10);
        if (Number.isInteger(n) && n > 0) {params.set(key, String(n));}
    }

    const res = await apiFetch(`/pos/reports/sales?${params.toString()}`);
    if (!res || typeof res !== 'object') {
        throw new Error('لم يعد من الخادم ما يُقرأ — لا مغلّف التقرير.');
    }
    const rows = Array.isArray(res.rows) ? res.rows : [];

    return {
        startDate: String(res.start_date || startDate),
        endDate: String(res.end_date || endDate),
        groupBy: GROUP_BY.includes(res.group_by) ? res.group_by : groupBy,
        // Echoed by the server (:1136-1139) — for a cashier it is the user's
        // own id whether or not one was asked for.
        filters: {
            departmentId: res.filters ? res.filters.department_id ?? null : null,
            cashierId: res.filters ? res.filters.cashier_id ?? null : null,
        },
        summary: res.summary && typeof res.summary === 'object' ? res.summary : {},
        rows,
        capped: groupBy === 'item' && rows.length >= ITEM_CAP,
    };
}

/** The stored currency the whole app prints (settings row, id main_settings). */
export async function fetchCurrency() {
    const res = await apiFetch('/settings/main_settings');
    const row = Array.isArray(res) ? res[0] : res;
    return row && row.currency !== undefined && row.currency !== null ? String(row.currency).trim() : '';
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

export function formatInt(v) {
    return Math.round(Number(v) || 0).toLocaleString('en-US');
}

/** Quantities arrive rounded to three places by the server (:1012,:1036). */
export function formatQty(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) {return '0';}
    return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * Money: two decimals because every money column is ROUND(...,2) in SQL
 * (:1008-1014). `currency` is the stored settings value — when it is empty
 * the number stays bare, and the screen declares the unit missing.
 */
export function formatMoney(v, currency) {
    const n = Number(v);
    const amount = (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const unit = String(currency ?? '').trim();
    return { amount, unit, hasUnit: !!unit };
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;      // COALESCE(...,0) is the server's own rule (:1008)
};

/* ── Row allowlist ─────────────────────────────────────────────────────── */

/** What each dimension actually returns (shift-routes.js:1042-1055, :1079-1092,
 *  :1108-1121) — the screen reads only these keys. `nameResolved` is the flag
 *  this file derives from an empty stored name, so it is part of the contract. */
export const ROW_FIELDS = {
    department: ['dimensionId', 'dimensionName', 'nameResolved', 'dimensionCode', 'invoiceCount',
        'subtotalSales', 'discountTotal', 'taxTotal', 'netSales', 'avgTicket', 'itemsQty', 'uniqueItems'],
    cashier: ['dimensionId', 'dimensionName', 'nameResolved', 'dimensionCode', 'invoiceCount',
        'subtotalSales', 'discountTotal', 'taxTotal', 'netSales', 'avgTicket', 'itemsQty', 'uniqueItems'],
    item: ['dimensionId', 'dimensionName', 'nameResolved', 'dimensionCode', 'departmentName',
        'invoiceCount', 'quantitySold', 'subtotalSales', 'discountTotal', 'taxTotal', 'netSales'],
};

/**
 * Database row → display row, per the server's own dimension. Pure and
 * exported so it is testable without a browser. Names are kept as stored: an
 * empty `department_name` is an empty name, shown as the id it is.
 */
export function reportToRow(raw = {}, groupBy = 'department') {
    const kind = GROUP_BY.includes(groupBy) ? groupBy : 'department';
    if (kind === 'item') {
        const name = raw.product_name ? String(raw.product_name) : '';
        return {
            dimensionId: raw.product_id ?? null,
            dimensionName: name,
            nameResolved: !!name,
            dimensionCode: raw.product_barcode ? String(raw.product_barcode) : '',
            departmentName: raw.department_name ? String(raw.department_name) : '',
            invoiceCount: num(raw.invoice_count),
            quantitySold: num(raw.quantity_sold),
            subtotalSales: num(raw.subtotal_sales),
            discountTotal: num(raw.discount_total),
            taxTotal: num(raw.tax_total),
            netSales: num(raw.net_sales),
        };
    }
    const id = kind === 'cashier' ? raw.cashier_id : raw.department_id;
    const name = String((kind === 'cashier' ? raw.cashier_name : raw.department_name) ?? '');
    return {
        dimensionId: id ?? null,
        dimensionName: name,
        nameResolved: !!name,
        dimensionCode: String((kind === 'cashier' ? raw.cashier_username : raw.department_code) ?? ''),
        invoiceCount: num(raw.invoice_count),
        subtotalSales: num(raw.subtotal_sales),
        discountTotal: num(raw.discount_total),
        taxTotal: num(raw.tax_total),
        netSales: num(raw.net_sales),
        avgTicket: num(raw.avg_ticket),
        itemsQty: num(raw.items_qty),
        uniqueItems: num(raw.unique_items),
    };
}

/* ── Derived layer ─────────────────────────────────────────────────────── */

/** Share of a base — an empty base gives a stated dash, never "0%" of nothing
 *  (the same rule as stockPill in inventory-repo.js). `currency` only labels
 *  the two absolute amounts in the aria text; the ratio itself is unit-free. */
export function sharePill(part, base, label, currency = '') {
    const unit = String(currency ?? '').trim();
    const tail = unit ? ` ${unit}` : '';
    if (!(base > 0)) {
        return { text: '—', on: false, aria: `لا إجمالي في النتيجة — لا نسبة تُحسب لـ${label}` };
    }
    const pct = (part / base) * 100;
    return {
        text: `${pct.toFixed(1)}%`, on: true,
        aria: `${label}: ${formatMoney(part).amount}${tail} من ${formatMoney(base).amount}${tail} (${pct.toFixed(1)}%)`,
    };
}

/** Payment methods, biggest first, unknown keys kept verbatim (:1015). */
export function paymentBreakdown(methods = {}) {
    const entries = Object.entries(methods || {})
        .map(([method, amount]) => ({ method: String(method), label: PAYMENT_METHOD_AR[String(method)] || String(method), amount: num(amount) }))
        .filter((e) => e.amount !== 0)
        .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'ar'));
    const total = entries.reduce((s, e) => s + e.amount, 0);
    return { rows: entries, total };
}

/**
 * The chips above the report. Every figure is a summary field the server
 * computed with SQL aggregates — nothing here re-derives a total from the
 * visible rows, because the rows are grouped and the item dimension is capped.
 * The chip shape is the one every V2 screen paints (inventory-repo.js).
 * @param {object} summary
 * @param {{currency?:string, scopeLabel?:string, capped?:boolean}} [opts]
 */
export function buildReportKpis(summary = {}, opts = {}) {
    const currency = String(opts.currency ?? '').trim();
    const scope = opts.scopeLabel || 'الفترة';
    const net = num(summary.net_sales);
    const gross = num(summary.subtotal_sales);
    const discount = num(summary.discount_total);
    const tax = num(summary.tax_total);
    const invoices = num(summary.invoice_count);
    const avg = num(summary.avg_ticket);
    const unique = num(summary.unique_items);

    // A money chip carries its unit only when the settings row really has one;
    // `unit: ''` makes the screen say the unit is unknown instead of dressing
    // the number in a currency this file guessed.
    const money = (v) => formatMoney(v, currency);
    const moneyChip = (spec) => {
        const m = money(spec.value);
        return {
            id: spec.id, icon: spec.icon, tone: spec.tone, label: spec.label, en: spec.en,
            value: m.amount, unit: m.unit, kind: 'money', hint: spec.hint, pill: spec.pill,
        };
    };
    const countChip = (spec) => ({
        id: spec.id, icon: spec.icon, tone: spec.tone, label: spec.label, en: spec.en,
        value: spec.value, unit: spec.unit, kind: 'count', hint: spec.hint, pill: spec.pill,
    });

    return [
        moneyChip({
            id: 'net', icon: 'banknote', tone: 'brand', label: 'صافي المبيعات', en: 'Net sales', value: net,
            hint: opts.capped
                ? `${scope} · جدول الأصناف يعرض أول ${formatInt(ITEM_CAP)} صنفًا — حصر في الخادم نفسه`
                : `${scope} · total_amount لفواتير بحالة issued أو reported فقط`,
            pill: { text: formatInt(invoices), on: invoices > 0, label: 'فاتورة',
                aria: invoices > 0 ? `محسوبة على ${formatInt(invoices)} فاتورة` : 'لا فاتورة في الفترة' },
        }),
        moneyChip({
            id: 'subtotal', icon: 'calculator', tone: 'neutral',
            label: 'الإجمالي قبل الضريبة', en: 'Subtotal', value: gross,
            hint: 'subtotal كما في الفاتورة — قبل الضريبة',
            pill: sharePill(gross, net, 'قبل الضريبة', currency),
        }),
        moneyChip({
            id: 'discount', icon: 'tag', tone: discount > 0 ? 'warning' : 'neutral',
            label: 'الخصومات', en: 'Discounts', value: discount,
            hint: 'discount_total مجموع الخصم المخزّن، لا تقدير نسبة',
            pill: sharePill(discount, gross, 'الخصومات', currency),
        }),
        moneyChip({
            id: 'tax', icon: 'percent', tone: 'info', label: 'الضريبة', en: 'VAT', value: tax,
            hint: 'tax_total — والنتيجة صافي يشملها',
            pill: sharePill(tax, gross, 'الضريبة', currency),
        }),
        countChip({
            id: 'invoices', icon: 'receipt', tone: 'neutral',
            label: 'عدد الفواتير', en: 'Invoices', value: formatInt(invoices), unit: 'فاتورة',
            hint: avg > 0
                ? `متوسط الفاتورة ${money(avg).amount}${currency ? ` ${currency}` : ''} — AVG من الخادم`
                : 'لا فاتورة — لا متوسط يُحسب',
            pill: { text: invoices > 0 ? money(avg).amount : '—', on: invoices > 0 && avg > 0,
                label: currency ? `متوسط ${currency}` : 'متوسط',
                aria: avg > 0 ? `متوسط الفاتورة: ${money(avg).amount}${currency ? ` ${currency}` : ''}` : 'لا متوسط' },
        }),
        countChip({
            id: 'quantity', icon: 'package', tone: 'neutral',
            label: 'الكمية المباعة', en: 'Quantity', value: formatQty(summary.items_qty), unit: 'وحدة',
            hint: `أصناف مختلفة: ${formatInt(unique)} — عدّ DISTINCT من الخادم (:1013)`,
            pill: { text: formatInt(unique), on: unique > 0, label: 'صنفًا مختلفًا',
                aria: `${formatInt(unique)} صنفًا مختلفًا ضمن ${formatQty(summary.items_qty)} وحدة` },
        }),
    ];
}
