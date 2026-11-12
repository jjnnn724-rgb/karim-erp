import { describe, expect, it } from 'vitest';
import { vegPrintItems, vegRequestPrintHtml } from './veg-print';
import { type VegRequest, vegRequestSchema } from './veg-requests';

/**
 * ورقة الطباعة — نفس حقول V2 `buildVegPrintHtml` (veg-requests.js:58-158):
 * الأصناف المرفوضة والتالف، أعمدة السعر عند التسعير، ختم الحالة،
 * ورقم النسخة `print_count + 1`، والهروب من HTML.
 */

function request(raw: Record<string, unknown>): VegRequest {
    return vegRequestSchema.parse(raw);
}

const base = {
    id: 17905,
    request_no: 'VR-20261025-17905',
    created_by_name: 'فاروق عبد احمد',
    created_by_role: 'sous_chef',
    priority: 'normal',
    status: 'pending',
    items_count: 2,
    total: null,
    created_at: '2026-10-25T09:52:55.890Z',
    print_count: 2,
    items: [
        { name: 'طماطم', qty: 12, unit: 'كجم', note: '' },
        { name: 'خيار', qty: 4.5, unit: 'كجم', note: 'مفضل' },
    ],
};

describe('vegPrintItems', () => {
    it('يقرأ المصفوفة أو JSON النصّي ويتجاهل السطور غير الصالحة', () => {
        expect(vegPrintItems(request(base))).toHaveLength(2);
        const text = request({ ...base, items: JSON.stringify(base.items) });
        expect(vegPrintItems(text).map((item) => item.name)).toEqual(['طماطم', 'خيار']);
        const junk = request({ ...base, items: [{ qty: 2 }, { name: 'بصل', qty: '3' }, null] });
        expect(vegPrintItems(junk)).toEqual([
            {
                name: 'بصل',
                qty: 3,
                unit: '',
                note: '',
                rejected: false,
                spoiledQty: null,
                price: null,
                lineTotal: null,
            },
        ]);
    });
});

describe('vegRequestPrintHtml', () => {
    it('يطبع الأصناف والطلب المعلّق بلا أعمدة سعر', () => {
        const html = vegRequestPrintHtml(request(base), {
            byName: 'مدير النظام',
            generatedAt: new Date('2026-11-11T10:00:00Z'),
        });
        expect(html).toContain('VR-20261025-17905');
        expect(html).toContain('طماطم');
        expect(html).toContain('خيار');
        expect(html).toContain('توقيع الشيف — فاروق عبد احمد');
        expect(html).toContain('نسخة رقم 3');
        expect(html).toContain('data-veg-print');
        expect(html).toContain('background:#102a43');
        expect(html).toContain('border-bottom:3px solid #0f766e');
        expect(html).not.toContain('سعر الوحدة');
        expect(html).not.toContain('معتمد');
    });

    it('يضيف أعمدة السعر وختم الاعتماد والتالف عند التسعير', () => {
        const html = vegRequestPrintHtml(
            request({
                ...base,
                status: 'priced',
                total: '1250.50',
                received_by_name: 'أمين المخزن',
                priced_by_name: 'أمين المخزن',
                items: [
                    { name: 'طماطم', qty: 10, unit: 'كجم', price: 12.5, lineTotal: 125 },
                    { name: 'خيار', qty: 4, unit: 'كجم', rejected: true, price: null, lineTotal: null },
                    { name: 'بصل', qty: 5, unit: 'كجم', spoiledQty: 1.5, price: 4, lineTotal: 20 },
                ],
            }),
            { byName: 'مدير النظام', currency: 'SAR' },
        );
        expect(html).toContain('سعر الوحدة');
        expect(html).toContain('12.50');
        expect(html).toContain('125.00');
        expect(html).toContain('SAR');
        expect(html).toContain('✔ معتمد');
        expect(html).toContain('✗ مرفوض');
        expect(html).toContain('تالف: 1.5');
    });

    it('يهرب نصّ الطلب والملاحظات ويختم الإلغاء', () => {
        const html = vegRequestPrintHtml(
            request({
                ...base,
                status: 'cancelled',
                notes: '<script>alert(1)</script>',
                items: [{ name: '<b>طماطم</b>', qty: 1, unit: 'كجم' }],
            }),
            { byName: 'مدير <x>', generatedAt: new Date('2026-11-11T10:00:00Z') },
        );
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<b>طماطم</b>');
        expect(html).toContain('✖ ملغي');
    });
});
