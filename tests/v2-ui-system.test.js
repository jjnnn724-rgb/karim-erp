/**
 * v2-ui-system.test.js — عقد طبقتي الكثافة والحركة (UI system layer)
 * ═══════════════════════════════════════════════════════════════════════
 * طبقتا erp-density.css وerp-motion.css إضافتان على نظام التصميم، والعقد
 * نفسه هو ما يُثبَّت هنا مصدرِيًا (بيئة node — لا متصفح):
 *
 *   1. الصفحة تربط الملفين بنفس نسخة صفحة المعاينة الواحدة (عقد ?v=).
 *   2. الكثافة opt-in حصرا: لا قاعدة خارج .erp-v2.is-dense — حذف الملف
 *      أو الصنف يعيد المريح، ولا شيء آخر يتحرك.
 *   3. حجم الخط لا ينكمش في الكثافة المضغوطة (القراءة ليست تفصيلاً).
 *   4. الحركة بلا استثناء داخل حارس prefers-reduced-motion: no-preference.
 *   5. density.js لا شبكة عليه (لا fetch/XHR) — تفضيل عرض محلي فقط.
 *   6. app-layout يستورد mountDensityControl ويستضيف slot له، ويُنظّفه في
 *      destroy — نفس عقد متحكم الثيم.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const CSS = path.join(APP, 'css', 'v2');

const read = (p) => fs.readFileSync(p, 'utf8');

/** CSS بلا تعليقات — حتى لا يُلَتقط سطر تعليق كأنه مُحدِّد. */
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** مُحدِّدات ملف CSS stripped — أسطر تبدأ بـ . أو @ فقط حتى \{. */
function cssSelectors(css) {
    return [...css.matchAll(/^[ \t]*([.][^{@]*)\{/gm)].map((m) => m[1].trim());
}

function pageRevision() {
    const html = read(path.join(APP, 'v2.html'));
    const m = html.match(/js\/v2\/preview\.js\?v=([\d.]+)/);
    expect(m).not.toBeNull();
    return m[1];
}

describe('v2 UI system layer — density + motion', () => {
    test('الصفحة تربط erp-density.css وerp-motion.css على نفس نسخة preview.js', () => {
        const rev = pageRevision();
        const html = read(path.join(APP, 'v2.html'));
        expect(html).toContain(`css/v2/erp-density.css?v=${rev}`);
        expect(html).toContain(`css/v2/erp-motion.css?v=${rev}`);
    });

    test('الكثافة opt-in: كل مُحدِّد يختص في .erp-v2 — لا قاعدة عالمية', () => {
        const css = stripCssComments(read(path.join(CSS, 'erp-density.css')));
        const selectors = cssSelectors(css);
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            expect(sel.startsWith('.erp-v2')).toBe(true);
        }
    });

    test('الكتل المضغوطة لا تُنقص أحجام الخط (القراءة عقد)', () => {
        const css = stripCssComments(read(path.join(CSS, 'erp-density.css')));
        const denseBlocks = css.split('.erp-v2.is-dense').slice(1);
        expect(denseBlocks.length).toBeGreaterThan(0);
        for (const block of denseBlocks) {
            const body = block.slice(0, block.indexOf('}'));
            expect(body).not.toMatch(/--erp-text-(xs|sm|base|md|lg|xl|2xl)\s*:/);
            expect(body).not.toMatch(/font-size\s*:/);
        }
    });

    test('الحركة كلها داخل حارس prefers-reduced-motion: no-preference', () => {
        const stripped = stripCssComments(read(path.join(CSS, 'erp-motion.css'))).trim();
        // الملف كله = الحارس الواحد من أول سطر إلى آخره.
        expect(stripped.startsWith('@media (prefers-reduced-motion: no-preference)')).toBe(true);
        expect([...stripped.matchAll(/@media/g)].length).toBe(1);
        // كل المُحدِّدات داخل الملف مُختصة بـ .erp-v2.
        const selectors = cssSelectors(stripped);
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            expect(sel.startsWith('.erp-v2')).toBe(true);
        }
    });

    test('density.js تفضيل عرض محلي — صفر شبكة، والخيارات cozy/dense فقط', () => {
        const src = read(path.join(V2, 'density.js'));
        expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/);
        expect(src).toContain("'cozy'");
        expect(src).toContain("'dense'");
        expect(src).toContain('export function mountDensityControl');
        expect(src).toContain('export function applyDensity');
    });

    test('رأس القشرة لا يتجاوز العرض على الموبايل — صف قابل للانكماش بلا تمرير أفقي', () => {
        const shell = read(path.join(CSS, 'erp-shell.css'));
        // داخل كتلة 640: لا تمرير أفقي — الصف ينكمش ولا يدفع المستند
        const block640 = shell.split('@media (max-width: 640px)').slice(1).join('');
        expect(block640).toContain('.erp-shell__actions');
        // العقد الجديد: صف الإجراءات صار قابلًا للانكماش (flex-shrink: 1 +
        // min-width: 0) بدل التمرير الأفقي (overflow-x/scrollbar-width) —
        // فالتحكم الثانوي انتقل إلى مركز التحكم والصف لا يدفع المستند جانبًا.
        expect(shell).toMatch(/\.erp-shell__actions\s*\{[^}]*flex-shrink:\s*1/);
        expect(shell).toMatch(/\.erp-shell__actions\s*\{[^}]*min-width:\s*0/);
    });

    test('app-layout يستضيف الكثافة ويحررها في destroy — مثل الثيم', () => {
        const src = read(path.join(V2, 'layout', 'app-layout.js'));
        const rev = pageRevision();
        expect(src).toContain(`import { mountDensityControl } from '../density.js?v=${rev}'`);
        expect(src).toContain('data-erp-density-slot');
        expect(src).toContain('mountDensityControl(el.densitySlot, root)');
        expect(src).toContain('state.densityControl?.destroy?.()');
    });
});
