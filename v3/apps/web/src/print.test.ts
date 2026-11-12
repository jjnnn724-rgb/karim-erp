import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس الطباعة المشتركة — يقرأ `print.css` و`main.tsx` نصًّا، ولا يفتح
 * شبكة ولا متصفحًا (Vitest يعمل هنا في بيئة node).
 *
 * الحارس يثبّت عقد V2 الذي نُقل:
 *   • صفحة A4 رأسية بهوامش 14mm/12mm واتجاه RTL.
 *   • إخفاء القشرة وأدوات الشاشة بلا إخفاء أي جدول/صف/خلية بيانات.
 *   • `table-header-group` لرأس الجدول و`break-inside: avoid` للصفوف.
 *   • لا أصول خارجية ولا `@import` — الطبع بلا شبكة.
 *   • `print.css` مستورد فعلًا في `main.tsx` بعد `styles.css`.
 *
 * `dirname(fileURLToPath(import.meta.url))` لا `new URL('.', import.meta.url)`:
 * الأخيرة يعيدها Vite عنوان أصلٍ فيفقد مخطّط `file:` (نفس عقد `rtl.test.ts`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'print.css'), 'utf8');
const MAIN = readFileSync(join(HERE, 'main.tsx'), 'utf8');

/** كل قاعدة في الملف — المحدِّد والجسم — بلا تعليقات. */
function allBlocks(): { selector: string; body: string }[] {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks: { selector: string; body: string }[] = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match = rule.exec(withoutComments);
    while (match) {
        blocks.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
        match = rule.exec(withoutComments);
    }
    return blocks;
}

function blocksMatching(selectorPattern: RegExp): { selector: string; body: string }[] {
    return allBlocks().filter((block) => selectorPattern.test(block.selector));
}

describe('print.css — تنسيق الطباعة المشترك', () => {
    it('مستورد في main.tsx بعد styles.css', () => {
        expect(MAIN).toContain("import './print.css';");
        expect(MAIN.indexOf("import './print.css';")).toBeGreaterThan(MAIN.indexOf("import './styles.css';"));
    });

    it('صفحة A4 رأسية واتجاه RTL وخط الواجهة', () => {
        expect(CSS).toMatch(/@page\s*\{[^}]*size:\s*A4\s+portrait/s);
        expect(CSS).not.toMatch(/size:\s*A4\s+landscape/);
        expect(CSS).toMatch(/@page\s*\{[^}]*margin:\s*14mm\s+12mm/s);
        expect(CSS).toMatch(/direction:\s*rtl/);
        expect(CSS).toMatch(/font-family:\s*"Tajawal"/);
    });

    it('يخفي القشرة وأدوات الشاشة المعلنة', () => {
        for (const selector of [
            '.erp-shell__sidebar',
            '.erp-shell__header',
            '.erp-shell__mobile-nav',
            '.erp-shell__drawer',
            '.erp-shell__backdrop',
            '.erp-print-action',
            '[data-erp-print-hide]',
        ]) {
            expect(CSS).toContain(selector);
        }
        const hidden = allBlocks().filter((block) => /display:\s*none/.test(block.body));
        expect(hidden.length).toBeGreaterThan(0);
        for (const block of hidden) {
            expect(block.selector).not.toMatch(/(^|,)\s*(table|thead|tbody|tfoot|tr|th|td)\s*(,|$)/);
        }
    });

    it('لا يخفي بيانات الجدول — يكرر رأسها ويمنع انقسام الصفوف', () => {
        const tableBlocks = blocksMatching(/(^|[\s,>])(table|thead|tbody|tfoot|tr|th|td)([\s,{:]|$)/);
        expect(tableBlocks.length).toBeGreaterThan(0);
        for (const block of tableBlocks) {
            expect(block.body).not.toMatch(/display:\s*none/);
        }
        expect(CSS).toMatch(/thead\s*\{[^}]*display:\s*table-header-group/s);
        expect(CSS).toMatch(/tfoot\s*\{[^}]*display:\s*table-footer-group/s);
        expect(CSS).toMatch(/tr,\s*th,\s*td\s*\{[^}]*break-inside:\s*avoid/s);
        expect(CSS).toMatch(/tr,\s*th,\s*td\s*\{[^}]*page-break-inside:\s*avoid/s);
    });

    it('يفكّ حصر التمرير ولا يقطع الجدول داخل بطاقته', () => {
        expect(CSS).toMatch(/\.erp-table__scroll[^}]*\{[^}]*overflow:\s*visible/s);
    });

    it('بلا شبكة أو أصول خارجية أو مكتبات', () => {
        expect(CSS).not.toMatch(/https?:\/\//);
        expect(CSS).not.toMatch(/@import/);
        expect(CSS).not.toMatch(/url\(/);
    });
});

/**
 * هوية المستند الطباعي — منقولة من `css/print-doc.css` عبر
 * `core/print-system.js`: ترويسة العلامة، تذييل واحد، ورأس جدول كحلي.
 * الحارس يمنع تراجع أي قاعدة منها؛ الترويسة نفسها مكوّن (`PrintBrand`).
 */
describe('print.css — هوية المستند المنقولة من V2', () => {
    it('الترويسة والتذييل مخفيان على الشاشة وظاهران في الطباعة فقط', () => {
        expect(CSS).toMatch(/\.erp-print-brand,[\s\S]{0,40}?\.erp-print-runner\s*\{[^}]*display:\s*none/s);
        expect(CSS).toMatch(/\.erp-print-brand\s*\{[^}]*display:\s*flex/s);
        expect(CSS).toMatch(/\.erp-print-runner\s*\{[^}]*display:\s*flex/s);
    });

    it('ترويسة العلامة: شعار + اسم + سطر إنجليزي بخط تركوازي', () => {
        expect(CSS).toMatch(/\.erp-print-brand__logo\s*\{[^}]*inline-size:\s*16mm/s);
        expect(CSS).toMatch(/\.erp-print-brand__name\s*\{[^}]*color:\s*#102a43/s);
        expect(CSS).toMatch(/\.erp-print-brand__name\s*\{[^}]*font-size:\s*15pt/s);
        expect(CSS).toMatch(/\.erp-print-brand__en\s*\{[^}]*letter-spacing:\s*0\.14em/s);
        expect(CSS).toMatch(/border-bottom:\s*2\.5pt\s+solid\s+#0f766e/);
    });

    it('تذييل واحد ثابت في آخر المستند لا مكرر لكل صفحة', () => {
        const runner = blocksMatching(/\.erp-print-runner\s*,?\s*$/).find((block) => /justify-content:\s*space-between/.test(block.body));
        expect(runner).toBeDefined();
        expect(runner?.body).toMatch(/position:\s*static/);
        expect(runner?.body).toMatch(/break-inside:\s*avoid/);
    });

    it('جدول المستند: رأس كحلي متكرر، حدود تركوازية، وتظليل صفوف', () => {
        expect(CSS).toMatch(/th\s*\{[^}]*background:\s*#102a43/s);
        expect(CSS).toMatch(/th\s*\{[^}]*color:\s*#f0f6fa/s);
        expect(CSS).toMatch(/tbody tr:nth-child\(even\)\s*>\s*td\s*\{[^}]*background:\s*#f3f6fa/s);
        expect(CSS).toMatch(/border:\s*1px\s+solid\s+#dce5ec\s*!important/);
    });
});
