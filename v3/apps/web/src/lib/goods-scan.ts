import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { fetchInventoryRegister, type InventoryItem } from './inventory-register';

export const BARCODE_MAX = 100;
export const CREATE_DISPATCH_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;
export const INVENTORY_WRITE_ROLES = ['admin', 'manager', 'warehouse'] as const;

const unknownResponse = z.unknown();

const departmentSchema = z
    .object({
        code: z.string(),
        name: z.string().nullable().optional(),
        name_ar: z.string().nullable().optional(),
    })
    .passthrough();

const departmentPageSchema = z
    .object({
        data: z.array(departmentSchema),
        pagination: z.object({ totalPages: z.number().optional() }).passthrough().optional(),
    })
    .passthrough();

export type ScanItem = InventoryItem & {
    id: string | number;
    name: string | null;
    barcode: string | null;
    mainQty: string | number | null;
    unit: string | null;
};

export type ScanLine = {
    key: string;
    count: number;
    qty: number;
    price: number | null;
    expiryDate: string | null;
};

export type ScanDepartment = { code: string; name: string };
export type ScanState = 'empty' | 'unique' | 'ambiguous' | 'none';

export function normalizeCode(raw: unknown): string {
    return [...String(raw ?? '')]
        .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint > 0x1f && codePoint !== 0x7f;
        })
        .join('')
        .trim();
}

export function codeFamily(raw: unknown): string {
    const code = normalizeCode(raw);
    if (!code) {
        return 'empty';
    }
    if (!/^[0-9]+$/.test(code)) {
        return 'alphanumeric';
    }
    if (code.length === 13) {
        return 'ean13';
    }
    if (code.length === 8) {
        return 'ean8';
    }
    if (code.length === 12) {
        return 'upc-a';
    }
    if (code.length === 14) {
        return 'gtin14';
    }
    if (code.length % 2 === 0 && code.length >= 6 && code.length <= 14) {
        return 'itf';
    }
    return 'numeric-other';
}

export function gtinCheckDigit(body: string): number {
    const digits = body.replace(/\D/g, '');
    let sum = 0;
    for (let index = 0; index < digits.length; index += 1) {
        const weight = (digits.length - index) % 2 === 1 ? 3 : 1;
        sum += Number(digits[index]) * weight;
    }
    return (10 - (sum % 10)) % 10;
}

export type GtinValidation = {
    ok: boolean;
    checked: boolean;
    family: string;
    expected: number | null;
    reason: string;
};

export function validateGtin(raw: unknown): GtinValidation {
    const code = normalizeCode(raw);
    const family = codeFamily(code);
    if (code.length < 2) {
        return { ok: true, checked: false, family, expected: null, reason: 'كودٌ قصير — لا رقم تحقق له يُفحص' };
    }
    if (['alphanumeric', 'numeric-other', 'itf', 'empty'].includes(family)) {
        return { ok: true, checked: false, family, expected: null, reason: 'ليس GTIN مقيسًا — لا فحص تحقق عليه' };
    }
    const expected = gtinCheckDigit(code.slice(0, -1));
    if (expected === Number(code.slice(-1))) {
        return { ok: true, checked: true, family, expected, reason: 'رقم التحقق مطابق' };
    }
    return {
        ok: false,
        checked: true,
        family,
        expected,
        reason: `آخر خانة لا تطابق حساب GS1 (المتوقّع ${String(expected)}) — تحقّق من الكود أو أكّد الربط يدويًا`,
    };
}

export function exactBarcodeMatches(rows: readonly ScanItem[], raw: unknown): ScanItem[] {
    const code = normalizeCode(raw);
    return code ? rows.filter((row) => normalizeCode(row.barcode) === code) : [];
}

export function resolveScan(
    rows: readonly ScanItem[],
    raw: unknown,
): {
    state: ScanState;
    code: string;
    items: ScanItem[];
    validation: GtinValidation;
} {
    const code = normalizeCode(raw);
    const validation = validateGtin(code);
    const items = exactBarcodeMatches(rows, code);
    return {
        state: !code ? 'empty' : items.length === 0 ? 'none' : items.length === 1 ? 'unique' : 'ambiguous',
        code,
        items,
        validation,
    };
}

function barcodeHolders(rows: readonly ScanItem[], code: string, exceptId?: string | number): ScanItem[] {
    return rows.filter((row) => normalizeCode(row.barcode) === code && (exceptId === undefined || String(row.id) !== String(exceptId)));
}

export type AssignDecision = {
    state: 'empty' | 'taken' | 'invalid' | 'suspect' | 'duplicate' | 'ready';
    message: string;
    code: string;
    item: ScanItem | null;
    holders: ScanItem[];
    validation: GtinValidation;
};

export function assignDecision(rows: readonly ScanItem[], rawCode: unknown, itemId: string | number): AssignDecision {
    const code = normalizeCode(rawCode);
    const validation = validateGtin(code);
    const item = rows.find((row) => String(row.id) === String(itemId)) ?? null;
    const holders = code ? barcodeHolders(rows, code, itemId) : [];
    if (!code) {
        return { state: 'empty', message: 'لا كود — امسح الباركود أو اكتبه', code, item, holders: [], validation };
    }
    if (holders.length) {
        return {
            state: 'taken',
            message: `الكود مربوط بـ«${holders[0]?.name || holders[0]?.id}» — لا يُربط بصنفين`,
            code,
            item,
            holders,
            validation,
        };
    }
    if (!item) {
        return {
            state: 'invalid',
            message: 'الصنف غير موجود في نتيجة الخادم — أعد البحث',
            code,
            item,
            holders,
            validation,
        };
    }
    const existing = normalizeCode(item.barcode);
    if (existing && existing !== code) {
        return {
            state: 'duplicate',
            message: `«${item.name || item.id}» مربوط بالفعل بـ${existing} — الربط يستبدله${validation.ok ? '' : `؛ ${validation.reason}`}`,
            code,
            item,
            holders,
            validation,
        };
    }
    if (!validation.ok) {
        return { state: 'suspect', message: validation.reason, code, item, holders, validation };
    }
    return {
        state: 'ready',
        message: `يربط «${item.name || item.id}» بالكود ${code}`,
        code,
        item,
        holders,
        validation,
    };
}

export type ScanCoverage = {
    total: number;
    assigned: number;
    unassigned: number;
    pct: number;
    distinct: number;
    duplicates: { code: string; count: number }[];
    suspect: number;
};

export function coverage(rows: readonly ScanItem[]): ScanCoverage {
    const byCode = new Map<string, number>();
    let assigned = 0;
    let suspect = 0;
    for (const row of rows) {
        const code = normalizeCode(row.barcode);
        if (!code) {
            continue;
        }
        assigned += 1;
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
        if (!validateGtin(code).ok) {
            suspect += 1;
        }
    }
    const duplicates = [...byCode.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({ code, count }));
    return {
        total: rows.length,
        assigned,
        unassigned: rows.length - assigned,
        pct: rows.length ? Math.round((assigned / rows.length) * 100) : 0,
        distinct: byCode.size,
        duplicates,
        suspect,
    };
}

export function unassignedRows(rows: readonly ScanItem[], limit = 200): ScanItem[] {
    return rows.filter((row) => !normalizeCode(row.barcode)).slice(0, Math.max(1, Number(limit) || 200));
}

export function bumpLine(lines: readonly ScanLine[], key: string, delta = 1): ScanLine[] {
    const result = [...lines];
    const step = Number(delta) > 0 ? Number(delta) : 1;
    const index = result.findIndex((line) => line.key === String(key));
    if (index < 0) {
        result.push({ key: String(key), count: step, qty: step, price: null, expiryDate: null });
        return result;
    }
    const current = result[index];
    if (current) {
        result[index] = {
            ...current,
            count: current.count + step,
            qty: current.qty + step,
        };
    }
    return result;
}

export function setLineQty(lines: readonly ScanLine[], key: string, rawQty: string): ScanLine[] {
    const quantity = Number(rawQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return [...lines];
    }
    return lines.map((line) => (line.key === key ? { ...line, qty: quantity } : line));
}

export function setLinePrice(lines: readonly ScanLine[], key: string, rawPrice: string): ScanLine[] {
    const value = rawPrice.trim();
    const parsed = Number(value);
    const price = !value || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
    return lines.map((line) => (line.key === key ? { ...line, price } : line));
}

export function setLineExpiry(lines: readonly ScanLine[], key: string, rawDate: string): ScanLine[] {
    const expiryDate = rawDate.trim() || null;
    return lines.map((line) => (line.key === key ? { ...line, expiryDate } : line));
}

export function dropLine(lines: readonly ScanLine[], key: string): ScanLine[] {
    return lines.filter((line) => line.key !== key);
}

export function sessionTotals(lines: readonly ScanLine[]) {
    const qty = lines.reduce((sum, line) => sum + line.qty, 0);
    return {
        lines: lines.length,
        scans: lines.reduce((sum, line) => sum + line.count, 0),
        qty: Math.round(qty * 1000) / 1000,
    };
}

export async function lookupByCode(code: string, signal?: AbortSignal) {
    const normalized = normalizeCode(code);
    if (!normalized) {
        return { rows: [] as ScanItem[], total: 0, truncated: false, matches: [] as ScanItem[], code: normalized };
    }
    const result = await fetchInventoryRegister({ q: normalized, category: 'all', stock: 'all' }, signal);
    return {
        rows: result.rows as ScanItem[],
        total: result.total,
        truncated: result.truncated,
        matches: exactBarcodeMatches(result.rows as ScanItem[], normalized),
        code: normalized,
    };
}

export async function loadCampaign(signal?: AbortSignal) {
    const result = await fetchInventoryRegister({ q: '', category: 'all', stock: 'all' }, signal);
    return { rows: result.rows as ScanItem[], total: result.total, truncated: result.truncated };
}

export async function searchItems(term: string, signal?: AbortSignal): Promise<ScanItem[]> {
    const query = term.trim().slice(0, 100);
    if (!query) {
        return [];
    }
    const result = await fetchInventoryRegister({ q: query, category: 'all', stock: 'all' }, signal, 2);
    return result.rows as ScanItem[];
}

export async function assignItemBarcode(itemId: string | number, barcode: string): Promise<void> {
    const code = normalizeCode(barcode).slice(0, BARCODE_MAX);
    if (!code) {
        throw new Error('لا يمكن ربط صنفٍ بكودٍ فارغ');
    }
    await fetchJson(unknownResponse, `/api/inventory/${encodeURIComponent(String(itemId))}`, getAccessToken(), {
        method: 'PUT',
        body: { barcode: code },
    });
}

function normalizedExpiryDate(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

export function checkExpiryOnLines(lines: readonly ScanLine[], rows: readonly ScanItem[]) {
    const invalid = lines
        .filter((line) => line.expiryDate && !normalizedExpiryDate(line.expiryDate))
        .map((line) => rows.find((row) => String(row.id) === line.key)?.name || line.key);
    if (invalid.length) {
        return {
            ok: false,
            message: `تاريخ الصلاحية غير صحيح للصنف ${invalid.slice(0, 5).join('، ')} — الصيغة المطلوبة YYYY-MM-DD`,
        };
    }
    return { ok: true, message: '' };
}

export function receiptPayload(item: ScanItem, line: ScanLine) {
    const parsedPrice = line.price ?? 0;
    return {
        qty: line.qty,
        price: parsedPrice || Number(item.avgCost) || 0,
        unit: item.unit || '',
        expiryDate: line.expiryDate ? normalizedExpiryDate(line.expiryDate) : null,
    };
}

export async function receiveInventoryItem(itemId: string | number, payload: ReturnType<typeof receiptPayload>) {
    await fetchJson(unknownResponse, `/api/warehouse/inventory/${encodeURIComponent(String(itemId))}/receipt`, getAccessToken(), {
        method: 'POST',
        body: payload,
    });
}

export async function fetchScanDepartments(signal?: AbortSignal): Promise<ScanDepartment[]> {
    const departments: ScanDepartment[] = [];
    for (let page = 1; page <= 3; page += 1) {
        const response = await fetchJson(
            departmentPageSchema,
            `/api/departments?page=${String(page)}&limit=1000&sort=id&order=asc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        departments.push(
            ...response.data.map((department) => ({
                code: department.code,
                name: department.name || department.name_ar || department.code,
            })),
        );
        const pages = response.pagination?.totalPages ?? 0;
        if (response.data.length < 1000 || (pages > 0 && page >= pages)) {
            break;
        }
    }
    return departments;
}

export async function createDispatch(payload: {
    deptCode: string;
    deptName?: string;
    items: { itemName: string; qty: number; unit: string }[];
    notes: string;
    status: 'pending';
    date: string;
}): Promise<void> {
    await fetchJson(unknownResponse, '/api/dispatches', getAccessToken(), { method: 'POST', body: payload });
}
