/**
 * v2-header-layout.test.js — رأس الشل: لا يتجاوز العرض ولا يُخرج أزراره (المرحلة ٢)
 * ═════════════════════════════════════════════════════════════════════════
 * العطب المقيس على الصفحة الحيّة (RTL، قبل هذا الإصلاح):
 *   `.erp-shell__actions` كان يبسط 1308px من عناصر التحكم داخل هيدر 985px
 *   (1280 − 248 شريط جانبي − 32 حشو − 15 شريط تمرير) فيدفع المستند 351px
 *   ويُخرج زرَّي الثيم والكثافة — آخر كتلتين — خارج الشاشة تمامًا. ولم يكن
 *   عطبًا «للشاشات الصغيرة»: تجاوز عند 1440 (+191) و1366 (+265) أيضًا.
 *
 * فما يحرسه هذا الملف:
 *   ١) الصف قابل للتقليص في القاعدة، لا `flex-shrink: 0` — وإلّا عاد الدفع.
 *   ٢) الممتص الوحيد هو العنقود (`erp-shell__extras`)، لأنه الوحيد بلا
 *      popover متمركز داخله: فلا قصّ لقائمة الجرس. وأنه `nowrap` لأن الهيدر
 *      شريطٌ ثابت الارتفاع (56px) فلا يتحمّل صفًّا ثانيًا.
 *   ٣) الصف نفسه لا يحمل `overflow-x` في القاعدة: كائنُ تمريرٍ هنا يقصّ قائمة
 *      الجرس (وهي `position: absolute` داخله). التمرير يبقى للعنقود وحده.
 *   ٤) لا `overflow-x: hidden` في css/v2 كلها — إخفاءُ العطب ممنوع.
 *   ٥) نقطتا التوقف (1620 · 1400) مخفيتان لما هو مكرّر فقط، وأن كل عنصر
 *      أُخفي نصّه يحمل اسمًا وصوليًّا في مصدره:
 *        · السَّيرشتر وزر كلمة المرور: `aria-label` ⇒ `display: none` مسموح.
 *        · خيارات الثيم: نصّها هو اسمها ⇒ وصفة `.erp-sr-only`، لا `display: none`.
 *   ٦) شبكة الأمان عند 640px فعّالة: `flex: 0 1 auto` — لا `min-width: 0`
 *      وحدها (كانت عاطلة تحت `flex-shrink: 0` فظل الصف 874px عند 360px).
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const SHELL = path.join(CSS_V2, 'erp-shell.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** جسم كتلة `@media (max-width: N px)` — بأقواسٍ متوازنة، لا تعبير نمطي أعمى. */
function mediaBlock(css, maxWidth) {
    const at = css.indexOf(`@media (max-width: ${maxWidth}px)`);
    if (at < 0) {return null;}
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') {depth++;}
        else if (css[i] === '}') {depth--; if (depth === 0) {return css.slice(open + 1, i);}}
    }
    return null;
}

/** جسم أول قاعدة تبدأ بهذا المُحدِّد داخل نصّ معطى. */
function ruleBody(text, selector) {
    const at = text.indexOf(selector);
    if (at < 0) {return null;}
    const open = text.indexOf('{', at);
    const close = text.indexOf('}', open);
    if (open < 0 || close < 0) {return null;}
    return text.slice(open + 1, close);
}

const CSS = strip(read(SHELL));
const BASE = CSS.slice(0, CSS.indexOf('@media'));
const M1620 = mediaBlock(CSS, 1620);
const M1400 = mediaBlock(CSS, 1400);
const M640 = mediaBlock(CSS, 640);

describe('V2 رأس الشل — لا دفع للمستند ولا إخراج لأزراره (المرحلة ٢)', () => {

    test('الصف قابل للتقليص في القاعدة الأساسية', () => {
        const body = ruleBody(BASE, '.erp-shell__actions');
        expect(body).not.toBeNull();
        expect(body).toMatch(/flex-shrink:\s*1/);
        expect(body).not.toMatch(/flex-shrink:\s*0/);
        expect(body).toMatch(/min-width:\s*0/);
    });

    test('الممتص الوحيد هو العنقود: يمرّر داخليًا ولا يلتفّ', () => {
        const body = ruleBody(BASE, '.erp-v2 .erp-shell__extras');
        expect(body).not.toBeNull();
        expect(body).toMatch(/min-width:\s*0/);
        expect(body).toMatch(/overflow-x:\s*auto/);
        expect(body).toMatch(/scrollbar-width:\s*none/);
        // الهيدر شريطٌ ثابت 56px: صفٌّ ثانٍ هنا كان سيُرسم فوق المحتوى تحته.
        expect(body).toMatch(/flex-wrap:\s*nowrap/);
    });

    test('الصف نفسه لا يمرّر في القاعدة: تمريرُه يقصّ قائمة الجرس', () => {
        const body = ruleBody(BASE, '.erp-shell__actions');
        expect(body).not.toMatch(/overflow-x/);
    });

    test('لا overflow-x: hidden في css/v2 كلها', () => {
        const offenders = fs.readdirSync(CSS_V2).filter((n) => n.endsWith('.css'))
            .filter((f) => /overflow-x:\s*hidden/.test(strip(read(path.join(CSS_V2, f)))));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('≤1620px: يسقط النصّ المكرَّر فقط — وكل عنصرٍ يحمل aria-label', () => {
        expect(M1620).not.toBeNull();
        // النصّان المكرَّران: نصّ السَّيرشتر ولوحة Ctrl+K، وتسمية زر كلمة المرور.
        expect(M1620).toMatch(/\.erp-v2 \.erp-search-trigger__text/);
        expect(M1620).toMatch(/\.erp-v2 \.erp-search-trigger \.erp-pal__kbd/);
        expect(M1620).toMatch(/\.erp-v2 \.erp-shell__extras > \.erp-btn:last-child span/);
        expect(M1620).toMatch(/display:\s*none/);

        // الأسماء الوصولية لها في مصدرها: اسمٌ لا يسقط مع النصّ.
        const dash = read(path.join(APP, 'js', 'v2', 'screens', 'dashboard.js'));
        expect(dash).toMatch(/trigger\.setAttribute\('aria-label', 'بحث سريع في الشاشات \(Ctrl\+K\)'\)/);
        expect(dash).toMatch(/class="erp-pal__kbd" aria-hidden="true"/);

        const extras = read(path.join(APP, 'js', 'v2', 'layout', 'shell-extras.js'));
        expect(extras).toMatch(/pwBtn\.setAttribute\('aria-label', 'تغيير كلمة المرور'\)/);
        // والمُحدِّد `:last-child` يشير إليه فعلًا: كلمة المرور آخر ما يُضاف للعنقود.
        expect(extras).toMatch(/cluster\.append\(lamps, langBtn, quick, pwBtn\)/);
    });

    test('≤1400px: نصّ خيار الثيم يُخفى بصريًّا لا يُحذف — الاسم يبقى لـAT', () => {
        expect(M1400).not.toBeNull();
        const body = ruleBody(M1400, '.erp-v2 .erp-shell__actions .erp-theme-option span');
        expect(body).not.toBeNull();
        expect(body).toMatch(/position:\s*absolute/);
        expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
        expect(body).toMatch(/width:\s*1px/);
        // ليس `display: none`: بها كان يمحو اسم الخيار من شجرة الوصول.
        expect(body).not.toMatch(/display:\s*none/);
    });

    test('≤640px: شبكةُ التمرير فعّالة فعلًا (flex: 0 1 auto لا min-width وحدها)', () => {
        expect(M640).not.toBeNull();
        const body = ruleBody(M640, '.erp-v2 .erp-shell__actions');
        expect(body).not.toBeNull();
        expect(body).toMatch(/flex:\s*0 1 auto/);
        expect(body).toMatch(/min-width:\s*0/);
        expect(body).toMatch(/overflow-x:\s*auto/);
        expect(body).toMatch(/scrollbar-width:\s*none/);
        // ولا display: none على نصّ خيار الثيم عند 640 إمّا: الاسم يبقى.
        expect(M640).not.toMatch(/\.erp-theme-option span\s*\{[^}]*display:\s*none/);
    });

    test('التوكنز المستعملة في كتل الرأس كلها معرَّفة', () => {
        const tokens = read(path.join(CSS_V2, 'erp-tokens.css'));
        const defined = new Set((tokens.match(/--erp-[a-z0-9-]+(?=\s*:)/g) || []));
        for (const block of [M1620, M1400, M640].filter(Boolean)) {
            const used = [...block.matchAll(/var\((--erp-[a-z0-9-]+)/g)].map((m) => m[1]);
            expect([...new Set(used)].filter((t) => !defined.has(t))).toEqual([]);
        }
    });
});
