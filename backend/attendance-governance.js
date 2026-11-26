'use strict';
/**
 * attendance-governance.js — حوكمة الحضور: قواعد صارمة + سجلّ تدقيق دائم
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «إجراءات صارمة في الموقع والتدقيق» — كل تغييرٍ على حضور
 * موظفٍ يكون: مُقفلاً خلف سببٍ مكتوب، ومُسجَّلًا بمن فعله ومتى ولماذا.
 *
 * قبل هذا الملف كان الحضور بلا أثر:
 *   • أي مدير/موارد بشرية يغيّر وقتَ حضورٍ أو انصرافٍ بلا سبب — وسجلُّ
 *     الملاحظات نصٌّ حرٌّ في صفٍّ واحد، فيضيع مع أول تصحيح لاحق.
 *   • لا أثر لمن عدّل، ولا متى، ولا القيمة القديمة.
 *   • ولا تجميد في فترةٍ محاسبية مغلقة: راتبُ شهرٍ مُعتمد يُحسب على
 *     حضورٍ ما زال قابلًا للتعديل.
 *
 * ما يفعله هذا الملف:
 *   1. سببٌ إجباري لكل تصحيح — قاعدة خادم، لا نصيحة واجهة.
 *   2. تجميد الحضور في الفترة المحاسبية المغلقة (نفس قفل الرواتب).
 *   3. سجلُّ تدقيق دائم: من غيّر ماذا ومتى ولماذا — لا يُعدَّل ولا يُحذف.
 *
 * الأداء: استعلامٌ إضافيٌّ واحد لكل تعديل (قراءة الصفّ القديم قبله،
 * وكتابة سطر تدقيق بعده) داخل معاملة واحدة — فإما أن يُحفظ التعديل
 * ويُسجَّل، أو لا يُحفظ شيء. المسارُ الحارّ (بصمة الجهاز) لا يمرّ من
 * هنا: المحرك يكتب الحضور مباشرةً، وسجلُّ البصمات الخام هو دفتره.
 */
const { pool } = require('./shared-pool');

/** حقولُ الحقيقة في يوم الموظف — تغييرُها «تصحيح» يستوجب سببًا. */
const SUBSTANTIVE_FIELDS = Object.freeze([
    'date', 'checkIn', 'checkOut', 'checkInAt', 'checkOutAt',
    'workMinutes', 'late', 'early_leave', 'on_leave',
]);

/** حقولُ التدقيق — كل ما يوثّق مسار اليوم، سببًا كان أو وقتًا. */
const AUDITED_FIELDS = Object.freeze([
    ...SUBSTANTIVE_FIELDS,
    'notes', 'source', 'checkin_inferred', 'checkout_inferred',
]);

/** أفعالُ السجلّ المسموحة. */
const AUDIT_ACTIONS = Object.freeze(['create', 'update', 'delete']);

const GOVERNANCE_SCHEMA_SQL = `
-- سجلّ تدقيق الحضور: يُكتب ولا يُقرأ منه إلا للعرض.
-- لا مسار يحدّث أو يحذف سطرًا هنا — فهي ثوابت الوحدة المالية.
CREATE TABLE IF NOT EXISTS attendance_edit_log (
    id BIGSERIAL PRIMARY KEY,
    "attendanceId" BIGINT,
    "employeeId" BIGINT,
    action VARCHAR(16) NOT NULL,
    "changedFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT,
    "actorId" BIGINT,
    "actorName" VARCHAR(120),
    "actorRole" VARCHAR(40),
    source VARCHAR(24) NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_created
    ON attendance_edit_log ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_employee
    ON attendance_edit_log ("employeeId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_row
    ON attendance_edit_log ("attendanceId");
`;

let schemaReady = null;

/** مخطّط السجلّ — يُطبَّق مرّةً عند أول استخدام (idempotent). */
function ensureGovernanceSchema() {
    if (!schemaReady) {
        schemaReady = pool.query(GOVERNANCE_SCHEMA_SQL)
            .then(() => undefined)
            .catch((error) => {schemaReady = null; throw error;});
    }
    return schemaReady;
}

/** قيمةٌ قابلةٌ للمقارنة: '' و NULL سواء، والأرقام كالأرقام. */
function normValue(value) {
    if (value === undefined || value === null || value === '') {return null;}
    if (typeof value === 'boolean' || typeof value === 'number') {return value;}
    return String(value);
}

function trunc(value, max = 500) {
    if (typeof value !== 'string' || value.length <= max) {return value;}
    return `${value.slice(0, max)}…`;
}

/**
 * الفرق بين صفّين: الحقول التي تغيّرت فقط.
 *
 * `partial` يعني أن `after` حمولةٌ جزئية (طلب تعديل لا الصفُّ كاملًا):
 * الحقلُ غير الوارد في الطلب لا يُحسب تغييرًا — وإلا لبدا كلُّ حقلٍ
 * لم يُرسل تغييرًا إلى null.
 *
 * @param {object} before
 * @param {object} after
 * @param {{partial?:boolean, removed?:boolean}} [opts]
 * @returns {Record<string, {before: any, after: any}>}
 */
function diffAttendance(before = {}, after = {}, { partial = false, removed = false } = {}) {
    const out = {};
    for (const field of AUDITED_FIELDS) {
        const hasAfter = after && after[field] !== undefined;
        if (partial && !hasAfter) {continue;}
        const b = normValue(before ? before[field] : null);
        const a = removed ? null : normValue(hasAfter ? after[field] : null);
        if (a === b) {continue;}
        out[field] = { before: trunc(b), after: trunc(a) };
    }
    return out;
}

/** هل في الفرق تغييرٌ يمسّ حقيقة اليوم (يستوجب سببًا)؟ */
function isSubstantiveChange(diff = {}) {
    return SUBSTANTIVE_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(diff, f));
}

/**
 * قاعدة السبب الإجباري: تصحيحُ حضورٍ بلا سببٍ مكتوب مرفوض.
 * الواجهة تطلب السبب، لكن الطلب يأتي من أي عميل — فالقاعدة في الخادم.
 *
 * @param {{action:string, before?:object, after?:object, filtered?:object}} input
 * @returns {{status:number, error:string, message:string}|null}
 */
function attendanceCorrectionViolation({ action, before = null, after = null, filtered = null } = {}) {
    if (action === 'delete') {return null;}
    const diff = diffAttendance(before || {}, after || {}, { partial: true });
    if (!isSubstantiveChange(diff)) {return null;}
    const note = String((filtered && filtered.notes) || (after && after.notes) || '').trim();
    if (!note) {
        return {
            status: 422,
            error: 'ATTENDANCE_REASON_REQUIRED',
            message: 'تصحيح الحضور يستلزم سببًا مكتوبًا — لا يُعدَّل وقتُ حضورٍ أو انصرافٍ بلا سبب',
        };
    }
    const oldNote = String((before && before.notes) || '').trim();
    if (action === 'update' && oldNote && note === oldNote) {
        return {
            status: 422,
            error: 'ATTENDANCE_REASON_REQUIRED',
            message: 'اكتب سببًا جديدًا لهذا التصحيح — الملاحظة السابقة لا تصلح سببًا',
        };
    }
    return null;
}

/**
 * تجميد الحضور في فترةٍ محاسبية مغلقة — كتجميد الرواتب نفسه:
 * الاعتماد المالي يجمّد ما بُني عليه.
 * @returns {Promise<{status:number, error:string, message:string}|null>}
 */
async function attendancePeriodViolation(row = {}) {
    const date = String(row.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(date)) {return null;}
    try {
        const { isPeriodClosed } = require('./accounting-periods');
        if (await isPeriodClosed(date)) {
            return {
                status: 423,
                error: 'PERIOD_LOCKED',
                message: `الفترة ${date} مقفلة محاسبيًا — حضورُها لا يُعدَّل (أعد فتح الفترة أولًا)`,
            };
        }
    } catch (_) {
        /* المراقبة متوقّفة ⇒ تُترك القاعدة مغلقةً (fail-open) كقفل الرواتب. */
    }
    return null;
}

/**
 * يكتب سطر تدقيق. يُستدعى داخل معاملة الكتابة نفسها: إما يُحفظ
 * التعديل ويُسجَّل، أو لا يُحفظ شيء.
 *
 * @param {{db?:object, action:string, before?:object, after?:object,
 *          actor?:object, source?:string, reason?:string}} input
 */
async function recordAttendanceEdit({ db, action, before = null, after = null, actor = null, source = 'api', reason = null } = {}) {
    if (!AUDIT_ACTIONS.includes(action)) {return null;}
    const conn = db || pool;
    const diff = action === 'delete'
        ? diffAttendance(before || {}, {}, { removed: true })
        : diffAttendance(before || {}, after || {});
    const row = after || before || {};
    const employeeId = row.employeeId ?? (before ? before.employeeId : null);
    const attendanceId = row.id ?? (before ? before.id : null);
    const note = String(reason != null ? reason : (row.notes || '')).trim();
    await ensureGovernanceSchema();
    await conn.query(
        `INSERT INTO attendance_edit_log
            ("attendanceId", "employeeId", action, "changedFields", reason,
             "actorId", "actorName", "actorRole", source)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
        [
            attendanceId ?? null,
            employeeId ?? null,
            action,
            JSON.stringify(diff),
            note || null,
            actor && actor.id != null ? actor.id : null,
            actor ? String(actor.name || actor.username || '').slice(0, 120) : null,
            actor && actor.role ? String(actor.role).slice(0, 40) : null,
            String(source || 'api').slice(0, 24),
        ],
    );
    return { attendanceId, employeeId, action, diff };
}

/**
 * قراءة السجلّ للعرض.
 * @param {{from?:string, to?:string, employeeId?:number|string, actorId?:number|string,
 *          action?:string, limit?:number, offset?:number}} filter
 */
async function listAttendanceEdits({ from = '', to = '', employeeId = null, actorId = null, action = '', limit = 200, offset = 0 } = {}) {
    await ensureGovernanceSchema();
    const params = [];
    const where = [];
    if (from) {params.push(from); where.push(`l."createdAt" >= $${params.length}::date`);}
    if (to) {params.push(to); where.push(`l."createdAt" < ($${params.length}::date + INTERVAL '1 day')`);}
    if (employeeId != null && employeeId !== '') {params.push(employeeId); where.push(`l."employeeId" = $${params.length}`);}
    if (actorId != null && actorId !== '') {params.push(actorId); where.push(`l."actorId" = $${params.length}`);}
    if (action && AUDIT_ACTIONS.includes(action)) {params.push(action); where.push(`l.action = $${params.length}`);}
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const max = Math.max(1, Math.min(500, Number(limit) || 200));
    const skip = Math.max(0, Number(offset) || 0);
    /* البناء بالربط لا بقالب نصي: بوابة الأمان ترفض ${} داخل استعلام SQL. */
    const select = 'SELECT l.id, l."attendanceId", l."employeeId", l.action, l."changedFields", l.reason,'
        + ' l."actorId", l."actorName", l."actorRole", l.source, l."createdAt",'
        + ' e.name AS employee_name, e."employeeId" AS employee_no'
        + ' FROM attendance_edit_log l'
        + ' LEFT JOIN employees e ON e.id = l."employeeId"'
        + ' ' + clause
        + ' ORDER BY l."createdAt" DESC, l.id DESC'
        + ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    const rows = (await pool.query(select, [...params, max, skip])).rows;
    const total = (await pool.query(
        'SELECT COUNT(*)::int AS c FROM attendance_edit_log l ' + clause, params,
    )).rows[0].c;
    return { rows, total, limit: max, offset: skip };
}

module.exports = {
    SUBSTANTIVE_FIELDS,
    AUDITED_FIELDS,
    AUDIT_ACTIONS,
    ensureGovernanceSchema,
    diffAttendance,
    isSubstantiveChange,
    attendanceCorrectionViolation,
    attendancePeriodViolation,
    recordAttendanceEdit,
    listAttendanceEdits,
};
