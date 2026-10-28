/**
 * cost-attribution.test.js — ربط مراكز التكلفة بالربحية (طلب المالك 2026-10-28)
 * ═══════════════════════════════════════════════════════════════════════
 * الخلل المُغلق: إيراد يارا يُسجَّل على قنوات البيع (ys_cc_N) لا على الأقسام،
 * والكلفة تُسجَّل على الأقسام. فكان كل قسم إنتاج «مركز تكلفة» بالضرورة،
 * وربحية المركز رقمٌ لا معنى له. الإصلاح ينسب إيراد كل كاشير إلى قسمه في
 * جدول dept_cashier_links (103) قبل التجميع الشجري — لا خريطة جديدة.
 *
 * العقود المثبَّتة:
 *   1) استعلام costAnalysisSql ينسب عبر revenue_links/revenue_alloc، ويضع
 *      فلتر الفترة في WHERE لا في ON (وإلا سقط إيراد خارج الفترة على قناته
 *      وظهر الإسناد زائفًا).
 *   2) buildCostAnalysisResult يوسم القنوات (channel) ومرآة البيع الخارجي
 *      (external) كي لا تُعرض كأقسام.
 *   3) قاعدة الاختبار المعزولة: كاشير مرتبط بقسم ينقل إيراده إليه، وإيراد
 *      القسم المباشر يبقى، وصف القناة يبقى صفريًا.
 *   4) الشاشة والطباعة والهجرة 122 تلتزم بالوسم نفسه.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { pool } = require('../backend/shared-pool');
const {
    costAnalysisSql, buildCostAnalysisResult, isRevenueChannel,
} = require('../backend/finance-routes');

const SCREEN = read('frontend/app/js/v2/screens/cost-analysis.js');
const CENTER_SCREEN = read('frontend/app/js/v2/screens/cost-center.js');
const MIGRATION = read('database/migrations/122_cost_centers_from_departments.sql');
const BACKFILL = read('scripts/backfill-dispatch-cost-centers.js');

describe('isRevenueChannel — القناة ليست قسمًا', () => {
    test('قنوات الكاشير تُوسم، والأقسام ومرآة البيع الخارجي لا', () => {
        expect(isRevenueChannel('ys_cc_1')).toBe(true);
        expect(isRevenueChannel('ys_cc_9')).toBe(true);
        expect(isRevenueChannel(' YS_CC_12 ')).toBe(true);
        expect(isRevenueChannel('CAF')).toBe(false);
        expect(isRevenueChannel('kitchen')).toBe(false);
        expect(isRevenueChannel('ys_b4_ext')).toBe(false);
        expect(isRevenueChannel(null)).toBe(false);
    });
});

describe('costAnalysisSql — الإسناد قبل التجميع الشجري', () => {
    const { text, params } = costAnalysisSql('2026-10-01', '2026-10-28');

    test('يقرأ خريطة الكاشير من جدول 103 ويختار هدفًا واحدًا لكل كاشير', () => {
        expect(text).toMatch(/revenue_links AS \(/);
        expect(text).toContain('FROM dept_cashier_links l');
        expect(text).toContain("'ys_cc_' || l.cashier_no");
        expect(text).toMatch(/DISTINCT ON \(l\.cashier_no\)/);
        expect(text).toContain('ORDER BY l.cashier_no, l.is_primary DESC, l.id');
    });

    test('الإسناد يحدث قبل revenue_totals، والقناة غير المرتبطة تبقى على كودها', () => {
        expect(text).toContain('COALESCE(link.target_dept, r."deptId") AS dept_code');
        expect(text.indexOf('revenue_alloc AS')).toBeLessThan(text.indexOf('revenue_totals AS'));
        expect(text).toContain('JOIN revenue_alloc alloc ON alloc.dept_code = tree.code');
    });

    test('فلتر الفترة في WHERE لا في ON — لا إيراد خارج الفترة يتسرب لصف القناة', () => {
        const alloc = text.slice(text.indexOf('revenue_alloc AS'), text.indexOf('revenue_totals AS'));
        expect(alloc).toContain('WHERE TRUE');
        expect(alloc).not.toMatch(/LEFT JOIN revenue_links[\s\S]{0,160}\$\{revenueRange\}/);
        // والعقد الأصلي للـ params لم يتغيّر: 6 قيم (إيراد، مصروف، تصنيف × من/إلى)
        expect(params).toEqual(['2026-10-01', '2026-10-29', '2026-10-01', '2026-10-29', '2026-10-01', '2026-10-29']);
    });
});

describe('buildCostAnalysisResult — وسم الصفوف', () => {
    test('القناة والبيع الخارجي موسومان، والقسم العادي ليس كذلك', () => {
        const out = buildCostAnalysisResult([
            { code: 'ys_cc_9', name: 'مبيعات كاشير 9', revenue: 0, materials: 0, count_adj: 0, operating: 0, row_count: 0 },
            { code: 'ys_b4_ext', name: 'مبيعات بيع خارجي', revenue: 500, materials: 0, count_adj: 0, operating: 0, row_count: 3 },
            { code: 'CAF', name: 'كافيه', revenue: 100, materials: 40, count_adj: 0, operating: 0, row_count: 2 },
        ]);
        const by = Object.fromEntries(out.rows.map((r) => [r.code, r]));
        expect(by['ys_cc_9'].channel).toBe(true);
        expect(by['ys_b4_ext'].channel).toBe(false);
        expect(by['ys_b4_ext'].external).toBe(true);
        expect(by['CAF'].channel).toBe(false);
        expect(by['CAF'].external).toBe(false);
        expect(by['CAF'].profit).toBe(60);
    });
});

describe('الشاشة والطباعة والهجرة — تلتزم بالوسم نفسه', () => {
    test('تحليل التكاليف يستبعد القنوات من الجدول والرسوم ويعرض سطر الإسناد', () => {
        expect(SCREEN).toContain('function departmentRows()');
        expect(SCREEN).toMatch(/rows\.filter\(\(row\) => !row\.channel\)/);
        expect(SCREEN).toContain('data-v2-attribution');
        expect(SCREEN).toContain('result.attribution');
        expect(SCREEN).toContain('table.setRows(visible)');
        expect(SCREEN).toContain('بيع خارجي — خارج الإجمالي');
    });

    test('شاشة حساب القسم تنسب الإيراد إلى كاشيرات القسم من جدول 103', () => {
        expect(CENTER_SCREEN).toContain("from '../data/dept-cashier-repo.js");
        expect(CENTER_SCREEN).toContain('deptCashierNos(dept, { links: cashierLinks, departments })');
        expect(CENTER_SCREEN).toContain('data-v2-attribution');
    });

    test('الهجرة 122 تستكمل المراكز من الأقسام بقاعدة التطبيع نفسها وتستثني القنوات', () => {
        expect(MIGRATION).toContain("REGEXP_REPLACE(d.code, '[^A-Za-z0-9_-]', '_', 'g')");
        expect(MIGRATION).toContain('ON CONFLICT (code) DO NOTHING');
        expect(MIGRATION).toContain("d.code NOT LIKE 'ys\\_%' ESCAPE '\\'");
        expect(MIGRATION).toContain('INTO cost_centers');
    });

    test('سكربت التعبئة معاينة افتراضيًا ولا يكتب فوق مركز قائم', () => {
        expect(BACKFILL).toContain("process.argv.includes('--apply')");
        expect(BACKFILL).toContain('AND l.cost_center_code IS NULL');
        expect(BACKFILL).toContain('normalizeCostCenterCode');
        expect(BACKFILL).toContain('source_type = \'dispatch\'');
    });
});

describe('قاعدة الاختبار المعزولة — الإسناد الحقيقي', () => {
    const A = 'ZZA_ATTR';
    const B = 'ZZB_ATTR';
    const CHANNEL = 'ys_cc_991';
    const FROM = '2001-02-01';
    const TO = '2001-02-28';

    beforeAll(async () => {
        await pool.query(
            `INSERT INTO departments (id, code, name, parent_code) VALUES
               (990011, $1, 'قسم اختبار أ', NULL),
               (990012, $2, 'قسم اختبار ب', NULL),
               (990014, $3, 'مبيعات كاشير اختبار', NULL)
             ON CONFLICT (code) DO NOTHING`, [A, B, CHANNEL]);
        await pool.query(
            `INSERT INTO dept_cashier_links (id, dept_code, cashier_no, is_primary)
             VALUES (990013, $1, '991', TRUE) ON CONFLICT (dept_code, cashier_no) DO NOTHING`, [B]);
        await pool.query(
            `INSERT INTO revenues (id, "deptId", source, amount, date) VALUES
               (990021, $1, 'كاشير', 100, '2001-02-10'),
               (990022, $2, 'يدوي', 25, '2001-02-11')
             ON CONFLICT (id) DO NOTHING`, [CHANNEL, A]);
        await pool.query(
            `INSERT INTO expenses (id, "deptId", "desc", amount, date, category, "adjustmentType")
             VALUES (990023, $1, 'صرف اختبار', 40, '2001-02-12', 'مواد خام', 'dispatch')
             ON CONFLICT (id) DO NOTHING`, [B]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM revenues WHERE id = ANY($1::bigint[])', [['990021', '990022']]);
        await pool.query('DELETE FROM expenses WHERE id = ANY($1::bigint[])', [['990023']]);
        await pool.query('DELETE FROM dept_cashier_links WHERE id = 990013');
        await pool.query('DELETE FROM departments WHERE code = ANY($1::text[])', [[A, B, CHANNEL]]);
        await pool.end().catch(() => {});
    });

    test('إيراد الكاشير المربوط ينتقل إلى قسمه، والمباشر يبقى، وصف القناة صفري', async () => {
        const q = costAnalysisSql(FROM, TO);
        const { rows } = await pool.query(q.text, q.params);
        const by = Object.fromEntries(rows.map((r) => [r.code, r]));
        expect(Number(by[B].revenue)).toBe(100);
        expect(Number(by[B].materials)).toBe(40);
        expect(Number(by[A].revenue)).toBe(25);
        expect(Number(by[CHANNEL].revenue)).toBe(0);
        expect(Number(by[CHANNEL].materials)).toBe(0);
    });
});
