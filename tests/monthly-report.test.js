/**
 * monthly-report.test.js — حساب تقرير الامتثال الشهري (WPS + GOSI + قوى)
 * ────────────────────────────────────────────────────────────────────────────
 * دالة نقية: كل المدخلات مصنوعة يدويًا. لا DB، لا شبكة، لا كتابة.
 */
'use strict';

const { computeMonthlyCompliance, complianceReportHtml } = require('../backend/integration/monthly-report');

const SAUDI = { id: 10, name: 'سالم', iqama: '1000000001', salary: 10000, iban: 'SA5750000000000123456789', nationality: 'SA', status: 'active' };
const EXPAT = { id: 11, name: 'أحمد', iqama: '2000000001', salary: 8000, iban: 'SA8430000000111100000000', nationality: 'EG', status: 'active' };

const payrollPosted = new Map([
    ['10', { basic: 10000, allowances: 0, deductions: 0, net: 10000 }],
    ['11', { basic: 8000, allowances: 0, deductions: 0, net: 8000 }],
]);

const base = {
    month: '2026-10',
    employees: [SAUDI, EXPAT],
    payrollById: payrollPosted,
    postedStatus: 'posted',
    employer: { crn: 'CRN123', name: 'منشأة' },
    qiwaChecks: [
        { id: 'crn', label_ar: 'السجل التجاري', ok: true, detail: 'CRN123' },
        { id: 'contracts', label_ar: 'عقود العمل', ok: true, detail: '2 عقد' },
    ],
    rateSetId: null,
    generatedAt: '2026-11-01T00:00:00.000Z',
};

describe('computeMonthlyCompliance — الامتثال الشهري', () => {
    test('يحسب الرواتب والمجاميع والجاهزية وينشر export_ready', () => {
        const r = computeMonthlyCompliance(base);
        expect(r.month).toBe('2026-10');
        expect(r.payroll.active_employees).toBe(2);
        expect(r.payroll.totals.basic).toBe(18000);
        expect(r.payroll.totals.net).toBe(18000);
        expect(r.payroll.posted).toBe(true);
        expect(r.readiness.summary.ready).toBeDefined();
        expect(r.readiness.percent).toBeGreaterThanOrEqual(0);
        expect(r.global_blockers).toEqual([]);
        expect(r.export_ready).toBe(true);
    });

    test('GOSI: بلا rate_set يُعلن rate_set_required ولا يفتعل نسبًا', () => {
        const r = computeMonthlyCompliance(base);
        expect(r.gosi.rate_set_required).toBe(true);
        expect(r.gosi.available.length).toBeGreaterThan(0);
        expect(r.gosi.preview).toBeUndefined();
    });

    test('GOSI: بمجموعة صريحة تُحسب معاينة التأمينات', () => {
        const r = computeMonthlyCompliance({ ...base, rateSetId: 'legacy_before_2024_07' });
        expect(r.gosi.preview).toBeDefined();
        expect(r.gosi.preview.totals).toBeDefined();
        expect(r.gosi.rate_set.id).toBe('legacy_before_2024_07');
    });

    test('غير مُرحّل + بلا سجل تجاري → موانع عامة وexport_ready=false', () => {
        const r = computeMonthlyCompliance({ ...base, postedStatus: null, employer: { crn: null, name: null } });
        expect(r.global_blockers.join(' ')).toMatch(/غير مُرحّل/);
        expect(r.global_blockers.join(' ')).toMatch(/السجل التجاري/);
        expect(r.export_ready).toBe(false);
    });

    test('موظف بلا سطر مسير يُحصى بدل أن يُعرض صفرًا صامتًا', () => {
        const partial = new Map([['10', { basic: 10000, allowances: 0, deductions: 0, net: 10000 }]]);
        const r = computeMonthlyCompliance({ ...base, payrollById: partial });
        expect(r.payroll.employees_without_line).toBe(1);
    });

    test('موظف غير نشط لا يُحسب في المجاميع', () => {
        const r = computeMonthlyCompliance({
            ...base,
            employees: [SAUDI, { ...EXPAT, status: 'inactive' }],
        });
        expect(r.payroll.active_employees).toBe(1);
    });

    test('complianceReportHtml يطبع ورقة الامتثال بلا أي إرسال', () => {
        const r = computeMonthlyCompliance(base);
        const html = complianceReportHtml(r);
        expect(html).toContain('تقرير الامتثال الشهري');
        expect(html).toContain('لا يُرسل');
        expect(html).not.toMatch(/<script>/);
    });
});
