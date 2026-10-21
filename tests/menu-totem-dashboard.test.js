const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (relativePath) => fs.readFileSync(path.join(APP, relativePath), 'utf8');

describe('menu board dashboard meal scheduling and bilingual item entry', () => {
    test('dashboard exposes a menu category and start time for each meal', () => {
        const html = read('menu-totem-dashboard.html');
        for (const id of [
            'setBreakfastStart', 'setBreakfastCategory',
            'setLunchStart', 'setLunchCategory',
            'setDinnerStart', 'setDinnerCategory',
        ]) {
            expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('menu-totem-dashboard.css?v=2.4.0');
        expect(html).toContain('menu-totem-dashboard.js?v=2.9.0');
    });

    test('selected meal categories and start times are saved to board settings', () => {
        const dashboard = read('js/menu-totem-dashboard.js');
        const board = read('js/menu-board.js');
        expect(dashboard).toContain("['setBreakfastCategory', s.breakfast_category]");
        expect(dashboard).toContain("['setLunchCategory', s.lunch_category]");
        expect(dashboard).toContain("['setDinnerCategory', s.dinner_category]");
        expect(dashboard).toContain('breakfast_category: categories.breakfast || null');
        expect(dashboard).toContain('lunch_category: categories.lunch || null');
        expect(dashboard).toContain('dinner_category: categories.dinner || null');
        expect(board).toContain('assigned.set(String(category), period)');
        expect(board).toContain('scheduleCycle(true)');
        expect(board).toContain('periodAtMinute(now.getHours() * 60 + now.getMinutes(), s)');
    });

    test('automatic Arabic translation reports outcomes and ignores stale responses', () => {
        const dashboard = read('js/menu-totem-dashboard.js');
        expect(dashboard).toContain('https://api.mymemory.translated.net/get?q=');
        expect(dashboard).toContain('request !== TR_REQUEST');
        expect(dashboard).toContain('AbortController');
        expect(dashboard).toContain('تعذّرت الترجمة التلقائية');
        expect(dashboard).toContain('تمت الترجمة تلقائيًا');
        expect(dashboard).toContain('id="translationStatus" class="translation-status" aria-live="polite"');
    });
});
