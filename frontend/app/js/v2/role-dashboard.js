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
    // بوابة الموظف لكل أدوار الورديات (قرار المالك 2026-11-03): الكاشير/الشيف
    // العامي/السو شيف يفتحون على بطاقتهم وبصمتهم — لا على موجز المدير (403).
    cashier: 'employee',
    kitchen: 'employee',
    sous_chef: 'employee',
    // المالك: موجز المدير التنفيذي — حارس /api/executive/summary فُتح له
    // بموافقة المالك نفسها (لا يبقى بلا لوحة أولى).
    owner: 'executive',
    accountant: 'accountant',
    warehouse: 'warehouse',
    dept_head: 'dept-head',
};

/** @param {string|null|undefined} role @returns {'briefing'|'hr'|'employee'|'accountant'|'warehouse'|'dept-head'|'executive'} */
export function dashboardKind(role) {
    return ROLE_DASHBOARD[String(role || '')] || 'briefing';
}
