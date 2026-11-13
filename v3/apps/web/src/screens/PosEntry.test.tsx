import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { calculatePosTotals, type PosCartLine } from '../lib/pos-pricing';
import { ToastProvider } from '../ui/Toast';
import { installDomPolyfills } from '../ui/test-utils';
import { PosEntry } from './PosEntry';

/**
 * نقطة البيع — اختبار العقد الظاهر:
 *  • بلا وردية نشطة تُعرض شاشة الفتح بالقسم والعهدة، لا تخمين قسم.
 *  • الأصناف من الخادم كما هي، والإضافة تحسب في السلة والسلة وحدها.
 *  • البيع يذهب إلى `/api/sales/complete` بمفتاح منع تكرار ثابت عند إعادة
 *    المحاولة، ورؤوس الوردية كما يفرضها الخادم.
 *  • الإيصال يعرض أرقام الخادم، لا حساب العميل.
 */

installDomPolyfills();

const mocks = vi.hoisted(() => ({ role: 'cashier' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '7', name: 'كاشير اختبار', username: 'cashier', role: mocks.role, deptCode: 'K01' },
    }),
}));

const DEPARTMENT = {
    id: 7,
    code: 'K01',
    name_ar: 'الكاشير الرئيسي',
    name_en: 'Main Cashier',
    is_active: true,
    vat_number: '300000000000003',
};

const SHIFT = {
    id: '44',
    session_id: '44',
    department_id: '7',
    cashier_id: '7',
    status: 'open',
    opening_balance: 100,
    opened_at: new Date().toISOString(),
    dept_name: 'الكاشير الرئيسي',
    dept_code: 'K01',
};

const STALE_SHIFT = {
    ...SHIFT,
    id: '5',
    session_id: '5',
    opened_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
};

const TEA = {
    id: 501,
    name_ar: 'شاي',
    name_en: 'Tea',
    barcode: '6281000000011',
    price: 10,
    cost_price: 3,
    stock_quantity: 40,
    vat_rate: 15,
    category: 'مشروبات',
    unit: 'كوب',
    department_id: 7,
    is_active: true,
    min_stock_level: 5,
    image_url: '',
    ingredient_count: 0,
};

const COFFEE = {
    ...TEA,
    id: 502,
    name_ar: 'قهوة',
    name_en: 'Coffee',
    barcode: '6281000000028',
    price: 20,
    category: 'مشروبات',
};

const SALE_RESULT = {
    order_id: '0f7a4c62-8a8e-4f5e-9f30-9a3f5b2c1d10',
    invoice_counter: 11,
    invoice_uuid: '0f7a4c62-8a8e-4f5e-9f30-9a3f5b2c1d10',
    invoice_hash: 'hash',
    qr_payload: '',
    digital_signature: 'sig',
    total_amount: 11.5,
    tax_total: 1.5,
    subtotal: 11.5,
    discount_total: 0,
    paid: 11.5,
    change: 0,
    non_cash_overpayment: null,
    print_job_id: '99',
    zatca_queued: true,
    kot_enabled: false,
    kot_jobs: [],
    session_id: '44',
    erp_revenue_id: null,
    erp_dept_code: 'K01',
    buffet: null,
    party_name: null,
};

const BUFFET_SHIFT = {
    ...SHIFT,
    department_id: '9',
    dept_name: 'البوفيه المفتوح',
    dept_code: 'erp_open_buffet',
};

const BUFFET_TIERS = [
    { id: 11, tier: 'adult', name_ar: 'بالغ', price: 60, vat_rate: 15, unit: 'فرد', is_core: true, is_active: true },
    { id: 12, tier: 'child', name_ar: 'طفل', price: 30, vat_rate: 15, unit: 'فرد', is_core: true, is_active: true },
    { id: 13, tier: 'hospitality', name_ar: 'ضيافة', price: 0, vat_rate: 15, unit: 'فرد', is_core: true, is_active: true },
    { id: 14, tier: null, name_ar: 'بوفيه عائلي', price: 100, vat_rate: 15, unit: 'فرد', is_core: false, is_active: true },
];

const BUFFET_LIVE = {
    daily: {
        covers_total: 42,
        revenue: 2520,
        invoices_count: 12,
        voided: { count: 1, amount: 60 },
    },
    shift: { session_id: 44, covers_total: 10, held_orders: 1, revenue: 0 },
};

const BUFFET_REPORT = {
    date: '2026-11-09',
    generated_at: '2026-11-09 20:00',
    totals: {
        covers_total: 42,
        revenue: 2520,
        vat_total: 328.7,
        net_revenue: 2191.3,
        invoices: 12,
        revenue_per_cover: 60,
        voided: { count: 1, amount: 60 },
        still_held: { count: 1, amount: 0 },
    },
    tiers: [{ name: 'بالغ', covers: 30, revenue: 1800, avg_price: 60, invoices: 10 }],
    hourly: [{ hour: 20, invoices: 12, covers: 42, revenue: 2520 }],
    payments: [{ method: 'cash', count: 12, total: 2520 }],
    cashiers: [{ cashier: 'كاشير اختبار', invoices: 12, revenue: 2520 }],
};

const SHIFT_SUMMARY = {
    id: '44',
    department_id: '7',
    opening_balance: 100,
    dept_name: 'الكاشير الرئيسي',
    cash_in: 50,
    cash_out: 20,
    card_in: 0,
    wallet_in: 0,
    invoice_count: 3,
    sales_total: 40,
    discount_total: 0,
    tax_total: 5.2,
    voided_count: 0,
    voided_amount: 0,
};

const ORDER_ROW = {
    id: '0f7a4c62-8a8e-4f5e-9f30-9a3f5b2c1d10',
    invoice_counter: 11,
    invoice_uuid: '0f7a4c62-8a8e-4f5e-9f30-9a3f5b2c1d10',
    status: 'issued',
    subtotal: 10,
    discount_total: 0,
    tax_total: 1.5,
    total_amount: 11.5,
    currency_code: 'SAR',
    notes: null,
    void_reason: null,
    created_at: '2026-11-09 09:45',
    updated_at: '2026-11-09 09:45',
    department_name: 'الكاشير الرئيسي',
    department_name_en: null,
    cashier_name: 'كاشير اختبار',
    item_count: 1,
    payments: [{ method: 'cash', amount: 11.5, reference: null }],
};

const ORDER_DETAIL = {
    ...ORDER_ROW,
    vat_number: '300000000000003',
    items: [
        {
            id: '1',
            product_id: '501',
            product_name: 'شاي',
            product_barcode: '6281000000011',
            quantity: 1,
            unit_price: 10,
            discount: 0,
            vat_rate: 15,
            line_total: 11.5,
            vat_amount: 1.5,
        },
    ],
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

interface StubOptions {
    activeShift?: unknown | null;
    departments?: unknown;
    products?: unknown;
    sale?: unknown;
    saleStatus?: number;
    buffetTiers?: unknown;
    buffetLive?: unknown;
    buffetReport?: unknown;
    ordersPage?: unknown;
    orderDetail?: unknown;
    shiftSummary?: unknown;
    drawer?: unknown;
    holdResult?: unknown;
    reprintResult?: unknown;
    quoteResponse?: unknown;
    quoteStatus?: number;
}

function stubFetch(options: StubOptions = {}) {
    const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const href = String(input);
        if (href.includes('/api/pos/departments')) {
            return json(options.departments ?? [DEPARTMENT]);
        }
        if (href.includes('/api/pos/shifts/active')) {
            return options.activeShift ? json(options.activeShift) : json({ error: 'NOT_FOUND', message: 'لا توجد وردية مفتوحة' }, 404);
        }
        if (/\/api\/pos\/shifts\/[0-9]+\/summary/.test(href)) {
            return json(options.shiftSummary ?? SHIFT_SUMMARY);
        }
        if (href.includes('/api/pos/buffet/config')) {
            return json({ tiers: options.buffetTiers ?? BUFFET_TIERS });
        }
        if (href.includes('/api/pos/buffet/live')) {
            return json(options.buffetLive ?? BUFFET_LIVE);
        }
        if (href.includes('/api/pos/buffet/report')) {
            return json(options.buffetReport ?? BUFFET_REPORT);
        }
        if (href.includes('/api/pos/buffet/invoices')) {
            return json({ data: [] });
        }
        if (href.includes('/reprint')) {
            return json(options.reprintResult ?? { message: 'أُرسل الإيصال إلى طابور الطباعة.' });
        }
        if (href.includes('/api/pos/orders/export')) {
            return json({ data: [ORDER_ROW] });
        }
        if (/\/api\/pos\/orders\/[0-9a-f-]{36}$/.test(href)) {
            return json(options.orderDetail ?? ORDER_DETAIL);
        }
        if (href.includes('/api/pos/orders')) {
            return json(
                options.ordersPage ?? {
                    data: [ORDER_ROW],
                    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
                },
            );
        }
        if (href.includes('/api/pos/products')) {
            return json(options.products ?? [TEA, COFFEE]);
        }
        if (href.includes('/api/pos/held-orders')) {
            if (init?.method === 'POST') {
                return json(
                    options.holdResult ?? {
                        id: '5c1d8e2f-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
                        created_at: '2026-11-09 10:00',
                        total_amount: 11.5,
                    },
                );
            }
            return json([]);
        }
        if (href.includes('/api/pos/drawer/open')) {
            return json(options.drawer ?? { ok: true, printer_id: 'pos-7', at: '2026-11-09T10:00:00.000Z' });
        }
        if (href.includes('/api/sales/quote')) {
            if (options.quoteResponse) {
                return json(options.quoteResponse, options.quoteStatus ?? 200);
            }
            // نفس معادلة الخادم (أعداد صحيحة، half-up) حتى يُختبر العقد لا التخمين.
            const payload =
                typeof init?.body === 'string'
                    ? (JSON.parse(init.body) as {
                          items?: Array<{ product_id: number; quantity: number; unit_price: number; discount: number }>;
                      })
                    : {};
            const catalog = (options.products ?? [TEA, COFFEE]) as Array<{ id: number; name_ar: string; price: number; vat_rate: number }>;
            const lines: PosCartLine[] = (payload.items ?? []).map((item) => ({
                id: String(item.product_id),
                name: catalog.find((row) => Number(row.id) === Number(item.product_id))?.name_ar ?? '',
                price: item.unit_price,
                vatRate: catalog.find((row) => Number(row.id) === Number(item.product_id))?.vat_rate ?? 15,
                quantity: item.quantity,
            }));
            const totals = calculatePosTotals(lines, { type: '', value: '0' });
            return json({
                quote: true,
                subtotal: totals.subtotal,
                discount_total: totals.discount,
                tax_total: totals.tax,
                total_amount: totals.total,
                line_items: totals.items.map((row) => ({
                    product_id: row.id,
                    quantity: row.quantity,
                    unit_price: row.price,
                    discount: row.discount,
                    vat_rate: row.vatRate,
                    line_total: row.subtotal,
                    vat_amount: row.tax,
                    line_total_incl: row.subtotal + row.tax,
                })),
            });
        }
        if (href.includes('/api/sales/complete')) {
            return json(options.sale ?? SALE_RESULT, options.saleStatus ?? 200);
        }
        return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <PosEntry />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

async function openShiftMenu() {
    fireEvent.click(await screen.findByText('إدارة الوردية'));
}

function saleCalls(mock: ReturnType<typeof stubFetch>) {
    return mock.mock.calls.filter((call) => String(call[0]).includes('/api/sales/complete'));
}

function callInit(call: unknown[]): RequestInit {
    return (call[1] ?? {}) as RequestInit;
}

afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    mocks.role = 'cashier';
});

describe('نقطة البيع', () => {
    it('بلا وردية نشطة تعرض فتح الوردية بأقسام الخادم دون تخمين', async () => {
        const mock = stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'فتح وردية' })).toBeTruthy();
        });
        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('الكاشير');
        expect(screen.getByLabelText('العهدة الافتتاحية')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: /السلة/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'فتح الوردية' }).hasAttribute('disabled')).toBe(true);

        // الأصناف لا تُطلب قبل وجود وردية.
        expect(mock.mock.calls.some((call) => String(call[0]).includes('/api/pos/products'))).toBe(false);
    });

    it('وردية يوم سابق تُحجب البيع وتقود لإغلاقها قبل فتح وردية اليوم', async () => {
        const mock = stubFetch({ activeShift: STALE_SHIFT });
        renderScreen();

        expect(await screen.findByRole('heading', { name: 'وردية يوم سابق ما زالت مفتوحة' })).toBeTruthy();
        expect(screen.getAllByText(/#5/).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: 'إضافة شاي إلى السلة' })).toBeNull();
        // لا تُطلب الأصناف ولا تُرسل بيع على وردية مرفوضة من الخادم.
        expect(mock.mock.calls.some((call) => String(call[0]).includes('/api/pos/products'))).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'إغلاق وردية الأمس' }));
        expect(await screen.findByRole('heading', { name: 'إغلاق الوردية' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText('النقد المتوقع')).toBeTruthy();
        });
    });

    it('ردّ 409 SHIFT_STALE أثناء البيع يعيد قراءة الوردية برسالة صريحة', async () => {
        const mock = stubFetch({
            activeShift: SHIFT,
            saleStatus: 409,
            sale: { error: 'SHIFT_STALE', message: 'الوردية من يوم سابق — أغلقها وافتح وردية اليوم' },
        });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));

        expect(await screen.findByText('وردية الأمس ما زالت مفتوحة؛ أغلقها أولًا ثم افتح وردية اليوم.')).toBeTruthy();
        await waitFor(() => {
            const shiftReads = mock.mock.calls.filter((call) => String(call[0]).includes('/api/pos/shifts/active'));
            expect(shiftReads.length).toBeGreaterThan(1);
        });
    });

    it('يعرض أصناف الخادم، والإضافة تحسب في السلة وحدها', async () => {
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        const tea = await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' });
        expect(screen.getByText('الكاشير الرئيسي')).toBeTruthy();
        expect(screen.getByText(/وردية #44/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إضافة قهوة إلى السلة' })).toBeTruthy();

        fireEvent.click(tea);

        expect(screen.getByRole('heading', { name: /السلة/ })).toBeTruthy();
        const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('شاي')).toBeTruthy();
        expect(within(cart).getByRole('group', { name: 'كمية شاي' })).toBeTruthy();

        // البحث يرشّح بطاقة القهوة خارج الشاشة.
        fireEvent.change(screen.getByLabelText('بحث الأصناف'), { target: { value: 'شاي' } });
        expect(screen.queryByRole('button', { name: 'إضافة قهوة إلى السلة' })).toBeNull();
        expect(screen.getByRole('button', { name: 'إضافة شاي إلى السلة' })).toBeTruthy();
    });

    it('يرسل البيع بمفتاح منع تكرار ورؤوس الوردية، ويعرض إيصال الخادم', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));

        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        const init = callInit(saleCalls(mock)[0] as unknown[]);
        const headers = init.headers as Record<string, string>;
        expect(headers['Idempotency-Key']).toMatch(/^v3-pos-44-/);
        expect(headers['X-Shift-Session-Id']).toBe('44');
        expect(init.method).toBe('POST');

        const body = JSON.parse(String(init.body)) as {
            department_id: number;
            items: Array<{ product_id: number; quantity: number }>;
            payments: Array<{ method: string; amount: number }>;
        };
        expect(body.department_id).toBe(7);
        expect(body.items).toEqual([{ product_id: 501, quantity: 1, unit_price: 10, discount: 0 }]);
        expect(body.payments).toEqual([{ method: 'cash', amount: 11.5, reference: null }]);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /إيصال البيع/ })).toBeTruthy();
        });
        expect(screen.getByText('#11')).toBeTruthy();
        expect(screen.getByText('أُضيف الإيصال إلى الطابور')).toBeTruthy();
        // السلة فُرّغت بعد نجاح الخادم.
        expect(screen.getByText('السلة فارغة — اختر صنفًا للبدء.')).toBeTruthy();
    });

    it('يطلب معاينة الخادم بعد تثبيت السلة (نفس محرّك الفاتورة)', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));

        await waitFor(
            () => {
                expect(mock.mock.calls.some((call) => String(call[0]).includes('/api/sales/quote'))).toBe(true);
            },
            { timeout: 3000 },
        );
    });

    it('فاتورة غير متوازنة: تُعرض رسالة الرفض ولا يُرسل البيع', async () => {
        const mock = stubFetch({
            activeShift: SHIFT,
            quoteResponse: { error: 'INVOICE_UNBALANCED', message: 'الفاتورة غير متوازنة: 60.87 + 9.20 ≠ 70.00' },
            quoteStatus: 422,
        });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        expect(await screen.findByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));
        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(0);
        });
    });

    it('يبقي السلة ويعيد المحاولة بنفس مفتاح منع التكرار بعد فشل الخادم', async () => {
        const mock = stubFetch({ activeShift: SHIFT, saleStatus: 500 });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));

        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        const firstHeaders = callInit(saleCalls(mock)[0] as unknown[]).headers as Record<string, string>;
        const firstKey = firstHeaders['Idempotency-Key'];
        expect(firstKey).toBeTruthy();
        // السلة باقية بعد الفشل.
        expect(screen.getByRole('heading', { name: /السلة/ })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));
        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(2);
        });
        const secondHeaders = callInit(saleCalls(mock)[1] as unknown[]).headers as Record<string, string>;
        expect(secondHeaders['Idempotency-Key']).toBe(firstKey);
    });

    it('يسترجع الطلب المعلق عبر مسار الوردية نفسها', async () => {
        const held = [
            {
                id: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
                created_at: '2026-11-09 09:30',
                total_amount: 23,
                items_preview: 'شاي × 1، قهوة × 1',
            },
        ];
        const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
            const href = String(input);
            if (href.includes('/api/pos/shifts/active')) {
                return json(SHIFT);
            }
            if (href.includes('/api/pos/products')) {
                return json([TEA, COFFEE]);
            }
            if (href.includes('/recall')) {
                expect(init?.method).toBe('POST');
                return json({
                    id: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
                    items: [
                        { product_id: 501, name: 'شاي', barcode: '', quantity: 1, unit_price: 10, discount: 0, vat_rate: 15 },
                        { product_id: 502, name: 'قهوة', barcode: '', quantity: 1, unit_price: 20, discount: 0, vat_rate: 15 },
                    ],
                    cart_discount: null,
                    total_amount: 23,
                });
            }
            if (href.includes('/api/pos/held-orders')) {
                return json(held);
            }
            if (href.includes('/api/pos/departments')) {
                return json([DEPARTMENT]);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        });
        vi.stubGlobal('fetch', mock);

        renderScreen();

        await screen.findByText('شاي × 1، قهوة × 1');
        fireEvent.click(screen.getByRole('button', { name: 'استرجاع' }));

        await waitFor(() => {
            const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
            expect(within(cart).getByText('قهوة')).toBeTruthy();
        });
        expect(mock.mock.calls.some((call) => String(call[0]).includes('/recall'))).toBe(true);
    });

    it('قسم البوفيه يبيع أفرادًا ويظهر العداد الحي وتعديل الأسعار', async () => {
        mocks.role = 'manager';
        const mock = stubFetch({ activeShift: BUFFET_SHIFT });
        renderScreen();

        const adult = await screen.findByRole('button', { name: 'إضافة بالغ إلى السلة' });
        expect(screen.getByText('بوفيه مفتوح')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('فرد اليوم')).toBeTruthy();
        expect(screen.getByText('1 ملغاة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إضافة طفل إلى السلة' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إضافة بوفيه عائلي إلى السلة' })).toBeTruthy();
        // لا طلب أصناف في قسم البوفيه — الفئات وحدها.
        expect(mock.mock.calls.some((call) => String(call[0]).includes('/api/pos/products'))).toBe(false);

        fireEvent.click(adult);
        const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('بالغ')).toBeTruthy();
        expect(within(cart).getByText(/فرد/)).toBeTruthy();

        await openShiftMenu();
        fireEvent.click(screen.getByRole('button', { name: 'أسعار البوفيه' }));
        expect(screen.getByRole('heading', { name: 'قائمة أسعار البوفيه' })).toBeTruthy();
        expect(screen.getByDisplayValue('بوفيه عائلي')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حفظ الأسعار والأسماء' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'العودة إلى الكاشير' })).toBeTruthy();
    });

    it('تقرير البوفيه يعرض مؤشرات الخادم وأقسامه', async () => {
        mocks.role = 'manager';
        stubFetch({ activeShift: BUFFET_SHIFT });
        renderScreen();

        await openShiftMenu();
        fireEvent.click(await screen.findByRole('button', { name: 'تقرير البوفيه' }));

        expect(await screen.findByRole('heading', { name: 'تقرير البوفيه المفتوح' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText('إجمالي الأفراد')).toBeTruthy();
        });
        expect(screen.getAllByText('42').length).toBeGreaterThan(0);
        expect(screen.getByText('حسب الفئة')).toBeTruthy();
        expect(screen.getByText('التوزيع الساعي')).toBeTruthy();
        expect(screen.getByText('طرق الدفع')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'طباعة التقرير' })).toBeTruthy();
    });

    it('سجل الفواتير يعرض صفحة الخادم، والتفصيل يلغي بسبب مكتوب', async () => {
        mocks.role = 'manager';
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        await openShiftMenu();
        fireEvent.click(await screen.findByRole('button', { name: 'سجل الفواتير' }));

        expect(await screen.findByRole('heading', { name: 'سجل فواتير الكاشير' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText('الكاشير الرئيسي')).toBeTruthy();
        });
        expect(screen.getByText('صادرة')).toBeTruthy();
        expect(screen.getByText('11.50')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'عرض' }));

        expect(await screen.findByRole('heading', { name: 'تفاصيل الفاتورة #11' })).toBeTruthy();
        expect(screen.getByText('شاي')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة ورد المبلغ' }));
        fireEvent.change(screen.getByLabelText('سبب الإلغاء (مطلوب)'), { target: { value: 'خطأ في الإدخال' } });
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));

        await waitFor(() => {
            const call = mock.mock.calls.find((entry) => String(entry[0]).includes('/void'));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body)) as { reason: string };
            expect(body.reason).toBe('خطأ في الإدخال');
        });
    });

    it('إغلاق الوردية يطلب النقد الفعلي ويغلق بنقد الخادم المتوقع مسبقًا', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' });
        await openShiftMenu();
        fireEvent.click(screen.getByRole('button', { name: 'إغلاق الوردية' }));

        expect(await screen.findByRole('heading', { name: 'إغلاق الوردية' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText('النقد المتوقع')).toBeTruthy();
        });
        expect((screen.getByLabelText('النقد الفعلي') as HTMLInputElement).value).toBe('130.00');

        const buttons = screen.getAllByRole('button', { name: 'إغلاق الوردية' });
        fireEvent.click(buttons[buttons.length - 1] as HTMLElement);

        // تأكيد نافذة ConfirmProvider الافتراضية.
        const confirmDialog = await screen.findByRole('dialog', { name: 'تأكيد الإجراء' });
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'إغلاق الوردية' }));

        await waitFor(() => {
            const call = mock.mock.calls.find((entry) => String(entry[0]).includes('/api/pos/shifts/44/close'));
            expect(call).toBeTruthy();
            const body = JSON.parse(String(call?.[1]?.body)) as { actual_cash: number };
            expect(body.actual_cash).toBe(130);
        });
    });

    it('يفصل الطلبات المتوازية: كل تبويب سلة ودفع ومفتاح مستقل', async () => {
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        expect(screen.getByRole('tab', { name: /طلب 1/ }).getAttribute('aria-selected')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: '+ طلب جديد' }));
        const addTabDialog = await screen.findByRole('dialog', { name: 'تأكيد الإجراء' });
        fireEvent.click(within(addTabDialog).getByRole('button', { name: 'التبديل مع الاحتفاظ بالطلب' }));
        const secondTab = await screen.findByRole('tab', { name: /طلب 2/ });
        expect(secondTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByText('السلة فارغة — اختر صنفًا للبدء.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'إضافة قهوة إلى السلة' }));
        let cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('قهوة')).toBeTruthy();
        expect(within(cart).queryByText('شاي')).toBeNull();

        // Ctrl+1 يعود للطلب الأول دون فقدان سلته.
        fireEvent.keyDown(window, { key: '1', ctrlKey: true });
        const switchTabDialog = await screen.findByRole('dialog', { name: 'تأكيد الإجراء' });
        fireEvent.click(within(switchTabDialog).getByRole('button', { name: 'التبديل مع الاحتفاظ بالطلب' }));
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /طلب 1/ }).getAttribute('aria-selected')).toBe('true');
        });
        cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('شاي')).toBeTruthy();
        expect(within(cart).queryByText('قهوة')).toBeNull();
    });

    it('لوحة الدفع السريع تستبدل المبلغ التلقائي، وتجمع الأوراق النقدية، وتعيد المطلوب', async () => {
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByText('تعديل'));
        const cash = screen.getByLabelText('نقدي') as HTMLInputElement;
        await waitFor(() => {
            expect(cash.value).toBe('11.50');
        });

        const numpad = screen.getByRole('group', { name: 'لوحة الدفع السريع' });
        fireEvent.click(within(numpad).getByRole('button', { name: '5' }));
        fireEvent.click(within(numpad).getByRole('button', { name: '0' }));
        expect(cash.value).toBe('50');

        fireEvent.click(within(numpad).getByRole('button', { name: 'إضافة 100 إلى النقدي' }));
        expect(cash.value).toBe('150.00');

        fireEvent.click(within(numpad).getByRole('button', { name: 'المبلغ المطلوب بالضبط' }));
        expect(cash.value).toBe('11.50');
    });

    it('تثبيت صنف مفضل لكل قسم يظهر شريطًا سريعًا ويُحفظ محليًا', async () => {
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى المفضلة' }));

        const strip = screen.getByRole('group', { name: 'الأصناف المفضلة' });
        expect(within(strip).getByRole('button', { name: 'إضافة شاي إلى السلة من المفضلة' })).toBeTruthy();
        expect(window.localStorage.getItem('v3-pos-favorites:7')).toBe(JSON.stringify([String(TEA.id)]));

        fireEvent.click(within(strip).getByRole('button', { name: 'إضافة شاي إلى السلة من المفضلة' }));
        const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('شاي')).toBeTruthy();
    });

    it('فتح الدرج يمر بوردية الخادم ويكتب أثرًا عبر المسار المخصص', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'فتح الدرج' }));

        await waitFor(() => {
            const call = mock.mock.calls.find((entry) => String(entry[0]).includes('/api/pos/drawer/open'));
            expect(call).toBeTruthy();
            const headers = callInit(call as unknown[]).headers as Record<string, string>;
            expect(headers['X-Shift-Session-Id']).toBe('44');
            expect(callInit(call as unknown[]).method).toBe('POST');
        });
    });

    it('F5 من لوحة المفاتيح يُتمم البيع بنفس عقد الزر', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.keyDown(window, { key: 'F5' });

        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        expect(callInit(saleCalls(mock)[0] as unknown[]).headers).toMatchObject({ 'X-Shift-Session-Id': '44' });
    });

    it('F4 من لوحة المفاتيح يُتمم البيع من اختصار الشاشة الجديد', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.keyDown(window, { key: 'F4' });

        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        expect(callInit(saleCalls(mock)[0] as unknown[]).headers).toMatchObject({ 'X-Shift-Session-Id': '44' });
    });

    it('F2 يركّز البحث وF9 يفتح سجل الفواتير للمخول', async () => {
        mocks.role = 'manager';
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        const search = await screen.findByPlaceholderText(/F2/);
        fireEvent.keyDown(window, { key: 'F2' });
        expect(search).toHaveFocus();

        fireEvent.keyDown(window, { key: 'F9' });
        expect(await screen.findByRole('heading', { name: 'سجل فواتير الكاشير' })).toBeTruthy();
    });

    it('خصم نسبي يُوزَّع على البنود، واللقطة المعروضة هي ما يُرسل للخادم', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByText('تعديل'));

        fireEvent.click(screen.getByRole('combobox', { name: 'نوع الخصم' }));
        fireEvent.click(await screen.findByRole('option', { name: 'نسبة مئوية' }));
        fireEvent.change(screen.getByLabelText('قيمة الخصم'), { target: { value: '10' } });

        // 10.00 − خصم 1.00 = 9.00، وضريبة 15% = 1.35، والإجمالي 10.35 بالقرش لا بالعوم.
        const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getByText('−1.00')).toBeTruthy();
        expect(within(cart).getAllByText('10.35').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));
        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        const body = JSON.parse(String(callInit(saleCalls(mock)[0] as unknown[]).body)) as {
            items: Array<{ product_id: number; quantity: number; unit_price: number; discount: number }>;
        };
        expect(body.items).toEqual([{ product_id: 501, quantity: 1, unit_price: 10, discount: 1 }]);
    });

    it('خصم نسبي فوق 100% يُعلن خطأً ويمنع البيع', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByText('تعديل'));
        fireEvent.click(screen.getByRole('combobox', { name: 'نوع الخصم' }));
        fireEvent.click(await screen.findByRole('option', { name: 'نسبة مئوية' }));
        fireEvent.change(screen.getByLabelText('قيمة الخصم'), { target: { value: '140' } });

        expect(await screen.findByText('قيمة الخصم غير صالحة؛ النسبة من 0 إلى 100.')).toBeTruthy();
        const complete = screen.getByRole('button', { name: 'إتمام البيع' });
        expect(complete.hasAttribute('disabled')).toBe(true);
        expect(saleCalls(mock)).toHaveLength(0);
    });

    it('الدفع المقسّم: نقدي وبطاقة بمرجع، ويلغي التأكيد عند المطابقة', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByText('تعديل'));

        fireEvent.change(screen.getByLabelText('نقدي'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('بطاقة'), { target: { value: '6.5' } });
        fireEvent.change(screen.getByLabelText('مرجع بطاقة'), { target: { value: 'AUTH-9911' } });
        expect(screen.getByText('المبلغ المدفوع مطابق للإجمالي.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));
        await waitFor(() => {
            expect(saleCalls(mock)).toHaveLength(1);
        });
        // لا نافذة تأكيد: المبلغ مطابق.
        expect(screen.queryByRole('dialog', { name: 'تأكيد الإجراء' })).toBeNull();
        const body = JSON.parse(String(callInit(saleCalls(mock)[0] as unknown[]).body)) as {
            payments: Array<{ method: string; amount: number; reference: string | null }>;
        };
        expect(body.payments).toEqual([
            { method: 'cash', amount: 5, reference: null },
            { method: 'card', amount: 6.5, reference: 'AUTH-9911' },
        ]);
    });

    it('المبلغ المدفوع أقل من الإجمالي يُرفض بلا طلب بيع', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByText('تعديل'));
        fireEvent.change(screen.getByLabelText('نقدي'), { target: { value: '5' } });

        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('المبلغ المدفوع أقل من إجمالي الفاتورة.');
        expect(saleCalls(mock)).toHaveLength(0);
        // السلة باقية كما هي.
        expect(screen.getByRole('heading', { name: /السلة/ })).toBeTruthy();
    });

    it('تعليق الطلب يرسل السلة للخادم بمفتاح الوردية ثم يُفرّغها', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'تعليق الطلب الحالي' }));

        await waitFor(() => {
            const call = mock.mock.calls.find((entry) => String(entry[0]).includes('/api/pos/held-orders') && entry[1]?.method === 'POST');
            expect(call).toBeTruthy();
            const init = callInit(call as unknown[]);
            const headers = init.headers as Record<string, string>;
            expect(headers['x-device-name']).toBeTruthy();
            const body = JSON.parse(String(init.body)) as {
                session_id: number;
                department_id: number;
                items: Array<{ product_id: number; quantity: number; unit_price: number; discount: number }>;
                cart_discount: unknown;
            };
            expect(body.session_id).toBe(44);
            expect(body.department_id).toBe(7);
            expect(body.items).toEqual([{ product_id: 501, quantity: 1, unit_price: 10, discount: 0 }]);
            expect(body.cart_discount).toBeNull();
        });
        expect(await screen.findByText('تم تعليق الطلب في الخادم.')).toBeTruthy();
        expect(screen.getByText('السلة فارغة — اختر صنفًا للبدء.')).toBeTruthy();
    });

    it('إعادة طباعة الإيصال تمر بمعرّف الفاتورة من رد الخادم', async () => {
        const mock = stubFetch({ activeShift: SHIFT });
        renderScreen();

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'إتمام البيع' }));

        fireEvent.click(await screen.findByRole('button', { name: 'إعادة طباعة الإيصال' }));

        await waitFor(() => {
            const call = mock.mock.calls.find((entry) => String(entry[0]).includes('/reprint'));
            expect(call).toBeTruthy();
            expect(String(call?.[0])).toBe(`/api/pos/orders/${SALE_RESULT.order_id}/reprint`);
            expect(callInit(call as unknown[]).method).toBe('POST');
        });
        expect(await screen.findByText('أُرسل الإيصال إلى طابور الطباعة.')).toBeTruthy();
    });

    it('أزرار الكمية تحدّث الإجمالي، والباركود مع Enter يضيف الصنف ويمسح البحث', async () => {
        stubFetch({ activeShift: SHIFT });
        renderScreen();

        const search = (await screen.findByLabelText('بحث الأصناف')) as HTMLInputElement;
        expect(document.activeElement).toBe(search);

        fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
        fireEvent.click(screen.getByRole('button', { name: 'زيادة شاي' }));
        fireEvent.click(screen.getByRole('button', { name: 'زيادة شاي' }));

        const cart = screen.getByRole('heading', { name: /السلة/ }).closest('section') as HTMLElement;
        expect(within(cart).getAllByText('30.00').length).toBeGreaterThan(0);
        expect(within(within(cart).getByRole('group', { name: 'كمية شاي' })).getByText('3')).toBeTruthy();
        expect(within(cart).getAllByText('34.50').length).toBeGreaterThan(0);

        fireEvent.change(search, { target: { value: COFFEE.barcode } });
        fireEvent.keyDown(search, { key: 'Enter' });

        expect(within(cart).getByText('قهوة')).toBeTruthy();
        expect(search.value).toBe('');
    });

    it('درج قائمة مخفي في القشرة لا يعطّل اختصارات الكاشير', async () => {
        // القشرة تحتفظ بدرج تنقّل `role="dialog"` مخفي دائمًا؛ الاختصارات تعمل ما دام لا نافذة ظاهرة.
        const drawer = document.createElement('div');
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-label', 'قائمة التنقّل');
        drawer.style.display = 'none';
        document.body.appendChild(drawer);
        try {
            const mock = stubFetch({ activeShift: SHIFT });
            renderScreen();

            fireEvent.click(await screen.findByRole('button', { name: 'إضافة شاي إلى السلة' }));
            fireEvent.keyDown(window, { key: 'F5' });

            await waitFor(() => {
                expect(saleCalls(mock)).toHaveLength(1);
            });
        } finally {
            drawer.remove();
        }
    });
});
