import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { writeAck, writeJson } from './write';

/**
 * الجرد الفعلي للمخزون — ربط V3 بمسارات «استوديو الجرد» الجاهزة على الخادم
 * (`backend/stocktaking-routes.js` + `inventory-control-routes.js`) تحت
 * `/api/warehouse/inventory/...`.
 *
 * هذه هي أكبر فجوة في جرد V2→V3 (docs/phase-0/v3-parity-audit.md §2-1):
 * الخادم يملك دورة كاملة (جلسة → عدّ → إرسال موقّع → اعتماد يترحّل الفروق)،
 * وكانت الواجهة تفتقدها فتُغلق الجلسات من V2 أو يدويًا.
 *
 * العقود كما هي في الخادم حرفيًّا:
 *   GET    /api/warehouse/inventory/audits                    → Audit[]
 *   GET    /api/warehouse/inventory/audits/:id                → {audit, items, progress, summary, events}
 *   POST   /api/warehouse/inventory/audits                    → {audit, itemCount, location}
 *   POST   /api/warehouse/inventory/audits/:id/counts         → {saved_count, rejected[], counted_items}
 *   POST   /api/warehouse/inventory/audits/:id/submit         → Audit   (توقيع إلزامي)
 *   POST   /api/warehouse/inventory/audits/:id/approve        → Audit   (توقيع إلزامي)
 *   POST   /api/warehouse/inventory/audits/:id/cancel         → Audit   (سبب ≥ 3 أحرف)
 *   GET    /api/warehouse/inventory/locations                 → Location[]
 *
 * الأدوار من الخادم نفسه: قراءة = admin|manager|warehouse|accountant،
 * كتابة = admin|manager|warehouse. `admin` ليس ضمنيًّا في أي قائمة أخرى.
 */

const BASE = '/api/warehouse/inventory';

const idSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const numberish = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

export const auditStatusSchema = z.enum(['draft', 'submitted', 'approved', 'cancelled']);

export const auditSchema = z
    .object({
        id: idSchema,
        audit_number: z.string().nullable().optional(),
        status: z.string(),
        warehouse_scope: z.string().nullable().optional(),
        location_id: z.union([z.string(), z.number()]).nullable().optional(),
        location_name: z.string().nullable().optional(),
        counted_at: z.string().nullable().optional(),
        created_at: z.string().nullable().optional(),
        created_by: z.union([z.string(), z.number()]).nullable().optional(),
        notes: z.string().nullable().optional(),
        total_items: numberish,
        counted_items: numberish,
        item_count: numberish,
        period_type: z.string().nullable().optional(),
        period_start: z.string().nullable().optional(),
        period_end: z.string().nullable().optional(),
        submit_signature_hash: z.string().nullable().optional(),
        approval_signature_hash: z.string().nullable().optional(),
    })
    .passthrough();

export type InventoryAudit = z.infer<typeof auditSchema>;

const auditListSchema = z.array(auditSchema);

export const auditItemSchema = z
    .object({
        id: numberish,
        item_id: numberish,
        item_name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        system_qty: numberish,
        counted_qty: numberish,
        variance_qty: numberish,
        avg_cost: numberish,
        variance_value: numberish,
        live_qty: numberish,
        notes: z.string().nullable().optional(),
        counted_at: z.string().nullable().optional(),
        is_counted: z.boolean().optional(),
        is_stale: z.boolean().optional(),
        category: z.string().nullable().optional(),
        barcode: z.string().nullable().optional(),
        location_name: z.string().nullable().optional(),
    })
    .passthrough();

export type AuditItem = z.infer<typeof auditItemSchema>;

const auditDetailSchema = z
    .object({
        audit: auditSchema,
        items: z.array(auditItemSchema),
        progress: z
            .object({
                total: numberish,
                counted: numberish,
                remaining: numberish,
                percent: numberish,
            })
            .passthrough()
            .optional(),
        summary: z
            .object({
                items_with_variance: numberish,
                shortage_items: numberish,
                surplus_items: numberish,
                projected_variance_value: numberish,
                stale_items: numberish,
            })
            .passthrough()
            .optional(),
        events: z.array(z.unknown()).optional(),
        location_name: z.string().nullable().optional(),
    })
    .passthrough();

export type AuditDetail = z.infer<typeof auditDetailSchema>;

const locationSchema = z
    .object({
        id: idSchema,
        code: z.string().nullable().optional(),
        name_ar: z.string().nullable().optional(),
        location_type: z.string().nullable().optional(),
        dept_code: z.string().nullable().optional(),
        dept_name: z.string().nullable().optional(),
        items_count: numberish,
        on_hand_value: numberish,
        on_hand_qty: numberish,
    })
    .passthrough();

export type AuditLocation = z.infer<typeof locationSchema>;

const locationsSchema = z.array(locationSchema);

const saveCountsSchema = z
    .object({
        saved_count: numberish,
        rejected: z
            .array(
                z
                    .object({
                        itemId: z.union([z.string(), z.number()]).optional(),
                        reason: z.string().optional(),
                    })
                    .passthrough(),
            )
            .optional(),
        counted_items: numberish,
    })
    .passthrough();

export interface AuditCountResult {
    savedCount: number;
    rejectedCount: number;
    rejectedReasons: string[];
    countedItems: number;
}

export type AuditWriteRole = 'admin' | 'manager' | 'warehouse';
export const AUDIT_WRITE_ROLES: readonly string[] = ['admin', 'manager', 'warehouse'];
export const AUDIT_READ_ROLES: readonly string[] = ['admin', 'manager', 'warehouse', 'accountant'];

export function canWriteAudit(role: string | null | undefined): boolean {
    return AUDIT_WRITE_ROLES.includes(String(role ?? '').trim());
}

export function canReadAudit(role: string | null | undefined): boolean {
    return AUDIT_READ_ROLES.includes(String(role ?? '').trim());
}

export async function fetchInventoryAudits(signal?: AbortSignal): Promise<InventoryAudit[]> {
    return fetchJson(auditListSchema, `${BASE}/audits`, getAccessToken(), signal ? { signal } : {});
}

export async function fetchAuditLocations(signal?: AbortSignal): Promise<AuditLocation[]> {
    return fetchJson(locationsSchema, `${BASE}/locations`, getAccessToken(), signal ? { signal } : {});
}

export async function fetchAuditDetail(id: string, signal?: AbortSignal): Promise<AuditDetail> {
    return fetchJson(auditDetailSchema, `${BASE}/audits/${encodeURIComponent(id)}`, getAccessToken(), signal ? { signal } : {});
}

export interface CreateAuditInput {
    locationId: string;
    periodType: 'daily' | 'weekly' | 'monthly' | 'custom' | 'annual';
    periodStart: string;
    periodEnd: string;
    notes?: string;
    /** نطاق الجرد — يُبني في الخادم لقطة الموقع ثم يُرشَّح. */
    scopeFilter?: AuditScopeFilter;
}

/**
 * إنشاء جلسة مسودة. الخادم يبني اللقطة من أرصدة المخزن المختار ويجعل
 * «العدد الفعلي» مساويًا لرصيد النظام مبدئيًّا — ثم يعدّله المستخدم.
 */
export async function createInventoryAudit(input: CreateAuditInput): Promise<void> {
    const scope = input.scopeFilter;
    await writeAck(`${BASE}/audits`, 'POST', {
        locationId: Number(input.locationId),
        periodType: input.periodType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        countedAt: input.periodStart,
        notes: String(input.notes ?? '').trim() || null,
        ...(scope
            ? {
                  scopeFilter: {
                      mode: scope.mode,
                      category: scope.category ? String(scope.category) : null,
                      search: scope.search ? String(scope.search) : null,
                  },
              }
            : {}),
    });
}

export interface AuditCountPayload {
    itemId: number;
    countedQty: number;
    notes?: string | null;
}

/** حفظ دفعة عدّ — يُرد الخادم عدد المحفوظ والمرفوض بأسبابها. */
export async function saveAuditCounts(id: string, counts: readonly AuditCountPayload[]): Promise<AuditCountResult> {
    const body = await writeJson(saveCountsSchema, `${BASE}/audits/${encodeURIComponent(id)}/counts`, 'POST', {
        counts: counts.map((row) => ({
            itemId: row.itemId,
            countedQty: row.countedQty,
            notes: String(row.notes ?? '').trim() || null,
        })),
    });
    const rejected = body.rejected ?? [];
    return {
        savedCount: Number(body.saved_count ?? 0),
        rejectedCount: rejected.length,
        rejectedReasons: rejected.map((row) => String(row.reason ?? '').trim()).filter(Boolean),
        countedItems: Number(body.counted_items ?? 0),
    };
}

const countItemSchema = z
    .object({
        id: numberish,
        item_id: numberish,
        counted_qty: numberish,
        notes: z.string().nullable().optional(),
        is_counted: z.boolean().optional(),
    })
    .passthrough();

const singleCountSchema = z
    .object({
        item: countItemSchema.optional(),
        counted_items: numberish,
    })
    .passthrough();

/**
 * حفظ عدّ صف واحد — `PUT /audits/:id/counts/:itemId`
 * (`backend/stocktaking-routes.js:290`): body `{countedQty, notes}`،
 * والرد `{item, counted_items}`. هذا ما كان يفعله زرّ «حفظ» في صف
 * شبكة V2 (`data-v2-asave`).
 */
export async function saveAuditCount(
    id: string,
    itemId: number,
    countedQty: number,
    notes?: string | null,
): Promise<{ countedItems: number }> {
    const body = await writeJson(singleCountSchema, `${BASE}/audits/${encodeURIComponent(id)}/counts/${itemId}`, 'PUT', {
        countedQty: Number(countedQty),
        notes: String(notes ?? '').trim() || null,
    });
    return { countedItems: Number(body.counted_items ?? 0) };
}

/**
 * مسح عدّ صف واحد — `DELETE /audits/:id/counts/:itemId`
 * (`backend/stocktaking-routes.js:378`): يُعيد البند `is_counted:false`
 * و`counted_items`. زرّ «مسح» في صف شبكة V2 (`data-v2-aclear`).
 */
export async function clearAuditCount(id: string, itemId: number): Promise<{ countedItems: number }> {
    const body = await writeJson(singleCountSchema, `${BASE}/audits/${encodeURIComponent(id)}/counts/${itemId}`, 'DELETE');
    return { countedItems: Number(body.counted_items ?? 0) };
}

const locationPreviewSchema = z
    .object({
        items_count: numberish,
        on_hand_value: numberish,
        on_hand_qty: numberish,
    })
    .passthrough();

export interface AuditLocationPreview {
    itemsCount: number;
    onHandValue: number;
    onHandQty: number;
}

/**
 * معاينة نطاق موقع قبل بدء الجلسة — `GET /inventory/locations/:id/preview`
 * (`backend/stocktaking-routes.js:254`): كم صنفًا في الموقع وبقيمة
 * كم، بنفس مرشّحات النطاق المستعملة في إنشاء الجلسة.
 */
export async function fetchAuditLocationPreview(
    locationId: string,
    params: { mode?: string; category?: string; search?: string },
    signal?: AbortSignal,
): Promise<AuditLocationPreview> {
    const query = new URLSearchParams();
    if (params.mode) query.set('mode', params.mode);
    if (params.category) query.set('category', params.category);
    if (params.search) query.set('search', params.search);
    const suffix = query.toString();
    const body = await fetchJson(
        locationPreviewSchema,
        `${BASE}/locations/${encodeURIComponent(locationId)}/preview${suffix ? `?${suffix}` : ''}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    return {
        itemsCount: Number(body.items_count ?? 0),
        onHandValue: Number(body.on_hand_value ?? 0),
        onHandQty: Number(body.on_hand_qty ?? 0),
    };
}

/** نطاق الجرد — نفس قيم `normalizeScopeFilter` في الخادم. */
export const AUDIT_SCOPE_MODES = ['all', 'category', 'search', 'in_stock'] as const;
export type AuditScopeMode = (typeof AUDIT_SCOPE_MODES)[number];

export const AUDIT_SCOPE_LABELS: Record<AuditScopeMode, string> = {
    all: 'كل أصناف الموقع',
    category: 'تصنيف محدّد',
    search: 'بحث بالاسم أو الباركود',
    in_stock: 'الأصناف التي لها رصيد',
};

export interface AuditScopeFilter {
    mode: AuditScopeMode;
    category?: string | null;
    search?: string | null;
}

export interface AuditSignature {
    signatureData: string;
    signerName: string;
}

export async function submitInventoryAudit(id: string, signature: AuditSignature): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(id)}/submit`, 'POST', signature);
}

/** الاعتماد يترحّل فروق الجرد إلى الأرصدة — توقيع إلزامي كما في V2. */
export async function approveInventoryAudit(id: string, signature: AuditSignature): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(id)}/approve`, 'POST', signature);
}

export async function cancelInventoryAudit(id: string, reason: string): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(id)}/cancel`, 'POST', { reason: reason.trim() });
}

/* ── نصوص وأدوات العرض ──────────────────────────────────────────────────── */

export const AUDIT_STATUS_LABELS: Record<string, string> = {
    draft: 'مسودة — قيد العدّ',
    submitted: 'مُرسل للمراجعة',
    approved: 'معتمد — رُحّلت الفروق',
    cancelled: 'ملغى',
};

export const AUDIT_TEXT = {
    create: 'بدء جلسة جرد',
    save: 'حفظ العدّ',
    submit: 'إرسال للمراجعة',
    approve: 'اعتماد وترحيل الفروق',
    cancel: 'إلغاء الجلسة',
    signatureRequired: 'ارسم أو ثبّت التوقيع أولًا — الخادم لا يقبل قرارًا بلا توقيع.',
    signerMissing: 'اسم صاحب الحساب فارغ — لا يمكن توقيع القرار.',
    cancelReason: 'سبب الإلغاء مطلوب (3 أحرف على الأقل).',
    emptyCounts: 'لم تتغيّر أي كمية — عدّل عددًا واحدًا على الأقل ثم احفظ.',
    createFailed: 'تعذّر بدء جلسة الجرد',
    saveFailed: 'تعذّر حفظ العدّ',
    submitFailed: 'تعذّر إرسال الجرد للمراجعة',
    approveFailed: 'تعذّر اعتماد الجرد',
    cancelFailed: 'تعذّر إلغاء الجلسة',
} as const;

export function auditStatusLabel(status: string): string {
    return AUDIT_STATUS_LABELS[String(status)] ?? String(status || '—');
}

export function auditStatusTone(status: string): 'info' | 'success' | 'warning' | 'danger' {
    switch (String(status)) {
        case 'approved':
            return 'success';
        case 'submitted':
            return 'warning';
        case 'cancelled':
            return 'danger';
        default:
            return 'info';
    }
}

export function isAuditDraft(status: string): boolean {
    return String(status) === 'draft';
}

export function isAuditOpen(status: string): boolean {
    return ['draft', 'submitted'].includes(String(status));
}

/** فحص محلي مطابق لـ`getSignature` في الخادم (توقيع + اسم غير فارغ). */
export function auditSignatureError(signature: string | null | undefined, signerName: string): string | null {
    if (!signature) {
        return AUDIT_TEXT.signatureRequired;
    }
    if (!String(signerName ?? '').trim()) {
        return AUDIT_TEXT.signerMissing;
    }
    return null;
}

const QTY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('en-US');

export function formatAuditQty(value: number): string {
    return QTY.format(Number.isFinite(value) ? value : 0);
}

export function formatAuditMoney(value: number): string {
    return MONEY.format(Number.isFinite(value) ? value : 0);
}

export function formatAuditInt(value: number): string {
    return INT.format(Math.round(Number.isFinite(value) ? value : 0));
}

export function auditPeriodLabel(audit: InventoryAudit): string {
    const start = String(audit.period_start ?? '').slice(0, 10);
    const end = String(audit.period_end ?? '').slice(0, 10);
    if (!start && !end) {
        return '—';
    }
    return start === end ? start || end : `${start || '—'} ← ${end || '—'}`;
}

export function auditProgressLabel(audit: InventoryAudit): string {
    const total = Number(audit.total_items ?? audit.item_count ?? 0);
    const counted = Number(audit.counted_items ?? 0);
    if (!total) {
        return '—';
    }
    return `${formatAuditInt(counted)} / ${formatAuditInt(total)}`;
}

/** فرق موجب = زيادة، سالب = عجز — النص يوضح الاتجاه لا الإشارة فقط. */
export function varianceLabel(value: number): string {
    const amount = Number(value) || 0;
    if (Math.abs(amount) < 0.0005) {
        return 'مطابق';
    }
    return amount > 0 ? `زيادة ${formatAuditQty(amount)}` : `عجز ${formatAuditQty(Math.abs(amount))}`;
}

/** تاريخ اليوم بتوقيت الرياض بصيغة `YYYY-MM-DD` (نفس `riyadhToday` في الخادم). */
export function auditToday(): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(new Date());
}
