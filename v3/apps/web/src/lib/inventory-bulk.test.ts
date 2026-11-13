import { describe, expect, it } from 'vitest';
import {
    BULK_CHUNK_SIZE,
    BULK_DEFAULTS,
    type BulkReceiptRow,
    bulkOutcomeText,
    bulkRowError,
    bulkRowPayload,
    chunkBulkRows,
    emptyBulkRow,
    isValidExpiryDate,
    validBulkRows,
} from './inventory-bulk';

/**
 * حارس الاستلام المجمّع — العقد من `backend/warehouse/returns-routes.js:348-429`:
 * الفئة الافتراضية «عام»، الوحدة «قطعة»، الحد الأدنى 5، والصلاحية اختيارية
 * لكن تاريخها الفاسد يُرفض. الترشيح يطابق الخادم حرفيًّا: بلا اسم أو
 * كمية ≤ 0 أو سعر < 0 يُسقط الصف.
 */

function row(overrides: Partial<BulkReceiptRow> = {}): BulkReceiptRow {
    return { ...emptyBulkRow(), name: 'أرز', qty: '10', price: '25', ...overrides };
}

describe('الاستلام المجمّع — الافتراضيات كما في V2', () => {
    it('صف فارغ يحمل الافتراضيات general/قطعة/5', () => {
        const blank = emptyBulkRow();
        expect(blank.category).toBe(BULK_DEFAULTS.category);
        expect(blank.category).toBe('عام');
        expect(blank.unit).toBe('قطعة');
        expect(blank.minQty).toBe('5');
    });

    it('الصف الفارغ لا يمرّ بالتحقق', () => {
        expect(bulkRowError(emptyBulkRow())).toBe('اكتب اسم الصنف');
    });
});

describe('الاستلام المجمّع — تحقق الصف', () => {
    it('صف كامل صالح', () => {
        expect(bulkRowError(row())).toBe('');
    });

    it('الكمية يجب أن تكون أكبر من صفر', () => {
        expect(bulkRowError(row({ qty: '0' }))).toContain('الكمية');
        expect(bulkRowError(row({ qty: '' }))).toContain('الكمية');
    });

    it('السعر يجب أن يكون رقمًا غير سالب', () => {
        expect(bulkRowError(row({ price: '' }))).toContain('سعر');
        expect(bulkRowError(row({ price: '-1' }))).toContain('سعر');
        expect(bulkRowError(row({ price: '0' }))).toBe('');
    });

    it('الصلاحية اختيارية لكن الفاسد مرفوض', () => {
        expect(isValidExpiryDate('')).toBe(true);
        expect(isValidExpiryDate('2026-12-31')).toBe(true);
        expect(isValidExpiryDate('2026-02-31')).toBe(false);
        expect(isValidExpiryDate('31-12-2026')).toBe(false);
        expect(bulkRowError(row({ expiryDate: '2026-13-01' }))).toContain('تاريخ الصلاحية');
    });
});

describe('الاستلام المجمّع — حمولة الصف', () => {
    it('تعبئة الافتراضيات إذا تُركت فارغة، والصلاحية null', () => {
        const payload = bulkRowPayload(row({ category: '', unit: '', minQty: '', expiryDate: '' }));
        expect(payload.category).toBe('عام');
        expect(payload.unit).toBe('قطعة');
        expect(payload.minQty).toBe(5);
        expect(payload.expiryDate).toBeNull();
    });

    it('الحد الأدنى السالب يُقرَّب إلى صفر', () => {
        expect(bulkRowPayload(row({ minQty: '-3' })).minQty).toBe(0);
    });
});

describe('الاستلام المجمّع — الترشيح والدفعات', () => {
    it('الصفوف الصالحة فقط تُرسل', () => {
        const rows = [row(), row({ name: '' }), row({ qty: '0' })];
        expect(validBulkRows(rows)).toHaveLength(1);
    });

    it('الدفعات على 20 صفًا كما في V2', () => {
        const rows = Array.from({ length: 45 }, () => row());
        const chunks = chunkBulkRows(rows);
        expect(BULK_CHUNK_SIZE).toBe(20);
        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toHaveLength(20);
        expect(chunks[2]).toHaveLength(5);
    });
});

describe('الاستلام المجمّع — نص النتيجة', () => {
    it('نجاح كامل', () => {
        expect(bulkOutcomeText({ imported: 30, total: 30, batches: ['BULK-1'], failures: [] })).toBe('استُورد 30 صنف');
    });

    it('نتيجة جزئية تُظهر ما فشل', () => {
        const text = bulkOutcomeText({
            imported: 20,
            total: 40,
            batches: ['BULK-1'],
            failures: [{ names: ['أرز'], message: 'خطأ' }],
        });
        expect(text).toContain('استُورد 20 صنف من 40');
        expect(text).toContain('فشلت 1 دفعة');
    });
});
