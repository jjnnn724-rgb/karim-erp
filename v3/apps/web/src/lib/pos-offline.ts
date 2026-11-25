/**
 * pos-offline.ts — ربط طابور Stage 5 بنقطة البيع (Stage 9 flag).
 *
 * الخادم يظل الحاكم: لا خصم مخزون محليًا ولا رقم ضريبي نهائي offline.
 * البيع يُحفظ كـ"نية" بمفتاح idempotency ثابت، ويُرسل عند عودة الاتصال.
 * المفتاح `posOfflineQueue` مغلق افتراضيًا ⇒ مسار البيع القديم كما كان.
 */
import { ApiError } from './api';
import { createOfflineQueue, localStorageQueueStore, type FlushResult } from './offline-queue';
import { completePosSale, type CompleteSaleInput, type PosSaleResult } from './pos';
import { isUiFlagOn } from './ui-flags';

const STORE_KEY = 'karim_pos_offline_queue_v1';

export class SaleQueuedOfflineError extends Error {
    readonly code = 'SALE_QUEUED_OFFLINE';
    constructor(readonly localTransactionUuid: string) {
        super('تم حفظ البيع محليًا وسيُرسل تلقائيًا عند عودة الاتصال.');
        this.name = 'SaleQueuedOfflineError';
    }
}

/** تجاوز حد الجهاز — يُرفض صراحةً بدل تضخيم الطابور بلا سقف. */
export class OfflineLimitReachedError extends Error {
    readonly code = 'OFFLINE_DEVICE_LIMIT';
    constructor(readonly limit: number) {
        super(`تجاوزت حد المبيعات المعلقة على هذا الجهاز (${limit}). راجع المعلّق قبل المتابعة.`);
        this.name = 'OfflineLimitReachedError';
    }
}

const LIMIT_KEY = 'karim_pos_offline_limit';

/** حد لكل جهاز (قابل للضبط محليًا). التهيئة لكل مستأجر من الخادم = قرار معماري لم يُنفّذ. */
export function offlineDeviceLimit(): number {
    try {
        const raw = globalThis.localStorage?.getItem(LIMIT_KEY);
        const value = Number(raw);
        return Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : 100;
    } catch {
        return 100;
    }
}

/** Electron renderer — الـstore في localStorage يستمر تحت userData تلقائيًا. */
export function isElectronRenderer(): boolean {
    return typeof window !== 'undefined' && Boolean((window as unknown as { electronAPI?: unknown }).electronAPI);
}

export function isNetworkFailure(error: unknown): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {return true;}
    if (error instanceof ApiError) {return false;} // الخادم ردّ — خطأ عمل/صلاحية
    if (error instanceof TypeError) {return true;}
    const text = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
    return /network|fetch|enotfound|econnrefused|timeout|offline/.test(text);
}

const queue = createOfflineQueue<CompleteSaleInput>({
    store: localStorageQueueStore(STORE_KEY),
    send: async (payload, localTransactionUuid) => {
        await completePosSale({ ...payload, idempotencyKey: localTransactionUuid });
        return { ok: true };
    },
});

export async function submitSaleWithOffline(input: CompleteSaleInput): Promise<PosSaleResult> {
    if (!isUiFlagOn('posOfflineQueue')) {return completePosSale(input);}
    try {
        return await completePosSale(input);
    } catch (error) {
        if (!isNetworkFailure(error)) {throw error;}
        const existing = (await queue.list()).some((row) => row.local_transaction_uuid === input.idempotencyKey);
        if (!existing && (await queuedSalesCount()) >= offlineDeviceLimit()) {
            throw new OfflineLimitReachedError(offlineDeviceLimit());
        }
        await queue.enqueue(input, input.idempotencyKey);
        throw new SaleQueuedOfflineError(input.idempotencyKey);
    }
}

export function flushQueuedSales(): Promise<FlushResult> {
    return queue.flush();
}

export function queuedSalesCount(): Promise<number> {
    return queue.stats().then((stats) => stats.pending + stats.conflict);
}

/** إيصال مؤقت وقت الانقطاع — بلا رقم ضريبي نهائي (B1.3). */
export function offlineReceiptLines(localTransactionUuid: string): string[] {
    return [
        'PENDING FISCAL',
        `LOCAL: ${localTransactionUuid}`,
        'سيُستبدل برقم ضريبي من الخادم عند المزامنة.',
    ];
}

/** تعارضات 409 تحتاج قرارًا بشريًا صريحًا — لا إعادة تلقائية. */
export function queuedSaleConflicts() {
    return queue.list().then((rows) => rows.filter((row) => row.status === 'conflict'));
}

export function resolveQueuedSale(localTransactionUuid: string, action: 'retry' | 'discard') {
    return queue.resolveConflict(localTransactionUuid, action);
}

/** للاختبارات فقط: إعادة قراءة المتجر بعد مسحه. */
export function resetPosOfflineCacheForTests(): void {
    queue.reload();
}
