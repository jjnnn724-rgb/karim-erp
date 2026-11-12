import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * أجهزة البصمة — أبواب الكتابة (كانت في V2 وحده):
 *
 *   إضافة جهاز       POST   /api/zkteco/devices              (routes.js:148)
 *   تعديل جهاز       PUT    /api/zkteco/devices/:id          (routes.js:170)
 *   حذف جهاز         DELETE /api/zkteco/devices/:id          (routes.js:203)
 *   فحص اتصال        POST   /api/zkteco/devices/:id/test     (routes.js:216)
 *   مزامنة فورية     POST   /api/zkteco/devices/:id/sync     (routes.js:235)
 *   تشغيل/إيقاف      POST   /api/zkteco/engine/:action       (routes.js:1101)
 *
 * الأدوار حرفيًّا: الكتابة `admin|hr` (`WRITE_ROLES`)، والتحكم
 * `admin|owner` (`CONTROL_ROLES`). سبب إجراء المحرك إلزامي (≥ 3 أحرف)
 * لأن الخادم يسجّله في سجل التحكم.
 */

export const ZK_WRITE_ROLES = ['admin', 'hr'] as const;
export const ZK_CONTROL_ROLES = ['admin', 'owner'] as const;
export const ZK_ENGINE_ACTIONS = ['start', 'stop', 'restart'] as const;
export type ZkEngineAction = (typeof ZK_ENGINE_ACTIONS)[number];
const MAX_REASON = 200;

export function canWriteZk(role: string | null | undefined): boolean {
    return isWriteRole(role, ZK_WRITE_ROLES);
}

export function canControlZk(role: string | null | undefined): boolean {
    return isWriteRole(role, ZK_CONTROL_ROLES);
}

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export interface ZkDeviceForm {
    name: string;
    ipAddress: string;
    port: string;
    commKey: string;
    syncIntervalSeconds: string;
    enabled: boolean;
}

export function emptyZkDeviceForm(): ZkDeviceForm {
    return { name: '', ipAddress: '', port: '4370', commKey: '0', syncIntervalSeconds: '30', enabled: true };
}

export type ZkDeviceField = keyof ZkDeviceForm;

/** تحقق مطابق لـ`validateDevicePayload` في الخادم (`routes.js:56`). */
export function validateZkDeviceForm(form: ZkDeviceForm): { field: ZkDeviceField; message: string }[] {
    const errors: { field: ZkDeviceField; message: string }[] = [];
    const name = String(form.name ?? '').trim();
    if (!name || name.length > 100) {
        errors.push({ field: 'name', message: 'اسم الجهاز مطلوب (حتى 100 حرف)' });
    }
    if (!IPV4_PATTERN.test(String(form.ipAddress ?? '').trim())) {
        errors.push({ field: 'ipAddress', message: 'عنوان IP غير صالح (مثال: 192.168.1.201)' });
    }
    const port = form.port === '' ? 4370 : Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push({ field: 'port', message: 'المنفذ غير صالح' });
    }
    const key = String(form.commKey ?? '').trim();
    if (key !== '') {
        const value = Number(key);
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
            errors.push({ field: 'commKey', message: 'مفتاح الاتصال (Comm Key) بين 0 و 65535' });
        }
    }
    const interval = form.syncIntervalSeconds === '' ? 30 : Number(form.syncIntervalSeconds);
    if (!Number.isInteger(interval) || interval < 5 || interval > 86_400) {
        errors.push({ field: 'syncIntervalSeconds', message: 'فترة المزامنة بين 5 و 86400 ثانية' });
    }
    return errors;
}

export interface ZkDevicePayload {
    name: string;
    ipAddress: string;
    port: number;
    commKey?: number;
    syncIntervalSeconds: number;
    enabled: boolean;
}

/** حمولة الجهاز — الحقول الاختيارية لا تُرسل فارغة. */
export function zkDevicePayload(form: ZkDeviceForm): ZkDevicePayload {
    const key = String(form.commKey ?? '').trim();
    const payload: ZkDevicePayload = {
        name: String(form.name ?? '').trim(),
        ipAddress: String(form.ipAddress ?? '').trim(),
        port: form.port === '' ? 4370 : Number(form.port),
        syncIntervalSeconds: form.syncIntervalSeconds === '' ? 30 : Number(form.syncIntervalSeconds),
        enabled: Boolean(form.enabled),
    };
    if (key !== '') {
        payload.commKey = Number(key);
    }
    return payload;
}

const deviceSchema = z.object({}).passthrough();
const actionSchema = z
    .object({
        ok: z.boolean().optional(),
        message: z.string().nullable().optional(),
        running: z.boolean().optional(),
    })
    .passthrough();

export async function createZkDevice(form: ZkDeviceForm): Promise<void> {
    await writeJson(deviceSchema, '/api/zkteco/devices', 'POST', zkDevicePayload(form));
}

export async function updateZkDevice(id: string, form: ZkDeviceForm): Promise<void> {
    await writeJson(deviceSchema, `/api/zkteco/devices/${encodeURIComponent(id)}`, 'PUT', zkDevicePayload(form));
}

export async function deleteZkDevice(id: string): Promise<void> {
    await writeAck(`/api/zkteco/devices/${encodeURIComponent(id)}`, 'DELETE');
}

export interface ZkProbeResult {
    message: string;
}

export async function testZkDevice(id: string): Promise<ZkProbeResult> {
    const result = await writeJson(actionSchema, `/api/zkteco/devices/${encodeURIComponent(id)}/test`, 'POST', {});
    return { message: String(result.message ?? 'تم الاتصال بالجهاز') };
}

export async function syncZkDevice(id: string): Promise<ZkProbeResult> {
    const result = await writeJson(actionSchema, `/api/zkteco/devices/${encodeURIComponent(id)}/sync`, 'POST', {});
    return { message: String(result.message ?? 'تمت المزامنة') };
}

/** سبب إجراء المحرك — نفس تحقق الخادم (`ZK_REASON_REQUIRED`). */
export function zkEngineReasonError(reason: unknown): string {
    const value = String(reason ?? '').trim();
    return value.length >= 3 ? '' : 'سبب الإجراء مطلوب (3 أحرف على الأقل)';
}

export interface ZkEngineResult {
    running: boolean;
    message: string;
}

export async function zkEngineAction(action: ZkEngineAction, reason: string): Promise<ZkEngineResult> {
    const result = await writeJson(actionSchema, `/api/zkteco/engine/${encodeURIComponent(action)}`, 'POST', {
        reason: String(reason ?? '')
            .trim()
            .slice(0, MAX_REASON),
    });
    return { running: result.running === true, message: String(result.message ?? '') };
}

export const ZK_WRITE_TEXT = {
    addTitle: 'إضافة جهاز بصمة',
    editTitle: 'تعديل جهاز البصمة',
    add: 'إضافة جهاز',
    save: 'حفظ',
    cancel: 'إغلاق',
    name: 'اسم الجهاز',
    ip: 'عنوان IP',
    port: 'المنفذ',
    commKey: 'مفتاح الاتصال (Comm Key)',
    syncInterval: 'فترة المزامنة (ثانية)',
    enabled: 'الجهاز مفعّل',
    test: 'فحص الاتصال',
    sync: 'مزامنة الآن',
    edit: 'تعديل',
    delete: 'حذف',
    deleteConfirm: (name: string) => `حذف الجهاز «${name}» مع سجل بصماته الخام؟ لا يمكن التراجع.`,
    deleted: 'حُذف الجهاز',
    created: 'أُضيف الجهاز',
    updated: 'حُدّث الجهاز',
    engineTitle: 'التحكم في محرك المزامنة',
    engineHint: 'كل إجراء يُسجَّل في سجل التحكم بسببٍ إلزامي.',
    reason: 'السبب',
    reasonPlaceholder: 'مثال: توقف الشبكة عن الجهاز',
    start: 'تشغيل المحرك',
    stop: 'إيقاف المحرك',
    restart: 'إعادة تشغيل',
    engineDone: 'نُفّذ إجراء المحرك',
    engineFailed: 'تعذر تنفيذ إجراء المحرك',
    saveFailed: 'تعذر حفظ الجهاز',
    deleteFailed: 'تعذر حذف الجهاز',
    testFailed: 'فشل فحص الاتصال',
    syncFailed: 'فشلت المزامنة',
} as const;
