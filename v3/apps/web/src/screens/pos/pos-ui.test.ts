import { describe, expect, it } from 'vitest';
import { bestSellers, type CatalogItem, groupCatalog, orderCatalog, searchScore, soldQty } from './pos-ui';

function item(overrides: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name'>): CatalogItem {
    return {
        price: 10,
        vatRate: 15,
        unit: 'حبة',
        barcode: '',
        stock: null,
        imageUrl: '',
        category: '',
        tier: '',
        isBuffet: false,
        isCore: false,
        ...overrides,
    };
}

const SALES: Record<string, number> = { A: 120, B: 40, C: 5 };

describe('ترتيب كتالوج الكاشير الذكي', () => {
    it('يقدّم المفضلة، ثم الأكثر مبيعًا، ثم الأبجدية', () => {
        const items = [
            item({ id: '1', name: 'شاي', yaraCode: 'C' }),
            item({ id: '2', name: 'قهوة', yaraCode: 'A' }),
            item({ id: '3', name: 'عصير', yaraCode: 'B' }),
            item({ id: '4', name: 'ماء' }),
        ];
        const ordered = orderCatalog(items, { favorites: ['4'], sales: SALES });
        expect(ordered.map((row) => row.id)).toEqual(['4', '2', '3', '1']);
    });

    it('غياب المبيعات يعيد الترتيب الأبجدي بلا كسر', () => {
        const items = [item({ id: '1', name: 'ب' }), item({ id: '2', name: 'أ' })];
        expect(orderCatalog(items, { favorites: [] }).map((row) => row.id)).toEqual(['2', '1']);
        expect(soldQty(items[0]!, undefined)).toBe(0);
    });

    it('البحث يقدّم الباركود المطابق ثم بادئة الاسم', () => {
        const barcodeMatch = item({ id: '1', name: 'صنف بعيد', barcode: '12345' });
        const nameMatch = item({ id: '2', name: '12345 صنف' });
        const contains = item({ id: '3', name: 'صنفX12345' });
        expect(searchScore(barcodeMatch, '12345')).toBe(0);
        expect(searchScore(nameMatch, '12345')).toBe(2);
        expect(searchScore(contains, '12345')).toBe(4);
        const ordered = orderCatalog([contains, nameMatch, barcodeMatch], { favorites: [], query: '12345' });
        expect(ordered.map((row) => row.id)).toEqual(['1', '2', '3']);
    });

    it('تجميع الفئات يرتبها بالمبيعات ويضع «أخرى» أخيرًا', () => {
        const groups = groupCatalog(
            [
                item({ id: '1', name: 'شاي', category: 'مشروبات', yaraCode: 'A' }),
                item({ id: '2', name: 'كبسة', category: 'أطباق', yaraCode: 'C' }),
                item({ id: '3', name: 'بلا فئة' }),
            ],
            { favorites: [], sales: SALES },
        );
        expect(groups.map((group) => group.key)).toEqual(['مشروبات', 'أطباق', 'أخرى']);
    });

    it('شريط الأكثر مبيعًا يستثني المفضلة ويحترم الحد', () => {
        const items = [
            item({ id: '1', name: 'قهوة', yaraCode: 'A' }),
            item({ id: '2', name: 'عصير', yaraCode: 'B' }),
            item({ id: '3', name: 'شاي', yaraCode: 'C' }),
            item({ id: '4', name: 'ماء' }),
        ];
        expect(bestSellers(items, { favorites: ['1'], sales: SALES, limit: 2 }).map((row) => row.id)).toEqual(['2', '3']);
        expect(bestSellers(items, { favorites: [] })).toEqual([]);
    });
});
