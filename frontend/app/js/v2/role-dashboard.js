/**
 * V2 — Which dashboard does this role own? (P2-7)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * features/dashboard.js:127-133 dispatches the same five roles before the
 * admin default. V2 keeps that mapping and lets admin/manager (and any role
 * without a migrated dashboard) read the executive briefing, which is the
 * live form of their legacy dashboard.
 *
 * Pure: no session, no network. The server still decides what each account
 * may read — this only chooses which screen asks.
 */

const ROLE_DASHBOARD = {
    hr: 'hr',
    employee: 'employee',
    accountant: 'accountant',
    warehouse: 'warehouse',
    dept_head: 'dept-head',
};

/** @param {string|null|undefined} role @returns {'briefing'|'hr'|'employee'|'accountant'|'warehouse'|'dept-head'} */
export function dashboardKind(role) {
    return ROLE_DASHBOARD[String(role || '')] || 'briefing';
}
