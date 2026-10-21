/**
 * menu-board-light.test.js — عقد النسخة الفاتحة لشاشة المنيو (2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════
 * قرار المالك: ألوان فاتحة + سرعة على شاشات TV الضعيفة. المثبَّت هنا:
 *   • الصفحة تربط menu-board-light.css ولا تربط حزمة النوار (الرجوع = سطر)
 *   • لا عقد زخرفة ثقيلة في HTML: لا orb/noise/specks/lattice/arabesque
 *   • الـ CSS الفاتح: لا filter: blur ولا radial-gradient متحرك — الأداء
 *     قبل الجمال على معالج TV؛ والحركة كلها transform/opacity
 *   • كل صنفٍ يلمسه menu-board.js موجود في الـ CSS الفاتح (لا صنف مكسور)
 *   • عقد الجافاسكربت لم يُلمس: نفس الأصناف، البث والفحص الدوري كما هما
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const LIGHT_CLASSES = [
    'status-bar', 'conn', 'status-brand', 'language-toggle', 'clock-time', 'clock-date',
    'mb-header', 'crest', 'period-strip', 'period', 'period-name', 'period-hours',
    'period-sep', 'gold-rule', 'page', 'empty-note', 'cat-header', 'cat-title', 'cat-en',
    'cat-note', 'now-ribbon', 'nr-dot', 'items-grid', 'item', 'item-top', 'item-bullet',
    'item-thumb', 'item-copy', 'item-name', 'item-en', 'sold-note', 'page-dots', 'dot',
    'mb-footer', 'ticker', 'ticker-star', 'ticker-track', 'ticker-marquee', 'ticker-text',
    'footer-meta', 'foot-brand',
    'buffet-page', 'buffet-panel', 'buffet-section-heading', 'buffet-soup-grid',
    'buffet-main-grid', 'buffet-small-grid', 'buffet-soup-item', 'buffet-main-item',
    'buffet-small-item', 'buffet-number', 'buffet-item-name', 'buffet-item-en',
    'buffet-empty', 'carving-current', 'buffet-note', 'buffet-note-track', 'buffet-note-text',
];

describe('شاشة المنيو — النسخة الفاتحة', () => {
    test('الصفحة تربط الـ CSS الفاتح ولا تربط حزمة النوار', () => {
        const html = read('menu-board.html');
        expect(html).toContain('css/menu-board-light.css?v=1.2.0');
        // لا ربط فعلي لحزمة النوار — ذكرها في تعليق الرجوع مقبول
        expect(html).not.toMatch(/href=["']css\/menu-board-bundle\.css/);
        expect(html).not.toMatch(/href=["']css\/menu-board-islamic\.css/);
        expect(html).not.toMatch(/menu-board\.css/);
        // الرجوع موثّق في تعليق الصفحة نفسها
        expect(html).toContain('menu-board-bundle.css');
    });

    test('لا زخرفة ثقيلة في HTML: لا هالات ولا ضوضاء ولا بريق', () => {
        const html = read('menu-board.html');
        for (const heavy of ['orb-', 'bg-noise', 'bg-lattice', 'bg-arabesque', 'specks',
            'bg-vignette', 'shimmer', 'pulse-aura', 'bg-grid', 'bg-frame']) {
            expect(html).not.toContain(heavy);
        }
    });

    test('الأداء: CSS الفاتح بلا blur ولا تدرجات شعاعية متحركة', () => {
        const css = read('css/menu-board-light.css');
        expect(css).not.toMatch(/filter:\s*blur/);
        expect(css).not.toMatch(/backdrop-filter/);
        // لا keyframes على خصائص غير تركيبية (width/height/margin/…)
        // كل keyframes حركتها تركيبية فقط: transform/opacity/inline-size المحصور
        const bodies = css.split('@keyframes').slice(1).map((b) => b.slice(0, b.indexOf('}}') + 1));
        expect(bodies.length).toBeGreaterThan(0);
        for (const body of bodies) {
            expect(body).not.toMatch(/\b(margin|padding|top|left|right|bottom|block-size)\s*:/);
        }
    });

    test('كل صنف يلمسه menu-board.js معرّف في الـ CSS الفاتح', () => {
        const css = read('css/menu-board-light.css');
        for (const cls of LIGHT_CLASSES) {
            expect(css).toContain('.' + cls);
        }
    });

    test('الثيم الفاتح موحّد مهما كانت بيانات الثيم القديمة (noir يُعرض فاتحاً)', () => {
        const css = read('css/menu-board-light.css');
        // الخلفية الفاتحة على #stage بلا شروط ثيم — والتعليق يوثق القرار
        expect(css).toMatch(/#stage\s*\{[^}]*--mb-bg/);
        expect(css).toContain('فاتح');
    });

    test('حركة مصغّرة محترمة: prefers-reduced-motion يطفئ كل شيء', () => {
        const css = read('css/menu-board-light.css');
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });

    test('سعة الصفحة 10 أصناف (5 صفوف × عمودين) — قرار المالك 2026-10-15', () => {
        const js = read('js/menu-board.js');
        expect(js).toContain('MAX_ITEMS_PER_PAGE = 10');
        expect(js).not.toMatch(/MAX_ITEMS_PER_PAGE = 8/);
        // الشبكة توزّع الصفوف تلقائياً (grid-auto-rows: 1fr) فلا كسر عند 5 صفوف
        const css = read('css/menu-board-light.css');
        expect(css).toMatch(/\.items-grid\s*\{[^}]*grid-auto-rows:\s*1fr/);
    });

    test('الترويسة أكثر إحكامًا وتبدأ شبكة الأصناف أعلى مع مساحة عرض أكبر', () => {
        const css = read('css/menu-board-light.css');
        expect(css).toMatch(/\.status-bar\s*\{[^}]*padding:\s*14px 40px 0/);
        expect(css).toMatch(/\.mihrab-crown\s*\{\s*width:\s*190px/);
        expect(css).toMatch(/\.crest img\s*\{\s*width:\s*210px/);
        expect(css).toMatch(/#pageHost\s*\{[^}]*flex:\s*1 1 auto[^}]*margin:\s*14px 40px 8px/);
        expect(css).toMatch(/\.items-grid\s*\{[^}]*flex:\s*1 1 auto[^}]*grid-auto-rows:\s*1fr/);
    });

    test('عرض ثنائي دائم: عربي + إنجليزي معاً في كل وضع — لا لغة مخفية', () => {
        const js = read('js/menu-board.js');
        // الفترات بالاسمين معاً (الصغير = اللغة الأخرى)
        expect(js).toMatch(/period-names|periodNames\s*=\s*\{[\s\S]*ar:/);
        expect(js).toMatch(/<small dir="(rtl|ltr)"/);
        // الأصناف: الاسم الأساسي + الآخر في السطر الثاني دائماً — لا فراغ في EN
        expect(js).not.toMatch(/secondary\s*=\s*language === 'en'\s*\?\s*''/);
        // سطر الاسم الثانوي يبدّل حسب اللغة (لا فراغ في EN)
        expect(js).toMatch(/class="item-en">\$\{esc\(language === 'en'/);
        // سطر البوفيه باللغتين دائماً
        expect(js).toMatch(/بوفيه مفتوح · OPEN BUFFET/);
        expect(js).toMatch(/ريال \/ SAR per person/);
        // شريط الخبر الافتراضي باللغتين
        expect(js).toMatch(/الأسعار شاملة الضريبة · Prices include tax/);
        // والـ CSS ينسّق الاسم الثانوي
        const css = read('css/menu-board-light.css');
        expect(css).toMatch(/\.period-name small\s*\{/);
    });

    test('الطابع الإسلامي: قبة تحتضن الشعار + محاريب + نقشة نجمة ثابتة + رواق أقواس', () => {
        const html = read('menu-board.html');
        const css = read('css/menu-board-light.css');
        // القبة SVG ثابتة فوق الشعار (هلال + قبة + قاعدة)
        expect(html).toContain('mihrab-crown');
        expect(html).toMatch(/<svg class="mihrab-crown"/);
        // القوس الحاوي للشعار + المحراب الصغير في كل بطاقة + الرواق
        expect(css).toContain('.mihrab ');
        expect(css).toMatch(/\.item::before/);
        expect(css).toMatch(/\.arcade\s*\{/);
        // النقشة ثابتة (لا animation عليها) وتُرسم مرة واحدة
        expect(css).toMatch(/background-size:\s*140px 140px/);
    });

    test('الطابع الإسلامي لا يكسر الأداء: صفر فلاتر وكل الزخرفة SVG ثابتة', () => {
        const css = read('css/menu-board-light.css');
        expect(css).not.toMatch(/filter:\s*blur/);
        expect(css).not.toMatch(/backdrop-filter/);
        // لا صور نقطية — كل الزخرفة SVG مضمّنة (بايتات لا طلبات)
        expect(css).not.toMatch(/url\(["']?[^)"']*\.(png|jpe?g|webp)/);
    });
});
