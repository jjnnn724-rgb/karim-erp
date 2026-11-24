'use strict';
/**
 * backend/saas/onboarding.js — إنشاء مستأجر جديد (self-service)
 * ─────────────────────────────────────────────────────────────────────────────
 * معاملة واحدة ذرية: tenants + users + tenant_users + tenant_settings +
 * subscriptions. أي فشل ⇒ ROLLBACK كامل، ولا يبقى مستأجر ناقص.
 * كل القيم معاملات SQL؛ كلمة المرور تُ hash بـbcrypt cost 12 ولا تُعاد في الرد.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { pool } = require('../shared-pool');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code, status = 422) {
    return Object.assign(new Error(code), { code, status });
}

function validate(input) {
    const slug = String(input.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) { throw fail('INVALID_SLUG'); }
    const name = String(input.name || '').trim();
    if (!name || name.length > 200) { throw fail('INVALID_NAME'); }
    const admin = input.admin || {};
    const username = String(admin.username || '').trim();
    if (username.length < 3 || username.length > 255) { throw fail('INVALID_USERNAME'); }
    const password = String(admin.password || '');
    if (password.length < 12) { throw fail('WEAK_PASSWORD'); }
    if (admin.email && !EMAIL_RE.test(String(admin.email))) { throw fail('INVALID_EMAIL'); }
    return {
        slug,
        name,
        admin: {
            username,
            password,
            name: String(admin.name || 'مدير المستأجر').slice(0, 200),
            email: admin.email || null,
        },
        planId: String(input.planId || 'free'),
        locale: input.locale === 'en' ? 'en' : 'ar',
        currency: /^[A-Za-z]{3}$/.test(String(input.currency || '')) ? String(input.currency).toUpperCase() : 'SAR',
        timezone: String(input.timezone || 'Asia/Riyadh').slice(0, 64),
    };
}

/**
 * @param {{pool?:any, input:any, bcryptRounds?:number, now?:()=>number}} args
 */
async function provisionTenant(args) {
    const v = validate(args.input || {});
    const pgPool = args.pool || pool;
    const hash = await bcrypt.hash(v.admin.password, args.bcryptRounds || 12);
    const tenantId = crypto.randomUUID();
    const now = typeof args.now === 'function' ? args.now() : Date.now();
    const userId = now * 1000 + crypto.randomInt(1, 1000);

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');

        const taken = await client.query('SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1', [v.slug]);
        if (taken.rowCount > 0) { throw fail('SLUG_TAKEN', 409); }

        await client.query(
            `INSERT INTO tenants (id, slug, name, status, locale, currency, timezone)
             VALUES ($1,$2,$3,'trial',$4,$5,$6)`,
            [tenantId, v.slug, v.name, v.locale, v.currency, v.timezone]
        );

        await client.query(
            `INSERT INTO users (id, username, password, role, name, active, tenant_id)
             VALUES ($1,$2,$3,'admin',$4,true,$5)`,
            [userId, v.admin.username, hash, v.admin.name, tenantId]
        );

        await client.query(
            `INSERT INTO tenant_users (tenant_id, user_id, role_in_tenant) VALUES ($1,$2,'owner')`,
            [tenantId, userId]
        );

        await client.query(
            `INSERT INTO tenant_settings (tenant_id, key, value) VALUES
                ($1,'branding', jsonb_build_object('name',$2::text,'currency',$3::text)),
                ($1,'locale', to_jsonb($4::text)),
                ($1,'timezone', to_jsonb($5::text)),
                ($1,'tax_rate', '0.15'::jsonb)`,
            [tenantId, v.name, v.currency, v.locale, v.timezone]
        );

        await client.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
             VALUES ($1,$2,'trial', now(), now() + interval '14 days')`,
            [tenantId, v.planId]
        );

        await client.query('COMMIT');
        // لا تُعاد كلمة المرور ولا الـhash في أي شكل.
        return { ok: true, tenantId, userId, slug: v.slug, plan: v.planId };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* الأصل هو الخطأ الأول */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { provisionTenant, validate, SLUG_RE };
