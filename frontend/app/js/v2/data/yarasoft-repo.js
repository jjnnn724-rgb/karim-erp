import { apiFetch } from '../../core/api.js?v=4.9.180';
import { fetchInventory } from './inventory-repo.js?v=4.9.180';

export const YARASOFT_WRITE_ROLES = Object.freeze(['admin', 'manager']);

export function fetchYarasoftStatus() {
    return apiFetch('/yarasoft/status');
}

export function fetchYarasoftOracleStatus() {
    return apiFetch('/yarasoft/oracle/status');
}

export function testYarasoftOracle() {
    return apiFetch('/yarasoft/oracle/test', { method: 'POST' });
}

export function pollYarasoftOracleNow() {
    return apiFetch('/yarasoft/oracle/poll-now', { method: 'POST' });
}

export function previewYarasoftOracleItems() {
    return apiFetch('/yarasoft/oracle/import-items/preview');
}

export function importYarasoftOracleItems() {
    return apiFetch('/yarasoft/oracle/import-items', { method: 'POST' });
}

export function fetchYarasoftOracleReconcile(days = 14) {
    const safeDays = Math.max(1, Math.min(90, Math.floor(Number(days) || 14)));
    return apiFetch(`/yarasoft/oracle/reconcile?days=${safeDays}`);
}

export function fetchYarasoftOracleCatchUpStatus() {
    return apiFetch('/yarasoft/oracle/catch-up/status');
}

export function startYarasoftOracleCatchUp(days = 14) {
    const safeDays = Math.max(1, Math.min(90, Math.floor(Number(days) || 14)));
    return apiFetch('/yarasoft/oracle/catch-up', {
        method: 'POST',
        body: JSON.stringify({ days: safeDays }),
    });
}

export function previewYarasoftInvoiceText(text) {
    const source = String(text || '');
    if (!source.trim()) {throw new Error('ألصق محتوى ملف فاتورة للمعاينة أولاً.');}
    const body = JSON.stringify({ text: source });
    if (new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024) {
        throw new Error('حجم محتوى المعاينة يتجاوز الحد الأقصى للخادم (2 ميغابايت).');
    }
    return apiFetch('/yarasoft/dry-run-preview', { method: 'POST', body });
}

function mirrorDateQuery(date) {
    return date ? `?date=${encodeURIComponent(String(date))}` : '';
}

export function fetchYarasoftMirrorCashiers(date = '') {
    return apiFetch(`/yarasoft/mirror/cashiers${mirrorDateQuery(date)}`);
}

export function fetchYarasoftMirrorOrders({ date = '', cashier = '', limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (date) {params.set('date', String(date));}
    if (cashier) {params.set('cashier', String(cashier));}
    params.set('limit', String(Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))));
    params.set('offset', String(Math.max(0, Math.floor(Number(offset) || 0))));
    return apiFetch(`/yarasoft/mirror/orders?${params.toString()}`);
}

export function fetchYarasoftMirrorOrder(docNo) {
    return apiFetch(`/yarasoft/mirror/orders/${encodeURIComponent(String(docNo || '').trim())}`);
}

export function fetchYarasoftMirrorClose({ date = '', cashier } = {}) {
    const params = new URLSearchParams({ cashier: String(cashier || '') });
    if (date) {params.set('date', String(date));}
    return apiFetch(`/yarasoft/mirror/close?${params.toString()}`);
}

export function refreshYarasoftMirror() {
    return apiFetch('/yarasoft/mirror/refresh', { method: 'POST', body: JSON.stringify({}) });
}

export function fetchYarasoftLog(limit = 150) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 150)));
    return apiFetch(`/yarasoft/log?limit=${safeLimit}`);
}

export function runYarasoftNow() {
    return apiFetch('/yarasoft/run-now', { method: 'POST' });
}

export function reprocessYarasoftInvoice(id) {
    return apiFetch(`/yarasoft/reprocess/${encodeURIComponent(String(id || '').trim())}`, { method: 'POST' });
}

export function fetchYarasoftInvoiceDetail(id) {
    return apiFetch(`/yarasoft/log/${encodeURIComponent(String(id || '').trim())}/detail`);
}

export function fetchYarasoftReview(open = true) {
    return apiFetch(`/yarasoft/review?open=${open ? '1' : '0'}`);
}

export function resolveYarasoftReview(id, internalProductId) {
    return apiFetch(`/yarasoft/review/${encodeURIComponent(String(id || '').trim())}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ internalProductId: Number(internalProductId) }),
    });
}

export function searchYarasoftProducts(query) {
    return fetchInventory({ q: String(query || '').trim().slice(0, 100), maxPages: 2 });
}

export function fetchYarasoftMappings() {
    return apiFetch('/yarasoft/mappings');
}

export function saveYarasoftMapping({ externalCode = '', externalBarcode = '', internalProductId } = {}) {
    return apiFetch('/yarasoft/mappings', {
        method: 'POST',
        body: JSON.stringify({
            externalCode: String(externalCode).trim(),
            externalBarcode: String(externalBarcode).trim(),
            internalProductId: Number(internalProductId),
        }),
    });
}

export function deactivateYarasoftMapping(id) {
    return apiFetch(`/yarasoft/mappings/${encodeURIComponent(String(id || '').trim())}`, { method: 'DELETE' });
}

export function fetchYarasoftSectionMap() {
    return apiFetch('/yarasoft/sections/map');
}

export function fetchYarasoftSectionInvoices(mapId, { page = 1, limit = 20, dateFrom = '', dateTo = '', query = '' } = {}) {
    const params = new URLSearchParams({
        map_id: String(mapId),
        page: String(Math.max(1, Math.floor(Number(page) || 1))),
        limit: String(Math.max(5, Math.min(100, Math.floor(Number(limit) || 20)))),
    });
    if (dateFrom) {params.set('date_from', String(dateFrom));}
    if (dateTo) {params.set('date_to', String(dateTo));}
    if (query) {params.set('q', String(query).trim().slice(0, 60));}
    return apiFetch(`/yarasoft/sections/invoices?${params.toString()}`);
}

export function fetchYarasoftSectionInvoiceDetail(ref) {
    return apiFetch(`/yarasoft/sections/invoice-detail?ref=${encodeURIComponent(String(ref || '').trim())}`);
}

export function reclassifyYarasoftRevenue(ids, toMapId) {
    const revenueIds = [...new Set((Array.isArray(ids) ? ids : [])
        .map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
    return apiFetch('/yarasoft/sections/reclassify', {
        method: 'POST',
        body: JSON.stringify({ revenue_ids: revenueIds, to_map_id: Number(toMapId) }),
    });
}

export function fetchYarasoftUnmappedSections() {
    return apiFetch('/yarasoft/sections/unmapped');
}

export function renameYarasoftSection(id, { displayAr = '', displayEn = '' } = {}) {
    return apiFetch(`/yarasoft/sections/map/${encodeURIComponent(String(id || '').trim())}/rename`, {
        method: 'POST',
        body: JSON.stringify({ displayAr: String(displayAr).trim(), displayEn: String(displayEn).trim() }),
    });
}

export function createYarasoftManualSection({ displayAr = '', displayEn = '' } = {}) {
    return apiFetch('/yarasoft/sections/manual', {
        method: 'POST',
        body: JSON.stringify({ displayAr: String(displayAr).trim(), displayEn: String(displayEn).trim() }),
    });
}

export function approveYarasoftSection(id, { displayAr = '', displayEn = '', mergeMapId } = {}) {
    const body = { displayAr: String(displayAr).trim(), displayEn: String(displayEn).trim() };
    if (mergeMapId != null && mergeMapId !== '') {body.mergeMapId = Number(mergeMapId);}
    return apiFetch(`/yarasoft/sections/unmapped/${encodeURIComponent(String(id || '').trim())}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function fetchYarasoftCatalogStatus() {
    return apiFetch('/yarasoft/oracle/catalog-status');
}

export function fetchYarasoftQuarantine() {
    return apiFetch('/yarasoft/quality/quarantine');
}

export function organizeYarasoftCategories() {
    return apiFetch('/yarasoft/oracle/organize', { method: 'POST' });
}

export function syncYarasoftBalances(force = false) {
    return apiFetch('/yarasoft/oracle/sync-balances', {
        method: 'POST',
        body: JSON.stringify({ force: Boolean(force) }),
    });
}

export function canWriteYarasoft(role) {
    return YARASOFT_WRITE_ROLES.includes(role);
}
