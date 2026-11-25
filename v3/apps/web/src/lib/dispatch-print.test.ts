import { describe, expect, it } from 'vitest';
import { dispatchPrintable, dispatchPrintHtml } from './dispatch-print';
import type { Dispatch } from './dispatches';

const brand = { name: 'شركة الاختبار', logoSrc: '/logo.png' };

describe('dispatch operational print sheet', () => {
    it('matches the established printable workflow statuses', () => {
        for (const status of ['approved', 'partially_received', 'received', 'cancelled', 'voided']) {
            expect(dispatchPrintable(status)).toBe(true);
        }
        for (const status of ['pending', 'chef_approved', 'rejected', '', null]) {
            expect(dispatchPrintable(status)).toBe(false);
        }
    });

    it('prints approved quantities, accumulated receipts, signatures, and escaped text without cost data', () => {
        const dispatch = {
            id: '42',
            status: 'partially_received',
            deptName: '<قسم>',
            createdBy: 'مقدم الطلب',
            requestSignatureData: 'data:image/png;base64,QUJD',
            approvedItems: [{ itemName: '<رز>', approvedQty: 5, unit: 'كجم', approvedValue: 250, catchWeightEnabled: false }],
            receivedItems: [{ itemName: '<رز>', receivedQty: 2, catchWeightEnabled: false }],
            kitchenReceivedBy: 'المستلم',
            kitchenReceivedAt: '2026-11-25T10:00:00.000Z',
        } as Dispatch;

        const html = dispatchPrintHtml(dispatch, brand, new Date('2026-11-25T10:00:00.000Z'));

        expect(html).toContain('إذن صرف مخزني');
        expect(html).toContain('5 كجم');
        expect(html).toContain('2 كجم');
        expect(html).toContain('data:image/png;base64,QUJD');
        expect(html).toContain('&lt;قسم&gt;');
        expect(html).toContain('&lt;رز&gt;');
        expect(html).not.toContain('<قسم>');
        expect(html).not.toContain('250');
    });

    it('does not render a non-image signature payload as an image', () => {
        const html = dispatchPrintHtml({ id: '7', status: 'approved', requestSignatureData: 'javascript:alert(1)' } as Dispatch, brand);

        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('<img src="javascript:');
    });
});
