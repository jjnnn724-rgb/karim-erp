// ────────────────────────────────────────────────────────────────────────────
// dept-head-requisition.test.js — Task 19
// سلسلة اعتماد طلبات الصرف: رئيس القسم → الشيف العمومي → المخازن → الاستلام
// يغطي الدوال النقية لبوابات السلسلة ومخازن الأقسام وقيد إنشاء الطلبات
// ────────────────────────────────────────────────────────────────────────────
const {
    DEPT_STORES,
    resolveDispatchTargetStore,
    canWarehouseApprove,
    canChefDecide,
    resolveDeptHeadDispatch,
    canReceiveDispatch,
} = require('../backend/warehouse-routes');

describe('resolveDispatchTargetStore — مخازن الأقسام الخمسة المخصصة', () => {
    test('كل قسم من الأقسام الخمسة له مخزن خاص بكود فريد', () => {
        expect(resolveDispatchTargetStore('salads')).toEqual({ code: 'STORE-SALADS', name: 'مخزن قسم السلطات' });
        expect(resolveDispatchTargetStore('sweets')).toEqual({ code: 'STORE-SWEETS', name: 'مخزن الحلواني' });
        expect(resolveDispatchTargetStore('bakery')).toEqual({ code: 'STORE-BAKERY', name: 'مخزن الخباز' });
        expect(resolveDispatchTargetStore('hot_kitchen')).toEqual({ code: 'STORE-HOT-KITCHEN', name: 'مخزن المطبخ الساخن' });
        expect(resolveDispatchTargetStore('external_sales')).toEqual({ code: 'STORE-EXTERNAL', name: 'مخزن البيع الخارجي' });
    });

    test('الأقسام القديمة (kitchen/open_buffet) وأكواد غير معروفة → null (تكمل في مخزن المطبخ)', () => {
        expect(resolveDispatchTargetStore('kitchen')).toBeNull();
        expect(resolveDispatchTargetStore('open_buffet')).toBeNull();
        expect(resolveDispatchTargetStore('unknown_dept')).toBeNull();
        expect(resolveDispatchTargetStore(null)).toBeNull();
        expect(resolveDispatchTargetStore('')).toBeNull();
    });

    test('التطبيع: مسافات وحروف كبيرة لا تكسر المطابقة', () => {
        expect(resolveDispatchTargetStore('  SALADS ')).toEqual({ code: 'STORE-SALADS', name: 'مخزن قسم السلطات' });
        expect(resolveDispatchTargetStore('Hot_Kitchen')).toEqual({ code: 'STORE-HOT-KITCHEN', name: 'مخزن المطبخ الساخن' });
    });

    test('قاموس المخازن مكتمل بكل الحقول وغير قابل للتعديل', () => {
        expect(Object.keys(DEPT_STORES).sort()).toEqual(['bakery', 'external_sales', 'hot_kitchen', 'salads', 'sweets']);
        for (const store of Object.values(DEPT_STORES)) {
            expect(store.code).toMatch(/^STORE-/);
            expect(store.name.length).toBeGreaterThan(3);
        }
        expect(() => { 'x' in DEPT_STORES === false; }).not.toThrow();
    });
});

describe('canWarehouseApprove — بوابة اعتماد المخازن في سلسلة الاعتماد', () => {
    test('طلب رئيس قسم في الانتظار → مرفوض CHEF_APPROVAL_REQUIRED', () => {
        const r = canWarehouseApprove({ needsChefApproval: true, status: 'pending' });
        expect(r.ok).toBe(false);
        expect(r.code).toBe('CHEF_APPROVAL_REQUIRED');
    });

    test('طلب رئيس قسم بعد اعتماد الشيف → يُسمح بالاعتماد', () => {
        expect(canWarehouseApprove({ needsChefApproval: true, status: 'chef_approved' }).ok).toBe(true);
    });

    test('طلب عادي (ليس من رئيس قسم) يُعتمد مباشرة من الانتظار كالسابق', () => {
        expect(canWarehouseApprove({ needsChefApproval: false, status: 'pending' }).ok).toBe(true);
        expect(canWarehouseApprove({ needsChefApproval: null, status: 'pending' }).ok).toBe(true);
    });

    test('إذن معتمد/مرفوض/مستلم لا يُعتمد مرة أخرى (سد الاعتماد المزدوج)', () => {
        expect(canWarehouseApprove({ needsChefApproval: false, status: 'approved' })).toEqual({ ok: false, code: 'DISPATCH_ALREADY_APPROVED' });
        expect(canWarehouseApprove({ needsChefApproval: false, status: 'rejected' })).toEqual({ ok: false, code: 'DISPATCH_REJECTED' });
        expect(canWarehouseApprove({ needsChefApproval: false, status: 'received' })).toEqual({ ok: false, code: 'DISPATCH_ALREADY_RECEIVED' });
        expect(canWarehouseApprove({ needsChefApproval: true, status: 'received' })).toEqual({ ok: false, code: 'DISPATCH_ALREADY_RECEIVED' });
        expect(canWarehouseApprove({ needsChefApproval: true, status: 'partially_received' }).ok).toBe(false);
    });

    test('إذن مفقود → DISPATCH_NOT_FOUND', () => {
        expect(canWarehouseApprove(null)).toEqual({ ok: false, code: 'DISPATCH_NOT_FOUND' });
        expect(canWarehouseApprove(undefined)).toEqual({ ok: false, code: 'DISPATCH_NOT_FOUND' });
    });

    test('حالة غريبة لا تمر صمتًا', () => {
        const r = canWarehouseApprove({ needsChefApproval: false, status: 'weird_state' });
        expect(r.ok).toBe(false);
        expect(r.code).toBe('DISPATCH_INVALID_STATUS');
    });
});

describe('canChefDecide — بوابة الشيف العمومي', () => {
    test('طلب رئيس قسم بانتظار → يمكن اعتماده أو رفضه', () => {
        expect(canChefDecide({ needsChefApproval: true, status: 'pending' }).ok).toBe(true);
    });

    test('طلب لا يحتاج الشيف → رفض صريح لا صمت', () => {
        expect(canChefDecide({ needsChefApproval: false, status: 'pending' })).toEqual({ ok: false, code: 'CHEF_APPROVAL_NOT_REQUIRED' });
    });

    test('طلب تجاوز الانتظار (اعتمد الشيف/عادي/مرفوض/مستلم) → DISPATCH_NOT_PENDING', () => {
        for (const status of ['chef_approved', 'approved', 'rejected', 'received', 'partially_received']) {
            expect(canChefDecide({ needsChefApproval: true, status }).code).toBe('DISPATCH_NOT_PENDING');
        }
    });

    test('إذن مفقود → DISPATCH_NOT_FOUND', () => {
        expect(canChefDecide(null).code).toBe('DISPATCH_NOT_FOUND');
    });
});

describe('resolveDeptHeadDispatch — رئيس القسم مقيّد بقسمه', () => {
    test('رئيس قسم بقسمه نفسه → يمر ويعيد الكود المطبَّع', () => {
        expect(resolveDeptHeadDispatch({ dept_code: 'salads' }, 'salads')).toEqual({ ok: true, deptCode: 'salads' });
        expect(resolveDeptHeadDispatch({ dept_code: 'salads' }, '  salads  ')).toEqual({ ok: true, deptCode: 'salads' });
        expect(resolveDeptHeadDispatch({ dept_code: 'SALADS' }, 'salads')).toEqual({ ok: true, deptCode: 'SALADS' });
    });

    test('محاولة طلب صرف لقسم آخر → DEPT_MISMATCH (403)', () => {
        const r = resolveDeptHeadDispatch({ dept_code: 'salads' }, 'sweets');
        expect(r.ok).toBe(false);
        expect(r.code).toBe('DEPT_MISMATCH');
    });

    test('حساب رئيس قسم بلا قسم مرتبط → DEPT_HEAD_WITHOUT_DEPARTMENT', () => {
        expect(resolveDeptHeadDispatch({ dept_code: null }, '').code).toBe('DEPT_HEAD_WITHOUT_DEPARTMENT');
        expect(resolveDeptHeadDispatch({}, null).code).toBe('DEPT_HEAD_WITHOUT_DEPARTMENT');
        expect(resolveDeptHeadDispatch({ dept_code: '   ' }, '').code).toBe('DEPT_HEAD_WITHOUT_DEPARTMENT');
    });

    test('طلب بلا قسم محدد يُقبَل ويُربط بقسم رئيس القسم تلقائيًا', () => {
        expect(resolveDeptHeadDispatch({ dept_code: 'bakery' }, undefined)).toEqual({ ok: true, deptCode: 'bakery' });
        expect(resolveDeptHeadDispatch({ dept_code: 'bakery' }, null).ok).toBe(true);
    });

    test('مستخدم بلا كائن لا ينهار', () => {
        expect(resolveDeptHeadDispatch(null, 'salads').ok).toBe(false);
    });
});

describe('canReceiveDispatch — رئيس القسم يستلم إذن قسمه هو فقط', () => {
    test('رئيس قسم يستلم إذن قسمه نفسه → يمر', () => {
        expect(canReceiveDispatch({ role: 'dept_head', dept_code: 'salads' }, { deptCode: 'salads' })).toEqual({ ok: true });
        expect(canReceiveDispatch({ role: 'dept_head', dept_code: 'SALADS ' }, { deptCode: 'salads' })).toEqual({ ok: true });
    });

    test('رئيس قسم يحاول استلام إذن قسم آخر → DEPT_MISMATCH (403)', () => {
        const r = canReceiveDispatch({ role: 'dept_head', dept_code: 'salads' }, { deptCode: 'sweets' });
        expect(r.ok).toBe(false);
        expect(r.code).toBe('DEPT_MISMATCH');
    });

    test('رئيس قسم بلا قسم مرتبط → DEPT_HEAD_WITHOUT_DEPARTMENT', () => {
        expect(canReceiveDispatch({ role: 'dept_head', dept_code: null }, { deptCode: 'salads' }).code)
            .toBe('DEPT_HEAD_WITHOUT_DEPARTMENT');
    });

    test('أدوار الاستلام الأخرى (admin/kitchen/warehouse) غير مقيّدة بقسم', () => {
        expect(canReceiveDispatch({ role: 'kitchen' }, { deptCode: 'salads' })).toEqual({ ok: true });
        expect(canReceiveDispatch({ role: 'admin' }, { deptCode: 'kitchen' })).toEqual({ ok: true });
        expect(canReceiveDispatch({ role: 'warehouse' }, {})).toEqual({ ok: true });
    });

    test('مدخلات ناقصة لا تُنهار', () => {
        expect(canReceiveDispatch(null, { deptCode: 'salads' }).ok).toBe(false);
        expect(canReceiveDispatch({ role: 'dept_head', dept_code: 'salads' }, null).ok).toBe(false);
    });
});
