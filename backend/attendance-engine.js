/**
 * attendance-engine.js — محرك الحضور الواحد (قرار المالك 2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 * البصمة هي مصدر الحقيقة الوحيد — جهازًا كانت أو كاميرا — ولا شيء غيرها.
 * مصادر الحضور المعتمدة (اثنان فقط)، ولا تفريق بينهما في الحكم:
 *   ١. جهاز البصمة (ZKTeco)
 *   ٢. كاميرا التطبيق (بوابة الموظف)
 * أي مصدر آخر محذوف: مسح QR، مزامنة أجهزة خارجية، استكمال تلقائي، اشتقاق من السياق.
 *
 * الحكم الواحد (بلا تعقيدات):
 *   • أول بصمة في يوم الوردية = حضور، وكل بصمة بعدها = انصراف؛ آخر بصمة هي الانصراف.
 *   • ملصق حالة الجهاز (دخول/انصراف) دليلٌ يُسجَّل عند المخالفة فقط — لا يُلغي بصمة،
 *     ولا يُنشئ صفًّا، ولا يُخلِّف «انصرافًا بلا دخول» (انقلب على خمسة موظفين فكانت
 *     انصرافات حقيقية تضيع وأيتام تُراجع؛ والكلام للمالك: البصمة حاكمة لا ملصقها).
 *   • لا بصمة ⇒ لا صف: لا يُخترع انصراف ولا حضور من فراغ —
 *     صفٌ بلا انصراف يبقى مفتوحًا ويظهر «بلا انصراف» حتى تأتي بصمته الحقيقية.
 *   • بصمة واحدة تُطبَّق مرة واحدة: أي بصمة تصل خلال نافذة التبريد من لحظة طرف
 *     مسجَّل في القاعدة تُهمَل وتُعلَّم للمراجعة — لا تُحجز نفس البصمة مرتين.
 *   • البطاقة للوقت فقط (بداية الدوام ومدّة الوردية): لا دخل لها في اتجاه البصمة.
 *   • التأخير = دقائق بعد بداية دوام البطاقة. الساعات = الانصراف − الدخول.
 *     العجز عن ساعات البطاقة يُحتسب كاملًا بلا سماحية (التأخير من أول دقيقة).
 */

'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const {
    shiftDateForEmployee, prevDay, isLate, isEarlyLeave,
    normalizeShiftStart, normalizeShiftKarim,
} = require('./shift-day');

const proto = require('./zkteco/protocol');
const IN_STATES = proto.CHECK_IN_STATES;
const OUT_STATES = proto.CHECK_OUT_STATES;

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh (UTC+3، بلا تغيير موسمي)

/** نافذة التبريد بالميلي ثانية — بصمة تصل خلالّها من لحظة طرف مسجَّل تُعدّ إعادة
 *  لنفس البصمة. ATTENDANCE_PUNCH_COOLDOWN_MS=0 يُعطل الحارس، والقيم الشاذة
 *  ترجع للافتراضي. الافتراضي يغطي فارق المللي ثانية الذي خلَّفه تطبيقٌ مزدوج. */
const DEFAULT_PUNCH_COOLDOWN_MS = 2000;

function punchCooldownMs() {
    const raw = process.env.ATTENDANCE_PUNCH_COOLDOWN_MS;
    if (raw == null || String(raw).trim() === '') {return DEFAULT_PUNCH_COOLDOWN_MS;}
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 60000) {return DEFAULT_PUNCH_COOLDOWN_MS;}
    return Math.floor(n);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toMin(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {return null;}
    const h = Number(m[1]); const mi = Number(m[2]);
    if (h > 23 || mi > 59) {return null;}
    return h * 60 + mi;
}

/** تعقيم وقت الحائط النصي — صيغة شاذة ⇒ null. */
function safeWallTime(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) {return null;}
    let H = Number(m[1]);
    const M = Number(m[2]);
    if (!Number.isFinite(H) || !Number.isFinite(M) || M > 59) {return null;}
    H = ((H % 24) + 24) % 24;
    return `${pad2(H)}:${pad2(M)}`;
}

/** لحظة مطلقة → { date, time, hour, minute } بتوقيت الرياض. */
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

/** دقائق بين وقتين على خطٍّ ممتد (العبور لليوم التالي يدعم وردية الليل). */
function minutesBetween(inTime, outTime) {
    const a = toMin(inTime); const b = toMin(outTime);
    if (a == null || b == null) {return null;}
    let d = b - a;
    if (d < 0) {d += 24 * 60;}
    return d;
}

class AttendanceEngine {
    constructor() {
        this.io = null;
        this.emit = null;
    }

    setIO(io) {
        this.io = io;
        this.emit = require('./realtime/guard').makeEmitScoped(io);
    }

    /**
     * الوردية = بطاقة الموظف مباشرة (shift_start / shift_karim).
     * لا سجلّ سريان ولا استنتاج — أي تعديل في البطاقة يسري فورًا على الأيام التالية.
     */
    async getEmployeeShift(employeeId, _forDate) {
        const { rows } = await pool.query(
            `SELECT shift_start, shift_karim FROM employees WHERE id = $1`, [employeeId]);
        if (!rows[0]) {return null;}
        return {
            shiftStart: normalizeShiftStart(rows[0].shift_start),
            shiftKarim: normalizeShiftKarim(rows[0].shift_karim),
        };
    }

    /** تحقق مما إذا كان الموظف في إجازة معتمدة في تاريخ محدد. */
    async isOnLeave(employeeId, date) {
        try {
            const { rows } = await pool.query(
                `SELECT 1 FROM "leaveRequests"
                 WHERE "employeeId" = $1 AND $2 BETWEEN "startDate" AND "endDate"
                   AND status = 'approved' LIMIT 1`,
                [employeeId, date]);
            return rows.length > 0;
        } catch (e) {
            logger.warn('[AttendanceEngine] تعذر فحص الإجازة (متابعة بلا إجازة):', e && e.message ? e.message : e);
            return false;
        }
    }

    /**
     * يعالج بصمة واحدة ويحدث جدول attendance.
     * الاتجاه من تسلسل بصمات الموظف نفسه — للمصدرين معًا بلا تفريق:
     *   • لا صف مفتوح ولا دخول في يوم الوردية ⇒ البصمة حضور.
     *   • صف مفتوح (اليوم أو أمس للوردية الليلية) أو دخول محجوز ⇒ البصمة انصراف،
     *     تمدّه إلى آخر بصمة.
     * ملصق حالة الجهاز يُقرأ ويُعلَّم عند المخالفة، ولا يحكم ولا يُسقط بصمة.
     */
    async processPunch({ employeeId, punchState, instant, wall, device, source = 'device', forDate = null }) {
        const shift = await this.getEmployeeShift(employeeId, forDate || undefined);
        if (!shift) {return { action: null, error: 'Employee not found' };}

        if (wall && typeof wall.time === 'string') {
            wall = { ...wall, time: safeWallTime(wall.time) };
        }

        const { shiftStart, shiftKarim } = shift;
        const shiftDate = shiftDateForEmployee(wall.date, wall.hour,
            { shift_start: shiftStart, shift_karim: shiftKarim });
        const onLeave = await this.isOnLeave(employeeId, shiftDate);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // تسلسل بصمات نفس الموظف+اليوم حتى لا تُنشأ صفّين بنفس اللحظة (جهاز + كاميرا).
            // hashtext لا غير: النسخة الأولى مرّرت employeeId خامًا والنسخةُ الكبيرة منه
            // (17908800…) خارج نطاق int4 ⇒ 22003 ⇒ المعاملة تُلغى وتضيع البصمة (2026-11-05).
            // تصادم الهاش يُسرِع قفلًا زائدًا لا يُخطئ كتابة.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
                [String(employeeId), shiftDate]);

            // حارس التبريد: الدليل من القاعدة لا من الذاكرة (درس 2026-10-14 — كاش
            // راسب ابتلع بصمة موثقة)، ويستعلم قبل أي قرار/كتابة في نفس القفل.
            const cooldownMs = punchCooldownMs();
            if (cooldownMs > 0) {
                const at = new Date(instant);
                const winStart = new Date(at.getTime() - cooldownMs);
                const winEnd = new Date(at.getTime() + cooldownMs);
                const replay = await client.query(
                    `SELECT id, date FROM attendance
                      WHERE "employeeId" = $1 AND date IN ($2, $3)
                        AND ("checkInAt" BETWEEN $4 AND $5 OR "checkOutAt" BETWEEN $4 AND $5)
                      ORDER BY date DESC LIMIT 1`,
                    [employeeId, shiftDate, prevDay(shiftDate), winStart, winEnd]);
                if (replay.rows[0]) {
                    await this.logDecision({
                        employeeId, date: shiftDate, decision: 'ignore', confidence: 0.9,
                        reason: `بصمة خلال نافذة التبريد (${cooldownMs}مللي ث) من طرف مسجَّل في صف ${replay.rows[0].date} — مُطبَّقة بالفعل، بلا صف جديد`,
                        punchState, deviceId: device?.id,
                    });
                    await client.query('COMMIT');
                    return { action: 'ignore', record: null, cooldown: true };
                }
            }

            const openCheck = await client.query(
                `SELECT id, date, "checkIn", "checkInAt" FROM attendance
                  WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL AND "checkOut" IS NULL
                    AND date IN ($2, $3)
                  ORDER BY date DESC LIMIT 1 FOR UPDATE`,
                [employeeId, shiftDate, prevDay(shiftDate)]);
            const openRow = openCheck.rows[0] || null;
            const rowForDay = (await client.query(
                'SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE',
                [employeeId, shiftDate])).rows[0] || null;

            // ── الاتجاه من تسلسل البصمات وحده — بصمة الجهاز وبصمة الكاميرا سيان ──
            // البصمة هي مصدر الحقيقة الوحيد (قرار المالك 2026-11-05): أول بصمة في يوم
            // الوردية حضور، وكل بصمة بعدها انصرافٌ حتى آخر بصمة. لا ملصق جهاز يحكم ولا
            // بطاقة: ملصقات خمسة موظفين مقلوبة، فكان بها انصرافات تُهمَل كأخوات للدخول
            // وأيتام «انصراف بلا دخول» — والتسلسل يبني اليومَين الصحيحَين من نفس البصمات.
            const dir = (openRow || (rowForDay && rowForDay.checkIn)) ? 'out' : 'in';

            const raw = punchState;
            const known = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
            if (known) {
                const saysIn = IN_STATES.has(Number(raw));
                const saysOut = !saysIn && OUT_STATES.has(Number(raw));
                if ((saysIn && dir === 'out') || (saysOut && dir === 'in')) {
                    await this.logDecision({
                        employeeId, date: shiftDate, decision: 'state_conflict', confidence: 0.7,
                        reason: `ملصق الجهاز (${raw}) يقول ${saysIn ? 'دخولًا' : 'انصرافًا'} والتسلسل يحكم `
                            + `${dir === 'in' ? 'حضورًا' : 'انصرافًا'} — البصمة حاكمة، ويُراجع ضبط جهاز الموظف`,
                        punchState: raw, deviceId: device?.id,
                    });
                }
            }

            const time = wall.time;
            const lateFlag = isLate(wall.hour, wall.minute, shiftStart, 9);
            let action = null;
            let record = null;

            if (dir === 'in') {
                const note = `تسجيل حضور عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`;
                if (rowForDay) { // انصراف يتيم من بناء سابق — أول بصمة هنا تصير الدخول
                    record = (await client.query(
                        `UPDATE attendance
                            SET "checkIn"=$2, "checkInAt"=$3, late=$4, source=$5, on_leave=$6,
                                "workMinutes" = CASE WHEN "checkOutAt" IS NOT NULL
                                    THEN GREATEST(0, ROUND(EXTRACT(epoch FROM ("checkOutAt" - $3)) / 60))
                                    ELSE "workMinutes" END,
                                notes = COALESCE(notes,'') || ' | ' || $7
                          WHERE id=$1 RETURNING *`,
                        [rowForDay.id, time, instant, lateFlag, source, onLeave, note]
                    )).rows[0];
                } else {
                    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
                    try {
                        record = (await client.query(
                            `INSERT INTO attendance (id, "employeeId", date, "checkIn", late, notes, "checkInAt", source, on_leave)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                            [id, employeeId, shiftDate, time, lateFlag, note, instant, source, onLeave]
                        )).rows[0];
                    } catch (insertErr) {
                        if (insertErr && insertErr.code === '23505') { // أُنشئ بنفس اللحظة من مصدر آخر — الأول يحسم
                            await this.logDecision({
                                employeeId, date: shiftDate, decision: 'ignore', confidence: 0.8,
                                reason: `تصادُف كتابة ${source} عند ${time} مع صف كُتب قبله بأجزاء الثانية — الأول يحسم، والمُكررة مُتجاهَلة`,
                                punchState, deviceId: device?.id,
                            });
                            await client.query('COMMIT');
                            return { action: 'ignore', record: null, duplicate: true };
                        }
                        throw insertErr;
                    }
                }
                action = 'check_in';
            } else { // dir === 'out' — البصمة تمدّ الانصراف إلى آخر بصمة
                const target = openRow || rowForDay;
                if (target.checkOutAt && new Date(instant) <= new Date(target.checkOutAt)) {
                    await this.logDecision({
                        employeeId, date: shiftDate, decision: 'ignore', confidence: 0.9,
                        reason: `بصمة (${time}) أقدم من انصراف محجوز ${target.checkOut} — بلا قرار ولا إعادة ترتيب، والخام محفوظ في attendance_logs`,
                        punchState, deviceId: device?.id,
                    });
                    await client.query('COMMIT');
                    return { action: 'ignore', record: null, outOfOrder: true };
                }
                const minutes = Math.max(0, Math.round((instant - new Date(target.checkInAt)) / 60000));
                const early = isEarlyLeave(wall.hour, wall.minute, shiftStart, shiftKarim);
                const note = target.checkOut
                    ? `انصراف مُمتدّ ${time} عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`
                    : `تسجيل انصراف عبر ${source}${device ? ` (${device.name || device.deviceName})` : ''}`;
                record = (await client.query(
                    `UPDATE attendance
                        SET "checkOut"=$2, "checkOutAt"=$3, "workMinutes"=$4, early_leave=$5,
                            on_leave=$6, source=$7,
                            notes = COALESCE(notes,'') || ' | ' || $8
                      WHERE id=$1 RETURNING *`,
                    [target.id, time, instant, minutes, early, onLeave, source, note]
                )).rows[0];
                action = 'check_out';
            }

            if (action) {
                try {
                    const { emitDomainEvent } = require('./realtime/producers');
                    await emitDomainEvent(pool, client, 'HR', {
                        eventType: action === 'check_in' ? 'EMPLOYEE_CLOCK_IN' : 'EMPLOYEE_CLOCK_OUT',
                        aggregateType: 'attendance',
                        aggregateId: record ? record.id : `${employeeId}:${shiftDate}`,
                        payload: { employee_id: employeeId, date: shiftDate, time: action === 'check_in' ? record?.checkIn : record?.checkOut, source },
                    });
                } catch (_) { /* البصمة أهم من الحدث */ }
            }
            await client.query('COMMIT');

            if (action && this.io) {
                this.emit('attendance:updated', { action, source, employee: { id: employeeId }, record });
            }
            return { action, record };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            // pino يترك الوسيط النصي الثاني — والرسالة داخل النص هي الدليل الوحيد عند الفشل
            logger.error(`[AttendanceEngine] processPunch failed: employee=${employeeId} date=${shiftDate} `
                + `source=${source} code=${error && error.code ? error.code : '-'} :: ${error && error.message ? error.message : error}`);
            throw error;
        } finally {
            client.release();
        }
    }

    /** سجل التدقيق — يُكتب فقط لما يستحق المراجعة (انصراف يتيم، حالة مجهولة). */
    async logDecision({ employeeId, date, decision, confidence, reason, punchState, deviceId }) {
        try {
            await pool.query(
                `INSERT INTO attendance_decisions (id, "employeeId", date, decision, confidence, reason, punch_state, device_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [Date.now() * 1000 + Math.floor(Math.random() * 999), employeeId, date,
                    decision, confidence, reason, punchState ?? null, deviceId || null]
            );
        } catch (e) { logger.warn('[AttendanceEngine] Failed to log decision:', e.message); }
    }
}

const engine = new AttendanceEngine();

/** مطابقة رقم جهاز بموظف (مصدّر من engine.js الأصلي) — مع حارس الأصفار البادئة. */
function matchUserToEmployee(deviceUserId, byDeviceId, byEmployeeNo) {
    const key = String(deviceUserId).trim();
    let hit = byDeviceId.get(key);
    if (hit != null) {return { employeeId: hit, via: 'device_user_id' };}
    hit = byEmployeeNo.get(key);
    if (hit != null) {return { employeeId: hit, via: 'employee_number' };}
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

module.exports = {
    AttendanceEngine,
    engine,
    instantToWall,
    safeWallTime,
    toMin,
    minutesBetween,
    matchUserToEmployee,
    punchCooldownMs,
    DEFAULT_PUNCH_COOLDOWN_MS,
    BUSINESS_TZ_OFFSET_MS,
};
