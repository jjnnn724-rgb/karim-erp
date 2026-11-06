const { buildMonthlyAttendanceSummaryQuery } = require('../backend/monthly-attendance-query');

describe('monthly attendance summary query', () => {
  test('uses valid PostgreSQL aggregate syntax instead of invalid COUNT(a.*)', () => {
    const sql = buildMonthlyAttendanceSummaryQuery();

    expect(sql).toContain('COUNT(a.id)::int AS days');
    expect(sql).toContain('COUNT(a."checkIn") FILTER (WHERE NOT COALESCE(a.on_leave, false))::int AS present');
    expect(sql).toContain('COUNT(a."checkOut") FILTER (WHERE NOT COALESCE(a.on_leave, false))::int AS complete');
    expect(sql).toContain('COUNT(*) FILTER (WHERE a.late AND NOT COALESCE(a.on_leave, false))::int AS late');
    expect(sql).not.toContain('COUNT(a.*)');
  });

  // قرار المالك 2026-11-02 بعد واقعة EMP-052: بصمة في يوم راحة معتمدة لا تُحوِّله إلى «مداوم».
  test('approved-leave days are excluded from presence, completion and lateness', () => {
    const sql = buildMonthlyAttendanceSummaryQuery();

    for (const alias of ['AS present', 'AS complete', 'AS late']) {
      const line = sql.split('\n').find(l => l.includes(alias));
      expect(line).toBeDefined();
      expect(line).toContain('NOT COALESCE(a.on_leave, false)');
    }
    // الإجازة تُعرض كبند مستقل لا كحضور: leave_days يبقى عدّاد on_leave.
    expect(sql).toContain('COUNT(*) FILTER (WHERE a.on_leave)::int AS leave_days');
    // أيام السجل كلها (بما فيها الراحة) تظل مرئية في days.
    expect(sql).toContain('COUNT(a.id)::int AS days');
  });

  test('minutes are summed only from real pairs on non-leave days', () => {
    const sql = buildMonthlyAttendanceSummaryQuery();

    expect(sql).toContain('NOT COALESCE(a.on_leave, false)');
    expect(sql).toContain('AS minutes');
  });

  test('emits no JavaScript-style comments inside the SQL text', () => {
    // PostgreSQL يقرأ «//» كعامل قسمة صحيحة، فأي تعليق كهذا داخل SQL يُسقط الاستعلام.
    const sql = buildMonthlyAttendanceSummaryQuery();

    expect(sql).not.toContain('//');
  });
});
