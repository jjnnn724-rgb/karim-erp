/**
 * core/state.js — central STATE singleton + entity registry (extracted verbatim — EXTRACTION-005)
 * Bridge policy: window.STATE is the frozen realtime.js contract; PERSISTED_ENTITIES drives the
 * boot fan-out. All three are mounted on window by js/main.js (BRIDGE-005).
 * Module evaluation is side-effect-free (pure data).
 */
// ============================================
// DATABASE-BACKED ENTITY API
// ────────────────────────────────────────────
// Every one of these already has a real PostgreSQL table + a whitelisted,
// authenticated REST endpoint on the server (backend/schema-registry.js +
// backend/server.js generic CRUD routes). This is the single source of
// truth from now on — the old approach of dumping the whole STATE object
// into one JSON blob (`app_state`) is kept ONLY for `settings`/UI prefs.
// ============================================
const PERSISTED_ENTITIES = [
    'users', 'departments', 'revenues', 'expenses', 'inventory', 'inventoryTx',
    'dispatches', 'recipes', 'purchaseInvoices', 'kitchenReturns',
    'employees', 'attendance', 'leaveRequests', 'hrDepartments',
    'leaveTypes', 'payroll', 'shelves', 'weightReadings', 'notifications',
    'salary_advances', 'payroll_adjustments', 'employee_contracts', 'employee_evaluations', 'payroll_runs',
];

// بعض الأدوار لا تملك قراءة كل الكيانات — الاستبعاد هنا يمنع ضجيج 403 في الكونسول عند الإقلاع
// (لوحة رئيس القسم لا تحتاج المستخدمين ولا مسيرات الرواتب — لصفحات الإدارة حصرًا)
const ROLE_ENTITY_EXCLUSIONS = {
    dept_head: ['users', 'payroll'],
    // المالك: شاشته متابعة الكاشير فقط — لا كيانات أعمال عند الإقلاع (منع ضجيج 403)
    owner: ['users', 'departments', 'revenues', 'expenses', 'inventory', 'inventoryTx', 'dispatches', 'recipes',
            'purchaseInvoices', 'kitchenReturns', 'employees', 'attendance', 'leaveRequests', 'hrDepartments',
            'leaveTypes', 'payroll', 'shelves', 'weightReadings', 'salary_advances', 'payroll_adjustments',
            'employee_contracts', 'employee_evaluations', 'payroll_runs'],
};

const STATE = {
// <i class=ji data-i=alert-triangle></i> SECURITY: users[] is intentionally empty. Authentication is handled
// server-side via POST /api/auth/login (JWT). Client-side credential
// storage is forbidden — see doLogin() below.
users: [],
currentUser: null,
departments: [], revenues: [], expenses: [], inventory: [], inventoryTx: [], dispatches: [], recipes: [], purchaseInvoices: [], kitchenReturns: [], suppliers: [], supplierPayments: [],
purchaseRequests: [], // طلبات شراء النواقص (مخزن → شيف → مدير عام) — من GET /api/warehouse/purchase-requests
employees: [], attendance: [], leaveRequests: [], hrDepartments: [], leaveTypes: [], payroll: [],
deptEmployees: [],   // موظفو قسم رئيس القسم — من GET /hr/dept-employees (جدول الحضور المقيد)
salary_advances: [], payroll_adjustments: [], employee_contracts: [], employee_evaluations: [], payroll_runs: [],
shelves: [], weightReadings: [],
settings: { name:'مطاعم الشرفه العالمي', logo:'<i class=ji data-i=utensils></i>', logoB64:null, currency:'SAR', lowStockAlert:true, workStartHour:9 },
recipeCatalog: {},
page: 'dashboard', dept: null, charts: {}, lang: 'ar', theme: 'light',
notifications: [],
deptPanel: null   // Task 28: لوحة رئيس القسم — من GET /api/warehouse/dept-panel
};

export { STATE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS };
