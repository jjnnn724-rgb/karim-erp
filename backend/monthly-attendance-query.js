function buildMonthlyAttendanceSummaryQuery() {
  return `SELECT e.id, e.name, e."employeeId", e."deviceUserId", e.department, e.position, e.shift_start, e.shift_karim,
                COUNT(a.id)::int AS days, COUNT(a."checkIn")::int AS present,
                COUNT(a."checkOut")::int AS complete, COUNT(*) FILTER (WHERE a.late)::int AS late,
                COUNT(*) FILTER (WHERE a.on_leave)::int AS leave_days,
                COALESCE(SUM(a."workMinutes") FILTER (WHERE NOT a.on_leave),0)::int AS minutes
           FROM employees e LEFT JOIN attendance a
             ON a."employeeId" = e.id AND a.date LIKE $1 || '-%'
          WHERE e.status = 'active'
          GROUP BY e.id, e.shift_start, e.shift_karim ORDER BY e.name`;
}

module.exports = { buildMonthlyAttendanceSummaryQuery };
