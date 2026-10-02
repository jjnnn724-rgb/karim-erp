/**
 * attendance-engine.js — محرك الحضور الموحد والمحكم
 * ────────────────────────────────────────────────────────────────────────────
 * يعالج جميع الحالات الحدية بذكاء:
 * 1. حساب التأخير = تأخير الحضور + انصراف مبكر (كلاهما دقائق)
 * 2. خروج بلا دخول ذكي: نمط الموظف + وقت الوردية + حالة الجهاز
 * 3. دخول بلا خروج ذكي: استكمال تلقائي بطابع زمني صحيح
 * 4. بصمات مكررة/متعارضة/خاطئة → قرارات مسجلة للمراجعة
 * 5. ورديات ليلية (عبر منتصف الليل) مدعومة بالكامل
 * 6. صفر تعارض مع القيم المدخلة يدويًا/QR (fill-only)
 */

'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const {
    shiftDateFor, shiftDateForEmployee, prevDay, isLate, isEarlyLeave, graceMinutes, lockGraceMinutes,
    normalizeShiftStart, normalizeShiftKarim, delayEngineEnabled,
} = require('./shift-day');

const proto = require('./zkteco/protocol');
const IN_STATES = proto.CHECK_IN_STATES;
const OUT_STATES = proto.CHECK_OUT_STATES;
// قاعدة الزر المنسي: أدنى فجوة (بالدقائق) منذ الدخول تعتبر البصمة التالية «خروج»
// حتى لو كان زر الجهاز على «دخول» — أرضية 60 دقيقة، افتراضي 240 (4 ساعات).
const WRONG_BUTTON_GAP_MIN = Math.max(60, Number(process.env.ATT_WRONG_BUTTON_GAP_MIN) || 240);

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh

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
    } catch (_) {}
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

function clockDistanceMinutes(a, b) {
    const day = 24 * 60;
    const diff = Math.abs((a - b + day) % day);
    return Math.min(diff, day - diff);
}

function wallToInstant(wall) {
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - BUSINESS_TZ_OFFSET_MS);
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
    return { min: wall.hour * 60 + wall.minute, out: OUT_STATES.has(state) && !IN_STATES.has(state) };
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
function minutesBetween(inTime, outTime, shiftDate) {    const [ih, im] = String(inTime).split(':').map(Number);
    const [oh, om] = String(outTime).split(':').map(Number);
    let d = (oh * 60 + om) - (ih * 60 + im);
    if (d < 0) { d += 24 * 60; }
    return d;
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
// محرك التصنيف الذكي (Core Decision Engine)
// ════════════════════════════════════════════════════════════════════════

/**
 * يصنف بصمة إلى: 'in' | 'out' | 'ignore' | 'fix_in' | 'fix_out'
 * مع confidence و reason و override flag
 */
function classifyPunch({
    punchState,
    wallMin,           // دقائق من منتصف الليل (ساعة الحائط)
    shiftStartMin,     // بداية الوردية بالدقائق
    shiftEndMin,       // نهاية الوردية بالدقائق (قد > 1440 للوردية الليلية)
    hasOpenRow,        // هل يوجد صف مفتوح (بلا خروج) لليوم
    openRowCheckIn,    // ساعة دخول الصف المفتوح ('HH:MM' أو null) — حرس الارتداد
    lastPunch,         // { min, out } آخر بصمة معالجة
    pattern,           // { medianIn, medianOut, samples }
    dayLogs,           // جميع بصمات اليوم مصنفة: { in: [], out: [] }
}) {
    const deviceIn = IN_STATES.has(Number(punchState));
    const deviceOut = OUT_STATES.has(Number(punchState));
    const thisOut = deviceOut && !deviceIn;

    // 1. بصمة مكررة بنفس الاتجاه خلال 5 دقائق → تجاهل
    if (lastPunch && lastPunch.out === thisOut && Math.abs(wallMin - lastPunch.min) <= 5) {
        return { action: 'ignore', confidence: 0.95, reason: 'بصمة مكررة بنفس الاتجاه خلال 5 دقائق', override: false };
    }

    // 2. صف مفتوح موجود → أي بصمة تالية تُغلقه (زر الجهاز يُتجاهل تماماً:
    //    التبديل بين دخول/انصراف على الجهاز سبب شائع للخطأ، والتسلسل هو المرجع)
    if (hasOpenRow) {
        if (deviceOut) {
            // حرس الارتداد: «خروج» خلال ساعة من الدخول = ضغط مزدوج عند الوصول — يُتجاهل
            const openMin = openRowCheckIn != null ? toMin(openRowCheckIn) : (lastPunch ? lastPunch.min : null);
            const arrivedGap = openMin != null ? ((wallMin - openMin) + 24 * 60) % (24 * 60) : 999;
            if (arrivedGap <= 60) {
                return { action: 'ignore', confidence: 0.9, reason: 'بصمة خروج خلال ساعة من الدخول — ضغط مزدوج عند الوصول', override: false };
            }
            return { action: 'out', confidence: 0.9, reason: 'صف مفتوح + حالة خروج', override: false };
        }
        // زر «دخول» والصف مفتوح: الزر المنسي عند الخروج (فجوة طويلة منذ الدخول أو
        // قرب موعد الانصراف المعتاد) — مقابل الضغط المزدوج عند الوصول (يُتجاهل)
        const openMin2 = openRowCheckIn != null ? toMin(openRowCheckIn) : (lastPunch ? lastPunch.min : null);
        const gap2 = openMin2 != null ? ((wallMin - openMin2) + 24 * 60) % (24 * 60) : null;
        const patOut2 = pattern?.medianOut != null ? pattern.medianOut % (24 * 60) : null;
        if (gap2 != null && (gap2 >= WRONG_BUTTON_GAP_MIN || (patOut2 != null && Math.abs(wallMin - patOut2) <= 90))) {
            return { action: 'out', confidence: 0.85, reason: ('زر دخول بالخطأ عند الخروج — فجوة ' + Math.floor(gap2 / 60) + 'س' + (gap2 % 60) + 'د منذ الدخول'), override: true };
        }
        return { action: 'ignore', confidence: 0.9, reason: 'صف مفتوح + زر دخول بعد قليل — ضغط مزدوج عند الوصول', override: false };
    }

    const near = (target, tol) => target != null && Math.abs(wallMin - target) <= tol;

    const patIn = pattern?.medianIn;
    // medianOut مخزن كدقائق مطلقة (قد > 1440 للليلية) → نحول لوقت حائط
    const patOut = pattern?.medianOut != null ? pattern.medianOut % (24 * 60) : null;

    const shiftStartWindow = shiftStartMin % (24 * 60);
    const shiftEndWindow = shiftEndMin % (24 * 60);
    const atShiftStart = clockDistanceMinutes(wallMin, shiftStartWindow) <= 120 || (patIn != null && clockDistanceMinutes(wallMin, patIn) <= 60);
    const atShiftEnd = clockDistanceMinutes(wallMin, shiftEndWindow) <= 180 || (patOut != null && clockDistanceMinutes(wallMin, patOut) <= 90);
    const inZone = atShiftStart || near(shiftStartMin, 120) || near(patIn, 60);
    const outZone = atShiftEnd || near(shiftEndWindow, 180) || (patOut != null && near(patOut, 90));

    // 3. لا صف مفتوح: القرار بالزمن لا بزر الجهاز (معالجة جذرية 2026-10-02):
    //    أ) قرب بداية الوردية أو نمط الدخول → دخول بالضرورة (زر «خروج» عند بداية
    //       الدوام سبب شائع للخطأ ويُتجاهل تماماً)
    if (inZone) {
        return { action: 'in', confidence: 0.9, reason: 'بلا صف مفتوح + وقت دخول — زر الجهاز يُتجاهل', override: deviceOut };
    }
    //    ب) قرب نهاية الوردية أو نمط الانصراف → خروج (وردية ليلية فقد صفها)
    if (outZone) {
        return { action: 'out', confidence: 0.85, reason: 'بلا صف مفتوح + وقت انصراف', override: !deviceOut };
    }
    //    ج) وقت محايد → فتح جلسة افتراضياً (الوصول أشيع من انصراف يتيم)
    return { action: 'in', confidence: 0.7, reason: 'وقت محايد — فتح جلسة افتراضياً', override: deviceOut };
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
    const arrival = checkInMin == null ? 0 : Math.max(0, checkInMin - shiftMin);
    const lateFlag = arrival > 0;

    let early = 0;
    let earlyFlag = false;
    // قرار المالك (2026-09): التأخير يُقاس بإتمام ساعات الوردية لا بلحظة الدخول —
    // «أهم شي يكمل 10 أو 12 ساعته»: الدخول المبكر يغطي الانصراف المبكر، والتأخير
    // يُمتص بالبقاء أطول. أي نقص (قبل أو بعد) يُحسب تأخيرًا. بلا بصمة خروج اليوم
    // مفتوح → يُحكم عليه عند إغلاقه (قيد المراجعة).
    let totalLate = arrival;
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
                early = Math.max(0, endRaw - out);
                earlyFlag = early > 0;
            }
            if (checkInMin != null) {
                const requiredMin = Math.round(karim * 60);
                const workedMin = out - checkInMin; // نفس التظليل الليلي المطبق على out
                totalLate = Math.max(0, requiredMin - workedMin);
            }
        }
    }

    return {
        arrivalLateMinutes: arrival,
        earlyLeaveMinutes: early,
        totalLateMinutes: totalLate,
        lateFlag,
        earlyFlag,
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
        this.patterns = new Map(); // employeeId → pattern
        this.lastPunches = new Map(); // employeeId → { min, out }
    }

    setIO(io) { this.io = io; }

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
        } catch (_) {}
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
    async processPunch({ employeeId, punchState, instant, wall, device, source = 'device' }) {
        const shift = await this.getEmployeeShift(employeeId);
        if (!shift) {return { action: null, error: 'Employee not found' };}

        const { shiftStart, shiftKarim, autoCheckout, autoLock } = shift;
        const shiftStartMin = toMin(shiftStart);
        const shiftEndMin = shiftStartMin + Math.round(Number(shiftKarim) * 60);
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
            const pattern = await this.loadPattern(employeeId);

            // جلب بصمات اليوم الحالية للتصنيف الذكي
            const dayLogs = await this.getDayLogsForClassification(employeeId, shiftDate, { shift_start: shiftStart, shift_karim: shiftKarim });

            // هل يوجد صف مفتوح؟ (يوم الوردية أو اليوم السابق للورديات الليلية)
            // يُقرأ قبل التصنيف حتى يتجاهل المصنف زر الجهاز ويعتمد التسلسل.
            const openCheck = await client.query(
                `SELECT id, "checkIn", "checkInAt" FROM attendance
                  WHERE "employeeId" = $1 AND "checkOut" IS NULL AND date IN ($2, $3)
                  LIMIT 1`,
                [employeeId, shiftDate, prevDay(shiftDate)]
            );
            const hasOpenRow = openCheck.rows.length > 0;
            // دقائق الدخول للصف المفتوح — يغذي قاعدة «زر دخول بالخطأ عند الخروج»
            const openRowCheckIn = hasOpenRow ? (openCheck.rows[0].checkIn || null) : null;

            // ═══ قاعدة النسيان الجذرية (2026-10-02) ═══
            // صف مفتوح تجاوز طول الوردية بساعتي رحمة = الموظف نسي بصمة الخروج:
            // يُقفل مستنتجاً بنهاية ورديته (وليس بهذه البصمة!) حتى لا تتولد صفوف
            // 24 ساعة، وهذه البصمة تفتح يومها الحالي كدخول جديد.
            let staleOpenRowId = null;
            if (hasOpenRow && openCheck.rows[0].checkInAt) {
                const openHours = (instant - new Date(openCheck.rows[0].checkInAt)) / 3600000;
                if (openHours > Number(shiftKarim) + 2) {
                    staleOpenRowId = openCheck.rows[0].id;
                    const shiftLenMs = Math.round(Number(shiftKarim) * 3600 * 1000);
                    const inferredOutAt = new Date(new Date(openCheck.rows[0].checkInAt).getTime() + shiftLenMs);
                    const wallOut = this._wallParts(inferredOutAt);
                    await client.query(
                        `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3, "workMinutes" = $4,
                            checkout_inferred = true,
                            notes = COALESCE(notes,'') || ' | انصراف مستنتج بنهاية الوردية — نسيان بصمة الخروج'
                         WHERE id = $1`,
                        [staleOpenRowId, wallOut.time, inferredOutAt, Math.round(Number(shiftKarim) * 60)]
                    );
                    logger.warn('[AttendanceEngine] صف مفتوح قديم أُقفل مستنتجاً (نسيان خروج):', employeeId, openRowCheckIn);
                }
            }
            const effectiveHasOpenRow = hasOpenRow && !staleOpenRowId;

            // تصنيف ذكي — مع تجاوز الصف القديم الذي أُقفل مستنتجاً أعلاه
            const verdict = classifyPunch({
                punchState,
                wallMin,
                shiftStartMin,
                shiftEndMin,
                hasOpenRow: effectiveHasOpenRow,
                openRowCheckIn,
                lastPunch,
                pattern,
                dayLogs,
            });
            // إن كانت البصمة ستفتح يوماً جديداً بعد قفل صف قديم → دخول مباشر
            if (staleOpenRowId) {
                verdict.action = 'in';
                verdict.override = true;
                verdict.reason = 'بعد قفل نسيان الخروج مستنتجاً — هذه البصمة دخول اليوم';
            }

            // تسجيل القرارات المثيرة للمراجعة
            if (verdict.override || verdict.confidence < confidenceThreshold()) {
                await this.logDecision({
                    employeeId, date: shiftDate, decision: verdict.action,
                    confidence: verdict.confidence, reason: verdict.reason,
                    punchState, deviceId: device?.id,
                });
            }

            this.lastPunches.set(employeeId, { min: wallMin, out: thisOut });

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
                    shiftStart, shiftKarim, verdict, source, device, onLeave,
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

            if (action && this.io) {
                this.io.emit('attendance:updated', { action, source, employee: { id: employeeId }, record });
            }

            return { action, record, decision: verdict };

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('[AttendanceEngine] processPunch failed:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // معالج الدخول
    // ════════════════════════════════════════════════════════════════════════

    async handleCheckIn({ client, employeeId, shiftDate, wall, instant, shiftStart, shiftKarim, verdict, source, device, onLeave }) {
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
            const record = (await client.query(
                `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, "checkInAt", source, on_leave)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [id, employeeId, shiftDate, wall.time, lateFlag, note, instant, source, onLeave]
            )).rows[0];
            return { action: 'check_in', record };
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
                return { action: null, record: null }; // دخول بعد انصراف — تجاهل
            }

            const mins = checkOutAt ? Math.max(0, Math.round((checkOutAt - instant) / 60000)) : null;
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

    // ════════════════════════════════════════════════════════════════════════
    // معالج الخروج (الأذكى)
    // ════════════════════════════════════════════════════════════════════════

    async handleCheckOut({ client, employeeId, shiftDate, wall, instant, shiftStart, shiftKarim, verdict, source, device, onLeave, punchState }) {
        const note = `تسجيل انصراف عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`;
        const earlyFlag = isEarlyLeave(wall.hour, wall.minute, shiftStart, shiftKarim);

        // 1. أحدث صف مفتوح من يوم الوردية أو اليوم السابق (وردية ليلية)
        const open = await client.query(
            `SELECT * FROM attendance
              WHERE "employeeId" = $1 AND "checkOut" IS NULL AND date IN ($2, $3)
              ORDER BY date DESC LIMIT 1 FOR UPDATE`,
            [employeeId, shiftDate, prevDay(shiftDate)]
        );

        if (open.rows[0]) {
            // يوجد صف مفتوح → إغلاقه
            const row = open.rows[0];
            const checkInAt = row.checkInAt ? new Date(row.checkInAt) : null;
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
                return { action: 'check_out', record };
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
            const checkInAt = inf.checkInAt ? new Date(inf.checkInAt) : null;
            if (!checkInAt || instant > checkInAt) {
                const minutes = checkInAt ? Math.max(0, Math.round((instant - checkInAt) / 60000)) : null;
                const record = (await client.query(
                    `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3,
                        "workMinutes" = COALESCE($4, "workMinutes"), checkout_inferred = false, early_leave = $6,
                        notes = COALESCE(notes, '') || ' | انصراف عبر ' || $5
                     WHERE id = $1 RETURNING *`,
                    [inf.id, wall.time, instant, minutes, note, earlyFlag]
                )).rows[0];
                return { action: 'check_out', record };
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

        // 4. إنشاء صف جديد بخروج + محاولة استرداد الدخول من سجل البصمات
        //    بدلًا من ترك checkIn=null (الذي يسبب سجلات شاذة في التقارير)
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
        const earlyPunches = await client.query(
            `SELECT "attendanceTime", "punchState" FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" < $3
                AND "attendanceTime" < $4
              ORDER BY "attendanceTime" ASC`,
            [employeeId, dayStart, dayEnd, instant]
        );
        if (earlyPunches.rows.length > 0) {
            // أول بصمة في اليوم = الدخول (حتى لو كانت حالة "خروج" بالجهاز)
            const first = earlyPunches.rows[0];
            const firstWall = instantToWall(new Date(first.attendanceTime));
            recoveredCheckIn = firstWall.time;
            recoveredCheckInAt = new Date(first.attendanceTime);
            recoveredLateFlag = isLate(firstWall.hour, firstWall.minute, shiftStart, Number(process.env.WORK_START_HOUR || 9));
            recoveredMinutes = Math.max(0, Math.round((instant - recoveredCheckInAt) / 60000));
        }

        const delay = calculateDelayDetail({ checkIn: recoveredCheckIn, checkOut: wall.time, shiftStart, shiftKarim });
        const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        const record = (await client.query(
            `INSERT INTO attendance
                (id, "employeeId", date, "checkIn", late, notes, "checkOut", "checkOutAt", source, early_leave, "workMinutes", "checkInAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [id, employeeId, shiftDate,
             recoveredCheckIn, recoveredLateFlag,
             recoveredCheckIn ? `دخول مسترد من سجل البصمات + ${note}` : `دخول مفقود — ${note}`,
             wall.time, instant, source, delay.earlyLeaveMinutes > 0,
             recoveredMinutes, recoveredCheckInAt]
        )).rows[0];

        // تسجيل قرار للمراجعة
        await this.logDecision({
            employeeId, date: shiftDate, decision: 'check_out_without_in',
            confidence: 0.6, reason: 'بصمة خروج بلا صف مفتوح ولا دخول — دخول مفقود',
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

            const logsOf = (day) => logs.filter(l => shiftDateForEmployee(l.wall.date, l.wall.hour, { shift_start: sStart, shift_karim: sHours }) === day);
            const minsBetween = (inT, outT) => {
                const [ih, im] = inT.split(':').map(Number);
                const [oh, om] = outT.split(':').map(Number);
                let d = (oh * 60 + om) - (ih * 60 + im);
                if (d < 0) {d += 24 * 60;}
                return d;
            };

            for (const row of empRows) {
                const isToday = row.date === todayStr;
                const dayLogs = logsOf(row.date);
                const ins = dayLogs.filter(l => IN_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
                const outs = dayLogs.filter(l => OUT_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));

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
                    if (ins.length) {
                        const f = ins[0];
                        const late = isLate(f.wall.hour, f.wall.minute, sStart, Number(process.env.WORK_START_HOUR || 9));
                        const mins = row.checkInAt ? Math.max(0, Math.round((new Date(row.checkOutAt) - new Date(f.attendanceTime)) / 60000))
                            : minutesBetween(f.wall.time, row.checkOut, row.date);
                        await pool.query(
                            `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                                "workMinutes" = COALESCE($5, "workMinutes"), checkin_inferred = false,
                                notes = COALESCE(notes, '') || ' | دخول مسترد من سجل البصمات'
                             WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), late, mins]);
                        fixedRows++;
                    } else if (dayLogs.length) {
                        // لا توجد بصمة دخول صريحة (كل البصمات بحالة خروج — شائع في الورديات الليلية):
                        // استخدم أقدم بصمة *قبل* لحظة الخروج فقط — أما بصمة الخروج نفسها
                        // فلا تُستخدم دخولًا أبدًا (كانت تُنتج أزواجًا صفرية الدقائق).
                        const ordered = [...dayLogs].sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
                        const coAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
                        const f = ordered.find(o => !coAt || new Date(o.attendanceTime).getTime() < coAt.getTime());
                        if (!f) {
                            continue;
                        }
                        const late = isLate(f.wall.hour, f.wall.minute, sStart, Number(process.env.WORK_START_HOUR || 9));
                        const mins = coAt ? Math.max(0, Math.round((coAt - new Date(f.attendanceTime)) / 60000))
                            : minutesBetween(f.wall.time, row.checkOut, row.date);
                        await pool.query(
                            `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                                "workMinutes" = COALESCE($5, "workMinutes"), checkin_inferred = false,
                                notes = COALESCE(notes, '') || ' | دخول مسترد من أقدم بصمة (حالة الجهاز خروج)'
                             WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), late, mins]);
                        fixedRows++;
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
                        await pool.query(
                            `UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3,
                                "workMinutes" = COALESCE($4, "workMinutes"), checkout_inferred = false,
                                notes = COALESCE(notes, '') || ' | خروج مسترد من سجل البصمات' || $5
                             WHERE id = $1`, [row.id, f.wall.time, new Date(f.attendanceTime), mins, wrongBtn ? ' (زر خاطئ)' : '']);
                        fixedRows++;
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

                        if (row.checkin_inferred && ins.length) {
                            const f = ins[0];
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

    async getDayLogsForClassification(employeeId, shiftDate, shift = null) {
        const { rows } = await pool.query(
            `SELECT "deviceUserId", "attendanceTime", "punchState" FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" >= ($2::date - INTERVAL '1 day')::timestamptz
                AND "attendanceTime" < ($2::date + INTERVAL '2 days')::timestamptz
              ORDER BY "attendanceTime"`,
            [employeeId, shiftDate]
        );
        const byDay = { in: [], out: [] };
        for (const l of rows) {
            const wall = instantToWall(new Date(l.attendanceTime));
            const wd = shift
                ? shiftDateForEmployee(wall.date, wall.hour, shift)
                : shiftDateFor(wall.date, wall.hour);
            if (wd === shiftDate) {
                if (IN_STATES.has(Number(l.punchState))) {byDay.in.push(l);}
                else if (OUT_STATES.has(Number(l.punchState))) {byDay.out.push(l);}
            }
        }
        return byDay;
    }

    isLockedOut(row, shiftDate, shiftStart, shiftKarim, autoLock) {
        if (!autoLock || !row) {return false;}
        if (!row.checkout_inferred && !row.checkin_inferred) {return false;}
        return Date.now() > endInstantOf(shiftDate, shiftStart, shiftKarim) + lockGraceMinutes() * 60000;
    }

    async loadEmployeeMapping() {
        const { rows } = await pool.query(
            'SELECT id, name, "deviceUserId", "employeeId", shift_start, shift_karim, auto_checkout, auto_lock FROM employees'
        );
        const byDeviceId = new Map();
        const byEmployeeNo = new Map();
        const byId = new Map();
        for (const row of rows) {
            const duid = row.deviceUserId != null ? String(row.deviceUserId).trim() : '';
            if (duid) {byDeviceId.set(duid, row.id);}
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
    const asNum = Number(key);
    if (Number.isFinite(asNum) && /^\d+$/.test(key)) {
        for (const [candidate, employeeId] of byEmployeeNo.entries()) {
            if (/^\d+$/.test(candidate) && Number(candidate) === asNum) {
                return { employeeId, via: 'employee_number_numeric' };
            }
        }
        for (const [candidate, employeeId] of byDeviceId.entries()) {
            if (/^\d+$/.test(candidate) && Number(candidate) === asNum) {
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