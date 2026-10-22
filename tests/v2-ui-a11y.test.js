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
        expect(css).toMatch(/\.erp-v2 p a\s*\{[^}]*text-decoration:\s*underline/);
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
});
