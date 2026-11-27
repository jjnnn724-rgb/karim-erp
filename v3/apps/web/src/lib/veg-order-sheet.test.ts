import { describe, expect, it } from 'vitest';
import { VEG_REQUEST_CATALOG } from './veg-catalog';
import { vegOrderSheetHtml } from './veg-order-sheet';

describe('نموذج طلبية الخضروات والأعشاب', () => {
    it('يعرض كل أصناف الكتالوج وخانة كمية فارغة أمام كل صنف', () => {
        const html = vegOrderSheetHtml({ generatedAt: new Date('2026-11-27T10:00:00Z') });
        for (const item of VEG_REQUEST_CATALOG) {
            expect(html).toContain(item.name);
            expect(html).toContain(`>${item.unit}<`);
        }
        expect((html.match(/<td class="qty"><i><\/i><\/td>/g) ?? []).length).toBe(35);
        expect(html).toContain('30 رئيسية + 5 إضافية');
        expect(html).toContain('يرجى تسجيل الكمية المتاحة أمام كل صنف');
    });

    it('ورقة A4 عربية باتجاه RTL وتوقيعات الطرفين، مع تاريخ واسم المُعِدّ', () => {
        const html = vegOrderSheetHtml({
            date: '27 / 11 / 2026',
            preparedBy: '<b>شيف</b>',
            generatedAt: new Date('2026-11-27T10:00:00Z'),
        });
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('@page{size:A4 portrait;margin:11mm}');
        expect(html).toContain('@media print');
        expect(html).toContain('التوقيع / المُعِدّ');
        expect(html).toContain('التوقيع / المستلم');
        expect(html).toContain('27 / 11 / 2026');
        expect(html).not.toContain('<b>شيف</b>');
        expect(html).toContain('&lt;b&gt;شيف&lt;/b&gt;');
    });
});
