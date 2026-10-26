/**
 * punch-gps-hardening.test.js — تقوية الجي بي اس ضد التزييف (2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي الطبقات الجديدة فوق الأساس (punch-portal + location-hardening):
 *   • geolib كمحرك قياس (getDistance/isPointWithinRadius عبر المغلّفات)
 *   • الدقة الثابتة flatline (بصمة Fake GPS) — ضعيفة وحدها، تزييف مع التجمد
 *   • درجة الواقعية trust score وإشاراتها
 *   • التنقل المستحيل بين بصمتين assessTeleport
 *   • إعدادات teleport الافتراضية (مفعّلة)
 */
'use strict';

const {
    evaluatePunch,
    resolvePunchSettings,
    assessFixQuality,
    assessFixRealism,
    assessTeleport,
    isWithinRadius,
    normalizeFixes,
} = require('../backend/punch-portal-logic');

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

const baseReq = {
    remoteIp: '192.168.1.55',
    deviceId: 'device-abc-123',
    boundDeviceId: 'device-abc-123',
};

const jitterFixes = (accuracy) => ([
    { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy, fixAgeS: 1 },
    { lat: RESTAURANT.lat + 0.00002, lng: RESTAURANT.lng - 0.00001, accuracy, fixAgeS: 3 },
    { lat: RESTAURANT.lat - 0.00001, lng: RESTAURANT.lng + 0.00002, accuracy, fixAgeS: 5 },
]);

describe('isWithinRadius — محرك geolib', () => {
    test('نفس النقطة داخل أي نطاق', () => {
        expect(isWithinRadius(RESTAURANT.lat, RESTAURANT.lng, RESTAURANT.lat, RESTAURANT.lng, 120)).toBe(true);
    });
    test('300م خارج نطاق 120م', () => {
        expect(isWithinRadius(RESTAURANT.lat + 0.0027, RESTAURANT.lng, RESTAURANT.lat, RESTAURANT.lng, 120)).toBe(false);
    });
});

describe('assessFixQuality — الدقة الثابتة والتقارب', () => {
    test('نفس الدقة 3 مرات → flatline', () => {
        const q = assessFixQuality(jitterFixes(8));
        expect(q.accuracyFlatline).toBe(true);
        expect(q.frozen).toBe(false); // اهتزاز موجود — ليس تجميدًا
    });
    test('دقّات متذبذبة → ليست flatline', () => {
        const q = assessFixQuality([
            { lat: 24.1, lng: 46.1, accuracy: 20, fixAgeS: 1 },
            { lat: 24.10002, lng: 46.1, accuracy: 12, fixAgeS: 3 },
            { lat: 24.10004, lng: 46.1, accuracy: 8, fixAgeS: 5 },
        ]);
        expect(q.accuracyFlatline).toBe(false);
        expect(q.accuracyConverging).toBe(true); // 20 → 8 تقارب حقيقي
    });
});

describe('assessFixRealism — درجة الثقة', () => {
    test('جلسة حقيقية متقاربة → درجة عالية', () => {
        const fixes = normalizeFixes({ fixes: [
            { lat: 24.1, lng: 46.1, accuracy: 30, fixAgeS: 1, alt: 600 },
            { lat: 24.10002, lng: 46.1, accuracy: 18, fixAgeS: 3, alt: 601 },
            { lat: 24.10004, lng: 46.1, accuracy: 10, fixAgeS: 5, alt: 600 },
        ] });
        const q = assessFixQuality(fixes);
        const r = assessFixRealism(fixes, q);
        expect(r.score).toBeGreaterThanOrEqual(90);
        expect(r.signals).toContain('ACCURACY_CONVERGING');
    });
    test('دقة ثابتة بلا حسّاسات → درجة منخفضة وإشارة FLAT_ACCURACY', () => {
        const fixes = normalizeFixes({ fixes: jitterFixes(8) });
        const q = assessFixQuality(fixes);
        const r = assessFixRealism(fixes, q);
        expect(r.signals).toContain('FLAT_ACCURACY');
        expect(r.score).toBeLessThan(70);
    });
    test('علامة تزييف صريحة → صفر', () => {
        const fixes = normalizeFixes({ fixes: [
            { lat: 24.1, lng: 46.1, accuracy: 10, fixAgeS: 1, mocked: true },
            { lat: 24.10002, lng: 46.1, accuracy: 9, fixAgeS: 3 },
        ] });
        const q = assessFixQuality(fixes);
        const r = assessFixRealism(fixes, q);
        expect(r.score).toBe(0);
        expect(r.signals).toContain('MOCK_FLAG');
    });
});

describe('assessTeleport — التنقل المستحيل بين بصمتين', () => {
    test('الرياض → جدة خلال 5 دقائق = تنقل مستحيل', () => {
        const r = assessTeleport(
            { lat: 24.7136, lng: 46.6753, atMs: 0 },
            { lat: 21.4858, lng: 39.1925, nowMs: 5 * 60 * 1000 },
            250);
        expect(r.teleport).toBe(true);
        expect(r.speedKmh).toBeGreaterThan(250);
    });
    test('مشي طبيعي 200م خلال 10 دقائق → ليس تنقلًا', () => {
        const r = assessTeleport(
            { lat: 24.7136, lng: 46.6753, atMs: 0 },
            { lat: 24.7154, lng: 46.6753, nowMs: 10 * 60 * 1000 },
            250);
        expect(r.teleport).toBe(false);
    });
    test('بلا بصمة سابقة → ليس تنقلًا (أول بصمة دائمًا)', () => {
        expect(assessTeleport(null, { lat: 24.7, lng: 46.6, nowMs: 1 }).teleport).toBe(false);
    });
    test('قفزة صغيرة سريعة داخل الموقع (ضجيج GPS) → ليست تنقلًا', () => {
        const r = assessTeleport(
            { lat: 24.7136, lng: 46.6753, atMs: 0 },
            { lat: 24.7145, lng: 46.6753, nowMs: 1000 },
            250);
        expect(r.teleport).toBe(false); // أقل من 1 كم — ضجيج لا تنقل
    });
});

describe('evaluatePunch — التكامل مع القواعد الجديدة', () => {
    test('دقة ثابتة + تجميد + بلا حسّاسات = بصمة Fake GPS → MOCKED', () => {
        const r = evaluatePunch(baseSettings, {
            ...baseReq,
            location: { fixes: [
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 5, fixAgeS: 1 },
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 5, fixAgeS: 2 },
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 5, fixAgeS: 3 },
            ] },
        });
        // التجميد التام يُمسك أولًا بنفس الرمز العائلي
        expect(['PUNCH_LOCATION_FROZEN', 'PUNCH_LOCATION_MOCKED']).toContain(r.rejectCode);
    });
    test('دقة ثابتة مع اهتزاز طبيعي → WEAK (لا اتهام قاطع)', () => {
        const r = evaluatePunch(baseSettings, { ...baseReq, location: { fixes: jitterFixes(12) } });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('إصلاح مُعلّم mocked من الجهاز → MOCKED', () => {
        const r = evaluatePunch(baseSettings, {
            ...baseReq,
            location: { fixes: [
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 12, fixAgeS: 1 },
                { lat: RESTAURANT.lat + 0.00002, lng: RESTAURANT.lng, accuracy: 11, fixAgeS: 2, mocked: true },
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng + 0.00002, accuracy: 10, fixAgeS: 3 },
            ] },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_MOCKED');
    });
    test('البصمة المقبولة تحمل trustScore وإشارات', () => {
        const r = evaluatePunch(baseSettings, {
            ...baseReq,
            location: { fixes: [
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 25, fixAgeS: 1, alt: 600 },
                { lat: RESTAURANT.lat + 0.00002, lng: RESTAURANT.lng, accuracy: 15, fixAgeS: 3, alt: 601 },
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng + 0.00002, accuracy: 9, fixAgeS: 5, alt: 600 },
            ] },
        });
        expect(r.decision).toBe('accepted');
        expect(r.details.trustScore).toBeGreaterThanOrEqual(90);
    });
});

describe('resolvePunchSettings — إعدادات التنقل الافتراضية', () => {
    test('الفحص مفعّل افتراضيًا (250 كم/س)', () => {
        const s = resolvePunchSettings([]);
        expect(s.teleportCheck).toBe(true);
        expect(s.maxTeleportKmh).toBe(250);
    });
});
