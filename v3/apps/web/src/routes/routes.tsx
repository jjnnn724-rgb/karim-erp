import { createRoute } from '@tanstack/react-router';
import { validateAccountantDashboardSearch } from '../lib/accountant-search';
import { firstEnabledScreen, LEGACY_APP_URL } from '../lib/screens';
import { rootRoute } from './root';

/**
 * شجرة المسارات — **برمجية** لا مبنية على ملفات (قرار G5): الشجرة نصٌّ صريح
 * في `routes.tsx`، فمسارُ الشاشة ومكوّنها وحمولتها الكسولة في مكانٍ واحد.
 *
 * تقسيم الشيفرة: كل شاشة في وحدةٍ منفصلة تُحمَّل عند الطلب (`lazy`)، فحزمة
 * البداية تحمل القشرة فقط — والقياس في بوابة G5 على `assets/index-*.js`.
 */

/** الجذر `/` — الصفحة الرئيسية (خارج عدّ التكافؤ). لا شاشات مفعّلة ⇒ القديم يبقى الوجهة. */
export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
        if (!firstEnabledScreen()) {
            window.location.replace(LEGACY_APP_URL);
        }
    },
});
indexRoute.lazy(() => import('../screens/Home.lazy').then((module) => module.Route));

/** شجرة الحسابات — للقراءة فقط. */
export const accountsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts',
});
accountsRoute.lazy(() => import('../screens/AccountsTree.lazy').then((module) => module.Route));

/** القيود اليومية — للقراءة فقط. */
export const journalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/journal',
});
journalRoute.lazy(() => import('../screens/JournalViewer.lazy').then((module) => module.Route));

/** الإيرادات — للقراءة فقط. */
export const revenuesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/revenues',
});
revenuesRoute.lazy(() => import('../screens/Revenues.lazy').then((module) => module.Route));

/** المصروفات — للقراءة فقط. */
export const expensesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/expenses',
});
expensesRoute.lazy(() => import('../screens/Expenses.lazy').then((module) => module.Route));

/** سجلّ الصرف + إذن الصرف — قراءة فقط (B4). */
export const cashRegisterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cash-register',
});
cashRegisterRoute.lazy(() => import('../screens/CashRegister.lazy').then((module) => module.Route));

/** التقفيل اليومي — قراءة فقط (B4). */
export const dailyLocksRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/daily-locks',
});
dailyLocksRoute.lazy(() => import('../screens/DailyLocks.lazy').then((module) => module.Route));

/** بيانات Oracle المنسوخة — عرض قرائي فقط (B4). */
export const oracleDataRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/oracle-data',
});
oracleDataRoute.lazy(() => import('../screens/OracleData.lazy').then((module) => module.Route));

/** دليل الموردين — للقراءة فقط. */
export const procurementRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/procurement',
});
procurementRoute.lazy(() => import('../screens/Procurement.lazy').then((module) => module.Route));

/** مدفوعات الموردين — للقراءة فقط. */
export const paymentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/payments',
});
paymentsRoute.lazy(() => import('../screens/Payments.lazy').then((module) => module.Route));

/** فواتير الشراء — للقراءة فقط. */
export const purchaseInvoicesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/purchase-invoices',
});
purchaseInvoicesRoute.lazy(() => import('../screens/PurchaseInvoices.lazy').then((module) => module.Route));

/** سجل الأقسام — للقراءة فقط. */
export const departmentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/departments',
});
departmentsRoute.lazy(() => import('../screens/Departments.lazy').then((module) => module.Route));

/** حركات المخزون — للقراءة فقط. */
export const inventoryMovementsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wh-moves',
});
inventoryMovementsRoute.lazy(() => import('../screens/InventoryMovements.lazy').then((module) => module.Route));

/** أذون الصرف — للقراءة فقط. */
export const dispatchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dispatch',
});
dispatchesRoute.lazy(() => import('../screens/Dispatches.lazy').then((module) => module.Route));

/** المخزون — للقراءة فقط. */
export const warehouseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/warehouse',
});
warehouseRoute.lazy(() => import('../screens/Warehouse.lazy').then((module) => module.Route));

/** حوكمة المخزن — السنة المالية وتقارير الأرصدة والصحة. */
export const warehouseGovRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/warehouse-gov',
});
warehouseGovRoute.lazy(() => import('../screens/WarehouseGov.lazy').then((module) => module.Route));

/** مسح البضاعة — ربط باركود ووارد وأذون صرف. */
export const goodsScanRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goods-scan',
});
goodsScanRoute.lazy(() => import('../screens/GoodsScan.lazy').then((module) => module.Route));

/** الرفوف — للقراءة فقط. */
export const shelvesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/shelves',
});
shelvesRoute.lazy(() => import('../screens/Shelves.lazy').then((module) => module.Route));

/** مرتجعات المطبخ — للقراءة فقط. */
export const kitchenReturnsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wh-returns',
});
kitchenReturnsRoute.lazy(() => import('../screens/KitchenReturns.lazy').then((module) => module.Route));

/** طلبات شراء النواقص — للقراءة فقط. */
export const purchaseRequestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wh-prs',
});
purchaseRequestsRoute.lazy(() => import('../screens/PurchaseRequests.lazy').then((module) => module.Route));

/** التحويلات الداخلية — للقراءة فقط. */
export const deptTransfersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dept-transfers',
});
deptTransfersRoute.lazy(() => import('../screens/DeptTransfers.lazy').then((module) => module.Route));

/** دليل الموظفين — للقراءة فقط. */
export const employeesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/employees',
});
employeesRoute.lazy(() => import('../screens/Employees.lazy').then((module) => module.Route));

/** أقسام الموارد البشرية — دليل وعمليات مقيّدة بعلم الكتابة. */
export const hrDepartmentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/hr-departments',
});
hrDepartmentsRoute.lazy(() => import('../screens/HrDepartments.lazy').then((module) => module.Route));

/** سجل الحضور والانصراف — قراءة فقط. */
export const attendanceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/attendance',
});
attendanceRoute.lazy(() => import('../screens/Attendance.lazy').then((module) => module.Route));

/** طلبات الإجازات وسلسلة الاعتماد — للقراءة فقط. */
export const leavesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/leaves',
});
leavesRoute.lazy(() => import('../screens/Leaves.lazy').then((module) => module.Route));

/** سجل الرواتب وكشف الموظفين — قراءة فقط. */
export const payrollRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/payroll',
});
payrollRoute.lazy(() => import('../screens/Payroll.lazy').then((module) => module.Route));

/** مدد والتأمينات وقوى — جاهزية محلية وكشف مراجعة (GATE 06، ADR-008). */
export const mudadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/mudad',
});
mudadRoute.lazy(() => import('../screens/Mudad.lazy').then((module) => module.Route));

/** شبكة الدوام الأسبوعية — للقراءة فقط. */
export const rosterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/roster',
});
rosterRoute.lazy(() => import('../screens/Roster.lazy').then((module) => module.Route));

/** دليل حسابات الدخول — للقراءة فقط. */
export const usersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users',
});
usersRoute.lazy(() => import('../screens/Users.lazy').then((module) => module.Route));

/** فروع المنشأة — للقراءة فقط. */
export const branchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/branches',
});
branchesRoute.lazy(() => import('../screens/Branches.lazy').then((module) => module.Route));

/** الصلاحيات — للقراءة فقط. */
export const permissionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/permissions',
});
permissionsRoute.lazy(() => import('../screens/Permissions.lazy').then((module) => module.Route));

/** طلبات شراء الخضار — للقراءة فقط. */
export const vegRequestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/veg-requests',
});
vegRequestsRoute.lazy(() => import('../screens/VegRequests.lazy').then((module) => module.Route));

/** الميزان — للقراءة فقط. */
export const weightRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/weight',
});
weightRoute.lazy(() => import('../screens/Weight.lazy').then((module) => module.Route));

/** الوصفات — للقراءة فقط. */
export const recipesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/recipes',
});
recipesRoute.lazy(() => import('../screens/Recipes.lazy').then((module) => module.Route));

/** الأجهزة والجلسات النشطة — قراءة وإبطال. */
export const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
});
sessionsRoute.lazy(() => import('../screens/Sessions.lazy').then((module) => module.Route));

/** واتساب والتنبيهات — سجل ومتابعة وقوالب. */
export const whatsappRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/whatsapp',
});
whatsappRoute.lazy(() => import('../screens/Whatsapp.lazy').then((module) => module.Route));

/** الموجز التنفيذي — لوحة متابعة للمدير. */
export const briefingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/briefing',
});
briefingRoute.lazy(() => import('../screens/Briefing.lazy').then((module) => module.Route));

/** إعدادات النظام — عامة وفواتير وطابعات. */
export const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
});
settingsRoute.lazy(() => import('../screens/Settings.lazy').then((module) => module.Route));

/** الموجز التنفيذي — ملخص الأداء للإدارة. */
export const executiveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/executive',
});
executiveRoute.lazy(() => import('../screens/Executive.lazy').then((module) => module.Route));

/** لوحة الموارد البشرية — مؤشرات وإجازات بانتظار الاعتماد. */
export const hrDashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/hr-dashboard',
});
hrDashboardRoute.lazy(() => import('../screens/HrDashboard.lazy').then((module) => module.Route));

/** موظفو القسم — سجل القائد (قراءة فقط). */
export const deptEmployeesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dept-employees',
});
deptEmployeesRoute.lazy(() => import('../screens/DeptEmployees.lazy').then((module) => module.Route));

/** بوابة الموظف — حالة الحضور والبصمات (قراءة فقط). */
export const employeePortalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/employee-portal',
});
employeePortalRoute.lazy(() => import('../screens/EmployeePortal.lazy').then((module) => module.Route));

/** أجهزة البصمة — حالة الأجهزة والربط والسجل. */
export const zktecoRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/zkteco',
});
zktecoRoute.lazy(() => import('../screens/Zkteco.lazy').then((module) => module.Route));

/** المطبخ — نظرة عامة على الإنتاج والمخزون. */
export const kitchenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/kitchen',
});
kitchenRoute.lazy(() => import('../screens/Kitchen.lazy').then((module) => module.Route));

/** شاشة القائمة — أصناف نقاط البيع المعروضة. */
export const menuBoardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/menu-board',
});
menuBoardRoute.lazy(() => import('../screens/MenuBoard.lazy').then((module) => module.Route));

/** لوحة المخزن — مؤشرات المخزون والتدفق. */
export const warehouseDashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/warehouse-dashboard',
});
warehouseDashboardRoute.lazy(() => import('../screens/WarehouseDashboard.lazy').then((module) => module.Route));

/** لوحة المحاسب — مؤشرات مالية وتشغيلية. */
export const accountantDashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accountant-dashboard',
    validateSearch: validateAccountantDashboardSearch,
});
accountantDashboardRoute.lazy(() => import('../screens/AccountantDashboard.lazy').then((module) => module.Route));

/** لوحة رئيس القسم — أداء القسم. */
export const deptHeadDashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dept-head-dashboard',
});
deptHeadDashboardRoute.lazy(() => import('../screens/DeptHeadDashboard.lazy').then((module) => module.Route));

/** تحليل التكلفة — تكلفة الأصناف والأقسام. */
export const costAnalysisRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cost-analysis',
});
costAnalysisRoute.lazy(() => import('../screens/CostAnalysis.lazy').then((module) => module.Route));

/** مركز التكلفة — مصروفات الأقسام ومقابلتها. */
export const costCenterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cost-center',
});
costCenterRoute.lazy(() => import('../screens/CostCenter.lazy').then((module) => module.Route));

/** محرك استعلامات المخزون — قراءة فقط. */
export const inventoryInquiryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inventory-inquiry',
});
inventoryInquiryRoute.lazy(() => import('../screens/InventoryInquiry.lazy').then((module) => module.Route));

/** البطاقة الفاخرة للصنف — قراءة فقط. */
export const inventoryInquiryProRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inventory-inquiry-pro',
});
inventoryInquiryProRoute.lazy(() => import('../screens/InventoryInquiryPro.lazy').then((module) => module.Route));

/** الأرباح والخسائر — قائمة الدخل. */
export const pnlRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pnl',
});
pnlRoute.lazy(() => import('../screens/Pnl.lazy').then((module) => module.Route));

/** المدير المالي — ملخص وميزان وقيود وفترات (قراءة فقط). */
export const cfoRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cfo',
});
cfoRoute.lazy(() => import('../screens/Cfo.lazy').then((module) => module.Route));

/** المقارنة الشهرية — إيراد ومصروف شهرٍ مقابل آخر. */
export const monthlyComparisonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/monthly-comparison',
});
monthlyComparisonRoute.lazy(() => import('../screens/MonthlyComparison.lazy').then((module) => module.Route));

/** التقارير — تقرير مبيعات POS وفهرس مخرجات التقارير المتاحة حسب الصلاحية. */
export const reportsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reports',
});
reportsRoute.lazy(() => import('../screens/Reports.lazy').then((module) => module.Route));

/** مبيعات الكاشير — فواتير وأصناف (مرآة YaraSoft). */
export const cashierSalesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cashier-sales',
});
cashierSalesRoute.lazy(() => import('../screens/CashierSales.lazy').then((module) => module.Route));

/** متابعة الكاشير — أوردرات حيّة (مرآة YaraSoft). */
export const cashierMonitorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cashier-monitor',
});
cashierMonitorRoute.lazy(() => import('../screens/CashierMonitor.lazy').then((module) => module.Route));

/** نقطة البيع — الكاشير الحيّ: أصناف وسلة ودفع ووردية وإيصال. */
export const posEntryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pos-entry',
});
posEntryRoute.lazy(() => import('../screens/PosEntry.lazy').then((module) => module.Route));

/** كشك الكاشير — نفس نقطة البيع بلا قائمة إدارة أو بيانات خارج الوردية. */
export const cashierKioskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cashier',
});
cashierKioskRoute.lazy(() => import('../screens/CashierKiosk.lazy').then((module) => module.Route));

/** مصدر البيانات — فصل Yarasoft/Oracle والاعتماد على PostgreSQL وحده. */
export const legacySourceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/integrations',
});
legacySourceRoute.lazy(() => import('../screens/LegacySource.lazy').then((module) => module.Route));

/** تحليل مبيعات الأصناف (مرآة YaraSoft). */
export const salesAnalyzerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sales-analyzer',
});
salesAnalyzerRoute.lazy(() => import('../screens/SalesAnalyzer.lazy').then((module) => module.Route));

/** استعلام المبيعات (مرآة YaraSoft). */
export const salesInquiryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sales-inquiry',
});
salesInquiryRoute.lazy(() => import('../screens/SalesInquiry.lazy').then((module) => module.Route));

/** تحليل المستلَم (مرآة YaraSoft). */
export const receivedAnalyzerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/received-analyzer',
});
receivedAnalyzerRoute.lazy(() => import('../screens/ReceivedAnalyzer.lazy').then((module) => module.Route));

/** مقارنة المخزن بنقطة البيع (مرآة YaraSoft). */
export const whVsPosRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wh-vs-pos',
});
whVsPosRoute.lazy(() => import('../screens/WhVsPos.lazy').then((module) => module.Route));

/** يارسوفت — تكامل قاعدة الكاشير (كل تبويبات V2) + الإيرادات المحلية. */
export const yarasoftRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/yarasoft',
});
yarasoftRoute.lazy(() => import('../screens/Yarasoft.lazy').then((module) => module.Route));

/** معرض نظام التصميم — مسار أداة داخلي كسول، خارج عدّ التكافؤ (ADR-002). */
export const designGalleryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/design',
});
designGalleryRoute.lazy(() => import('../screens/DesignGallery.lazy').then((module) => module.Route));

export const routeTree = rootRoute.addChildren([
    indexRoute,
    accountsRoute,
    journalRoute,
    revenuesRoute,
    expensesRoute,
    cashRegisterRoute,
    dailyLocksRoute,
    oracleDataRoute,
    designGalleryRoute,
    procurementRoute,
    purchaseInvoicesRoute,
    paymentsRoute,
    departmentsRoute,
    inventoryMovementsRoute,
    dispatchesRoute,
    warehouseRoute,
    warehouseGovRoute,
    goodsScanRoute,
    shelvesRoute,
    kitchenReturnsRoute,
    purchaseRequestsRoute,
    deptTransfersRoute,
    employeesRoute,
    hrDepartmentsRoute,
    attendanceRoute,
    leavesRoute,
    payrollRoute,
    mudadRoute,
    rosterRoute,
    usersRoute,
    branchesRoute,
    permissionsRoute,
    vegRequestsRoute,
    weightRoute,
    recipesRoute,
    sessionsRoute,
    whatsappRoute,
    briefingRoute,
    settingsRoute,
    executiveRoute,
    hrDashboardRoute,
    deptEmployeesRoute,
    employeePortalRoute,
    zktecoRoute,
    kitchenRoute,
    menuBoardRoute,
    warehouseDashboardRoute,
    accountantDashboardRoute,
    deptHeadDashboardRoute,
    costAnalysisRoute,
    costCenterRoute,
    inventoryInquiryRoute,
    inventoryInquiryProRoute,
    pnlRoute,
    cfoRoute,
    monthlyComparisonRoute,
    reportsRoute,
    cashierSalesRoute,
    cashierMonitorRoute,
    posEntryRoute,
    cashierKioskRoute,
    legacySourceRoute,
    salesAnalyzerRoute,
    salesInquiryRoute,
    receivedAnalyzerRoute,
    whVsPosRoute,
    yarasoftRoute,
]);
