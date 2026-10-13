/**
 * punch-portal-logic.js — منطق بوابة البصمة الذاتية (نقي — بلا DB ولا Express)
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md §5.3
 * الفصل مقصود: كل قرارات الرفض/القبول دوال نقية تُختبَر 100% بمعزل عن السيرفر،
 * ومسار Express مجرد توصيل (attendance-portal-routes.js).
 *
 * Type policy (handover 2026-09-29): this module is the REFERENCE for the
 * company's incremental TypeScript adoption — @ts-check + full JSDoc, passes
 * `tsc --strict` with 0 errors (see tsconfig.strict.json).
 *
 * تسلسل الحكم (الأولوية من أعلى لأسفل — أول فشل يرفض فورًا):
 *   0. PUNCH_PORTAL_DISABLED   الميزة مغلقة بالمفتاح المركزي
 *   1. PUNCH_OUT_OF_NETWORK    الطلب ليس من شبكة داخلية (L1 — لا تُتخطى أبدًا)
 *   2. PUNCH_LOCATION_REQUIRED لا ترويسات موقع (L2 مفعّلة)
 *   2ب. PUNCH_LOCATION_WEAK    قراءات غير كافية (multi-fix إلزامي)
 *   2ج. PUNCH_LOCATION_FROZEN  إحداثيات مجمّدة أو انتقال مستحيل (تزوير)
 *   3. PUNCH_LOCATION_MOCKED   مؤشر موقع مزيف (L3)
 *   4. PUNCH_LOCATION_WEAK     دقة مريبة / إحداثيات قديمة / تشتت (L3)
 *   5. PUNCH_OUT_OF_RANGE      خارج نطاق المطعم (L2)
 *   5ب. PUNCH_LOCATION_AMBIGUOUS منطقة الغموض في الوضع الصارم
 *   6. PUNCH_DEVICE_MISMATCH   جهاز غير مربوط بالحساب (L4)
 *   → accepted
 */
// @ts-check
'use strict';

// ─── محرك القياس الجغرافي: geolib (MIT — مكتبة مفتوحة المصدر احترافية) ───────
// getDistance (صيغة WGS84 الدقيقة بدل Haversine التقريبية) + getSpeed +
// isPointWithinRadius. السقوط إلى Haversine اليدوي لو تعذر التحميل (لا حجب تشغيلي).
/** @type {any} */
let _geolib = null;
try {
    // eslint-disable-next-line global-require
    _geolib = require('geolib');
} catch (_) { _geolib = null; }

// ─── الأنواع (JSDoc — يقرأها tsc strict وتوثّق للشركة) ───────────────────────

/**
 * إصلاح GPS واحد قادم من الجهاز.
 * الحقول الإضافية (altitude/heading/speed/t) اختيارية — يرسلها العميل الحديث
 * ويتجاهلها القديم؛ السيرفر يستخدم ما وصل فقط (لا رفض لغيابها).
 * @typedef {Object} GeoFix
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracy دقة الإصلاح بالأمتار
 * @property {number} fixAgeS عمر الإصلاح بالثواني لحظة الإرسال
 * @property {number|null} [alt] الارتفاع بالأمتار (إن توفر)
 * @property {number|null} [altAcc] دقة الارتفاع (إن توفرت)
 * @property {number|null} [heading] الاتجاه بالدرجات (إن توفر)
 * @property {number|null} [speed] سرعة الجهاز م/ث كما أبلغها (إن توفرت)
 * @property {boolean} [mocked] الجهاز صرّح أن الإصلاح من موفر وهمي
 * @property {number|null} [t] طابع الجهاز بالمللي ثانية (لفروق زمنية دقيقة)
 */

/**
 * موقع الطلب: إما مجموعة إصلاحات (المسار المُحصّن) أو إصلاح واحد (توافق قديم).
 * @typedef {Object} PunchLocation
 * @property {GeoFix[]} [fixes]
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {number} [accuracy]
 * @property {number} [fixAgeS]
 * @property {boolean} [mocked]
 */

/**
 * إعدادات البصمة بعد التطبيع (تُبنى من punch_settings عبر resolvePunchSettings).
 * @typedef {Object} PunchSettings
 * @property {boolean} portalEnabled
 * @property {boolean} geofenceEnabled
 * @property {boolean} deviceBinding
 * @property {boolean} deviceAutoRebind الربط الذاتي لأول بصمة من جهاز جديد (2026-10-04)
 * @property {boolean} selfieEnabled
 * @property {boolean} faceEnabled
 * @property {number} faceThreshold
 * @property {boolean} faceV2Enabled
 * @property {number} faceV2Threshold
 * @property {boolean} multiFixRequired
 * @property {boolean} strictGeofence
 * @property {number} maxRejects10m
 * @property {number} maxAccuracyM
 * @property {number} maxFixAgeS
 * @property {boolean} teleportCheck فحص التنقل المستحيل ضد آخر بصمة مقبولة
 * @property {number} maxTeleportKmh أقصى سرعة مقبولة بين بصمتين (كم/س)
 * @property {number} radiusMeters
 * @property {number|null} lat إحداثيات المطعم — null = غير مضبوطة
 * @property {number|null} lng
 */

/**
 * طلب البصمة بعد التنظيف في مسار Express.
 * @typedef {Object} PunchRequest
 * @property {string} remoteIp
 * @property {string|null} deviceId
 * @property {PunchLocation|null} [location]
 * @property {string|null} [boundDeviceId]
 * @property {boolean} [viaTunnel] وصل عبر Cloudflare Tunnel (ترويسات cf-*) —
 *   الجيولوكيشن في المتصفح يتطلب HTTPS فالهواتف تدخل حصرًا عبر التونل؛ شبكتها
 *   الأصلية غير قابلة للتمييز، فيستبدل حكم L1 بقيد "الجيوفانس إلزامي".
 */

/**
 * نتيجة الحكم النهائية.
 * @typedef {Object} EvaluateResult
 * @property {'accepted'|'rejected'} decision
 * @property {string} [rejectCode]
 * @property {{networkOk: boolean, hasLocation: boolean, fixCount?: number, singleFix?: boolean, spreadM?: number, maxSpeedKmh?: number, trustScore?: number, trustSignals?: string[], bestLat?: number|null, bestLng?: number|null, distanceM: number|null, accuracyM: number|null, fixAgeS: number|null, deviceId: string|null}} details
 */

// ─── المسافات (geolib الاحترافية أولًا — Haversine احتياطيًا) ────────────────

const EARTH_RADIUS_M = 6371000;

/** تحويل إصلاح داخلي إلى نقطة geolib
 * @param {number} lat
 * @param {number} lng
 * @returns {{latitude: number, longitude: number}}
 */
function _toGeoPoint(lat, lng) {
    return { latitude: Number(lat), longitude: Number(lng) };
}

/**
 * المسافة بين نقطتين بالأمتار — geolib (WGS84 دقيقة) أو Haversine عند غيابها.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
    if (_geolib && Number.isFinite(lat1) && Number.isFinite(lng1)
        && Number.isFinite(lat2) && Number.isFinite(lng2)) {
        try {
            return _geolib.getDistance(_toGeoPoint(lat1, lng1), _toGeoPoint(lat2, lng2));
        } catch (_) { /* سقط للاحتياطي أدناه */ }
    }
    const toRad = (/** @type {number} */ d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * هل النقطة داخل دائرة المطعم؟ — geolib.isPointWithinRadius أو الحساب اليدوي.
 * @param {number} lat
 * @param {number} lng
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusM
 * @returns {boolean}
 */
function isWithinRadius(lat, lng, centerLat, centerLng, radiusM) {
    if (_geolib) {
        try {
            return _geolib.isPointWithinRadius(
                _toGeoPoint(lat, lng), _toGeoPoint(centerLat, centerLng), Number(radiusM));
        } catch (_) { /* سقط للاحتياطي */ }
    }
    return haversineMeters(centerLat, centerLng, lat, lng) <= Number(radiusM);
}

// ─── الشبكات (L1) ────────────────────────────────────────────────────────────

/**
 * هل العنوان من شبكة داخلية (RFC1918 / loopback / link-local / ULA)؟
 * يعالج صيغ IPv4-mapped IPv6 (::ffff:192.168.1.7) الشائعة في Node على ويندوز.
 * العناوين العامة (إنترنت) → false دائمًا.
 * @param {unknown} ip
 * @returns {boolean}
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
    const a = Number(m[1]);
    const b = Number(m[2]);
    if ([a, b].some((x) => Number.isNaN(x) || x < 0 || x > 255)) {return false;}
    if (a === 10 || a === 127) {return true;}
    if (a === 192 && b === 168) {return true;}
    if (a === 172 && b >= 16 && b <= 31) {return true;}
    if (a === 169 && b === 254) {return true;} // link-local
    return false;
}

// ─── الإعدادات ───────────────────────────────────────────────────────────────

/**
 * @template T
 * @param {unknown} v
 * @param {T} fallback
 * @returns {number|T}
 */
function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {unknown} v
 * @param {boolean} fallback
 * @returns {boolean}
 */
function boolOr(v, fallback) {
    if (v === undefined || v === null || v === '') {return fallback;}
    return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

/**
 * دمج صفوف punch_settings مع قيم افتراضية/بيئة — يرجع كائن إعدادات مطبَّع.
 * الإحداثيات النصية تُقبل فقط لو كانت أرقامًا صالحة (وإلا تُعتبر غير مضبوطة).
 * @param {Array<{key: string, value: string}>} rows
 * @param {Record<string, string|undefined>} [env]
 * @returns {PunchSettings}
 */
function resolvePunchSettings(rows, env = {}) {
    /** @type {Record<string, string>} */
    const kv = {};
    for (const r of rows) {kv[r.key] = r.value;}
    const lat = /** @type {number|null} */ (numOr(kv.punch_restaurant_lat, numOr(env.PUNCH_LAT, null)));
    const lng = /** @type {number|null} */ (numOr(kv.punch_restaurant_lng, numOr(env.PUNCH_LNG, null)));
    const coordsSet = lat !== null && lng !== null
        && Number.isFinite(lat) && Number.isFinite(lng)
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return {
        portalEnabled: boolOr(kv.punch_portal_enabled, false),
        geofenceEnabled: boolOr(kv.punch_geofence_enabled, false),
        deviceBinding: boolOr(kv.punch_device_binding, true),
        // الربط الذاتي (2026-10-04): أول بصمة من جهاز جديد تربطه تلقائيًا بدل
        // الرفض الدائم «تواصل مع HR» — كل حدث يُوثَّق في punch_attempts (DEVICE_REBOUND)
        deviceAutoRebind: boolOr(kv.punch_device_auto_rebind, true),
        selfieEnabled: boolOr(kv.punch_selfie_enabled, false),
        faceEnabled: boolOr(kv.punch_face_enabled, false),
        faceThreshold: /** @type {number} */ (numOr(kv.punch_face_threshold, 0.55)),
        faceV2Enabled: boolOr(kv.punch_face_v2_enabled, false),
        faceV2Threshold: /** @type {number} */ (numOr(kv.punch_face_v2_threshold, 0.42)),
        multiFixRequired: boolOr(kv.punch_multi_fix_required, true),
        strictGeofence: boolOr(kv.punch_strict_geofence, false),
        maxRejects10m: /** @type {number} */ (numOr(kv.punch_max_rejects_10m, 5)),
        maxAccuracyM: /** @type {number} */ (numOr(kv.punch_max_accuracy_m, 50)),
        maxFixAgeS: /** @type {number} */ (numOr(kv.punch_max_fix_age_s, 30)),
        teleportCheck: boolOr(kv.punch_teleport_check, true),
        maxTeleportKmh: /** @type {number} */ (numOr(kv.punch_max_teleport_kmh, 250)),
        radiusMeters: /** @type {number} */ (numOr(kv.punch_radius_meters, 120)),
        lat: coordsSet ? lat : null,
        lng: coordsSet ? lng : null,
    };
}

// ─── تحصين الموقع (multi-fix): كشف التجميد/الانتقال المستحيل/التشتت ─────────

const MAX_FIX_SPEED_KMH = 300;   // انتقال أسرع من ذلك = تزوير
const MAX_SESSION_SPREAD_M = 150; // تشتت القراءات داخل نفس الجلسة
// FIX 2026-10-11 (M18): cap fixes array size — unbounded array = DoS vector
const MAX_FIXES = 50;

/**
 * يحوّل موقع الطلب إلى قائمة إصلاحات موحدة (متعدد أو قديم أحادي).
 * الحقول الإضافية (altitude/heading/speed/t/mocked) تُحفَظ خامًا للتحليل —
 * غيابها لا يرفض (عملاء قدامى ومتصفحات لا توفرها).
 * @param {PunchLocation|null|undefined} loc
 * @returns {GeoFix[]}
 */
function normalizeFixes(loc) {
    const keepExtras = (/** @type {any} */ f) => {
        const numOrNull = (/** @type {unknown} */ v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        return {
            alt: numOrNull(f.alt ?? f.altitude),
            altAcc: numOrNull(f.altAcc ?? f.altitudeAccuracy),
            heading: numOrNull(f.heading),
            speed: numOrNull(f.speed),
            mocked: f.mocked === true,
            t: numOrNull(f.t ?? f.timestamp),
        };
    };
    if (Array.isArray(loc?.fixes) && loc.fixes.length) {
        // FIX 2026-10-11 (M18): cap array size — client can send arbitrary
        // count, causing quadratic speed/spread checks over large arrays.
        const capped = loc.fixes.slice(0, MAX_FIXES);
        return capped
            .map((f) => ({
                lat: Number(f.lat),
                lng: Number(f.lng),
                accuracy: Number(f.accuracy),
                fixAgeS: Number.isFinite(Number(f.fixAgeS)) ? Number(f.fixAgeS) : 0,
                ...keepExtras(f || {}),
            }))
            .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng)
                && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180);
    }
    if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
        return [{
            lat: Number(loc.lat),
            lng: Number(loc.lng),
            accuracy: Number.isFinite(Number(loc.accuracy)) ? Number(loc.accuracy) : 999,
            fixAgeS: Number.isFinite(Number(loc.fixAgeS)) ? Number(loc.fixAgeS) : 0,
            ...keepExtras(loc),
        }];
    }
    return [];
}

/**
 * فحوص جودة مجموعة الإصلاحات — كلها على السيرفر من البيانات الخام:
 *   • تجميد: كل الإحداثيات متطابقة تمامًا (GPS الحقيقي يهتز دائمًا) → تزوير
 *   • انتقال مستحيل: سرعة بين إصلاحين > 300 كم/س (geolib.getSpeed) → تزوير
 *   • تشتت: بعد بين أبعد إصلاحين > 150م داخل نفس الجلسة → قفزات
 *   • دقة ثابتة (flatline): نفس قيمة الدقة في كل القراءات — أشهر بصمة لتطبيقات
 *     الـ Fake GPS (الحقيقي يتذبذب دائمًا 5←30م) → مؤشر تزييف قوي
 *   • تقارب الدقة: تناقص الدقة عبر الجلسة = تقارب GPS حقيقي على الأقمار
 * الفروق الزمنية من طوابع الجهاز (t) عند توفرها — أدق من فروق fixAgeS.
 * @param {GeoFix[]} fixes
 * @returns {{best: GeoFix, spreadM: number, minSpreadM: number, maxSpeedKmh: number, frozen: boolean, accuracyFlatline: boolean, accuracyConverging: boolean}}
 */
function assessFixQuality(fixes) {
    if (fixes.length < 2) {
        return {
            best: fixes[0], spreadM: 0, minSpreadM: 0, maxSpeedKmh: 0,
            frozen: false, accuracyFlatline: false, accuracyConverging: false,
        };
    }
    const allSame = fixes.every((f) => f.lat === fixes[0].lat && f.lng === fixes[0].lng);
    let spreadM = 0;
    let minSpreadM = Infinity;
    let maxSpeedKmh = 0;
    const dtSeconds = (/** @type {GeoFix} */ a, /** @type {GeoFix} */ b) => {
        if (Number.isFinite(a.t) && Number.isFinite(b.t)) {
            return Math.abs(/** @type {number} */ (b.t) - /** @type {number} */ (a.t)) / 1000;
        }
        return Math.abs(b.fixAgeS - a.fixAgeS);
    };
    for (let i = 0; i < fixes.length; i++) {
        for (let j = i + 1; j < fixes.length; j++) {
            const d = haversineMeters(fixes[i].lat, fixes[i].lng, fixes[j].lat, fixes[j].lng);
            if (d > spreadM) {spreadM = d;}
            if (d < minSpreadM) {minSpreadM = d;}
            const dtS = dtSeconds(fixes[i], fixes[j]);
            if (dtS > 0 && d > 0) {
                let kmh = (d / 1000) / (dtS / 3600);
                // تحقق متقاطع بمحرك geolib الاحترافي عند توفر طوابع حقيقية
                if (_geolib && Number.isFinite(fixes[i].t) && Number.isFinite(fixes[j].t)) {
                    try {
                        const ms = _geolib.getSpeed(
                            { latitude: fixes[i].lat, longitude: fixes[i].lng, time: fixes[i].t },
                            { latitude: fixes[j].lat, longitude: fixes[j].lng, time: fixes[j].t });
                        if (Number.isFinite(ms)) {kmh = Math.max(kmh, ms * 3.6);}
                    } catch (_) { /* اليدوي يكفي */ }
                }
                if (kmh > maxSpeedKmh) {maxSpeedKmh = kmh;}
            }
        }
    }
    if (!Number.isFinite(minSpreadM)) {minSpreadM = 0;}
    const accs = fixes.map((f) => f.accuracy).filter((a) => Number.isFinite(a));
    const accuracyFlatline = accs.length >= 3 && accs.every((a) => a === accs[0]);
    // تقارب حقيقي: آخر قراءة أدق من الأولى بفارق واضح (التقاط الأقمار تدريجيًا)
    const accuracyConverging = accs.length >= 3
        && Number.isFinite(accs[0]) && Number.isFinite(accs[accs.length - 1])
        && (accs[0] - accs[accs.length - 1]) >= 5;
    const best = fixes.reduce((a, b) => (b.accuracy < a.accuracy ? b : a), fixes[0]);
    return {
        best,
        spreadM: Math.round(spreadM * 10) / 10,
        minSpreadM: Math.round(minSpreadM * 10) / 10,
        maxSpeedKmh: Math.round(maxSpeedKmh),
        frozen: allSame,
        accuracyFlatline,
        accuracyConverging,
    };
}

/**
 * درجة واقعية الجلسة (0-100) — تجمع إشارات يستحيل تزويرها معًا بسهولة:
 *   −40 دقة ثابتة في كل القراءات (بصمة Fake GPS)
 *   −25 بلا أي حقول حسّاسات إضافية (altitude/heading/speed) — مخفف لأن الداخل قد يحجبها
 *   +10 تقارب الدقة عبر الجلسة (GPS حقيقي)
 *   +5  ≥4 قراءات (جلسة مكتملة)
 * الإشارات تُرجع نصًا للتدقيق (تظهر للإدارة في سجل المحاولات).
 * @param {GeoFix[]} fixes
 * @param {{spreadM: number, accuracyFlatline: boolean, accuracyConverging: boolean}} quality ناتج assessFixQuality
 * @returns {{score: number, signals: string[]}}
 */
function assessFixRealism(fixes, quality) {
    let score = 100;
    const signals = [];
    if (quality.accuracyFlatline) {
        score -= 40;
        signals.push('FLAT_ACCURACY');
    }
    const withExtras = fixes.filter((f) =>
        f.alt != null || f.heading != null || f.speed != null).length;
    if (withExtras === 0) {
        score -= 10;
        signals.push('NO_SENSOR_EXTRAS');
    }
    if (quality.accuracyConverging) {
        score += 10;
        signals.push('ACCURACY_CONVERGING');
    }
    if (fixes.length >= 4) {
        score += 5;
        signals.push('FULL_SESSION');
    }
    if (fixes.some((f) => f.mocked === true)) {
        score = 0;
        signals.push('MOCK_FLAG');
    }
    return { score: Math.max(0, Math.min(100, score)), signals };
}

/**
 * فحص التنقل المستحيل بين بصمتين (نقي): هل انتقل الموظف من آخر بصمة مقبولة
 * إلى الحالية بسرعة مستحيلة؟ — يصطاد مشاركة الحسابات والتزييف المتنقل.
 * @param {{lat: number, lng: number, atMs: number}|null} prev آخر بصمة مقبولة
 * @param {{lat: number, lng: number, nowMs: number}} curr البصمة الحالية
 * @param {number} [maxKmh=250] العتبة (افتراضي 250 كم/س — فوق أي سيارة)
 * @returns {{teleport: boolean, speedKmh: number, distanceM: number}}
 */
function assessTeleport(prev, curr, maxKmh = 250) {
    if (!prev || !Number.isFinite(prev.lat) || !Number.isFinite(prev.lng)
        || !Number.isFinite(prev.atMs)) {
        return { teleport: false, speedKmh: 0, distanceM: 0 };
    }
    const distanceM = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const dtS = (curr.nowMs - prev.atMs) / 1000;
    if (!(dtS > 0)) {return { teleport: false, speedKmh: 0, distanceM: Math.round(distanceM * 10) / 10 };}
    const speedKmh = (distanceM / 1000) / (dtS / 3600);
    return {
        teleport: speedKmh > maxKmh && distanceM > 1000,
        speedKmh: Math.round(speedKmh),
        distanceM: Math.round(distanceM * 10) / 10,
    };
}

// ─── التعرف على الوجه (L5) — مطابقة متجهات بدون صور ─────────────────────────

const FACE_DESCRIPTOR_LEN = 128;

/**
 * تحقق صارم من متجه الوجه: 128 رقمًا محدودًا — يُرفض أي شيء آخر.
 * @param {unknown} d
 * @returns {d is number[]}
 */
function isValidFaceDescriptor(d) {
    return Array.isArray(d) && d.length === FACE_DESCRIPTOR_LEN
        && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 20);
}

/**
 * المسافة الإقليدية بين متجهين — مقياس مطابقة face_recognition القياسي.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
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
 * @param {unknown} candidate متجه المحاولة القادم من الجهاز
 * @param {unknown} stored القالب المخزن من قاعدة البيانات
 * @param {number|unknown} threshold
 * @returns {{ok: boolean, distance?: number, threshold?: number, samples?: number, rejectCode?: string}}
 */
function evaluateFaceMatch(candidate, stored, threshold) {
    if (!isValidFaceDescriptor(candidate)) {
        return { ok: false, rejectCode: 'PUNCH_FACE_INVALID' };
    }
    // UPGRADE 2026-10-01: القالب قد يكون عينات متعددة [[..]..] (تسجيل 5 عينات)
    // أو عينة واحدة قديمة [..] — المطابقة بأقل مسافة بين العينات تحسّن القبول
    // الفعلي مع تغيّر الإضاءة/الكاميرا دون تخفيف عتبة الأمان.
    const samples = Array.isArray(stored) && Array.isArray(stored[0])
        ? stored
        : (isValidFaceDescriptor(stored) ? [stored] : null);
    if (!samples) {
        return { ok: false, rejectCode: 'PUNCH_FACE_NOT_ENROLLED' };
    }
    const thr = /** @type {number} */ (numOr(threshold, 0.55));
    let best = Infinity;
    for (const s of samples) {
        if (!isValidFaceDescriptor(s)) {continue;}
        const d = faceDistance(candidate, s);
        if (d < best) {best = d;}
    }
    if (!Number.isFinite(best)) {
        return { ok: false, rejectCode: 'PUNCH_FACE_NOT_ENROLLED' };
    }
    return { ok: best <= thr, distance: Math.round(best * 10000) / 10000, threshold: thr, samples: samples.length };
}

// ─── الربط الذاتي للجهاز (L4 self-heal) — قرار نقي يُختبَر معزولًا ───────────

/**
 * ماذا تفعل بوابة البصمة مع ربط الجهاز لهذا الطلب؟ (نقي — بلا DB)
 *   'rebind' : جهاز جديد لحساب مربوط — اربطه تلقائيًا ووثّق ذلك (الافتراضي)
 *   'skip'   : العميل بلا معرّف جهاز قابل للتخزين — تُطبَّق بقية الطبقات وL4 يُتجاهل
 *   'none'   : لا تدخل — اترك evaluatePunch يحكم (مطابق = مرور، مختلف = رفض)
 * @param {Pick<PunchSettings, 'deviceBinding'|'deviceAutoRebind'>} settings
 * @param {string|null} deviceId معرّف الجهاز القادم في الطلب
 * @param {string|null} boundDeviceId الجهاز المربوط حاليًا في قاعدة البيانات
 * @returns {{action: 'rebind'|'skip'|'none', from?: string}}
 */
function resolveDeviceBindingAction(settings, deviceId, boundDeviceId) {
    if (!settings.deviceBinding) {return { action: 'none' };}
    if (!deviceId) {
        return settings.deviceAutoRebind ? { action: 'skip' } : { action: 'none' };
    }
    if (boundDeviceId && boundDeviceId !== deviceId) {
        return settings.deviceAutoRebind
            ? { action: 'rebind', from: boundDeviceId }
            : { action: 'none' };
    }
    return { action: 'none' };
}

// ─── الحكم الموحّد ───────────────────────────────────────────────────────────

/**
 * الحكم على محاولة البصمة كاملة (L1→L4 + مفتاح التفعيل).
 * @param {PunchSettings} settings ناتج resolvePunchSettings
 * @param {PunchRequest} req بيانات الطلب المنظفة
 * @returns {EvaluateResult}
 */
function evaluatePunch(settings, req) {
    const details = {
        networkOk: false,
        hasLocation: false,
        fixCount: /** @type {number|undefined} */ (undefined),
        singleFix: /** @type {boolean|undefined} */ (undefined),
        spreadM: /** @type {number|undefined} */ (undefined),
        maxSpeedKmh: /** @type {number|undefined} */ (undefined),
        trustScore: /** @type {number|undefined} */ (undefined),
        trustSignals: /** @type {string[]|undefined} */ (undefined),
        bestLat: /** @type {number|null} */ (null),
        bestLng: /** @type {number|null} */ (null),
        distanceM: /** @type {number|null} */ (null),
        accuracyM: /** @type {number|null} */ (null),
        fixAgeS: /** @type {number|null} */ (null),
        deviceId: req.deviceId || null,
    };

    // 0. مفتاح التفعيل المركزي (G4: الميزة تولد مغلقة)
    if (!settings.portalEnabled) {
        return { decision: 'rejected', rejectCode: 'PUNCH_PORTAL_DISABLED', details };
    }

    // 1. L1 — الشبكة الداخلية. SECURITY: cloudflared يعمل على نفس الجهاز فيصل
    //    التونل للسيرفر من 127.0.0.1 — كان يُحسب "داخليًا" فيُفتح البصمة للإنترنت
    //    كله. الآن حركة التونل (ترويسات cf-*) تُقبل فقط إذا الجيوفانس مفعّل وسيحكم
    //    إثبات الموقع؛ مع تعطيل الجيوفانس تُرفض (لا بصمة عن بُعد بلا إثبات مكان).
    const viaTunnel = req.viaTunnel === true;
    details.networkOk = viaTunnel || isInternalIp(req.remoteIp);
    if (!details.networkOk || (viaTunnel && !settings.geofenceEnabled)) {
        return { decision: 'rejected', rejectCode: 'PUNCH_OUT_OF_NETWORK', details };
    }

    // تحصين الموقع: تطبيع الإصلاحات (متعددة أو أحادية للتوافق القديم)
    const fixes = normalizeFixes(req.location);
    details.hasLocation = fixes.length > 0;
    details.fixCount = fixes.length;

    // 2-5. الطبقات الجغرافية — تعمل فقط إذا فُعّلت إداريًا (وقُطبت الإحداثيات)
    if (settings.geofenceEnabled) {
        if (settings.lat == null || settings.lng == null) {
            return { decision: 'rejected', rejectCode: 'PUNCH_GEOFENCE_NOT_CONFIGURED', details };
        }
        if (!details.hasLocation) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_REQUIRED', details };
        }

        // تحصين 1: قراءات متعددة إلزامية — القناع الواحد لا يثبت شيئًا
        // الجذرية (2026-10-02): القراءة الواحدة «عالية الجودة» تُقبل لأن كثيرًا
        // من الأجهزة داخل المبنى لا تجمع قراءتين خلال الجلسة، والرفض الدائم
        // حجب البوابة كليًا. الشروط: دقة صارمة (≤30م) وطازجة (≤ مهلة القراءة)
        // — وبقية الطبقات (النطاق والوجه وربط الجهاز والواقعية) مفروضة بالكامل،
        // ويُوثَّق ذلك بإشارة SINGLE_FIX_FALLBACK للمراجعة.
        if (settings.multiFixRequired && fixes.length < 2) {
            const f = fixes[0];
            const strictAcc = Math.min(Number(settings.maxAccuracyM) || 50, 30);
            const maxAge = Number(settings.maxFixAgeS) || 30;
            const singleOk = f != null && Number.isFinite(Number(f.accuracy))
                && Number(f.accuracy) > 0 && Number(f.accuracy) <= strictAcc
                && Number(f.fixAgeS) <= maxAge;
            if (!singleOk) {
                return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_WEAK', details };
            }
            details.singleFix = true;
        }

        // تحصين 2: جودة المجموعة من البيانات الخام (سيرفر لا عميل)
        const quality = assessFixQuality(fixes);
        details.spreadM = quality.spreadM;
        details.maxSpeedKmh = quality.maxSpeedKmh;
        const realism = assessFixRealism(fixes, quality);
        details.trustScore = realism.score;
        details.trustSignals = realism.signals;
        // القراءة الواحدة المقبولة تُوثَّق دائماً للمراجعة الإدارية
        if (details.singleFix) {
            details.trustScore = Math.min(realism.score, 60);
            details.trustSignals = [...realism.signals, 'SINGLE_FIX_FALLBACK'];
        }
        if (quality.frozen) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_FROZEN', details };
        }
        if (quality.maxSpeedKmh > MAX_FIX_SPEED_KMH) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_FROZEN', details };
        }
        if (quality.spreadM > MAX_SESSION_SPREAD_M) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_WEAK', details };
        }
        // تحصين 2ب: علامة تزييف صريحة من الجهاز (فحص أصلي APK أو WebView) → رفض قاطع
        if (fixes.some((f) => f.mocked === true)) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_MOCKED', details };
        }
        // تحصين 2ج: دقة ثابتة + تجميد شبه كامل + بلا حسّاسات = بصمة Fake GPS
        // (كل إشارة وحدها قد تكون بريئة — اجتماعها الثلاثي لا يحدث طبيعيًا)
        if (quality.accuracyFlatline && quality.spreadM < 3 && realism.signals.includes('NO_SENSOR_EXTRAS')) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_MOCKED', details };
        }
        // دقة ثابتة وحدها (إشارة متذبذبة الجودة) → ضعف لا تزييف مؤكد
        if (quality.accuracyFlatline) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_WEAK', details };
        }

        // أفضل إصلاح = الأدق بين القراءات
        const best = quality.best;
        details.accuracyM = best.accuracy;
        details.fixAgeS = best.fixAgeS;
        details.bestLat = best.lat;
        details.bestLng = best.lng;

        // 3. مؤشر موقع مزيف: العميل يبلّغ صراحةً
        if (req.location?.mocked === true) {
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

        // 5. النطاق: المسافة من إحداثيات المطعم (من أفضل إصلاح) — geolib الاحترافية
        details.distanceM = Math.round(haversineMeters(settings.lat, settings.lng, best.lat, best.lng) * 10) / 10;
        if (!isWithinRadius(best.lat, best.lng, settings.lat, settings.lng, settings.radiusMeters)) {
            return { decision: 'rejected', rejectCode: 'PUNCH_OUT_OF_RANGE', details };
        }
        // النطاق الصارم: منطقة الغموض (المسافة مقبولة لكن هامش الدقة يمتد
        // خارج النطاق بمسافة كبيرة) تُرفض إذا فعّلت الإدارة الصرامة
        if (settings.strictGeofence
            && details.distanceM + details.accuracyM > settings.radiusMeters + 10) {
            return { decision: 'rejected', rejectCode: 'PUNCH_LOCATION_AMBIGUOUS', details };
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

module.exports = {
    haversineMeters,
    isWithinRadius,
    isInternalIp,
    resolvePunchSettings,
    normalizeFixes,
    assessFixQuality,
    assessFixRealism,
    assessTeleport,
    isValidFaceDescriptor,
    faceDistance,
    evaluateFaceMatch,
    resolveDeviceBindingAction,
    evaluatePunch,
    FACE_DESCRIPTOR_LEN,
    MAX_SESSION_SPREAD_M,
    MAX_FIX_SPEED_KMH,
};
