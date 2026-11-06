'use strict';
/**
 * punch-statement-routes.js — API كشف البصمات الخام (دخول/خروج/ساعات فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * GET /api/attendance/punches?from=YYYY-MM-DD&to=YYYY-MM-DD[&employee_id=N]
 *   • المدير/hr/manager: أي موظف، أو كل الموظفين بلا employee_id.
 *   • الموظف نفسه: كشفه وحده مهما كتب في السؤال.
 * الكشف لا يمسّ جدول `attendance` ولا حسابات التأخير: قراءةٌ فقط من
 * البصمات (attendance_logs + بصمات البوابة المقبولة + المحاولات).
 */

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { buildPunchStatement } = require('./punch-statement');
const { wallDate } = require('./business-time');

const router = express.Router();
const ADMIN_ROLES = ['admin', 'hr', 'manager'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange() {
    const today = wallDate(new Date());
    return { from: `${today.slice(0, 8)}01`, to: today };
}

router.get('/punches', jwtAuth, async (req, res) => {
    try {
        const range = defaultRange();
        const from = DAY.test(String(req.query.from || '')) ? String(req.query.from) : range.from;
        const to = DAY.test(String(req.query.to || '')) ? String(req.query.to) : range.to;
        if (from > to) {return res.status(400).json({ error: 'BAD_RANGE', message: 'من بعد إلى' });}

        let employeeIds = null;
        if (ADMIN_ROLES.includes(req.user?.role)) {
            if (req.query.employee_id) {
                const id = Number(req.query.employee_id);
                if (!Number.isInteger(id)) {return res.status(400).json({ error: 'BAD_EMPLOYEE_ID' });}
                employeeIds = [id];
            }
        } else {
            const own = await pool.query('SELECT id FROM employees WHERE "userId" = $1', [req.user.id]);
            if (!own.rows.length) {return res.status(403).json({ error: 'NO_EMPLOYEE_PROFILE', message: 'حسابك غير مرتبط بملف موظف' });}
            employeeIds = [own.rows[0].id];
        }

        const statement = await buildPunchStatement({ from, to, employeeIds });
        const totals = statement.employees.reduce((s, e) => ({
            minutesWorked: s.minutesWorked + e.totals.minutesWorked,
            employeesWithPunches: s.employeesWithPunches + (e.punchCount ? 1 : 0),
            openSegments: s.openSegments + e.totals.openSegments,
            reviewRows: s.reviewRows + e.totals.reviewRows,
        }), { minutesWorked: 0, employeesWithPunches: 0, openSegments: 0, reviewRows: 0 });
        res.json({ ...statement, totals: { ...totals, hoursWorked: Number((totals.minutesWorked / 60).toFixed(2)) } });
    } catch (e) {
        logger.error('[punch_statement]', e);
        res.status(500).json({ error: 'PUNCH_STATEMENT_FAILED', message: 'تعذر جلب كشف البصمات' });
    }
});

module.exports = router;
