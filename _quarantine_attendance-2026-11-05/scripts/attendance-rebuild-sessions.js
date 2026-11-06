'use strict';
/**
 * attendance-rebuild-sessions.js — إعادة بناء أيام الحضور من البصمات الخام
 * ═══════════════════════════════════════════════════════════════════════════
 * هذه ليست «أداة ترقيع». هي **إعادة حساب** بنفس مدخلات البصمة وبنفس المحرّك
 * (backend/attendance-sessions.js): تشغيلها مرتين يعطي نفس الناتج حرفًا بحرف
 * (idempotent) — وهذا ما يجعل الترقيع اليدوي غير لازم أصلًا.
 *
 * المصدر (الدفتر الأعمى):
 *   • attendance_logs  — بصمات الأجهزة (الجهاز الحقيقي، البوابة إن أُرشفت).
 *   • punch_attempts   — بصمات تطبيق الموظف المقبولة (بلا اتجاه: مجرد لحظة).
 *   البصمة تُقرأ لحظةً خامة بلا اتجاه؛ الاتجاه قرارُ المحسّن لا قرار العميل.
 *
 * ما تكتبه عند --apply (لموظف/يوم):
 *   ١. صفوف attendance_sessions (DELETE ثم INSERT لنفس اليوم).
 *   ٢. صفّ attendance: أول دخول، آخر انصراف، مجموع الدقائق، late/early_leave.
 *   ٣. سطر تدقيق واحد في attendance_edit_log (recordAttendanceEdit).
 *   ولا يُلمس صفٌّ يدوي (له سطر تدقيق سابق من مصدر 'manual' أو 'api').
 *
 * التشغيل:
 *   node scripts/attendance-rebuild-sessions.js --days=14                 (تجريبي)
 *   node scripts/attendance-rebuild-sessions.js --days=14 --apply
 *   node scripts/attendance-rebuild-sessions.js --employee=84 --from=2026-11-01 --apply
 */
const { pool } = require('../backend/shared-pool');
const { buildDay, rowFromDay, wallOf, toHHMM } = require('../backend/attendance-sessions');
const { loadShiftHistoryMap, resolveShiftAt } = require('../backend/attendance-engine');
const { graceMinutes } = require('../backend/shift-day');
const { recordAttendanceEdit } = require('../backend/attendance-governance');

const ACTOR = { name: 'محرّك الجلسات — إعادة بناء آلية', role: 'system' };
const REASON = 'إعادة بناء اليوم من البصمات الخام (محرّك الجلسات، idempotent)';

function parseArgs(argv) {
    const out = { days: 14, from: '', to: '', apply: false, employee: '' };
    for (const a of argv) {
        if (a === '--apply') {out.apply = true;}
        else if (a === '--dry-run') {out.apply = false;}
        else if (a.startsWith('--days=')) {out.days = Number(a.slice(7)) || out.days;}
        else if (a.startsWith('--from=')) {out.from = a.slice(7);}
        else if (a.startsWith('--to=')) {out.to = a.slice(5);}
        else if (a.startsWith('--employee=')) {out.employee = String(a.slice(11)).trim();}
    }
    return out;
}

const pad2 = (n) => String(n).padStart(2, '0');
const shiftDays = (dateStr, days) => {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

/** كل بصمات الموظف في نطاق لحظي — من مصدرَي الدليل، بلا اتجاه. */
async function loadPunches(db, employeeId, fromMs, toMs) {
    const logs = (await db.query(
        `SELECT "attendanceTime" AS at, "punchState" AS state, source, "deviceId" AS device_id
           FROM attendance_logs
          WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" < $3`,
        [employeeId, new Date(fromMs), new Date(toMs)]
    )).rows;
    const attempts = (await db.query(
        `SELECT "attempted_at" AS at, NULL AS state, 'portal' AS source, "device_id"
           FROM punch_attempts
          WHERE "employee_id" = $1 AND decision = 'accepted'
            AND "attempted_at" >= $2 AND "attempted_at" < $3`,
        [employeeId, new Date(fromMs), new Date(toMs)]
    )).rows;
    const seen = new Set();
    return [...logs, ...attempts]
        .map((r) => ({ at: new Date(r.at).getTime(), state: r.state, source: r.source || 'device', deviceId: r.device_id }))
        .filter((p) => {
            const key = `${p.at}:${p.source}`;
            if (seen.has(key)) {return false;}
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.at - b.at);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const to = args.to || today;
    const from = args.from || shiftDays(to, -Math.max(1, args.days));
    const empFilter = args.employee && /^\d+$/.test(args.employee) ? Number(args.employee) : null;
    if (args.employee && empFilter === null) {
        console.log(`[SESSIONS] --employee=${args.employee} ليس رقمًا صحيحًا`);
        await pool.end();
        return;
    }
    console.log(`[SESSIONS] ${from} → ${to} · ${args.apply ? 'تطبيق' : 'تجريبي (لم يُكتب شيء)'}`
        + (empFilter ? ` · موظف ${empFilter}` : ''));

    const emps = (await pool.query(
        `SELECT id, name, "shift_start", "shift_karim" FROM employees
          WHERE status IS DISTINCT FROM 'inactive' ${empFilter ? 'AND id = $1' : ''}
          ORDER BY id`,
        empFilter ? [empFilter] : []
    )).rows;
    const histMap = await loadShiftHistoryMap(emps.map((e) => e.id), to);
    if (process.env.SESSIONS_DEBUG) {console.log(`[SESSIONS][debug] موظفون: ${emps.length} · سجل ورديات: ${histMap.size}`);}

    let days = 0, changed = 0, created = 0, openDays = 0, skippedManual = 0, ghosts = 0, keptIntact = 0, quarantined = 0;
    // حاجز التعديل الجوهري (2026-11-03): لا يُعاد كتابة يومٍ له طرفان بدقائق
    // تختلف عن الحساب بأكثر من هذا الحد — يُعزل للمراجعة بدل تغيير راتب بصمت.
    // السبب: الدورات المتتالية أنتجت 445 ثم 717 لنفس اليوم (EMP-091).
    const MATERIAL_MIN = (() => {
        const v = Number(process.env.REBUILD_MATERIAL_MIN);
        return Number.isFinite(v) && v >= 0 ? v : 60;
    })();
    const samples = [];
    const review = [];

    for (const emp of emps) {
        const base = {
            shift_start: emp.shift_start || null,
            shift_karim: Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10,
        };
        /**
         * أطراف الجلسات المبنية لهذا الموظف — لكشف الصفوف الشبح.
         * تُخزّن **اللحظة** لا نصّ الساعة: 04:42 تتكرّر في أيام كثيرة، فمطابقة
         * النصّ حذفت صفّ 2026-11-05 لأن 04:42 طرفُ جلسة يوم 2026-10-31.
         */
        const edges = new Set();
        const noPunchDays = [];
        /** أيام لها بصمات حولها لكن لا بصمة داخل نافذتها المسجّلة. */
        const noWindowDays = [];
        /** حتمية (2026-11-03): لا مجموعة «مستهلكة» عابرة للأيام — ملكية البصمة تُحسم بالنافذة. */
        for (let d = from; d <= to; d = shiftDays(d, 1)) {
            const shift = resolveShiftAt(histMap.get(String(emp.id)) || [], d, base) || base;
            const probe = buildDay({ punches: [], shiftDate: d, shiftStart: shift.shift_start, karim: shift.shift_karim });
            const { fromMs, toMs } = probe.window;
            if (fromMs == null) {continue;}
            // نطاق القراءة **أوسع** من النافذة (±١٢ ساعة): إن كانت الوردية
            // مسجّلة خطأً أو طويلة، فلا بد أن تصل البصمتان إلى المحرّك حتى
            // تستطيع الحوكمة (G1) أن تستنتج الوردية.
            const loadFrom = fromMs - 12 * 3600 * 1000;
            const loadTo = toMs + 12 * 3600 * 1000;
            const wide = await loadPunches(pool, emp.id, loadFrom, loadTo);
            // ═══ حتمية الإعادة (إصلاح 2026-11-03) ═══
            // كان `consumed` يُمرَّر بين الأيام بحسب ترتيب الدورة، فبصمةُ مساءٍ واحد
            // تُقرأ «دخول اليوم التالي» في دورة، و«انصراف الأمس» في دورة أخرى ⇒ نفس
            // اليوم يُعاد كتابته بقيم مختلفة كل ٣٠ دقيقة (دليل: سجل المجدول 20:18 vs
            // 21:48 — انصراف ٢٢:٠٠ صار دخولًا، و٩٥٤ دقيقة ظهرت ثم اختفت).
            // الآن: النافذة هي مالك البصمة، وناتج اليوم دالةٌ في بصماته وحده.
            const punches = wide.filter((p) => p.at >= fromMs && p.at < toMs);
            // بصمات اليوم نفسه (لا ليلة أمس ولا ليلة غد): صفٌّ يحمل وقتًا ليس من
            // بصمات يومه استعار لحظة يومٍ آخر (انزياح أو قلب اقتران) فلا يُحمى.
            const ownHHMM = new Set(wide
                .filter((p) => wallOf(p.at).date === d)
                .map((p) => toHHMM(wallOf(p.at).minutes)));
            if (process.env.SESSIONS_DEBUG) {
                console.log(`[SESSIONS][debug] ${emp.id} ${d} نافذة ${new Date(fromMs).toISOString()}→${new Date(toMs).toISOString()}`
                    + ` بصمات ${punches.length} (واسع ${wide.length})`);
            }
            if (!wide.length) {noPunchDays.push(d); continue;}
            // بصمات موجودة لكن خارج نافذة الوردية المسجّلة: لا حكم ولا كتابة.
            // لا بصمة داخل النافذة المسجّلة، لكن حولها بصمات: لا تُسقط اليوم —
            // المحرّك يستنتج ورديته من بصمة يومه نفسه (G1ب)، أو يقرّر أنه بلا
            // دليل فيُحذف صفّه. تبقى القائمة لحارس الأشباح بعد البناء.
            if (!punches.length) {noWindowDays.push(d);}
            // المحرّك يستقبل النطاق الواسع لا نافذة الوردية المسجّلة: الحوكمة G1
            // تحتاج بصمات اليوم لترى أن الوردية المسجّلة لا تفسّرها فتُعيد
            // استنتاجها (واقعة EMP-114: وردية 05:00 في بطاقة 13:00). المحرّك
            // نفسه هو من يفلتر بالنافذة — التسريب كان في الترشيح قبل استدعائه.
            const day = buildDay({
                punches: wide, shiftDate: d, shiftStart: shift.shift_start, karim: shift.shift_karim,
                graceMin: graceMinutes(),
            });
            days += 1;
            for (const s of day.sessions) {
                edges.add(new Date(s.inAt).getTime());
                edges.add(new Date(s.outAt).getTime());
            }
            if (day.status === 'awaiting_out') {openDays += 1;}

            const current = (await pool.query(
                `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`,
                [emp.id, d]
            )).rows[0] || null;

            // صفٌّ يدوي محمي: له تعديل بشري مسجّل — لا يُعاد بناؤه آليًا.
            const manual = current ? (await pool.query(
                `SELECT 1 FROM attendance_edit_log
                  WHERE "attendanceId" = $1 AND source IN ('api','manual') LIMIT 1`,
                [current.id]
            )).rows[0] : null;
            if (manual) {skippedManual += 1; continue;}

            const row = rowFromDay(day);
            // أصل البصمة يُحفظ في المصدر (2026-11-03): يوم بصماته كلها من كاميرا
            // التطبيق يُكتب «portal» لا «builder»، فلا تظهر بصمة الكاميرا كأنها
            // إدخال بشري. المختلط يبقى «builder» لأن جمعه آلي.
            const origins = new Set((day.punches || []).map((p) => p.source || 'device'));
            const rowSource = origins.size === 1 ? [...origins][0] : 'builder';
            // المقارنة تُطبّع الفارغ/العدم معًا: صفٌّ بطرفٍ واحد (بلا ساعات)
            // يجب أن يبقى «لا فرق» حتى لا يُكتب كل تشغيل من جديد.
            const nn = (v) => (v == null || v === '' ? null : v);
            // الطرف النصّي والحادية الاثنان وجهان لدليل واحد: يقارن المحرّك لحظاته
            // أيضًا حتى يشفى أي صفٍ سابق كُتب نصًّا بلا لحظة من تلقاء نفسه.
            const atMs = (v) => (v == null || v === '' ? null : (Number.isNaN(new Date(v).getTime()) ? null : new Date(v).getTime()));
            const differs = !current
                ? Boolean(row)
                : (row == null
                    ? Boolean(current.checkIn || current.checkOut)
                    : nn(current.checkIn) !== nn(row.checkIn)
                        || nn(current.checkOut) !== nn(row.checkOut)
                        || atMs(current.checkInAt) !== atMs(row && row.checkInAt)
                        || atMs(current.checkOutAt) !== atMs(row && row.checkOutAt)
                        || (current.workMinutes == null ? null : Number(current.workMinutes)) !== nn(row.workMinutes)
                        // الأعلام تُقارن أيضًا: تغيير السماح لا يُطبّق على صفٍّ موجود بدونه
                        || Boolean(current.late) !== Boolean(row.late)
                        || Boolean(current.early_leave) !== Boolean(row.earlyLeave));

            // تزامن الطبقتين (2026-11-03): صفّ الحضور قد يكون صحيحًا وجلساته قديمة
            // (كتبها اقتران سابق) — كانت الإعادة تتخطى اليوم فلا تُصحَّح الجلسات أبدًا.
            // الآن اختلاف الجلسات نفسه يُعدّ فرقًا فيُعاد البناء ويُزامَن الطرفان.
            if (!differs) {
                const curS = (await pool.query(
                    `SELECT "inAt", "outAt", minutes FROM attendance_sessions
                      WHERE "employeeId" = $1 AND "shiftDate" = $2 ORDER BY seq`,
                    [emp.id, d]
                )).rows;
                const sameSessions = curS.length === day.sessions.length && curS.every((s, i) => (
                    new Date(s.inAt).getTime() === new Date(day.sessions[i].inAt).getTime()
                    && new Date(s.outAt).getTime() === new Date(day.sessions[i].outAt).getTime()
                    && Number(s.minutes) === Number(day.sessions[i].minutes)
                ));
                if (sameSessions) {continue;}
            }

            // الحوكمة تُحسّن ولا تُسقط دليلًا: لا نستبدل صفًّا له طرفان (دخول
            // وانصراف مسجّلان من الجهاز) بصفٍّ جزئي. هذا يحدث حين تكون الوردية
            // المسجّلة خاطئة — فيُبلغ عن الموظف للمراجعة ولا تُمس بيانته.
            // صفٌّ يحمل وقتًا ليس من بصمات يومه = استعار لحظة يومٍ آخر، فلا يُحمى
            // من التصحيح بذريعة «دليل» (واقعة EMP-114: صف 10-30 يحمل بصمتي 10-31).
            const borrowed = Boolean(current) && (
                (current.checkIn && !ownHHMM.has(String(current.checkIn)))
                || (current.checkOut && !ownHHMM.has(String(current.checkOut)))
            );
            const currentComplete = current && current.checkIn && current.checkOut && !borrowed;
            const newPartial = row && (!row.checkIn || !row.checkOut) && row.workMinutes == null;
            // صفٌّ موجود وبصماتٌ موجودة لكن خارج نافذة الوردية المسجّلة: لا حذف
            // ولا استبدال — بيانات الموظف أرجح من إعداد الوردية.
            const keepEvidence = !row && current && wide.length > 0 && !borrowed;
            if ((currentComplete && newPartial) || keepEvidence) {
                keptIntact += 1;
                if (review.length < 30) {
                    review.push(`${emp.id} ${emp.name.slice(0, 18)} ${d}: الصفّ الحالي ${current.checkIn || '—'}→${current.checkOut || '—'}`
                        + `؛ المحرّك ${row ? `${row.checkIn || '—'}→${row.checkOut || '—'}` : 'لا جلسة في نافذة الوردية'}`
                        + ` (وردية ${shift.shift_start} — يحتمل إعدادٌ خاطئ)`);
                }
                continue;
            }

            // ── حاجز العزل: صفٌّ مكتمل الطرفين يُعاد حسابه بدقائق مختلفة جوهريًا ──
            if (current && current.checkIn && current.checkOut && current.workMinutes != null
                && row && row.workMinutes != null
                && Math.abs(Number(current.workMinutes) - Number(row.workMinutes)) > MATERIAL_MIN) {
                quarantined += 1;
                if (review.length < 30) {
                    review.push(`${emp.id} ${emp.name.slice(0, 18)} ${d}: محسوم ${current.workMinutes}د`
                        + ` ↔ المحرّك ${row.workMinutes}د (فرق > ${MATERIAL_MIN}د — عُزل للمراجعة، لم يُكتب)`);
                }
                continue;
            }

            changed += 1;
            if (!current && row) {created += 1;}
            if (samples.length < 25) {
                samples.push(`${emp.id} ${emp.name.slice(0, 18)} ${d}: `
                    + (current ? `${current.checkIn || '—'}→${current.checkOut || '—'}` : 'لا صف')
                    + (row
                        ? ` ⇒ ${row.checkIn || '—'}→${row.checkOut || '—'}`
                            + ` (${row.workMinutes == null ? 'ساعات غير مكتملة' : `${row.workMinutes}د`}·${day.status}`
                            + `${day.governance && day.governance.rule !== 'strict' ? `·${day.governance.rule}` : ''})`
                        : ` ⇒ بلا بصمة صالحة (${day.status})`));
            }

            if (!args.apply) {continue;}

            if (process.env.SESSIONS_DEBUG) {console.log(`  ~ ${emp.id} ${d} يُكتب`);}
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    'DELETE FROM attendance_sessions WHERE "employeeId" = $1 AND "shiftDate" = $2',
                    [emp.id, d]
                );
                for (const s of day.sessions) {
                    await client.query(
                        `INSERT INTO attendance_sessions
                            ("employeeId", "shiftDate", seq, "inAt", "outAt", minutes, cost, source, "builtBy")
                         VALUES ($1,$2,$3,$4,$5,$6,$7,'builder',$8)`,
                        [emp.id, d, s.seq, s.inAt, s.outAt, s.minutes, s.cost, ACTOR.name]
                    );
                }
                // لا حذف لدخولٍ حقيقي: الحذف هنا لِما لا بصمة له إطلاقًا فقط
                // (نطاقٍ واسع، لا نافذة الوردية — بصمةٌ خارج نافذةٍ خاطئة تبقى دليلًا).
                if (!row && current && !punches.length) {
                    await recordAttendanceEdit({
                        db: client, action: 'delete', before: current, actor: ACTOR,
                        source: 'repair', reason: REASON + ' — لا جلسة تتبنّى الصف',
                    });
                    await client.query('DELETE FROM attendance WHERE id = $1', [current.id]);
                } else if (row && !current) {
                    // نفس اصطلاح المحرك: معرّف زمنيّ فريد (العمود NOT NULL بلا افتراضي)
                    const newId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
                    const ins = (await client.query(
                        `INSERT INTO attendance
                            (id, "employeeId", date, "checkIn", "checkOut", "workMinutes", late, "early_leave",
                             "checkInAt", "checkOutAt",
                             source, notes, "checkin_inferred", "checkout_inferred")
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$11,FALSE,FALSE)
                         RETURNING *`,
                        [newId, emp.id, d, row.checkIn, row.checkOut, row.workMinutes, row.late, row.earlyLeave,
                            row.checkInAt, row.checkOutAt, REASON, rowSource]
                    )).rows[0];
                    await recordAttendanceEdit({
                        db: client, action: 'create', after: ins, actor: ACTOR,
                        source: 'repair', reason: REASON,
                    });
                } else if (row && current) {
                    const upd = (await client.query(
                        `UPDATE attendance
                            SET "checkIn" = $2, "checkOut" = $3, "workMinutes" = $4,
                                late = $5, "early_leave" = $6,
                                "checkInAt" = $7, "checkOutAt" = $8, source = $10,
                                notes = COALESCE(notes, '') || ' | ' || $9
                          WHERE id = $1 RETURNING *`,
                        [current.id, row.checkIn, row.checkOut, row.workMinutes, row.late, row.earlyLeave,
                            row.checkInAt, row.checkOutAt, REASON, rowSource]
                    )).rows[0];
                    await recordAttendanceEdit({
                        db: client, action: 'update', before: current, after: upd, actor: ACTOR,
                        source: 'repair', reason: REASON,
                    });
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                console.log(`  ✗ ${emp.id} ${d}: ${e.message}`);
            } finally {
                client.release();
            }
        }

        // ─── حارس الصفوف بلا دليل ────────────────────────────────────────
        // صفُّ يومٍ لا بصمة له إطلاقًا، ودخوله هو نفسه طرفُ جلسةٍ في يوم آخر:
        // هذا أثر البصمة الواحدة التي تُقرأ مرتين (انصراف الليلة = «دخول» اليوم
        // التالي). لا جلسة تتبنّاه ⇒ يُحذف بتدقيق، وإلا بقي شبحًا يفتح يومًا.
        for (const d of [...noPunchDays, ...noWindowDays]) {
            const row = (await pool.query(
                `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`, [emp.id, d]
            )).rows[0];
            if (!row || (!row.checkIn && !row.checkOut)) {continue;}
            const rowInMs = row.checkInAt ? new Date(row.checkInAt).getTime() : null;
            const rowOutMs = row.checkOutAt ? new Date(row.checkOutAt).getTime() : null;
            if ((rowInMs != null && edges.has(rowInMs)) || (rowOutMs != null && edges.has(rowOutMs))) {
                ghosts += 1;
                if (samples.length < 25) {
                    samples.push(`${emp.id} ${emp.name.slice(0, 18)} ${d}: شبح ${row.checkIn || '—'}→${row.checkOut || '—'}`
                        + ' ⇒ حذف (طرف جلسة يوم آخر)');
                }
                if (!args.apply) {continue;}
                const g = await pool.connect();
                try {
                    await g.query('BEGIN');
                    await recordAttendanceEdit({
                        db: g, action: 'delete', before: row, actor: ACTOR, source: 'repair',
                        reason: REASON + ' — صف بلا بصمة تخصّه: لحظته طرفُ جلسة يوم آخر',
                    });
                    // جلسات اليوم المحذوف تخرج معه: صفٌّ محذوف وجلسة باقية
                    // تُظهر ساعات ليومٍ لا وجود له في الكشف.
                    await g.query(
                        'DELETE FROM attendance_sessions WHERE "employeeId" = $1 AND "shiftDate" = $2',
                        [emp.id, d]
                    );
                    await g.query('DELETE FROM attendance WHERE id = $1', [row.id]);
                    await g.query('COMMIT');
                } catch (e) {
                    await g.query('ROLLBACK').catch(() => {});
                    console.log(`  ✗ شبح ${emp.id} ${d}: ${e.message}`);
                } finally {g.release();}
            }
        }
    }

    console.log(`[SESSIONS] أيام فيها بصمات: ${days} · تحتاج تغييرًا: ${changed}`
        + ` (جديد ${created}) · صفوف شبح بلا دليل: ${ghosts}`
        + ` · أيام بلا انصراف (لا اختلاق): ${openDays} · صفوف يدوية محمية: ${skippedManual}`
        + ` · صفوف كاملة لم تُمس (وردية مشكوك فيها): ${keptIntact}`
        + ` · معزولة (فرق جوهري): ${quarantined}`);
    if (review.length) {
        console.log('[SESSIONS] مراجعة إعداد الوردية (لم تُمس صفوفهم):');
        review.forEach((r) => console.log('   ⚠ ' + r));
    }
    for (const line of samples) {console.log('  ' + line);}
    if (!args.apply) {console.log('[SESSIONS] وضع تجريبي — لم يُكتب شيء (أضف --apply).');}
    await pool.end();
}

main().catch((e) => { console.error('FAIL:', e.stack); process.exit(1); });
