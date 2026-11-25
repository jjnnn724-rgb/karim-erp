import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import type { BadgeTone } from './mudad';
import { writeJson } from './write';

/**
 * تشغيل التكامل — سجل المزوّدين وصندوق الصادر والأحداث
 * (`backend/integration/routes.js:125-418`):
 *   GET  /api/integration/health?live=1
 *   GET  /api/integration/providers
 *   PUT  /api/integration/providers/:code/settings   { enabled }  (VERIFIED فقط)
 *   GET  /api/integration/outbox?live=1&status=
 *   POST /api/integration/outbox/:id/retry
 *   POST /api/integration/outbox/:id/review          { decision, reason } (dead_letter فقط)
 *   GET  /api/integration/events?live=1&limit=
 *
 * القراءة admin/manager، والكتابة admin وحده — نفس بوابات الخادم، والخادم يحسم.
 */

export const INTEGRATION_VIEW_ROLES = ['admin', 'manager'] as const;
export const INTEGRATION_WRITE_ROLES = ['admin'] as const;

export const OUTBOX_STATUSES = ['pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

const text = z.string().nullable().optional();
const idText = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? '' : String(value)));
const count = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

export const providerSchema = z
    .object({
        code: z.string(),
        name_ar: text,
        name_en: text,
        verification: text,
        is_enabled: z.boolean().nullable().optional(),
        evidence_note: text,
        last_verified_at: text,
    })
    .passthrough();
export type IntegrationProvider = z.infer<typeof providerSchema>;

const outboxCountsSchema = z
    .object({
        pending: count,
        failed: count,
        dead_letter: count,
        oldest_pending_age_seconds: count,
    })
    .passthrough()
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const integrationHealthSchema = z
    .object({
        providers: z
            .array(providerSchema)
            .nullable()
            .optional()
            .transform((rows) => rows ?? []),
        outbox: outboxCountsSchema,
        infra: z.object({ migration_145: z.boolean().nullable().optional() }).passthrough().nullable().optional(),
        generated_at: text,
    })
    .passthrough();
export type IntegrationHealth = z.infer<typeof integrationHealthSchema>;

export const outboxRowSchema = z
    .object({
        id: idText,
        provider_code: text,
        event_type: text,
        aggregate_type: text,
        aggregate_id: text,
        status: text,
        attempts: count,
        max_attempts: count,
        next_attempt_at: text,
        created_at: text,
        delivered_at: text,
        last_error_code: text,
        payload_sha256: text,
    })
    .passthrough();
export type OutboxRow = z.infer<typeof outboxRowSchema>;

const outboxResponseSchema = z
    .object({
        rows: z
            .array(outboxRowSchema)
            .nullable()
            .optional()
            .transform((rows) => rows ?? []),
    })
    .passthrough();

export const eventRowSchema = z
    .object({
        id: idText,
        outbox_id: idText,
        provider_code: text,
        direction: text,
        outcome: text,
        attempt: count,
        http_status: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined ? null : Number(value))),
        duration_ms: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined ? null : Number(value))),
        error_code: text,
        occurred_at: text,
        actor_user_id: idText,
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .passthrough();
export type IntegrationEvent = z.infer<typeof eventRowSchema>;

const eventsResponseSchema = z
    .object({
        rows: z
            .array(eventRowSchema)
            .nullable()
            .optional()
            .transform((rows) => rows ?? []),
    })
    .passthrough();

const writeAckLooseSchema = z.object({ ok: z.boolean().optional() }).passthrough();

export const credentialRotationSchema = z
    .object({
        ok: z.boolean().optional(),
        key_name: z.string().optional(),
        rotated_at: text,
        rotated: z.boolean().nullable().optional(),
    })
    .passthrough();
export type CredentialRotation = z.infer<typeof credentialRotationSchema>;

/* ─── القراءة ──────────────────────────────────────────────────────────── */

function authOptions(signal?: AbortSignal) {
    return signal ? { signal } : {};
}

export async function fetchIntegrationHealth(signal?: AbortSignal): Promise<IntegrationHealth> {
    return fetchJson(integrationHealthSchema, '/api/integration/health?live=1', getAccessToken(), authOptions(signal));
}

export async function fetchIntegrationOutbox(status: OutboxStatus | '', signal?: AbortSignal, provider?: string): Promise<OutboxRow[]> {
    const params = new URLSearchParams({ live: '1', limit: '50' });
    if (status) {
        params.set('status', status);
    }
    if (provider) {
        params.set('provider', provider);
    }
    const body = await fetchJson(
        outboxResponseSchema,
        `/api/integration/outbox?${params.toString()}`,
        getAccessToken(),
        authOptions(signal),
    );
    return body.rows;
}

export async function fetchIntegrationEvents(limit = 20, signal?: AbortSignal): Promise<IntegrationEvent[]> {
    const safe = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
    const body = await fetchJson(
        eventsResponseSchema,
        `/api/integration/events?live=1&limit=${safe}`,
        getAccessToken(),
        authOptions(signal),
    );
    return body.rows;
}

/* ─── الكتابة ──────────────────────────────────────────────────────────── */

export async function setIntegrationProviderEnabled(code: string, enabled: boolean): Promise<z.infer<typeof writeAckLooseSchema>> {
    return writeJson(writeAckLooseSchema, `/api/integration/providers/${encodeURIComponent(code)}/settings`, 'PUT', {
        enabled,
    });
}

export async function retryIntegrationRow(id: string | number): Promise<z.infer<typeof writeAckLooseSchema>> {
    return writeJson(writeAckLooseSchema, `/api/integration/outbox/${encodeURIComponent(String(id))}/retry`, 'POST');
}

export type ReviewDecision = 'retry' | 'abandon';

export async function reviewIntegrationRow(
    id: string | number,
    decision: ReviewDecision,
    reason: string,
): Promise<z.infer<typeof writeAckLooseSchema>> {
    return writeJson(writeAckLooseSchema, `/api/integration/outbox/${encodeURIComponent(String(id))}/review`, 'POST', {
        decision,
        reason: reason.trim(),
    });
}

/* ─── تدوير الاعتمادات (كتابة فقط — لا تُقرأ القيم أبدًا) ───────────────── */

/** مزوّدو التكامل الأربعة — نفس `PROVIDER_CODES` في `backend/integration/lib.js`. */
export const INTEGRATION_PROVIDER_CODES = ['zatca', 'mudad', 'gosi', 'qiwa'] as const;
export type IntegrationProviderCode = (typeof INTEGRATION_PROVIDER_CODES)[number];

/** `KEY_NAME_RE` في الخادم: حرف لاتيني صغير أولًا، ثم أحرف/رقام/._ بطول 2–64. */
export const CREDENTIAL_KEY_RE = /^[a-z][a-z0-9_.]{1,63}$/;

/** طول قيمة الاعتماد كما يطلب الخادم (8–8192). */
export const CREDENTIAL_VALUE_MIN = 8;
export const CREDENTIAL_VALUE_MAX = 8192;

/**
 * تدوير اعتماد لمزوّد — `PUT /api/integration/credentials/:provider/:key`.
 *
 * الكتابة فقط: القيمة تُرسل ولا تُقرأ ولا تُخزَّن؛ الخادم يبطل الاعتماد
 * السابق ويسجّل الحدث `credential.rotated`.
 */
export async function rotateIntegrationCredential(
    provider: IntegrationProviderCode,
    key: string,
    value: string,
): Promise<CredentialRotation> {
    return writeJson(
        credentialRotationSchema,
        `/api/integration/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(key)}`,
        'PUT',
        { value },
    );
}

/* ─── الدلالات والتسميات — من V2 `compliance.js:90-165` حرفيًّا ────────── */

export type ProviderVerification = { label: string; tone: BadgeTone };

export function providerVerification(value: string | null | undefined): ProviderVerification {
    const code = String(value ?? '').trim();
    if (code === 'VERIFIED') {
        return { label: 'موثّق', tone: 'success' };
    }
    if (code === 'INFERRED') {
        return { label: 'مستنتج', tone: 'warning' };
    }
    if (code === 'BLOCKED') {
        return { label: 'محظور', tone: 'danger' };
    }
    if (code === 'UNVERIFIED') {
        return { label: 'غير موثّق', tone: 'neutral' };
    }
    return { label: code || '—', tone: 'neutral' };
}

export function outboxStatusLabel(value: string | null | undefined): string {
    const code = String(value ?? '').trim();
    const labels: Record<string, string> = {
        pending: 'معلّق',
        processing: 'قيد المعالجة',
        delivered: 'مُسلَّم',
        failed: 'فاشل',
        dead_letter: 'ميت',
        cancelled: 'ملغى',
    };
    return labels[code] ?? (code || '—');
}

export function outboxRetryable(status: string | null | undefined): boolean {
    return ['failed', 'dead_letter'].includes(String(status ?? '').trim());
}

export function outboxReviewable(status: string | null | undefined): boolean {
    return String(status ?? '').trim() === 'dead_letter';
}

export function providerToggleAllowed(provider: IntegrationProvider): boolean {
    return String(provider.verification ?? '').trim() === 'VERIFIED';
}

/** مدة الانتظار كما في V2 `ageText` (compliance.js:63). */
export function ageText(seconds: number): string {
    const value = Math.max(0, Math.trunc(Number(seconds) || 0));
    if (value < 60) {
        return `${value} ث`;
    }
    if (value < 3600) {
        return `${Math.floor(value / 60)} د`;
    }
    return `${Math.floor(value / 3600)} س`;
}

export function eventDirectionLabel(value: string | null | undefined): string {
    const code = String(value ?? '').trim();
    return code === 'internal' ? 'داخلي' : code === 'outbound' ? 'صادر' : code === 'inbound' ? 'وارد' : code || '—';
}

export function eventOutcomeLabel(value: string | null | undefined): string {
    const code = String(value ?? '').trim();
    return code === 'success' ? 'نجاح' : code === 'failure' ? 'فشل' : code === 'skipped' ? 'تخطٍ' : code || '—';
}

/* ─── تحقق نموذج الاعتماد (مطابق لـ `backend/integration/routes.js:214`) ─── */

export type CredentialForm = { key: string; value: string };

export type CredentialValidation = { ok: true; key: string; value: string } | { ok: false; message: string };

/**
 * تحقق محلي قبل الإرسال — نفس شروط الخادم:
 *  - اسم المفتاح `KEY_NAME_RE`: حرف لاتيني صغير أولًا.
 *  - القيمة سلسلة بطول 8–8192 حرفًا.
 * القيمة لا تُسجَّل ولا تُعاد في الرسالة.
 */
export function validateCredentialForm(form: CredentialForm): CredentialValidation {
    const key = String(form.key ?? '').trim();
    const value = String(form.value ?? '');
    if (!key) {
        return { ok: false, message: 'اسم مفتاح الاعتماد مطلوب.' };
    }
    if (!CREDENTIAL_KEY_RE.test(key)) {
        return { ok: false, message: 'اسم المفتاح يبدأ بحرف لاتيني صغير، ثم أحرف أو أرقام أو . _ بطول 2–64.' };
    }
    if (value.length < CREDENTIAL_VALUE_MIN || value.length > CREDENTIAL_VALUE_MAX) {
        return { ok: false, message: `قيمة الاعتماد بطول ${CREDENTIAL_VALUE_MIN} إلى ${CREDENTIAL_VALUE_MAX} حرفًا.` };
    }
    return { ok: true, key, value };
}
