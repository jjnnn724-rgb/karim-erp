import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
    canEnrollFace,
    canPunchPortal,
    collectLocationFixes,
    DEVICE_ID_KEY,
    enrollFaceV1,
    enrollFaceV2,
    faceEnrollMessage,
    faceV1Required,
    nativeMockSignals,
    type PortalStorage,
    portalDeviceId,
    punchActionLabel,
    punchPortal,
    punchSampleTarget,
    removeFaceEnrollment,
    reportClientReject,
    sanitizeClientDetail,
} from './portal-write';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(body: unknown = { ok: true }) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(body));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) {
        throw new Error('لم يُستدعَ fetch');
    }
    return { url: String(call[0]), init: call[1] ?? {} };
}

function memoryStorage(initial: Record<string, string> = {}): PortalStorage & { data: Record<string, string> } {
    const data = { ...initial };
    return {
        data,
        getItem: (key: string) => data[key] ?? null,
        setItem: (key: string, value: string) => {
            data[key] = value;
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('أدوار بوابة الموظف', () => {
    it('البصمة لكل أدوار الخادم الثمانية فقط', () => {
        for (const role of ['admin', 'hr', 'dept_head', 'cashier', 'kitchen', 'sous_chef', 'warehouse', 'employee']) {
            expect(canPunchPortal(role)).toBe(true);
        }
        expect(canPunchPortal('manager')).toBe(false);
        expect(canPunchPortal('auditor')).toBe(false);
        expect(canPunchPortal(null)).toBe(false);
    });

    it('قوالب الوجه لـ admin و hr فقط — كما في الخادم', () => {
        expect(canEnrollFace('admin')).toBe(true);
        expect(canEnrollFace('hr')).toBe(true);
        expect(canEnrollFace('manager')).toBe(false);
        expect(canEnrollFace('employee')).toBe(false);
    });
});

describe('تفصيل الرفض المحلي', () => {
    it('يبقي أكواد الآلة ويحذف أي حرف خارج القائمة', () => {
        expect(sanitizeClientDetail('lastKnown:GPS / live:network')).toBe('lastKnown:GPS  live:network');
        expect(sanitizeClientDetail('<script>alert(1)</script>')).toBe('scriptalert1script');
    });

    it('يقتطع عند 120 حرفًا ويعيد null للفراغ', () => {
        expect(sanitizeClientDetail('a'.repeat(200))).toHaveLength(120);
        expect(sanitizeClientDetail('')).toBeNull();
        expect(sanitizeClientDetail(null)).toBeNull();
        expect(sanitizeClientDetail('عربي')).toBeNull();
    });
});

describe('معرّف جهاز البصمة', () => {
    it('يعيد المخزَّن كما هو بمفتاح القديم نفسه', () => {
        const storage = memoryStorage({ [DEVICE_ID_KEY]: 'device-abc' });
        expect(portalDeviceId(storage)).toBe('device-abc');
    });

    it('يولّد معرّفًا ويحفظه عند أول استخدام', () => {
        const storage = memoryStorage();
        const id = portalDeviceId(storage);
        expect(id.length).toBeGreaterThan(10);
        expect(storage.data[DEVICE_ID_KEY]).toBe(id);
        expect(portalDeviceId(storage)).toBe(id);
    });

    it('يعمل بلا تخزين أو بتخزين يرمي', () => {
        const broken: PortalStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        };
        expect(portalDeviceId(broken).length).toBeGreaterThan(10);
        expect(portalDeviceId(null).length).toBeGreaterThan(10);
    });
});

describe('قرارات الواجهة', () => {
    it('محرك v1 مطلوب إن كان مفعّلًا وبلا قالب v2 نشط', () => {
        expect(faceV1Required({ faceEnabled: true })).toBe(true);
        expect(faceV1Required({ faceEnabled: true, faceV2: { enabled: true, enrolled: false } })).toBe(true);
        expect(faceV1Required({ faceEnabled: true, faceV2: { enabled: true, enrolled: true } })).toBe(false);
        expect(faceV1Required({ faceEnabled: false, faceV2: { enabled: true, enrolled: true } })).toBe(false);
        expect(faceV1Required(null)).toBe(false);
    });

    it('الوضع الصارم يفرض عيّنتين على الأقل', () => {
        expect(punchSampleTarget({})).toBe(1);
        expect(punchSampleTarget({ faceStrict: true })).toBe(2);
        expect(punchSampleTarget({ faceStrict: true, faceMinSamples: 5 })).toBe(5);
        expect(punchSampleTarget({ faceStrict: true, faceMinSamples: 1 })).toBe(2);
    });

    it('نصوص نتيجة البصمة والتسجيل كالقديم', () => {
        expect(punchActionLabel('check_in')).toBe('✅ تم تسجيل الحضور');
        expect(punchActionLabel('check_out')).toBe('✅ تم تسجيل الانصراف');
        expect(punchActionLabel('ignore')).toBe('✅ تم تسجيل البصمة');
        expect(faceEnrollMessage({ v1: true, v2: true })).toContain('بالمحركين');
        expect(faceEnrollMessage({ v2: true, v1Error: 'x' })).toContain('(الأساسي: x)');
        expect(faceEnrollMessage({ v1: true, v2Error: 'y' })).toContain('(المتقدم: y)');
        expect(faceEnrollMessage({})).toContain('فشل التسجيل');
    });
});

describe('عقود الكتابة', () => {
    it('البصمة ترسل الجسم كاملًا إلى المسار الصحيح وتقرأ القرار', async () => {
        const fetchMock = stubFetch({
            ok: true,
            action: 'check_out',
            decision: 'accepted',
            record: { id: 9 },
            at: '2026-11-11T06:00:00.000Z',
        });
        const result = await punchPortal({
            deviceId: 'dev-1',
            location: null,
            faceDescriptor: [0.1, 0.2],
        });
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/attendance/portal/punch');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({
            deviceId: 'dev-1',
            location: null,
            faceDescriptor: [0.1, 0.2],
        });
        expect(result.action).toBe('check_out');
        expect(result.record).toEqual({ id: 9 });
    });

    it('يرفض رمز الخادم يُطرح كـApiError بكوده', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'PUNCH_OUT_OF_RANGE', message: 'أنت خارج نطاق المطعم' }, 403)),
        );
        await expect(punchPortal({ deviceId: 'dev-1', location: null })).rejects.toMatchObject({
            code: 'PUNCH_OUT_OF_RANGE',
            message: 'أنت خارج نطاق المطعم',
        });
        await expect(punchPortal({ deviceId: 'dev-1', location: null })).rejects.toBeInstanceOf(ApiError);
    });

    it('الرفض المحلي يحفظ الرمز المسموح ويستبدل غيره ويُنقّي التفصيل', async () => {
        const fetchMock = stubFetch({ ok: true });
        await reportClientReject('PUNCH_LOCATION_MOCKED_CLIENT', 'mock:android');
        let request = lastRequest(fetchMock);
        expect(request.url).toBe('/api/attendance/portal/punch/client-reject');
        expect(JSON.parse(String(request.init.body))).toEqual({
            reason: 'PUNCH_LOCATION_MOCKED_CLIENT',
            detail: 'mock:android',
        });

        await reportClientReject('SOMETHING_ELSE', '<b>x</b>');
        request = lastRequest(fetchMock);
        expect(JSON.parse(String(request.init.body))).toEqual({
            reason: 'PUNCH_CLIENT_REJECTED',
            detail: 'bxb',
        });
    });

    it('تسجيل الوجه v1 وv2 وإزالة القالبين بعقودها', async () => {
        const fetchMock = stubFetch({ ok: true, removed: 1, removedV2: 1 });
        await enrollFaceV1('12', [[0.1, 0.2]]);
        let request = lastRequest(fetchMock);
        expect(request.url).toBe('/api/attendance/portal/face/enroll');
        expect(JSON.parse(String(request.init.body))).toEqual({ targetUserId: '12', descriptors: [[0.1, 0.2]] });

        await enrollFaceV2('12', ['data:image/jpeg;base64,AAA']);
        request = lastRequest(fetchMock);
        expect(request.url).toBe('/api/attendance/portal/face/enroll-v2');
        expect(JSON.parse(String(request.init.body))).toEqual({
            targetUserId: '12',
            images: ['data:image/jpeg;base64,AAA'],
        });

        const removal = await removeFaceEnrollment('a/b');
        request = lastRequest(fetchMock);
        expect(request.url).toBe('/api/attendance/portal/face/enroll/a%2Fb');
        expect(request.init.method).toBe('DELETE');
        expect(removal.removed).toBe(1);
        expect(removal.removedV2).toBe(1);
    });
});

describe('قراءات الموقع', () => {
    it('يجمع ست قراءات من watchPosition ويبلّغ المستمع بالتقدم', async () => {
        const watchPosition = vi.fn((success: PositionCallback) => {
            for (let index = 1; index <= 6; index += 1) {
                success({
                    coords: {
                        latitude: 24.7,
                        longitude: 46.6,
                        accuracy: 10 + index,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: null,
                    },
                    timestamp: Date.now(),
                } as GeolocationPosition);
            }
            return 1;
        });
        vi.stubGlobal('navigator', {
            geolocation: { watchPosition, clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
        });
        const progress: number[] = [];
        const fixes = await collectLocationFixes((done) => progress.push(done));
        expect(fixes).toHaveLength(6);
        expect(fixes?.[0]).toMatchObject({ lat: 24.7, lng: 46.6, fixAgeS: 0 });
        expect(fixes?.[5]?.accuracy).toBe(16);
        expect(progress.at(-1)).toBe(6);
    });

    it('يعيد null بلا geolocation', async () => {
        vi.stubGlobal('navigator', {});
        await expect(collectLocationFixes()).resolves.toBeNull();
    });

    it('يقرأ إشارات التزييف من بلجن Capacitor ويجاهل غيرها', async () => {
        vi.stubGlobal('Capacitor', {
            Plugins: { MockLocationDetector: { isMockLocation: async () => ({ mocked: true, detail: 'mock:gps' }) } },
        });
        await expect(nativeMockSignals()).resolves.toEqual({ mocked: true, detail: 'mock:gps' });

        vi.stubGlobal('Capacitor', { Plugins: {} });
        await expect(nativeMockSignals()).resolves.toBeNull();
    });
});
