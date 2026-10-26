/**
 * v2-focus-trap.test.js — حراسة حبس التركيز في كل طبقةٍ تعلن aria-modal.
 * الطبقة التي تعلنها وتترك Tab يمرّ إلى الصفحة خلفها تَعِد قارئ الشاشة بما
 * لا يقع. هذه الحراسة تمنع عودة العيب إلى أي من مواضعها الخمسة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

describe('V2 focus trap', () => {
    test('الدالة تحبس الطرفين وتعيد التركيز الهارب', () => {
        const src = read('js/v2/focus-trap.js');
        expect(src).toContain('export function trapFocus(root)');
        // التركيز داخل اللوحة: الأول يعود من الأخير، والعكس بالخلف.
        expect(src).toMatch(/e\.shiftKey && active === first\) \{e\.preventDefault\(\); last\.focus\(\);/);
        expect(src).toMatch(/!e\.shiftKey && active === last\) \{e\.preventDefault\(\); first\.focus\(\);/);
        // التركيز هرب خارج اللوحة: يُسحب إلى طرفها المناسب.
        expect(src).toMatch(/if \(!root\.contains\(active\)\) \{/);
        // لوحة بلا عناصر مرئية لا تُسرّب Tab إلى الخلف.
        expect(src).toMatch(/if \(!list\.length\) \{e\.preventDefault\(\); return;\}/);
        // تُفكّ بالدالة المُعادة — لا مستمع دائم.
        expect(src).toMatch(/return \(\) => document\.removeEventListener\('keydown', onKey, true\);/);
    });

    const SITES = [
        { file: 'js/v2/screens/cash-register.js', panel: /class="cashreg__panel"[^>]*tabindex="-1"/, close: 'function closePanel() {' },
        { file: 'js/v2/screens/cashier-sales.js', panel: /class="csales__panel"[^>]*tabindex="-1"/, close: 'function hidePanels() {' },
        { file: 'js/v2/screens/monthly-comparison.js', panel: null, close: 'function closePanel() {' },
        { file: 'js/v2/report-viewer.js', panel: null, close: 'export function closeReportViewer() {' },
    ];

    for (const site of SITES) {
        test(`${site.file}: يركّب الحبس ويفكّه عند الإغلاق`, () => {
            const src = read(site.file);
            expect(src).toMatch(/from '\.\.?\/(?:screens\/)?focus-trap\.js\?v=/);
            expect(src).toContain('trapFocus(');
            expect(src).toMatch(/releaseTrap\?\.\(\);/);
            const start = src.indexOf(site.close);
            expect(start).toBeGreaterThan(-1);
            const body = src.slice(start, src.indexOf('\n    }', start));
            expect(body).toContain('releaseTrap');
            if (site.panel) {expect(src).toMatch(site.panel);}
        });
    }

    test('لوحة مقارنة الشهور لا تُبقي حبسًا مكتوبًا يدويًا مكرَّرًا', () => {
        const src = read('js/v2/screens/monthly-comparison.js');
        expect(src).not.toMatch(/const focusables = \[\.\.\.panel\.querySelectorAll/);
        expect(src).toMatch(/releaseTrap = trapFocus\(panel\);/);
    });

    test('حوارات الجسم: كل الفواتير والكاميرا والمساعد والعارض', () => {
        expect(read('js/v2/screens/briefing.js')).toMatch(/layer\.tabIndex = -1;[\s\S]*?trapFocus\(layer\)/);
        expect(read('js/v2/portal-face.js')).toMatch(/host\.tabIndex = -1;[\s\S]*?const releaseTrap = trapFocus\(host\);/);
        expect(read('js/v2/ai-assistant.js')).toMatch(/releaseTrap = trapFocus\(drawer\);/);
        expect(read('js/v2/report-viewer.js')).toMatch(/releaseTrap = trapFocus\(host\);/);
        // لا أيقونات نصّية بدل أيقونة السهم: ✕ و&times; ممنوعتان في أزرار V2.
        expect(read('js/v2/portal-face.js')).not.toContain('>✕</button>');
        expect(read('js/v2/screens/briefing.js')).not.toContain('&times;</button>');
    });
});
