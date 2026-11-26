'use strict';
/**
 * tenant/resolution — المنطق الفعلي لحلّ هوية المستأجر (A3.2).
 * نُقل من tenant-context.js بنفس السلوك: الخادم فقط، عضويتين = فشل مغلق،
 * الافتراضي في وضع الانتقال فقط، SET LOCAL داخل transaction.
 */
const { pool } = require('../../shared-pool');
const { logger } = require('../../logger');

const ENFORCE = String(process.env.TENANT_ENFORCEMENT || '').trim().toLowerCase() === 'true';

async function resolveTenantForUser(user, options = {}) {
    const enforce = options.enforce === undefined ? ENFORCE : Boolean(options.enforce);
    if (!user || user.id === undefined || user.id === null) {return null;}
    try {
        const memberships = await pool.query(
            `SELECT tm.tenant_id
               FROM public.tenant_memberships tm
               JOIN public.tenants t ON t.id = tm.tenant_id
              WHERE tm.user_id = $1 AND tm.status = 'active' AND t.status = 'active'
              ORDER BY tm.id`,
            [user.id],
        );
        if (memberships.rows.length > 1) {
            logger.warn('[tenant] ambiguous active memberships — failing closed', { userId: user.id });
            return null;
        }
        if (memberships.rows.length === 1) {
            return Number(memberships.rows[0].tenant_id);
        }
        if (!enforce) {
            const fallback = await pool.query(
                "SELECT id FROM public.tenants WHERE code = 'default' AND status = 'active' LIMIT 1",
            );
            if (fallback.rows.length) {
                logger.warn('[tenant] legacy account without membership — default tenant (transition only)', { userId: user.id });
                return Number(fallback.rows[0].id);
            }
        }
        return null;
    } catch (error) {
        logger.warn({ err: { message: String(error.message) } }, '[tenant] resolution failed (fail-closed)');
        return null;
    }
}

async function setTenantLocal(client, tenantId) {
    if (!tenantId || !Number.isFinite(Number(tenantId))) {
        throw new Error('TENANT_CONTEXT_REQUIRED');
    }
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
}

module.exports = { ENFORCE, resolveTenantForUser, setTenantLocal };
