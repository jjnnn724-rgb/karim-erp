import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ApiError } from '../lib/api';
import { INVENTORY_TEXT } from '../lib/inventory-write';
import { ToastProvider } from '../ui/Toast';
import { Warehouse } from './Warehouse';

/**
 * شاشة المخزون — القراءة بقواعد V2، والكتابة بأبوابها الأربعة (+ الدمج):
 * زر لكل عملية يظهر بقائمة الدور نفسها، تأكيد/نجاح/خطأ بنصوص V2، وإبطال
 * استعلام السجل بعد كل كتابة بلا إعادة تحميل كاملة.
 */

const mocks = vi.hoisted(() => ({
    role: 'warehouse',
    receiveInventoryItem: vi.fn(),
    directEditInventoryItem: vi.fn(),
    deleteInventoryItem: vi.fn(),
    forceDeleteInventoryItem: vi.fn(),
    mergeInventoryItems: vi.fn(),
    submitBulkReceipt: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مستخدم اختبار', username: 'test', role: mocks.role },
    }),
}));

vi.mock('../lib/inventory-write', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/inventory-write')>();
    return {
        ...original,
        receiveInventoryItem: mocks.receiveInventoryItem,
        directEditInventoryItem: mocks.directEditInventoryItem,
        deleteInventoryItem: mocks.deleteInventoryItem,
        forceDeleteInventoryItem: mocks.forceDeleteInventoryItem,
        mergeInventoryItems: mocks.mergeInventoryItems,
    };
});

vi.mock('../lib/inventory-bulk', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/inventory-bulk')>();
    return { ...original, submitBulkReceipt: mocks.submitBulkReceipt };
});

const items = [
    {
        id: 1,
        name: 'باذنجان',
        category: 'خضروات',
        unit: 'كجم',
        qty: '0',
        minQty: '5',
        mainQty: '0',
        barcode: '6221',
        shelfId: 7,
    },
    { id: 2, name: 'طماطم', category: 'خضروات', unit: 'كجم', qty: '3', minQty: '10', mainQty: '1', shelfId: null },
    { id: 3, name: 'دجاج', category: 'لحوم', unit: 'كجم', qty: '12', minQty: '5', mainQty: '12', shelfId: 8 },
    { id: 4, name: 'زيت', category: 'زيوت', unit: 'لتر', qty: '20', minQty: '0', mainQty: '15', shelfId: 7 },
    { id: 5, name: 'أرز', category: 'غلال', unit: 'كجم', qty: '7', minQty: '5' },
];

const duplicateItems = [
    ...items,
    { id: 6, name: 'باذنجان', category: 'خضروات', unit: 'كجم', qty: '2', minQty: '5', mainQty: '2', shelfId: 7 },
];

const shelves = [
    { id: 7, code: 'V-01', name: 'رف الخضروات' },
    { id: 8, code: 'M-02', name: 'رف اللحوم' },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false, source = items): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر جلب المخزون' }, 500);
            }
            if (target.includes('/api/shelves')) {
                return json({ data: shelves, pagination: { totalPages: 1 } });
            }
            if (target.includes('/api/warehouse/inventory/search')) {
                const params = new URL(target, 'http://local').searchParams;
                const q = params.get('q') ?? '';
                const category = params.get('category') ?? 'all';
                const stock = params.get('stock') ?? 'all';
                const matches = (item: (typeof items)[number]) => {
                    if (q && !String(item.name).includes(q)) {
                        return false;
                    }
                    if (category !== 'all' && item.category !== category) {
                        return false;
                    }
                    if (stock === 'out') {
                        return Number(item.qty) <= 0;
                    }
                    if (stock === 'low') {
                        return Number(item.qty) > 0 && Number(item.qty) <= Number(item.minQty);
                    }
                    if (stock === 'ok') {
                        return Number(item.qty) > Number(item.minQty);
                    }
                    return true;
                };
                let data = source.filter(matches);
                let fuzzy = false;
                if (q === 'بازنجان' && data.length === 0) {
                    data = source.filter((item) => item.name === 'باذنجان');
                    fuzzy = data.length > 0;
                }
                return json({
                    data,
                    pagination: { page: 1, limit: 200, total: data.length, pages: 1 },
                    categories: [...new Set(source.map((item) => item.category))].sort(),
                    fuzzy,
                });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Warehouse />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
    return { client, invalidate };
}

function register(): HTMLElement {
    return screen.getByLabelText('جدول المخزون');
}

function registerRows(): HTMLElement[] {
    return within(register()).getAllByRole('row').slice(1);
}

function rowByText(name: string): HTMLElement {
    const cell = within(register()).getByText(name);
    return cell.closest('tr') as HTMLElement;
}

function summaryLine(): string {
    return screen.getByRole('status').textContent ?? '';
}

function submitForm(id: string): void {
    const form = document.getElementById(id);
    if (!form) {
        throw new Error(`النموذج ${id} غير موجود`);
    }
    fireEvent.submit(form);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'warehouse';
    mocks.receiveInventoryItem.mockResolvedValue(undefined);
    mocks.directEditInventoryItem.mockResolvedValue({ delta: 2 });
    mocks.deleteInventoryItem.mockResolvedValue(undefined);
    mocks.forceDeleteInventoryItem.mockResolvedValue(undefined);
    mocks.mergeInventoryItems.mockResolvedValue({ mergedCount: 1, movedQty: 2 });
    mocks.submitBulkReceipt.mockResolvedValue({ imported: 2, total: 2, batches: ['BULK-1'], failures: [] });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('المخزون — القراءة بقواعد V2', () => {
    it('يعرض الحالات والفجوات والأرفف والسجل بقواعد الخادم', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(register()).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('المخزون');
        expect(summaryLine()).toContain('5 صنفًا');
        expect(summaryLine()).toContain('تحت الحد 1 · نفد 1 · متوفر 3');
        expect(summaryLine()).toContain('بلا حد أدنى 1');
        expect(summaryLine()).toContain('بلا رف 2');
        expect(registerRows()).toHaveLength(5);

        const eggplant = rowByText('باذنجان');
        expect(within(eggplant).getByText('نفد')).toBeTruthy();
        expect(within(eggplant).getByText('V-01')).toBeTruthy();
        expect(within(eggplant).getByText('6221')).toBeTruthy();

        const tomato = rowByText('طماطم');
        expect(within(tomato).getByText('تحت الحد')).toBeTruthy();
        expect(within(tomato).getByText('بلا رف مسجّل')).toBeTruthy();

        const oil = rowByText('زيت');
        expect(within(oil).getByText('متوفر')).toBeTruthy();
        expect(within(oil).getByText('بلا حد أدنى')).toBeTruthy();
        expect(within(oil).getByText('15')).toBeTruthy();
        expect(within(oil).getByText('5')).toBeTruthy();

        // أكبر فجوة أولًا: طماطم 10−3=7 قبل باذنجان 5−0=5.
        const shortTable = screen.getByLabelText('جدول الأصناف تحت الحد');
        const shorts = within(shortTable).getAllByRole('row').slice(1);
        expect(shorts).toHaveLength(2);
        expect((shorts[0] as HTMLElement).textContent).toContain('طماطم');
        expect((shorts[1] as HTMLElement).textContent).toContain('باذنجان');
    });

    it('يبحث على الخادم بعد مهلة قصيرة ويعرض نتائج التسامح الحرفي', async () => {
        const urls = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'دجاج' } });
        await waitFor(() => {
            expect(registerRows()).toHaveLength(1);
        });
        expect(urls.some((url) => url.includes('q=%D8%AF%D8%AC%D8%A7%D8%AC'))).toBe(true);

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: '' } });
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'بازنجان' } });
        await waitFor(() => {
            expect(registerRows()).toHaveLength(1);
        });
        expect(within(register()).getByText('باذنجان')).toBeTruthy();
        expect(summaryLine()).toContain('بحث متسامح بعائلات الحروف');
    });

    it('يمرّر حالة المخزون والفئة إلى الخادم لا إلى الصفوف', async () => {
        const urls = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.change(screen.getByLabelText('حالة المخزون'), { target: { value: 'out' } });
        await waitFor(() => {
            expect(registerRows()).toHaveLength(1);
        });
        expect(urls.some((url) => url.includes('stock=out'))).toBe(true);

        fireEvent.change(screen.getByLabelText('حالة المخزون'), { target: { value: 'all' } });
        fireEvent.change(screen.getByLabelText('الفئة'), { target: { value: 'خضروات' } });
        await waitFor(() => {
            expect(registerRows()).toHaveLength(2);
        });
        expect(urls.some((url) => url.includes('category=%D8%AE%D8%B6%D8%B1%D9%88%D8%A7%D8%AA'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});

describe('المخزون — أزرار الكتابة حسب الدور (بوابة V2)', () => {
    it('مخزن: وارد وحذف فقط، بلا تعديل مباشر أو دمج', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        const row = rowByText('باذنجان');
        expect(within(row).getByRole('button', { name: 'وارد' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'حذف' })).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'تعديل' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'دمج أصناف مكررة' })).toBeNull();
    });

    it('مدير: وارد وحذف (النهائي ليس من قائمته)', async () => {
        mocks.role = 'manager';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        const row = rowByText('باذنجان');
        expect(within(row).getByRole('button', { name: 'وارد' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'حذف' })).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'تعديل' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'دمج أصناف مكررة' })).toBeNull();
    });

    it('أدمن: كل الأزرار بما فيها التعديل المباشر والدمج', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        const row = rowByText('باذنجان');
        expect(within(row).getByRole('button', { name: 'وارد' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'تعديل' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'حذف' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'دمج أصناف مكررة' })).toBeTruthy();
    });

    it('محاسب: لا زر كتابة ولا عمود إجراءات', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        const row = rowByText('باذنجان');
        expect(within(row).queryByRole('button')).toBeNull();
        expect(screen.queryByRole('button', { name: 'دمج أصناف مكررة' })).toBeNull();
    });
});

describe('المخزون — وارد سريع', () => {
    it('يرسل ما كتبه المستخدم بنفس حمولة V2 ويحدّث السجل بإبطال الاستعلام', async () => {
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'وارد' }));
        expect(await screen.findByRole('heading', { name: 'وارد سريع' })).toBeTruthy();

        fireEvent.input(document.querySelector('[name="qty"]') as HTMLInputElement, { target: { value: '3' } });
        fireEvent.input(document.querySelector('[name="price"]') as HTMLInputElement, { target: { value: '7.25' } });
        submitForm('erp-inventory-receipt-form');

        await waitFor(() => {
            expect(mocks.receiveInventoryItem).toHaveBeenCalledTimes(1);
        });
        expect(mocks.receiveInventoryItem.mock.calls[0]?.[0]).toBe('1');
        expect(mocks.receiveInventoryItem.mock.calls[0]?.[1]).toEqual({
            qty: 3,
            price: 7.25,
            unit: 'كجم',
            expiryDate: null,
        });
        expect(await screen.findByText('تم إضافة 3 كجم إلى باذنجان')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
        });
        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'وارد سريع' })).toBeNull();
        });
    });

    it('يرفض السعر الفارغ قبل الإرسال بنص V2 ويركّز على الحقل', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'وارد' }));
        submitForm('erp-inventory-receipt-form');

        expect(await screen.findByText(INVENTORY_TEXT.priceInvalid)).toBeTruthy();
        expect(document.activeElement?.getAttribute('name')).toBe('price');
        expect(mocks.receiveInventoryItem).not.toHaveBeenCalled();
    });

    it('يعرض خطأ الخادم داخل النموذج ويُبقيه مفتوحًا', async () => {
        mocks.receiveInventoryItem.mockRejectedValueOnce(new ApiError(500, 'MANUAL_RECEIPT_FAILED', 'تعذر تسجيل حركة الإضافة المخزنية'));
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'وارد' }));
        fireEvent.input(document.querySelector('[name="qty"]') as HTMLInputElement, { target: { value: '2' } });
        fireEvent.input(document.querySelector('[name="price"]') as HTMLInputElement, { target: { value: '5' } });
        submitForm('erp-inventory-receipt-form');

        expect(await screen.findByText('تعذر تسجيل حركة الإضافة المخزنية')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'وارد سريع' })).toBeTruthy();
    });
});

describe('المخزون — تعديل مباشر (أدمن)', () => {
    it('يتحقق ثم يؤكد بنص V2 ويطبّق التعديل برسالة الفرق', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'تعديل' }));
        expect(await screen.findByRole('heading', { name: 'تعديل مباشر (أدمن)' })).toBeTruthy();

        fireEvent.input(document.querySelector('[name="qty"]') as HTMLInputElement, { target: { value: '4' } });
        fireEvent.input(document.querySelector('[name="cost"]') as HTMLInputElement, { target: { value: '2.5' } });
        fireEvent.input(document.querySelector('[name="reason"]') as HTMLInputElement, {
            target: { value: 'تسوية جرد' },
        });
        submitForm('erp-inventory-direct-form');

        expect(await screen.findByText((content) => content.includes('تعديل مباشر لـ "باذنجان"'))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.directEditInventoryItem).toHaveBeenCalledTimes(1);
        });
        expect(mocks.directEditInventoryItem.mock.calls[0]?.[0]).toBe('1');
        expect(mocks.directEditInventoryItem.mock.calls[0]?.[1]).toEqual({
            qty: 4,
            avgCost: 2.5,
            reason: 'تسوية جرد',
        });
        expect(await screen.findByText('تم التعديل المباشر — الفرق 2 كجم قُيِّد في الدفتر')).toBeTruthy();
    });

    it('يرفض النموذج الناقص قبل التأكيد بنص V2', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'تعديل' }));
        submitForm('erp-inventory-direct-form');

        expect(await screen.findByText('اكتب كمية صحيحة ≥ صفر')).toBeTruthy();
        expect(mocks.directEditInventoryItem).not.toHaveBeenCalled();
    });
});

describe('المخزون — حذف وحذف نهائي', () => {
    it('يطلب تأكيد V2 ثم يحذف ويظهر «تم الحذف» ويحدّث السجل', async () => {
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'حذف' }));
        expect(await screen.findByText('حذف الصنف "باذنجان"؟')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.deleteInventoryItem).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('تم الحذف')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
        });
    });

    it('إلغاء التأكيد لا يحذف', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'حذف' }));
        await screen.findByText('حذف الصنف "باذنجان"؟');
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        expect(mocks.deleteInventoryItem).not.toHaveBeenCalled();
    });

    it('حارس الحركات يفتح الحذف النهائي لدور مخوّل ويؤكّد بنص V2', async () => {
        mocks.deleteInventoryItem.mockRejectedValueOnce(
            new ApiError(409, 'INVENTORY_HAS_MOVEMENTS', 'لا يمكن حذف صنف له حركات مخزون أو أرصدة'),
        );
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'حذف' }));
        await screen.findByText('حذف الصنف "باذنجان"؟');
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        expect(await screen.findByText((content) => content.includes('هل تريد الحذف النهائي مع كل حركاته وسجلاته؟'))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.forceDeleteInventoryItem).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('تم الحذف النهائي مع الحركات')).toBeTruthy();
    });

    it('المدير لا يملك الحذف النهائي: يظهر رفض الحارس نصًّا بلا طلب force', async () => {
        mocks.role = 'manager';
        mocks.deleteInventoryItem.mockRejectedValueOnce(
            new ApiError(409, 'INVENTORY_HAS_MOVEMENTS', 'لا يمكن حذف صنف له حركات مخزون أو أرصدة'),
        );
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(within(rowByText('باذنجان')).getByRole('button', { name: 'حذف' }));
        await screen.findByText('حذف الصنف "باذنجان"؟');
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        expect(await screen.findByText('لا يمكن حذف صنف له حركات مخزون أو أرصدة')).toBeTruthy();
        expect(screen.queryByText((content) => content.includes('هل تريد الحذف النهائي'))).toBeNull();
        expect(mocks.forceDeleteInventoryItem).not.toHaveBeenCalled();
    });
});

describe('المخزون — دمج المكرر (أدمن)', () => {
    it('يُظهر المجموعات ويقترح الأكبر رصيدًا ثم يؤكد ويدمج', async () => {
        mocks.role = 'admin';
        stubFetch(false, duplicateItems);
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(6);
        });

        fireEvent.click(screen.getByRole('button', { name: 'دمج أصناف مكررة' }));
        expect(await screen.findByRole('heading', { name: 'دمج أصناف مكررة' })).toBeTruthy();
        expect(screen.getByText('«باذنجان» — 2 نسخ')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'دمج في الصنف المحدد' }));
        expect(await screen.findByText((content) => content.includes('تأكيد الدمج: سيُنقل رصيد 1 صنفًا مكررًا'))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.mergeInventoryItems).toHaveBeenCalledTimes(1);
        });
        // المقترح الأكبر رصيدًا: الصنف 6 (رصيد 2) يبقى، والصنف 1 (صفر) يُدمج.
        expect(mocks.mergeInventoryItems.mock.calls[0]?.[0]).toBe(6);
        expect(mocks.mergeInventoryItems.mock.calls[0]?.[1]).toEqual([1]);
        expect(await screen.findByText('تم الدمج: 1 مكرر حُذف ونُقل رصيده (2)')).toBeTruthy();
    });

    it('لا مكرر: لوحة V2 تقول ذلك بلا زر دمج', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'دمج أصناف مكررة' }));
        expect(await screen.findByText('ممتاز — لا توجد أصناف مكررة بالاسم نفسه حاليًا 👌')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'دمج في الصنف المحدد' })).toBeNull();
    });
});

describe('المخزون — الاستلام المجمّع', () => {
    function bulkDialog(): HTMLElement {
        return screen.getByRole('dialog');
    }

    function fillRow(index: number, values: { name?: string; qty?: string; price?: string }): void {
        const scope = within(bulkDialog());
        if (values.name !== undefined) {
            fireEvent.change(scope.getByLabelText(`الصنف — صف ${index}`), { target: { value: values.name } });
        }
        if (values.qty !== undefined) {
            fireEvent.change(scope.getByLabelText(`الكمية — صف ${index}`), { target: { value: values.qty } });
        }
        if (values.price !== undefined) {
            fireEvent.change(scope.getByLabelText(`السعر — صف ${index}`), { target: { value: values.price } });
        }
    }

    it('الزر يظهر لمن يملك الكتابة ويختفي عن المحاسب', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        expect(screen.getByRole('button', { name: 'استلام مجمّع' })).toBeTruthy();
    });

    it('المحاسب لا يرى زر الاستلام المجمّع', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });
        expect(screen.queryByRole('button', { name: 'استلام مجمّع' })).toBeNull();
    });

    it('يفتح النافذة بصف واحد بالافتراضيات ويضيف صفوفًا', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'استلام مجمّع' }));
        expect(await screen.findByRole('heading', { name: 'استلام مجمّع' })).toBeTruthy();

        const scope = within(bulkDialog());
        expect((scope.getByLabelText('الفئة — صف 1') as HTMLInputElement).value).toBe('عام');
        expect((scope.getByLabelText('الوحدة — صف 1') as HTMLInputElement).value).toBe('قطعة');
        expect((scope.getByLabelText('الحد الأدنى — صف 1') as HTMLInputElement).value).toBe('5');

        fireEvent.click(scope.getByRole('button', { name: 'إضافة صف' }));
        expect(scope.getByLabelText('الصنف — صف 2')).toBeTruthy();
        expect(screen.getByText('2 صف — 0 صالح للإرسال')).toBeTruthy();
    });

    it('يرفض الصف الناقص قبل الإرسال ولا ينادي الخادم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'استلام مجمّع' }));
        await screen.findByRole('heading', { name: 'استلام مجمّع' });

        fillRow(1, { name: 'أرز' });
        fireEvent.click(within(bulkDialog()).getByRole('button', { name: 'استلام 0 صنف' }));

        expect(await screen.findByText('الكمية يجب أن تكون أكبر من صفر')).toBeTruthy();
        expect(mocks.submitBulkReceipt).not.toHaveBeenCalled();
    });

    it('يرسل الصفوف الصالحة ويبطل استعلام المخزون', async () => {
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'استلام مجمّع' }));
        await screen.findByRole('heading', { name: 'استلام مجمّع' });

        fillRow(1, { name: 'أرز', qty: '10', price: '25' });
        fireEvent.click(within(bulkDialog()).getByRole('button', { name: 'استلام 1 صنف' }));

        await waitFor(() => {
            expect(mocks.submitBulkReceipt).toHaveBeenCalledTimes(1);
        });
        const rows = mocks.submitBulkReceipt.mock.calls[0]?.[0] as { name: string; qty: string; price: string; minQty: string }[];
        expect(rows[0]).toMatchObject({ name: 'أرز', qty: '10', price: '25', minQty: '5' });

        expect(await screen.findByText('تم الاستلام المجمّع')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
        });
    });

    it('فشل دفعة يظهر كإيراد جزئي لا كنجاح صامت', async () => {
        mocks.submitBulkReceipt.mockResolvedValueOnce({
            imported: 1,
            total: 2,
            batches: ['BULK-1'],
            failures: [{ names: ['زيت'], message: 'الوحدة غير مطابقة' }],
        });
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'استلام مجمّع' }));
        await screen.findByRole('heading', { name: 'استلام مجمّع' });

        fillRow(1, { name: 'أرز', qty: '10', price: '25' });
        fireEvent.click(within(bulkDialog()).getByRole('button', { name: 'استلام 1 صنف' }));

        expect(await screen.findByText('اكتمل الاستيراد جزئيًا')).toBeTruthy();
        expect(screen.getByText('زيت — الوحدة غير مطابقة')).toBeTruthy();
    });

    it('فشل الاستلام كله يبقي النافذة مفتوحة ويعرض رسالة الخادم', async () => {
        mocks.submitBulkReceipt.mockRejectedValueOnce(new Error('تعذر تسجيل استيراد المخزون'));
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(registerRows()).toHaveLength(5);
        });

        fireEvent.click(screen.getByRole('button', { name: 'استلام مجمّع' }));
        await screen.findByRole('heading', { name: 'استلام مجمّع' });

        fillRow(1, { name: 'أرز', qty: '10', price: '25' });
        fireEvent.click(within(bulkDialog()).getByRole('button', { name: 'استلام 1 صنف' }));

        expect(await screen.findByText('تعذر تسجيل استيراد المخزون')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'استلام مجمّع' })).toBeTruthy();
    });
});
