import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previousMonth } from '../lib/mudad';
import { ToastProvider } from '../ui/Toast';
import { Mudad } from './Mudad';

const mocks = vi.hoisted(() => ({ role: 'manager' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مدير النظام', username: 'admin', role: mocks.role },
    }),
}));

/**
 * سطح V3 لمدد — يقرأ المسارات السبعة (بلا gosi/preview قبل اختيار النسب)
 * ولا يرسل أي كتابة تلقائيًا. النسب لا تُفترض: القائمة تبدأ بلا اختيار.
 */

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Mudad />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    mocks.role = 'manager';
});

describe('مدد والتأمينات وقوى', () => {
    it('يعرض المتطلبات والجاهزية والنسب وقوى من الخادم بلا أي كتابة', async () => {
        const calls: { url: string; method: string | undefined }[] = [];
        const month = previousMonth();
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, method: init?.method });
            if (url.includes('/wps/requirements')) {
                return json({
                    month,
                    provider: {
                        code: 'mudad',
                        verification: 'BLOCKED',
                        is_enabled: false,
                        direct_integration: false,
                    },
                    requirements: [
                        {
                            id: 'employee_iban',
                            title_ar: 'IBAN سعودي لكل موظف',
                            requirement: 'IBAN صحيح 24 حرفًا يبدأ بـSA.',
                            status: 'TODO',
                            detail: '1 من 2',
                        },
                    ],
                    note: 'ليست قبولًا من مدد',
                });
            }
            if (url.includes('/wps/readiness')) {
                return json({
                    month,
                    summary: {
                        month,
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
                        {
                            employee_id: 8,
                            name: 'منى حسن',
                            id_number: '2234567890',
                            iban_masked: null,
                            nationality: 'EG',
                            salary: 4000,
                            has_line: true,
                            issues: ['IBAN_MISSING'],
                            ready: false,
                        },
                    ],
                    truncated: false,
                    note: 'عرض جاهزية فقط',
                });
            }
            if (url.includes('/gosi/rates')) {
                return json({
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
                    note: 'النسب غير موثّقة داخل النظام',
                });
            }
            if (url.includes('/qiwa/readiness')) {
                return json({
                    provider: { code: 'qiwa', verification: 'UNVERIFIED', direct_integration: false },
                    checks: [{ id: 'contracts', label_ar: 'عقود العمل المسجّلة', ok: true, detail: '3 عقد' }],
                    ready: true,
                    note: 'جاهزية بيانات محلية فقط',
                });
            }
            return json({ error: 'NOT_FOUND' });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('IBAN سعودي لكل موظف')).toBeTruthy();
        expect(screen.getAllByText('أحمد علي').length).toBeGreaterThan(0);
        expect(screen.getAllByText('SA03**********7519').length).toBeGreaterThan(0);
        expect(screen.getByText(/موظفون بلا IBAN سعودي صالح/)).toBeTruthy();
        expect(screen.getAllByText('مسجّل قبل 2024-07-03').length).toBeGreaterThan(0);
        expect(screen.getByText('غير موثّقة')).toBeTruthy();
        expect(screen.getByText('عقود العمل المسجّلة')).toBeTruthy();
        expect(screen.getByText('لا افتراض تلقائي للنسب — اختر مجموعة صراحةً لعرض الحساب التقديري.')).toBeTruthy();

        const portal = screen.getByRole('link', { name: /مدد — حماية الأجور/ });
        expect(portal.getAttribute('href')).toBe('https://www.mudad.com.sa');
        expect(portal.getAttribute('rel')).toContain('noopener');

        expect(calls.some((call) => call.url.includes(`/wps/readiness?month=${month}`))).toBe(true);
        expect(calls.some((call) => call.url.includes('/gosi/preview'))).toBe(false);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });
});

/**
 * الأتمتة الاحترافية: مزامنة حيّة، ورقة مراجعة مطبوعة، ملخّص CSV،
 * ولوحة تدوير اعتمادات للأدمن وحده.
 */
describe('أتمتة شاشة الامتثال', () => {
    function stubApi(calls: { url: string; method: string | undefined }[]): string {
        const month = previousMonth();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push({ url, method: init?.method });
                if (url.includes('/wps/requirements')) {
                    return json({
                        month,
                        provider: { code: 'mudad', verification: 'BLOCKED' },
                        requirements: [{ id: 'r1', title_ar: 'IBAN لكل موظف', requirement: 'IBAN صحيح', status: 'TODO' }],
                        generated_at: '2026-11-01T03:00:00Z',
                    });
                }
                if (url.includes('/wps/readiness')) {
                    return json({
                        month,
                        summary: {
                            month,
                            employees: 1,
                            ready: 1,
                            missing_id: 0,
                            missing_salary: 0,
                            missing_iban: 0,
                            unknown_nationality: 0,
                            missing_payroll_line: 0,
                            posted: true,
                            employer_identifier: true,
                        },
                        blockers: [],
                        export_ready: true,
                        employees: [
                            {
                                employee_id: 7,
                                name: 'أحمد علي',
                                id_number: '1234567890',
                                iban_masked: 'SA03**********7519',
                                nationality: 'SA',
                                salary: 5000,
                                issues: [],
                                ready: true,
                            },
                        ],
                        generated_at: '2026-11-01T03:00:00Z',
                    });
                }
                if (url.includes('/gosi/rates')) {
                    return json({
                        rates: [
                            {
                                id: 'legacy_before_2024_07',
                                label_ar: 'مسجّل قبل 2024-07-03',
                                verified: false,
                                saudi: { employee_bp: 975, employer_bp: 1175 },
                                expat: { employee_bp: 0, employer_bp: 200 },
                            },
                        ],
                    });
                }
                if (url.includes('/qiwa/readiness')) {
                    return json({
                        provider: { code: 'qiwa', verification: 'UNVERIFIED' },
                        checks: [{ id: 'contracts', label_ar: 'عقود العمل', ok: true, detail: '3 عقد' }],
                        ready: true,
                        generated_at: '2026-11-01T03:00:00Z',
                    });
                }
                if (url.includes('/api/integration/health')) {
                    return json({
                        providers: [],
                        outbox: null,
                        infra: { migration_145: true },
                        generated_at: '2026-11-01T03:00:00Z',
                    });
                }
                if (url.includes('/api/integration/outbox')) {
                    return json({ rows: [] });
                }
                if (url.includes('/api/integration/events')) {
                    return json({ rows: [] });
                }
                return json({ error: 'NOT_FOUND' });
            }),
        );
        return month;
    }

    it('يعلن المزامنة التلقائية وطابع آخر تحديث', async () => {
        stubApi([]);
        renderScreen();

        expect(await screen.findByText('IBAN لكل موظف')).toBeTruthy();
        expect(screen.getByText('كل 60 ثانية')).toBeTruthy();
        expect(screen.getByText(/المزامنة التلقائية كل 60 ثانية/)).toBeTruthy();
        expect(screen.getByText(/آخر تحديث من الخادم/)).toBeTruthy();
    });

    it('لا يعرض لوحة تدوير الاعتمادات لغير الأدمن', async () => {
        stubApi([]);
        renderScreen();

        expect(await screen.findByText('IBAN لكل موظف')).toBeTruthy();
        expect(screen.queryByText('تدوير اعتمادات التكامل')).toBeNull();
    });

    it('يعرض لوحة تدوير الاعتمادات للأدمن', async () => {
        mocks.role = 'admin';
        stubApi([]);
        renderScreen();

        expect(await screen.findByText('تدوير اعتمادات التكامل')).toBeTruthy();
        expect(screen.getByLabelText('اسم المفتاح')).toBeTruthy();
        expect(screen.getByLabelText('القيمة الجديدة')).toBeTruthy();
    });

    it('يطبع ورقة المراجعة في تبويب مستقل', async () => {
        const popup = {
            document: document.implementation.createHTMLDocument(),
            focus: vi.fn(),
            print: vi.fn(),
            close: vi.fn(),
        } as unknown as Window;
        vi.spyOn(window, 'open').mockReturnValue(popup);
        stubApi([]);
        renderScreen();

        expect(await screen.findByText('IBAN لكل موظف')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'طباعة ورقة المراجعة' }));

        expect(window.open).toHaveBeenCalledWith('', '_blank');
        await waitFor(() => {
            expect(popup.document.documentElement.textContent).toContain('ورقة مراجعة الامتثال');
        });
        expect(popup.document.documentElement.textContent).toContain('BLOCKED');
    });

    it('ينزّل ملخّص CSV باسم موحّد', async () => {
        const createObjectURL = vi.fn(() => 'blob:mock');
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true, configurable: true });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        stubApi([]);
        renderScreen();

        expect(await screen.findByText('IBAN لكل موظف')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تنزيل ملخّص CSV' }));

        await waitFor(() => {
            expect(createObjectURL).toHaveBeenCalled();
        });
        expect(click).toHaveBeenCalled();
        expect(screen.getByText(/نُزّل ملخّص المراجعة/)).toBeTruthy();
    });
});
