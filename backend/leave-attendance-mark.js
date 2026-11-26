'use strict';
/**
 * leave-attendance-mark.js — الجذر الغائب في مسار الإجازة
 * ═══════════════════════════════════════════════════════════════════════
 * القرار (المالك 2026-11-02): الإجازة المعتمدة تُعدّل صفوف الحضور نفسها.
 * قبل كده كان on_leave يُكتب لحظة البصمة فقط (attendance-engine.js:isOnLeave)،
 * فأي اعتماد بأثر رجعي يترك اليوم مختومًا «مداوم» ببطاقة اليوم للأبد، مع
 * تأخيرٍ وساعاتٍ محسوبة من انصرافٍ لا وجود له.
 *
 * الحالة المرجعية الوحيدة هي leaveRequests بحالة 'approved'. الدالة idempotent:
 * تُعيد اشتقاق on_leave من الطلبات المعتمدة، فيردّ الإلغاء اليومَ لحالته ما دام
 * لا يوجد طلب معتمد آخر يغطّيه.
 *
 * الأوقات المخزّنة UTC والمحلي +03:00 (Asia/Riyadh) — يُقرأ الدخول بلسان
 * التوقيت المحلي لأنه المقياس الذي تُحاسب عليه الورديات.
 */
const { pool } = require('./shared-pool');
const { graceMinutes, normalizeShiftStart } = require('./shift-day');

/** هل هذه البصمة متأخرة؟ بلا سماح (قرار المالك 2026-11-02 «حتي فتره السماح شيلها»). */
function computeLate(checkInAt, shiftStart) {
    if (!checkInAt) {return null;}
    const m = normalizeShiftStart(shiftStart);
    const sm = /^(\d{1,2}):(\d{2})$/.exec(String(m || ''));
    if (!sm) {return null;}
    const startMin = Number(sm[1]) * 60 + Number(sm[2]);
    const d = new Date(new Date(checkInAt).getTime() + 3 * 60 * 60 * 1000);
    const wall = d.getUTCHours() * 60 + d.getUTCMinutes();
    return (wall - startMin + 1440) % 1440 > graceMinutes()
        && (wall - startMin + 1440) % 1440 < 720;
}

/**
 * يزامن حالة الإجازة لصفوف حضور موظف في مدى تاريخي.
 * @param {{employeeId:number|string, startDate:string, endDate:string, client?:object}} opts
 * @returns Promise<{updated:number, rows:Array}>
 */
async function syncLeaveMarks({ employeeId, startDate, endDate, client }) {
    const q = client || pool;
    const id = Number(employeeId);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!Number.isInteger(id) || !dateRe.test(String(startDate)) || !dateRe.test(String(endDate))) {
        return { updated: 0, rows: [], skipped: 'invalid-args' };
    }
    const targets = (await q.query(
        `SELECT a.id, a.date, a."checkInAt", a.on_leave AS was_on_leave, e.shift_start
           FROM attendance a JOIN employees e ON e.id = a."employeeId"
          WHERE a."employeeId" = $1 AND a.date BETWEEN $2 AND $3
          ORDER BY a.date`,
        [id, String(startDate), String(endDate)])).rows;

    let updated = 0;
    const changed = [];
    for (const row of targets) {
        const cover = await q.query(
            `SELECT 1 FROM "leaveRequests"
              WHERE "employeeId" = $1 AND status = 'approved' AND $2 BETWEEN "startDate" AND "endDate" LIMIT 1`,
            [id, row.date]);
        const onLeave = cover.rows.length > 0;
        if (onLeave === !!row.was_on_leave) {continue;}

        let patch;
        if (onLeave) {
            // يوم إجازة: لا ساعات ولا تأخير ولا انصرافٌ مبكر ولا اختلاق
            patch = { on_leave: true, workMinutes: null, late: false, early_leave: false };
        } else {
            // رُفع عنه وسم الإجازة: تُرد الدقائق من بصمتين حقيقيتين فقط
            const full = await q.query(
                `SELECT "checkInAt", "checkOutAt" FROM attendance WHERE id = $1`, [row.id]);
            const { checkInAt, checkOutAt } = full.rows[0] || {};
            const mins = (checkInAt && checkOutAt)
                ? Math.max(0, Math.round((new Date(checkOutAt) - new Date(checkInAt)) / 60000)) : null;
            patch = {
                on_leave: false,
                workMinutes: mins,
                late: computeLate(checkInAt, row.shift_start) === true,
            };
        }
        await q.query(
            `UPDATE attendance SET on_leave = $2, "workMinutes" = $3, late = $4,
                early_leave = COALESCE($5, early_leave)
              WHERE id = $1`,
            [row.id, patch.on_leave, patch.workMinutes, patch.late,
              patch.early_leave === undefined ? null : patch.early_leave]);
        updated++;
        changed.push({ id: String(row.id), date: row.date, ...patch });
    }
    return { updated, rows: changed };
}

module.exports = { syncLeaveMarks, computeLate };
