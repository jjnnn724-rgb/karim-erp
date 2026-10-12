/**
 * i18n-routes.js — إعداد اللغة/العملة العام للواجهات (بلا JWT).
 * GET /api/i18n/config → { lang, currency, branches[] }
 * fail-open بالكامل: لا جدول branches؟ لا إعدادات؟ راجع الافتراضيات آمنة.
 */
const { pool } = require('./shared-pool');

const CURRENCY_RE = /^[A-Za-z]{3}$/;

function register(app) {

    app.get('/api/i18n/config', asyncHandler(async (req, res) => {
        const cfg = {
            lang: process.env.DEFAULT_LANGUAGE === 'en' ? 'en' : 'ar',
            currency: String(process.env.CURRENCY_DEFAULT || 'SAR').toUpperCase(),
            tax_rate: parseFloat(process.env.DEFAULT_TAX_RATE || '0.15'),
            branches: [],
        };
        if (!CURRENCY_RE.test(cfg.currency)) {cfg.currency = 'SAR';}

        // عملة المنشأة من جدول settings (001_schema: عمود currency) — ISO فقط
        try {
            const s = await pool.query('SELECT currency FROM settings WHERE currency IS NOT NULL ORDER BY id LIMIT 1');
            const c = String(s.rows[0]?.currency || '').trim().toUpperCase();
            if (CURRENCY_RE.test(c)) {cfg.currency = c;}
        } catch (_) { /* جدول/عمود غائب — افتراض البيئة يكفي */ }

        // لغة الواجهة المحفوظة في app_state (التفضيلات الحالية للـERP)
        try {
            const st = await pool.query('SELECT state_data FROM app_state WHERE id = 1');
            const savedLang = st.rows[0]?.state_data?.lang;
            if (savedLang === 'en' || savedLang === 'ar') {cfg.lang = savedLang;}
        } catch (_) { /* لا تفضيلات بعد */ }

        // عملات الفروع (102_branches) — اختيارية تمامًا
        try {
            cfg.branches = (await pool.query(
                'SELECT code, currency, timezone FROM branches WHERE is_active = TRUE ORDER BY id'
            )).rows;
        } catch (_) { /* قبل الـmigration: قائمة فارغة */ }

        res.json({ ok: true, ...cfg });
    }));
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { register };
