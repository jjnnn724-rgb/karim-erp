/**
 * reports-routes.js — إحاطة المدير + التقرير اليومي (مُستخلص من server.js)
 */
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { collectDailyReport, renderDailyReportHtml, sendDailyReport, smtpConfigured } = require('./daily-report-service');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function register(app, opts = {}) {
    const { pool } = opts;

    // Manager live briefing: cashiers + expenses + stock gaps + forecast + attendance + pending.
    app.get('/api/manager/briefing', jwtAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
        const { collectBriefing } = require('./manager-briefing');
        res.json({ ok: true, ...(await collectBriefing(pool, req.query.date)) });
    }));

    // Daily management report: database-backed preview and optional SMTP delivery.
    app.get('/api/reports/daily', jwtAuth, requireRole('admin', 'manager', 'auditor'), asyncHandler(async (req, res) => {
        const report = await collectDailyReport(pool, req.query.date || undefined);
        res.type('html').send(renderDailyReportHtml(report));
    }));
    app.post('/api/reports/daily/send', jwtAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
        if (!smtpConfigured()) {return res.status(503).json({ error: 'REPORT_SMTP_NOT_CONFIGURED', message: 'أضف إعدادات SMTP ومستلمي التقرير في ملف البيئة على الخادم.' });}
        const report = await sendDailyReport(pool, req.body?.date || undefined);
        res.json({ status: 'sent', reportDate: report.reportDate, recipients: process.env.REPORT_EMAIL_TO });
    }));
}

module.exports = { register };
