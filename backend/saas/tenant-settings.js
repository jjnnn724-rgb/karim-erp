'use strict';
/**
 * backend/saas/tenant-settings.js — إعدادات لكل مستأجر (white-label آمن)
 * ─────────────────────────────────────────────────────────────────────────────
 * يقرأ tenant_settings بمفتاح المستأجر، ويمنع تسرّب هوية/ضريبة مستأجر لآخر.
 * عند غياب أي قيمة يعود بالـfallback العام (البيئة + settings القديم) —
 * أي أن إطفاء وضع SaaS يُبقي السلوك القديم حرفياً.
 */

const { getTenantId } = require('../middleware/correlation');

const DEFAULT_TTL_MS = 30_000;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const stores = new WeakMap();

/**
 * مصدر الهوية الموحّد: إعدادات المستأجر إن وُجد سياق، وإلا صف settings العام.
 * يُعيد نفس شكل الصف القديم {name, currency, logoB64} فلا يتغيّر مستهلكوه.
 * @param {any} pool
 */
async function loadBrandSource(pool) {
    const tenantId = getTenantId();
    if (tenantId) {
        let store = stores.get(pool);
        if (!store) { store = createTenantSettings({ pool }); stores.set(pool, store); }
        const values = await store.load(tenantId);
        if (values && values.branding && typeof values.branding === 'object') {
            const b = values.branding;
            return { name: b.name || '', currency: b.currency || '', logoB64: b.logoB64 || '' };
        }
    }
    const r = await pool.query(
        'SELECT name, currency, "logoB64" FROM settings WHERE id = $1 LIMIT 1',
        ['main_settings']
    );
    return r.rows[0] || {};
}

/**
 * @param {{pool:any, ttlMs?:number, env?:NodeJS.ProcessEnv, logger?:any}} opts
 */
function createTenantSettings(opts) {
    const { pool, ttlMs = DEFAULT_TTL_MS } = opts;
    const env = opts.env || process.env;
    const log = opts.logger || null;
    const cache = new Map(); // tenantId -> { values, expiresAt }

    return {
        /** @param {string} tenantId */
        async load(tenantId) {
            if (!tenantId) { return null; }
            const hit = cache.get(tenantId);
            if (hit && hit.expiresAt > Date.now()) { return hit.values; }

            let values;
            try {
                const r = await pool.query('SELECT key, value FROM tenant_settings WHERE tenant_id = $1', [tenantId]);
                values = /** @type {Record<string, any>} */ ({});
                for (const row of r.rows || []) { values[row.key] = row.value; }
            } catch (err) {
                if (log && typeof log.warn === 'function') {
                    log.warn('[tenant-settings] lookup failed, using global fallback:', err instanceof Error ? err.message : String(err));
                }
                values = null;
            }
            if (!values || Object.keys(values).length === 0) { values = null; }
            else { cache.set(tenantId, { values, expiresAt: Date.now() + ttlMs }); }
            return values;
        },

        clearCache() { cache.clear(); },

        /**
         * @param {string|null} tenantId
         * @returns {Promise<{lang:string,currency:string,tax_rate:number,branding:any,timezone:string|null}|null>}
         */
        async localization(tenantId) {
            const values = tenantId ? await this.load(tenantId) : null;
            if (!values) { return null; }

            const branding = values.branding && typeof values.branding === 'object' ? values.branding : null;
            const currencyRaw = String(
                (branding && branding.currency) || values.currency || env.CURRENCY_DEFAULT || 'SAR'
            ).trim().toUpperCase();
            const lang = values.locale === 'en' || values.locale === 'ar'
                ? values.locale
                : ((env.DEFAULT_LANGUAGE === 'en') ? 'en' : 'ar');
            const taxRaw = Number(values.tax_rate);
            const tax_rate = Number.isFinite(taxRaw) && taxRaw >= 0 && taxRaw <= 1
                ? taxRaw
                : parseFloat(env.DEFAULT_TAX_RATE || '0.15');

            return {
                lang,
                currency: CURRENCY_RE.test(currencyRaw) ? currencyRaw : 'SAR',
                tax_rate,
                branding,
                timezone: typeof values.timezone === 'string' ? values.timezone : null,
            };
        },
    };
}

module.exports = { createTenantSettings, loadBrandSource, CURRENCY_RE };
