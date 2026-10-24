'use strict';

/**
 * عقد أساس أرقام لوحة المدير المالي (/api/accounting/cfo-summary)
 * ────────────────────────────────────────────────────────────────────────────
 * سبب الاختبار (قرار المالك 2026-10-24): اللوحة كانت تجمع أرقامها من استعلامات
 * مزاجية (إيراد من المرآة، مصروف من جدول الصرف، رواتب بـ substr BETWEEN) فلا
 * يتفق رقم البطاقة مع رقم قائمة الدخل لنفس الفترة. الآن الأساس واحد:
 * loadPnlInputs + buildPnlStatement، والكتلة reconciliation تربط الدفتر بالمرآة.
 * المرآة (revenues) تُقرأ هنا فقط — لا كتابة عليها إطلاقًا.
 */

const mockLoadPnlInputs = jest.fn(async () => ({ orders: [], expenses: [], payroll: [], departments: [] }));
const mockBuildPnlStatement = jest.fn(() => stubPnl);
const mockQueries = [];
const mockPoolResults = [];
const mockPool = {
    async query(sql, params) {
        mockQueries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        const next = mockPoolResults.shift();
        if (next instanceof Error) {throw next;}
        return { rows: next === undefined ? [] : next };
    },
};

jest.mock('../backend/shared-pool', () => ({ pool: mockPool }));
jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../backend/finance-routes', () => ({
    loadPnlInputs: mockLoadPnlInputs,
    buildPnlStatement: mockBuildPnlStatement,
}));

const fs = require('fs');
const path = require('path');
const { router } = require('../backend/accounting-routes');

const stubPnl = {
    revenue: {
        total: 1800000, invoice_count: 19000, manual_count: 12, pos_net: 1780000,
        manual: 20000, pos_gross: 1900000, vat_collected: 90000, pos_discounts: 30000,
    },
    operating: {
        total: 300000, count: 400,
        items: [
            { category: 'إيجارات', amount: 120000 }, { category: 'كهرباء', amount: 60000 },
            { category: 'صيانة', amount: 50000 }, { category: 'نظافة', amount: 40000 },
            { category: 'اشتراكات', amount: 20000 }, { category: 'متفرقات', amount: 10000 },
        ],
    },
    cogs: { dispatch: 900000, returns: 0, net: 900000, count: 2153 },
    shrinkage: { amount: 5000, count: 194, losses: 6000, gains: -1000 },
    internal_moves: { amount: 0, count: 0 },
    payroll: { total: 120000, months: ['2026-10'] },
    gross_profit: { amount: 900000, margin_pct: 50 },
    net_profit: { amount: 595000, margin_pct: 33.06 },
    by_department: [
        { code: 'ys_cc_1', name: 'كاشير 1', revenue: 900000, net: 450000, margin_pct: 50 },
        { code: 'ys_b4_ext', name: 'بيع خارجي', revenue: 0, net: 0, margin_pct: 0 },
    ],
    daily_series: [{ day: '2026-10-05', revenue: 41000, expenses: 8000 }],
};

/** هل القيم أرقام صحيحة النهاية — لا NaN ولا null ولا نص؟ */
function numbersAreFinite(...vals) {return vals.every((v) => typeof v === 'number' && Number.isFinite(v));}

function takeRows(rows) {mockPoolResults.push(...rows.map((r) => [r]));}

function captureQueryOrder() {
    // ترتيب الاستعلامات داخل المعالج ثابت: cash ثم قيود الفترة ثم كل القيود ثم
    // المرآة ثم المدخل بالدفتر ثم بلا قيد ثم الملغاة ثم الافتتاحي.
    takeRows([
        { petty: '1000.00', bank: '-8.22' },
        { n: 120 },
        { n: 5300 },
        { total: '2155291.43', n: 20802, ext_total: '479612.74', ext_n: 1234 },
        { total: '2155291.43', n: 20802 },
        { n: 0, total: '0' },
        { n: 1447, total: '129182.64' },
        { total: '2252293.42', n: 1, as_of: '2026-09-30' },
    ]);
}

async function callHandler(query = { from: '2026-10-01', to: '2026-10-24' }) {
    const layer = router.stack.find((l) => l.route && l.route.path === '/cfo-summary');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = {
        body: null, code: 200, error: null,
        json(payload) {res.body = payload; return res;},
        status(code) {res.code = code; return res;},
    };
    await handler({ query, user: { id: 1, role: 'admin' }, headers: {} }, res);
    return res;
}

describe('/cfo-summary — الأساس موحّد مع قائمة الدخل', () => {
    beforeEach(() => {
        mockQueries.length = 0; mockPoolResults.length = 0;
        mockLoadPnlInputs.mockClear(); mockBuildPnlStatement.mockClear();
    });

    test('كل بطاقة رقمها من قائمة الدخل لا من استعلام مزاجي', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        expect(mockLoadPnlInputs).toHaveBeenCalledWith('2026-10-01', '2026-10-24');
        expect(mockBuildPnlStatement).toHaveBeenCalledTimes(1);
        const payload = mockBuildPnlStatement.mock.calls[0][0];
        expect(payload.fromDay).toBe('2026-10-01');
        expect(payload.toDay).toBe('2026-10-24');
        expect(body.revenue.total).toBe(stubPnl.revenue.total);
        expect(body.expenses.total).toBe(stubPnl.operating.total);
        expect(body.cogs).toEqual(stubPnl.cogs);
        // الشاشة تقرأ cogs.net و shrinkage.amount — الحقول نفسها التي تنتجها قائمة الدخل
        expect(body.cogs.net).toBe(900000);
        expect(body.shrinkage.amount).toBe(5000);
        expect(body.inventory_moves).toEqual(stubPnl.internal_moves);
        expect(body.gross_profit).toEqual(stubPnl.gross_profit);
        expect(body.net_profit).toEqual(stubPnl.net_profit);
        expect(body.payroll_open).toBe(stubPnl.payroll.total);
    });

    test('الفترة الافتراضية شهر الرياض الحالي عند غياب من/إلى', async () => {
        captureQueryOrder();
        const { body } = await callHandler({});
        expect(body.from).toMatch(/^\d{4}-\d{2}-01$/);
        expect(body.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(mockLoadPnlInputs).toHaveBeenCalledWith(body.from, body.to);
    });

    test('net_approx أصبح اسمًا ثانيًا لنفس صافي قائمة الدخل', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        expect(body.net_approx).toBe(body.net_profit.amount);
        expect(body.net_approx).toBe(595000);
    });

    test('عدّاد الفواتير يجمع الكاشير واليدوي، والمصروف العد تشغيلي', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        expect(body.revenue.count).toBe(stubPnl.revenue.invoice_count + stubPnl.revenue.manual_count);
        expect(body.expenses.count).toBe(stubPnl.operating.count);
        expect(body.pos.invoices).toBe(stubPnl.revenue.invoice_count);
        expect(body.top_expense_categories).toHaveLength(5);
        expect(body.top_expense_categories[0]).toEqual({ category: 'إيجارات', total: 120000 });
    });

    test('النقدية من الدفتر التراكمي: صندوق + بنك، والملغاة لا تدخل', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        expect(body.cash_ledger).toEqual({ petty_cash: 1000, bank: -8.22 });
        expect(body.cash_position).toBe(991.78);
        const cashSql = mockQueries[0].sql;
        expect(cashSql).toContain("e.status = 'posted'");
        expect(cashSql).toContain("'1000'");
        expect(cashSql).toContain("'1010'");
        expect(numbersAreFinite(body.cash_position, body.cash_ledger.bank)).toBe(true);
    });

    test('تسوية الدفتر مع المرآة: فرق صفر وصفوف بلا قيد = متوافق', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        const rec = body.reconciliation;
        expect(rec.status).toBe('متوافق');
        expect(rec.mirror_revenue).toBe(2155291.43);
        expect(rec.ledger_revenue).toBe(2155291.43);
        expect(rec.difference).toBe(0);
        expect(rec.unposted_rows).toBe(0);
        expect(rec.voided_duplicates).toBe(1447);
        expect(rec.voided_amount).toBe(129182.64);
        expect(rec.pre_book_opening).toBe(2252293.42);
        expect(rec.external_revenue).toBe(479612.74);
        expect(rec.cutover).toBe('2026-10-01');
        expect(rec.note).toContain('ys_b4_ext');
    });

    test('أي صفّ بلا قيد أو أي فرق يكسر حالة التوافق', async () => {
        mockPoolResults.push(
            [{ petty: '0', bank: '0' }], [{ n: 0 }], [{ n: 0 }],
            [{ total: '1000.00', n: 10, ext_total: '0', ext_n: 0 }],
            [{ total: '940.00', n: 9 }],
            [{ n: 1, total: '60.00' }],
            [{ n: 0, total: '0' }],
            [{ total: '0', n: 0, as_of: null }],
        );
        const { body } = await callHandler();
        expect(body.reconciliation.status).toBe('غير متوافق');
        expect(body.reconciliation.difference).toBe(60);
        expect(body.reconciliation.unposted_rows).toBe(1);
        expect(body.reconciliation.unposted_amount).toBe(60);
    });

    test('المرآة تُقرأ ولا تُكتب، ومن يوم التحول فقط', async () => {
        captureQueryOrder();
        await callHandler();
        for (const q of mockQueries) {
            expect(q.sql).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\b/i);
        }
        const mirror = mockQueries.find((q) => /FROM revenues/.test(q.sql) && /ext_total/.test(q.sql));
        expect(mirror.params).toEqual(['2026-10-01', '2026-10-24', '2026-10-01']);
        const unposted = mockQueries.find((q) => /NOT EXISTS/.test(q.sql));
        expect(unposted.sql).toContain('r.external_ref');
        expect(unposted.sql).toContain("('id:' || CAST(r.id AS TEXT))");
        expect(unposted.params[2]).toBe('2026-10-01');
        expect(unposted.params[3]).toBe('yarasoft_revenue');
    });

    test('المدخل في الدفتر دائن 4000 لقيود إيراد يارسوفت المرحّلة فقط', async () => {
        captureQueryOrder();
        await callHandler();
        const booked = mockQueries.find((q) => /source_type = \$3/.test(q.sql) && /'4000'/.test(q.sql));
        expect(booked.sql).toContain("e.status = 'posted'");
        expect(booked.params[2]).toBe('yarasoft_revenue');
        const voided = mockQueries.find((q) => /'void'/.test(q.sql));
        expect(voided.sql).toContain("l.account_code = '4000'");
        const opening = mockQueries[mockQueries.length - 1];
        expect(opening.sql).toContain("l.account_code = '3100'");
        expect(opening.params[0]).toBe('yarasoft_prebooks');
    });

    test('أساس كل رقم معلن في الاستجابة حتى لا يُقرأ الرقم بلا سياقه', async () => {
        captureQueryOrder();
        const { body } = await callHandler();
        expect(Object.keys(body.basis).sort()).toEqual(['cash', 'expenses', 'ledger', 'payroll', 'revenue']);
        expect(body.basis.ledger).toContain('posted');
        expect(body.basis.expenses).toContain('فروق الجرد');
        expect(body.daily_series).toEqual(stubPnl.daily_series);
        expect(body.revenue_by_dept).toHaveLength(2);
        expect(body.revenue_by_dept[0]).toEqual({ code: 'ys_cc_1', name: 'كاشير 1', total: 900000, net: 450000, margin_pct: 50 });
        expect(body.journal_entries).toBe(120);
        expect(body.journal_entries_all_time).toBe(5300);
    });

    test('فشل الحساب لا يسرّب تفاصيل القاعدة', async () => {
        mockPoolResults.push([{ petty: '0', bank: '0' }], [{ n: 0 }], [{ n: 0 }], [new Error('connection lost')]);
        const res = await callHandler();
        expect(res.code).toBe(500);
        expect(res.body).toEqual({ error: 'LEDGER_CFO_FAILED', message: 'تعذر حساب ملخص المدير المالي' });
    });
});

describe('عقد المصدر — لا رجوع للأساس القديم', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'backend', 'accounting-routes.js'), 'utf8');
    const handler = src.slice(src.indexOf("router.get('/cfo-summary'"));
    const screen = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'screens', 'cfo.js'), 'utf8');

    test('المعالج يستدعي دالة قائمة الدخل لا استعلام إيراد مستقل', () => {
        expect(handler).toContain('loadPnlInputs(from, to)');
        expect(handler).toContain('buildPnlStatement');
        expect(handler).toMatch(/revenue:\s*\{\s*total:\s*pnl\.revenue\.total/);
    });

    test('أسلوب الرواتب القديم (substr BETWEEN) اختفى من اللوحة', () => {
        expect(handler).not.toMatch(/BETWEEN\s+substr/i);
        expect(handler).not.toMatch(/payroll.*GROUP BY\s+substr/is);
    });

    test('الاستثناء التاريخي للبند الخارجي يبقى معلَنًا في الأساس', () => {
        expect(handler).toContain('ys_b4_ext');
        expect(handler).toContain("'قائمة الدخل: صافي الكاشير");
    });

    test('شاشة V2 تعرض بطاقة التسوية وتقرأ نفس العقد', () => {
        expect(screen).toContain('data-v2-recon');
        expect(screen).toContain('reconciliation');
        expect(screen).toContain('net_profit');
        expect(screen).toContain('unposted_rows');
        expect(screen).toContain('external_revenue');
    });
});
