/**
 * v2-zindex.test.js — الطبقات (البند ١٢)
 *═════════════════════════════════════════════════════════════════════════
 * `z-index: 9999` لا يفشل في أي اختبار: فقط يجعل عنصرًا واحدًا يسبح فوق كل
 * شيءٍ إلى الأبد — فوق المودال المفتوح وفوق الدرج وفوق الطبقات التي لم تُكتب
 * بعد. والأخطرُ أنه ضجينةُ الصنفِ الذي قاسه البند ١١: رقمٌ خارج المقياس لا
 * يصرخ، بل يغطّي.
 *
 * القياس الحيّ (خادمٌ ساكنٌ على 127.0.0.1:8099، مستند v2.html نفسه):
 *   · الـFAB على --erp-z-* رقمٌ يدوي 60، و`#erp-v2-root` measured static/auto
 *     — أي لا سياق طبقيَّ له — فالمنافسُ الحقيقيُّ هو الشريطُ الجانبيُّ اللزج
 *     (sticky، معتم، 248px، على حافة inline-start نفسها التي يقف عليها الـFAB).
 *     في نموذجٍ طبقَ القيمَ حرفيًا: نقطةُ center للزرّ رجعت `fixture-side`
 *     عند 60 و`fixture-fab` عند 200. أي أن الزرَّ غيرُ قابلٍ للنقر عند كل
 *     عرضٍ فوق نقطة 1024 (تحتَها الشريطُ درجٌ off-canvas فلا تداخل).
 *   · لوحةُ الإشعارات (60) داخل سياق الهيدر (100) — لا تُقارن بالعالم الخارجي،
 *     فنقلُها إلى --erp-z-dropdown محايدٌ بحتٌ ويُبقي المقياسَ وحده مصدرًا.
 *   · شريطُ عدم الاتصال 9999 كان يرسم فوق المودال (900) وطبقةِ الـtoast.
 *
 * لذلك يثبّت هذا الملف:
 *   ١) لا رقمَ z-indexٍ خارج `--erp-z-*` في css/v2، عدا قائمةِ استثناءٍ مغلقة.
 *   ٢) المقياسُ رتيبٌ متزايدٌ بلا تكرار، وكلُّ اسمٍ مستخدَمٍ فيه موجودٌ فعلًا
 *      (اسمٌ مكتوبٌ غلطًا = auto صامتٌ، وهو الخطرُ نفسه من البند ١١)، ولا
 *      بديلَ رقميٍّ خلف `var(--erp-z-…)` — التراجعُ مقياسٌ ثانٍ يرسم بعد أي
 *      إعادة تسميةٍ دون أن يشتكي أحد.
 *   ٣) طبقةُ الـFAB بين اللزج والدرج — أي فوق الشريط الجانبي وتحت المفتوح.
 *   ٤) طبقاتُ الـbody الحاملةِ لـ --erp-z- معلَنةٌ في قائمة التوكنز، وإلا صار
 *      الرقْمُ auto.
 *   ٥) لا 9999 ولا تسرّبَ للمقياس خارج css/v2.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const CSS_LEGACY_DIR = path.join(APP, 'css');
const read = (p) => fs.readFileSync(p, 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* الاستثناءات مغلقةٌ بالملف والمحدِّد والقيمة — لا بقائمةِ ملفاتٍ عامة.
   · .erp-pipe__dot          رفعٌ محليٌّ (نقطةُ مسارٍ فوق خطَّها) داخل سياقٍ
                             طبقيٍّ واحد؛ لا مكانُها في مقياسٍ عالمي.
   · .erp-pop                القاعدةُ لا تُطابَق: js/v2/layout/shell-extras.js:255
                             يُلحِّف الغلافَ بdocument.body، فـ`.erp-v2 .erp-pop`
                             ميّتةٌ وكلُ قيمها—including 70 — غيرُ حيّة. إصلاحُ
                             التركيب سطرٌ JS في ملفٍ عليه شغلٌ جارٍ لغيري: بندٌ مستقل.
   · .erp-preview-banner     كروم v2.html خارج `#erp-v2-root`، فلا تُحلُّ أسماءُ
                             المقياس عنده؛ يتغيّر إلى متغيّرٍ محليّ. */
const EXCEPTIONS = [
    { file: 'erp-dashboard.css', sel: '.erp-v2 .erp-pipe__dot', value: '1' },
    { file: 'erp-components.css', sel: '.erp-v2 .erp-pop', value: '70' },
    { file: 'erp-preview.css', sel: '.erp-preview-banner', value: 'var(--v2-preview-z-banner)' },
];

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

function cssFiles() {
    return fs.readdirSync(CSS_V2).filter((f) => f.endsWith('.css')).sort();
}

const isException = (file, sel, value) => EXCEPTIONS.some((e) => e.file === file && e.sel === sel && e.value === value);

/** كل declarations z-index في css/v2: [{file, sel, value, ok}] */
function zDecls() {
    const rows = [];
    for (const f of cssFiles()) {
        for (const r of rules(read(path.join(CSS_V2, f)))) {
            for (const decl of r.body.split(';')) {
                const d = decl.trim();
                const idx = d.indexOf(':');
                if (!d || idx < 0) {continue;}
                const prop = d.slice(0, idx).trim();
                const value = d.slice(idx + 1).trim().replace(/\s+/g, ' ');
                if (prop !== 'z-index') {continue;}
                const scaled = /^var\(--erp-z-[a-z0-9]+\)$/.test(value) || /^calc\(\s*var\(--erp-z-[a-z0-9]+/.test(value);
                rows.push({ file: f, sel: r.sel.replace(/\s+/g, ' '), value, ok: scaled || isException(f, r.sel.replace(/\s+/g, ' '), value) });
            }
        }
    }
    return rows;
}

/** مقياس erp-tokens.css: [{name, value}] بترتيب الإعلان. */
function scale() {
    const src = stripComments(read(path.join(CSS_V2, 'erp-tokens.css')));
    const out = [];
    const re = /--erp-z-([a-z0-9]+):\s*(-?\d+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {out.push({ name: m[1], value: Number(m[2]) });}
    return out;
}

const valueOf = (name) => {
    const hit = scale().find((s) => s.name === name);
    return hit ? hit.value : null;
};

const ruleBody = (file, sel) => {
    const hit = rules(read(path.join(CSS_V2, file))).find((r) => r.sel.replace(/\s+/g, ' ') === sel);
    return hit ? hit.body : '';
};

describe('البند ١٢ — مقياس الطبقات في V2', () => {
    test('لا رقمَ z-indexٍ خارج المقياس في css/v2', () => {
        const offenders = zDecls().filter((r) => !r.ok).map((r) => `${r.file} · ${r.sel} · z-index: ${r.value}`);
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('قائمةُ الاستثناء مغلقةٌ ولا تُنتَسَح سرًّا', () => {
        expect({ exempt: EXCEPTIONS.map((e) => `${e.file}|${e.sel}|${e.value}`).sort() }).toEqual({
            exempt: [
                'erp-components.css|.erp-v2 .erp-pop|70',
                'erp-dashboard.css|.erp-v2 .erp-pipe__dot|1',
                'erp-preview.css|.erp-preview-banner|var(--v2-preview-z-banner)',
            ].sort(),
        });
        // استثناءٌ لا يعود موجودًا = مكانٌ vacant يُخفي فيه رقمٌ جديدًا لاحقًا.
        const alive = EXCEPTIONS.map((e) => `${e.file}|${e.sel}|${e.value}`).filter((key) => {
            const [file, sel] = key.split('|');
            return ruleBody(file, sel).includes('z-index');
        });
        expect({ alive: alive.sort() }).toEqual({ alive: EXCEPTIONS.map((e) => `${e.file}|${e.sel}|${e.value}`).sort() });
    });

    test('المقياسُ رتيبٌ متزايدٌ بلا تكرار، والجذرُ صفر', () => {
        const s = scale();
        expect(s.length).toBeGreaterThanOrEqual(8);
        expect({ names: s.map((x) => x.name).filter((n, i, a) => a.indexOf(n) !== i) }).toEqual({ names: [] });
        const outOfOrder = [];
        for (let i = 1; i < s.length; i += 1) {
            if (s[i].value <= s[i - 1].value) {outOfOrder.push(`${s[i - 1].name}(${s[i - 1].value}) → ${s[i].name}(${s[i].value})`);}
        }
        expect({ outOfOrder }).toEqual({ outOfOrder: [] });
        expect({ first: s[0] }).toEqual({ first: { name: 'base', value: 0 } });
    });

    test('كلُّ اسمِ مقياسٍ مستخدَمٍ معلَنٌ فعلًا — وإلا فالقيمة auto صامتة', () => {
        const declared = new Set(scale().map((x) => x.name));
        const used = new Set();
        for (const f of cssFiles()) {
            const re = /var\(--erp-z-([a-z0-9]+)/g;
            const src = stripComments(read(path.join(CSS_V2, f)));
            let m;
            while ((m = re.exec(src)) !== null) {used.add(m[1]);}
        }
        expect({ undeclared: [...used].filter((n) => !declared.has(n)).sort() }).toEqual({ undeclared: [] });
    });

    test('طبقةُ الـFAB بين اللزج والدرج: فوق الشريط الجانبي، تحت المفتوح', () => {
        const fab = valueOf('fab');
        expect({ fab }).toEqual({ fab: 200 });
        expect(fab > valueOf('sticky')).toBe(true);
        expect(fab < valueOf('drawer')).toBe(true);
        expect(fab < valueOf('dropdown')).toBe(true);
        expect(ruleBody('erp-components.css', '.erp-fab-host')).toMatch(/z-index:\s*var\(--erp-z-fab\)/);
    });

    test('طبقاتُ الـbody الحاملةُ للطبقة معلَنةٌ في قائمة التوكنز (وإلا auto)', () => {
        const tokens = stripComments(read(path.join(CSS_V2, 'erp-tokens.css')));
        const block = tokens.match(/([^{}]+)\{[^}]*--erp-text-inverse:/);
        expect(block).toBeTruthy();
        const bare = ['.erp-fab-host', '.erp-offline-bar', '.erp-pal-backdrop']
            .filter((sel) => /z-index:\s*var\(--erp-z-/.test(ruleBody('erp-components.css', sel) + ruleBody('erp-dashboard.css', sel)));
        const missing = bare.filter((sel) => !block[1].includes(sel));
        expect({ bare, missing }).toEqual({ bare: ['.erp-fab-host', '.erp-offline-bar', '.erp-pal-backdrop'], missing: [] });
    });

    test('لا بديلَ رقميٍّ في var(--erp-z-…): التراجعُ مقياسٌ ثانٍ صامت', () => {
        const withFallback = [];
        for (const f of cssFiles()) {
            const src = stripComments(read(path.join(CSS_V2, f)));
            const re = /var\(--erp-z-[a-z0-9]+\s*,/g;
            let m;
            while ((m = re.exec(src)) !== null) {withFallback.push(`${f} · ${src.slice(m.index, src.indexOf(')', m.index) + 1)}`);}
        }
        expect({ withFallback }).toEqual({ withFallback: [] });
    });

    test('شريطُ عدم الاتصال على طبقة الـtoast، لا فوق كلِّ شيء', () => {
        expect(ruleBody('erp-components.css', '.erp-offline-bar')).toMatch(/z-index:\s*var\(--erp-z-toast\)/);
        expect(valueOf('toast') >= valueOf('modal')).toBe(true);
    });

    test('لا 9999 في css/v2، ولا مقياسَ يتسرّب للقديم', () => {
        const still = cssFiles().filter((f) => /z-index:\s*(9[0-9]{3}|[1-9][0-9]{4,})/.test(stripComments(read(path.join(CSS_V2, f)))));
        expect({ still }).toEqual({ still: [] });
        const leaked = [];
        for (const f of fs.readdirSync(CSS_LEGACY_DIR).filter((n) => n.endsWith('.css'))) {
            if (/--erp-z-/.test(read(path.join(CSS_LEGACY_DIR, f)))) {leaked.push(f);}
        }
        expect({ leaked }).toEqual({ leaked: [] });
    });
});
