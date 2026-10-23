/**
 * V2 — المقارنة الشهرية · باب البيانات الوحيد لشاشة «مقارنة الشهور»
 * ═══════════════════════════════════════════════════════════════════════
 *   GET /finance/monthly-comparison?months=12
 *   GET /finance/monthly-comparison?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     (الفترة المخصصة تُقرأ أيامها وحدها؛ تُقبل حتى اليوم وفي حدود 24 شهرًا)
 *   الاختيار المشترك في العنوانين: &cashiers=1,2,3 — غيابه = كل كاشيرٍ
 *   ظهرت له فواتير معتمدة في الفترة (ومنهم 2 وأي رقمٍ جديد على الشبكة).
 *     → { period{from,to,months,mode,today},
 *         sources{revenue,ledger,oracle}, oracle_available,
 *         cashier_scope[{no,name,linked,selected}],
 *         cashier_revenue{rows[{no,name,linked,net,gross,discount,
 *                          invoices,share_pct}], selected, all_selected,
 *                          totals{net,invoices}},
 *         months[{ month, from, to, partial, in_progress, no_data,
 *                  revenue, revenue_pos, revenue_manual, invoice_count,
 *                  revenue_gross, revenue_discount,
 *                  cost, cost_dispatch, cost_returns,
 *                  shrinkage, operating, payroll, expenses,
 *                  gross_profit, net_profit, margin_pct, gross_margin_pct,
 *                  ledger_rows, ledger_covered,
 *                  oracle_cost, oracle_docs, oracle_covered,
 *                  cost_gap, cost_gap_pct }],
 *         totals{…}, dispatch_year{…}, generated_at, generated_by }
 *     (backend/finance-routes.js — نفس بوابة /finance/pnl وأرقامه ونفس
 *      محرّك قائمة الدخل: admin|manager|accountant)
 *   GET /finance/monthly-comparison/print → مستند A4 (يُعرض في عارض V2 عبر
 *     iframe.src، فقفزة المتصفح إليه لا تحمل رؤوسًا ولا تُستعمل هنا).
 *   GET /finance/monthly-comparison/month?month=YYYY-MM[&from&to&cashiers]
 *     → ملف الشهر: نفس statement قائمة الدخل، وإيراد التحصيل المعتمد،
 *       وتكوين الكوست والمصروفات، والفئات، والحركة اليومية، وسطور المصروفات
 *       مع سقفٍ معلن، وكشف إيراد الكاشيرات المشمولة.
 *   GET /finance/monthly-comparison/month/print?month=YYYY-MM[&from&to&cashiers]
 *     → قائمة الشهر A4.
 *
 * كل الحساب في الخادم: هذا الملف يقرأ ويعرض ولا يجمع ولا يقسم ولا يحسب
 * هامشًا. وهو الباب الوحيد للشبكة — الشاشة لا تعرف العنوان ولا الرؤوس.
 */

import { apiFetch } from '../../core/api.js?v=4.9.197';

export const MONTHS_DEFAULT = 12;
export const MONTHS_MIN = 1;
export const MONTHS_MAX = 24;
/** نوافذ الاختيار المعروضة في الشاشة (آخر ٦ / ١٢ / ٢٤ شهرًا). */
export const MONTHS_CHOICES = [6, 12, 24];

export function clampMonths(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n)) {return MONTHS_DEFAULT;}
    return Math.max(MONTHS_MIN, Math.min(n, MONTHS_MAX));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** يومٌ فعليٌّ فقط — 2026-02-31 يمرّ من الشكل ويسقط من التقويم. */
export function normalizeDayKey(value) {
    const day = String(value || '').trim();
    if (!DAY_RE.test(day)) {return '';}
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : '';
}

/** أرقام الكاشيرات المختارة: صحيحة، بلا تكرار، مرتّبة رقميًا. */
export function normalizeCashiers(value) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
    const seen = new Set();
    for (const item of raw) {
        const no = String(item ?? '').trim();
        if (/^\d{1,8}$/.test(no)) {seen.add(no);}
    }
    return [...seen].sort((a, b) => Number(a) - Number(b));
}

/**
 * فلاتر المقارنة: إمّا نافذة متجددة (months) أو فترة مخصصة (from/to).
 * الفترة المخصصة لا تُرسل ناقصة — من تاريخين صحيحين فقط، وإلا وقعنا على
 * النافذة المتجددة كي لا يطلب الخادم نافذةً نصفها غائب.
 */
export function monthlyComparisonQuery(filters) {
    const params = new URLSearchParams();
    if (filters != null && typeof filters === 'object') {
        const from = normalizeDayKey(filters.from);
        const to = normalizeDayKey(filters.to);
        if (from && to) {
            params.set('from', from);
            params.set('to', to);
        } else if (filters.months) {
            params.set('months', String(clampMonths(filters.months)));
        }
        const cashiers = normalizeCashiers(filters.cashiers);
        if (cashiers.length) {params.set('cashiers', cashiers.join(','));}
    } else if (filters != null) {
        params.set('months', String(clampMonths(filters)));
    }
    return params.toString();
}

/** فلاتر ملف الشهر داخل حدود الشهر: نافذة اختيارية وكاشيرات اختيارية. */
function monthlyDetailQuery(filters) {
    const params = new URLSearchParams();
    if (filters != null && typeof filters === 'object') {
        const from = normalizeDayKey(filters.from);
        const to = normalizeDayKey(filters.to);
        if (from && to) {
            params.set('from', from);
            params.set('to', to);
        }
        const cashiers = normalizeCashiers(filters.cashiers);
        if (cashiers.length) {params.set('cashiers', cashiers.join(','));}
    }
    return params.toString();
}

/** صفوف المقارنة الشهرية — الأرقام كلها من الخادم. */
export async function fetchMonthlyComparison(filters) {
    const query = monthlyComparisonQuery(filters);
    return apiFetch(`/finance/monthly-comparison${query ? `?${query}` : ''}`);
}

/** رابط المستند المطبوع بنفس الفلاتر — يُمرَّر إلى عارض V2 لا إلى نافذة خارجية. */
export function monthlyComparisonPrintUrl(filters) {
    const query = monthlyComparisonQuery(filters);
    return `/api/finance/monthly-comparison/print${query ? `?${query}` : ''}`;
}

/** مفتاح شهر صالح فقط — لا يُرسَل ما لا يطابق YYYY-MM. */
export function normalizeMonthKey(value) {
    const key = String(value || '').trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : '';
}

/** ملف شهر واحد — الإيرادات والمصروفات وسطورها كما سُجّلت. */
export async function fetchMonthlyDetail(month, filters) {
    const key = normalizeMonthKey(month);
    if (!key) {throw new Error('صيغة الشهر غير صالحة — استخدم YYYY-MM');}
    const query = monthlyDetailQuery(filters);
    return apiFetch(`/finance/monthly-comparison/month?month=${encodeURIComponent(key)}${query ? `&${query}` : ''}`);
}

/** مستند قائمة الشهر A4 — يُفتح في عارض V2. */
export function monthlyDetailPrintUrl(month, filters) {
    const key = normalizeMonthKey(month);
    const query = monthlyDetailQuery(filters);
    return `/api/finance/monthly-comparison/month/print?month=${encodeURIComponent(key)}${query ? `&${query}` : ''}`;
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** «2026-09» → «سبتمبر 2026». أرقامٌ لاتينية ثابتة، لا تعتمد لغة المتصفح. */
export function monthLabel(key) {
    const raw = String(key || '');
    const year = raw.slice(0, 4);
    const month = Number.parseInt(raw.slice(5, 7), 10);
    const name = AR_MONTHS[month - 1];
    return name && year ? `${name} ${year}` : (raw || '—');
}