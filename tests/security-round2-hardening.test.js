/**
 * Security Round-2 Hardening Tests — تدقيق أمني جولة ثانية 2026-09-03
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي إصلاحات الجولة الثانية (كل منطق قرار نقي مُصدَّر ومُختبَر مباشرة،
 * وطبقة HTTP تُثبت حيًا في scripts/live_security_audit_r2.py):
 *
 * 1. حرس حذف إذن الصرف canDeleteDispatch:
 *    كان DELETE /api/dispatches/:id يقبل حذف إذن معتمد/مستلم/مرفوض —
 *    يمحو مستندًا ماليًا موقّعًا رحّل مصروفات وحركات دفتر وأحداث موقّعة.
 *
 * 2. الكيانات المحمية من الحذف PROTECTED_DELETE_ENTITIES:
 *    inventoryTx (دفتر الحركات) + kitchenReturns (حذف الصف يعيد فتح سقف
 *    الإرجاع → إرجاع مزدوج) + purchaseInvoices (حذفها يمحو دين المورد).
 *
 * 3. إخفاء رواتب الموظفين maskEmployeeRowForRole:
 *    قائمة employees تبقى متاحة لبوابة الموظف لكن salary يُخفى
 *    عن الأدوار غير المرتفعة (admin/manager/hr فقط).
 *
 * 4. منع التصديق الذاتي في سلسلة الإجازات canDecideLeave:
 *    صاحب الطلب (manager/hr) كان يعتمد طلبه بنفسه في مرحلته.
 *
 * 5. تحقق أرقام الطلبات validateOrderPayload:
 *    POST/PUT /api/orders كانا يقبلان كميات وأسعاراً وإجماليات سالبة
 *    وpayment_status قيمة حرة.
 *
 * 6. فحص واقعي: حقل الراتب في قاعدة البيانات اسمه فعلًا salary
 *    (لو تغيّر اسم العمود يفشل الاختبار ويجبر تحديث خريطة الإخفاء).
 *
 * Run: npx jest tests/security-round2-hardening.test.js
 */

const { describe, it, expect } = require('@jest/globals');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    PROTECTED_DELETE_ENTITIES,
    EMPLOYEE_SENSITIVE_FIELDS,
    EMPLOYEE_ELEVATED_ROLES,
    isProtectedDeleteEntity,
    maskEmployeeRowForRole,
} = require('../backend/schema-registry');
const { canDeleteDispatch } = require('../backend/warehouse-routes');
const { validateOrderPayload, ORDER_PAYMENT_STATUSES } = require('../backend/cashier-module/orders-routes');
const { canDecideLeave } = require('../backend/leave-workflow-routes');
const { pool } = require('../backend/shared-pool');

// ─── 1) حرس حذف إذن الصرف ────────────────────────────────────────────────────
describe('Round-2 — canDeleteDispatch (signed dispatch documents are not deletable)', () => {
    it('الطلب المعلّق pending قابل للحذف (إلغاء طلب خاطئ لم تحسمه أي جهة)', () => {
        expect(canDeleteDispatch({ status: 'pending' })).toEqual({ ok: true });
    });

    it('الإذن المعتمد ممنوع — مستند مالي مرحّل مصروفات وحركات', () => {
        const guard = canDeleteDispatch({ status: 'approved' });
        expect(guard.ok).toBe(false);
        expect(guard.code).toBe('DISPATCH_ALREADY_APPROVED');
    });

    it('الإذن المستلم كليًا أو جزئيًا ممنوع', () => {
        expect(canDeleteDispatch({ status: 'received' }).code).toBe('DISPATCH_ALREADY_RECEIVED');
        expect(canDeleteDispatch({ status: 'partially_received' }).code).toBe('DISPATCH_ALREADY_RECEIVED');
    });

    it('الإذن المرفوض ممنوع — قرار الرفض موقّع في سلسلة الأحداث', () => {
        expect(canDeleteDispatch({ status: 'rejected' }).code).toBe('DISPATCH_REJECTED');
    });

    it('إذن بانتظار المخازن (chef_approved) ممنوع — قرار الشيف موقّع', () => {
        const guard = canDeleteDispatch({ status: 'chef_approved' });
        expect(guard.ok).toBe(false);
        expect(guard.code).toBe('DISPATCH_CHEF_DECIDED');
    });

    it('غياب الإذن وحالة غير معروفة يعطيان رموز خطأ صريحة', () => {
        expect(canDeleteDispatch(null).code).toBe('DISPATCH_NOT_FOUND');
        expect(canDeleteDispatch({ status: 'whatever' }).code).toBe('DISPATCH_INVALID_STATUS');
    });
});

// ─── 2) الكيانات المحمية من الحذف ───────────────────────────────────────────
describe('Round-2 — PROTECTED_DELETE_ENTITIES (append-only financial records)', () => {
    it('تغطي دفتر الحركات والمرتجعات وفواتير الموردين بالضبط', () => {
        expect(PROTECTED_DELETE_ENTITIES).toEqual(expect.arrayContaining(['inventoryTx', 'kitchenReturns', 'purchaseInvoices']));
        expect(PROTECTED_DELETE_ENTITIES).toHaveLength(3);
    });

    it('isProtectedDeleteEntity يطابق الثلاثة ويرفض البقية', () => {
        for (const e of ['inventoryTx', 'kitchenReturns', 'purchaseInvoices']) {
            expect(isProtectedDeleteEntity(e)).toBe(true);
        }
        for (const e of ['expenses', 'revenues', 'employees', 'inventory', 'dispatches', 'notifications', 'shelves']) {
            expect(isProtectedDeleteEntity(e)).toBe(false);
        }
    });
});

// ─── 3) إخفاء رواتب الموظفين ────────────────────────────────────────────────
describe('Round-2 — maskEmployeeRowForRole (salary hidden from non-elevated roles)', () => {
    const row = { id: 1, name: 'موظف', department: 'salads', position: 'شيف', userId: 7, salary: 4500 };

    it('الأدوار غير المرتفعة لا ترى salary', () => {
        for (const role of ['kitchen', 'dept_head', 'employee', 'cashier', 'warehouse', 'accountant', 'auditor', undefined]) {
            const masked = maskEmployeeRowForRole(row, role);
            expect(masked.salary).toBeUndefined();
            expect(masked.name).toBe('موظف');
            expect(masked.department).toBe('salads');
            expect(masked.userId).toBe(7);
        }
    });

    it('admin وmanager وhr يرون الراتب كما هو', () => {
        for (const role of EMPLOYEE_ELEVATED_ROLES) {
            expect(maskEmployeeRowForRole(row, role).salary).toBe(4500);
        }
    });

    it('الإخفاء لا يعبث بالصف الأصلي ولا ينهار على قيم شاذة', () => {
        const masked = maskEmployeeRowForRole(row, 'kitchen');
        expect(row.salary).toBe(4500); // الأصل سليم
        expect(maskEmployeeRowForRole(null, 'kitchen')).toBeNull();
        expect(maskEmployeeRowForRole(undefined, 'admin')).toBeUndefined();
    });

    it('خريطة الحقول الحساسة تضم salary تحديدًا', () => {
        expect(EMPLOYEE_SENSITIVE_FIELDS).toContain('salary');
    });
});

// ─── 4) منع التصديق الذاتي في سلسلة الإجازات ────────────────────────────────
describe('Round-2 — canDecideLeave (no self-approval in the leave chain)', () => {
    it('مدير غير صاحب الطلب يعتمد في مرحلته (المدير المباشر) طبيعيًا', () => {
        expect(canDecideLeave({ role: 'manager' }, 'direct_manager', false)).toEqual({ ok: true });
    });

    it('مدير صاحب الطلب ممنوع من التصديق على طلبه بنفسه', () => {
        const decision = canDecideLeave({ role: 'manager' }, 'direct_manager', true);
        expect(decision.ok).toBe(false);
        expect(decision.code).toBe('LEAVE_SELF_APPROVAL_FORBIDDEN');
    });

    it('hr صاحب الطلب في مرحلته (hr) ممنوع أيضًا', () => {
        expect(canDecideLeave({ role: 'hr' }, 'hr', true).code).toBe('LEAVE_SELF_APPROVAL_FORBIDDEN');
    });

    it('admin استثناء موثّق: يمر في كل المراحل حتى لو كان صاحب الطلب', () => {
        for (const stage of ['direct_manager', 'operations_manager', 'general_manager', 'hr']) {
            expect(canDecideLeave({ role: 'admin' }, stage, true)).toEqual({ ok: true });
        }
    });

    it('دور بلا صلاحية في المرحلة يُرفض رفض مرحلة قبل أي شيء آخر', () => {
        expect(canDecideLeave({ role: 'kitchen' }, 'direct_manager', true).code).toBe('LEAVE_STAGE_FORBIDDEN');
        expect(canDecideLeave({ role: 'hr' }, 'general_manager', false).code).toBe('LEAVE_STAGE_FORBIDDEN');
    });
});

// ─── 5) تحقق أرقام الطلبات ──────────────────────────────────────────────────
describe('Round-2 — validateOrderPayload (no negative money, payment_status whitelisted)', () => {
    it('يرفض كمية/سعر/خصم/إجمالي بند سالبًا أو غير رقمي', () => {
        const check = validateOrderPayload({
            items: [
                { quantity: -3, unit_price: 10 },
                { quantity: 2, unit_price: -1 },
                { quantity: 1, unit_price: 5, discount: -2 },
                { quantity: 1, unit_price: 5, total: 'abc' },
            ],
        }, { withItems: true });
        expect(check.ok).toBe(false);
        expect(check.errors.some(e => e.includes('items[0].quantity'))).toBe(true);
        expect(check.errors.some(e => e.includes('items[1].unit_price'))).toBe(true);
        expect(check.errors.some(e => e.includes('items[2].discount'))).toBe(true);
        expect(check.errors.some(e => e.includes('items[3].total'))).toBe(true);
    });

    it('يرفض إجماليات الطلب العليا السالبة (subtotal/tax/total/discount)', () => {
        const check = validateOrderPayload({ subtotal: -5, tax: -1, total: -100, discount: -2, items: [{ quantity: 1 }] }, { withItems: true });
        expect(check.ok).toBe(false);
        expect(check.errors).toHaveLength(4);
    });

    it('يرفض payment_status خارج القائمة البيضاء ويقبل القيم النظامية', () => {
        const bad = validateOrderPayload({ payment_status: 'hacked', items: [{ quantity: 1 }] }, { withItems: true });
        expect(bad.ok).toBe(false);
        for (const s of ORDER_PAYMENT_STATUSES) {
            expect(validateOrderPayload({ payment_status: s }, {}).ok).toBe(true);
        }
    });

    it('يقبل طلبًا سليمًا وقيمًا معدومة، وPUT الجزئي بلا بنود يمر', () => {
        expect(validateOrderPayload({
            subtotal: 100, discount: 0, tax: 15, total: 115, payment_status: 'paid',
            items: [{ quantity: 2, unit_price: 50, discount: 0, total: 100 }],
        }, { withItems: true })).toEqual({ ok: true, errors: [] });
        // PUT يصل غالبًا بحقول جزئية بلا items
        expect(validateOrderPayload({ status: 'completed' })).toEqual({ ok: true, errors: [] });
        // quantity الغائب يبقى مسموحًا (القيمة الافتراضية 1 في المسار)
        expect(validateOrderPayload({ items: [{ product_name: 'طبق' }] }, { withItems: true }).ok).toBe(true);
    });
});

// ─── 6) فحص واقعي على قاعدة البيانات ────────────────────────────────────────
describe('Round-2 — DB shape guard', () => {
    it('عمود الراتب في employees اسمه فعلاً salary (وإلا خريطة الإخفاء تتحدث)', async () => {
        const result = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'salary'`
        );
        expect(result.rows.length).toBe(1);
    });
});
