import { describe, expect, it } from 'vitest';
import type { PosReceiptData } from '../../lib/pos';
import { receiptPrintHtml } from './PosReceipt';

const base = {
    order_id: 'order-1',
    invoice_counter: 1099,
    invoice_uuid: '8f2c1d7e-4a5b-4c3d-9e21-77aa10bb22cc',
    invoice_hash: 'hash',
    qr_payload: null,
    digital_signature: 'sig',
    total_amount: 55.25,
    tax_total: 7.25,
    subtotal: 48,
    discount_total: 0,
    paid: 60,
    change: 4.75,
    non_cash_overpayment: null,
    print_job_id: null,
    zatca_queued: true,
    kot_enabled: true,
    kot_jobs: [],
    session_id: '44',
    erp_revenue_id: null,
    erp_dept_code: 'K01',
    party_name: null,
    buffet: null,
    cartLines: [
        { name: 'شاي', quantity: 2, unit_price: 5, line_total: 10, vat_rate: 0.15 },
        { name: 'قهوة عربية', quantity: 2, unit_price: 19, line_total: 38, vat_rate: 0.15 },
    ],
    paymentLines: [
        { method: 'cash', amount: 20, reference: null },
        { method: 'card', amount: 40, reference: 'AUTH-9911', brand: 'mada', last4: '8899' },
    ],
    cashierName: 'أحمد السيد',
} as unknown as PosReceiptData;

const brand = { name: 'مطاعم الشرفه العالمي', logoSrc: '/app/assets/karim-logo.png' };

describe('receiptPrintHtml — إيصال ما بعد البيع', () => {
    const html = receiptPrintHtml(base, null, brand);

    it('يعرض الأصناف وكمياتها بدل الاكتفاء بالإجماليات', () => {
        expect(html).toContain('شاي');
        expect(html).toContain('قهوة عربية');
        expect(html).toContain('<th>الصنف / Item</th>');
    });

    it('يعرض شكل الدفع ببيانات البطاقة المقروءة', () => {
        expect(html).toContain('مدى');
        expect(html).toContain('····8899');
        expect(html).toContain('AUTH-9911');
    });

    it('يعرض الباقي والإجمالي والوردية والكاشير', () => {
        expect(html).toContain('الباقي للعميل');
        expect(html).toContain('55.25');
        expect(html).toContain('44');
        expect(html).toContain('أحمد السيد');
    });

    it('يحترم الهروب من HTML في كل الحقول القادمة من المستخدم', () => {
        const dirty = {
            ...base,
            party_name: '<script>alert(1)</script>',
            cartLines: [{ name: '<b>x</b>', quantity: 1, unit_price: 10, line_total: 10, vat_rate: 0.15 }],
        } as PosReceiptData;
        const dirtyHtml = receiptPrintHtml(dirty, null, brand);
        expect(dirtyHtml).not.toContain('<script>');
        expect(dirtyHtml).not.toContain('<b>x</b>');
        expect(dirtyHtml).toContain('&lt;script&gt;');
    });
});
