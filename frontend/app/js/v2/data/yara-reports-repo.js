/**
 * V2 — Yara reports repository (الباب الوحيد إلى /api/yara-reports/*)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER (backend/yarasoft/yara-reports.js), NOT INVENTED
 *
 * Doors (all GET, read-only — this file never writes):
 *   item-sales          ?from&to&group=item|cashier|day&cashier&item (:518)
 *   orders              ?from&to&cashier&limit&offset (:594)
 *   received-items      ?from&to&dept&item&group=item|dept|day&limit&offset (:688)
 *   received-dispatches ?from&to&dept&limit&offset (:754)
 *   item-outflow        ?from&to&item (:837) — ملخص + رصيد + متوسط + اتجاه + تنبيهات
 *   item-suggest        ?q= (:956) — اقتراحات أسماء فورية (لا نافذة زمنية)
 *   wh-vs-pos           ?from&to[:live=1] (:986) — مطابقة المخزن مع الكاشيرية
 *
 * Shared rules (every dated door):
 *   - التواريخ YYYY-MM-DD وإلا يسقط الخادم على آخر 30 يومًا (:520-522)
 *   - المدى المعكوس → 422 INVALID_RANGE (:523) — بوابة محلية هنا قبل أي طلب
 *   - سقف المدى 93 يومًا → 422 RANGE_TOO_WIDE «الحد الأقصى 93 يومًا» (:525)
 *
 * Role gate mirror (كل الأبواب): requireRole('sous_chef','admin','owner').
 */

import { apiFetch } from '../../core/api.js?v=4.9.151';

/** بوابة القراءة مرآة حرفية لسطور الخادم الستة (:518/:594/:688/:754/:837/:956/:986). */
export const YARA_READ_ROLES = ['sous_chef', 'admin', 'owner'];

/** سقف المدى الموحد — الخادم يرفض بعده (:525). */
export const YARA_MAX_SPAN_DAYS = 93;

/** فرق أيام شامل الطرفين — نفس حساب الخادم (:524). */
export function spanDays(from, to) {
    const a = new Date(`${from}T12:00:00Z`);
    const b = new Date(`${to}T12:00:00Z`);
    const ms = Number(b) - Number(a);
    if (!Number.isFinite(ms)) {return NaN;}
    return Math.round(ms / 86400000) + 1;
}

/**
 * بوابة المدى — نفس قاعدة شاشة 04/07/08: المدى المعكوس أو الأوسع من السقف
 * يُرفض محليًا قبل أي طلب. الأخطاء تسمّي سببها كما يفعل الخادم.
 * @returns {{ ok: boolean, message: string }}
 */
export function rangeError(from, to) {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dayRe.test(String(from || '')) || !dayRe.test(String(to || ''))) {
        return { ok: false, message: 'التاريخان مطلوبان بصيغة YYYY-MM-DD' };
    }
    if (String(from) > String(to)) {
        return { ok: false, message: 'المدى معكوس — «من» بعد «إلى»' };
    }
    const span = spanDays(from, to);
    if (span > YARA_MAX_SPAN_DAYS) {
        return { ok: false, message: `الحد الأقصى 93 يومًا — طُلب ${span} يومًا` };
    }
    return { ok: true, message: '' };
}

function qs(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v) !== '') {p.set(k, String(v));}
    }
    const s = p.toString();
    return s ? `?${s}` : '';
}

/** GET /item-sales — تحليل مبيعات الأصناف مجمّعاً. */
export async function fetchItemSales({ from, to, group = 'item', cashier = '', item = '' } = {}) {
    return apiFetch(`/yara-reports/item-sales${qs({ from, to, group, cashier, item })}`);
}

/** GET /orders — أوردرات مفصّلة بترقيم صفحات. */
export async function fetchYaraOrders({ from, to, cashier = '', limit = 50, offset = 0 } = {}) {
    return apiFetch(`/yara-reports/orders${qs({ from, to, cashier, limit, offset })}`);
}

/** GET /received-items — ما استلمته الأقسام من أذون الصرف. */
export async function fetchReceivedItems({ from, to, dept = '', item = '', group = 'item', limit = 200, offset = 0 } = {}) {
    return apiFetch(`/yara-reports/received-items${qs({ from, to, dept, item, group, limit, offset })}`);
}

/** GET /received-dispatches — قائمة أذون الصرف المستلمة. */
export async function fetchReceivedDispatches({ from, to, dept = '', limit = 50, offset = 0 } = {}) {
    return apiFetch(`/yara-reports/received-dispatches${qs({ from, to, dept, limit, offset })}`);
}

/** GET /item-outflow — تحليل الاستهلاك الذكي لصنف (أو الكل). */
export async function fetchItemOutflow({ from, to, item = '' } = {}) {
    return apiFetch(`/yara-reports/item-outflow${qs({ from, to, item })}`);
}

/** GET /item-suggest — اقتراحات فورية أثناء الكتابة (≥2 حرف عند الخادم :959). */
export async function fetchItemSuggestions(q) {
    const term = String(q || '').trim().slice(0, 40);
    if (term.length < 2) {return [];}
    const res = await apiFetch(`/yara-reports/item-suggest${qs({ q: term })}`);
    const list = res && Array.isArray(res.suggestions) ? res.suggestions : [];
    return list.map((s) => (s && typeof s === 'object' ? String(s.name || '') : String(s))).filter(Boolean);
}

/** GET /wh-vs-pos — مطابقة ما صرفه المخزن مع ما بيعت به الكاشيرية. */
export async function fetchWhVsPos({ from, to } = {}) {
    return apiFetch(`/yara-reports/wh-vs-pos${qs({ from, to })}`);
}

/* ── Pure transforms — قابلة للاختبار بلا متصفح ── */

/** صف تحليل مجمّع: التسمية حسب التجميع كما يبنيها القديم (sales-analyzer.js). */
export function analysisLabel(row = {}, group = 'item') {
    if (group === 'cashier') {return String(row.cashier_name || row.cashier_no || '—');}
    if (group === 'dept') {return String(row.dept_name || row.deptName || '—');}
    if (group === 'day') {return String(row.doc_date || row.day || row.date || '—');}
    return String(row.item_name || row.name || '—');
}

/** إجماليات التحليل بصففر آمن — لا NaN يدخل الواجهة. */
export function safeTotals(t = {}) {
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    return { invoices: n(t.invoices), qty: n(t.qty), net: n(t.net), vat: n(t.vat) };
}

/** قيم التجميع المشروعة — الخادم يقبل الثلاثة فقط. */
export const SA_GROUPS = ['item', 'cashier', 'day'];
export const RECEIVED_GROUPS = ['item', 'dept', 'day'];
