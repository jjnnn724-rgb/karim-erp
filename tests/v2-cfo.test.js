/**
 * v2-cfo.test.js — عقد شاشة المدير المالي ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/accounting-routes.js (:26-27 READ/WRITE، :422/:463/:488/
 *   :506/:526/:550/:583) + accounting-periods.js (:58/:82/:109/:139/:186/
 *   :229) + accounting-growth.js (:55/:84/:135/:157/:188/:230/:249/:270/
 *   :288/:301/:322/:341) + budget-alerts.js (:49/:70/:117/:253/:261) +
 *   cashier-module/shift-routes.js (:880) + day-close-routes.js (:88/:117).
 * المرجع الثاني: frontend/app/js/features/cfo.js (477 سطرًا) — نفس الأقسام
 * والحمولات والجمل، بلا حوارات حاجبة (نماذج سطرية بدلها).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'cfo-repo.js');
const SCREEN = path.join(V2, 'screens', 'cfo.js');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ROUTES = path.join(__dirname, '..', 'backend', 'accounting-routes.js');
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];
const read = (p) => fs.readFileSync(p, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

describe('CFO — مرآة الخادم', () => {
    test('بوابات القراءة/الكتابة مرايا حرفية', () => {
        const srv = read(ROUTES);
        expect(srv).toMatch(/const READ_ROLES = \['admin', 'accountant', 'manager', 'auditor'\]/);
        expect(srv).toMatch(/const WRITE_ROLES = \['admin', 'accountant'\]/);
        const ctx = loadEsm(REPO, {}, ['CFO_READ_ROLES', 'CFO_WRITE_ROLES']);
        expect(ctx.CFO_READ_ROLES).toEqual(['admin', 'accountant', 'manager', 'auditor']);
        expect(ctx.CFO_WRITE_ROLES).toEqual(['admin', 'accountant']);
    });

    test('أبواب القراءة تطابق الراوتر مساراً', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchCfoSummary', 'fetchTrialBalance', 'fetchJournal', 'fetchChart',
            'fetchPeriods', 'fetchBalanceSheet', 'fetchCashFlow', 'fetchProfitByCC',
            'fetchApAging', 'fetchAssets', 'fetchCustody', 'fetchAlertsLog',
            'fetchBudgetVsActual', 'fetchOpenShifts', 'dayCloseStatus',
        ]);
        await ctx.fetchCfoSummary('2026-10-01', '2026-10-15');
        await ctx.fetchTrialBalance('2026-10-01', '2026-10-15');
        await ctx.fetchJournal(30);
        await ctx.fetchChart();
        await ctx.fetchPeriods();
        await ctx.fetchBalanceSheet('2026-10-15');
        await ctx.fetchCashFlow('2026-10-01', '2026-10-15');
        await ctx.fetchProfitByCC('2026-10-01', '2026-10-15');
        await ctx.fetchApAging();
        await ctx.fetchAssets();
        await ctx.fetchCustody();
        await ctx.fetchAlertsLog();
        await ctx.fetchBudgetVsActual('2026-10');
        await ctx.fetchOpenShifts();
        await ctx.dayCloseStatus();
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /accounting/cfo-summary?from=2026-10-01&to=2026-10-15',
            'GET /accounting/trial-balance?from=2026-10-01&to=2026-10-15',
            'GET /accounting/journal?limit=30',
            'GET /accounting/chart',
            'GET /accounting/periods',
            'GET /accounting/balance-sheet?as_of=2026-10-15',
            'GET /accounting/cash-flow?from=2026-10-01&to=2026-10-15',
            'GET /accounting/profit-by-cost-center?from=2026-10-01&to=2026-10-15',
            'GET /accounting/ap-aging',
            'GET /accounting/fixed-assets',
            'GET /accounting/cash-custody',
            'GET /accounting/alerts/log',
            'GET /accounting/budget-vs-actual?period=2026-10',
            'GET /pos/shifts/open',
            'GET /pos/day-close/status',
        ]);
    });

    test('أبواب الكتابة تطابق الراوتر مساراً وطريقة وحمولة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'createJournal', 'approveJournal', 'voidJournal', 'postPayroll',
            'closePeriod', 'openPeriod', 'createBudget', 'deleteBudget',
            'runAlerts', 'autoMatchBank', 'addBankStatement', 'createAsset',
            'disposeAsset', 'runDepreciation', 'handCustody', 'ackCustody',
            'closeShiftRemote', 'execDayClose',
        ]);
        await ctx.createJournal({ date: '2026-10-15', memo: 'قيد', lines: [{ account_code: '1010', debit: 100, credit: 0 }], status: 'posted' });
        await ctx.approveJournal(3);
        await ctx.voidJournal(3);
        await ctx.postPayroll('2026-10');
        await ctx.closePeriod('2026-10', 'قفل');
        await ctx.openPeriod('2026-10');
        await ctx.createBudget({ period: '2026-10', label: 'الرواتب', account_code: null, amount: 5000 });
        await ctx.deleteBudget(9);
        await ctx.runAlerts();
        await ctx.autoMatchBank('1010');
        await ctx.addBankStatement([{ account_code: '1010', stmt_date: '2026-10-15', amount: 100, description: '' }]);
        await ctx.createAsset({ name: 'فرن', cost: 9000, life_months: 60 });
        await ctx.disposeAsset(4);
        await ctx.runDepreciation();
        await ctx.handCustody(12, 500);
        await ctx.ackCustody(7);
        await ctx.closeShiftRemote(11, 1500);
        await ctx.execDayClose('2026-10-15');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /accounting/journal',
            'POST /accounting/journal/3/approve',
            'POST /accounting/journal/3/void',
            'POST /accounting/post-payroll',
            'POST /accounting/periods/2026-10/close',
            'POST /accounting/periods/2026-10/open',
            'POST /accounting/budgets',
            'DELETE /accounting/budgets/9',
            'POST /accounting/alerts/run',
            'POST /accounting/bank-rec/auto-match',
            'POST /accounting/bank-statements',
            'POST /accounting/fixed-assets',
            'POST /accounting/fixed-assets/4/dispose',
            'POST /accounting/depreciation/run',
            'POST /accounting/cash-custody',
            'POST /accounting/cash-custody/7/ack',
            'POST /pos/shifts/11/close',
            'POST /pos/day-close',
        ]);
        expect(JSON.parse(calls[0].body)).toEqual({
            date: '2026-10-15', memo: 'قيد',
            lines: [{ account_code: '1010', debit: 100, credit: 0 }],
            status: 'posted',
        });
        expect(JSON.parse(calls[16].body)).toEqual({ actual_cash: 1500, notes: 'إغلاق مركزي من المحاسبة' });
        expect(JSON.parse(calls[17].body)).toEqual({ date: '2026-10-15', counts: {}, manager_approve: true });
    });

    test('collectJournalLines: نفس قاعدة القديم (حساب + مبلغ)', () => {
        const ctx = loadEsm(REPO, {}, ['collectJournalLines']);
        expect(ctx.collectJournalLines([
            { account_code: '1010', debit: 100, credit: 0 },
            { account_code: '', debit: 50, credit: 0 },
            { account_code: '2020', debit: 0, credit: 0 },
        ])).toEqual([{ account_code: '1010', debit: 100, credit: 0 }]);
    });
});

describe('CFO — عقد الشاشة من المصدر', () => {
    const src = () => read(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/cfo-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/accounting/);
        expect(s).not.toMatch(/['"`]\/pos\//);
    });

    test('لا معالج سطري ولا حوار حاجب', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s.match(/\son[a-z]+=/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s).not.toMatch(/\bprompt\(/);
    });

    test('الأقسام الثمانية للقديم حاضرة + Excel حقيقي بحارس', () => {
        const s = src();
        for (const k of ['data-v2-tb', 'data-v2-journal', 'data-v2-periods', 'data-v2-stmt',
            'data-v2-shifts', 'data-v2-growth', 'data-v2-pay-month', 'data-v2-export-tb']) {
            expect(s).toContain(k);
        }
        expect(s).toMatch(/typeof window\.XLSX === 'undefined'/);
        expect(s).toMatch(/trial-balance_/);
    });

    test('نسخة الوحدة الموحدة — لا stale خلف الكاش', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });

    test('المضيف يربط المفتاح: استيراد + متغير + تفكيك + رسم + توجيه', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountCfoScreen \} from '\.\/screens\/cfo\.js\?v=/);
        expect(h).toMatch(/let cfoScreen = null;/);
        expect(h).toMatch(/function teardownCfoScreen\(\)/);
        expect(h).toMatch(/key: 'cfo', title: 'المدير المالي', mount: mountCfoScreen/);
        expect(h).toMatch(/if \(key === 'cfo'\)/);
    });
});
