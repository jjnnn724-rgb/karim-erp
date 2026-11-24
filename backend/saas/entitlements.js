'use strict';
/**
 * backend/saas/entitlements.js — حدود الاشتراك (quota) لكل مستأجر
 * ─────────────────────────────────────────────────────────────────────────────
 * يقرأ الاشتراك وخطة الحدود وعدادات الاستخدام، ويقرر إذا كان الإجراء مسموحاً.
 * لا يفرض أي شيء تلقائياً — يُستدعى صراحةً من نقاط الدخول في وضع SaaS.
 * غياب الاشتراك ⇒ خطة `free` كحد آمن (لا يمرّ بلا حدود).
 */

const { record } = require('./saas-metrics');

const DEFAULT_TTL_MS = 30_000;
const METRICS = new Set(['sales', 'users', 'branches', 'storage_mb']);

/**
 * @param {{pool:any, ttlMs?:number, logger?:any}} opts
 */
function createEntitlements(opts) {
    const { pool, ttlMs = DEFAULT_TTL_MS } = opts;
    const log = opts.logger || null;
    const cache = new Map();

    return {
        /** @param {string} tenantId */
        async snapshot(tenantId) {
            if (!tenantId) { return null; }
            const hit = cache.get(tenantId);
            if (hit && hit.expiresAt > Date.now()) { return hit.value; }

            let value;
            try {
                const sub = await pool.query(
                    `SELECT s.status, s.plan_id, s.current_period_end::text,
                            p.name, p.max_branches, p.max_users, p.max_sales_per_month, p.max_storage_mb
                       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                      WHERE s.tenant_id = $1`,
                    [tenantId]
                );
                const row = sub.rows[0];
                const usage = await pool.query(
                    `SELECT metric, value::bigint::text AS value FROM usage_counters
                      WHERE tenant_id = $1 AND period_start = (now() AT TIME ZONE 'UTC')::date`,
                    [tenantId]
                );
                const used = {};
                for (const r of usage.rows || []) { used[r.metric] = Number(r.value); }
                value = {
                    status: row ? row.status : 'none',
                    plan: row ? row.plan_id : 'free',
                    planName: row ? row.name : 'مجاني',
                    limits: row ? {
                        branches: row.max_branches,
                        users: row.max_users,
                        sales: row.max_sales_per_month,
                        storage_mb: row.max_storage_mb,
                    } : { branches: 1, users: 5, sales: 100, storage_mb: 100 },
                    used,
                    periodEnd: row ? row.current_period_end : null,
                };
            } catch (err) {
                if (log && typeof log.warn === 'function') {
                    log.warn('[entitlements] lookup failed:', err && err.message);
                }
                // فشل مخزن الحدود ⇒ رفض بأمان بدل السماح بلا سقف.
                value = {
                    status: 'unavailable', plan: 'free', planName: 'مجاني',
                    limits: { branches: 1, users: 5, sales: 100, storage_mb: 100 },
                    used: {}, periodEnd: null,
                };
            }
            cache.set(tenantId, { value, expiresAt: Date.now() + ttlMs });
            return value;
        },

        clearCache() { cache.clear(); },

        /**
         * @param {string} tenantId
         * @param {'sales'|'users'|'branches'|'storage_mb'} metric
         * @param {number} [delta]
         */
        async check(tenantId, metric, delta = 1) {
            if (!METRICS.has(metric)) {
                return { allowed: false, reason: 'INVALID_METRIC' };
            }
            const snap = await this.snapshot(tenantId);
            if (!snap) { return { allowed: false, reason: 'TENANT_REQUIRED' }; }
            if (snap.status === 'canceled' || snap.status === 'past_due') {
                return { allowed: false, reason: 'SUBSCRIPTION_INACTIVE', plan: snap.plan };
            }
            const limit = snap.limits[metric];
            if (limit === null || limit === undefined) {
                return { allowed: true, plan: snap.plan, unlimited: true };
            }
            const next = (snap.used[metric] || 0) + Number(delta || 0);
            if (next > limit) {
                record('quota_denied', tenantId);
                return { allowed: false, reason: 'PLAN_LIMIT_REACHED', plan: snap.plan, limit, requested: next };
            }
            record('quota_allowed', tenantId);
            return { allowed: true, plan: snap.plan, limit, remaining: limit - next };
        },
    };
}

module.exports = { createEntitlements, METRICS };
