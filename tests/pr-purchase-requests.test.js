/**
 * pr-purchase-requests.test.js — سياسة طلبات الشراء (2026-10-01 بطلب المالك)
 * ────────────────────────────────────────────────────────────────────────────
 * بيتها المخزن: الإنشاء (admin/manager/warehouse) ← توقيع الشيف ← اعتماد
 * المدير العام (بتوقيع مختلف) ← استلام المخزن. kitchen/dept_head للاعتماد
 * والعرض فقط — بلا إنشاء.
 */
'use strict';

const {
    PR_CREATE_ROLES,
    PR_CANCEL_ROLES,
    PR_CHEF_ROLES,
    PR_GM_ROLES,
    PR_WH_ROLES,
    PR_READ_ROLES,
    canPRChefDecide,
    canPRGMDecide,
} = require('../backend/warehouse-routes');

describe('أدوار طلبات الشراء — بيتها المخزن', () => {
    test('الإنشاء من المخزن والإدارة فقط', () => {
        expect(PR_CREATE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(PR_CREATE_ROLES).not.toContain('kitchen');
        expect(PR_CREATE_ROLES).not.toContain('dept_head');
    });
    test('الإلغاء يشمل أصحاب الطلبات القديمة (ملكية تُفحص داخل المسار)', () => {
        expect(PR_CANCEL_ROLES).toEqual(
            expect.arrayContaining(['admin', 'manager', 'warehouse', 'kitchen', 'dept_head']));
    });
    test('الشيف يوقّع (مطبخ) والمدير العام يعتمد (بلا مطبخ)', () => {
        expect(PR_CHEF_ROLES).toContain('kitchen');
        expect(PR_GM_ROLES).toEqual(['admin', 'manager']);
        expect(PR_GM_ROLES).not.toContain('kitchen');
    });
    test('الاستلام للمخزن — والقراءة تشمل الشيف والمحاسب', () => {
        expect(PR_WH_ROLES).toContain('warehouse');
        expect(PR_READ_ROLES).toEqual(
            expect.arrayContaining(['admin', 'manager', 'warehouse', 'kitchen', 'accountant']));
    });
});

describe('سلسلة الاعتماد — شيف ثم مدير عام بتوقيعين مختلفين', () => {
    test('المدير العام لا يعتمد قبل توقيع الشيف', () => {
        expect(canPRGMDecide({ status: 'pending' }, { id: 9 }).ok).toBe(false);
        expect(canPRGMDecide({ status: 'pending' }, { id: 9 }).code).toBe('PR_CHEF_APPROVAL_REQUIRED');
    });
    test('الشيف لا يعتمد اعتماد المدير العام بنفسه (توقيعان مختلفان)', () => {
        const pr = { status: 'chef_approved', chef_approved_by: 7 };
        expect(canPRGMDecide(pr, { id: 7 }).ok).toBe(false);
        expect(canPRGMDecide(pr, { id: 7 }).code).toBe('PR_SELF_APPROVAL');
        expect(canPRGMDecide(pr, { id: 9 }).ok).toBe(true);
    });
    test('الشيف يبت في المعلق فقط', () => {
        expect(canPRChefDecide({ status: 'pending' }).ok).toBe(true);
        expect(canPRChefDecide({ status: 'chef_approved' }).ok).toBe(false);
        expect(canPRChefDecide({ status: 'approved' }).code).toBe('PR_ALREADY_APPROVED');
    });
});
