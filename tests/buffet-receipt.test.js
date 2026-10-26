/**
 * buffet-receipt.test.js — Custom open-buffet thermal receipt
 * ─────────────────────────────────────────────────────────────
 * The buffet sells PEOPLE, not menu items: buffet-mode receipts must print
 * guest tiers with PERSON counts (فرد) and a prominent total persons line,
 * while normal sales keep the classic Item/Total table untouched.
 */

const { buildEscPosReceipt } = require('../backend/cashier-module/escpos-printer');

const baseOrder = {
    id: '11111111-1111-1111-1111-111111111111',
    invoice_counter: 77,
    invoice_uuid: 'abc-def',
    subtotal: 300,
    discount_total: 0,
    tax_total: 45,
    total_amount: 345,
    created_at: '2026-08-30T10:00:00Z',
    session_id: 42,
    notes: 'عائلة آل سعيد — غداء',
};

const buffetItems = [
    { product_name: 'بوفيه كبار', quantity: 2, unit_price: 120, line_total: 240, discount: 0 },
    { product_name: 'بوفيه أطفال', quantity: 1, unit_price: 60, line_total: 60, discount: 0 },
    { product_name: 'ضيافة', quantity: 1, unit_price: 0, line_total: 0, discount: 0 },
];

const normalItems = [
    { product_name: 'برياني لحم', quantity: 1, unit_price: 45, line_total: 45, discount: 0 },
];

const baseCtx = {
    order: baseOrder,
    payments: [{ method: 'cash', amount: 400 }],
    qrPayload: 'ABCD1234',
    department: { name_ar: 'البوفيه المفتوح', vat_number: '300000000000003' },
    cashier: { name: 'أحمد' },
    paid: 400,
    change: 55,
};

function decode(buf) { return Buffer.from(buf).toString('utf8'); }

describe('buffet thermal receipt (persons instead of items)', () => {
    test('buffet receipt prints guest tiers with person counts', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: buffetItems, buffet: true });
        const text = decode(bytes);
        expect(text).toContain('بوفيه مفتوح');
        expect(text).toContain('بوفيه كبار');
        expect(text).toContain('2 فرد × 120.00');
        expect(text).toContain('1 فرد × 60.00');
        expect(text).toContain('عدد الأشخاص: 4');
    });

    test('buffet receipt shows occasion/family name and hospitality as free', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: buffetItems, buffet: true });
        const text = decode(bytes);
        expect(text).toContain('العائلة/المناسبة:');
        expect(text).toContain('عائلة آل سعيد');
        // Zero-priced tier (hospitality) must not print a fake 0.00 unit charge
        expect(text).toContain('مجاناً (ضيافة)');
    });

    test('buffet receipt has NO menu-item table header', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: buffetItems, buffet: true });
        const text = decode(bytes);
        expect(text).not.toContain('Item');
    });

    test('buffet receipt keeps VAT + ZATCA QR + payments (legal sections)', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: buffetItems, buffet: true });
        const text = decode(bytes);
        expect(text).toContain('Subtotal:');
        expect(text).toContain('VAT (15%):');
        expect(text).toContain('Total Paid:');
        expect(text).toContain('ZATCA Phase-2 QR');
        expect(text).toContain('شكراً لزيارتكم');
    });

    test('normal sale keeps the classic Item/Total table (no persons)', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: normalItems, buffet: false });
        const text = decode(bytes);
        expect(text).toContain('Item');
        expect(text).toContain('برياني لحم');
        expect(text).not.toContain('فرد');
        expect(text).not.toContain('بوفيه مفتوح');
    });

    test('default (no flag) is a normal receipt — buffet mode is opt-in', async () => {
        const bytes = await buildEscPosReceipt({ ...baseCtx, items: normalItems });
        const text = decode(bytes);
        expect(text).toContain('Item');
        expect(text).not.toContain('فرد');
    });
});
