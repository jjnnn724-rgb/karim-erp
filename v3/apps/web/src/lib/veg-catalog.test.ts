import { describe, expect, it } from 'vitest';
import { VEG_CATALOG_CATEGORIES, VEG_REQUEST_CATALOG, VEG_UNITS, vegItemsFromQuantities } from './veg-catalog';

describe('كتالوج طلب الخضار الأساسي', () => {
    it('يعرض الأصناف المرسلة مرة واحدة فقط بوحداتها الافتراضية', () => {
        expect(VEG_REQUEST_CATALOG).toHaveLength(27);
        expect(new Set(VEG_REQUEST_CATALOG.map((item) => item.name)).size).toBe(VEG_REQUEST_CATALOG.length);
        expect(VEG_REQUEST_CATALOG.find((item) => item.name === 'كرنب أبيض')?.unit).toBe('كيس');
        expect(VEG_REQUEST_CATALOG.find((item) => item.name === 'زنجبيل')?.unit).toBe('كرتونة');
        expect(VEG_UNITS).toEqual(['كجم', 'كيس', 'كرتونة']);
        expect(VEG_CATALOG_CATEGORIES[0]).toBe('الكل');
    });

    it('يبني الطلب من الكميات المدخلة فقط ولا يثبت كميات الجدول القديمة', () => {
        expect(vegItemsFromQuantities({ طماطم: '3.5', خيار: '', 'كرنب أبيض': '0', جزر: '10' }, { 'كرنب أبيض': 'كيس' })).toEqual([
            { name: 'طماطم', qty: 3.5, unit: 'كجم' },
            { name: 'جزر', qty: 10, unit: 'كجم' },
        ]);
    });

    it('يسمح بتغيير وحدة الصنف عند الحاجة', () => {
        expect(vegItemsFromQuantities({ زنجبيل: '2' }, { زنجبيل: 'كجم' })).toEqual([{ name: 'زنجبيل', qty: 2, unit: 'كجم' }]);
    });
});
