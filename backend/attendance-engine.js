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
 *   • أطراف اليوم من بصمات الموظف: أقدم بصمة في يوم الوردية = دخول، وأحدثها = انصراف.
 *   • البطاقة للوقت فقط (بداية الدوام ومدّة الوردية): لا دخل لها في اتجاه البصمة.
 *   • ملصق حالة الجهاز (دخول/انصراف) لا يُقرأ أصلًا: هو سبب ضياع انصرافات حقيقية
 *     وأيتام «انصراف بلا دخول» يوم 2026-11-05، والحاكم أطراف بصمات اليوم نفسه.
 *   • لا بصمة ⇒ لا صف: لا يُخترع انصراف ولا حضور من فراغ —
 *     صفٌ بلا انصراف يبقى مفتوحًا ويظهر «بلا انصراف» حتى تأتي بصمته الحقيقية.
 *   • لا حراس ولا استثناءات: المعادلة لا تعتمد على ترتيب وصول البصمات، فتكرار نفس
 *     البصمة لا يغيّر شيئًا — بلا نافذة تبريد ولا كاش ولا مفتاح بيئة (قرار المالك
 *     2026-11-05: «مش عايز تقيدات ولا شفاعات ولا حراس؛ بصم تظهر، مش بصم مش تظهر»).
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

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh (UTC+3، بلا تغيير موسمي)

function pad2(n) { return String(n).padStart(2, '0'); }

/** ثانية واحدة = بصمة واحدة. النسخ المتزامنة من نفس البصمة تختلف بأجزاء الثانية. */
function sameSecond(a, b) {
    if (!a || !b) {return !a && !b;}
    return Math.floor(new Date(a).getTime() / 1000) === Math.floor(new Date(b).getTime() / 1000);
}

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
     * بصمة واحدة ← يوم الموظف. البصمة هي الحقيقة، وأطراف اليوم من بصماته هو:
     *   • دخول اليوم = أقدم بصمة في يوم الوردية، وانصرافه = أحدث بصمة فيه.
     *   • يوم الوردية من ساعة البصمة وبطاقة الموظف — بصمة الفجر لوردية تعبر
     *     الليل تُحسب على يومها لا على يوم التقويم (قاعدة shift-day، وانصراف الليل
     *     لبطاقةٍ ساعاتُها لا تبلغ منتصف الليل يُغلِق يومَها المفتوح).
     *   • بلا بصمة ⇒ بلا صف: لا انصراف يُختلق ولا حضور يُشتق — والصف المفتوح
     *     يبقى مفتوحًا ويظهر «بلا انصراف» حتى تأتي بصمته الحقيقية.
     *   • لا حراس: إعادة تطبيق نفس البصمة لا تغيّر شيئًا (المعادلة لا ترتبط
     *     بترتيب الورود)، ولا نافذة زمنية ولا كاش ولا ملصق جهاز — بلا استثناء.
     */
    // ملاحظة: punchState ليست في قائمة الوسائط — ملصق حالة الجهاز لا يُقرأ إطلاقًا.
    async processPunch({ employeeId, instant, wall, device, source = 'device', forDate = null }) {
        const shift = await this.getEmployeeShift(employeeId, forDate || undefined);
        if (!shift) {return { action: null, error: 'Employee not found' };}

        const { shiftStart, shiftKarim } = shift;
        instant = new Date(instant);
        if (!wall || typeof wall.date !== 'string') {wall = instantToWall(instant);}

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // قفل لكل موظف (hashtext لا غير: معرّفات سبعة تجاوزت int4 ⇒ 22003 ⇒ البصمة تضيع).
            // قفل واحد لكل البصمة — لا ازدواج ولا طرق موت، والصفوف تُقرأ بعده مباشرة.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [String(employeeId)]);

            let day = shiftDateForEmployee(wall.date, wall.hour,
                { shift_start: shiftStart, shift_karim: shiftKarim });

            // انصراف الليل: بطاقةٌ لا تمتد ساعاتُها عبر منتصف الليل (١٣:٠٠+٩ مثلًا) تقطع
            // الوردية إلى نصفين — بصمة الفجر تصير «دخول يوم جديد». إن كان أمس مفتوحًا
            // (دخول بلا انصراف) وبصمتُنا قبل الظهر وفي مدى ساعات وردية معقولة بعدها،
            // فهي انصرافُ أمس. قاعدة يومٍ لا حارس بصمة: البصمة تُحجز دائمًا، على يومها.
            if (day === wall.date && wall.hour < 12) {
                const prev = await client.query(
                    `SELECT date, "checkInAt" FROM attendance
                      WHERE "employeeId" = $1 AND date = $2
                        AND "checkIn" IS NOT NULL AND "checkOut" IS NULL LIMIT 1 FOR UPDATE`,
                    [employeeId, prevDay(day)]);
                const p = prev.rows[0];
                if (p) {
                    const spanMin = (instant - new Date(p.checkInAt)) / 60000;
                    if (spanMin >= 0 && spanMin <= (Number(shiftKarim) || 8) * 60 + 240) {day = p.date;}
                }
            }

            // الصفتان معًا لقراءة واحدة: صف يوم الوردية (يُبنى) وصف يومه السابق
            // (دليل الهوية فقط — بصمة محجوزة هناك ليست بصمة جديدة هنا).
            const days = await client.query(
                `SELECT * FROM attendance WHERE "employeeId" = $1 AND date IN ($2, $3)
                  ORDER BY date DESC FOR UPDATE`,
                [employeeId, day, prevDay(day)]);
            const row = days.rows.find(r => r.date === day) || null;
            const prevRow = days.rows.find(r => r.date !== day) || null;

            // هوية البصمة لا حارس عليها: نفس الثانية من طرفٍ محفوظ = نفس البصمة،
            // فنسختان منها (جهاز + كاميرا، أو إعادة مزامنة) لا تصنعان انصرافًا ولا
            // صفًّا لليوم التالي — «دخول الخميس المتخلَّق» 2026-11-05 كان كذلك.
            const dup = [row, prevRow].filter(Boolean).find(r =>
                sameSecond(r.checkInAt, instant) || sameSecond(r.checkOutAt, instant));
            if (dup) {
                await client.query('COMMIT');
                return { action: dup.checkOut ? 'check_out' : 'check_in', record: dup, changed: false, day: dup.date };
            }

            // الإجازة المعتمدة تُعلَّم على يومها — وصف، لا بصمة ولا استكمال
            const onLeave = await this.isOnLeave(employeeId, day);

            // ── أطراف اليوم من بصمات الموظف وحدها — لا ترتيب ورود ولا ملصق يحكم ──
            // أطراف الصف المحجوزة + هذه البصمة: أقدمُها الدخول وأحدثُها الانصراف.
            // المعادلة لا تعتمد على أيهما وصل أولًا، فتأخر مزامنة بصمة لا يبتلعها.
            const points = [row && row.checkInAt, row && row.checkOutAt, instant]
                .filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b);
            const entryAt = points[0];
            const exitAt = points.length > 1 ? points[points.length - 1] : null;

            const inWall = instantToWall(entryAt);
            const outWall = exitAt ? instantToWall(exitAt) : null;
            const lateFlag = isLate(inWall.hour, inWall.minute, shiftStart, 9);
            const early = outWall ? isEarlyLeave(outWall.hour, outWall.minute, shiftStart, shiftKarim) : false;
            const minutes = exitAt ? Math.max(0, Math.round((exitAt - entryAt) / 60000)) : null;

            // أطراف لا تتغير ⇒ لا كتابة: بصمة وسط اليوم لا تعيد رسمه
            if (row && sameSecond(row.checkInAt, entryAt) && sameSecond(row.checkOutAt, exitAt)) {
                await client.query('COMMIT');
                return { action: row.checkOut ? 'check_out' : 'check_in', record: row, changed: false, day };
            }

            const note = `بصمة ${source}${device ? ` (${device.name || device.deviceName})` : ''}: `
                + `دخول ${inWall.time}` + (outWall ? ` وانصراف ${outWall.time}` : ' — بلا انصراف حتى الآن');

            let record;
            if (row) {
                record = (await client.query(
                    `UPDATE attendance
                        SET "checkIn"=$2, "checkInAt"=$3, "checkOut"=$4, "checkOutAt"=$5,
                            "workMinutes"=$6, late=$7, early_leave=$8, on_leave=$9, source=$10, notes=$11
                      WHERE id=$1 RETURNING *`,
                    [row.id, inWall.time, entryAt, outWall ? outWall.time : null, exitAt,
                        minutes, lateFlag, early, onLeave, source, note]
                )).rows[0];
            } else {
                const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
                record = (await client.query(
                    `INSERT INTO attendance (id, "employeeId", date, "checkIn", "checkOut", "checkInAt",
                        "checkOutAt", "workMinutes", late, early_leave, notes, source, on_leave)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                    [id, employeeId, day, inWall.time, outWall ? outWall.time : null, entryAt, exitAt,
                        minutes, lateFlag, early, note, source, onLeave]
                )).rows[0];
            }
            // القرار يصف ما فعلته هذه البصمة بالتحديد: صارت دخول اليوم أم انصرافه
            const action = sameSecond(entryAt, instant) ? 'check_in' : 'check_out';

            try {
                const { emitDomainEvent } = require('./realtime/producers');
                await emitDomainEvent(pool, client, 'HR', {
                    eventType: action === 'check_in' ? 'EMPLOYEE_CLOCK_IN' : 'EMPLOYEE_CLOCK_OUT',
                    aggregateType: 'attendance',
                    aggregateId: record.id,
                    payload: { employee_id: employeeId, date: day,
                        time: action === 'check_in' ? record.checkIn : record.checkOut, source },
                });
            } catch (_) { /* البصمة أهم من الحدث */ }
            await client.query('COMMIT');

            if (this.io) {
                this.emit('attendance:updated', { action, source, employee: { id: employeeId }, record });
            }
            return { action, record, day, changed: true };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            // pino يترك الوسيط النصي الثاني — والرسالة داخل النص هي الدليل الوحيد عند الفشل
            logger.error(`[AttendanceEngine] processPunch failed: employee=${employeeId} `
                + `source=${source} code=${error && error.code ? error.code : '-'} :: ${error && error.message ? error.message : error}`);
            throw error;
        } finally {
            client.release();
        }
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
    BUSINESS_TZ_OFFSET_MS,
};
