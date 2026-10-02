/**
 * backend/shifts-engine.js — محرك الورديات: إدخال + تطبيق + إعادة حساب تلقائي
 * ────────────────────────────────────────────────────────────────────────────
 * المالك يضيف الورديات الصحيحة (نص حر من واتساب أو من شاشة النظام) والمحرك:
 *   1) يحلل كل سطر: موظف (EMP-رقم / رقم بصمة / اسم) + وقت الدخول + الطول أو وقت الخروج
 *   2) يطبّق shift_start / shift_karim على الموظفين المطابقين
 *   3) يعيد حساب كل البيانات المشتقة (late / دقائق التأخير) من البصمات الحقيقية
 *   4) في النهاية يقول «الموظف دا كم ساعة» — تدقيق workedHoursAudit يجمع ما داك
 *      فعليًا من البصمات يومًا بيوم ويقارنه بدوامه المطلوب (10/12 ساعة…)،
 *      وأهم قاعدة: لا يقل عن دوامه (أقل = يوم «ناقص» بفارق الدقائق)
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
            const fpM = line.match(/(?:بصمه|بصمة|بصمه)\s*(\d{1,4})/) || line.match(/^\s*(\d{1,4})\s*[:-]/);
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
    // في النهاية: «الموظف دا كم ساعة؟» — تدقيق الساعات الفعلية مقابل دوامه المطلوب (لا تقل عن دوامه)
    let audit = null;
    try { audit = await workedHoursAudit(month); } catch (e) { logger.error('[SHIFTS] worked-hours audit failed: ' + e.message); }
    const auditById = new Map((audit ? audit.employees : []).map(a => [a.id, a]));
    const auditLines = applied.map(a => (auditById.get(a.id) || {}).line).filter(Boolean).slice(0, 12);
    const summary = {
        parsed: items.length, applied: applied.length, failed: failed.length,
        failures: failed, recompute,
        appliedList: applied.map(a => `${a.name} → ${a.start}/${a.karim}س`),
        audit,
        auditLines,
    };
    logger.info(`[SHIFTS] applied ${applied.length}/${items.length} — recompute late days: ${recompute.lateDaysAfter}`);
    return summary;
}

/** إعادة حساب كل مشتقات الحضور من الورديات الحالية (يدوي + تلقائي بعد التطبيق) */
async function recomputeDerived(graceMin = 0) {
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

// ════════════════════════════════════════════════════════════════════════
// تدقيق ساعات الدوام الفعلية — «الموظف دا كم ساعة؟»
// لكل موظف دوامه المطلوب (shift_karim: 10 أو 12 ساعة…) والمحرك يجمع ما داك
// فعليًا من البصمات يومًا بيوم ويقارنه به. أهم قاعدة: لا يقل عن دوامه —
// أي يوم ما داه أقل من وردية المطلوبة يُعلَّم «ناقص» بفارق الدقائق.
// ════════════════════════════════════════════════════════════════════════

/** دقائق العمل الفعلية بين بصمتَي دخول وخروج (وردية ليلية: خروج أقل من دخول → يعبر منتصف الليل) */
function workedMinutesOf(checkIn, checkOut) {
    const ci = toMinutes(checkIn);
    const co = toMinutes(checkOut);
    if (ci == null || co == null) {return null;}
    return Math.max(0, (co - ci) + (co < ci ? 1440 : 0));
}

/** سطر جاهز للعرض لكل موظف: «احمد: دوام 12س | دا 213س في 18 يوم → تمام» */
function employeeAuditLine(a) {
    const bits = [`دوام ${a.shiftHours}س`, `دا ${a.workedHours}س في ${a.daysCounted} يوم`];
    if (a.completeDays) {bits.push(`كامل ${a.completeDays}`);}
    if (a.shortDays) {bits.push(`ناقص ${a.shortDays} يوم (−${a.shortfallHours}س)`);}
    if (a.openDays) {bits.push(`${a.openDays} يوم مفتوح`);}
    if (a.reviewDays) {bits.push(`${a.reviewDays} يوم مراجعة`);}
    return `${a.name}: ${bits.join(' | ')} → ${a.verdict}`;
}

/** تجميع صفوف حضور خام (JOIN employees) إلى تدقيق ساعات لكل موظف — دالة نقية قابلة للاختبار */
function aggregateWorkedHours(rows) {
    const byEmp = new Map();
    for (const r of rows) {
        let e = byEmp.get(r.id);
        if (!e) {
            e = {
                id: r.id, name: r.name, empNo: r.emp_no || null, fp: r.fp != null ? String(r.fp) : null,
                shiftStart: r.shift_start || null,
                shiftHours: Number(r.shift_hours) > 0 ? Number(r.shift_hours) : 10,
                days: new Map(),
            };
            byEmp.set(r.id, e);
        }
        const ci = toMinutes(r.checkIn), co = toMinutes(r.checkOut);
        if (ci == null && co == null) {continue;}
        let day = e.days.get(r.date);
        if (!day) {e.days.set(r.date, day = { date: r.date, workedMin: 0, open: false, checkIn: null, checkOut: null });}
        if (ci != null && co != null) {
            // أكثر من بصمة في نفس اليوم (وردية مقسمة) → تُجمع دقائقها
            day.workedMin += workedMinutesOf(r.checkIn, r.checkOut);
            if (!day.checkIn || ci < toMinutes(day.checkIn)) {day.checkIn = r.checkIn;}
            if (!day.checkOut || co > toMinutes(day.checkOut)) {day.checkOut = r.checkOut;}
        } else {
            day.open = true;
            if (ci != null && (!day.checkIn || ci < toMinutes(day.checkIn))) {day.checkIn = r.checkIn;}
        }
    }
    const round = (v) => Math.round(v * 100) / 100;
    const out = [];
    for (const e of byEmp.values()) {
        const requiredMin = Math.round(e.shiftHours * 60);
        const agg = { complete: 0, short: 0, open: 0, review: 0, workedMin: 0, shortfallMin: 0, overtimeMin: 0, days: [] };
        for (const d of e.days.values()) {
            const rec = { date: d.date, in: d.checkIn, out: d.checkOut, requiredMin, workedMin: d.workedMin };
            if (d.workedMin > 0) {
                agg.workedMin += d.workedMin;
                if (d.workedMin >= requiredMin) {
                    rec.status = 'تمام';
                    rec.extraMin = d.workedMin - requiredMin;
                    agg.overtimeMin += rec.extraMin;
                    agg.complete += 1;
                } else {
                    rec.status = 'ناقص';
                    rec.deficitMin = requiredMin - d.workedMin;
                    agg.shortfallMin += rec.deficitMin;
                    agg.short += 1;
                }
            } else if (d.open) {
                rec.status = 'مفتوح'; // دخول بلا بصمة خروج — لا يُحكم عليه بعد
                agg.open += 1;
            } else {
                rec.status = 'مراجعة'; // دخول = خروج (بصمة مكررة بصفر ساعات) — قيد المراجعة
                agg.review += 1;
            }
            agg.days.push(rec);
        }
        agg.days.sort((a, b) => (a.date < b.date ? -1 : 1));
        const daysCounted = agg.complete + agg.short;
        const item = {
            id: e.id, name: e.name, empNo: e.empNo, fp: e.fp,
            shiftStart: e.shiftStart, shiftHours: e.shiftHours,
            daysCounted,
            completeDays: agg.complete, shortDays: agg.short, openDays: agg.open, reviewDays: agg.review,
            workedHours: round(agg.workedMin / 60),
            requiredHours: round((daysCounted * requiredMin) / 60),
            shortfallHours: round(agg.shortfallMin / 60),
            overtimeHours: round(agg.overtimeMin / 60),
            days: agg.days,
        };
        item.verdict = agg.short > 0 ? 'ناقص' : agg.open > 0 ? 'بانتظار الانصراف' : agg.review > 0 ? 'قيد المراجعة' : 'تمام';
        item.line = employeeAuditLine(item);
        out.push(item);
    }
    const rank = { 'ناقص': 0, 'بانتظار الانصراف': 1, 'قيد المراجعة': 2, 'تمام': 3 };
    out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.shortfallHours - a.shortfallHours || String(a.name).localeCompare(String(b.name), 'ar'));
    return out;
}

/** تدقيق ساعات الدوام الفعلية لشهر كامل: الموظف دا كم ساعة مقابل دوامه المطلوب (قراءة فقط) */
async function workedHoursAudit(month) {
    const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : String(new Date().toISOString().slice(0, 7));
    const rows = (await pool.query(
        `SELECT e.id, e.name, e."employeeId" AS emp_no, e."deviceUserId" AS fp, e.shift_start,
                COALESCE(e.shift_karim, 10) AS shift_hours,
                a.date, a."checkIn", a."checkOut"
           FROM employees e JOIN attendance a ON a."employeeId" = e.id
          WHERE a.date LIKE $1 AND e.status = 'active'
          ORDER BY e.id, a.date`, [m + '%']
    )).rows;
    const employees = aggregateWorkedHours(rows);
    const notOk = employees.filter(x => x.verdict === 'ناقص');
    const pending = employees.filter(x => x.verdict !== 'تمام' && x.verdict !== 'ناقص');
    const summaryLine = notOk.length
        ? `الدوام غير تمام ✗ — ناقص عند ${notOk.length} من ${employees.length} موظف`
        : pending.length
            ? `الدوام تمام حتى الآن ✓ — ${pending.length} موظف بانتظار انصراف/مراجعة`
            : `الدوام تمام ✓ لكل ${employees.length} موظف`;
    logger.info(`[SHIFTS] worked-hours audit ${m}: ${employees.length} employees, short ${notOk.length}, allOk=${notOk.length === 0}`);
    return { month: m, analyzed: employees.length, allOk: notOk.length === 0, summaryLine, employees };
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

module.exports = { parseShiftLines, applyShiftText, recomputeDerived, realityAnalysis, workedHoursAudit, aggregateWorkedHours, workedMinutesOf, resolveEmployee, norm };
