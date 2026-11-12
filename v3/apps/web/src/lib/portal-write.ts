import { z } from 'zod';
import type { PortalStatus } from './employee-portal';
import { isOn } from './employee-portal';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * أبواب بوابة الموظف الكتابية — مرآة `portal-repo.js` في V2:
 *
 *   البصمة الذاتية      POST   /api/attendance/portal/punch
 *   تسجيل الرفض الأصلي  POST   /api/attendance/portal/punch/client-reject
 *   قالب الوجه v1       POST   /api/attendance/portal/face/enroll
 *   قالب الوجه v2       POST   /api/attendance/portal/face/enroll-v2
 *   إزالة القالبين      DELETE /api/attendance/portal/face/enroll/:userId
 *
 * قواعد V2 المنقولة حرفيًّا:
 *  · الأدوار مرآة `requireRole` في `attendance-portal-routes.js` — والخادم يبقى
 *    الحاكم؛ القوائم هنا لإخفاء ما سيُرفض فقط.
 *  · البصمة تُقرأ من موقع الجهاز ووجهه ثم يحكم الخادم وحده (شبكة/موقع/وجه/ربط).
 *  · كل رفض محلي يُسجَّل عبر client-reject — لا رفض صامت خارج `punch_attempts`.
 *  · تفصيل الرفض يمرّ على قائمة السماح نفسها (أحرف/أرقام/نقطتان) قبل الإرسال.
 *  · معرّف الجهاز يستخدم مفتاح القديم نفسه `punch_device_id` فلا ينكسر الربط.
 *  · الصور لا تُخزَّن: تُمرَّر للخادم الذي يستخرج البصمة ثم يُهملها.
 */

/** أدوار البصمة الذاتية — مرآة requireRole في attendance-portal-routes.js:335 */
export const PUNCH_ROLES = ['admin', 'hr', 'dept_head', 'cashier', 'kitchen', 'sous_chef', 'warehouse', 'employee'] as const;

/** قوالب الوجه — مرآة requireRole في :880 و:901 و:922 (admin/hr فقط). */
export const FACE_ENROLL_ROLES = ['admin', 'hr'] as const;

/** رموز الرفض الأصلية المسموحة — مرآة CLIENT_REJECT_CODES في :681 */
export const CLIENT_REJECT_CODES = ['PUNCH_LOCATION_MOCKED_CLIENT', 'PUNCH_LOCATION_UNAVAILABLE_CLIENT'] as const;

/** مفتاح جهاز البصمة المشترك مع القديم — الربط لا ينكسر بين الواجهتين. */
export const DEVICE_ID_KEY = 'punch_device_id';

export function canPunchPortal(role: string | null | undefined): boolean {
    return isWriteRole(role, PUNCH_ROLES);
}

export function canEnrollFace(role: string | null | undefined): boolean {
    return isWriteRole(role, FACE_ENROLL_ROLES);
}

/**
 * تفصيل الرفض المحلي — نفس قائمة الخادم الصارمة (أحرف/أرقام/نقطتان فقط)
 * حتى لا يتحوّل نص جهاز إلى HTML مخزَّن في سجل المحاولات.
 */
export function sanitizeClientDetail(raw: unknown): string | null {
    return (
        String(raw ?? '')
            .replace(/[^A-Za-z0-9:_.\- ]/g, '')
            .trim()
            .slice(0, 120) || null
    );
}

export interface PortalStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function defaultStorage(): PortalStorage | null {
    try {
        return typeof globalThis === 'undefined' ? null : (globalThis.localStorage ?? null);
    } catch {
        return null;
    }
}

/**
 * معرّف جهاز مستقر — نفس مفتاح القديم فلا يُفكّ الربط عند تبديل الواجهة.
 * `storage: null` = بلا تخزين (جلسة خاصة/localStorage محجوب).
 */
export function portalDeviceId(storage?: PortalStorage | null): string {
    const store = storage !== undefined ? storage : defaultStorage();
    let id: string | null = null;
    try {
        id = store ? store.getItem(DEVICE_ID_KEY) : null;
    } catch {
        id = null;
    }
    if (id) {
        return String(id);
    }
    const cryptoObj = typeof globalThis === 'undefined' ? null : globalThis.crypto;
    id =
        cryptoObj && typeof cryptoObj.randomUUID === 'function'
            ? cryptoObj.randomUUID()
            : `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    try {
        store?.setItem(DEVICE_ID_KEY, id);
    } catch {
        // تخزين محجوب — المعرّف يبقى لهذه الجلسة فقط.
    }
    return String(id);
}

/* ─── العقود ────────────────────────────────────────────────────────────── */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();

const punchResultSchema = z
    .object({
        ok: boolLike,
        action: text,
        decision: text,
        record: z.unknown().optional(),
        at: text,
    })
    .passthrough();

export type PunchResult = z.infer<typeof punchResultSchema>;

const faceEnrollSchema = z
    .object({
        ok: boolLike,
        id: numLike,
        samples: numLike,
        enrolledAt: text,
    })
    .passthrough();

export type FaceEnrollAck = z.infer<typeof faceEnrollSchema>;

const faceRemovalSchema = z
    .object({
        ok: boolLike,
        removed: numLike,
        removedV2: numLike,
    })
    .passthrough();

export type FaceRemovalAck = z.infer<typeof faceRemovalSchema>;

/* ─── قراءات الموقع ─────────────────────────────────────────────────────── */

export interface GeoFix {
    lat: number;
    lng: number;
    accuracy: number;
    fixAgeS: number;
    alt: number | null;
    altAcc: number | null;
    heading: number | null;
    speed: number | null;
    t: number;
}

export interface MockSignals {
    mocked: boolean;
    detail?: string;
    mockAppSelected?: boolean;
}

export type GeoFixListener = (done: number, total: number, accuracy: number | null) => void;

export const GEO_TARGET = 6;
export const GEO_SESSION_MS = 9000;

function numberOrNull(value: unknown): number | null {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * 6 قراءات GPS خلال ~9 ثوانٍ — نفس تحصين القديم: السيرفر يحلل
 * التجميد/الانتقال/التشتت/الدقة الثابتة. محاولة ثانية فقط عند الفشل التام
 * (هوائيات داخلية بطيئة)، لا عند النجاح الجزئي.
 */
function collectOnce(onFix?: GeoFixListener): Promise<GeoFix[] | null> {
    return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            resolve(null);
            return;
        }
        const fixes: GeoFix[] = [];
        const sendTime = Date.now();
        let settled = false;
        let watchId: number | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (value: GeoFix[] | null) => {
            if (settled) {
                return;
            }
            settled = true;
            if (watchId !== null) {
                try {
                    navigator.geolocation.clearWatch(watchId);
                } catch {
                    // مشاهد ميتة أصلًا.
                }
            }
            if (timer !== null) {
                clearTimeout(timer);
            }
            resolve(value);
        };
        try {
            watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const coords = position.coords;
                    fixes.push({
                        lat: coords.latitude,
                        lng: coords.longitude,
                        accuracy: numberOrNull(coords.accuracy) ?? 999,
                        fixAgeS: Math.max(0, Math.round((sendTime - (position.timestamp || Date.now())) / 1000)),
                        alt: numberOrNull(coords.altitude),
                        altAcc: numberOrNull(coords.altitudeAccuracy),
                        heading: numberOrNull(coords.heading),
                        speed: numberOrNull(coords.speed),
                        t: Number(position.timestamp) || Date.now(),
                    });
                    try {
                        onFix?.(fixes.length, GEO_TARGET, numberOrNull(coords.accuracy));
                    } catch {
                        // مستمع واجهة معطوب لا يوقف القراءة.
                    }
                    if (fixes.length >= GEO_TARGET) {
                        done(fixes);
                    }
                },
                () => {
                    done(fixes.length ? fixes : null);
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: GEO_SESSION_MS },
            );
        } catch {
            done(null);
            return;
        }
        timer = setTimeout(() => {
            done(fixes.length ? fixes : null);
        }, GEO_SESSION_MS + 500);
    });
}

export async function collectLocationFixes(onFix?: GeoFixListener): Promise<GeoFix[] | null> {
    const first = await collectOnce(onFix);
    if (first) {
        return first;
    }
    return collectOnce(onFix);
}

interface CapacitorRoot {
    Capacitor?: { Plugins?: Record<string, unknown> };
}

interface MockLocationPlugin {
    isMockLocation: () => Promise<unknown>;
}

/** إشارات تزييف الجهاز الأصلية (Android فقط) — null على الويب/PWA. */
export async function nativeMockSignals(): Promise<MockSignals | null> {
    try {
        const root = globalThis as CapacitorRoot;
        const plugin = root.Capacitor?.Plugins?.MockLocationDetector as MockLocationPlugin | undefined;
        if (!plugin || typeof plugin.isMockLocation !== 'function') {
            return null;
        }
        const result = await Promise.race([
            plugin.isMockLocation(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), GEO_SESSION_MS)),
        ]);
        if (!result || typeof result !== 'object') {
            return null;
        }
        const value = result as { mocked?: unknown; detail?: unknown; mockAppSelected?: unknown };
        if (typeof value.mocked !== 'boolean') {
            return null;
        }
        return {
            mocked: value.mocked,
            ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
            ...(value.mockAppSelected === true ? { mockAppSelected: true } : {}),
        };
    } catch {
        return null;
    }
}

/* ─── الكتابة ───────────────────────────────────────────────────────────── */

export interface PunchPayload {
    deviceId: string;
    location: { fixes: GeoFix[]; mocked: boolean; spoofSignals: string[] } | null;
    faceDescriptor?: number[];
    faceImage?: string;
    faceImages?: string[];
    faceCapture?: { source: 'live' | 'upload'; sampleCount: number };
}

/** البصمة الذاتية — الحكم كله على الخادم (شبكة/موقع/وجه/ربط جهاز). */
export async function punchPortal(payload: PunchPayload): Promise<PunchResult> {
    return writeJson(punchResultSchema, '/api/attendance/portal/punch', 'POST', payload);
}

/**
 * رفض حدث على الجهاز قبل وصول البصمة للسيرفر — لا رفض صامت خارج سجل المحاولات.
 * أي رمز خارج القائمة البيضاء يُستبدل بـ`PUNCH_CLIENT_REJECTED` كما يفعل الخادم.
 */
export async function reportClientReject(reason: string, detail?: unknown): Promise<void> {
    const raw = String(reason ?? '');
    const code = (CLIENT_REJECT_CODES as readonly string[]).includes(raw) ? raw : 'PUNCH_CLIENT_REJECTED';
    await writeAck('/api/attendance/portal/punch/client-reject', 'POST', {
        reason: code,
        detail: sanitizeClientDetail(detail),
    });
}

/** محرك v1: متجهات 128 — التسجيل لـ admin/hr فقط. */
export async function enrollFaceV1(targetUserId: string | number, descriptors: number[][]): Promise<FaceEnrollAck> {
    return writeJson(faceEnrollSchema, '/api/attendance/portal/face/enroll', 'POST', {
        targetUserId,
        descriptors,
    });
}

/** محرك v2: 1-8 لقطات مقصوصة — السيرفر يستخرج المتجهات ولا يخزّن الصور. */
export async function enrollFaceV2(targetUserId: string | number, images: string[]): Promise<FaceEnrollAck> {
    return writeJson(faceEnrollSchema, '/api/attendance/portal/face/enroll-v2', 'POST', {
        targetUserId,
        images,
    });
}

/** إزالة القالبين معًا (v1 + v2) — admin/hr فقط. */
export async function removeFaceEnrollment(targetUserId: string | number): Promise<FaceRemovalAck> {
    return writeJson(faceRemovalSchema, `/api/attendance/portal/face/enroll/${encodeURIComponent(String(targetUserId))}`, 'DELETE');
}

/* ─── قرارات الواجهة ────────────────────────────────────────────────────── */

/**
 * هل لقطة الوجه وحدها لا تكفي؟ (v1 فقط أو قالب v2 غائب)
 * مرآة مسار الخادم: v2 يعمل فقط لمن لديه قالب v2 نشط.
 */
export function faceV1Required(status: PortalStatus | null | undefined): boolean {
    const v2Handles = isOn(status?.faceV2?.enabled) && isOn(status?.faceV2?.enrolled);
    return isOn(status?.faceEnabled) && !v2Handles;
}

/** عدد العينات المطلوبة للبصمة — الوضع الصارم يفرض عيّنتين على الأقل. */
export function punchSampleTarget(status: PortalStatus | null | undefined): number {
    if (!isOn(status?.faceStrict)) {
        return 1;
    }
    return Math.max(2, Number(status?.faceMinSamples) || 2);
}

/** نص نتيجة البصمة من قرار المحرك — نفس رسائل القديم. */
export function punchActionLabel(action: unknown): string {
    if (action === 'check_in') {
        return '✅ تم تسجيل الحضور';
    }
    if (action === 'check_out') {
        return '✅ تم تسجيل الانصراف';
    }
    return '✅ تم تسجيل البصمة';
}

/** رسالة نتيجة التسجيل المزدوج — نص القديم نفسه. */
export function faceEnrollMessage(saved: { v1?: boolean; v2?: boolean; v1Error?: string; v2Error?: string }): string {
    if (saved.v2 && saved.v1) {
        return 'تم تسجيل الوجه بالمحركين — البصمة جاهزة من أي كاميرا';
    }
    if (saved.v2) {
        return `تم تسجيل الوجه بالمحرك المتقدم${saved.v1Error ? ` (الأساسي: ${saved.v1Error})` : ''}`;
    }
    if (saved.v1) {
        return `تم تسجيل الوجه بالمحرك الأساسي${saved.v2Error ? ` (المتقدم: ${saved.v2Error})` : ''}`;
    }
    return `فشل التسجيل: ${saved.v2Error || saved.v1Error || 'لا لقطة صالحة'}`;
}
