const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (relativePath) => fs.readFileSync(path.join(APP, relativePath), 'utf8');

// طبقة «شاشة واحدة بلا تمرير» للكاشير: pos-fit.css + pos-fit.js
// الحراسة تثبّت العقد لا الأرقام: أي تعديل يخالف «لا تمرير» يفشل هنا.
describe('POS single-viewport layout (no scrolling)', () => {
    const html = read('pos.html');
    const css = read('css/pos-fit.css');
    const js = read('js/pos-fit.js');

    test('layer loads after the base POS stylesheet and script', () => {
        expect(html).toMatch(/<link rel="stylesheet" href="css\/pos-fit\.css\?v=\d+\.\d+\.\d+">/);
        expect(html).toMatch(/<script src="js\/pos-fit\.js\?v=\d+\.\d+\.\d+"><\/script>/);
        expect(html.indexOf('css/pos.css')).toBeLessThan(html.indexOf('css/pos-fit.css'));
        expect(html.indexOf('js/pos.js')).toBeLessThan(html.indexOf('js/pos-fit.js'));
    });

    test('product and cart pagers exist with stable ids and Arabic labels', () => {
        ['pos-pager', 'pos-pager-range', 'pos-pager-page', 'pos-page-prev', 'pos-page-next',
            'cart-pager', 'cart-pager-page', 'cart-page-prev', 'cart-page-next']
            .forEach((id) => expect(html).toContain(`id="${id}"`));
        // السلة تبدأ مطويّة: الشريط يظهر فقط عند تجاوز السعة
        expect(html).toMatch(/class="cart-pager hidden" id="cart-pager"/);
        // تسمية الصفحة عربية صريحة (1 / 2 ملتبسة في RTL)
        expect(js).toContain('صفحة ${state.productPage + 1} من ${pages}');
        expect(js).toContain('صفحة ${state.cartPage + 1} من ${finalPages}');
    });

    test('grid, cart and page never scroll — overflow stays hidden', () => {
        // لا قاعدة تمرير في الطبقة كلها
        expect(css).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
        // الطبقة تُلغي تمرير pos.css على الحاويتين بالتحديد
        expect(css).toMatch(/\.products-grid\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/\.cart-items\s*\{[^}]*overflow:\s*hidden/);
        // الارتفاع مقفول على المستند والشاشة
        expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/#pos-screen\s*\{[^}]*overflow:\s*hidden/);
    });

    test('payment amount fields are text+decimal so Latin digits always render', () => {
        ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'].forEach((id) => {
            const field = new RegExp(`<input type="text" inputmode="decimal"[^>]*id="${id}"`);
            expect(html).toMatch(field);
            expect(html).not.toMatch(new RegExp(`<input type="number"[^>]*id="${id}"`));
        });
        // الحقول النصية تحتاج تنظيفًا يدويًا للمدخلات غير الرقمية
        expect(js).toContain("field.addEventListener('beforeinput'");
        expect(js).toContain("field.addEventListener('input'");
        // والقيم تبقى LTR حتى بعد تحويلها من number إلى text
        expect(css).toMatch(/input\[type="number"\],\s*\.pay-channel input\[inputmode="decimal"\]\s*\{[^}]*direction:\s*ltr/);
    });

    test('no inline event handlers on the cashier screen', () => {
        expect(html).not.toMatch(/\son(click|change|input|submit|keydown|keyup|load)\s*=/i);
    });

    test('pagination hides extras with one class and keeps every card in the DOM', () => {
        expect(js).toContain("card.classList.toggle('pos-page-off'");
        expect(js).toContain("item.classList.toggle('pos-page-off'");
        expect(css).toContain('.products-grid .product-card.pos-page-off { display: none !important; }');
        expect(css).toContain('.cart-item.pos-page-off { display: none !important; }');
        // السعة تُقاس من الهندسة الحقيقية لا من رقم ثابت
        expect(js).toContain('grid.clientHeight');
        expect(js).toContain('gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`');
    });

    test('every keyboard shortcut stays visible at every width', () => {
        // تراجع محمي: لا يجوز إخفاء أي اختصار بالـ nth-child
        expect(css).not.toMatch(/\.pos-shortcut-help[^{]*nth-child/);
        expect(css).not.toMatch(/\.pos-shortcut-help\s*\{\s*display:\s*none/);
        expect(html).toMatch(/<kbd>F1<\/kbd>/);
        expect(html).toMatch(/<kbd>F9<\/kbd>/);
        // حين يضيق عمود السلة يُخفى سطر «الوحدة × الكمية» ليبقى الاسم مقروءًا
        expect(css).toContain('.cart-item-price { display: none; }');
    });

    test('motion is opt-out aware and print never paints the cashier', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toMatch(/@media print\s*\{[^}]*#pos-screen\s*\{\s*display:\s*none/);
    });
});
