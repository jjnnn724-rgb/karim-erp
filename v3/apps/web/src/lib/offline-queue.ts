/**
 * offline-queue.ts — طابور محلي متين للبيعات وقت انقطاع الاتصال (Stage 5).
 *
 * القواعد:
 *  · كل عملية لها `local_transaction_uuid` ثابت — يُرسل كـIdempotency-Key؛
 *    إعادة الإرسال لا تخلق عملية ثانية في الخادم.
 *  · الحالة تُحفظ في المتجر بعد كل تغيير (crash recovery بلا فقدان صامت).
 *  · تعذّر القراءة/التحليل = خطأ صريح QUEUE_CORRUPT — لا نُعيد تعيين الطابور.
 *  · 4xx (غير 408/429) = conflict ⇒ قرار بشري صريح، لا إعادة تلقائية.
 *  · 5xx/شبكة = pending مع backoff أُسّي محدد بسقف.
 *  · الخادم يظل الحاكم: لا تخصم مخزون محليًا ولا رقم ضريبي نهائي offline.
 */
export interface OfflineQueueStore {
    read(): Promise<string | null>;
    write(value: string): Promise<void>;
}

export interface SendResult {
    ok: boolean;
    status?: number;
    replay?: boolean;
}

export type QueueStatus = 'pending' | 'conflict' | 'done' | 'discarded';

export interface QueueEntry {
    local_transaction_uuid: string;
    payload: unknown;
    created_at: string;
    updated_at: string;
    attempts: number;
    next_attempt_at: string;
    status: QueueStatus;
    last_error?: string;
}

export interface FlushResult {
    processed: number;
    replayed: number;
    conflicts: number;
    failed: number;
    remaining: number;
}

export interface OfflineQueueOptions<T> {
    store: OfflineQueueStore;
    send: (payload: T, localTransactionUuid: string) => Promise<SendResult>;
    now?: () => number;
    newUuid?: () => string;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

const KEY = 'karim_offline_queue_v1';

export class OfflineQueueCorruptError extends Error {
    readonly code = 'QUEUE_CORRUPT';
}

function isEntry(value: unknown): value is QueueEntry {
    if (!value || typeof value !== 'object') {return false;}
    const row = value as Partial<QueueEntry>;
    return typeof row.local_transaction_uuid === 'string' && row.local_transaction_uuid.length > 0
        && typeof row.created_at === 'string'
        && typeof row.attempts === 'number'
        && ['pending', 'conflict', 'done', 'discarded'].includes(String(row.status));
}

export function createOfflineQueue<T>(options: OfflineQueueOptions<T>) {
    const now = options.now ?? Date.now;
    const newUuid = options.newUuid ?? (() => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const baseDelay = options.baseDelayMs ?? 1000;
    const maxDelay = options.maxDelayMs ?? 60000;
    let entries: QueueEntry[] | null = null;

    async function load(): Promise<QueueEntry[]> {
        if (entries) {return entries;}
        const raw = await options.store.read();
        if (raw === null || raw === '') {
            entries = [];
            return entries;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed) || !parsed.every(isEntry)) {throw new Error('invalid shape');}
            entries = parsed as QueueEntry[];
            return entries;
        } catch (error) {
            throw new OfflineQueueCorruptError(`OFFLINE_QUEUE_CORRUPT: ${String((error as Error).message)}`);
        }
    }

    async function persist(): Promise<void> {
        await options.store.write(JSON.stringify(entries ?? []));
    }

    function nextAttemptAfter(attempts: number): string {
        const delay = Math.min(maxDelay, baseDelay * (2 ** Math.max(0, attempts - 1)));
        return new Date(now() + delay).toISOString();
    }

    async function enqueue(payload: T, localTransactionUuid?: string): Promise<QueueEntry> {
        const rows = await load();
        const uuid = localTransactionUuid || newUuid();
        const existing = rows.find((row) => row.local_transaction_uuid === uuid);
        if (existing) {return existing;} // dedupe: نفس العملية لا تُدرج مرتين
        const stamp = new Date(now()).toISOString();
        const entry: QueueEntry = {
            local_transaction_uuid: uuid,
            payload,
            created_at: stamp,
            updated_at: stamp,
            attempts: 0,
            next_attempt_at: stamp,
            status: 'pending',
        };
        rows.push(entry);
        await persist();
        return entry;
    }

    async function list(): Promise<readonly QueueEntry[]> {
        return [...(await load())];
    }

    async function stats() {
        const rows = await load();
        return {
            pending: rows.filter((r) => r.status === 'pending').length,
            conflict: rows.filter((r) => r.status === 'conflict').length,
            done: rows.filter((r) => r.status === 'done').length,
            discarded: rows.filter((r) => r.status === 'discarded').length,
            total: rows.length,
        };
    }

    async function flush(): Promise<FlushResult> {
        const rows = await load();
        const result: FlushResult = { processed: 0, replayed: 0, conflicts: 0, failed: 0, remaining: 0 };
        const current = now();
        for (const entry of rows) {
            if (entry.status !== 'pending' || Date.parse(entry.next_attempt_at) > current) {continue;}
            entry.attempts += 1;
            entry.updated_at = new Date(now()).toISOString();
            try {
                const sent = await options.send(entry.payload as T, entry.local_transaction_uuid);
                if (sent.replay) {
                    // الخادم أكد أنه رأى العملية من قبل (idempotent replay) — إغلاق آمن.
                    entry.status = 'done';
                    result.replayed += 1;
                } else if (sent.ok) {
                    entry.status = 'done';
                    result.processed += 1;
                } else {
                    const status = sent.status ?? 0;
                    const conflict = status >= 400 && status < 500 && status !== 408 && status !== 429;
                    entry.status = conflict ? 'conflict' : 'pending';
                    entry.last_error = `HTTP_${status || 'NETWORK'}`;
                    if (conflict) {result.conflicts += 1;} else {
                        result.failed += 1;
                        entry.next_attempt_at = nextAttemptAfter(entry.attempts);
                    }
                }
            } catch (error) {
                entry.status = 'pending';
                entry.last_error = String((error as Error).message).slice(0, 300);
                entry.next_attempt_at = nextAttemptAfter(entry.attempts);
                result.failed += 1;
            }
            await persist(); // كل حالة تُحفظ فورًا — لا فقدان عند انهيار العملية
        }
        result.remaining = (await stats()).pending;
        return result;
    }

    /** قرار بشري صريح: إعادة جدولة أو إلغاء موثّق — لا شيء تلقائي. */
    async function resolveConflict(uuid: string, action: 'retry' | 'discard'): Promise<QueueEntry | null> {
        const rows = await load();
        const entry = rows.find((r) => r.local_transaction_uuid === uuid && r.status === 'conflict');
        if (!entry) {return null;}
        if (action === 'retry') {
            entry.status = 'pending';
            entry.attempts = 0;
            entry.next_attempt_at = new Date(now()).toISOString();
        } else {
            entry.status = 'discarded';
        }
        entry.updated_at = new Date(now()).toISOString();
        await persist();
        return entry;
    }

    async function clearDone(): Promise<number> {
        const rows = await load();
        const before = rows.length;
        entries = rows.filter((r) => r.status !== 'done' && r.status !== 'discarded');
        await persist();
        return before - entries.length;
    }

    /** إعادة قراءة المتجر من القرص (مفيد بعد تغييره خارج الطابور أو في الاختبارات). */
    function reload(): void {
        entries = null;
    }

    return { enqueue, list, stats, flush, resolveConflict, clearDone, reload };
}

/** متجر localStorage — يستمر في userData تحت Electron، ويُستخدم في المتصفح للاختبار. */
export function localStorageQueueStore(key = KEY): OfflineQueueStore {
    return {
        async read() { return globalThis.localStorage?.getItem(key) ?? null; },
        async write(value) { globalThis.localStorage?.setItem(key, value); },
    };
}
