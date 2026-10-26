/**
 * v2-fonts.test.js — الخط العربي المحلي (المرحلة ٢: الوجه المؤسسي)
 * ═════════════════════════════════════════════════════════════════════════
 * الخطر الذي لا يكشفه أي اختبار آخر ولا أي خطأ console: أن تكون الطباعة
 * خاصّةً بجهاز العارض لا بالمنتج.
 *
 * المرحلة ١ ثبّتت Tajawal كملف محلي. المرحلة ٢ استبدلته بـIBM Plex Sans
 * Arabic: وجهٌ مؤسسي للـERP (أرقام مال، رواتب، ضريبة، مخزون) بدل الوجه
 * التسويقي المستدير. القاعدة نفسها لم تتغيّر: الصفحة لا تسأل الجهاز عن
 * خطٍّ مثبَّت.
 *
 * لذلك يثبّت هذا الملف ستة أشياء:
 *   ١) الصفحة تربط `erp-fonts.css` على نفس نسخة `preview.js` (فيدخل الكاش
 *      المُسبق عبر refsInHtml في sw.js تلقائيًا — لا قائمة يدوية).
 *   ٢) الملف يعلن وجوهَ `IBM Plex Sans Arabic` وحدها:
 *      400/500/600/700 × arabic/latin = ٨، كلُّها `font-display: swap`.
 *      وجود 600 حقيقي هو ما يجعل `--erp-fw-semibold` لا يُحلّ إلى 700.
 *   ٣) كلُّ `src` ملفٌ حقيقيٌّ في المستودع، وصفرُ `local()` — وهذا هو الدليل
 *      أنّ الخط يُحمَّل من ملف، لا من خطٍّ مثبَّت على الجهاز. القاعدة: لو
 *      أُضيف `local()` لَعاد العطب من بابه.
 *   ٤) صفرُ اعتمادٍ خارجي: لا CDN ولا Google Fonts، لا في الصفحة ولا في الملف.
 *   ٥) النطاقان (unicode-range) حقيقيّان لا زينة: العربي يحمل ضوابطَ الوصل
 *      U+200C-200E مع نطاقه U+0600-06FF، واللاتيني يحمل الأرقامَ U+0000-00FF
 *      وإشارةَ السالب U+2212 (لأن جداول المال أرقامٌ قبل أن تكون نصًّا).
 *   ٦) الملف يعلن وجوهًا فقط — صفرُ مُحدِّد، فلا يمكن أن يتسرّب لشاشةٍ قديمة.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const FONTS_CSS = path.join(CSS_V2, 'erp-fonts.css');
const TOKENS = path.join(CSS_V2, 'erp-tokens.css');
const BASE = path.join(CSS_V2, 'erp-base.css');
const V2_HTML = path.join(APP, 'v2.html');

const read = (p) => fs.readFileSync(p, 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** الوجوه [{family, weight, display, src, range}] — الأقواس في @font-face غير متداخلة. */
function faces() {
    return [...read(FONTS_CSS).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
        const body = m[1];
        const get = (re) => (body.match(re) || [])[1];
        return {
            family: get(/font-family:\s*'([^']+)'/),
            weight: get(/font-weight:\s*(\d+)/),
            display: get(/font-display:\s*([a-z-]+)/),
            src: (get(/src:\s*([^;]+);/) || '').trim(),
            range: (get(/unicode-range:\s*([^;]+);/) || '').trim(),
        };
    });
}

/** نسخة الصفحة: هي مرجع كل رابط CSS يشترطه العقد (نفس نمط v2-ui-system.test.js). */
function pageRevision() {
    const m = read(V2_HTML).match(/js\/v2\/preview\.js\?v=([\d.]+)/);
    expect(m).not.toBeNull();
    return m[1];
}

describe('V2 الخط المحلي — الوجه يتبع الملف لا الجهاز (المرحلة ٢)', () => {

    test('الصفحة تربط erp-fonts.css على نسخة preview.js نفسها', () => {
        expect(read(V2_HTML)).toContain(`css/v2/erp-fonts.css?v=${pageRevision()}`);
    });

    test('الملف يعلن IBM Plex Sans Arabic وحدها: ٤٠٠/٥٠٠/٦٠٠/٧٠٠ × arabic+latin، وكلُّها swap', () => {
        const all = faces();
        expect(all.length).toBe(8);
        expect([...new Set(all.map((f) => f.family))]).toEqual(['IBM Plex Sans Arabic']);
        expect([...new Set(all.map((f) => f.display))]).toEqual(['swap']);
        // كلُّ وزنٍ له نطاقاه: العربي واللاتيني.
        const byWeight = {};
        for (const f of all) {byWeight[f.weight] = (byWeight[f.weight] || 0) + 1;}
        expect(byWeight).toEqual({ '400': 2, '500': 2, '600': 2, '700': 2 });
    });

    test('كل src ملفٌ حقيقيٌّ في المستودع تحت fonts/v2 — وصفرُ local()', () => {
        const srcs = faces().map((f) => f.src);
        expect(srcs.length).toBe(8);
        for (const src of srcs) {
            // صيغةٌ واحدة ضيّقة: مسارٌ نسبيٌّ من css/v2 إلى ملف woff2، ثم format.
            const m = src.match(/^url\(\.\.\/\.\.\/fonts\/v2\/([\w-]+\.woff2)\)\s*format\('woff2'\)$/);
            expect({ src, matched: Boolean(m) }).toEqual({ src, matched: true });
            expect(fs.existsSync(path.join(CSS_V2, '../../fonts/v2', m[1]))).toBe(true);
        }
        // `local()` يجعل خطًّا مثبَّتًا على الجهاز يفوز — وهو العطب نفسه من بابه.
        // ناديه في التعليقات موثَّق، فلا يُقرأ إلا بعد تجريدها.
        expect(stripComments(read(FONTS_CSS))).not.toMatch(/local\(/);
    });

    test('صفرُ اعتمادٍ خارجي: لا CDN ولا Google Fonts في الصفحة ولا في الملف', () => {
        const html = read(V2_HTML);
        const css = read(FONTS_CSS);
        expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
        expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
        expect(css).not.toMatch(/https?:\/\//);
        // ولا رابط نمطٍ مطلق في الصفحة كلها: كل أصلٍ يُخدَم من الأصل نفسه.
        const remote = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /^https?:\/\//.test(h));
        expect({ remoteSheets: remote }).toEqual({ remoteSheets: [] });
    });

    test('النطاقان حقيقيّان: ضوابط الوصل مع العربية، والأرقام والسالب مع اللاتيني', () => {
        for (const f of faces()) {
            if (f.src.includes('-arabic.')) {
                expect(f.range).toContain('U+0600-06FF');
                // U+200C ZWNJ · U+200D ZWJ · U+200E LRM — تشكيلٌ لا يُترك لخطٍّ بديل.
                expect(f.range).toContain('U+200C-200E');
            } else {
                expect(f.src.includes('-latin.')).toBe(true);
                expect(f.range).toContain('U+0000-00FF');
                expect(f.range).toContain('U+2212');   // إشارة السالب في المبالغ
            }
        }
    });

    test('الملف يعلن وجوهًا فقط — صفرُ مُحدِّد، فلا تسرّبَ لشاشةٍ قديمة', () => {
        const rest = stripComments(read(FONTS_CSS))
            .replace(/@font-face\s*\{[^}]*\}/g, '')
            .replace(/\s+/g, '');
        expect(rest).toBe('');
    });

    test('التوكن يقدّم IBM Plex Sans Arabic أولًا، و`.erp-v2` يستهلك التوكن فعلًا', () => {
        const declared = stripComments(read(TOKENS)).match(/--erp-font-sans\s*:\s*([^;]+);/);
        expect(declared).not.toBeNull();
        const chain = declared[1];
        expect(chain).toMatch(/^"IBM Plex Sans Arabic"\s*,/);
        // الوجه المُعلَن هنا هو نفسه الذي تحمّله erp-fonts.css من ملف.
        expect([...new Set(faces().map((f) => f.family))]).toEqual(['IBM Plex Sans Arabic']);
        // Tajawal يبقى بديلًا محليًا، ثم سلّم النظام القديم صراحةً.
        expect(chain).toContain('"Tajawal"');
        expect(chain).toMatch(/"Tajawal"\s*,\s*"Cairo"\s*,\s*"Segoe UI"\s*,\s*sans-serif\s*$/);
        // لا التفافَ ولا تكرار: كانت var(--karim-font) تعيد «IBM Plex Sans
        // Arabic» ثانيةً في السلسلة المحسوبة (الاسم مرتين متتاليتين).
        expect(chain.match(/"IBM Plex Sans Arabic"/g)).toHaveLength(1);
        expect(chain).not.toContain('var(--karim-font');
        // والتوكن بلا مستهلكٍ اسمٌ ميت.
        const root = stripComments(read(BASE)).match(/\.erp-v2\s*\{([^}]*)\}/);
        expect(root).not.toBeNull();
        expect(root[1]).toMatch(/font-family:\s*var\(--erp-font-sans\)/);
    });

    test('الملف UTF-8 بلا BOM — لا يبدأ بـU+FEFF', () => {
        const bytes = fs.readFileSync(FONTS_CSS);
        expect([bytes[0], bytes[1], bytes[2]]).toEqual([0x2F, 0x2A, 0x20]); // "/* "
    });
});
