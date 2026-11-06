'use strict';
/* attendance-repair-rows.js — إصلاح الصفوف التالفة في جدول الحضور وفق البصمات الخام.
 * ════════════════════════════════════════════════════════════════════════════
 * الخلفية (2026-11-03): تشريح آخر 60 يومًا وجد صفوفًا كتبتها إصداراتُ قديمة من
 * المحرك قبل حوكمة دليل البصمة الواحد — ثلاث آليات تلف:
 *   1. «وقت محايد — فتح جلسة افتراضياً»: بصمة انصراف كُتبت دخولاً ثم أُغلق الصف
 *      بعدها بيوم كامل → صفوف بـ1440+ دقيقة (خمس عينات: 2664، 2264، 2169…).
 *   2. «ترقية لحقّي: بصمة لاحقة» / «انصراف مستنتج تلقائيًا»: استكمالُ خروج في
 *      نفس الساعة تواناً، ثم استبدالُه ببصمة لاحقة خارج الجلسة → سلاسل 1440±.
 *   3. «خروج مسترد من سجل البصمات» بزوج لمسة واحدة → صفوف بأقل من دقيقة.
 *
 * المبدأ: البصمة الخام هي الدليل الوحيد، والإصلاح تطبيق متجدد لسلوك المحرك
 * المُصلَّح (حارس مدة الجلسة MAX_SESSION_MIN = 1400 د كما في attendance-engine).
 *   • الجلسات تُبنى من البصمات الخام (تناوب دخول/انصراف + الحارس)، وكل جلسة
 *     تقابل صفَّها المزعوم: الفارق يُصحَّح (UPDATE فقط — لا حذف ولا INSERT).
 *   • الصف المشكوك غير المقابل لأي جلسة ومستهلك طرفاُه بجلساتٍ أخرى يُفرَّغ
 *     (كل أعمدته تُصبح NULL) — بلا حذف؛ التفريغ أرشُف من الإكمال الخاطئ.
 *   • لا يُلمس صف: يدوي (له سطر في attendance_edit_log)، إجازة (on_leave)،
 *     أو سليم بالفعل. كل نفسير يُسجَّل تدقيقًا بـ recordAttendanceEdit.
 *
 * الاستخدام:
 *   node scripts/attendance-repair-rows.js --dry-run [--days=60]
 *   node scripts/attendance-repair-rows.js [--days=60]
 */

const { pool } = require('../backend/shared-pool');
const {
    instantToWall, shiftDateForEmployee, isLate, calculateDelayDetail,
} = require('../backend/attendance-engine');
const { recordAttendanceEdit } = require('../backend/attendance-governance');

const proto = require('../backend/zkteco/protocol');
const IN_STATES = proto.CHECK_IN_STATES;    // {0,2,4} حالة دخول
const OUT_STATES = proto.CHECK_OUT_STATES;  // {1,3,5} حالة انصراف
const MAX_SESSION_MIN = 1400;               // نفس حارس المحرك 2026-11-03
const ANCHOR_TOL_MS = 90000;                // سماح مطابقة لحظة الصف مع لحظة البصمة

function parseArgs(argv) {
    const out = { days: 60, dryRun: false };
    for (const a of argv) {
        if (a === '--dry-run') {out.dryRun = true;}
        else if (a.startsWith('--days=')) {out.days = Number(a.slice(7)) || out.days;}
    }
    return out;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ─── بناء جلسات موظف واحد من بصماته الخام (نفس دلالة المحرك المُصلَّح) ──────
 * returns { sessions: [...], used: Set<index> }
 * session = { inIdx, inAt, inWall, outIdx, outAt, outWall, anchorless? }
 *     anchorless = انصراف بلا أي بصمة دخول حقيقية قبل٤ه مما يقبل الإقتران.
 */
function segmentSessions(logs) {
    const sessions = [];
    let cursor = null; // { inIdx, inAt, inWall }
    const used = new Set();
    for (let i = 0; i < logs.length; i++) {
        const l = logs[i];
        const t = new Date(l.attendanceTime);
        if (Number.isNaN(t.getTime())) {continue;}
        if (IN_STATES.has(Number(l.punchState))) {
            if (!cursor) { cursor = { inIdx: i, inAt: t, inWall: instantToWall(t) }; continue; }
            // دخول على جلسة مفتوحة: ما دام ضمن السقف فهي لمسة تعارض والسطر
            // الأول يظل (سلوك classifyPunch: «دخول على صف مفتوح → تجاهل»).
            // إن تجاوز السقف فالافتتاح الأقدم اقترانُه مستحيل — الأحدث حقيقي.
            if ((t.getTime() - cursor.inAt.getTime()) / 60000 > MAX_SESSION_MIN) {
                cursor = { inIdx: i, inAt: t, inWall: instantToWall(t) };
            }
            continue;
        }
        // بصمة انصراف
        if (cursor) {
            if ((t.getTime() - cursor.inAt.getTime()) / 60000 > MAX_SESSION_MIN) {
                // إعادة تثبيت الدخول على أحدث بصمة دخول حقيقية قبل الانصراف
                let reIdx = null;
                for (let j = cursor.inIdx + 1; j < i; j++) {
                    if (IN_STATES.has(Number(logs[j].punchState))) {reIdx = j;}
                }
                if (reIdx != null) {
                    const rt = new Date(logs[reIdx].attendanceTime);
                    cursor = { inIdx: reIdx, inAt: rt, inWall: instantToWall(rt) };
                } else {
                    // لا دليل جلستين: لا إقتران مُختلَق — للمراجعة.
                    sessions.push({ inIdx: null, outIdx: i, outAt: t, outWall: instantToWall(t), anchorless: true });
                    cursor = null;
                    continue;
                }
            }
            sessions.push({
                inIdx: cursor.inIdx, inAt: cursor.inAt, inWall: cursor.inWall,
                outIdx: i, outAt: t, outWall: instantToWall(t),
            });
            used.add(cursor.inIdx); used.add(i);
            cursor = null;
        }
        // انصراف بلا جلسة مفتوحة (يتيم) — لا يُخترَق له دليل؛ يظل في سجل البصمات.
    }
    return { sessions, used };
}

/* مطابقة لحظة صفّ مع لحظة بصمة خام (±90 ث) */
function anchorIndex(logs, ms, wantStateSet) {
    if (ms == null) {return null;}
    for (let k = 0; k < logs.length; k++) {
        const lt = new Date(logs[k].attendanceTime);
        if (Number.isNaN(lt.getTime())) {continue;}
        if (Math.abs(lt.getTime() - ms) > ANCHOR_TOL_MS) {continue;}
        if (wantStateSet.has(Number(logs[k].punchState))) {return k;}
    }
    return null;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dry = !!args.dryRun;
    console.log(`[REPAIR] أيام=${args.days} ${dry ? 'تشغيل_تجريبي' : 'كتابي'}`);

    // إعدادات وردية الموظفين — مصدر المحرك نفسه
    const { rows: empRows } = await pool.query('SELECT id, shift_start, shift_karim FROM employees');
    const shiftOf = new Map();
    for (const r of empRows) {
        shiftOf.set(String(r.id), {
            shiftStart: /^\d{1,2}:\d{2}$/.test(String(r.shift_start || '')) ? String(r.shift_start) : '09:00',
            shiftKarim: Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10,
        });
    }

    // ══ 1) وصفوف المرشّحة (نفس مرشّحات الدراسة) ══
    const bad = (await pool.query(
        `SELECT a.id, a."employeeId", a.date, a."checkIn", a."checkOut", a."workMinutes",
                a."checkInAt", a."checkOutAt", a.source,
                a.checkin_inferred AS ci_inf, a.checkout_inferred AS co_inf
           FROM attendance a
          WHERE a.date::date >= (NOW() AT TIME ZONE 'Asia/Riyadh')::date - $1::int
            AND NOT COALESCE(a.on_leave, false)
            AND a."workMinutes" IS NOT NULL
            AND (a."workMinutes" > $2 OR (a."workMinutes" > 0 AND a."workMinutes" < 60)
                 OR (a."checkInAt" IS NOT NULL AND a."checkOutAt" IS NOT NULL
                     AND a."checkOutAt" < a."checkInAt"))
          ORDER BY a."employeeId", a.date`,
        [args.days, MAX_SESSION_MIN]
    )).rows;
    const emps = [...new Set(bad.map(r => String(r.employeeId)))];
    console.log(`[REPAIR] صفوف مرشّحة: ${bad.length} عبر ${emps.length} موظف`);
    if (!emps.length) {
        console.log('[REPAIR] لا شيء بحاجة إصلاح في النافذة. ✅');
        await pool.end().catch(() => {});
        return;
    }

    // تعريف يدوي: صف للمسته يحصل عليه إنسان فعلاً (actorId معروف) —
    // التشغيلات الآلية (reconciliation / punch-repair / owner-directive)
    // بلا فاعل بشري لا تمنع الإصلاح، لأن أصلاحًا آليًا وفق البصمات يتفوق عليها.
    const manualIds = new Set((await pool.query(
        `SELECT DISTINCT "attendanceId" AS id FROM attendance_edit_log
          WHERE "attendanceId" IS NOT NULL AND "actorId" IS NOT NULL`
    )).rows.map(r => String(r.id)));

    let nFix = 0, nBlank = 0, nSame = 0, nReview = 0, nSkipped = 0;
    const previews = [];
    const beforeImages = []; // صورة قبل لكل صفوف الموظف المعالج (لنسخة الرجوع)

    // ══ 2) لكل موظف — بصمات وصفوفه في نافذة موسّعة (هامش 4 أيام قبل أقدم مرشّح) ══
    for (const emp of emps) {
        if (dry && previews.length >= 2000) {break;}
        const shift = shiftOf.get(emp) || { shiftStart: '09:00', shiftKarim: 10 };
        const earliest = bad.filter(r => String(r.employeeId) === emp).reduce((m, r) => (r.date < m ? r.date : m), '9999-12-31');
        const [yy, mm, dd] = earliest.split('-').map(Number);
        const sinceDate = `${yy}-${pad2(mm)}-${pad2(Math.max(1, dd - 4))}`;

        const logs = (await pool.query(
            `SELECT l.id, l."attendanceTime", l."punchState" FROM attendance_logs l
              WHERE l."employeeId" = $1::bigint AND l."attendanceTime" >= ($2::date - 4)
              ORDER BY l."attendanceTime" ASC`,
            [emp, sinceDate]
        )).rows;
        const rows = (await pool.query(
            `SELECT * FROM attendance
              WHERE "employeeId" = $1::bigint AND date::date >= ($2::date - 4)
              ORDER BY date ASC`,
            [emp, sinceDate]
        )).rows;
        if (!dry) {beforeImages.push({ employeeId: emp, rows: JSON.parse(JSON.stringify(rows)) });}

        const { sessions } = segmentSessions(logs);

        // خريطة الأزواج المستهدفة: التاريخ ← جلسة + قائمة الجلسات الزمنية
        const targets = new Map(); // date → session
        const realSessions = [];
        for (const s of sessions) {
            if (s.anchorless) {continue;}
            realSessions.push(s);
            const target = shiftDateForEmployee(s.inWall.date, s.inWall.hour, {
                shift_start: shift.shiftStart, shift_karim: shift.shiftKarim,
            });
            if (target && !targets.has(target)) {targets.set(target, s);} // أقدم جلسة ليوم الوردية
        }

        const claimedRowIds = new Set(); // صفوف بنى عليها الجلسات في هذه الدورة
        const isRowAnomalous = (row) => {
            const minsNum = Number(row.workMinutes);
            const reversed = row.checkInAt != null && row.checkOutAt != null
                && new Date(row.checkOutAt) < new Date(row.checkInAt);
            const stillBad = Number.isFinite(minsNum)
                && (minsNum > MAX_SESSION_MIN || (minsNum > 0 && minsNum < 60));
            return stillBad || reversed;
        };

        // ═══ 3) إصلاح كل جلسة مقابل صفّها ═══
        // مطابقة على درجتين: (أ) صفّ بتاريخ الوردية المستهدف، (ب) وإلا — صف
        // شاذ غير مُطمَس تقابله لحظات البصمات (±90 ث) وإن كان بتاريخ آخر
        // (المحرك القديم كتب تاريخ الوردية خطأ لسلاسل الليل المتأخر).
        for (const s of realSessions) {
            const targetDate = shiftDateForEmployee(s.inWall.date, s.inWall.hour, { shift_start: shift.shiftStart, shift_karim: shift.shiftKarim });
            let row = rows.find(r => r.date === targetDate
                && !claimedRowIds.has(String(r.id)));
            if (!row) {
                const sInMs = s.inAt.getTime(); const sOutMs = s.outAt.getTime();
                row = rows.find(r => !claimedRowIds.has(String(r.id)) && isRowAnomalous(r) && (
                    (r.checkInAt != null && Math.abs(new Date(r.checkInAt).getTime() - sInMs) <= ANCHOR_TOL_MS)
                    || (r.checkOutAt != null && Math.abs(new Date(r.checkOutAt).getTime() - sOutMs) <= ANCHOR_TOL_MS)));
            }
            if (!row) {continue;} // جلسة بلا صف (نطاق backfill) — لا يُلمس هنا
            claimedRowIds.add(String(row.id));
            // الصف اليدوي السليم لا يُمس. الصف اليدوي لكنه ما زال شاذًا (فوق
            // السقف / تحت الدقيقة / معكوس) يُصلح بالدليل — التصحيح البشري
            // القديم يظل محفوظًا في attendance_edit_log وخلطه في الملاحظات.
            const reversed = row.checkInAt != null && row.checkOutAt != null
                && new Date(row.checkOutAt) < new Date(row.checkInAt);
            const manual = manualIds.has(String(row.id));
            if (manual && !isRowAnomalous(row) && !reversed) {nSkipped++; continue;}

            const mins = Math.max(0, Math.round((s.outAt.getTime() - s.inAt.getTime()) / 60000));
            const rowInAtMs = row.checkInAt ? new Date(row.checkInAt).getTime() : null;
            const rowOutAtMs = row.checkOutAt ? new Date(row.checkOutAt).getTime() : null;
            const same = rowInAtMs != null && Math.abs(rowInAtMs - s.inAt.getTime()) <= ANCHOR_TOL_MS
                && rowOutAtMs != null && Math.abs(rowOutAtMs - s.outAt.getTime()) <= ANCHOR_TOL_MS
                && row.workMinutes === mins;
            if (same) {nSame++; continue;}

            const late = isLate(s.inWall.hour, s.inWall.minute, shift.shiftStart, Number(process.env.WORK_START_HOUR || 9));
            const delay = calculateDelayDetail({ checkIn: s.inWall.time, checkOut: s.outWall.time, shiftStart: shift.shiftStart, shiftKarim: shift.shiftKarim });
            const oldSummary = `(كان ${row.checkIn ?? '—'}@${rowInAtMs ? (new Date(rowInAtMs).toISOString().slice(0, 16).replace('T', ' ')) : '—'} → ${row.checkOut ?? '—'} | ${row.workMinutes ?? '—'}د)`;
            const newSummary = `${s.inWall.time} → ${s.outWall.time} | ${mins}د`;
            const reason = (manual ? 'تجاوزُ تعديلٍ بشري (محفوظ في سجل التدقيق) لأن الصف يظل شاذًا. ' : '')
                + (targetDate && row.date !== targetDate
                    ? 'تاريخ الصف مختلف عن يوم وردية الجلسة لكن بصمتيه هما الدليل نفسه. ' : '')
                + `إصلاح اقتران وفق البصمات الخام 2026-11-03: ${oldSummary} ← ${newSummary}`;
            if (dry) {previews.push(`FIX موظف ${emp} يوم ${row.date} [${row.id}] ${oldSummary} ⇒ ${newSummary}`); continue;}

            await pool.query(
                `UPDATE attendance
                    SET "checkIn" = $2, "checkInAt" = $3, late = $4,
                        "checkOut" = $5, "checkOutAt" = $6, "workMinutes" = $7,
                        checkin_inferred = false, checkout_inferred = false,
                        early_leave = $8,
                        notes = COALESCE(notes, '') || $9
                  WHERE id = $1`,
                [row.id, s.inWall.time, s.inAt, late, s.outWall.time, s.outAt, mins,
                 delay.earlyLeaveMinutes > 0, ' | ' + reason]
            );
            await recordAttendanceEdit({
                action: 'update', before: row,
                after: { ...row, checkIn: s.inWall.time, checkOut: s.outWall.time, workMinutes: mins },
                actor: null, source: 'attendance-repair', reason,
            });
            nFix++;
        }

        // ═══ 4) تفريغ صف شاذ بلا جلسة تتبنّاه ═══
        // كل جلسة حقيقية من البصمات الخام صار لها صف. الصف الشاذ الباقي (فوق
        // السقف / تحت الدقيقة / معكوس) محتواه لا يُشهد بأي جلسة — بقايا
        // إقتران تالفة من إصدارات المحرك القديمة ⇒ يُفرَّغ (بلا حذف).
        // بوابات الحماية: لا يُفرَّغ يدويّ (سطر تدقيق بفاعل بشري) ولا إجازة،
        // ولا صف بلا أي مرساة في البصمات الخام (قد يكون إدخالًا خارج البصمات
        // — يُترك للمراجعة البشرية لا لقرار صامت).
        for (const row of rows) {
            if (dry && previews.length >= 2000) {break;}
            if (manualIds.has(String(row.id))) {continue;} // اليدوي لا يُفرَّغ أبدًا
            if (claimedRowIds.has(String(row.id))) {continue;}
            if (!row.checkIn && !row.checkOut) {continue;}
            if (!isRowAnomalous(row)) {continue;}
            const rowInAtMs = row.checkInAt ? new Date(row.checkInAt).getTime() : null;
            const rowOutAtMs = row.checkOutAt ? new Date(row.checkOutAt).getTime() : null;
            const oldSummary = `${row.checkIn ?? '—'}→${row.checkOut ?? '—'} | ${row.workMinutes ?? '—'}د`;
            // مرساة واحدة على الأقل في البصمات الخام (إلا ذلك: للمراجعة)
            const inIdx = anchorIndex(logs, rowInAtMs, IN_STATES);
            const outIdx = anchorIndex(logs, rowOutAtMs, OUT_STATES);
            if (inIdx == null && outIdx == null) {
                if (String(row.source) === 'portal') {
                    // صف portal (إدخال بشري عبر البوابة) بلا مرساة: لا تفريغ صامت
                    const desc = `صف portal شاذ (${oldSummary}) بلا أي بصمة خام تدعمه — للمراجعة البشرية (لا تفريغ صامت)`;
                    if (dry) {previews.push(`REVIEW-PORTAL موظف ${emp} يوم ${row.date} [${row.id}] ${oldSummary}`); continue;}
                    await pool.query(
                        `INSERT INTO attendance_decisions (id, "employeeId", date, decision, confidence, reason)
                         VALUES ($1, $2::bigint, $3, 'review', 0.5, $4)`,
                        [Date.now() * 1000 + Math.floor(Math.random() * 999), emp, row.date, desc]
                    ).catch(() => {});
                    nReview++;
                    continue;
                }
                // صف device بلا أي مرساة = محتوى مُختلَق بالكامل (لا دليل خام)
            }
            const reason = `تفريغ اقتران تالف 2026-11-03: ${oldSummary} — لا جلسة من البصمات الخام تتبنّى هذا الصف${(inIdx == null && outIdx == null) ? ' ولا أي مرساة بصمة خام' : ''}، لا دليل جلستين`;
            if (dry) {previews.push(`BLANK موظف ${emp} يوم ${row.date} [${row.id}] ${oldSummary}`); continue;}

            await pool.query(
                `UPDATE attendance
                    SET "checkIn" = NULL, "checkInAt" = NULL, "checkOut" = NULL,
                        "checkOutAt" = NULL, "workMinutes" = NULL,
                        late = false, early_leave = false,
                        checkin_inferred = false, checkout_inferred = false,
                        notes = COALESCE(notes, '') || $2
                  WHERE id = $1`,
                [row.id, ' | ' + reason]
            );
            await recordAttendanceEdit({
                action: 'update', before: row,
                after: { ...row, checkIn: null, checkOut: null, workMinutes: null },
                actor: null, source: 'attendance-repair', reason,
            });
            nBlank++;
        }

        // ═══ 5) قرارات مراجعة: جلسات بلا دليل إقتران ═══
        for (const s of sessions) {
            if (!s.anchorless) {continue;}
            const desc = `جلستا بلا أي بصمة دخول حقيقية قبل انصراف ${s.outWall.date} ${s.outWall.time} — للمراجعة (لا إقتران مختلق)`;
            if (dry) {previews.push(`REVIEW موظف ${emp}: ${desc}`); continue;}
            await pool.query(
                `INSERT INTO attendance_decisions (id, "employeeId", date, decision, confidence, reason)
                 VALUES ($1, $2::bigint, $3, 'review', 0.5, $4)`,
                [Date.now() * 1000 + Math.floor(Math.random() * 999), emp, s.outWall.date, desc]
            ).catch(() => {});
            nReview++;
        }
    }

    if (dry) {
        console.log(`[REPAIR] خطة: إصلاح ${nFix} | تفريغ ${nBlank} | مراجعة ${nReview} | يدوي/متجاهل: ${nSkipped} | سليم: ${nSame}`);
        for (const p of previews) {console.log('  ' + p);}
        console.log('[REPAIR] وضع تجريبي — لم يُكتب أي شيء.');
        await pool.end().catch(() => {});
        return;
    }

    // ─── نسخة رجوع: صورة "قبل" لصفوف كل موظف معالج ───
    if (beforeImages.length) {
        const fs = require('fs');
        const path = require('path');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = path.join(process.cwd(), 'database', 'backups', `attendance-repair-${stamp}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({
            created_at: new Date().toISOString(),
            script: 'scripts/attendance-repair-rows.js',
            summary: { fixes: nFix, blanks: nBlank, reviews: nReview },
            before: beforeImages,
        }, null, 2), 'utf8');
        console.log(`[REPAIR] نسخة رجوع: ${file}`);
    }
    console.log(`[REPAIR] تم: إصلاح ${nFix} | تفريغ ${nBlank} | مراجعة ${nReview} | متخطّى يدوي ${nSkipped} | بلا تغيير ${nSame}`);

    // ══ 3) التحقق النهائي: صفر صفوف شاذة في النافذة ══
    const remaining = (await pool.query(
        `SELECT count(*)::int AS n
           FROM attendance
          WHERE date::date >= (NOW() AT TIME ZONE 'Asia/Riyadh')::date - $1::int
            AND "workMinutes" IS NOT NULL
            AND ("workMinutes" > $2 OR ("workMinutes" > 0 AND "workMinutes" < 60)
                 OR ("checkInAt" IS NOT NULL AND "checkOutAt" IS NOT NULL AND "checkOutAt" < "checkInAt"))`,
        [args.days, MAX_SESSION_MIN]
    )).rows[0];
    console.log(`[REPAIR] التحقق: صفوف شاذة متبقية في النافذة: ${remaining.n} (المتوقع: يدوي/إجازة فقط إن وُجد)`);

    await pool.end().catch(() => {});
}

module.exports = { segmentSessions, anchorIndex };
if (require.main === module) {
    main().catch((e) => { console.error('[REPAIR] خطأ: ' + (e && e.message)); process.exit(1); });
}
