import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 * jsdom بلا تخطيط: نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي
 * يُختبر مسار التمرير الافتراضي لجدولي الموظفين والمعاينة فعلًا — نفس نهج
 * Sessions.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

const EMP_REGION = 'جاهزية بيانات الصرف لكل موظف';
const GOSI_REGION = 'معاينة اشتراكات التأمينات';

// jsdom بلا URL.revokeObjectURL — الإبطال المؤجل في downloadTextFile (بعد ثانية)
// يجب ألا يتسرب كخطأ غير معالج أيًا كان ترتيب الاختبارات.
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true, configurable: true });

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
                        requirements: [
                            { id: 'r1', title_ar: 'IBAN لكل موظف', requirement: 'IBAN صحيح', status: 'TODO' },
                        ],
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

/**
 * ترحيل جدولي الموظفين ومعاينة التأمينات إلى DataTable — نفس عقد اختبارات
 * الجلسات: تمرير افتراضي فوق 200 صف، فرز محلي، بحث من جهة الشاشة، الحالات
 * الأربع برؤوس حقيقية، وبوابة الأدوار (admin فقط للاستكمال). تصدير الشاشة
 * الكامل (BOM/حماية الصيغ/اسم الملف) يبقى في قسم كشف المراجعة بلا تغيير.
 */
function wpsEmployee(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        employee_id: String(index),
        name: `موظف ${String(index).padStart(3, '0')}`,
        id_number: `1${String(index).padStart(9, '0')}`,
        iban_masked: 'SA03**********7519',
        nationality: 'SA',
        salary: 5000,
        issues: [],
        ready: true,
        ...overrides,
    };
}

function stubMudad(options: {
    employees?: unknown[];
    readinessFail?: boolean;
    readinessNeverResolve?: boolean;
    previewLines?: unknown[];
}) {
    const month = previousMonth();
    const employees = options.employees ?? [];
    const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/wps/requirements')) {
            return json({
                month,
                provider: { code: 'mudad', verification: 'BLOCKED' },
                requirements: [{ id: 'r1', title_ar: 'IBAN لكل موظف', requirement: 'IBAN صحيح', status: 'TODO' }],
            });
        }
        if (url.includes('/wps/readiness')) {
            if (options.readinessNeverResolve) {
                return new Promise<Response>(() => {});
            }
            if (options.readinessFail) {
                return new Response(JSON.stringify({ error: 'SERVER', message: 'تعذّر تحميل الجاهزية' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return json({
                month,
                summary: {
                    month,
                    employees: employees.length,
                    ready: employees.length,
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
                employees,
                truncated: false,
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
        if (url.includes('/gosi/preview')) {
            const lines = options.previewLines ?? [];
            return json({
                month,
                rate_set: { id: 'legacy_before_2024_07', label_ar: 'مسجّل قبل 2024-07-03', verified: false },
                basis: 'salary',
                estimate: false,
                lines,
                unclassified: [],
                totals: { employee: 0, employer: 0, total: 0 },
                warnings: [],
            });
        }
        if (url.includes('/qiwa/readiness')) {
            return json({
                provider: { code: 'qiwa', verification: 'UNVERIFIED' },
                checks: [{ id: 'contracts', label_ar: 'عقود العمل', ok: true, detail: '3 عقد' }],
                ready: true,
            });
        }
        if (url.includes('/api/integration/health')) {
            return json({ providers: [], outbox: null, infra: { migration_145: true } });
        }
        if (url.includes('/api/integration/outbox')) {
            return json({ rows: [] });
        }
        if (url.includes('/api/integration/events')) {
            return json({ rows: [] });
        }
        return json({ error: 'NOT_FOUND' });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('جدول جاهزية الموظفين (DataTable)', () => {
    it('فوق 200 موظف: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const employees = Array.from({ length: 250 }, (_, index) => wpsEmployee(index + 1));
        stubMudad({ employees });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('موظف 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        expect(within(region).getByRole('table').getAttribute('aria-rowcount')).toBe('251');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    });

    it('البحث من جهة الشاشة لا الجدول (manualFiltering)', async () => {
        stubMudad({ employees: [wpsEmployee(1), wpsEmployee(2, { name: 'سالم الخاص' })] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('موظف 001');
        expect(region.querySelector('table')?.getAttribute('data-manual-filtering')).toBe('true');
        fireEvent.change(screen.getByPlaceholderText('الاسم أو الرقم أو الجنسية…'), {
            target: { value: 'سالم الخاص' },
        });
        expect(within(region).getAllByText('سالم الخاص').length).toBeGreaterThan(0);
        expect(within(region).queryByText('موظف 001')).toBeNull();
    });

    it('يرتّب الرواتب محليًا على كل النتائج مع اتجاه تنازلي', async () => {
        stubMudad({
            employees: [
                wpsEmployee(1, { name: 'صغير', salary: 100 }),
                wpsEmployee(2, { name: 'كبير', salary: 300 }),
                wpsEmployee(3, { name: 'وسط', salary: 200 }),
            ],
        });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('كبير');
        const sortButton = within(region).getByRole('button', { name: 'فرز حسب الراتب' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('كبير');
        expect(rows[0]?.textContent).toContain('300.00');
        expect(rows[2]?.textContent).toContain('صغير');
        expect(
            within(region)
                .getByRole('columnheader', { name: /الراتب/ })
                .getAttribute('aria-sort'),
        ).toBe('descending');
    });

    it('حالة loading: الرؤوس الحقيقية تبقى مع aria-busy ورسالة حالة', async () => {
        stubMudad({ readinessNeverResolve: true });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        expect(region.getAttribute('data-state')).toBe('loading');
        expect(within(region).getByRole('table').getAttribute('aria-busy')).toBe('true');
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'IBAN' })).toBeTruthy();
        expect(within(region).getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
    });

    it('حالة error: تنبيه داخل الجدول وإعادة المحاولة تعيد الجلب', async () => {
        const fetchMock = stubMudad({ readinessFail: true });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('error');
        });
        expect(within(region).getByRole('alert')).toBeTruthy();
        const before = fetchMock.mock.calls.length;
        fireEvent.click(within(region).getByRole('button', { name: 'إعادة المحاولة' }));
        await vi.waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
        });
    });

    it('حالة empty: لا موظفون نشطون مع بقاء الرؤوس', async () => {
        stubMudad({ employees: [] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('empty');
        });
        expect(within(region).getByText('لا موظفون نشطون')).toBeTruthy();
        expect(within(region).getByText('يظهر الموظفون النشطون فقط في هذا الملف.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
    });

    it('البحث بلا نتائج يعلن الحالة الفارغة ولا يخفي الرؤوس', async () => {
        stubMudad({ employees: [wpsEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('موظف 001');
        fireEvent.change(screen.getByPlaceholderText('الاسم أو الرقم أو الجنسية…'), {
            target: { value: 'موظف غير موجود' },
        });
        expect(region.getAttribute('data-state')).toBe('empty');
        expect(within(region).getByText('لا موظفون مطابقون')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
    });

    it('دور manager: لا عمود إجراء ولا زر استكمال', async () => {
        mocks.role = 'manager';
        stubMudad({ employees: [wpsEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('موظف 001');
        expect(within(region).queryByRole('columnheader', { name: 'إجراء' })).toBeNull();
        expect(within(region).queryByRole('button', { name: 'تعديل بيانات الصرف' })).toBeNull();
    });

    it('دور admin: زر الاستكمال يفتح نموذج بيانات الصرف كما كان', async () => {
        mocks.role = 'admin';
        stubMudad({ employees: [wpsEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        const button = await within(region).findByRole('button', { name: 'تعديل بيانات الصرف' });
        fireEvent.click(button);
        expect(await screen.findByText(/استكمال بيانات الصرف — موظف 001/)).toBeTruthy();
    });

    it('لا تصدير CSV للجدول نفسه — تصدير الشاشة الكامل يبقى في كشف المراجعة', async () => {
        stubMudad({ employees: [wpsEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: EMP_REGION });
        await within(region).findAllByText('موظف 001');
        expect(within(region).queryByRole('button', { name: /تصدير/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'تنزيل ملخّص CSV' })).toBeTruthy();
    });
});

describe('جدول معاينة التأمينات (DataTable)', () => {
    function previewLine(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            employee_id: String(index),
            name: `موظف ${String(index).padStart(3, '0')}`,
            category: 'saudi',
            wage: 5000,
            basis: 'salary',
            employee: 487.5,
            employer: 587.5,
            total: 1075,
            below_minimum: false,
            ...overrides,
        };
    }

    it('اختيار النسب صراحةً يعرض المعاينة، وفوق 200 صف تمرير افتراضي', async () => {
        const lines = Array.from({ length: 250 }, (_, index) => previewLine(index + 1));
        stubMudad({ employees: [wpsEmployee(1)], previewLines: lines });
        renderScreen();

        await screen.findByText('IBAN لكل موظف');
        expect(screen.queryByRole('region', { name: GOSI_REGION })).toBeNull();
        fireEvent.click(screen.getByRole('radio'));
        const region = await screen.findByRole('region', { name: GOSI_REGION });
        await within(region).findAllByText('موظف 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
    });

    it('يرتّب الأجر محليًا مع اتجاه تنازلي', async () => {
        stubMudad({
            employees: [wpsEmployee(1)],
            previewLines: [
                previewLine(1, { name: 'صغير', wage: 100 }),
                previewLine(2, { name: 'كبير', wage: 300 }),
                previewLine(3, { name: 'وسط', wage: 200 }),
            ],
        });
        renderScreen();

        await screen.findByText('IBAN لكل موظف');
        fireEvent.click(screen.getByRole('radio'));
        const region = await screen.findByRole('region', { name: GOSI_REGION });
        await within(region).findAllByText('كبير');
        const sortButton = within(region).getByRole('button', { name: 'فرز حسب الأجر' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('كبير');
        expect(rows[0]?.textContent).toContain('300.00');
        expect(rows[2]?.textContent).toContain('صغير');
    });

    it('معاينة بلا صفوف: حالة فارغة بتلميح مع بقاء الرؤوس', async () => {
        stubMudad({ employees: [wpsEmployee(1)], previewLines: [] });
        renderScreen();

        await screen.findByText('IBAN لكل موظف');
        fireEvent.click(screen.getByRole('radio'));
        const region = await screen.findByRole('region', { name: GOSI_REGION });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('empty');
        });
        expect(within(region).getByText('لا صفوف محسوبة')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الأجر' })).toBeTruthy();
    });
});
