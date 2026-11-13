/**
 * v2-dept-transfers.test.js — عقد نظام التحويلات الداخلية بين الأقسام
 * ═══════════════════════════════════════════════════════════════════════
 * (2026-11-01 — اعتماد المالك: أي قسم → أي قسم باعتماد الشيف الفوري +
 * بيع خارجي مباشر بلا اعتماد، خصم/إضافة بالتكلفة الفعلية وقيد مركزي تكلفة).
 *
 * فحوص عقد نصية خالصة (fs) — لا vm ولا DB، بنمط اختبارات V2 الأحدث.
 * العقود مثبتة من:
 *   backend/dept-transfer-routes.js · backend/transfer-notifier.js
 *   backend/notification-service.js · frontend/app/js/v2/data/transfer-repo.js
 *   frontend/app/js/v2/screens/dept-transfers.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ROUTES = 'backend/dept-transfer-routes.js';
const STORES = 'backend/dept-stores.js';
const NOTIFIER = 'backend/transfer-notifier.js';
const NOTIF_SVC = 'backend/notification-service.js';
const REPO = 'frontend/app/js/v2/data/transfer-repo.js';
const SCREEN = 'frontend/app/js/v2/screens/dept-transfers.js';
const REGISTRY = 'frontend/app/js/v2/screens/registry.js';
const PREVIEW = 'frontend/app/js/v2/preview.js';
const NAV = 'frontend/app/js/v2/layout/nav-model.js';
const I18N = 'frontend/app/js/core/i18n.js';
const APPJS = 'frontend/app/js/app.js';
const CONFIG = 'frontend/app/js/core/config.js';
const SERVER = 'backend/server.js';
const CALLOUT = 'frontend/app/js/v2/callout.js';
const SHELL = 'frontend/app/js/v2/layout/shell-extras.js';

describe('عقد نظام التحويلات الداخلية بين الأقسام', () => {
    test('الخادم: المسارات الثمانية موجودة في ملف معزول جديد', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/router\.get\('\/dept-transfers\/stock'/);
        expect(src).toMatch(/router\.get\('\/dept-transfers\/summary'/);
        expect(src).toMatch(/router\.get\('\/dept-transfers'/);
        expect(src).toMatch(/router\.post\('\/dept-transfers\/external'/);
        expect(src).toMatch(/router\.post\('\/dept-transfers\/:id\/approve'/);
        expect(src).toMatch(/router\.post\('\/dept-transfers\/:id\/reject'/);
        expect(src).toMatch(/router\.post\('\/dept-transfers\/:id\/cancel'/);
        // التصدير اتسع لاحقًا ليشمل buildFactorySettlementLines + buildTransferCostLines
        // (يراها accounting-routes.js) — المهم أن router ضمن المصدَّر.
        expect(src).toMatch(/module\.exports = \{\s*router\b/);
    });

    test('الخادم: دورة قرار الشيف نفسها في سلسلة الصرف + منع اعتماد الطلب الذاتي', () => {
        const src = read(ROUTES);
        // الأدوار مرآة CHEF_APPROVAL_ROLES (warehouse-routes.js:22)
        expect(src).toMatch(/const APPROVE_ROLES = \['admin', 'manager', 'kitchen', 'sous_chef'\]/);
        expect(src).toMatch(/const WRITE_ROLES = \['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'\]/);
        // لا يعتمد أحد طلبه بنفسه
        expect(src).toMatch(/SELF_APPROVAL/);
        expect(src).toMatch(/transfer\.requested_by\) === Number\(req\.user\.id\)/);
    });

    test('الخادم: الاعتماد تنفيذ فوري — خصم من المرسل وإضافة للمستلم بالتكلفة الفعلية', () => {
        const src = read(ROUTES);
        // قيد الحالة في الجدول لا يحوي completed — الإتمام بحالة received
        expect(src).toMatch(/const STATUS_DONE = 'received'/);
        expect(src).toMatch(/transactionType: 'transfer_out'/);
        expect(src).toMatch(/transactionType: 'transfer_in'/);
        expect(src).toMatch(/idempotencyKey: idOut/);
        expect(src).toMatch(/idempotencyKey: idIn/);
        // التكلفة الفعلية = avgCost لحظة التنفيذ
        expect(src).toMatch(/SELECT COALESCE\("avgCost",0\) avg_cost FROM inventory WHERE id=\$1/);
        // الاعتماد يرفض منفَّذًا ويقبل requested فقط
        expect(src).toMatch(/transfer\.status !== 'requested'/);
        // نفاد الرصيد 409
        expect(src).toMatch(/INSUFFICIENT_STOCK/);
    });

    test('الخادم: منافذ البيع الخارجية الثلاثة — أي قسم يسلّم بلا اعتماد من أذونات الشهر', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/const EXTERNAL_SALE_DEPT = 'external_sales'/);
        expect(src).toMatch(/const EXTERNAL_DESTS = \['external_sales', 'caf', 'nas'\]/);
        expect(src).toMatch(/EXTERNAL_SALE_USE_DIRECT/);
        expect(src).toMatch(/INVALID_EXTERNAL_DEST/);
        expect(src).toMatch(/mode: 'external_sale'/);
        // الوجهات الثلاث ممنوعة على مسار الطلب/الاعتماد — لها مسار مباشر
        expect(src).toMatch(/if \(isExternalDest\(destDept\)\)/);
        // المصدر يُحل بنفس دالة سلسلة الصرف (رئيس القسم مُجبر على قسمه)
        expect(src).toMatch(/const srcRes = resolveSourceDept\(req\.user, req\.body \? req\.body\.sourceDeptCode : null\)/);
        expect(src).toMatch(/resolveExternalDest\(client, destRaw\)/);
        // نطاق الشهر: المصدر جدول أذونات الصرف نفسه (approvedItems بتكلفة الإذن)
        expect(src).toMatch(/scope === 'month'/);
        expect(src).toMatch(/FROM dispatches/);
        expect(src).toMatch(/"warehouseApprovedAt" >= \$2::timestamptz/);
        expect(src).toMatch(/function monthVoucherStartAtRiyadh\(\) \{\s*return monthStartRiyadh\(\) \+ 'T00:00:00\+03:00';/);
        expect(src).not.toContain('2026-11-01T22:00:00+03:00');
        expect(src).toMatch(/"approvedItems"/);
        expect(src).toMatch(/Number\(it\.itemId\)/);
        expect(src).toMatch(/Number\(it\.approvedQty\)/);
        expect(src).toMatch(/function monthStartRiyadh\(\)/);
        expect(src).toMatch(/month_qty/);
        // حارس المصدر: لا تحويل لما لم يدخل بأذونات الشهر + لا تكرار + رصيد فعلي
        expect(src).toMatch(/assertMonthSourced\(client, srcRes\.deptCode, sourceLoc\.id/);
        expect(src).toMatch(/NOT_FROM_CURRENT_DISPATCH/);
        expect(src).toMatch(/reference_type = 'inventory_transfer'/);
    });

    test('الخادم: التحويل الداخلي أيضًا محصور في أذونات الصرف ويُعاد فحصه عند الاعتماد', () => {
        const src = read(ROUTES);
        const requestStart = src.indexOf("router.post('/dept-transfers'");
        const externalStart = src.indexOf("router.post('/dept-transfers/external'");
        const approveStart = src.indexOf("router.post('/dept-transfers/:id/approve'");
        const requestRoute = src.slice(requestStart, externalStart);
        const approveRoute = src.slice(approveStart);
        expect(requestRoute).toMatch(/assertMonthSourced\(client, srcRes\.deptCode, sourceLoc\.id/);
        expect(requestRoute).toContain("cost_basis: 'issue_voucher'");
        expect(approveRoute).toContain('await assertMonthSourced(client, sourceDept, transfer.source_location_id');
        expect(src).toMatch(/ORDER BY inventory_id FOR UPDATE/);
    });

    test('الخادم: التحويل يكتب قيدَي مصروف متقابلين في دفتر المصروفات (مصدر تحليل التكاليف)', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/adjustmentType[\s\S]*inventory_transfer/);
        expect(src).toMatch(/'inventory_transfer'\)/);
        expect(src).toMatch(/writeTransferExpenses\(client, transfer, totalValue, srcRes\.deptCode, destDept/);
        expect(src).toMatch(/writeTransferExpenses\(client, transfer, totalValue, sourceDept, destDept/);
        expect(src).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
        expect(src).toMatch(/function expenseIdFor\(transferId, side\)/);
        expect(src).toMatch(/transfer-expense:/);
    });

    test('الخادم: قيد نقل التكلفة بين مركزي القسمين (مدين 5000 مستلم / دائن 5000 مرسل)', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/postJournal, ensureCostCenters, normalizeCostCenterCode/);
        // الحساب صار حسابًا مُحلَّلًا من الخريطة بخيار 5000 افتراضيًا — النص يذكر fallback
        expect(src).toMatch(/cost_account \|\| '5000'/);
        expect(src).toMatch(/account_code: costAcct, debit: v, credit: 0/);
        expect(src).toMatch(/account_code: costAcct, debit: 0, credit: v/);
        expect(src).toMatch(/source_type: 'inventory_transfer'/);
        expect(src).toMatch(/ensureCostCenters\(\[src, dst\]\)/);
    });

    test('الخادم: رئيس القسم مُجبر على قسمه والشيف بلا قسم يعمل من المطبخ', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/DEPT_MISMATCH/);
        expect(src).toMatch(/DEPT_HEAD_WITHOUT_DEPARTMENT/);
        expect(src).toMatch(/const KITCHEN_DEPT = 'kitchen'/);
    });

    test('الخادم: مخازن الأقسام تُنشأ تلقائيًا idempotent على الكود', () => {
        const src = read(ROUTES);
        expect(src).toMatch(/ensureDeptLocation/);
        const stores = read(STORES);
        expect(stores).toMatch(/ON CONFLICT \(code\) DO UPDATE/);
        expect(stores).toMatch(/'STORE-' \+ normalizeStoreToken/);
    });

    test('الإشعارات: فئة transfers ذات أولوية والقناة مصنفة في الجرس والمنادي', () => {
        const svc = read(NOTIF_SVC);
        expect(svc).toMatch(/NOTIFICATION_CATEGORIES = \['dispatch', 'procurement', 'transfers'\]/);
        expect(svc).toMatch(/PRIORITY_CATEGORIES = \['dispatch', 'procurement', 'transfers'\]/);
        const notifier = read(NOTIFIER);
        expect(notifier).toMatch(/category: 'transfers'/);
        expect(notifier).toMatch(/targetRoles: \['kitchen', 'sous_chef'\]/);
        expect(notifier).toMatch(/link: 'dept-transfers'/);
        // إشعار الاعتماد يصل للقسم المستلم
        expect(notifier).toMatch(/targetDeptCodes: toDeptCode \? \[toDeptCode\] : \[\]/);
        const callout = read(CALLOUT);
        expect(callout).toMatch(/Object\.freeze\(\['dispatch', 'procurement', 'transfers'\]\)/);
        const shell = read(SHELL);
        expect(shell).toMatch(/id: 'transfers', label: 'التحويلات', icon: 'arrow-left-right'/);
    });

    test('الفرونت: المستودع باب وحيد وأدواره مرآة الخادم', () => {
        const repo = read(REPO);
        expect(repo).toMatch(/import \{ apiFetch \} from '\.\.\/\.\.\/core\/api\.js/);
        expect(repo).toMatch(/WRITE_ROLES = \['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'\]/);
        expect(repo).toMatch(/APPROVE_ROLES = \['admin', 'manager', 'kitchen', 'sous_chef'\]/);
        expect(repo).toMatch(/fetchDeptTransfers/);
        expect(repo).toMatch(/createExternalSaleTransfer/);
        expect(repo).toMatch(/fetchTransferSummary/);
        // منافذ البيع الخارجية الثلاثة — مرآة EXTERNAL_DESTS في الخادم
        expect(repo).toMatch(/EXTERNAL_DESTINATIONS = \[/);
        expect(repo).toMatch(/\{ code: 'external_sales', name: 'البيع الخارجي' \}/);
        expect(repo).toMatch(/\{ code: 'CAF', name: 'كافيهshop' \}/);
        expect(repo).toMatch(/\{ code: 'NAS', name: 'كافيه ناصر' \}/);
        expect(repo).toMatch(/isExternalDestination/);
        // بوابة التحويل الخارجي = أدوار الكتابة (أي قسم) — والخادم الحكم النهائي
        expect(repo).toMatch(/export function canExternalSale\(user = \{\}\) \{\n {4}return canCreate\(user\.role\);/);
        expect(repo).toMatch(/canChooseSourceDept/);
        // الحالات الثلاث المعروفة + طلب
        expect(repo).toMatch(/requested: \{ label: 'بانتظار اعتماد الشيف'/);
        expect(repo).toMatch(/received: \{ label: 'منفَّذ ومكتمل'/);
    });

    test('الفرونت: الشاشة بلا apiFetch وتستخدم esc وkpiStrip ولوحة التحويلات', () => {
        const screen = read(SCREEN);
        expect(screen).not.toMatch(/apiFetch/);
        expect(screen).toMatch(/import \{ kpiStrip \} from '\.\.\/role-dash-parts\.js/);
        expect(screen).toMatch(/transferBadge/);
        // الاستيفاء داخل innerHTML مُهرَّب دائمًا (سياسة الأمان الموحدة)
        expect(screen).toMatch(/const esc = \(v\) => String\(v \?\? ''\)/);
        // الشاشة تُلحق عنصرها بالـhost — بلا إلحاق يبقى المضيف فارغًا بصمت
        expect(screen).toMatch(/host\.appendChild\(el\)/);
        // أزرار المسارين والاعتماد والرفض
        expect(screen).toMatch(/data-v2dt-new/);
        expect(screen).toMatch(/data-v2dt-approve/);
        expect(screen).toMatch(/data-v2dt-reject/);
        // لوحة التحويلات: حاوية + فترة (من/إلى) + تطبيق + جلب الملخص
        expect(screen).toMatch(/data-v2dt-dash/);
        expect(screen).toMatch(/data-v2dt-dash-from/);
        expect(screen).toMatch(/data-v2dt-dash-to/);
        expect(screen).toMatch(/data-v2dt-dash-apply/);
        expect(screen).toMatch(/fetchTransferSummary\(dash\.from, dash\.to, currentScopeMode\(\)\)/);
        // نفس أصناف لوحة تحليل التكاليف (.erp-v2-cost__*) — بلا ملف CSS جديد
        expect(screen).toMatch(/erp-v2-cost__hero/);
        expect(screen).toMatch(/erp-v2-cost__mix/);
    });

    test('الفرونت: المسار الخارجي — أي قسم يختار مصدره ووجهته من منافذ البيع الثلاثة', () => {
        const screen = read(SCREEN);
        // زر منافذ البيع الخارجية = بوابة أدوار الكتابة (canCreate) لا أدوار المطبخ
        expect(screen).toMatch(/mayExternal \? `<button[^>]*data-v2dt-external/);
        expect(screen).toMatch(/const mayExternal = canExternalSale\(\{ role, dept_code: deptCode \}\)/);
        // اختيار المصدر متاح للأدوار الحرة في المسارين (لا استثناء للمطبخ)
        expect(screen).toMatch(/const mayChooseSource = canChooseSourceDept\(role\)/);
        expect(screen).toMatch(/const fixedFrom = mayChooseSource \? '' : mySrc/);
        expect(screen).toMatch(/data-v2dt-src/);
        // الوجهة: منافذ البيع الخارجية الثلاثة من المستودع — لا قيمة ثابتة
        expect(screen).toMatch(/EXTERNAL_DESTINATIONS\.map/);
        expect(screen).toMatch(/isExternalDestination\(d\.code\)/);
        expect(screen).toMatch(/data-v2dt-dest/);
        expect(screen).toMatch(/createExternalSaleTransfer\(\{ \.\.\.body, destDeptCode: p\.to \}\)/);
        expect(screen).toMatch(/createDeptTransfer\(\{ \.\.\.body, destDeptCode: p\.to \}\)/);
        // قائمة الأصناف من أذونات الشهر الحالي فقط. السقف إذنُ الصرف نفسه:
        // المتاح يأتي من الخادم بلا قصّ إضافي في المتصفح على رصيد المخزن —
        // ذلك القصّ كان يصفّر المتاح بصمت لما البضاعة تكون معتمدة في الإذن
        // ولم يُسجَّل استلامها بعد في مخزن القسم.
        expect(screen).toMatch(/const stockScope = 'month'/);
        expect(screen).toMatch(/صُرف بالإذن/);
        expect(screen).toMatch(/لم تُستلم بعد/);
        expect(screen).toMatch(/const cap = Number\(stockItem\.available\) \|\| 0/);
        expect(screen).not.toMatch(/Math\.min\(Number\(stockItem\.month_qty\)/);
    });

    test('الاستجابة: الزر لا يعمل بصمت — سبب المنع داخل اللوحة والتنفيذ يلتقط السطر المُعدّ', () => {
        const screen = read(SCREEN);
        // شريط حالة داخل اللوحة نفسها فوق الزر: سطر الملاحظات أعلى الشاشة
        // بعيد عن الإبهام على الهاتف، فمنعٌ بلا رسالة يبدو كزرٍ ميت.
        expect(screen).toMatch(/data-v2dt-status role="status" aria-live="polite"/);
        expect(screen).toMatch(/function say\(message, kind = 'info'\)/);
        // كل موانع الإرسال تمر بالشريط، لا بسطر بعيد عن اللوحة.
        expect(screen).toMatch(/say\('أضف صنفًا واحدًا على الأقل/);
        expect(screen).toMatch(/'اختر منفذ البيع الخارجي/);
        expect(screen).toMatch(/'حدد القسم المستلم/);
        expect(screen).toMatch(/تعذّر التنفيذ: \$\{reason\}/);
        // «تنفيذ التحويل» يلتقط السطر المكتوب في صف الاختيار أولًا — لا رفض
        // صامت حين يكون الصنف والكمية محفوظين ولم يضغط «إضافة».
        expect(screen).toMatch(/if \(addLineFromDraft\(\) === 'blocked'\) \{return;\}/);
        expect(screen).toMatch(/if \(btn\.hasAttribute\('data-v2dt-addline'\)\) \{addLineFromDraft\(\); return;\}/);
        // ضغطتان متتاليتان لا ترسلان تحويلين: الزر يُعطَّل أثناء التنفيذ.
        expect(screen).toMatch(/data-v2dt-submit\$\{p\.busy \? ' disabled' : ''\}>\$\{p\.busy \? 'جارٍ التنفيذ…'/);
        expect(screen).toMatch(/if \(p\.busy\) \{return;\}/);
    });

    test('التسجيل: الشاشة في السجل والمسار والقائمة والأدوار والترجمة', () => {
        const registry = read(REGISTRY);
        expect(registry).toMatch(/'dept-transfers': 'mountDeptTransfersScreen'/);
        expect(registry).toMatch(/'dept-transfers': \(\) => import\('\.\/dept-transfers\.js/);
        const preview = read(PREVIEW);
        expect(preview).toMatch(/renderDeptTransfersScreen/);
        expect(preview).toMatch(/if \(key === 'dept-transfers'\)/);
        expect(preview).toMatch(/teardownDeptTransfersScreen/);
        const nav = read(NAV);
        expect(nav).toMatch(/'wh-prs', 'dept-transfers', 'veg-requests'/);
        const i18n = read(I18N);
        expect(i18n).toMatch(/'pg\.dept-transfers': 'التحويلات الداخلية'/);
        expect(i18n).toMatch(/'pg\.dept-transfers': 'Internal Transfers'/);
        expect(i18n).toMatch(/'dept-transfers': \{ icon: 'arrow-left-right', ar: 'التحويلات الداخلية', en: 'Internal Transfers' \}/);
        const app = read(APPJS);
        expect(app).toMatch(/'dept-transfers': '<i class=ji data-i=arrow-left-right><\/i>'/);
        const config = read(CONFIG);
        // الأدوار السبعة التي تحتاج الشاشة
        for (const role of ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head', 'accountant']) {
            const block = config.match(new RegExp(role + ': \\{[^}]*\\}'));
            expect(block).toBeTruthy();
            expect(block[0]).toContain("'dept-transfers'");
        }
    });

    test('التركيب: جبل الخادم مع req.io بجوار محرك التحويلات المخزني', () => {
        const server = read(SERVER);
        expect(server).toMatch(/const \{ router: deptTransferRouter \} = require\('\.\/dept-transfer-routes'\)/);
        expect(server).toMatch(/app\.use\('\/api\/warehouse', \(req, res, next\) => \{ req\.io = io; next\(\); \}, deptTransferRouter\)/);
    });

    test('الملف الأصلي inventory-transfer-routes.js لم يُمَس — المعزولة صفر استخدام تبقى كما هي', () => {
        const src = read('backend/inventory-transfer-routes.js');
        // لم يُضف إليه نظام الأقسام الجديد
        expect(src).not.toMatch(/dept-transfer-routes/);
        expect(src).not.toMatch(/EXTERNAL_SALE_DEPT/);
        // عقوده التاريخية باقية (اختبارات expiry-policy مثبتة عليه)
        expect(src).toMatch(/latestExpiryFor/);
    });
});
