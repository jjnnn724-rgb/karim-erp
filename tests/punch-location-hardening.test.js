/**
 * punch-location-hardening.test.js — تحصين تحديد الموقع (طلب المالك 2026-09-29)
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي: قراءات متعددة إلزامية، كشف التجميد (Fake GPS)، كشف الانتقال المستحيل،
 * تشتت الجلسة، النطاق الصارم، ودمجها مع evaluatePunch الكامل.
 */
'use strict';

const {
    evaluatePunch,
    resolvePunchSettings,
    assessFixQuality,
    haversineMeters,
} = require('../backend/punch-portal-logic');

const RESTAURANT = { lat: 24.7136, lng: 46.6753 };

const baseSettings = resolvePunchSettings([
    { key: 'punch_portal_enabled', value: 'true' },
    { key: 'punch_geofence_enabled', value: 'true' },
    { key: 'punch_device_binding', value: 'true' },
    { key: 'punch_radius_meters', value: '120' },
    { key: 'punch_max_accuracy_m', value: '50' },
    { key: 'punch_max_fix_age_s', value: '30' },
    { key: 'punch_multi_fix_required', value: 'true' },
    { key: 'punch_strict_geofence', value: 'false' },
    { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
    { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
]);

const validReq = {
    remoteIp: '192.168.1.55',
    deviceId: 'dev-1',
    boundDeviceId: 'dev-1',
    location: {
        fixes: [
            { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 12, fixAgeS: 1 },
            { lat: RESTAURANT.lat + 0.00003, lng: RESTAURANT.lng, accuracy: 10, fixAgeS: 2 },
            { lat: RESTAURANT.lat, lng: RESTAURANT.lng + 0.00002, accuracy: 14, fixAgeS: 3 },
        ],
    },
};

describe('assessFixQuality — فحوص المجموعة الخام', () => {
    test('إصلاح واحد → بلا تجميد وبلا سرعة (توافق قديم)', () => {
        const q = assessFixQuality([{ lat: 24, lng: 46, accuracy: 10, fixAgeS: 0 }]);
        expect(q.frozen).toBe(false);
        expect(q.spreadM).toBe(0);
    });
    test('إحداثيات متطابقة تمامًا → frozen (GPS الحقيقي يهتز)', () => {
        const q = assessFixQuality([
            { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 1 },
            { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 2 },
            { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 3 },
        ]);
        expect(q.frozen).toBe(true);
    });
    test('اهتزاز طبيعي (سنتيمترات) → ليس frozen', () => {
        const q = assessFixQuality([
            { lat: 24.713600, lng: 46.675300, accuracy: 10, fixAgeS: 1 },
            { lat: 24.713601, lng: 46.675299, accuracy: 11, fixAgeS: 2 },
        ]);
        expect(q.frozen).toBe(false);
    });
    test('انتقال مستحيل (1 كم خلال ثانية) → سرعة فلكية', () => {
        const q = assessFixQuality([
            { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 1 },
            { lat: 24.7226, lng: 46.6753, accuracy: 10, fixAgeS: 2 }, // ~1 كم بعد ثانية
        ]);
        expect(q.maxSpeedKmh).toBeGreaterThan(300);
    });
});

describe('evaluatePunch — التحصين داخل المسار الكامل', () => {
    test('قراءات متعددة سليمة داخل المطعم → accepted', () => {
        const r = evaluatePunch(baseSettings, validReq);
        expect(r.decision).toBe('accepted');
        expect(r.details.fixCount).toBe(3);
    });
    test('قناع واحد ضعيف الدقة عند إلزامية multi-fix → PUNCH_LOCATION_WEAK', () => {
        const r = evaluatePunch(baseSettings, {
            ...validReq,
            location: { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 45 },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('قناع واحد عالي الجودة داخل النطاق → accepted مع SINGLE_FIX_FALLBACK (2026-10-02)', () => {
        const r = evaluatePunch(baseSettings, {
            ...validReq,
            location: { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 12 },
        });
        expect(r.decision).toBe('accepted');
        expect(r.details.singleFix).toBe(true);
        expect(r.details.trustSignals).toContain('SINGLE_FIX_FALLBACK');
    });
    test('إحداثيات مجمّدة (Fake GPS ثابت) → PUNCH_LOCATION_FROZEN', () => {
        const r = evaluatePunch(baseSettings, {
            ...validReq,
            location: { fixes: [
                { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 1 },
                { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 2 },
                { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 3 },
            ] },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_FROZEN');
    });
    test('انتقال مستحيل بين القراءات → PUNCH_LOCATION_FROZEN', () => {
        const r = evaluatePunch(baseSettings, {
            ...validReq,
            location: { fixes: [
                { lat: 24.7136, lng: 46.6753, accuracy: 10, fixAgeS: 1 },
                { lat: 24.7226, lng: 46.6753, accuracy: 10, fixAgeS: 2 },
            ] },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_FROZEN');
    });
    test('تشتت كبير بين القراءات (> 150م) → PUNCH_LOCATION_WEAK', () => {
        const r = evaluatePunch(baseSettings, {
            ...validReq,
            location: { fixes: [
                { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 10, fixAgeS: 1 },
                { lat: RESTAURANT.lat + 0.002, lng: RESTAURANT.lng, accuracy: 10, fixAgeS: 4 }, // ~220م
            ] },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_WEAK');
    });
    test('إيقاف multi-fix إداريًا → قناع واحد مقبول (سلوك قابل للضبط)', () => {
        const s = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'true' },
            { key: 'punch_multi_fix_required', value: 'false' },
            { key: 'punch_radius_meters', value: '120' },
            { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
            { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
        ]);
        const r = evaluatePunch(s, {
            remoteIp: '192.168.1.55', deviceId: 'd', boundDeviceId: 'd',
            location: { lat: RESTAURANT.lat, lng: RESTAURANT.lng, accuracy: 12 },
        });
        expect(r.decision).toBe('accepted');
    });
    test('الوضع الصارم: هامش الدقة يمتد خارج النطاق → PUNCH_LOCATION_AMBIGUOUS', () => {
        const s = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'true' },
            { key: 'punch_device_binding', value: 'false' },
            { key: 'punch_multi_fix_required', value: 'false' },
            { key: 'punch_strict_geofence', value: 'true' },
            { key: 'punch_radius_meters', value: '120' },
            { key: 'punch_max_accuracy_m', value: '50' },
            { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
            { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
        ]);
        // على بعد ~110م بدقة 40م → 110+40=150 > 120+10 → غموض مرفوض في الصارم
        const edge = RESTAURANT.lat + 0.00099;
        const r = evaluatePunch(s, {
            remoteIp: '192.168.1.55', deviceId: 'd', boundDeviceId: 'd',
            location: { lat: edge, lng: RESTAURANT.lng, accuracy: 40 },
        });
        expect(r.rejectCode).toBe('PUNCH_LOCATION_AMBIGUOUS');
        // نفس الموقف بلا صرامة → مقبول (داخل النطاق نقطةً)
        const lenient = resolvePunchSettings([
            { key: 'punch_portal_enabled', value: 'true' },
            { key: 'punch_geofence_enabled', value: 'true' },
            { key: 'punch_device_binding', value: 'false' },
            { key: 'punch_multi_fix_required', value: 'false' },
            { key: 'punch_strict_geofence', value: 'false' },
            { key: 'punch_radius_meters', value: '120' },
            { key: 'punch_max_accuracy_m', value: '50' },
            { key: 'punch_restaurant_lat', value: String(RESTAURANT.lat) },
            { key: 'punch_restaurant_lng', value: String(RESTAURANT.lng) },
        ]);
        const r2 = evaluatePunch(lenient, {
            remoteIp: '192.168.1.55', deviceId: 'd', boundDeviceId: 'd',
            location: { lat: edge, lng: RESTAURANT.lng, accuracy: 40 },
        });
        expect(r2.decision).toBe('accepted');
        expect(haversineMeters(RESTAURANT.lat, RESTAURANT.lng, edge, RESTAURANT.lng)).toBeLessThan(120);
    });
});
