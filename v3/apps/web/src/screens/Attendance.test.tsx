import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIso } from '../lib/attendance';
import { ToastProvider } from '../ui/Toast';
import { Attendance } from './Attendance';

/**
 * الدور قابل للتغيير لكل اختبار — عمود الإجراء محكوم بـ`canWriteAttendance`
 * (admin/hr/manager). الافتراضي دور قراءة فقط كي تبقى اختبارات القراءة
 * الأصلية بلا أزرار كتابة، كما كانت قبل الترحيل إلى DataTable.
 */
const mocks = vi.hoisted(() => ({ role: '' }));
vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'Test User', username: 'test', role: mocks.role },
    }),
}));

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
                <Attendance />
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

interface AttendanceRecord {
    id: number;
    employeeId: number;
    date: string;
    checkIn: string;
    checkOut: string;
    source: string;
    workMinutes: number;
    status: string;
}

/** سجلات أيام متتالية من الشهر الحالي — الترتيب الأصلي تصاعدي بالتاريخ. */
function makeRecords(count: number): AttendanceRecord[] {
    return Array.from({ length: count }, (_, index) => ({
        id: 501 + index,
        employeeId: 7,
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        checkIn: '08:00',
        checkOut: '16:00',
        source: 'device',
        workMinutes: 480,
        status: 'present',
    }));
}

function stubFetch(records: AttendanceRecord[], calls?: { url: string; method: string | undefined }[]): void {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        calls?.push({ url, method: init?.method });
        if (url.includes('/api/attendance/range')) {
            return json({ data: records, total: records.length });
        }
        if (url.includes('/api/employees')) {
            return json({
                data: [{ id: 7, name: 'أحمد علي', employeeId: 'EMP-007', department: 'KITCHEN', status: 'active' }],
                pagination: { totalPages: 1 },
            });
        }
        if (url.includes('/api/hrDepartments')) {
            return json({ data: [{ code: 'KITCHEN', name: 'المطبخ' }], pagination: { totalPages: 1 } });
        }
        if (url.includes('/api/hr/leave-workflow')) {
            return json([]);
        }
        return json({ error: 'NOT_FOUND' });
    });
    vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
    mocks.role = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('الحضور والانصراف', () => {
    it('يعرض سجل الفترة ومؤشرات اليوم من أبواب القراءة فقط', async () => {
        const calls: { url: string; method: string | undefined }[] = [];
        stubFetch(
            [
                {
                    id: 501,
                    employeeId: 7,
                    date: todayIso(),
                    checkIn: '08:00',
                    checkOut: '16:00',
                    source: 'device',
                    workMinutes: 480,
                    status: 'present',
                },
            ],
            calls,
        );

        renderScreen();

        // الاسم يظهر في الجدول وبطاقة الجوال معًا.
        expect((await screen.findAllByText('أحمد علي')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getByText('متوسط العمل')).toBeTruthy();
        // دور قراءة فقط: لا عمود إجراء ولا أزرار تصحيح.
        expect(screen.queryByRole('columnheader', { name: 'إجراء' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'تصحيح' })).toBeNull();
        expect(calls.some((call) => call.url.includes('/api/attendance/range'))).toBe(true);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });

    it('يرفض نطاق تاريخ معكوس قبل طلبه', async () => {
        const urls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                urls.push(url);
                return json({ data: [], total: 0 });
            }),
        );
        renderScreen();
        await screen.findByText('إجمالي السجلات');

        const from = screen.getByLabelText('من');
        const to = screen.getByLabelText('إلى');
        fireEvent.change(from, { target: { value: '2026-11-20' } });
        fireEvent.change(to, { target: { value: '2026-11-01' } });
        const before = urls.filter((url) => url.includes('/api/attendance/range')).length;
        screen.getByRole('button', { name: 'عرض الفترة' }).click();
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(urls.filter((url) => url.includes('/api/attendance/range'))).toHaveLength(before);
    });

    it('يرقّم محليًا 20 سجلًا للصفحة ولا يفعّل التمرير الافتراضي تحت العتبة', async () => {
        stubFetch(makeRecords(25));

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'سجل الحضور والانصراف' });
        await within(sheet).findAllByText('أحمد علي');
        expect(sheet.getAttribute('data-row-count')).toBe('20');
        expect(sheet.getAttribute('data-virtualized')).toBe('false');
        expect(within(sheet).getAllByTestId('datatable-row')).toHaveLength(20);
        expect(screen.getByText('1–20 من 25')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
        expect(within(sheet).getAllByTestId('datatable-row')).toHaveLength(5);
        expect(screen.getByText('21–25 من 25')).toBeTruthy();
    });

    it('يفرز كامل النتائج المرشّحة قبل التقطيع ويعيد الصفحة الأولى', async () => {
        stubFetch(makeRecords(25));

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'سجل الحضور والانصراف' });
        await within(sheet).findAllByText('أحمد علي');
        // الصفحة الأولى تصاعديًا تبدأ بـ2026-11-01؛ آخر تاريخ (25) في الصفحة الثانية.
        expect(within(sheet).getAllByTestId('datatable-row')[0]?.textContent).toContain('2026-11-01');

        const sortButton = within(sheet).getByRole('button', { name: 'فرز حسب التاريخ' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(sheet).getAllByTestId('datatable-row');
        // تنازليًا على كامل المجموعة: 2026-11-25 يتصدر الصفحة الأولى الآن.
        expect(rows[0]?.textContent).toContain('2026-11-25');
        expect(rows).toHaveLength(20);
        expect(screen.getByText('1–20 من 25')).toBeTruthy();
        expect(
            within(sheet)
                .getByRole('columnheader', { name: /التاريخ/ })
                .getAttribute('aria-sort'),
        ).toBe('descending');
    });

    it('يصدّر CSV لكل السجلات الظاهرة (عبر الصفحات) لا الصفحة الحالية فقط', async () => {
        stubFetch(makeRecords(25));
        const blobs: Blob[] = [];
        const downloads: string[] = [];
        const createObjectURL = vi.fn((blob: Blob) => {
            blobs.push(blob);
            return 'blob:attendance';
        });
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
        });

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'سجل الحضور والانصراف' });
        await within(sheet).findAllByText('أحمد علي');
        fireEvent.click(screen.getByRole('button', { name: 'تصدير CSV' }));

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(downloads[0]).toMatch(/^attendance_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
        const csv = await blobCsv(blobs[0] as Blob);
        // ترويسة + 25 سجلًا كاملًا رغم أن الصفحة الأولى تعرض 20 فقط.
        expect(csv.split('\r\n')).toHaveLength(26);
        expect(csv).toContain('2026-11-25');
    });

    it('يظهر عمود الإجراء وزر التصحيح للأدوار الكاتبة فقط', async () => {
        mocks.role = 'hr';
        stubFetch(makeRecords(1));

        renderScreen();

        const sheet = await screen.findByRole('region', { name: 'سجل الحضور والانصراف' });
        await within(sheet).findAllByText('أحمد علي');
        expect(within(sheet).getByRole('columnheader', { name: 'إجراء' })).toBeTruthy();
        expect(within(sheet).getAllByRole('button', { name: 'تصحيح' })).toHaveLength(1);
        // بطاقة الجوال تحمل الإجراء نفسه.
        const cards = screen.getByRole('list', { name: 'سجل الحضور والانصراف — بطاقات' });
        expect(within(cards).getAllByRole('button', { name: 'تصحيح' })).toHaveLength(1);
    });
});
