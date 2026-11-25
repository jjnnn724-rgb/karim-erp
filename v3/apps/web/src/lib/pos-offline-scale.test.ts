import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineQueue, localStorageQueueStore, type SendResult } from './offline-queue';
import { setUiFlag } from './ui-flags';

const mocks = vi.hoisted(() => ({ completePosSale: vi.fn() }));
vi.mock('./pos', () => ({ completePosSale: mocks.completePosSale }));

import {
    OfflineLimitReachedError,
    offlineDeviceLimit,
    queuedSaleConflicts,
    resetPosOfflineCacheForTests,
    submitSaleWithOffline,
} from './pos-offline';

const sale = (n: number) => ({
    departmentId: '7',
    sessionId: '11',
    items: [{ product_id: 1, quantity: 1, unit_price: 10, discount: 0 }],
    payments: [{ method: 'cash' as const, amount: 10, reference: null }],
    idempotencyKey: `sale-${n}`,
});

beforeEach(() => {
    localStorage.clear();
    mocks.completePosSale.mockReset();
    resetPosOfflineCacheForTests();
    setUiFlag('posOfflineQueue', false);
});

afterEach(() => {
    setUiFlag('posOfflineQueue', false);
    localStorage.clear();
});

describe('Stage 5 scale — offline queue', () => {
    it('10 أجهزة × 100 عملية: الترتيب محفوظ، صفر فقدان/ازدواج', async () => {
        const sentPerDevice: string[][] = [];
        for (let device = 0; device < 10; device++) {
            const key = `karim_offline_queue_v1_device_${device}`;
            const q = createOfflineQueue<{ n: number }>({
                store: localStorageQueueStore(key),
                send: async (_payload, uuid) => {
                    (sentPerDevice[device] ||= []).push(uuid);
                    return { ok: true };
                },
            });
            for (let n = 0; n < 100; n++) {
                await q.enqueue({ n }, `d${device}-s${n}`);
            }
            const result = await q.flush();
            expect(result.processed).toBe(100);
            expect(result.remaining).toBe(0);
            expect(sentPerDevice[device]).toEqual(Array.from({ length: 100 }, (_, n) => `d${device}-s${n}`));
        }
        expect(sentPerDevice).toHaveLength(10);
    });

    it('قطع شبكة ثم عودة: كل المعلّق يُرسل مرة واحدة', async () => {
        let online = false;
        let sends = 0;
        const q = createOfflineQueue<number>({
            store: localStorageQueueStore('karim_offline_queue_v1_cut'),
            baseDelayMs: 0,
            maxDelayMs: 0,
            send: async () => {
                if (!online) {
                    throw new TypeError('Failed to fetch');
                }
                sends++;
                return { ok: true };
            },
        });
        for (let n = 0; n < 25; n++) {
            await q.enqueue(n, `cut-${n}`);
        }
        expect((await q.flush()).failed).toBe(25);
        online = true;
        expect((await q.flush()).processed).toBe(25);
        expect(sends).toBe(25);
        expect((await q.stats()).pending).toBe(0);
    });

    it('انهيار العملية ثم استئنافها: الطابور باقٍ من التخزين', async () => {
        const key = 'karim_offline_queue_v1_crash';
        const q1 = createOfflineQueue<number>({ store: localStorageQueueStore(key), send: async () => ({ ok: true }) });
        for (let n = 0; n < 40; n++) {
            await q1.enqueue(n, `crash-${n}`);
        }
        const q2 = createOfflineQueue<number>({ store: localStorageQueueStore(key), send: async () => ({ ok: true }) });
        expect((await q2.stats()).pending).toBe(40);
        expect((await q2.list())[0]?.local_transaction_uuid).toBe('crash-0');
    });

    it('تكرار النفس uuid لا يُدرج مرتين، وreplay يُغلق بأمان', async () => {
        const q = createOfflineQueue<number>({
            store: localStorageQueueStore('karim_offline_queue_v1_dup'),
            send: async () => ({ ok: true, replay: true }) as SendResult,
        });
        await q.enqueue(1, 'same-key');
        await q.enqueue(1, 'same-key');
        expect((await q.stats()).total).toBe(1);
        const r = await q.flush();
        expect(r.replayed).toBe(1);
        expect((await q.stats()).done).toBe(1);
    });

    it('تجاوز الرصيد (409): تعارض بلا إعادة تلقائية', async () => {
        const q = createOfflineQueue<number>({
            store: localStorageQueueStore('karim_offline_queue_v1_409'),
            send: async () => ({ ok: false, status: 409 }) as SendResult,
        });
        await q.enqueue(1, 'oversell-1');
        const r = await q.flush();
        expect(r.conflicts).toBe(1);
        expect((await q.stats()).conflict).toBe(1);
        await q.flush();
        expect((await q.stats()).conflict).toBe(1); // لم تُعَد تلقائيًا
    });
});

describe('Stage 5 — حد الجهاز', () => {
    it('الحد الافتراضي 100 ويُقرأ من التخزين', () => {
        localStorage.removeItem('karim_pos_offline_limit');
        expect(offlineDeviceLimit()).toBe(100);
        localStorage.setItem('karim_pos_offline_limit', '3');
        expect(offlineDeviceLimit()).toBe(3);
    });

    it('تجاوز الحد يُرفض صراحةً لا صمتًا', async () => {
        setUiFlag('posOfflineQueue', true);
        localStorage.setItem('karim_pos_offline_limit', '2');
        mocks.completePosSale.mockRejectedValue(new TypeError('offline'));
        for (const n of [1, 2]) {
            await expect(submitSaleWithOffline(sale(n))).rejects.toMatchObject({ code: 'SALE_QUEUED_OFFLINE' });
        }
        await expect(submitSaleWithOffline(sale(3))).rejects.toBeInstanceOf(OfflineLimitReachedError);
    });

    it('تعارضات 409 تُعرَض للقرار اليدوي', async () => {
        const q = createOfflineQueue<number>({
            store: localStorageQueueStore('karim_pos_offline_queue_v1'),
            send: async () => ({ ok: false, status: 409 }) as SendResult,
        });
        await q.enqueue(1, 'manual-1');
        await q.flush();
        setUiFlag('posOfflineQueue', true);
        const conflicts = await queuedSaleConflicts();
        expect(conflicts).toHaveLength(1);
    });
});
