/**
 * v2-header-layout.test.js — رأس الشل ومركز التحكم
 * ═════════════════════════════════════════════════════════════════════════
 * العطب المقيس تاريخيًا: `.erp-shell__actions` كان يبسط 1308px من عناصر
 * التحكم داخل هيدر 985px فيدفع المستند 351px، وعند 390px صار العنقود
 * 0px عرضًا يحمل 796px محتوى — كلمة المرور وحالة الخادم واللغة والثيم كلها
 * خارج الشاشة. الحلّ ليس نقطة توقف جديدة بل بنية جديدة: الرأس يحتفظ فقط
 * بما له وظيفة دائمة (بحث · جرس · جلسة · مركز التحكم)، وكل تحكم ثانوي
 * يسكن لوحة منبثقة ثابتة العرض.
 *
 * فما يحرسه هذا الملف:
 *   ١) الصف قابل للتقليص في القاعدة (`flex-shrink: 1` + `min-width: 0`)
 *      ولا يحمل `overflow-x` — فلا دفع للمستند ولا قصّ لقائمة الجرس.
 *   ٢) لا وجود لشريط `erp-shell__extras` بعد اليوم (لا CSS ولا تركيب).
 *   ٣) الزناد يعلن اللوحة (`aria-controls`/`aria-expanded`) واللوحة
 *      `role="dialog"` مخفيةٌ افتراضيًا وخارج `<header>` — لأن
 *      `backdrop-filter` على الرأس يجعل `position: fixed` يتمركز داخله.
 *   ٤) كل التحكمات الثانوية تُركَّب داخل `[data-erp-more]` لا في الرأس.
 *   ٥) شبكة الأزرار السريعة تقع على `<span class="erp-shell__quick">`
 *      لا على حاويها — وإلّا صارت الأربعة صفًّا واحدًا مقصوصًا.
 *   ٦) حدود التكامل المخفية لا تُرسم (`.erp-boundary[hidden]`).
 *   ٧) لا `overflow-x: hidden` في css/v2 كلها — إخفاء العطب ممنوع.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const SHELL = path.join(CSS_V2, 'erp-shell.css');
const LAYOUT = path.join(APP, 'js', 'v2', 'layout', 'app-layout.js');
const EXTRAS = path.join(APP, 'js', 'v2', 'layout', 'shell-extras.js');

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
const M640 = mediaBlock(CSS, 640);
const M340 = mediaBlock(CSS, 340);

const layoutSrc = read(LAYOUT);
const extrasSrc = read(EXTRAS);

describe('V2 رأس الشل — مركز تحكم بدل شريطٍ يُسحق', () => {

    test('الصف قابل للتقليص في القاعدة ولا يمرّر', () => {
        const body = ruleBody(BASE, '.erp-shell__actions');
        expect(body).not.toBeNull();
        expect(body).toMatch(/flex-shrink:\s*1/);
        expect(body).not.toMatch(/flex-shrink:\s*0/);
        expect(body).toMatch(/min-width:\s*0/);
        // التمرير هنا يقصّ قائمة الجرس (absolute داخل الصف).
        expect(body).not.toMatch(/overflow-x/);
    });

    test('شريط extras أُزيل من CSS والتركيب معًا', () => {
        const offenders = fs.readdirSync(CSS_V2).filter((n) => n.endsWith('.css'))
            .filter((f) => /erp-shell__extras/.test(strip(read(path.join(CSS_V2, f)))));
        expect({ offenders }).toEqual({ offenders: [] });
        expect(layoutSrc).not.toMatch(/erp-shell__extras/);
        expect(extrasSrc).not.toMatch(/erp-shell__actions/);
    });

    test('الزناد يعلن اللوحة واللوحة حوارٌ مخفيٌّ افتراضيًا', () => {
        expect(layoutSrc).toMatch(/data-erp-more-toggle/);
        expect(layoutSrc).toMatch(/aria-controls="erp-more-panel"/);
        expect(layoutSrc).toMatch(/aria-expanded="false"/);
        expect(layoutSrc).toMatch(/aria-label="مركز التحكم"/);
        expect(layoutSrc).toMatch(/id="erp-more-panel"[^>]*data-erp-more[^>]*hidden/);
        expect(layoutSrc).toMatch(/role="dialog" aria-label="مركز التحكم"/);
    });

    test('اللوحة خارج الرأس: backdrop-filter يجعل fixed يتمركز داخله', () => {
        const panelAt = layoutSrc.indexOf('id="erp-more-panel"');
        const headerEnd = layoutSrc.indexOf('</header>');
        const toolbarAt = layoutSrc.indexOf('class="erp-toolbar"');
        expect(panelAt).toBeGreaterThan(headerEnd);
        expect(panelAt).toBeLessThan(toolbarAt);
    });

    test('كل التحكمات الثانوية لها مقعد داخل اللوحة', () => {
        for (const slot of [
            'data-erp-more-status', 'data-erp-theme-slot', 'data-erp-density-slot',
            'data-erp-more-lang', 'data-erp-more-quick', 'data-erp-more-account',
        ]) {
            expect(layoutSrc).toMatch(new RegExp(slot));
        }
        // التركيب الفعلي: extras تبحث عن اللوحة وتُلحق بها، لا بالرأس.
        expect(extrasSrc).toMatch(/querySelector\('\[data-erp-more\]'\)/);
        expect(extrasSrc).toMatch(/querySelector\('\[data-erp-more-status\]'\)/);
        expect(extrasSrc).toMatch(/querySelector\('\[data-erp-more-quick\]'\)/);
        expect(extrasSrc).toMatch(/querySelector\('\[data-erp-more-lang\]'\)/);
        expect(extrasSrc).toMatch(/querySelector\('\[data-erp-more-account\]'\)/);
    });

    test('الفتح/الإغلاق يحفظ التركيز ويحترم Escape والضغط الخارجي', () => {
        expect(layoutSrc).toMatch(/el\.morePanel\.hidden = !moreOpen;/);
        expect(layoutSrc).toMatch(/el\.moreToggle\.setAttribute\('aria-expanded', String\(moreOpen\)\);/);
        expect(layoutSrc).toMatch(/moreReturnFocus/);
        // Escape يغلق اللوحة قبل الدرج.
        expect(layoutSrc.indexOf("e.key === 'Escape' && moreOpen"))
            .toBeLessThan(layoutSrc.indexOf("e.key === 'Escape' && state.drawerOpen"));
        // النقر الخارجي يغلق دون سحب التركيز من حيث ذهب المستخدم.
        expect(layoutSrc).toMatch(/setMore\(false, \{ returnFocus: false \}\)/);
    });

    test('اللوحة ثابتة بعرضٍ مقروء وبتمرير داخلي', () => {
        const body = ruleBody(BASE, '.erp-shell__more {');
        expect(body).not.toBeNull();
        expect(body).toMatch(/position:\s*fixed/);
        expect(body).toMatch(/inline-size:\s*min\(340px/);
        expect(body).toMatch(/max-block-size:/);
        expect(body).toMatch(/overflow-y:\s*auto/);
        const hidden = ruleBody(BASE, '.erp-shell__more[hidden]');
        expect(hidden).toMatch(/display:\s*none/);
        expect(ruleBody(BASE, '.erp-shell__more-section[hidden]')).toMatch(/display:\s*none/);
    });

    test('الشبكة السريعة على span الأزرار لا على حاويها', () => {
        const body = ruleBody(BASE, '.erp-v2 .erp-shell__more-quick .erp-shell__quick');
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*grid/);
        expect(body).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(body).toMatch(/inline-size:\s*100%/);
        // عناوين طويلة تُقصّ بنقاط لا تدفع اللوحة أفقيًا.
        expect(BASE).toMatch(/\.erp-v2 \.erp-shell__more-quick \.erp-btn span \{[^}]*text-overflow:\s*ellipsis/);
    });

    test('الحدود المخفية لا تُرسم: القاعدة تتغلب على display:inline-flex', () => {
        const body = ruleBody(BASE, '.erp-v2 .erp-boundary[hidden]');
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*none/);
    });

    test('لا overflow-x: hidden في css/v2 كلها', () => {
        const offenders = fs.readdirSync(CSS_V2).filter((n) => n.endsWith('.css'))
            .filter((f) => /overflow-x:\s*hidden/.test(strip(read(path.join(CSS_V2, f)))));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('≤640px: ورقةٌ كاملة العرض ويُخفى النصّ المكرَّر فقط', () => {
        expect(M640).not.toBeNull();
        const sheet = ruleBody(M640, '.erp-shell__more {');
        expect(sheet).not.toBeNull();
        expect(sheet).toMatch(/inset-inline:\s*var\(--erp-space-2\)/);
        expect(sheet).toMatch(/inline-size:\s*auto/);

        expect(M640).toMatch(/\.erp-v2 \.erp-search-trigger__text/);
        expect(M640).toMatch(/\.erp-v2 \.erp-search-trigger \.erp-pal__kbd/);
        expect(M640).toMatch(/display:\s*none/);
        // الاسم الوصولي في المصدر لا يسقط مع النص.
        expect(read(path.join(APP, 'js', 'v2', 'screens', 'dashboard.js')))
            .toMatch(/trigger\.setAttribute\('aria-label', 'بحث سريع في الشاشات \(Ctrl\+K\)'\)/);

        // نصّ خيارات الثيم والكثافة هو اسمها — لا يُخفى في أي عرض.
        for (const block of [M640, M340]) {
            expect(block).not.toMatch(/\.erp-theme-option[^}]*display:\s*none/);
            expect(block).not.toMatch(/\.erp-density-option[^}]*display:\s*none/);
        }
    });

    test('≤340px: الأزرار السريعة عمود واحد بلا نقاط قصّ', () => {
        expect(M340).not.toBeNull();
        const body = ruleBody(M340, '.erp-v2 .erp-shell__more-quick .erp-shell__quick');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    });

    test('التوكنز المستعملة في كتل العرض معرَّفة', () => {
        const tokens = read(path.join(CSS_V2, 'erp-tokens.css'));
        const defined = new Set((tokens.match(/--erp-[a-z0-9-]+(?=\s*:)/g) || []));
        for (const block of [M640, M340].filter(Boolean)) {
            const used = [...block.matchAll(/var\((--erp-[a-z0-9-]+)/g)].map((m) => m[1]);
            expect([...new Set(used)].filter((t) => !defined.has(t))).toEqual([]);
        }
    });
});
