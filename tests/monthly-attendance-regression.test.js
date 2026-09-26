const { buildMonthlyAttendanceSummaryQuery } = require('../backend/monthly-attendance-query');

describe('monthly attendance summary query', () => {
  test('uses valid PostgreSQL aggregate syntax instead of invalid COUNT(a.*)', () => {
    const sql = buildMonthlyAttendanceSummaryQuery();

    expect(sql).toContain('COUNT(a.id)::int AS days');
    expect(sql).toContain('COUNT(a."checkIn")::int AS present');
    expect(sql).toContain('COUNT(*) FILTER (WHERE a.late)::int AS late');
    expect(sql).not.toContain('COUNT(a.*)');
  });
});
