import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { currentMonth } from '../lib/payroll';
import { ToastProvider } from '../ui/Toast';
import { Payroll } from './Payroll';

/**
 * jsdom بلا تخطيط: `clientHeight` دائمًا صفر، فـreact-virtual لا يرسم
 * VirtualItems. نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي يُختبر
 * مسار التمرير الافتراضي في الكشف فعلًا — نفس نهج DataTable.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

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
                <ConfirmProvider>
                    <Payroll />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

/** بايتات Blob عبر FileReader — للتحقق من BOM ثم فك الترميز يدويًا. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

/** يفكّ CSV مع التحقق من بادئة UTF-8 (BOM) التي يزيلها FileReader تلقائيًا. */
async function blobCsv(blob: Blob): Promise<string> {
    const bytes = await blobBytes(blob);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    return new TextDecoder('utf-8').decode(bytes.slice(3));
}

interface FetchCall {
    url: string;
    method: string | undefined;
}

/**
 * خادم الاختبار — مسيرات وكشف وموظفون وأقسام من أبواب القراءة فقط.
 * `employees` تتحكم بحجم الكشف لاختبار عتبة التمرير الافتراضي (> 200).
 */
function stubFetch(options: { runs?: unknown[]; employees?: unknown[]; calls?: FetchCall[] }): void {
    const runs = options.runs ?? [
        {
            id: 11,
            month: '2026-10',
            status: 'approved',
            employee_count: 2,
            total_basic: '10000.00',
            total_overtime: '500.00',
            total_bonuses: '250.00',
            total_penalties: '50.00',
            total_advances: '100.00',
            total_net: '10600.00',
        },
    ];
    const employees = options.employees ?? [
        {
            id: 7,
            name: 'أحمد علي',
            department: 'KITCHEN',
            position: 'شيف',
            status: 'active',
            salary: '5000.00',
        },
        { id: 8, name: 'منى حسن', department: 'SERVICE', position: 'مضيفة', status: 'active' },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        options.calls?.push({ url, method: init?.method });
        if (url.includes('/api/payroll_runs')) {
            return json({ data: runs, pagination: { totalPages: 1 } });
        }
        if (url.includes('/api/employees')) {
            return json({ data: employees, pagination: { totalPages: 1 } });
        }
        if (url.includes('/api/attendance/range')) {
            return json({
                data: [
                    { employeeId: 7, checkIn: '08:00' },
                    { employeeId: 8, checkIn: '09:00' },
                ],
            });
        }
        if (url.includes('/api/hrDepartments')) {
            return json({
                data: [
                    { code: 'KITCHEN', name: 'المطبخ' },
                    { code: 'SERVICE', name: 'الصالة' },
                ],
                pagination: { totalPages: 1 },
            });
        }
        return json({ error: 'NOT_FOUND' });
    });
    vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('الرواتب', () => {
    it('يعرض المسيرات والكشف من مصادره ولا يرسل أي كتابة', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });

        renderScreen();

        // الاسم يظهر في الجدول وبطاقة الجوال معًا — ننتظر ظهوره في أيهما.
        expect((await screen.findAllByText('أحمد علي')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-10').length).toBeGreaterThan(0);
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('5000.00').length).toBeGreaterThan(0);
        expect(screen.getByText(/1 راتبًا مرئيًا/)).toBeTruthy();
        expect(screen.getByText(/1 مخفي بقرار الخادم/)).toBeTruthy();
        expect(calls.some((call) => call.url.includes('/api/payroll_runs'))).toBe(true);
        expect(calls.some((call) => call.url.includes(`/api/attendance/range?from=${currentMonth()}-01`))).toBe(true);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });

    it('الكشف فوق 200 صف: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const employees = Array.from({ length: 250 }, (_, index) => ({
            id: index + 1,
            name: `موظف ${String(index + 1).padStart(3, '0')}`,
            department: 'KITCHEN',
            position: 'عامل',
            status: 'active',
            salary: '3000.00',
        }));
        stubFetch({ runs: [], employees });

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'كشف رواتب الموظفين' });
        await within(sheet).findAllByText('موظف 001');
        expect(sheet.getAttribute('data-virtualized')).toBe('true');
        expect(sheet.getAttribute('data-row-count')).toBe('250');
        expect(within(sheet).getByRole('table').getAttribute('aria-rowcount')).toBe('251');
        const rendered = within(sheet).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
        // المسيرات الفارغة تبقى حالة فارغة معلَنة لا منطقة بيضاء.
        const runs = screen.getByRole('region', { name: 'سجل مسيرات الرواتب' });
        expect(await within(runs).findByText('لا مسيرات في هذا العرض')).toBeTruthy();
        expect(runs.getAttribute('data-state')).toBe('empty');
    });

    it('يرتّب الكشف محليًا على كل النتائج (لا ترقيم) مع اتجاه تنازلي', async () => {
        stubFetch({});

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'كشف رواتب الموظفين' });
        await within(sheet).findAllByText('أحمد علي');
        const sortButton = within(sheet).getByRole('button', { name: 'فرز حسب الموظف' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(sheet).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('منى حسن');
        expect(
            within(sheet)
                .getByRole('columnheader', { name: /الموظف/ })
                .getAttribute('aria-sort'),
        ).toBe('descending');
    });

    it('يرتّب المسيرات بالمبلغ رقميًا لا نصيًا', async () => {
        stubFetch({
            runs: [
                {
                    id: 11,
                    month: '2026-10',
                    status: 'approved',
                    employee_count: 2,
                    total_basic: '10000.00',
                    total_overtime: '500.00',
                    total_bonuses: '250.00',
                    total_penalties: '50.00',
                    total_advances: '100.00',
                    total_net: '10600.00',
                },
                {
                    id: 12,
                    month: '2026-09',
                    status: '',
                    employee_count: 1,
                    total_basic: '500.00',
                    total_overtime: '0.00',
                    total_bonuses: '0.00',
                    total_penalties: '0.00',
                    total_advances: '0.00',
                    total_net: '500.00',
                },
            ],
        });

        renderScreen();

        const runs = await screen.findByRole('region', { name: 'سجل مسيرات الرواتب' });
        await within(runs).findAllByText('2026-10');
        fireEvent.click(within(runs).getByRole('button', { name: 'فرز حسب الصافي' }));
        const rows = within(runs).getAllByTestId('datatable-row');
        // 500.00 قبل 10600.00 — الفرز النصي كان يضع '10600.00' أولًا.
        expect(rows[0]?.textContent).toContain('500.00');
        expect(rows[1]?.textContent).toContain('10600.00');
    });

    it('يصدّر الكشف كاملًا (كل المطابقين) باسم الشهر وبترميز UTF-8', async () => {
        stubFetch({});
        const blobs: Blob[] = [];
        const downloads: string[] = [];
        const createObjectURL = vi.fn((blob: Blob) => {
            blobs.push(blob);
            return 'blob:payroll';
        });
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
        });

        renderScreen();

        await screen.findAllByText('أحمد علي');
        fireEvent.click(screen.getByRole('button', { name: 'تصدير CSV' }));

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(downloads).toEqual([`payroll_${currentMonth()}.csv`]);
        const csv = await blobCsv(blobs[0] as Blob);
        expect(csv).toContain('أحمد علي');
        expect(csv).toContain('منى حسن');
        // ترويسة + موظفان: الراتب المخفي بقرار الخادم خانة فارغة لا رقمًا مخمَّنًا.
        expect(csv.split('\r\n')).toHaveLength(3);
    });
});
