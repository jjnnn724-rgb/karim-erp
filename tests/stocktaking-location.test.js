/**
 * stocktaking-location.test.js — جرد كل مخزن على حدة (Task 20)
 * ─────────────────────────────────────────────────────────────
 * يغطي: فلترة لقطة المخزن المختار بالنطاقات الأربعة، دلالة «ذات
 * رصيد» على رصيد المخزن نفسه، الاسم المعروض للمخزن، الفروقات على
 * رصيد الموقع، وحسابات القيمة في معاينة النطاق.
 */

const {
    computeVariance,
    filterSnapshotRows,
    resolveScopeLabel,
    normalizeScopeFilter,
    ensureAuditLocationSchema,
} = require('../backend/stocktaking-routes');

const SNAPSHOT = [
    { item_id: 1, name: 'خس', category: 'خضروات', barcode: 'BC-1', systemQty: 10, avgCost: 3 },
    { item_id: 2, name: 'طماطم', category: 'خضروات', barcode: 'BC-2', systemQty: 0, avgCost: 2.5 },
    { item_id: 3, name: 'فراخ', category: 'لحوم', barcode: 'BC-3', systemQty: 7.5, avgCost: 30 },
    { item_id: 4, name: 'أرز', category: 'جافة', barcode: '', systemQty: 100, avgCost: 4 },
];

describe('فلترة لقطة المخزن المختار', () => {
    test('نطاق الكل يجيب كل صفوف اللقطة', () => {
        expect(filterSnapshotRows(SNAPSHOT, { mode: 'all' })).toHaveLength(4);
    });

    test('«ذات رصيد» تعني رصيد هذا المخزن لا الرصيد العالمي', () => {
        const rows = filterSnapshotRows(SNAPSHOT, { mode: 'in_stock' });
        // الطماطم رصيدها صفر في هذا المخزن رغم أنها قد تكون موجودة في مخازن أخرى
        expect(rows.map(r => r.item_id).sort()).toEqual([1, 3, 4]);
        expect(rows.find(r => r.item_id === 2)).toBeUndefined();
    });

    test('فلتر الفئة يقارن فئة اللقطة على المخزن المختار', () => {
        const rows = filterSnapshotRows(SNAPSHOT, { mode: 'category', category: 'خضروات' });
        expect(rows.map(r => r.item_id).sort()).toEqual([1, 2]);
    });

    test('البحث يطابق الاسم أو الباركود بلا حساسية لحالة الأحرف', () => {
        expect(filterSnapshotRows(SNAPSHOT, { mode: 'search', search: 'فراخ' }).map(r => r.item_id)).toEqual([3]);
        expect(filterSnapshotRows(SNAPSHOT, { mode: 'search', search: 'bc-2' }).map(r => r.item_id)).toEqual([2]);
        expect(filterSnapshotRows(SNAPSHOT, { mode: 'search', search: '  ' })).toHaveLength(4);
    });

    test('إدخال غير صالح يسقط إلى نطاق الكل بأمان', () => {
        expect(filterSnapshotRows(SNAPSHOT, null)).toHaveLength(4);
        expect(filterSnapshotRows(SNAPSHOT, { mode: 'hack', search: 'DROP TABLE' })).toHaveLength(4);
        expect(filterSnapshotRows('not-array', { mode: 'all' })).toEqual([]);
    });
});

describe('اسم المخزن المعروض في التقارير', () => {
    test('اسم الموقع من قاعدة البيانات له الأولوية', () => {
        expect(resolveScopeLabel('STORE-SALADS', { name_ar: 'مخزن قسم السلطات', code: 'STORE-SALADS' })).toBe('مخزن قسم السلطات');
    });

    test('الجلسات القديمة main تظهر باسم المخزن الرئيسي', () => {
        expect(resolveScopeLabel('main', null)).toBe('المخزن الرئيسي');
        expect(resolveScopeLabel(null, null)).toBe('المخزن الرئيسي');
    });

    test('كود غير معروف يظهر كما هو بدل الفشل', () => {
        expect(resolveScopeLabel('STORE-X', null)).toBe('STORE-X');
    });
});

describe('فروقات الجرد على رصيد الموقع', () => {
    test('عجز في مخزن القسم يقارن رصيد الموقع لا العالمي', () => {
        // اللقطة: رصيد المخزن 10 — العد الفعلي 6 → عجز 4 بقيمة التكلفة
        const { varianceQty, varianceValue } = computeVariance(6, 10, 3);
        expect(varianceQty).toBe(-4);
        expect(varianceValue).toBe(-12);
    });

    test('زيادة في المخزن المختار تحسب على رصيده هو', () => {
        const { varianceQty, varianceValue } = computeVariance(9, 7.5, 30);
        expect(varianceQty).toBe(1.5);
        expect(varianceValue).toBe(45);
    });

    test('الصنف الغائب من المخزن (رصيد 0) عدّه فعلياً يعني زيادة كاملة', () => {
        const { varianceQty } = computeVariance(5, 0, 2);
        expect(varianceQty).toBe(5);
    });
});

describe('معاينة النطاق الحية', () => {
    test('قيمة المعاينة = مجموع (الرصيد الموجب × التكلفة) بعد الفلترة', () => {
        const rows = filterSnapshotRows(SNAPSHOT, { mode: 'all' });
        const value = rows.reduce((s, r) => s + (Math.max(Number(r.systemQty), 0) * Number(r.avgCost || 0)), 0);
        expect(value).toBeCloseTo(10 * 3 + 7.5 * 30 + 100 * 4, 2);
    });

    test('مخطط عمود location_id مُعد ذاتياً (دالة الترقية موجودة)', () => {
        expect(typeof ensureAuditLocationSchema).toBe('function');
    });

    test('تطبيع النطاق يبقي الأنماط الأربعة فقط', () => {
        expect(normalizeScopeFilter({ mode: 'in_stock' }).mode).toBe('in_stock');
        expect(normalizeScopeFilter({ mode: 'other' }).mode).toBe('all');
    });
});
