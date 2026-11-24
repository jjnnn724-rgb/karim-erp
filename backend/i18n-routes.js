/**
 * i18n-routes.js — إعداد اللغة/العملة العام للواجهات (بلا JWT).
 * GET /api/i18n/config → { lang, currency, branches[] }
 * fail-open بالكامل: لا جدول branches؟ لا إعدادات؟ راجع الافتراضيات آمنة.
 */
const { pool } = require('./shared-pool');
const { createTenantSettings } = require('./saas/tenant-settings');

const CURRENCY_RE = /^[A-Za-z]{3}$/;
let tenantSettingsStore = null;
function getTenantSettingsStore() {
    if (!tenantSettingsStore) {
        tenantSettingsStore = createTenantSettings({ pool, env: process.env, logger: require('./logger').logger });
    }
    return tenantSettingsStore;
}

function register(/** @type {any} */ app) {

    app.get('/api/i18n/config', asyncHandler(async (/** @type {any} */ req, /** @type {any} */ res) => {
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

        // SaaS: إعدادات المستأجر تتحكّم أخيراً — لا يبقى عميلان بنفس الضريبة/الهوية.
        // بلا سياق (الوضع الحالي) لا يتغيّر شيء عن المسار القديم.
        if (req.tenant && req.tenant.id) {
            const local = await getTenantSettingsStore().localization(req.tenant.id);
            if (local) {
                cfg.lang = local.lang;
                cfg.currency = local.currency;
                cfg.tax_rate = local.tax_rate;
                if (local.branding) {cfg.branding = local.branding;}
                if (local.timezone) {cfg.timezone = local.timezone;}
            }
        }

        res.json({ ok: true, ...cfg });
    }));
}

function asyncHandler(/** @type {any} */ fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { register };
