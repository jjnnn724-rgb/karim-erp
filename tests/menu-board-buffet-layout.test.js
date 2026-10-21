const { cleanBuffetLayout, emptyBuffetLayout, collectBuffetProductIds } = require('../backend/menu-board-routes');

describe('menu board buffet layout', () => {
    test('normalizes an empty layout to a full weekly carving schedule', () => {
        const layout = cleanBuffetLayout(emptyBuffetLayout());

        expect(layout.enabled).toBe(false);
        expect(layout.appetizers).toEqual([]);
        expect(layout.carving_by_day).toHaveLength(7);
        expect(layout.carving_by_day[6]).toEqual({ day: 6, lunch: null, dinner: null });
    });

    test('supports appetizer selections and defaults older layouts to no appetizers', () => {
        const oldLayout = { ...emptyBuffetLayout() };
        delete oldLayout.appetizers;
        expect(cleanBuffetLayout(oldLayout).appetizers).toEqual([]);

        const layout = cleanBuffetLayout({ ...emptyBuffetLayout(), appetizers: [21, 22] });
        expect(layout.appetizers).toEqual([21, 22]);
        expect(() => cleanBuffetLayout({ ...emptyBuffetLayout(), appetizers: Array.from({ length: 9 }, (_, index) => index + 1) }))
            .toThrow('INVALID_BUFFET_APPETIZERS');
    });

    test('supports up to ten main courses per meal and two soups', () => {
        const invalid = { ...emptyBuffetLayout(), enabled: true };
        expect(cleanBuffetLayout(invalid).breakfast_mains).toEqual([]);

        const valid = cleanBuffetLayout({
            ...invalid,
            breakfast_mains: Array.from({ length: 10 }, (_, index) => index + 1),
            lunch_mains: [1, 2],
            dinner_mains: [1],
            soups: [11, 12],
        });
        expect(valid.breakfast_mains).toHaveLength(10);
        expect(valid.lunch_mains).toEqual([1, 2]);
        expect(valid.dinner_mains).toEqual([1]);
        expect(valid.soups).toEqual([11, 12]);
        expect(() => cleanBuffetLayout({
            ...invalid,
            dinner_mains: Array.from({ length: 11 }, (_, index) => index + 1),
        })).toThrow('INVALID_BUFFET_DINNER_MAINS');
    });

    test('defaults each meal to the legacy main-course selection', () => {
        const legacy = {
            ...emptyBuffetLayout(),
            mains: [31, 32],
        };
        delete legacy.breakfast_mains;
        delete legacy.lunch_mains;
        delete legacy.dinner_mains;

        const layout = cleanBuffetLayout(legacy);
        expect(layout.breakfast_mains).toEqual([31, 32]);
        expect(layout.lunch_mains).toEqual([31, 32]);
        expect(layout.dinner_mains).toEqual([31, 32]);
    });

    test('rejects duplicate, non-positive, and over-limit product selections', () => {
        expect(() => cleanBuffetLayout({ ...emptyBuffetLayout(), soups: [1, 1] })).toThrow('INVALID_BUFFET_SOUPS');
        expect(() => cleanBuffetLayout({ ...emptyBuffetLayout(), salads: [0] })).toThrow('INVALID_BUFFET_SALADS');
        expect(() => cleanBuffetLayout({ ...emptyBuffetLayout(), desserts: Array.from({ length: 9 }, (_, index) => index + 1) }))
            .toThrow('INVALID_BUFFET_DESSERTS');
        expect(() => cleanBuffetLayout('not-json')).toThrow('INVALID_BUFFET_LAYOUT');
        expect(() => cleanBuffetLayout(null)).toThrow('INVALID_BUFFET_LAYOUT');
    });

    test('normalizes carving selections by weekday and preserves free-text values', () => {
        const layout = cleanBuffetLayout({
            ...emptyBuffetLayout(),
            carving_by_day: [{ day: 2, lunch: '8', dinner: null }],
        });
        expect(layout.carving_by_day[2]).toEqual({ day: 2, lunch: '8', dinner: null });
        const named = cleanBuffetLayout({
            ...emptyBuffetLayout(),
            carving_by_day: [{ day: 0, lunch: 'لحم حنيذ', dinner: null }],
        });
        expect(named.carving_by_day[0].lunch).toBe('لحم حنيذ');
        expect(() => cleanBuffetLayout({ ...emptyBuffetLayout(), enabled: 'false' })).toThrow('INVALID_BUFFET_ENABLED');
    });

    test('validates numeric carving item IDs without treating free-text names as IDs', () => {
        const layout = cleanBuffetLayout({
            ...emptyBuffetLayout(),
            appetizers: [21],
            carving_by_day: [
                { day: 0, lunch: 'لحم حنيذ', dinner: '123' },
            ],
        });

        expect(collectBuffetProductIds(layout)).toContain(21);
        expect(collectBuffetProductIds(layout)).toContain(123);
        expect(collectBuffetProductIds(layout)).not.toContain('لحم حنيذ');
    });
});
