import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ApiError } from '../lib/api';
import { riyadhToday } from '../lib/finance';
import { ToastProvider } from '../ui/Toast';
import { PurchaseInvoices } from './PurchaseInvoices';

/**
 * فواتير الشراء — القراءة بقواعد V2، والكتابة بأبوابها الستة:
 * إنشاء/تعديل (بنود وترويسة وخصم وسداد)، إلغاء void، حذف الكل بتأكيد مزدوج،
 * تسديد كامل، ودفعة جزئية — أزرار حسب الدور وحالة الفاتورة، ونصوص V2 حرفيًّا،
 * وإبطال استعلام السجل بعد كل كتابة.
 */

const mocks = vi.hoisted(() => ({
    role: 'kitchen',
    createPurchaseInvoice: vi.fn(),
    updatePurchaseInvoice: vi.fn(),
    voidPurchaseInvoice: vi.fn(),
    clearAllPurchaseInvoices: vi.fn(),
    payInvoiceFull: vi.fn(),
    payInvoicePartial: vi.fn(),
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

vi.mock('../lib/purchase-invoices-write', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/purchase-invoices-write')>();
    return {
        ...original,
        createPurchaseInvoice: mocks.createPurchaseInvoice,
        updatePurchaseInvoice: mocks.updatePurchaseInvoice,
        voidPurchaseInvoice: mocks.voidPurchaseInvoice,
        clearAllPurchaseInvoices: mocks.clearAllPurchaseInvoices,
        payInvoiceFull: mocks.payInvoiceFull,
        payInvoicePartial: mocks.payInvoicePartial,
    };
});

const today = riyadhToday();

const invoices = {
    data: [
        {
            id: 1,
            invoiceNumber: 'INV-1',
            date: today,
            supplierId: 10,
            supplierName: 'اسم احتياطي',
            supplier_name_snapshot: 'لقطة المورد',
            totalAmount: '100.00',
            paidAmount: '40.00',
            paymentStatus: 'partial',
            paymentMethod: 'bank',
            items: [{ itemId: 7, itemName: 'طماطم', qty: 1, price: 10, unit: 'كجم', taxCategory: 'STANDARD' }],
        },
        {
            id: 2,
            invoiceNumber: 'INV-2',
            date: today,
            supplierId: 11,
            supplier_name_snapshot: 'لقطة المورد ٢',
            totalAmount: 50,
            paidAmount: 50,
            paymentStatus: 'paid',
            paymentMethod: 'cash',
            items: [],
        },
        {
            id: 3,
            invoiceNumber: 'INV-3',
            date: today,
            supplierId: null,
            supplierName: 'اسم مباشر',
            totalAmount: '25.50',
            paidAmount: 0,
            paymentStatus: null,
            paymentMethod: 'credit',
            items: [{ itemName: 'سكر', qty: 1, price: 5 }],
        },
        {
            id: 4,
            invoiceNumber: 'INV-4',
            date: '2020-01-01',
            supplierId: 12,
            totalAmount: '10.00',
            paidAmount: '0',
            paymentStatus: 'unpaid',
            paymentMethod: 'cheque',
            items: [],
        },
    ],
    pagination: { totalPages: 1 },
};

const suppliers = {
    data: [{ id: 10, name: 'مورد حي', tax_registration_status: 'NOT_REGISTERED' }],
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(failInvoices = false): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            urls.push(String(url));
            const text = String(url);
            if (text.includes('/api/purchaseInvoices')) {
                return failInvoices ? json({ error: 'FAILED', message: 'تعذر جلب الفواتير' }, 500) : json(invoices);
            }
            if (text.includes('/api/procurement/suppliers')) {
                return json(suppliers);
            }
            if (text.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
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
                    <PurchaseInvoices />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
    return { client, invalidate };
}

function dataRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

function rowByText(text: string): HTMLElement {
    return screen.getByText(text).closest('tr') as HTMLElement;
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

function inputOf(selector: string): HTMLInputElement {
    const node = document.querySelector(selector);
    if (!node) {
        throw new Error(`الحقل ${selector} غير موجود`);
    }
    return node as HTMLInputElement;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'kitchen';
    mocks.createPurchaseInvoice.mockResolvedValue(undefined);
    mocks.updatePurchaseInvoice.mockResolvedValue(undefined);
    mocks.voidPurchaseInvoice.mockResolvedValue({
        invoiceNumber: 'INV-1',
        reversedItems: 2,
        deletedPayments: 0,
    });
    mocks.clearAllPurchaseInvoices.mockResolvedValue({ deletedInvoices: 4, reversedLedgerRows: 12 });
    mocks.payInvoiceFull.mockResolvedValue(undefined);
    mocks.payInvoicePartial.mockResolvedValue(42);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('فواتير الشراء — القراءة', () => {
    it('يعرض السجل والمجاميع للفترة الافتراضية باسم المورد الأفضل', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('فواتير الشراء');
        expect(summaryLine()).toContain('3 فاتورة بإجمالي 175.50 SAR');
        expect(summaryLine()).toContain('مسدد 90.00 · متبقٍ 85.50');
        expect(dataRows()).toHaveLength(3);
        expect(screen.queryByText('INV-4')).toBeNull();
        expect(screen.getByText('3 موردًا')).toBeTruthy();

        const live = screen.getByText('INV-1').closest('tr') as HTMLElement;
        expect(within(live).getByText('مورد حي')).toBeTruthy();
        expect(within(live).getByText('بنكي')).toBeTruthy();
        expect(within(live).getByText('جزئية')).toBeTruthy();
        expect(within(live).getByText('60.00')).toBeTruthy();

        const snapshot = screen.getByText('INV-2').closest('tr') as HTMLElement;
        expect(within(snapshot).getByText('لقطة المورد ٢')).toBeTruthy();
        expect(within(snapshot).getByText('نقدي')).toBeTruthy();
        expect(within(snapshot).getByText('مسددة')).toBeTruthy();

        const direct = screen.getByText('INV-3').closest('tr') as HTMLElement;
        expect(within(direct).getByText('اسم مباشر')).toBeTruthy();
        expect(within(direct).getByText('آجل')).toBeTruthy();
        expect(within(direct).getByText('غير مسددة')).toBeTruthy();
        expect(within(direct).getAllByText('25.50')).toHaveLength(2);
    });

    it('يبدّل الفترات ويرفض فترة معكوسة', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'كل الفترات' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(4);
        });
        expect(summaryLine()).toContain('كل الفترات');
        expect(screen.getByText('INV-4')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'آخر 30 يومًا' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.change(screen.getByLabelText('من'), { target: { value: '2999-01-01' } });
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('بداية الفترة بعد نهايتها');
        });
        expect(screen.queryByRole('table')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(4);
        });
        expect(summaryLine()).toContain('كل الفترات');
    });

    it('يرتّب العميل بالمال نصًّا على المليم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'الإجمالي' }));
        await waitFor(() => {
            expect(within(dataRows()[0] as HTMLElement).getByText('INV-3')).toBeTruthy();
        });
        expect(within(dataRows()[2] as HTMLElement).getByText('INV-1')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'الإجمالي' }));
        await waitFor(() => {
            expect(within(dataRows()[0] as HTMLElement).getByText('INV-1')).toBeTruthy();
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

describe('فواتير الشراء — أزرار الكتابة حسب الدور (بوابة V2)', () => {
    it('مخزن: إنشاء وتعديل فقط، بلا تسديد أو إلغاء', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        expect(screen.getByRole('button', { name: 'فاتورة شراء جديدة' })).toBeTruthy();
        const row = rowByText('INV-1');
        expect(within(row).getByRole('button', { name: 'تعديل' })).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'تسديد الكل' })).toBeNull();
        expect(within(row).queryByRole('button', { name: 'جزئي' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'حذف الفاتورة INV-1' })).toBeNull();
        expect(screen.queryByRole('heading', { name: /منطقة الخطر/ })).toBeNull();
    });

    it('أدمن: كل الأزرار ومنطقة الخطر', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        expect(screen.getByRole('button', { name: 'فاتورة شراء جديدة' })).toBeTruthy();
        const row = rowByText('INV-1');
        expect(within(row).getByRole('button', { name: 'تعديل' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'تسديد الكل' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'جزئي' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حذف الفاتورة INV-1' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: /منطقة الخطر/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حذف كل الفواتير نهائيًا' }).hasAttribute('disabled')).toBe(true);
    });

    it('محاسب: تسديد كامل وجزئي فقط، بلا إنشاء أو إلغاء', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        expect(screen.queryByRole('button', { name: 'فاتورة شراء جديدة' })).toBeNull();
        const row = rowByText('INV-1');
        expect(within(row).queryByRole('button', { name: 'تعديل' })).toBeNull();
        expect(within(row).getByRole('button', { name: 'تسديد الكل' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'جزئي' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'حذف الفاتورة INV-1' })).toBeNull();
        expect(screen.queryByRole('heading', { name: /منطقة الخطر/ })).toBeNull();
    });

    it('دور بلا كتابة: لا عمود إجراءات', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });
        expect(within(rowByText('INV-1')).queryByRole('button')).toBeNull();
        expect(screen.queryByText('إجراءات')).toBeNull();
    });
});

describe('فواتير الشراء — إنشاء وتعديل (نموذج بنود)', () => {
    it('ينشئ فاتورة بنفس حمولة V2 ويظهر توست الحفظ ويبطل السجل', async () => {
        mocks.role = 'admin';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByRole('button', { name: 'فاتورة شراء جديدة' }));
        expect(await screen.findByRole('heading', { name: 'فاتورة مشتريات جديدة' })).toBeTruthy();

        fireEvent.input(inputOf('[name="invoiceNumber"]'), { target: { value: 'INV-9' } });
        fireEvent.click(screen.getByRole('button', { name: 'إضافة صنف' }));
        fireEvent.input(inputOf('[name="itemName-0"]'), { target: { value: 'طماطم' } });
        fireEvent.input(inputOf('[name="qty-0"]'), { target: { value: '2' } });
        fireEvent.input(inputOf('[name="price-0"]'), { target: { value: '5' } });
        submitForm('erp-invoice-form');

        await waitFor(() => {
            expect(mocks.createPurchaseInvoice).toHaveBeenCalledTimes(1);
        });
        expect(mocks.createPurchaseInvoice.mock.calls[0]?.[0]).toMatchObject({
            invoiceNumber: 'INV-9',
            paymentMethod: 'cash',
            items: [{ itemName: 'طماطم', qty: '2', price: '5', unit: 'وحدة' }],
        });
        expect(await screen.findByText('تم حفظ الفاتورة')).toBeTruthy();
        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'فاتورة مشتريات جديدة' })).toBeNull();
        });
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['purchase-invoices'] });
        });
        // لا يُرسل paidAmount إلا بعد لمس الحقل (purchaseInvoicePayload يحذفه).
        expect(mocks.createPurchaseInvoice.mock.calls[0]?.[0]).toMatchObject({ paidTouched: false });
    });

    it('يرفض النموذج بلا بنود بنص V2 ولا يرسل', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByRole('button', { name: 'فاتورة شراء جديدة' }));
        await screen.findByRole('heading', { name: 'فاتورة مشتريات جديدة' });
        submitForm('erp-invoice-form');

        expect(await screen.findByText('أضف صنفًا واحدًا على الأقل')).toBeTruthy();
        expect(mocks.createPurchaseInvoice).not.toHaveBeenCalled();
    });

    it('يعدّل فاتورة غير مدفوعة ويغلق النموذج بتوست التحديث', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-3')).getByRole('button', { name: 'تعديل' }));
        await screen.findByRole('heading', { name: 'فاتورة مشتريات جديدة' });
        expect(inputOf('[name="invoiceNumber"]').value).toBe('INV-3');
        expect(inputOf('[name="invoiceNumber"]').disabled).toBe(false);
        expect(inputOf('[name="supplierName"]').value).toBe('اسم مباشر');

        fireEvent.input(inputOf('[name="invoiceNumber"]'), { target: { value: 'INV-3B' } });
        submitForm('erp-invoice-form');

        await waitFor(() => {
            expect(mocks.updatePurchaseInvoice).toHaveBeenCalledTimes(1);
        });
        expect(mocks.updatePurchaseInvoice.mock.calls[0]?.[0]).toBe('3');
        expect(mocks.updatePurchaseInvoice.mock.calls[0]?.[1]).toMatchObject({ invoiceNumber: 'INV-3B' });
        expect(await screen.findByText('تم تحديث الفاتورة والمخزون والحسابات')).toBeTruthy();
    });

    it('الفاتورة المدفوعة تُجمّد الترويسة وتُظهر إشعار الأصناف فقط', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-2')).getByRole('button', { name: 'تعديل' }));
        await screen.findByRole('heading', { name: 'فاتورة مشتريات جديدة' });
        expect(screen.getByText('⚠ فاتورة مدفوعة — يمكن تعديل الأصناف فقط؛ الترويسة والدفعات ثابتة')).toBeTruthy();
        expect(inputOf('[name="invoiceNumber"]').disabled).toBe(true);
        expect((document.querySelector('[name="paymentMethod"]') as HTMLSelectElement).disabled).toBe(true);
    });

    it('خطأ تكرار الفاتورة يظهر بنص V2 ويبقي النموذج مفتوحًا', async () => {
        mocks.role = 'admin';
        mocks.createPurchaseInvoice.mockRejectedValueOnce(new ApiError(409, 'DUPLICATE_INVOICE', 'فاتورة مشابهة مسجلة بالفعل'));
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByRole('button', { name: 'فاتورة شراء جديدة' }));
        await screen.findByRole('heading', { name: 'فاتورة مشتريات جديدة' });
        fireEvent.click(screen.getByRole('button', { name: 'إضافة صنف' }));
        fireEvent.input(inputOf('[name="itemName-0"]'), { target: { value: 'أرز' } });
        fireEvent.input(inputOf('[name="qty-0"]'), { target: { value: '1' } });
        fireEvent.input(inputOf('[name="price-0"]'), { target: { value: '4' } });
        submitForm('erp-invoice-form');

        expect(await screen.findByText('الفاتورة مسجلة بالفعل — لم تتكرر')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'فاتورة مشتريات جديدة' })).toBeTruthy();
    });
});

describe('فواتير الشراء — تسديد كامل', () => {
    it('يؤكد بالنص والمبلغ ثم يسدد ويبطل الفواتير والمدفوعات', async () => {
        mocks.role = 'accountant';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-1')).getByRole('button', { name: 'تسديد الكل' }));
        expect(await screen.findByText('تسديد كامل للفاتورة INV-1 — 60.00 SAR نقدًا؟')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.payInvoiceFull).toHaveBeenCalledTimes(1);
        });
        expect(mocks.payInvoiceFull.mock.calls[0]).toEqual(['1', { method: 'cash' }]);
        expect(await screen.findByText('تم تسديد الفاتورة INV-1 (60.00 SAR)')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurement', 'payments'] });
        });
    });

    it('إلغاء التأكيد لا يرسل تسديدًا', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-1')).getByRole('button', { name: 'تسديد الكل' }));
        await screen.findByText('تسديد كامل للفاتورة INV-1 — 60.00 SAR نقدًا؟');
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        expect(mocks.payInvoiceFull).not.toHaveBeenCalled();
    });
});

describe('فواتير الشراء — دفعة جزئية', () => {
    it('يسجل دفعة جزئية بالحمولة نفسها ويظهر رصيد المورد', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-1')).getByRole('button', { name: 'جزئي' }));
        expect(await screen.findByRole('heading', { name: 'دفعة جزئية — INV-1' })).toBeTruthy();
        fireEvent.input(inputOf('[name="partialAmount"]'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ الدفعة' }));

        expect(await screen.findByText('تسجيل دفعة 10.00 SAR على الفاتورة INV-1؟')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.payInvoicePartial).toHaveBeenCalledTimes(1);
        });
        expect(mocks.payInvoicePartial.mock.calls[0]?.[0]).toBe('1');
        expect(mocks.payInvoicePartial.mock.calls[0]?.[1]).toMatchObject({
            supplierId: '10',
            amount: '10',
            method: 'cash',
        });
        expect(await screen.findByText('تم تسجيل دفعة 10.00 SAR على الفاتورة INV-1 — رصيد المورد الآن 42.00 SAR')).toBeTruthy();
    });

    it('يرفض مبلغًا يتجاوز المتبقي قبل الطلب بنص V2', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(within(rowByText('INV-1')).getByRole('button', { name: 'جزئي' }));
        await screen.findByRole('heading', { name: 'دفعة جزئية — INV-1' });
        fireEvent.input(inputOf('[name="partialAmount"]'), { target: { value: '70' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ الدفعة' }));

        expect(await screen.findByText('المبلغ يتجاوز المتبقي (60.00)')).toBeTruthy();
        expect(mocks.payInvoicePartial).not.toHaveBeenCalled();
    });
});

describe('فواتير الشراء — إلغاء void وحذف الكل (أدمن)', () => {
    it('يؤكد الإلغاء بنص V2 ثم يحذف ويعكس ويبطل المخزون', async () => {
        mocks.role = 'admin';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByRole('button', { name: 'حذف الفاتورة INV-1' }));
        expect(await screen.findByText((content) => content.includes('حذف فاتورة الشراء INV-1 (100.00 SAR)؟'))).toBeTruthy();
        expect(
            screen.getByText((content) => content.includes('عليها مبلغ مسدد 40.00 SAR — إن كانت دفعة تلقائية ستُعكس مع الإلغاء.')),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.voidPurchaseInvoice).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('حُذفت الفاتورة INV-1 وعُكس مخزون 2 صنفًا')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
        });
    });

    it('رفض الدفعات اليدوية يضيف دليل V2 إلى رسالة الخادم', async () => {
        mocks.role = 'admin';
        mocks.voidPurchaseInvoice.mockRejectedValueOnce(
            new ApiError(409, 'INVOICE_HAS_PAYMENTS', 'الفاتورة مرتبطة بدفعات موردين يدوية — لا يمكن إلغاؤها قبل عكس الدفعة محاسبيًا'),
        );
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByRole('button', { name: 'حذف الفاتورة INV-1' }));
        await screen.findByText((content) => content.includes('حذف فاتورة الشراء INV-1'));
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        expect(await screen.findByText((content) => content.includes('اعكس الدفعة يدويًا ثم أعد الإلغاء'))).toBeTruthy();
    });

    it('حذف الكل بتأكيد مزدوج: مربع تأكيد ثم نافذة تأكيد', async () => {
        mocks.role = 'admin';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        const clearButton = screen.getByRole('button', { name: 'حذف كل الفواتير نهائيًا' });
        expect(clearButton.hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByLabelText('أفهم أن هذه العملية نهائية وتعكس كميات المخزون'));
        expect(clearButton.hasAttribute('disabled')).toBe(false);

        fireEvent.click(clearButton);
        expect(await screen.findByText((content) => content.includes('حذف كل فواتير الشراء (4) نهائيًا؟'))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.clearAllPurchaseInvoices).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByText('تم حذف 4 فاتورة وعكس 12 قيد مخزون')).toBeTruthy();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
        });
    });

    it('إلغاء نافذة التأكيد لا يحذف شيئًا', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });

        fireEvent.click(screen.getByLabelText('أفهم أن هذه العملية نهائية وتعكس كميات المخزون'));
        fireEvent.click(screen.getByRole('button', { name: 'حذف كل الفواتير نهائيًا' }));
        await screen.findByText((content) => content.includes('حذف كل فواتير الشراء (4) نهائيًا؟'));
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        expect(mocks.clearAllPurchaseInvoices).not.toHaveBeenCalled();
    });
});
