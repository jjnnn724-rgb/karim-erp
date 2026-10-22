/**
 * v2-briefing.test.js — عقد شاشة «موجز المدير» الحية في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-branches.test.js: these are browser ESM
 * files and jest runs with testEnvironment:'node', so the repository is
 * loaded into a vm with its single dependency (apiFetch) stubbed, and the
 * screen is asserted as a source contract.
 *
 * What is pinned here is the part that cannot be eyeballed:
 *   • a percentage never appears without a real base — yesterday 0 gives a
 *     stated dash, not "100%" and not "∞"
 *   • colour carries good/bad, the arrow carries direction: an increase in
 *     expenses is red AND points up
 *   • comparisons only run against the same definition (no cancelled orders
 *     inside a "vs yesterday issued+reported" number)
 *   • the derived `draft` count is clamped at zero, and every null in the
 *     payload becomes 0 — never NaN on a manager's screen
 *   • the screen owns no network layer, has no inline handlers (CSP nonce),
 *     escapes every payload string, and fetches both sources with allSettled
 *     so one 403 still renders a dashboard that says what is missing
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'briefing-repo.js');
const SCREEN = path.join(V2, 'screens', 'briefing.js');
const PREVIEW = path.join(V2, 'preview.js');
const STATUS = path.join(V2, 'status.js');
const V2_HTML = path.join(APP, 'v2.html');

function loadEsm(file, injections = {}) {
    const src = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        encodeURIComponent, decodeURIComponent, TextDecoder, Uint8Array, Intl,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

/** A payload shaped exactly like backend/manager-briefing.js returns it. */
function briefingFixture() {
    return {
        day: '2026-10-13', yesterday: '2026-10-12', generatedAt: '2026-10-13T18:00:00.000Z',
        cashiers: [
            { code: 'D1', name: 'الصالة', invoices: 40, total: 9000 },
            { code: 'D2', name: 'التوصيل', invoices: 10, total: 2000 },
        ],
        cashiersTotal: { invoices: 50, total: 11000 },
        pos: { invoices: 44, total: 10000 },
        expenses: { count: 3, total: 1500 },
        stockOut: [{ id: 1, name: 'دجاج طازج', unit: 'كجم', qty: 0, min_qty: 5 }],
        stockLow: [],
        forecast: [{ id: 2, name: 'أرز', unit: 'كجم', qty: 20, avg_day: 8, days_cover: 2.5 }],
        attendance: { with_record: 30, checked_in: 25, missing_out: 4, missing_in: 1 },
        pending: { leavesPending: 2, unmappedSections: 0, reviewItems: 5, openShifts: 1 },
        cashiersY: { total: 10000, invoices: 45 },
        posY: { total: 9000, invoices: 40 },
        expensesY: { total: 1000 },
        payments: [{ method: 'cash', amount: 8000, count: 30 }, { method: 'stc_pay', amount: 2000, count: 9 }],
        week: { total: 77000, invoices: 350 },
        purchases: { n: 4, total: 5000 },
        topItems: [{ name: 'برجر', qty: 30, total: 4500 }, { name: 'بيتزا', qty: 20, total: 3000 }],
        purchasesY: { n: 2, total: 3000 },
        cashiersYDetail: { D1: { code: 'D1', invoices: 30, total: 6000 } },
        weekDaily: [
            { day: '2026-10-07', total: 10000, invoices: 40 },
            { day: '2026-10-13', total: 11000, invoices: 50 },
        ],
        syncHealth: { zkTotal: 4, zkOnline: 3, ysLog: { SUCCESS: 9, FAILED: 2 }, punchesToday: 60 },
    };
}

function statsFixture() {
    return {
        date: '2026-10-13',
        summary: {
            orders_count: 60, total_revenue: 12000, avg_order_value: 200,
            issued_count: 40, reported_count: 15, voided_count: 3,
            total_tax: 1800, total_discounts: 120,
        },
        department_breakdown: [{ department_name: 'الصالة', orders_count: 40, total_revenue: 9000 }],
        payment_breakdown: [{ method: 'cash', count: 30, total: 8000 }, { method: 'card', count: 10, total: 4000 }],
        recent_orders: [{
            id: 9, invoice_counter: 'INV-1', total_amount: 250, status: 'issued',
            created_at: '2026-10-13T15:04:00.000Z', department_name: 'الصالة', cashier_name: 'كاشير 1',
        }],
    };
}

function repoHarness() {
    const calls = [];
    const apiFetch = jest.fn(async (p, options = {}) => {
        calls.push({ path: p, options });
        if (p.startsWith('/manager/briefing')) {return briefingFixture();}
        if (p.startsWith('/pos/orders/stats/today')) {return statsFixture();}
        return { ok: true };
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }) };
}

describe('V2 briefing design layer — «السَنَد»', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const CSS = path.join(APP, 'css', 'v2', 'erp-briefing.css');
    const TOKENS = path.join(APP, 'css', 'v2', 'erp-tokens.css');
    const css = () => fs.readFileSync(CSS, 'utf8');

    test('the receipt device is markup, not an image or a hard-coded colour', () => {
        const s = screen();
        expect(s).toMatch(/class="erp-sand"/);
        expect(s).toMatch(/erp-sand__leader/);       // النقاط القاطعة
        expect(s).toMatch(/erp-sand__tear/);         // الحافة المسنّنة SVG
        expect(s).toMatch(/patternUnits="userSpaceOnUse"/); // سنّ بحجم ثابت لا يتمدد
        expect(css()).toMatch(/border-block-end: 0/);       // الورق لا يغلقه خط مستقيم
        expect(s).not.toMatch(/<img|url\(http/);
    });

    test('the stamp is only ever a cancelled invoice — an accounting act, not decoration', () => {
        const s = screen();
        expect(s).toMatch(/s\.known === true && s\.raw === 'cancelled'/);
        expect(s).toMatch(/class="erp-sand__stamp" role="img"/);
        expect(s.match(/erp-sand__stamp/g)).toHaveLength(1);
    });

    test('six portlets in the grid, the work list full-width below them', () => {
        const s = screen();
        const flow = s.slice(s.indexOf('const flow = ['), s.indexOf("].join('')"));
        expect((flow.match(/card\(/g) || []).length).toBe(5);
        expect(flow.match(/sandPortlet\(/g)).toHaveLength(1);
        expect(s).toMatch(/<div class="erp-dash-grid">\$\{flow\}<\/div>/);
        expect(s).toMatch(/cls: 'erp-brief__decisions'/);
    });

    test('the intro plays once: a manual refresh must not replay it', () => {
        const s = screen();
        expect(s).toMatch(/let introPending = true;/);
        expect(s).toMatch(/\{ animate: introPending \}/);
        expect(s).toMatch(/introPending = false;/);
    });

    test('no emoji in the interface — the empty state uses the icon set', () => {
        expect(screen()).not.toMatch(/✅|🎉|🔥|⭐/);
        expect(screen()).toMatch(/data-i="circle-check"/);
    });

    test('the design layer defines no colour value: every one is a token', () => {
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css()).not.toMatch(/rgba?\(/);
    });

    test('every token the design layer reads actually exists', () => {
        const defined = new Set(
            `${fs.readFileSync(TOKENS, 'utf8')}\n${css()}`
                .match(/--erp-[a-z0-9-]+(?=\s*:)/g) || [],
        );
        // Set by inline style from the screen, one per portlet.
        defined.add('--erp-rise-i');
        const used = [...css().matchAll(/var\((--erp-[a-z0-9-]+)/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(20);
        expect([...new Set(used)].filter((t) => !defined.has(t))).toEqual([]);
    });

    test('display faces are self-hosted Arabic files already in the repo, scoped narrow', () => {
        const faces = [...css().matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]);
        expect(faces).toEqual(expect.arrayContaining(['Amiri', 'Aref Ruqaa']));
        for (const src of css().matchAll(/url\(([^)]+\.woff2)\)/g)) {
            expect(src[1].startsWith('../../fonts/menu/')).toBe(true);
            expect(fs.existsSync(path.join(APP, 'css', 'v2', src[1]))).toBe(true);
        }
    });

    test('motion is opt-out and the page revision binds the new stylesheet', () => {
        expect(css()).toMatch(/prefers-reduced-motion: reduce/);
        expect(css()).toMatch(/animation: none/);
        const page = fs.readFileSync(V2_HTML, 'utf8');
        const ver = page.match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(page).toMatch(`css/v2/erp-briefing.css?v=${ver}`);
    });
});

describe('V2 briefing repository — honesty of the numbers', () => {

    test('a percentage needs a real base: yesterday 0 is a stated dash, never 100%', () => {
        const { repo } = repoHarness();
        const d = repo.deltaOf(5000, 0);
        expect(d.text).toBe('—');
        expect(d.sign).toBe('flat');
        expect(d.favor).toBe('flat');
        expect(d.aria).toMatch('لا مقارنة');
        expect(repo.deltaOf(5000, null).text).toBe('—');
    });

    test('colour judges the metric, the arrow reports the movement', () => {
        const { repo } = repoHarness();
        // Revenue up 10% → green, arrow up.
        const sales = repo.deltaOf(11000, 10000, 'higher');
        expect(sales).toMatchObject({ sign: 'up', favor: 'good', text: '10.0%' });
        // Expenses up 50% → RED but the arrow still points up.
        const cost = repo.deltaOf(1500, 1000, 'lower');
        expect(cost).toMatchObject({ sign: 'up', favor: 'bad' });
        // Expenses down → green.
        expect(repo.deltaOf(800, 1000, 'lower')).toMatchObject({ sign: 'down', favor: 'good' });
        expect(cost.aria).toMatch('ارتفع');
    });

    test('noBase is a pill that admits it has nothing to compare', () => {
        const { repo } = repoHarness();
        expect(repo.noBase('لا مقارنة')).toEqual({ sign: 'flat', favor: 'flat', text: '—', aria: 'لا مقارنة' });
    });

    test('buildKpis: six numbers, net is arithmetic on the two real ones', () => {
        const { repo } = repoHarness();
        const kpis = repo.buildKpis(briefingFixture(), statsFixture());
        expect(kpis).toHaveLength(6);
        expect(new Set(kpis.map((k) => k.id)).size).toBe(6);
        const net = kpis.find((k) => k.id === 'net');
        expect(net.value).toBe(repo.formatMoney(11000 - 1500));
        // net 9500 vs yesterday's 10000 − 1000 = 9000 → up, and up is good.
        expect(net.delta).toMatchObject({ sign: 'up', favor: 'good' });
        const att = kpis.find((k) => k.id === 'attendance');
        // The ratio rides as one LTR run — split in two, RTL prints it backwards.
        expect(att.value).toBe('25 / 30');
        expect(att.unit).toBe('');
        expect(att.delta.favor).toBe('flat');
        expect(kpis.find((k) => k.id === 'expenses').delta.favor).toBe('bad');
    });

    test('average ticket compares to the 7-day average of the same table', () => {
        const { repo } = repoHarness();
        const kpis = repo.buildKpis(briefingFixture(), statsFixture());
        const avg = kpis.find((k) => k.id === 'avg_ticket');
        // 77000 / 350 = 220 base, today 200 → down, and down on a ticket is bad.
        expect(avg.delta).toMatchObject({ sign: 'down', favor: 'bad' });
        expect(avg.delta.aria).toMatch('متوسط آخر ٧ أيام');
        expect(avg.hint).toMatch('220');
    });

    test('an empty payload yields zeros, never NaN', () => {
        const { repo } = repoHarness();
        const view = repo.buildBriefingView({});
        expect(JSON.stringify(view)).not.toMatch('NaN');
        expect(view.kpis.every((k) => k.delta && k.delta.text)).toBe(true);
        expect(view.sources).toEqual({ briefing: 'missing', stats: 'missing' });
        expect(view.pipeline.steps.map((s) => s.count)).toEqual([0, 0, 0]);
    });

    test('bars label themselves from the stored date, not from a locale', () => {
        const { repo } = repoHarness();
        const bars = repo.buildBars(briefingFixture());
        expect(bars[0]).toMatchObject({ date: '2026-10-07', label: '07/10', value: 10000 });
        expect(repo.buildBars({})).toEqual([]);
        expect(repo.buildBars({ weekDaily: [{ day: 'garbage', total: 1 }] })[0].label).toBe('garbage');
    });

    test('payments prefer POS rows, translate known methods, and keep unknown ones verbatim', () => {
        const { repo } = repoHarness();
        const fromStats = repo.buildPayments(briefingFixture(), statsFixture());
        expect(fromStats.map((p) => p.label)).toEqual(['نقدي', 'بطاقة']);
        expect(fromStats[0].value).toBe(8000);
        const onlyBriefing = repo.buildPayments(briefingFixture(), null);
        expect(onlyBriefing.map((p) => p.label)).toEqual(['نقدي', 'stc_pay']); // not relabelled into a guess
        expect(repo.buildPayments({ payments: [{ method: 'cash', amount: 0 }] }, null)).toEqual([]);
    });

    test('pipeline comes from the real enum and draft is clamped at zero', () => {
        const { repo } = repoHarness();
        const p = repo.buildPipeline(statsFixture());
        expect(p.steps).toEqual([
            { key: 'draft', label: 'مسودة', count: 2, state: 'todo' },
            { key: 'issued', label: 'صادرة', count: 40, state: 'current' },
            { key: 'reported', label: 'مُبلَّغة', count: 15, state: 'done' },
        ]);
        expect(p.voided).toBe(3);
        // orders_count inconsistent with the stage counts → never negative
        const clamped = repo.buildPipeline({ summary: { orders_count: 5, issued_count: 9, reported_count: 9, voided_count: 9 } });
        expect(clamped.steps[0].count).toBe(0);
    });

    test('departments each face their own yesterday, per code', () => {
        const { repo } = repoHarness();
        const rows = repo.buildDepartments(briefingFixture());
        expect(rows[0]).toMatchObject({ code: 'D1', total: 9000, hasBase: true });
        expect(rows[0].delta).toMatchObject({ sign: 'up', favor: 'good', text: '50.0%' });
        expect(rows[1].hasBase).toBe(false);          // D2 has no yesterday row → no invented delta
        expect(rows[1].delta.text).toBe('—');
    });

    test('alerts rank by severity and cap at six', () => {
        const { repo } = repoHarness();
        const alerts = repo.buildAlerts(briefingFixture());
        expect(alerts.length).toBeLessThanOrEqual(6);
        expect(alerts[0].tone).toBe('danger');       // نافذ + جهاز غير متصل يسبقان الإجازات
        expect(alerts.some((a) => a.text.includes('نافذ'))).toBe(true);
        expect(repo.buildAlerts({})).toEqual([]);
    });

    test('five best sellers by real line total, in the order the server ranked them', () => {
        const { repo } = repoHarness();
        const items = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, qty: 9 - i, total: 9 - i }));
        const tops = repo.buildTops({ topItems: items });
        expect(tops.map((t) => t.name)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
        expect(tops[0]).toEqual({ name: 'p0', value: 9, qty: 9 });
        expect(repo.buildTops({ topItems: [{ name: null, qty: null, total: null }] }))
            .toEqual([{ name: '—', value: 0, qty: 0 }]);
    });
});

describe('V2 briefing repository — the two doors', () => {
    test('briefing is fetched with an optional encoded date only', async () => {
        const { calls, repo } = repoHarness();
        await repo.fetchBriefing();
        await repo.fetchBriefing('2026 10/01');
        expect(calls[0].path).toBe('/manager/briefing');
        expect(calls[1].path).toBe('/manager/briefing?date=2026%2010%2F01');
        expect(calls[0].options.method).toBeUndefined(); // read, never write
    });

    test('POS stats path is the mounted router path', async () => {
        const { calls, repo } = repoHarness();
        await repo.fetchTodayStats();
        expect(calls[0].path).toBe('/pos/orders/stats/today');
    });

    test('a non-object response is null, not an empty object that renders zeros', async () => {
        const repo = loadEsm(REPO, { apiFetch: jest.fn(async () => undefined) });
        await expect(repo.fetchBriefing()).resolves.toBeNull();
        await expect(repo.fetchTodayStats()).resolves.toBeNull();
    });
});

describe('V2 briefing screen + host (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        // An attribute, not prose: the file header explains the rule and
        // quotes the syntax it forbids.
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/briefing-repo\.js\?v=/);
        expect(screen()).toMatch(/fetchBriefing\(\), fetchTodayStats\(\)/);
    });

    test('every payload string reaching the DOM is escaped', () => {
        expect(screen()).toMatch(/esc\(t\.name\)/);
        expect(screen()).toMatch(/esc\(o\.counter\)/);
        expect(screen()).toMatch(/esc\(d\.name\)/);
        expect(screen()).toMatch(/esc\(a\.text\)/);
    });

    test('movement is reported twice: colour and arrow, with an aria sentence', () => {
        const s = screen();
        expect(s).toMatch(/favor === 'good' \? 'erp-delta--up'/);
        expect(s).toMatch(/favor === 'bad' \? 'erp-delta--down'/);
        expect(s).toMatch(/sign === 'up' \? 'arrow-up'/);
        expect(s).toMatch(/aria-label="\$\{esc\(d\.aria\)\}"/);
    });

    test('the charts come from the engine, so a theme switch keeps them readable', () => {
        const s = screen();
        expect(s).toMatch(/from '\.\.\/charts\.js\?v=/);
        /* اللونُ شأنُ المحرّك: الشاشةُ تسمّي النغمةَ ولا تصبغ بنفسها. */
        expect(s).toMatch(/tone: `chart-/);
        expect(s).not.toMatch(/#[0-9a-f]{6}/i);
        /* ولا رسومَ مرسومةً باليد — كلُّها من المحرّك. */
        expect(s).not.toMatch(/erp-bars|erp-donut/);
    });

    test('one click cannot stack two loads, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{return;\}/);
        expect(s).toMatch(/el\.isConnected/);
    });

    test('both sources use allSettled and the missing one is named on screen', () => {
        const s = screen();
        expect(s).toMatch(/Promise\.allSettled/);
        expect(s).toMatch(/لم يستجب|استجابة فارغة/);
        expect(s).toMatch(/erp-error/);
    });

    test('no sample figures on the live screen — the label says where numbers come from', () => {
        const s = screen();
        expect(s).not.toMatch('بيانات نموذجية');
        expect(s).toMatch(/مباشر من قاعدة البيانات|مصدر الأرقام/);
    });

    test('the host maps the executive nav key to the briefing screen and tears it down', () => {
        const p = fs.readFileSync(PREVIEW, 'utf8');
        expect(p).toMatch(/key === 'cfo'/);
        expect(p).toMatch(/renderBriefingScreen\(\)/);
        expect(p).toMatch(/teardownBriefingScreen\(\)/);
        expect(p).toMatch(/briefingScreen \|\| hrDashboardScreen/);
        expect(p).toMatch(/deptHeadDashScreen\s*\|\|\s*branchesScreen/);
        expect(p).toMatch(/noSessionState\('الموجز'\)/);
    });

    test('the five POS invoice states match the database enum', () => {
        const s = fs.readFileSync(STATUS, 'utf8');
        for (const v of ['draft', 'issued', 'reported', 'failed', 'cancelled']) {
            expect(s).toMatch(`'pos_order:${v}'`);
        }
        expect(s).toMatch(/003_cashier_module\.sql/);
    });

    test('every V2 module specifier carries the page revision (no stale JS)', () => {
        const page = fs.readFileSync(V2_HTML, 'utf8');
        const ver = page.match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        const files = [];
        (function walk(dir) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) {walk(p);} else if (entry.name.endsWith('.js')) {files.push(p);}
            }
        })(V2);
        const drifting = [];
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            for (const m of src.matchAll(/from\s*'(\.[^']*?)'/g)) {
                if (!m[1].endsWith(`.js?v=${ver}`)) {drifting.push(`${path.relative(V2, f)} → ${m[1]}`);}
            }
        }
        expect(drifting).toEqual([]);
    });
});
