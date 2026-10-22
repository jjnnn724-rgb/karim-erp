'use strict';

/**
 * permissions.js — Individual user permission grants (additive over roles).
 * ────────────────────────────────────────────────────────────────────────────
 * Design: role stays the base. An explicit grant can only ADD access, never
 * remove role access. Admin role implies every permission (no rows needed).
 * Grant changes are audit-logged (permission_audit) with actor + reason.
 *
 * Enforcement points (v1): frontend menus + page access + generic CRUD
 * entities below. Dedicated transactional routes (dispatch approve, payments,
 * journal...) stay role-based in v1 — documented, not silent.
 */

const { pool } = require('./shared-pool');

// ─── Catalog: key → Arabic label, group, menus, generic-CRUD entities ───────
const PERMISSIONS = [
    // الموارد البشرية
    { key: 'hr.view', ar: 'عرض الموارد البشرية', group: 'الموارد البشرية',
      menus: ['hr-dashboard', 'employees', 'leaves', 'attendance', 'employee-portal'],
      entitiesRead: ['employees', 'attendance', 'leaveRequests', 'leaveTypes', 'hrDepartments'], entitiesWrite: [] },
    { key: 'hr.edit', ar: 'إدارة الموارد البشرية', group: 'الموارد البشرية',
      menus: ['hr-dashboard', 'employees', 'leaves', 'attendance', 'employee-portal'],
      entitiesRead: ['employees', 'attendance', 'leaveRequests', 'leaveTypes', 'hrDepartments'],
      entitiesWrite: ['employees', 'attendance', 'leaveRequests', 'leaveTypes', 'hrDepartments'] },
    { key: 'payroll.view', ar: 'عرض الرواتب', group: 'الموارد البشرية',
      menus: ['payroll'], entitiesRead: ['payroll', 'salary_advances', 'payroll_adjustments', 'payroll_runs', 'employee_contracts', 'employee_evaluations'], entitiesWrite: [] },
    { key: 'payroll.edit', ar: 'إدارة الرواتب', group: 'الموارد البشرية',
      menus: ['payroll'], entitiesRead: ['payroll', 'salary_advances', 'payroll_adjustments', 'payroll_runs', 'employee_contracts', 'employee_evaluations'],
      entitiesWrite: ['payroll', 'salary_advances', 'payroll_adjustments', 'payroll_runs', 'employee_contracts', 'employee_evaluations'] },
    // المخزون
    { key: 'inventory.view', ar: 'عرض المخزون', group: 'المخزون',
      menus: ['warehouse', 'shelves'], entitiesRead: ['inventory', 'inventoryTx', 'shelves', 'weightReadings'], entitiesWrite: [] },
    { key: 'inventory.edit', ar: 'إدارة المخزون', group: 'المخزون',
      menus: ['warehouse', 'shelves'], entitiesRead: ['inventory', 'inventoryTx', 'shelves', 'weightReadings'],
      entitiesWrite: ['inventory', 'shelves', 'weightReadings'] },
    // استعلامات المخزون (قراءة فقط — محرك الاستعلامات وبطاقة الصنف)
    { key: 'inventory-inquiry.view', ar: 'استعلامات المخزون', group: 'المخزون',
      menus: ['query', 'professional'], entitiesRead: [], entitiesWrite: [] },
    // المشتريات
    { key: 'purchasing.view', ar: 'عرض المشتريات والموردين', group: 'المشتريات',
      menus: ['procurement'], entitiesRead: ['purchaseInvoices'], entitiesWrite: [] },
    { key: 'purchasing.edit', ar: 'إدارة المشتريات والموردين', group: 'المشتريات',
      menus: ['procurement'], entitiesRead: ['purchaseInvoices'], entitiesWrite: ['purchaseInvoices'] },
    // الصرف
    { key: 'dispatch.view', ar: 'عرض الصرف', group: 'التشغيل',
      menus: ['dispatch'], entitiesRead: ['dispatches', 'kitchenReturns'], entitiesWrite: [] },
    { key: 'dispatch.edit', ar: 'إدارة الصرف', group: 'التشغيل',
      menus: ['dispatch'], entitiesRead: ['dispatches', 'kitchenReturns'], entitiesWrite: ['dispatches', 'kitchenReturns'] },
    // المطبخ
    { key: 'kitchen.view', ar: 'عرض المطبخ والوصفات', group: 'التشغيل',
      menus: ['kitchen', 'recipes'], entitiesRead: ['recipes'], entitiesWrite: [] },
    { key: 'kitchen.edit', ar: 'إدارة المطبخ والوصفات', group: 'التشغيل',
      menus: ['kitchen', 'recipes'], entitiesRead: ['recipes'], entitiesWrite: ['recipes'] },
    // المالية
    { key: 'finance.view', ar: 'عرض الإيرادات والمصاريف', group: 'المالية',
      menus: ['revenues', 'expenses', 'cash-register', 'cashier-sales'], entitiesRead: ['revenues', 'expenses'], entitiesWrite: [] },
    { key: 'finance.edit', ar: 'إدارة الإيرادات والمصاريف', group: 'المالية',
      menus: ['revenues', 'expenses', 'cash-register', 'cashier-sales'], entitiesRead: ['revenues', 'expenses'], entitiesWrite: ['revenues', 'expenses'] },
    { key: 'reports.view', ar: 'عرض التقارير', group: 'المالية',
      menus: ['reports', 'cfo', 'cost-analysis', 'pnl'], entitiesRead: [], entitiesWrite: [] },
    { key: 'accounting.view', ar: 'عرض الحسابات', group: 'المالية',
      menus: ['cfo'], entitiesRead: [], entitiesWrite: [] },
    // التكامل
    { key: 'yarasoft.view', ar: 'عرض استيراد فواتير الكاشير', group: 'التكامل',
      menus: ['yarasoft', 'oracle-data'], entitiesRead: [], entitiesWrite: [] },
    { key: 'zk.view', ar: 'عرض البصمة', group: 'التكامل',
      menus: ['zkteco'], entitiesRead: [], entitiesWrite: [] },
    // متابعة الكاشير (مرآة يارا سوفت — الكاشير 1/4/5/6/9) — قراءة فقط، للأونر
    { key: 'cashier-monitor.view', ar: 'متابعة الكاشير', group: 'التشغيل',
      menus: ['cashier-monitor'], entitiesRead: [], entitiesWrite: [] },
    { key: 'whatsapp.use', ar: 'استخدام واتساب', group: 'التكامل',
      menus: ['whatsapp'], entitiesRead: [], entitiesWrite: [] },
    // النظام (عرض فقط — الكتابة الحساسة تبقى للأدوار)
    { key: 'users.view', ar: 'عرض المستخدمين', group: 'النظام',
      menus: ['users', 'settings'], entitiesRead: [], entitiesWrite: [] },
];

const PERM_MAP = new Map(PERMISSIONS.map((p) => [p.key, p]));

// entity → { read: key, write: key } derived from catalog (first match wins)
const ENTITY_PERMS = {};
for (const p of PERMISSIONS) {
    for (const e of p.entitiesRead || []) {ENTITY_PERMS[e] = ENTITY_PERMS[e] || {}; ENTITY_PERMS[e].read = ENTITY_PERMS[e].read || p.key;}
    for (const e of p.entitiesWrite || []) {ENTITY_PERMS[e] = ENTITY_PERMS[e] || {}; ENTITY_PERMS[e].write = ENTITY_PERMS[e].write || p.key;}
}

function permForEntity(entity, mode) {
    const m = ENTITY_PERMS[entity];
    return (m && m[mode]) || null;
}

function menusForGrants(grants) {
    const out = new Set();
    for (const g of grants || []) {
        const p = PERM_MAP.get(g);
        if (p) {for (const m of p.menus || []) {out.add(m);}}
    }
    return [...out];
}

/** Menus covered by deny keys (for hiding grant/role menus they map to). */
function menusForDenies(denies) {
    return menusForGrants(denies);
}

// ─── Grant/deny storage (30s per-process cache, invalidated on change) ─────
const _cache = new Map(); // userId -> { at, grants:Set, denies:Set }
const CACHE_MS = 30000;

async function getUserPerms(userId, db) {
    const id = Number(userId);
    const empty = { grants: new Set(), denies: new Set() };
    if (!Number.isInteger(id) || id <= 0) {return empty;}
    const hit = _cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) {return { grants: hit.grants, denies: hit.denies };}
    const conn = db || pool;
    const rows = (await conn.query(`SELECT perm_key, effect FROM user_permissions WHERE user_id = $1`, [id])).rows;
    const grants = new Set();
    const denies = new Set();
    for (const r of rows) {
        if (!PERM_MAP.has(r.perm_key)) {continue;}
        if (r.effect === 'deny') {denies.add(r.perm_key);}
        else {grants.add(r.perm_key);}
    }
    _cache.set(id, { at: Date.now(), grants, denies });
    return { grants, denies };
}

/** Backward-compatible: grants only. */
async function getUserGrants(userId, db) {
    return (await getUserPerms(userId, db)).grants;
}

function invalidateUser(userId) {
    _cache.delete(Number(userId));
}

/** Effective check: admin → everything; DENY beats role AND grant; else role/grant. */
async function userHasPerm(user, permKey, roles = [], db) {
    if (!user) {return false;}
    if (user.role === 'admin') {return true;}
    if (permKey && PERM_MAP.has(permKey)) {
        const { denies } = await getUserPerms(user.id, db);
        if (denies.has(permKey)) {return false;}
    }
    if (Array.isArray(roles) && roles.includes(user.role)) {return true;}
    if (!permKey || !PERM_MAP.has(permKey)) {return false;}
    const { grants } = await getUserPerms(user.id, db);
    return grants.has(permKey);
}

/** Express guard: deny-first, then role, then grant. */
function requireRoleOrPerm(roles, permKey) {
    const list = Array.isArray(roles) ? roles : [roles];
    return async (req, res, next) => {
        try {
            if (req.user?.role === 'admin') {return next();}
            if (permKey && PERM_MAP.has(permKey)) {
                const { denies } = await getUserPerms(req.user?.id, null);
                if (denies.has(permKey)) {
                    return res.status(403).json({ error: 'FORBIDDEN', message: 'هذه الصلاحية مسحوبة منك — راجع المدير' });
                }
            }
            if (list.includes(req.user?.role)) {return next();}
            if (await userHasPerm(req.user, permKey, [], null)) {return next();}
            return res.status(403).json({ error: 'FORBIDDEN', message: 'لا تملك صلاحية هذه العملية' });
        } catch (_) {
            return res.status(500).json({ error: 'PERM_CHECK_FAILED', message: 'تعذر التحقق من الصلاحية' });
        }
    };
}

module.exports = {
    PERMISSIONS, PERM_MAP, ENTITY_PERMS, permForEntity, menusForGrants, menusForDenies,
    getUserPerms, getUserGrants, invalidateUser, userHasPerm, requireRoleOrPerm,
};
