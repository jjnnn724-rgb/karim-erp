import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
    CLEAR_ALL_CONFIRM,
    clearAllConfirm,
    clearAllPurchaseInvoices,
    clearAllSuccess,
    createPurchaseInvoice,
    DISCOUNT_TYPE_OPTIONS,
    emptyInvoiceForm,
    emptyInvoiceItem,
    INVOICE_CREATE_ROLES,
    INVOICE_TEXT,
    INVOICE_VOID_ROLES,
    invoiceCreateVisible,
    invoiceEstimate,
    invoiceFormFromRow,
    invoiceIdOf,
    invoiceItemsFromRow,
    invoiceNumberFallback,
    invoicePaymentVisible,
    invoiceSaveError,
    invoiceVoidVisible,
    isDuplicateInvoiceError,
    isVoidPaymentError,
    moneyWithUnit,
    normalizeExpiryDate,
    PAID_ITEMS_ONLY_NOTICE,
    PAYMENT_WRITE_ROLES,
    partialPaymentError,
    partialPaymentPayload,
    payFullConfirm,
    payFullSuccess,
    payInvoiceFull,
    payInvoicePartial,
    payPartialConfirm,
    payPartialSuccess,
    purchaseInvoicePayload,
    readExpiryField,
    TAX_CATEGORIES,
    UNIT_OPTIONS,
    updatePurchaseInvoice,
    voidConfirm,
    voidPurchaseInvoice,
    voidSuccess,
} from './purchase-invoices-write';

/**
 * كتابة فواتير الشراء — تحرس الرسائل والقواعد والحمولات المنقولة حرفيًّا من
 * `v2/data/purchase-invoices-write-repo.js`، `v2/invoice-editor.js`،
 * `v2/screens/wh-invoices.js`، `v2/screens/invoices.js`، و`v2/data/procurement-repo.js`،
 * مع نفس بوابات HTTP الست ونفس نصوص المرفوضات.
 */

vi.mock('./auth', () => ({ getAccessToken: () => 'test-token', getAppKey: () => null }));

type FetchCall = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response): FetchCall[] {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const request = init ?? {};
            calls.push({ url: String(input), init: request });
            return handler(String(input), request);
        }),
    );
    return calls;
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
    const raw = call?.init.body;
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const formWithItem = {
    invoiceNumber: 'INV-9',
    date: '2026-11-09',
    supplierId: '',
    supplierName: ' مورد الخضار ',
    supplierPhone: ' 0500000000 ',
    paymentMethod: 'cash',
    notes: ' ملاحظة ',
    discountType: 'none',
    discountValue: '0',
    paidTouched: false,
    items: [{ itemName: ' طماطم ', qty: '3', price: '2.50', unit: 'كجم', weight: '', taxCategory: 'standard' }],
};

describe('فواتير الشراء — الأدوار (قوائم V2/الخادم حرفيًّا)', () => {
    it('كل قائمة هي قائمة الخادم نفسها', () => {
        expect([...INVOICE_CREATE_ROLES]).toEqual(['admin', 'manager', 'warehouse']);
        expect([...INVOICE_VOID_ROLES]).toEqual(['admin']);
        expect([...PAYMENT_WRITE_ROLES]).toEqual(['admin', 'manager', 'accountant']);
    });

    it('بوابات الظهور تطابق القوائم (لا admin ضمنيًّا)', () => {
        expect(invoiceCreateVisible('admin')).toBe(true);
        expect(invoiceCreateVisible('manager')).toBe(true);
        expect(invoiceCreateVisible('warehouse')).toBe(true);
        expect(invoiceCreateVisible('accountant')).toBe(false);
        expect(invoiceCreateVisible(null)).toBe(false);

        expect(invoiceVoidVisible('admin')).toBe(true);
        expect(invoiceVoidVisible('manager')).toBe(false);
        expect(invoiceVoidVisible('warehouse')).toBe(false);

        expect(invoicePaymentVisible('admin')).toBe(true);
        expect(invoicePaymentVisible('manager')).toBe(true);
        expect(invoicePaymentVisible('accountant')).toBe(true);
        expect(invoicePaymentVisible('warehouse')).toBe(false);
    });
});

describe('فواتير الشراء — حمولة POST/PUT', () => {
    it('تطابق شكل purchaseInvoicePayload: بند م filtered، defaults، والصلاحية null', () => {
        expect(purchaseInvoicePayload(formWithItem)).toEqual({
            invoiceNumber: 'INV-9',
            date: '2026-11-09',
            supplierName: 'مورد الخضار',
            supplierPhone: '0500000000',
            supplierId: null,
            paymentMethod: 'cash',
            notes: 'ملاحظة',
            discountType: 'none',
            discountValue: 0,
            items: [
                {
                    itemId: null,
                    itemName: 'طماطم',
                    qty: 3,
                    price: 2.5,
                    unit: 'كجم',
                    weight: 0,
                    taxCategory: 'STANDARD',
                    expiryDate: null,
                },
            ],
        });
    });

    it('يرفض/يشطب البنود غير الصالحة ويطبّع الفئة والصلاحية', () => {
        const payload = purchaseInvoicePayload({
            items: [
                { itemName: '', qty: '3', price: '1' },
                { itemName: 'أرز', qty: '0', price: '1' },
                { itemName: 'سكر', qty: '2', price: '-1' },
                { itemName: 'قهوة', qty: '1', price: '9', taxCategory: 'WRONG', expiryDate: '2026-02-30' },
                {
                    itemName: 'شاي',
                    qty: '1',
                    price: '9',
                    expiryDate: '2026-12-31',
                    packagingQty: '12',
                    packagingUom: 'كرتون',
                },
            ],
        });
        expect(payload.items).toHaveLength(2);
        expect(payload.items[0]).toMatchObject({
            itemName: 'قهوة',
            taxCategory: 'STANDARD',
            expiryDate: null,
        });
        expect(payload.items[1]).toMatchObject({
            itemName: 'شاي',
            expiryDate: '2026-12-31',
            packagingQty: 12,
            packagingUom: 'كرتون',
        });
        expect(TAX_CATEGORIES).toEqual(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']);
        expect(UNIT_OPTIONS).toContain('كجم');
    });

    it('paidAmount يُرسل فقط بعد لمس الحقل — قرار legacy', () => {
        expect(purchaseInvoicePayload({ ...formWithItem, paidTouched: false, paidAmount: '5' })).not.toHaveProperty(
            'paidAmount',
        );
        expect(purchaseInvoicePayload({ ...formWithItem, paidTouched: true, paidAmount: '5.5' })).toMatchObject({
            paidAmount: 5.5,
        });
        expect(purchaseInvoicePayload({ ...formWithItem, paidTouched: true, paidAmount: '' })).not.toHaveProperty(
            'paidAmount',
        );
    });

    it('رقم فاتورة بديل بنفس بصمة V2', () => {
        expect(invoiceNumberFallback(1)).toBe('INV-1');
        expect(invoiceNumberFallback()).toMatch(/^INV-[0-9A-Z]+$/);
        expect(emptyInvoiceItem()).toMatchObject({ itemName: '', qty: 1, unit: 'وحدة', taxCategory: 'STANDARD' });
        expect(emptyInvoiceForm('2026-11-09')).toMatchObject({ paymentMethod: 'cash', date: '2026-11-09' });
        expect(DISCOUNT_TYPE_OPTIONS.map((option) => option.value)).toEqual(['none', 'percent', 'amount']);
        expect(PAID_ITEMS_ONLY_NOTICE).toBe('فاتورة مدفوعة — يمكن تعديل الأصناف فقط؛ الترويسة والدفعات ثابتة');
    });
});

describe('فواتير الشراء — صفّ → نموذج', () => {
    it('يقرأ البنود من JSON نصّي ومن snake_case كما في V2', () => {
        const invoice = {
            id: '5',
            invoiceNumber: 'INV-5',
            date: '2026-11-01T00:00:00.000Z',
            supplierId: '10',
            supplierName: 'مورد',
            paymentMethod: 'bank',
            discount_type: 'percent',
            discount_value: '5',
            paidAmount: '20',
            items: JSON.stringify([
                {
                    item_id: 7,
                    name: 'أرز',
                    qty: '2',
                    price: '10',
                    tax_category: 'ZERO_RATED',
                    expiry_date: '2026-12-01',
                },
            ]),
        };
        expect(invoiceFormFromRow(invoice)).toMatchObject({
            invoiceNumber: 'INV-5',
            date: '2026-11-01',
            supplierId: '10',
            paymentMethod: 'bank',
            discountType: 'percent',
            discountValue: 5,
            paidAmount: 20,
        });
        expect(invoiceFormFromRow(invoice).items?.[0]).toMatchObject({
            itemId: 7,
            itemName: 'أرز',
            qty: 2,
            price: 10,
            taxCategory: 'ZERO_RATED',
            expiryDate: '2026-12-01',
        });
        expect(invoiceItemsFromRow({ items: 'not-json' })).toEqual([]);
        expect(invoiceItemsFromRow({ items: null })).toEqual([]);
    });
});

describe('فواتير الشراء — تحقق الحفظ بنصوص V2', () => {
    it('الترتيب نفسه: بند ← كمية/سعر ← سداد ← خصم ← صلاحية', () => {
        expect(invoiceSaveError({ items: [] })).toBe('أضف صنفًا واحدًا على الأقل');
        expect(invoiceSaveError({ items: [{ itemName: 'أرز', qty: '-1', price: '1' }] })).toBe(
            'أضف صنفًا واحدًا على الأقل',
        );
        expect(
            invoiceSaveError({
                items: [
                    { itemName: 'أرز', qty: '1', price: '1' },
                    { itemName: 'سكر', qty: '-1', price: '1' },
                ],
            }),
        ).toBe('تحقق من إدخال كمية وسعر صحيحين لكل صنف');
        expect(
            invoiceSaveError({
                items: [{ itemName: 'أرز', qty: '1', price: '1' }],
                paidTouched: true,
                paidAmount: '-2',
            }),
        ).toBe('أدخل مبلغ سداد صحيحًا أو اتركه فارغًا');
        expect(
            invoiceSaveError({
                items: [{ itemName: 'أرز', qty: '1', price: '1' }],
                discountType: 'percent',
                discountValue: '120',
            }),
        ).toBe('قيمة الخصم غير صحيحة');
        expect(
            invoiceSaveError({
                items: [{ itemName: 'أرز', qty: '1', price: '1', expiryDate: '30/11/2026' }],
            }),
        ).toBe('تاريخ الصلاحية غير صحيح للصنف أرز — الصيغة المطلوبة YYYY-MM-DD');
        expect(
            invoiceSaveError({
                items: [{ itemName: 'أرز', qty: '1', price: '1', expiryDate: '2026-11-30' }],
            }),
        ).toBe('');
        // الصلاحية الفارغة مقبولة (سياسة 2026-10-20)
        expect(invoiceSaveError({ items: [{ itemName: 'أرز', qty: '1', price: '1' }] })).toBe('');
    });

    it('سياسة الصلاحية: غياب مقبول وصيغة صحيحة فقط', () => {
        expect(normalizeExpiryDate('2026-11-30')).toBe('2026-11-30');
        expect(normalizeExpiryDate('2026-02-30')).toBeNull();
        expect(normalizeExpiryDate('30/11/2026')).toBeNull();
        expect(normalizeExpiryDate('')).toBeNull();
        expect(readExpiryField({ expiry_date: '2026-12-01' })).toBe('2026-12-01');
        expect(readExpiryField({})).toBeNull();
    });
});

describe('فواتير الشراء — تقدير الإجمالي (مرآة pcmtGrandEstimate)', () => {
    const items = [
        { itemName: 'أرز', qty: '2', price: '10', taxCategory: 'STANDARD' },
        { itemName: 'سكر', qty: '1', price: '10', taxCategory: 'STANDARD' },
    ];

    it('بدون خصم وبدون ضريبة لمورد غير مسجل', () => {
        expect(invoiceEstimate({ items, supplierId: '' })).toMatchObject({
            subtotal: 30,
            discount: 0,
            net: 30,
            vat: 0,
            grand: 30,
            registered: false,
            selected: false,
        });
    });

    it('خصم نسبة يوزّع على الأسطر وضريبة 15% للمورد المسجل', () => {
        const estimate = invoiceEstimate(
            { items, supplierId: '10', discountType: 'percent', discountValue: '10' },
            true,
        );
        expect(estimate).toMatchObject({ subtotal: 30, discount: 3, net: 27, vat: 4.05, grand: 31.05 });
    });

    it('خصم مبلغ لا يتجاوز الصافي', () => {
        expect(invoiceEstimate({ items, discountType: 'amount', discountValue: '100' })).toMatchObject({
            subtotal: 30,
            discount: 30,
            net: 0,
            vat: 0,
            grand: 0,
        });
    });
});

describe('فواتير الشراء — الرسائل الحرفية', () => {
    it('التسديد الكامل والجزئي', () => {
        expect(payFullConfirm('INV-1', '60.00 SAR')).toBe('تسديد كامل للفاتورة INV-1 — 60.00 SAR نقدًا؟');
        expect(payFullSuccess('INV-1', '60.00 SAR')).toBe('تم تسديد الفاتورة INV-1 (60.00 SAR)');
        expect(payPartialConfirm('10.00 SAR', 'INV-1')).toBe('تسجيل دفعة 10.00 SAR على الفاتورة INV-1؟');
        expect(payPartialSuccess('10.00 SAR', 'INV-1', '42.00 SAR')).toBe(
            'تم تسجيل دفعة 10.00 SAR على الفاتورة INV-1 — رصيد المورد الآن 42.00 SAR',
        );
        expect(payPartialSuccess('10.00 SAR', 'INV-1', null)).toBe('تم تسجيل دفعة 10.00 SAR على الفاتورة INV-1');
        expect(moneyWithUnit('60', 'SAR')).toBe('60.00 SAR');
        expect(moneyWithUnit('60')).toBe('60.00');
    });

    it('الإلغاء: سطر المسدد الشرطي ثم النجاح مع الدفعات التلقائية', () => {
        expect(voidConfirm('INV-1', '100.00 SAR')).toBe(
            'حذف فاتورة الشراء INV-1 (100.00 SAR)؟\nسيُعكس أثرها على المخزون تلقائيًا.',
        );
        expect(voidConfirm('INV-1', '100.00 SAR', '40.00 SAR')).toBe(
            'حذف فاتورة الشراء INV-1 (100.00 SAR)؟\nسيُعكس أثرها على المخزون تلقائيًا.\nعليها مبلغ مسدد 40.00 SAR — إن كانت دفعة تلقائية ستُعكس مع الإلغاء.',
        );
        expect(voidSuccess('INV-1', 2)).toBe('حُذفت الفاتورة INV-1 وعُكس مخزون 2 صنفًا');
        expect(voidSuccess('INV-1', 2, 1)).toBe('حُذفت الفاتورة INV-1 وعُكس مخزون 2 صنفًا وعُكست 1 دفعة تلقائية مرتبطة');
    });

    it('الحذف الجماعي والتأكيد المزدوج', () => {
        expect(clearAllConfirm(3)).toBe('حذف كل فواتير الشراء (3) نهائيًا؟\nستُعكس كمياتها من المخزون ولا يمكن التراجع.');
        expect(clearAllSuccess(3, 12)).toBe('تم حذف 3 فاتورة وعكس 12 قيد مخزون');
        expect(CLEAR_ALL_CONFIRM).toBe('حذف كل الفواتير');
        expect(INVOICE_TEXT.clearAllCheck).toBe('أفهم أن هذه العملية نهائية وتعكس كميات المخزون');
        expect(INVOICE_TEXT.clearAllAction).toBe('حذف كل الفواتير نهائيًا');
        expect(INVOICE_TEXT.clearAllUnchecked).toBe('فعّل مربع التأكيد أولًا.');
    });

    it('حراس الخطأ: التكرار ودفعة الإلغاء اليدوية', () => {
        expect(isDuplicateInvoiceError(new ApiError(409, 'DUPLICATE_INVOICE', 'x'))).toBe(true);
        expect(isDuplicateInvoiceError(new Error('فاتورة مشابهة موجودة'))).toBe(true);
        expect(isDuplicateInvoiceError(new Error('خطأ آخر'))).toBe(false);
        expect(isDuplicateInvoiceError(null)).toBe(false);
        expect(isVoidPaymentError(new Error('الفاتورة مرتبطة بدفعات موردين يدوية'))).toBe(true);
        expect(isVoidPaymentError(new Error('تدفع يدوية'))).toBe(true);
        expect(isVoidPaymentError(new Error('الفاتورة مسددة بالكامل'))).toBe(false);
        expect(INVOICE_TEXT.voidPaymentGuide).toBe(' — افتح «المشتريات › المدفوعات» واعكس الدفعة يدويًا ثم أعد الإلغاء');
    });

    it('تحقق الدفعة الجزئية قبل الإرسال', () => {
        expect(partialPaymentError('', '60.00')).toBe('أدخل مبلغًا أكبر من صفر');
        expect(partialPaymentError('0', '60.00')).toBe('أدخل مبلغًا أكبر من صفر');
        expect(partialPaymentError('abc', '60.00')).toBe('أدخل مبلغًا أكبر من صفر');
        expect(partialPaymentError('70', '60.00')).toBe('المبلغ يتجاوز المتبقي (60.00)');
        expect(partialPaymentError('60', '60.00')).toBe('');
        expect(partialPaymentError('59.99', 60)).toBe('');
    });
});

describe('فواتير الشراء — البوابات الست (المسارات والحمولات)', () => {
    it('إنشاء: POST /api/warehouse/purchase-invoices', async () => {
        const calls = stubFetch(() => json({ ok: true, data: { id: 1 } }));
        await createPurchaseInvoice(formWithItem);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-invoices');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toMatchObject({ invoiceNumber: 'INV-9', supplierName: 'مورد الخضار' });
    });

    it('تعديل: PUT مع معرّف موجب أو رسالة V2', async () => {
        const calls = stubFetch(() => json({ ok: true }));
        await updatePurchaseInvoice('7', formWithItem);
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-invoices/7');
        expect(calls[0]?.init.method).toBe('PUT');
        expect(() => invoiceIdOf(0)).toThrow('معرف الفاتورة غير صحيح');
        expect(() => invoiceIdOf('abc')).toThrow('معرف الفاتورة غير صحيح');
        await expect(updatePurchaseInvoice('0', formWithItem)).rejects.toThrow('معرف الفاتورة غير صحيح');
    });

    it('إلغاء: POST .../void بجسم فارغ ويعيد الأرقام', async () => {
        const calls = stubFetch(() => json({ ok: true, invoiceNumber: 'INV-1', reversedItems: 2, deletedPayments: 1 }));
        const result = await voidPurchaseInvoice('3');
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-invoices/3/void');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({});
        expect(result).toEqual({ invoiceNumber: 'INV-1', reversedItems: 2, deletedPayments: 1 });
    });

    it('حذف الكل: POST .../clear-all بعبارة التأكيد الحرفية', async () => {
        const calls = stubFetch(() => json({ ok: true, deletedInvoices: 3, reversedLedgerRows: 12 }));
        const result = await clearAllPurchaseInvoices();
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-invoices/clear-all');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ confirm: CLEAR_ALL_CONFIRM });
        expect(result).toEqual({ deletedInvoices: 3, reversedLedgerRows: 12 });
    });

    it('تسديد كامل: POST /procurement/invoices/:id/pay بجسم {method}', async () => {
        const calls = stubFetch(() => json({ payment: {}, invoice: {} }, 201));
        await payInvoiceFull('4');
        expect(calls[0]?.url).toBe('/api/procurement/invoices/4/pay');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ method: 'cash' });
    });

    it('دفعة جزئية: POST /procurement/payments ويعيد رصيد المورد', async () => {
        const calls = stubFetch(() => json({ payment: {}, invoice: {}, supplierDueTotal: '42.00' }, 201));
        const due = await payInvoicePartial('5', {
            supplierId: '10',
            amount: '10',
            method: 'bank',
            date: '2026-11-09',
            notes: 'دفعة',
        });
        expect(calls[0]?.url).toBe('/api/procurement/payments');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({
            supplierId: 10,
            amount: 10,
            method: 'bank',
            date: '2026-11-09',
            invoiceId: 5,
            notes: 'دفعة',
        });
        expect(due).toBe(42);
        expect(partialPaymentPayload(5, { supplierId: 10, amount: 10, date: '2026-11-09' })).toEqual({
            supplierId: 10,
            amount: 10,
            method: 'cash',
            date: '2026-11-09',
            invoiceId: 5,
        });
    });

    it('خطأ الخادم يمرّ كـApiError برسالته العربية', async () => {
        stubFetch(() =>
            json(
                { error: 'INVOICE_HAS_PAYMENTS', message: 'الفاتورة مرتبطة بدفعات موردين يدوية — لا يمكن إلغاؤها' },
                409,
            ),
        );
        const failure = await voidPurchaseInvoice('9').catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({
            status: 409,
            code: 'INVOICE_HAS_PAYMENTS',
            message: 'الفاتورة مرتبطة بدفعات موردين يدوية — لا يمكن إلغاؤها',
        });
        expect(isVoidPaymentError(failure)).toBe(true);
    });
});
