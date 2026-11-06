'use strict';
/**
 * zk-repair-gaps.js — استعادة صفوف الحضور الناقصة من سجل بصمات الجهاز
 * ═══════════════════════════════════════════════════════════════════════
 * ما يعالجه:
 *   البصمةُ تصل `attendance_logs` (خام، committed منفصل) ثم يفشل ربطُها
 *   بصفِّ حضور (خطأ SQL / إسقاط الدورة / إعادة تشغيل السيرفر) — فلا يعيد
 *   المحركُ كتابةَها أبدًا: دورةُ المزامنة التالية تصطدم بالقيد الفريد
 *   (DO NOTHING) فلا تُدرج السطرَ فيُعاد ربطُه. النتيجةُ بصمةٌ في الجهاز
 *   بلا صفِّ حضور في النظام، أي يومُ موظفٍ ناقصٌ في كشف الرواتب.
 *
 * لماذا هذا المِصلح (وليس تعديلٌ مباشر):
 *   1. مصدرُه تقريرُ المطابقة نفسه (backend/attendance-reconciliation.js)
 *      الذي تراه الواجهة — فما يُصلَح هو ما يُعرض على المدير لا ما نخترعه.
 *   2. «تملأ ولا تكرّر» (fill-only): لا يلمس صفًّا موجودًا أبدًا.
 *   3. لا يومَ قبل أن يبدأ النظامُ يسجّل الحضور (أولُ صفٍّ في الجدول)
 *      — فالحضورُ قبل ذلك ليس يومَ موظفٍ في هذا النظام أصلًا.
 *   4. لا فترةٍ محاسبيةً مقفلة (قفلُ الرواتب يحمي الاعتماد المالي).
 *   5. كلُّ صفٍّ يُنشأ يترك سطرَ تدقيق (attendance_edit_log): من ومتى ولماذا.
 *
 * التشغيل:
 *   node scripts/zk-repair-gaps.js --dry-run --days=70      (افتراضي: تجربة)
 *   node scripts/zk-repair-gaps.js --apply --days=70
 *   node scripts/zk-repair-gaps.js --apply --from=2026-08-31 --to=2026-11-02
 */
const { pool } = require('../backend/shared-pool');
const {
    engine, instantToWall, shiftDateForEmployee,
    loadShiftHistoryMap, resolveShiftAt,
} = require('../backend/attendance-engine');
const { deviceSystemReconciliation } = require('../backend/attendance-reconciliation');
const { recordAttendanceEdit } = require('../backend/attendance-governance');
const { isPeriodClosed } = require('../backend/accounting-periods');

const REASON = 'استعادة صفّ حضور من سجل بصمات الجهاز — تدقيق بصمة';

/** Historic attendance rows the ERP never recorded (before coverage) are not employee days. */
function coverageStart() {
    return pool.query(
        `SELECT MIN("date"::date)::text AS first_row FROM attendance
          WHERE "date" ~ '^\\d{4}-\\d{2}-\\d{2}$'`
    ).then((r) => (r.rows[0] && r.rows[0].first_row ? String(r.rows[0].first_row).slice(0, 10) : null));
}

function parseArgs(argv) {
    const out = { days: 70, from: '', to: '', apply: false, limit: 0, employee: '' };
    for (const a of argv) {
        if (a === '--apply') {out.apply = true;}
        else if (a === '--dry-run') {out.apply = false;}
        else if (a.startsWith('--days=')) {out.days = Number(a.slice(7)) || out.days;}
        else if (a.startsWith('--from=')) {out.from = a.slice(7);}
        else if (a.startsWith('--to=')) {out.to = a.slice(5);}
        else if (a.startsWith('--limit=')) {out.limit = Number(a.slice(8)) || 0;}
        else if (a.startsWith('--employee=')) {out.employee = String(a.slice(11)).trim();}
    }
    return out;
}

const p2 = (n) => String(n).padStart(2, '0');
function shiftDays(dateStr, days) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

/** instants bounding a shift day (a night shift starts the evening before). */
function dayWindow(dateStr) {
    const from = `${shiftDays(dateStr, -1)}T00:00:00+03:00`;
    const to = `${shiftDays(dateStr, 1)}T00:00:00+03:00`;
    return [new Date(from), new Date(to)];
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const from = args.from || shiftDays(today, -args.days);
    const to = args.to || today;

    console.log(`[REPAIR] المدى ${from} → ${to} · الوضع ${args.apply ? 'تطبيق' : 'تجريبي (لم يُكتب شيء)'}`);

    const coverage = await coverageStart();
    console.log(`[REPAIR] أولُ صفٍّ في النظام: ${coverage || '—'}`);
    if (!coverage) {
        console.log('[REPAIR] لا صفوف حضور أصلًا — لا شيء يُصلَح. (تنتهي)');
        await pool.end();
        return;
    }

    // --employee=N يقصر المطابقة والإصلاح على موظفٍ واحد: مراجعةُ بصمة موظفٍ
    // بعينه لا تفتح باب تعديل كشف بقية الموظفين.
    const empFilter = args.employee && /^\d+$/.test(args.employee) ? Number(args.employee) : null;
    if (args.employee && empFilter === null) {
        console.log(`[REPAIR] --employee=${args.employee} ليس رقم موظف صحيحًا — تنتهي.`);
        await pool.end();
        return;
    }
    const report = await deviceSystemReconciliation({ from, to, limit: 500, employeeId: empFilter });
    const gaps = report.gap_days || [];
    console.log(`[REPAIR] أيامُ فجوة: ${gaps.length} (فجوات حقيقية: ${report.classification.real_gaps})`);

    const usable = gaps.filter((g) => g.date >= coverage);
    const skipped = gaps.filter((g) => g.date < coverage);
    if (skipped.length) {
        console.log(`[REPAIR] تُرك ${skipped.length} يومًا قبل بدء النظام (${coverage}) — ليست أيامَ موظفٍ في هذا النظام.`);
    }

    if (!usable.length) {
        console.log('[REPAIR] لا فجوات قابلة للإصلاح في هذا المدى.');
        await pool.end();
        return;
    }

    const empIds = [...new Set(usable.map((g) => g.employee_id))];
    const empRows = (await pool.query(
        `SELECT id, shift_start, shift_karim FROM employees WHERE id = ANY($1::bigint[])`,
        [empIds]
    )).rows;
    const base = new Map();
    for (const r of empRows) {
        base.set(Number(r.id), {
            shift_start: r.shift_start || null,
            shift_karim: Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10,
        });
    }
    const histMap = await loadShiftHistoryMap(empIds, to);

    /* كلُّ بصمات الموظف في نافذة اليوم — ثم نُبقي التي ورديتُها هي ذلك اليوم. */
    const punchesOf = new Map();
    for (const empId of empIds) {
        const days = usable.filter((g) => g.employee_id === empId).map((g) => g.date).sort();
        const [w0] = dayWindow(shiftDays(days[0], -1));
        const [, wEnd] = dayWindow(shiftDays(days[days.length - 1], 1));
        const logs = (await pool.query(
            `SELECT id, "attendanceTime" AS at, "punchState" AS st
               FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" < $3
              ORDER BY "attendanceTime"`,
            [empId, w0, wEnd]
        )).rows;
        const b = base.get(empId) || null;
        for (const l of logs) {
            const wall = instantToWall(new Date(l.at));
            const sh = resolveShiftAt(histMap.get(String(empId)) || [], wall.date, b);
            const shiftDate = shiftDateForEmployee(wall.date, wall.hour, {
                shift_start: sh?.shift_start,
                shift_karim: sh?.shift_karim,
            });
            const key = `${empId}|${shiftDate}`;
            if (!punchesOf.has(key)) {punchesOf.set(key, []);}
            punchesOf.get(key).push(l);
        }
    }

    const ordered = usable.sort((a, b) => (a.date === b.date ? a.employee_id - b.employee_id : (a.date < b.date ? -1 : 1)));
    const todo = args.limit ? ordered.slice(0, args.limit) : ordered;

    let repaired = 0, skippedClosed = 0, skippedExisting = 0, noRow = 0, failed = 0;
    const details = [];

    for (const g of todo) {
        const key = `${g.employee_id}|${g.date}`;
        const punches = (punchesOf.get(key) || []).sort((a, b) => new Date(a.at) - new Date(b.at));
        if (!punches.length) {
            details.push(`emp=${g.employee_id} ${g.date} — لا بصمات في سجل الجهاز لهذا اليوم`);
            noRow += 1;
            continue;
        }
        if (await isPeriodClosed(g.date.slice(0, 7))) {
            details.push(`emp=${g.employee_id} ${g.date} — الفترة ${g.date.slice(0, 7)} مقفلة (تُرك)`);
            skippedClosed += 1;
            continue;
        }
        const before = (await pool.query(
            `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`,
            [g.employee_id, g.date]
        )).rows[0];
        /* صفٌّ له وقتٌ (ولو ناقصٌ) لا يُلمس: لا مخترعَ وقتَ دخولٍ من العدم.
           الصفُّ الفارغ (لا دخول ولا انصراف) يُملأ من بصمات اليوم. */
        if (before && (before.checkIn || before.checkOut)) {
            skippedExisting += 1;
            details.push(`emp=${g.employee_id} ${g.date} — صفٌّ له وقت (دخول ${before.checkIn || '—'} · انصراف ${before.checkOut || '—'}) — لا يُلمس؛ مراجعة يدوية`);
            continue;
        }

        if (!args.apply) {
            details.push(`emp=${g.employee_id} ${g.date} — ${before ? 'صفٌّ فارغ يُملأ' : 'يُنشأ صفٌّ'} · ${punches.length} بصمة: ${punches.map((p) => instantToWall(new Date(p.at)).time + '/' + p.st).join(' ')}`);
            continue;
        }

        try {
            for (const p of punches) {
                const instant = new Date(p.at);
                const wall = instantToWall(instant);
                await engine.processPunch({
                    employeeId: g.employee_id,
                    punchState: Number(p.st),
                    instant,
                    wall,
                    device: null,
                    source: 'device',
                    /* الورديةُ السارية يومَ البصمة — لا ورديةُ اليوم (إعادةُ معالجة). */
                    forDate: wall.date,
                });
            }
            const row = (await pool.query(
                `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`,
                [g.employee_id, g.date]
            )).rows[0];
            if (!row) {
                details.push(`emp=${g.employee_id} ${g.date} — لم يُنشأ صف (قرار المحرك: البصمة متجاهَلة)`);
                noRow += 1;
                continue;
            }
            await pool.query(
                `UPDATE attendance SET notes = COALESCE(notes, '') || ' | ' || $2 WHERE id = $1`,
                [row.id, REASON]
            );
            const after = (await pool.query(
                `SELECT * FROM attendance WHERE id = $1`, [row.id]
            )).rows[0];
            await recordAttendanceEdit({
                action: before ? 'update' : 'create',
                before: before || null,
                after,
                actor: { id: null, name: 'مِصلح تدقيق البصمة', role: 'system' },
                source: 'reconciliation',
                reason: REASON,
            });
            repaired += 1;
            details.push(`emp=${g.employee_id} ${g.date} — ${before ? 'أُملأ صفٌّ فارغ' : 'أُنشئ صفٌّ'} (دخول ${after.checkIn || '—'} · انصراف ${after.checkOut || '—'})`);
        } catch (e) {
            failed += 1;
            details.push(`emp=${g.employee_id} ${g.date} — فشل: ${e && e.message}`);
        }
    }

    console.log(`[REPAIR] أُصلح=${repaired} · بلا صف=${noRow} · فترة مقفلة=${skippedClosed} · صفٌّ له وقت=${skippedExisting} · فشل=${failed}`);
    for (const d of details.slice(0, 40)) {console.log('  ' + d);}
    if (details.length > 40) {console.log(`  … و${details.length - 40} سطرًا آخر`);}
    if (!args.apply) {console.log('[REPAIR] وضع تجريبي — لم يُكتب أي شيء (أضف --apply للتنفيذ).');}

    await pool.end();
}

main().catch((e) => { console.error('[REPAIR] خطأ: ' + (e && e.message)); process.exit(1); });
