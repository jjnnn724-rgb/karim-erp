/**
 * attendance-engine.js — محرك الحضور الواحد الصارم
 * ────────────────────────────────────────────────────────────────────────────
 * البصمة الخام هي الدليل الوحيد. المحرك لا يخمّن ولا يستنتج ولا يفتح جلسة:
 * 1. حالة الجهاز تحدد الاتجاه: بصمة دخول ⇒ دخول، بصمة انصراف ⇒ إغلاق آخر صف مفتوح.
 * 2. نافذة الوردية ونمط الموظف و«الزر المنسي» لم تعد تُستخدم في التصنيف إطلاقًا.
 * 3. لا انصراف مُختلَق بنهاية الوردية ولا دخول مُختلَق من وقت البداية.
 * 4. كل تعارض (دخول على صف مفتوح، انصراف بلا دخول، حالة مجهولة) يُسجَّل في
 *    attendance_decisions للمراجعة — البصمة لا تُمحى والقرار لا يُتّخذ صامتًا.
 * 5. الدوام كله بتوقيت مكة (Asia/Riyadh) بلا استثناء.
 * 6. صفر تعارض مع القيم المدخلة يدويًا/QR (fill-only).
 */

'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const {
    shiftDateFor, shiftDateForEmployee, prevDay, isLate, isEarlyLeave, graceMinutes, overGrace, lockGraceMinutes,
    calculateDelayParts,
    normalizeShiftStart, normalizeShiftKarim, delayEngineEnabled,
} = require('./shift-day');

const proto = require('./zkteco/protocol');
const IN_STATES = proto.CHECK_IN_STATES;
const OUT_STATES = proto.CHECK_OUT_STATES;
// نافذة «نفس الضغط»: خروجٌ على بعد دقائق من دخول نفس اليوم هو نفس لمسة الجهاز،
// لا يومٌ من عمله. أضيق ما يمكن (5 دقائق) ولا يُتخذ به قرار صامت — يُعلَّم للمراجعة.
const SAME_PRESS_MS = 5 * 60 * 1000;

// سقف الجلسة السليم (2026-11-03): أي اقتران دخول/انصراف يتجاوز 23:20 ساعة ليس
// وردية — هو إقتران خاطئ عبر منتصف ليلين. الدراسة الدامغة (156 صف شاذ في آخر
// 45 يومًا): كل الصفوف المخترعة كانت ≥1400 دقيقة وكل الجلسات الحقيقية ≤810.
// لا يُكتب صفٌّ بهذه المدة صامتًا: إمّا إعادة تثبيت الدخول على أحدث بصمة دخول
// حقيقية قبل الانصراف (الإقتران الصحيح)، أو التعلّم للمراجعة بلا كتابة.
const MAX_SESSION_MIN = 1400;
const MAX_SESSION_MS = MAX_SESSION_MIN * 60000;

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh

/** هل يُسمح باختلاق انصرافٍ بلا بصمة؟ افتراضيًا: لا (طلب المالك 2026-11-02). */
function inventionAllowed() {
    return ['on', 'true', '1'].includes(String(process.env.ATTENDANCE_INVENT_MISSING_EXIT ?? '').trim().toLowerCase());
}

// ─── تاريخ سريان الدوام (087): الدوام الساري في يوم = أحدث صف بتاريخ ≤ اليوم ───
// fail-open دائمًا: أي خطأ → خريطة فارغة (المستهلك يعود لأعمدة البطاقة).
async function loadShiftHistoryMap(employeeIds, toDate) {
    const map = new Map();
    try {
        const ids = [...new Set((employeeIds || []).map(Number).filter(Number.isInteger))];
        if (!ids.length) {return map;}
        const { rows } = await pool.query(
            `SELECT employee_id, shift_start, shift_karim, day_off, effective_from::text AS effective_from
               FROM employee_shift_history
              WHERE employee_id = ANY($1::bigint[]) AND effective_from <= $2::date
              ORDER BY employee_id, effective_from`,
            [ids, String(toDate)]
        );
        for (const r of rows) {
            const k = String(r.employee_id);
            if (!map.has(k)) {map.set(k, []);}
            map.get(k).push(r);
        }
    } catch (_) { logger.warn("attendance-engine non-fatal:", _ && _.message ? _.message : _); }
    return map;
}

function resolveShiftAt(histRows, dateStr, fallback) {
    let best = null;
    for (const r of (histRows || [])) {
        if (String(r.effective_from) <= String(dateStr)) {best = r;}
        else {break;}
    }
    if (!best) {return fallback;}
    return {
        shift_start: best.shift_start || fallback?.shift_start,
        shift_karim: Number(best.shift_karim) > 0 ? Number(best.shift_karim) : fallback?.shift_karim,
        day_off: best.day_off ?? fallback?.day_off ?? null,
    };
}

// ════════════════════════════════════════════════════════════════════════
// إعدادات قابلة للتكوين عبر ENV
// ════════════════════════════════════════════════════════════════════════

function autoCompleteEnabled() {
    // لا استكمال تلقائي بلا بصمة (قرار المالك 2026-11-05): لا حضور ولا انصراف
    // إلا من بصمة خام — جهاز البصمة أو كاميرا التطبيق المقبولة. مفتاح
    // ATTENDANCE_AUTO_COMPLETE وحده لم يبقَ كافيًا؛ يلزمه مفتاح الاختلاق
    // الصريح ATTENDANCE_INVENT_MISSING_EXIT (وهو مطفأ افتراضيًا).
    if (!inventionAllowed()) {return false;}
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.ATTENDANCE_AUTO_COMPLETE || 'false').trim().toLowerCase());
}

function smartReconcileEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.ATTENDANCE_SMART_RECONCILE || 'true').trim().toLowerCase());
}

function maxReconcileDays() {
    const n = Number(process.env.ATTENDANCE_RECONCILE_DAYS);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 30;
}

function confidenceThreshold() {
    const n = Number(process.env.ATTENDANCE_CONFIDENCE_THRESHOLD);
    return Number.isFinite(n) && n >= 0.5 && n <= 1.0 ? n : 0.85;
}

// ════════════════════════════════════════════════════════════════════════
// دوال مساعدة
// ════════════════════════════════════════════════════════════════════════

function pad2(n) { return String(n).padStart(2, '0'); }

function toMin(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** تعقيم وقت الحائط النصي (درس 24:51): أي صيغة شاذة تُعاد لصيغة 00-23:00-59 وإلا null.
 *  تُستدعى مركزيًا على أي وقت قادم من خارج المحرك قبل كتابته في attendance. */
function safeWallTime(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) {return null;}
    let H = Number(m[1]);
    const M = Number(m[2]);
    if (!Number.isFinite(H) || !Number.isFinite(M) || M > 59) {return null;}
    H = ((H % 24) + 24) % 24;
    return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}
function instantToWall(instant) {
    const shifted = new Date(instant.getTime() + BUSINESS_TZ_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
        time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
    };
}

/**
 * ترطيب lastPunch من صف خام في attendance_logs — يُستدعى عند فقد كاش الذاكرة
 * (بعد إعادة التشغيل) حتى يظل حرس «التكرار خلال 5 دقائق» محصنًا عبر الإقلاعات.
 * نقية وقابلة للاختبار: صف {attendanceTime, punchState} → {min, out} أو null.
 */
function lastPunchFromRow(row) {
    if (!row || !row.attendanceTime) {return null;}
    const t = new Date(row.attendanceTime);
    if (Number.isNaN(t.getTime())) {return null;}
    const wall = instantToWall(t);
    const state = Number(row.punchState);
    return { min: wall.hour * 60 + wall.minute, out: OUT_STATES.has(state) && !IN_STATES.has(state), at: t.getTime() };
}

/** آخر بصمة خام للموظف قبض البصمة الحالية مباشرة — fail-open دائمًا */
async function lastPunchFromDb(employeeId, instant) {
    try {
        // `< instant` حصرًا: بصمة الزكطة الحالية نفسها (المُدرجة قبل النداء) تُستبعد
        const { rows } = await pool.query(
            `SELECT "attendanceTime", "punchState" FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" < $2
              ORDER BY "attendanceTime" DESC LIMIT 1`,
            [employeeId, instant]);
        return lastPunchFromRow(rows[0]);
    } catch (_) { return null; }
}

/** دقائق بين وقتين على نفس يوم الوردية (يدعم عبر منتصف الليل) */
function minutesBetween(inTime, outTime, _shiftDate) {    const [ih, im] = String(inTime).split(':').map(Number);
    const [oh, om] = String(outTime).split(':').map(Number);
    let d = (oh * 60 + om) - (ih * 60 + im);
    if (d < 0) { d += 24 * 60; }
    return d;
}

/**
 * حارس مدة الجلسة (2026-11-03): قبل أي إكمال لصفٍّ بانصراف، إن كان الانصراف
 * يتجاوز سقف الجلسة عن الدخول، يُعاد تثبيت الدخول على أحدث بصمة دخول حقيقية
 * (حالة دخول في سجل البصمات) بين دخول الصف والمغادرة — هذه هي الوحدة العمليّة
 * الفعلية للجلسة وفق الدليل الخام. تُرجع: { instant, wall } أو null.
 * fail-open دائمًا: أي خطأ → null (لا يمنع الأرشفة من القرار الأصلي الواعي).
 */
async function reAnchorFromLogs(client, employeeId, afterInstant, beforeInstant) {
    try {
        const { rows } = await client.query(
            `SELECT "attendanceTime" AS t FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" > $2
                AND "attendanceTime" < $3
                AND "punchState" IN (0, 2, 4)
              ORDER BY "attendanceTime" DESC LIMIT 1`,
            [employeeId, new Date(afterInstant.getTime() + 60000), new Date(beforeInstant.getTime() - 120000)]
        );
        if (!rows[0]) {return null;}
        const t = new Date(rows[0].t);
        if (Number.isNaN(t.getTime())) {return null;}
        return { instant: t, wall: instantToWall(t) };
    } catch (_) { logger.warn('[AttendanceEngine] إعادة تثبيت الدخول فشلت (fail-open):', _ && _.message ? _.message : _); return null; }
}

/** نهاية الوردية كلحظة مطلقة (للمقارنات) */
function endInstantOf(shiftDate, shiftStart, shiftKarim) {
    const [h, m] = String(shiftStart).split(':').map(Number);
    const [y, mo, d] = shiftDate.split('-').map(Number);
    const mins = (h || 0) * 60 + (m || 0) + Math.round(Number(shiftKarim) * 60);
    return Date.UTC(y, mo - 1, d, 0, 0) + mins * 60000 - BUSINESS_TZ_OFFSET_MS;
}

/** نمط الموظف: وسيط الدخول/الخروج من آخر N أيام مكتملة */
async function learnPattern(employeeId, days = 30) {
    const { rows } = await pool.query(
        `SELECT "checkIn", "checkOut" FROM attendance
          WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL
            AND checkin_inferred = false AND checkout_inferred = false
          ORDER BY date DESC LIMIT $2`,
        [employeeId, days]
    ).catch(() => ({ rows: [] }));

    const med = (arr) => {
        if (!arr.length) {return null;}
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
    };

    const ins = rows.map(r => toMin(r.checkIn)).filter(v => v != null);
    const outs = rows.map(r => {
        let v = toMin(r.checkOut);
        if (v == null) {return null;}
        const iv = toMin(r.checkIn);
        if (iv != null && v <= iv) { v += 24 * 60; } // ليلية
        return v;
    }).filter(v => v != null);

    return {
        samples: rows.length,
        medianIn: med(ins),
        medianOut: med(outs),
    };
}

// ════════════════════════════════════════════════════════════════════════
// المحرك الواحد: تصنيفٌ بالبصمة لا بالتخمين
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// (حُذِف قرار المالك 2026-11-05) deriveSequencePunchState — كان يشتق اتجاه
// البصمة الناقصة من تسلسل السطر المفتوح (قرار 2026-11-02). البصمة الفيزيائية
// هي مصدر الحقيقة الوحيد الآن: لا اشتقاق ولا استنتاج لاتجاه من أي سياق.
// المجهول/خارج البروتوكول → classifyPunch: ignore + review، بلا كتابة صفوف.
// ════════════════════════════════════════════════════════════════════════

/**
 * يصنف بصمة إلى 'in' | 'out' | 'ignore' بالدليل فقط.
 * @returns {{action:string, confidence:number, reason:string, override:boolean, review:boolean}}
 */
function classifyPunch({
    punchState,
    wallMin,              // دقائق من منتصف الليل (ساعة الحائط) — تُستخدم لحرس التكرار فقط
    punchAt,              // لحظة البصمة مطلقة (epoch ms) — تمايز التكرار عبر الأيام
    hasOpenRow,           // هل يوجد صف مفتوح (دخول بلا انصراف) لليوم أو اليوم السابق
    openRowCheckIn,       // ساعة دخول الصف المفتوح ('HH:MM' أو null)
    openRowCheckInAt,     // لحظة دخول الصف المفتوح (epoch ms أو null)
    openRowShiftDate,     // يوم الوردية للصف المفتوح
    currentShiftDate,     // يوم الوردية للبصمة الحالية
    lastPunch,            // { min, out, at? } آخر بصمة معالجة (at = لحظة مطلقة)
}) {
    const rawState = Number(punchState);
    // حالة مجهولة أو غائبة لا تُقرأ «دخولًا»: Number(null)=0 وNumber('')=0 وكانا
    // يقعان في IN_STATES فيخترع المحرك دخولًا لا بصمة له.
    const knownState = punchState !== null && punchState !== undefined && punchState !== '' && Number.isFinite(rawState);
    const deviceIn = knownState && IN_STATES.has(rawState);
    const deviceOut = knownState && OUT_STATES.has(rawState);
    const thisOut = deviceOut && !deviceIn;

    // 0. حالة لا يعرفها البروتوكول: لا قرار ولا كتابة — تُعلَّم للمراجعة.
    //    كانت تقع في الزمن المحايد فتصنع دخولًا لا بصمة له.
    if (!deviceIn && !deviceOut) {
        return { action: 'ignore', confidence: 0.5, reason: `حالة بصمة غير معروفة (${punchState}) — بلا قرار`, override: false, review: true };
    }

    // 1. بصمة مكررة بنفس الاتجاه خلال 5 دقائق → تجاهل.
    //    التشابه بدقائق الساعة وحده لا يكفي: بصمة أمس 16:51 كانت تبتلع دخول
    //    النهاردة 16:55 (درس 2026-10-14). إن وُجدت لحظة البصمة والمرساة، يُطلب
    //    أيضًا قربٌ مطلق ≤ 5 دقائق. بلا punchAt → السلوك القديم (اختبارات قديمة).
    const dupAbs = lastPunch && lastPunch.at != null && punchAt != null
        ? Math.abs(punchAt - lastPunch.at) <= 5 * 60000 : true;
    if (lastPunch && lastPunch.out === thisOut && dupAbs && Math.abs(wallMin - lastPunch.min) <= 5) {
        return { action: 'ignore', confidence: 0.95, reason: 'بصمة مكررة بنفس الاتجاه خلال 5 دقائق', override: false, review: false };
    }

    // هل الصف المفتوح من يوم وردية أقدم؟ (ليلاً: صف أمس ما زال بلا ختام)
    const openRowIsEarlierDay = !!(openRowShiftDate && currentShiftDate && openRowShiftDate !== currentShiftDate);

    if (hasOpenRow) {
        if (thisOut) {
            // لمسة واحدة يمرّ بها الجهاز بدخول ثم خروج: خروجٌ على بعد 5 دقائق من
            // دخول *نفس اليوم* ليس يوم عمل من خمس دقائق — يُعلَّم، لا يُقفل به الصف.
            const inAtMs = openRowCheckInAt != null ? Number(openRowCheckInAt) : null;
            const samePress = !openRowIsEarlierDay && inAtMs != null && punchAt != null
                && toMin(openRowCheckIn) != null
                && punchAt > inAtMs && punchAt - inAtMs <= SAME_PRESS_MS;
            if (samePress) {
                return { action: 'ignore', confidence: 0.8, reason: 'انصراف خلال 5 دقائق من دخول نفس اليوم — لمسة واحدة، للمراجعة', override: false, review: true };
            }
            return { action: 'out', confidence: 1, reason: openRowIsEarlierDay ? 'صف مفتوح من يوم وردية سابق — البصمة تُغلقه' : 'صف مفتوح + بصمة انصراف', override: false, review: false };
        }
        // بصمة دخول وصف مفتوح: إن كان الصف ليوم سابق فهي دخول اليوم الحالي، وصف الأمس
        // يبقى مفتوحًا بلا انصراف مُختلَق (واقعة EMP-052: انصراف 05:17 المختلَق ابتلع
        // انصرافه الحقيقي فجرًا وحوّل دخوله المسائي إلى «انصراف 416 د»).
        // أما إن كان صف اليوم نفسه فالسجل يقول إنه دخل ولا يُشترى له خروج بالحدس.
        if (openRowIsEarlierDay) {
            return { action: 'in', confidence: 1, reason: 'الصف المفتوح ليوم وردية سابق — البصمة دخول اليوم الحالي', override: false, review: false };
        }
        return { action: 'ignore', confidence: 0.9, reason: 'بصمة دخول على صف مفتوح لهذا اليوم — الدخول مسجل، التعارض للمراجعة', override: false, review: true };
    }

    // 2. لا صف مفتوح: تُكتب البصمة كما هي — لا نافذة وردية، لا نمط موظف،
    //    لا قرار بالزمن.
    if (deviceIn) {
        return { action: 'in', confidence: 1, reason: 'بصمة دخول بلا صف مفتوح', override: false, review: false };
    }
    return { action: 'out', confidence: 0.9, reason: 'بصمة انصراف بلا دخول — انصراف يتيم، للمراجعة', override: false, review: true };
}

// ════════════════════════════════════════════════════════════════════════
// حساب التأخير المحكم (العنصر الأساسي)
// ════════════════════════════════════════════════════════════════════════

/**
 * يحسب تفصيل التأخير ليوم واحد
 * @returns { arrivalLateMinutes, earlyLeaveMinutes, totalLateMinutes, lateFlag, earlyFlag }
 */
function calculateDelayDetail({ checkIn, checkOut, shiftStart, shiftKarim }) {
    const zero = { arrivalLateMinutes: 0, earlyLeaveMinutes: 0, totalLateMinutes: 0, lateFlag: false, earlyFlag: false };
    if (!delayEngineEnabled()) {return zero;}
    if (!checkIn && !checkOut) {return zero;}

    const checkInMin = toMin(checkIn);
    const shiftMin = toMin(shiftStart) ?? 9 * 60;
    // قرار المالك 2026-11-03: ربع ساعة واحدة لليوم كله، تُستهلك من البداية أو
    // النهاية معًا. داخل الحدّ = صفر على الطرفين، وفوقه = الدقائق كاملة.
    const arrivalRaw = checkInMin == null ? 0 : Math.max(0, checkInMin - shiftMin);

    let earlyRaw = 0;
    let totalLateRaw = 0;
    let out;

    if (checkOut) {
        const checkOutMin = toMin(checkOut);
        if (checkOutMin != null) {
            const karim = Number(shiftKarim) > 0 ? Number(shiftKarim) : 10;
            const endRaw = shiftMin + Math.round(karim * 60);
            out = checkOutMin;

            if (checkInMin != null && out < checkInMin) {
                out += 24 * 60;
            }
            // وردية ليلية: الانصراف الصباحي على نفس الخط الممتد
            if (endRaw > 24 * 60 && out < 12 * 60) { out += 24 * 60; }
            // بلا دخول مسجل لا يُحتسب تبكير: الخروج وحده لا يثبت شيئًا
            if (checkInMin != null && out >= shiftMin) {
                earlyRaw = Math.max(0, endRaw - out);
            }
            if (checkInMin != null) {
                const requiredMin = Math.round(karim * 60);
                const workedMin = out - checkInMin; // نفس التظليل الليلي المطبق على out
                totalLateRaw = Math.max(0, requiredMin - workedMin);
            }
        }
    }

    // الميزانية الواحدة: تأخير البداية + تبكير النهاية يشتركان في ١٥ دقيقة.
    const spent = arrivalRaw + earlyRaw;
    const withinBudget = spent <= graceMinutes();
    const arrival = withinBudget ? 0 : arrivalRaw;
    const early = withinBudget ? 0 : earlyRaw;
    // بلا بصمة خروج: اليوم مفتوح → يُحكم على العجز عند إغلاقه
    const totalLate = checkOut ? overGrace(totalLateRaw) : arrival;

    return {
        arrivalLateMinutes: arrival,
        earlyLeaveMinutes: early,
        totalLateMinutes: totalLate,
        lateFlag: arrival > 0,
        earlyFlag: early > 0,
    };
}

/** الدالة الموحدة لحساب دقائق التأخير (للاستخدام في التقارير) */
function calculateTotalLateMinutes({ checkIn, checkOut, shiftStart, shiftKarim }) {
    return calculateDelayDetail({ checkIn, checkOut, shiftStart, shiftKarim }).totalLateMinutes;
}

// ════════════════════════════════════════════════════════════════════════
// خدمة الحضور الموحدة (فئة رئيسية)
// ════════════════════════════════════════════════════════════════════════

class AttendanceEngine {
    constructor() {
        this.io = null;
        /** بثّ مُوجَّه (غرفة erp:authed عند RT_REQUIRE_AUTH) — لا io.emit خام */
        this.emit = null;
        this.patterns = new Map(); // employeeId → pattern
        this.lastPunches = new Map(); // employeeId → { min, out }
    }

    setIO(io) {
        this.io = io;
        this.emit = require('./realtime/guard').makeEmitScoped(io);
    }

    async getEmployeeShift(employeeId, forDate) {
        // الدوام الساري في التاريخ المطلوب (تاريخ السريان 087) — الماضي محفوظ،
        // والمستقبل المرتب يطبق تلقائيًا. الرجوع للأعمدة عند غياب التاريخ.
        const { rows } = await pool.query(
            `SELECT shift_start, shift_karim, auto_checkout, auto_lock
             FROM employees WHERE id = $1`, [employeeId]
        );
        if (!rows[0]) {return null;}
        const base = {
            shiftStart: normalizeShiftStart(rows[0].shift_start),
            shiftKarim: normalizeShiftKarim(rows[0].shift_karim),
            autoCheckout: rows[0].auto_checkout === true,
            autoLock: rows[0].auto_lock === true,
        };
        const d = forDate || new Date().toISOString().slice(0, 10);
        try {
            const hist = await loadShiftHistoryMap([employeeId], d);
            const at = resolveShiftAt(hist.get(String(employeeId)), d, null);
            if (at) {
                return {
                    ...base,
                    shiftStart: normalizeShiftStart(at.shift_start || base.shiftStart),
                    shiftKarim: normalizeShiftKarim(Number(at.shift_karim) > 0 ? Number(at.shift_karim) : base.shiftKarim),
                };
            }
        } catch (_) { logger.warn("attendance-engine non-fatal:", _ && _.message ? _.message : _); }
        return base;
    }

async loadPattern(employeeId) {
        if (this.patterns.has(employeeId)) {return this.patterns.get(employeeId);}
        const pattern = await learnPattern(employeeId);
        this.patterns.set(employeeId, pattern);
        return pattern;
    }

    /**
     * تحقق مما إذا كان الموظف في إجازة معتمدة في تاريخ محدد
     */
    async isOnLeave(employeeId, date) {
        const { rows } = await pool.query(
            `SELECT 1 FROM "leaveRequests" 
             WHERE "employeeId" = $1 AND $2 BETWEEN "startDate" AND "endDate" 
             AND status = 'approved' LIMIT 1`,
            [employeeId, date]
        );
        return rows.length > 0;
    }

    // ════════════════════════════════════════════════════════════════════════
    // معالجة بصمة واحدة (النقطة المركزية)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * يعالج بصمة واحدة ويحدث جدول attendance
     * @returns { action: 'check_in'|'check_out'|'ignore'|'fix_in'|'fix_out'|null, record, decision }
     */
    async processPunch({ employeeId, punchState, instant, wall, device, source = 'device', forDate = null }) {
        /* الورديةُ السارية *يومَ البصمة* لا يومَ التشغيل: إعادةُ معالجةِ بصمةٍ
           قديمة (مِصلحُ تدقيق البصمة) بلا هذا تُحلَّل على ورديةِ اليوم فتُكتب
           في يومٍ خاطئ. المسارُ الحيُّ لا يمرّر forDate فيبقى سلوكُه كما هو. */
        const shift = await this.getEmployeeShift(employeeId, forDate || undefined);
        if (!shift) {return { action: null, error: 'Employee not found' };}
        // تعقيم مركزي: لا يُكتب وقت حائط شاذ في attendance أبدًا (درس 24:51)
        if (wall && typeof wall.time === 'string') {
            const clean = safeWallTime(wall.time);
            wall = clean ? { ...wall, time: clean } : { ...wall, time: null };
        }

        const { shiftStart, shiftKarim, autoLock } = shift;
        const shiftDate = shiftDateForEmployee(wall.date, wall.hour, { shift_start: shiftStart, shift_karim: shiftKarim });

        // تحقق من الإجازة: إذا كان في إجازة، سجل البصمة لكن عيّن on_leave
        const onLeave = await this.isOnLeave(employeeId, shiftDate);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const wallMin = wall.hour * 60 + wall.minute;
            const thisOut = OUT_STATES.has(Number(punchState)) && !IN_STATES.has(Number(punchState));
            let lastPunch = this.lastPunches.get(employeeId) ?? null;
            if (!lastPunch) {
                // الكاش فارغ (أول بصمة بعد إقلاع جديد) — ترطيب من القاعدة حتى لا
                // يفقد حرس «التكرار خلال 5 دقائق» ذاكرته عبر إعادة التشغيل
                lastPunch = await lastPunchFromDb(employeeId, instant);
                if (lastPunch) {this.lastPunches.set(employeeId, lastPunch);}
            }
            // هل يوجد صف مفتوح؟ (يوم الوردية أو اليوم السابق للورديات الليلية)
            // «مفتوح» = له دخول بلا انصراف. السطر الفارغ (لا دخول ولا انصراف) ليس
            // مفتوحًا: صفّه كذلك كان يجعل بصمة فجر تُقفل سطر يوم لم يبدأ بعد، فيُكتب
            // انصراف بلا دخول ويسدّ باب دخول النهار (درس 14/10).
            const openCheck = await client.query(
                `SELECT id, "checkIn", "checkInAt" FROM attendance
                  WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL AND "checkOut" IS NULL
                    AND date IN ($2, $3) AND NOT COALESCE(on_leave, false)
                  ORDER BY date DESC LIMIT 1`,
                [employeeId, shiftDate, prevDay(shiftDate)]
            );
            const openRow = openCheck.rows[0] || null;
            const hasOpenRow = !!openRow;
            const openRowCheckIn = openRow ? (openRow.checkIn || null) : null;
            const openRowCheckInAt = openRow && openRow.checkInAt ? new Date(openRow.checkInAt).getTime() : null;
            // يوم الوردية للصف المفتوح يُشتق من لحظة دخوله بتوقيت مكة، لا من تاريخ
            // صفّه (درس 2026-10-11: كان يُخلط UTC بالمحلي فيُخطئ يوم بصمات 00:00-03:00).
            let openRowShiftDate = null;
            if (openRowCheckInAt != null) {
                const w = instantToWall(new Date(openRowCheckInAt));
                openRowShiftDate = shiftDateForEmployee(w.date, w.hour, { shift_start: shiftStart, shift_karim: shiftKarim });
            }

            // قرار المالك 2026-11-05 (يُلغي اشتقاق 2026-11-02): البصمة الفيزيائية هي
            // مصدر الحقيقة الوحيد — لا اشتقاق لاتجاهٍ من تسلسل السطر المفتوح ولا من
            // أي سياق. بلا حالة صريحة (null/''/undefined) أو بحالة خارج البروتوكول
            // → لا قرار ولا كتابة: classifyPunch يُرجع ignore + review، وتبقى البصمة
            // محفوظة خامًا في attendance_logs ومحفوظة القرار في attendance_decisions.

            // لا قاعدة نسيان ولا انصراف مستنتَج: صفٌ مفتوح بلا بصمة خروج يبقى مفتوحًا
            // ويظهر كذلك في كشف البصمات (قرار المالك 2026-11-02 بعد واقعة EMP-052).
            let verdict = classifyPunch({
                punchState,
                wallMin,
                punchAt: instant.getTime(),
                hasOpenRow,
                openRowCheckIn,
                openRowCheckInAt,
                openRowShiftDate,
                currentShiftDate: shiftDate,
                lastPunch,
            });

            // ═══ حديد 2026-10-06: حرس التكرار لا يثق بالذاكرة وحدها ═══
            // بلاغ المالك (كريم عبد الحميد): بصمة وجه موثقة (ثقة 100) قُبلت ثم حُكم عليها
            // «مكررة خلال 5 دقائق» من كاش راسب — القاعدة لا تعرف بصمة سابقة — ففُقدت بصمة
            // الدخول بصمت. قبل أي تجاهل بسبب التكرار: يُتحقق من القاعدة نفسها، ولو لا
            // بصمة فعلية داخل النافذة (دفتر الجهاز أو صف حضور) → الكاش راسب، يُمسح،
            // ويُعاد التصنيف بلا lastPunch وتُسجل البصمة (fail-safe نحو التسجيل).
            if (verdict.action === 'ignore' && String(verdict.reason || '').includes('مكررة')) {
                const winStart = new Date(instant - 5 * 60000);
                // النافذة تستثني البصمة نفسها (المدرجة في attendance_logs قبل هذه
                // المعالجة) — وإلّا كان العدّاد ≥1 دائمًا فلم يعمل الأمان قطّ.
                const winEnd = new Date(instant - 1000);
                const dbPunch = (await client.query(
                    `SELECT
                       (SELECT COUNT(*)::int FROM attendance_logs WHERE "employeeId"=$1 AND "attendanceTime" BETWEEN $2 AND $3) AS logs,
                       (SELECT COUNT(*)::int FROM attendance WHERE "employeeId"=$1
                          AND ("checkInAt" BETWEEN $2 AND $3 OR "checkOutAt" BETWEEN $2 AND $3)) AS att`,
                    [employeeId, winStart, winEnd])).rows[0];
                if (!Number(dbPunch.logs) && !Number(dbPunch.att)) {
                    this.lastPunches.delete(employeeId);
                    verdict = classifyPunch({ punchState, wallMin, punchAt: instant.getTime(), hasOpenRow, openRowCheckIn, openRowCheckInAt, openRowShiftDate, currentShiftDate: shiftDate, lastPunch: null });
                    logger.warn('[AttendanceEngine] حرس التكرار اعتمد على ذاكرة راسبة — أُعيد التصنيف وتُسجل البصمة:', employeeId, verdict.action, verdict.reason);
                }
            }

            // كل قرار لا يستند إلى بصمة صريحة يُسجَّل للمراجعة (لمسة واحدة، تعارض
            // اتجاه، انصراف يتيم، حالة مجهولة) — لا يُتخذ صامتًا ولا يُمحى أثره.
            if (verdict.review || verdict.override || verdict.confidence < confidenceThreshold()) {
                await this.logDecision({
                    employeeId, date: shiftDate, decision: verdict.action,
                    confidence: verdict.confidence, reason: verdict.reason,
                    punchState, deviceId: device?.id,
                });
            }

            // علامة مرئية في بطاقة اليوم: جدول attendance_decisions لا شاشة له، فالتعارض
            // يجب أن يُقرأ من السطر نفسه. وسم واحد لكل سطر مهما تكررت البصمات المتعارضة.
            if (verdict.review && openRow) {
                await client.query(
                    `UPDATE attendance SET notes = COALESCE(notes, '') || $2
                      WHERE id = $1 AND COALESCE(notes, '') NOT LIKE '%مراجعة:%'`,
                    [openRow.id, ' | ⚠ مراجعة: ' + verdict.reason]
                );
            }

            // حديد 2026-10-06: المرساة (lastPunches) لا تُحرَّك هنا قبل تنفيذ القرار —
            // كانت تتحرك حتى للبصمات المُتجاهلة وتقبل تسمم الكاش قبل الكتابة، وتُحرَّك
            // بعد COMMIT الناجح فقط (أسفل).

            // ── تنفيذ القرار ──
            let action = null;
            let record = null;

            if (verdict.action === 'ignore') {
                await client.query('COMMIT');
                return { action: 'ignore', record: null, decision: verdict };
            }

            if (verdict.action === 'in' || verdict.action === 'fix_in') {
                const result = await this.handleCheckIn({
                    client, employeeId, shiftDate, wall, instant,
                    shiftStart, shiftKarim, autoLock, verdict, source, device, onLeave,
                });
                action = result.action; record = result.record;
            } else if (verdict.action === 'out' || verdict.action === 'fix_out') {
                const result = await this.handleCheckOut({
                    client, employeeId, shiftDate, wall, instant,
                    shiftStart, shiftKarim, verdict, source, device, onLeave, punchState,
                });
                action = result.action; record = result.record;
            }

            // TASK 9: حدث دومين داخل نفس المعاملة — قبل COMMIT (LAW 6) حتى
            // يُجهض مع البصمة عند الفشل، وfail-open (G1): خلل الصندوق لا يكسر البصمة.
            if (action === 'check_in' || action === 'check_out') {
                try {
                    const { emitDomainEvent } = require('./realtime/producers');
                    await emitDomainEvent(pool, client, 'HR', {
                        eventType: action === 'check_in' ? 'EMPLOYEE_CLOCK_IN' : 'EMPLOYEE_CLOCK_OUT',
                        aggregateType: 'attendance', aggregateId: record?.id ?? `${employeeId}:${shiftDate}`,
                        payload: { employee_id: employeeId, date: shiftDate, time: action === 'check_in' ? record?.checkIn : record?.checkOut, source },
                    });
                } catch (_) { /* fail-open: البصمة أهم من الحدث */ }
            }
            await client.query('COMMIT');

            // حديد 2026-10-06: مرساة حرس التكرار تُثبت بعد نجاح الكتابة فقط، وللقرارات
            // الفعلية (in/out) — البصمة المُتجاهلة لا تحرك المرساة، وفشل الكتابة لا يترك أثرًا
            if (action === 'check_in' || action === 'check_out') {
                this.lastPunches.set(employeeId, { min: wallMin, out: thisOut, at: instant.getTime() });
            }

            if (action && this.io) {
                this.emit('attendance:updated', { action, source, employee: { id: employeeId }, record });
            }

            return { action, record, decision: verdict };

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            // حديد 2026-10-06: فشل الكتابة → الكاش قد يحمل أثرًا لم يصل القاعدة — يُمسح
            // ويعاد ترطيبه من القاعدة في البصمة التالية حتى لا يلتهم حرس التكرار بصمة حقيقية
            this.lastPunches.delete(employeeId);
            logger.error('[AttendanceEngine] processPunch failed:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // معالج الدخول
    // ════════════════════════════════════════════════════════════════════════

    async handleCheckIn({ client, employeeId, shiftDate, wall, instant, shiftStart, shiftKarim, autoLock, verdict: _verdict, source, device, onLeave }) {
        const note = `تسجيل حضور عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`;
        const lateFlag = isLate(wall.hour, wall.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9));

        // البحث عن صف موجود
        const existing = await client.query(
            'SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE',
            [employeeId, shiftDate]
        );

        if (!existing.rows[0]) {
            // لا صف → إنشاء جديد
            const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
            try {
                const record = (await client.query(
                    `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, "checkInAt", source, on_leave)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                    [id, employeeId, shiftDate, wall.time, lateFlag, note, instant, source, onLeave]
                )).rows[0];
                return { action: 'check_in', record };
            } catch (insertErr) {
                // FIX 2026-10-11: catch 23505 (unique constraint uq_attendance_employee_date)
                // — concurrent punch (device + portal) both saw "no row" → second INSERT
                // hit the unique index. Re-select the existing row instead of failing.
                if (insertErr && insertErr.code === '23505') {
                    const raced = (await client.query(
                        'SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2',
                        [employeeId, shiftDate]
                    )).rows[0];
                    if (raced) {
                        // Another punch already created the row — treat as update path
                        existing.rows = [raced];
                    } else {
                        throw insertErr;
                    }
                } else {
                    throw insertErr;
                }
            }
        }

        const row = existing.rows[0];

        // قيمة مستنتَجة + بصمة حقيقية لاحقة → الحقيقي يستبدلها (ما لم يقفل اليوم)
        if (row.checkin_inferred && this.isLockedOut(row, shiftDate, shiftStart, shiftKarim, autoLock)) {
            return { action: null, record: null }; // مقفل
        }

        if (!row.checkIn || row.checkin_inferred) {
            // التحقق: لا دخول بعد انصراف مسجل
            const checkOutAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
            if (checkOutAt && instant > checkOutAt) {
                // انصراف يسبق هذا الدخول ولا دخول في السطر أصلًا = انصراف يتيم من
                // ليلة الأمس لا ختام اليوم؛ رفضه كان يهدر دخول النهار كله (14/10).
                if (row.checkIn) {return { action: null, record: null };}
                const moved = await this.relocateLoneCheckout({ client, employeeId, row, checkOutAt, shiftDate });
                if (!moved) {
                    await client.query(
                        `UPDATE attendance SET "checkOut" = NULL, "checkOutAt" = NULL, "workMinutes" = NULL,
                            checkout_inferred = false,
                            notes = COALESCE(notes, '') || ' | انصراف يتيم بلا صف يُغلقه — أُزيل ليسجّل الدخول (موجود في سجل البصمات)'
                         WHERE id = $1`, [row.id]);
                    row.checkOut = null; row.checkOutAt = null;
                }
            }

            const mins = row.checkOutAt ? Math.max(0, Math.round((new Date(row.checkOutAt) - instant) / 60000)) : null;
            const record = (await client.query(
                `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                    checkin_inferred = false, "workMinutes" = COALESCE($6, "workMinutes"),
                    on_leave = $7,
                    notes = COALESCE(notes, '') || ' | حضور عبر ' || $5
                 WHERE id = $1 RETURNING *`,
                [row.id, wall.time, instant, lateFlag, note, mins, onLeave]
            )).rows[0];
            return { action: 'check_in', record };
        }

        // دخول حقيقي موجود بالفعل → تجاهل
        return { action: null, record: null };
    }

    /**
     * انصراف بلا دخول في سطره ويسبق أول دخول حقيقي له: ليس ختام هذا اليوم بل
     * ختام وردية الأمس. يُنقل إلى سطر الأمس إن كان مفتوحًا أو منصرفًا استنتاجًا؛
     * وإلا يُرجع false فيتولّىcaller مسحه (البصمة تبقى في attendance_logs).
     */
    async relocateLoneCheckout({ client, employeeId, row, checkOutAt, shiftDate }) {
        const prev = (await client.query(
            `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2
              AND NOT COALESCE(on_leave, false) LIMIT 1 FOR UPDATE`,
            [employeeId, prevDay(shiftDate)]
        )).rows[0];
        if (!prev || !prev.checkInAt) {return false;}
        const prevInAt = new Date(prev.checkInAt);
        if (checkOutAt <= prevInAt) {return false;}
        // حارس مدة الجلسة (2026-11-03): انصرافٌ يُنقل لأمس بعد تجاوز السقف ليست
        // وردية الأمس — لا نقل، ويُتولّى مراجعته (إزالة الإقتران الخاطئ).
        if (Math.round((checkOutAt - prevInAt) / 60000) > MAX_SESSION_MIN) {return false;}
        if (prev.checkOut && !prev.checkout_inferred) {return false;} // الأمس مقفول ببصمة حقيقية
        const wall = instantToWall(checkOutAt);
        const minutes = Math.max(0, Math.round((checkOutAt - prevInAt) / 60000));
        await client.query(
            `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3, "workMinutes" = $4, checkout_inferred = false,
                notes = COALESCE(notes, '') || ' | انصراف حقيقي أُعيد من سطر اليوم التالي'
             WHERE id = $1`, [prev.id, wall.time, checkOutAt, minutes]);
        await client.query(
            `UPDATE attendance SET "checkOut" = NULL, "checkOutAt" = NULL, "workMinutes" = NULL, checkout_inferred = false,
                notes = COALESCE(notes, '') || ' | انصراف الفجر أُسند لوردية الأمس'
             WHERE id = $1`, [row.id]);
        return true;
    }

    // ════════════════════════════════════════════════════════════════════════
    // معالج الخروج (الأذكى)
    // ════════════════════════════════════════════════════════════════════════

    async handleCheckOut({ client, employeeId, shiftDate, wall, instant, shiftStart, shiftKarim, verdict: _verdict, source, device, onLeave, punchState }) {
        const note = `تسجيل انصراف عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`;
        const earlyFlag = isEarlyLeave(wall.hour, wall.minute, shiftStart, shiftKarim);

        // قرار المالك 2026-11-03: الأعلام المخزّنة تُحسم من **نفس** دالة الميزانية
        // الواحدة لحظة إغلاق اليوم، لأن لحظة الدخول وحدها لا تعرف إن كان سيخرج مبكرًا.
        // بدونها يبقى late/early_leave بمقياس الطرف الواحد فتختلف الشاشات.
        const settleFlags = async (rec) => {
            if (!rec) {return rec;}
            const d = calculateDelayParts(
                { checkIn: rec.checkIn, checkOut: rec.checkOut },
                { shift_start: shiftStart, shift_karim: shiftKarim }
            );
            const lateNow = d.arrivalLateMinutes > 0;
            const earlyNow = d.earlyLeaveMinutes > 0;
            if (Boolean(rec.late) === lateNow && Boolean(rec.early_leave) === earlyNow) {return rec;}
            return (await client.query(
                'UPDATE attendance SET late = $2, early_leave = $3 WHERE id = $1 RETURNING *',
                [rec.id, lateNow, earlyNow]
            )).rows[0];
        };

        // 1. أحدث صف مفتوح من يوم الوردية أو اليوم السابق (وردية ليلية)
        //    «مفتوح» يستلزم دخولًا: السطر الفارغ لا يُقفل بانصراف، وإلا صار انصراف
        //    الفجر ختامًا ليومٍ لم يبدأ (درس 14/10).
        const open = await client.query(
            `SELECT * FROM attendance
              WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL AND "checkOut" IS NULL
                AND date IN ($2, $3) AND NOT COALESCE(on_leave, false)
              ORDER BY date DESC LIMIT 1 FOR UPDATE`,
            [employeeId, shiftDate, prevDay(shiftDate)]
        );

        if (open.rows[0]) {
            // يوجد صف مفتوح → إغلاقه (مع حارس مدة الجلسة 2026-11-03 — واقعة الصف 1461 د)
            let row = open.rows[0];
            let checkInAt = row.checkInAt ? new Date(row.checkInAt) : null;
            // الانصراف يتجاوز سقف الجلسة عن الدخول؟ الإقتران الحالي خاطئ قطعًا: الجلسة
            // الفعلية تبدأ من أحدث بصمة دخول حقيقية قبل الانصراف — تُعاد تثبيت الدخول
            // عليها قبل الإغلاق. بلا أي بصمة دخول حقيقية بينهما: لا إقتران مفترى —
            // الصف يبقى مفتوحًا للمراجعة (الدليل الخام محفوظ في attendance_logs).
            if (checkInAt && instant > checkInAt && (instant - checkInAt) > MAX_SESSION_MS) {
                const re = await reAnchorFromLogs(client, employeeId, checkInAt, instant);
                if (re) {
                    row = (await client.query(
                        `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                            notes = COALESCE(notes,'') || ' | إعادة تثبيت الدخول على آخر بصمة دخول حقيقية (' || $5 || ') — الدخول المسبوق كان خارج نطاق الجلسة (حارس 2026-11-03)'
                         WHERE id = $1 RETURNING *`,
                        [row.id, re.wall.time, re.instant,
                         isLate(re.wall.hour, re.wall.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9)), re.wall.time]
                    )).rows[0];
                    checkInAt = re.instant;
                } else {
                    await this.logDecision({
                        employeeId, date: shiftDate, decision: 'review', confidence: 0.5,
                        reason: `انصراف بعد ${Math.round((instant - checkInAt) / 60000)} دقيقة من دخول الصف بلا أي بصمة دخول حقيقية بينهما — لا إغلاق صامت (حارس مدة الجلسة 2026-11-03)`,
                        punchState, deviceId: device?.id,
                    });
                    return { action: null, record: null };
                }
            }
            if (!checkInAt || instant > checkInAt) {
                const minutes = checkInAt ? Math.max(0, Math.round((instant - checkInAt) / 60000)) : null;
                const record = (await client.query(
                    `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3,
                        "workMinutes" = COALESCE($4, "workMinutes"), early_leave = $6,
                        on_leave = $7,
                        notes = COALESCE(notes, '') || ' | انصراف عبر ' || $5
                     WHERE id = $1 RETURNING *`,
                    [row.id, wall.time, instant, minutes, note, earlyFlag, onLeave]
                )).rows[0];
                return { action: 'check_out', record: await settleFlags(record) };
            }
            return { action: null, record: null }; // انصراف قبل دخول — تجاهل
        }

        // 2. لا صف مفتوح: هل هناك صف اليوم مكتمل (بخروج مستنتَج)؟
        const inferredRow = await client.query(
            `SELECT * FROM attendance
             WHERE "employeeId" = $1 AND date = $2 AND checkout_inferred = true
             LIMIT 1 FOR UPDATE`,
            [employeeId, shiftDate]
        );

        if (inferredRow.rows[0]) {
            const inf = inferredRow.rows[0];
            if (this.isLockedOut(inf, shiftDate, shiftStart, shiftKarim, true)) {
                return { action: null, record: null }; // مقفل
            }
            let checkInAt = inf.checkInAt ? new Date(inf.checkInAt) : null;
            // حارس مدة الجلسة (2026-11-03) — نفس منطق الخطوة 1
            if (checkInAt && instant > checkInAt && (instant - checkInAt) > MAX_SESSION_MS) {
                const re = await reAnchorFromLogs(client, employeeId, checkInAt, instant);
                if (re) {
                    await client.query(
                        `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                            notes = COALESCE(notes,'') || ' | إعادة تثبيت الدخول على آخر بصمة دخول حقيقية (' || $5 || ') — الدخول المسبوق كان خارج نطاق الجلسة (حارس 2026-11-03)'
                         WHERE id = $1`,
                        [inf.id, re.wall.time, re.instant,
                         isLate(re.wall.hour, re.wall.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9)), re.wall.time]
                    );
                    checkInAt = re.instant;
                } else {
                    await this.logDecision({
                        employeeId, date: shiftDate, decision: 'review', confidence: 0.5,
                        reason: `انصراف بعد ${Math.round((instant - checkInAt) / 60000)} دقيقة من دخول الصف بلا أي بصمة دخول حقيقية بينهما — لا إغلاق صامت (حارس مدة الجلسة 2026-11-03)`,
                        punchState, deviceId: device?.id,
                    });
                    return { action: null, record: null };
                }
            }
            if (!checkInAt || instant > checkInAt) {
                const minutes = checkInAt ? Math.max(0, Math.round((instant - checkInAt) / 60000)) : null;
                const record = (await client.query(
                    `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3,
                        "workMinutes" = COALESCE($4, "workMinutes"), checkout_inferred = false, early_leave = $6,
                        notes = COALESCE(notes, '') || ' | انصراف عبر ' || $5
                     WHERE id = $1 RETURNING *`,
                    [inf.id, wall.time, instant, minutes, note, earlyFlag]
                )).rows[0];
                return { action: 'check_out', record: await settleFlags(record) };
            }
        }

        // 2b. انصراف حقيقي بعد منتصف الليل يُصلح انصراف الأمس المستنتَج ولا يصنع
        //     صفًا بخروج بلا دخول. درس 14/10: بصمة 01:03 كُتبت خروجًا لسطر 14/10
        //     فحُرمت وردية 13/10 من ختامها الحقيقي، وسدّ باب دخول النهار (12:56)
        //     لأن «لا دخول بعد انصراف». النافذة ±6 ساعات من الانصراف المستنتَج.
        const prevInferred = await client.query(
            `SELECT * FROM attendance
             WHERE "employeeId" = $1 AND date = $2 AND checkout_inferred = true AND "checkInAt" IS NOT NULL
             LIMIT 1 FOR UPDATE`,
            [employeeId, prevDay(shiftDate)]
        );
        const pinf = prevInferred.rows[0];
        if (pinf) {
            const infOutAt = pinf.checkOutAt ? new Date(pinf.checkOutAt) : null;
            const pInAt = new Date(pinf.checkInAt);
            const near = infOutAt && Math.abs(instant - infOutAt) <= 6 * 3600000;
            if (instant > pInAt && near) {
                const minutes = Math.max(0, Math.round((instant - pInAt) / 60000));
                const record = (await client.query(
                    `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3, "workMinutes" = $4,
                        checkout_inferred = false, early_leave = $6,
                        notes = COALESCE(notes, '') || ' | انصراف حقيقي حلّ محل المستنتَج عبر ' || $5
                     WHERE id = $1 RETURNING *`,
                    [pinf.id, wall.time, instant, minutes, note, earlyFlag]
                )).rows[0];
                return { action: 'check_out', record: await settleFlags(record) };
            }
        }

        // 3. لا صف مفتوح ولا مستنتَج: تحقق من اليوم مكتمل أصلاً
        const done = await client.query(
            `SELECT id FROM attendance WHERE "employeeId" = $1 AND date = $2 AND "checkOut" IS NOT NULL LIMIT 1`,
            [employeeId, shiftDate]
        );
        if (done.rows[0]) {
            return { action: 'ignore', record: null }; // انصراف مكررة
        }

        // 4. لا صف مفتوح ولا مكتمل: يُكتب الانصراف كما هو، ويُسترد الدخول من بصمة
        //    دخول حقيقية غير مستهلكة في يوم الوردية — لا من بصمة انصراف بالحدس.
        let recoveredCheckIn = null;
        let recoveredCheckInAt = null;
        let recoveredLateFlag = false;
        let recoveredMinutes = null;

        // ابحث عن أقدم بصمة في يوم الوردية (قبل وقت الانصراف)
        const dayStart = new Date(Date.UTC(
            Number(shiftDate.split('-')[0]),
            Number(shiftDate.split('-')[1]) - 1,
            Number(shiftDate.split('-')[2])
        ) - BUSINESS_TZ_OFFSET_MS);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        // FIX 2026-10-13: الـ param كان يُترك untyped، فـ PostgreSQL تُحلّ `$4 - INTERVAL`
        // كـ `interval - interval` (تُقيَّد $4 interval) ثم `timestamptz <= interval` → خطأ
        // يُلقي processPunch بالكامل ويقطع دورة المزامنة، فتبقى البصمات عالقة في
        // attendance_logs ولا تُكتب أبدًا (write-back يجري للسجلات المُدرجة في الدورة نفسها فقط).
        // الحل: نحسب الحدّ في JS ونمرّره لحظة صريحة — لا مجال لالتباس نوع المعامل.
        const cutoffInstant = new Date(instant.getTime() - 2 * 60 * 1000);
        // الدخول المسترد يجب أن يكون بصمة غير مستهلكة: أقدم بصمة في اليوم الميلادي
        // للعامل الليلي هي انصراف أمسه (بصمة 06:14 لمازن 12/10)؛ اعتبارها دخولًا
        // يصنع سطرًا يقرض ختام أمس فيبدأ به، بدقائق تقارب 24 ساعة.
        const earlyPunches = await client.query(
            `SELECT l."attendanceTime", l."punchState" FROM attendance_logs l
              WHERE l."employeeId" = $1 AND l."attendanceTime" >= $2 AND l."attendanceTime" < $3
                AND l."attendanceTime" <= $4
                AND NOT EXISTS (
                    SELECT 1 FROM attendance a
                     WHERE a."employeeId" = l."employeeId"
                       AND (abs(extract(epoch FROM a."checkInAt" - l."attendanceTime")) <= 60
                         OR abs(extract(epoch FROM a."checkOutAt" - l."attendanceTime")) <= 60))
              ORDER BY l."attendanceTime" ASC`,
            [employeeId, dayStart, dayEnd, cutoffInstant]
        );
        // بصمة بحالة «دخول» فقط تُصلح الطرف الناقص: اعتبار أقدم بصمة دخولًا وهي
        // انصرافٌ حدسٌ بالنية لا دليل، فلا يُستخدم إلا بمفتاح الاختلاق الصريح.
        const recoverable = (earlyPunches.rows || []).filter((r) => IN_STATES.has(Number(r.punchState)));
        const candidates = inventionAllowed() ? earlyPunches.rows : recoverable;
        if (candidates.length > 0) {
            const first = candidates[0];
            const firstWall = instantToWall(new Date(first.attendanceTime));
            const minsRaw = Math.max(0, Math.round((instant - new Date(first.attendanceTime).getTime()) / 60000));
            // حارس مدة الجلسة (2026-11-03): دخول مُسترد يتجاوز السقف ليس جلسة —
            // لا يُسترد (السطر يُكتب انصرافًا فقط ويتعلّم للمراجعة).
            if (minsRaw <= MAX_SESSION_MIN) {
                recoveredCheckIn = firstWall.time;
                recoveredCheckInAt = new Date(first.attendanceTime);
                recoveredLateFlag = isLate(firstWall.hour, firstWall.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9));
                recoveredMinutes = minsRaw;
            } else {
                await this.logDecision({
                    employeeId, date: shiftDate, decision: 'review', confidence: 0.5,
                    reason: `بصمة دخول مُستردة (candidate) تبعد ${minsRaw} دقيقة عن الانصراف — تجاوز سقف الجلسة، لا استرداد صامت (حارس 2026-11-03)`,
                    punchState, deviceId: device?.id,
                });
            }
        }

        const delay = calculateDelayDetail({ checkIn: recoveredCheckIn, checkOut: wall.time, shiftStart, shiftKarim });
        // سطر فارغ (لا دخول ولا انصراف) موجود أصلًا لهذا اليوم؟ هو مقصود بالبصمة،
        // وليس صفًا جديدًا — INSERT عليه كان يرمي uq_attendance_employee_date.
        const blank = (await client.query(
            `SELECT * FROM attendance
              WHERE "employeeId" = $1 AND date = $2 AND "checkIn" IS NULL AND "checkOut" IS NULL
              LIMIT 1 FOR UPDATE`,
            [employeeId, shiftDate]
        )).rows[0];
        const noteText = recoveredCheckIn ? `دخول مسترد من سجل البصمات + ${note}` : `⚠ مراجعة: انصراف بلا بصمة دخول — لا دخول مُختلَق (${note})`;
        let record;
        if (blank) {
            record = (await client.query(
                `UPDATE attendance SET "checkIn" = COALESCE($2, "checkIn"), late = $3, "checkInAt" = COALESCE($4, "checkInAt"),
                    "checkOut" = $5, "checkOutAt" = $6, source = $7, early_leave = $8, "workMinutes" = $9, on_leave = $10,
                    notes = COALESCE(notes, '') || ' | ' || $11
                 WHERE id = $1 RETURNING *`,
                [blank.id, recoveredCheckIn, recoveredLateFlag, recoveredCheckInAt,
                 wall.time, instant, source, delay.earlyLeaveMinutes > 0, recoveredMinutes, onLeave, noteText]
            )).rows[0];
        } else {
            const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
            record = (await client.query(
                `INSERT INTO attendance
                    (id, "employeeId", date, "checkIn", late, notes, "checkOut", "checkOutAt", source, early_leave, "workMinutes", "checkInAt", on_leave)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id, employeeId, shiftDate,
                 recoveredCheckIn, recoveredLateFlag, noteText,
                 wall.time, instant, source, delay.earlyLeaveMinutes > 0,
                 recoveredMinutes, recoveredCheckInAt, onLeave]
            )).rows[0];
        }

        // تسجيل قرار للمراجعة
        await this.logDecision({
            employeeId, date: shiftDate, decision: 'check_out_without_in',
            confidence: 0.6, reason: recoveredCheckIn
                ? 'بصمة انصراف بلا صف مفتوح — أُسندت لبصمة دخول غير مستهلكة من سجل البصمات'
                : 'بصمة انصراف بلا صف مفتوح وبلا بصمة دخول — السطر انصراف فقط، للمراجعة',
            punchState, deviceId: device?.id,
        });

        return { action: 'check_out', record };
    }

    // ════════════════════════════════════════════════════════════════════════
    // مصالحة الحضور الذكية (التشغيل الدوري)
    // ════════════════════════════════════════════════════════════════════════

    async reconcileAttendance({ sinceDays = maxReconcileDays() } = {}) {
        if (!smartReconcileEnabled()) {return { fixedLogs: 0, fixedRows: 0 };}

        const mapping = await this.loadEmployeeMapping();
        const matchNow = (d) => matchUserToEmployee(d, mapping.byDeviceId, mapping.byEmployeeNo).employeeId;
        let fixedLogs = 0, fixedRows = 0;

        // 1. ربط السجلات اليتيمة
        const nullLogs = (await pool.query(
            `SELECT id, "deviceUserId" FROM attendance_logs WHERE "employeeId" IS NULL LIMIT 5000`
        )).rows;
        for (const l of nullLogs) {
            const eid = matchNow(String(l.deviceUserId));
            if (eid) {
                await pool.query('UPDATE attendance_logs SET "employeeId" = $2 WHERE id = $1 AND "employeeId" IS NULL', [l.id, eid]);
                fixedLogs++;
            }
        }

        // 2. معالجة الأيام المغلقة
        const nowMs = Date.now();
        const riyadhNow = new Date(nowMs + BUSINESS_TZ_OFFSET_MS);
        const p2 = (n) => String(n).padStart(2, '0');
        const todayStr = `${riyadhNow.getUTCFullYear()}-${p2(riyadhNow.getUTCMonth() + 1)}-${p2(riyadhNow.getUTCDate())}`;
        const sinceD = new Date(Date.UTC(riyadhNow.getUTCFullYear(), riyadhNow.getUTCMonth(), riyadhNow.getUTCDate()) - sinceDays * 86400000);
        const sinceStr = `${sinceD.getUTCFullYear()}-${p2(sinceD.getUTCMonth() + 1)}-${p2(sinceD.getUTCDate())}`;

        const rows = (await pool.query(
            `SELECT * FROM attendance WHERE date >= $1 AND date <= $2 ORDER BY "employeeId", date`,
            [sinceStr, todayStr]
        )).rows;

        const byEmp = new Map();
        for (const r of rows) {
            if (!byEmp.has(r.employeeId)) {byEmp.set(r.employeeId, []);}
            byEmp.get(r.employeeId).push(r);
        }

        for (const [empId, empRows] of byEmp.entries()) {
            const shift = mapping.byId.get(empId) || { shiftStart: '09:00', shiftKarim: 10, autoCheckout: false, autoLock: false };
            const sStart = shift.shiftStart;
            const sHours = shift.shiftKarim;

            const logs = (await pool.query(
                `SELECT "deviceUserId", "attendanceTime", "punchState" FROM attendance_logs
                  WHERE "employeeId" = $1 AND "attendanceTime" >= ($2::date - INTERVAL '2 days')::timestamptz
                  ORDER BY "attendanceTime"`,
                [empId, sinceStr]
            )).rows.map(l => ({ ...l, wall: instantToWall(new Date(l.attendanceTime)) }));

            // الحرس لا يُبنى من سطور النافذة (درس 2026-10-15): بمحاكاة نافذة 3 أيام عاد
            // انصراف مازن «06:14» فصار دخولًا لسطر 12/10 = 1375 دقيقة وهمية، لأن سطر 11/10
            // لم يكن ضمن empRows المحمّلة. الادّعاءات تُقرأ من الجدول كله لنفس الموظف.
            const claimsRaw = (await pool.query(
                `SELECT id, "checkInAt" AS ci, "checkOutAt" AS co FROM attendance
                  WHERE "employeeId" = $1 AND ("checkInAt" IS NOT NULL OR "checkOutAt" IS NOT NULL)`,
                [empId]
            )).rows;
            const claims = [];
            for (const c of claimsRaw) {
                if (c.ci) {claims.push({ id: c.id, t: new Date(c.ci).getTime() });}
                if (c.co) {claims.push({ id: c.id, t: new Date(c.co).getTime() });}
            }

            const logsOf = (day) => logs.filter(l => shiftDateForEmployee(l.wall.date, l.wall.hour, { shift_start: sStart, shift_karim: sHours }) === day);

            for (const row of empRows) {
                const isToday = row.date === todayStr;
                const dayLogs = logsOf(row.date);
                const ins = dayLogs.filter(l => IN_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
                const outs = dayLogs.filter(l => OUT_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
                // حرس الاستخدام المزدوج (درس 2026-10-14): بصمة يستعملها سطر آخر بالفعل
                // (خلال 60 ثانية) لا تُستَرد «دخولًا» لهذا السطر — وإلا أعادت المطابقة تصنيع
                // الاستخدام المزدوج بعد كل ترميم (انصراف الأمس صار دخول اليوم → وردية 23 ساعة).
                // وكذلك بصمة خروج السطر نفسه: اقترانها بدخوله ينتج يومًا بصفر دقيقة
                // (سطر 12/10 لمازن: البصمة بحالة «دخول» على الجهاز فمرّت من فلتر الحالات).
                // مسار الانصراف لا يُمنع: علاجه نقل الختام لوردية أمسه، لا منع الدليل.
                const consumedElsewhere = (l) => {
                    const t = new Date(l.attendanceTime).getTime();
                    if (row.checkOutAt && Math.abs(t - new Date(row.checkOutAt).getTime()) <= 60000) {return true;}
                    return claims.some((c) => c.id !== row.id && Math.abs(c.t - t) <= 60000);
                };
                const freeIns = ins.filter((l) => !consumedElsewhere(l));
                const freeDayLogs = dayLogs.filter((l) => !consumedElsewhere(l));

                // ── أ0: زوج معكوس (الانصراف لحظيًا قبل الدخول — غالبًا بصمة ليلية نُسبت خطأ):
                // اقلب الدخول/الخروج وأعد الحساب (أيام مغلقة فقط).
                if (!isToday && row.checkIn && row.checkOut && row.checkInAt && row.checkOutAt) {
                    const ciAt0 = new Date(row.checkInAt).getTime();
                    const coAt0 = new Date(row.checkOutAt).getTime();
                    if (Number.isFinite(ciAt0) && Number.isFinite(coAt0) && coAt0 < ciAt0) {
                        const d = calculateDelayDetail({ checkIn: row.checkOut, checkOut: row.checkIn, shiftStart: sStart, shiftKarim: sHours });
                        const fixedMins = Math.max(0, Math.round((ciAt0 - coAt0) / 60000));
                        await pool.query(
                            `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, "checkOut" = $4, "checkOutAt" = $5,
                                late = $6, early_leave = $7, "workMinutes" = $8,
                                checkin_inferred = false, checkout_inferred = false,
                                notes = COALESCE(notes, '') || ' | إصلاح عكس الدخول/الخروج (انصراف قبل دخول)'
                             WHERE id = $1`,
                            [row.id, row.checkOut, new Date(row.checkOutAt), row.checkIn, new Date(row.checkInAt),
                             d.arrivalLateMinutes > 0, d.earlyLeaveMinutes > 0, fixedMins]);
                        fixedRows++;
                        continue;
                    }
                }

                // ── أ: دخول مفقود (يوجد خروج، لا دخول، يوم مغلق) ──
                if (!row.checkIn && row.checkOut && !isToday) {
                    if (freeIns.length) {
                        const f = freeIns[0];
                        const late = isLate(f.wall.hour, f.wall.minute, sStart, Number(process.env.WORK_START_HOUR || 9));
                        const mins = row.checkInAt ? Math.max(0, Math.round((new Date(row.checkOutAt) - new Date(f.attendanceTime)) / 60000))
                            : minutesBetween(f.wall.time, row.checkOut, row.date);
                        // حارس مدة الجلسة (2026-11-03): دخول مُسترد يتجاوز السقف
                        // ليس جلسة — لا استرداد صامت، الصف يُعلَّم للمراجعة.
                        if (mins > MAX_SESSION_MIN) {
                            await this.logDecision({ employeeId: empId, date: row.date, decision: 'review',
                                confidence: 0.5,
                                reason: `مطابقة: دخول مُسترد تبعد ${mins} دقيقة عن الانصراف المسجّل — تجاوز سقف الجلسة، لا استرداد صامت (حارس 2026-11-03)` });
                        } else {
                            await pool.query(
                                `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                                    "workMinutes" = COALESCE($5, "workMinutes"), checkin_inferred = false,
                                    notes = COALESCE(notes, '') || ' | دخول مسترد من سجل البصمات'
                                 WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), late, mins]);
                            fixedRows++;
                        }
                    } else if (inventionAllowed() && freeDayLogs.length) {
                        // لا بصمة دخول صريحة (كل البصمات بحالة خروج): إسناد أقدم بصمة
                        // انصرافٍ كدخولٍ حدسٌ بالنية — لا يجري إلا بمفتاح الاختلاق.
                        const ordered = [...freeDayLogs].sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
                        const coAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
                        const f = ordered.find(o => !coAt || new Date(o.attendanceTime).getTime() < coAt.getTime());
                        if (!f) {
                            continue;
                        }
                        const late = isLate(f.wall.hour, f.wall.minute, sStart, Number(process.env.WORK_START_HOUR || 9));
                        const mins = coAt ? Math.max(0, Math.round((coAt - new Date(f.attendanceTime)) / 60000))
                            : minutesBetween(f.wall.time, row.checkOut, row.date);
                        // حارس مدة الجلسة: نفس القاعدة أعلاه
                        if (mins > MAX_SESSION_MIN) {
                            await this.logDecision({ employeeId: empId, date: row.date, decision: 'review',
                                confidence: 0.5,
                                reason: `مطابقة: اختلاق دخول يبعد ${mins} دقيقة عن الانصراف المسجّل — تجاوز سقف الجلسة، لا اختلاق صامت (حارس 2026-11-03)` });
                        } else {
                            await pool.query(
                                `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                                    "workMinutes" = COALESCE($5, "workMinutes"), checkin_inferred = false,
                                    notes = COALESCE(notes, '') || ' | دخول مسترد من أقدم بصمة (حالة الجهاز خروج)'
                                 WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), late, mins]);
                            fixedRows++;
                        }
                    } else if (autoCompleteEnabled() && shift.autoCheckout) {
                        // استكمال تلقائي بموافقة المدير فقط
                        const [sy, smo, sd] = row.date.split('-').map(Number);
                        const [sh, sm] = String(sStart).split(':').map(Number);
                        const startInstant = new Date(Date.UTC(sy, smo - 1, sd, sh || 0, sm || 0) - BUSINESS_TZ_OFFSET_MS);
                        const mins = minutesBetween(sStart, row.checkOut, row.date);
                        await pool.query(
                            `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $4, late = false,
                                "workMinutes" = COALESCE($3, "workMinutes"), checkin_inferred = true,
                                notes = COALESCE(notes, '') || ' | استكمال تلقائي: نسيان بصمة الدخول'
                             WHERE id = $1`, [row.id, sStart, mins, startInstant]);
                        fixedRows++;
                    }
                }

                // ── ب: خروج مفقود (يوجد دخول، لا خروج) ──
                // يُقبل خروج حقيقي (حالة خروج) بعد الدخول فقط — بصمة دخول لاحقة
                // لا تُخترع انصرافًا (كانت تُنتج تبكيرًا وهميًا). الصف يبقى مفتوحًا.
                else if (row.checkIn && !row.checkOut) {
                    const afterIn = outs.filter(o => !row.checkInAt || new Date(o.attendanceTime) > new Date(row.checkInAt));
                    if (afterIn.length) {
                        const f = afterIn[afterIn.length - 1];
                        const mins = row.checkInAt ? Math.max(0, Math.round((new Date(f.attendanceTime) - new Date(row.checkInAt)) / 60000))
                            : minutesBetween(row.checkIn, f.wall.time, row.date);
                        const wrongBtn = !OUT_STATES.has(Number(f.punchState));
                        // حارسا الجلسة (2026-11-03): خروج على بعد دقائق من الدخول =
                        // نفس اللمسة (لا خروج مقدَّراً لكل يوم)، وخروج يتجاوز السقف =
                        // إقتران خاطئ. كلاهما لا يُكتب صامتًا — للمراجعة.
                        const samePress = row.checkInAt != null
                            && (new Date(f.attendanceTime).getTime() - new Date(row.checkInAt).getTime()) < SAME_PRESS_MS;
                        if (mins > MAX_SESSION_MIN) {
                            await this.logDecision({ employeeId: empId, date: row.date, decision: 'review',
                                confidence: 0.5,
                                reason: `مطابقة: خروج مُسترد تبعد ${mins} دقيقة عن الدخول — تجاوز سقف الجلسة، لا إقتران صامت (حارس 2026-11-03)` });
                        } else if (samePress) {
                            await this.logDecision({ employeeId: empId, date: row.date, decision: 'review',
                                confidence: 0.5,
                                reason: 'مطابقة: خروج خلال 5 دقائق من الدخول — نفس اللمسة، لا يُقفل به الصف (حارس 2026-11-03)' });
                        } else {
                            await pool.query(
                                `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3,
                                    "workMinutes" = COALESCE($4, "workMinutes"), checkout_inferred = false,
                                    notes = COALESCE(notes, '') || ' | خروج مسترد من سجل البصمات' || $5
                                 WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), mins, wrongBtn ? ' (زر خاطئ)' : '']);
                            fixedRows++;
                        }
                    } else if (autoCompleteEnabled() && shift.autoCheckout && nowMs > endInstantOf(row.date, sStart, sHours)) {
                        const endT = expectedEndTime(sStart, sHours);
                        const mins = row.checkIn ? minutesBetween(row.checkIn, endT, row.date) : Math.round(sHours * 60);
                        const [ey, emo, ed] = row.date.split('-').map(Number);
                        const [eh, em] = String(endT).split(':').map(Number);
                        let endAt = new Date(Date.UTC(ey, emo - 1, ed, eh || 0, em || 0) - BUSINESS_TZ_OFFSET_MS);
                        if (row.checkIn) {
                            const [ih, im] = String(row.checkIn).split(':').map(Number);
                            const inMs = Date.UTC(ey, emo - 1, ed, ih || 0, im || 0) - BUSINESS_TZ_OFFSET_MS;
                            if (endAt <= inMs) { endAt = new Date(endAt.getTime() + 24 * 3600000); }
                        }
                        await pool.query(
                            `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $4,
                                "workMinutes" = COALESCE($3, "workMinutes"), checkout_inferred = true,
                                notes = COALESCE(notes, '') || ' | استكمال تلقائي: نسيان بصمة الخروج'
                             WHERE id = $1`, [row.id, endT, mins, endAt]);
                        fixedRows++;
                    }
                }

                // ── ج: ترقية المستنتَج القديم ← بصمة حقيقية ──
                else if ((row.checkin_inferred || row.checkout_inferred) && !isToday) {
                    const locked = shift.autoLock === true && row.checkout_inferred
                        && nowMs > endInstantOf(row.date, sStart, sHours) + lockGraceMinutes() * 60000;
                    if (!locked) {
                        let changed = false;
                        let ci = row.checkIn, ciAt = row.checkInAt ? new Date(row.checkInAt) : null;
                        let co = row.checkOut, coAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
                        let ciInf = !!row.checkin_inferred, coInf = !!row.checkout_inferred;

                        if (row.checkin_inferred && freeIns.length) {
                            const f = freeIns[0];
                            if (!coAt || new Date(f.attendanceTime) <= coAt) {
                                ci = f.wall.time; ciAt = new Date(f.attendanceTime); ciInf = false; changed = true;
                            }
                        }
                        if (row.checkout_inferred) {
                            const afterIn = outs.filter(o => !ciAt || new Date(o.attendanceTime) > ciAt);
                            if (afterIn.length) {
                                const f = afterIn[afterIn.length - 1];
                                co = f.wall.time; coAt = new Date(f.attendanceTime); coInf = false; changed = true;
                            }
                        }
                        if (changed) {
                            const mins = (ciAt && coAt) ? Math.max(0, Math.round((coAt - ciAt) / 60000))
                                : (ci && co ? minutesBetween(ci, co, row.date) : row.workMinutes);
                            // حارس مدة الجلسة (2026-11-03): الترقية التي تصنع جلسة
                            // فوق السقف ليست ترقية — الإقتران الأصلي خاطئ. لا كتابة
                            // صامتة، للمراجعة (هذا ميلاد سلاسل الـ1440 د التاريخية).
                            if (mins != null && mins > MAX_SESSION_MIN) {
                                await this.logDecision({ employeeId: empId, date: row.date, decision: 'review',
                                    confidence: 0.5,
                                    reason: `مطابقة: ترقية لحقّي تصنع جلسة ${mins} دقيقة — تجاوز سقف الجلسة، لا ترقية صامتة (حارس 2026-11-03)` });
                                continue;
                            }
                            const late = ci && ciAt
                                ? isLate((ciAt.getUTCHours() + 3) % 24, ciAt.getUTCMinutes(), sStart, Number(process.env.WORK_START_HOUR || 9))
                                : row.late;
                            await pool.query(
                                `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                                    "checkOut" = $5, "checkOutAt" = $6, "workMinutes" = COALESCE($7, "workMinutes"),
                                    checkin_inferred = $8, checkout_inferred = $9,
                                    notes = COALESCE(notes, '') || ' | ترقية لحقيقي: بصمة لاحقة'
                                 WHERE id = $1`,
                                [row.id, ci, ciAt, late, co, coAt, mins, ciInf, coInf]);
                            fixedRows++;
                        }
                    }
                }

                // ── د: دقائق ناقصة مع وجود الطرفين ──
                else if (row.checkIn && row.checkOut && row.workMinutes == null) {
                    const mins = (row.checkInAt && row.checkOutAt)
                        ? Math.max(0, Math.round((new Date(row.checkOutAt) - new Date(row.checkInAt)) / 60000))
                        : minutesBetween(row.checkIn, row.checkOut, row.date);
                    await pool.query(`UPDATE attendance SET "workMinutes" = $2 WHERE id = $1`, [row.id, mins]);
                    fixedRows++;
                }
            }
        }

        if (fixedLogs || fixedRows) {
            logger.info(`[AttendanceEngine] Reconcile: linked ${fixedLogs} logs, fixed ${fixedRows} rows`);
        }
        return { fixedLogs, fixedRows };
    }

    // ════════════════════════════════════════════════════════════════════════
    // دوال مساعدة داخلية
    // ════════════════════════════════════════════════════════════════════════

    isLockedOut(row, shiftDate, shiftStart, shiftKarim, autoLock) {
        if (!autoLock || !row) {return false;}
        if (!row.checkout_inferred && !row.checkin_inferred) {return false;}
        return Date.now() > endInstantOf(shiftDate, shiftStart, shiftKarim) + lockGraceMinutes() * 60000;
    }

    async loadEmployeeMapping() {
        const { rows } = await pool.query(
            'SELECT id, name, "deviceUserId", "deviceUserIdAlt", "employeeId", shift_start, shift_karim, auto_checkout, auto_lock FROM employees'
        );
        const byDeviceId = new Map();
        const byEmployeeNo = new Map();
        const byId = new Map();
        for (const row of rows) {
            const duid = row.deviceUserId != null ? String(row.deviceUserId).trim() : '';
            if (duid) {byDeviceId.set(duid, row.id);}
            // المعرف البديل (uid مقابل userId في أجهزة ZKTeco — يمنع ضياع البصمات نهائيًا)
            const alt = row.deviceUserIdAlt != null ? String(row.deviceUserIdAlt).trim() : '';
            if (alt && !byDeviceId.has(alt)) {byDeviceId.set(alt, row.id);}
            const empNo = row.employeeId != null ? String(row.employeeId).trim() : '';
            if (empNo) {byEmployeeNo.set(empNo, row.id);}
            byId.set(row.id, {
                shiftStart: normalizeShiftStart(row.shift_start),
                shiftKarim: normalizeShiftKarim(row.shift_karim),
                autoCheckout: row.auto_checkout === true,
                autoLock: row.auto_lock === true,
            });
        }
        return { byDeviceId, byEmployeeNo, byId, employees: rows };
    }

    /** إغلاق النسيان المجدول (طلب المالك 2026-10-10): صف مفتوح تجاوز الوردية + ساعتين
     *  يُقفل تلقائيًا حتى بلا بصمة جديدة. وقت الخروج = مدة الموظف المعتادة (نمطه
     *  الشخصي) عند توفرها ضمن ±ساعتين من الوردية، وإلا نهاية الوردية. موسوم
     *  checkout_inferred وقابل للتراجع من شاشة الحضور. */
    async closeStaleOpenRows({ graceHours = 2, minSamples = 3 } = {}) {
        /* المالك 2026-11-02: لا تُختلق بصمةُ انصرافٍ من مدة الوردية. واقعةُ
           EMP-052 (1–2/11) هي الدليل: انصرافٌ مختلَق الساعة 05:17 ابتلع
           انصرافه الحقيقي فجرًا وحوّل دخوله المسائي إلى «انصراف 416 د».
           البديل: السطر يبقى مفتوحًا ويظهر «بلا بصمة خروج» في كشف البصمات. */
        if (!inventionAllowed()) {return { closed: 0, skipped: 'invention-disabled', details: [] };}
        const now = new Date();
        const open = (await pool.query(
            `SELECT a.id, a."employeeId", a."checkInAt", a.date FROM attendance a
              WHERE a."checkOut" IS NULL AND a."checkInAt" IS NOT NULL
              AND a."checkInAt" < NOW() - INTERVAL '1 hour' LIMIT 200`
        )).rows;
        if (!open.length) {return { closed: 0, details: [] };}
        const mapping = await this.loadEmployeeMapping();
        let closed = 0;
        const details = [];
        for (const row of open) {
            const meta = mapping.byId.get(row.employeeId) ?? mapping.byId.get(String(row.employeeId));
            const karim = Number(meta?.shiftKarim) > 0 ? Number(meta.shiftKarim) : 10;
            const inAt = new Date(row.checkInAt);
            if (!Number.isFinite(inAt.getTime())) {continue;}
            if ((now - inAt) / 3600000 <= karim + graceHours) {continue;}
            let outAt = new Date(inAt.getTime() + Math.round(karim * 3600000));
            let source = 'shift';
            try {
                const pat = await this.loadPattern(row.employeeId);
                const mIn = Number(pat?.medianIn), mOut = Number(pat?.medianOut), n = Number(pat?.samples ?? 0);
                if (Number.isFinite(mIn) && Number.isFinite(mOut) && n >= minSamples) {
                    let durMin = (mOut - mIn) % 1440;
                    if (durMin <= 0) {durMin += 1440;}
                    if (durMin >= karim * 60 - 120 && durMin <= karim * 60 + 120) {
                        outAt = new Date(inAt.getTime() + Math.round(durMin * 60000));
                        source = `pattern:${Math.round(durMin)}m`;
                    }
                }
            } catch (_) {}
            if (outAt > now) {continue;}
            const wallOut = instantToWall(outAt);
            const r = await pool.query(
                `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3, "workMinutes" = $4,
                    checkout_inferred = true,
                    notes = COALESCE(notes,'') || $5 WHERE id = $1 AND "checkOut" IS NULL`,
                [row.id, wallOut.time, outAt, Math.round(karim * 60),
                    ` | انصراف مستنتج تلقائيًا (${source}) — نسيان بصمة الخروج`]
            );
            if ((r.rowCount || 0) > 0) {
                closed++;
                details.push({ id: row.id, employeeId: row.employeeId, date: row.date, out: wallOut.time, source });
            }
        }
        if (closed) {logger.warn('[AttendanceEngine] إغلاق نسيان تلقائي:', closed, details.slice(0, 5));}
        return { closed, details };
    }

    async logDecision({ employeeId, date, decision, confidence, reason, punchState, deviceId }) {
        try {
            await pool.query(
                `INSERT INTO attendance_decisions (id, "employeeId", date, decision, confidence, reason, punch_state, device_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [Date.now() * 1000 + Math.floor(Math.random() * 999), employeeId, date, decision, confidence, reason, punchState, deviceId || null]
            );
        } catch (e) { logger.warn('[AttendanceEngine] Failed to log decision:', e.message); }
    }
}

// ════════════════════════════════════════════════════════════════════════
// دوال مساعدة للتوافق مع الكود القديم
// ════════════════════════════════════════════════════════════════════════

/** مطابقة رقم جهاز بموظف (مصدّر من engine.js الأصلي) */
function matchUserToEmployee(deviceUserId, byDeviceId, byEmployeeNo) {
    const key = String(deviceUserId).trim();
    let hit = byDeviceId.get(key);
    if (hit != null) {return { employeeId: hit, via: 'device_user_id' };}
    hit = byEmployeeNo.get(key);
    if (hit != null) {return { employeeId: hit, via: 'employee_number' };}
    // ═══ حارس الأصفار البادئة (2026-11-03) ═══
    // كان المقارن الرقمي يُسقط الأصفار: «059» تطابق «59» و«091» تطابق «91».
    // والنتيجة موثقة في karim_erp: كاميرا كريم (EMP-059) ترسل 59، و«59» نفسها
    // رقم بصمة EMP-058 على جهاز آخر (927 بصمة) — فكان أي إرسال مُصفّر يسرق
    // بصمات موظف آخر بلا إشعار. المطابقة الرقمية الآن لا تعبر صيغة مختلفة
    // للأصفار البادئة؛ إن اختلفت الصيغة فلا مطابقة (الغياب أأمن من الانتحال).
    const asNum = Number(key);
    const noPad = (s) => /^[1-9]\d*$/.test(s);
    if (Number.isFinite(asNum) && noPad(key)) {
        for (const [candidate, employeeId] of byEmployeeNo.entries()) {
            if (noPad(candidate) && Number(candidate) === asNum) {
                return { employeeId, via: 'employee_number_numeric' };
            }
        }
        for (const [candidate, employeeId] of byDeviceId.entries()) {
            if (noPad(candidate) && Number(candidate) === asNum) {
                return { employeeId, via: 'device_user_id_numeric' };
            }
        }
    }
    return { employeeId: null, via: null };
}

const engine = new AttendanceEngine();

module.exports = {
    AttendanceEngine,
    engine,
    calculateDelayDetail,
    calculateTotalLateMinutes,
    classifyPunch,
    lastPunchFromRow,
    learnPattern,
    matchUserToEmployee,
    autoCompleteEnabled,
    inventionAllowed,
    smartReconcileEnabled,
    delayEngineEnabled,
    maxReconcileDays,
    graceMinutes,
    lockGraceMinutes,
    isLate,
    isEarlyLeave,
    shiftDateFor,
    shiftDateForEmployee,
    prevDay,
    loadShiftHistoryMap,
    resolveShiftAt,
    endInstantOf,
    minutesBetween,
    instantToWall,
    BUSINESS_TZ_OFFSET_MS,
    IN_STATES,
    OUT_STATES,
};