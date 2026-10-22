/**
 * V2 — Opening-balance input and net stock adjustment.
 * The purchase-invoice and direct-inventory endpoints remain authoritative.
 */
import { apiFetch } from '../../core/api.js?v=4.9.194';
import {
    importCell, importNumber, mergeItemKey, sheetExpiryCell,
} from './inventory-repo.js?v=4.9.194';
import { normalizeExpiryDate } from './expiry-policy.js?v=4.9.194';

export const OPENING_WRITE_ROLES = Object.freeze(['admin', 'manager', 'warehouse']);
export const OPENING_NET_ROLES = Object.freeze(['admin']);

const HEADER_NAMES = Object.freeze({
    name: ['اسم الصنف', 'الصنف', 'اسم', 'item', 'product', 'name'],
    unit: ['الوحدة', 'وحدة', 'unit', 'uom'],
    qty: ['كمية فعلية', 'الكمية الفعلية', 'الكمية', 'كمية', 'qty', 'quantity'],
    price: ['سعر الشراء', 'سعر', 'التكلفة', 'price', 'cost'],
    boxes: ['الكراتين', 'كراتين', 'عدد الكراتين', 'boxes', 'cartons'],
    category: ['الفئة', 'التصنيف', 'category', 'cat'],
    expiry: ['تاريخ الصلاحية', 'الصلاحية', 'تاريخ الانتهاء', 'expiry', 'expiry_date', 'bestbefore'],
});

const openingHeaderKey = (value) => importCell(value).toLowerCase()
    .replace(/[\s_()\-\u00a0\t]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

function isMeatRow(row) {
    return /لحوم|لحم|دجاج|فراخ|meat|chicken|beef/i.test(`${row.name} ${row.category}`);
}

export function validateOpeningRows(input = []) {
    const rows = [];
    const errors = [];
    const seen = new Set();
    for (const [index, raw] of (Array.isArray(input) ? input : []).entries()) {
        const name = String(raw?.name ?? '').trim();
        const qtyRaw = String(raw?.qty ?? '').trim();
        const priceRaw = String(raw?.price ?? '').trim();
        const boxesRaw = String(raw?.boxes ?? '').trim();
        const hasContent = name || qtyRaw || priceRaw || boxesRaw
            || String(raw?.unit ?? '').trim() || String(raw?.category ?? '').trim()
            || String(raw?.expiry ?? '').trim();
        if (!hasContent) {continue;}

        const qty = importNumber(qtyRaw, NaN);
        const price = importNumber(priceRaw, NaN);
        const expiryRaw = String(raw?.expiry ?? '').trim();
        const expiry = normalizeExpiryDate(raw?.expiry) || (raw?.expiry instanceof Date
            ? normalizeExpiryDate(raw.expiry.toISOString()) : '');
        const rowErrors = [];
        if (!name) {rowErrors.push('اسم الصنف مفقود');}
        if (name.length > 255) {rowErrors.push('اسم الصنف يتجاوز 255 حرفًا');}
        if (!Number.isFinite(qty) || qty <= 0) {rowErrors.push('الكمية يجب أن تكون أكبر من صفر');}
        if (!Number.isFinite(price) || price < 0) {rowErrors.push('سعر الشراء غير صحيح');}
        if (expiryRaw && !expiry) {
            rowErrors.push('تاريخ الصلاحية غير صحيح — الصيغة YYYY-MM-DD');
        }

        const row = {
            name,
            qty,
            unit: String(raw?.unit ?? '').trim() || 'كجم',
            price,
            boxes: boxesRaw ? importNumber(boxesRaw, NaN) : null,
            category: String(raw?.category ?? '').trim() || 'عام',
            expiry,
        };
        if (row.unit.length > 50) {rowErrors.push('الوحدة تتجاوز 50 حرفًا');}
        if (row.category.length > 100) {rowErrors.push('الفئة تتجاوز 100 حرف');}
        if (row.boxes !== null && (!Number.isInteger(row.boxes) || row.boxes <= 0)) {
            rowErrors.push('عدد الكراتين يجب أن يكون عددًا صحيحًا أكبر من صفر');
        }
        if (row.boxes !== null && !isMeatRow(row)) {
            rowErrors.push('عدد الكراتين متاح لأصناف اللحوم فقط');
        }
        const key = mergeItemKey(name);
        if (key && seen.has(key)) {rowErrors.push('اسم الصنف مكرر في الجدول');}
        if (key) {seen.add(key);}
        if (rowErrors.length) {
            errors.push({ line: index + 1, message: rowErrors.join('، ') });
        } else {
            rows.push(row);
        }
    }
    if (!rows.length && errors.length === 0) {
        errors.push({ line: '—', message: 'أدخل صنفًا واحدًا على الأقل' });
    }
    return { rows, errors };
}

export function parseOpeningSheetRows(rawRows = []) {
    const rows = Array.isArray(rawRows) ? rawRows.filter(Array.isArray) : [];
    const headerKeyRows = rows.slice(0, 3).map((row) => row.map(openingHeaderKey));
    let headerIndex = -1;
    let indexes = null;

    for (let i = 0; i < headerKeyRows.length; i += 1) {
        const header = headerKeyRows[i];
        const find = (field) => {
            const names = HEADER_NAMES[field].map(openingHeaderKey);
            return header.findIndex((cell) => names.includes(cell));
        };
        const name = find('name');
        let qty = find('qty');
        if (qty < 0) {qty = header.findIndex((cell) => /كميه|qty|quantity/.test(cell));}
        const price = find('price');
        if (name >= 0 && qty >= 0 && price >= 0) {
            headerIndex = i;
            indexes = {
                name, qty, price,
                unit: find('unit'), boxes: find('boxes'),
                category: find('category'), expiry: find('expiry'),
            };
            break;
        }
    }
    if (!indexes) {
        return {
            rows: [],
            errors: [{ line: '—', message: 'لم أتعرف على الأعمدة. يلزم اسم الصنف والكمية الفعلية وسعر الشراء.' }],
        };
    }

    const parsed = [];
    const errors = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
        const cells = rows[index];
        const name = importCell(cells[indexes.name]);
        const qtyRaw = cells[indexes.qty];
        const priceRaw = cells[indexes.price];
        const boxesRaw = indexes.boxes >= 0 ? cells[indexes.boxes] : '';
        const expiryRaw = indexes.expiry >= 0 ? cells[indexes.expiry] : '';
        const hasContent = name || importCell(qtyRaw) || importCell(priceRaw) || importCell(boxesRaw);
        if (!hasContent) {continue;}
        parsed.push({
            name,
            qty: importNumber(qtyRaw, NaN),
            unit: indexes.unit >= 0 ? importCell(cells[indexes.unit]) : '',
            price: importNumber(priceRaw, NaN),
            boxes: importCell(boxesRaw),
            category: indexes.category >= 0 ? importCell(cells[indexes.category]) : '',
            expiry: indexes.expiry >= 0 ? sheetExpiryCell(expiryRaw) : '',
        });
    }
    const result = validateOpeningRows(parsed);
    errors.push(...result.errors.map((error) => ({
        line: typeof error.line === 'number' ? error.line + headerIndex + 1 : error.line,
        message: error.message,
    })));
    return { rows: result.rows, errors };
}

export function openingNetQuantity(startingQty, issuedQty) {
    const start = Number(startingQty);
    const issued = Number(issuedQty);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(issued) || issued < 0) {
        throw new Error('كمية البداية أو المنصرف غير صالحة');
    }
    return Math.round((start - issued) * 1000) / 1000;
}

export function openingInvoicePayload(rows, { invoiceNumber, date }) {
    return {
        invoiceNumber: String(invoiceNumber || '').trim(),
        date: String(date || '').trim(),
        supplierName: 'رصيد افتتاحي - بداية الفترة',
        supplierPhone: '',
        paymentMethod: 'credit',
        paidAmount: 0,
        notes: 'رصيد افتتاحي بداية الفترة',
        supplierId: null,
        items: rows.map((row) => ({
            itemName: row.name,
            qty: row.qty,
            unit: row.unit,
            price: row.price,
            category: row.category,
            expiryDate: row.expiry,
            ...(row.boxes ? { packagingQty: row.boxes, packagingUom: 'كرتون' } : {}),
        })),
    };
}

export async function fetchOpeningIssuedTotals() {
    const response = await apiFetch('/warehouse/issued-totals');
    if (!response || !Array.isArray(response.items)) {
        throw new Error('صيغة إجمالي المنصرف غير صالحة');
    }
    return response.items.map((item) => ({
        name: String(item.itemName || '').trim(),
        issued: Number(item.issued),
    })).filter((item) => item.name && Number.isFinite(item.issued) && item.issued >= 0);
}

export async function createOpeningInvoice(rows, options) {
    const payload = openingInvoicePayload(rows, options);
    return apiFetch('/warehouse/purchase-invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
