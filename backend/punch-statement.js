'use strict';
/**
 * punch-statement.js — كشف البصمات الخام: دخل امتى وخرج امتى وكم ساعة
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك (2026-11-02): «أهم شي البصمة وعدد ساعات الدوام، مليش دعوة
 * بالشفتات». الكشف هنا لا يقرأ `shift_start` ولا `shift_karim` ولا حدّ
 * الـ15 دقيقة إطلاقًا: مصادره الثلاثة هي البصمات نفسها
 *   1. `attendance_logs`  — بصمات جهاز البصمة (لحظة UTC + حالة الدخول/الخروج).
 *   2. `attendance`       — بصمات بوابة الجوال المقبولة (غير المستنتجة).
 *   3. `punch_attempts`   — كل محاولة بوابة، مقبولة كانت أو مرفوضة.
 *
 * الإزدواج بالتسلسل الزمني وحده: بصمةُ الدخول تُفتح عند أول بصمة في المقطع،
 * وتُغلق بأول بصمة خروجٍ أو بأول بصمةٍ تليها. فلا تنكسر عند ورديةٍ تنتهي
 * بالظبط عند منتصف الليل (12:00+12h) — وهي الحالة التي أهدت النظامُ فيها
 * بصمةَ فجرٍ ليومٍ غير يومها.
 *
 * لا بصمة = لا وقت. لا يُخترع انصراف من مدة الوردية: المقطع يبقى مفتوحًا
 * وبلا ساعات حتى تأتي بصمة أو يوقّعها مسؤول في `attendance_edit_log`.
 *
 * الأوقات كلها لحظة UTC حقيقية، والعرض عبر business-time.js (توقيت مكة
 * Asia/Riyadh) — نفس الساعة التي تراها بقية شاشات النظام، بلا استثناء.
 */

const { pool } = require('./shared-pool');
const { wallDate, wallTime, offsetMinutes, BUSINESS_TZ } = require('./business-time');

/** بصمتان لنفس الموظف خلال هذه النافذة = حدثٌ واحد لا حدثان.
 *  بوابة الجوال تكتب اللحظة بأجزاء الثانية، فيكون الفرق بين نسختي البصمة
 *  الواحدة ثوانٍ؛ وبلا هذه النافذة تُقرأ البصمة مرّتين وتُختلق ساعة صفر. */
const SAME_EVENT_WINDOW_MS = Number(process.env.PUNCH_DEDUP_WINDOW_MS || 180000);
/** مقاطع أطول من هذا تُعلَّم للمراجعة: من النادر أن يكون دوامٌ متصلٌ أطول. */
const LONG_SEGMENT_MINUTES = Number(process.env.PUNCH_LONG_SEGMENT_MINUTES || 840);

function toMs(value) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

/** طول المقطع بالدقائق من اللحظتين — فرقٌ حقيقي لا تقريبٌ على نص HH:MM. */
function minutesBetween(inMs, outMs) {
    return Math.max(0, Math.round((outMs - inMs) / 60000));
}

/** يفضّل بصمة الجهاز (أدق لحظةً وأصدق حالةً) على نسخة البوابة لنفس الحدث. */
function sourceRank(source) {
    return source === 'device' ? 0 : source === 'attendance' ? 1 : 2;
}

/**
 * لقطة البصمات الخام لموظف واحد: كل المصادر في قائمة واحدة مرتّبة.
 * @returns {Promise<Array<{employeeId:number, ms:number, source:string, direction:string|null, state:number|null, note:string}>>}
 */
async function collectRawPunches(employeeId, startMs, endMs) {
    const rows = [];

    const device = await pool.query(
        `SELECT "attendanceTime" AS at, "punchState" AS state, "deviceUserId" AS du, source
           FROM attendance_logs
          WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" < $3
          ORDER BY "attendanceTime" ASC`,
        [employeeId, new Date(startMs), new Date(endMs)]
    );
    for (const r of device.rows) {
        const ms = toMs(r.at);
        if (ms === null) {continue;}
        rows.push({
            employeeId, ms, source: 'device',
            state: r.state === null || r.state === undefined ? null : Number(r.state),
            direction: Number(r.state) === 0 ? 'in' : Number(r.state) === 1 ? 'out' : null,
            note: `جهاز ${r.du ?? '-'}`,
        });
    }

    // بوابة الجوال: الدخول والانصراف المقبولان (المستنتَج مستبعد — ليس بصمة).
    const portal = await pool.query(
        `SELECT date, "checkInAt" AS at, 'in' AS dir, source
           FROM attendance
          WHERE "employeeId" = $1 AND "checkInAt" IS NOT NULL AND NOT COALESCE("checkin_inferred", false)
            AND "checkInAt" >= $2 AND "checkInAt" < $3
         UNION ALL
         SELECT date, "checkOutAt" AS at, 'out' AS dir, source
           FROM attendance
          WHERE "employeeId" = $1 AND "checkOutAt" IS NOT NULL AND NOT COALESCE("checkout_inferred", false)
            AND "checkOutAt" >= $2 AND "checkOutAt" < $3
          ORDER BY at ASC`,
        [employeeId, new Date(startMs), new Date(endMs)]
    );
    for (const r of portal.rows) {
        const ms = toMs(r.at);
        if (ms === null) {continue;}
        rows.push({ employeeId, ms, source: 'portal', state: null, direction: r.dir, note: `بوابة (${r.source || 'portal'})` });
    }

    // كل محاولة بوابة — المقبولة والمرفوضة: المرفوضة بصمةٌ حدثت ولم تُحتسب،
    // وإخفاؤها هو ما يجعل «كلام الموظف» و«الشاشة» لا يلتقيان.
    const attempts = await pool.query(
        `SELECT attempted_at AS at, decision, reject_code AS code, engine_result AS eng
           FROM punch_attempts
          WHERE employee_id = $1 AND attempted_at >= $2 AND attempted_at < $3
          ORDER BY attempted_at ASC`,
        [employeeId, new Date(startMs), new Date(endMs)]
    );
    for (const r of attempts.rows) {
        const ms = toMs(r.at);
        if (ms === null) {continue;}
        const action = String(r.eng?.action || r.eng?.decision?.action || '').toLowerCase();
        rows.push({
            employeeId, ms, source: 'attempt', state: null,
            direction: action === 'check_in' || action === 'in' ? 'in' : action === 'check_out' || action === 'out' ? 'out' : null,
            note: r.decision === 'accepted' ? 'محاولة مقبولة' : `مرفوضة: ${r.code || 'بلا كود'}`,
            accepted: r.decision === 'accepted',
        });
    }

    rows.sort((a, b) => a.ms - b.ms || sourceRank(a.source) - sourceRank(b.source));

    // إزالة التكرار للحدث الواحد: أقرب نسخة لنفس الموظف داخل النافذة.
    const deduped = [];
    for (const p of rows) {
        const prev = deduped[deduped.length - 1];
        if (prev && p.ms - prev.ms <= SAME_EVENT_WINDOW_MS) {
            prev.dupes = (prev.dupes || 1) + 1;
            if (p.direction && !prev.direction) {prev.direction = p.direction;}
            continue;
        }
        deduped.push({ ...p, dupes: 1 });
    }
    return deduped;
}

/**
 * إزدواجٌ صارم بالتسلسل: لا وردية، لا سماحية، لا تسمية الجهاز.
 * البصمة الأولى = دخول، الثانية = خروج، والثالثة = دخول... وهكذا.
 * سبب التخلّي عن إشارة الجهاز/البوابة: في واقعة 2026-11-01–02 كانت بصمة
 * الفجر (انصرافه الحقيقي) مصنَّفة «دخول» وبصمة المساء (دخوله الحقيقي)
 * مصنَّفة «انصراف» — أي أن التسمية الآلية كانت هي مصدر الخطأ، فلا يصلح
 * أن تكون هي الحكم. تُعرض التسمية الأصلية للمحاكمة، وتُعلَّم البصمة التي
 * تتعارض مع دورها في التسلسل. لا تُستهلك بصمةٌ مرّتين: كل بصمةٍ إما طرف
 * بداية أو طرف نهاية في مقطعٍ واحد.
 */
function pairBySequence(punches) {
    const segments = [];
    let open = null;

    const conflictFlag = (punch, role) => (punch.direction && punch.direction !== role)
        ? [`التصنيف الآلي قال «${punch.direction === 'in' ? 'دخول' : 'انصراف'}» والتسلسل يقول «${role === 'in' ? 'دخول' : 'انصراف'}»`] : [];

    for (const p of punches) {
        if (!open) {
            open = p;
            const flags = [];
            if (p.direction === 'out') {flags.push('أول بصمةٍ في النطاق مصنَّفة خروجًا — قد يكون دخولها قبل أول النطاق');}
            p._entryFlags = flags;
            continue;
        }
        const minutes = minutesBetween(open.ms, p.ms);
        segments.push({
            entry: open, exit: p, minutes,
            closedBy: 'sequence',
            overnight: wallDate(open.ms) !== wallDate(p.ms),
            flags: [
                ...(open._entryFlags || []),
                ...conflictFlag(p, 'out'),
                ...(minutes === 0 ? ['بصمتان في نفس الدقيقة — صفر ساعات']
                    : minutes > LONG_SEGMENT_MINUTES ? [`مقطع أطول من ${Math.round(LONG_SEGMENT_MINUTES / 60)} ساعات — يحتاج مراجعة`] : []),
            ],
        });
        open = null;
    }
    if (open) {segments.push({ entry: open, exit: null, minutes: null, closedBy: 'open', overnight: false, flags: [...(open._entryFlags || []), 'بلا بصمة خروج — الساعات غير محسوبة'] });}
    return segments;
}

/** صفٌّ معروض: لحظةُ الدخول والخروج بالساعة المدنية المصرية والساعات. */
function toRow(segment) {
    const inMs = segment.entry ? segment.entry.ms : null;
    const outMs = segment.exit ? segment.exit.ms : null;
    return {
        date: inMs ? wallDate(inMs) : wallDate(outMs),
        entryAt: inMs ? new Date(inMs).toISOString() : null,
        exitAt: outMs ? new Date(outMs).toISOString() : null,
        entryTime: inMs ? wallTime(inMs) : null,
        exitTime: outMs ? wallTime(outMs) : null,
        entrySource: segment.entry ? segment.entry.source : null,
        exitSource: segment.exit ? segment.exit.source : null,
        entryNote: segment.entry ? segment.entry.note : null,
        exitNote: segment.exit ? segment.exit.note : null,
        hours: segment.minutes === null || segment.minutes === undefined ? null : Number((segment.minutes / 60).toFixed(2)),
        minutesWorked: segment.minutes ?? null,
        overnight: segment.overnight,
        closedBy: segment.closedBy,
        needsReview: (segment.flags || []).length > 0,
        flags: segment.flags,
    };
}

/**
 * كشف البصمات لفترة.
 * @param {{from:string,to:string,employeeIds?:number[],limit?:number}} opts من/إلى YYYY-MM-DD
 */
async function buildPunchStatement(opts = {}) {
    const from = String(opts.from || '').slice(0, 10);
    const to = String(opts.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw Object.assign(new Error('FROM_TO_REQUIRED'), { code: 'BAD_RANGE' });
    }
    // نافذة أوسع يومًا قبل وبعد: بصمة فجرٍ تُغلق مقطع الليلة السابقة يجب أن تُرى.
    const startMs = new Date(`${from}T00:00:00Z`).getTime() - 36 * 3600000;
    const endMs = new Date(`${to}T00:00:00Z`).getTime() + 36 * 3600000;

    const scope = await pool.query(
        `SELECT id, name, "employeeId" AS code, department
           FROM employees
          WHERE ($1::bigint[] IS NULL OR id = ANY($1::bigint[])) AND status = 'active'
          ORDER BY name ASC`,
        [opts.employeeIds && opts.employeeIds.length ? opts.employeeIds.map(Number) : null]
    );
    const employees = opts.limit ? scope.rows.slice(0, opts.limit) : scope.rows;

    const out = [];
    for (const emp of employees) {
        const punches = await collectRawPunches(emp.id, startMs, endMs);
        const segments = pairBySequence(punches);
        const rows = segments.map(toRow)
            .filter(r => r.date >= from && r.date <= to)
            .sort((a, b) => String(a.entryAt || a.exitAt).localeCompare(String(b.entryAt || b.exitAt)));
        const minutes = rows.reduce((s, r) => s + (r.minutesWorked || 0), 0);
        out.push({
            employee: { id: emp.id, name: emp.name, employeeId: emp.code, department: emp.department },
            punchCount: punches.length,
            rows,
            totals: {
                segments: rows.length,
                daysPresent: rows.filter(r => r.entryAt).length,
                openSegments: rows.filter(r => r.closedBy === 'open').length,
                reviewRows: rows.filter(r => r.needsReview).length,
                minutesWorked: minutes,
                hoursWorked: Number((minutes / 60).toFixed(2)),
            },
        });
    }

    const offset = offsetMinutes(new Date(`${to}T12:00:00Z`));
    return {
        from, to,
        timezone: BUSINESS_TZ,
        offsetLabel: `UTC${offset >= 0 ? '+' : ''}${offset / 60}`,
        basis: 'raw-punches-only',
        employees: out,
    };
}

module.exports = { buildPunchStatement, collectRawPunches, pairBySequence, toRow, SAME_EVENT_WINDOW_MS, LONG_SEGMENT_MINUTES };
