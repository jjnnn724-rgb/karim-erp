import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { getAccessToken, getAppKey } from './auth';
import {
    appStateSchema,
    type BackupList,
    backupListSchema,
    entityPageSchema,
    type HrCardSettings,
    type PosLegacyMode,
    type ResetResult,
    type RestoreResult,
    resetResultSchema,
    restoreResultSchema,
    type ZatcaApplyVatResult,
    type ZatcaCsrResult,
    type ZatcaRetryResult,
    type ZatcaTestResult,
    zatcaApplyVatSchema,
    zatcaCsrSchema,
    zatcaRetrySchema,
    zatcaTestSchema,
} from './settings';
import { isWriteRole, writeAck } from './write';

/**
 * كتابة الإعدادات — بوابات الأدوار مطابقة حرفيًا للخادم:
 *  • العامة            admin                (كيان `settings` في CRUD العام)
 *  • القائمة الجانبية  admin                (`hidden_nav_pages` في صف الإعدادات)
 *  • ZATCA             قراءة admin/manager/accountant/auditor — كتابة admin/manager
 *  • KOT               قراءة admin/manager/accountant/auditor — كتابة admin/manager
 *  • بطاقات الموظفين   قراءة أي حساب — كتابة admin
 *  • البصمة الذاتية    admin/hr
 *  • النسخ الاحتياطي   admin
 *  • التصفير           admin
 */

export const SETTINGS_READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'] as const;
export const SETTINGS_WRITE_ROLES = ['admin'] as const;
export const ZATCA_READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'] as const;
export const ZATCA_WRITE_ROLES = ['admin', 'manager'] as const;
export const KOT_READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'] as const;
export const KOT_WRITE_ROLES = ['admin', 'manager'] as const;
export const PUNCH_ROLES = ['admin', 'hr'] as const;
export const BACKUP_ROLES = ['admin'] as const;

export function roleIn(role: string | null | undefined, allowed: readonly string[]): boolean {
    return isWriteRole(role, allowed);
}

export function settingsReadVisible(role: string | null | undefined): boolean {
    return roleIn(role, SETTINGS_READ_ROLES);
}

export function settingsWriteVisible(role: string | null | undefined): boolean {
    return roleIn(role, SETTINGS_WRITE_ROLES);
}

export function zatcaWriteVisible(role: string | null | undefined): boolean {
    return roleIn(role, ZATCA_WRITE_ROLES);
}

export function kotWriteVisible(role: string | null | undefined): boolean {
    return roleIn(role, KOT_WRITE_ROLES);
}

export function punchVisible(role: string | null | undefined): boolean {
    return roleIn(role, PUNCH_ROLES);
}

export function backupVisible(role: string | null | undefined): boolean {
    return roleIn(role, BACKUP_ROLES);
}

export const SETTINGS_TEXT = {
    saveSuccess: 'تم حفظ الإعدادات',
    saveFailed: 'تعذّر حفظ الإعدادات',
    cancel: 'إلغاء',
    save: 'حفظ التغييرات',
    saved: 'محفوظ',
} as const;

/* ─── الإعدادات العامة ────────────────────────────────────────────────── */

export interface MainSettingsPatch {
    name?: string;
    logo?: string;
    logoB64?: string | null;
    currency?: string;
    workStartHour?: number;
    hidden_nav_pages?: string;
    opening_balance_visible?: boolean;
    pos_legacy_mode?: PosLegacyMode;
    pos_official_path?: string;
}

export async function saveMainSettings(id: string, patch: MainSettingsPatch): Promise<void> {
    await writeAck(`/api/settings/${encodeURIComponent(id)}`, 'PUT', patch);
}

/* ─── ZATCA ───────────────────────────────────────────────────────────── */

export interface ZatcaSavePayload {
    seller_name: string;
    vat_number: string;
    crn: string;
    address: string;
    branch_name: string;
    eid: string;
    solution_name: string;
    environment: string;
    api_base: string;
    max_attempts: number;
    poll_in_server: boolean;
}

export async function saveZatcaSettings(payload: ZatcaSavePayload): Promise<void> {
    await writeAck('/api/zatca/settings', 'PUT', payload);
}

export async function zatcaToggle(enabled: boolean): Promise<void> {
    await writeAck('/api/zatca/toggle', 'POST', { enabled });
}

export async function zatcaTest(apiBase?: string): Promise<ZatcaTestResult> {
    return fetchJson(zatcaTestSchema, '/api/zatca/test', getAccessToken(), {
        method: 'POST',
        body: apiBase ? { api_base: apiBase } : {},
    });
}

export async function zatcaGenerateCsr(): Promise<ZatcaCsrResult> {
    return fetchJson(zatcaCsrSchema, '/api/zatca/csr', getAccessToken(), { method: 'POST', body: {} });
}

export async function zatcaRequestCsid(otp: string): Promise<void> {
    await writeAck('/api/zatca/csid', 'POST', { otp });
}

export async function zatcaManualCsid(input: { csid?: string; vat_number?: string; clear?: boolean }): Promise<void> {
    await writeAck('/api/zatca/csid/manual', 'POST', input);
}

export async function zatcaApplyVat(vatNumber?: string): Promise<ZatcaApplyVatResult> {
    const body = vatNumber ? { vat_number: vatNumber } : {};
    return fetchJson(zatcaApplyVatSchema, '/api/zatca/apply-vat', getAccessToken(), {
        method: 'POST',
        body,
    });
}

export async function zatcaRetryQueue(scope: 'failed' | 'all'): Promise<ZatcaRetryResult> {
    return fetchJson(zatcaRetrySchema, '/api/zatca/queue/retry', getAccessToken(), {
        method: 'POST',
        body: { scope },
    });
}

/* ─── KOT ─────────────────────────────────────────────────────────────── */

export interface KotSavePayload {
    enabled: boolean;
    copies: number;
    include_notes: boolean;
}

/** العقد الحقيقي للخادم: `kot_enabled`/`kot_copies`/`kot_include_notes`. */
export async function saveKotSettings(payload: KotSavePayload): Promise<void> {
    await writeAck('/api/pos/kot/settings', 'PUT', {
        kot_enabled: payload.enabled,
        kot_copies: payload.copies,
        kot_include_notes: payload.include_notes,
    });
}

/* ─── بطاقات الموظفين ─────────────────────────────────────────────────── */

export async function saveHrCardSettings(payload: HrCardSettings): Promise<void> {
    await writeAck('/api/hr/card-settings', 'PUT', payload);
}

/* ─── البصمة الذاتية ──────────────────────────────────────────────────── */

export async function savePunchSettings(payload: Record<string, unknown>): Promise<void> {
    await writeAck('/api/attendance/portal/settings-admin', 'PUT', payload);
}

export async function enrollFaceV2(userId: string, images: string[]): Promise<void> {
    await writeAck('/api/attendance/portal/face/enroll-v2', 'POST', {
        targetUserId: Number(userId),
        images,
    });
}

export async function removeFace(userId: string): Promise<void> {
    await writeAck(`/api/attendance/portal/face/enroll/${encodeURIComponent(userId)}`, 'DELETE');
}

export async function unbindPunchDevice(userId: string): Promise<void> {
    await writeAck(`/api/attendance/portal/punch-devices/${encodeURIComponent(userId)}`, 'DELETE');
}

/* ─── النسخ الاحتياطي ─────────────────────────────────────────────────── */

export async function fetchBackups(verify = false): Promise<BackupList> {
    const suffix = verify ? '?verify=1' : '';
    return fetchJson(backupListSchema, `/api/system/backups${suffix}`, getAccessToken());
}

export async function createBackup(): Promise<BackupList> {
    return fetchJson(backupListSchema, '/api/system/backup', getAccessToken(), { method: 'POST', body: {} });
}

export async function uploadBackup(file: File): Promise<BackupList> {
    if (!/\.sql$/i.test(file.name)) {
        throw new Error('ارفع ملف نسخة .sql فقط');
    }
    if (file.size > 1024 * 1024 * 1024) {
        throw new Error('الملف أكبر من 1 جيجابايت');
    }
    const body = new FormData();
    body.append('file', file);
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getAccessToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const appKey = getAppKey();
    if (appKey) {
        headers['x-api-key'] = appKey;
    }
    const response = await fetch('/api/system/upload', { method: 'POST', headers, body });
    if (!response.ok) {
        let message = `تعذّر رفع النسخة (${String(response.status)})`;
        try {
            const parsed = z
                .object({ message: z.string().optional(), error: z.string().optional() })
                .passthrough()
                .safeParse(await response.json());
            if (parsed.success) {
                message = parsed.data.message ?? parsed.data.error ?? message;
            }
        } catch {
            // جسم غير JSON.
        }
        throw new ApiError(response.status, 'UPLOAD_FAILED', message);
    }
    return backupListSchema.parse(await response.json());
}

export async function restoreBackup(file: string, restoreEnv: boolean): Promise<RestoreResult> {
    return fetchJson(restoreResultSchema, '/api/system/restore', getAccessToken(), {
        method: 'POST',
        body: { file, confirm: 'RESTORE', ...(restoreEnv ? { restoreEnv: true } : {}) },
    });
}

/* ─── التصدير والتصفير ────────────────────────────────────────────────── */

export const EXPORT_ENTITIES = [
    'departments',
    'revenues',
    'expenses',
    'inventory',
    'inventoryTx',
    'dispatches',
    'recipes',
    'purchaseInvoices',
    'kitchenReturns',
    'users',
    'employees',
    'attendance',
    'leaveRequests',
    'hrDepartments',
    'leaveTypes',
    'shelves',
    'weightReadings',
    'settings',
] as const;

export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const EXPORT_PAGE_SIZE = 1000;
const EXPORT_MAX_PAGES = 20;

export interface ExportProgress {
    entity: string;
    index: number;
    total: number;
    rows: number;
}

export interface ExportBundle {
    version: number;
    exportDate: string;
    totals: Record<string, number>;
    data: Record<string, unknown[]>;
}

/** تصدير قراءة كل الكيانات التي كان V2 يصدّرها — عبر CRUD العام نفسه. */
export async function exportAllData(onProgress?: (progress: ExportProgress) => void): Promise<ExportBundle> {
    const data: Record<string, unknown[]> = {};
    const totals: Record<string, number> = {};
    for (const [index, entity] of EXPORT_ENTITIES.entries()) {
        const rows: unknown[] = [];
        for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
            const url = `/api/${encodeURIComponent(entity)}?limit=${EXPORT_PAGE_SIZE}&page=${page}`;
            const result = await fetchJson(entityPageSchema, url, getAccessToken());
            rows.push(...result.data);
            if (!result.hasNextPage) {
                break;
            }
            if (page === EXPORT_MAX_PAGES) {
                throw new Error(
                    `«${entity}» يتجاوز ${EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE} صف — استخدم النسخة الاحتياطية الكاملة (SQL) بدل التصدير`,
                );
            }
        }
        data[entity] = rows;
        totals[entity] = rows.length;
        onProgress?.({ entity, index: index + 1, total: EXPORT_ENTITIES.length, rows: rows.length });
    }
    return { version: 3, exportDate: new Date().toISOString(), totals, data };
}

export function downloadJson(filename: string, value: unknown): void {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export async function fetchAppState(): Promise<unknown> {
    return fetchJson(appStateSchema, '/api/state', getAccessToken());
}

export async function clearAppState(): Promise<void> {
    await writeAck('/api/state', 'DELETE');
}

export async function resetAllSystem(reason: string, force: boolean): Promise<ResetResult> {
    return fetchJson(resetResultSchema, '/api/warehouse/system/reset-all', getAccessToken(), {
        method: 'POST',
        body: { confirmation: 'CONFIRM PRODUCTION RESET', reason, force, scope: 'full' },
    });
}
