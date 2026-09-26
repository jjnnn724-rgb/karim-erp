const nodemailer = require('nodemailer');
const { logger } = require('./logger');

const DEFAULT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Riyadh';
const REPORT_TIME = process.env.REPORT_EMAIL_TIME || '23:00';

function todayInTimezone(timeZone = DEFAULT_TIMEZONE) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function number(value) { return Number(value || 0); }

async function collectDailyReport(pool, reportDate = todayInTimezone()) {
    const tz = DEFAULT_TIMEZONE;
    const [sales, departments, payments, products, expenses, attendance, lowStock] = await Promise.all([
        pool.query(`
            SELECT COUNT(*)::int AS invoice_count,
                   COALESCE(SUM(total_amount),0)::numeric AS gross_sales,
                   COALESCE(SUM(discount_total),0)::numeric AS discounts,
                   COALESCE(SUM(tax_total),0)::numeric AS tax
              FROM pos_orders
             WHERE status IN ('issued','reported')
               AND (created_at AT TIME ZONE $1)::date = $2::date`, [tz, reportDate]),
        pool.query(`
            SELECT d.name_ar, d.code, COUNT(o.id)::int AS invoice_count,
                   COALESCE(SUM(o.total_amount),0)::numeric AS revenue
              FROM pos_departments d
              LEFT JOIN pos_orders o ON o.department_id=d.id
                 AND o.status IN ('issued','reported')
                 AND (o.created_at AT TIME ZONE $1)::date = $2::date
             GROUP BY d.id, d.name_ar, d.code ORDER BY revenue DESC`, [tz, reportDate]),
        pool.query(`
            SELECT method, COALESCE(SUM(amount),0)::numeric AS amount, COUNT(*)::int AS payment_count
              FROM pos_invoice_payments p JOIN pos_orders o ON o.id=p.order_id
             WHERE p.direction='in' AND o.status IN ('issued','reported')
               AND (o.created_at AT TIME ZONE $1)::date = $2::date
             GROUP BY method ORDER BY amount DESC`, [tz, reportDate]),
        pool.query(`
            SELECT i.product_name, SUM(i.quantity)::numeric AS quantity,
                   COALESCE(SUM(i.line_total),0)::numeric AS revenue
              FROM pos_order_items i JOIN pos_orders o ON o.id=i.order_id
             WHERE o.status IN ('issued','reported')
               AND (o.created_at AT TIME ZONE $1)::date = $2::date
             GROUP BY i.product_name ORDER BY quantity DESC LIMIT 20`, [tz, reportDate]),
        pool.query(`
            SELECT COUNT(*)::int AS expense_count, COALESCE(SUM(amount),0)::numeric AS total
              FROM expenses WHERE LEFT(COALESCE(date,''),10) = $1 AND COALESCE("adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`, [reportDate]),
        pool.query(`
            SELECT COUNT(*)::int AS attendance_count,
                   COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS checked_in,
                   COUNT(*) FILTER (WHERE "checkOut" IS NOT NULL)::int AS checked_out
              FROM attendance WHERE LEFT(COALESCE(date,''),10) = $1`, [reportDate]),
        pool.query(`
            SELECT id, name, unit, qty, "minQty", "avgCost"
              FROM inventory WHERE COALESCE(qty,0) <= COALESCE("minQty",0)
             ORDER BY name LIMIT 100`),
    ]);
    return {
        reportDate,
        timezone: tz,
        generatedAt: new Date().toISOString(),
        sales: sales.rows[0],
        departments: departments.rows,
        payments: payments.rows,
        topProducts: products.rows,
        expenses: expenses.rows[0],
        attendance: attendance.rows[0],
        lowStock: lowStock.rows,
    };
}

function rowTable(rows, columns, empty = 'لا توجد بيانات') {
    if (!rows.length) {return `<p class="empty">${empty}</p>`;}
    return `<table><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([key]) => `<td>${escapeHtml(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderDailyReportHtml(report) {
    const s = report.sales || {};
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
body{font-family:Arial,Tahoma,sans-serif;background:#f5f7fb;color:#172033;margin:0;padding:24px}main{max-width:1000px;margin:auto;background:#fff;padding:24px;border-radius:14px}h1{color:#8a6b19;margin-top:0}h2{border-bottom:2px solid #e7d59a;padding-bottom:8px;margin-top:28px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{background:#f8f4e8;border:1px solid #eadba7;border-radius:10px;padding:14px}.label{font-size:12px;color:#687083}.value{font-size:22px;font-weight:bold;margin-top:7px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:9px;border-bottom:1px solid #e8ebf0;text-align:right}th{background:#f6f7fa}.empty{color:#6b7280}@media(max-width:650px){.cards{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main><h1>مطاعم الشرفه العالمي — التقرير اليومي</h1><p>التاريخ: <b>${escapeHtml(report.reportDate)}</b> — المنطقة الزمنية: ${escapeHtml(report.timezone)}</p><div class="cards"><div class="card"><div class="label">إجمالي المبيعات</div><div class="value">SAR ${number(s.gross_sales).toFixed(2)}</div></div><div class="card"><div class="label">عدد الفواتير</div><div class="value">${number(s.invoice_count)}</div></div><div class="card"><div class="label">المصروفات</div><div class="value">SAR ${number(report.expenses?.total).toFixed(2)}</div></div><div class="card"><div class="label">أصناف منخفضة</div><div class="value">${report.lowStock.length}</div></div></div><h2>الإيراد حسب القسم</h2>${rowTable(report.departments,[['name_ar','القسم'],['invoice_count','الفواتير'],['revenue','الإيراد']])}<h2>طرق الدفع</h2>${rowTable(report.payments,[['method','الطريقة'],['payment_count','العمليات'],['amount','المبلغ']])}<h2>الأصناف الأكثر مبيعًا</h2>${rowTable(report.topProducts,[['product_name','الصنف'],['quantity','الكمية'],['revenue','الإيراد']])}<h2>الحضور والمصروفات</h2><p>الحضور المسجل: ${number(report.attendance?.attendance_count)}، تسجيل حضور: ${number(report.attendance?.checked_in)}، تسجيل انصراف: ${number(report.attendance?.checked_out)}، عدد المصروفات: ${number(report.expenses?.expense_count)}.</p><h2>الأصناف منخفضة المخزون</h2>${rowTable(report.lowStock,[['name','الصنف'],['qty','الرصيد'],['unit','الوحدة'],['minQty','الحد الأدنى']])}<p style="color:#6b7280;font-size:12px">تم إنشاء التقرير تلقائيًا في ${escapeHtml(report.generatedAt)}.</p></main></body></html>`;
}

function smtpConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.REPORT_EMAIL_TO);
}

function createTransporter() {
    if (!smtpConfigured()) {return null;}
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
}

async function sendDailyReport(pool, reportDate = todayInTimezone()) {
    const report = await collectDailyReport(pool, reportDate);
    const html = renderDailyReportHtml(report);
    const transporter = createTransporter();
    if (!transporter) {throw new Error('REPORT_SMTP_NOT_CONFIGURED');}
    await transporter.sendMail({
        from: process.env.REPORT_EMAIL_FROM || process.env.SMTP_USER,
        to: process.env.REPORT_EMAIL_TO,
        subject: `${process.env.REPORT_EMAIL_SUBJECT || 'تقرير حورس اليومي'} — ${report.reportDate}`,
        html,
    });
    logger.info(`[daily-report] sent for ${report.reportDate}`);
    return report;
}

function startDailyReportScheduler(pool) {
    if (!smtpConfigured()) {
        logger.warn('[daily-report] SMTP غير مضبوط؛ تم تعطيل الإرسال التلقائي حتى إضافة إعدادات SMTP الآمنة.');
        return () => {};
    }
    let lastSentDate = null;
    const timer = setInterval(async () => {
        const now = new Date();
        const localDate = todayInTimezone();
        const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        if (localTime === REPORT_TIME && lastSentDate !== localDate) {
            try { await sendDailyReport(pool, localDate); lastSentDate = localDate; }
            catch (error) { logger.error(`[daily-report] failed: ${error.message}`); }
        }
    }, 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
}

module.exports = { collectDailyReport, renderDailyReportHtml, sendDailyReport, startDailyReportScheduler, smtpConfigured, todayInTimezone };
