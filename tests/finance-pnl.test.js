/**
 * finance-pnl.test.js — قائمة الأرباح والخسائر الحية (P&L)
 * ────────────────────────────────────────────────────────
 * يغطي: تصنيف المصاريف (COGS/فروق جرد/تشغيلية)، تجميع الرواتب داخل النطاق،
 * حساب الفترة السابقة بنفس الطول، هوية قائمة الدخل (إيراد − تكلفة − مصاريف = صافي)،
 * الهوامش، المقارنة بين فترتين، وأمان الأصفار والقيم الفارغة — كلها دوال نقية.
 */

const {
    roundMoney,
    normalizeDay,
    monthStartOf,
    daysBetween,
    computePreviousPeriod,
    pctChange,
    isCogsExpense,
    isShrinkageExpense,
    isOperatingExpenseRow,
    classifyExpenses,
    aggregatePayroll,
    marginPct,
    buildPnlStatement,
    buildComparison,
    renderPnlPrintHtml,
} = require('../backend/finance-routes');

// نفس تقريب الصف الواحد في aggregatePayroll (سطر لكل مسير) — لمطابقة التجميع
const round6 = (v) => Math.round(v * 100) / 100;

describe('roundMoney و normalizeDay — التطهير الأساسي', () => {
    test('تقريب النقود لمنزلتين', () => {
        expect(roundMoney(10.005)).toBe(10.01);
        expect(roundMoney(10.004)).toBe(10);
        expect(roundMoney('12.349')).toBe(12.35);
    });

    test('القيم الفاسدة تصير صفرًا لا NaN', () => {
        expect(roundMoney(null)).toBe(0);
        expect(roundMoney(undefined)).toBe(0);
        expect(roundMoney('abc')).toBe(0);
        expect(roundMoney(NaN)).toBe(0);
        expect(roundMoney(Infinity)).toBe(0);
    });

    test('تطبيع التواريخ: ISO كامل أو تاريخ فقط', () => {
        expect(normalizeDay('2026-08-30T14:22:00Z')).toBe('2026-08-30');
        expect(normalizeDay('2026-08-30')).toBe('2026-08-30');
        expect(normalizeDay(new Date('2026-08-30T10:00:00Z'))).toBe('2026-08-30');
        expect(normalizeDay('garbage')).toBe('');
        expect(normalizeDay(null)).toBe('');
    });
});

describe('computePreviousPeriod — الفترة السابقة بنفس الطول', () => {
    test('أسبوع كامل يسبقه أسبوع كامل متصل', () => {
        const prev = computePreviousPeriod('2026-08-25', '2026-08-31');
        expect(prev).toEqual({ from: '2026-08-18', to: '2026-08-24' });
    });

    test('شهر كامل (أغسطس) يسبقه يوليو بالطول نفسه', () => {
        const prev = computePreviousPeriod('2026-08-01', '2026-08-31');
        expect(prev).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    });

    test('يوم واحد يسبقه اليوم السابق', () => {
        const prev = computePreviousPeriod('2026-08-30', '2026-08-30');
        expect(prev).toEqual({ from: '2026-08-29', to: '2026-08-29' });
    });

    test('عبور حدود السنة', () => {
        const prev = computePreviousPeriod('2026-01-01', '2026-01-15');
        expect(prev).toEqual({ from: '2025-12-17', to: '2025-12-31' });
    });

    test('نطاق فاسد يعيد فراغين بلا انفجار', () => {
        expect(computePreviousPeriod('', '')).toEqual({ from: '', to: '' });
        expect(computePreviousPeriod('2026-08-30', 'bad')).toEqual({ from: '', to: '' });
    });
});

describe('monthStartOf و aggregatePayroll — الرواتب داخل النطاق', () => {
    test('مطلع الشهر سليم للقيم الصحيحة', () => {
        expect(monthStartOf(2026, 8)).toBe('2026-08-01');
        expect(monthStartOf('2026', '08')).toBe('2026-08-01');
    });

    test('قيم فاسدة تعيد فراغًا', () => {
        expect(monthStartOf(2026, 13)).toBe('');
        expect(monthStartOf(null, 8)).toBe('');
        expect(monthStartOf(2026, 0)).toBe('');
    });

    test('يجمع رواتب الأشهر التي يقع مطلعها داخل الفترة فقط', () => {
        const payroll = [
            { year: 2026, month: 7, netSalary: '5000' },   // مطلعه قبل الفترة
            { year: 2026, month: 8, netSalary: '6000' },   // مطلعه داخلها
            { year: 2026, month: 9, netSalary: '7000' },   // مطلعه بعدها
            { year: 2026, month: 8, netSalary: '1500' },   // مسير ثانٍ لنفس الشهر
        ];
        const agg = aggregatePayroll(payroll, '2026-08-01', '2026-08-31');
        expect(agg.total).toBe(7500);
        expect(agg.count).toBe(2);
        expect(agg.months).toEqual(['2026-08']);
    });

    test('فترة جزئية تنسْب الرواتب تناسبيًا لأيام كل شهر (proration)', () => {
        const payroll = [
            { year: 2026, month: 8, netSalary: '6000' },  // 17/31 يوم من أغسطس
            { year: 2026, month: 9, netSalary: '6500' },  // 10/30 يوم من سبتمبر
        ];
        const agg = aggregatePayroll(payroll, '2026-08-15', '2026-09-10');
        expect(agg.total).toBe(round6(6000 * 17 / 31) + round6(6500 * 10 / 30));
        expect(agg.count).toBe(2);
        expect(agg.months).toEqual(['2026-08', '2026-09']);
    });

    test('شهر كامل داخل الفترة يُحسب كاملًا بلا كسور', () => {
        const payroll = [{ year: 2026, month: 8, netSalary: '6000' }];
        const agg = aggregatePayroll(payroll, '2026-08-01', '2026-08-31');
        expect(agg.total).toBe(6000);
    });

    test('صفوف بصفر رواتب أو فاسدة تُتجاهل بأمان', () => {
        expect(aggregatePayroll([], '2026-08-01', '2026-08-31').total).toBe(0);
        expect(aggregatePayroll([{ year: 'x', month: 'y', netSalary: '100' }], '2026-08-01', '2026-08-31').total).toBe(0);
        expect(aggregatePayroll(null, '2026-08-01', '2026-08-31').total).toBe(0);
    });
});

describe('تصنيف المصاريف — COGS / فروق جرد / تشغيلية', () => {
    test('dispatch و dispatch_return تكلفة مبيعات', () => {
        expect(isCogsExpense({ adjustmentType: 'dispatch' })).toBe(true);
        expect(isCogsExpense({ adjustmentType: 'dispatch_return' })).toBe(true);
        expect(isCogsExpense({ adjustment_type: 'DISPATCH' })).toBe(true);
        expect(isCogsExpense({ adjustmentType: 'count_correction' })).toBe(false);
        expect(isCogsExpense({})).toBe(false);
    });

    test('count_correction فرق جرد', () => {
        expect(isShrinkageExpense({ adjustmentType: 'count_correction' })).toBe(true);
        expect(isShrinkageExpense({ adjustmentType: 'dispatch' })).toBe(false);
    });

    test('البقية تشغيلية', () => {
        expect(isOperatingExpenseRow({ adjustmentType: 'rent' })).toBe(true);
        expect(isOperatingExpenseRow({})).toBe(true);
        expect(isOperatingExpenseRow({ adjustmentType: 'dispatch' })).toBe(false);
        expect(isOperatingExpenseRow({ adjustmentType: 'count_correction' })).toBe(false);
    });

    test('classifyExpenses: صرف 500 ومرتجع -100 → صافي COGS 400', () => {
        const cls = classifyExpenses([
            { amount: 500, date: '2026-08-01', adjustmentType: 'dispatch', category: 'مواد خام' },
            { amount: -100, date: '2026-08-02', adjustmentType: 'dispatch_return', category: 'مواد خام' },
        ], '2026-08-01', '2026-08-31');
        expect(cls.cogs.dispatch).toBe(500);
        expect(cls.cogs.returns).toBe(-100);
        expect(cls.cogs.net).toBe(400);
        expect(cls.operating.total).toBe(0);
        expect(cls.shrinkage.amount).toBe(0);
    });

    test('فروق الجرد: عجز موجب وزيادة سالبة تُفصل', () => {
        const cls = classifyExpenses([
            { amount: 80, date: '2026-08-03', adjustmentType: 'count_correction' },
            { amount: -30, date: '2026-08-04', adjustmentType: 'count_correction' },
        ], '2026-08-01', '2026-08-31');
        expect(cls.shrinkage.amount).toBe(50);
        expect(cls.shrinkage.losses).toBe(80);
        expect(cls.shrinkage.gains).toBe(-30);
        expect(cls.shrinkage.count).toBe(2);
    });

    test('التشغيلية تتجمع بالفئة والخارج عن النطاق يُستبعد', () => {
        const cls = classifyExpenses([
            { amount: 200, date: '2026-08-05', category: 'كهرباء' },
            { amount: 300, date: '2026-08-06', category: 'كهرباء' },
            { amount: 100, date: '2026-07-31', category: 'كهرباء' }, // خارج النطاق
            { amount: 50, date: '2026-09-01', category: 'إيجار' },   // خارج النطاق
        ], '2026-08-01', '2026-08-31');
        expect(cls.operating.total).toBe(500);
        expect(cls.operating.items).toHaveLength(1);
        expect(cls.operating.items[0].category).toBe('كهرباء');
        expect(cls.operating.items[0].count).toBe(2);
    });
});

describe('buildPnlStatement — هوية قائمة الدخل', () => {
    const base = {
        orders: [
            { day: '2026-08-10', subtotal: 1000, discount_total: 100, tax_total: 135, total_amount: 1035, pos_dept_code: 'erp_kitchen' },
            { day: '2026-08-11', subtotal: 500, discount_total: 0, tax_total: 75, total_amount: 575, pos_dept_code: 'erp_kitchen' },
        ],
        manualRevenues: [
            { amount: 200, date: '2026-08-12', deptId: 'kitchen' },
        ],
        expenses: [
            { amount: 400, date: '2026-08-10', adjustmentType: 'dispatch', deptId: 'kitchen', category: 'مواد خام' },
            { amount: -50, date: '2026-08-11', adjustmentType: 'dispatch_return', deptId: 'kitchen', category: 'مواد خام' },
            { amount: 30, date: '2026-08-12', adjustmentType: 'count_correction', deptId: 'kitchen' },
            { amount: 120, date: '2026-08-13', category: 'كهرباء', deptId: 'kitchen' },
        ],
        payroll: [{ year: 2026, month: 8, netSalary: '900' }],
        posDeptMap: [{ code: 'erp_kitchen', name_ar: 'المطبخ', legacy_dept_code: 'kitchen' }],
        fromDay: '2026-08-01',
        toDay: '2026-08-31',
    };

    test('الإيرادات: صافي الكاشير (بلا ضريبة) + اليدوي، والضريبة مذكّرة منفصلة', () => {
        const st = buildPnlStatement(base);
        expect(st.revenue.pos_net).toBe(1400);        // 900 + 500
        expect(st.revenue.total).toBe(1600);          // + 200 يدوي
        expect(st.revenue.vat_collected).toBe(210);   // 135 + 75
        expect(st.revenue.pos_gross).toBe(1610);
        expect(st.revenue.pos_discounts).toBe(100);
        expect(st.revenue.invoice_count).toBe(2);
    });

    test('الهوية: إيراد − COGS − عجز − تشغيلية − رواتب = صافي الربح', () => {
        const st = buildPnlStatement(base);
        // COGS = 400 - 50 = 350
        expect(st.cogs.net).toBe(350);
        expect(st.gross_profit.amount).toBe(1250);    // 1600 - 350
        // صافي = 1250 - 30 (عجز) - 120 (كهرباء) - 900 (رواتب) = 200
        expect(st.net_profit.amount).toBe(200);
        const identity = st.revenue.total - st.cogs.net - st.shrinkage.amount - st.operating.total - st.payroll.total;
        expect(roundMoney(identity)).toBe(st.net_profit.amount);
    });

    test('الهوامش صحيحة', () => {
        const st = buildPnlStatement(base);
        expect(st.gross_profit.margin_pct).toBe(roundMoney((1250 / 1600) * 100));
        expect(st.net_profit.margin_pct).toBe(roundMoney((200 / 1600) * 100));
    });

    test('تفصيل الأقسام: POS عبر legacy_dept_code + اليدوي + المصاريف', () => {
        const st = buildPnlStatement(base);
        const kitchen = st.by_department.find((d) => d.code === 'kitchen');
        expect(kitchen).toBeDefined();
        expect(kitchen.revenue).toBe(1600);           // 1400 POS + 200 يدوي
        expect(kitchen.cogs).toBe(350);
        expect(kitchen.shrinkage).toBe(30);
        expect(kitchen.operating).toBe(120);
        expect(kitchen.net).toBe(1100);
    });

    test('قسم POS بلا legacy يستمد كود ERP بإزالة erp_', () => {
        const st = buildPnlStatement({
            ...base,
            manualRevenues: [], // نعزل الإيراد اليدوي لقياس POS وحده
            posDeptMap: [{ code: 'erp_kitchen', name_ar: 'المطبخ', legacy_dept_code: null }],
        });
        const kitchen = st.by_department.find((d) => d.code === 'kitchen');
        expect(kitchen).toBeDefined();
        expect(kitchen.revenue).toBe(1400);
    });

    test('الحركات خارج الفترة لا تدخل أبدًا', () => {
        const st = buildPnlStatement({
            ...base,
            orders: [...base.orders, { day: '2026-07-31', subtotal: 9999, discount_total: 0, tax_total: 0, total_amount: 9999, pos_dept_code: 'erp_kitchen' }],
            expenses: [...base.expenses, { amount: 8888, date: '2026-09-02', adjustmentType: 'dispatch', deptId: 'kitchen' }],
        });
        expect(st.revenue.pos_net).toBe(1400);
        expect(st.cogs.net).toBe(350);
    });

    test('فترة فارغة: أصفار نظيفة بلا NaN وهوامش null', () => {
        const st = buildPnlStatement({ ...base, orders: [], manualRevenues: [], expenses: [], payroll: [] });
        expect(st.revenue.total).toBe(0);
        expect(st.cogs.net).toBe(0);
        expect(st.gross_profit.amount).toBe(0);
        expect(st.gross_profit.margin_pct).toBeNull();
        expect(st.net_profit.margin_pct).toBeNull();
        expect(Number.isFinite(st.net_profit.amount)).toBe(true);
    });

    test('السلسلة اليومية مرتبة زمنيًا وتجمع الإيراد والتكاليف', () => {
        const st = buildPnlStatement(base);
        const days = st.daily_series.map((d) => d.date);
        expect(days).toEqual([...days].sort());
        const day10 = st.daily_series.find((d) => d.date === '2026-08-10');
        expect(day10.revenue).toBe(900);
        expect(day10.cogs).toBe(400);
    });

    test('نطاق مقلوب ينفجر برسالة عربية', () => {
        expect(() => buildPnlStatement({ ...base, fromDay: '2026-08-31', toDay: '2026-08-01' })).toThrow('نطاق تاريخ غير صالح');
    });
});

describe('buildComparison و pctChange — مقارنة الفترتين', () => {
    test('pctChange: علامات صحيحة وقاعدة صفرية تعيد null', () => {
        expect(pctChange(120, 100)).toBe(20);
        expect(pctChange(80, 100)).toBe(-20);
        expect(pctChange(100, 0)).toBeNull();
        expect(pctChange(0, 0)).toBeNull();
    });

    test('مقارنة كاملة بين فترتين مبنيتين', () => {
        const mk = (net) => ({
            revenue: { total: net + 100 },
            cogs: { net: 50 },
            gross_profit: { amount: net + 50 },
            operating: { total: 20 },
            shrinkage: { amount: 5 },
            payroll: { total: 25 },
            net_profit: { amount: net },
        });
        const cmp = buildComparison(mk(200), mk(100));
        expect(cmp.revenue.current).toBe(300);
        expect(cmp.net_profit.previous).toBe(100);
        expect(cmp.net_profit.delta).toBe(100);
        expect(cmp.net_profit.pct).toBe(100);
        // بلا فترة سابقة: prev/delta/pct كلها null
        const cmpNoPrev = buildComparison(mk(200), null);
        expect(cmpNoPrev.net_profit.previous).toBeNull();
        expect(cmpNoPrev.net_profit.delta).toBeNull();
        expect(cmpNoPrev.net_profit.pct).toBeNull();
    });
});

describe('marginPct و renderPnlPrintHtml — الهوامش والطباعة', () => {
    test('هامش على قاعدة سالبة يتبع الصيغة القياسية (ربح/إيراد)', () => {
        expect(marginPct(-20, -100)).toBe(20);
        expect(marginPct(10, 0)).toBeNull();
    });

    test('HTML الطباعة يحوي الأقسام الثلاثة والتوقيعات وبلا قيم NaN', () => {
        const st = buildPnlStatement({
            orders: [{ day: '2026-08-10', subtotal: 200, discount_total: 0, tax_total: 30, total_amount: 230, pos_dept_code: 'erp_kitchen' }],
            manualRevenues: [],
            expenses: [{ amount: 80, date: '2026-08-10', adjustmentType: 'dispatch', deptId: 'kitchen', category: 'مواد خام' }],
            payroll: [],
            posDeptMap: [{ code: 'erp_kitchen', name_ar: 'المطبخ', legacy_dept_code: 'kitchen' }],
            fromDay: '2026-08-01',
            toDay: '2026-08-31',
        });
        const html = renderPnlPrintHtml(st, { restaurantName: 'مطاعم الشرفه العالمي' });
        expect(html).toContain('قائمة الأرباح والخسائر');
        expect(html).toContain('أولًا: الإيرادات');
        expect(html).toContain('ثانيًا: تكلفة المبيعات');
        expect(html).toContain('ثالثًا: المصاريف التشغيلية');
        expect(html).toContain('المدير المالي');
        expect(html).toContain('مطاعم الشرفه العالمي');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
    });

    test('HTML الطباعة يهرّب HTML في اسم المنشأة (حماية XSS)', () => {
        const st = buildPnlStatement({
            orders: [], manualRevenues: [], expenses: [], payroll: [],
            posDeptMap: [], fromDay: '2026-08-01', toDay: '2026-08-31',
        });
        const html = renderPnlPrintHtml(st, { restaurantName: '<script>alert(1)</script>' });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
