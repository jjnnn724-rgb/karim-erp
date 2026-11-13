import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosSaleResult } from '../../lib/pos';
import { PosReceipt } from './PosReceipt';

const mocks = vi.hoisted(() => ({
    openServerHtmlWindow: vi.fn((html: string, _title?: string) => true),
    qrDataUrl: vi.fn(async (_payload: string) => 'data:image/png;base64,AAAA' as string | null),
}));

vi.mock('./pos-ui', async (importOriginal) => {
    const original = await importOriginal<typeof import('./pos-ui')>();
    return {
        ...original,
        openServerHtmlWindow: mocks.openServerHtmlWindow as unknown as typeof original.openServerHtmlWindow,
        qrDataUrl: mocks.qrDataUrl as unknown as typeof original.qrDataUrl,
    };
});

const receipt = {
    order_id: '11111111-1111-4111-8111-111111111111',
    invoice_counter: 1099,
    invoice_uuid: '8f2c1d7e-4a5b-4c3d-9e21-77aa10bb22cc',
    invoice_hash: 'hash',
    qr_payload: 'tlv-bytes',
    digital_signature: 'sig',
    total_amount: 55.25,
    tax_total: 7.25,
    subtotal: 48,
    discount_total: 0,
    paid: 60,
    change: 4.75,
    non_cash_overpayment: null,
    print_job_id: null,
    zatca_queued: true,
    kot_enabled: true,
    kot_jobs: [],
    session_id: '44',
    erp_revenue_id: null,
    erp_dept_code: 'K01',
    party_name: null,
    buffet: null,
} as unknown as PosSaleResult;

function renderReceipt() {
    return render(
        <PosReceipt
            receipt={receipt}
            buffet={false}
            canReprint={false}
            busy={false}
            onReprint={() => {}}
            onKot={() => {}}
            onDismiss={() => {}}
        />,
    );
}

describe('زر «طباعة الإيصال» — مسار الخادم الموحّد', () => {
    beforeEach(() => {
        mocks.openServerHtmlWindow.mockClear();
        mocks.qrDataUrl.mockClear();
        mocks.openServerHtmlWindow.mockReturnValue(true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('يجلب HTML الإيصال من الخادم ويفتحه كاملًا بلا تغليف', async () => {
        const html = '<!DOCTYPE html><html dir="rtl">فاتورة 300000000000003</html>';
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ html }) })) as unknown as typeof fetch);
        renderReceipt();

        fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));

        await waitFor(() => {
            expect(mocks.openServerHtmlWindow).toHaveBeenCalledTimes(1);
        });
        const call = mocks.openServerHtmlWindow.mock.calls[0] as unknown as [string, string];
        expect(call[0]).toBe(html);
        expect(call[1]).toContain('1099');
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/pos/orders/11111111-1111-4111-8111-111111111111/receipt-html'),
            expect.anything(),
        );
    });

    it('لو حجب المتصفح النافذة تظهر رسالة الخطأ ولا ينكسر', async () => {
        const html = '<!DOCTYPE html><html dir="rtl">فاتورة</html>';
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ html }) })) as unknown as typeof fetch);
        mocks.openServerHtmlWindow.mockReturnValue(false);
        renderReceipt();

        fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));

        expect(await screen.findByText(/حجب المتصفح نافذة الطباعة/)).toBeTruthy();
    });

    it('لو الخادم رفض الفاتورة تظهر رسالة الخطأ للمستخدم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('INVOICE_UNBALANCED');
            }) as unknown as typeof fetch,
        );
        renderReceipt();

        fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));

        expect(await screen.findByText(/تعذّرت طباعة الإيصال/)).toBeTruthy();
    });
});
