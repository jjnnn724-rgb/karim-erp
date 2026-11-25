import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { writeAck } from './write';

/**
 * تشغيل المطبخ — ربط V3 بمسارات التشغيل الكاملة في الخادم
 * (`backend/kitchen-production-routes.js` تحت `/api/kitchen`).
 *
 * الفجوة التي تغلقها هذه الطبقة (`docs/phase-0/v3-parity-audit.md`):
 * كانت شاشة المطبخ في V3 تقرأ النظرة العامة فقط، بينما الخادم يملك:
 *   GET  /stock                    → أرصدة المخزن الرئيسي القابلة للتحويل للمطبخ
 *   POST /transfers/receive        → استلام مواد في مخزن المطبخ (قيد مزدوج في الدفتر)
 *   GET  /production-materials     → مكونات متاحة في مخزن المطبخ
 *   GET  /production-destinations  → الأقسام كجهات توزيع
 *   POST /production               → أمر إنتاج يدوي موزّع على جهات (يستهلك المكونات)
 *   GET  /audits                   → جرد المطبخ بالبنود
 *   POST /audits                   → جلسة جرد مسودة من أرصدة مخزن المطبخ
 *   POST /audits/:id/count         → حفظ العدّ
 *   POST /audits/:id/submit        → إرسال موقّع
 *   POST /audits/:id/approve       → اعتماد موقّع يترحّل الفروق
 *   GET  /documents                → تحويلات المطبخ (داخل/خارج)
 *   POST /exceptions/:id/review    → مراجعة استثناء سياسة
 *
 * كل الأرقام تأتي من الخادم؛ هذه الطبقة تتحقق من الشكل فقط.
 */

const BASE = '/api/kitchen';

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numberish = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

/* ── الأدوار (مطابقة حرفية لقوائم الخادم) ────────────────────────────────── */

export const KITCHEN_READ_ROLES: readonly string[] = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'auditor', 'cashier'];
export const KITCHEN_WRITE_ROLES: readonly string[] = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
export const KITCHEN_REVIEW_ROLES: readonly string[] = ['admin', 'manager', 'auditor'];

export function canReadKitchenOps(role: string | null | undefined): boolean {
    return KITCHEN_READ_ROLES.includes(String(role ?? '').trim());
}

export function canWriteKitchenOps(role: string | null | undefined): boolean {
    return KITCHEN_WRITE_ROLES.includes(String(role ?? '').trim());
}

export function canReviewKitchenExceptions(role: string | null | undefined): boolean {
    return KITCHEN_REVIEW_ROLES.includes(String(role ?? '').trim());
}

/* ── المخزون القابل للتحويل والاستلام ────────────────────────────────────── */

export const kitchenLocationSchema = z
    .object({
        id: idValue,
        code: text,
        name_ar: text,
    })
    .passthrough();

export const kitchenStockItemSchema = z
    .object({
        inventory_id: idValue,
        name: text,
        unit: text,
        on_hand: numberish,
        reserved: numberish,
        available: numberish,
        avg_cost: numberish,
    })
    .passthrough();

export type KitchenStockItem = z.infer<typeof kitchenStockItemSchema>;

export const kitchenStockSchema = z
    .object({
        source: kitchenLocationSchema.nullable().optional(),
        destination: kitchenLocationSchema.nullable().optional(),
        items: z.array(kitchenStockItemSchema).optional(),
    })
    .passthrough();

export type KitchenStock = z.infer<typeof kitchenStockSchema>;

export async function fetchKitchenStock(signal?: AbortSignal): Promise<KitchenStock> {
    return fetchJson(kitchenStockSchema, `${BASE}/stock`, getAccessToken(), signal ? { signal } : {});
}

export interface KitchenTransferLine {
    inventoryId: number;
    qty: number;
    packagingQty?: number | null;
    packagingUom?: string | null;
}

export interface KitchenTransferInput {
    reference?: string;
    destinationLocationId?: number | null;
    items: readonly KitchenTransferLine[];
}

/**
 * استلام مواد في مخزن المطبخ: يقيّد خروجًا من الرئيسي ودخولًا للمطبخ في
 * معاملة واحدة، ويرفض التكرار المطابق خلال 10 دقائق (حماية النقر المزدوج).
 */
export async function receiveKitchenTransfer(input: KitchenTransferInput): Promise<void> {
    await writeAck(`${BASE}/transfers/receive`, 'POST', {
        ...(input.reference ? { reference: input.reference.trim() } : {}),
        ...(input.destinationLocationId ? { destination_location_id: input.destinationLocationId } : {}),
        items: input.items.map((line) => ({
            inventory_id: line.inventoryId,
            qty: line.qty,
            ...(line.packagingQty != null ? { packaging_qty: line.packagingQty } : {}),
            ...(line.packagingUom ? { packaging_uom: line.packagingUom } : {}),
        })),
    });
}

/* ── أمر الإنتاج ─────────────────────────────────────────────────────────── */

export const kitchenMaterialSchema = z
    .object({
        inventory_id: idValue,
        name: text,
        unit: text,
        weight: numberish,
        on_hand: numberish,
        reserved: numberish,
        available: numberish,
        avg_cost: numberish,
    })
    .passthrough();

export type KitchenMaterial = z.infer<typeof kitchenMaterialSchema>;

export const kitchenDestinationSchema = z
    .object({
        id: idValue,
        code: text,
        name: text,
        icon: text,
        color: text,
    })
    .passthrough();

export type KitchenDestination = z.infer<typeof kitchenDestinationSchema>;

export async function fetchKitchenMaterials(signal?: AbortSignal): Promise<KitchenMaterial[]> {
    return fetchJson(z.array(kitchenMaterialSchema), `${BASE}/production-materials`, getAccessToken(), signal ? { signal } : {});
}

export async function fetchKitchenDestinations(signal?: AbortSignal): Promise<KitchenDestination[]> {
    return fetchJson(z.array(kitchenDestinationSchema), `${BASE}/production-destinations`, getAccessToken(), signal ? { signal } : {});
}

/** جهات التوزيع غير القسمية — نفس خريطة الخادم. */
export const KITCHEN_CHANNELS: readonly { code: string; label: string }[] = [
    { code: 'external_sales', label: 'البيع الخارجي' },
    { code: 'open_buffet', label: 'البوفيه المفتوح' },
    { code: 'staff_meals', label: 'وجبات الموظفين' },
];

export interface KitchenProductionMaterialLine {
    inventoryId: number;
    quantity: number;
    wastePercent: number;
}

export interface KitchenProductionDistributionLine {
    kind: 'channel' | 'department';
    code: string;
    departmentId?: number | null;
    quantity: number;
}

export interface KitchenProductionInput {
    productName: string;
    productUnit: string;
    producedQty: number;
    materials: readonly KitchenProductionMaterialLine[];
    distributions: readonly KitchenProductionDistributionLine[];
    notes?: string | null;
}

/**
 * إنشاء أمر إنتاج يدوي موزّع: الخادم يتحقق من كفاية مخزن المطبخ، يستهلك
 * المكونات في الدفتر، ثم يسجل التوزيعات ويغلق الأمر — ذرّيًا.
 */
export async function createKitchenProduction(input: KitchenProductionInput): Promise<void> {
    await writeAck(`${BASE}/production`, 'POST', {
        product_name: input.productName.trim(),
        product_unit: input.productUnit.trim() || 'وحدة',
        produced_qty: input.producedQty,
        materials: input.materials.map((line) => ({
            inventory_id: line.inventoryId,
            quantity: line.quantity,
            waste_percent: line.wastePercent,
        })),
        distributions: input.distributions.map((line) =>
            line.kind === 'department'
                ? {
                      destination_type: 'department',
                      destination_code: line.code,
                      department_id: line.departmentId ?? null,
                      quantity: line.quantity,
                  }
                : {
                      destination_type: 'channel',
                      destination_code: line.code,
                      quantity: line.quantity,
                  },
        ),
        ...(input.notes ? { notes: input.notes.trim() } : {}),
    });
}

/* ── جرد المطبخ ──────────────────────────────────────────────────────────── */

export const kitchenAuditItemSchema = z
    .object({
        id: idValue,
        inventory_id: idValue,
        item_name: text,
        unit: text,
        system_qty: numberish,
        counted_qty: numberish,
        variance_qty: numberish,
        avg_cost: numberish,
    })
    .passthrough();

export type KitchenAuditItem = z.infer<typeof kitchenAuditItemSchema>;

export const kitchenAuditSchema = z
    .object({
        id: idValue,
        audit_number: text,
        period: text,
        period_start: text,
        period_end: text,
        status: text,
        total_items: numberish,
        total_variance_value: numberish,
        created_at: text,
        items: z.array(kitchenAuditItemSchema).optional(),
    })
    .passthrough();

export type KitchenAudit = z.infer<typeof kitchenAuditSchema>;

export const KITCHEN_AUDIT_PERIODS = ['daily', 'weekly', 'monthly', 'custom', 'annual'] as const;
export type KitchenAuditPeriod = (typeof KITCHEN_AUDIT_PERIODS)[number];

export const KITCHEN_AUDIT_PERIOD_AR: Record<string, string> = {
    daily: 'يومي',
    weekly: 'أسبوعي',
    monthly: 'شهري',
    custom: 'فترة مخصّصة',
    annual: 'سنوي',
};

export const KITCHEN_AUDIT_STATUS_AR: Record<string, string> = {
    draft: 'مسودة — قيد العدّ',
    submitted: 'مُرسل للمراجعة',
    approved: 'معتمد — رُحّلت الفروق',
    rejected: 'مرفوض',
};

export async function fetchKitchenAudits(signal?: AbortSignal): Promise<KitchenAudit[]> {
    return fetchJson(z.array(kitchenAuditSchema), `${BASE}/audits`, getAccessToken(), signal ? { signal } : {});
}

export interface KitchenAuditCreateInput {
    period: KitchenAuditPeriod;
    periodStart: string;
    periodEnd: string;
    notes?: string | null;
}

export async function createKitchenAudit(input: KitchenAuditCreateInput): Promise<void> {
    await writeAck(`${BASE}/audits`, 'POST', {
        period: input.period,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        ...(input.notes ? { notes: input.notes.trim() } : {}),
    });
}

export interface KitchenAuditCountLine {
    id: number;
    countedQty: number;
    notes?: string | null;
}

export async function saveKitchenAuditCounts(auditId: string, lines: readonly KitchenAuditCountLine[]): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(auditId)}/count`, 'POST', {
        items: lines.map((line) => ({
            id: line.id,
            counted_qty: line.countedQty,
            ...(line.notes ? { notes: line.notes } : {}),
        })),
    });
}

export interface KitchenSignature {
    signatureData: string;
    signerName: string;
}

export async function submitKitchenAudit(auditId: string, signature: KitchenSignature): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(auditId)}/submit`, 'POST', signature);
}

export async function approveKitchenAudit(auditId: string, signature: KitchenSignature): Promise<void> {
    await writeAck(`${BASE}/audits/${encodeURIComponent(auditId)}/approve`, 'POST', signature);
}

/* ── المستندات والاستثناءات ──────────────────────────────────────────────── */

export const kitchenDocumentItemSchema = z
    .object({
        inventory_id: idValue,
        item_name: text,
        requested_qty: numberish,
        received_qty: numberish,
        unit: text,
    })
    .passthrough();

export const kitchenDocumentSchema = z
    .object({
        id: idValue,
        source_name: text,
        destination_name: text,
        status: text,
        created_at: text,
        items: z.array(kitchenDocumentItemSchema).optional(),
    })
    .passthrough();

export type KitchenDocument = z.infer<typeof kitchenDocumentSchema>;

export async function fetchKitchenDocuments(signal?: AbortSignal): Promise<KitchenDocument[]> {
    return fetchJson(z.array(kitchenDocumentSchema), `${BASE}/documents`, getAccessToken(), signal ? { signal } : {});
}

export const KITCHEN_EXCEPTION_STATUS_AR: Record<string, string> = {
    open: 'مفتوح',
    reviewed: 'روجِع',
    dismissed: 'مستبعَد',
};

export async function reviewKitchenException(id: string, status: 'reviewed' | 'dismissed'): Promise<void> {
    await writeAck(`${BASE}/exceptions/${encodeURIComponent(id)}/review`, 'POST', { status });
}

/* ── أدوات العرض والتحقق ─────────────────────────────────────────────────── */

const QTY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatKitchenQty(value: number): string {
    return QTY.format(Number.isFinite(value) ? value : 0);
}

export function formatKitchenMoney(value: number): string {
    return MONEY.format(Number.isFinite(value) ? value : 0);
}

/** تاريخ الرياض بصيغة `YYYY-MM-DD` — نفس `riyadhToday` في الخادم. */
export function kitchenToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

export function kitchenPeriodStart(period: KitchenAuditPeriod, today: string = kitchenToday()): string {
    const [year, month] = today.split('-');
    switch (period) {
        case 'daily':
            return today;
        case 'weekly': {
            const date = new Date(`${today}T00:00:00Z`);
            const weekday = date.getUTCDay();
            const shift = weekday === 6 ? 0 : weekday + 1; // الأسبوع يبدأ السبت
            date.setUTCDate(date.getUTCDate() - shift);
            return date.toISOString().slice(0, 10);
        }
        case 'monthly':
        case 'annual':
            return `${year ?? ''}-${period === 'annual' ? '01' : (month ?? '01')}-01`;
        default:
            return today;
    }
}

export interface KitchenProductionCheck {
    ok: boolean;
    errors: string[];
}

/** فحص محلي مطابق لشروط الخادم — يمنع طلبًا محكومًا عليه بالرفض. */
export function validateKitchenProduction(input: {
    productName: string;
    producedQty: number;
    materials: readonly KitchenProductionMaterialLine[];
    distributions: readonly KitchenProductionDistributionLine[];
}): KitchenProductionCheck {
    const errors: string[] = [];
    if (!input.productName.trim()) {
        errors.push('اكتب اسم المنتج النهائي.');
    }
    if (!Number.isFinite(input.producedQty) || input.producedQty <= 0) {
        errors.push('الكمية المنتجة يجب أن تكون أكبر من صفر.');
    }
    if (input.materials.length === 0) {
        errors.push('أضف مكوّنًا واحدًا على الأقل من مخزن المطبخ.');
    }
    if (input.distributions.length === 0) {
        errors.push('وزّع الإنتاج على جهة واحدة على الأقل.');
    }
    if (
        input.materials.some(
            (line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || line.wastePercent < 0 || line.wastePercent > 100,
        )
    ) {
        errors.push('تحقق من كميات المكونات ونسب الهالك (0–100).');
    }
    const allocated = input.distributions.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    if (input.distributions.length > 0 && Math.abs(allocated - input.producedQty) > 0.0001) {
        errors.push(`إجمالي التوزيع ${formatKitchenQty(allocated)} لا يساوي الإنتاج ${formatKitchenQty(input.producedQty)}.`);
    }
    return { ok: errors.length === 0, errors };
}

/** فحص محلي مطابق لـ`requireSignature` في الخادم. */
export function kitchenSignatureError(signature: string | null | undefined, signerName: string): string | null {
    if (!signature) {
        return 'التوقيع الإلكتروني مطلوب لإرسال أو اعتماد جرد المطبخ.';
    }
    if (!String(signerName ?? '').trim()) {
        return 'اسم صاحب الحساب فارغ — لا يمكن توقيع القرار.';
    }
    return null;
}

export function kitchenAuditStatusTone(status: string): 'info' | 'success' | 'warning' | 'danger' {
    switch (String(status)) {
        case 'approved':
            return 'success';
        case 'submitted':
            return 'warning';
        case 'rejected':
            return 'danger';
        default:
            return 'info';
    }
}
