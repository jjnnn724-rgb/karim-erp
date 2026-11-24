import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { InventoryMovements } from './InventoryMovements';

/**
 * الحركات تُعرض كما يعيدها `/api/inventoryTx`: نوع معروف بترجمته، ونوع
 * مجهول بشارة «افتتاحي» مع القيمة الخام — نفس قاعدة القديم حرفيًا.
 * الجدول الآن DataTable: الصفوف في الجدول وبطاقات الجوال معًا، فاستعلامات
 * النص تُنطاق داخل الجدول أو تُجمع بـgetAllByText.
 */

const movements = {
    data: [
        {
            id: 1,
            itemName: 'لحم بقري',
            type: 'in',
            date: '2026-11-03',
            qty: '12.500',
            cost: '80',
            totalValue: '1000',
            invoiceNumber: 'INV-9',
        },
        {
            id: 2,
            itemName: 'لحم بقري',
            type: 'out',
            date: '2026-11-04',
            qty: '3',
            cost: '80',
            totalValue: '250.50',
            dispatchId: 44,
        },
        {
            id: 3,
            itemName: 'دقيق',
            type: 'return',
            date: '2026-11-05',
            qty: '2',
            cost: '5',
            totalValue: '10',
            notes: 'مرتجع مطبخ',
        },
        {
            id: 4,
            itemName: 'زيت',
            type: 'opening',
            date: '2026-11-01',
            qty: '7',
            cost: '20',
            totalValue: '140',
            notes: null,
        },
    ],
    pagination: { totalPages: 1 },
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر جلب الحركات' }, 500);
            }
            if (String(url).includes('/api/inventoryTx')) {
                return json(movements);
            }
            if (String(url).includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
}

/** حركات مولّدة لاختبار الترقيم وعتبة التمرير الافتراضي وسقف الجلب. */
function stubFetchMany(count: number): void {
    const data = Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        itemName: `صنف ${String(index + 1)}`,
        type: 'in',
        date: '2026-11-01',
        qty: '1',
        cost: '1',
        totalValue: '1',
        invoiceNumber: `INV-${String(index + 1)}`,
    }));
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (String(url).includes('/api/inventoryTx')) {
                return json({ data, pagination: { totalPages: 1 } });
            }
            if (String(url).includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <InventoryMovements />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function dataRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
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

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('حركات المخزون', () => {
    it('يعرض الوارد والصادر والصافي ويترجم الأنواع', async () => {
        stubFetch();
        renderScreen();

        await screen.findAllByText('لحم بقري');

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('حركات المخزون');
        expect(screen.getByText('1,000.00 SAR')).toBeTruthy();
        expect(screen.getByText('250.50 SAR')).toBeTruthy();
        expect(screen.getByText('749.50 SAR')).toBeTruthy();

        expect(dataRows()).toHaveLength(4);
        const incoming = screen.getAllByText('لحم بقري')[0]?.closest('tr') as HTMLElement;
        expect(within(incoming).getByText('وارد')).toBeTruthy();
        expect(within(incoming).getByText('12.5')).toBeTruthy();
        expect(within(incoming).getByText('INV-9')).toBeTruthy();

        const unknown = screen.getAllByText('زيت')[0]?.closest('tr') as HTMLElement;
        expect(within(unknown).getByText(/افتتاحي/)).toBeTruthy();
        expect(within(unknown).getByText(/\(opening\)/)).toBeTruthy();
    });

    it('يترشّح بالنوع ويبحث بالصنف أو المرجع', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('لحم بقري');

        fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'out' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(within(dataRows()[0] as HTMLElement).getByText('44')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'ALL' } });
        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'دقيق' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(within(dataRows()[0] as HTMLElement).getByText('مرتجع مطبخ')).toBeTruthy();
    });

    it('يرفض فترة معكوسة قبل العرض', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('لحم بقري');

        fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-11-30' } });
        fireEvent.change(screen.getByLabelText('إلى'), { target: { value: '2026-11-01' } });

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('بداية الفترة بعد نهايتها');
        });
        // عقد الحالات الأربع: الرؤوس تبقى والحالة الفارغة معلَنة بعنوان وتلميح.
        const table = screen.getByTestId('datatable');
        expect(table.getAttribute('data-state')).toBe('empty');
        expect(screen.getByText('لا حركات')).toBeTruthy();
        expect(screen.getByText('صحّح التاريخين أولًا.')).toBeTruthy();
        expect(screen.queryByTestId('datatable-row')).toBeNull();
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('يرقّم 50 حركة للصفحة ويتنقل بين الصفحات', async () => {
        stubFetchMany(60);
        renderScreen();

        const table = screen.getByTestId('datatable');
        await screen.findAllByText('صنف 1');
        expect(table.getAttribute('data-row-count')).toBe('50');
        expect(screen.getAllByTestId('datatable-row')).toHaveLength(50);
        expect(screen.getByText('1–50 من 60 حركة')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
        expect(screen.getAllByTestId('datatable-row')).toHaveLength(10);
        expect(screen.getByText('51–60 من 60 حركة')).toBeTruthy();
        expect(screen.getAllByText('صنف 51').length).toBeGreaterThan(0);
    });

    it('لا يفعّل التمرير الافتراضي على صفحة من 50 صفًا رغم تحميل 500 حركة', async () => {
        stubFetchMany(500);
        renderScreen();

        await screen.findAllByText('صنف 1');
        const table = screen.getByTestId('datatable');
        // العتبة (> 200) تُقاس على الصفوف المرسومة فعلًا — صفحة الترقيم الحالية.
        expect(table.getAttribute('data-virtualized')).toBe('false');
        expect(table.getAttribute('data-row-count')).toBe('50');
        expect(screen.getAllByTestId('datatable-row')).toHaveLength(50);
    });

    it('يعلن سقف الجلب (8 صفحات) في ملخص الترقيم', async () => {
        stubFetchMany(8000);
        renderScreen();

        await screen.findAllByText('صنف 1');
        expect(screen.getByText(/الخادم أعاد أول 8,000 حركة فقط/)).toBeTruthy();
    });

    it('يصدّر الصفحة الحالية CSV بترويسة الأعمدة وقيمها المعلنة', async () => {
        stubFetch();
        const blobs: Blob[] = [];
        const downloads: string[] = [];
        const createObjectURL = vi.fn((blob: Blob) => {
            blobs.push(blob);
            return 'blob:movements';
        });
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
        });

        renderScreen();
        await screen.findAllByText('لحم بقري');
        fireEvent.click(screen.getByRole('button', { name: 'تصدير الصفحة الحالية CSV' }));

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(downloads).toEqual(['حركات-المخزون.csv']);
        const csv = await blobCsv(blobs[0] as Blob);
        expect(csv.split('\r\n')[0]).toBe('"التاريخ","الصنف","النوع","الكمية","السعر","القيمة","المرجع"');
        expect(csv.split('\r\n')).toHaveLength(5);
        expect(csv).toContain('لحم بقري');
        expect(csv).toContain('افتتاحي (opening)');
    });

    it('يعرض بطاقات الجوال بنفس قيم الجدول', async () => {
        stubFetch();
        renderScreen();

        await screen.findAllByText('لحم بقري');
        const cards = screen.getByRole('list', { name: 'جدول حركات المخزون — بطاقات' });
        expect(within(cards).getAllByText('لحم بقري')).toHaveLength(2);
        expect(within(cards).getByText('مرتجع مطبخ')).toBeTruthy();
    });

    it('يطبّق الفترات السريعة بنقرة واحدة', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('لحم بقري');

        const from = screen.getByLabelText('من') as HTMLInputElement;
        const preset = screen.getByRole('button', { name: 'هذا الشهر' });
        expect(preset.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'كل الفترات' }));
        expect(from.value).toBe('');
        expect(screen.getByRole('button', { name: 'كل الفترات' }).getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'اليوم' }));
        expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect((screen.getByLabelText('إلى') as HTMLInputElement).value).toBe(from.value);
    });

    it('يعرض المرشّحات النشطة كشرائح قابلة للإزالة', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('لحم بقري');

        fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'in' } });
        const chips = screen.getByRole('list', { name: 'المرشّحات النشطة' });
        expect(within(chips).getByText('وارد')).toBeTruthy();

        fireEvent.click(within(chips).getByRole('button', { name: 'إزالة مرشّح النوع' }));
        expect((screen.getByLabelText('النوع') as HTMLSelectElement).value).toBe('ALL');
        await waitFor(() => {
            expect(dataRows()).toHaveLength(4);
        });
    });
});
