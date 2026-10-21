/**
 * v2-invoice-create-flag.test.js — «إضافة فواتير» ظاهرة افتراضيًا
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-20: زرّ «فاتورة شراء جديدة» وظيفةٌ أساسية لا ميزة
 * staging، فيُعرض بلا مفتاح. المثبَّت هنا:
 *   ١) الغياب = ظاهر (query وstorage فارغان).
 *   ٢) `?v2invoicecreate=0` أو المخزّن '0' يُخفيه — والـURL يغلب المخزّن.
 *   ٣) بقية أعلام الكتابة تبقى OFF افتراضيًا (لا انفتاح بالخطأ).
 *   ٤) الشاشة تقرن العلم بالدور وتربط الزر بالنموذج.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const FLAGS = path.join(V2, 'write-flags.js');
const SCREEN = path.join(V2, 'screens', 'wh-invoices.js');

function loadFlags() {
    const src = fs.readFileSync(FLAGS, 'utf8').replace(/^export\s+/gm, '');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: FLAGS });
    return ctx;
}

const store = (value) => ({ getItem: () => value });
const F = loadFlags();

describe('علم إنشاء فواتير الشراء — ظاهر افتراضيًا', () => {
    test('غياب الـquery والمخزّن = ظاهر', () => {
        expect(F.invoiceCreateWriteEnabled('', store(null))).toBe(true);
        expect(F.invoiceCreateWriteEnabled('?x=1', store(null))).toBe(true);
        expect(F.invoiceCreateWriteEnabled('', null)).toBe(true);
    });

    test('=0 يُخفيه (query أو مخزّن)، والـquery يغلب المخزّن', () => {
        expect(F.invoiceCreateWriteEnabled('?v2invoicecreate=0', store('1'))).toBe(false);
        expect(F.invoiceCreateWriteEnabled('', store('0'))).toBe(false);
        expect(F.invoiceCreateWriteEnabled('?v2invoicecreate=1', store('0'))).toBe(true);
    });

    test('بقية أعلام الكتابة تبقى OFF افتراضيًا', () => {
        expect(F.invoiceVoidWriteEnabled('', null)).toBe(false);
        expect(F.financeWriteEnabled('', null)).toBe(false);
        expect(F.departmentWriteEnabled('', null)).toBe(false);
        expect(F.chatWriteEnabled('', null)).toBe(false);
        /* الاستثناءان المُقرّان: الأقسام-كاشير وفواتير الشراء فقط */
        expect(F.deptCashierWriteEnabled('', null)).toBe(true);
    });
});

describe('ربط الشاشة — الدور + العلم + الزر', () => {
    const screen = fs.readFileSync(SCREEN, 'utf8');

    test('الإنشاء مقيّد بالأدوار الثلاثة وبالعلم معًا', () => {
        expect(screen).toMatch(/const canCreate = canWrite\(ctx\.role, INVOICE_CREATE_ROLES\) && invoiceCreateWriteEnabled\(\);/);
        expect(screen).toMatch(/data-v2-new/);
        expect(screen).toMatch(/فاتورة شراء جديدة/);
    });

    test('نص الشاشة لا يدّعي أن الزر مطفأ افتراضيًا', () => {
        expect(screen).not.toMatch(/v2invoicecreate<\/span>\s*\(OFF/);
        expect(screen).toContain('?v2invoicecreate=0');
    });
});
