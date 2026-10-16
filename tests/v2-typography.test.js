/**
 * v2-typography.test.js — سِلم الطباعة (البند ١٠)
 *═════════════════════════════════════════════════════════════════════════
 * الخطر هنا لا يظهر في أي مراجعة كود: اسمُ صنفٍ مستخدَمٌ في شاشةٍ ومجهولٌ في
 * CSS يعمل عمل الزينة — لا خطأ، لاconsole صراخ، فقط حجمٌ لا يصغّر أبدًا.
 *
 * القياس الحيّ (خادمٍ ثابتٍ على 127.0.0.1:8099، وضعُ المعاينة، ثلاثُ أسطحٍ
 * حقيقية: لوحة التحكم · جدول المخزن · شاشة الباركود) رجّع 93 عنصرًا يحمل
 * `erp-text-sm`: 89 يرثون 13px من الجذر، و2 عند 11px، و2 عند 14px. نيّةٌ واحدة
 * تُرسل بثلاثة أحجام لأن لا أحد عرّف الاسم قطّ.
 *
 * لذلك يثبّت هذا الملف أربعة أشياء:
 *   ١) لا اسمَ مستخدَمٍ يبقى بلا تعريف (الحارس الذي يمنع عودة الأسماء الميتة).
 *   ٢) أسماءُ الأحجام تشتقّ من `--erp-text-*` وحدها — لا رقمٍ مكتوبٍ باليد.
 *   ٣) كلُ تعريفٍ تحت `.erp-v2` — القديم لا يُلمس من هنا.
 *   ٤) السلّمُ نفسه سليم: سبعُ درجاتٍ متزايدةٌ بصرم، والجذرُ على `base`.
 * لا يُعاد هنا قياسُ الكثافة (is-dense) — ذلك عقدُ v2-ui-system.test.js.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2_DIR = path.join(APP, 'js', 'v2');
const CSS_DIR = path.join(APP, 'css', 'v2');
const read = (p) => fs.readFileSync(p, 'utf8');

const SIZES = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl'];

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** [{sel, body}] لكل قاعدةٍ بسيطة؛ يتخطى @media ويغوص داخلها. */
function cssRules(src) {
    const out = [];
    const walk = (text) => {
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const sel = m[1].trim();
            const body = m[2];
            if (sel.startsWith('@')) {walk(body);} else {out.push({ sel, body });}
        }
    };
    walk(stripCssComments(src));
    return out;
}

function cssFiles(dir) {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
}

function jsFiles(dir) {
    const acc = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {acc.push(...jsFiles(p));} else if (e.name.endsWith('.js')) {acc.push(p);}
    }
    return acc;
}

/**
 * الأسماء المستخدَمة كأصنافٍ فعلية. `--erp-text-sm` اسمُ متغيّرٍ لا صنف،
 * والبادئة '-' هي الفارق — تجاهلها يجعل العدّد يزوّر 707 استخدامٍ وهمي.
 */
function usedClassNames() {
    const found = new Set();
    const srcs = [...jsFiles(V2_DIR), ...fs.readdirSync(APP).filter((f) => f.endsWith('.html')).map((f) => path.join(APP, f))];
    for (const f of srcs) {
        for (const m of read(f).matchAll(/(?:^|[^-\w])erp-text-([a-z0-9]+)/gm)) {
            found.add(m[1]);
        }
    }
    return found;
}

function definedByText() {
    const map = new Map();
    for (const f of cssFiles(CSS_DIR)) {
        for (const r of cssRules(read(path.join(CSS_DIR, f)))) {
            for (const m of r.sel.matchAll(/\.erp-text-([a-z0-9]+)/g)) {
                if (!map.has(m[1])) {map.set(m[1], []);}
                map.get(m[1]).push({ file: f, sel: r.sel, body: r.body.trim() });
            }
        }
    }
    return map;
}

function tokenPx(name) {
    const src = stripCssComments(read(path.join(CSS_DIR, 'erp-tokens.css')));
    const m = src.match(new RegExp(`--erp-text-${name}:\\s*([\\d.]+)px`));
    expect(m).not.toBeNull();
    return Number(m[1]);
}

describe('V2 سِلم الطباعة — لا أصناف ميتة (البند ١٠)', () => {
    test('كلُ اسمِ erp-text-* مستخدَمٌ في js/v2 أو الصفحة له تعريفٌ مقيّد', () => {
        const used = usedClassNames();
        const defined = definedByText();
        // رسالةٌ تُصلح نفسها: الأسماء المكتوبةُ بلا تعريف، لا رقمٌ غامض.
        expect({ deadNames: [...used].filter((n) => !defined.has(n)).sort() }).toEqual({ deadNames: [] });
        expect(used.size).toBeGreaterThan(0);
    });

    test('الأسماء التي أحييتُها هنا باقيةٌ محيَّاة: sm · xs · warning', () => {
        const defined = definedByText();
        expect(['sm', 'xs', 'warning'].filter((n) => !defined.has(n))).toEqual([]);
    });

    test('أحجامُ الأصناف تُشتقّ من --erp-text-* ولا تكتب رقمًا باليد', () => {
        const defined = definedByText();
        const wrong = [];
        for (const name of SIZES) {
            for (const r of defined.get(name) || []) {
                const fsDecl = (r.body.match(/font-size\s*:\s*([^;]+)/) || [])[1];
                if (!fsDecl) {continue;}   // صنفُ لونٍ لا حجم
                if (fsDecl.trim() !== `var(--erp-text-${name})`) {wrong.push(`${r.file}: ${r.sel} → ${fsDecl.trim()}`);}
            }
        }
        expect({ pxWrittenByHand: wrong }).toEqual({ pxWrittenByHand: [] });
    });

    test('لا تسرّبَ للقديم: كلُ صنفِ erp-text-* مقيّدٌ بـ .erp-v2', () => {
        const unscoped = [];
        for (const f of cssFiles(CSS_DIR)) {
            for (const r of cssRules(read(path.join(CSS_DIR, f)))) {
                if (!/\.erp-text-[a-z0-9]/.test(r.sel)) {continue;}
                for (const part of r.sel.split(',')) {
                    if (!part.trim().startsWith('.erp-v2')) {unscoped.push(`${f}: ${part.trim()}`);}
                }
            }
        }
        expect({ unscopedSelectors: unscoped }).toEqual({ unscopedSelectors: [] });
    });

    test('السلّمُ سبعُ درجاتٍ متزايدةٌ بصرمٍ من 11px إلى 26px', () => {
        const px = SIZES.map(tokenPx);
        expect({ scale: px }).toEqual({ scale: [11, 12, 13, 14, 16, 20, 26] });
    });

    test('جذرُ V2 يقعد على --erp-text-base — لا حجمَ مكتوبٍ باليد في الأساس', () => {
        const root = cssRules(read(path.join(CSS_DIR, 'erp-base.css')))
            .find((r) => r.sel === '.erp-v2');
        expect(root).toBeTruthy();
        expect(root.body).toMatch(/font-size:\s*var\(--erp-text-base\)/);
    });

    test('--erp-warning-text موجودٌ في الوضعين — لا صنفَ بلا قيمةٍ داكنة', () => {
        expect(stripCssComments(read(path.join(CSS_DIR, 'erp-tokens.css')))).toMatch(/--erp-warning-text:/);
        expect(stripCssComments(read(path.join(CSS_DIR, 'erp-themes.css')))).toMatch(/--erp-warning-text:/);
    });
});
