import { describe, expect, it } from 'vitest';
import { invoiceToRow } from './purchase-invoices';

const base = {
    id: '1',
    date: '2026-11-24',
    supplierId: null,
    vat_total: '0',
    totalAmount: '0',
    paidAmount: '0',
};

describe('invoiceToRow — ضريبة الفاتورة', () => {
    it('يقرأ vat_total من الخادم كنص مليمي بلا تخمين', () => {
        const row = invoiceToRow({
            ...base,
            invoiceNumber: 'INV-1',
            supplierName: 'مورد مسجل',
            vat_total: '105.00',
            totalAmount: '805.00',
        });
        expect(row.vat).toBe('105.00');
        expect(row.total).toBe('805.00');
    });

    it('غياب الضريبة من الخادم ⇒ صفر صريح (لا undefined)', () => {
        const row = invoiceToRow(base);
        expect(row.vat).toBe('0.00');
    });

    it('القيمة النصية من NUMERIC تمرّ كما هي', () => {
        const row = invoiceToRow({ ...base, id: '3', vat_total: '14.85', totalAmount: '113.85' });
        expect(row.vat).toBe('14.85');
    });
});
