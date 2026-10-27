/**
 * v2-type-coherence.test.js — سلامة المقياس: لا رقمٌ مكتوبٌ باليد
 *═════════════════════════════════════════════════════════════════════════
 * الفجوة التي يحرسها هذا الملف (قياس 2026-10-27 على css/v2 كاملة):
 *   قبل  48 حجمًا مكتوبًا باليد + 31 نصف قطرًا مكتوبًا باليد، موزّعةً على
 *   13 ملفًا — القياسات تتسرب من ملف إلى آخر (10px في شاشة، 11px في أخرى)
 *   فلا يبقى للاسم «حجم» معنى واحد، وكل شاشة تُقرئ بخطٍّ مختلف قليلًا.
 *   بعد  صفر.
 *
 * لماذا لا يكفي اختبار v2-typography؟ هو يحرس *أسماء الأصناف*
 * (`.erp-text-sm` مشتقةً من المتغيّر) — أما `font-size: 11px` المكتوب على
 * محدِّدٍ عشوائي فلا يراه أصلًا. البوابة هنا تقرأ الملفات كما هي.
 *
 * القواعد:
 *   ١) لا `font-size: <رقم>px` في css/v2 — السلّم النصي سبع درجات
 *      (`--erp-text-*`) والعرض ثلاث (`--erp-display-*`)، وكلٌّ منهما معرَّف
 *      في erp-tokens.css على `body` فيصل لكل عنصر.
 *   ٢) لا `border-radius: <رقم>px;` (قيمة واحدة) خارج erp-board.css.
 *      اللوحة الفنية نظامٌ مستقل له `--kb-*` ومقياسه المحلي و اختباره
 *      الخاص (v2-board-portrait) — استثناءٌ مقصودٌ ومعلَّن لا انسحاب.
 *      القيم المركّبة (3px 14px 3px 14px) شكلٌ من الزخرفة لا قياس، فلا
 *      تُطابَق هنا أصلًا (النمط يطلب قيمةً واحدة قبل الفاصلة/النهاية).
 *   ٣) كل متغيّر `--erp-display-*` معرَّف، وكل متغيّر معرَّف مستخدَم — لا
 *      رموز ميتة تكبر الملف دون أن تُقرأ.
 *
 * الفشل هنا لا يكسر شيئًا في المتصفح — لهذا هو بالضبط نوع الخطأ الذي لا
 * يظهر إلا كتفاوتٍ بصريٍّ بطيء يصعب تتبّعه لاحقًا.
 */
const fs = require('fs');
const path = require('path');

const CSS_V2 = path.join(__dirname, '..', 'frontend', 'app', 'css', 'v2');
const TOKENS = path.join(CSS_V2, 'erp-tokens.css');
const read = (p) => fs.readFileSync(p, 'utf8');
const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const cssFiles = () => fs.readdirSync(CSS_V2).filter((f) => f.endsWith('.css')).sort();

/** استثناء معلَّن: النظام الفني للوحة المنيو (`--kb-*`). */
const EXEMPT_RADIUS_FILES = ['erp-board.css'];

test('لا حجمَ خطٍّ مكتوبًا باليد في css/v2 — السلّم نامٍ من المتغيّرات وحدها', () => {
    const offenders = [];
    for (const f of cssFiles()) {
        const src = stripCssComments(read(path.join(CSS_V2, f)));
        for (const m of src.matchAll(/font-size:\s*(\d+)px/g)) {
            offenders.push(`${f}: font-size: ${m[1]}px`);
        }
    }
    expect({ handWrittenSizes: offenders }).toEqual({ handWrittenSizes: [] });
});

test('لا نصفَ قطرٍ مكتوبًا باليد بقيمةٍ واحدة خارج erp-board.css', () => {
    const offenders = [];
    for (const f of cssFiles()) {
        if (EXEMPT_RADIUS_FILES.includes(f)) {continue;}
        const src = stripCssComments(read(path.join(CSS_V2, f)));
        for (const m of src.matchAll(/border-radius:\s*(\d+)px\s*;/g)) {
            offenders.push(`${f}: border-radius: ${m[1]}px`);
        }
    }
    expect({ handWrittenRadii: offenders }).toEqual({ handWrittenRadii: [] });
});

test('الاستثناء المعلن موجود فعلًا: erp-board.css ومقياسه المحلي', () => {
    const board = stripCssComments(read(path.join(CSS_V2, 'erp-board.css')));
    // إن نُقلت اللوحة أو حُذف مقياسها لزم إعادة النظر في الاستثناء — لا يبقى استثناءً بلا موضوع.
    expect(EXEMPT_RADIUS_FILES).toEqual(['erp-board.css']);
    expect(board).toMatch(/--kb-u:/);
    expect(board).toMatch(/border-radius:\s*999px\s*;/);
});

/*
 * مصدران للسلّم: erp-tokens.css يعرّف القيم، وerp-identity.css يرفعها درجةً
 * على body (وهو الفائز تسلسليًا لأنّه يأتي لاحقًا). هذا مقصودٌ ومُعلَن، لكن
 * اثنينِ مصدرين يعني احتمالَ نسيان أحدهما: يُضاف درجةٌ في الأول فتبقى
 * الثانية كما كانت، فيبدو الاسم صغيرًا في شاشةٍ وكبيرًا في أخرى — نفس
 * الفجوة التي وُجد من أجلها هذا الملف، لكن من الباب الخلفي.
 * الحارس يثبّت أن الاثنين يزدانان معًا ولا يفترقان.
 */
const SIZES = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl'];

function scaleOf(file) {
    const src = stripCssComments(read(path.join(CSS_V2, file)));
    const map = {};
    for (const m of src.matchAll(/--erp-text-(xs|sm|base|md|lg|xl|2xl):\s*([\d.]+)px/g)) {
        if (!(m[1] in map)) {map[m[1]] = Number(m[2]);}
    }
    return map;
}

test('المصدراان لا يفترقان: السلّم متطابق الشكل ومتدرّج ولا يتناقص', () => {
    const tokens = scaleOf('erp-tokens.css');
    const identity = scaleOf('erp-identity.css');
    const missing = [];
    for (const f of ['erp-tokens.css', 'erp-identity.css']) {
        const map = f === 'erp-tokens.css' ? tokens : identity;
        for (const s of SIZES) {if (!(s in map)) {missing.push(`${f}: --erp-text-${s}`);}}
    }
    expect({ missingSteps: missing }).toEqual({ missingSteps: [] });

    const ascending = (map) => SIZES.map((s) => map[s]);
    const t = ascending(tokens);
    const i = ascending(identity);
    const strictly = (a) => a.every((v, n) => n === 0 || v > a[n - 1]);

    expect({ tokensScale: t, strictlyIncreasing: strictly(t) })
        .toEqual({ tokensScale: t, strictlyIncreasing: true });
    expect({ identityScale: i, strictlyIncreasing: strictly(i) })
        .toEqual({ identityScale: i, strictlyIncreasing: true });

    // الهوية ترفع ولا تخفض: درجةٌ أصغر من أصلها تعني خطًّا أصغر مما وعدت
    // به السلّم الأساسي في تلك الدرجة بالذات.
    const regressions = SIZES.filter((s, n) => identity[s] < tokens[s]);
    expect({ identityLifts: regressions }).toEqual({ identityLifts: [] });
});

test('رموز العرض معرَّفة ومستخدَم — لا رموز ميتة ولا أرقام بلا بيت', () => {
    const tokens = stripCssComments(read(TOKENS));
    const defined = new Set([...tokens.matchAll(/(--erp-display-[a-z0-9]+):/g)].map((m) => m[1]));

    const used = new Set();
    const unknown = [];
    for (const f of cssFiles()) {
        const src = stripCssComments(read(path.join(CSS_V2, f)));
        for (const m of src.matchAll(/var\((--erp-display-[a-z0-9]+)/g)) {
            used.add(m[1]);
            if (!defined.has(m[1])) {unknown.push(`${f}: ${m[1]}`);}
        }
    }

    expect({ unknownTokens: unknown }).toEqual({ unknownTokens: [] });
    expect(used.size).toBeGreaterThan(0);
    // كل رمز معرَّف يُقرأ فعلًا — رمزٌ بلا مستهلك يعني أنه نُسي ولا يخدم أحدًا.
    expect({ deadTokens: [...defined].filter((d) => !used.has(d)).sort() })
        .toEqual({ deadTokens: [] });
});
