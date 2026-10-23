/**
 * v2-monthly-comparison.test.js — مقارنة الشهور (إيرادات · مصروفات · كوست)
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   1) عمودٌ واحد لا يُدمج: كوست دفتر النظام (رقم قائمة الدخل) وكوست
 *      فواتير المخزون (المرآة) عمودان منفصلان، والفرق بينهما ظاهر — لا
 *      يُجمعان ولا يُقايَضان في عمودٍ واحد.
 *   2) لا صيغة ثانية: كل رقم شهري يخرج من نفس buildPnlStatement التي
 *      تُغذّي شاشة قائمة الدخل — فشهرٌ في الصفحتين يحمل الرقم نفسه.
 *   3) النقص يُعلَن: شهرٌ لا قمم فيه ولا مرآة يُعلَّم no_data، وتُذكر تغطية
 *      كل مصدر (ledger_/oracle_) بدل أن يُقرأ الغياب صفرًا.
 *   4) المرآة تُقرأ بحذر: doc_date نصٌّ لا تاريخ، فيُقطَّع منه الشهر،
 *      وتُستثنى القيم غير الرقمية قبل ::numeric.
 *   5) قراءةٌ فقط، ونفس بوابة /finance/pnl (admin|manager|accountant).
 *   6) الباب الواحد: الشاشة لا تعرف الشبكة؛ المستودع وحده يحمل المسارات،
 *      والطباعة تخرج من عارض V2 (لا سكربت طباعة في المستند ولا نافذة).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const backend = read('backend', 'finance-routes.js');
const screen = read('frontend', 'app', 'js', 'v2', 'screens', 'monthly-comparison.js');
const repo = read('frontend', 'app', 'js', 'v2', 'data', 'monthly-comparison-repo.js');
const preview = read('frontend', 'app', 'js', 'v2', 'preview.js');
const nav = read('frontend', 'app', 'js', 'features', 'auth-navigation.js');
const model = read('frontend', 'app', 'js', 'v2', 'layout', 'nav-model.js');
const config = read('frontend', 'app', 'js', 'core', 'config.js');
const i18n = read('frontend', 'app', 'js', 'core', 'i18n.js');
const settings = read('frontend', 'app', 'js', 'v2', 'screens', 'settings.js');
const perms = read('backend', 'permissions.js');
const yaraReports = read('backend', 'yarasoft', 'yara-reports.js');
const server = read('backend', 'server.js');
const monthlyCss = read('frontend', 'app', 'css', 'v2', 'erp-monthly.css');
const v2html = read('frontend', 'app', 'v2.html');
const {
    buildDispatchYearSummary,
    buildMonthlyComparison,
    buildMonthlyDetail,
    monthlyExpenseLedger,
    renderMonthlyDetailPrintHtml,
    MONTHLY_DETAIL_ROW_CAP,
    monthWindowsInRange,
    parseCashierSelection,
    monthlyRangeFromQuery,
    summarizeCashierDays,
    buildCashierRevenueRows,
    detailWindowFor,
} = require('../backend/finance-routes');

// مستند المقارنة وحده — حتى تبدأ طبقة تفصيل الشهر فلا يُخلط المستندان.
const monthlyPrint = backend.slice(
    backend.indexOf('function renderMonthlyPrintHtml'),
    backend.indexOf('// ─── تفصيل شهرٍ واحد'),
);
const detailPrint = backend.slice(
    backend.indexOf('function renderMonthlyDetailPrintHtml'),
    backend.indexOf('// ─── Routes'),
);

describe('مقارنة الشهور — عمودان لا يُدمجان', () => {
    test('كوست دفتر النظام وكوست فواتير المخزون عمودان مستقلان', () => {
        expect(backend).toMatch(/cost,\s/);
        expect(backend).toMatch(/oracle_cost: oracleCost,/);
        expect(backend).toMatch(/ledger_covered: st\.expense_row_count > 0,/);
        expect(backend).toMatch(/oracle_covered: oracleCost != null,/);
        // الفرق يُحسب ويُرسل، لا يُطوى
        expect(backend).toMatch(/cost_gap: oracleCost == null \? null : roundMoney\(oracleCost - cost\)/);
        expect(backend).toMatch(/cost_gap_pct: oracleCost == null \|\| cost === 0/);
    });

    test('المستند المطبوع يُظهر العمودين ويشرح أنهما لا يُدمجان', () => {
        expect(monthlyPrint).toMatch(/صافي تكلفة المخزون/);
        expect(monthlyPrint).toMatch(/فواتير المخزون \(مقارنة\)/);
        expect(monthlyPrint).toMatch(/مصدر مستقل ولا تُدمج معه/);
        expect(monthlyPrint).toMatch(/money\(r\.cost\)/);
        expect(monthlyPrint).toMatch(/money\(r\.oracle_cost\)/);
    });
});

describe('مقارنة الشهور — ترتيب الإيرادات والمصروفات', () => {
    test('يعرض الملخص من الإيراد إلى تكلفة المخزون والمصروفات ثم الربح', () => {
        const revenueKpi = screen.indexOf("kpiCard('إيراد التحصيل المعتمد'");
        const costKpi = screen.indexOf("kpiCard('صافي كوست الدفتر'");
        const expensesKpi = screen.indexOf("kpiCard('المصروفات الأخرى'");
        const profitKpi = screen.indexOf("kpiCard('صافي الربح'");
        expect(revenueKpi).toBeGreaterThan(-1);
        expect(revenueKpi).toBeLessThan(costKpi);
        expect(costKpi).toBeLessThan(expensesKpi);
        expect(expensesKpi).toBeLessThan(profitKpi);
        expect(screen).toMatch(/الاتجاه الشهري/);
        expect(screen).toMatch(/سجل الشهور/);
        expect(screen).toMatch(/تشغيلية \$\{money\(totals\.operating/);
        expect(screen).toMatch(/جرد \$\{money\(totals\.shrinkage/);
        expect(screen).toMatch(/رواتب \$\{money\(totals\.payroll/);
    });

    test('يرتب أعمدة الصرف والمرتجعات قبل صافي التكلفة ثم المصروفات الأخرى', () => {
        const dispatchCol = screen.indexOf("key: 'cost_dispatch', header: 'أذونات الصرف'");
        const returnsCol = screen.indexOf("key: 'cost_returns', header: 'مرتجعات الصرف'");
        const costCol = screen.indexOf("key: 'cost', header: 'صافي كوست الدفتر'");
        const otherExpensesCol = screen.indexOf("key: 'expenses', header: 'المصروفات الأخرى'");
        expect(dispatchCol).toBeLessThan(returnsCol);
        expect(returnsCol).toBeLessThan(costCol);
        expect(costCol).toBeLessThan(otherExpensesCol);
    });
});

describe('مقارنة الشهور — لا صيغة ثانية', () => {
    test('كل شهر يمرّ على نفس محرّك قائمة الدخل', () => {
        expect(backend).toMatch(/function buildMonthlyComparison\(\{\s*monthKeys, monthWindows, toDay, inputs, oracleByMonth,\s*cashierRevenueByMonth, cashierRevenueForWindow,\s*\}\)/);
        expect(backend).toMatch(/buildPnlStatement\(\{ \.\.\.inputs, fromDay: win\.from, toDay: win\.to \}\)/);
        // الربح والهامش يعاد احتسابهما من إيراد يارا ومكونات التكلفة نفسها.
        expect(backend).toMatch(/const grossProfit = roundMoney\(revenueNet - st\.cogs\.net\)/);
        expect(backend).toMatch(/const netProfit = roundMoney\(grossProfit - st\.shrinkage\.amount - st\.operating\.total - st\.payroll\.total\)/);
        // مدخلاتُ P&L تُحمَّل مرةً واحدة للمدى كله ثم تُقطع شهريًا
        expect(backend).toMatch(/loadPnlInputs\(inputsFrom, toDay\)/);
    });

    test('إيراد المقارنة من يارا فقط وليس POS أو الإيراد اليدوي المحلي', () => {
        const rows = buildMonthlyComparison({
            monthKeys: ['2026-10'],
            toDay: '2026-10-23',
            inputs: {
                orders: [{ subtotal: 900, discount_total: 0, tax_total: 0, total_amount: 900, day: '2026-10-05' }],
                manualRevenues: [{ amount: 100, date: '2026-10-05' }],
                expenses: [],
                payroll: [],
                posDeptMap: [],
                deptHierarchy: [],
            },
            oracleByMonth: new Map(),
            cashierRevenueByMonth: new Map([['2026-10', { net: 225, gross: 250, discount: 25, invoices: 3 }]]),
        });
        expect(rows[0]).toMatchObject({
            revenue: 225,
            revenue_pos: 225,
            revenue_manual: 0,
            invoice_count: 3,
            revenue_covered: true,
            gross_profit: 225,
            net_profit: 225,
        });
    });
});

describe('مقارنة الشهور — مصدر يارا المباشر', () => {
    test('يقرأ الفواتير المعتمدة ويكتشف كل كاشير على الشبكة ومنهم 2', () => {
        expect(yaraReports).toMatch(/WHERE src_table = 'CC' AND active = true/);
        // الكاشيرات تُكتشف من فواتير الفترة نفسها، لا من قائمةٍ ثابتة
        expect(yaraReports).toMatch(/SELECT DISTINCT TRIM\(b\.CSHR_NO\) AS cashier_no/);
        expect(yaraReports).not.toMatch(/no !== '2'/);
        expect(yaraReports).toMatch(/linked: Boolean\(known\)/);
        expect(yaraReports).toMatch(/name: known \? known\.name : `كاشير \$\{no\}`/);
        expect(yaraReports).toMatch(/FROM CC_BILLS3 b/);
        expect(yaraReports).toMatch(/b\.PSTD = 'Y'/);
        expect(yaraReports).toMatch(/NVL\(b\.NET_VAL, 0\) > 0/);
        expect(yaraReports).toMatch(/TRIM\(b\.CSHR_NO\) IN \(\$\{inList\}\)/);
        expect(yaraReports).toMatch(/SUM\(NVL\(b\.NET_VAL, 0\)\) AS net/);
    });

    test('اختيار كاشير غير موجود في فواتير الفترة يُرفض 400 لا يُصفَّر', () => {
        expect(yaraReports).toMatch(/err\.code = 'INVALID_CASHIERS'/);
        expect(yaraReports).toMatch(/const missing = requested\.filter\(\(no\) => !discoveredNos\.includes\(no\)\)/);
        expect(yaraReports).toMatch(/const selectedNos = requested && requested\.length \? requested : discoveredNos/);
    });

    test('تعذّر يارا لا يستبدل الإيراد برقم محلي', () => {
        expect(backend).toMatch(/loadMonthlyLinkedCashierRevenue\(range\.from, range\.to, \{ cashiers: requestedCashiers \}\)/);
        expect(backend).toMatch(/loadMonthlyLinkedCashierRevenue\(win\.from, win\.to, \{ cashiers: requestedCashiers \}\)/);
        expect(backend).toMatch(/cashierRevenueForWindow: \(win\) => summarizeCashierDays\(cashierRevenue\.days, win\.from, win\.to\)/);
        expect(backend).toMatch(/بلا بديل محلي/);
        expect(server).toMatch(/const \{ router: yaraReportsRouter \} = require\('\.\/yarasoft\/yara-reports'\)/);
    });
});

describe('مقارنة الشهور — فترة مخصصة واختيار كاشيرات', () => {
    const codeOf = (fn) => {
        try {fn(); return null;} catch (e) {return e.code || null;}
    };

    test('نوافذ الفترة المخصصة تُقصّ على حدودها وتُعلَم جزئية', () => {
        expect(monthWindowsInRange('2026-08-20', '2026-09-10')).toEqual([
            { key: '2026-08', from: '2026-08-20', to: '2026-08-31', partial: true },
            { key: '2026-09', from: '2026-09-01', to: '2026-09-10', partial: true },
        ]);
        expect(monthWindowsInRange('2026-09-01', '2026-09-30')).toEqual([
            { key: '2026-09', from: '2026-09-01', to: '2026-09-30', partial: false },
        ]);
        // تاريخٌ باطل التقويم لا يمرّ من الشكل
        expect(monthWindowsInRange('2026-09-31', '2026-10-01')).toEqual([]);
    });

    test('مدى الفترة: مخصص حتى اليوم وفي حدود 24 شهرًا، وإلا نافذة متجددة', () => {
        const custom = monthlyRangeFromQuery({ from: '2026-09-01', to: '2026-09-15' }, '2026-10-23');
        expect(custom).toMatchObject({ from: '2026-09-01', to: '2026-09-15', mode: 'custom', months: 1 });
        expect(custom.windows).toEqual([{ key: '2026-09', from: '2026-09-01', to: '2026-09-15', partial: true }]);

        const rolling = monthlyRangeFromQuery({ months: '12' }, '2026-10-23');
        expect(rolling).toMatchObject({ from: '2025-11-01', to: '2026-10-23', mode: 'rolling', months: 12 });

        expect(codeOf(() => monthlyRangeFromQuery({ from: '2026-09-01' }, '2026-10-23'))).toBe('INVALID_PERIOD');
        expect(codeOf(() => monthlyRangeFromQuery({ from: '2026-09-02', to: '2026-09-01' }, '2026-10-23'))).toBe('INVALID_PERIOD');
        expect(codeOf(() => monthlyRangeFromQuery({ from: '2026-09-01', to: '2026-10-24' }, '2026-10-23'))).toBe('INVALID_PERIOD');
        expect(codeOf(() => monthlyRangeFromQuery({ from: '2024-01-01', to: '2026-10-23' }, '2026-10-23'))).toBe('PERIOD_TOO_LONG');
    });

    test('اختيار الكاشيرات يُنقّى ويُرفض غير الصالح — وغيابه يعني الكل', () => {
        expect(parseCashierSelection(undefined)).toBeNull();
        expect(parseCashierSelection('')).toBeNull();
        expect(parseCashierSelection('1, 2,2,10')).toEqual(['1', '2', '10']);
        expect(parseCashierSelection(['3', '3'])).toEqual(['3']);
        expect(codeOf(() => parseCashierSelection('1,a'))).toBe('INVALID_CASHIERS');
    });

    test('مجموع الأيام يحترم حدود النافذة ولا يجمع خارجها', () => {
        const days = [
            { day: '2026-08-31', net: 999, gross: 999, discount: 0, invoices: 9 },
            { day: '2026-09-01', net: 50.5, gross: 60, discount: 9.5, invoices: 1 },
            { day: '2026-09-15', net: 100, gross: 110, discount: 10, invoices: 2 },
            { day: '2026-09-16', net: 777, gross: 777, discount: 0, invoices: 7 },
        ];
        expect(summarizeCashierDays(days, '2026-09-01', '2026-09-15')).toEqual({
            net: 150.5, gross: 170, discount: 19.5, invoices: 3,
        });
        expect(summarizeCashierDays(days, '2026-09-15', '2026-09-01'))
            .toEqual({ net: 0, gross: 0, discount: 0, invoices: 0 });
    });

    test('حصص الكاشيرات تُحسب من الإجمالي المعروض فقط وتُرتّب رقميًا', () => {
        const rows = buildCashierRevenueRows([
            { no: '2', name: 'كاشير 2', linked: true, net: 80, gross: 90, discount: 10, invoices: 4 },
            { no: '1', name: 'كاشير 1', linked: true, net: 20, gross: 25, discount: 5, invoices: 1 },
            { no: '4', name: 'كاشير 4', linked: false, net: 500, gross: 500, discount: 0, invoices: 9 },
        ], ['1', '2']);
        expect(rows.map((row) => row.no)).toEqual(['1', '2']);
        expect(rows.map((row) => row.share_pct)).toEqual([20, 80]);
        expect(rows.reduce((sum, row) => sum + row.share_pct, 0)).toBe(100);

        const all = buildCashierRevenueRows([
            { no: '2', name: 'كاشير 2', linked: true, net: 80, gross: 90, discount: 10, invoices: 4 },
            { no: '9', name: 'كاشير 9', linked: false, net: 20, gross: 25, discount: 5, invoices: 1 },
        ], null);
        expect(all.map((row) => row.no)).toEqual(['2', '9']);
        expect(all.map((row) => row.share_pct)).toEqual([80, 20]);
    });

    test('نافذة التفصيل داخل الشهر فقط، وشهر اليوم الحالي ينتهي عند اليوم', () => {
        expect(detailWindowFor('2026-09', { from: '2026-09-01', to: '2026-09-15' }, '2026-10-23'))
            .toEqual({ from: '2026-09-01', to: '2026-09-15', partial: true });
        expect(detailWindowFor('2026-09', {}, '2026-10-23'))
            .toEqual({ from: '2026-09-01', to: '2026-09-30', partial: false });
        expect(detailWindowFor('2026-10', {}, '2026-10-23'))
            .toEqual({ from: '2026-10-01', to: '2026-10-23', partial: true });
        expect(codeOf(() => detailWindowFor('2026-09', { from: '2026-08-31', to: '2026-09-15' }, '2026-10-23')))
            .toBe('INVALID_PERIOD');
        expect(codeOf(() => detailWindowFor('2026-09', { from: '2026-09-01', to: '2026-10-01' }, '2026-10-23')))
            .toBe('INVALID_PERIOD');
    });

    test('الصف الشهري في الفترة المخصصة يحمل نوافذه وأيامه وحدها', () => {
        const rows = buildMonthlyComparison({
            monthWindows: [{ key: '2026-09', from: '2026-09-01', to: '2026-09-15', partial: true }],
            toDay: '2026-10-23',
            inputs: {
                orders: [],
                manualRevenues: [],
                expenses: [
                    { deptId: 'erp_a', desc: 'داخل النافذة', amount: 40, date: '2026-09-10', category: 'كهرباء', adjustmentType: 'operating' },
                    { deptId: 'erp_a', desc: 'بعد النافذة', amount: 999, date: '2026-09-20', category: 'كهرباء', adjustmentType: 'operating' },
                ],
                payroll: [],
                posDeptMap: [],
                deptHierarchy: [],
            },
            oracleByMonth: new Map(),
            cashierRevenueForWindow: () => ({ net: 500, gross: 550, discount: 50, invoices: 2 }),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            month: '2026-09', from: '2026-09-01', to: '2026-09-15', partial: true,
            revenue: 500, invoice_count: 2, expenses: 40, net_profit: 460,
        });
    });
});

describe('مقارنة الشهور — أذونات الصرف السنوية', () => {
    test('يلخص الصرف والمرتجعات من بداية السنة حتى اليوم شهريًا وصافيًا', () => {
        const summary = buildDispatchYearSummary([
            { date: '2026-01-05', amount: 120, adjustmentType: 'dispatch' },
            { date: '2026-01-20', amount: -20, adjustmentType: 'dispatch_return' },
            { date: '2026-02-02', amount: 75, adjustmentType: 'dispatch' },
            { date: '2025-12-31', amount: 500, adjustmentType: 'dispatch' },
            { date: '2026-10-24', amount: 900, adjustmentType: 'dispatch' },
            { date: '2026-03-01', amount: 300, adjustmentType: 'operating' },
        ], '2026-10-23');

        expect(summary).toMatchObject({
            year: '2026',
            from: '2026-01-01',
            to: '2026-10-23',
            totals: { dispatch: 195, returns: -20, net: 175, rows: 3 },
        });
        expect(summary.monthly).toHaveLength(10);
        expect(summary.monthly[0]).toMatchObject({ month: '2026-01', dispatch: 120, returns: -20, net: 100 });
        expect(summary.monthly[1]).toMatchObject({ month: '2026-02', dispatch: 75, returns: 0, net: 75 });
        expect(summary.monthly[9]).toMatchObject({ month: '2026-10', dispatch: 0, returns: 0, net: 0, rows: 0 });
    });

    test('يحمل مدخلات السنة كاملة ويعرض المصدر والملخص في الشاشة والطباعة', () => {
        expect(backend).toMatch(/const inputsFrom = range\.from < yearFrom \? range\.from : yearFrom/);
        expect(backend).toMatch(/buildDispatchYearSummary\(inputs\.expenses, range\.to\)/);
        expect(backend).toMatch(/dispatch_year: dispatchYear/);
        expect(backend).toMatch(/dispatchYear: payload\.dispatch_year/);
        expect(screen).toMatch(/data-v2-dispatch-year/);
        expect(screen).toMatch(/dispatchTotals\.net/);
        expect(screen).toMatch(/لا قيود صرف مسجلة/);
        expect(screen).toMatch(/key: 'cost_dispatch', header: 'أذونات الصرف'/);
        expect(monthlyPrint).toMatch(/أذونات الصرف ومرتجعاتها/);
        expect(monthlyPrint).toMatch(/totals\?\.cost_dispatch/);
    });
});

describe('مقارنة الشهور — النقص يُعلَن ولا يُنعَّم', () => {
    test('شهرٌ بلا أي حركة يُعلَّم no_data', () => {
        expect(backend).toMatch(/const noData = invoiceCount === 0\s+&& st\.expense_row_count === 0 && num\(st\.payroll\.count\) === 0 && hit == null/);
        expect(backend).toMatch(/no_data: noData,/);
        expect(backend).toMatch(/revenue_covered: true,/);
    });

    test('تغطيةُ كل مصدر تُرسل صراحةً', () => {
        expect(backend).toMatch(/out\.ledger_months = ledgers\.length;/);
        expect(backend).toMatch(/out\.oracle_months = oracles\.length;/);
        expect(backend).toMatch(/out\.ledger_first = ledgers\[0\] \|\| null;/);
        expect(backend).toMatch(/out\.oracle_last = oracles\[oracles\.length - 1\] \|\| null;/);
    });

    test('نطاقُ الشهور محدودٌ 1..24', () => {
        expect(backend).toMatch(/const MONTHLY_DEFAULT_MONTHS = 12;/);
        expect(backend).toMatch(/const MONTHLY_MAX_MONTHS = 24;/);
        expect(backend).toMatch(/Math\.max\(1, Math\.min\(n, MONTHLY_MAX_MONTHS\)\)/);
    });
});

describe('مقارنة الشهور — المرآة تُقرأ بحذر', () => {
    test('doc_date نصٌّ يُقطَّع منه الشهر (سنة من 12 لـ4، واسمٌ من 5 لـ3)', () => {
        expect(backend).toMatch(/FROM ora_bills6/);
        expect(backend).toMatch(/substring\(doc_date, 12, 4\)/);
        expect(backend).toMatch(/LOWER\(substring\(doc_date, 5, 3\)\)/);
        expect(backend).toMatch(/ORACLE_MONTH_ABBR/);
        // القيم غير الرقمية تُعدّ صفرًا بدل أن تُجرح بـ ::numeric
        expect(backend).toMatch(/total_val::numeric/);
        expect(backend).toMatch(/WHERE substring\(doc_date, 12, 4\) ~ '\^\[0-9\]\{4\}\$'/);
    });

    test('غياب المرآة لا يُسقط الصفحة: يُرفع علم availabilty', () => {
        expect(backend).toMatch(/oracleAvailable = true;/);
        expect(backend).toMatch(/oracleAvailable = false;/);
        expect(backend).toMatch(/oracle_available: oracleAvailable,/);
        expect(backend).toMatch(/catch \(e\) \{[\s\S]*?oracle monthly cost unavailable/);
    });
});

describe('مقارنة الشهور — قراءة فقط وبوابةُ pnl', () => {
    test('لا كتابة في الوحدة', () => {
        expect(backend).not.toMatch(/INSERT\s+INTO|UPDATE\s+[a-zA-Z_".]+\s+SET|DELETE\s+FROM/i);
    });

    test('المساران بعد بوابة router.use نفسها التي تحرس /pnl', () => {
        const gateIdx = backend.indexOf('router.use(jwtAuth, requireRole(...READ_ROLES));');
        const listIdx = backend.indexOf("router.get('/monthly-comparison'");
        const printIdx = backend.indexOf("router.get('/monthly-comparison/print'");
        expect(gateIdx).toBeGreaterThan(-1);
        expect(listIdx).toBeGreaterThan(gateIdx);
        expect(printIdx).toBeGreaterThan(gateIdx);
        expect(backend).toMatch(/const READ_ROLES = \['admin', 'manager', 'accountant'\];/);
    });
});

describe('مقارنة الشهور — الورقة المطبوعة بلا طباعة ذاتية', () => {
    test('مستندُ العارض لا يطبع نفسه: العارضُ هو من يطبع', () => {
        expect(monthlyPrint.length).toBeGreaterThan(0);
        expect(monthlyPrint).not.toMatch(/window\.print/);
        expect(monthlyPrint).not.toMatch(/<script/i);
        // بياناتُ المصدرين مذكورة على الورق
        expect(monthlyPrint).toMatch(/تغطية دفتر النظام/);
        expect(monthlyPrint).toMatch(/تغطية فواتير المخزون/);
        expect(monthlyPrint).toMatch(/لا قيود|لا مرآة/);
    });
});

describe('مقارنة الشهور — الباب الواحد والطباعة', () => {
    test('المستودع وحده يحمل المسارات؛ الشاشة لا تعرف الشبكة', () => {
        expect(repo).toMatch(/import \{ apiFetch \} from '\.\.\/\.\.\/core\/api\.js/);
        expect(repo).not.toMatch(/\bfetch\(/);
        expect(repo).toMatch(/apiFetch\(`\/finance\/monthly-comparison\$\{query \? `\?\$\{query\}` : ''\}`\)/);
        expect(repo).toMatch(/export function monthlyComparisonPrintUrl/);
        expect(repo).toMatch(/`\/api\/finance\/monthly-comparison\/print\$\{query \? `\?\$\{query\}` : ''\}`/);

        expect(screen).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen).toMatch(/from '\.\.\/data\/monthly-comparison-repo\.js/);
    });

    test('الطباعةُ عبر عارض V2 لا نافذةً خارجية', () => {
        expect(screen).toMatch(/openInAppReport\('مقارنة الشهور', monthlyComparisonPrintUrl\(currentFilters\(\)\)\)/);
        expect(screen).not.toMatch(/target="_blank"/);
        expect(screen).not.toMatch(/href="\/api\//);
    });
});

describe('مقارنة الشهور — الواجهة', () => {
    test('مكوّناتُ النظام لا طبقةً خاصة', () => {
        expect(screen).toMatch(/createDataTable/);
        expect(screen).toMatch(/barChart\(\{/);
        expect(screen).toMatch(/lineChart\(\{/);
        expect(screen).toMatch(/class="erp-kpis/);
        expect(screen).toMatch(/erp-kpi/);
        expect(screen).toMatch(/mountMonthlyComparisonScreen/);
    });

    test('لا معالجات inline (CSP script-src-attr none)', () => {
        expect(screen).not.toMatch(/on(?:click|submit|input|change)\s*=\s*["']/);
        expect(screen).toMatch(/addEventListener\('click'/);
    });

    test('حالةٌ تُعرض ولا تُبتلع، وتنظيفٌ كامل', () => {
        expect(screen).toMatch(/monthTable\.setLoading\(true\)/);
        expect(screen).toMatch(/monthTable\.setRows\(rows\)/);
        expect(screen).toMatch(/emptyMessage: 'لا شهور في هذه النافذة'/);
        expect(screen).toMatch(/if \(!el\.isConnected\) \{return;\}/);
        expect(screen).toMatch(/monthTable\.destroy\(\)/);
    });
});

describe('مقارنة الشهور — النشر: مفتاحٌ واحد في كل أبواب التنقّل والأذونات', () => {
    test('التنقّل في الطبقتين', () => {
        expect(nav).toMatch(/'cost-analysis','pnl','monthly-comparison'/);
        expect(model).toMatch(/'cost-analysis', 'pnl', 'monthly-comparison'/);
        expect(nav).toMatch(/'monthly-comparison':t\('pg\.monthly-comparison'\)/);
    });

    test('الأدوار والأذونات', () => {
        expect(config).toMatch(/admin:\s*\{[^}]*'monthly-comparison'/);
        expect(config).toMatch(/manager:\s*\{[^}]*'monthly-comparison'/);
        expect(config).toMatch(/accountant:\s*\{[^}]*'monthly-comparison'/);
        expect(perms).toMatch(/menus: \['reports', 'cfo', 'cost-analysis', 'pnl', 'monthly-comparison'\]/);
    });

    test('اللغة والإعدادات', () => {
        expect(i18n).toMatch(/'monthly-comparison':\s*\{\s*icon: 'calendar-days',\s*ar: 'مقارنة الشهور'/);
        expect(i18n).toMatch(/'pg\.monthly-comparison': 'مقارنة الشهور'/);
        expect(i18n).toMatch(/'pg\.monthly-comparison': 'Monthly Comparison'/);
        expect(settings).toMatch(/'pnl', 'monthly-comparison'/);
        expect(settings).toMatch(/'monthly-comparison': 'مقارنة الشهور'/);
    });

    test('المعاينة V2 تحمّل الشاشة وتُنظّفها وتوجّهها', () => {
        expect(preview).toMatch(/import \{ mountMonthlyComparisonScreen \} from '\.\/screens\/monthly-comparison\.js/);
        expect(preview).toMatch(/let monthlyComparisonScreen = null;/);
        expect(preview).toMatch(/function teardownMonthlyComparisonScreen\(\)/);
        expect(preview).toMatch(/teardownMonthlyComparisonScreen\(\);/);
        expect(preview).toMatch(/key: 'monthly-comparison', title: 'مقارنة الشهور', mount: mountMonthlyComparisonScreen/);
        expect(preview).toMatch(/if \(key === 'monthly-comparison'\) \{/);
    });
});
/* ── تفصيل الشهر: نفس محرّك القائمة، إيرادٌ مطابق لصف المقارنة، وبياناتُ
      المصروفات كما سُجّلت مع سقف معلن، وطباعة A4 بلا سكربت. ─────────────── */

const DETAIL_INPUTS = {
    orders: [{ subtotal: 900, discount_total: 100, tax_total: 130, total_amount: 930, created_at: '2026-10-05', pos_dept_code: 'pos_a' }],
    manualRevenues: [{ amount: 50, date: '2026-10-06', deptId: 'erp_a', source: 'إيراد يدوي' }],
    expenses: [
        { deptId: 'erp_a', desc: 'صرف مواد', amount: 300, date: '2026-10-01', category: 'مواد', adjustmentType: 'dispatch' },
        { deptId: 'erp_a', desc: 'مرتجع مواد', amount: -30, date: '2026-10-02', category: 'مواد', adjustmentType: 'dispatch_return' },
        { deptId: 'erp_a', desc: 'كهرباء', amount: 40, date: '2026-10-03', category: 'كهرباء', adjustmentType: 'operating' },
        { deptId: 'erp_a', desc: 'فرق جرد', amount: 10, date: '2026-10-04', category: 'جرد', adjustmentType: 'count_correction' },
    ],
    payroll: [],
    posDeptMap: [{ code: 'pos_a', name_ar: 'القسم أ', legacy_dept_code: 'erp_a' }],
    deptHierarchy: [{ code: 'erp_a', name: 'القسم أ', parent_code: null }],
};
const DETAIL_WIN = { from: '2026-10-01', to: '2026-10-31', partial: false };
const DETAIL_HIT = { net: 1000, gross: 1100, discount: 100, invoices: 5 };

function detailFixture(overrides = {}) {
    return buildMonthlyDetail({
        monthKey: '2026-10',
        win: DETAIL_WIN,
        inputs: DETAIL_INPUTS,
        cashierHit: DETAIL_HIT,
        oracleHit: { cost: 320, docs: 3 },
        oracleAvailable: true,
        ...overrides,
    });
}

describe('تفصيل الشهر — إيرادٌ واحدٌ مع صف المقارنة', () => {
    test('إيراد الشهر هو تحصيل الفواتير نفسه، لا إيراد الدفتر', () => {
        const detail = detailFixture();
        expect(detail.revenue.total).toBe(1000);
        expect(detail.revenue.ledger_total).toBe(850);       // 800 POS + 50 يدوي — مطابقة فقط
        expect(detail.revenue.manual_total).toBe(50);
        expect(detail.revenue.invoice_count).toBe(5);
        expect(detail.statement.revenue.total).toBe(850);    // الدفتر لا يُستعمل كإيراد معروض
    });

    test('الكوست والمصروفات وصافي الربح تُشتق من نفس statement', () => {
        const detail = detailFixture();
        expect(detail.derived.cost).toBe(270);               // 300 − 30
        expect(detail.derived.expenses).toBe(50);            // 40 تشغيلي + 10 جرد
        expect(detail.derived.gross_profit).toBe(730);
        expect(detail.derived.net_profit).toBe(680);
        expect(detail.derived.cost_pct).toBe(27);
        expect(detail.derived.net_margin_pct).toBe(68);
        expect(detail.derived.oracle_gap).toBe(50);          // 320 − 270 — لا يُدمج
    });

    test('شهرٌ بلا فواتير تحصيل يُعلَن ولا يُقرأ صفرًا', () => {
        const detail = detailFixture({ cashierHit: null });
        expect(detail.revenue_available).toBe(false);
        expect(detail.revenue.total).toBe(0);
        expect(detail.derived.net_margin_pct).toBeNull();
    });
});

describe('تفصيل الشهر — بيانات المصروفات كما سُجّلت', () => {
    test('كل سطر يحمل تاريخه ونوعه وفئته وبيانه وقسمه ومبلغه', () => {
        const detail = detailFixture();
        expect(detail.expenses.rows_total).toBe(4);
        expect(detail.expenses.rows_truncated).toBe(false);
        const first = detail.expenses.rows[0];
        expect(first.date).toBe('2026-10-04');
        expect(first).toMatchObject({ type: 'count_correction', type_label: 'فرق جرد', department: 'القسم أ', amount: 10 });
        expect(detail.expenses.rows.map((r) => r.date)).toEqual(['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']);
    });

    test('تصنيف الأنواع الأربعة محفوظ بترتيبه', () => {
        const detail = detailFixture();
        expect(detail.expenses.by_type.map((t) => t.type)).toEqual(['dispatch', 'dispatch_return', 'count_correction', 'operating']);
        expect(monthlyExpenseLedger(DETAIL_INPUTS, DETAIL_WIN.from, DETAIL_WIN.to, new Map())
            .byType.find((t) => t.type === 'dispatch')).toMatchObject({ amount: 300, count: 1 });
    });

    test('السقف معلن: 250 سطرًا وrows_total بالعدد الكامل', () => {
        const rows = Array.from({ length: MONTHLY_DETAIL_ROW_CAP + 10 }, (_, i) => ({
            deptId: 'erp_a', desc: `حركة ${i}`, amount: 1, date: '2026-10-01',
            category: 'بند', adjustmentType: 'operating',
        }));
        const detail = buildMonthlyDetail({
            monthKey: '2026-10', win: DETAIL_WIN,
            inputs: { ...DETAIL_INPUTS, expenses: rows },
            cashierHit: DETAIL_HIT, oracleHit: null, oracleAvailable: true,
        });
        expect(MONTHLY_DETAIL_ROW_CAP).toBe(250);
        expect(detail.expenses.rows).toHaveLength(250);
        expect(detail.expenses.rows_total).toBe(260);
        expect(detail.expenses.rows_truncated).toBe(true);
    });

    test('الإيرادات اليدوية تُعرض للبيان ولا تُضاف إلى إيراد التحصيل', () => {
        const detail = detailFixture();
        expect(detail.manual_revenues.total).toBe(50);
        expect(detail.manual_revenues.rows).toHaveLength(1);
        expect(detail.manual_revenues.rows[0]).toMatchObject({ source: 'إيراد يدوي', department: 'القسم أ' });
        expect(detail.revenue.total).toBe(1000);
    });

    test('الحركة اليومية للكوست والمصروفات بلا اختراع إيراد يومي', () => {
        const detail = detailFixture();
        expect(detail.derived.daily.find((d) => d.date === '2026-10-01')).toMatchObject({ cost: 300, other: 0 });
        expect(detail.derived.daily.find((d) => d.date === '2026-10-03')).toMatchObject({ cost: 0, other: 40 });
        expect(detail.derived.daily.every((d) => !('revenue' in d))).toBe(true);
    });
});

describe('تفصيل الشهر — نقاطُ الخادم وبوابةُ pnl', () => {
    test('المساران معرّضان بعد بوابة router.use نفسها', () => {
        const gateIdx = backend.indexOf('router.use(jwtAuth, requireRole(...READ_ROLES));');
        expect(backend.indexOf("router.get('/monthly-comparison/month'")).toBeGreaterThan(gateIdx);
        expect(backend.indexOf("router.get('/monthly-comparison/month/print'")).toBeGreaterThan(gateIdx);
        expect(backend).toMatch(/async function monthlyDetailPayload\(query\)/);
        expect(backend).toMatch(/monthKeyOrThrow\(query\?\.month\)/);
        expect(backend).toMatch(/loadPnlInputs\(win\.from, win\.to\)/);
        expect(backend).toMatch(/loadMonthlyLinkedCashierRevenue\(win\.from, win\.to, \{ cashiers: requestedCashiers \}\)/);
        expect(backend).toMatch(/const cashierHit = summarizeCashierDays\(cashierRevenue\.days, win\.from, win\.to\)/);
        expect(backend).toMatch(/cashierHit: cashierHit\.invoices > 0 \? cashierHit : null/);
    });

    test('صيغة الشهر محروسة والشهر المستقبلي مرفوض 400', () => {
        expect(backend).toMatch(/err\.code = 'INVALID_MONTH'/);
        expect(backend).toMatch(/err\.code = 'MONTH_IN_FUTURE'/);
        expect(backend).toMatch(/monthKey > toDay\.slice\(0, 7\)/);
        expect(backend).toMatch(/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
    });

    test('الطباعة لا تحسب شيئًا بنفسها ولا تكتب في القاعدة', () => {
        expect(backend).not.toMatch(/INSERT\s+INTO|DELETE\s+FROM/i);
        expect(detailPrint).not.toMatch(/<script/i);
        expect(detailPrint).not.toMatch(/window\.print/);
        expect(detailPrint).toMatch(/قائمة الشهر المالية/);
        expect(detailPrint).toMatch(/إيراد التحصيل المعتمد/);
        expect(detailPrint).toMatch(/أهم حركات المصروفات/);
        expect(detailPrint).toMatch(/الحركة اليومية للكوست والمصروفات/);
    });

    test('الورقة A4 تهرب النص ولا تترك وسمًا حيًّا', () => {
        const hostile = detailFixture({
            inputs: {
                ...DETAIL_INPUTS,
                expenses: [{ deptId: 'erp_a', desc: '<script>alert(1)</script>', amount: 5, date: '2026-10-01', category: '<b>خطر</b>', adjustmentType: 'operating' }],
            },
        });
        const html = renderMonthlyDetailPrintHtml(hostile, { restaurantName: 'مطاعم الاختبار', generatedAt: '2026-10-23', generatedBy: 'admin' });
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('مطاعم الاختبار');
        expect(html).toMatch(/lang="ar" dir="rtl"/);
    });
});

describe('تفصيل الشهر — المستودع والدرج', () => {
    test('المستودع وحده يحمل مسارَي التفصيل بنافذة وكاشيرات', () => {
        expect(repo).toMatch(/export function normalizeMonthKey/);
        expect(repo).toMatch(/\/finance\/monthly-comparison\/month\?month=\$\{encodeURIComponent\(key\)\}\$\{query \? `&\$\{query\}` : ''\}/);
        expect(repo).toMatch(/\/api\/finance\/monthly-comparison\/month\/print\?month=\$\{encodeURIComponent\(key\)\}\$\{query \? `&\$\{query\}` : ''\}/);
        expect(repo).toMatch(/export async function fetchMonthlyDetail\(month, filters\)/);
    });

    test('الدرج حوارٌ مُعلَن: scrim + panel + قفل جسم + Escape', () => {
        expect(screen).toMatch(/data-v2-panel role="dialog" aria-modal="true"/);
        expect(screen).toMatch(/data-v2-scrim/);
        expect(screen).toMatch(/classList\.add\('erp-monthly-open'\)/);
        expect(screen).toMatch(/classList\.remove\('erp-monthly-open'\)/);
        expect(screen).toMatch(/event\.key === 'Escape'/);
        expect(screen).toMatch(/document\.addEventListener\('keydown', onKey, true\)/);
        expect(screen).toMatch(/document\.removeEventListener\('keydown', onKey, true\)/);
        expect(screen).toMatch(/erp-report-viewer-open/);
    });

    test('بيانات المصروفات تصل بجدولها وطباعة الشهر من داخل الدرج', () => {
        expect(screen).toMatch(/fetchMonthlyDetail/);
        expect(screen).toMatch(/data-v2-expenses-table/);
        expect(screen).toMatch(/caption: 'سطور المصروفات كما سُجّلت في الدفتر'/);
        expect(screen).toMatch(/openInAppReport\(`قائمة \$\{monthLabel\(openMonthKey\)\}`/);
        expect(screen).toMatch(/monthlyDetailPrintUrl\(openMonthKey, detailFilters\(\)\)/);
        expect(screen).toMatch(/detailTable\.destroy\(\)/);
    });

    test('حالات الدرج ظاهرة: تحميلٌ وخطأٌ وإعادةُ محاولة', () => {
        expect(screen).toMatch(/aria-busy/);
        expect(screen).toMatch(/data-v2-detail-retry/);
        expect(screen).toMatch(/panelError\(/);
        expect(screen).toMatch(/detailCache/);
    });
});

describe('مقارنة الشهور — واجهة الفترة والكاشيرات', () => {
    test('شريط فلترة: تاريخان وزرّا تطبيق/ضبط وشرائح كاشيرات وحالة معلنة', () => {
        ['data-v2-from', 'data-v2-to', 'data-v2-apply', 'data-v2-reset',
            'data-v2-cashiers', 'data-v2-cashiers-all', 'data-v2-filterMsg',
            'data-v2-cashierTable'].forEach((hook) => {
            expect(screen).toContain(hook);
        });
        expect(screen).toMatch(/aria-pressed="\$\{on \? 'true' : 'false'\}"/);
        expect(screen).toMatch(/role="status" aria-live="polite"/);
        expect(screen).toMatch(/فترة مخصصة/);
        expect(screen).toMatch(/إيراد الكاشيرات المشمولة/);
        expect(screen).toMatch(/فهامش كاشيرٍ واحد لا يُقرأ هامش المنشأة/);
        expect(screen).toMatch(/e\.code === 'INVALID_CASHIERS'/);
        expect(screen).toMatch(/pendingReload = true/);
    });

    test('الفلاتر تسري على المقارنة والتفصيل والطباعة معًا', () => {
        expect(screen).toMatch(/function currentFilters\(\)/);
        expect(screen).toMatch(/function detailFilters\(\)/);
        expect(screen).toMatch(/filters\.cashiers = cashiers/);
        expect(screen).toMatch(/fetchMonthlyComparison\(currentFilters\(\)\)/);
        expect(screen).toMatch(/fetchMonthlyDetail\(month, detailFilters\(\)\)/);
        expect(screen).toMatch(/monthlyComparisonPrintUrl\(currentFilters\(\)\)/);
        expect(screen).toMatch(/monthlyDetailPrintUrl\(openMonthKey, detailFilters\(\)\)/);
        expect(screen).toMatch(/detailCacheKey\(month\)/);
    });

    test('المستودع يبني الاستعلام من تاريخين صحيحين أو نافذة الشهور', () => {
        expect(repo).toMatch(/export function monthlyComparisonQuery\(filters\)/);
        expect(repo).toMatch(/export function normalizeDayKey\(value\)/);
        expect(repo).toMatch(/export function normalizeCashiers\(value\)/);
        expect(repo).toMatch(/if \(from && to\) \{\s*params\.set\('from', from\);\s*params\.set\('to', to\);/);
        expect(repo).toMatch(/params\.set\('cashiers', cashiers\.join\(','\)\)/);
        expect(repo).toMatch(/return !Number\.isNaN\(parsed\.getTime\(\)\) && parsed\.toISOString\(\)\.slice\(0, 10\) === day/);
        expect(repo).toMatch(/export function monthlyDetailPrintUrl\(month, filters\)/);
    });
});

describe('طبقة المقارنة — رموزٌ فقط وتُحمَّل في الصفحة', () => {
    test('erp-monthly.css بلا hex/rgba/px/rem/em خارج الاستعلامات', () => {
        const body = monthlyCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(monthlyCss).toMatch(/var\(--erp-space-/);
        expect(monthlyCss).toMatch(/\.erp-v2\.erp-monthly/);
    });

    test('فخّ hidden في الدرج مقفولٌ صراحةً', () => {
        expect(monthlyCss).toMatch(/\.erp-monthly__panel\[hidden\][\s\S]*?display: none/);
        expect(monthlyCss).toMatch(/\.erp-monthly__scrim\[hidden\][\s\S]*?display: none/);
        expect(monthlyCss).toMatch(/body\.erp-monthly-open \{ overflow: hidden; \}/);
    });

    test('الورقة تُسجَّل في صفحة V2', () => {
        expect(v2html).toMatch(/css\/v2\/erp-monthly\.css\?v=\d+\.\d+\.\d+/);
    });
});
