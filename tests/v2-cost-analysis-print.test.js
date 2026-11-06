/**
 * The cost-analysis A4 sheet is the printed face of the V2 screen. It must
 * carry the restaurant identity, the same totals the screen shows, and no
 * POS vendor name — the sheet is customer-facing.
 */
const {
    renderCostAnalysisPrintHtml,
} = require('../backend/finance-routes.js');

const PAYLOAD = {
    rows: [
        {
            code: 'kitchen', name: 'المطبخ', parent: null, rev: 1000, materials: 200,
            countAdj: 10, operating: 90, exp: 300, profit: 700,
            costRatio: 30, total: 300, rowCount: 12,
            own: { rev: 1000, exp: 300, profit: 700, costRatio: 30, materials: 200, transfers: 0, countAdj: 10, operating: 90, rowCount: 12 },
        },
        {
            code: 'store', name: 'المخزن', parent: 'kitchen', rev: 100, materials: 200,
            countAdj: 0, operating: 0, exp: 200, profit: -100,
            costRatio: 200, total: 200, rowCount: 3,
            own: { rev: 100, exp: 200, profit: -100, costRatio: 200, materials: 200, transfers: 0, countAdj: 0, operating: 0, rowCount: 3 },
        },
    ],
    totals: { rev: 1000, mat: 200, cnt: 10, ops: 90, exp: 300, avgCost: 30 },
    categories: [{ label: 'رواتب', value: 90 }, { label: 'كهرباء', value: 210 }],
    period: { from: '2026-10-01', to: '2026-10-23' },
};

const OPTS = {
    restaurantName: 'مطاعم الشرفه العالمي',
    logo: 'data:image/png;base64,AAAA',
    currency: 'SAR',
    generatedAt: '2026-10-23 10:00',
    generatedBy: 'admin',
};

/* مقطع من المستند: عنوان القسم حتى <h3> التالي — فلا يُقرأ صفٌ من جدول أخيه. */
const sectionOf = (html, title) => {
    const at = html.indexOf(title);
    expect(at).toBeGreaterThan(-1);
    const rest = html.slice(at);
    const next = rest.indexOf('<h3 class="sec">', 5);
    return next === -1 ? rest : rest.slice(0, next);
};

/* صف الجدول كما طُبع: الاسم ثم رمز القسم في سطر واحد، من <tr> إلى </tr>. */
const rowOf = (section, name, code) => {
    const key = `>${name}<span class="pill" style="margin-inline-start:6px"${code ? `>${code}` : ''}`;
    const at = section.indexOf(key);
    expect(at).toBeGreaterThan(-1);
    return section.slice(section.lastIndexOf('<tr>', at), section.indexOf('</tr>', at));
};

describe('renderCostAnalysisPrintHtml — A4 identity', () => {
    test('brand header, logo and period lead the sheet', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('data-v2-print-brand');
        expect(html).toContain('<img src="data:image/png;base64,AAAA"');
        expect(html).toContain('مطاعم الشرفه العالمي');
        expect(html).toContain('2026-10-01');
        expect(html).toContain('2026-10-23');
        expect(html).toContain('@page { size: A4;');
    });

    test('nine KPI cells and the three cost buckets are rendered', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        const cells = html.match(/<div class="cell">/g) || [];
        expect(cells).toHaveLength(9);
        expect(html).toContain('حركة التحويلات (إجمالي)');
        expect(html).toContain('صرف المخزون (صافي المرتجعات)');
        expect(html).toContain('فروق الجرد');
        expect(html).toContain('مصروفات تشغيلية');
        expect(html).toContain('صافي الربح');
        expect(html).toContain('1,000.00');
        expect(html).toContain('700.00');
    });

    test('every department and category appears with totals and verdict', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        expect(html).toContain('المطبخ');
        expect(html).toContain('المخزن');
        expect(html).toContain('رواتب');
        expect(html).toContain('كهرباء');
        expect(html).toContain('tfoot');
        expect(html).toContain('مربح');
        expect(html).toContain('خاسر');
        expect(html).toContain('أُنشئ 2026-10-23 10:00 · admin');
    });

    test('escapes stored text and never names the POS vendor', () => {
        const html = renderCostAnalysisPrintHtml({
            ...PAYLOAD,
            rows: [{ ...PAYLOAD.rows[0], name: '<script>alert(1)</script>' }],
        }, OPTS);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html.toLowerCase()).not.toContain('yara');
        expect(html).not.toContain('يارا');
    });
});

describe('قسم حركة التحويلات — طباعة تحليل التكاليف', () => {
    const FLOW = {
        total: 5400, transfers: 3,
        bySource: [{ name: 'المطبخ', transfers: 2, value: 5400 }],
        byDest: [{ name: 'البيع الخارجي', transfers: 2, value: 5400 }],
        topItems: [{ name: 'لحم بقري', unit: 'كجم', qty: 30, value: 5400 }],
        recent: [{
            number: 'TR-20261101203759-328', day: '2026-11-01', from: 'المطبخ',
            to: 'البيع الخارجي', lines: 2, value: 5400,
        }],
    };

    test('المصادر والوجهات والأصناف وآخر التحويلات برقمها', () => {
        const html = renderCostAnalysisPrintHtml({ ...PAYLOAD, flow: FLOW }, OPTS);
        expect(html).toContain('حركة التحويلات بين الأقسام');
        expect(html).toContain('المطبخ — مُرسِل');
        expect(html).toContain('البيع الخارجي — مُستلِم');
        expect(html).toContain('أعلى الأصناف المحوَّلة');
        expect(html).toContain('رقم التحويل');
        expect(html).toContain('TR-20261101203759-328');
        expect(html).toContain('تُخصم من تكلفة القسم المرسل');
    });

    test('لا حركة = لا قسم تحويلات ولا رقم وهمي', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        expect(html).not.toContain('حركة التحويلات بين الأقسام');
        expect(html).not.toContain('رقم التحويل');
    });

    test('نص خبيث في رقم التحويل يُهرَّب كما هو', () => {
        const html = renderCostAnalysisPrintHtml({
            ...PAYLOAD,
            flow: { ...FLOW, recent: [{ ...FLOW.recent[0], number: '<img src=x onerror=alert(1)>' }] },
        }, OPTS);
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});

const CARDS = {
    ...PAYLOAD,
    rows: [
        {
            code: 'kitchen', name: 'المطبخ', parent: null, rev: 900, materials: 300,
            transfers: 0, countAdj: 0, operating: 0, exp: 300, profit: 600, costRatio: 33.3,
            total: 300, rowCount: 9,
            own: { rev: 0, exp: 120, profit: -120, costRatio: 0, materials: 120, transfers: 0, countAdj: 0, operating: 0, rowCount: 4 },
        },
        {
            code: 'external_sales', name: 'قسم البيع الخارجي', parent: 'kitchen', rev: 600, materials: 180,
            transfers: 0, countAdj: 0, operating: 0, exp: 180, profit: 420, costRatio: 30,
            total: 180, rowCount: 5,
            own: { rev: 600, exp: 180, profit: 420, costRatio: 30, materials: 180, transfers: 0, countAdj: 0, operating: 0, rowCount: 5 },
        },
        {
            code: 'open_buffet', name: 'البوفيه المفتوح', parent: 'kitchen', rev: 300, materials: 0,
            transfers: 0, countAdj: 0, operating: 0, exp: 0, profit: 300, costRatio: 0,
            total: 0, rowCount: 2,
            own: { rev: 300, exp: 0, profit: 300, costRatio: 0, materials: 0, transfers: 0, countAdj: 0, operating: 0, rowCount: 2 },
        },
    ],
    attribution: {
        links: [
            { cashierNo: '4', dept: 'external_sales', primary: true },
            { cashierNo: '5', dept: 'external_sales', primary: false },
            { cashierNo: '9', dept: 'open_buffet', primary: true },
        ],
        channelRevenue: [{ code: 'ys_cc_4', revenue: 500 }, { code: 'ys_cc_5', revenue: 100 }, { code: 'ys_cc_9', revenue: 300 }],
    },
};

describe('بطاقات الأقسام في الطباعة — نفس الشاشة على A4', () => {
    /* كل بطاقة تقطع عند بداية البطاقة التالية، ثم عند نهايتها — فالشريحة
       تحوي قسمها وحده ولا تسحب ذيل المستند معها. */
    const cardOf = (html, name) => {
        const parts = html.split('<article class="dcard');
        const hit = parts.find((chunk) => chunk.includes(`dcard__name">${name}`));
        expect(hit).toBeTruthy();
        return `<article class="dcard${hit.slice(0, hit.indexOf('</article>'))}`;
    };

    test('عنوان القسم، والبيع الخارجي جذر مستقل لا فرع في المطبخ', () => {
        const html = renderCostAnalysisPrintHtml(CARDS, OPTS);
        expect(html).toContain('بطاقات الأقسام');
        const ext = cardOf(html, 'قسم البيع الخارجي');
        expect(ext).not.toContain('dcard--child');
        expect(ext).not.toContain('فرع من');
        const buffet = cardOf(html, 'البوفيه المفتوح');
        expect(buffet).toContain('class="dcard dcard--child"');
        expect(buffet).toContain('فرع من المطبخ');
    });

    test('كاشيريات البيع الخارجي مستقلة برقم إيرادها، والأساسي موسوم', () => {
        const html = renderCostAnalysisPrintHtml(CARDS, OPTS);
        expect(html).toMatch(/كاشير 4 · 500\.00/);
        expect(html).toMatch(/كاشير 5 · 100\.00/);
        expect(html).toContain('pill pill--brand">كاشير 4');
        /* المطبخ لا كاشير له: أبناؤه يحملون الروابط، فبطاقته بلا شريط كاشيريات. */
        expect(cardOf(html, 'المطبخ')).not.toContain('كاشير ');
    });

    test('سطح البطاقة أرقام القسم وحده، و«مع فروعه» سطر مستقل عند الاختلاف', () => {
        const html = renderCostAnalysisPrintHtml(CARDS, OPTS);
        const kitchen = cardOf(html, 'المطبخ');
        expect(kitchen).toContain('<b>إيراد القسم</b><span>0.00');
        expect(kitchen).toContain('<b>تكلفة القسم</b><span>120.00');
        /* فروعه المطبوعة تحته وحده — البيع الخارجي بطاقته المستقلة فلا
           يدخل هذا السطر، وإلا حُسب مرّتين في المستند. */
        expect(kitchen).toContain('مع فروعه (1): إيراد 300.00 · تكلفة 120.00.');
        expect(cardOf(html, 'قسم البيع الخارجي')).not.toContain('مع فروعه');
        expect(cardOf(html, 'البوفيه المفتوح')).not.toContain('مع فروعه');
        expect(html.match(/class="dcard__own"/g)).toHaveLength(1);
    });

    test('بطاقات بلا حركة تُطبع ذيلًا مدمجًا، لا بطاقات أصفار', () => {
        const zero = (/** @type {any} */ r) => ({
            ...r,
            rev: 0, exp: 0, profit: 0, rowCount: 0,
            own: { rev: 0, exp: 0, profit: 0, costRatio: 0, materials: 0, transfers: 0, countAdj: 0, operating: 0, rowCount: 0 },
        });
        const html = renderCostAnalysisPrintHtml({
            ...CARDS,
            attribution: { links: [], channelRevenue: [] },
            rows: CARDS.rows.map(zero),
        }, OPTS);
        expect(html).toContain('أقسام بلا حركة في الفترة');
        expect(html).toContain('class="dcards dcards--quiet"');
        expect(html).toContain('dcard--quiet');
        expect(html).not.toContain('<div class="dcard__figs">');
        /* شبكة الحركة فارغة، فتكتفي بشبكة واحدة موسومة بلا حركة. */
        expect(html).toContain('لا حركة لأقسامك في هذه الفترة');
        expect(html.match(/class="dcards/g)).toHaveLength(2);
    });

    test('لا بطاقات بلا أقسام، والنص الخبيث في اسم القسم يُهرَّب', () => {
        expect(renderCostAnalysisPrintHtml({ ...PAYLOAD, rows: [] }, OPTS)).not.toContain('بطاقات الأقسام');
        const evil = renderCostAnalysisPrintHtml({
            ...CARDS,
            rows: [{ ...CARDS.rows[0], name: '<img src=x onerror=alert(1)>' }],
        }, OPTS);
        expect(evil).not.toContain('<img src=x onerror=alert(1)>');
        expect(evil).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('مرآة البيع الخارجي تُطبع في الجدول وحده — لا بطاقة لها', () => {
        const html = renderCostAnalysisPrintHtml({
            ...CARDS,
            rows: [...CARDS.rows, {
                code: 'ys_b4_ext', name: 'مبيعات بيع خارجي', parent: null, external: true,
                rev: 766477.26, materials: 0, transfers: 0, countAdj: 0, operating: 0,
                exp: 0, profit: 766477.26, costRatio: 0, total: 0, rowCount: 0,
                own: { rev: 766477.26, exp: 0, profit: 766477.26, costRatio: 0, materials: 0, transfers: 0, countAdj: 0, operating: 0, rowCount: 0 },
            }],
        }, OPTS);
        expect(html.match(/مبيعات بيع خارجي/g)).toHaveLength(1);
        expect(html.match(/<article class="dcard/g)).toHaveLength(CARDS.rows.length);
        expect(sectionOf(html, 'تفصيل الأقسام')).toContain('766,477.26');
        /* وعدّاد النطاق أقسام حقيقية: المرآة سطر مراجعة لا قسم، وإلا قال
           المستند «١٧ قسم» تحت «١٦ بطاقة». */
        const range = html.match(/<b>النطاق<\/b><span>(\d+) قسم/);
        expect(Number(range[1])).toBe(CARDS.rows.length);
    });
});

describe('جدول الأقسام في الطباعة — كل صف برقم قسمه وحده', () => {
    const TABLE = {
        ...CARDS,
        totals: { ...CARDS.totals, rev: 900, mat: 300, cnt: 0, ops: 0, exp: 300, avgCost: 33.3 },
    };
    const NAMES = [['kitchen', 'المطبخ'], ['external_sales', 'قسم البيع الخارجي'], ['open_buffet', 'البوفيه المفتوح']];

    test('رؤوس الجدول موسومة بـ«القسم وحده» ومعها عمود الفروع', () => {
        const table = sectionOf(renderCostAnalysisPrintHtml(TABLE, OPTS), 'تفصيل الأقسام');
        expect(table).toContain('<th>إيراد القسم</th>');
        expect(table).toContain('<th>تكلفة القسم</th>');
        expect(table).toContain('مع فروعه');
    });

    test('المطبخ لا يحمل إيراد فروعه، والبيع الخارجي صف قائم وحده', () => {
        const table = sectionOf(renderCostAnalysisPrintHtml(TABLE, OPTS), 'تفصيل الأقسام');
        const kitchen = rowOf(table, 'المطبخ', 'kitchen');
        expect(kitchen).toContain('<td class="n">0.00</td>');
        expect(kitchen).not.toContain('900.00');
        expect(kitchen).toContain('<td class="n"><strong>120.00</strong></td>');
        expect(kitchen).toContain('مركز تكلفة');
        const ext = rowOf(table, 'قسم البيع الخارجي', 'external_sales');
        expect(ext).toContain('<td class="n">600.00</td>');
        expect(ext).toContain('<td class="n"><strong>180.00</strong></td>');
        expect(ext).toContain('مربح');
        /* الفروع المطبوعة تُذكر في عمود صريح، لا داخل رقم الأب. */
        expect(kitchen).toContain('إيراد 300.00 · تكلفة 120.00');
        expect(ext).toContain('<td class="n">—</td>');
    });

    test('مجموع صفوف الجدول = إجمالي الشركة: لا رقم يُقرأ مرّتين', () => {
        const table = sectionOf(renderCostAnalysisPrintHtml(TABLE, OPTS), 'تفصيل الأقسام');
        const money = (s) => Number(String(s).replace(/,/g, ''));
        const rev = NAMES.reduce((s, [, name]) => s + money(rowOf(table, name).match(/<td class="n">([\d,.]+)<\/td>/)[1]), 0);
        const exp = NAMES.reduce((s, [, name]) => s + money(rowOf(table, name).match(/<strong>([\d,.]+)<\/strong>/)[1]), 0);
        expect(rev).toBe(900);
        expect(exp).toBe(300);
    });
});

describe('مقارنة التكلفة بالفترة السابقة — على أرقام القسم وحده', () => {
    /* byDept شجري: مطبخ الأب يحمل تكلفة مستودعه معه، وownExp رقمه وحده. */
    const PREVIOUS = {
        from: '2026-09-01', to: '2026-09-23', days: 23, totalExp: 700,
        byDept: {
            kitchen: {
                materials: 700, transfers: 0, countAdj: 0, operating: 0, exp: 700,
                own: { materials: 500, transfers: 0, countAdj: 0, operating: 0, exp: 500 }, ownExp: 500,
            },
            store: {
                materials: 200, transfers: 0, countAdj: 0, operating: 0, exp: 200,
                own: { materials: 200, transfers: 0, countAdj: 0, operating: 0, exp: 200 }, ownExp: 200,
            },
        },
    };
    const withPrev = (previous) => ({ ...PAYLOAD, previous });

    test('كل سطر يقارن تكلفة قسمه وحده، والإجمالي بلا تضاعف', () => {
        const cmp = sectionOf(renderCostAnalysisPrintHtml(withPrev(PREVIOUS), OPTS), 'مقارنة التكلفة بالفترة السابقة');
        expect(cmp).toContain('تكلفة قسمه وحده سابقًا');
        expect(rowOf(cmp, 'المطبخ', 'kitchen')).toContain('<td class="n">500.00</td>');
        expect(rowOf(cmp, 'المطبخ', 'kitchen')).not.toContain('700.00');
        expect(rowOf(cmp, 'المخزن', 'store')).toContain('<td class="n">200.00</td>');
        expect(cmp).toContain('<td class="n">700.00</td>');
    });

    test('بناءٌ أقدم لا يعطي ownExp: تُخصم سابقات الأبناء من سابقة الأب', () => {
        const legacy = {
            ...PREVIOUS,
            byDept: Object.fromEntries(Object.entries(PREVIOUS.byDept).map(([k, v]) => [k, {
                materials: v.materials, transfers: 0, countAdj: 0, operating: 0, exp: v.exp,
            }])),
        };
        const cmp = sectionOf(renderCostAnalysisPrintHtml(withPrev(legacy), OPTS), 'مقارنة التكلفة بالفترة السابقة');
        expect(rowOf(cmp, 'المطبخ', 'kitchen')).toContain('<td class="n">500.00</td>');
    });
});
