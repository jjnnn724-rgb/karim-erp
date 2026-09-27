/**
 * shift-day.js — منطق يوم الوردية والورديات الليلية (مشترك: zkteco + QR)
 * ────────────────────────────────────────────────────────────────────────────
 * • يوم الوردية: البصمة قبل ساعة الفصل (NIGHT_CUTOFF_HOUR، افتراضي 5 فجرًا)
 *   تُنسب ليوم العمل السابق — فيدخل انصراف الفجر مع حضور الليلة السابقة.
 * • ربط الانصراف: يُغلق أحدث صف مفتوح (بلا انصراف) من يوم الوردية أو اليوم
 *   السابق — فيعمل لورديات 9 و12 ساعة العابرة لمنتصف الليل.
 * • التأخير يُحسب مقابل بداية وردية الموظف لا ساعة ثابتة.
 */

'use strict';

function shiftDateModeEnabled() {
    const mode = String(process.env.ATTENDANCE_SHIFT_DAY_MODE ?? '').trim().toLowerCase();
    // Default behavior: keep the wall-calendar day intact unless the business
    // explicitly opts into overnight carryover logic.
    if (mode === '') {return false;}
    return !['off', 'false', '0', 'disabled', 'none'].includes(mode);
}

function nightCutoffHour() {
    if (!shiftDateModeEnabled()) {return null;}
    const n = Number(process.env.NIGHT_CUTOFF_HOUR);
    if (Number.isFinite(n) && n >= 0 && n <= 12) {return Math.floor(n);}
    return 5;
}

function normalizeEmployeeCode(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {return null;}
    const upper = raw.toUpperCase().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
    const match = upper.match(/EMP-?(\d{1,5})$/) || upper.match(/^(\d{1,5})$/) || upper.match(/^(?:EMP)?(\d{1,5})$/);
    if (match) {
        const digits = match[1] || match[0];
        return `EMP-${String(Number(digits)).padStart(3, '0')}`;
    }
    const digits = raw.match(/\d+/);
    if (digits) {
        return `EMP-${String(Number(digits[0])).padStart(3, '0')}`;
    }
    return raw;
}

function normalizeDepartmentCode(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {return null;}
    const normalized = raw.toLowerCase()
        .replace(/[\u0640\u0660-\u0669]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[\u2019\u2018\u060C]/g, '')
        .trim();
    const map = {
        'اسيوارد': 'steward',
        'استيوارد': 'steward',
        'استيورد': 'steward',
        'الاستيوارد': 'steward',
        'الاستيورد': 'steward',
        'steward': 'steward',
        'البيع الخارجي': 'ys_b4_ext',
        'بيع خارجي': 'ys_b4_ext',
        'external sales': 'ys_b4_ext',
        'ys_b4_ext': 'ys_b4_ext',
    };
    return map[normalized] || normalized;
}

/** تاريخ أمس بصيغة yyyy-mm-dd */
function prevDay(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) - 24 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** يوم الوردية لبصمة: قبل الفجر → أمس */
function shiftDateFor(wallDate, wallHour, cutoff = nightCutoffHour()) {
    if (cutoff == null) {return wallDate;}
    if (Number(wallHour) < cutoff) {return prevDay(wallDate);}
    return wallDate;
}

/**
 * يوم الوردية حسب وردية الموظف: الترحيل لليوم السابق (بصمات الفجر)
 * يُطبق فقط على الورديات العابرة لمنتصف الليل. ورديات النهار
 * تُنسب دائمًا لتاريخها الميلادي حتى لا تُقرن مساءً بفجر اليوم التالي.
 */
function shiftDateForEmployee(wallDate, wallHour, employee, cutoff = nightCutoffHour()) {
    if (cutoff == null) {return wallDate;}
    const karim = Number(employee?.shift_karim) > 0 ? Number(employee.shift_karim) : 10;
    if (!crossesMidnight(employee?.shift_start || '09:00', karim)) {return wallDate;}
    if (Number(wallHour) < cutoff) {return prevDay(wallDate);}
    return wallDate;
}

/** تحقق بداية الوردية HH:MM — يرجع المطبّع أو يرمي */
function normalizeShiftStart(value) {
    if (value == null || String(value).trim() === '') {return null;}
    const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
        const err = new Error('بداية الوردية بصيغة HH:MM (مثال 22:00)');
        err.statusCode = 422; err.code = 'SHIFT_START_INVALID'; throw err;
    }
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) {
        const err = new Error('بداية الوردية ساعة غير صالحة');
        err.statusCode = 422; err.code = 'SHIFT_START_INVALID'; throw err;
    }
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(mi)}`;
}

/** تحقق ساعات الوردية 1–24 — يرجع الرقم أو يرمي */
function normalizeShiftKarim(value) {
    if (value == null || String(value).trim() === '') {return null;}
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1 || n > 24) {
        const err = new Error('ساعات الوردية بين 1 و 24');
        err.statusCode = 422; err.code = 'SHIFT_HOURS_INVALID'; throw err;
    }
    return Math.round(n * 100) / 100;
}

/** هل يعبر الموظف منتصف الليل؟ (بداية + مدة > 24) */
function crossesMidnight(shiftStart, shiftKarim) {
    const [h, m] = String(shiftStart || '09:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0) + Number(shiftKarim || 10) * 60 > 24 * 60;
}

/** وقت الانصراف المتوقع HH:MM من البداية والمدة */
function expectedEndTime(shiftStart, shiftKarim) {
    const [h, m] = String(shiftStart || '09:00').split(':').map(Number);
    const total = (h || 0) * 60 + (m || 0) + Math.round(Number(shiftKarim || 10) * 60);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
}

/** مفتاح إيقاف محرك التأخير — ATTENDANCE_DELAY_ENGINE=false يعطّل كل حسابات
 *  التأخير/التبكير (بصمة خام فقط: حضور/انصراف/ساعات). الافتراضي مفعّل للحفاظ
 *  على السلوك الحالي؛ الإيقاف لا يمس تسجيل البصمات ولا حساب الساعات. */
function delayEngineEnabled() {
    return String(process.env.ATTENDANCE_DELAY_ENGINE ?? 'true').trim().toLowerCase() !== 'false';
}

/** متأخر؟ مقارنة ببداية الوردية — بدون أي سماح: أي دقيقة فعلية تُحتسب (GRACE_MINUTES مهمل = 0) */
function isLate(wallHour, wallMinute, shiftStart, fallbackStart = 9, graceMin = graceMinutes()) {
    if (!delayEngineEnabled()) {return false;}
    let sH = fallbackStart;
    let sM = 0;
    const m = String(shiftStart || '').match(/^(\d{1,2}):(\d{2})$/);
    if (m) { sH = Number(m[1]); sM = Number(m[2]); }
    return (wallHour * 60 + wallMinute) > (sH * 60 + sM + graceMin);
}

/** فترة السماح بالدقائق — معطلة نهائيًا بقرار المالك: كل شيء فعلي (دائمًا 0) */
function graceMinutes() {
    return 0;
}

/** نافذة القفل بالدقائق بعد نهاية الوردية — LOCK_GRACE_MINUTES، افتراضي 10 */
function lockGraceMinutes() {
    const n = Number(process.env.LOCK_GRACE_MINUTES);
    if (Number.isFinite(n) && n >= 0 && n <= 120) {return Math.floor(n);}
    return 10;
}

function parseTimeMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {return null;}
    return Number(m[1]) * 60 + Number(m[2]);
}

function getShiftStartMinutes(employee) {
    const s = String(employee?.shift_start || '').trim();
    const v = parseTimeMinutes(s);
    if (v != null) {return v;}
    const fallback = Number(process.env.WORK_START_HOUR || 9);
    return fallback * 60;
}

function calculateDelayParts(row, employee) {
    const zero = { arrivalLateMinutes: 0, earlyLeaveMinutes: 0, lateMinutes: 0 };
    if (!delayEngineEnabled()) {return zero;}
    if (!row) {return zero;}
    const checkInMin = parseTimeMinutes(row.checkIn);
    const shiftMin = getShiftStartMinutes(employee);
    const arrival = checkInMin == null ? 0 : Math.max(0, checkInMin - shiftMin);

    let early = 0;
    const checkOutMin = parseTimeMinutes(row.checkOut);
    if (checkOutMin != null) {
        const karim = Number(employee?.shift_karim) > 0 ? Number(employee.shift_karim) : 10;
        const endRaw = shiftMin + Math.round(karim * 60);
        let out = checkOutMin;

        if (checkInMin != null && out < checkInMin) {
            out += 24 * 60;
        }
        if (endRaw > 24 * 60 && out < 12 * 60) {
            out += 24 * 60;
        }
        // بلا دخول مسجل لا يُحتسب تبكير: الخروج وحده لا يثبت شيئًا
        // (مقارنة رقم مع null في جافاسكربت تعطي true زائفة وتنتج دقائق وهمية)
        if (checkInMin != null && out >= shiftMin) {
            early = Math.max(0, endRaw - out);
        }
    }

    return {
        arrivalLateMinutes: arrival,
        earlyLeaveMinutes: early,
        lateMinutes: arrival + early,
    };
}

function calculateLateMinutes(row, employee) {
    return calculateDelayParts(row, employee).lateMinutes;
}

/** انصراف مبكر؟ أي خروج قبل نهاية الوردية المتوقعة — بدون أي سماح */
function isEarlyLeave(outHour, outMinute, shiftStart, shiftKarim, graceMin = graceMinutes()) {
    if (!delayEngineEnabled()) {return false;}
    const m = String(shiftStart || '09:00').match(/^(\d{1,2}):(\d{2})$/);
    const sMin = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
    const endMin = sMin + Math.round(Number(shiftKarim || 10) * 60);
    let oMin = outHour * 60 + outMinute;
    // وردية ليلية تنتهي بعد منتصف الليل: انصراف الصباح على نفس الخط الممتد
    if (endMin > 24 * 60 && oMin < 12 * 60) {oMin += 24 * 60;}
    return (endMin - oMin) > graceMin;
}

module.exports = {
    nightCutoffHour,
    delayEngineEnabled,
    graceMinutes,
    lockGraceMinutes,
    prevDay,
    shiftDateFor,
    shiftDateForEmployee,
    normalizeEmployeeCode,
    normalizeDepartmentCode,
    normalizeShiftStart,
    normalizeShiftKarim,
    crossesMidnight,
    expectedEndTime,
    isLate,
    isEarlyLeave,
    calculateDelayParts,
    calculateLateMinutes,
};
