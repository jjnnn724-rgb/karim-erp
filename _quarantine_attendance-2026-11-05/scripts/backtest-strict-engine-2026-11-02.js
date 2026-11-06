/**
 * backtest-strict-engine-2026-11-02.js — إعادة تشغيل البصمات الخام على المحرك الواحد
 * ───────────────────────────────────────────────────────────────────────────────────
 * قراءة فقط (لا كتابة): يمرّر بصمات attendance_logs الأخيرة عبر classifyPunch بنفس
 * المدخلات التي يبنيها processPunch، ثم يقارن ما كان سيُكتب بما هو مكتوب فعلًا.
 * الهدف: قياس كم بصمة كانت تُصنَّف بالحدس، وكم واحدة تُعلَّم للمراجعة الآن، والتأكد
 * أن لا انصراف مُختلَق ولا دخول بالزمن يبقى في المسار الحي.
 *
 * التشغيل: node scripts/backtest-strict-engine-2026-11-02.js [عددالأيام]
 */
'use strict';

const { pool } = require('../backend/shared-pool');
const { classifyPunch, instantToWall, shiftDateForEmployee, prevDay } = require('../backend/attendance-engine');

const DAYS = Math.min(30, Number(process.argv[2]) || 7);

/** محاكاة سطر attendance كما يكتبه المحرك */
class Row {
    constructor(shiftDate, checkInAt) {
        this.date = shiftDate;
        this.checkInAt = checkInAt;
        this.checkIn = checkInAt ? instantToWall(new Date(checkInAt)).time : null;
        this.checkOutAt = null;
        this.checkOut = null;
    }
    close(instant) {
        this.checkOutAt = instant;
        this.checkOut = instantToWall(new Date(instant)).time;
    }
}

/** يطابق ما يجلبه processPunch: أحدث صف مفتوح له دخول، من يوم الوردية أو اليوم السابق */
function findOpen(rowsByDate, shiftDate) {
    let best = null;
    for (const key of [shiftDate, prevDay(shiftDate)]) {
        const row = rowsByDate.get(key);
        if (row && row.checkIn && !row.checkOut) {best = row;break;}
    }
    return best;
}

function shiftDateOfOpenRow(row, shift) {
    if (!row.checkInAt) {return null;}
    const w = instantToWall(new Date(row.checkInAt));
    return shiftDateForEmployee(w.date, w.hour, shift);
}

async function main() {
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
    const emps = (await pool.query(
        `SELECT id, "employeeId", name, shift_start, shift_karim FROM employees`
    )).rows;
    const shiftOf = new Map(emps.map((e) => [String(e.id), { shift_start: e.shift_start, shift_karim: e.shift_karim }]));
    const nameOf = new Map(emps.map((e) => [String(e.id), `${e.employeeId || ''} ${e.name || ''}`.trim()]));

    const logs = (await pool.query(
        `SELECT "employeeId", "attendanceTime", "punchState" FROM attendance_logs
          WHERE "employeeId" IS NOT NULL AND "attendanceTime" >= $1
          ORDER BY "employeeId", "attendanceTime"`,
        [since]
    )).rows;

    const actual = (await pool.query(
        `SELECT "employeeId", date, "checkIn", "checkOut", "checkInAt", "checkOutAt",
                checkin_inferred, checkout_inferred, "workMinutes"
           FROM attendance WHERE date >= $1`,
        [since.toISOString().slice(0, 10)]
    )).rows;
    const actualKey = new Map(actual.map((r) => [`${r.employeeId}|${r.date}`, r]));

    const byEmp = new Map();
    for (const l of logs) {
        const k = String(l.employeeId);
        if (!byEmp.has(k)) {byEmp.set(k, []);}
        byEmp.get(k).push(l);
    }

    const verdicts = new Map();
    const reviewFlags = [];
    const simRows = [];
    let punches = 0;

    for (const [empId, rows] of byEmp) {
        const base = shiftOf.get(empId) || { shift_start: '09:00', shift_karim: 9 };
        const shift = { shift_start: base.shift_start || '09:00', shift_karim: Number(base.shift_karim) || 9 };
        /** يوم الوردية → سطر (محاكاة جدول attendance للعامل) */
        const rowsByDate = new Map();
        let lastPunch = null;

        for (const l of rows) {
            const instant = new Date(l.attendanceTime).getTime();
            if (!Number.isFinite(instant)) {continue;}
            punches++;
            const wall = instantToWall(new Date(instant));
            const shiftDate = shiftDateForEmployee(wall.date, wall.hour, shift);
            const open = findOpen(rowsByDate, shiftDate);
            const verdict = classifyPunch({
                punchState: l.punchState,
                wallMin: wall.hour * 60 + wall.minute,
                punchAt: instant,
                hasOpenRow: !!open,
                openRowCheckIn: open ? open.checkIn : null,
                openRowCheckInAt: open && open.checkInAt ? Number(open.checkInAt) : null,
                openRowShiftDate: open ? shiftDateOfOpenRow(open, shift) : null,
                currentShiftDate: shiftDate,
                lastPunch,
            });
            const tag = `${verdict.action}${verdict.review ? ' (مراجعة)' : ''}: ${verdict.reason}`;
            verdicts.set(tag, (verdicts.get(tag) || 0) + 1);

            if (verdict.action === 'in') {
                if (!rowsByDate.has(shiftDate) || !rowsByDate.get(shiftDate).checkIn) {
                    const row = rowsByDate.get(shiftDate) || new Row(shiftDate, null);
                    row.checkInAt = instant; row.checkIn = wall.time;
                    rowsByDate.set(shiftDate, row);
                }
                lastPunch = { min: wall.hour * 60 + wall.minute, out: false, at: instant };
            } else if (verdict.action === 'out') {
                if (open) {
                    if (instant > open.checkInAt) {open.close(instant);}
                } else {
                    const orphan = new Row(shiftDate, null);
                    orphan.close(instant);
                    rowsByDate.set(shiftDate, orphan);
                }
                lastPunch = { min: wall.hour * 60 + wall.minute, out: true, at: instant };
            }
            if (verdict.review) {
                reviewFlags.push({ emp: nameOf.get(empId) || empId, when: `${wall.date} ${wall.time}`, state: l.punchState, reason: verdict.reason });
            }
        }
        for (const row of rowsByDate.values()) {
            if (row.checkIn || row.checkOut) {simRows.push({ empId, ...row });}
        }
    }

    // مقارنة بالسطر المكتوب فعلًا
    let mismatch = 0, inventedExit = 0, openNow = 0, simOpen = 0;
    const diffs = [];
    const simKey = new Map(simRows.map((r) => [`${r.empId}|${r.date}`, r]));
    for (const [key, sim] of simKey) {
        const act = actualKey.get(key);
        if (!act) {continue;}
        if (act.checkout_inferred) {inventedExit++;}
        if (act.checkOut && !sim.checkOut) {openNow++;}
        if (!act.checkOut && !sim.checkOut) {simOpen++;}
        const aIn = act.checkIn || '-', aOut = act.checkOut || '-';
        const sIn = sim.checkIn || '-', sOut = sim.checkOut || '-';
        if (aIn !== sIn || aOut !== sOut) {
            mismatch++;
            if (diffs.length < 25) {diffs.push(`${key.split('|')[0]} ${key.split('|')[1]}: مكتوب ${aIn}→${aOut}${act.checkout_inferred ? ' [مختلَق]' : ''} | صارم ${sIn}→${sOut}`);}
        }
    }

    const pct = (n) => `${((n / Math.max(1, punches)) * 100).toFixed(1)}%`;
    console.log(`\n════ المحرك الواحد على ${punches} بصمة خام (${DAYS} يومًا) ═══════════════════════`);
    console.log('\nتوزيع القرارات الصارمة:');
    [...verdicts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)} (${pct(n)})  ${k}`));
    console.log(`\nمعلَّمة للمراجعة: ${reviewFlags.length}`);
    reviewFlags.slice(0, 12).forEach((f) => console.log(`  ${f.emp} | ${f.when} | حالة ${f.state} | ${f.reason}`));
    console.log(`\nمقارنة مع السطر المكتوب فعلًا (${simKey.size} سطر محاكى):`);
    console.log(`  اختلاف في الطرفين: ${mismatch}`);
    console.log(`  صفوف مكتوبة بانصراف مُختلَق (checkout_inferred) كان المحرك الجديد سيتركها مفتوحة/خالية: ${inventedExit}`);
    console.log(`  صفوف مفتوحة اليوم في القاعدة رغم وجود بصمة خروج: ${openNow}`);
    console.log(`  صفوف يتركها المحرك الصارم مفتوحة (بلا بصمة خروج): ${simOpen}`);
    if (diffs.length) {
        console.log('\nعيّنة فروقات:');
        diffs.forEach((d) => console.log('  ' + d));
    }

    // قضية EMP-052 + ريان عادل: ما الذي كان سيُكتب؟
    const focus = (no) => {
        const emp = emps.find((e) => String(e.employeeId) === String(no));
        if (!emp) {return console.log(`\n${no}: غير موجود`);}
        const mine = simRows.filter((r) => String(r.empId) === String(emp.id));
        console.log(`\nرقم ${no} (${nameOf.get(String(emp.id))}) — محاكاة المحرك الصارم:`);
        mine.sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .forEach((r) => console.log(`  ${r.date}: ${r.checkIn || '—'} → ${r.checkOut || 'بلا بصمة خروج'}`));
        console.log(`  المكتوب فعلًا:`);
        actual.filter((a) => String(a.employeeId) === String(emp.id))
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .forEach((a) => console.log(`  ${a.date}: ${a.checkIn || '—'} → ${a.checkOut || 'مفتوح'}${a.checkout_inferred ? ' [مختلَق]' : ''}`));
    };
    focus('EMP-052');
    await pool.end();
}

main().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
