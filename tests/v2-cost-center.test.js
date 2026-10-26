/**
 * v2-cost-center.test.js — عقد «حساب القسم» (نظام تكلفة المراكز) · 2026-10-25
 * ═══════════════════════════════════════════════════════════════════════
 * المعادلة المعتمدة: صافي القسم = إيراد الكاشير − كلفة الصرف − كلفة
 * التوليد − الإضافات. عقود هذا الملف قراءةُ مصدرٍ خالصة (بلا تنفيذ ديناميكي):
 *   • معادلة buildDeptEquation مثبتة بترتيب الطرح حرفيًا + هامش الإيراد.
 *   • dispatchValue يجمع approvedValues المعتمدة لا التقديرية.
 *   • أبواب الإضافات والتوليد: مساراتها وأفعالها وحقولها الحرفية.
 *   • Backend: مركز تكلفة القسم في قيدي الصرف والمرتجع، وensureCostCenters
 *     idempotent، ونقطة التوليد بحراسها (عائد/رصيد) وحركاتها وقيدها.
 *   • الشاشة الموحدة مسجلة في التنقل والراوتر والi18n بأيقونتها.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const REPO = path.join(APP, 'js', 'v2', 'data', 'cost-center-repo.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'cost-center.js');
const ACCOUNTING = path.join(__dirname, '..', 'backend', 'accounting-routes.js');
const PRODUCTION = path.join(__dirname, '..', 'backend', 'production-routes.js');
const NAV = path.join(APP, 'js', 'v2', 'layout', 'nav-model.js');
const PREVIEW = path.join(APP, 'js', 'v2', 'preview.js');
const I18N = path.join(APP, 'js', 'core', 'i18n.js');
const APPJS = path.join(APP, 'js', 'app.js');
const SERVER = path.join(__dirname, '..', 'backend', 'server.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('حساب القسم — عقد المعادلة والأبواب', () => {
    const repo = read(REPO);
    const SCREEN_SRC = read(SCREEN);

    test('المعادلة: الإيراد − (الصرف + التوليد) − الإضافات = الصافي، والهامش على الإيراد', () => {
        // ترتيب الطرح حرفيًا في buildDeptEquation — انزياحٌ يستوجب تحديث العقد.
        expect(repo).toMatch(/const cost = \(Number\(dispatchCost\) \|\| 0\) \+ \(Number\(productionCost\) \|\| 0\);/);
        expect(repo).toMatch(/const total = \(Number\(revenue\) \|\| 0\) - cost - \(Number\(additions\) \|\| 0\);/);
        expect(repo).toMatch(/marginPct: \(Number\(revenue\) \|\| 0\) > 0 \? Math\.round\(\(total \/ Number\(revenue\)\) \* 1000\) \/ 10 : null/);
        expect(repo).toMatch(/productionCost: Number\(productionCost\) \|\| 0/);
    });

    test('dispatchValue يجمع approvedValues المعتمدة لا التقديرية', () => {
        expect(repo).toMatch(/export function dispatchValue\(d = \{\}\)/);
        expect(repo).toMatch(/items\.reduce\(\(s, it\) => s \+ \(Number\(it\.approvedValue\) \|\| 0\), 0\)/);
        expect(repo).not.toMatch(/it\.qty/);   // لا قيم تقديرية في الحساب
    });

    test('باب الإضافات: POST/DELETE على /expenses بفئة إضافات قسم وdeptId', () => {
        expect(repo).toMatch(/export async function createDeptAddition/);
        expect(repo).toMatch(/apiFetch\('\/expenses', \{\s*method: 'POST'/);
        expect(repo).toMatch(/deptId: deptCode/);
        expect(repo).toMatch(/category: ADDITION_CATEGORY/);
        expect(repo).toMatch(/export async function deleteDeptAddition\(id\)/);
        expect(repo).toMatch(/apiFetch\(`\/expenses\/\$\{encodeURIComponent\(String\(id\)\)\}`, \{ method: 'DELETE' \}\)/);
        expect(repo).toContain("export const ADDITION_CATEGORY = 'إضافات قسم';");
    });

    test('باب التوليد وسجله: POST /productions بوصفة ودفعات + معلمات فترة/قسم', () => {
        expect(repo).toMatch(/apiFetch\('\/productions', \{[\s\S]{0,120}method: 'POST'/);
        expect(repo).toMatch(/body: JSON\.stringify\(\{ recipeId, batches: Number\(batches\), date, notes \}\)/);
        expect(repo).toMatch(/export async function fetchProductions/);
        expect(repo).toMatch(/params\.set\('dept', dept\)/);
    });

    test('الأذون: نفس باب dispatch-repo بفلتر القسم والنطاق، والقيمة من المعتمد', () => {
        expect(repo).toMatch(/import \{ fetchDispatches, itemsSummary \} from '\.\/dispatch-repo\.js/);
        expect(repo).toMatch(/\.filter\(\(d\) => String\(d\.deptCode \|\| ''\) === String\(deptCode\)\)/);
        expect(repo).toMatch(/fetchDispatches\(scope\)/);
    });

    /* انحدار 2026-10-26: الشاشة كانت تقرأ r.value من صفوف /dispatches،
       والجدول لا يحمل عمود value أصلًا (items / approvedItems فقط) — فكانت
       «كلفة الصرف» وإجمالي الأذون وعمود القيمة صفرًا دائمًا، وصافي القسم
       مبالغًا فيه بكامل كلفة المسحوب. القيمة تُشتق الآن من البنود المعتمدة. */
    test('قيمة الإذن تُشتق للصف: decorateDispatch يضبط value وitemsText من المصدر', () => {
        expect(repo).toMatch(/export function decorateDispatch\(d = \{\}\)/);
        expect(repo).toMatch(/value: dispatchValue\(d\)/);
        expect(repo).toMatch(/itemsText: itemsSummary\(items\)/);
        expect(repo).toMatch(/\.map\(decorateDispatch\)/);
        expect(repo).toMatch(/import \{ fetchDispatches, itemsSummary \} from '\.\/dispatch-repo\.js/);
    });

    test('الأذون المعروضة هي التي حملت كلفة فقط — لا pending/rejected بقيمة صفر', () => {
        expect(repo).toMatch(/export const COSTED_DISPATCH_STATUSES = \['approved', 'received', 'partially_received', 'closed'\]/);
        expect(repo).toMatch(/COSTED_DISPATCH_STATUSES\.includes\(String\(d\.status \|\| ''\)\)/);
    });

    test('الشاشة تستهلك value المدروس ولا تعيد اشتقاقه من حقل غير موجود', () => {
        expect(SCREEN_SRC).toMatch(/reduce\(\(s, r\) => s \+ \(Number\(r\.value\) \|\| 0\), 0\)/);
        expect(SCREEN_SRC).toMatch(/value: \(r\) => r\.value, render: \(r\) => money\(r\.value, currency\)/);
        expect(SCREEN_SRC).toMatch(/esc\(r\.itemsText \|\| '.'\)/);
    });
});

describe('عقد Backend — مراكز التكلفة والتوليد', () => {
    test('قيود الصرف والمرتجع تحمل مركز تكلفة القسم على سطري القيد', () => {
        const src = read(ACCOUNTING);
        expect(src).toMatch(/buildStockMoveLines\(totalValue, direction, costCenter = null\)/);
        expect(src.match(/cost_center_code: costCenter/g)?.length).toBeGreaterThanOrEqual(4);
        expect(src).toMatch(/postDispatchToLedger[\s\S]{0,700}ensureCostCenters\(\[deptCode\]\)/);
        expect(src).toMatch(/postReturnToLedger[\s\S]{0,700}ensureCostCenters\(\[deptCode\]\)/);
        expect(src).toContain('ensureCostCenters,');
    });

    test('ensureCostCenters idempotent: INSERT مع ON CONFLICT DO NOTHING', () => {
        const src = read(ACCOUNTING);
        expect(src).toMatch(/INSERT INTO cost_centers \(code, name_ar\)/);
        expect(src).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    });

    test('نقطة التوليد: حرس الدور + فحص العائد والرصيد + حركات المخزون ومصروف التوليد والقيد بمركز القسم', () => {
        const src = read(PRODUCTION);
        expect(src).toContain('requireRole(...WRITE_ROLES)');
        expect(src).toMatch(/PRODUCTION_NO_YIELD/);
        expect(src).toMatch(/PRODUCTION_STOCK_SHORT/);
        expect(src).toMatch(/PRODUCTION_NO_INGREDIENTS/);
        expect(src).toMatch(/INSERT INTO "inventoryTx"/);
        expect(src).toMatch(/'توليد','production'/);
        expect(src).toMatch(/cost_center_code: cc/);
        expect(src).toMatch(/idempotencyKey: `production:/);
        expect(src).toMatch(/source_type: 'production'/);
        // عشوائية قوية لمعرفات العملية (مراجعة أمنية 2026-10-25)
        expect(src).toContain('crypto.randomBytes');
        expect(src).not.toMatch(/Math\.random/);
    });

    test('نقطة التوليد مركبة على /api/productions في الخادم', () => {
        const server = read(SERVER);
        expect(server).toContain("require('./production-routes')");
        expect(server).toContain("app.use('/api/productions'");
    });
});

describe('عقد الشاشة والتنقل', () => {
    const screen = read(SCREEN);

    test('الشاشة الموحدة: معادلة + أذون + توليد + إضافات + طباعة — بلا جدول بحث مزدوج', () => {
        expect(screen).toContain('data-v2-kpis');
        expect(screen).toContain('buildDeptEquation');
        expect(screen).toContain('data-v2-prod-run');
        expect(screen).toContain('data-v2-add-save');
        expect(screen).toContain('function printAccount');
        expect(screen.match(/search: false/g)?.length).toBe(3);   // الأذون والتوليد والإضافات
        expect(screen).toContain("destroy() {");
    });

    test('التنقل: المفتاح في مجموعة المالية بعنوان عربي وأيقونة مسجلة ومسار راوتر', () => {
        expect(read(NAV)).toMatch(/'cost-center', 'cost-analysis'/);
        expect(read(I18N)).toContain("'cost-center': { icon: 'calculator', ar: 'حساب القسم', en: 'Cost Center' }");
        expect(read(I18N)).toContain("'pg.cost-center': 'حساب القسم'");
        expect(read(PREVIEW)).toContain('mountCostCenterScreen');
        expect(read(PREVIEW)).toMatch(/if \(key === 'cost-center'\)/);
        expect(read(APPJS)).toContain("'cost-center': '<i class=ji data-i=calculator></i>'");
    });

    test('كل استيراد في الشاشة والمستودع بنسخة الصفحة الحية', () => {
        const html = read(path.join(APP, 'v2.html'));
        const rev = (html.match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];
        for (const file of [SCREEN, REPO]) {
            for (const line of read(file).split('\n').filter((l) => /from '\.\.?\//.test(l))) {
                expect(line).toContain(`?v=${rev}`);
            }
        }
    });
});
