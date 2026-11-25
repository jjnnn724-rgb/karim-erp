import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Zkteco } from './Zkteco';

const mocks = vi.hoisted(() => ({ role: 'viewer' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مستخدم الاختبار', username: 'tester', role: mocks.role },
    }),
}));

/**
 * jsdom بلا تخطيط: `clientHeight` دائمًا صفر، فـreact-virtual لا يرسم
 * VirtualItems. نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي يُختبر
 * مسار التمرير الافتراضي فعلًا — نفس نهج Sessions.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

const MAPPINGS_REGION = 'جدول ربط الموظفين بأرقام البصمة';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Zkteco />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    mocks.role = 'viewer';
});

describe('أجهزة البصمة', () => {
    it('يعرض حالة المحرك والأجهزة والبصمات والربط', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/zkteco/status')) {
                    return json({
                        running: true,
                        devices: [
                            {
                                id: 1,
                                name: 'بصمة المدخل',
                                ipAddress: '192.168.1.201',
                                port: 4370,
                                status: 'online',
                                enabled: true,
                                lastSyncAt: '2026-11-07T08:12:00.000Z',
                                totalSynced: 1520,
                                commKey: 12345,
                            },
                            {
                                id: 2,
                                name: 'بصمة المطبخ',
                                ipAddress: '192.168.1.202',
                                port: 4370,
                                status: 'offline',
                                enabled: false,
                                totalSynced: 0,
                                lastError: 'انتهت مهلة الاتصال',
                            },
                        ],
                        totals: {
                            logs: 9000,
                            unmapped: 12,
                            today: 84,
                            employees: 40,
                            linkedEmployees: 36,
                            unlinkedEmployees: 4,
                        },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('بصمة المدخل')).toBeTruthy();
        expect(screen.getByText('192.168.1.201:4370')).toBeTruthy();
        expect(screen.getByText('يعمل')).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();
        expect(screen.getByText('84')).toBeTruthy();
        expect(screen.getByText(/36/)).toBeTruthy();
        expect(screen.getByText(/انتهت مهلة الاتصال/)).toBeTruthy();
        expect(screen.queryByText(/12345/)).toBeNull();
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'ZK_FAILED', message: 'تعذّر جلب أجهزة البصمة' }, 500)),
        );
        renderScreen();

        expect(await screen.findByText('تعذّر جلب أجهزة البصمة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});

/**
 * ترحيل جدول ربط الموظفين إلى DataTable — نفس عقد اختبارات الجلسات:
 * تمرير افتراضي فوق 200 صف، فرز محلي على كل النتائج، بحث من جهة الشاشة،
 * الحالات الأربع برؤوس حقيقية، وبوابة الأدوار للكتابة كما كانت.
 */
interface FetchCall {
    url: string;
    method: string | undefined;
}

function mappingEmployee(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: String(index),
        name: `موظف ${String(index).padStart(3, '0')}`,
        employeeId: `E${String(index)}`,
        department: 'المطبخ',
        deviceUserId: String(index),
        todayPunches: index % 5,
        punches30d: index,
        ...overrides,
    };
}

function stubZk(options: {
    employees?: unknown[];
    unmapped?: unknown[];
    mappingsFail?: boolean;
    mappingsNeverResolve?: boolean;
    calls?: FetchCall[];
}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        options.calls?.push({ url, method: init?.method });
        if (url.includes('/api/zkteco/status')) {
            return json({
                running: true,
                devices: [
                    {
                        id: 1,
                        name: 'بصمة المدخل',
                        ipAddress: '192.168.1.201',
                        port: 4370,
                        status: 'online',
                        enabled: true,
                        totalSynced: 10,
                    },
                ],
                totals: { logs: 10, today: 2, employees: 3, linkedEmployees: 2, unlinkedEmployees: 1 },
            });
        }
        if (url.includes('/api/zkteco/mappings')) {
            if (options.mappingsNeverResolve) {
                return new Promise<Response>(() => {});
            }
            if (options.mappingsFail) {
                return json({ error: 'ZK_FAILED', message: 'تعذّر جلب الربط' }, 500);
            }
            return json({ employees: options.employees ?? [], unmapped: options.unmapped ?? [] });
        }
        return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('جدول ربط الموظفين بأرقام البصمة (DataTable)', () => {
    it('فوق 200 موظف: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const employees = Array.from({ length: 250 }, (_, index) => mappingEmployee(index + 1));
        stubZk({ employees });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
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
        stubZk({ employees: [mappingEmployee(1), mappingEmployee(2, { name: 'سالم الخاص' })] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await within(region).findAllByText('موظف 001');
        expect(region.querySelector('table')?.getAttribute('data-manual-filtering')).toBe('true');
        fireEvent.change(screen.getByPlaceholderText('بالاسم أو الرقم الوظيفي أو رقم البصمة'), {
            target: { value: 'سالم الخاص' },
        });
        expect(within(region).getAllByText('سالم الخاص').length).toBeGreaterThan(0);
        expect(within(region).queryByText('موظف 001')).toBeNull();
    });

    it('يرتّب محليًا على كل النتائج مع اتجاه تنازلي', async () => {
        stubZk({
            employees: [
                mappingEmployee(1, { name: 'أحمد' }),
                mappingEmployee(2, { name: 'سالم' }),
                mappingEmployee(3, { name: 'خالد' }),
            ],
        });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await within(region).findAllByText('أحمد');
        const sortButton = within(region).getByRole('button', { name: 'فرز حسب الموظف' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('سالم');
        expect(rows[2]?.textContent).toContain('أحمد');
        expect(
            within(region)
                .getByRole('columnheader', { name: /الموظف/ })
                .getAttribute('aria-sort'),
        ).toBe('descending');
    });

    it('حالة loading: الرؤوس الحقيقية تبقى مع aria-busy ورسالة حالة', async () => {
        stubZk({ mappingsNeverResolve: true });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        expect(region.getAttribute('data-state')).toBe('loading');
        expect(within(region).getByRole('table').getAttribute('aria-busy')).toBe('true');
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'رقم البصمة' })).toBeTruthy();
        expect(within(region).getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
    });

    it('حالة error: تنبيه داخل الجدول وإعادة المحاولة تعيد الجلب', async () => {
        const fetchMock = stubZk({ mappingsFail: true });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
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

    it('حالة empty: عنوان وتلميح مع بقاء الرؤوس', async () => {
        stubZk({ employees: [] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('empty');
        });
        expect(within(region).getByText('لا موظفين')).toBeTruthy();
        expect(within(region).getByText('تعذّر قراءة قائمة الموظفين أو لا يوجد موظفون.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
    });

    it('البحث بلا نتائج يعلن الحالة الفارغة ولا يخفي الرؤوس', async () => {
        stubZk({ employees: [mappingEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await within(region).findAllByText('موظف 001');
        fireEvent.change(screen.getByPlaceholderText('بالاسم أو الرقم الوظيفي أو رقم البصمة'), {
            target: { value: 'موظف غير موجود' },
        });
        expect(region.getAttribute('data-state')).toBe('empty');
        expect(within(region).getByText('لا نتائج مطابقة للبحث.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الموظف' })).toBeTruthy();
    });

    it('دور قارئ: لا عمود إجراء ولا أزرار ربط', async () => {
        mocks.role = 'viewer';
        stubZk({ employees: [mappingEmployee(1, { deviceUserId: '' })] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await within(region).findAllByText('موظف 001');
        expect(within(region).queryByRole('columnheader', { name: 'إجراء' })).toBeNull();
        expect(within(region).queryByRole('button', { name: 'ربط' })).toBeNull();
        expect(within(region).getAllByText('بلا رقم').length).toBeGreaterThan(0);
    });

    it('دور hr: زر الربط يفتح حوار رقم البصمة كما كان', async () => {
        mocks.role = 'hr';
        stubZk({ employees: [mappingEmployee(1, { deviceUserId: '' })] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        const button = await within(region).findByRole('button', { name: 'ربط' });
        fireEvent.click(button);
        expect(await screen.findByText('رقم البصمة للموظف')).toBeTruthy();
    });

    it('لا زر تصدير CSV للجدول — لم يكن في الشاشة القديمة ولا يُضاف الآن', async () => {
        stubZk({ employees: [mappingEmployee(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: MAPPINGS_REGION });
        await within(region).findAllByText('موظف 001');
        expect(within(region).queryByRole('button', { name: /تصدير/ })).toBeNull();
    });
});
