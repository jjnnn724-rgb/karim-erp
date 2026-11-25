import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { writeJson } from './write';

/**
 * أجهزة البصمة — بقية أبواب V2 (2026-11-11):
 *
 *   مسح الشبكة        POST   /api/zkteco/scan                        (admin|hr)
 *   مستخدمو الجهاز    GET    /api/zkteco/devices/:id/stored-users    (قراءة)
 *   استيراد موظفين    POST   /api/zkteco/devices/:id/import-users    (admin|hr)
 *   الربط             GET    /api/zkteco/mappings                    (قراءة)
 *                     PUT    /api/zkteco/mappings/:employeeId        (admin|hr)
 *                     POST   /api/zkteco/mappings/auto               (admin|hr)
 *   سجل البصمات       GET    /api/zkteco/logs                        (قراءة)
 *   تجاهل/استعادة     POST   /api/zkteco/logs/:id/ignore|restore     (admin|owner)
 *   التغطية           GET    /api/zkteco/coverage                    (قراءة)
 *   المطابقة          GET    /api/zkteco/reconciliation              (قراءة)
 *   مركز التحكم       GET    /api/zkteco/control                     (admin|owner)
 *   إعادة بناء الأيام POST   /api/zkteco/rebuild-days                (admin|owner)
 *
 * كل التحقق المحلي هنا مطابق لتحقق الخادم فقط حيث يفيد المستخدم قبل الإرسال
 * (سبب مكتوب، مدى ≤ 31 يومًا). الخادم يبقى الحاكم، والرسالة العربية منه تُعرض.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();

// ─── مسح الشبكة ─────────────────────────────────────────────────────────────
const scanHitSchema = z
    .object({
        ip: z.string(),
        port: numLike,
        open: boolLike,
        isZkteco: boolLike,
        serial: text,
        deviceName: text,
        firmware: text,
    })
    .passthrough();

const scanSchema = z
    .object({
        ok: boolLike,
        subnets: z.array(z.string()).optional(),
        port: numLike,
        found: z.array(scanHitSchema).optional(),
        message: text,
    })
    .passthrough();

export type ZkScanResult = z.infer<typeof scanSchema>;

export async function scanZkNetwork(): Promise<ZkScanResult> {
    return writeJson(scanSchema, '/api/zkteco/scan', 'POST', {});
}

export function zkScanDeviceName(hit: { ip: string; deviceName?: string | null | undefined }): string {
    const name = String(hit.deviceName ?? '').trim();
    return name || `ZKTeco ${hit.ip}`;
}

// ─── مستخدمو الجهاز المخزَّنون ─────────────────────────────────────────────
const storedUserSchema = z
    .object({
        userId: z.union([z.string(), z.number()]).transform((value) => String(value)),
        name: text,
        privilege: numLike,
        card: text,
        punches: numLike,
        lastSeenAt: text,
        employeeId: numLike,
        employeeName: text,
        archived: boolLike,
        totalPunches: numLike,
    })
    .passthrough();

const storedUsersSchema = z
    .object({
        ok: boolLike,
        count: numLike,
        users: z.array(storedUserSchema).optional(),
    })
    .passthrough();

export type ZkStoredUsers = z.infer<typeof storedUsersSchema>;
export type ZkStoredUser = z.infer<typeof storedUserSchema>;

export async function fetchZkStoredUsers(deviceId: string, signal?: AbortSignal): Promise<ZkStoredUsers> {
    return fetchJson(
        storedUsersSchema,
        `/api/zkteco/devices/${encodeURIComponent(deviceId)}/stored-users`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export interface ZkImportOptions {
    userIds?: readonly string[];
    department?: string;
}

export interface ZkImportResult {
    total: number;
    created: number;
    skipped: number;
    message: string;
}

const importSchema = z
    .object({
        ok: boolLike,
        total: numLike,
        created: numLike,
        skipped: numLike,
        message: text,
    })
    .passthrough();

export async function importZkUsers(deviceId: string, options: ZkImportOptions = {}): Promise<ZkImportResult> {
    const body: Record<string, unknown> = {};
    if (options.userIds && options.userIds.length > 0) {
        body.userIds = options.userIds.map((value) => String(value).trim()).filter(Boolean);
    }
    const department = String(options.department ?? '').trim();
    if (department) {
        body.department = department;
    }
    const result = await writeJson(importSchema, `/api/zkteco/devices/${encodeURIComponent(deviceId)}/import-users`, 'POST', body);
    return {
        total: Number(result.total ?? 0),
        created: Number(result.created ?? 0),
        skipped: Number(result.skipped ?? 0),
        message: String(result.message ?? ''),
    };
}

// ─── ربط الموظفين بأرقام البصمة ─────────────────────────────────────────────
const mappingEmployeeSchema = z
    .object({
        id: idValue,
        name: text,
        employeeId: text,
        department: text,
        status: text,
        deviceUserId: text,
        deviceUserIdAlt: text,
        todayPunches: numLike,
        punches30d: numLike,
        deviceUidOfAccount: text,
        deviceAccountName: text,
        altOwnedBy: text,
        altOwnedByNumber: text,
    })
    .passthrough();

const unmappedLogSchema = z
    .object({
        deviceId: numLike,
        deviceUserId: text,
        punches: numLike,
        lastPunch: text,
    })
    .passthrough();

const mappingsSchema = z
    .object({
        employees: z.array(mappingEmployeeSchema).optional(),
        unmapped: z.array(unmappedLogSchema).optional(),
    })
    .passthrough();

export type ZkMappings = z.infer<typeof mappingsSchema>;
export type ZkMappingEmployee = z.infer<typeof mappingEmployeeSchema>;
export type ZkUnmappedLog = z.infer<typeof unmappedLogSchema>;

export async function fetchZkMappings(signal?: AbortSignal): Promise<ZkMappings> {
    return fetchJson(mappingsSchema, '/api/zkteco/mappings', getAccessToken(), signal ? { signal } : {});
}

const mappingSaveSchema = z
    .object({
        id: idValue,
        name: text,
        employeeId: text,
        deviceUserId: text,
        attached: numLike,
    })
    .passthrough();

export interface ZkMappingSaveResult {
    name: string;
    number: string;
    attached: number;
}

/** رقم فارغ = فكّ الربط — نفس ما يفعله V2 (`deviceUserId = null`). */
export async function setZkMapping(employeeId: string, deviceUserId: string): Promise<ZkMappingSaveResult> {
    const trimmed = String(deviceUserId ?? '').trim();
    const result = await writeJson(mappingSaveSchema, `/api/zkteco/mappings/${encodeURIComponent(employeeId)}`, 'PUT', {
        deviceUserId: trimmed === '' ? null : trimmed,
    });
    return {
        name: String(result.name ?? ''),
        number: String(result.deviceUserId ?? ''),
        attached: Number(result.attached ?? 0),
    };
}

export interface ZkAutoLinkResult {
    linked: number;
    names: readonly string[];
    message: string;
}

const autoLinkSchema = z
    .object({
        ok: boolLike,
        linked: numLike,
        linkedNames: z.array(z.string()).optional(),
        message: text,
    })
    .passthrough();

export async function autoLinkZkMappings(deviceId?: string): Promise<ZkAutoLinkResult> {
    const body: Record<string, unknown> = {};
    if (deviceId) {
        body.deviceId = Number(deviceId);
    }
    const result = await writeJson(autoLinkSchema, '/api/zkteco/mappings/auto', 'POST', body);
    return {
        linked: Number(result.linked ?? 0),
        names: result.linkedNames ?? [],
        message: String(result.message ?? ''),
    };
}

// ─── سجل البصمات الخام ─────────────────────────────────────────────────────
const logSchema = z
    .object({
        id: idValue,
        deviceUserId: text,
        employeeId: numLike,
        employeeName: text,
        employeeNumber: text,
        attendanceTime: text,
        verifyType: numLike,
        punchState: numLike,
        syncedAt: text,
        deviceName: text,
        ipAddress: text,
        ignored: boolLike,
        ignoredReason: text,
        ignoredBy: text,
        ignoredAt: text,
    })
    .passthrough();

export type ZkLogRow = z.infer<typeof logSchema>;

export interface ZkLogsOptions {
    limit?: number;
    unmappedOnly?: boolean;
}

export async function fetchZkLogs(options: ZkLogsOptions = {}, signal?: AbortSignal): Promise<ZkLogRow[]> {
    const params = new URLSearchParams({ limit: String(Math.min(500, Math.max(1, options.limit ?? 100))) });
    if (options.unmappedOnly) {
        params.set('unmapped', '1');
    }
    return fetchJson(z.array(logSchema), `/api/zkteco/logs?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

const toggleSchema = z
    .object({
        ok: boolLike,
        changed: boolLike,
        ignored: boolLike,
        message: text,
    })
    .passthrough();

export interface ZkPunchToggleResult {
    changed: boolean;
    ignored: boolean;
    message: string;
}

export async function toggleZkPunch(logId: string, ignore: boolean, reason: string): Promise<ZkPunchToggleResult> {
    const result = await writeJson(toggleSchema, `/api/zkteco/logs/${encodeURIComponent(logId)}/${ignore ? 'ignore' : 'restore'}`, 'POST', {
        reason: String(reason ?? '').trim(),
    });
    return {
        changed: result.changed === true,
        ignored: result.ignored === true,
        message: String(result.message ?? ''),
    };
}

/** 0 دخول · 1 خروج — تسمية الحركة كما في تصدير V2. */
export function zkPunchStateName(state: unknown): string {
    if (state === null || state === undefined || state === '') {
        return '—';
    }
    const value = Number(state);
    if (!Number.isFinite(value)) {
        return '—';
    }
    if (value === 0) {
        return 'دخول';
    }
    if (value === 1) {
        return 'خروج';
    }
    return `حالة ${String(value)}`;
}

// ─── التغطية (تشخيص كل موظف) ───────────────────────────────────────────────
const coverageRowSchema = z
    .object({
        id: idValue,
        name: text,
        employeeId: text,
        department: text,
        deviceUserId: text,
        on_device: boolLike,
        face_enrolled: boolLike,
        last_punch: text,
        raw_punches: numLike,
        attendance_days: numLike,
        diagnosis: text,
        action: text,
    })
    .passthrough();

const coverageSchema = z
    .object({
        generated_at: text,
        days: numLike,
        summary: z
            .object({
                total_employees: numLike,
                ok: numLike,
                problems: numLike,
                face_enrolled: numLike,
                unmapped_device_users: numLike,
            })
            .passthrough()
            .optional(),
        problems: z.array(coverageRowSchema).optional(),
        ok: z.array(coverageRowSchema).optional(),
        unmapped_device_users: z
            .array(
                z
                    .object({
                        deviceUserId: text,
                        raw: numLike,
                        last_at: text,
                        device_name: text,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export type ZkCoverage = z.infer<typeof coverageSchema>;
export type ZkCoverageRow = z.infer<typeof coverageRowSchema>;

export async function fetchZkCoverage(days: number, signal?: AbortSignal): Promise<ZkCoverage> {
    const bounded = Math.min(90, Math.max(1, Math.round(days) || 7));
    return fetchJson(coverageSchema, `/api/zkteco/coverage?days=${String(bounded)}`, getAccessToken(), signal ? { signal } : {});
}

// ─── المطابقة (دفتر الجهاز مقابل دفتر النظام) ──────────────────────────────
const reconciliationSchema = z
    .object({
        generated_at: text,
        range: z.object({ from: text, to: text }).passthrough().optional(),
        coverage: z.object({ from: text, note: text }).passthrough().optional(),
        summary: z
            .object({
                device_punches: numLike,
                matched: numLike,
                orphan_punches: numLike,
                unmapped_punches: numLike,
                system_rows: numLike,
                rows_with_device_punch: numLike,
                rows_without_device_punch: numLike,
                real_gaps: numLike,
                benign_duplicates: numLike,
                unmatched_before_coverage: numLike,
            })
            .passthrough()
            .optional(),
        classification: z
            .object({
                total_unmatched: numLike,
                compared: numLike,
                before_coverage: numLike,
                real_gaps: numLike,
                benign_duplicates: numLike,
                gap_days: numLike,
                gap_days_without_row: numLike,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type ZkReconciliation = z.infer<typeof reconciliationSchema>;

export interface ZkRangeQuery {
    from: string;
    to: string;
}

export async function fetchZkReconciliation(range: ZkRangeQuery, signal?: AbortSignal): Promise<ZkReconciliation> {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    return fetchJson(reconciliationSchema, `/api/zkteco/reconciliation?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

// ─── مركز التحكم ────────────────────────────────────────────────────────────
const controlSchema = z
    .object({
        engine: z.object({ running: boolLike }).passthrough().optional(),
        devices: z.array(z.object({}).passthrough()).optional(),
        totals: z
            .object({
                today: numLike,
                unmapped: numLike,
                openDays: numLike,
                manualToday: numLike,
            })
            .passthrough()
            .optional(),
        audit: z
            .array(
                z
                    .object({
                        id: idValue,
                        action: text,
                        actorName: text,
                        actorRole: text,
                        reason: text,
                        createdAt: text,
                    })
                    .passthrough(),
            )
            .optional(),
        limits: z.object({ rebuildMaxDays: numLike }).passthrough().optional(),
    })
    .passthrough();

export type ZkControl = z.infer<typeof controlSchema>;
export type ZkAuditRow = NonNullable<ZkControl['audit']>[number];

export async function fetchZkControl(signal?: AbortSignal): Promise<ZkControl> {
    return fetchJson(controlSchema, '/api/zkteco/control', getAccessToken(), signal ? { signal } : {});
}

// ─── إعادة بناء الأيام ─────────────────────────────────────────────────────
const rebuildSchema = z
    .object({
        ok: boolLike,
        from: text,
        to: text,
        punches: numLike,
        created: numLike,
        updated: numLike,
        removed: numLike,
        message: text,
    })
    .passthrough();

export interface ZkRebuildInput {
    employeeId: string;
    from: string;
    to: string;
    reason: string;
}

export interface ZkRebuildResult {
    punches: number;
    created: number;
    updated: number;
    removed: number;
    message: string;
}

export async function rebuildZkDays(input: ZkRebuildInput): Promise<ZkRebuildResult> {
    const result = await writeJson(rebuildSchema, '/api/zkteco/rebuild-days', 'POST', {
        employeeId: Number(input.employeeId),
        from: input.from,
        to: input.to,
        reason: String(input.reason ?? '').trim(),
    });
    return {
        punches: Number(result.punches ?? 0),
        created: Number(result.created ?? 0),
        updated: Number(result.updated ?? 0),
        removed: Number(result.removed ?? 0),
        message: String(result.message ?? ''),
    };
}

// ─── تحقق محلي مطابق للخادم (رسائل عربية قبل الإرسال) ─────────────────────
/** 'YYYY-MM-DD' صالح فعلًا — 2026-02-31 يُرفض لأنه لا يعود كما هو. */
export function isIsoDay(value: unknown): boolean {
    const day = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return false;
    }
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** عدد الأيام شاملًا الطرفين — null إن كان أي تاريخ غير صالح. */
export function zkDaySpan(from: string, to: string): number | null {
    if (!isIsoDay(from) || !isIsoDay(to)) {
        return null;
    }
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    return Math.round((end - start) / 86_400_000) + 1;
}

export function zkRebuildErrors(input: ZkRebuildInput, maxDays = 31): string[] {
    const errors: string[] = [];
    if (!Number.isFinite(Number(input.employeeId)) || Number(input.employeeId) <= 0) {
        errors.push('اختر الموظف أولًا');
    }
    if (!isIsoDay(input.from) || !isIsoDay(input.to)) {
        errors.push('التاريخ بصيغة YYYY-MM-DD');
    } else if (input.to < input.from) {
        errors.push('تاريخ البداية بعد النهاية');
    } else {
        const span = zkDaySpan(input.from, input.to);
        if (span !== null && span > maxDays) {
            errors.push(`أقصى مدى للبناء ${String(maxDays)} يومًا في الطلب الواحد`);
        }
    }
    if (String(input.reason ?? '').trim().length < 5) {
        errors.push('سبب إعادة البناء مطلوب (5 أحرف على الأقل)');
    }
    return errors;
}

/** تجاهل/استعادة بصمة: الخادم يطلب سببًا من 3 أحرف. */
export function zkIgnoreReasonError(reason: unknown): string {
    return String(reason ?? '').trim().length >= 3 ? '' : 'سبب التصحيح مطلوب (3 أحرف على الأقل)';
}
