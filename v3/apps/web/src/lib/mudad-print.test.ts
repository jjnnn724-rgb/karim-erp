import { describe, expect, it } from 'vitest';
import type { WpsReadinessResponse } from './mudad';
import { mudadReviewCsv, mudadReviewFilename, mudadReviewPrintHtml } from './mudad-print';

/**
 * ورقة مراجعة الامتثال — تُبنى من بيانات الخادم كما هي.
 * لا حساب ولا استنتاج: الورقة تطبع ما استُقبل فقط.
 */

const readiness: WpsReadinessResponse = {
    month: '2026-10',
    summary: {
        month: '2026-10',
        employees: 2,
        ready: 1,
        missing_id: 0,
        missing_salary: 1,
        missing_iban: 1,
        unknown_nationality: 0,
        missing_payroll_line: 0,
        posted: true,
        employer_identifier: true,
    },
    blockers: ['EMPLOYEES_MISSING_IBAN'],
    export_ready: false,
    employees: [
        {
            employee_id: '7',
            name: 'أحمد علي',
            id_number: '1234567890',
            iban_masked: 'SA03**********7519',
            nationality: 'SA',
            salary: 5000,
            has_line: true,
            issues: [],
            ready: true,
        },
        {
            employee_id: '8',
            name: 'منى حسن',
            id_number: null,
            iban_masked: null,
            nationality: 'EG',
            salary: 4000,
            has_line: true,
            issues: ['IBAN_MISSING', 'SALARY_MISSING'],
            ready: false,
        },
    ],
    truncated: false,
    note: 'عرض جاهزية فقط',
    generated_at: '2026-11-01T03:00:00Z',
};

describe('ورقة مراجعة الامتثال', () => {
    it('تطبع الشهر والجاهزية والموانع وصفوف الموظفين', () => {
        const html = mudadReviewPrintHtml(readiness, { month: '2026-10', byName: 'مدير الموارد' });

        expect(html).toContain('2026-10');
        expect(html).toContain('مدير الموارد');
        expect(html).toContain('EMPLOYEES_MISSING_IBAN');
        expect(html).toContain('SA03**********7519');
        expect(html).toContain('منى حسن');
        expect(html).toContain('IBAN غير صالح');
        expect(html).toContain('50%');
    });

    it('تحمل لافتة الحظر: ليست ملف SIF ولا رفعًا تلقائيًا', () => {
        const html = mudadReviewPrintHtml(readiness, { month: '2026-10', byName: '—' });

        expect(html).toContain('BLOCKED');
        expect(html).toContain('ليست ملف SIF');
        expect(html).toContain('لا اتصال حكومي ولا رفع تلقائي');
    });

    it('تهرّب اسم من يطبع الورقة فلا يكسر المستند', () => {
        const html = mudadReviewPrintHtml(readiness, {
            month: '2026-10',
            byName: '<img src=x onerror=alert(1)>',
        });

        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
    });

    it('يطبع كشف التأمينات بأرقام الخادم فقط', () => {
        const html = mudadReviewPrintHtml(readiness, {
            month: '2026-10',
            byName: '—',
            preview: {
                month: '2026-10',
                rate_set: { id: 'legacy_before_2024_07', label_ar: 'مسجّل قبل 2024-07-03', verified: false },
                basis: 'payroll',
                estimate: false,
                lines: [
                    {
                        employee_id: '7',
                        name: 'أحمد علي',
                        category: 'saudi',
                        wage: 5000,
                        basis: 'payroll',
                        employee: 487.5,
                        employer: 587.5,
                        total: 1075,
                        below_minimum: false,
                    },
                ],
                unclassified: [{ employee_id: '8', name: 'منى حسن', reason: 'NATIONALITY_UNKNOWN' }],
                totals: { employee: 487.5, employer: 587.5, total: 1075 },
                warnings: [],
                generated_at: '2026-11-01T03:00:00Z',
            },
        });

        expect(html).toContain('معاينة اشتراكات التأمينات');
        expect(html).toContain('مسجّل قبل 2024-07-03');
        expect(html).toContain('1075.00');
        expect(html).toContain('الجنسية غير معروفة');
        expect(html).toContain('غير موثّقة');
    });

    it('يبني CSV بترميز BOM ويقتبس الخلايا ويضع اسمًا موحّدًا', () => {
        const csv = mudadReviewCsv(readiness, { month: '2026-10', byName: '—' });

        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain('"الموظفون النشطون","2"');
        expect(csv).toContain(`"مانع — EMPLOYEES_MISSING_IBAN","EMPLOYEES_MISSING_IBAN"`);
        expect(mudadReviewFilename('2026-10')).toBe('ورقة-امتثال-ملف-الأجور-2026-10.csv');
    });
});
