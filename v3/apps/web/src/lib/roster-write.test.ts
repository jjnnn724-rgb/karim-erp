import { describe, expect, it } from 'vitest';
import {
    canApproveRoster,
    canWriteRoster,
    type RosterCellEdit,
    rosterCellError,
    rosterCellPayload,
    validateRosterSave,
} from './roster-write';

const WEEK = '2026-11-07';
const TODAY = '2026-11-10';

function edit(overrides: Partial<RosterCellEdit> = {}): RosterCellEdit {
    return {
        id: '50',
        date: '2026-11-10',
        shiftStart: '09:00',
        shiftHours: '10',
        dayOff: '',
        ...overrides,
    };
}

describe('roster-write', () => {
    it('يقبل خلية مستقبلية صحيحة', () => {
        expect(rosterCellError(edit(), WEEK, TODAY)).toBe('');
    });

    it('يرفض الماضي بنص الخادم نفسه', () => {
        expect(rosterCellError(edit({ date: '2026-11-09' }), WEEK, TODAY)).toBe('لا يمكن تعديل ماضٍ (2026-11-09) — القديم محمي');
    });

    it('يرفض تاريخًا خارج الأسبوع', () => {
        expect(rosterCellError(edit({ date: '2026-11-20' }), WEEK, TODAY)).toBe('تاريخ خلية خارج الأسبوع: 2026-11-20');
    });

    it('يرفض وقتًا أو مدة أو يوم راحة غير صالح', () => {
        expect(rosterCellError(edit({ shiftStart: '25:00' }), WEEK, TODAY)).toContain('وقت غير صالح');
        expect(rosterCellError(edit({ shiftHours: '0' }), WEEK, TODAY)).toContain('مدة الدوام 1-24');
        expect(rosterCellError(edit({ dayOff: '7' }), WEEK, TODAY)).toContain('يوم الراحة 0-6');
    });

    it('يطبّع الوقت ويحوّل الفارغ إلى null', () => {
        expect(rosterCellPayload(edit({ shiftStart: '9:05', shiftHours: '8' }))).toMatchObject({
            shift_start: '09:05',
            shift_hours: 8,
            day_off: null,
        });
        expect(rosterCellPayload(edit({ shiftStart: '', shiftHours: '8', dayOff: '5' }))).toMatchObject({
            shift_start: null,
            shift_hours: null,
            day_off: 5,
        });
    });

    it('يرفض حفظة فارغة أو أكبر من 700 خلية', () => {
        expect(validateRosterSave([], WEEK, TODAY)).toEqual({ ok: false, error: 'لا توجد خلايا للحفظ' });
        const many = Array.from({ length: 701 }, () => edit());
        expect(validateRosterSave(many, WEEK, TODAY)).toEqual({
            ok: false,
            error: 'حد أقصى 700 خلية في الحفظة الواحدة',
        });
    });

    it('يعيد الحمولة الكاملة عند نجاح التحقق', () => {
        const result = validateRosterSave([edit()], WEEK, TODAY);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.cells).toHaveLength(1);
            expect(result.cells[0]?.id).toBe('50');
        }
    });

    it('يفصل أدوار الحفظ عن أدوار الاعتماد', () => {
        expect(canWriteRoster('dept_head')).toBe(true);
        expect(canApproveRoster('dept_head')).toBe(false);
        expect(canApproveRoster('hr')).toBe(true);
        expect(canApproveRoster('admin')).toBe(true);
        expect(canWriteRoster('viewer')).toBe(false);
    });
});
