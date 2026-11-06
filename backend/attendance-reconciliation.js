'use strict';
/**
 * attendance-reconciliation.js — مطابقة بصمات جهاز البصمة بسجلّ النظام
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «مراجعة البصمات من جهاز البصمات لمقارنته بسستم البصمة».
 *
 * الجهازُ فيه دفترُه (`attendance_logs` — كل بصمة خام مرةً واحدة بالضبط)،
 * والنظامُ فيه دفترُه (`attendance` — يومُ الموظف: دخولٌ وانصراف). بين
 * الدفترين جسرٌ يُقارَن: فبصمةٌ ضاعت من الجهاز إلى النظام (أو العكس)
 * كانت تمرّ بلا أثر ولا أحد يعرف.
 *
 * المطابقة هنا وقتٌ حقيقيّ لا تقريبٌ زمنيّ: لحظةُ البصمة كما سجّلها
 * الجهاز هي نفسها اللحظةُ التي يكتبها المحرك في صفّ الحضور. لذلك:
 *   • بصمةٌ لها صفُّ حضور  → «مطابقة» (ما زالت في الجهاز وفي النظام).
 *   • صفُّ حضور بلا بصمة   → «بلا بصمة» (في النظام ولم يرد من الجهاز:
 *     بوابة التطبيق، أو تصحيحٌ يدوي، أو بصمةٌ من جهازٍ لم تُربط).
 *   • بصمةٌ بلا موظف       → «غير مربوطة» (رقمُ الجهاز غير مربوط بموظف).
 *
 * ═══ لماذا «بلا صفّ» ليست فجوةً واحدة (2026-11-02) ═══════════════════
 * المحركُ «تملأ ولا تكرّر»: موضعُ البصمة (دخولٌ/انصراف) مشغولٌ بالفعل
 * فالمحرك يتجاهلها ويُبقيها في `attendance_logs` بلا صفٍّ جديد — وهذا سلوكٌ
 * مقصودٌ لا فقدُ بيانات. ولأن «بلا صفّ» كان يُعرض كلمةً واحدة («فقيدة»)
 * صار الرقمُه مخيفًا بلا معنى: آلافُ «الفقيد» بينما المحركُ سجّل كلَّها
 * كما أراد.
 *
 * فصار التقريرُ يصنّف كلَّ بصمة غير مطابقة بصنفها — بنفس قواعد المحرك
 * (يوم الوردية وسجلّ سريان الدوام ونسق حالة الجهاز):
 *   • «فجوةٌ حقيقية» = بصمةٌ كان يجب أن تُكتب ولم يكتبها أحد.
 *   • «تكرارٌ مُتجاهَل» = قاعدةٌ معروفة (زرٌّ ضُغط مرتين) والصفُّ الأول محفوظ.
 *   • «قبل بدء النظام» = ما قبل أول صفٍّ في النظام فالمقارنةُ غير ممكنة أصلًا.
 *
 * القراءة فقط: هذه دالةُ تدقيقٍ لا دالةُ تعديل. الإصلاحُ يبقى في
 * `scripts/zk-reconcile.js` و`scripts/reconcile-portal-punches.js`.
 */
const { pool } = require('./shared-pool');
const { shiftDateForEmployee, prevDay } = require('./shift-day');
const proto = require('./zkteco/protocol');
const { instantToWall } = require('./attendance-engine');

/** وقتُ العمل في الجداول: Asia/Riyadh (UTC+3 بلا تغييرٍ موسمي). */
const WORK_TZ = 'Asia/Riyadh';

const IN_STATES = proto.CHECK_IN_STATES;
const OUT_STATES = proto.CHECK_OUT_STATES;

/* ── أصنافُ البصمة غير المطابقة ─────────────────────────────────────────
   gap=true يعني: «هنا بخسارةٍ محتملة تستحقّ تدقيقًا» — لا مجرد بصمة زائدة. */
const KIND = {
    UNMAPPED: 'unmapped_device_user',
    BEFORE_COVERAGE: 'before_system_started',
    NO_ROW_IN: 'no_row_for_shift_day',
    ROW_NO_IN: 'row_without_check_in',
    NO_ROW_OUT: 'no_row_for_checkout',
    OPEN_ROW: 'open_row_not_closed',
    DUP_IN: 'duplicate_check_in',
    DUP_OUT: 'duplicate_check_out',
};

const KIND_META = {
    [KIND.UNMAPPED]: {label: 'رقمُ الجهاز غير مربوطٍ بموظف', gap: true},
    [KIND.BEFORE_COVERAGE]: {label: 'قبل أن يبدأ النظام بتسجيل الحضور', gap: false},
    [KIND.NO_ROW_IN]: {label: 'لا صفَّ حضورٍ ليوم الوردية (بصمة دخول)', gap: true},
    [KIND.ROW_NO_IN]: {label: 'صفُّ يوم الوردية بلا وقت دخول', gap: true},
    [KIND.NO_ROW_OUT]: {label: 'لا صفَّ حضورٍ لهذا اليوم ولا أمس (بصمة انصراف)', gap: true},
    [KIND.OPEN_ROW]: {label: 'انصرافٌ على صفٍّ مفتوح — لم يُغلق', gap: true},
    [KIND.DUP_IN]: {label: 'دخولٌ مكرر — الصفُّ الأول محفوظ', gap: false},
    [KIND.DUP_OUT]: {label: 'انصرافٌ مكرر — الصفُّ الأول محفوظ', gap: false},
};

/** ترتيبُ العرض: الفجواتُ أولًا لأنها ما يستحقّ العمل. */
const KIND_ORDER = [
    KIND.NO_ROW_IN, KIND.ROW_NO_IN, KIND.NO_ROW_OUT, KIND.OPEN_ROW, KIND.UNMAPPED,
    KIND.DUP_IN, KIND.DUP_OUT, KIND.BEFORE_COVERAGE,
];

/** أقصى عددِ بصماتٍ تُصنَّف (حارسُ ذاكرة) —!\!\ أكبرُ عددٍ في القاعدة ~٥٦ ألفًا. */
const CLASSIFY_CAP = 50000;

/** أقصى عيّنةٍ تُعرض لكل صنف. */
const BUCKET_SAMPLE = 50;

/**
 * شرطُ نطاق سجلّات الجهاز — يُبنى مع مصفوفةِ معاملاتٍ مستقلة كل مرّة
 * (الأرقام النائبة $1… تعتمد على ترتيب الدفع، فإعادةُ الاستخدام خطأ).
 */
function logFilters({ from, to, employeeId, deviceId }, params) {
    const where = [];
    if (from) {
        params.push(from);
        where.push(`l."attendanceTime" >= ($${params.length}::date::timestamp AT TIME ZONE '${WORK_TZ}')`);
    } else {
        params.push('-30 days');
        where.push(`l."attendanceTime" >= NOW() + $${params.length}::interval`);
    }
    if (to) {
        params.push(to);
        where.push(`l."attendanceTime" < (($${params.length}::date + 1)::timestamp AT TIME ZONE '${WORK_TZ}')`);
    }
    if (employeeId != null && employeeId !== '') {
        params.push(employeeId);
        where.push(`l."employeeId" = $${params.length}`);
    }
    if (deviceId != null && deviceId !== '') {
        params.push(deviceId);
        where.push(`l."deviceId" = $${params.length}`);
    }
    return where.join(' AND ');
}

/** أولُ يومٍ سجّل فيه النظام صفوف حضور — ما قبله غير قابلٍ للمقارنة. */
async function coverageStart() {
    try {
        const row = (await pool.query(
            `SELECT MIN("date"::date)::text AS first_row
               FROM attendance
              WHERE "date" ~ '^\\d{4}-\\d{2}-\\d{2}$'`
        )).rows[0] || {};
        return row.first_row ? String(row.first_row).slice(0, 10) : null;
    } catch (_) {
        return null;
    }
}

/**
 * تصنيفُ البصمات غير المطابقة — بنفس منطق المحرك (يوم الوردية + سريان
 * الدوام + نسق حالة الجهاز) حتى لا يخالف التقريرُ ما يفعل المحركُ فعلًا.
 *
 * @param {Array<{log_id:number, employee_id:number, attendance_time:Date|string,
 *                punch_state:number, device_user_id:*, device_id:*}>} punches
 * @param {string|null} coverageFrom
 */
async function classifyUnmatched(punches, coverageFrom) {
    const kindById = new Map();
    const acc = new Map();
    const gapDays = new Map();
    const out = {
        coverage_from: coverageFrom || null,
        total: punches.length,
        compared: 0,
        before_coverage: 0,
        gaps: 0,
        benign: 0,
        buckets: [],
        truncated: false,
    };
    if (!punches.length) {return {...out, kindById};}

    const empIds = [...new Set(punches.map((p) => Number(p.employee_id)).filter(Number.isInteger))];

    /* ورديةُ كل موظف من **البطاقة** مباشرة (shift_start / shift_karim) — بلا سجلّ سريان. */
    const empBase = new Map();
    if (empIds.length) {
        const er = (await pool.query(
            `SELECT id, shift_start, shift_karim FROM employees WHERE id = ANY($1::bigint[])`,
            [empIds]
        )).rows;
        for (const r of er) {
            empBase.set(Number(r.id), {
                shift_start: r.shift_start || null,
                shift_karim: Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10,
            });
        }
    }

    /* مدى البصمات لحساب الصفوفِ المطلوبة: [أقدم يوم -2 , أحدث يوم +2] */
    let minWall = null;
    let maxWall = null;
    for (const p of punches) {
        const w = instantToWall(new Date(p.attendance_time));
        if (!minWall || w.date < minWall) {minWall = w.date;}
        if (!maxWall || w.date > maxWall) {maxWall = w.date;}
    }
    const shiftDays = (dateStr, days) => {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
        const p2 = (n) => String(n).padStart(2, '0');
        return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
    };
    const fromDate = shiftDays(minWall, -2);
    const toDate = shiftDays(maxWall, 2);

    /* صفوفُ حضور هؤلاء الموظفين في المدى — خريطة: موظف ← (يوم ← صف) */
    const rowsByEmp = new Map();
    if (empIds.length) {
        const rr = (await pool.query(
            `SELECT id, "employeeId" AS employee_id, date,
                    "checkInAt" AS check_in_at, "checkOutAt" AS check_out_at
               FROM attendance
              WHERE "employeeId" = ANY($1::bigint[]) AND date >= $2 AND date <= $3`,
            [empIds, fromDate, toDate]
        )).rows;
        for (const r of rr) {
            const k = Number(r.employee_id);
            if (!rowsByEmp.has(k)) {rowsByEmp.set(k, new Map());}
            rowsByEmp.get(k).set(String(r.date), r);
        }
    }

    const bump = (kind, p) => {
        if (!acc.has(kind)) {
            const meta = KIND_META[kind] || {label: kind, gap: false};
            acc.set(kind, {kind, label: meta.label, gap: meta.gap, count: 0, samples: []});
        }
        const b = acc.get(kind);
        b.count += 1;
        if (b.samples.length < BUCKET_SAMPLE) {
            b.samples.push({
                log_id: p.log_id,
                device_id: p.device_id,
                device_user_id: p.device_user_id,
                employee_id: p.employee_id,
                employee_name: p.employee_name || null,
                attendance_time: p.attendance_time,
                punch_state: p.punch_state,
            });
        }
    };

    for (const p of punches) {
        const empId = Number(p.employee_id);
        const wall = instantToWall(new Date(p.attendance_time));
        let kind;
        let shiftDate = null;
        let dayRow = null;

        if (coverageFrom && wall.date < coverageFrom) {
            kind = KIND.BEFORE_COVERAGE;
        } else {
            const base = empBase.get(empId) || null;
            shiftDate = shiftDateForEmployee(wall.date, wall.hour, {
                shift_start: base?.shift_start,
                shift_karim: base?.shift_karim,
            });
            /* المقارنةُ على *يوم الوردية* لا على يوم الحائط: ورديةٌ تبدأ مساءً
               ٣٠/٨ وتمتدّ إلى فجر ٣١/٨ لا تُقارَن بما قبل بدء النظام — وإلّا
               صُنِّفت كلُّ بصمةِ فجرٍ أولى من تلك الليلة كـ«فجوة». */
            if (coverageFrom && shiftDate < coverageFrom) {
                kind = KIND.BEFORE_COVERAGE;
                shiftDate = null;
            } else {
                const rowsOf = rowsByEmp.get(empId);
                dayRow = rowsOf?.get(shiftDate) || null;
                const prevRow = rowsOf?.get(prevDay(shiftDate)) || null;
                const state = Number(p.punch_state);
                const isOut = OUT_STATES.has(state) && !IN_STATES.has(state);
                const isIn = IN_STATES.has(state);

                if (isOut) {
                    /* الانصرافُ يُغلق أحدث صفٍّ مفتوح من يوم الوردية أو اليوم
                       السابق (وردية ليلية) — فمرّرنا في الاثنين. */
                    const open = [dayRow, prevRow].find((r) => r && r.check_in_at && !r.check_out_at);
                    if (open) {kind = KIND.OPEN_ROW;}
                    else if (dayRow && dayRow.check_out_at) {kind = KIND.DUP_OUT;}
                    else {kind = KIND.NO_ROW_OUT;}
                } else if (isIn) {
                    /* الدخولُ يكتب في صفّ يوم الوردية وحده (لا صفّ أمس) — فالمقارنة
                       على صفّ اليوم فقط: وجودُ صفٍّ أمس لا يُلغي فجوةَ هذا اليوم. */
                    if (dayRow && dayRow.check_in_at) {kind = KIND.DUP_IN;}
                    else if (dayRow) {kind = KIND.ROW_NO_IN;}
                    else {kind = KIND.NO_ROW_IN;}
                } else {
                    kind = KIND.NO_ROW_IN; // حالةُ جهازٍ غير معروفة = لا موضعَ لها
                }
            }
        }

        kindById.set(p.log_id, kind);
        bump(kind, p);

        /* الفجواتُ تُجمَّع بيومِ الوردية — فالإصلاحُ يقع على «يومِ موظف» لا
           على «بصمة»: ويُعرف من أرقام البصمات هل يكفي اليوم بنقرة. */
        if ((KIND_META[kind] || {}).gap && shiftDate) {
            const k = `${empId}|${shiftDate}`;
            if (!gapDays.has(k)) {
                gapDays.set(k, {
                    employee_id: empId,
                    employee_name: p.employee_name || null,
                    date: shiftDate,
                    has_row: Boolean(dayRow),
                    kinds: [],
                    kind_labels: [],
                    punches: [],
                });
            }
            const g = gapDays.get(k);
            if (!g.kinds.includes(kind)) {
                g.kinds.push(kind);
                g.kind_labels.push((KIND_META[kind] || {}).label || kind);
            }
            if (g.punches.length < 10) {
                g.punches.push({
                    log_id: p.log_id,
                    attendance_time: p.attendance_time,
                    punch_state: p.punch_state,
                    kind,
                });
            }
        }
    }

    const buckets = KIND_ORDER.filter((k) => acc.has(k)).map((k) => acc.get(k));
    out.before_coverage = acc.has(KIND.BEFORE_COVERAGE) ? acc.get(KIND.BEFORE_COVERAGE).count : 0;
    out.compared = out.total - out.before_coverage;
    out.gaps = buckets.filter((b) => b.gap).reduce((s, b) => s + b.count, 0);
    out.benign = buckets
        .filter((b) => b.kind === KIND.DUP_IN || b.kind === KIND.DUP_OUT)
        .reduce((s, b) => s + b.count, 0);
    out.buckets = buckets;
    /* أيامُ الفجوة: «يومُ موظف» ناقص — هو ما يُصلَح ويُراجَع. */
    out.gapDays = [...gapDays.values()].sort((a, b) => (
        a.date === b.date ? a.employee_id - b.employee_id : (a.date < b.date ? -1 : 1)
    ));
    out.gapDaysWithoutRow = out.gapDays.filter((g) => !g.has_row).length;
    return {...out, kindById};
}

/**
 * @param {{from?:string, to?:string, employeeId?:number|string, deviceId?:number|string,
 *          limit?:number}} filter
 */
async function deviceSystemReconciliation({ from, to, employeeId = null, deviceId = null, limit = 500 } = {}) {
    const filter = {from, to, employeeId, deviceId};

    /* متى بدأ النظام يسجّل صفوف الحضور؟ ما قبل ذلك لا يُقارَن أصلًا. */
    const coverageFrom = await coverageStart();

    /* ── بصماتُ الجهاز ─────────────────────────────────────────────── */
    const logParams = [];
    const logClause = logFilters(filter, logParams);

    /* ── الأعدادُ الحقيقية (2026-11-02) ───────────────────────────────
       القوائمُ تُقتطع عند سقفٍ (عيّنةٌ معروضة)، لكن الأرقامَ في الملخّص
       يجب أن تكون كلَّها لا عيّنةً منها: وإلا قرأ المديرُ «بصمات الجهاز
       ٥٠٠» وهي ٥٥٬٩١٠ بصمة، فحُسبت المقارنةُ على مجهول.
       فالعدّ يُسأل القاعدةُ عن الكلّ، والقوائم وحدها مقتطعة. */
    /* البناء بالربط النصي لا بقالب يحوي ${}: بوابة الأمان ترفض الاستعلام
       المُنسَّق داخل قالب نصي حتى لو كانت القيمُ كلها مُعامَلة ($n). */
    const punchCounts = (await pool.query(
        'SELECT COUNT(*)::int AS device_punches,'
        + ' COUNT(*) FILTER (WHERE l."employeeId" IS NULL)::int AS unmapped_punches,'
        + ' COUNT(*) FILTER (WHERE EXISTS ('
        + '   SELECT 1 FROM attendance a2'
        + '    WHERE a2."employeeId" = l."employeeId"'
        + '      AND (a2."checkInAt" = l."attendanceTime" OR a2."checkOutAt" = l."attendanceTime")'
        + ' ))::int AS matched_punches'
        + ' FROM attendance_logs l WHERE ' + logClause,
        logParams,
    )).rows[0] || {};

    const punches = (await pool.query(
        'SELECT l.id AS log_id, l."deviceId" AS device_id, l."deviceUserId" AS device_user_id,'
        + ' l."employeeId" AS employee_id, l."attendanceTime" AS attendance_time,'
        + ' l."punchState" AS punch_state, l."verifyType" AS verify_type,'
        + ' d.name AS device_name,'
        + ' a.id AS attendance_id, a.date AS attendance_date,'
        + ' e.name AS employee_name'
        + ' FROM attendance_logs l'
        + ' LEFT JOIN attendance_devices d ON d.id = l."deviceId"'
        + ' LEFT JOIN employees e ON e.id = l."employeeId"'
        + ' LEFT JOIN attendance a'
        + '   ON a."employeeId" = l."employeeId"'
        + '  AND (a."checkInAt" = l."attendanceTime" OR a."checkOutAt" = l."attendanceTime")'
        + ' WHERE ' + logClause
        + ' ORDER BY l."attendanceTime" DESC'
        + ' LIMIT $' + (logParams.length + 1),
        [...logParams, Math.max(1, Math.min(2000, Number(limit) || 500))],
    )).rows;

    /* ── صفوفُ الحضور ──────────────────────────────────────────────── */
    const rowParams = [];
    const rowWhere = [];
    if (from) {rowParams.push(from); rowWhere.push('a.date >= $' + rowParams.length);}
    if (to) {rowParams.push(to); rowWhere.push('a.date <= $' + rowParams.length);}
    if (employeeId != null && employeeId !== '') {rowParams.push(employeeId); rowWhere.push('a."employeeId" = $' + rowParams.length);}
    const rowClause = rowWhere.length ? 'WHERE ' + rowWhere.join(' AND ') : '';

    const rows = (await pool.query(
        'SELECT a.id AS attendance_id, a."employeeId" AS employee_id, a.date,'
        + ' a."checkIn" AS check_in, a."checkOut" AS check_out,'
        + ' a."checkInAt" AS check_in_at, a."checkOutAt" AS check_out_at,'
        + ' a.source, a.late, a."workMinutes" AS work_minutes, a.notes,'
        + ' e.name AS employee_name, e."employeeId" AS employee_no,'
        + ' (SELECT COUNT(*)::int FROM attendance_logs l'
        + '   WHERE l."employeeId" = a."employeeId"'
        + '     AND (l."attendanceTime" = a."checkInAt" OR l."attendanceTime" = a."checkOutAt")) AS device_punches'
        + ' FROM attendance a'
        + ' LEFT JOIN employees e ON e.id = a."employeeId"'
        + (rowClause ? ' ' + rowClause : '')
        + ' ORDER BY a.date DESC, a."employeeId"'
        + ' LIMIT 5000',
        rowParams,
    )).rows;

    const rowCounts = (await pool.query(
        'SELECT COUNT(*)::int AS system_rows,'
        + ' COUNT(*) FILTER (WHERE NOT EXISTS ('
        + '   SELECT 1 FROM attendance_logs l2'
        + '    WHERE l2."employeeId" = a."employeeId"'
        + '      AND (l2."attendanceTime" = a."checkInAt" OR l2."attendanceTime" = a."checkOutAt")'
        + ' ))::int AS rows_without_device_punch'
        + ' FROM attendance a'
        + (rowClause ? ' ' + rowClause : ''),
        rowParams,
    )).rows[0] || {};

    /* ── البصماتُ غير المطابقة (كلُّها، لا عيّنة) ─────────────────────
       التقريرُ لا يكفيه عدٌّ: يجب أن يعرف *لماذا* لم تُطابق كلُّ بصمة. */
    const unmatchedPunches = (await pool.query(
        'SELECT l.id AS log_id, l."deviceId" AS device_id, l."deviceUserId" AS device_user_id,'
        + ' l."employeeId" AS employee_id, l."attendanceTime" AS attendance_time,'
        + ' l."punchState" AS punch_state, e.name AS employee_name'
        + ' FROM attendance_logs l'
        + ' LEFT JOIN employees e ON e.id = l."employeeId"'
        + ' WHERE ' + logClause
        + ' AND l."employeeId" IS NOT NULL'
        + ' AND NOT EXISTS ('
        + '   SELECT 1 FROM attendance a'
        + '    WHERE a."employeeId" = l."employeeId"'
        + '      AND (a."checkInAt" = l."attendanceTime" OR a."checkOutAt" = l."attendanceTime"))'
        + ' ORDER BY l."attendanceTime" DESC'
        + ' LIMIT ' + CLASSIFY_CAP,
        logParams,
    )).rows;

    const classification = await classifyUnmatched(unmatchedPunches, coverageFrom);
    const kindById = classification.kindById;

    /* أرقامُ الجهاز غير المربوطة: تجميعٌ حسب الرقم — من أين تأتي؟ */
    const unmappedUsers = (await pool.query(
        'SELECT l."deviceId" AS device_id, d.name AS device_name,'
        + ' l."deviceUserId" AS device_user_id,'
        + ' COUNT(*)::int AS punches,'
        + ' MIN(l."attendanceTime") AS first_seen, MAX(l."attendanceTime") AS last_seen'
        + ' FROM attendance_logs l'
        + ' LEFT JOIN attendance_devices d ON d.id = l."deviceId"'
        + ' WHERE ' + logClause + ' AND l."employeeId" IS NULL'
        + ' GROUP BY l."deviceId", d.name, l."deviceUserId"'
        + ' ORDER BY punches DESC'
        + ' LIMIT 100',
        logParams,
    )).rows;

    const unmatched = punches.filter((p) => !p.attendance_id);
    const unmapped = unmatched.filter((p) => p.employee_id == null);
    const orphans = unmatched.filter((p) => p.employee_id != null);
    const rowsWithoutDevice = rows.filter((r) => Number(r.device_punches || 0) === 0);

    /* الأعدادُ أدناه كلُّها حقيقيةّةٌ من القاعدة (لا عيّنة)، والقوائمُ
       وحدها مقتطعة — لذلك يُفصَل العدّ عن العيّنة صراحةً. */
    const devicePunches = Number(punchCounts.device_punches || 0);
    const matchedPunches = Number(punchCounts.matched_punches || 0);
    const unmappedPunches = Number(punchCounts.unmapped_punches || 0);
    const systemRows = Number(rowCounts.system_rows || 0);
    const rowsWithoutDeviceCount = Number(rowCounts.rows_without_device_punch || 0);

    const byReason = (r) => {
        if (r.check_in_at == null && r.check_out_at == null) {return 'لا أوقات';}
        if (r.source === 'portal') {return 'بوابة التطبيق';}
        if (r.source === 'qr') {return 'مسح QR';}
        if (r.source === 'device') {return 'بصمة جهاز';}
        if (r.source === 'backfill') {return 'أرشيف';}
        return `يدوي (${r.source || 'غير محدد'})`;
    };

    const orphanTotal = Math.max(0, devicePunches - matchedPunches - unmappedPunches);
    const realGaps = Number(classification.gaps || 0);
    const benign = Number(classification.benign || 0);

    return {
        generated_at: new Date().toISOString(),
        range: { from: from || null, to: to || null, employee_id: employeeId || null, device_id: deviceId || null },
        /* من متىstarted النظام يسجّل الحضور — ما قبله غير قابلٍ للمقارنة. */
        coverage: {
            from: coverageFrom,
            note: coverageFrom
                ? `النظامُ لم يكن يسجّل صفوف حضور قبل ${coverageFrom} — فبصماتُ ما قبل ذلك غير قابلةٍ للمقارنة`
                : 'تعذّر تحديد بداية تسجيل النظام لصفوف الحضور',
        },
        summary: {
            device_punches: devicePunches,
            matched: matchedPunches,
            orphan_punches: orphanTotal,
            unmapped_punches: unmappedPunches,
            system_rows: systemRows,
            rows_with_device_punch: Math.max(0, systemRows - rowsWithoutDeviceCount),
            rows_without_device_punch: rowsWithoutDeviceCount,
            /* التفصيلُ الصادق: كم «فقيدة» حقيقيةً وكم تكرارٌ مُتجاهَل. */
            real_gaps: realGaps,
            benign_duplicates: benign,
            unmatched_before_coverage: Number(classification.before_coverage || 0),
        },
        /* القوائمُ المعروضة عيّناتٌ مقتطعة، والملخّصُ فوقه أعدادٌ كاملة.
           بلا هذا الفصل يقرأ المديرُ «فقديدتان» وهو أمامه ١١. */
        sample_limits: {
            punches_listed: punches.length,
            punches_cap: Math.max(1, Math.min(2000, Number(limit) || 500)),
            rows_listed: rows.length,
            rows_cap: 5000,
            lists_are_samples: true,
        },
        classification: {
            total_unmatched: Number(classification.total || 0),
            compared: Number(classification.compared || 0),
            before_coverage: Number(classification.before_coverage || 0),
            real_gaps: realGaps,
            benign_duplicates: benign,
            gap_days: Number((classification.gapDays || []).length),
            gap_days_without_row: Number(classification.gapDaysWithoutRow || 0),
            buckets: (classification.buckets || []).map((b) => ({
                kind: b.kind,
                label: b.label,
                gap: b.gap,
                count: b.count,
                samples: b.samples,
            })),
        },
        /* أيامُ الفجوة: كلُّ يومِ موظفٍ ناقص بصمتهُ — هذا ما يُراجَع ويُصلَح. */
        gap_days: (classification.gapDays || []).slice(0, 500).map((g) => ({
            employee_id: g.employee_id,
            employee_name: g.employee_name,
            date: g.date,
            has_row: g.has_row,
            kinds: g.kinds,
            kind_labels: g.kind_labels || [],
            punches: (g.punches || []).map((p) => ({
                log_id: p.log_id,
                attendance_time: p.attendance_time,
                punch_state: p.punch_state,
                kind: p.kind,
            })),
        })),
        unmapped_users: unmappedUsers,
        orphans: orphans.map((p) => ({
            log_id: p.log_id,
            device_id: p.device_id,
            device_name: p.device_name,
            device_user_id: p.device_user_id,
            employee_id: p.employee_id,
            employee_name: p.employee_name,
            attendance_time: p.attendance_time,
            punch_state: p.punch_state,
            kind: kindById.get(p.log_id) || null,
            kind_label: (KIND_META[kindById.get(p.log_id)] || {}).label || null,
            gap: Boolean((KIND_META[kindById.get(p.log_id)] || {}).gap),
        })),
        unmapped: unmapped.map((p) => ({
            log_id: p.log_id,
            device_id: p.device_id,
            device_name: p.device_name,
            device_user_id: p.device_user_id,
            attendance_time: p.attendance_time,
            punch_state: p.punch_state,
        })),
        rows_without_device_punch: rowsWithoutDevice.map((r) => ({
            attendance_id: r.attendance_id,
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            employee_no: r.employee_no,
            date: r.date,
            check_in: r.check_in,
            check_out: r.check_out,
            source: r.source,
            reason: byReason(r),
        })),
    };
}

module.exports = { deviceSystemReconciliation, WORK_TZ, KIND, KIND_META };
