const { parseRevenueItems } = require('../backend/external-sales-routes');

describe('parseRevenueItems (البيع الخارجي — فك بنود الفاتورة)', () => {
    it('يُحلّل بندًا بصيغة «اسم-وحدة(كمية)»', () => {
        const rows = parseRevenueItems('[AUTO:YARASOFT] | invoice=BILLS4:2282 | sec=عميل | items=كاتشب رنا جالون-كرتون(1)');
        expect(rows).toEqual([{ name: 'كاتشب رنا جالون', unit: 'كرتون', qty: 1, parsed: true }]);
    });

    it('يُحلّل عدة بنود في نفس السطر', () => {
        const rows = parseRevenueItems('x | items=كاتشب رنا جالون-كرتون(0.5)، باكسو كفته لحم ماليزي-كيس(80)');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ name: 'كاتشب رنا جالون', unit: 'كرتون', qty: 0.5, parsed: true });
        expect(rows[1]).toEqual({ name: 'باكسو كفته لحم ماليزي', unit: 'كيس', qty: 80, parsed: true });
    });

    it('يُحلّل صيغة «اسم (كمية)» بدون وحدة', () => {
        const rows = parseRevenueItems('x | items=شاي ربيع احمر (0.13)');
        expect(rows).toEqual([{ name: 'شاي ربيع احمر', unit: null, qty: 0.13, parsed: true }]);
    });

    it('يُعيد مصفوفة فارغة عند غياب items=', () => {
        expect(parseRevenueItems('لا يوجد بنود هنا')).toEqual([]);
        expect(parseRevenueItems(null)).toEqual([]);
        expect(parseRevenueItems(undefined)).toEqual([]);
    });

    it('يحافظ على البند غير المعروف دون فقدان البند', () => {
        const rows = parseRevenueItems('x | items=بند غريب بدون أي صيغة');
        expect(rows).toHaveLength(1);
        expect(rows[0].qty).toBe(1);
        expect(rows[0].name).toBe('بند غريب بدون أي صيغة');
    });

    it('يُنظّف مسافات زائدة داخل الأسماء', () => {
        const rows = parseRevenueItems('x | items=شاي    ربيع   احمر -علبة(2)');
        expect(rows[0].name).toBe('شاي ربيع احمر');
    });

    it('وحدة مركّبة بأحرف غير الفاصلة والأقواس', () => {
        const rows = parseRevenueItems('x | items=صحن ربع حبه -كرتون(2)');
        expect(rows[0]).toEqual({ name: 'صحن ربع حبه', unit: 'كرتون', qty: 2, parsed: true });
    });
});
