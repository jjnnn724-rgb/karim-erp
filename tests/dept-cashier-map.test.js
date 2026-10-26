// ────────────────────────────────────────────────────────────────────────────
// dept-cashier-map.test.js — طلب المالك 2026-10-05
// «إيرادات كاشير 1 في قسم الكافي… 4 و5 البيع الخارجي… 9 الاوبن بوفيه… 6 العصير»
// يقيّم مصدر departments.js الحقيقي (نفس ما يُشغَّل في المتصفح) ويفحص دوال
// الخريطة والتجميع النقية: إيراد الكاشير يُجمع على بطاقة قسمه بلا تحريك بيانات.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'departments.js'), 'utf8')
    // نزيل سطر التصدير ليوافق صياغة CommonJS داخل المُقيِّم
    .replace(/export\s*\{[^}]*\};?/, '');

/** يبني مثيل الدوال النقية بحقن STATE و deptWithChildren بدل الاعتماد على نافذة المتصفح */
function build(STATE, deptChildren) {
    const factory = new Function('STATE', 'deptWithChildren', SRC +
        '\nreturn { CASHIER_DEPT_MAP, deptMappedCashiers, cashierRevenueIn, deptCashierRevenue, deptIdentityColor };');
    return factory(STATE, deptChildren);
}

function rev(deptId, amount, date) { return { deptId, amount, date, source: 'كاشير' }; }

describe('CASHIER_DEPT_MAP — ربط كاشيرات يارا سوفت بالأقسام (طلب المالك 2026-10-05)', () => {
    const STATE = { revenues: [], departments: [] };
    const m = build(STATE, () => new Set());

    test('الربط مطابق لطلب المالك حرفيًا', () => {
        expect(m.CASHIER_DEPT_MAP['1']).toBe('CAF');              // كاشير 1 → الكافيه
        expect(m.CASHIER_DEPT_MAP['4']).toBe('external_sales');   // كاشير 4 → البيع الخارجي
        expect(m.CASHIER_DEPT_MAP['5']).toBe('external_sales');   // كاشير 5 → البيع الخارجي
        expect(m.CASHIER_DEPT_MAP['6']).toBe('G');                // كاشير 6 → العصير
        expect(m.CASHIER_DEPT_MAP['9']).toBe('open_buffet');      // كاشير 9 → الأوبن بوفيه
    });

    test('كاشير 4 و5 معًا لقسم البيع الخارجي — والكاشير غير المربوط لا يُسند لأي قسم', () => {
        expect(m.deptMappedCashiers('external_sales').sort()).toEqual(['4', '5']);
        expect(m.deptMappedCashiers('kitchen')).toEqual([]);
        expect(m.deptMappedCashiers('ys_cc_2')).toEqual([]); // كاشير 2 مخفي من الحسابات — بلا قسم
    });
});

describe('cashierRevenueIn — جمع إيراد الكاشير الخام (ys_cc_N) بحدوده الزمنية', () => {
    const STATE = { revenues: [
        rev('ys_cc_1', 100, '2026-10-01'),
        rev('ys_cc_1', 50, '2026-10-05'),
        rev('ys_cc_4', 200, '2026-10-05'),
        rev('ys_cc_5', 30, '2026-10-04'),
        rev('ys_cc_2', 999, '2026-10-05'), // كاشير خارج الحسابات
        rev('CAF', 77, '2026-10-05'),      // إيراد مباشر للقسم لا يُعد إيراد كاشير
    ], departments: [] };
    const m = build(STATE, () => new Set());

    test('يجمع كل الكاشيرات المطلوبة فقط', () => {
        expect(m.cashierRevenueIn(STATE.revenues, ['1'])).toBe(150);
        expect(m.cashierRevenueIn(STATE.revenues, ['4', '5'])).toBe(230);
    });

    test('حدود التاريخ من/إلى تُحترم', () => {
        expect(m.cashierRevenueIn(STATE.revenues, ['1'], '2026-10-05', '2026-10-05')).toBe(50);
        expect(m.cashierRevenueIn(STATE.revenues, ['1'], '2026-10-02', '2026-10-03')).toBe(0);
    });

    test('لا يلتقط أكوادًا غير مربوطة ولا إيراد القسم المباشر', () => {
        expect(m.cashierRevenueIn(STATE.revenues, ['2'])).toBe(999); // الطلب الصريح يُسمع
        expect(m.cashierRevenueIn(STATE.revenues, ['4', '5'])).toBe(230); // بلا CAF
    });
});

describe('deptCashierRevenue — إيراد الكاشير المسند لبطاقة القسم (يشمل الأقسام الفرعية)', () => {
    const STATE = { revenues: [
        rev('ys_cc_9', 500, '2026-10-05'),  // كاشير 9 → open_buffet (فرع للمطبخ)
        rev('ys_cc_1', 100, '2026-10-05'),  // كاشير 1 → CAF (فرع للمطبخ)
        rev('ys_cc_6', 60, '2026-10-05'),   // كاشير 6 → G (فرع للمطبخ)
        rev('ys_cc_4', 200, '2026-10-05'),  // كاشير 4 → external_sales (خارج شجرة المطبخ)
        rev('ys_cc_2', 777, '2026-10-05'),  // غير مربوط
    ], departments: [] };
    const kitchenTree = new Set(['kitchen', 'open_buffet', 'CAF', 'G', 'salads']);
    const m = build(STATE, (code) => (code === 'kitchen' ? kitchenTree : new Set([String(code)])));

    test('بطاقة الأوبن بوفيه تجمع كاشير 9', () => {
        expect(m.deptCashierRevenue('open_buffet')).toBe(500);
    });

    test('بطاقة الكافيه تجمع كاشير 1، والعصير كاشير 6', () => {
        expect(m.deptCashierRevenue('CAF')).toBe(100);
        expect(m.deptCashierRevenue('G')).toBe(60);
    });

    test('البيع الخارجي (فرع بلا أبناء في المثال) يجمع كاشيري 4 و5 ولا يشمل شجرة المطبخ', () => {
        expect(m.deptCashierRevenue('external_sales')).toBe(200);
    });

    test('البطاقة التجميعية للمطبخ تجمع كاشيرات كل أقسامها (9+1+6) دون غيرها', () => {
        expect(m.deptCashierRevenue('kitchen')).toBe(660);
    });
});

describe('deptIdentityColor — هوية لونية آمنة للبطاقات (لا لون مكسور أبدًا)', () => {
    const m = build({ revenues: [], departments: [] }, () => new Set());

    test('اللون المسجل في القاعدة يُستخدم كما هو', () => {
        expect(m.deptIdentityColor({ color: '#673ab7' })).toBe('#673ab7');
        expect(m.deptIdentityColor({ color: ' #2196F3 ' })).toBe('#2196F3');
    });

    test('اللون الغيّر أو غير الصالح → الافتراضي الذهبي (حماية من لون 3 خانات أو نص)', () => {
        expect(m.deptIdentityColor({})).toBe('#D4A843');
        expect(m.deptIdentityColor({ color: '#abc' })).toBe('#D4A843');
        expect(m.deptIdentityColor({ color: 'chef-hat' })).toBe('#D4A843');
        expect(m.deptIdentityColor(null)).toBe('#D4A843');
    });
});
