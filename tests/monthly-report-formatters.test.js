const { formatLateSummary, formatLateRow, formatHours } = require('../backend/report-formatters');

describe('monthly report formatters', () => {
  test('formats aggregate delay without mixing day count with total minutes', () => {
    expect(formatLateSummary({ totalMinutes: 200762, lateDays: 938 })).toBe('3346.0 ساعة <small>(200762 دقيقة)</small>');
  });

  test('formats per-employee delay detail with day count and total minutes', () => {
    expect(formatLateRow({ lateMinutes: 4609, lateDays: 9 })).toBe('9 يوم <small>(4609 دقيقة)</small>');
  });

  test('formats duration cleanly in hours', () => {
    expect(formatHours(3346.0)).toBe('3346.0 ساعة');
  });
});
