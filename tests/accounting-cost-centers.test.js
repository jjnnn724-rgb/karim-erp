/**
 * accounting-cost-centers.test.js — مراكز التكلفة وترحيل قيد الصرف
 * ═══════════════════════════════════════════════════════════════════════
 * عطل حقيقي في الإنتاج (2026-10-26): 21 إذنًا معتمدًا بقيمة 31,202.50 ر.س
 * لم تُرحَّل إلى دفتر الأستاذ. السبب الجذري:
 *   • `cost_centers.code` يفرض `^[A-Z0-9_-]{1,20}$` (أحرف كبيرة فقط).
 *   • `ensureCostCenters` كانت تُدرج اسم القسم كما هو (`kitchen`, `hot_hall`)،
 *     فيفشل الإدراج بقيد `cost_centers_code_check` ويُبتلع التحذير.
 *   • `postJournal` يرفع الرمز إلى `KITCHEN` ثم لا يجده ⇒ يرمي «مركز غير معروف»
 *     بعد COMMIT المخزون ⇒ Dr 5000/Cr 1200 يسقط، والمخزون ينقص بلا تكلفة.
 *
 * العقود هنا تمنع الرجوع إلى أي جزء من هذا المسار:
 *   1. تطبيع الرمز قبل الإدراج وقبل البحث (مصدر واحد).
 *   2. الإدراج idempotent عبر ON CONFLICT (سباق الاعتمادات المتزامنة).
 *   3. الفشل يُسجَّل error صريح باسم الإذن وقيمته — لا warn صامت.
 *   4. اختبار حيّ على قاعدة الاختبار: أقسام بأحرف صغيرة تُنشئ صفوفًا كبيرة.
 */
const fs = require('fs');
const path = require('path');
const { pool: sharedPool } = require('../backend/shared-pool');

const ROOT = path.join(__dirname, '..');
const ACCOUNTING = path.join(ROOT, 'backend', 'accounting-routes.js');
const WAREHOUSE = path.join(ROOT, 'backend', 'warehouse-routes.js');
const read = (p) => fs.readFileSync(p, 'utf8');

describe('مراكز التكلفة — تطبيع الرمز وترحيل قيد الصرف', () => {
    const accounting = read(ACCOUNTING);
    const warehouse = read(WAREHOUSE);

    test('الرمز يُطبَّع إلى ما يسمح به قيد الجدول قبل الإدراج', () => {
        expect(accounting).toMatch(/function normalizeCostCenterCode\(code\)/);
        expect(accounting).toMatch(/\.trim\(\)\.toUpperCase\(\)/);
        expect(accounting).toMatch(/\.replace\(\/\[\^A-Z0-9_-\]\/g, '_'\)\.slice\(0, 20\)/);
        expect(accounting).toMatch(/codes\.map\(normalizeCostCenterCode\)/);
    });

    test('postJournal يستخدم نفس التطبيع — لا فرق بين ما يُدرَج وما يُبحث عنه', () => {
        expect(accounting).toMatch(/normalizeCostCenterCode\(l\.cost_center_code\) \|\| null/);
        expect(accounting).not.toMatch(/String\(l\.cost_center_code\)\.trim\(\)\.toUpperCase\(\)\.slice\(0, 20\)/);
    });

    test('الإدراج idempotent ويتحمّل سباق الاعتمادات (ON CONFLICT لا NOT EXISTS)', () => {
        expect(accounting).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
        expect(accounting).not.toMatch(/INSERT INTO cost_centers[\s\S]{0,200}WHERE NOT EXISTS/);
    });

    test('فشل ترحيل الإذن إلى الأستاذ ليس صامتًا', () => {
        expect(warehouse).toMatch(/\[dispatch_ledger\] FAILED dispatch=/);
        expect(warehouse).toMatch(/logger\.error\(`\[dispatch_ledger\]/);
        expect(warehouse).not.toMatch(/best-effort skipped/);
    });
});

describe('مراكز التكلفة — قاعدة الاختبار المعزولة', () => {
    let pool = null;
    let ensureCostCenters = null;

    beforeAll(async () => {
        pool = sharedPool;
        await pool.query('SELECT 1');
        ensureCostCenters = require(ACCOUNTING).ensureCostCenters;
    });

    afterAll(async () => {
        if (pool) {
            await pool.query(`DELETE FROM cost_centers WHERE code IN ('KITCHEN','HOT_HALL','EXTERNAL_SALES')`).catch(() => {});
            await pool.end().catch(() => {});
        }
    });

    test('أقسام بأحرف صغيرة تُنشئ مراكز بأحرف كبيرة', async () => {
        await ensureCostCenters(['kitchen', 'hot_hall', 'external_sales']);
        const r = await pool.query(
            `SELECT code FROM cost_centers WHERE code IN ('KITCHEN','HOT_HALL','EXTERNAL_SALES') ORDER BY code`);
        expect(r.rows.map((x) => x.code)).toEqual(['EXTERNAL_SALES', 'HOT_HALL', 'KITCHEN']);
    });

    test('النداء المتكرر لا يرمي (idempotent)', async () => {
        await expect(ensureCostCenters(['kitchen', 'kitchen'])).resolves.toBeTruthy();
        const n = await pool.query(`SELECT COUNT(*)::int c FROM cost_centers WHERE code = 'KITCHEN'`);
        expect(n.rows[0].c).toBe(1);
    });

    test('رمز غير صالح يُطبَّع ولا يُسقط الطلب', async () => {
        const out = await ensureCostCenters(['dept.with dot']);
        expect(out).toContain('DEPT_WITH_DOT');
        const r = await pool.query(`SELECT code FROM cost_centers WHERE code = 'DEPT_WITH_DOT'`);
        await pool.query(`DELETE FROM cost_centers WHERE code = 'DEPT_WITH_DOT'`).catch(() => {});
        expect(r.rowCount).toBe(1);
    });

    /* الإثبات النهائي للعطل: إذن قسمه `kitchen` يجب أن يُرحَّل بقيد متوازن
       Dr 5000 / Cr 1200 ومركز تكلفة KITCHEN — وهو ما كان يفشل قبل الإصلاح. */
    test('postDispatchToLedger يرحّل إذن قسم صغير الأحرف بمركز تكلفة صحيح', async () => {
        const { postDispatchToLedger } = require(ACCOUNTING);
        const sourceId = `__test_cc_${process.pid}_${Date.now()}`;
        await pool.query(`DELETE FROM journal_lines WHERE entry_id IN
            (SELECT id FROM journal_entries WHERE source_type = 'dispatch' AND source_id = $1)`, [sourceId]).catch(() => {});
        await pool.query(`DELETE FROM journal_entries WHERE source_type = 'dispatch' AND source_id = $1`, [sourceId]).catch(() => {});

        try {
            const out = await postDispatchToLedger(sourceId, {
                totalValue: 12.5, date: '2026-10-26', deptCode: 'kitchen',
            });
            expect(out.replay).toBe(false);
            const lines = await pool.query(
                `SELECT account_code, debit, credit, cost_center_code FROM journal_lines
                  WHERE entry_id = $1 ORDER BY account_code`, [out.entry.id]);
            const byAcc = Object.fromEntries(lines.rows.map((l) => [l.account_code, l]));
            expect(Number(byAcc['5000'].debit)).toBeCloseTo(12.5, 2);
            expect(Number(byAcc['1200'].credit)).toBeCloseTo(12.5, 2);
            expect(byAcc['5000'].cost_center_code).toBe('KITCHEN');
            expect(byAcc['1200'].cost_center_code).toBe('KITCHEN');
        } finally {
            await pool.query(`DELETE FROM journal_lines WHERE entry_id IN
                (SELECT id FROM journal_entries WHERE source_type = 'dispatch' AND source_id = $1)`, [sourceId]).catch(() => {});
            await pool.query(`DELETE FROM journal_entries WHERE source_type = 'dispatch' AND source_id = $1`, [sourceId]).catch(() => {});
            await pool.query(`DELETE FROM cost_centers WHERE code = 'KITCHEN'`).catch(() => {});
        }
    });
});
