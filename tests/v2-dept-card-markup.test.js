/**
 * v2-dept-card-markup.test.js — عقد بنية بطاقة القسم (V2)
 * ═══════════════════════════════════════════════════════════════════════
 * السبب الجذري لهذا الملف: كان `deptCardHtml` لا يُغلق `erp-dept-card__head`،
 * فكانت الأقسام كلها (الإحصاءات · النسبة · الكاشيرات · الأزرار) تُبتلع داخل
 * رأس البطاقة‏ (صفّ flex بـ nowrap) وتُسحق أفقيًا: بطاقةٌ عرضها 406 بكسل لكن
 * `scrollWidth` بلغ 973، وخلية الإحصاء تنكمش إلى 42 بكسل. هذا هو «شكل زي الزفت»
 * الذي شكا منه المالك — وليس الزحمة فقط.
 *
 * الفحص هنا بنيوي لا نصّي: نُقيّم دالّة `deptCardHtml` الحقيقية من المصدر
 * بمساعداتٍ بديلة، ثم نحوّل ناتجها إلى DOM حقيقي ونتأكد أن:
 *   1) الوسم متوازن تمامًا (xmldom يرمي عند أي عدم توازن).
 *   2) أبناء البطاقة المباشرون هم الأقسام المعلومة بالترتيب المتوقّع.
 *   3) `erp-dept-card__head` يحوي الميدالية + العنوان فقط.
 * أيّ كسرٍ مستقبلي في التوازن يُسقط هذه الاختبارات فورًا.
 */
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

const ROOT = path.join(__dirname, '..');
const SCREEN = path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'departments.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** استخراج متن دالّة من المصدر بمطابقة الأقواس المعقوفة. */
function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) {throw new Error('دالّة غير موجودة: ' + name);}
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') {depth += 1;}
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) {return src.slice(start, i + 1);}
        }
    }
    throw new Error('دالّة غير متوازنة: ' + name);
}

/** مساعدات بديلة تُحاكي شكل ناتج الدوال الحقيقية (وسوم متوازنة). */
const deps = {
    esc: (v) => String(v == null ? '' : v),
    deptIdentityColor: () => '#B45309',
    deptCardCashierNos: () => ['4', '5'],
    LIVE_CASHIER_NOS: new Set(['4', '5']),
    deptCardStats: () => ({ rev: 1000, exp: 400, profit: 600, costRatio: 40 }),
    deptLinkRows: () => [{ cashierNo: '4', isPrimary: true, deptCode: 'kitchen', inherited: false }],
    deptCashierChip: (l) => `<span class="erp-dept-cashier">${l.cashierNo}</span>`,
    rows: [{ id: 1, code: 'kitchen', name: 'المطبخ', icon: 'chef-hat', parent_code: '' }],
    visibleRows: () => [{ code: 'B.F' }, { code: 'G' }],
    deptThemeOf: () => 'warm',
    formatInt: (v) => String(v),
    deptMedalHtml: () => '<span class="erp-dept-medal" aria-hidden="true"><i class="ji" data-i="chef-hat"></i></span>',
    deptSignalsHtml: () => '<div class="erp-dept-card__signals"><span class="erp-dept-signal">x</span></div>',
    deptStatCell: (label, icon, value, cls) => `<span class="erp-dept-stat ${cls}"><span class="erp-dept-stat__label">${label}</span>`
        + `<span class="erp-dept-stat__value">${value}</span></span>`,
    money: (v) => `<span class="erp-money" dir="ltr">${v}</span>`,
    currency: 'SAR',
    linkingCode: null,
    links: [],
    canLink: true,
    canManage: true,
    deptLinkPanelHtml: () => '<div class="erp-dept-link-panel"><div class="erp-dept-link-panel__body">p</div></div>',
};

function buildCard(extraLinks = []) {
    const src = extractFn(read(SCREEN), 'deptCardHtml');
    const factory = new Function(
        'deps',
        `const {${Object.keys(deps).join(',')}} = deps;\n${src}\nreturn deptCardHtml;`,
    );
    return factory(deps)(deps.rows[0], extraLinks);
}

/** تحويل الناتج إلى DOM؛ xmldom يرمي عند عدم التوازن، فنمسك الرمي كفشل مقروء. */
function parseCard(html) {
    const errors = [];
    const doc = new DOMParser({ onError: (level, msg) => errors.push(`${level}: ${msg}`) }).parseFromString(html, 'text/html');
    return { doc, errors };
}

const tagOf = (el) => `${el.tagName}.${el.getAttribute('class') || ''}`;
const childrenOf = (el) => [...el.childNodes].filter((n) => n.nodeType === 1).map(tagOf);

describe('V2 — بنية بطاقة القسم (مصدر انحراف التصميم)', () => {
    const html = buildCard();

    test('الوسم متوازن تمامًا: لا خطأ تحليل واحد', () => {
        const { errors } = parseCard(html);
        expect(errors).toEqual([]);
    });

    test('أبناء البطاقة المباشرون: سكة اللون ثم أقسام البطاقة بالترتيب', () => {
        const { doc } = parseCard(html);
        const li = doc.getElementsByTagName('li')[0];
        expect(childrenOf(li)).toEqual([
            'span.erp-dept-card__rail',
            'div.erp-dept-card__head',
            'div.erp-dept-card__signals',
            'div.erp-dept-card__stats',
            'div.erp-dept-card__ratio',
            'div.erp-dept-card__cashiers',
            'div.erp-dept-card__foot',
        ]);
    });

    test('الرأس يحوي الميدالية والعنوان فقط (لا تُبتلع باقي الأقسام)', () => {
        const { doc } = parseCard(html);
        const head = doc.getElementsByTagName('div')[0];
        expect(tagOf(head)).toBe('div.erp-dept-card__head');
        expect(childrenOf(head)).toEqual([
            'span.erp-dept-medal',
            'div.erp-dept-card__titles',
        ]);
    });

    test('لا وسم إغلاق مكرّر/ناقص في نهاية الرأس', () => {
        const src = extractFn(read(SCREEN), 'deptCardHtml');
        expect(src).toMatch(/\+ '<\/span><\/div><\/div>'/);
        expect(src).not.toMatch(/<\/span><\/span><\/div>/);
    });

    test('الإحصاءات ثلاث خلايا: إيراد · مصروف · صافي', () => {
        const { doc } = parseCard(html);
        const spans = Array.from(doc.getElementsByTagName('span'));
        const cells = spans.filter((s) => /^erp-dept-stat /.test(s.getAttribute('class') || ''));
        const hasStatsWrap = spans.some((s) => (s.getAttribute('class') || '') === 'erp-dept-stat__value');
        expect(cells.length).toBe(3);
        expect(hasStatsWrap).toBe(true);
    });
});

describe('V2 — شريط الأقسام الفرعية (بنية الزر وحالة الفتح)', () => {
    const stubDeps = { esc: (v) => String(v), formatInt: (v) => String(v) };
    function buildBar(open) {
        const src = extractFn(read(SCREEN), 'deptKidsBarHtml');
        const factory = new Function('deps', `const {esc, formatInt} = deps;\n${src}\nreturn deptKidsBarHtml;`);
        return factory(stubDeps)('kitchen', 12, open);
    }

    test('الزر متوازن ويحمل كود القسم والعدد', () => {
        const { doc, errors } = parseCard(buildBar(false));
        expect(errors).toEqual([]);
        const btn = doc.getElementsByTagName('button')[0];
        expect(btn.getAttribute('data-v2-kids')).toBe('kitchen');
        expect(btn.getAttribute('class')).toContain('erp-dept-kids-bar');
        expect(btn.textContent).toContain('12');
    });

    test('aria-expanded يطابق الحالة (false مطوي · true مفروش)', () => {
        expect(parseCard(buildBar(false)).doc.getElementsByTagName('button')[0].getAttribute('aria-expanded')).toBe('false');
        expect(parseCard(buildBar(true)).doc.getElementsByTagName('button')[0].getAttribute('aria-expanded')).toBe('true');
    });
});
