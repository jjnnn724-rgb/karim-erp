/**
 * v2-charts.test.js — عقد طبقة الرسوم P2-6
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت:
 *   • SVG نقي بلا مكتبة: لا Chart.js ولا fetch ولا DOM في charts.js
 *   • كل رقم له <title> نصّي، وكل تسمية مُهرَّبة (HTML injection)
 *   • «لا بيانات» تُقال وتُعرض — لا رسم مسطّح يوهم بصفر
 *   • الشاشات الثلاث تستورد الطبقة وتملك مضيف الرسم، والوسم 4.9.145
 *   • نافذة حضور HR = 7 أيام فعلًا (المستودع) لا اليوم فقط
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const read = (p) => fs.readFileSync(p, 'utf8');
const REV = (read(path.join(APP, 'v2.html')).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadCharts() {
    const src = read(path.join(V2, 'charts.js')).replace(/^export\s+/gm, '');
    const ctx = { console, Intl, Math, Number, String, Array, Object, RegExp, JSON, Error };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'charts.js' });
    return ctx;
}

describe('charts.js — رياضيات المحور والهرمية', () => {
    const C = loadCharts();

    test('axisMax يقرّب إلى 1/2/5 والمدخل الفاسد لا ينتج NaN', () => {
        expect(C.axisMax(0)).toBe(1);
        expect(C.axisMax(-7)).toBe(1);
        expect(C.axisMax(87)).toBe(100);
        expect(C.axisMax(230)).toBe(500);
        expect(C.axisMax('x')).toBe(1);
        expect(Number.isFinite(C.axisMax(123456))).toBe(true);
    });
});

describe('الأعمدة', () => {
    const C = loadCharts();

    test('يرسم مجموعة لكل سلسلة ولكل تسمية، ويهرّب النص', () => {
        const html = C.barChart({
            title: 'اختبار',
            ariaLabel: 'أعمدة اختبار',
            labels: ['<b>A</b>', 'ب'],
            series: [
                { label: 'إيراد', tone: 'success', values: [10, 20] },
                { label: 'تكلفة', tone: 'danger', values: [5, 0] },
            ],
            formatValue: (v) => `${v} ر.س`,
        });
        expect(html).toContain('role="img"');
        expect(html).toContain('أعمدة اختبار');
        expect(html).toContain('&lt;b&gt;A&lt;/b&gt;');
        expect(html).not.toContain('<b>A</b>');
        expect(html.match(/<rect /g)).toHaveLength(4);
        expect(html).toContain('إيراد: 10 ر.س');
        expect(html).not.toMatch(/NaN|undefined/);
    });

    test('صفر كامل أو بلا تسميات = رسالة فراغ صريحة', () => {
        const zero = C.barChart({ labels: ['أ'], series: [{ label: 'س', values: [0] }], emptyText: 'لا شيء' });
        expect(zero).toContain('erp-chart__empty');
        expect(zero).toContain('لا شيء');
        expect(zero).not.toContain('<rect ');
        expect(C.barChart({ labels: [], series: [] })).toContain('erp-chart__empty');
    });
});

describe('الخط', () => {
    const C = loadCharts();

    test('مسار لكل سلسلة ونقاط قصيرة، بلا NaN', () => {
        const html = C.lineChart({
            title: 'اتجاه', ariaLabel: 'خط اختبار',
            labels: ['a', 'b', 'c'],
            series: [
                { label: 'أ', tone: 'brand', values: [1, 5, 3] },
                { label: 'ب', tone: 'info', values: [0, 2, 4] },
            ],
            formatValue: (v) => String(v),
        });
        expect(html.match(/<path /g).length).toBeGreaterThanOrEqual(2);
        expect(html.match(/<circle /g)).toHaveLength(6);
        expect(html).not.toMatch(/NaN|Infinity/);
    });

    test('السلسلة الطويلة لا ترسم مئات النقاط (قراءة تبقى نظيفة)', () => {
        const values = Array.from({ length: 366 }, (_, i) => i);
        const html = C.lineChart({ labels: values.map(String), series: [{ label: 'يومي', values }] });
        expect(html).not.toMatch(/<circle /);
        expect(html).toContain('<path ');
    });
});

describe('الدائري', () => {
    const C = loadCharts();

    test('نسب مشتقة من المجموع، والمركز يعرض الإجمالي', () => {
        const html = C.donutChart({
            title: 'توزيع',
            ariaLabel: 'دائري اختبار',
            slices: [{ label: 'أ', value: 10 }, { label: 'ب', value: 20 }, { label: 'ج', value: 30 }],
            centerLabel: 'الإجمالي',
            formatValue: (v) => String(v),
        });
        expect(html).toContain('16.7%');
        expect(html).toContain('33.3%');
        expect(html).toContain('50.0%');
        expect(html).toContain('>60<');
        expect(html).toContain('الإجمالي');
        expect(html.match(/<circle /g)).toHaveLength(4); // خلفية + 3 شرائح
    });

    test('الشرائح الزائدة تُدمج في «أخرى» والكل صفر = فراغ', () => {
        const html = C.donutChart({
            slices: [1, 2, 3, 4, 5].map((v, i) => ({ label: `ص${i}`, value: v })),
            maxSlices: 3,
        });
        expect(html).toContain('أخرى');
        expect(html.match(/<circle /g)).toHaveLength(4); // خلفية + 3
        const empty = C.donutChart({ slices: [{ label: 'صفر', value: 0 }], emptyText: 'لا تصنيفات' });
        expect(empty).toContain('لا تصنيفات');
        expect(empty).toContain('erp-chart__empty');
    });
});

describe('العقد المصدري — لا مكتبة ولا شبكة ولا حقن', () => {
    const charts = read(path.join(V2, 'charts.js'));

    test('charts.js نقي: لا fetch/apiFetch/Chart.js/DOM/تخزين', () => {
        expect(charts).not.toMatch(/\b(fetch|apiFetch)\s*\(/);
        expect(charts).not.toContain('new Chart');
        expect(charts).not.toMatch(/document\.|window\.|localStorage/);
        expect(charts).not.toMatch(/https?:\/\//);
    });

    test('الشاشات الثلاث تستورد الطبقة وتملك المضيف ولا تنشئ Chart', () => {
        for (const name of ['pnl', 'cost-analysis', 'hr-dashboard']) {
            const src = read(path.join(V2, 'screens', `${name}.js`));
            expect(src).toContain(`from '../charts.js?v=${REV}'`);
            expect(src).toContain('data-v2-charts');
            expect(src).not.toContain('new Chart');
            expect(src).not.toMatch(/\bfetch\s*\(/);
            expect(src).not.toMatch(/\son(click|change|submit|input)=/i);
            expect(src).toContain('chartsEl.innerHTML');
        }
    });

    test('نافذة HR: المستودع يجلب 7 أيام ويصدّر الحسابين', () => {
        const repo = read(path.join(V2, 'data', 'hr-dashboard-repo.js'));
        expect(repo).toContain('fetchAttendanceRange({ from: shiftDay(day, -6), to: day })');
        expect(repo).toContain('export function weeklyAttendance');
        expect(repo).toContain('export function departmentDistribution');
    });

    test('ورقة الرسوم مرتبطة بمراجعة الصفحة وكل قيمها رموز', () => {
        const html = read(path.join(APP, 'v2.html'));
        expect(html).toMatch(new RegExp(`css/v2/erp-charts\\.css\\?v=${REV.replace(/\./g, '\\.')}`));
        const css = read(path.join(APP, 'css', 'v2', 'erp-charts.css'));
        expect(css).toContain('.erp-chart');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/https?:\/\//);
    });
});
