/**
 * v2-executive-live.test.js — عقد لوحة القيادة الحية (Gate D)
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت:
 *   • مستودع واحد يقرأ /executive/summary فقط ولا يكتب أبدًا
 *   • نسبة بلا أساس = null (تُطبع «—») لا صفرًا يبدو كبيانات حقيقية
 *   • الأرقام/التقسيمات تُمرَّر كما وصلت من الخادم بلا تقريب مخفي
 *   • كاش ٣٠ ثانية + إلغاء ازدواج الطلب: نقرة تحديث لا تعني طلبًا جديدًا
 *   • الشاشة تعيد الرسم من الخادم، والمعاينة تمرّر التنقل لأزرار الإجراء
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'frontend', 'app', 'js', 'v2');
const read = (p) => fs.readFileSync(p, 'utf8');
const REPO_SRC = read(path.join(V2, 'data', 'executive-repo.js'));

function loadRepo(apiFetch) {
    const src = REPO_SRC
        .replace(/^import[^\n]*\n/gm, '')
        .replace(/^export\s+/gm, '');
    const ctx = {
        apiFetch,
        console, Promise, Date, Math, Number, String, Array, Object, JSON,
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'executive-repo.js' });
    return ctx;
}

const PAYLOAD = {
    day: '2026-11-06',
    postedToday: 9,
    kpi: {
        revenue: 12000, cogs: 4500, net: 5200, margin: 43.333,
        cash: 87000, openShifts: 2, negativeStock: 4,
    },
    series: [
        { day: '2026-11-05', revenue: 11000, cost: 4200, net: 5000 },
        { day: '2026-11-06', revenue: 12000, cost: 4500, net: 5200 },
    ],
    cash: [
        { code: '1010', name: 'الصندوق', balance: 5000 },
        { code: '1020', name: 'البنك', balance: -1200 },
    ],
    topDepts: [{ name: 'المطبخ', total: 3000 }, { name: 'الصالة', total: 9000 }],
    topItems: [{ name: 'مندي لحم', qty: 12, total: 900 }],
    alerts: [{ severity: 'high', title: 'لا إقفال', detail: 'أقفل الصندوق', action: { label: 'فتح', screen: 'cfo' } }],
};

describe('buildLiveBoard — تمرير أمين لأرقام الخادم', () => {
    const R = loadRepo(async () => PAYLOAD);
    const board = R.buildLiveBoard(PAYLOAD);

    test('المؤشرات الثمانية تُبنى من نفس الحقول', () => {
        expect(board.kpis).toHaveLength(8);
        expect(board.kpi.revenue).toBe(12000);
        expect(board.kpi.cash).toBe(87000);
        expect(board.kpis[0].value).toBe('12,000');
        expect(board.kpis[3].value).toBe('43.3%');
    });

    test('نسبة تكلفة البضاعة من الإيراد، وبلا أساس = null', () => {
        expect(board.costRatio).toBe(37.5);
        expect(R.buildLiveBoard({ kpi: { revenue: 0, cogs: 500 } }).costRatio).toBeNull();
        expect(R.buildLiveBoard({}).costRatio).toBeNull();
    });

    test('التقسيمات تحمل توكنات الرسم ولا تُختلق صفوفًا', () => {
        expect(board.departments[0]).toEqual({ label: 'المطبخ', value: 3000, tone: 'chart-1' });
        expect(board.cash[1].value).toBe(1200); // رصيد سالب ⇒ قيمة مطلقة للقرص
        expect(R.buildLiveBoard({}).departments).toEqual([]);
        expect(R.buildLiveBoard({}).alerts).toEqual([]);
    });

    test('محور الزمن يقصر اليوم إلى MM-DD ويحفظ الإيراد والتكلفة', () => {
        expect(board.trend[0]).toEqual({ day: '11-05', revenue: 11000, cost: 4200, net: 5000 });
    });

    test('التنبيهات تحمل إجراءً قابلًا للنقر فقط إن أعطى الخادم شاشة', () => {
        expect(board.alerts[0].action).toEqual({ label: 'فتح', screen: 'cfo' });
        expect(R.buildLiveBoard({ alerts: [{ severity: 'low', title: 'x' }] }).alerts[0].action).toBeNull();
    });
});

describe('fetchExecutiveSummary — كاش وتزامن', () => {
    test('نداءَان متتاليان = طلب واحد داخل نافذة الكاش', async () => {
        let calls = 0;
        const R = loadRepo(async () => { calls += 1; return PAYLOAD; });
        await R.fetchExecutiveSummary({ days: 14 });
        await R.fetchExecutiveSummary({ days: 14 });
        expect(calls).toBe(1);
    });

    test('force يتجاوز الكاش، ونداءَان متوازيان يتشاركان الرحلة', async () => {
        let calls = 0;
        const R = loadRepo(() => new Promise((resolve) => {
            calls += 1;
            setTimeout(() => resolve(PAYLOAD), 5);
        }));
        await Promise.all([R.fetchExecutiveSummary(), R.fetchExecutiveSummary()]);
        expect(calls).toBe(1);
        await R.fetchExecutiveSummary({ force: true });
        expect(calls).toBe(2);
    });

    test('الفترة تُقيَّد بين ٧ و٣١ يومًا كما يقيدها الخادم', async () => {
        const seen = [];
        const R = loadRepo(async (p) => { seen.push(p); return PAYLOAD; });
        await R.fetchExecutiveSummary({ days: 2 });
        await R.fetchExecutiveSummary({ days: 90, force: true });
        expect(seen[0]).toContain('/executive/summary?days=7');
        expect(seen[1]).toContain('/executive/summary?days=31');
    });

    test('فشل الخادم ينتقل للمستدعي بدل لوحة أصفار', async () => {
        const R = loadRepo(async () => { throw new Error('403'); });
        await expect(R.fetchExecutiveSummary()).rejects.toThrow('403');
    });
});

describe('العقد المصدري — لا كتابة ولا استقصاء', () => {
    test('المستودع قراءة فقط ويستعمل عميل الـAPI الموحّد', () => {
        expect(REPO_SRC).toContain("from '../../core/api.js?v=");
        expect(REPO_SRC).toContain('/executive/summary?days=');
        expect(REPO_SRC).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/);
        expect(REPO_SRC).not.toMatch(/setInterval|setTimeout/);
    });

    test('لوحة القيادة تقرأ المستودع ولا تفتح الشبكة بنفسها', () => {
        const screen = read(path.join(V2, 'screens', 'dashboard.js'));
        expect(screen).toContain("from '../data/executive-repo.js?v=");
        expect(screen).toContain('fetchExecutiveSummary(');
        expect(screen).not.toMatch(/\bfetch\s*\(/);
        expect(screen).not.toMatch(/\bapiFetch\s*\(/);
        expect(screen).not.toMatch(/setInterval/);
        // الحالة الحية تُعلن مصدرها، والفشل يُعلن نفسه بدل أصفار
        expect(screen).toContain('بيانات حية');
        expect(screen).toContain('تعذّر قراءة السجل الحي');
    });

    test('المعاينة تمرّر التنقل إلى أزرار الإجراء في اللوحة', () => {
        const preview = read(path.join(V2, 'preview.js'));
        expect(preview).toContain('renderDashboard(shell.main.querySelector(\'[data-erp-dash]\'), { statusBadge, navigate: (key) => shell.navigate(key) })');
    });
});
