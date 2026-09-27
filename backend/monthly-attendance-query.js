function buildMonthlyAttendanceSummaryQuery() {
  // الدقائق من النصين المعروضين (HH:MM) لا من workMinutes المخزن — يمنع قيمًا
  // شاذة (25:43) من أزمنة instant متقطعة. التفاف ليلي فقط عند out<in.
  return `SELECT e.id, e.name, e."employeeId", e."deviceUserId", e.department, e.position, e.shift_start, e.shift_karim,
                 COUNT(a.id)::int AS days, COUNT(a."checkIn")::int AS present,
                 COUNT(a."checkOut")::int AS complete, COUNT(*) FILTER (WHERE a.late)::int AS late,
                 COUNT(*) FILTER (WHERE a.on_leave)::int AS leave_days,
                 COALESCE(SUM(CASE WHEN NOT COALESCE(a.on_leave, false)
                   AND a."checkIn" ~ '^\\d{1,2}:\\d{2}$' AND a."checkOut" ~ '^\\d{1,2}:\\d{2}$'
                   THEN (EXTRACT(HOUR FROM a."checkOut"::time) * 60 + EXTRACT(MINUTE FROM a."checkOut"::time))
                      - (EXTRACT(HOUR FROM a."checkIn"::time) * 60 + EXTRACT(MINUTE FROM a."checkIn"::time))
                      + CASE WHEN a."checkOut"::time < a."checkIn"::time THEN 1440 ELSE 0 END
                   ELSE 0 END),0)::int AS minutes
            FROM employees e LEFT JOIN attendance a
              ON a."employeeId" = e.id AND a.date LIKE $1 || '-%'
           WHERE e.status = 'active'
           GROUP BY e.id, e.shift_start, e.shift_karim ORDER BY e.name`;
}

module.exports = { buildMonthlyAttendanceSummaryQuery };
