/**
 * backend/shifts-engine.js — محرك الورديات: إدخال + تطبيق + إعادة حساب تلقائي
 * ────────────────────────────────────────────────────────────────────────────
 * المالك يضيف الورديات الصحيحة (نص حر من واتساب أو من شاشة النظام) والمحرك:
 *   1) يحلل كل سطر: موظف (EMP-رقم / رقم بصمة / اسم) + وقت الدخول + الطول أو وقت الخروج
 *   2) يطبّق shift_start / shift_karim على الموظفين المطابقين
 *   3) يعيد حساب كل البيانات المشتقة (late / دقائق التأخير) من البصمات الحقيقية
 * صيغ مقبولة لكل سطر:
 *   EMP-019: 16:00 12          (رقم + دخول + طول بالساعات)
 *   بصمة 45: 04:00 - 16:00     (بصمة + دخول - خروج)
 *   احمد السيد العدوي 16:00 12س (اسم + دخول + طول)
 */
'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');

function norm(s) {
    return String(s || '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim().replace(/\s+/g, ' ');
}

function toMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {return null;}
    const H = Number(m[1]), M = Number(m[2]);
    if (H > 23 || M > 59) {return null;}
    return H * 60 + M;
}

/** تحليل نص الورديات (متعدد الأسطر أو سطر واحد بفواصل EMP) إلى عناصر منظمة */
function parseShiftLines(text) {
    const raw = String(text || '').replace(/\r/g, '');
    let lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    // لو الرسالة وصلت في سطر واحد: قسّم على رموز الموظف EMP
    if (lines.length === 1 && /EMP[-\s]?\d+/i.test(lines[0])) {
        lines = lines[0].split(/(?=EMP[-\s]?\d+)/i).map(l => l.trim()).filter(l => l);
    }
    const items = [], errors = [];
    for (const line of lines) {
        if (!line || /^(ورديات|الورديات)\b/.test(line)) {continue;}
        // الوقت الأول = الدخول
        const startM = line.match(/(\d{1,2}:\d{2})/);
        if (!startM) {
            // لا وقت → لو السطر يحمل اسمًا مع رقم EMP فقط بدون وقت تجاهله
            errors.push(`سطر بدون وقت دخول: «${line.slice(0, 40)}»`);
            continue;
        }
        const start = startM[1];
        const afterStart = line.slice((startM.index || 0) + startM[1].length);
        // الطول: «12 س» / «12ساعة» / «/ 12» أو وقت خروج «- 16:00»
        let karim = null;
        const durM = afterStart.match(/^\s*[-–—]?\s*(\d{1,2}(?:\.\d)?)\s*(?:س|ساعة|ساعات|س\u0648\u0627\u062a|h\b)?/i);
        const endM = afterStart.match(/[-–—]\s*(\d{1,2}:\d{2})/);
        if (endM) {
            const a = toMinutes(start), b = toMinutes(endM[1]);
            if (a != null && b != null) {karim = Math.round((((b - a) + 1440) % 1440) / 6) / 10;}
        } else if (durM && durM[1] != null && Number(durM[1]) > 0) {
            karim = Number(durM[1]);
        }
        if (karim != null && (karim < 2 || karim > 20)) {karim = null;}
        // رمز الموظف: EMP-رقم أو رقم بصمة أو الاسم المتبقي
        let token = null;
        const empM = line.match(/EMP[-\s]?(\d{1,4})/i);
        if (empM) {token = 'emp:' + empM[1];}
        if (!token) {
            const fpM = line.match(/(?:بصمه|بصمة|بصمه)\s*(\d{1,4})/) || line.match(/^\s*(\d{1,4})\s*[:\-]/);
            if (fpM) {token = 'fp:' + fpM[1];}
        }
        if (!token) {
            const namePart = line.slice(0, (startM.index || 0)).replace(/EMP[-\s]?\d+|بصمه\s*\d+|بصمة\s*\d+|[:\-–—]/g, ' ').trim();
            if (namePart.length >= 2) {token = 'name:' + namePart;}
        }
        if (!token) {errors.push(`سطر بدون موظف محدد: «${line.slice(0, 40)}»`); continue;}
        items.push({ token, start, karim });
    }
    return { items, errors };
}

/** مطابقة رمز الموظف → صف الموظف (EMP-رقم / بصمة / اسم) */
async function resolveEmployee(token) {
    const [kind, ...rest] = token.split(':');
    const value = rest.join(':').trim();
    if (kind === 'emp') {
        const r = await pool.query(`SELECT id, name, "employeeId" AS emp_no, "deviceUserId" AS fp, "shift_start" AS cur_start, COALESCE("shift_karim",10) AS cur_karim FROM employees WHERE "employeeId" = $1 OR "employeeId" ILIKE $2 LIMIT 2`, [value, 'EMP-' + value]);
        if (r.rows.length) {return r.rows[0];}
    }
    if (kind === 'fp') {
        const r = await pool.query(`SELECT id, name, "employeeId" AS emp_no, "deviceUserId" AS fp, "shift_start" AS cur_start, COALESCE("shift_karim",10) AS cur_karim FROM employees WHERE "deviceUserId"::text = $1 LIMIT 2`, [value]);
        if (r.rows.length) {return r.rows[0];}
    }
    if (kind === 'name') {
        const emps = (await pool.query(`SELECT id, name, "employeeId" AS emp_no, "deviceUserId" AS fp, "shift_start" AS cur_start, COALESCE("shift_karim",10) AS cur_karim FROM employees WHERE status='active' ORDER BY id LIMIT 800`)).rows;
        const q = norm(value);
        const hits = emps.filter(e => { const n = norm(e.name); return n && (n.includes(q) || q.includes(n)); }).slice(0, 2);
        if (hits.length) {return hits[0];}
    }
    return null;
}

/** تطبيق قائمة ورديات + إعادة حساب مشتقات الحضور */
async function applyShiftText(text, month) {
    const { items, errors } = parseShiftLines(text);
    const applied = [], failed = [];
    for (const it of items) {
        try {
            const emp = await resolveEmployee(it.token);
            if (!emp) {failed.push(`${it.token}: لا يوجد موظف مطابق`); continue;}
            await pool.query(
                `UPDATE employees SET "shift_start" = $1, "shift_karim" = $2 WHERE id = $3`,
                [it.start, it.karim != null ? it.karim : emp.cur_karim, emp.id]
            );
            applied.push({ id: emp.id, name: emp.name, start: it.start, karim: it.karim != null ? it.karim : emp.cur_karim });
        } catch (e) {failed.push(`${it.token}: ${e.message.slice(0, 60)}`);}
    }
    const recompute = await recomputeDerived();
    const summary = {
        parsed: items.length, applied: applied.length, failed: failed.length,
        failures: failed, recompute,
        appliedList: applied.map(a => `${a.name} → ${a.start}/${a.karim}س`),
    };
    logger.info(`[SHIFTS] applied ${applied.length}/${items.length} — recompute late days: ${recompute.lateDays}`);
    return summary;
}

/** إعادة حساب كل مشتقات الحضور من الورديات الحالية (يدوي + تلقائي بعد التطبيق) */
async function recomputeDerived(graceMin = 10) {
    const before = (await pool.query(
        `SELECT count(*)::int AS late_days, COALESCE(SUM(GREATEST(0,
            (split_part(a."checkIn",':',1)::int*60 + split_part(a."checkIn",':',2)::int)
          - (split_part(e."shift_start",':',1)::int*60 + split_part(e."shift_start",':',2)::int))),0)::int AS late_min
         FROM attendance a JOIN employees e ON e.id = a."employeeId" WHERE a.late AND a."checkIn" IS NOT NULL`
    )).rows[0];
    const upd = await pool.query(
        `UPDATE attendance a SET late = CASE
            WHEN a."checkIn" IS NULL THEN false
            ELSE (split_part(a."checkIn",':',1)::int*60 + split_part(a."checkIn",':',2)::int)
               > (split_part(e."shift_start",':',1)::int*60 + split_part(e."shift_start",':',2)::int) + $1
         END
         FROM employees e WHERE e.id = a."employeeId"`, [graceMin]
    );
    const after = (await pool.query(
        `SELECT count(*)::int AS late_days, COALESCE(SUM(GREATEST(0,
            (split_part(a."checkIn",':',1)::int*60 + split_part(a."checkIn",':',2)::int)
          - (split_part(e."shift_start",':',1)::int*60 + split_part(e."shift_start",':',2)::int))),0)::int AS late_min
         FROM attendance a JOIN employees e ON e.id = a."employeeId" WHERE a.late AND a."checkIn" IS NOT NULL`
    )).rows[0];
    return {
        rowsScanned: upd.rowCount,
        lateDaysBefore: before.late_days, lateDaysAfter: after.late_days,
        lateMinutesBefore: before.late_min, lateMinutesAfter: after.late_min,
    };
}

/** تحليل واقع البصمة: الوردية الفعلية لكل موظف مقابل المسجلة (قراءة فقط) */
async function realityAnalysis(month) {
    const rows = (await pool.query(
        `SELECT e.id, e.name, e."shift_start" AS cur, a.date, a."checkIn"
           FROM employees e JOIN attendance a ON a."employeeId" = e.id
          WHERE a.date LIKE $1 AND e.status = 'active' AND a."checkIn" IS NOT NULL`, [month + '%']
    )).rows;
    const byEmp = new Map();
    for (const r of rows) {
        if (!byEmp.has(r.id)) {byEmp.set(r.id, { name: r.name, cur: r.cur, ins: [] });}
        const m = String(r.checkIn || '').match(/^(\d{1,2}):(\d{2})$/);
        if (m) {byEmp.get(r.id).ins.push(Number(m[1]) * 60 + Number(m[2]));}
    }
    const out = [];
    for (const [id, b] of byEmp) {
        if (b.ins.length < 5) {continue;}
        const sorted = [...b.ins].sort((a, c) => a - c);
        const p25 = sorted[Math.floor(sorted.length * 0.25)];
        const med = sorted[Math.floor(sorted.length / 2)];
        const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const curMin = /^(\d{1,2}):(\d{2})$/.test(b.cur || '') ? Number(RegExp.$1) * 60 + Number(RegExp.$2) : 540;
        out.push({ id, name: b.name, days: b.ins.length, current: fmt(curMin), realityP25: fmt(p25), medianIn: fmt(med), driftMinutes: med - curMin });
    }
    out.sort((a, b) => Math.abs(b.driftMinutes) - Math.abs(a.driftMinutes));
    return { month, analyzed: out.length, wrong: out.filter(x => Math.abs(x.driftMinutes) >= 30).length, items: out.slice(0, 200) };
}

module.exports = { parseShiftLines, applyShiftText, recomputeDerived, realityAnalysis, resolveEmployee, norm };
