/**
 * عقد الكتابة المحاسبية — منافذ لا تنفيذ (ADR-07).
 *
 * المنفذ نفسه ينفّذه adapter في `backend/v3-write-adapter.js` يستدعي
 * `postJournal` و`voidJournalById` و`buildVatSettlementPlan` القديمة نفسها؛
 * لا نسخة ثانية من منطق الترحيل في TypeScript. لذلك نتيجة المنفذ هي
 * `{ status, body }` حرفيًا كما ينتجها مسار القديم — وطبقة Hono تنقلها
 * بلا إعادة تفسير. أي اختلاف في الأكواد أو الرسائل يكشفه shadow diff.
 *
 * `date` و`lines` و`source_id` تبقى `unknown` في العقد: التحقق منها —
 * برسائله وأكواده (422) — ملك القديم، وتكراره هنا يخلق نسختين تتباعدان.
 */

export interface JournalWriteRequest {
    date?: unknown;
    memo?: unknown;
    source_id?: unknown;
    lines?: unknown;
    status?: unknown;
    /** الفاعل من `jwtAuth` القديم — لا يُقرأ من جسم الطلب أبدًا. */
    created_by?: number | null;
    /** مفتاح idempotency القادم من `Idempotency-Key`؛ يُحل قبل مناداة القديم. */
    idempotency_key?: unknown;
}

export interface VoidJournalRequest {
    reason?: unknown;
    /** الفاعل من `jwtAuth` القديم — لا يُقرأ من جسم الطلب أبدًا. */
    actor_user_id?: number | null;
}

export interface VatSettlementWriteRequest {
    month?: unknown;
    apply?: unknown;
    /** الفاعل من `jwtAuth` القديم — لا يُقرأ من جسم الطلب أبدًا. */
    created_by?: number | null;
}

/** نتيجة مسار قديم: الحالة والجسم كما يكتبهما Express حرفيًا. */
export interface LegacyRouteResult {
    status: number;
    body: unknown;
}

/** بث `entity_changed` القديم — يُمرَّر من الجسر، وقد يغيب في الاختبارات. */
export type EntityChangeNotifier = (payload: unknown) => void;

export interface AccountingWritePort {
    /** `POST /journal` القديم — manual + `repostVoided: true` + بصمة المحتوى. */
    postJournal(input: JournalWriteRequest): Promise<LegacyRouteResult>;
    /** `POST /journal/:id/void` القديم — إبطال لا حذف، وقفل الفترة 423. */
    voidJournal(entryId: string, input: VoidJournalRequest, notify?: EntityChangeNotifier): Promise<LegacyRouteResult>;
    /** `POST /vat-settlement` القديم — معاينة/ترحيل، والإعادة replay لا تكرار. */
    vatSettlement(input: VatSettlementWriteRequest): Promise<LegacyRouteResult>;
}

/** أدوار الكتابة — مطابقة لـ`WRITE_ROLES` في `backend/accounting-routes.js:27`. */
export const ACCOUNTING_WRITE_ROLES = ['admin', 'accountant'] as const;

export type AccountingWriteRole = (typeof ACCOUNTING_WRITE_ROLES)[number];

/**
 * مفتاح idempotency: محارف آمنة للنقل والتسجيل، حتى 200 محرف. المفتاح الفارغ
 * يعني «لا مفتاح» (نفس سلوك ترويسة غائبة) بدل رفض طلب سليم.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export type JournalSourceIdResult =
    | { ok: true; source_id: string | null; keyed: boolean }
    | { ok: false; status: 422; error: 'IDEMPOTENCY_KEY_INVALID' | 'IDEMPOTENCY_KEY_CONFLICT'; message: string };

/**
 * حل مرجع المصدر من جسم الطلب ومفتاح idempotency.
 *
 * المفتاح يصير `source_id = 'idem:<key>'`، فيصبح التكرار سباقًا على
 * `uq_journal_source` لا بصمة محتوى مؤقتة (10 دقائق): إعادة الطلب بعد أي
 * مدة ترجع الموجود، وطلب متزامن بنفس المفتاح يُعيد المُدرَج الأول.
 *
 * `source_id` الصريح يبقى كما هو حين لا مفتاح. وإذا وُجد الاثنان فيجب أن
 * يتطابقا — تجاهل أحدهما بصمت يجعل «إعادة الطلب بنفس المفتاح» غير مضمونة.
 */
export function resolveJournalSourceId({
    source_id,
    idempotency_key,
}: {
    source_id?: unknown;
    idempotency_key?: unknown;
}): JournalSourceIdResult {
    const explicit = source_id == null ? null : String(source_id).trim() || null;
    const key = idempotency_key == null ? '' : String(idempotency_key).trim();
    if (key === '') {
        return { ok: true, source_id: explicit, keyed: false };
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
        return {
            ok: false,
            status: 422,
            error: 'IDEMPOTENCY_KEY_INVALID',
            message: 'مفتاح idempotency غير صالح (حتى 200 محرف: حروف/أرقام/.-_:)',
        };
    }
    const derived = `idem:${key}`;
    if (explicit !== null && explicit !== derived) {
        return {
            ok: false,
            status: 422,
            error: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'source_id الممرَّر يخالف مفتاح idempotency — أرسل أحدهما فقط',
        };
    }
    return { ok: true, source_id: derived, keyed: true };
}
