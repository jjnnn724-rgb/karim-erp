const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const readApp = (relativePath) => fs.readFileSync(path.join(APP, relativePath), 'utf8');

describe('weekly menu uses the saved menu catalog', () => {
    test('weekly menu rows can select a catalog dish and fill both language names', () => {
        const js = readApp('js/menu-admin.js');
        const html = readApp('menu-admin.html');
        expect(js).toContain('WEEK_CATALOG = (full.items || []).filter(item => item.is_active !== false)');
        expect(js).toContain('class="wk-catalog"');
        expect(js).toContain('data-karim-action="weekUseCatalogItem"');
        expect(js).toContain('data-karim-pass="element"');
        expect(js).toContain('window.weekUseCatalogItem = select =>');
        expect(js).toContain('item.name = catalogItem.name_ar || catalogItem.name ||');
        expect(js).toContain('item.name_en = catalogItem.name_en ||');
        expect(js).toContain("soups: 'الشوربات'");
        expect(js).toContain("mains: 'الأطباق الرئيسية'");
        expect(html).toContain('css/menu-admin.css?v=6.1.4');
        expect(html).toContain('js/menu-admin.js?v=5.14.1');
    });

    test('catalog selections persist as metadata alongside the weekly dish', () => {
        const js = readApp('js/menu-admin.js');
        const routes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'menu-board-routes.js'), 'utf8');
        expect(js).toContain('catalog_id: select && select.value ? Number(select.value) : null');
        expect(routes).toContain('catalog_id: Number.isSafeInteger(Number(it.catalog_id))');
    });

    test('printed weekly menus include the restaurant logo', () => {
        const js = readApp('js/menu-admin.js');
        expect(js).toContain('class="cover-logo" src="${logoUrl}"');
        expect(js).toContain('.cover-logo{display:block;width:88px;height:88px');
    });
});
