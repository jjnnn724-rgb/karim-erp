/**
 * v2-reports.test.js — عقد شاشة 04 «التقارير» في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-warehouse.test.js: the repository runs in
 * a vm with its one dependency (apiFetch) stubbed, and the screen is asserted
 * as a source contract, because jest here is testEnvironment:'node'.
 *
 * What is pinned here is the part nobody can eyeball in a browser:
 *   • the two dates the server demands, in the server's own format, and the
 *     reversal it 422s on (shift-routes.js:124-134,:942-944) — all three
 *     rejected before a request is spent
 *   • `group_by` is the server enum and nothing else (:946-949); an unknown
 *     dimension is refused, never defaulted in silence
 *   • the item dimension is `LIMIT 200` with no total (:1121) — the cap is
 *     inferred from 200 rows and then SAID
 *   • the row allowlist per dimension (:1042-1055,:1079-1092,:1108-1121): a
 *     cashier row has no product barcode, and an item row has no avg_ticket
 *   • money is allowed here because the unit is read from the stored settings
 *     row (:1529-1541) — when that read fails the figures stay bare, and no
 *     currency literal is typed into either file
 *   • the server echoes its own scoping (:1138); the screen reports the echo
 *     instead of claiming a filter the operator set
 *   • no inline handlers (CSP nonce), payloads escaped, one click cannot
 *     stack two reports, and a detached screen stops writing
 *   • a reply that no longer matches what the screen asks for is dropped,
 *     and a failed read leaves the header line silent instead of «جارية»
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'reports-repo.js');
const SCREEN = path.join(V2, 'screens', 'reports.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const V2_HTML = path.join(APP, 'v2.html');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    // `export const X` becomes a lexical binding that never lands on the vm's
    // global object, so the harness publishes the named bindings itself.
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        Set, Map, Intl, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const EXPORTS = ['GROUP_BY', 'PERIODS', 'PAYMENT_METHOD_AR', 'ROW_FIELDS', 'localDateOnly',
    'periodRange', 'fetchSalesReport', 'fetchCurrency', 'formatInt', 'formatQty', 'formatMoney',
    'reportToRow', 'sharePill', 'paymentBreakdown', 'buildReportKpis'];

/** A server-shaped stub: one envelope, so the rules under test are the repo's. */
function repoStub(envelope) {
    const calls = [];
    const apiFetch = jest.fn(async (p) => {
        calls.push(p);
        return typeof envelope === 'function' ? envelope(p, calls.length) : envelope;
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }, EXPORTS) };
}

/** The Wednesday the calendar was checked on: 2026-10-14, Sunday-start week. */
const NOW = () => new Date(2026, 9, 14);

function envelope(over = {}) {
    return {
        start_date: '2026-10-01',
        end_date: '2026-10-14',
        group_by: 'department',
        filters: { department_id: null, cashier_id: null },
        summary: {
            invoice_count: 12, net_sales: 4500.5, subtotal_sales: 4000, discount_total: 100.25,
            tax_total: 600, items_qty: 210.5, unique_items: 33, avg_ticket: 375.04,
            payment_methods: { cash: 2000, card: 2500.5 },
        },
        rows: [{
            department_id: 3, department_code: 'KIT', department_name: 'المطبخ',
            invoice_count: 12, subtotal_sales: 4000, discount_total: 100.25, tax_total: 600,
            net_sales: 4500.5, avg_ticket: 375.04, items_qty: 210.5, unique_items: 33,
        }],
        ...over,
    };
}

describe('V2 reports repository — the server rules, the allowlist, the money unit', () => {
    test('the grouping enum sent to the server is the server enum, verbatim', () => {
        const { repo } = repoStub(envelope());
        expect(repo.GROUP_BY).toEqual(['department', 'cashier', 'item']);
        expect(repo.PERIODS).toEqual(['today', 'week', 'month', 'year', 'custom']);
    });

    test('both dates are required in the server format and cost no request', async () => {
        const { calls, repo } = repoStub(envelope());
        await expect(repo.fetchSalesReport({ startDate: '', endDate: '2026-10-01' })).rejects.toThrow('YYYY-MM-DD');
        await expect(repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '1-10-2026' })).rejects.toThrow('YYYY-MM-DD');
        await expect(repo.fetchSalesReport({})).rejects.toThrow('YYYY-MM-DD');
        expect(calls).toHaveLength(0);
    });

    test('a reversed range is refused locally — the server would 422 it', async () => {
        const { calls, repo } = repoStub(envelope());
        await expect(repo.fetchSalesReport({ startDate: '2026-10-05', endDate: '2026-10-01' }))
            .rejects.toThrow('INVALID_DATE_RANGE');
        expect(calls).toHaveLength(0);
    });

    test('an unknown dimension names the three the server accepts', async () => {
        const { calls, repo } = repoStub(envelope());
        await expect(repo.fetchSalesReport({
            startDate: '2026-10-01', endDate: '2026-10-02', groupBy: 'dept',
        })).rejects.toThrow('department، cashier، item');
        expect(calls).toHaveLength(0);
    });

    test('the query string is the server contract: start_date, end_date, group_by', async () => {
        const { calls, repo } = repoStub(envelope());
        await repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-14', groupBy: 'cashier' });
        expect(calls[0].startsWith('/pos/reports/sales?')).toBe(true);
        const qs = new URLSearchParams(calls[0].split('?')[1]);
        expect(qs.get('start_date')).toBe('2026-10-01');
        expect(qs.get('end_date')).toBe('2026-10-14');
        expect(qs.get('group_by')).toBe('cashier');
        expect(qs.get('department_id')).toBeNull();
        expect(qs.get('cashier_id')).toBeNull();
    });

    test('an id that is not a positive integer is dropped, not sent to a 422', async () => {
        const { calls, repo } = repoStub(envelope());
        await repo.fetchSalesReport({
            startDate: '2026-10-01', endDate: '2026-10-02', departmentId: '0', cashierId: '-4',
        });
        const qs = new URLSearchParams(calls[0].split('?')[1]);
        expect(qs.get('department_id')).toBeNull();
        expect(qs.get('cashier_id')).toBeNull();
        await repo.fetchSalesReport({
            startDate: '2026-10-01', endDate: '2026-10-02', departmentId: '7', cashierId: 12.9,
        });
        const q2 = new URLSearchParams(calls[1].split('?')[1]);
        expect(q2.get('department_id')).toBe('7');
        // parseInt truncates; the server wants an integer, and 12 is one.
        expect(q2.get('cashier_id')).toBe('12');
    });

    test('the envelope is read as stored: dates, filters and summary come back intact', async () => {
        const { repo } = repoStub(envelope({
            group_by: 'cashier', filters: { department_id: null, cashier_id: 7 },
        }));
        const res = await repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-14', groupBy: 'cashier' });
        expect(res.startDate).toBe('2026-10-01');
        expect(res.endDate).toBe('2026-10-14');
        expect(res.groupBy).toBe('cashier');
        expect(res.filters).toEqual({ departmentId: null, cashierId: 7 });
        expect(res.summary.invoice_count).toBe(12);
        expect(res.rows).toHaveLength(1);
        expect(res.capped).toBe(false);
    });

    test('the item cap is inferred from 200 rows and declared, never hidden', async () => {
        const at = Array.from({ length: 200 }, (_, i) => ({ product_id: i + 1, product_name: `صنف ${i}` }));
        const { repo } = repoStub(envelope({ group_by: 'item', rows: at }));
        const res = await repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-14', groupBy: 'item' });
        expect(res.capped).toBe(true);
        const { repo: r2 } = repoStub(envelope({ group_by: 'item', rows: at.slice(0, 199) }));
        const r199 = await r2.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-14', groupBy: 'item' });
        expect(r199.capped).toBe(false);
        // 200 departments is not a cap — the LIMIT is only in the item SQL.
        const { repo: r3 } = repoStub(envelope({ rows: at }));
        expect((await r3.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-14' })).capped).toBe(false);
    });

    test('a reply that is not an envelope is an error, not an empty report', async () => {
        const { repo } = repoStub(null);
        await expect(repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-02' }))
            .rejects.toThrow('لا مغلّف التقرير');
    });

    test('missing rows or summary degrade to empty, never to a crash', async () => {
        const { repo } = repoStub({ group_by: 'department' });
        const res = await repo.fetchSalesReport({ startDate: '2026-10-01', endDate: '2026-10-02' });
        expect(res.rows).toEqual([]);
        expect(res.summary).toEqual({});
        expect(res.filters).toEqual({ departmentId: null, cashierId: null });
    });

    test('the currency door reads the stored settings row in any shape it arrives', async () => {
        const cases = [[{ currency: 'SAR' }, 'SAR'], [[{ currency: ' AED ' }], 'AED'], [{ currency: null }, ''],
            [{ currency: '' }, ''], [null, ''], [{}, '']];
        for (const [payload, expected] of cases) {
            const { calls, repo } = repoStub(payload);
            expect(await repo.fetchCurrency()).toBe(expected);
            expect(calls).toEqual(['/settings/main_settings']);
        }
    });

    test('the doors are reads: the repository contains no write method', () => {
        const src = fs.readFileSync(REPO, 'utf8');
        expect(src).not.toMatch(/\bmethod: '(POST|PUT|PATCH|DELETE)'/i);
        expect(src.match(/apiFetch\(/g)).toHaveLength(2);
    });

    test('no currency literal in the layer that prints money', () => {
        const src = fs.readFileSync(REPO, 'utf8');
        expect(src).not.toMatch(/unit:\s*'(ر\.س|ج\.م|SAR|EGP)'/);
        expect(src).not.toMatch(/currency:\s*'(SAR|EGP)'/);
        // The unit only ever arrives as an argument.
        expect(src).toMatch(/const unit = String\(currency \?\? ''\)/);
    });

    test('the period edges are the legacy rules: Sunday week, first of month, first of year', () => {
        const { repo } = repoStub(envelope());
        expect(repo.periodRange('today', {}, NOW())).toEqual({ startDate: '2026-10-14', endDate: '2026-10-14', label: 'اليوم' });
        expect(repo.periodRange('week', {}, NOW()).startDate).toBe('2026-10-11');   // Sunday
        expect(repo.periodRange('week', {}, new Date(2026, 9, 11))).toEqual({ startDate: '2026-10-11', endDate: '2026-10-11', label: 'هذا الأسبوع' });
        expect(repo.periodRange('month', {}, NOW()).startDate).toBe('2026-10-01');
        expect(repo.periodRange('year', {}, NOW()).startDate).toBe('2026-01-01');
        expect(repo.periodRange('month', {}, new Date(2026, 0, 5))).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-05' });
    });

    test('custom passes the operator dates through untouched', () => {
        const { repo } = repoStub(envelope());
        expect(repo.periodRange('custom', { startDate: '2026-09-01', endDate: '2026-09-30' }, NOW()))
            .toEqual({ startDate: '2026-09-01', endDate: '2026-09-30', label: 'فترة مخصصة' });
        expect(repo.periodRange('custom', {}, NOW())).toEqual({ startDate: '', endDate: '', label: 'فترة مخصصة' });
    });

    test('a day is the local calendar day, never the UTC one', () => {
        const { repo } = repoStub(envelope());
        // 00:30 local is still the same calendar day; toISOString would move it.
        expect(repo.localDateOnly(new Date(2026, 9, 14, 0, 30))).toBe('2026-10-14');
        expect(repo.localDateOnly(new Date(2026, 9, 14, 23, 59))).toBe('2026-10-14');
        expect(repo.localDateOnly('not a date')).toBe('');
        expect(repo.localDateOnly()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('each dimension has its own allowlist and reportToRow returns exactly it', () => {
        const { repo } = repoStub(envelope());
        for (const kind of repo.GROUP_BY) {
            expect(Object.keys(repo.reportToRow({}, kind))).toEqual(repo.ROW_FIELDS[kind]);
        }
        expect(repo.ROW_FIELDS.item).not.toContain('avgTicket');
        expect(repo.ROW_FIELDS.item).toContain('quantitySold');
        expect(repo.ROW_FIELDS.department).not.toContain('quantitySold');
        expect(repo.ROW_FIELDS.cashier).toContain('uniqueItems');
    });

    test('a row is mapped from its own dimension columns, not from a guessed union', () => {
        const { repo } = repoStub(envelope());
        const dept = repo.reportToRow(envelope().rows[0], 'department');
        expect(dept).toMatchObject({ dimensionId: 3, dimensionName: 'المطبخ', dimensionCode: 'KIT', netSales: 4500.5, avgTicket: 375.04 });
        const cash = repo.reportToRow({
            cashier_id: 7, cashier_name: 'كاشير', cashier_username: 'k1', invoice_count: 4,
            subtotal_sales: 900, discount_total: 0, tax_total: 135, net_sales: 1035,
            avg_ticket: 258.75, items_qty: 20, unique_items: 9,
        }, 'cashier');
        expect(cash.dimensionCode).toBe('k1');
        expect(cash.nameResolved).toBe(true);
        // An item row has no cashier and no average ticket to invent.
        const item = repo.reportToRow({
            product_id: 9, product_name: 'أرز', product_barcode: '620', department_name: 'المطبخ',
            invoice_count: 3, quantity_sold: 2.5, subtotal_sales: 10, discount_total: 1, tax_total: 1.35, net_sales: 10.35,
        }, 'item');
        expect(item).toMatchObject({ dimensionId: 9, dimensionCode: '620', departmentName: 'المطبخ', quantitySold: 2.5 });
        expect(item.avgTicket).toBeUndefined();
    });

    test('numbers arrive as numbers or numeric text, and absent figures are zero', () => {
        const { repo } = repoStub(envelope());
        const r = repo.reportToRow({ department_id: 1, department_name: 'د', net_sales: '750.25', invoice_count: null }, 'department');
        expect(r.netSales).toBe(750.25);
        expect(r.invoiceCount).toBe(0);
        expect(r.taxTotal).toBe(0);
        expect(Number.isFinite(r.netSales)).toBe(true);
        expect(JSON.stringify(r)).not.toMatch('NaN');
    });

    test('an empty stored name is an empty name, flagged and shown as the id it is', () => {
        const { repo } = repoStub(envelope());
        const row = repo.reportToRow({ product_id: 55, product_name: '', invoice_count: 1 }, 'item');
        expect(row.dimensionName).toBe('');
        expect(row.nameResolved).toBe(false);
    });

    test('money is two decimals with the stored unit, and bare when the unit is missing', () => {
        const { repo } = repoStub(envelope());
        expect(repo.formatMoney(1234.5, 'SAR')).toEqual({ amount: '1,234.50', unit: 'SAR', hasUnit: true });
        expect(repo.formatMoney(1234.5, '')).toEqual({ amount: '1,234.50', unit: '', hasUnit: false });
        expect(repo.formatMoney(null, 'SAR').amount).toBe('0.00');
        expect(repo.formatMoney('750', 'SAR').amount).toBe('750.00');
        expect(repo.formatQty(2.5)).toBe('2.5');
        expect(repo.formatQty(210.567)).toBe('210.567');
        expect(repo.formatInt(1234567.6)).toBe('1,234,568');
    });

    test('a share needs a real base: zero net is a stated dash, not 0% of nothing', () => {
        const { repo } = repoStub(envelope());
        const none = repo.sharePill(5, 0, 'الخصومات', 'SAR');
        expect(none.text).toBe('—');
        expect(none.on).toBe(false);
        expect(none.aria).toMatch('لا نسبة تُحسب');
        const some = repo.sharePill(100, 4000, 'الخصومات', 'SAR');
        expect(some.text).toBe('2.5%');
        expect(some.aria).toMatch('100.00 SAR من 4,000.00 SAR');
    });

    test('payments sort by amount, keep unknown methods verbatim, and drop zero', () => {
        const { repo } = repoStub(envelope());
        const pay = repo.paymentBreakdown({ cash: 2000, unknown_kind: 500, card: 2500.5, bank: 0 });
        expect(pay.rows.map((p) => p.method)).toEqual(['card', 'cash', 'unknown_kind']);
        expect(pay.rows[0].label).toBe('بطاقة');
        expect(pay.rows[2].label).toBe('unknown_kind');       // never renamed into a guess
        expect(pay.total).toBe(5000.5);
        expect(repo.paymentBreakdown(null).rows).toEqual([]);
        expect(repo.paymentBreakdown({}).total).toBe(0);
    });

    test('six chips, four of them money and two counts, all from summary fields', () => {
        const { repo } = repoStub(envelope());
        const chips = repo.buildReportKpis(envelope().summary, { currency: 'SAR', scopeLabel: 'هذا الشهر' });
        expect(chips.map((c) => c.id)).toEqual(['net', 'subtotal', 'discount', 'tax', 'invoices', 'quantity']);
        expect(chips.filter((c) => c.kind === 'money').map((c) => c.id)).toEqual(['net', 'subtotal', 'discount', 'tax']);
        expect(chips.find((c) => c.id === 'net').value).toBe('4,500.50');
        expect(chips.find((c) => c.id === 'net').unit).toBe('SAR');
        expect(chips.find((c) => c.id === 'invoices').value).toBe('12');
        expect(chips.find((c) => c.id === 'quantity').value).toBe('210.5');
        expect(chips.every((c) => c.label && c.en && c.icon && c.tone && c.hint && c.pill.aria)).toBe(true);
        expect(chips.find((c) => c.id === 'net').hint).toMatch('issued');
        expect(chips.find((c) => c.id === 'net').hint).toMatch('هذا الشهر');
    });

    test('a discount that exists is a warning and a share; a zero is a plain zero', () => {
        const { repo } = repoStub(envelope());
        const withDiscount = repo.buildReportKpis(envelope().summary, { currency: 'SAR' })
            .find((c) => c.id === 'discount');
        expect(withDiscount.tone).toBe('warning');
        expect(withDiscount.pill.text).toBe('2.5%');
        const none = repo.buildReportKpis({ ...envelope().summary, discount_total: 0 }, { currency: 'SAR' })
            .find((c) => c.id === 'discount');
        expect(none.tone).toBe('neutral');
        expect(none.pill.text).toBe('0.0%');
    });

    test('no currency means bare numbers, and the chip never invents a unit', () => {
        const { repo } = repoStub(envelope());
        const chips = repo.buildReportKpis(envelope().summary, {});
        expect(chips.find((c) => c.id === 'net').unit).toBe('');
        expect(JSON.stringify(chips)).not.toMatch('SAR');
        expect(JSON.stringify(chips)).not.toMatch('ر.س');
    });

    test('an empty summary yields zeros and dashes, never NaN and never a clean bill', () => {
        const { repo } = repoStub(envelope());
        const chips = repo.buildReportKpis({}, {});
        expect(chips.find((c) => c.id === 'net').value).toBe('0.00');
        expect(chips.find((c) => c.id === 'invoices').pill.text).toBe('—');
        expect(chips.find((c) => c.id === 'invoices').hint).toMatch('لا فاتورة');
        expect(chips.find((c) => c.id === 'subtotal').pill.text).toBe('—');
        expect(JSON.stringify(chips)).not.toMatch('NaN');
    });

    test('the item cap is written into the chip hint, not left to the table', () => {
        const { repo } = repoStub(envelope());
        const chips = repo.buildReportKpis(envelope().summary, { currency: 'SAR', capped: true });
        expect(chips[0].hint).toMatch('200');
        expect(chips[0].hint).toMatch('حصر في الخادم نفسه');
        // A source line number is a note for the repository, not a word to a
        // manager reading a KPI hint.
        expect(chips[0].hint).not.toMatch('(:');
    });
});

describe('V2 reports screen + layer (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener\('click'/);
        expect(screen()).toMatch(/addEventListener\('change'/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/reports-repo\.js\?v=/);
    });

    test('the periods and dimensions rendered are the repository enums, not a local list', () => {
        const s = screen();
        expect(s).toMatch(/PERIODS\.map/);
        expect(s).toMatch(/GROUP_BY\.map/);
        expect(s).toMatch(/data-v2-period="\$\{esc\(p\)\}"/);
        expect(s).toMatch(/data-v2-group="\$\{esc\(g\)\}"/);
        // Nothing outside the server enum is offered as a button.
        expect(s).not.toMatch(/data-v2-period="(hour|quarter|all)"/);
    });

    test('only allowlisted fields reach the table columns', () => {
        const keys = [...screen().matchAll(/\bkey: '([a-zA-Z]+)'/g)].map((m) => m[1]);
        expect(new Set(keys)).toEqual(new Set(['dimensionName', 'departmentName', 'invoiceCount',
            'quantitySold', 'itemsQty', 'uniqueItems', 'avgTicket', 'subtotalSales',
            'discountTotal', 'taxTotal', 'netSales']));
        expect(screen()).not.toMatch(/\.avgCost|\.cashier_username\b|\.product_barcode\b/);
    });

    test('the table is client mode over server-grouped rows, and both search boxes are declared', () => {
        const s = screen();
        expect(s).toMatch(/mode: 'client'/);
        expect(s).toMatch(/الفترة والتجميع يسألان الخادم/);
        expect(s).toMatch(/مربع البحث\s+داخل الجدول يضيق/);
    });

    test('a dimension change rebuilds the table because its headers would lie', () => {
        const s = screen();
        expect(s).toMatch(/function mountTable\(\)/);
        expect(s).toMatch(/if \(table\) \{table\.destroy\(\);\}/);
        expect(s).toMatch(/mountTable\(\);\s+\/\/ new dimension, new columns/);
        expect(s).toMatch(/caption: `سجل المبيعات حسب \$\{GROUP_AR\[groupBy\]\}/);
    });

    test('rows are mapped by this screen dimension, so headers and values cannot drift', () => {
        const s = screen();
        expect(s).toMatch(/report\.rows\.map\(\(row\) => reportToRow\(row, groupBy\)\)/);
        expect(s).not.toMatch(/reportToRow\(row, report\.groupBy\)/);
    });

    test('every payload string reaching the DOM is escaped', () => {
        const s = screen();
        expect(s).toMatch(/esc\(row\.dimensionCode\)/);
        expect(s).toMatch(/esc\(r\.departmentName\)/);
        expect(s).toMatch(/esc\(p\.label\)/);
        expect(s).toMatch(/esc\(m\.unit\)/);
        expect(s).toMatch(/title="\$\{esc\(opts\.title\)\}"/);
        expect(s).toMatch(/title="\$\{esc\(title\)\}"/);
        expect(s).toMatch(/aria-label="\$\{esc\(k\.pill\.aria\)\}"/);
        expect(s).toMatch(/data-i="\$\{esc\(k\.icon\)\}"/);
    });

    test('money is printed only through the unit the settings row carries', () => {
        const s = screen();
        expect(s).toMatch(/formatMoney\(v, currency\)/);
        expect(s).toMatch(/m\.hasUnit \? ` <span class="erp-text-sm erp-text-muted">\$\{esc\(m\.unit\)\}<\/span>` : ''/);
        expect(s).not.toMatch(/'[٥5]?\s*(ر\.س|ج\.م)'/);
        expect(s).toMatch(/data-v2-currency-note/);
        expect(s).toMatch(/تعذّرت قراءة وحدة المال/);
    });

    test('the status rule is quoted as the servers, not restated as an opinion', () => {
        const s = screen();
        expect(s).toMatch(/issued<\/span>$/m);
        expect(s).toMatch(/المرتجعات والملغاة ليست/);
        expect(s).toMatch(/قاعدة الخادم لا تصفية من هنا/);
    });

    test('the 200-item ceiling is disclosed when the server stopped early', () => {
        const s = screen();
        expect(s).toMatch(/data-v2-cap-note/);
        expect(s).toMatch(/أول 200 صنفًا \(LIMIT\)/);
        expect(s).toMatch(/capNote\.hidden = !meta\.capped/);
    });

    test('the scoping the server echoes is reported as its decision', () => {
        const s = screen();
        expect(s).toMatch(/meta\.filters\.cashierId \?\? meta\.filters\.departmentId/);
        expect(s).toMatch(/scopeNote\.hidden = !echo/);
        expect(s).toMatch(/هذا قراره، لا فلتر من هذه الشاشة/);
    });

    test('changing period or grouping costs exactly one reload and repaints only its segment', () => {
        const s = screen();
        expect(s).toMatch(/q\('\[data-v2-periodseg\]'\)\.innerHTML = periodSeg\(period\)/);
        expect(s).toMatch(/q\('\[data-v2-groupseg\]'\)\.innerHTML = groupSeg\(groupBy\)/);
        expect(s.match(/reload\(\)/g).length).toBeGreaterThanOrEqual(5);
        expect(s).toMatch(/function periodSeg\(active\)/);
        expect(s).toMatch(/function groupSeg\(active\)/);
    });

    test('choosing a period writes the dates it will send before sending them', () => {
        const s = screen();
        expect(s).toMatch(/if \(period !== 'custom'\) \{/);
        expect(s).toMatch(/fromInput\.value = r\.startDate;/);
        expect(s).toMatch(/toInput\.value = r\.endDate;/);
    });

    test('editing a date adopts the custom period instead of lying about the range', () => {
        const s = screen();
        expect(s).toMatch(/matches\('\[data-v2-from\], \[data-v2-to\]'\)/);
        expect(s).toMatch(/period = 'custom';/);
    });

    test('the dates shown before the first reply are the dates being asked for', () => {
        const s = screen();
        expect(s).toMatch(/const initial = periodRange\(period, \{\}\);/);
        expect(s).toMatch(/القراءة جارية/);
    });

    test('the top portlets stop at six and say the rest is in the table', () => {
        const s = screen();
        expect(s).toMatch(/const TOP_PORTLET = 6/);
        expect(s).toMatch(/pay\.rows\.slice\(0, TOP_PORTLET\)/);
        expect(s).toMatch(/rows\.slice\(0, TOP_PORTLET\)/);
        expect(s).toMatch(/والباقي في الجدول/);
    });

    test('a payment share names its base instead of leaving a bare percentage', () => {
        const s = screen();
        expect(s).toMatch(/نسبة من إجمالي المدفوع/);
        expect(s).toMatch(/p\.amount \/ pay\.total/);
        expect(s).toMatch(/لا مدفوعات مسجّلة/);
    });

    test('one click cannot stack two reports, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{queued = true; return;\}/);
        expect(s.split('el.isConnected').length - 1).toBeGreaterThanOrEqual(3);
        expect(s).toMatch(/queued = false;\s*if \(table\) \{table\.destroy\(\); table = null;\}/);
        expect(s).toMatch(/table\.setLoading\(false\)/);
    });

    test('a late answer cannot paint under headers it was not asked for', () => {
        const s = screen();
        // The request remembers what it asked; both paths drop it if the
        // screen has since been asked for another dimension or range.
        expect(s).toMatch(/const asked = \{ groupBy, startDate: r\.startDate, endDate: r\.endDate \};/);
        expect(s.split('if (stale(asked)) {return;}').length - 1).toBe(2);
        expect(s).toMatch(/asked\.groupBy !== groupBy \|\| asked\.startDate !== r\.startDate/);
    });

    test('a failed read stops claiming the measurement is still running', () => {
        const s = screen();
        const catchBlock = s.slice(s.indexOf('} catch (e) {'));
        expect(catchBlock.slice(0, 900)).toMatch(/scopeLine\.textContent = '';/);
    });

    test('a rejected read is explained by the host, and empty is empty in both directions', () => {
        const s = screen();
        expect(s).toMatch(/message === 'UNAUTHORIZED'/);
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toMatch(/لا فواتير في هذه الفترة عند الخادم/);
        expect(s).toMatch(/تعذّر تحميل التقرير/);
    });

    test('a currency read failure cannot sink a report that arrived', () => {
        const s = screen();
        expect(s).toMatch(/fetchCurrency\(\)\.catch\(\(\) => ''\)/);
        expect(s).toMatch(/currencyRead \? Promise\.resolve\(currency\)/);
    });

    test('printing states its own limits and the button is the only print call', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        expect(s).toMatch(/data-v2-print-note/);
        expect(s).toMatch(/المطبوعة تعرض الصفحة الحالية من الجدول، لا الفترة كاملة/);
    });

    test('the screen is read-only: it builds no request of its own', () => {
        const s = screen();
        expect(s).not.toMatch(/method:\s*['"`]/);
        expect(s).not.toMatch(/XMLHttpRequest|axios|fetch\(/);
        expect(s).toMatch(/قراءة فقط/);
    });

    test('no sample figures on the live screen', () => {
        expect(screen()).not.toMatch('بيانات نموذجية');
    });

    test('the shared layer is untouched: no new component and no new colour', () => {
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(css()).not.toMatch(/rgba?\(/);
        expect(css()).toMatch(/04 التقارير/);
    });

    test('the reports head compacts on a phone like the other screens', () => {
        const block = css().match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/\.erp-v2-reports \.erp-seg__label/);
        expect(block[0]).toMatch(/\.erp-v2-reports \.erp-filterbar/);
        expect(block[0]).toMatch(/\.erp-v2-reports \.erp-dash-controls \.erp-btn/);
        expect((block[0].match(/\.erp-v2-reports/g) || []).length).toBeGreaterThanOrEqual(7);
        expect(block[0]).toMatch(/\.erp-v2-warehouse/);
        expect(block[0]).toMatch(/\.erp-v2-employees/);
        expect(block[0]).toMatch(/\.erp-v2-attendance/);
    });

    test('two segments each get their own line, and touch targets stay finger-sized', () => {
        const block = css().match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
        expect(block[0]).toMatch(/\.erp-v2-reports \[data-v2-periodseg\]/);
        expect(block[0]).toMatch(/flex: 1 1 100%/);
        expect(block[0]).toMatch(/\.erp-v2-reports \.erp-seg button \{[\s\S]*?min-block-size: 40px;/);
        // Measured: a nowrap segment is 314px of min-content, which is wider
        // than a 320px phone and made the whole page pan sideways.
        expect(block[0]).toMatch(/\.erp-v2-reports \.erp-seg \{ flex-wrap: wrap; \}/);
    });

    test('the page loads the layer, versioned (Cloudflare caches CSS for 4h)', () => {
        const page = fs.readFileSync(V2_HTML, 'utf8');
        const ver = page.match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(page).toMatch(`css/v2/erp-hr.css?v=${ver}`);
        expect(page).toMatch(`js/v2/preview.js?v=${ver}`);
    });

    test('the host mounts, notifies and tears the screen down on navigation', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect(p).toMatch(/mountReportsScreen\(/);
        expect(p).toMatch(/reportsScreen\.destroy\(\)/);
        expect(p).toMatch(/key === 'reports'/);
        expect(p).toMatch(/teardownReportsScreen\(\)/);
        expect(p).toMatch(/navStatus\.current !== 'reports'/);
        expect(p).toMatch(/noSessionState\('التقارير'\)/);
        // The toolbar refresh must reach the new screen too.
        expect(p).toMatch(/warehouseScreen \|\| reportsScreen/);
        // Non-live does not fake totals: the period is answered in SQL.
        expect(p).toMatch(/الفترة والتجميع يُحسبان في SQL/);
    });

    test('the host has exactly one reports screen instance', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect(p).toMatch(/let reportsScreen = null;/);
        expect((p.match(/reportsScreen = mount/g) || []).length).toBe(1);
        expect((p.match(/function renderReportsScreen/g) || []).length).toBe(1);
    });
});
