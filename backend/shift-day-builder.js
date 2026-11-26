/**
 * shift-day-builder.js — بناء يوم الوردية من بصمات الموظف (دالة نقية بلا قاعدة بيانات)
 * ═══════════════════════════════════════════════════════════════════════════
 * قرار المالك 2026-11-07: «الموظف يبصم من بداية ورديته لنهايتها، لو كمّل
 * الساعات (10 أو 12) يبقى في الموعد». وهذه الوحدة تحمي البساطة بثلاث قواعد:
 *
 *   R1 — التكرار: أول بصمة دخول وآخرها انصراف، وما بينهما للعرض فقط.
 *        بصمتان خلال نافذة التكرار = ضغطة مكررة تُهمَل، ويبقى اليوم بحكم
 *        «بصمة واحدة» حتى تأتي بصمة خروجٍ حقيقية. ولا تتحول بصمةٌ واحدة
 *        أبدًا إلى دخول وانصراف في اللحظة نفسها.
 *   R2 — المصدر: كل بصمة تحمل مصدرًا معروفًا وهوية جهاز (deviceId)، وإلا
 *        رُفضت قبل أي كتابة. البصمة اليدوية تُستبدل بهوية المستخدم + السبب
 *        + الاعتماد. لا مصدر ضمني ولا default صامت.
 *   R3 — الوردية الليلية: البصمة تُنسب لبداية الوردية لا لتاريخ التقويم؛
 *        23:45 من اليوم الأول و00:15 من اليوم الثاني وردية واحدة لبطاقة
 *        14:00+10h أو 20:00+12h. لا ورديتان من بصمتين.
 *
 * المبدأ الحاكم: «لو النظام مش متأكد → يسأل، مش يخمن». لذلك كل حالة ناقصة
 * أو غامضة تُعلَّم `needsReview` ولا تدخل الإجماليات.
 */

'use strict';

/** المصادر المعتمدة للبصمة — ثلاثة لا غير. */
const PUNCH_SOURCES = Object.freeze(['device', 'portal', 'manual']);

/** التكرار = نفس الثانية (جهاز + كاميرا، أو إعادة مزامنة) — لا نافذة تبتلع بصمة حقيقية. */
const DEFAULT_DUPLICATE_WINDOW_MINUTES = 0;

/** أقل مدة تُعدّ وردية حقيقية؛ ما دونها يُعلَّم للمراجعة لا يُحكم عليه. */
const DEFAULT_MIN_REAL_SHIFT_MINUTES = 60;

/** نافذة قبول بصمة قبل بداية الوردية وبعد نهايتها (لنسبتها ليومها). */
const DEFAULT_EARLY_WINDOW_MINUTES = 180;
const DEFAULT_CLOSE_WINDOW_MINUTES = 90;

/** إزاحة الرياض الثابتة (UTC+3) — نفس إزاحة المحرك، بلا تغيير موسمي. */
const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad2(n) { return String(n).padStart(2, '0'); }

function minutesOfTime(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) { return null; }
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) { return null; }
    return h * 60 + mi;
}

function addDays(dateStr, delta) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + delta * 24 * 3600 * 1000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** لحظة مطلقة → { date, time, hour, minute } بتوقيت الرياض. */
function wallOf(instant) {
    const shifted = new Date(new Date(instant).getTime() + BUSINESS_TZ_OFFSET_MS);
    const hour = shifted.getUTCHours();
    const minute = shifted.getUTCMinutes();
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour,
        minute,
        date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
        time: `${pad2(hour)}:${pad2(minute)}`,
    };
}

/**
 * يوم الوردية لبصمة: النافذة تبدأ من بداية الوردية نفسها لا من منتصف الليل.
 *
 * @param {{date:string, hour:number, minute:number, time?:string}} wall
 * @param {string} shiftStart HH:MM
 * @param {number} shiftKarim ساعات الوردية (10 أو 12 …)
 * @param {{earlyWindowMinutes?:number, closeWindowMinutes?:number}} [opts]
 * @returns {{date:string, confident:boolean, reason:string}}
 */
function shiftDayForPunch(wall, shiftStart, shiftKarim, opts = {}) {
    const early = opts.earlyWindowMinutes ?? DEFAULT_EARLY_WINDOW_MINUTES;
    const close = opts.closeWindowMinutes ?? DEFAULT_CLOSE_WINDOW_MINUTES;
    const startMin = minutesOfTime(shiftStart) ?? 9 * 60;
    const duration = Math.round((Number(shiftKarim) > 0 ? Number(shiftKarim) : 10) * 60);
    const wallMin = Number(wall.hour) * 60 + Number(wall.minute);
    const date = String(wall.date);

    const candidates = [];
    for (const offset of [0, -1]) {
        const startAbs = offset * 1440 + startMin;
        const endAbs = startAbs + duration;
        if (wallMin >= startAbs - early && wallMin <= endAbs + close) {
            candidates.push({ date: addDays(date, offset), startAbs });
        }
    }
    if (candidates.length === 1) {
        return { date: candidates[0].date, confident: true, reason: 'inside_shift_window' };
    }
    if (candidates.length > 1) {
        // نظريًا لا تتقاطع نافذتان لوردية 9/10/12 ساعة؛ لو وقع ذلك فالأحدث بدايةً
        // أرجح، لكن اليقين يسقط فنطلب المراجعة.
        const begun = candidates.filter((c) => c.startAbs <= wallMin)
            .sort((a, b) => b.startAbs - a.startAbs);
        return {
            date: (begun[0] || candidates[0]).date,
            confident: false,
            reason: 'ambiguous_shift_window',
        };
    }
    // خارج النافذة: تبقى على تاريخها الميلادي بلا يقين — البصمة لا تُرفض،
    // والحكم عليها يُعلَّم للمراجعة بدل نسبةٍ مُخمَّنة.
    return {
        date,
        confident: false,
        reason: 'outside_shift_window',
    };
}

/**
 * تحقق من هوية البصمة قبل أي كتابة.
 * - device/portal: مصدر معروف + deviceId.
 * - manual: هوية المستخدم + سبب مكتوب + اعتماد صريح (الجهاز غير مطلوب).
 *
 * @param {{source?:string, deviceId?:*, device?:{id?:*, deviceId?:*},
 *          userId?:*, reason?:string, approved?:boolean}} punch
 * @returns {{ok:true}|{ok:false, code:string, message:string}}
 */
function validatePunch(punch = {}) {
    const source = String(punch.source || '').trim().toLowerCase();
    if (!PUNCH_SOURCES.includes(source)) {
        return {
            ok: false,
            code: 'PUNCH_SOURCE_REQUIRED',
            message: 'البصمة بلا مصدر معتمد (device / portal / manual) مرفوضة',
        };
    }
    if (source === 'manual') {
        if (punch.userId == null || punch.userId === '') {
            return {
                ok: false,
                code: 'MANUAL_PUNCH_USER_REQUIRED',
                message: 'البصمة اليدوية مرفوضة بلا هوية مستخدم',
            };
        }
        if (!String(punch.reason || '').trim()) {
            return {
                ok: false,
                code: 'MANUAL_PUNCH_REASON_REQUIRED',
                message: 'البصمة اليدوية مرفوضة بلا سبب مكتوب',
            };
        }
        if (punch.approved !== true) {
            return {
                ok: false,
                code: 'MANUAL_PUNCH_APPROVAL_REQUIRED',
                message: 'البصمة اليدوية مرفوضة بلا اعتماد صريح',
            };
        }
        return { ok: true };
    }
    const deviceId = punch.deviceId != null && punch.deviceId !== ''
        ? punch.deviceId
        : (punch.device && (punch.device.id ?? punch.device.deviceId));
    if (deviceId == null || deviceId === '') {
        return {
            ok: false,
            code: 'PUNCH_DEVICE_REQUIRED',
            message: 'البصمة بلا هوية جهاز (deviceId) مرفوضة',
        };
    }
    return { ok: true };
}

function punchInstant(punch) {
    const raw = punch && (punch.at ?? punch.instant);
    if (raw == null) { return null; }
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * يبني يوم وردية واحدًا من بصماته.
 *
 * @param {{shiftDate?:string, shiftStart?:string, shiftKarim?:number, punches?:Array,
 *          duplicateWindowMinutes?:number, minRealMinutes?:number}} input
 * @returns {object} اليوم مبنيًا + الحالة + سبب المراجعة إن وُجد
 */
function buildShiftDay(input = {}) {
    const {
        shiftStart = '09:00',
        shiftKarim = 10,
        duplicateWindowMinutes = DEFAULT_DUPLICATE_WINDOW_MINUTES,
        minRealMinutes = DEFAULT_MIN_REAL_SHIFT_MINUTES,
    } = input;
    const punches = Array.isArray(input.punches) ? input.punches : [];
    const requiredMinutes = Math.round((Number(shiftKarim) > 0 ? Number(shiftKarim) : 10) * 60);

    const invalid = [];
    const valid = [];
    const otherShift = [];
    for (const punch of punches) {
        const check = validatePunch(punch);
        const at = punchInstant(punch);
        if (!check.ok) { invalid.push({ punch, ...check }); continue; }
        if (!at) {
            invalid.push({
                punch,
                ok: false,
                code: 'PUNCH_TIME_REQUIRED',
                message: 'البصمة بلا وقت صالح مرفوضة',
            });
            continue;
        }
        const wall = punch.wall || wallOf(at);
        const mapped = shiftDayForPunch(wall, shiftStart, shiftKarim);
        const item = { ...punch, at, wall, shiftDay: mapped.date, dayConfident: mapped.confident };
        const belongsToOtherDay = input.shiftDate && mapped.date !== input.shiftDate;
        if (belongsToOtherDay) { otherShift.push(item); }
        if (belongsToOtherDay && input.filterByShiftDay === true) { continue; }
        valid.push(item);
    }

    if (invalid.length > 0) {
        return {
            ok: false,
            shiftDate: input.shiftDate || null,
            status: 'invalid_punch',
            needsReview: true,
            reviewReason: invalid[0].code,
            errors: invalid,
            entryAt: null,
            exitAt: null,
            middle: [],
            duplicates: [],
            workMinutes: null,
            requiredMinutes,
            completedHours: false,
            punches: [],
            otherShift: [],
        };
    }

    valid.sort((a, b) => a.at - b.at);

    const unique = [];
    const duplicates = [];
    const windowMs = Math.max(0, Number(duplicateWindowMinutes) || 0) * 60000;
    for (const punch of valid) {
        const last = unique[unique.length - 1];
        const duplicate = last && (windowMs > 0
            ? punch.at - last.at <= windowMs
            : Math.floor(punch.at.getTime() / 1000) === Math.floor(last.at.getTime() / 1000));
        if (duplicate) {
            duplicates.push(punch);
            continue;
        }
        unique.push(punch);
    }

    const entry = unique[0] || null;
    const exit = unique.length > 1 ? unique[unique.length - 1] : null;
    const middle = unique.slice(1, -1);
    const workMinutes = entry && exit
        ? Math.max(0, Math.round((exit.at - entry.at) / 60000))
        : null;

    let status;
    let needsReview = false;
    let reviewReason = null;
    if (!entry) {
        status = 'no_punch';
        needsReview = true;
        reviewReason = 'no_punch';
    } else if (!exit) {
        // بصمة واحدة لا تتحول أبدًا إلى دخول وانصراف في اللحظة نفسها.
        status = 'single_punch';
        needsReview = true;
        reviewReason = 'single_punch';
    } else if (workMinutes <= 0) {
        status = 'needs_review';
        needsReview = true;
        reviewReason = 'zero_span';
    } else if (workMinutes < minRealMinutes) {
        status = 'needs_review';
        needsReview = true;
        reviewReason = 'suspicious_span';
    } else {
        status = 'complete';
    }

    // مع filterByShiftDay تُستبعد بصمات الأيام الأخرى عن قصد، فلا تُقلق الحكم.
    const mixedDays = input.filterByShiftDay === true ? 0 : otherShift.length;
    const unsureDay = mixedDays > 0 || unique.some((p) => !p.dayConfident);
    if (!needsReview && unsureDay) {
        needsReview = true;
        reviewReason = mixedDays > 0 ? 'mixed_shift_days' : 'ambiguous_shift_day';
    }

    return {
        ok: true,
        shiftDate: input.shiftDate || (entry ? entry.shiftDay : null),
        status,
        needsReview,
        reviewReason,
        entryAt: entry ? entry.at : null,
        exitAt: exit ? exit.at : null,
        middle,
        duplicates,
        workMinutes,
        requiredMinutes,
        completedHours: workMinutes != null && workMinutes >= requiredMinutes,
        punches: unique,
        otherShift,
    };
}

/**
 * حكم صف حضور محفوظ (للتقارير): نفس قواعد البناء بلا بصمات خام.
 *
 * @param {{checkIn?:string, checkOut?:string, workMinutes?:number}} row
 * @param {{shiftKarim?:number, minRealMinutes?:number}} [opts]
 */
function classifyStoredDay(row = {}, opts = {}) {
    const minRealMinutes = opts.minRealMinutes ?? DEFAULT_MIN_REAL_SHIFT_MINUTES;
    const checkIn = String(row.checkIn || '').trim();
    const checkOut = String(row.checkOut || '').trim();
    const hasIn = Boolean(checkIn);
    const hasOut = Boolean(checkOut);

    let workMinutes = null;
    if (hasIn && hasOut) {
        const a = minutesOfTime(checkIn);
        const b = minutesOfTime(checkOut);
        if (a != null && b != null) {
            let diff = b - a;
            if (diff < 0) { diff += 24 * 60; }
            workMinutes = diff;
        } else if (Number.isFinite(Number(row.workMinutes))) {
            workMinutes = Number(row.workMinutes);
        }
    } else if (Number.isFinite(Number(row.workMinutes)) && hasIn) {
        workMinutes = Number(row.workMinutes);
    }

    let status = 'no_punch';
    let needsReview = false;
    let reviewReason = null;
    if (hasIn && !hasOut) {
        status = 'single_punch';
        needsReview = true;
        reviewReason = 'single_punch';
    } else if (!hasIn && hasOut) {
        status = 'missing_in';
        needsReview = true;
        reviewReason = 'missing_in';
    } else if (hasIn && hasOut) {
        if (workMinutes == null || workMinutes <= 0) {
            status = 'needs_review';
            needsReview = true;
            reviewReason = 'zero_span';
        } else if (workMinutes < minRealMinutes) {
            status = 'needs_review';
            needsReview = true;
            reviewReason = 'suspicious_span';
        } else {
            status = 'complete';
        }
    }

    return { hasIn, hasOut, workMinutes, status, needsReview, reviewReason };
}

module.exports = {
    PUNCH_SOURCES,
    DEFAULT_DUPLICATE_WINDOW_MINUTES,
    DEFAULT_MIN_REAL_SHIFT_MINUTES,
    DEFAULT_EARLY_WINDOW_MINUTES,
    DEFAULT_CLOSE_WINDOW_MINUTES,
    validatePunch,
    shiftDayForPunch,
    buildShiftDay,
    classifyStoredDay,
    wallOf,
};
