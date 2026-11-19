import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    blockerLabel,
    exportWpsReview,
    fetchGosiPreview,
    fetchGosiRates,
    fetchQiwaReadiness,
    fetchWpsReadiness,
    fetchWpsRequirements,
    gosiPreviewPath,
    issueLabel,
    isValidMonth,
    isValidSaudIban,
    isValidSaudiId,
    moneyText,
    nationalityCategory,
    normalizeIban,
    previousMonth,
    ratePercent,
    readinessPercent,
    requirementStatusLabel,
    updateEmployeeBank,
    validateBankForm,
    wpsReadinessPath,
    wpsRequirementsPath,
} from './mudad';

const VALID_IBAN = 'SA0380000000608010167519';

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('مدد — التواريخ والتحقق المحلي', () => {
    it('الشهر السابق يُحسب تقويميًا بلا تحويل UTC', () => {
        expect(previousMonth(new Date(2026, 0, 15))).toBe('2025-12');
        expect(previousMonth(new Date(2026, 2, 31))).toBe('2026-02');
        expect(previousMonth(new Date(Number.NaN))).toBe('');
        expect(isValidMonth('2026-11')).toBe(true);
        expect(isValidMonth('2026-13')).toBe(false);
        expect(isValidMonth('')).toBe(false);
    });

    it('IBAN: تطبيع وmod-97 مطابقان لدوال الخادم', () => {
        expect(normalizeIban(' sa03 8000-0000 6080 1016 7519 ')).toBe(VALID_IBAN);
        expect(isValidSaudIban(VALID_IBAN)).toBe(true);
        expect(isValidSaudIban('sa0380000000608010167519')).toBe(true);
        expect(isValidSaudIban('SA0380000000608010167518')).toBe(false);
        expect(isValidSaudIban('SA038000000060801016751')).toBe(false);
        expect(isValidSaudIban('')).toBe(false);
    });

    it('هوية 10 أرقام تبدأ بـ1 أو 2 فقط', () => {
        expect(isValidSaudiId('1234567890')).toBe(true);
        expect(isValidSaudiId('2234567890')).toBe(true);
        expect(isValidSaudiId('3234567890')).toBe(false);
        expect(isValidSaudiId('123456789')).toBe(false);
    });

    it('تصنيف الجنسية لا يخمّن', () => {
        expect(nationalityCategory('sa')).toBe('saudi');
        expect(nationalityCategory('EG')).toBe('expat');
        expect(nationalityCategory('')).toBe('unknown');
        expect(nationalityCategory('SAU')).toBe('unknown');
    });
});

describe('مدد — نموذج بيانات الصرف', () => {
    it('يبني حمولة صحيحة بلا حقول undefined', () => {
        const result = validateBankForm({ iban: ' sa03 8000 0000 6080 1016 7519 ', nationality: 'sa', gosiNumber: '' });
        expect(result).toEqual({ ok: true, payload: { iban: VALID_IBAN, nationality: 'SA' } });
        expect(JSON.stringify(result)).not.toContain('gosiNumber');
    });

    it('يقبل تعديل حقل واحد ويرفض الحمولة الفارغة', () => {
        expect(validateBankForm({ iban: '', nationality: '', gosiNumber: '123456' })).toEqual({
            ok: true,
            payload: { gosiNumber: '123456' },
        });
        expect(validateBankForm({ iban: '', nationality: '', gosiNumber: '' })).toMatchObject({ ok: false });
    });

    it('يرفض IBAN/جنسية/رقم تأمينات غير صالح', () => {
        expect(validateBankForm({ iban: 'SA00', nationality: '', gosiNumber: '' })).toMatchObject({ ok: false });
        expect(validateBankForm({ iban: '', nationality: 'SAU', gosiNumber: '' })).toMatchObject({ ok: false });
        expect(validateBankForm({ iban: '', nationality: '', gosiNumber: '12a' })).toMatchObject({ ok: false });
    });
});

describe('مدد — عقود المسارات', () => {
    it('يبني مسارات الشهر بنفس صيغة الخادم', () => {
        expect(wpsRequirementsPath('2026-10')).toBe('/api/integration/wps/requirements?month=2026-10');
        expect(wpsReadinessPath('2026-10')).toBe('/api/integration/wps/readiness?month=2026-10');
        expect(gosiPreviewPath('2026-10', 'legacy_before_2024_07')).toBe(
            '/api/integration/gosi/preview?month=2026-10&rate_set=legacy_before_2024_07',
        );
        // شهر غير صالح يسقط إلى الشهر السابق بدل تمريره كما هو.
        expect(wpsRequirementsPath('')).toBe(`/api/integration/wps/requirements?month=${previousMonth()}`);
    });

    it('يقرأ المتطلبات والجاهزية بعقودها الحقيقية', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/wps/requirements')) {
                return jsonResponse({
                    month: '2026-10',
                    provider: { code: 'mudad', verification: 'BLOCKED', is_enabled: false, direct_integration: false },
                    requirements: [
                        {
                            id: 'employee_iban',
                            title_ar: 'IBAN سعودي لكل موظف',
                            requirement: 'IBAN صحيح 24 حرفًا',
                            status: 'TODO',
                            detail: '1 من 2',
                        },
                    ],
                    note: 'ليست قبولًا من مدد',
                });
            }
            return jsonResponse({
                month: '2026-10',
                summary: {
                    month: '2026-10',
                    employees: 2,
                    ready: 1,
                    missing_id: 0,
                    missing_salary: 0,
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
                        employee_id: 7,
                        name: 'أحمد علي',
                        id_number: '1234567890',
                        iban_masked: 'SA03**********7519',
                        nationality: 'SA',
                        salary: 5000,
                        has_line: true,
                        issues: [],
                        ready: true,
                    },
                ],
                truncated: false,
                note: 'عرض جاهزية فقط',
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        const requirements = await fetchWpsRequirements('2026-10');
        expect(requirements.provider.verification).toBe('BLOCKED');
        expect(requirements.requirements[0]?.detail).toBe('1 من 2');

        const readiness = await fetchWpsReadiness('2026-10');
        expect(readiness.blockers).toEqual(['EMPLOYEES_MISSING_IBAN']);
        expect(readiness.employees[0]).toMatchObject({ employee_id: '7', ready: true, issues: [] });
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
            '/api/integration/wps/requirements?month=2026-10',
            '/api/integration/wps/readiness?month=2026-10',
        ]);
    });

    it('يقرأ نسب التأمينات ومعاينتها وقوى', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/gosi/rates')) {
                return jsonResponse({
                    rates: [
                        {
                            id: 'legacy_before_2024_07',
                            label_ar: 'مسجّل قبل 2024-07-03',
                            verified: false,
                            saudi: { employee_bp: 975, employer_bp: 1175 },
                            expat: { employee_bp: 0, employer_bp: 200 },
                        },
                    ],
                    verified: false,
                });
            }
            if (url.includes('/gosi/preview')) {
                return jsonResponse({
                    month: '2026-10',
                    rate_set: { id: 'legacy_before_2024_07', label_ar: 'مسجّل قبل 2024-07-03', verified: false },
                    basis: 'employee_salary_estimate',
                    estimate: true,
                    lines: [
                        {
                            employee_id: 7,
                            name: 'أحمد علي',
                            category: 'saudi',
                            wage: 5000,
                            basis: 'employee_salary',
                            employee: 487.5,
                            employer: 587.5,
                            total: 1075,
                            below_minimum: false,
                        },
                    ],
                    unclassified: [{ employee_id: 8, name: 'منى', reason: 'NATIONALITY_UNKNOWN' }],
                    totals: { employee: 487.5, employer: 587.5, total: 1075 },
                    warnings: ['حساب عرض فقط'],
                });
            }
            return jsonResponse({
                provider: { code: 'qiwa', verification: 'UNVERIFIED', direct_integration: false },
                checks: [{ id: 'contracts', label_ar: 'عقود العمل المسجّلة', ok: true, detail: '3 عقد' }],
                ready: true,
                note: 'جاهزية بيانات محلية فقط',
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        const rates = await fetchGosiRates();
        expect(rates.rates[0]?.verified).toBe(false);
        const preview = await fetchGosiPreview('2026-10', 'legacy_before_2024_07');
        expect(preview.lines[0]?.total).toBe(1075);
        expect(preview.unclassified[0]?.reason).toBe('NATIONALITY_UNKNOWN');
        const qiwa = await fetchQiwaReadiness();
        expect(qiwa.checks[0]?.ok).toBe(true);
    });

    it('يكتب بيانات الصرف ويطلب كشف المراجعة بالشهر نفسه', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
            jsonResponse({
                ok: true,
                employee_id: 7,
                month: '2026-10',
                rows: 2,
                sha256: 'abc',
                filename: 'wps-review-2026-10.csv',
                csv: 'x',
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await updateEmployeeBank('7', { iban: VALID_IBAN, nationality: 'SA' });
        await exportWpsReview('2026-10');

        expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, init?.body])).toEqual([
            ['/api/integration/wps/employees/7/bank', 'PUT', JSON.stringify({ iban: VALID_IBAN, nationality: 'SA' })],
            ['/api/integration/wps/export', 'POST', JSON.stringify({ month: '2026-10' })],
        ]);
    });
});

describe('مدد — التسميات والعرض', () => {
    it('تسميات الحالات والموانع والنواقص', () => {
        expect(requirementStatusLabel('DONE')).toEqual({ label: 'مكتمل', tone: 'success' });
        expect(requirementStatusLabel('BLOCKED').tone).toBe('neutral');
        expect(requirementStatusLabel('NEW_CODE')).toEqual({ label: 'NEW_CODE', tone: 'neutral' });
        expect(blockerLabel('PAYROLL_MONTH_NOT_POSTED')).toContain('posted');
        expect(blockerLabel('GHOST')).toBe('GHOST');
        expect(issueLabel('IBAN_MISSING')).toBe('IBAN غير صالح');
    });

    it('النسب والمبالغ والجاهزية تُنسَّق بلا كسور عائمة', () => {
        expect(ratePercent(975)).toBe('9.75%');
        expect(ratePercent(0)).toBe('0.00%');
        expect(moneyText(1075)).toBe('1075.00');
        expect(moneyText(null)).toBe('0.00');
        expect(
            readinessPercent({
                month: '2026-10',
                employees: 8,
                ready: 6,
                missing_id: 0,
                missing_salary: 0,
                missing_iban: 1,
                unknown_nationality: 0,
                missing_payroll_line: 0,
                posted: true,
                employer_identifier: true,
            }),
        ).toBe(75);
        expect(
            readinessPercent({
                month: '2026-10',
                employees: 0,
                ready: 0,
                missing_id: 0,
                missing_salary: 0,
                missing_iban: 0,
                unknown_nationality: 0,
                missing_payroll_line: 0,
                posted: false,
                employer_identifier: false,
            }),
        ).toBe(0);
    });
});
