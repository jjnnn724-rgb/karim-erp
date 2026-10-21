/**
 * V2 — POS doors. Writes use the established cashier routes; the server
 * remains authoritative for stock, VAT, shift ownership, ZATCA and printing.
 */
import { API_BASE, apiFetch } from '../../core/api.js?v=4.9.187';

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ASCII-only device label (browsers reject non-Latin-1 header values). */
export function posDeviceName(departmentId) {
    let device = 'POS terminal';
    try {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        device = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows PC' : device;
    } catch (_) { /* navigator unavailable in some embedded webviews */ }
    const dept = Number(departmentId);
    return `POS (${device}${Number.isInteger(dept) && dept > 0 ? ` dept-${dept}` : ''})`;
}

function deviceHeaders(departmentId) {
    return { 'x-device-name': posDeviceName(departmentId) };
}

/**
 * The existing cashier route syncs departments from the ERP department table
 * before returning them. Keep this call behind the embedded-POS flag; this
 * is the established legacy contract, not a read-only endpoint.
 */
export async function fetchPosDepartments() {
    const rows = await apiFetch('/pos/departments');
    if (!Array.isArray(rows)) {throw new Error('صيغة أقسام الكاشير غير صالحة');}
    return rows;
}

export async function fetchActivePosShift() {
    return apiFetch('/pos/shifts/active');
}

export async function fetchPosProducts(departmentId) {
    const id = Number(departmentId);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('القسم المحدد غير صالح');}
    const query = new URLSearchParams({ department_id: String(id) });
    const rows = await apiFetch(`/pos/products?${query.toString()}`);
    if (!Array.isArray(rows)) {throw new Error('صيغة أصناف الكاشير غير صالحة');}
    return rows;
}

export async function fetchPosHeldOrders(sessionId) {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('رقم الوردية غير صالح');}
    const query = new URLSearchParams({ session_id: String(id) });
    const rows = await apiFetch(`/pos/held-orders?${query.toString()}`);
    if (!Array.isArray(rows)) {throw new Error('صيغة الطلبات المعلقة غير صالحة');}
    return rows;
}

export async function holdPosOrder({ sessionId, departmentId, items, cartDiscount = null }) {
    const shift = Number(sessionId);
    const department = Number(departmentId);
    if (!Number.isInteger(shift) || shift <= 0 || !Number.isInteger(department) || department <= 0) {
        throw new Error('القسم أو الوردية غير صالح');
    }
    if (!Array.isArray(items) || !items.length) {throw new Error('أضف صنفًا قبل تعليق الطلب');}
    if (cartDiscount && !(
        (cartDiscount.type === 'percent' && Number.isFinite(Number(cartDiscount.value)) && Number(cartDiscount.value) >= 0 && Number(cartDiscount.value) <= 100)
        || (cartDiscount.type === 'fixed' && Number.isFinite(Number(cartDiscount.value)) && Number(cartDiscount.value) >= 0)
    )) {throw new Error('قيمة خصم الطلب غير صالحة');}
    return apiFetch('/pos/held-orders', {
        method: 'POST',
        headers: deviceHeaders(department),
        body: JSON.stringify({ session_id: shift, department_id: department, items, cart_discount: cartDiscount }),
    });
}

export async function recallPosHeldOrder(orderId, sessionId) {
    const id = String(orderId || '').trim();
    const shift = Number(sessionId);
    if (!id || !Number.isInteger(shift) || shift <= 0) {throw new Error('الطلب أو الوردية غير صالح');}
    return apiFetch(`/pos/held-orders/${encodeURIComponent(id)}/recall`, {
        method: 'POST',
        headers: deviceHeaders(),
        body: JSON.stringify({ session_id: shift }),
    });
}

export async function deletePosHeldOrder(orderId, sessionId) {
    const id = String(orderId || '').trim();
    const shift = Number(sessionId);
    if (!id || !Number.isInteger(shift) || shift <= 0) {throw new Error('الطلب أو الوردية غير صالح');}
    const query = new URLSearchParams({ session_id: String(shift) });
    return apiFetch(`/pos/held-orders/${encodeURIComponent(id)}?${query.toString()}`, {
        method: 'DELETE',
        headers: deviceHeaders(),
    });
}

export async function openPosShift({ departmentId, openingBalance }) {
    if (!Number.isInteger(Number(departmentId)) || Number(departmentId) <= 0) {
        throw new Error('اختر قسمًا صالحًا لفتح الوردية');
    }
    const opening = Number(openingBalance);
    if (!Number.isFinite(opening) || opening < 0) {throw new Error('العهدة الافتتاحية غير صالحة');}
    return apiFetch('/pos/shifts/open', {
        method: 'POST',
        headers: deviceHeaders(Number(departmentId)),
        body: JSON.stringify({ department_id: Number(departmentId), opening_balance: opening }),
    });
}

export async function fetchPosShiftSummary(sessionId) {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('رقم الوردية غير صالح');}
    return apiFetch(`/pos/shifts/${id}/summary`);
}

export async function fetchPosOrders({ page = 1, limit = 20, dateFrom = '', dateTo = '', status = '', search = '' } = {}) {
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {throw new Error('رقم صفحة سجل الفواتير غير صالح');}
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {throw new Error('حجم صفحة سجل الفواتير غير صالح');}
    if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {throw new Error('تاريخ بداية غير صالح');}
    if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {throw new Error('تاريخ نهاية غير صالح');}
    if (dateFrom && dateTo && dateFrom > dateTo) {throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');}
    if (status && !['issued', 'reported', 'cancelled'].includes(status)) {throw new Error('حالة الفاتورة غير صالحة');}

    const query = new URLSearchParams({
        page: String(pageNumber),
        limit: String(pageSize),
        sort: 'created_at',
        order: 'DESC',
    });
    if (dateFrom) {query.set('date_from', dateFrom);}
    if (dateTo) {query.set('date_to', dateTo);}
    if (status) {query.set('status', status);}
    const term = String(search || '').trim().slice(0, 100);
    if (term) {query.set('search', term);}

    const result = await apiFetch(`/pos/orders?${query.toString()}`);
    if (!result || !Array.isArray(result.data) || !result.pagination || typeof result.pagination !== 'object') {
        throw new Error('صيغة سجل فواتير الكاشير غير صالحة');
    }
    return result;
}

export async function fetchPosOrderDetails(orderId) {
    const id = String(orderId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    const order = await apiFetch(`/pos/orders/${encodeURIComponent(id)}`);
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
        throw new Error('صيغة تفاصيل الفاتورة غير صالحة');
    }
    return order;
}

export async function reprintPosOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    return apiFetch(`/pos/orders/${encodeURIComponent(id)}/reprint`, {
        method: 'POST',
        headers: deviceHeaders(),
    });
}

export async function voidPosOrder(orderId, reason) {
    const id = String(orderId || '').trim();
    const note = String(reason || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    if (!note || note.length > 500) {throw new Error('سبب الإلغاء مطلوب (حتى 500 حرف)');}
    return apiFetch(`/pos/orders/${encodeURIComponent(id)}/void`, {
        method: 'POST',
        headers: deviceHeaders(),
        body: JSON.stringify({ reason: note }),
    });
}

export async function closePosShift({ sessionId, actualCash, notes }) {
    const id = Number(sessionId);
    const cash = Number(actualCash);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('رقم الوردية غير صالح');}
    if (!Number.isFinite(cash) || cash < 0) {throw new Error('النقد الفعلي غير صالح');}
    return apiFetch(`/pos/shifts/${id}/close`, {
        method: 'POST',
        headers: deviceHeaders(),
        body: JSON.stringify({ actual_cash: cash, notes: String(notes || '').trim() || null }),
    });
}

export async function fetchPosKotPage(orderId) {
    const id = String(orderId || '').trim();
    if (!ORDER_ID.test(id)) {throw new Error('معرّف الفاتورة غير صالح');}
    const headers = {};
    if (window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (window._appKey) {headers['x-api-key'] = window._appKey;}
    const res = await fetch(`${API_BASE}/pos/kot/orders/${encodeURIComponent(id)}/html`, { headers });
    if (!res.ok) {
        if (res.status === 401) {throw new Error('انتهت الجلسة — سجّل الدخول مجددًا');}
        let message = '';
        try {const data = await res.json(); message = data?.message || data?.error || '';} catch (_) { /* non-JSON error body */ }
        throw new Error(message || `تعذّر تحميل تذاكر المطبخ (${res.status})`);
    }
    const html = await res.text();
    if (!html.trim()) {throw new Error('صفحة تذاكر المطبخ فارغة');}
    return html;
}

export async function exportPosOrders({
    dateFrom = '', dateTo = '', departmentId = '', cashierId = '', sessionId = '', status = '', search = '',
} = {}) {
    if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {throw new Error('تاريخ بداية غير صالح');}
    if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {throw new Error('تاريخ نهاية غير صالح');}
    if (dateFrom && dateTo && dateFrom > dateTo) {throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');}
    if (status && !['issued', 'reported', 'cancelled'].includes(status)) {throw new Error('حالة الفاتورة غير صالحة');}

    const query = new URLSearchParams();
    if (dateFrom) {query.set('date_from', dateFrom);}
    if (dateTo) {query.set('date_to', dateTo);}
    if (status) {query.set('status', status);}
    for (const [key, value, label] of [['department_id', departmentId, 'القسم'], ['cashier_id', cashierId, 'الكاشير'], ['session_id', sessionId, 'الوردية']]) {
        if (value === '' || value === null || value === undefined) {continue;}
        const id = Number(value);
        if (!Number.isInteger(id) || id <= 0) {throw new Error(`${label} غير صالح`);}
        query.set(key, String(id));
    }
    const term = String(search || '').trim().slice(0, 100);
    if (term) {query.set('search', term);}

    const result = await apiFetch(`/pos/orders/export?${query.toString()}`);
    if (!result || !Array.isArray(result.data)) {throw new Error('صيغة تصدير فواتير الكاشير غير صالحة');}
    return result;
}

export async function completePosSale({ departmentId, sessionId, items, payments, idempotencyKey }) {
    const dept = Number(departmentId);
    const shift = Number(sessionId);
    if (!Number.isInteger(dept) || dept <= 0 || !Number.isInteger(shift) || shift <= 0) {
        throw new Error('القسم أو الوردية غير صالح');
    }
    if (!Array.isArray(items) || !items.length) {throw new Error('أضف صنفًا واحدًا على الأقل');}
    if (!Array.isArray(payments)) {throw new Error('طرق الدفع غير صالحة');}
    const key = String(idempotencyKey || '').trim();
    if (!key) {throw new Error('مفتاح منع تكرار الفاتورة مفقود');}
    return apiFetch('/sales/complete', {
        method: 'POST',
        headers: {
            ...deviceHeaders(dept),
            'Idempotency-Key': key,
            'X-Shift-Session-Id': String(shift),
        },
        body: JSON.stringify({
            department_id: dept,
            items,
            payments,
            printer_id: `pos-${dept}`,
        }),
    });
}
