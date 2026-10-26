/**
 * v2-colors.test.js — توطين الألوان (البند ١١)
 *═════════════════════════════════════════════════════════════════════════
 * الخطر الذي لا تراه أي مراجعة: حدٌّ لونيٌّ مباشرٌ في سطر Presentation لا يكسر
 * اختبارًا ولا يصرخ في الconsole — فقط يتجمّد. والنتيجة المقيسة حيًّا (خادمٌ
 * ثابتٌ على 127.0.0.1:8099، ثيمٌ فاتحٌ وداكن، قبل هذا البند وبعده):
 *   · الـFAB: `background: var(--erp-brand-text)` على عنصرٍ ملحقٍ بdocument.body
 *     خارج `.erp-v2` → القيمة لا تُحلّ → rgba(0,0,0,0) وحرفٌ أبيض فوق #f4f5f7
 *     (نسبةٌ ≈1.0) وأربعُ كبسولاتٍ بلا خلفيةٍ ولا حدّ، والـhost نفسه static في
 *     قاع المستند (y≈2767). أي: ميزةُ الإجراءات السريعة غير ظاهرةٍ إطلاقًا.
 *   · scrim لوحة الأوامر `rgba(16,24,40,.5)` في الداكن: تعتيمٌ بنسبة 1.03
 *     وافرْقٍ 2 من 255 — أي لا تعتيم إطلاقًا.
 *   · شريطُ عدم الاتصال `#b91c1c`: احمرارٌ خارج اللوحة (البديل `#b42318`).
 *
 * لذلك يثبّت هذا الملف خمسة أشياء:
 *   ١) لا حرفيةَ لونيةِ استخدامٍ تبقى في css/v2 خارج قائمةِ استثناءٍ صريحة.
 *   ٢) طبقةُ التوكنز معلَنةٌ على طبقات الـbody الثلاثة — بغير ذلك يرتدّ الـFAB
 *      شفافًا ولا يفصح عن ذلك أيُّ اختبارٍ آخر ولا أيُّ شاشة.
 *   ٣) الـscrim متغيّرٌ واحد، فاتحُهُ = قيمةُ الدرج القديمة حرفيًا (no-op).
 *   ٤) حبرُ الأسطح المصمتة (FAB · شريط الأوفلاين) من `--erp-text-inverse`.
 *   ٥) لا تسرّب: أسماءُ طبقات الـbody لا تظهر في أي CSSٍ قديم خارج css/v2.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const CSS_LEGACY_DIR = path.join(APP, 'css');
const read = (p) => fs.readFileSync(p, 'utf8');

/* الاستثناءات المشروعة — كلُّ واحدٍ منها موثَّقٌ في ملفه نفسه:
   erp-board.css   : لوحة `--kb-*` الفنية الخاصة (بورد المنيو، له ثيم noir مستقل).
   erp-preview.css : كروم المعاينة فقط، مقصودٌ أن يبقى ثابت الداكنة لا يتبع الثيم.
   @media print    : الطباعة تريد حبرًا محدَّدًا، لا ثيمًا.  */
const EXEMPT_FILES = ['erp-board.css', 'erp-preview.css'];

const LITERALS = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** [{sel, body, at[]}] لكل قاعدة، غائصًا داخل @media بمطابقة الأقواس. */
function rules(src) {
    const text = stripComments(src);
    const out = [];
    const walk = (chunk, atChain) => {
        let i = 0;
        while (i < chunk.length) {
            const brace = chunk.indexOf('{', i);
            if (brace < 0) {return;}
            const head = chunk.slice(i, brace).trim().replace(/\s+/g, ' ');
            let depth = 1;
            let j = brace + 1;
            while (j < chunk.length && depth > 0) {
                if (chunk[j] === '{') {depth += 1;} else if (chunk[j] === '}') {depth -= 1; if (depth === 0) {break;}}
                j += 1;
            }
            const body = chunk.slice(brace + 1, j);
            if (head.startsWith('@')) {walk(body, atChain.concat(head));} else {out.push({ sel: head, body, at: atChain });}
            i = j + 1;
        }
    };
    walk(text, []);
    return out;
}

function colorHits(value) {
    const hits = [];
    LITERALS.lastIndex = 0;
    let m;
    while ((m = LITERALS.exec(value)) !== null) {
        hits.push({ lit: m[1], head: value.slice(0, m.index) });
        if (m.index === LITERALS.lastIndex) {LITERALS.lastIndex += 1;}
    }
    return hits;
}

/** حرفياتُ الاستخدام المباشر: لا تعريف متغيّر، لا بديل var()، لا طباعة، لا استثناء. */
function directUsages() {
    const offenders = [];
    for (const f of fs.readdirSync(CSS_V2).filter((n) => n.endsWith('.css')).sort()) {
        if (EXEMPT_FILES.includes(f)) {continue;}
        for (const r of rules(read(path.join(CSS_V2, f)))) {
            if (r.at.some((a) => /print/i.test(a))) {continue;}
            for (const decl of r.body.split(';')) {
                const d = decl.trim();
                const idx = d.indexOf(':');
                if (!d || idx < 0) {continue;}
                const prop = d.slice(0, idx).trim();
                const value = d.slice(idx + 1);
                if (prop.startsWith('--')) {continue;}                    // تعريف توكن — مكانه الصحيح
                for (const h of colorHits(value)) {
                    if (/var\([^()]*,[^()]*$/.test(h.head)) {continue;}    // بديل var() — مقصود
                    offenders.push(`${f} · ${r.sel.replace(/\s+/g, ' ')} · ${prop}: ${h.lit}`);
                }
            }
        }
    }
    return offenders;
}

const bodyRule = (file, re) => {
    for (const r of rules(read(path.join(CSS_V2, file)))) {
        const m = r.sel.match(re);
        if (m) {return r;}
    }
    return null;
};

describe('البند ١١ — توطين الألوان في V2', () => {
    test('لا حرفيةَ لونيةِ استخدامٍ مباشرة تبقى في css/v2 خارج الاستثناءات', () => {
        const offenders = directUsages();
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('قائمةُ الاستثناء صريحةٌ ولا تتضخّم سرًّا', () => {
        // أي ملفٍ يُضاف إلى الاستثناء يجب أن يكون قرارًا مكتوبًا لا زحفًا.
        expect({ exempt: EXEMPT_FILES.slice().sort() }).toEqual({ exempt: ['erp-board.css', 'erp-preview.css'].sort() });
        expect(read(path.join(CSS_V2, 'erp-board.css'))).toMatch(/--kb-paper:/);
        expect(read(path.join(CSS_V2, 'erp-preview.css'))).toMatch(/\.erp-preview-banner/);
    });

    test('طبقةُ التوكنز معلَنةٌ على طبقات الـbody (وإلا ارتدّ الـFAB شفافًا)', () => {
        const tokens = stripComments(read(path.join(CSS_V2, 'erp-tokens.css')));
        const themes = stripComments(read(path.join(CSS_V2, 'erp-themes.css')));
        const HOSTS = ['.erp-fab-host', '.erp-offline-bar', '.erp-pal-backdrop'];
        const lightBlock = tokens.match(/([^{}]+)\{[^}]*--erp-text-inverse:/);
        expect(lightBlock).toBeTruthy();
        const darkBlock = themes.match(/([^{}]+)\{[^}]*--erp-text-inverse:/);
        expect(darkBlock).toBeTruthy();
        const missing = [];
        for (const h of HOSTS) {
            if (!lightBlock[1].includes(h)) {missing.push(`light ${h}`);}
            if (!darkBlock[1].includes(`[data-theme="dark"] ${h}`)) {missing.push(`dark ${h}`);}
        }
        expect({ missing }).toEqual({ missing: [] });
    });

    test('الـFAB: حشوٌ من اللوحة وحبرٌ معاكس، وموضعُه ثابتٌ بحدٍّ نفسه', () => {
        const fab = bodyRule('erp-components.css', /^\.erp-fab-host \.erp-fab$/);
        expect(fab).toBeTruthy();
        expect(fab.body).toMatch(/background:\s*var\(--erp-brand-text\)/);
        expect(fab.body).toMatch(/color:\s*var\(--erp-text-inverse\)/);
        const host = bodyRule('erp-components.css', /^\.erp-fab-host$/);
        expect(host).toBeTruthy();
        expect(host.body).toMatch(/position:\s*fixed/);
    });

    test('شريطُ عدم الاتصال على احمرار اللوحة، لا على #b91c1c ولا على حبرٍ أبيض', () => {
        const bar = bodyRule('erp-components.css', /^\.erp-offline-bar$/);
        expect(bar).toBeTruthy();
        expect(bar.body).toMatch(/background:\s*var\(--erp-danger\)/);
        expect(bar.body).toMatch(/color:\s*var\(--erp-text-inverse\)/);
    });

    test('--erp-scrim متغيّرٌ واحد، فاتحُهُ = قيمةُ الدرج القديمة حرفيًا', () => {
        expect(read(path.join(CSS_V2, 'erp-tokens.css'))).toMatch(/--erp-scrim:\s*rgba\(0, 0, 0, \.45\);/);
        expect(read(path.join(CSS_V2, 'erp-themes.css'))).toMatch(/--erp-scrim:\s*rgba\(0, 0, 0, \.6\);/);
        const drawer = bodyRule('erp-shell.css', /^\.erp-shell__scrim$/);
        expect(drawer).toBeTruthy();
        expect(drawer.body).toMatch(/background:\s*var\(--erp-scrim\)/);
        const pal = bodyRule('erp-dashboard.css', /^\.erp-pal-backdrop$/);
        expect(pal).toBeTruthy();
        expect(pal.body).toMatch(/background:\s*var\(--erp-scrim\)/);
    });

    test('قائمةُ الـFAB تسمع لـ[hidden] — لا كبسولاتٍ ظاهرةً والمِزلاجُ مغلق', () => {
        /* عارضٌ جانبي لإظهار الـFAB: وهو قائمٌ في الكود منذ كُتب، لكن العنصر
           كان شفافًا في قاع المستند فلم يره أحد. */
        const src = stripComments(read(path.join(CSS_V2, 'erp-components.css')));
        const open = /\.erp-fab-host \.erp-fab-menu \{[^}]*display:\s*flex/.test(src);
        const closed = /\.erp-fab-host \.erp-fab-menu\[hidden\] \{[^}]*display:\s*none/.test(src);
        expect({ open, closed }).toEqual({ open: true, closed: true });
    });

    test('لا تسرّبَ للقديم: أسماءُ طبقات الـbody لا تظهر خارج css/v2', () => {
        const leaked = [];
        for (const f of fs.readdirSync(CSS_LEGACY_DIR).filter((n) => n.endsWith('.css'))) {
            if (/erp-fab|erp-offline-bar|erp-pal-backdrop|erp-shell__scrim/.test(read(path.join(CSS_LEGACY_DIR, f)))) {leaked.push(f);}
        }
        expect({ leaked }).toEqual({ leaked: [] });
    });

    test('الحرفياتُ المُحوَّلة لا تعود نصفَ عودة: لا #b91c1c في الملف الخمسة', () => {
        const touched = ['erp-tokens.css', 'erp-themes.css', 'erp-components.css', 'erp-shell.css', 'erp-dashboard.css'];
        const back = touched.filter((f) => /#b91c1c/.test(stripComments(read(path.join(CSS_V2, f)))));
        expect({ back }).toEqual({ back: [] });
    });
});
