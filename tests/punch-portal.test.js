/**
 * punch-portal.test.js — بوابة البصمة الذاتية: كل سيناريوهات الرفض/القبول
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md §5.7 (معايير القبول)
 * يختبر طبقة المنطق النقي (punch-portal-logic) — نفس الدوال التي يقرر بها
 * السيرفر فعليًا — بحيث يكون كل سيناريو من سيناريوهات "لا يكسر النظام" مُثبتًا.
 */
'use strict';

const {
    haversineMeters,
    isInternalIp,
    resolvePunchSettings,
    evaluatePunch,
} = require('../backend/punch-portal-logic');

// إحداثيات مرجعية واقعية (الرياض) — ~111 كم لكل درجة خط عرض
const RESTAURANT = { lat: 24.7136, lng: 46.6753 };

const baseSettings = resolvePunchSettings([
    { key: 'punch_portal_enabled', value: 'true' },
    { key: 'punch_geofence_enabled', value: 'true' },
    { key: 'punch_device_binding', value: 'true' },
    { key: 'punch_radius_meters', value: '120' },
    { key: 'punch_max_accuracy_m', value: '50' },
    { key: 'punch_max_fix_age_s', value: '30' },
    { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
    { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
]);

const goodLocation = { lat: 24.7142, lng: 46.6760, accuracy: 12, fixAgeS: 2 };
const baseReq = {
    remoteIp: '192.168.1.55',      // داخل شبكة المطعم
    deviceId: 'device-abc-123',
    boundDeviceId: 'device-abc-123',
    location: { ...goodLocation },
};

describe('haversineMeters — المسافة الجيوديسية', () => {
    test('نفس النقطة = صفر', () => {
        expect(haversineMeters(RESTAURANT.lat, RESTAURANT.lng, RESTAURANT.lat, RESTAURANT.lng)).toBe(0);
    });
    test('درجة خط عرض واحدة ≈ 111 كم', () => {
        const d = haversineMeters(24.0, 46.6753, 25.0, 46.6753);
        expect(d).toBeGreaterThan(110000);
        expect(d).toBeLessThan(112000);
    });
    test('مسافة داخل النطاق تُقاس بالأمتار لا بالكيلومترات', () => {
        // ~0.0001 درجة ≈ 11 مترًا
        const d = haversineMeters(RESTAURANT.lat, RESTAURANT.lng, RESTAURANT.lat + 0.0001, RESTAURANT.lng);
        expect(d).toBeGreaterThan(5);
        expect(d).toBeLessThan(20);
    });
});

describe('isInternalIp — طبقة L1 (الشبكة الداخلية)', () => {
    test('RFC1918: 192.168 / 10.x / 172.16-31 داخلية', () => {
        expect(isInternalIp('192.168.1.55')).toBe(true);
        expect(isInternalIp('10.0.0.7')).toBe(true);
        expect(isInternalIp('172.20.3.4')).toBe(true);
    });
    test('loopback و IPv4-mapped IPv6 داخلية', () => {
        expect(isInternalIp('127.0.0.1')).toBe(true);
        expect(isInternalIp('::ffff:192.168.1.7')).toBe(true);
        expect(isInternalIp('::1')).toBe(true);
    });
    test('العناوين العامة خارجية (إنترنت → رفض)', () => {
        expect(isInternalIp('156.203.44.10')).toBe(false); // عنوان سعودي واقعي
        expect(isInternalIp('8.8.8.8')).toBe(false);
    });
    test('قيم فاسدة/فارغة → خارجية', () => {
        expect(isInternalIp('')).toBe(false);
        expect(isInternalIp(null)).toBe(false);
        expect(isInternalIp('not-an-ip')).toBe(false);
    });
});

describe('resolvePunchSettings — الإعدادات المولودة مغلقة (G4)', () => {
    test('بلا صفوف إعدادات = كل شيء مغلقة (fail-safe)', () => {
        const s = resolvePunchSettings([]);
        expect(s.portalEnabled).toBe(false);
        expect(s.geofenceEnabled).toBe(false);
    });
    test('إحداثيات غير صالحة تُعتبر غير مضبوطة (لا انفجار)', () => {
        const s = resolvePunchSettings([
            { key: 'punch_restaurant_lat', value: 'abc' },
            { key: 'punch_restaurant_lng', value: '999' },
        ]);
        expect(s.lat).toBeNull();
        expect(s.lng).toBeNull();
    });
});

describe('evaluatePunch — سيناريوهات §5.7 الحرفية', () => {
    test('§5.7-2 بصمة من شبكة المنزل → PUNCH_OUT_OF_NETWORK (حتى بإحداثيات مثالية)', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, remoteIp: '156.203.44.10' });
        expect(r.decision).toBe('rejected');
        expect(r.rejectCode).toBe('PUNCH_OUT_OF_NETWORK');
    });
    test('§5.7-1 الموظف داخل المطعم على شبكته → accepted', () => {
        const r = evaluatePunch(baseSettings, baseReq);
        expect(r.decision).toBe('accepted');
        expect(r.details.networkOk).toBe(true);
        expect(r.details.distanceM).toBeLessThanOrEqual(120);
    });
    test('الميزة مغلقة بالمفتاح المركزي → PUNCH_PORTAL_DISABLED (G4)', () => {
        const s = resolvePunchSettings([{ key: 'punch_portal_enabled', value: 'false' }]);
        const r = evaluatePunch(s, baseReq);
        expect(r.rejectCode).toBe('PUNCH_PORTAL_DISABLED');
    });
    test('geofence مفعّل بلا إحداثيات مطعم → PUNCH_GEOFENCE_NOT_CONFIGURED (آمن)', () => {
        const s = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'true' },
        ]);
        const r = evaluatePunch(s, baseReq);
        expect(r.rejectCode).toBe('PUNCH_GEOFENCE_NOT_CONFIGURED');
    });
    test('geofence مطلوب ولا توجد بيانات موقع → PUNCH_LOCATION_REQUIRED', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: null });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_REQUIRED');
    });
    test('§5.7-3 خارج النطاق (300م بعيدًا) → PUNCH_OUT_OF_RANGE مع تسجيل المسافة', () => {
        // ~0.0027 درجة ≈ 300 متر
        const r = evaluatePunch(baseSettings, {
            ...baseReq,
            location: { ...goodLocation, lat: RESTAURANT.lat + 0.0027 },
        });
        expect(r.rejectCode).toBe('PUNCH_OUT_OF_RANGE');
        expect(r.details.distanceM).toBeGreaterThan(120);
    });
    test('على الحدود بالضبط (نفس المسافة = النطاق) → مقبول (<=)', () => {
        const r = evaluatePunch(baseSettings, {
            ...baseReq,
            location: { ...goodLocation, lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 10 },
        });
        expect(r.decision).toBe('accepted');
    });
    test('§5.7-4 دقة أسوأ من الحد (مثلاً 80م) → PUNCH_LOCATION_WEAK', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: { ...goodLocation, accuracy: 80 } });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('دقة "مثالية" (< 1م) غير طبيعية → مؤشر تلاعب → PUNCH_LOCATION_WEAK', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: { ...goodLocation, accuracy: 0 } });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('إحداثيات قديمة (fixAgeS > 30) → PUNCH_LOCATION_WEAK', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: { ...goodLocation, fixAgeS: 95 } });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('GPS مزيف (mocked) → PUNCH_LOCATION_MOCKED', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: { ...goodLocation, mocked: true } });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_MOCKED');
    });
    test('§5.7-5 جهاز غير مربوط بالحساب → PUNCH_DEVICE_MISMATCH', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, deviceId: 'device-other-999' });
        expect(r.rejectCode).toBe('PUNCH_DEVICE_MISMATCH');
    });
    test('بصمة بلا معرّف جهاز → PUNCH_DEVICE_REQUIRED', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, deviceId: null });
        expect(r.rejectCode).toBe('PUNCH_DEVICE_REQUIRED');
    });
    test('تعطيل ربط الجهاز إداريًا → mismatch لا يرفض (سلوك قابل للضبط)', () => {
        const s = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'true' },
            { key: 'punch_device_binding', value: 'false' },
            { key: 'punch_radius_meters', value: '120' },
            { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
            { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
        ]);
        const r = evaluatePunch(s, { ...baseReq, deviceId: 'device-other-999' });
        expect(r.decision).toBe('accepted');
    });
    test('تعطيل geofence إداريًا → تُتخطى الطبقات الجغرافية لكن L1 الشبكة تبقى إلزامية', () => {
        const s = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'false' },
        ]);
        const r1 = evaluatePunch(s, { ...baseReq, location: null });
        expect(r1.decision).toBe('accepted'); // داخل الشبكة بلا فحص جغرافي
        const r2 = evaluatePunch(s, { ...baseReq, remoteIp: '8.8.8.8', location: null });
        expect(r2.rejectCode).toBe('PUNCH_OUT_OF_NETWORK'); // الشبكة دائمًا
    });
});
