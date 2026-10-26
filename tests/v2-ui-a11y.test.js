/**
 * v2-ui-a11y.test.js — حراسة إصلاحات الوصول في هيكل V2 والهوية.
 * تمنع ارتداد: radios بلا aria-pressed، مصابيح بأدوار صحيحة، قوائم بلا
 * role=group، منطقة تمرير قابلة للتركيز، روابط نصية مسطّرة، وأهداف لمس.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

describe('V2 UI a11y guards', () => {
    test('أزرار الثيم والكثافة radios: aria-checked فقط بلا aria-pressed', () => {
        for (const file of ['js/v2/theme.js', 'js/v2/density.js']) {
            const src = read(file);
            expect(src).toContain("btn.setAttribute('role', 'radio')");
            expect(src).toContain("btn.setAttribute('aria-checked', String(on))");
            expect(src).not.toMatch(/setAttribute\(['"]aria-pressed/);
        }
    });

    test('مصابيح الحالة تحمل role=img مع aria-label', () => {
        const src = read('js/v2/layout/shell-extras.js');
        expect(src).toMatch(/class="erp-lamp" role="img"[^>]*aria-label=/);
    });

    test('قائمة تنقل V2 تبقى قائمة أصلية بلا role=group', () => {
        const src = read('js/v2/layout/app-layout.js');
        expect(src).toMatch(/<ul class="erp-nav-list" aria-labelledby="erp-nav-g-\$\{esc\(group\.id\)\}">/);
        expect(src).not.toContain('<ul class="erp-nav-list" role="group"');
    });

    test('شريط مسار الفواتير القابل للتمرير يقبل التركيز في المسارين', () => {
        for (const file of ['js/v2/screens/dashboard.js', 'js/v2/screens/briefing.js']) {
            expect(read(file)).toMatch(/<ol class="erp-pipe" tabindex="0" aria-label=/);
        }
    });

    test('الروابط داخل النص مسطّرة (ليست لونًا وحده)', () => {
        const css = read('css/v2/erp-base.css');
        expect(css).toMatch(/\.erp-v2 p a[^{]*\{[^}]*text-decoration:\s*underline/);
    });

    test('أهداف اللمس على المؤشرات الخشنة ≥ 44px', () => {
        const css = read('css/v2/erp-shell.css');
        const block = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
        expect(block).not.toBeNull();
        for (const sel of ['.erp-search-trigger', '.erp-nav-group__title', '.erp-theme-option', '.erp-density-option', '.erp-btn']) {
            expect(block[1]).toContain(sel);
        }
        // الرقمُ يأتي من رمزٍ واحد: ٤٤ على المؤشِّر الخشن، ٠ على الفأرة.
        expect(block[1]).toMatch(/min-height:\s*var\(--erp-touch-target\)/);
        // والأرضيةُ تُغطّي كلَّ هدف: الأزرار والأدوار والحقول — بتخصيصٍ
        // (٠،٤،٠) يغلب قواعدَ الشاشات (٠،٣،٠) فلم يبقَ هدفٌ دون ٤٤.
        expect(block[1]).toMatch(/\.erp-v2 :is\(button,/);
        expect(block[1]).toMatch(/\[role="button"\]/);
        expect(block[1]).toMatch(/min-block-size:\s*var\(--erp-touch-target\)/);
        expect(block[1]).toMatch(/min-inline-size:\s*var\(--erp-touch-target\)/);
        // مربّعاتُ الاختيار استثناءٌ مقصود: هدفُها التسميةُ حولها.
        expect(block[1]).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);

        const tokens = read('css/v2/erp-tokens.css');
        expect(tokens).toMatch(/--erp-touch-target:\s*0px/);
        expect(tokens).toMatch(/@media \(pointer: coarse\)[\s\S]*?--erp-touch-target:\s*44px/);
    });

    test('نص اسم العلامة في الشريط الجانبي يرث حبر الشريط لا حبر الصفحة', () => {
        const css = read('css/v2/erp-identity.css');
        expect(css).toMatch(/color:\s*var\(--erp-text-primary\);\s*\n\s*background:\s*var\(--erp-sidebar-bg\);/);
    });

    test('روابط النص تأخذ درجة النحاس النصّية (4.91:1) لا درجة التعبئة (3.18:1)', () => {
        const css = read('css/v2/erp-base.css');
        expect(css).toMatch(/\.erp-v2 a\s*\{[^}]*color:\s*var\(--erp-brand-text\)/);
        // الرابط داخل جملة الحالة مسطّر: اللون وحده ليس دليلًا (WCAG 1.4.1).
        expect(css).toMatch(/\.erp-v2 \.erp-state a\s*\{[^}]*text-decoration:\s*underline/);
    });

    test('الشريط الجانبي المغلق على الجوال خارج مسار Tab', () => {
        const src = read('js/v2/layout/app-layout.js');
        expect(src).toMatch(/matchMedia\('\(max-width: 1024px\)'\)/);
        expect(src).toMatch(/el\.sidebar\.inert = drawerMq\.matches && !state\.drawerOpen;/);
        // يُرفع الحجب قبل نقل التركيز إلى عنصر داخل الشريط، وإلا فشل التركيز.
        const start = src.indexOf('function setDrawer(open)');
        const sync = src.indexOf('syncSidebarInert();', start);
        const focus = src.indexOf('el.nav.querySelector', start);
        expect(sync).toBeGreaterThan(start);
        expect(focus).toBeGreaterThan(sync);
    });

    test('كل شاشة تُفتح بعنوان h1 واحد في الترويسة', () => {
        const layout = read('js/v2/layout/app-layout.js');
        expect(layout).toContain('<h1 class="erp-shell__page-title erp-truncate" id="erp-page-title" data-erp-page-title></h1>');
        // المحتوى يُسمّى بعنوان الشاشة: الانتقال بالتركيز إلى <main> يعلن اسمًا.
        expect(layout).toContain('<main class="erp-shell__content" id="erp-main" tabindex="-1" aria-labelledby="erp-page-title"></main>');
        // مخفيٌّ بصريًا لا display:none — وإلا خرج من شجرة الوصول.
        const css = read('css/v2/erp-shell.css');
        expect(css).toMatch(/\.erp-v2 \.erp-shell__page-title\s*\{[^}]*clip-path:\s*inset\(50%\)/);
        expect(css).not.toMatch(/\.erp-v2 \.erp-shell__page-title\s*\{[^}]*display:\s*none/);
        // عنوان الشاشة الداخلي h2: عنوان المستند واحد.
        for (const f of ['js/v2/screens/cash-register.js', 'js/v2/screens/cashier-sales.js']) {
            expect(read(f)).not.toMatch(/<h1 class="(?:cashreg|csales)__title"/);
            expect(read(f)).toMatch(/<h2 class="(?:cashreg|csales)__title"/);
        }
    });

    test('الانتقال بين الشاشات ينقل التركيز إلى المحتوى ويبدأ من أعلاه', () => {
        const src = read('js/v2/preview.js');
        expect(src).toMatch(/let firstScreen = true;/);
        expect(src).toMatch(/window\.scrollTo\(0, 0\);/);
        expect(src).toMatch(/shell\.main\.focus\(\{ preventScroll: true \}\)/);
        // الشاشة التي تضع تركيزها بنفسها (حقل بحث) تحتفظ به.
        expect(src).toMatch(/if \(active && shell\.main\.contains\(active\)\) \{return;\}/);
        const start = src.indexOf('function applyKey(key) {');
        const body = src.slice(start, src.indexOf('\n}', start));
        const paint = body.indexOf('renderScreen(key)');
        const settle = body.indexOf('settleScreen();');
        expect(paint).toBeGreaterThan(-1);
        expect(settle).toBeGreaterThan(paint);
    });

    test('تركيز المحتوى يظهر بالكيبورد وحده', () => {
        const css = read('css/v2/erp-shell.css');
        // قاعدة إخفاءٍ لاحقة كانت تُلغي :focus-visible فتُخفي كل حلقة تركيز.
        expect(css).not.toMatch(/\.erp-shell__content:focus\s*\{\s*outline:\s*none/);
        expect(read('css/v2/erp-base.css')).toMatch(/\.erp-v2 :focus-visible\s*\{[^}]*outline:\s*2px solid var\(--erp-focus-ring\)/);
    });

    test('رابط التخطّي يحفظ الشاشة ولا يمرّ بالراوتر كمسار مجهول', () => {
        const src = read('js/v2/layout/app-layout.js');
        expect(src).toMatch(/root\.querySelector\('\.erp-skip-link'\)/);
        const start = src.indexOf('const onSkip = (e) => {');
        const body = src.slice(start, src.indexOf('};', start));
        expect(body).toMatch(/e\.preventDefault\(\)/);
        expect(body).toContain('el.main.focus()');
        // ويقف تحت الترويسة اللاصقة لا خلفها.
        expect(read('css/v2/erp-shell.css')).toMatch(/\.erp-v2 \.erp-shell__content\s*\{[^}]*scroll-margin-block-start:/);
    });
});
