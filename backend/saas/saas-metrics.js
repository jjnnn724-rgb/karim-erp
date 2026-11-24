'use strict';
/**
 * backend/saas/saas-metrics.js — عدّادات SaaS خفيفة (بلا تبعيات)
 * ─────────────────────────────────────────────────────────────────────────────
 * منفصلة عن metrics.js القديمة حتى لا نلمس المسار الحار ولا نرفع cardinality.
 * حد أقصى 200 مستأجر في الذاكرة — بعدها يُحصى في `other` بدل إنشاء مفاتيح لا نهائية.
 */

const MAX_TENANTS = 200;
const EVENTS = Object.freeze([
    'tenant_required', 'tenant_mismatch', 'resolver_unavailable',
    'signup_attempt', 'signup_ok', 'signup_rate_limited',
    'quota_denied', 'quota_allowed',
]);

const totals = Object.create(null);
for (const e of EVENTS) { totals[e] = 0; }
const perTenant = new Map();
let otherCount = 0;

/** @param {string} event @param {string|null} tenantId */
function record(event, tenantId = null) {
    if (!EVENTS.includes(event)) { return; }
    totals[event]++;
    if (!tenantId) { return; }
    if (perTenant.has(tenantId)) { perTenant.get(tenantId)[event] = (perTenant.get(tenantId)[event] || 0) + 1; return; }
    if (perTenant.size >= MAX_TENANTS) { otherCount++; return; }
    perTenant.set(tenantId, { [event]: 1 });
}

function snapshot() {
    const top = [];
    for (const [id, counts] of perTenant) { top.push({ tenantId: id, ...counts }); }
    return {
        totals: { ...totals },
        trackedTenants: perTenant.size,
        otherTenants: otherCount,
        top,
        at: new Date().toISOString(),
    };
}

/** صيغة Prometheus text 0.0.4 — للـscrape خلف مصادقة.admin */
function prometheusFormat() {
    let out = '# HELP karim_saas_events_total SaaS platform events\n';
    out += '# TYPE karim_saas_events_total counter\n';
    for (const e of EVENTS) {
        out += `karim_saas_events_total{event="${e}"} ${totals[e]}\n`;
    }
    out += '\n# HELP karim_saas_tracked_tenants Tenants held in the bounded in-memory store\n';
    out += '# TYPE karim_saas_tracked_tenants gauge\n';
    out += `karim_saas_tracked_tenants ${perTenant.size}\n`;
    out += '# HELP karim_saas_other_tenants Tenants folded into the overflow bucket\n';
    out += '# TYPE karim_saas_other_tenants gauge\n';
    out += `karim_saas_other_tenants ${otherCount}\n`;
    out += '\n# HELP karim_saas_tenant_events_total Per-tenant SaaS events (bounded cardinality)\n';
    out += '# TYPE karim_saas_tenant_events_total counter\n';
    for (const [id, counts] of perTenant) {
        for (const [event, n] of Object.entries(counts)) {
            out += `karim_saas_tenant_events_total{tenant="${id}",event="${event}"} ${n}\n`;
        }
    }
    return out;
}

function reset() {
    for (const e of EVENTS) { totals[e] = 0; }
    perTenant.clear();
    otherCount = 0;
}

module.exports = { record, snapshot, prometheusFormat, reset, EVENTS, MAX_TENANTS };
