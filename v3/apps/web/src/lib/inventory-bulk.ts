import { z } from 'zod';
import { ApiError } from './api';
import { writeJson } from './write';

/**
 * الاستيراد الدفعي للمخزون — «استلام مجمّع» المنقولة من V2.
 *
 * العقد من الخادم حرفيًّا (`backend/warehouse/returns-routes.js:348-429`):
 *   POST /api/warehouse/inventory/bulk-receipt
 *   الأدوار: admin|manager|warehouse (requireRole).
 *   الجسم: {items:[{name|itemName, category, unit, qty, price, minQty, expiryDate}]}
 *   الرد 201: {inventory, transactions, batchId} — والدفعة ذرّية (BEGIN/COMMIT)،
 *   فأي خطأ في صف يُسقط الدفعة كلها.
 *
 * سلوك V2 (`frontend/app/js/v2/data/inventory-repo.js:368-424`):
 *   - القيم الافتراضية: الفئة «عام»، الوحدة «قطعة»، الحد الأدنى 5.
 *   - الدفعات تُرسل.groups من 20 صفًا (`BULK_CHUNK`)، وكل دفعة تُعزل
 *     في try/catch: فشل دفعة لا يُسقط الباقي، والنتيجة «جزئية».
 *   - الخادم يُسقط الصفوف بلا اسم أو بكمية ≤ 0 أو بسعر < 0، ويقبل
 *     الصلاحية اختيارية ويرفض تاريخًا فاسدًا بصيغة `YYYY-MM-DD` فقط.
 */

export const BULK_RECEIPT_ROLES = ['admin', 'manager', 'warehouse'] as const;

export const BULK_DEFAULTS = {
    category: 'عام',
    unit: 'قطعة',
    minQty: 5,
} as const;

/** `BULK_CHUNK` في V2 — عدد الصفوف في الدفعة الواحدة. */
export const BULK_CHUNK_SIZE = 20;

export interface BulkReceiptRow {
    /** معرّف محلّي للصف (مفتاح React) — لا يُرسل إلى الخادم. */
    id: string;
    name: string;
    category: string;
    unit: string;
    qty: string;
    price: string;
    minQty: string;
    expiryDate: string;
}

let rowSeq = 0;

export function emptyBulkRow(): BulkReceiptRow {
    rowSeq += 1;
    return {
        id: `bulk-row-${rowSeq}`,
        name: '',
        category: BULK_DEFAULTS.category,
        unit: BULK_DEFAULTS.unit,
        qty: '',
        price: '',
        minQty: String(BULK_DEFAULTS.minQty),
        expiryDate: '',
    };
}

/** صلاحية اختيارية — التاريخ الفاسد وحده يُرفض (نفس `checkExpiryOnLines`). */
const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidExpiryDate(value: unknown): boolean {
    const text = String(value ?? '').trim();
    if (!text) {
        return true;
    }
    if (!EXPIRY_RE.test(text)) {
        return false;
    }
    const parts = text.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * تحقق الصف قبل الإرسال — نفس شروط الترشيح في الخادم (`returns-routes.js:356-360`)
 * مع رسالة عربية في مكان الخطأ. يعيد '' حين الصف صالح.
 */
export function bulkRowError(row: BulkReceiptRow): string {
    const name = String(row.name ?? '').trim();
    if (!name) {
        return 'اكتب اسم الصنف';
    }
    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
        return 'الكمية يجب أن تكون أكبر من صفر';
    }
    const priceText = String(row.price ?? '').trim();
    const price = Number(priceText);
    if (priceText === '' || !Number.isFinite(price) || price < 0) {
        return 'اكتب سعر الشراء (صفر أو أكثر)';
    }
    if (!isValidExpiryDate(row.expiryDate)) {
        return `تاريخ الصلاحية غير صحيح للصنف ${name} — الصيغة المطلوبة YYYY-MM-DD`;
    }
    return '';
}

/** الصف الصالح كما يطلبه الخادم: `minQty` افتراضي 5، والصلاحية `null` إن فارغة. */
export function bulkRowPayload(row: BulkReceiptRow): Record<string, unknown> {
    const minQtyText = String(row.minQty ?? '').trim();
    const minQty = minQtyText ? Number(minQtyText) : Number.NaN;
    const expiry = String(row.expiryDate ?? '').trim();
    return {
        name: String(row.name ?? '').trim(),
        category: String(row.category ?? '').trim() || BULK_DEFAULTS.category,
        unit: String(row.unit ?? '').trim() || BULK_DEFAULTS.unit,
        qty: Number(row.qty) || 0,
        price: Number(row.price) || 0,
        minQty: Number.isFinite(minQty) ? Math.max(0, minQty) : BULK_DEFAULTS.minQty,
        expiryDate: expiry ? expiry : null,
    };
}

/** الصفوف الجاهزة للإرسال (صالحة فقط) — الترتيب كما أُدخل. */
export function validBulkRows(rows: readonly BulkReceiptRow[]): BulkReceiptRow[] {
    return rows.filter((row) => bulkRowError(row) === '');
}

export function chunkBulkRows(rows: readonly BulkReceiptRow[], size = BULK_CHUNK_SIZE): BulkReceiptRow[][] {
    const chunks: BulkReceiptRow[][] = [];
    for (let index = 0; index < rows.length; index += size) {
        chunks.push(rows.slice(index, index + size));
    }
    return chunks;
}

const bulkReceiptSchema = z
    .object({
        inventory: z.array(z.unknown()).optional(),
        transactions: z.array(z.unknown()).optional(),
        batchId: z.string().nullable().optional(),
    })
    .passthrough();

export interface BulkReceiptFailure {
    names: string[];
    message: string;
}

export interface BulkReceiptOutcome {
    /** عدد الأصناف المستوردة بنجاح. */
    imported: number;
    /** عدد الصفوف المرسلة. */
    total: number;
    /** معرّفات الدفعات التي نجحت. */
    batches: string[];
    /** الدفعات الفاشلة مع سببها. */
    failures: BulkReceiptFailure[];
}

export class BulkReceiptError extends Error {
    readonly code: string;
    readonly names: string[];

    constructor(message: string, code: string, names: string[] = []) {
        super(message);
        this.name = 'BulkReceiptError';
        this.code = code;
        this.names = names;
    }
}

/**
 * إرسال الدفعات بالترتيب. كل دفعة ذرّية على الخادم، ففشلها لا يُسقط
 * ما قبلها — والنتيجة تُصفّح بدل رمي خطأ واحد على المستخدم.
 */
export async function submitBulkReceipt(rows: readonly BulkReceiptRow[]): Promise<BulkReceiptOutcome> {
    const ready = validBulkRows(rows);
    const outcome: BulkReceiptOutcome = { imported: 0, total: ready.length, batches: [], failures: [] };
    for (const chunk of chunkBulkRows(ready)) {
        const names = chunk.map((row) => String(row.name ?? '').trim()).filter(Boolean);
        try {
            const response = await writeJson(bulkReceiptSchema, '/api/warehouse/inventory/bulk-receipt', 'POST', {
                items: chunk.map(bulkRowPayload),
            });
            const batchId = String(response.batchId ?? '').trim();
            if (batchId) {
                outcome.batches.push(batchId);
            }
            outcome.imported += chunk.length;
        } catch (error) {
            const api = error instanceof ApiError ? error : null;
            const code = String(api?.code ?? '');
            const message = api?.message || (error instanceof Error ? error.message : 'تعذّر تسجيل الدفعة');
            outcome.failures.push({ names, message });
            // رفض دفعة بسبب صف واحد (صلاحية فاسدة أو وحدة مختلفة) لا يُصلح
            // بتكرار الدفعة — يُبلَّغ المستخدم برفض الخادم مع أسماء الدفعة.
            if (code === 'UNIT_MISMATCH' || code === 'INVALID_EXPIRY_DATE' || code === 'EMPTY_BULK_RECEIPT') {
                throw new BulkReceiptError(message, code, names);
            }
        }
    }
    return outcome;
}

/** نص النتيجة الجزئية كما في V2 («استُورد X صنف من Y — فشلت Z دفعة»). */
export function bulkOutcomeText(outcome: BulkReceiptOutcome): string {
    if (!outcome.failures.length) {
        return `استُورد ${outcome.imported} صنف`;
    }
    return `استُورد ${outcome.imported} صنف من ${outcome.total} — فشلت ${outcome.failures.length} دفعة`;
}
