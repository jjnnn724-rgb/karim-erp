/**
 * fullchain-regression.test.js — قيود انحدار لسلسلة المخزون الكاملة
 * ───────────────────────────────────────────────────────────────────────
 * يثبّت إصلاحات اكتشفها الفحص الحي الشامل (من دخول البضاعة المخزن حتى الزبون):
 *
 *  1) ازدواج المخزون عند الإرجاع: إذن صرف استلمه القسم كان يُرجع للوزن
 *     الرئيسي دون خصم مخزن القسم — فتبقى الكمية محتسبة في الموضعين معًا
 *     (زيادة وهمية في الرصيد العام). الإصلاح: قيد مقترن transfer_out على
 *     مخزن القسم قبل قيد return للمخزن الرئيسي، بشرط وجود استلام مسجل.
 *
 *  2) سياسات المطبخ: Number(null) = 0 كانت تجتاز Number.isInteger فتنشئ
 *     سياسة شبح على قسم غير موجود. الإصلاح: حارس >0 + تحقق وجود القسم.
 *
 *  3) إرجاع كمية استُهلكت فعلًا: رصيد مخزن القسم لا يكفي → 409 واضح
 *     بدل 500 عام.
 *
 * ملاحظة: السلوك الكامل (الأرصدة، الليدجر، المصروفات) مغطى بالفحص الحي
 * scripts/live_fullchain_audit.py (77 فحصًا) — هذه الاختبارات تقفل الشيفرة
 * ضد أي انحدار يُبطل الإصلاحات.
 */

const fs = require('fs');
const path = require('path');

const warehouseSrc = fs.readFileSync(path.resolve(__dirname, '../backend/warehouse-routes.js'), 'utf8');
const kitchenSrc = fs.readFileSync(path.resolve(__dirname, '../backend/kitchen-production-routes.js'), 'utf8');

describe('إرجاع القسم للمخزن — لا ازدواج في المخزون', () => {
    test('قيد الخروج من مخزن القسم مقترن بشرط الاستلام', () => {
        // الحارس: لا يُخصم مخزن القسم إلا إذا كان هناك استلام مسجل فعلاً
        expect(warehouseSrc).toContain('if (receivedByName.size) {');
        // Task 19: مخزن القسم يُستنتج من إذن الصرف نفسه (مخازن الأقسام الخاصة) لا مخزن المطبخ الثابت
        expect(warehouseSrc).toContain('const deptLocation = await getDispatchTargetLocation(client, dispatch.deptCode);');
        // القيد المقترن: transfer_out من مخزن القسم بمفتاح idempotency :out
        expect(warehouseSrc).toContain("transactionType: 'transfer_out', inventoryId: Number(inv.id), locationId: deptLocation.id");
        expect(warehouseSrc).toContain('idempotencyKey: `dispatch-return:${returnId}:${inv.id}:out`');
        // قيد الدخول للمخزن الرئيسي يبقى return بالمفتاح الأصلي (بدون لاحقة — توافقًا مع المفتاح التاريخي)
        expect(warehouseSrc).toContain("transactionType: 'return', inventoryId: Number(inv.id), locationId: mainLocation.id");
        expect(warehouseSrc).toContain('idempotencyKey: `dispatch-return:${returnId}:${inv.id}`');
    });

    test('مفتاحا القيدين مختلفان فلا يلغي أحدهما الآخر بالـ replay', () => {
        const keys = [...new Set(warehouseSrc.match(/dispatch-return:\$\{returnId\}:\$\{inv\.id\}[^\s`]*/g) || [])];
        expect(keys.length).toBe(2); // «...:out» و «...» — قيدان مستقلان
    });

    test('الإرجاع الأكبر من رصيد مخزن القسم → 409 وليس 500', () => {
        expect(warehouseSrc).toContain("error.code === 'INSUFFICIENT_STOCK'");
        expect(warehouseSrc).toContain("رصيد مخزن القسم لا يكفي لإرجاع هذه الكمية");
    });

    test('شرط الاستلام يعتمد على receivedItems المسجلة لا على الحالة فقط', () => {
        // receivedByName تُبنى من dispatch.receivedItems — مصدر الحقيقة الفعلي للاستلام
        expect(warehouseSrc).toMatch(/const receivedByName = new Map\(receivedRows\.map/);
    });
});

describe('سياسات المطبخ — لا سياسات شبحية', () => {
    test('حارس department_id > 0 قبل الحفظ', () => {
        expect(kitchenSrc).toContain('departmentId<=0');
        expect(kitchenSrc).toContain('locationId<=0');
    });

    test('رفض قسم غير موجود في pos_departments', () => {
        expect(kitchenSrc).toContain("'DEPARTMENT_NOT_FOUND'");
        expect(kitchenSrc).toContain('SELECT 1 FROM pos_departments WHERE id=$1');
    });
});

describe('سلامة السلسلة — عقود بين المراحل', () => {
    test('الليدجر يقبل أنواع الحركات المستخدمة في السلسلة', () => {
        const ledgerSrc = fs.readFileSync(path.resolve(__dirname, '../backend/inventory-ledger.js'), 'utf8');
        // كل أنواع الحركات التي تستخدمها مراحل السلسلة يجب أن تبقى مسموحة
        for (const t of ['purchase_receipt', 'transfer_out', 'transfer_in', 'sale_consumption',
                         'production_consumption', 'return', 'count_correction', 'reversal']) {
            expect(ledgerSrc).toContain(`'${t}'`);
        }
    });

    test('البيع يستهلك الوصفة من موقع سياسة المطبخ (kitchen_policies أولاً)', () => {
        const saleSrc = fs.readFileSync(path.resolve(__dirname, '../backend/cashier-module/complete-sale.js'), 'utf8');
        expect(saleSrc).toContain('LEFT JOIN kitchen_policies kp ON kp.department_id = pd.id');
        expect(saleSrc).toContain('sale_consumption');
    });

    test('إلغاء الفاتورة يعكس الاستهلاك من نفس موقع السياسة لا من الرئيسي', () => {
        const voidSrc = fs.readFileSync(path.resolve(__dirname, '../backend/cashier-module/pos-orders-history.js'), 'utf8');
        expect(voidSrc).toContain('COALESCE(kp.kitchen_location_id, pd.location_id, main.id) AS location_id');
        expect(voidSrc).toContain("transactionType: 'reversal'");
    });
});
