'use strict';
/**
 * backend/saas/tenant-resolver.js — حل المستأجر من قاعدة البيانات
 * ─────────────────────────────────────────────────────────────────────────────
 * يحل الـslug إلى معرّف مستأجر من tenants / tenant_domains، مع كاش قصير
 * في الذاكرة. خريطة البيئة (SAAS_TENANT_MAP) تعمل كـfallback للتطوير
 * وحين تكون القاعدة غير متاحة — لا كبديل دائم في الإنتاج.
 */

const DEFAULT_TTL_MS = 30_000;

/**
 * @param {{pool:any, envMap?:Map<string,string>, ttlMs?:number, logger?:any}} opts
 */
function createTenantResolver(opts) {
    const { pool, envMap = new Map(), ttlMs = DEFAULT_TTL_MS } = opts;
    const log = opts.logger || null;
    const cache = new Map(); // slug -> { tenant, expiresAt }

    function fromEnv(/** @type {any} */ slug) {
        const id = envMap.get(slug);
        return id ? { id, slug, source: 'env' } : null;
    }

    return {
        /**
         * @param {string} slug
         * @returns {Promise<{id:string,slug:string,source:string}|null>}
         */
        async resolve(slug) {
            const key = String(slug || '').toLowerCase();
            if (!key) { return null; }

            const hit = cache.get(key);
            if (hit && hit.expiresAt > Date.now()) { return hit.tenant; }

            let tenant = null;
            try {
                const result = await pool.query(
                    `SELECT t.id::text AS id, t.slug
                       FROM tenants t
                       LEFT JOIN tenant_domains d ON d.tenant_id = t.id
                      WHERE (t.slug = $1 OR (d.hostname = $1 AND d.verified_at IS NOT NULL))
                        AND t.status = 'active'
                      ORDER BY CASE WHEN t.slug = $1 THEN 0 ELSE 1 END
                      LIMIT 1`,
                    [key]
                );
                if (result.rows && result.rows[0]) {
                    tenant = { id: result.rows[0].id, slug: result.rows[0].slug, source: 'db' };
                }
            } catch (err) {
                if (log && typeof log.warn === 'function') {
                    log.warn('[tenant-resolver] DB lookup failed, falling back to env map:', err && err.message);
                }
            }

            if (!tenant) { tenant = fromEnv(key); }
            if (tenant) {
                cache.set(key, { tenant, expiresAt: Date.now() + ttlMs });
            } else {
                // لا نخزّن النفي طويلاً: مستأجر جديد قد يُسجَّل في أي لحظة.
                cache.delete(key);
            }
            return tenant;
        },

        clearCache() { cache.clear(); },
    };
}

module.exports = { createTenantResolver, DEFAULT_TTL_MS };
