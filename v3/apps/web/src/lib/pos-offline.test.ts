import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { CompleteSaleInput } from './pos';
import type { PosSaleItem } from './pos-pricing';
import { setUiFlag } from './ui-flags';

const mocks = vi.hoisted(() => ({ completePosSale: vi.fn() }));

vi.mock('./pos', () => ({ completePosSale: mocks.completePosSale }));

import {
    flushQueuedSales,
    isNetworkFailure,
    queuedSalesCount,
    resetPosOfflineCacheForTests,
    SaleQueuedOfflineError,
    submitSaleWithOffline,
} from './pos-offline';

const input: CompleteSaleInput = {
    departmentId: '7',
    sessionId: '11',
    items: [{ product_id: 1, quantity: 2, unit_price: 5, discount: 0 }] satisfies PosSaleItem[],
    payments: [{ method: 'cash', amount: 10, reference: null }],
    idempotencyKey: 'sale-key-1',
};

beforeEach(() => {
    mocks.completePosSale.mockReset();
    localStorage.clear();
    resetPosOfflineCacheForTests();
    setUiFlag('posOfflineQueue', false);
});

afterEach(() => {
    setUiFlag('posOfflineQueue', false);
    localStorage.clear();
});

describe('POS offline integration', () => {
    it('المفتاح مغلق ⇒ البيع المباشر القديم بلا طابور', async () => {
        mocks.completePosSale.mockResolvedValue({ ok: true });
        await submitSaleWithOffline(input);
        expect(mocks.completePosSale).toHaveBeenCalledWith(input);
        expect(await queuedSalesCount()).toBe(0);
    });

    it('انقطاع الشبكة ⇒ حفظ النية وخطأ صريح لا فقدان صامت', async () => {
        setUiFlag('posOfflineQueue', true);
        mocks.completePosSale.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(submitSaleWithOffline(input)).rejects.toBeInstanceOf(SaleQueuedOfflineError);
        expect(await queuedSalesCount()).toBe(1);
    });

    it('خطأ عمل من الخادم لا يُودَع في الطابور', async () => {
        setUiFlag('posOfflineQueue', true);
        mocks.completePosSale.mockRejectedValue(new ApiError(422, 'INSUFFICIENT_STOCK', 'رصيد غير كافٍ'));
        await expect(submitSaleWithOffline(input)).rejects.toBeInstanceOf(ApiError);
        expect(await queuedSalesCount()).toBe(0);
    });

    it('عند عودة الاتصال: إرسال بمفتاح idempotency نفسه وتفريغ الطابور', async () => {
        setUiFlag('posOfflineQueue', true);
        mocks.completePosSale.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(submitSaleWithOffline(input)).rejects.toBeInstanceOf(SaleQueuedOfflineError);
        mocks.completePosSale.mockResolvedValue({ ok: true });
        const result = await flushQueuedSales();
        expect(result.processed).toBe(1);
        expect(mocks.completePosSale.mock.calls[1]?.[0]?.idempotencyKey).toBe('sale-key-1');
        expect(await queuedSalesCount()).toBe(0);
    });

    it('نفس مفتاح البيع لا يُودَع مرتين', async () => {
        setUiFlag('posOfflineQueue', true);
        mocks.completePosSale.mockRejectedValue(new TypeError('offline'));
        await expect(submitSaleWithOffline(input)).rejects.toBeInstanceOf(SaleQueuedOfflineError);
        await expect(submitSaleWithOffline(input)).rejects.toBeInstanceOf(SaleQueuedOfflineError);
        expect(await queuedSalesCount()).toBe(1);
    });

    it('تصنيف الخطأ: ApiError ليس شبكة، وTypeError شبكة', () => {
        expect(isNetworkFailure(new ApiError(500, 'SERVER', 'خطأ'))).toBe(false);
        expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    });
});
