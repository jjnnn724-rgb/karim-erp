/**
 * punch-portal-logic.js — منطق بوابة البصمة الذاتية (نقي — بلا DB ولا Express)
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md §5.3
 * الفصل مقصود: كل قرارات الرفض/القبول دوال نقية تُختبَر 100% بمعزل عن السيرفر،
 * ومسار Express مجرد توصيل (attendance-portal-routes.js).
 *
 * تسلسل الحكم (الأولوية من أعلى لأسفل — أول فشل يرفض فورًا):
 *   0. PUNCH_PORTAL_DISABLED   الميزة مغلقة بالمفتاح المركزي
 *   1. PUNCH_OUT_OF_NETWORK    الطلب ليس من شبكة داخلية (L1 — لا تُتخطى أبدًا)
 *   2. PUNCH_LOCATION_REQUIRED لا ترويسات موقع (L2 مفعّلة)
 *   3. PUNCH_LOCATION_MOCKED   مؤشر موقع مزيف (L3)
 *   4. PUNCH_LOCATION_WEAK     دقة مريبة / إحداثيات قديمة (L3)
 *   5. PUNCH_OUT_OF_RANGE      خارج نطاق المطعم (L2)
 *   6. PUNCH_DEVICE_MISMATCH   جهاز غير مربوط بالحساب (L4)
 *   → accepted
 */
'use strict';

// ─── المسافات ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6371000;

/**
 * المسافة بين نقطتين بالأمتار (Haversine) — دقة مترية كافية لنطاق المطعم.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ─── الشبكات (L1) ────────────────────────────────────────────────────────────

/**
 * هل العنوان من شبكة داخلية (RFC1918 / loopback / link-local / ULA)؟
 * يعالج صيغ IPv4-mapped IPv6 (::ffff:192.168.1.7) الشائعة في Node على ويندوز.
 * العناوين العامة (إنترنت) → false دائمًا.
 */
function isInternalIp(ip) {
    if (!ip) {return false;}
    let s = String(ip).trim().toLowerCase();
    if (s.startsWith('::ffff:')) {s = s.slice(7);}
    if (s === '::1' || s === 'localhost') {return true;}
    const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) {
        // IPv6 حقيقي: ULA fc00::/7 و link-local fe80::/10 داخلية؛ global (2xxx:) خارجي
        if (/^f[cd][0-9a-f]{2}:/.test(s)) {return true;}
        if (/^fe[89ab][0-9a-f]:/.test(s)) {return true;}
        return false;
    }
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([a, b].some((x) => Number.isNaN(x) || x < 0 || x > 255)) {return false;}
    if (a === 10 || a === 127) {return true;}
    if (a === 192 && b === 168) {return true;}
    if (a === 172 && b >= 16 && b <= 31) {return true;}
    if (a === 169 && b === 254) {return true;} // link-local
    return false;
}

// ─── الإعدادات ───────────────────────────────────────────────────────────────

/**
 * دمج صفوف punch_settings مع قيم افتراضية/بيئة — يرجع كائن إعدادات مطبَّع.
 * الإحداثيات النصية تُقبل فقط لو كانت أرقامًا صالحة (وإلا تُعتبر غير مضبوطة).
 */
function resolvePunchSettings(rows = [], env = {}) {
    const kv = {};
    for (const r of rows) {kv[r.key] = r.value;}
    const num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const bool = (v, fallback) => {
        if (v === undefined || v === null || v === '') {return fallback;}
        return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
    };
    const lat = num(kv.punch_restaurant_lat, num(env.PUNCH_LAT, null));
    const lng = num(kv.punch_restaurant_lng, num(env.PUNCH_LNG, null));
    const coordsSet = Number.isFinite(lat) && Number.isFinite(lng)
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return {
        portalEnabled: bool(kv.punch_portal_enabled, false),
        geofenceEnabled: bool(kv.punch_geofence_enabled, false),
        deviceBinding: bool(kv.punch_device_binding, true),
        selfieEnabled: bool(kv.punch_selfie_enabled, false),
        radiusMeters: num(kv.punch_radius_meters, 120),
        maxAccuracyM: num(kv.punch_max_accuracy_m, 50),
        maxFixAgeS: num(kv.punch_max_fix_age_s, 30),
        faceEnabled: bool(kv.punch_face_enabled, false),
        faceThreshold: num(kv.punch_face_threshold, 0.55),
        lat: coordsSet ? lat : null,
        lng: coordsSet ? lng : null,
    };
}

// ─── الحكم الموحّد ───────────────────────────────────────────────────────────

/**
 * الحكم على محاولة البصمة كاملة (L1→L4 + مفتاح التفعيل).
 * @param {Object} settings        ناتج resolvePunchSettings
 * @param {Object} req             بيانات الطلب المنظفة:
 *   { remoteIp, deviceId, location?: { lat, lng, accuracy, fixAgeS?, mocked? } }
 * @returns {{ decision:'accepted'|'rejected', rejectCode?:string, details:Object }}
 */
function evaluatePunch(settings, req) {
    const details = {
        networkOk: false,
        hasLocation: false,
        distanceM: null,
        accuracyM: null,
        fixAgeS: null,
        deviceId: req.deviceId || null,
    };

    // 0. مفتاح التفعيل المركزي (G4: الميزة تولد مغلقة)
    if (!settings.portalEnabled) {
        return { decision: 'rejected', rejectCode: 'PUNCH_PORTAL_DISABLED', details };
    }

    // 1. L1 — الشبكة الداخلية: لا تُتخطى أبدًا حتى مع تعطيل Geofence
    details.networkOk = isInternalIp(req.remoteIp);
    if (!details.networkOk) {
        return { decision: 'rejected', rejectCode: 'PUNCH_OUT_OF_NETWORK', details };
    }

    const loc = req.location || null;
    details.hasLocation = Boolean(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng));

    // 2-5. الطبقات الجغرافية — تعمل فقط إذا فُعّلت إداريًا (وقُطبت الإحداثيات)
    if (settings.geofenceEnabled) {
        if (!settings.lat || !settings.lng) {
            return { decision: 'rejected', rejectCode: 'PUNCH_GEOFENCE_NOT_CONFIGURED', details };
        }
        if (!details.hasLocation) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_REQUIRED', details };
        }
        details.accuracyM = Number(loc.accuracy);
        details.fixAgeS = Number.isFinite(Number(loc.fixAgeS)) ? Number(loc.fixAgeS) : 0;

        // 3. مؤشر موقع مزيف: العميل يبلّغ صراحةً
        if (loc.mocked === true) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_MOCKED', details };
        }

        // 4. جودة الإشارة: دقة أسوأ من الحد → مرفوضة؛ "دقة مثالية" (< 1م)
        //    غير موجودة طبيعيًا في الهواتف → مؤشر تلاعب يُعامل كضعف إشارة
        if (!(details.accuracyM > 0) || details.accuracyM > settings.maxAccuracyM
            || details.accuracyM < 1) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_WEAK', details };
        }

        // قدم الإحداثيات: إصلاح GPS قديم لا يثبت المكان الحاضر
        if (details.fixAgeS < 0 || details.fixAgeS > settings.maxFixAgeS) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_WEAK', details };
        }

        // 5. النطاق: المسافة من إحداثيات المطعم
        details.distanceM = Math.round(haversineMeters(settings.lat, settings.lng, loc.lat, loc.lng) * 10) / 10;
        if (details.distanceM > settings.radiusMeters) {
            return { decision: 'rejected', rejectCode: 'PUNCH_OUT_OF_RANGE', details };
        }
    }

    // 6. L4 — ربط الجهاز (يُطبَّق فقط لو مفعّل إداريًا)
    if (settings.deviceBinding) {
        if (!req.deviceId) {
            return { decision: 'rejected', rejectCode: 'PUNCH_DEVICE_REQUIRED', details };
        }
        if (req.boundDeviceId && req.boundDeviceId !== req.deviceId) {
            return { decision: 'rejected', rejectCode: 'PUNCH_DEVICE_MISMATCH', details };
        }
    }

    return { decision: 'accepted', details };
}

// ─── التعرف على الوجه (L5) — مطابقة متجهات بدون صور ────────────────────────

const FACE_DESCRIPTOR_LEN = 128;

/** تحقق صارم من متجه الوجه: 128 رقمًا محدودًا — يُرفض أي شيء آخر */
function isValidFaceDescriptor(d) {
    return Array.isArray(d) && d.length === FACE_DESCRIPTOR_LEN
        && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 20);
}

/** المسافة الإقليدية بين متجهين — مقياس مطابقة face_recognition القياسي */
function faceDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

/**
 * حكم مطابقة الوجه: المسافة ≤ العتبة = نفس الشخص.
 * العتبة 0.55 هي القيمة الموصى بها لمكتبة face_recognition (أقل = أشد).
 */
function evaluateFaceMatch(candidate, stored, threshold) {
    if (!isValidFaceDescriptor(candidate)) {
        return { ok: false, rejectCode: 'PUNCH_FACE_INVALID' };
    }
    if (!isValidFaceDescriptor(stored)) {
        return { ok: false, rejectCode: 'PUNCH_FACE_NOT_ENROLLED' };
    }
    const distance = faceDistance(candidate, stored);
    const thr = Number(threshold) > 0 ? Number(threshold) : 0.55;
    return { ok: distance <= thr, distance: Math.round(distance * 10000) / 10000, threshold: thr };
}

module.exports = {
    haversineMeters,
    isInternalIp,
    resolvePunchSettings,
    evaluatePunch,
    isValidFaceDescriptor,
    faceDistance,
    evaluateFaceMatch,
    FACE_DESCRIPTOR_LEN,
};
