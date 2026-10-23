/**
 * V2 — open-buffet doors. The buffet sells people (covers), not menu items:
 * the server keeps adult/child/hospitality tiers as products with
 * metadata.catalog_scope = 'buffet_only', and the cart sells those products.
 * Reads and writes match backend/cashier-module/buffet-routes.js; the server
 * remains authoritative for prices, roles and reporting.
 */
import { apiFetch } from '../../core/api.js?v=4.9.197';

export const BUFFET_ADMIN_ROLES = ['admin', 'manager', 'accountant'];
const BUFFET_CODES = ['erp_open_buffet', 'open_buffet'];
const CURRENCY_UNIT = 'فرد';

export function isBuffetDepartment(department) {
    if (!department || typeof department !== 'object') {return false;}
    const code = String(department.code || department.dept_code || '').trim().toLowerCase();
    if (BUFFET_CODES.includes(code)) {return true;}
    const name = `${department.name_ar || department.dept_name || ''} ${department.name_en || ''}`.toLowerCase();
    return name.includes('بوفيه') || name.includes('buffet');
}

export function buffetTierProducts(tiers) {
    return (Array.isArray(tiers) ? tiers : [])
        .filter((tier) => tier && tier.is_active !== false)
        .map((tier) => ({
            id: Number(tier.id),
            name_ar: String(tier.name_ar || '').trim(),
            name_en: '',
            price: Number(tier.price) || 0,
            vat_rate: Number.isFinite(Number(tier.vat_rate)) ? Number(tier.vat_rate) : 15,
            unit: String(tier.unit || CURRENCY_UNIT),
            category: 'بوفيه',
            barcode: '',
            stock_quantity: null,
            is_active: true,
            is_buffet: true,
            is_core: Boolean(tier.is_core),
            tier: String(tier.tier || ''),
        }))
        .filter((tier) => Number.isInteger(tier.id) && tier.id > 0 && tier.name_ar);
}

function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function sessionIdOf(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function tierIdOf(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('معرّف فئة البوفيه غير صالح');}
    return id;
}

export async function fetchBuffetConfig() {
    const config = await apiFetch('/pos/buffet/config');
    if (!config || typeof config !== 'object' || !Array.isArray(config.tiers)) {
        throw new Error('صيغة إعدادات البوفيه غير صالحة');
    }
    return config;
}

export async function saveBuffetPrices(prices) {
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
        throw new Error('أسعار البوفيه غير صالحة');
    }
    const entries = Object.entries(prices);
    if (!entries.length) {throw new Error('لا توجد أسعار لحفظها');}
    for (const [key, value] of entries) {
        const price = Number(value);
        if (!String(key).trim() || !Number.isFinite(price) || price < 0) {
            throw new Error(`السعر "${key}" يجب أن يكون رقمًا موجبًا أو صفرًا`);
        }
    }
    const result = await apiFetch('/pos/buffet/config/prices', {
        method: 'PUT',
        body: JSON.stringify({ prices }),
    });
    if (!result || !Array.isArray(result.tiers)) {throw new Error('لم يرجع الخادم قائمة الأسعار بعد الحفظ');}
    return result;
}

export async function addBuffetTier({ nameAr, price = 0, vatRate = 15 } = {}) {
    const name = String(nameAr || '').trim();
    const amount = Number(price);
    const vat = Number(vatRate);
    if (!name || name.length > 100) {throw new Error('اسم الفئة مطلوب (حتى 100 حرف)');}
    if (!Number.isFinite(amount) || amount < 0) {throw new Error('السعر يجب أن يكون رقمًا موجبًا أو صفرًا');}
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) {throw new Error('نسبة الضريبة بين 0 و 100');}
    const result = await apiFetch('/pos/buffet/config/tiers', {
        method: 'POST',
        body: JSON.stringify({ name_ar: name, price: amount, vat_rate: vat }),
    });
    if (!result || !Array.isArray(result.tiers)) {throw new Error('لم يرجع الخادم قائمة الفئات بعد الإضافة');}
    return result;
}

export async function renameBuffetTier(tierId, nameAr) {
    const id = tierIdOf(tierId);
    const name = String(nameAr || '').trim();
    if (!name || name.length > 100) {throw new Error('اسم الفئة مطلوب (حتى 100 حرف)');}
    const result = await apiFetch(`/pos/buffet/config/tiers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name_ar: name }),
    });
    if (!result || !Array.isArray(result.tiers)) {throw new Error('لم يرجع الخادم قائمة الفئات بعد التعديل');}
    return result;
}

export async function setBuffetTierActive(tierId, active) {
    const id = tierIdOf(tierId);
    const result = await apiFetch(`/pos/buffet/config/tiers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: active === true }),
    });
    if (!result || !Array.isArray(result.tiers)) {throw new Error('لم يرجع الخادم قائمة الفئات بعد التحديث');}
    return result;
}

export async function disableBuffetTier(tierId) {
    const id = tierIdOf(tierId);
    const result = await apiFetch(`/pos/buffet/config/tiers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!result || !Array.isArray(result.tiers)) {throw new Error('لم يرجع الخادم قائمة الفئات بعد التعطيل');}
    return result;
}

export async function fetchBuffetLive({ date = '', sessionId = null } = {}) {
    const query = new URLSearchParams();
    if (date) {
        if (!validDate(date)) {throw new Error('تاريخ البوفيه غير صالح');}
        query.set('date', date);
    }
    if (sessionId !== null && sessionId !== undefined && sessionId !== '') {
        const id = sessionIdOf(sessionId);
        if (!id) {throw new Error('رقم وردية البوفيه غير صالح');}
        query.set('session_id', String(id));
    }
    const suffix = query.toString();
    const live = await apiFetch(`/pos/buffet/live${suffix ? `?${suffix}` : ''}`);
    if (!live || typeof live !== 'object' || !live.daily) {
        throw new Error('صيغة العداد الحي للبوفيه غير صالحة');
    }
    return live;
}

export async function fetchBuffetInvoices({ date = '', sessionId = null, status = '', limit = 100 } = {}) {
    const query = new URLSearchParams();
    if (date) {
        if (!validDate(date)) {throw new Error('تاريخ فواتير البوفيه غير صالح');}
        query.set('date', date);
    }
    if (sessionId !== null && sessionId !== undefined && sessionId !== '') {
        const id = sessionIdOf(sessionId);
        if (!id) {throw new Error('رقم وردية البوفيه غير صالح');}
        query.set('session_id', String(id));
    }
    if (status) {
        if (!['issued', 'reported', 'cancelled'].includes(status)) {throw new Error('حالة فاتورة البوفيه غير صالحة');}
        query.set('status', status);
    }
    const size = Number(limit);
    if (!Number.isInteger(size) || size < 1 || size > 200) {throw new Error('حد فواتير البوفيه غير صالح');}
    query.set('limit', String(size));
    const result = await apiFetch(`/pos/buffet/invoices?${query.toString()}`);
    if (!result || !Array.isArray(result.data)) {throw new Error('صيغة فواتير البوفيه غير صالحة');}
    return result;
}

export async function fetchBuffetReport(date) {
    if (!validDate(date)) {throw new Error('تاريخ تقرير البوفيه غير صالح');}
    const report = await apiFetch(`/pos/buffet/report?date=${encodeURIComponent(date)}`);
    if (!report || typeof report !== 'object' || !report.totals || !Array.isArray(report.tiers)) {
        throw new Error('صيغة تقرير البوفيه غير صالحة');
    }
    return report;
}
