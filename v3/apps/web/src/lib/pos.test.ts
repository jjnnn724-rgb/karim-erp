import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    activeShiftOf,
    activeShiftSchema,
    buffetConfigSchema,
    buffetInvoiceRowSchema,
    buffetLiveSchema,
    buffetReportSchema,
    closeShiftResultSchema,
    completePosSale,
    expectedCash,
    fetchActiveShift,
    fetchPosOrders,
    heldOrderSchema,
    isBuffetDepartment,
    orderDetailSchema,
    orderPageSchema,
    posDayKey,
    posDepartmentSchema,
    posProductSchema,
    saleResultSchema,
    shiftSummarySchema,
    uploadPosProductImage,
} from './pos';

/**
 * الأشكال أدناه منسوخة حرفيًا من ردود الخادم الحقيقية
 * (`backend/cashier-module/shift-routes.js`، `pos-orders-history.js`،
 * `complete-sale.js`، `buffet-routes.js`): العمود `numeric` يصل نصًّا،
 * والـ`bigint` يصل نصًّا، والعدّ `COUNT(*)` يصل نصًّا أيضًا.
 */

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('عقود الكاشير', () => {
    it('قسم كاشير حي — بلا تحويلات صامتة', () => {
        const parsed = posDepartmentSchema.safeParse({
            id: 12,
            code: 'erp_open_buffet',
            name_ar: 'البوفيه المفتوح',
            name_en: 'Open Buffet',
            is_active: true,
            vat_number: null,
        });
        expect(parsed.success).toBe(true);
    });

    it('صنف حي بأعمدة نصية و`department_ids` مصفوفة', () => {
        const parsed = posProductSchema.safeParse({
            id: '128',
            name_ar: 'شاي',
            name_en: null,
            barcode: '6281000000011',
            price: '7.00',
            cost_price: '1.10',
            stock_quantity: '40',
            vat_rate: '15.00',
            category: 'مشروبات',
            unit: 'كوب',
            department_id: '12',
            is_active: true,
            min_stock_level: '5',
            image_url: null,
            ingredient_count: 0,
            metadata: {},
            department_ids: ['12'],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.price).toBe(7);
            expect(parsed.data.stock_quantity).toBe(40);
        }
    });

    it('الوردية المفتوحة تُطبَّع مع سقوط `session_id` إلى `id`', () => {
        const openedAt = new Date().toISOString();
        const row = activeShiftSchema.parse({
            id: '987654321',
            department_id: '12',
            cashier_id: '17908800123',
            status: 'open',
            opening_balance: '500.00',
            opened_at: openedAt,
            dept_name: 'البوفيه المفتوح',
            dept_code: 'erp_open_buffet',
            expected_cash: null,
        });
        const shift = activeShiftOf(row);
        expect(shift).toEqual({
            sessionId: '987654321',
            departmentId: '12',
            deptName: 'البوفيه المفتوح',
            deptCode: 'erp_open_buffet',
            openingBalance: 500,
            openedAt,
            openedOn: posDayKey(openedAt),
            isStale: false,
        });
    });

    it('وردية فُتحت في يوم سابق تُوسم `isStale` (الخادم يرفض البيع عليها 409)', () => {
        const openedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
        const row = activeShiftSchema.parse({
            id: '5',
            department_id: 2,
            status: 'open',
            opening_balance: '0',
            opened_at: openedAt,
            dept_name: 'الكاشير',
            dept_code: 'pos',
        });
        const shift = activeShiftOf(row);
        expect(shift.openedOn).toBe(posDayKey(openedAt));
        expect(shift.isStale).toBe(true);
    });

    it('`posDayKey` يحسب اليوم بتوقيت الرياض لا بتوقيت الجهاز', () => {
        // 2026-11-10T22:30Z = 2026-11-11 01:30 في الرياض
        expect(posDayKey('2026-11-10T22:30:00.000Z')).toBe('2026-11-11');
        expect(posDayKey(null)).toBe('');
        expect(posDayKey('not-a-date')).toBe('');
    });

    it('`session_id` الصريح يتقدّم على `id` (جلسة كاشير قديمة)', () => {
        const row = activeShiftSchema.parse({
            id: '5',
            session_id: '77',
            department_id: 3,
            status: 'open',
            opening_balance: 0,
        });
        expect(activeShiftOf(row).sessionId).toBe('77');
    });

    it('ملخص الوردية يُحسب النقد المتوقع بنفس صيغة خادم الإغلاق', () => {
        const summary = shiftSummarySchema.parse({
            id: 77,
            department_id: 12,
            opening_balance: '500.00',
            dept_name: 'البوفيه المفتوح',
            cash_in: '1200.50',
            cash_out: '200.25',
            card_in: '300',
            wallet_in: '0',
            invoice_count: 14,
            sales_total: '1750.75',
            discount_total: '50.00',
            tax_total: '228.25',
            voided_count: 1,
            voided_amount: '28.00',
            expected_cash: null,
        });
        expect(expectedCash(summary)).toBe(1500.25);
        expect(summary.invoice_count).toBe(14);
    });

    it('إغلاق الوردية يُعيد الفرق نصًّا محوَّلًا', () => {
        const parsed = closeShiftResultSchema.safeParse({
            session_id: 77,
            status: 'closed',
            opening_balance: 500,
            expected_cash: 1500.25,
            actual_cash: 1495,
            cash_variance: -5.25,
            closed_at: '2026-11-10T18:00:00.000Z',
        });
        expect(parsed.success).toBe(true);
    });

    it('الطلب المعلق: الخصم قد يكون null والبنود اختيارية في القائمة', () => {
        const parsed = heldOrderSchema.safeParse({
            id: '42',
            created_at: '2026-11-10T07:00:00.000Z',
            total_amount: '57.50',
            items_preview: 'شاي(2)، كيك(1)',
            cart_discount: null,
        });
        expect(parsed.success).toBe(true);

        const recall = heldOrderSchema.safeParse({
            id: 42,
            created_at: '2026-11-10T07:00:00.000Z',
            total_amount: 57.5,
            items_preview: '',
            cart_discount: { type: 'percent', value: 10 },
            items: [
                {
                    product_id: 128,
                    name: 'شاي',
                    barcode: null,
                    quantity: 2,
                    unit_price: 7,
                    discount: 0,
                    vat_rate: 15,
                },
            ],
        });
        expect(recall.success).toBe(true);
    });

    it('صفحة سجل الفواتير: `item_count` نص و`payments` jsonb', () => {
        const parsed = orderPageSchema.safeParse({
            data: [
                {
                    id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
                    invoice_counter: 1043,
                    invoice_uuid: 'f0a6c1e9-2b4a-4a0e-9f4b-1a2b3c4d5e6f',
                    status: 'issued',
                    subtotal: '50.00',
                    discount_total: '0.00',
                    tax_total: '7.50',
                    total_amount: '57.50',
                    currency_code: 'SAR',
                    notes: null,
                    void_reason: null,
                    created_at: '2026-11-10T07:00:00.000Z',
                    updated_at: '2026-11-10T07:00:00.000Z',
                    department_name: 'البوفيه المفتوح',
                    department_name_en: 'Open Buffet',
                    cashier_name: 'كاشير 1',
                    cashier_id: '17908800123',
                    session_id: '77',
                    item_count: '2',
                    payments: [{ method: 'cash', amount: '57.50' }],
                },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.data[0]?.item_count).toBe(2);
        }
    });

    it('تفصيل الفاتورة: لا `item_count` في `po.*`، والبنود والطباعة حاضرة', () => {
        const parsed = orderDetailSchema.safeParse({
            id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
            invoice_counter: 1043,
            invoice_uuid: 'f0a6c1e9-2b4a-4a0e-9f4b-1a2b3c4d5e6f',
            invoice_hash: 'abc123',
            qr_payload: 'BASE64QR',
            status: 'issued',
            subtotal: '50.00',
            discount_total: '0.00',
            tax_total: '7.50',
            total_amount: '57.50',
            currency_code: 'SAR',
            notes: null,
            void_reason: null,
            created_at: '2026-11-10T07:00:00.000Z',
            updated_at: '2026-11-10T07:00:00.000Z',
            department_name: 'البوفيه المفتوح',
            department_name_en: 'Open Buffet',
            cashier_name: 'كاشير 1',
            cashier_id: '17908800123',
            session_id: '77',
            vat_number: '300000000000003',
            items: [
                {
                    id: '9',
                    order_id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
                    product_id: '128',
                    product_name: 'شاي',
                    product_barcode: '6281000000011',
                    quantity: '2.000',
                    unit_price: '25.00',
                    discount: '0.00',
                    vat_rate: '15.00',
                    line_total: '50.00',
                    vat_amount: '7.50',
                    created_at: '2026-11-10T07:00:00.000Z',
                },
            ],
            payments: [{ method: 'cash', amount: '57.50' }],
            print_jobs: [{ id: '3', status: 'done', attempts: 1, last_attempt_at: null, completed_at: null, last_error: null }],
        });
        expect(parsed.success).toBe(true);
    });

    it('رد إتمام البيع كما يبنيه `complete-sale.js`', () => {
        const parsed = saleResultSchema.safeParse({
            order_id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
            invoice_counter: 1043,
            invoice_uuid: 'f0a6c1e9-2b4a-4a0e-9f4b-1a2b3c4d5e6f',
            invoice_hash: 'abc123',
            qr_payload: 'BASE64QR',
            digital_signature: 'SIG',
            total_amount: 57.5,
            tax_total: 7.5,
            subtotal: 50,
            discount_total: 0,
            paid: 60,
            change: 2.5,
            non_cash_overpayment: 0,
            print_job_id: '3',
            zatca_queued: true,
            kot_enabled: true,
            kot_jobs: [],
            session_id: 77,
            buffet: null,
            party_name: null,
            erp_revenue_id: '9001',
            erp_dept_code: 'open_buffet',
            zatca_vat_number_placeholder: false,
            _request_id: 'req-1',
        });
        expect(parsed.success).toBe(true);
    });

    it('رد البوفيه يحمل عدّ الأفراد لا إجمالًا مبهمًا', () => {
        const parsed = saleResultSchema.safeParse({
            order_id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
            total_amount: 240,
            tax_total: 31.3,
            subtotal: 208.7,
            discount_total: 0,
            paid: 240,
            change: 0,
            buffet: {
                persons_total: 3,
                tiers: [{ name: 'بالغ', persons: 2, unit_price: 90, amount: 180 }],
            },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.buffet?.persons_total).toBe(3);
        }
    });

    it('إعدادات البوفيه: كل كتابة تُعيد `tiers` كاملة', () => {
        const tiers = [
            { id: 1, tier: 'adult', name_ar: 'بالغ', price: 90, vat_rate: 15, unit: 'فرد', is_core: true, is_active: true },
            { id: 7, tier: 'custom_7', name_ar: 'أطفال 3-6', price: 40, vat_rate: 15, unit: 'فرد', is_core: false, is_active: false },
        ];
        expect(buffetConfigSchema.safeParse({ department: {}, pos_department: null, tiers }).success).toBe(true);
        expect(buffetConfigSchema.safeParse({ saved: 2, tiers, message: 'تم' }).success).toBe(true);
        expect(buffetConfigSchema.safeParse({ disabled: 7, tiers, message: 'تم' }).success).toBe(true);
    });

    it('العداد الحي: إيراد الوردية غائب في الخادم فلا يُشترط', () => {
        const parsed = buffetLiveSchema.safeParse({
            date: '2026-11-10',
            daily: {
                covers_by_tier: { adult: { name: 'بالغ', covers: 40 } },
                covers_total: 40,
                invoices_count: 12,
                revenue: 3600,
                avg_invoice: 300,
                revenue_per_cover: 90,
                voided: { count: 1, amount: 120 },
            },
            shift: { session_id: 77, covers_by_tier: {}, covers_total: 18, held_orders: 2 },
        });
        expect(parsed.success).toBe(true);
    });

    it('فاتورة البوفيه المخزَّنة أخف من صف السجل وتحمل `covers`', () => {
        const parsed = buffetInvoiceRowSchema.safeParse({
            id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
            invoice_counter: 1043,
            status: 'issued',
            total_amount: 240,
            tax_total: 31.3,
            discount_total: 0,
            party_name: 'عائلة أحمد',
            created_at: '2026-11-10T07:00:00.000Z',
            voided_at: null,
            cashier_name: 'كاشير 1',
            session_id: '77',
            covers: {
                tiers: { adult: { name: 'بالغ', covers: 2, amount: 180 }, child: { name: 'صغير', covers: 1, amount: 60 } },
                covers_total: 3,
            },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.covers?.covers_total).toBe(3);
        }
    });

    it('تقرير البوفيه اليومي بشكله الحرفي', () => {
        const parsed = buffetReportSchema.safeParse({
            date: '2026-11-10',
            generated_at: '2026-11-10T18:00:00.000Z',
            totals: {
                covers_total: 120,
                revenue: '10800.00',
                net_revenue: 10800,
                vat_total: 1408.7,
                discounts_total: 0,
                invoices: 38,
                avg_invoice: 284.21,
                revenue_per_cover: 90,
                voided: { count: 1, amount: 120 },
                still_held: { count: 0, amount: 0 },
            },
            tiers: [{ tier: 'adult', name: 'بالغ', covers: 100, revenue: 9000, invoices: 31, avg_price: 90 }],
            hourly: [{ hour: 13, invoices: 10, revenue: 2840, covers: 31 }],
            payments: [{ method: 'cash', total: 8000, count: 30 }],
            cashiers: [{ cashier: 'كاشير 1', invoices: 38, revenue: 10800 }],
        });
        expect(parsed.success).toBe(true);
    });

    it('يُعرَف قسم البوفيه بالكود أو بالاسم', () => {
        expect(isBuffetDepartment({ code: 'erp_open_buffet' })).toBe(true);
        expect(isBuffetDepartment({ code: 'open_buffet' })).toBe(true);
        expect(isBuffetDepartment({ code: 'erp_kitchen', name_ar: 'البوفيه المفتوح' })).toBe(true);
        expect(isBuffetDepartment({ name_en: 'Buffet Hall' })).toBe(true);
        expect(isBuffetDepartment({ code: 'erp_kitchen', name_ar: 'المطبخ' })).toBe(false);
        expect(isBuffetDepartment({})).toBe(false);
    });
});

describe('أبواب الكاشير — السلوك على الشبكة', () => {
    it('غياب الوردية (404) حالة طبيعية لا خطأ', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ error: 'NO_OPEN_SHIFT', message: 'لا توجد وردية' }, 404)),
        );
        await expect(fetchActiveShift()).resolves.toBeNull();
    });

    it('عطل الخادم (500) يرمي ولا يُخفى كغياب وردية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ error: 'INTERNAL_ERROR', message: 'عطل' }, 500)),
        );
        await expect(fetchActiveShift()).rejects.toMatchObject({ status: 500 });
    });

    it('إتمام البيع يرسل مفتاح المنع ووردية الوردية والجهاز', async () => {
        const sale = {
            order_id: '5f0a6c1e-9e2b-4a0e-8f4b-1a2b3c4d5e6f',
            invoice_counter: 1,
            total_amount: 23,
            tax_total: 3,
            subtotal: 20,
            discount_total: 0,
            paid: 23,
            change: 0,
        };
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(sale, 201));
        vi.stubGlobal('fetch', fetchMock);

        const result = await completePosSale({
            departmentId: '12',
            sessionId: '77',
            items: [{ product_id: 128, quantity: 2, unit_price: 10, discount: 0 }],
            payments: [{ method: 'cash', amount: 23, reference: null }],
            idempotencyKey: 'v2-pos-77-abc',
        });

        expect(result.order_id).toBe(sale.order_id);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/sales/complete');
        expect(init?.headers).toMatchObject({
            'Idempotency-Key': 'v2-pos-77-abc',
            'X-Shift-Session-Id': '77',
            'x-device-name': expect.stringContaining('dept-12') as unknown as string,
        });
        expect(JSON.parse(String(init?.body))).toEqual({
            department_id: 12,
            items: [{ product_id: 128, quantity: 2, unit_price: 10, discount: 0 }],
            payments: [{ method: 'cash', amount: 23, reference: null }],
            printer_id: 'pos-12',
        });
    });

    it('رفع صورة الصنف POST واحد متعدد الأجزاء ثم قراءة رده نفسه', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ id: '7', image_url: '/uploads/menu/p7.png' }));
        vi.stubGlobal('fetch', fetchMock);

        const file = new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' });
        const result = await uploadPosProductImage('7', file);

        expect(result).toEqual({ id: '7', image_url: '/uploads/menu/p7.png' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/pos/products/7/image');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeInstanceOf(FormData);
    });

    it('سجل الفواتير يبني الاستعلام الافتراضي كما في V2', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            jsonResponse({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await fetchPosOrders({});

        const [url] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/pos/orders?page=1&limit=20&sort=created_at&order=DESC');
    });
});
