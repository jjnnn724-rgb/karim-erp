import { describe, expect, it, vi } from 'vitest';
import {
    createOfflineQueue,
    OfflineQueueCorruptError,
    type OfflineQueueStore,
    type SendResult,
} from './offline-queue';

function memoryStore(shared?: { value: string }): OfflineQueueStore & { value: { value: string } } {
    const value = shared ?? { value: '' };
    return {
        value,
        async read() { return value.value || null; },
        async write(next) { value.value = next; },
    };
}

interface Sale { id: string; total: number }

function harness(shared = { value: '' }, sendImpl?: (payload: Sale, uuid: string) => Promise<SendResult>) {
    let clock = Date.parse('2026-11-23T10:00:00Z');
    const now = () => clock;
    const sent: Array<{ uuid: string; payload: Sale }> = [];
    const send = vi.fn(async (payload: Sale, uuid: string) => {
        sent.push({ uuid, payload });
        return sendImpl ? sendImpl(payload, uuid) : { ok: true };
    });
    const queue = createOfflineQueue<Sale>({
        store: memoryStore(shared),
        send,
        now,
        newUuid: (() => {
            let i = 0;
            return () => `uuid-${++i}`;
        })(),
        baseDelayMs: 1000,
    });
    return { queue, send, sent, advance: (ms: number) => { clock += ms; } };
}

describe('offline queue — Stage 5 acceptance', () => {
    it('dedupe: نفس local_transaction_uuid لا يُدرج مرتين', async () => {
        const { queue } = harness();
        await queue.enqueue({ id: 'sale-1', total: 10 }, 'local-1');
        await queue.enqueue({ id: 'sale-1', total: 10 }, 'local-1');
        expect((await queue.stats()).total).toBe(1);
    });

    it('انقطاع ⇒ إعادة اتصال ⇒ إعادة تشغيل: صفر فقد وصفر تكرار', async () => {
        const shared = { value: '' };
        const first = harness(shared, async () => { throw new Error('network down'); });
        await first.queue.enqueue({ id: 'sale-1', total: 10 }, 'local-1');
        await first.queue.enqueue({ id: 'sale-2', total: 20 }, 'local-2');
        let result = await first.queue.flush();
        expect(result.failed).toBe(2);
        expect(result.remaining).toBe(2);

        // restart: moduli جديد على نفس المتجر
        const second = harness(shared, async () => ({ ok: true }));
        expect((await second.queue.stats()).pending).toBe(2);
        second.advance(1000); // احترام الـbackoff بعد إعادة التشغيل
        result = await second.queue.flush();
        expect(result.processed).toBe(2);
        expect(second.sent.map((s) => s.uuid).sort()).toEqual(['local-1', 'local-2']);
        expect(new Set(second.sent.map((s) => s.uuid)).size).toBe(2);
        expect((await second.queue.stats()).done).toBe(2);
    });

    it('backoff أُسّي بسقف، ولا إرسال قبل موعد المحاولة', async () => {
        const { queue, send, advance } = harness(undefined, async () => { throw new Error('500'); });
        await queue.enqueue({ id: 'x', total: 1 }, 'local-1');
        await queue.flush();
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(1);
        advance(999);
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(1);
        advance(1);
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('تعارض مخزون (409) يحتاج قرارًا بشريًا — لا إعادة تلقائية', async () => {
        const { queue, send, advance } = harness(undefined, async () => ({ ok: false, status: 409 }));
        await queue.enqueue({ id: 'conflict', total: 5 }, 'local-1');
        const result = await queue.flush();
        expect(result.conflicts).toBe(1);
        advance(60000);
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(1);
        await queue.resolveConflict('local-1', 'retry');
        expect((await queue.stats()).pending).toBe(1);
        await queue.flush();
        expect((await queue.stats()).conflict).toBe(1);
    });

    it('إعادة إرسال بعد رد الخادم replay تُغلق بلا عملية ثانية', async () => {
        const { queue } = harness(undefined, async () => ({ ok: true, replay: true, status: 200 }));
        await queue.enqueue({ id: 'r', total: 7 }, 'local-1');
        const result = await queue.flush();
        expect(result.replayed).toBe(1);
        expect((await queue.stats()).done).toBe(1);
    });

    it('مزامنة جزئية: واحدة تنجح وواحدة تفشل — الباقي محفوظ', async () => {
        const shared = { value: '' };
        const { queue } = harness(shared, async (payload) =>
            payload.id === 'ok' ? { ok: true } : { ok: false, status: 503 });
        await queue.enqueue({ id: 'ok', total: 1 }, 'a');
        await queue.enqueue({ id: 'bad', total: 2 }, 'b');
        const result = await queue.flush();
        expect(result.processed).toBe(1);
        expect(result.failed).toBe(1);
        expect((await queue.stats()).done).toBe(1);
        expect((await queue.stats()).pending).toBe(1);
    });

    it('تخزين تالف = خطأ صريح، لا إعادة تعيين صامتة', async () => {
        const broken: OfflineQueueStore = {
            async read() { return '{not json'; },
            async write() { /* لا شيء */ },
        };
        const queue = createOfflineQueue<Sale>({ store: broken, send: async () => ({ ok: true }) });
        await expect(queue.list()).rejects.toBeInstanceOf(OfflineQueueCorruptError);
    });

    it('Idempotency-Key يُمرَّر للخادم مع كل إرسال', async () => {
        const { queue, send } = harness();
        await queue.enqueue({ id: 'k', total: 3 }, 'local-key-9');
        await queue.flush();
        expect(send.mock.calls[0]?.[1]).toBe('local-key-9');
    });

    it('جهازان: بيعان متزامنان، واحد يُرفض بالرصيد — لا فقد ولا ازدواج', async () => {
        const deviceA = harness({ value: '' }, async () => ({ ok: true }));
        const deviceB = harness({ value: '' }, async () => ({ ok: false, status: 409 }));
        await Promise.all([
            deviceA.queue.enqueue({ id: 'sale-A', total: 50 }, 'dev-A-1'),
            deviceB.queue.enqueue({ id: 'sale-B', total: 50 }, 'dev-B-1'),
        ]);
        const [a, b] = await Promise.all([deviceA.queue.flush(), deviceB.queue.flush()]);
        expect(a.processed).toBe(1);
        expect(b.conflicts).toBe(1);
        expect(deviceA.sent.map((s) => s.uuid)).toEqual(['dev-A-1']);
        expect(deviceB.sent.map((s) => s.uuid)).toEqual(['dev-B-1']);
        expect((await deviceB.queue.stats()).conflict).toBe(1);
        expect((await deviceB.queue.stats()).done).toBe(0);
    });
});
