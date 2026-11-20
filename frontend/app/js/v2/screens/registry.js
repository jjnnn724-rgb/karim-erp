/* registry.js — البوابةُ الوحيدةُ لشاشات V2: تحميلٌ عند الطلب بدل استيرادٍ ساكن
   ═══════════════════════════════════════════════════════════════════════════
   الدافع (2026-10-27): preview.js كان يستورد ٥٧ وحدةَ شاشةٍ استيرادًا ساكنًا،
   فيدفع كلُّ داخلٍ — حتى لو فتح «اللوحة» وحدها — ١٦١ طلبًا و٣٫٧٧ ميجابايت من
   JS قبل أن يرى أوّلَ بطاقة. هنا تُطلَب وحدةُ الشاشة عند فتحها فقط، وتُحفَظ
   في الذاكرة بعد أوّل طلبٍ ناجح؛ والاستيرادُ الديناميكيُّ يبقي كلَّ وحدةٍ
   معزولةً كما هي، فلا تتغيّر عقودُ الشاشات ولا بياناتها.

   العقد:
   • كل راويةٍ `() => import('./x.js?v=…')` — نصٌّ حرفيٌّ بلا وسيطات، كي
     يوائم v2-revision.js رقمَها مع رقم الصفحة، وتلتقطها خريطةُ الـSW (الطبقة
     الثالثة) فيبقى التثبيتُ يخزّن كلَّ الشاشات للعمل دون اتصال.
   • MOUNTS يحمل اسمَ الدالة المصدَّرة لكل وحدة؛ فشلُ التصدير يُرفَض صراحةً
     بدلَ تركيب `undefined` في منتصف الرسم.
   • الفشل لا يُحفَظ: يُسقَط الوعدُ من الكاش لتنجح المحاولةُ التالية (حلقة
     إعادة المحاولة في preview.js تعتمد على ذلك).
   • NAV_ALIAS: مفتاحُ المسار في القائمة ليس اسمَ ملف الوحدة لأربع شاشات؛
     الترجمة هنا مرةً واحدة بدل تكرارها في كل موقع نداء.
   • هذه الوحدة لا تلمس DOM ولا تقرأ جلسة — تركيبُ الشاشة يبقى في preview.js.
   الحراسة: tests/v2-lazy-screens.test.js
   ═══════════════════════════════════════════════════════════════════════════ */

const MOUNTS = {
    'branches': 'mountBranchesScreen',
    'attendance': 'mountAttendanceScreen',
    'employees': 'mountEmployeesScreen',
    'sessions': 'mountSessionsScreen',
    'briefing': 'mountBriefingScreen',
    'executive': 'mountExecutiveScreen',
    'cfo': 'mountCfoScreen',
    'warehouse': 'mountWarehouseScreen',
    'warehouse-gov': 'mountWarehouseGovScreen',
    'reports': 'mountReportsScreen',
    'procurement': 'mountProcurementScreen',
    'invoices': 'mountInvoicesScreen',
    'payments': 'mountPaymentsScreen',
    'wh-invoices': 'mountWhInvoicesScreen',
    'kitchen': 'mountKitchenScreen',
    'leaves': 'mountLeavesScreen',
    'dispatch': 'mountDispatchScreen',
    'veg-requests': 'mountVegScreen',
    'roster': 'mountRosterScreen',
    'employee-portal': 'mountEmployeePortalScreen',
    'settings': 'mountSettingsScreen',
    'users': 'mountUsersScreen',
    'yarasoft': 'mountYarasoftScreen',
    'whatsapp': 'mountWhatsappScreen',
    'permissions': 'mountPermissionsScreen',
    'cashier-monitor': 'mountCashierMonitorScreen',
    'oracle-data': 'mountOracleDataScreen',
    'daily-locks': 'mountDailyLocksScreen',
    'menu-board': 'mountMenuBoardScreen',
    'pos-entry': 'mountPosEntryScreen',
    'departments': 'mountDepartmentsScreen',
    'hr-departments': 'mountHrDepartmentsScreen',
    'payroll': 'mountPayrollScreen',
    'wh-moves': 'mountWhMovesScreen',
    'wh-returns': 'mountWhReturnsScreen',
    'wh-prs': 'mountWhPrsScreen',
    'dept-transfers': 'mountDeptTransfersScreen',
    'goods-scan': 'mountGoodsScanScreen',
    'recipes': 'mountRecipesScreen',
    'revenues': 'mountRevenuesScreen',
    'expenses': 'mountExpensesScreen',
    'cost-analysis': 'mountCostAnalysisScreen',
    'cost-center': 'mountCostCenterScreen',
    'pnl': 'mountPnlScreen',
    'monthly-comparison': 'mountMonthlyComparisonScreen',
    'hr-dashboard': 'mountHrDashboardScreen',
    'zkteco': 'mountZktecoScreen',
    'dept-employees': 'mountDeptEmployeesScreen',
    'sales-analyzer': 'mountSalesAnalyzerScreen',
    'sales-inquiry': 'mountSalesInquiryScreen',
    'received-analyzer': 'mountReceivedAnalyzerScreen',
    'wh-vs-pos': 'mountWhVsPosScreen',
    'inventory-inquiry': 'mountQueryScreen',
    'inventory-inquiry-pro': 'mountProfessionalScreen',
    'shelves': 'mountShelvesScreen',
    'weight': 'mountWeightScreen',
    'accountant-dashboard': 'mountAccountantDashboardScreen',
    'warehouse-dashboard': 'mountWarehouseDashboardScreen',
    'dept-head-dashboard': 'mountDeptHeadDashboardScreen',
};

const LOADERS = {
    'branches': () => import('./branches.js?v=4.9.411'),
    'attendance': () => import('./attendance.js?v=4.9.411'),
    'employees': () => import('./employees.js?v=4.9.411'),
    'sessions': () => import('./sessions.js?v=4.9.411'),
    'briefing': () => import('./briefing.js?v=4.9.411'),
    'executive': () => import('./executive.js?v=4.9.411'),
    'cfo': () => import('./cfo.js?v=4.9.411'),
    'warehouse': () => import('./warehouse.js?v=4.9.411'),
    'warehouse-gov': () => import('./warehouse-gov.js?v=4.9.411'),
    'reports': () => import('./reports.js?v=4.9.411'),
    'procurement': () => import('./procurement.js?v=4.9.411'),
    'invoices': () => import('./invoices.js?v=4.9.411'),
    'payments': () => import('./payments.js?v=4.9.411'),
    'wh-invoices': () => import('./wh-invoices.js?v=4.9.411'),
    'kitchen': () => import('./kitchen.js?v=4.9.411'),
    'leaves': () => import('./leaves.js?v=4.9.411'),
    'dispatch': () => import('./dispatch.js?v=4.9.411'),
    'veg-requests': () => import('./veg-requests.js?v=4.9.411'),
    'roster': () => import('./roster.js?v=4.9.411'),
    'employee-portal': () => import('./employee-portal.js?v=4.9.411'),
    'settings': () => import('./settings.js?v=4.9.411'),
    'users': () => import('./users.js?v=4.9.411'),
    'yarasoft': () => import('./yarasoft.js?v=4.9.411'),
    'whatsapp': () => import('./whatsapp.js?v=4.9.411'),
    'permissions': () => import('./permissions.js?v=4.9.411'),
    'cashier-monitor': () => import('./cashier-monitor.js?v=4.9.411'),
    'oracle-data': () => import('./oracle-data.js?v=4.9.411'),
    'daily-locks': () => import('./daily-locks.js?v=4.9.411'),
    'menu-board': () => import('./menu-board.js?v=4.9.411'),
    'pos-entry': () => import('./pos-entry.js?v=4.9.411'),
    'departments': () => import('./departments.js?v=4.9.411'),
    'hr-departments': () => import('./hr-departments.js?v=4.9.411'),
    'payroll': () => import('./payroll.js?v=4.9.411'),
    'wh-moves': () => import('./wh-moves.js?v=4.9.411'),
    'wh-returns': () => import('./wh-returns.js?v=4.9.411'),
    'wh-prs': () => import('./wh-prs.js?v=4.9.411'),
    'dept-transfers': () => import('./dept-transfers.js?v=4.9.411'),
    'goods-scan': () => import('./goods-scan.js?v=4.9.411'),
    'recipes': () => import('./recipes.js?v=4.9.411'),
    'revenues': () => import('./revenues.js?v=4.9.411'),
    'expenses': () => import('./expenses.js?v=4.9.411'),
    'cost-analysis': () => import('./cost-analysis.js?v=4.9.411'),
    'cost-center': () => import('./cost-center.js?v=4.9.411'),
    'pnl': () => import('./pnl.js?v=4.9.411'),
    'monthly-comparison': () => import('./monthly-comparison.js?v=4.9.411'),
    'hr-dashboard': () => import('./hr-dashboard.js?v=4.9.411'),
    'zkteco': () => import('./zkteco.js?v=4.9.411'),
    'dept-employees': () => import('./dept-employees.js?v=4.9.411'),
    'sales-analyzer': () => import('./sales-analyzer.js?v=4.9.411'),
    'sales-inquiry': () => import('./sales-inquiry.js?v=4.9.411'),
    'received-analyzer': () => import('./received-analyzer.js?v=4.9.411'),
    'wh-vs-pos': () => import('./wh-vs-pos.js?v=4.9.411'),
    'inventory-inquiry': () => import('./inventory-inquiry.js?v=4.9.411'),
    'inventory-inquiry-pro': () => import('./inventory-inquiry-pro.js?v=4.9.411'),
    'shelves': () => import('./shelves.js?v=4.9.411'),
    'weight': () => import('./weight.js?v=4.9.411'),
    'accountant-dashboard': () => import('./accountant-dashboard.js?v=4.9.411'),
    'warehouse-dashboard': () => import('./warehouse-dashboard.js?v=4.9.411'),
    'dept-head-dashboard': () => import('./dept-head-dashboard.js?v=4.9.411'),
};

/* أربع شاشاتٍ يختلف مفتاحُ مسارها في القائمة عن اسم ملف وحدتها. */
const NAV_ALIAS = {
    'yara-daily-locks': 'daily-locks',
    'pos': 'pos-entry',
    'query': 'inventory-inquiry',
    'professional': 'inventory-inquiry-pro',
};

const loaded = new Map();

/** مفتاحُ وحدةِ الشاشة المقابلُ لمفتاح المسار — أو null إن لم تكن كسولة. */
export function moduleFor(navKey) {
    const key = String(navKey == null ? '' : navKey);
    if (Object.prototype.hasOwnProperty.call(LOADERS, key)) {return key;}
    return Object.prototype.hasOwnProperty.call(NAV_ALIAS, key) ? NAV_ALIAS[key] : null;
}

/** كل مفاتيح الوحدات المسجَّلة — يستخدمها فحص العقد في الاختبارات. */
export function screenModules() {
    return Object.keys(LOADERS);
}

/**
 * يُعيد وعدًا بدالة التركيب، بواحدٍ فقط لكل وحدة.
 * الفشل يُسقَط من الكاش حتى تعمل إعادةُ المحاولة.
 * @param {string} key اسمُ الوحدة أو مفتاحُ المسار.
 * @returns {Promise<Function>}
 */
export function loadScreen(key) {
    const moduleKey = moduleFor(key);
    if (!moduleKey) {return Promise.reject(new Error(`V2: شاشة غير مسجّلة (${key})`));}
    const hit = loaded.get(moduleKey);
    if (hit) {return hit;}
    const pending = LOADERS[moduleKey]().then((mod) => {
        const mount = mod && mod[MOUNTS[moduleKey]];
        if (typeof mount !== 'function') {
            throw new Error(`V2: ${moduleKey}.js لا يصدّر ${MOUNTS[moduleKey]}()`);
        }
        return mount;
    });
    loaded.set(moduleKey, pending);
    pending.catch(() => {
        if (loaded.get(moduleKey) === pending) {loaded.delete(moduleKey);}
    });
    return pending;
}

/**
 * تحميلٌ استباقيٌّ صامت عند المرور/التركيز على عنصر قائمة — يقتصر على ما
 * فتحه المستخدم فعلًا، ولا يُفشل شيئًا لو تأخّرت الشبكة.
 */
export function prefetch(navKey) {
    if (!moduleFor(navKey)) {return;}
    loadScreen(navKey).catch(() => undefined);
}
