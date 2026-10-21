const { boardCategorySelected, cleanBoardCategories } = require('../backend/menu-board-routes');

describe('menu board category selection', () => {
    test('treats null as all categories and an empty array as none', () => {
        expect(boardCategorySelected('غداء', null)).toBe(true);
        expect(boardCategorySelected('غداء', [])).toBe(false);
    });

    test('only includes selected category names', () => {
        const selected = cleanBoardCategories([' غداء ', 'أصناف أخرى']);

        expect(selected).toEqual(['غداء', 'أصناف أخرى']);
        expect(boardCategorySelected('غداء', selected)).toBe(true);
        expect(boardCategorySelected('عشاء', selected)).toBe(false);
    });

    test('accepts clearing a filter and rejects malformed category data', () => {
        expect(cleanBoardCategories(null)).toBeNull();
        expect(cleanBoardCategories([])).toEqual([]);
        expect(() => cleanBoardCategories('غداء')).toThrow('INVALID_CATEGORIES');
    });

    test('limits selected categories to the supported maximum', () => {
        const categories = Array.from({ length: 65 }, (_, index) => `category-${index}`);

        expect(cleanBoardCategories(categories)).toHaveLength(60);
    });
});
