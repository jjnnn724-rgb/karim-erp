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
    'branches': () => import('./branches.js?v=4.9.330'),
    'attendance': () => import('./attendance.js?v=4.9.330'),
    'employees': () => import('./employees.js?v=4.9.330'),
    'sessions': () => import('./sessions.js?v=4.9.330'),
    'briefing': () => import('./briefing.js?v=4.9.330'),
    'executive': () => import('./executive.js?v=4.9.330'),
    'cfo': () => import('./cfo.js?v=4.9.330'),
    'warehouse': () => import('./warehouse.js?v=4.9.330'),
    'warehouse-gov': () => import('./warehouse-gov.js?v=4.9.330'),
    'reports': () => import('./reports.js?v=4.9.330'),
    'procurement': () => import('./procurement.js?v=4.9.330'),
    'invoices': () => import('./invoices.js?v=4.9.330'),
    'payments': () => import('./payments.js?v=4.9.330'),
    'wh-invoices': () => import('./wh-invoices.js?v=4.9.330'),
    'kitchen': () => import('./kitchen.js?v=4.9.330'),
    'leaves': () => import('./leaves.js?v=4.9.330'),
    'dispatch': () => import('./dispatch.js?v=4.9.330'),
    'veg-requests': () => import('./veg-requests.js?v=4.9.330'),
    'roster': () => import('./roster.js?v=4.9.330'),
    'employee-portal': () => import('./employee-portal.js?v=4.9.330'),
    'settings': () => import('./settings.js?v=4.9.330'),
    'users': () => import('./users.js?v=4.9.330'),
    'yarasoft': () => import('./yarasoft.js?v=4.9.330'),
    'whatsapp': () => import('./whatsapp.js?v=4.9.330'),
    'permissions': () => import('./permissions.js?v=4.9.330'),
    'cashier-monitor': () => import('./cashier-monitor.js?v=4.9.330'),
    'oracle-data': () => import('./oracle-data.js?v=4.9.330'),
    'daily-locks': () => import('./daily-locks.js?v=4.9.330'),
    'menu-board': () => import('./menu-board.js?v=4.9.330'),
    'pos-entry': () => import('./pos-entry.js?v=4.9.330'),
    'departments': () => import('./departments.js?v=4.9.330'),
    'hr-departments': () => import('./hr-departments.js?v=4.9.330'),
    'payroll': () => import('./payroll.js?v=4.9.330'),
    'wh-moves': () => import('./wh-moves.js?v=4.9.330'),
    'wh-returns': () => import('./wh-returns.js?v=4.9.330'),
    'wh-prs': () => import('./wh-prs.js?v=4.9.330'),
    'dept-transfers': () => import('./dept-transfers.js?v=4.9.330'),
    'goods-scan': () => import('./goods-scan.js?v=4.9.330'),
    'recipes': () => import('./recipes.js?v=4.9.330'),
    'revenues': () => import('./revenues.js?v=4.9.330'),
    'expenses': () => import('./expenses.js?v=4.9.330'),
    'cost-analysis': () => import('./cost-analysis.js?v=4.9.330'),
    'cost-center': () => import('./cost-center.js?v=4.9.330'),
    'pnl': () => import('./pnl.js?v=4.9.330'),
    'monthly-comparison': () => import('./monthly-comparison.js?v=4.9.330'),
    'hr-dashboard': () => import('./hr-dashboard.js?v=4.9.330'),
    'zkteco': () => import('./zkteco.js?v=4.9.330'),
    'dept-employees': () => import('./dept-employees.js?v=4.9.330'),
    'sales-analyzer': () => import('./sales-analyzer.js?v=4.9.330'),
    'sales-inquiry': () => import('./sales-inquiry.js?v=4.9.330'),
    'received-analyzer': () => import('./received-analyzer.js?v=4.9.330'),
    'wh-vs-pos': () => import('./wh-vs-pos.js?v=4.9.330'),
    'inventory-inquiry': () => import('./inventory-inquiry.js?v=4.9.330'),
    'inventory-inquiry-pro': () => import('./inventory-inquiry-pro.js?v=4.9.330'),
    'shelves': () => import('./shelves.js?v=4.9.330'),
    'weight': () => import('./weight.js?v=4.9.330'),
    'accountant-dashboard': () => import('./accountant-dashboard.js?v=4.9.330'),
    'warehouse-dashboard': () => import('./warehouse-dashboard.js?v=4.9.330'),
    'dept-head-dashboard': () => import('./dept-head-dashboard.js?v=4.9.330'),
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
