const fs = require('fs');
const path = require('path');
const posSearch = require('../frontend/app/js/pos-search.js');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (relativePath) => fs.readFileSync(path.join(APP, relativePath), 'utf8');

describe('POS fast-search and checkout UX', () => {
    test('Arabic fuzzy search tolerates common letter and diacritic variants', () => {
        expect(posSearch.includes('باذنجان', 'بازنجان')).toBe(true);
        expect(posSearch.includes('أرزّ باللحم', 'ارز باللحم')).toBe(true);
        expect(posSearch.includes('شاورما', 'ساورما')).toBe(true);
        expect(posSearch.includes('منتج', '')).toBe(false);
    });

    test('search normalizes Arabic and Persian numerals for barcode entry', () => {
        expect(posSearch.key('رقم ١٢٣٤٥')).toBe(posSearch.key('رقم ۱۲۳۴۵'));
        expect(posSearch.includes('باركود ١٢٣٤', '1234')).toBe(true);
    });

    test('POS loads local fonts and its standalone fuzzy-search helper', () => {
        const html = read('pos.html');
        expect(html).toContain('css/menu-fonts.css');
        expect(html).not.toContain('fonts.googleapis.com');
        expect(html).toContain('css/pos.css?v=4.9.34');
        expect(html).toContain('js/pos-search.js?v=4.9.162');
        expect(html).toContain('js/pos.js?v=4.9.34');
        expect(html.indexOf('js/pos-search.js')).toBeLessThan(html.indexOf('js/pos.js'));
        expect(html).toContain('<kbd>F2</kbd> إتمام البيع');
        expect(html).toContain('<kbd>F9</kbd> إغلاق الوردية');
        // إصدار الكاش يتقدّم مع كل دفعة — الحراسة تثبّت الوجودَ لا الرقمَ
        expect(read('sw.js')).toMatch(/const CACHE_VERSION='\d+\.\d+\.\d+';/);
    });

    test('legacy cashier shows a denser responsive product catalog', () => {
        const css = read('css/pos.css');
        expect(css).toContain('minmax(clamp(96px, 8vw, 122px), 1fr)');
        expect(css).toContain('minmax(98px, 1fr)');
        expect(css).toContain('min-height: 96px');
        expect(css).toContain('font-size: clamp(11px, 0.85vw, 12.5px)');
    });

    test('product search uses cached normalized labels and delegated product clicks', () => {
        const js = read('js/pos.js');
        expect(js).toContain('const productSearchCache = new WeakMap();');
        expect(js).toContain('productSearchText(product).includes(search)');
        expect(js).toContain("$('#products-grid').addEventListener('click'");
        expect(js).not.toContain("$$('.product-card').forEach");
        expect(js).toContain('const typingField = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);');
    });
});
