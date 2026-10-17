/**
 * v2-write-flags.test.js — عقد أعلام كتابة P1 (OFF افتراضيًا)
 * ═══════════════════════════════════════════════════════════════════════
 * عقد الإكمال (ص 80): كل كيان علمه المستقل، ولا يُفعَّل قبل عيّنة rollback.
 * المثبَّت: غياب العلم = لا أزرار كتابة؛ والـURL يغلب المخزّن؛ والخادم يبقى
 * الحاكم (الشاشات لا تستورد الكتابة إلا وراء الدور + العلم).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const FLAGS = path.join(V2, 'write-flags.js');
const SCREENS = ['revenues', 'expenses', 'recipes']
    .map((f) => path.join(V2, 'screens', `${f}.js`));

const read = (p) => fs.readFileSync(p, 'utf8');

function loadFlags() {
    const src = read(FLAGS).replace(/^export\s+/gm, '');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: FLAGS });
    return ctx;
}

const store = (value) => ({ getItem: () => value });
const throwingStore = { getItem: () => { throw new Error('denied'); } };

describe('write-flags — الافتراضي مغلق', () => {
    const ctx = loadFlags();

    test('غياب الـURL والمخزّن = OFF للأعلام الثلاثة عشر', () => {
        expect(ctx.financeWriteEnabled('', null)).toBe(false);
        expect(ctx.recipeWriteEnabled('', null)).toBe(false);
        expect(ctx.departmentWriteEnabled('', null)).toBe(false);
        expect(ctx.hrDepartmentWriteEnabled('', null)).toBe(false);
        expect(ctx.shelfWriteEnabled('', null)).toBe(false);
        expect(ctx.weightWriteEnabled('', null)).toBe(false);
        expect(ctx.zkWriteEnabled('', null)).toBe(false);
        expect(ctx.portalWriteEnabled('', null)).toBe(false);
        expect(ctx.faceWriteEnabled('', null)).toBe(false);
        expect(ctx.fiscalWriteEnabled('', null)).toBe(false);
        expect(ctx.invoiceVoidWriteEnabled('', null)).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('', null)).toBe(false);
        expect(ctx.bulkImportWriteEnabled('', null)).toBe(false);
        expect(ctx.financeWriteEnabled(undefined, null)).toBe(false);
    });

    test('المخزّن وحده يفتح للـstaging، والقراءة الممنوعة لا ترمي', () => {
        expect(ctx.financeWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.recipeWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.departmentWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.hrDepartmentWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.shelfWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.weightWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.zkWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.portalWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.faceWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.fiscalWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.invoiceVoidWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.invoiceVoidWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.invoiceVoidWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.invoiceCreateWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.bulkImportWriteEnabled('', store('1'))).toBe(true);
        expect(ctx.bulkImportWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.bulkImportWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.financeWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.portalWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.faceWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.fiscalWriteEnabled('', store('0'))).toBe(false);
        expect(ctx.financeWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.portalWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.faceWriteEnabled('', throwingStore)).toBe(false);
        expect(ctx.fiscalWriteEnabled('', throwingStore)).toBe(false);
    });

    test('?flag=1 يفتح و=0 يغلب المخزّن المفتوح', () => {
        expect(ctx.financeWriteEnabled('?v2financewrite=1', null)).toBe(true);
        expect(ctx.financeWriteEnabled('?x=1&v2financewrite=1', null)).toBe(true);
        expect(ctx.financeWriteEnabled('?v2financewrite=0', store('1'))).toBe(false);
        expect(ctx.recipeWriteEnabled('?v2recipewrite=1', null)).toBe(true);
        expect(ctx.recipeWriteEnabled('?v2recipewrite=0', store('1'))).toBe(false);
        expect(ctx.departmentWriteEnabled('?v2deptwrite=1', null)).toBe(true);
        expect(ctx.departmentWriteEnabled('?v2deptwrite=0', store('1'))).toBe(false);
        expect(ctx.hrDepartmentWriteEnabled('?v2hrdeptwrite=1', null)).toBe(true);
        expect(ctx.hrDepartmentWriteEnabled('?v2hrdeptwrite=0', store('1'))).toBe(false);
        expect(ctx.shelfWriteEnabled('?v2shelfwrite=1', null)).toBe(true);
        expect(ctx.shelfWriteEnabled('?v2shelfwrite=0', store('1'))).toBe(false);
        expect(ctx.weightWriteEnabled('?v2weightwrite=1', null)).toBe(true);
        expect(ctx.weightWriteEnabled('?v2weightwrite=0', store('1'))).toBe(false);
        expect(ctx.zkWriteEnabled('?v2zkwrite=1', null)).toBe(true);
        expect(ctx.zkWriteEnabled('?v2zkwrite=0', store('1'))).toBe(false);
        expect(ctx.portalWriteEnabled('?v2portalwrite=1', null)).toBe(true);
        expect(ctx.portalWriteEnabled('?v2portalwrite=0', store('1'))).toBe(false);
        expect(ctx.faceWriteEnabled('?v2facewrite=1', null)).toBe(true);
        expect(ctx.faceWriteEnabled('?v2facewrite=0', store('1'))).toBe(false);
        expect(ctx.fiscalWriteEnabled('?v2fiscalwrite=1', null)).toBe(true);
        expect(ctx.fiscalWriteEnabled('?v2fiscalwrite=0', store('1'))).toBe(false);
        expect(ctx.invoiceVoidWriteEnabled('?v2invoicevoid=1', null)).toBe(true);
        expect(ctx.invoiceVoidWriteEnabled('?v2invoicevoid=0', store('1'))).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('?v2invoicecreate=1', null)).toBe(true);
        expect(ctx.invoiceCreateWriteEnabled('?v2invoicecreate=0', store('1'))).toBe(false);
        expect(ctx.bulkImportWriteEnabled('?v2bulkimport=1', null)).toBe(true);
        expect(ctx.bulkImportWriteEnabled('?v2bulkimport=0', store('1'))).toBe(false);
    });

    test('كل علم لا يفتح الآخر', () => {
        expect(ctx.financeWriteEnabled('?v2recipewrite=1&v2deptwrite=1&v2hrdeptwrite=1&v2shelfwrite=1&v2weightwrite=1&v2zkwrite=1', null)).toBe(false);
        expect(ctx.recipeWriteEnabled('?v2financewrite=1', null)).toBe(false);
        expect(ctx.departmentWriteEnabled('?v2hrdeptwrite=1', null)).toBe(false);
        expect(ctx.hrDepartmentWriteEnabled('?v2deptwrite=1', null)).toBe(false);
        expect(ctx.shelfWriteEnabled('?v2weightwrite=1&v2financewrite=1', null)).toBe(false);
        expect(ctx.weightWriteEnabled('?v2shelfwrite=1&v2recipewrite=1', null)).toBe(false);
        expect(ctx.zkWriteEnabled('?v2financewrite=1&v2shelfwrite=1&v2weightwrite=1', null)).toBe(false);
        expect(ctx.portalWriteEnabled('?v2facewrite=1&v2zkwrite=1', null)).toBe(false);
        expect(ctx.faceWriteEnabled('?v2portalwrite=1&v2zkwrite=1', null)).toBe(false);
        expect(ctx.fiscalWriteEnabled('?v2financewrite=1&v2zkwrite=1&v2facewrite=1', null)).toBe(false);
        expect(ctx.invoiceVoidWriteEnabled('?v2financewrite=1&v2fiscalwrite=1', null)).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('?v2invoicevoid=1&v2financewrite=1', null)).toBe(false);
        expect(ctx.bulkImportWriteEnabled('?v2invoicecreate=1&v2invoicevoid=1&v2financewrite=1', null)).toBe(false);
        expect(ctx.invoiceCreateWriteEnabled('?v2bulkimport=1', null)).toBe(false);
    });
});

describe('الشاشات — الدور والعلم معًا', () => {
    test('15/16: writable = canWrite && financeWriteEnabled', () => {
        for (const f of SCREENS.slice(0, 2)) {
            const s = read(f);
            expect(s).toMatch(/import \{ financeWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
            expect(s).toMatch(/canWrite\(ctx\.role, FINANCE_WRITE_ROLES\) && financeWriteEnabled\(\)/);
        }
    });

    test('الوصفات: التعديل والمكوّنات كلاهما وراء recipeWriteEnabled', () => {
        const s = read(SCREENS[2]);
        expect(s).toMatch(/import \{ recipeWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(s).toMatch(/const writesOpen = recipeWriteEnabled\(\)/);
        expect(s).toMatch(/const canEdit = canWrite\(ctx\.role, RECIPE_WRITE_ROLES\) && writesOpen/);
        expect(s).toMatch(/const canBom = canWrite\(ctx\.role, RECIPE_BOM_ROLES\) && writesOpen/);
    });

    test('P2-5: الرفوف والميزان — كل كتابة وراء علمها ودورها', () => {
        const shelves = read(path.join(V2, 'screens', 'shelves.js'));
        expect(shelves).toMatch(/import \{ shelfWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(shelves).toMatch(/canWrite\(ctx\.role, SHELF_WRITE_ROLES\) && shelfWriteEnabled\(\)/);

        const weight = read(path.join(V2, 'screens', 'weight.js'));
        expect(weight).toMatch(/import \{ weightWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        // كتابة القراءة: دور weightReadings + العلم.
        expect(weight).toMatch(/canWrite\(ctx\.role, WEIGHT_WRITE_ROLES\) && weightWriteEnabled\(\)/);
        // إضافة الوزن لصنف تكتب inventory أيضًا: خريطة دور ثانية فوق الاثنين.
        expect(weight).toMatch(/const canAdd = writable && canWrite\(ctx\.role, WEIGHT_INVENTORY_ROLES\)/);
    });

    test('P2-2: البصمة — كل كتابة وراء العلم والدور معًا', () => {
        const zk = read(path.join(V2, 'screens', 'zkteco.js'));
        expect(zk).toMatch(/import \{ zkWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(zk).toMatch(/canWrite\(ctx\.role, ZK_WRITE_ROLES\) && zkWriteEnabled\(\)/);
    });

    test('P2-3: البوابة — علم البصمة وعلم الوجه مستقلان فوق الدور', () => {
        const portal = read(path.join(V2, 'screens', 'employee-portal.js'));
        expect(portal).toMatch(/import \{ portalWriteEnabled, faceWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(portal).toMatch(/canWrite\(ctx\.role, PUNCH_ROLES\) && portalWriteEnabled\(\)/);
        expect(portal).toMatch(/canWrite\(ctx\.role, FACE_ENROLL_ROLES\) && faceWriteEnabled\(\)/);
    });

    test('ذيل P1-4: إلغاء فاتورة الشراء لأدمن + علم مستقل', () => {
        const inv = read(path.join(V2, 'screens', 'invoices.js'));
        expect(inv).toMatch(/import \{ invoiceVoidWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(inv).toMatch(/canWrite\(ctx\.role, INVOICE_VOID_ROLES\) && invoiceVoidWriteEnabled\(\)/);
    });

    test('26c-2: إنشاء/تعديل فاتورة الشراء بدورها + علم مستقل ثانٍ', () => {
        const whi = read(path.join(V2, 'screens', 'wh-invoices.js'));
        expect(whi).toMatch(/import \{ invoiceCreateWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(whi).toMatch(/canWrite\(ctx\.role, INVOICE_CREATE_ROLES\) && invoiceCreateWriteEnabled\(\)/);
        // العلمان لا يفتح أحدهما الآخر (اختبار الدالة أعلاه)، ولا يُقرأ أحدهما يدويًا هنا.
        expect(whi).not.toMatch(/invoiceVoidWriteEnabled/);
    });

    test('P2-4: حوكمة المخزن — الإنشاء والإقفال وراء العلم والدور', () => {
        const gov = read(path.join(V2, 'screens', 'warehouse-gov.js'));
        expect(gov).toMatch(/import \{ fiscalWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(gov).toMatch(/const fiscalWrite = fiscalWriteEnabled\(\);/);
        expect(gov).toMatch(/canWrite\(role, FISCAL_CREATE_ROLES\) && fiscalWrite/);
        expect(gov).toMatch(/canWrite\(role, FISCAL_CLOSE_ROLES\) && fiscalWrite/);
    });

    test('26د: الاستيراد الجماعي — العلم والدور معًا في الشاشتين', () => {
        const users = read(path.join(V2, 'screens', 'users.js'));
        expect(users).toMatch(/import \{ bulkImportWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(users).toMatch(/const canBulk = canAdmin && bulkImportWriteEnabled\(\)/);
        expect(users).toMatch(/data-v2-bulk/);
        expect(users).toMatch(/mountBulkImportWizard/);

        const employees = read(path.join(V2, 'screens', 'employees.js'));
        expect(employees).toMatch(/import \{ bulkImportWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(employees).toMatch(/const canBulkImport = isAdmin && bulkImportWriteEnabled\(\)/);
        expect(employees).toMatch(/kind === 'bulk' && canBulkImport/);
        expect(employees).toMatch(/mountBulkImportWizard/);
    });

    test('لا نسخة ثانية من منطق العلم داخل الشاشات', () => {
        const all = SCREENS.concat(['departments', 'hr-departments', 'shelves', 'weight', 'zkteco', 'employee-portal', 'warehouse-gov', 'invoices', 'wh-invoices', 'users', 'employees']
            .map((f) => path.join(V2, 'screens', `${f}.js`)));
        for (const f of all) {
            const s = read(f);
            expect(s).not.toMatch(/localStorage\.getItem\(['"]karim_v2_/);
            expect(s).not.toMatch(/match\(\/\^.*v2financewrite/);
        }
    });
});
