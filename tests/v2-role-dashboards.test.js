/**
 * v2-role-dashboards.test.js — عقد لوحات الأدوار P2-7
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت:
 *   • خريطة الدور → اللوحة = خريطة القديم (dashboard.js:127-133)
 *   • رياضيات اللوحات الثلاث: نسبة بلا أساس = null لا 0%، والفلاتر
 *     المنفصلة تُجمع كما يجمعها الخادم، وصفوف القسم تُفلتر بمرآة deptsMatch
 *   • الشاشات لا تفتح شبكة بنفسها ولا تستخدم onclick، وتنظّف نفسها
 *   • المعاينة توجّه كل دور إلى لوحته وتدمّرها عند التنقل
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const read = (p) => fs.readFileSync(p, 'utf8');
const REV = (read(path.join(APP, 'v2.html')).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadRoleMap() {
    const src = read(path.join(V2, 'role-dashboard.js')).replace(/^export\s+/gm, '');
    const ctx = { String };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'role-dashboard.js' });
    return ctx;
}

const rowDeptMatches = (user, row) => {
    const codes = String((user && user.deptCode) || '').split(',')
        .map((s) => s.trim().toLowerCase()).filter(Boolean);
    return codes.length > 0 && codes.includes(String((row && row.deptCode) || '').trim().toLowerCase());
};

function loadRepo() {
    const src = read(path.join(V2, 'data', 'dashboard-repo.js'))
        .replace(/^import[^\n]*\n/gm, '')
        .replace(/^export\s+/gm, '');
    const ctx = {
        console, Math, Number, String, Array, Object, JSON,
        rowDeptMatches,
        itemsSummary: (items) => (Array.isArray(items) ? items.map((i) => i.itemName).join('، ') : ''),
        chainStage: (row) => `stage:${row.status}`,
        stockState: (qty, _min) => ({ key: Number(qty) <= 0 ? 'out' : 'low', label: Number(qty) <= 0 ? 'نفد' : 'تحت الحد' }),
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'dashboard-repo.js' });
    return ctx;
}

describe('خريطة الدور → اللوحة', () => {
    const R = loadRoleMap();

    test('الدورات الخمسة لها لوحات، والبقية للوحة التنفيذية', () => {
        expect(R.dashboardKind('hr')).toBe('hr');
        expect(R.dashboardKind('employee')).toBe('employee');
        expect(R.dashboardKind('accountant')).toBe('accountant');
        expect(R.dashboardKind('warehouse')).toBe('warehouse');
        expect(R.dashboardKind('dept_head')).toBe('dept-head');
        expect(R.dashboardKind('admin')).toBe('briefing');
        expect(R.dashboardKind('manager')).toBe('briefing');
        expect(R.dashboardKind(null)).toBe('briefing');
        expect(R.dashboardKind('cashier')).toBe('briefing');
    });
});

describe('لوحة المحاسب — من قائمة الدخل', () => {
    const D = loadRepo();
    const snapshot = {
        pnl: {
            period: { from: '2026-10-01', to: '2026-10-17' },
            statement: {
                revenue: { total: 1000, invoice_count: 40, manual_count: 2 },
                cogs: { net: 400 },
                operating: { total: 200 },
                payroll: { total: 100 },
                shrinkage: { amount: 10 },
                net_profit: { amount: 300 },
                daily_series: [{ date: '2026-10-16', revenue: 500, cogs: 200, opex: 50 }],
                by_department: [{ code: 'K', name: 'المطبخ', revenue: 700, cogs: 250, net: 200 }],
            },
        },
        latestRevenues: [{ id: 1, source: 'كاشير', date: '2026-10-17T00:00:00', amount: 120 }],
        latestExpenses: [{ id: 2, desc: 'خضار', category: 'مواد', date: '2026-10-17', amount: 30 }],
        currency: 'ر.س',
        failures: ['العملة'],
    };

    test('التكلفة = الإيراد − صافي الربح، والنسب حقيقية', () => {
        const v = D.buildAccountantView(snapshot);
        expect(v.totals.revenue).toBe(1000);
        expect(v.totals.profit).toBe(300);
        expect(v.totals.cost).toBe(700);
        expect(v.totals.margin).toBeCloseTo(30);
        expect(v.totals.costRatio).toBeCloseTo(70);
        expect(v.daily[0].cost).toBe(250);
        expect(v.latestRevenues[0].label).toBe('كاشير');
        expect(v.latestRevenues[0].date).toBe('2026-10-17');
        expect(v.latestExpenses[0].label).toBe('خضار');
        expect(v.failures).toEqual(['العملة']);
    });

    test('صفر إيراد = نسبة null (تُعرض «—») لا 0%', () => {
        const v = D.buildAccountantView({
            pnl: { statement: { revenue: { total: 0 }, net_profit: { amount: 0 } } },
        });
        expect(v.totals.margin).toBeNull();
        expect(v.totals.costRatio).toBeNull();
        expect(v.daily).toEqual([]);
        expect(v.latestRevenues).toEqual([]);
    });

    test('فشل قائمة الدخل يُعلن ولا يُحوَّل إلى أصفار', () => {
        const v = D.buildAccountantView({ pnlError: { message: 'FORBIDDEN' }, failures: ['قائمة الدخل'] });
        expect(v.hasPnl).toBe(false);
        expect(v.pnlFailed).toBe(true);
        expect(v.pnlMessage).toBe('FORBIDDEN');
        expect(v.totals.revenue).toBe(0);
        expect(v.failures).toEqual(['قائمة الدخل']);
    });
});

describe('لوحة المخزن — فلاتر الخادم المنفصلة', () => {
    const D = loadRepo();
    const snapshot = {
        low: { total: 5, rows: [{ id: 2, name: 'طماطم', qty: 2, minQty: 5, unit: 'كجم' }] },
        out: { total: 2, rows: [{ id: 1, name: 'زيت', qty: 0, minQty: 4, unit: 'لتر' }] },
        all: { total: 100, rows: [] },
        dispatches: [
            { status: 'pending', needsChefApproval: true },
            { status: 'pending', needsChefApproval: false },
            { status: 'chef_approved' },
            { status: 'received' },
        ],
        purchaseRequests: [{ status: 'pending' }, { status: 'approved' }, { status: 'chef_approved' }],
        failures: ['أذونات الصرف'],
    };

    test('متوفر = الكل − تحت الحد − نافد، والطوابير من الحالات المخزنة', () => {
        const v = D.buildWarehouseView(snapshot);
        expect(v.stock).toEqual({ known: true, low: 5, out: 2, ok: 93, total: 100 });
        expect(v.queues.chef).toBe(1);
        expect(v.queues.warehouse).toBe(2);
        expect(v.queues.purchase).toBe(2);
        expect(v.lowRows.map((r) => r.id)).toEqual([1, 2]); // الأنقص كمية أولًا
        expect(v.lowRows[0].state.key).toBe('out');
        expect(v.failures).toEqual(['أذونات الصرف']);
    });

    test('مصدر مخزون ناقص = known=false ولا أعداد ملفّقة', () => {
        const v = D.buildWarehouseView({ low: { total: 5, rows: [] }, all: { total: 100, rows: [] } });
        expect(v.stock.known).toBe(false);
        expect(v.stock.out).toBeNull();
        expect(v.stock.ok).toBeNull();
    });
});

describe('لوحة رئيس القسم — نطاق القسم', () => {
    const D = loadRepo();
    const snapshot = {
        dispatches: [
            { id: 1, deptCode: 'K', status: 'pending', needsChefApproval: true, items: [{ itemName: 'أرز' }] },
            { id: 2, deptCode: 'K', status: 'chef_approved', items: [] },
            { id: 3, deptCode: 'K', status: 'approved', items: [] },
            { id: 4, deptCode: 'X', status: 'pending', needsChefApproval: true, items: [] },
        ],
        panel: {
            department: { name: 'المطبخ' },
            subDepartments: [{ code: 'K2', name: 'الحلويات' }],
            expenses: {
                total: 500,
                count: 3,
                labels: { dispatch: 'صرف مخزني', manual: 'يدوي' },
                bySource: {
                    dispatch: { total: 600, count: 2 },
                    manual: { total: -100, count: 1 },
                },
            },
        },
        currency: 'ر.س',
        failures: [],
    };

    test('الفلترة بمرآة deptsMatch والعدادات من الصفوف نفسها', () => {
        const v = D.buildDeptHeadView(snapshot, { deptCode: 'K' });
        expect(v.deptName).toBe('المطبخ');
        expect(v.counts.chef).toBe(1);
        expect(v.counts.warehouse).toBe(1);
        expect(v.counts.receive).toBe(1);
        expect(v.counts.received).toBe(0);
        expect(v.cost).toBe(500);
        expect(v.sources[0]).toMatchObject({ key: 'dispatch', label: 'صرف مخزني', total: 600 });
        expect(v.sources[1].total).toBe(-100);
        expect(v.subDepartments).toHaveLength(1);
        expect(v.recent.map((r) => r.id)).toEqual([3, 2, 1]); // الأحدث أولًا
        expect(v.recent[2].itemsText).toBe('أرز');
        expect(v.statusSlices.reduce((s, x) => s + x.value, 0)).toBe(3);
        expect(v.currency).toBe('ر.س');
    });

    test('فشل لوحة القسم = كلفة null لا صفر', () => {
        const v = D.buildDeptHeadView({ dispatches: [], panel: null, failures: ['لوحة القسم'] }, { deptCode: 'K' });
        expect(v.cost).toBeNull();
        expect(v.costCount).toBeNull();
        expect(v.panelFailed).toBe(true);
        expect(v.sources).toEqual([]);
    });

    test('dept_code المفصول بفواصل يقرأ أكثر من قسم', () => {
        const v = D.buildDeptHeadView(snapshot, { deptCode: 'K, K2' });
        expect(v.counts.chef).toBe(1);
        expect(v.recent).toHaveLength(3);
    });
});

describe('العقد المصدري — شاشات P2-7', () => {
    const screens = ['accountant-dashboard', 'warehouse-dashboard', 'dept-head-dashboard'];
    const dashboardRepo = read(path.join(V2, 'data', 'dashboard-repo.js'));

    test('المستودع يقرأ الأبواب المعروفة فقط ولا يكتب', () => {
        expect(dashboardRepo).toContain("fetchNewest('revenues', 6)");
        expect(dashboardRepo).toContain("fetchNewest('expenses', 6)");
        expect(dashboardRepo).toContain("fetchInventory({ stock: 'low', maxPages: 1 })");
        expect(dashboardRepo).toContain("apiFetch('/warehouse/dept-panel')");
        expect(dashboardRepo).toContain("from './finance-repo.js?v=" + REV + "'");
        expect(dashboardRepo).not.toMatch(/method:\s*['"](POST|PUT|DELETE)/);
    });

    test('كل شاشة: بلا شبكة، بلا onclick، تنظيف عند المغادرة', () => {
        for (const name of screens) {
            const src = read(path.join(V2, 'screens', `${name}.js`));
            expect(src).toContain(`from '../data/dashboard-repo.js?v=${REV}'`);
            expect(src).not.toMatch(/\bfetch\s*\(/);
            expect(src).not.toMatch(/\bapiFetch\s*\(/);
            expect(src).not.toContain('new Chart');
            expect(src).not.toMatch(/\son(click|change|submit|input)=/i);
            expect(src).toContain('destroy()');
            expect(src).toContain('isConnected');
            expect(src).toContain('data-v2-go');
        }
    });

    test('جذر واحد لكل شاشة: القالب كله داخل حاوية واحدة', () => {
        for (const name of screens) {
            const src = read(path.join(V2, 'screens', `${name}.js`));
            expect(src).toContain('<div class="erp-v2-role-dash">');
            expect(src).toContain('const el = host.lastElementChild;');
        }
    });

    test('سقوط قائمة الدخل يعرض «—» لا صفرًا', () => {
        const src = read(path.join(V2, 'screens', 'accountant-dashboard.js'));
        expect(src).toContain('const noPnl = !v.hasPnl');
        expect(src).toContain('noPnl ? missing');
        expect(src).toContain('لا صفر مكانها');
    });

    test('أحدث أذونات القسم جدول النظام القياسي القابل للتمرير', () => {
        const src = read(path.join(V2, 'screens', 'dept-head-dashboard.js'));
        expect(src).toContain('erp-table__scroll');
        expect(src).toContain('erp-table__grid');
        expect(src).not.toContain('class="erp-table"');
    });

    test('المعاينة توجّه الأدوار وتدمّر لوحاتها', () => {
        const preview = read(path.join(V2, 'preview.js'));
        expect(preview).toContain('dashboardKind(session.role)');
        for (const mount of ['mountHrDashboardScreen', 'mountEmployeePortalScreen',
            'mountAccountantDashboardScreen', 'mountWarehouseDashboardScreen', 'mountDeptHeadDashboardScreen']) {
            expect(preview).toContain(`${mount}(host, ctx)`);
        }
        expect(preview).toContain('teardownAccountantScreen()');
        expect(preview).toContain('teardownWarehouseDashScreen()');
        expect(preview).toContain('teardownDeptHeadDashScreen()');
        expect(preview).toContain('navigate: (key) => shell.navigate(key)');
    });

    test('fetchNewest يقرأ صفحة الأحدث فقط', () => {
        const repo = read(path.join(V2, 'data', 'finance-repo.js'));
        expect(repo).toContain('export async function fetchNewest');
        expect(repo).toContain('sort=id&order=desc');
    });
});
