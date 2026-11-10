import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * بوابة الموظف — قراءة حالتها وبصماتي فقط:
 *   GET /api/attendance/portal/status  → ربط الحساب بالموظف، وحالة اليوم،
 *     وأعلام البوابة والموقع وقوالب الوجه (كما يرد من `attendance-portal-routes`).
 *   GET /api/zkteco/my-punches        → بصمات الحساب المرتبط (قد تكون غير مرتبطة).
 *
 * الكتابة كلها (البصمة وتسجيل الرفض وتسجيل الوجه) تبقى في القديم وراء
 * بواباتها. لا شيء هنا يُرسل POST.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const portalStatusSchema = z
    .object({
        ok: boolLike,
        enabled: boolLike,
        geofence: boolLike,
        deviceBinding: boolLike,
        radiusMeters: numLike,
        hasEmployeeProfile: boolLike,
        employeeName: text,
        deviceBound: boolLike,
        faceEnabled: boolLike,
        faceEnrolled: boolLike,
        faceStrict: boolLike,
        today: z.object({ checkIn: text, checkOut: text }).passthrough().optional(),
    })
    .passthrough();

export type PortalStatus = z.infer<typeof portalStatusSchema>;

const punchSchema = z
    .object({
        id: idValue,
        attendanceTime: text,
        punchTime: text,
        state: numLike,
        verifyType: numLike,
        deviceName: text,
    })
    .passthrough();

export const myPunchesSchema = z
    .object({
        linked: boolLike,
        punchCount: numLike,
        punches: z.array(punchSchema).optional(),
        error: text,
    })
    .passthrough();

export type MyPunches = z.infer<typeof myPunchesSchema>;

export interface PortalSnapshot {
    status: PortalStatus | null;
    punches: MyPunches | null;
    failures: string[];
}

export async function fetchPortalSnapshot(signal?: AbortSignal): Promise<PortalSnapshot> {
    const token = getAccessToken();
    const options = signal ? { signal } : {};
    const settled = await Promise.allSettled([
        fetchJson(portalStatusSchema, '/api/attendance/portal/status', token, options),
        fetchJson(myPunchesSchema, '/api/zkteco/my-punches', token, options),
    ]);
    const failures: string[] = [];
    settled.forEach((result, index) => {
        if (result.status === 'rejected') {
            const name = index === 0 ? 'حالة البوابة' : 'بصماتي';
            const reason = result.reason instanceof Error ? result.reason.message : 'لم يستجب';
            failures.push(`${name}: ${reason}`);
        }
    });
    return {
        status: settled[0]?.status === 'fulfilled' ? settled[0].value : null,
        punches: settled[1]?.status === 'fulfilled' ? settled[1].value : null,
        failures,
    };
}

/** تسميات حالات البصمة كما في `zkteco-repo.punchStateName`. */
const PUNCH_STATES = ['حضور', 'انصراف', 'خروج استراحة', 'عودة استراحة', 'دخول أوفر تايم', 'خروج أوفر تايم'];

export function punchStateName(state: unknown): string {
    if (state === null || state === undefined || state === '') {
        return 'غير محددة';
    }
    const value = Number(state);
    if (value === -1) {
        return 'غير محددة';
    }
    return PUNCH_STATES[value] ?? `حالة ${String(state)}`;
}

export function isOn(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

/** وقت البصمة كما ورد (تاريخ + وقت) بلا تحويل منطقة زمنية. */
export function punchTimeText(punch: z.infer<typeof punchSchema>): string {
    const raw = String(punch.attendanceTime ?? punch.punchTime ?? '');
    return raw ? raw.slice(0, 16).replace('T', ' ') : '—';
}
