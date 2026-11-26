'use strict';
/**
 * saas/onboarding — تدفق_register → verify → tenant → branch → admin → subscription.
 * كل الخطوات داخل transaction؛ فشل أي خطوة يتراجع الكل (لا tenant ناقص).
 */
const crypto = require('crypto');
const { hashSync } = require('../../pw-crypto');
const { createVerification, verifyCode } = require('./email');
const billing = require('./billing');

async function startVerification(pool, email) {
    const v = createVerification(email);
    await pool.query(
        `INSERT INTO public.app_state (id,state_data) VALUES (99001,$1::jsonb)
         ON CONFLICT (id) DO UPDATE SET state_data=EXCLUDED.state_data`,
        [JSON.stringify({ purpose: 'saas_verify', email, codeHash: crypto.createHash('sha256').update(v.code).digest('hex') })],
    );
    return { ok: true, provider: v.provider };
}

async function completeOnboarding(pool, { code, name, email, verificationCode, plan = 'basic', adminPassword }) {
    if (!code || !name || !email || !verificationCode) {
        throw Object.assign(new Error('INVALID_ONBOARDING'), { code: 'INVALID_ONBOARDING' });
    }
    if (!verifyCode(email, verificationCode)) {
        throw Object.assign(new Error('VERIFICATION_FAILED'), { code: 'VERIFICATION_FAILED' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const t = await client.query(
            'INSERT INTO public.tenants (code,name) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id,code',
            [String(code).toLowerCase(), name],
        );
        const tenantId = Number(t.rows[0].id);
        // RLS مُفعّل على branches ⇒ السياق يجب أن يكون المستأجر الجديد داخل الـtransaction.
        await client.query('SELECT set_config($1,$2,true)', ['app.tenant_id', String(tenantId)]);
        const b = await client.query(
            'INSERT INTO public.branches (code,name_ar,tenant_id) VALUES ($1,$2,$3) RETURNING id',
            [`${code}-main`, name, tenantId],
        );
        const trial = billing.newTrial();
        const s = await client.query(
            `INSERT INTO public.tenant_subscriptions (tenant_id,plan_code,status,trial_ends_at)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [tenantId, plan, trial.status, trial.trialEndsAt],
        );
        // أدمن المستأجر: كلمة مرور مؤقتة تُجبر على تغييرها عند أول دخول.
        const username = `${code}-admin`;
        const userId = Date.now() * 1000 + crypto.randomInt(0, 1000);
        const pw = String(adminPassword || crypto.randomBytes(12).toString('hex'));
        await client.query(
            `INSERT INTO public.users (id,username,password,role,name,email,branch_id,must_change_password)
             VALUES ($1,$2,$3,'admin',$4,$5,$6,TRUE)`,
            [userId, username, hashSync(pw), name, email, Number(b.rows[0].id)],
        );
        await client.query(
            'INSERT INTO public.tenant_memberships (tenant_id,user_id,role,branch_id) VALUES ($1,$2,$3,$4)',
            [tenantId, userId, 'admin', Number(b.rows[0].id)],
        );
        await client.query('COMMIT');
        return {
            tenantId, branchId: Number(b.rows[0].id), subscriptionId: Number(s.rows[0].id), trial,
            admin: { username, mustChangePassword: true, temporaryPassword: adminPassword ? undefined : pw },
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { startVerification, completeOnboarding };
