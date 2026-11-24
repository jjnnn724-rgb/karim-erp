import { describe, expect, it } from 'vitest';
import { inventoryTransferSchema, summarizeTransfers, transferSummarySchema, transferToRow } from './dept-transfers';

/**
 * قيمة التحويل تُجمع بدقة (ADR-04) ثم تُقرَّب مرة واحدة — لا Float ولا
 * تقريب لكل بند. حارس التسرب الذي قيس حيًّا: 33,072.07 مقابل 33,072.05.
 */

function transferOf(raw: Record<string, unknown>) {
    return inventoryTransferSchema.parse({ id: 'x', transfer_number: 'TR-X', ...raw });
}

describe('عقد التحويلات', () => {
    it('يجمع حواصل البنود ثم يقرّب الإجمالي مرة واحدة', () => {
        const items = Array.from({ length: 10 }, (_, index) => ({
            inventory_id: index + 1,
            requested_qty: '0.001',
            received_qty: '0.001',
            unit_cost: '12.50',
        }));
        const transfer = transferOf({ status: 'received', items });
        const row = transferToRow(transfer, new Map());
        // 10 × 0.0125 = 0.125 ⇒ 0.13. تقريب كل بند أولًا كان يعطي 0.10.
        expect(row.value).toBe('0.13');
        expect(row.qtyText).toBe('0.01');
        expect(row.itemsCount).toBe(10);
    });

    it('يقرأ الأسماء والأعلام من metadata ويحتفظ بالسبب', () => {
        const transfer = transferOf({
            status: 'rejected',
            metadata: {
                mode: 'dept_transfer',
                sourceDeptCode: 'butcher',
                destDeptCode: 'kitchen',
                test: 'true',
                factory: true,
                factory_total_value: '99.999',
                rejection_reason: 'كمية غير مطابقة',
            },
            items: [{ inventory_id: 7, received_qty: null, requested_qty: '2', unit_cost: '10' }],
        });
        const names = new Map([
            ['butcher', 'قسم الجزار'],
            ['kitchen', 'المطبخ'],
        ]);
        const row = transferToRow(transfer, names);
        expect(row.fromName).toBe('قسم الجزار');
        expect(row.toName).toBe('المطبخ');
        expect(row.test).toBe(true);
        expect(row.factory).toBe(true);
        expect(row.factoryValue).toBe('100.00');
        expect(row.rejectionReason).toBe('كمية غير مطابقة');
        expect(row.value).toBe('20.00');
        expect(row.statusKnown).toBe(true);
    });

    it('يجمع الحالات كما في القديم: القيمة للمنفَّذ فقط', () => {
        const names = new Map<string, string>();
        const rows = [
            transferOf({ status: 'requested', items: [{ requested_qty: '1', unit_cost: '5' }] }),
            transferOf({ status: 'received', items: [{ received_qty: '2', unit_cost: '5' }] }),
            transferOf({ status: 'rejected', items: [{ requested_qty: '3', unit_cost: '5' }] }),
            transferOf({ status: 'cancelled', items: [] }),
        ].map((transfer) => transferToRow(transfer, names));
        expect(summarizeTransfers(rows)).toEqual({
            total: 4,
            pending: 1,
            done: 1,
            rejected: 1,
            cancelled: 1,
            value: '10.00',
        });
    });

    it('يقبل لوحة الملخص بصيغ الخادم الرقمية', () => {
        const summary = transferSummarySchema.parse({
            from: '2026-11-01',
            to: '2026-11-07',
            totals: { transfers: 8, lines: 43, qty: 1585.566, value: 33072.05, sources: 1, destinations: 1 },
            bySource: [{ dept_code: 'kitchen', dept_name: 'المطبخ', transfers: 8, qty: 1585.566, value: 33072.05 }],
            byDest: [],
            topItems: [],
            daily: [{ day: '2026-11-01', transfers: 1, value: 1631.84 }],
        });
        expect(summary.totals?.transfers).toBe(8);
        expect(summary.bySource?.[0]?.dept_name).toBe('المطبخ');
    });
});
