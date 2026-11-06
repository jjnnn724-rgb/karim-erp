/**
 * pos-receipt-html.test.js — قالب الفاتورة الواحد (شاشة + طباعة)
 * ══════════════════════════════════════════════════════════════════════
 * قبل هذا القالب كانت الشاشة تعرض صفوفًا نصية والطابعة قالبًا آخر — أي
 * تعديل يصلح واحدة ويترك الأخرى. هنا يُثبَّت:
 *   1) فاتورة عادية: أصناف، خصم، ضريبة بمعدلها، إجمالي، دفعات وباقي.
 *   2) بوفيه: أشخاص لا أصناف، وإجمالي عدد الأشخاص.
 *   3) ZATCA QR داخل إطار، والهوية العربية للمطعم، وبصمة الإلغاء.
 *   4) القالب لا يحمل <script> ولا موارد خارجية غير خادمنا — يُعرض داخل
 *      iframe بلا أذونات إضافية.
 *   5) كل نص آتٍ من البيانات يُهرَّب (لا HTML injection في فاتورة).
 *   6) النسخة الحرارية (ESC/POS) تحمل نفس الهوية العربية.
 */
'use strict';

const { buildReceiptHtml, escHtml } = require('../backend/cashier-module/receipt-html');
const { buildEscPosReceipt } = require('../backend/cashier-module/escpos-printer');

const order = {
    invoice_counter: 1024,
    invoice_uuid: '8f2c1d7e-4a5b-4c3d-9e21-77aa10bb22cc',
    created_at: '2026-10-30T18:42:00+03:00',
    subtotal: 210.5,
    discount_total: 10.5,
    tax_total: 30,
    total_amount: 230,
    currency_code: 'SAR',
    session_id: 42,
    cashier_name: 'أحمد السيد',
    department_name: 'مطاعم الشرفه العالمي',
    department_name_en: 'AL SHARFA AL ALAMI RESTAURANTS',
    vat_number: '300000000000003',
    location: 'الرياض — طريق الملك عبدالله',
    status: 'issued',
};

const items = [
    { product_name: 'برياني لحم', quantity: 2, unit_price: 65, line_total: 130, discount: 0, vat_rate: 15 },
    { product_name: 'شيش طاووق', quantity: 1, unit_price: 48.5, line_total: 38, discount: 10.5, vat_rate: 15 },
];

const payments = [
    { method: 'cash', amount: 100, direction: 'in' },
    { method: 'card', amount: 150, direction: 'in', reference: '884213' },
    { method: 'cash', amount: 20, direction: 'out', payer_info: { reason: 'change' } },
];

const qr = 'data:image/png;base64,AAAA';

describe('قالب الفاتورة — فاتورة عادية', () => {
    const html = buildReceiptHtml({ order, items, payments, qrImageDataUrl: qr });

    test('هوية عربية + وصف ضريبي مبسط + الرقم الضريبي', () => {
        expect(html).toContain('مطاعم الشرفه العالمي');
        expect(html).toContain('فاتورة ضريبية مبسطة');
        expect(html).toContain('300000000000003');
        expect(html).toContain('dir="rtl"');
    });

    test('رأس الفاتورة: رقم، تاريخ، كاشير، وردية', () => {
        expect(html).toContain('#1024');
        expect(html).toContain('أحمد السيد');
        expect(html).toContain('الوردية');
        expect(html).toContain('8f2c1d7e-4a5b-4c3d-9e21-77aa10bb22cc');
    });

    test('الأصناف بكمياتها وأسعارها وإجمالي السطر', () => {
        expect(html).toContain('برياني لحم');
        expect(html).toContain('شيش طاووق');
        expect(html).toContain('130.00');
        expect(html).toContain('38.00');
        expect(html).toContain('خصم السطر');
    });

    test('الإجماليات: قبل الضريبة، الخصم، الضريبة بمعدلها، الإجمالي المستحق', () => {
        expect(html).toContain('210.50');
        expect(html).toContain('10.50');
        expect(html).toContain('ضريبة القيمة المضافة (15%)');
        expect(html).toContain('الإجمالي المستحق');
        expect(html).toContain('230.00');
    });

    test('الدفعات بأسمائها العربية والباقي باللون الأخضر', () => {
        expect(html).toContain('نقدي');
        expect(html).toContain('شبكة / بطاقة');
        expect(html).toContain('884213');
        expect(html).toContain('الباقي للعميل');
        expect(html).toContain('20.00');
        expect(html).toMatch(/pay-row change/);
    });

    test('رمز ZATCA داخل إطار مع عنوانه', () => {
        expect(html).toContain(qr);
        expect(html).toContain('ZATCA');
        expect(html).toMatch(/qr-frame/);
    });

    test('تذييل الشكر والإقرار الإلكتروني', () => {
        expect(html).toContain('شكراً لزيارتكم');
        expect(html).toContain('لا تحتاج ختمًا أو توقيعًا');
    });

    test('مقاس الطباعة 80mm وبلا موارد خارجية أو سكربتات', () => {
        // «auto» لا تقرؤه كروم: يتجاهلها ويطبع على مقاس Letter فتصغر الفاتورة.
        expect(html).toMatch(/@page\s*\{\s*size:\s*80mm 200mm/);
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/src="https?:/i);
    });
});

describe('قالب الفاتورة — بوفيه', () => {
    const html = buildReceiptHtml({
        order: { ...order, notes: 'عائلة آل سعيد — غداء', subtotal: 300, tax_total: 45, total_amount: 345, discount_total: 0 },
        items: [
            { product_name: 'بوفيه كبار', quantity: 2, unit_price: 120, line_total: 240, discount: 0 },
            { product_name: 'بوفيه أطفال', quantity: 1, unit_price: 60, line_total: 60, discount: 0 },
        ],
        payments: [{ method: 'cash', amount: 400, direction: 'in' }],
        qrImageDataUrl: qr,
        isBuffet: true,
    });

    test('أشخاص بلا أسعار أصناف، وإجمالي عدد الأشخاص', () => {
        expect(html).toContain('البوفيه المفتوح — الفوترة بعدد الأشخاص');
        expect(html).toContain('بوفيه كبار');
        expect(html).toContain('إجمالي عدد الأشخاص');
        expect(html).toContain('3 فرد');
    });

    test('المناسبة تُطبع، ولا ملاحظات في الفاتورة العادية', () => {
        expect(html).toContain('عائلة آل سعيد — غداء');
        const normal = buildReceiptHtml({ order: { ...order, notes: 'x' }, items, payments });
        expect(normal).not.toContain('العائلة / المناسبة');
    });
});

describe('قالب الفاتورة — إلغاء وتهريب النصوص', () => {
    test('فاتورة ملغاة تحمل شريط «ملغاة» وسببه', () => {
        const html = buildReceiptHtml({
            order: { ...order, status: 'voided', void_reason: 'خطأ في الطلب' },
            items, payments,
        });
        expect(html).toContain('void-banner');
        expect(html).toContain('خطأ في الطلب');
    });

    test('اسم صنف خبيث يُهرَّب ولا يُنفَّذ', () => {
        const html = buildReceiptHtml({
            order,
            items: [{ product_name: '<img src=x onerror=alert(1)>', quantity: 1, unit_price: 1, line_total: 1, discount: 0 }],
            payments,
        });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
        expect(escHtml('<b>a</b>')).toBe('&lt;b&gt;a&lt;/b&gt;');
    });
});

describe('النسخة الحرارية — نفس الهوية العربية', () => {
    const ctx = {
        order,
        items,
        payments: [{ method: 'cash', amount: 250 }],
        qrPayload: 'ABCD1234',
        department: { name_ar: 'مطاعم الشرفه العالمي', vat_number: '300000000000003' },
        cashier: { name: 'أحمد السيد' },
        paid: 250,
        change: 20,
    };

    test('العنوان العربي والمبلغ النهائي والباقي', async () => {
        const buf = await buildEscPosReceipt(ctx);
        const text = buf.toString('utf8');
        expect(text).toContain('فاتورة ضريبية مبسطة');
        expect(text).toContain('الإجمالي المستحق Total');
        expect(text).toContain('الباقي Change:');
        expect(text).toContain('شكراً لزيارتكم');
    });

    test('الدفع نقدًا يحمل نبضة الدرج (ESC p 0)', async () => {
        const buf = await buildEscPosReceipt(ctx);
        expect(Buffer.from(buf).includes(Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]))).toBe(true);
    });
});
