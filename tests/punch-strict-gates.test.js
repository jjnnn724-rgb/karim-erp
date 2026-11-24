/**
 * punch-strict-gates.test.js — صرامة البصمة بلا استثناءات (2026-11-02)
 * ────────────────────────────────────────────────────────────────────
 * طلب المالك (2026-11-02): «مفيش أي استثناء في البصمة، عايزها صارمة وحازمة، حتى بصمة
 * الوجه حازمة والـGPS احترافي» — والدليل الميداني من
 * scripts/backtest-strict-gates-2026-11-02.js:
 *   • 40 من 119 بصمة مقبولة دخلت من استثناء «قراءة واحدة»
 *   • fixAgeS المبعوث من العميل = 0 دائمًا (p95 = 0) فحدّ العمر لا يعمل
 *   • 118 من 119 مسافة وجه < 0.05 — تشابه شبه تام مع القالب
 *
 * تغطي: مفاتيح الصرامة الجديدة (افتراضيًا مغلقة حتى يقرّر المالك)، حذف استثناء
 * القراءة الواحدة، عمر القراءة المحسوب سيرفريًا، وحكم عينات الوجه الصارم.
 */
'use strict';

const {
    evaluatePunch,
    resolvePunchSettings,
    assessFixFreshness,
    assessFaceSamples,
} = require('../backend/punch-portal-logic');

const RESTAURANT = { lat: 24.7136, lng: 46.6753 };

const rows = (extra = []) => resolvePunchSettings([
    { key: 'punch_portal_enabled', value: 'true' },
    { key: 'punch_geofence_enabled', value: 'true' },
    { key: 'punch_device_binding', value: 'false' },
    { key: 'punch_radius_meters', value: '120' },
    { key: 'punch_max_accuracy_m', value: '50' },
    { key: 'punch_max_fix_age_s', value: '30' },
    { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
    { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
    ...extra,
]);

const jitterFixes = (over = {}) => ([
    { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 12, fixAgeS: 1, ...over },
    { lat: RESTAURANT.lat + 0.00004, lng: RESTAURANT.lng - 0.00002, accuracy: 15, fixAgeS: 3, ...over },
    { lat: RESTAURANT.lat - 0.00002, lng: RESTAURANT.lng + 0.00005, accuracy: 18, fixAgeS: 5, ...over },
]);

const at = (offsetMs) => ({ t: Date.now() - offsetMs });
const baseReq = (location, extra = {}) => ({
    remoteIp: '192.168.1.55',
    deviceId: 'device-1',
    location,
    serverNowMs: Date.now(),
    ...extra,
});

describe('مفاتيح الصرامة — تولد مغلقة', () => {
    test('الافتراضي: استثناء القراءة الواحدة باقٍ والوجه غير صارم', () => {
        const s = rows();
        expect(s.geoStrictMultiFix).toBe(false);
        expect(s.faceStrict).toBe(false);
        expect(s.faceMinSamples).toBe(2);
        expect(s.maxClockSkewS).toBe(120);
        expect(s.faceReplayMinDistance).toBe(0.004);
    });
    test('قراءة واحدة مقبولة اليوم (دقة ≤30م) — هذا هو الاستثناء المراد حذفه', () => {
        const v = evaluatePunch(rows(), baseReq({
            lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 10, fixAgeS: 2,
        }));
        expect(v.decision).toBe('accepted');
        expect(v.details.singleFix).toBe(true);
        expect(v.details.trustSignals).toContain('SINGLE_FIX_FALLBACK');
    });
});

describe('punch_geo_strict_multi_fix — بلا استثناء القراءة الواحدة', () => {
    test('نفس القراءة الواحدة تُرفض عند الصرامة', () => {
        const v = evaluatePunch(rows([{ key: 'punch_geo_strict_multi_fix', value: 'true' }]),
            baseReq({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 10, fixAgeS: 2 }));
        expect(v.decision).toBe('rejected');
        expect(v.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('ثلاث قراءات جيدة تقبل عند الصرامة', () => {
        const v = evaluatePunch(rows([{ key: 'punch_geo_strict_multi_fix', value: 'true' }]),
            baseReq({ fixes: jitterFixes() }));
        expect(v.decision).toBe('accepted');
    });
});

describe('assessFixFreshness — عمر القراءة بحساب السيرفر', () => {
    const NOW = 1_700_000_000_000;
    test('بلا طابع جهاز → غير قابل للتحقق (لا يرفض عميلًا قديمًا)', () => {
        expect(assessFixFreshness({ accuracy: 10 }, NOW, {}).status).toBe('unverifiable');
    });
    test('قراءة طازجة → ok', () => {
        const r = assessFixFreshness({ t: NOW - 5000 }, NOW, { maxAgeS: 30, maxSkewS: 120 });
        expect(r.status).toBe('ok');
        expect(r.ageS).toBe(5);
    });
    test('قراءة أقدم من الحد (والساعة موثوقة) → stale', () => {
        expect(assessFixFreshness({ t: NOW - 60_000 }, NOW, { maxAgeS: 30, maxSkewS: 120 }).status).toBe('stale');
    });
    test('ساعة الجهاز سابقة للسيرفر بأكثر من الحد → skew (تُرفض دائمًا لا عند الصرامة فقط)', () => {
        expect(assessFixFreshness({ t: NOW + 600_000 }, NOW, { maxSkewS: 120 }).status).toBe('skew');
    });
    test('ساعة متأخرة أكثر من الحد: العمر غير موثوق فلا يُرفض الموظف على حساب لا نثق به', () => {
        let r = assessFixFreshness({ t: NOW - 600_000 }, NOW, { maxAgeS: 30, maxSkewS: 120 });
        expect(r.status).toBe('unverifiable');
        r = assessFixFreshness({ t: NOW - 12_000_000 }, NOW, { maxAgeS: 30, maxSkewS: 120 });
        expect(r.status).toBe('unverifiable');
    });
});

describe('تسلسل الحكم — الساعة المضبوطة غلطًا ترفض ولو غير صارم', () => {
    test('PUNCH_LOCATION_CLOCK_SKEW يطرد قبل النطاق', () => {
        const skewed = jitterFixes(at(-600_000)); // طوابع في المستقبل بـ10 دقائق
        const v = evaluatePunch(rows(), baseReq({ fixes: skewed }));
        expect(v.decision).toBe('rejected');
        expect(v.rejectCode).toBe('PUNCH_LOCATION_CLOCK_SKEW');
        expect(v.details.clockSkewS).toBeGreaterThan(120);
    });
    test('القديمة ترفض عند الصرامة فقط', () => {
        const stale = jitterFixes(at(90_000));
        expect(evaluatePunch(rows(), baseReq({ fixes: stale })).decision).toBe('accepted');
        const strict = evaluatePunch(rows([{ key: 'punch_geo_strict_multi_fix', value: 'true' }]),
            baseReq({ fixes: stale }));
        expect(strict.decision).toBe('rejected');
        expect(strict.rejectCode).toBe('PUNCH_LOCATION_WEAK');
        expect(strict.details.serverAgeS).toBeGreaterThanOrEqual(90);
    });
});

describe('assessFaceSamples — دليل الوجه يُحسب على السيرفر', () => {
    const strict = { minSamples: 2, threshold: 0.42, replayMinDistance: 0.004 };
    const ok = (input) => assessFaceSamples({ ...input });

    test('عيّنتان مطابقتان من الكاميرا → مقبول', () => {
        expect(ok({ distances: [0.21, 0.18], hasServerImage: true, ...strict }).ok).toBe(true);
    });
    test('بلا صورة (متجه العميل وحده) → مرفوض مهما كانت المسافة', () => {
        const r = ok({ distances: [], hasServerImage: false, ...strict });
        expect(r.rejectCode).toBe('PUNCH_FACE_SERVER_EMBED_REQUIRED');
    });
    test('صورة من المعرض → مرفوضة في الصرامة', () => {
        expect(ok({ distances: [0.2, 0.22], hasServerImage: true, fromUpload: true, ...strict }).rejectCode)
            .toBe('PUNCH_FACE_UPLOAD_FORBIDDEN');
    });
    test('عيّنة واحدة لا تكفي', () => {
        expect(ok({ distances: [0.2], hasServerImage: true, ...strict }).rejectCode)
            .toBe('PUNCH_FACE_SAMPLES_REQUIRED');
    });
    test('تشابه مطلق مع القالب = نفس الصورة أعيدت لا وجه حيّ', () => {
        expect(ok({ distances: [0.0001, 0.02], hasServerImage: true, ...strict }).rejectCode)
            .toBe('PUNCH_FACE_REPLAY');
    });
    test('صورتان متطابقتان بايتيًا → إعادة تشغيل', () => {
        expect(ok({ distances: [0.2, 0.2], identicalImages: true, hasServerImage: true, ...strict }).rejectCode)
            .toBe('PUNCH_FACE_REPLAY');
    });
    test('كل العيّنات تُحاكم لا أحسنها: عيّنة فوق العتبة ترفض', () => {
        const r = ok({ distances: [0.1, 0.55], hasServerImage: true, ...strict });
        expect(r.rejectCode).toBe('PUNCH_FACE_MISMATCH');
        expect(r.maxDistance).toBe(0.55);
    });
    test('قيم غير رقمية (لم يُرصد وجه) لا تُحتسب عيّنات ولا تُقرأ صفرًا', () => {
        expect(ok({ distances: [NaN, null], hasServerImage: true, ...strict }).samples).toBe(0);
    });
});

describe('عقد الصرامة بين الواجهة والسيرفر', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const ROUTES = read('backend/attendance-portal-routes.js');
    const SCREEN = read('frontend/app/js/v2/screens/employee-portal.js');
    const FACE = read('frontend/app/js/v2/portal-face.js');
    const SETTINGS = read('frontend/app/js/v2/screens/settings.js');

    test('السيرفر يستدعي الحكم الصارم عند المفتوح ويغلّق البوابة على من لا يملك قالب v2', () => {
        expect(ROUTES).toMatch(/if \(settings\.faceStrict === true\) \{/);
        expect(ROUTES).toMatch(/verifyFaceStrict/);
        expect(ROUTES).toMatch(/PUNCH_FACE_NOT_ENROLLED/);
    });
    test('السيرفر يوثّق عمر القراءة المحسوب لديه لا رقم العميل', () => {
        expect(ROUTES).toMatch(/SERVER_FIX_AGE_/);
        expect(ROUTES).toMatch(/serverNowMs: Date.now\(\)/);
    });
    test('الشاشة تبعث كل العينات وأصل الالتقاط، وتطلب عينات متعددة عند الصرامة', () => {
        expect(SCREEN).toMatch(/payload\.faceImages = face\.images;/);
        expect(SCREEN).toMatch(/payload\.faceCapture = \{/);
        expect(SCREEN).toMatch(/target: s\.faceStrict \? Math\.max\(2, Number\(s\.faceMinSamples\) \|\| 2\) : 1/);
        expect(SCREEN).toMatch(/allowUpload: s\.faceStrict !== true/);
    });
    test('كاميرا الوجه تسجّل مصدر كل لقطة وتخفي «رفع صورة» في الوضع الصارم', () => {
        expect(FACE).toMatch(/addSample\(image, descriptor, 'live'\)/);
        expect(FACE).toMatch(/addSample\(jpeg, descriptor, 'upload'\)/);
        expect(FACE).toMatch(/allowUpload \? /);
    });
    test('المفاتيح الصارمة على قائمة بيضاء قابلة للحفظ من إعدادات البصمة', () => {
        for (const key of ['punch_geo_strict_multi_fix', 'punch_strict_geofence', 'punch_max_clock_skew_s',
            'punch_face_strict', 'punch_face_min_samples', 'punch_face_replay_min_distance']) {
            expect(ROUTES).toContain(`${key}:`);
            const inUi = SETTINGS.includes(`data-v2-pu="${key}"`)
                || SETTINGS.includes(`data-v2-pu-check="${key}"`);
            expect(inUi).toBe(true);
        }
    });
});
