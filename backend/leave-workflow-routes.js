const express = require('express');
const { pool } = require('./cashier-module/db-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');

const router = express.Router();
// سلسلة الاعتماد (2026-10-01 بطلب المالك): الموظف ← مديره المباشر (رئيس قسمه)
// ← المدير العام ← شؤون العاملين (تقفل الطلب). بلا مدير تشغيل.
const STAGES = ['direct_manager', 'general_manager', 'hr'];
const STAGE_LABELS = {
  employee: 'الموظف',
  direct_manager: 'المدير المباشر',
  operations_manager: 'مدير التشغيل', // مرحلة ملغاة — تُبقى للسجلات القديمة فقط
  general_manager: 'المدير العام',
  hr: 'شؤون العاملين',
};
const STAGE_ROLES = {
  direct_manager: ['manager', 'admin', 'dept_head'],
  general_manager: ['admin', 'manager'],
  hr: ['hr', 'admin'],
};
let schemaPromise;

async function ensureLeaveWorkflowSchema() {
  if (schemaPromise) {return schemaPromise;}
  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_approval_workflows (
        id BIGSERIAL PRIMARY KEY,
        leave_request_id BIGINT NOT NULL UNIQUE,
        current_stage VARCHAR(40) NOT NULL DEFAULT 'direct_manager',
        status VARCHAR(30) NOT NULL DEFAULT 'in_progress',
        current_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS leave_approval_events (
        id BIGSERIAL PRIMARY KEY,
        workflow_id BIGINT NOT NULL REFERENCES leave_approval_workflows(id) ON DELETE CASCADE,
        stage VARCHAR(40) NOT NULL,
        action VARCHAR(30) NOT NULL,
        note TEXT,
        actor_user_id BIGINT,
        actor_role VARCHAR(40),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_leave_workflows_stage_status ON leave_approval_workflows(current_stage,status,updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_leave_events_workflow ON leave_approval_events(workflow_id,created_at DESC);
      INSERT INTO leave_approval_workflows(leave_request_id,current_stage,status,current_note,completed_at)
      SELECT lr.id,
             CASE WHEN lr.status='approved' THEN 'hr' WHEN lr.status='rejected' THEN 'direct_manager' ELSE 'direct_manager' END,
             CASE WHEN lr.status='approved' THEN 'completed' WHEN lr.status='rejected' THEN 'rejected' ELSE 'in_progress' END,
             COALESCE(lr."rejectionReason",lr.reason),
             CASE WHEN lr.status='approved' THEN CURRENT_TIMESTAMP ELSE NULL END
        FROM "leaveRequests" lr
       WHERE NOT EXISTS (SELECT 1 FROM leave_approval_workflows w WHERE w.leave_request_id=lr.id);
      -- ترحيل 2026-10-01: طلبات عالقة لدى مدير التشغيل (مرحلة ملغاة) تتقدم للمدير العام
      UPDATE leave_approval_workflows SET current_stage='general_manager', updated_at=CURRENT_TIMESTAMP
       WHERE current_stage='operations_manager' AND status='in_progress';
    `);
  })();
  return schemaPromise;
}

function fail(res, status, error, message) { return res.status(status).json({ error, message }); }
// Listing visibility: elevated roles see all leave requests (they act on them).
function isPrivileged(user) { return ['admin', 'hr', 'manager'].includes(user?.role); }
// Stage enforcement is stricter: only a general admin may act on any stage;
// 'hr' and 'manager' must follow the stage chain like everyone else
// (previously they bypassed every stage, including the general-manager stage).
function canActOnStage(user, stage) {
  if (user?.role === 'admin') {return true;}
  return (STAGE_ROLES[stage] || []).includes(user?.role);
}
// ─── تدقيق أمني جولة 2: منع التصديق الذاتي في سلسلة الإجازات ───
// مدير/hr يقدّم إجازة لنفسه (isPrivileged يسمح بالطلب لأي موظف) ثم يعتمدها
// بنفسه في مرحلته — قرار مالي (راتب إجازة) بلا مراجعة. صاحب الطلب لا
// يصدّق/يرفض/يعيد طلبه بنفسه؛ admin استثناء موثّق (لا يوجد من فوقه
// في السلسلة، ورفضه يترك إجازاته معلّقة إلى الأبد).
function canDecideLeave(user, stage, isOwner) {
  const allowed = STAGE_ROLES[stage] || [];
  if (!allowed.includes(user?.role)) {return { ok: false, code: 'LEAVE_STAGE_FORBIDDEN' };}
  if (isOwner && user?.role !== 'admin') {return { ok: false, code: 'LEAVE_SELF_APPROVAL_FORBIDDEN' };}
  return { ok: true };
}
async function employeeForUser(userId) {
  return (await pool.query('SELECT * FROM employees WHERE "userId"=$1 LIMIT 1', [userId])).rows[0] || null;
}
function eventLabel(action) {
  return { submitted: 'تم تقديم الطلب', approve: 'تمت الموافقة على المرحلة', reject: 'تم رفض الطلب', return: 'أعيد للموظف للتعديل', resubmit: 'أعيد إرسال الطلب' }[action] || action;
}

router.get('/leave-workflow', jwtAuth, async (req, res) => {
  try {
    await ensureLeaveWorkflowSchema();
    const employee = isPrivileged(req.user) ? null : await employeeForUser(req.user.id);
    const params = [];
    let filter = '';
    if (isPrivileged(req.user)) {
      filter = '';
    } else if (req.user?.role === 'dept_head' && req.user?.dept_code) {
      // رئيس القسم يرى طلبات قسمه فقط (للموافقة عليها) — بطلب المالك 2026-10-01
      params.push(String(req.user.dept_code).toLowerCase());
      filter = `WHERE LOWER(COALESCE(dept_emp.department,''))=$${params.length}`;
    } else if (employee) {
      params.push(employee.id); filter = `WHERE lr."employeeId"=$${params.length}`;
    } else { return res.json([]); }
    const rows = (await pool.query(`
      SELECT lr.*,w.id AS workflow_id,w.current_stage,w.status AS workflow_status,w.current_note,w.updated_at AS workflow_updated_at,w.completed_at,
             e.name AS employee_name,lt.name AS leave_type_name,lt.icon AS leave_type_icon,
             COALESCE((SELECT json_agg(ev ORDER BY ev.created_at ASC) FROM leave_approval_events ev WHERE ev.workflow_id=w.id),'[]') AS events
        FROM "leaveRequests" lr
        JOIN leave_approval_workflows w ON w.leave_request_id=lr.id
        LEFT JOIN employees e ON e.id=lr."employeeId"
        LEFT JOIN employees dept_emp ON dept_emp.id=lr."employeeId"
        LEFT JOIN "leaveTypes" lt ON lt.id=lr."leaveTypeId"
        ${filter}
       ORDER BY lr."requestDate" DESC NULLS LAST,lr.id DESC`, params)).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'LEAVE_WORKFLOW_LIST_FAILED', message: 'تعذر جلب طلبات الإجازة' }); }
});

router.get('/leave-workflow/:id', jwtAuth, async (req, res) => {
  try {
    await ensureLeaveWorkflowSchema();
    const row = (await pool.query(`SELECT lr.*,w.id AS workflow_id,w.current_stage,w.status AS workflow_status,w.current_note,w.updated_at AS workflow_updated_at,w.completed_at,e.name AS employee_name,lt.name AS leave_type_name,lt.icon AS leave_type_icon FROM "leaveRequests" lr JOIN leave_approval_workflows w ON w.leave_request_id=lr.id LEFT JOIN employees e ON e.id=lr."employeeId" LEFT JOIN "leaveTypes" lt ON lt.id=lr."leaveTypeId" WHERE lr.id=$1`, [req.params.id])).rows[0];
    if (!row) {return fail(res, 404, 'LEAVE_NOT_FOUND', 'طلب الإجازة غير موجود');}
    if (!isPrivileged(req.user)) {
      const employee = await employeeForUser(req.user.id);
      const isOwner = employee && String(employee.id) === String(row.employeeId);
      let sameDept = false;
      if (req.user?.role === 'dept_head' && req.user?.dept_code) {
        const reqEmp = (await pool.query('SELECT department FROM employees WHERE id=$1 LIMIT 1', [row.employeeId])).rows[0];
        sameDept = String(reqEmp?.department || '').toLowerCase() === String(req.user.dept_code).toLowerCase();
      }
      if (!isOwner && !sameDept) {return fail(res, 403, 'LEAVE_FORBIDDEN', 'لا تملك صلاحية عرض هذا الطلب');}
    }
    row.events = (await pool.query('SELECT * FROM leave_approval_events WHERE workflow_id=$1 ORDER BY created_at ASC,id ASC', [row.workflow_id])).rows;
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'LEAVE_WORKFLOW_DETAILS_FAILED', message: 'تعذر جلب تفاصيل طلب الإجازة' }); }
});

router.post('/leave-requests', jwtAuth, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await ensureLeaveWorkflowSchema();
    const requestedEmployeeId = Number(req.body?.employeeId), leaveTypeId = Number(req.body?.leaveTypeId);
    const startDate = String(req.body?.startDate || '').trim(), endDate = String(req.body?.endDate || '').trim(), reason = String(req.body?.reason || '').trim();
    if (!Number.isInteger(leaveTypeId) || !startDate || !endDate || new Date(endDate) < new Date(startDate)) {return fail(res, 422, 'INVALID_LEAVE_REQUEST', 'تحقق من نوع الإجازة والتواريخ');}
    const ownEmployee = await employeeForUser(req.user.id);
    const employeeId = isPrivileged(req.user) ? requestedEmployeeId : Number(ownEmployee?.id);
    if (!Number.isInteger(employeeId)) {return fail(res, 422, 'EMPLOYEE_LINK_REQUIRED', 'الحساب غير مرتبط بملف موظف');}
    const employee = (await client.query('SELECT id,name FROM employees WHERE id=$1 LIMIT 1', [employeeId])).rows[0];
    const leaveType = (await client.query('SELECT id,name FROM "leaveTypes" WHERE id=$1 LIMIT 1', [leaveTypeId])).rows[0];
    if (!employee || !leaveType) {return fail(res, 422, 'LEAVE_REFERENCE_NOT_FOUND', 'الموظف أو نوع الإجازة غير موجود');}
    await client.query('BEGIN');
    const leave = (await client.query(`INSERT INTO "leaveRequests"("id","employeeId","leaveTypeId","startDate","endDate","status","reason","requestDate","requestedBy") VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8) RETURNING *`, [Date.now(), employeeId, leaveTypeId, startDate, endDate, reason || null, new Date().toISOString().slice(0,10), req.user.id])).rows[0];
    const workflow = (await client.query(`INSERT INTO leave_approval_workflows(leave_request_id,current_stage,status,current_note) VALUES($1,'direct_manager','in_progress',$2) RETURNING *`, [leave.id, reason || null])).rows[0];
    await client.query(`INSERT INTO leave_approval_events(workflow_id,stage,action,note,actor_user_id,actor_role) VALUES($1,'employee','submitted',$2,$3,$4)`, [workflow.id, reason || null, req.user.id, req.user.role]);
    await client.query('COMMIT');
    res.status(201).json({ leave, workflow, stage_label: STAGE_LABELS.direct_manager });
  } catch (e) { if (client) {await client.query('ROLLBACK').catch(() => {});} res.status(e.statusCode || 422).json({ error: e.code || 'LEAVE_CREATE_FAILED', message: 'تعذر إنشاء طلب الإجازة' }); }
  finally { if (client) {client.release();} }
});

router.post('/leave-workflow/:id/action', jwtAuth, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await ensureLeaveWorkflowSchema();
    const action = String(req.body?.action || '').trim(), note = String(req.body?.note || '').trim();
    if (!['approve','reject','return','resubmit'].includes(action)) {return fail(res, 422, 'INVALID_LEAVE_ACTION', 'الإجراء غير صحيح');}
    await client.query('BEGIN');
    const workflow = (await client.query('SELECT * FROM leave_approval_workflows WHERE leave_request_id=$1 FOR UPDATE', [req.params.id])).rows[0];
    const leave = (await client.query('SELECT * FROM "leaveRequests" WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!workflow || !leave) { await client.query('ROLLBACK'); return fail(res, 404, 'LEAVE_NOT_FOUND', 'طلب الإجازة غير موجود'); }
    const employee = (await client.query('SELECT * FROM employees WHERE id=$1 LIMIT 1', [leave.employeeId])).rows[0];
    const isOwner = employee && String(employee.userId) === String(req.user.id);
    if (action === 'resubmit') {
      if (!isOwner || workflow.status !== 'returned') { await client.query('ROLLBACK'); return fail(res, 403, 'LEAVE_ACTION_FORBIDDEN', 'لا يمكن إعادة إرسال هذا الطلب'); }
      await client.query(`UPDATE leave_approval_workflows SET current_stage='direct_manager',status='in_progress',current_note=$2,updated_at=CURRENT_TIMESTAMP,completed_at=NULL WHERE id=$1`, [workflow.id, note || null]);
      await client.query(`UPDATE "leaveRequests" SET status='pending',"rejectionReason"=NULL,"rejectedBy"=NULL,"rejectedDate"=NULL WHERE id=$1`, [leave.id]);
      await client.query(`INSERT INTO leave_approval_events(workflow_id,stage,action,note,actor_user_id,actor_role) VALUES($1,'employee','resubmit',$2,$3,$4)`, [workflow.id, note || null, req.user.id, req.user.role]);
    } else {
      const decision = canDecideLeave(req.user, workflow.current_stage, isOwner);
      if (!decision.ok) {
        await client.query('ROLLBACK');
        if (decision.code === 'LEAVE_SELF_APPROVAL_FORBIDDEN') {
          return fail(res, 403, 'LEAVE_SELF_APPROVAL_FORBIDDEN', 'لا يمكنك التصديق على طلب إجازتك الشخصية — يمر عبر سلسلة المراجعة');
        }
        return fail(res, 403, 'LEAVE_STAGE_FORBIDDEN', `الطلب موجود لدى ${STAGE_LABELS[workflow.current_stage]}`);
      }
      // نطاق القسم (2026-10-01): رئيس القسم يبت في طلبات قسمه فقط — لا أقسام أخرى
      if (req.user?.role === 'dept_head' && workflow.current_stage === 'direct_manager') {
        const reqEmp = (await client.query('SELECT department FROM employees WHERE id=$1 LIMIT 1', [leave.employeeId])).rows[0];
        const empDept = String(reqEmp?.department || '').toLowerCase();
        const myDept = String(req.user?.dept_code || '').toLowerCase();
        if (!myDept || empDept !== myDept) {
          await client.query('ROLLBACK');
          return fail(res, 403, 'LEAVE_DEPT_FORBIDDEN', 'تعتمد طلبات قسمك فقط — هذا الطلب لقسم آخر');
        }
      }
      if (workflow.status !== 'in_progress') { await client.query('ROLLBACK'); return fail(res, 409, 'LEAVE_NOT_ACTIONABLE', 'الطلب ليس في حالة قابلة للإجراء'); }
      let nextStage = workflow.current_stage, nextStatus = 'in_progress', completedAt = null;
      if (action === 'approve') {
        const index = STAGES.indexOf(workflow.current_stage);
        if (index === STAGES.length - 1) { nextStatus = 'completed'; completedAt = new Date(); }
        else {nextStage = STAGES[index + 1];}
      } else if (action === 'reject') { nextStatus = 'rejected'; }
      else if (action === 'return') { nextStage = 'employee'; nextStatus = 'returned'; }
      await client.query(`UPDATE leave_approval_workflows SET current_stage=$2,status=$3,current_note=$4,updated_at=CURRENT_TIMESTAMP,completed_at=$5 WHERE id=$1`, [workflow.id, nextStage, nextStatus, note || null, completedAt]);
      const leaveUpdate = action === 'reject' ? `UPDATE "leaveRequests" SET status='rejected',"rejectionReason"=$2,"rejectedBy"=$3,"rejectedDate"=$4 WHERE id=$1` : action === 'return' ? `UPDATE "leaveRequests" SET status='returned',"rejectionReason"=$2 WHERE id=$1` : nextStatus === 'completed' ? `UPDATE "leaveRequests" SET status='approved',"approvedBy"=$2,"approvedDate"=$3 WHERE id=$1` : `UPDATE "leaveRequests" SET status='pending' WHERE id=$1`;
      const leaveParams = action === 'reject' ? [leave.id,note || 'تم رفض الطلب',req.user.id,new Date().toISOString().slice(0,10)] : action === 'return' ? [leave.id,note || 'يرجى استكمال البيانات'] : nextStatus === 'completed' ? [leave.id,req.user.id,new Date().toISOString().slice(0,10)] : [leave.id];
      await client.query(leaveUpdate, leaveParams);
      await client.query(`INSERT INTO leave_approval_events(workflow_id,stage,action,note,actor_user_id,actor_role) VALUES($1,$2,$3,$4,$5,$6)`, [workflow.id, workflow.current_stage, action, note || null, req.user.id, req.user.role]);
    }
    await client.query('COMMIT');
    const updated = (await pool.query(`SELECT w.*,lr.status AS leave_status FROM leave_approval_workflows w JOIN "leaveRequests" lr ON lr.id=w.leave_request_id WHERE w.id=$1`, [workflow.id])).rows[0];
    res.json({ workflow: updated, stage_label: STAGE_LABELS[updated.current_stage] || updated.current_stage, event_label: eventLabel(action) });
  } catch (e) { if (client) {await client.query('ROLLBACK').catch(() => {});} res.status(422).json({ error: e.code || 'LEAVE_ACTION_FAILED', message: 'تعذر تنفيذ الإجراء على طلب الإجازة' }); }
  finally { if (client) {client.release();} }
});

module.exports = { router, ensureLeaveWorkflowSchema, STAGES, STAGE_LABELS, STAGE_ROLES, canDecideLeave };
