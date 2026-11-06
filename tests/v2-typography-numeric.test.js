/**
 * v2-typography-numeric.test.js — العقدُ الرقميّ للواجهة: الوجهُ الرقميّ + سياسةُ الأرقام
 * ═════════════════════════════════════════════════════════════════════════════════════
 * خيطان يلتقيان في مكانٍ واحد: العمودُ الرقميّ.
 *
 * ١) الوجهُ الرقميّ (IBM Plex Mono)
 *    `--erp-font-mono` كان يسقط على «Cascadia Mono» أو «Consolas» — خطِّ
 *    الجهاز. فشكلُ رقمِ الفاتورة يختلف بين كاشير ومدير وطابعة، وهو ما
 *    حرسَه عقدُ `v2-fonts.test.js` للوجه العربيّ ونسيه للوجه الرقميّ.
 *    الآن وجهٌ من المستودع: توأمُ Plex Sans بصريًّا، ولا يفوز بخطٍّ مثبَّت.
 *
 * ٢) سياسةُ الأرقام
 *    النظامُ يطبع المالَ بأرقامٍ لاتينية في 37 ملفًّا (`en-US`)، وبأرقامٍ
 *    عربية-هندية في ملفٍّ واحد (`wh-vs-pos.js` كان `ar-EG`). فبياناتٌ واحدة
 *    كان لها رقمان على شاشتين، والمطبوعُ يختلف عن المعروض.
 *
 *    والقرارُ المُعلَن هنا (وهو المُفروض في كل الأرقام المالية):
 *    **المالُ والكمياتُ وأرقامُ التعريفِ: لاتينيةٌ دائمًا.** أما العربية-هندية
 *    فلا تخرج إلا في النثر العربيّ («حتى ٣ ملفات») أو في تطبيع ما يكتبه
 *    المستخدم من لوحة المفاتيح.
 *
 *    ومعيارُه فنّيٌّ لا ذوقيّ: مستندات ZATCA الإلكترونية تطلب أرقامًا غربية،
 *    وعمودُ مبالغٍ لا يُقرأ بالعين إن اختلفت أرقامُه بين شاشتين.
 *
 *    أمّا **التواريخ** فهي خارجَ هذا العقد عمدًا: النظامُ يعرضها بأرقامٍ
 *    عربية-هندية في أكثر الشاشات (`ar-EG`) وأرقامٍ لاتينية في غيرها
 *    (`ar-SA-u-ca-gregory-nu-latn`) — فتوحيدُها قرارُ منتجٍ لا قرارُ خطأ،
 *    وهو مذكورٌ في DESIGN.md كقرارٍ مفتوح.
 *
 * لذلك يثبّت هذا الملف خمسة أشياء:
 *   ١) الوجهُ الرقميّ محليٌّ بالكامل: أربعةُ أوزانٍ حقيقية، صفرُ `local()`،
 *      صفرُ اعتمادٍ خارجي، والنطاقُ يرفض الأرقامَ وإشارةَ السالب.
 *   ٢) التوكنُ يبدأ بـ«IBM Plex Mono»، وصنفُ `.erp-mono` يستهلكه فعلًا.
 *   ٣) `.erp-num` يحمل `tabular-nums` وعزلَ LTR — فمحاذاةُ العمود شرطُ
 *      قراءةِ عمودِ مبالغ، لا زينة.
 *   ٤) كلُّ تنسيقٍ رقميٍّ (مبلغٌ أو كمية) يستعمل لغةَ أرقامٍ لاتينية.
 *   ٥) العربية-هندية لا تُرسم إلا في النثر أو في تطبيع الإدخال — لا في
 *      رقمٍ يُعرض.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const MONO_CSS = path.join(CSS_V2, 'erp-mono.css');
const TOKENS = path.join(CSS_V2, 'erp-tokens.css');
const BASE = path.join(CSS_V2, 'erp-base.css');
const DASH = path.join(CSS_V2, 'erp-dashboard.css');
const V2_HTML = path.join(APP, 'v2.html');
const JS_V2 = path.join(APP, 'js', 'v2');

const read = (p) => fs.readFileSync(p, 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** الوجوه [{family, weight, display, src, range}] */
function faces() {
    return [...read(MONO_CSS).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
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

function jsFiles(dir) {
    const acc = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {acc.push(...jsFiles(p));} else if (e.name.endsWith('.js')) {acc.push(p);}
    }
    return acc;
}

/** حرفٌ عربيٌّ حقيقي — النطاقُ يرفض الأرقامَ العربية-الهندية (U+0660-0669) فتُحسب نثرًا. */
const ARABIC_LETTER = /[ء-ٟٱ-ۓ]/;

describe('V2 — الوجهُ الرقميّ (IBM Plex Mono)', () => {

    test('أربعةُ أوزانٍ حقيقية ٤٠٠/٥٠٠/٦٠٠/٧٠٠، وكلُّها swap', () => {
        const all = faces();
        expect(all.length).toBe(4);
        expect([...new Set(all.map((f) => f.family))]).toEqual(['IBM Plex Mono']);
        expect([...new Set(all.map((f) => f.display))]).toEqual(['swap']);
        expect(all.map((f) => f.weight)).toEqual(['400', '500', '600', '700']);
    });

    test('كل src ملفٌ حقيقيٌّ كاملٌ في fonts/v2 — وصفرُ local() وصفرُ اعتمادٍ خارجي', () => {
        const srcs = faces().map((f) => f.src);
        for (const src of srcs) {
            const m = src.match(/^url\(\.\.\/\.\.\/fonts\/v2\/([\w-]+\.woff2)\)\s*format\('woff2'\)$/);
            expect({ src, matched: Boolean(m) }).toEqual({ src, matched: true });
            const file = path.join(CSS_V2, '../../fonts/v2', m[1]);
            expect(fs.existsSync(file)).toBe(true);
            // وجودُ الملفِ لا يكفي: نسخةٌ مبتورةٌ أو بديلٌ فارغٌ تمرّ به.
            expect(fs.statSync(file).size).toBeGreaterThan(8 * 1024);
        }
        expect(stripComments(read(MONO_CSS))).not.toMatch(/local\(/);
        expect(read(MONO_CSS)).not.toMatch(/https?:\/\//);
        expect(read(MONO_CSS)).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    });

    test('النطاق: الأرقامُ والإشارةُ السالبة — ولا يدّعي العربيةَ ولا يملكها', () => {
        /* النطاقُ يُقرأ دلاليًّا لا نصًّا: قائمةُ Google الفرعية (0020-007E,
           00A0-00FF, 2212…) تغطّي الأرقامَ واللاتينية تمامًا، واشتراطُ سلسلةٍ
           حرفية بعينها كان يحرس الصياغة لا التغطية. المفكِّكُ هنا يوسّع كل مدى
           ثم يسأل عن المحارف التي نعتمد عليها فعلًا في خلايا المبالغ. */
        const covered = (range) => {
            const set = new Set();
            for (const part of range.split(',')) {
                const m = part.trim().match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
                if (!m) {continue;}
                const a = parseInt(m[1], 16);
                const b = m[2] ? parseInt(m[2], 16) : a;
                for (let c = a; c <= b && c - a < 0x10000; c++) {set.add(c);}
            }
            return set;
        };
        const needed = [
            ...Array.from({ length: 10 }, (_, i) => 0x30 + i), // ٠-٩ لاتينية
            ...Array.from({ length: 26 }, (_, i) => 0x41 + i), // A-Z
            ...Array.from({ length: 26 }, (_, i) => 0x61 + i), // a-z
            0x2212,                                            // إشارة السالب في المبالغ
        ];
        for (const f of faces()) {
            const set = covered(f.range);
            const missing = needed.filter((c) => !set.has(c)).map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0'));
            expect({ src: f.src, missing }).toEqual({ src: f.src, missing: [] });
            expect(f.range).not.toContain('U+0600-06FF'); // لا ادّعاءً بخطٍّ لا يملك العربية
        }
    });

    test('الملف يعلن وجوهًا فقط — فلا تسرّبَ بتعريفٍ آخر', () => {
        const rest = stripComments(read(MONO_CSS))
            .replace(/@font-face\s*\{[^}]*\}/g, '')
            .replace(/\s+/g, '');
        expect(rest).toBe('');
    });

    test('التوكن يبدأ بـ«IBM Plex Mono» وصنفُ .erp-mono يستهلكه', () => {
        const chain = stripComments(read(TOKENS)).match(/--erp-font-mono\s*:\s*([^;]+);/);
        expect(chain).not.toBeNull();
        expect(chain[1]).toMatch(/^"IBM Plex Mono"\s*,/);
        // لا تكرارٌ للاسم في السلسلة نفسها.
        expect(chain[1].match(/"IBM Plex Mono"/g)).toHaveLength(1);
        const consumer = stripComments(read(BASE)).match(/\.erp-v2\s+\.erp-mono\s*\{([^}]*)\}/);
        expect(consumer).not.toBeNull();
        expect(consumer[1]).toMatch(/font-family:\s*var\(--erp-font-mono\)/);
    });

    test('الصفحة تربط erp-mono.css على نسخة preview.js نفسها', () => {
        const rev = read(V2_HTML).match(/js\/v2\/preview\.js\?v=([\d.]+)/);
        expect(rev).not.toBeNull();
        expect(read(V2_HTML)).toContain(`css/v2/erp-mono.css?v=${rev[1]}`);
    });
});

describe('V2 — سياسةُ الأرقام: لاتينيةٌ في كل رقمٍ يُعرض', () => {

    test('.erp-num يضمن tabular-nums وعزلَ LTR — فمحاذاةُ العمود شرطُ قراءته', () => {
        const base = stripComments(read(BASE)).match(/\.erp-v2\s+\.erp-num\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/font-variant-numeric:\s*tabular-nums/);
        expect(base[1]).toMatch(/font-feature-settings:\s*var\(--erp-tnum\)/);
        const dash = stripComments(read(DASH)).match(/\.erp-v2\s+\.erp-num\s*\{([^}]*)\}/);
        expect(dash).not.toBeNull();
        expect(dash[1]).toMatch(/direction:\s*ltr/);
        expect(dash[1]).toMatch(/unicode-bidi:\s*isolate/);
    });

    test('كلُّ تنسيقٍ رقميٍّ (مبلغٌ/كمية) بلغةِ أرقامٍ لاتينية', () => {
        const offenders = [];
        for (const f of jsFiles(JS_V2)) {
            const src = stripComments(read(f));
            // بصمةُ التنسيق الرقميّ: FractionDigits — أو ما يكافئها من مفاتيح الكسر.
            const re = /toLocaleString\(\s*['"]([^'"]+)['"]\s*,\s*\{[^}]*?FractionDigits[^}]*\}\s*\)/g;
            for (const m of src.matchAll(re)) {
                const locale = m[1];
                const latin = locale === 'en-US' || /nu-latn/.test(locale);
                if (!latin) {offenders.push(`${path.relative(JS_V2, f)}: ${locale}`);}
            }
        }
        expect({ arabicNumberedFormats: offenders }).toEqual({ arabicNumberedFormats: [] });
    });

    test('لا لغةُ «ar» المجرّدة: لا تقويمٌ ولا أرقامٌ مبهمة', () => {
        const offenders = [];
        for (const f of jsFiles(JS_V2)) {
            const src = stripComments(read(f));
            for (const m of src.matchAll(/toLocale(?:String|DateString|TimeString)\(\s*['"]ar['"]/g)) {
                offenders.push(`${path.relative(JS_V2, f)}: ${m[0]}`);
            }
        }
        expect({ bareArabicLocales: offenders }).toEqual({ bareArabicLocales: [] });
    });

    test('العربية-هندية لا تُرسم إلا في النثر أو في تطبيع الإدخال', () => {
        const offenders = [];
        for (const f of jsFiles(JS_V2)) {
            const src = stripComments(read(f));
            src.split(/\r?\n/).forEach((line, i) => {
                if (!/[٠-٩]/.test(line)) {return;}
                const prose = ARABIC_LETTER.test(line);            // جملةٌ عربية
                const normalizing = /\[[^\]]*٠-٩[^\]]*\]/.test(line); // صنفُ تطبيع الإدخال
                if (!prose && !normalizing) {
                    offenders.push(`${path.relative(JS_V2, f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
                }
            });
        }
        expect({ arabicIndicInData: offenders }).toEqual({ arabicIndicInData: [] });
    });
});
