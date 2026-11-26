'use strict';
/** حفظ إعدادات ZATCA للمستأجر — منطق قابل للاختبار مباشرة. */
const { validateConfig } = require('../../fiscal/zatca/validate');

async function saveTenantZatcaConfig(pool, tenantId, body = {}) {
    const id = Number(tenantId);
    if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('INVALID_TENANT'), { code: 'INVALID_TENANT' });
    }
    const checked = validateConfig(body);
    if (!checked.ok) {
        throw Object.assign(new Error('INVALID_ZATCA_CONFIG'), { code: 'INVALID_ZATCA_CONFIG', details: checked.errors });
    }
    const v = checked.value;
    await pool.query(
        `INSERT INTO public.tenant_zatca_config (tenant_id,vat_number,cr_number,enabled,sandbox,updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           vat_number=EXCLUDED.vat_number, cr_number=EXCLUDED.cr_number,
           enabled=EXCLUDED.enabled, sandbox=EXCLUDED.sandbox, updated_at=now()`,
        [id, v.vat, v.cr, v.enabled, v.sandbox],
    );
    return { tenantId: id, ...v };
}

module.exports = { saveTenantZatcaConfig };
