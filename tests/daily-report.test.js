const { renderDailyReportHtml, smtpConfigured, todayInTimezone } = require('../backend/daily-report-service');

describe('daily management report', () => {
  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.REPORT_EMAIL_TO;
  });

  test('renders Arabic daily report sections and escapes values', () => {
    const html = renderDailyReportHtml({
      reportDate: '2026-08-19', timezone: 'Asia/Riyadh', generatedAt: 'now',
      sales: { gross_sales: '100.50', invoice_count: 2 },
      departments: [{ name_ar: '<قسم>', invoice_count: 2, revenue: '100.50' }],
      payments: [], topProducts: [], expenses: { expense_count: 0, total: 0 },
      attendance: { attendance_count: 0, checked_in: 0, checked_out: 0 }, lowStock: [],
    });
    expect(html).toContain('التقرير اليومي');
    expect(html).toContain('&lt;قسم&gt;');
    expect(html).toContain('100.50');
  });

  test('does not claim SMTP is configured without all required values', () => {
    expect(smtpConfigured()).toBe(false);
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';
    process.env.REPORT_EMAIL_TO = 'owner@example.test';
    expect(smtpConfigured()).toBe(true);
  });

  test('returns a Saudi-calendar date shape', () => {
    expect(todayInTimezone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
