/**
 * v2-dept-signals.test.js — معلومات الأعمال داخل بطاقة القسم (V2)
 * ═════════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-19: «معلومات مفيدة في كل بطاقة قسم». المثبّت هنا:
 *   1) النموذج الخالص deptSignalsOf: يعدّ الأصناف من recipes.deptId،
 *      والموظفين من employees.department، وأذون الصرف من dispatches.deptCode —
 *      بمقارنةٍ نصّية على كود القسم، ويتجاهل قسمًا آخر.
 *   2) deptSignalTotals: مجموع الأصناف/الموظفين لأقسام السجل وحدها.
 *   3) الشاشة: تستورد الأبواب القائمة (لا شبكة مباشرة)، وترسم الشرائح،
 *      ومؤشراتها تحمل معلومات أعمال لا عدًّا هيكليًا فقط.
 *   4) ليست هناك إضافةٌ للخادم ولا للسكيمًا: قراءةٌ من أبوابٍ قائمة فقط.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const SIGNALS = path.join(APP, 'js', 'v2', 'data', 'dept-signals.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'departments.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-departments.css');

const read = (p) => fs.readFileSync(p, 'utf8');

/** تحميل النموذج الخالص: تجريد `export ` ثم إرجاع الدوال المسمّاة. */
function loadSignals() {
    const src = read(SIGNALS).replace(/^export\s+function/gm, 'function');
    const names = [...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    return new Function(`${src}\nreturn {${names.join(',')}};`)();
}

const s = loadSignals();

const RECIPES = [
    { id: 1, name: 'latte', deptId: 'CAF' },
    { id: 2, name: 'cake', deptId: 'CAF' },
    { id: 3, name: 'steak', deptId: 'kitchen' },
    { id: 4, name: 'orphan', deptId: '' },
];
const STAFF = [
    { id: 1, name: 'أ', department: 'CAF', status: 'active' },
    { id: 2, name: 'ب', department: 'CAF', status: 'active' },
    { id: 3, name: 'ج', department: 'kitchen', status: 'active' },
    { id: 4, name: 'د', department: 'ghost', status: 'active' },
];
const DISPATCHES = [
    { id: 1, deptCode: 'CAF', status: 'pending', date: '2026-10-01' },
    { id: 2, deptCode: 'CAF', status: 'received', date: '2026-10-15' },
    { id: 3, deptCode: 'CAF', status: 'pending', date: '2026-09-30' },
    { id: 4, deptCode: 'kitchen', status: 'approved', date: '2026-10-10' },
];

describe('١) deptSignalsOf — العدّ من كود القسم نفسه', () => {
    test('الكافيه: صنفان وموظفان وإذنان معلّقان وآخر صرف 2026-10-15', () => {
        expect(s.deptSignalsOf('CAF', RECIPES, STAFF, DISPATCHES)).toEqual({
            itemCount: 2, staffCount: 2, pending: 2, last: '2026-10-15',
        });
    });

    test('المطبخ: صنف واحد وموظف واحد وصفر معلّق وآخر صرف 2026-10-10', () => {
        expect(s.deptSignalsOf('kitchen', RECIPES, STAFF, DISPATCHES)).toEqual({
            itemCount: 1, staffCount: 1, pending: 0, last: '2026-10-10',
        });
    });

    test('قسمٌ بلا بيانات: أصفارٌ وفراغ لا انفجار', () => {
        expect(s.deptSignalsOf('empty', RECIPES, STAFF, DISPATCHES)).toEqual({
            itemCount: 0, staffCount: 0, pending: 0, last: '',
        });
    });

    test('لا يخلط قسمًا بآخر: كود «CA» لا يطابق «CAF»', () => {
        expect(s.deptSignalsOf('CA', RECIPES, STAFF, DISPATCHES)).toEqual({
            itemCount: 0, staffCount: 0, pending: 0, last: '',
        });
    });

    test('صفوفٌ ناقصة/فارغة لا تُسقط العدّ (تسامح الحقول)', () => {
        expect(s.deptSignalsOf('CAF', [null, {}, { deptId: 'CAF' }], [null, {}], [null, {}])).toEqual({
            itemCount: 1, staffCount: 0, pending: 0, last: '',
        });
    });

    test('التاريخ يُقصّ إلى YYYY-MM-DD مهما جاء بطابع زمني', () => {
        const rows = [{ deptCode: 'CAF', status: 'pending', date: '2026-10-19T23:59:59.000Z' }];
        expect(s.deptSignalsOf('CAF', [], [], rows).last).toBe('2026-10-19');
    });
});

describe('٢) deptSignalTotals — مجموع السجل وحده', () => {
    const DEPTS = [{ code: 'CAF' }, { code: 'kitchen' }];

    test('يعدّ الأصناف والموظفين المسندين لأقسام السجل، ويترك الغرباء', () => {
        expect(s.deptSignalTotals(DEPTS, RECIPES, STAFF)).toEqual({ items: 3, people: 3 });
    });

    test('سجلٌ فارغ = صفران', () => {
        expect(s.deptSignalTotals([], RECIPES, STAFF)).toEqual({ items: 0, people: 0 });
    });
});

describe('٣) عقد الشاشة — أبوابٌ قائمة وشرائح حقيقية', () => {
    const screen = read(SCREEN);
    const css = read(CSS);

    test('تستورد أبواب القراءة القائمة، ولا fetch مباشرًا', () => {
        for (const door of ['fetchEmployees', 'fetchRecipes', 'fetchDispatches', 'deptSignalsOf', 'deptSignalTotals']) {
            expect(screen).toContain(door);
        }
        expect(screen).not.toMatch(/\bapiFetch\s*\(/);
        expect(screen).not.toMatch(/[^.\w]fetch\s*\(/);
    });

    test('البطاقة ترسم شرائح المعلومات داخل deptCardHtml', () => {
        expect(screen).toMatch(/function deptSignalsHtml\(code\)/);
        expect(screen).toMatch(/\+ deptSignalsHtml\(code\)/);
        expect(screen).toMatch(/erp-dept-card__signals/);
        expect(screen).toMatch(/erp-dept-signal/);
    });

    test('المؤشرات العلوية تحمل معلومات أعمال لا عدًّا هيكليًا فقط', () => {
        for (const label of ['إجمالي الإيراد', 'إجمالي المصروف', 'صافي الربح', 'الموظفون', 'الأصناف', 'أذون معلّقة']) {
            expect(screen).toContain(label);
        }
        expect(screen).toMatch(/deptSignalTotals\(rows, recipes, staff\)/);
    });

    test('كل مصدرٍ يُفشَّل وحده: catch يعيد [] فلا يُسقط السجل', () => {
        expect(screen).toMatch(/fetchEmployees\(\)\.catch\(\(\) => \[\]\)/);
        expect(screen).toMatch(/fetchRecipes\(\)\.catch\(\(\) => \[\]\)/);
        expect(screen).toMatch(/fetchDispatches\(\)\.catch\(\(\) => \[\]\)/);
        expect(screen).toMatch(/paintKpis\(\);/);
    });

    test('CSS: شرائح المعلومات مقيّدة بجذر erp-v2 وبلا لونٍ حرفي', () => {
        expect(css).toMatch(/\.erp-v2 \.erp-dept-card__signals/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-signal\b/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-signal\.is-alert/);
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^.*@supports.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
        expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(stripped).not.toMatch(/\brgba?\(\s*[\d.]/);
        expect(stripped).not.toMatch(/\bhsla?\(\s*[\d.]/);
    });
});
