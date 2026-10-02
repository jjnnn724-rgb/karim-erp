/**
 * leave-chain.test.js — سلسلة اعتماد الإجازات: 3 مراحل (2026-10-01 بطلب المالك)
 * ────────────────────────────────────────────────────────────────────────────
 * الموظف ← مديره المباشر (رئيس القسم) ← المدير العام ← شؤون العاملين.
 * بلا مدير تشغيل. رئيس القسم ضمن أدوار المباشر، والمدير العام يشمل manager.
 */
'use strict';

const {
    STAGES,
    STAGE_LABELS,
    STAGE_ROLES,
    canDecideLeave,
} = require('../backend/leave-workflow-routes');

describe('مراحل السلسلة — 3 مراحل فقط', () => {
    test('STAGES = مباشر ← عام ← شؤون عاملين', () => {
        expect(STAGES).toEqual(['direct_manager', 'general_manager', 'hr']);
        expect(STAGES).not.toContain('operations_manager');
    });
    test('التسميات العربية موجودة', () => {
        expect(STAGE_LABELS.direct_manager).toBe('المدير المباشر');
        expect(STAGE_LABELS.general_manager).toBe('المدير العام');
        expect(STAGE_LABELS.hr).toBe('شؤون العاملين');
    });
});

describe('أدوار المراحل', () => {
    test('المدير المباشر: مدير + أدمن + رئيس قسم', () => {
        expect(STAGE_ROLES.direct_manager).toEqual(
            expect.arrayContaining(['manager', 'admin', 'dept_head']));
    });
    test('المدير العام: أدمن + مدير (بلا مطبخ/أقسام)', () => {
        expect(STAGE_ROLES.general_manager).toEqual(['admin', 'manager']);
        expect(STAGE_ROLES.general_manager).not.toContain('kitchen');
        expect(STAGE_ROLES.general_manager).not.toContain('dept_head');
    });
    test('شؤون العاملين تقفل: hr + أدمن', () => {
        expect(STAGE_ROLES.hr).toEqual(['hr', 'admin']);
    });
});

describe('canDecideLeave — البوابات', () => {
    test('رئيس القسم يبت في المباشر', () => {
        expect(canDecideLeave({ role: 'dept_head' }, 'direct_manager', false).ok).toBe(true);
    });
    test('رئيس القسم لا يبت في العام أو شؤون العاملين', () => {
        expect(canDecideLeave({ role: 'dept_head' }, 'general_manager', false).ok).toBe(false);
        expect(canDecideLeave({ role: 'dept_head' }, 'hr', false).ok).toBe(false);
    });
    test('المدير يبت في المباشر والعام', () => {
        expect(canDecideLeave({ role: 'manager' }, 'direct_manager', false).ok).toBe(true);
        expect(canDecideLeave({ role: 'manager' }, 'general_manager', false).ok).toBe(true);
        expect(canDecideLeave({ role: 'manager' }, 'hr', false).ok).toBe(false);
    });
    test('الموظف العادي لا يبت في أي مرحلة', () => {
        for (const s of STAGES) {
            expect(canDecideLeave({ role: 'employee' }, s, false).ok).toBe(false);
        }
    });
    test('صاحب الطلب لا يصدق على نفسه (عدا الأدمن)', () => {
        expect(canDecideLeave({ role: 'dept_head' }, 'direct_manager', true).ok).toBe(false);
        expect(canDecideLeave({ role: 'manager' }, 'general_manager', true).ok).toBe(false);
        expect(canDecideLeave({ role: 'admin' }, 'general_manager', true).ok).toBe(true);
    });
});
