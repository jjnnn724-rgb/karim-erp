/**
 * coa-phase3-stock-transfer.test.js — صرف/إرجاع المخزون والتحويلات من الخريطة
 * ─────────────────────────────────────────────────────────────────────────────
 * عقد Phase 3: `inventory.stock_dispatch` / `inventory.stock_return` (5000/1200)
 * و`dept_transfer.*` (4000/5000) مع fallback حرفي للثوابت القديمة.
 * البواني نقية، فالاختبار يثبت السطور قبل وبعد الخريطة دون قاعدة بيانات.
 */

const { buildStockMoveLines } = require('../backend/accounting-routes');
const { buildFactorySettlementLines, buildTransferCostLines } = require('../backend/dept-transfer-routes');

describe('buildStockMoveLines — الحسابات من الخريطة', () => {
    const mapped = { cogs_account: '5100', inventory_account: '1250' };

    test('صرف OUT: Dr COGS / Cr مخزون بالحسابات الممرَّرة', () => {
        expect(buildStockMoveLines(300, 'out', 'KITCHEN', mapped)).toEqual([
            { account_code: '5100', debit: 300, credit: 0, memo: 'تكلفة صرف', cost_center_code: 'KITCHEN' },
            { account_code: '1250', debit: 0, credit: 300, memo: 'صرف مخزون', cost_center_code: 'KITCHEN' },
        ]);
    });

    test('إرجاع IN: عكس متماثل بالحسابات الممرَّرة', () => {
        expect(buildStockMoveLines(120.75, 'in', null, mapped)).toEqual([
            { account_code: '1250', debit: 120.75, credit: 0, memo: 'إرجاع مخزون' },
            { account_code: '5100', debit: 0, credit: 120.75, memo: 'عكس تكلفة' },
        ]);
    });

    test('بلا خريطة يبقى 5000/1200 (لا تغيير سلوكي)', () => {
        expect(buildStockMoveLines(10, 'out').map((l) => l.account_code)).toEqual(['5000', '1200']);
        expect(buildStockMoveLines(10, 'in').map((l) => l.account_code)).toEqual(['1200', '5000']);
    });

    test('مبلغ صفري/سالب لا يُنتج سطورًا', () => {
        expect(buildStockMoveLines(0, 'out', null, mapped)).toEqual([]);
        expect(buildStockMoveLines(-5, 'in', null, mapped)).toEqual([]);
    });
});

describe('buildFactorySettlementLines — تسوية المصنع', () => {
    test('الافتراضي: Cr 4000 بمركز المصنع / Dr 5000 بمركز المنفذ', () => {
        expect(buildFactorySettlementLines({ total: 60, sourceDept: 'FACTZZ', destDept: 'external_sales' })).toEqual([
            { account_code: '4000', debit: 0, credit: 60, memo: 'إيراد مصنع — FACTZZ', cost_center_code: 'FACTZZ' },
            { account_code: '5000', debit: 60, credit: 0, memo: 'تحميل منفذ — external_sales', cost_center_code: 'EXTERNAL_SALES' },
        ]);
    });

    test('الخريطة تغيّر الحسابين ويبقى المركزان', () => {
        const lines = buildFactorySettlementLines({
            total: 60, sourceDept: 'FACTZZ', destDept: 'external_sales',
            accounts: { revenue_account: '4030', expense_account: '5120' },
        });
        expect(lines.map((l) => l.account_code)).toEqual(['4030', '5120']);
        expect(lines.map((l) => l.cost_center_code)).toEqual(['FACTZZ', 'EXTERNAL_SALES']);
        expect(lines[0].credit).toBe(60);
        expect(lines[1].debit).toBe(60);
    });
});

describe('buildTransferCostLines — نقل التكلفة بين القسمين', () => {
    test('الافتراضي: 5000/5000 بمركزين مختلفين', () => {
        expect(buildTransferCostLines({ total: 45, sourceDept: 'kitchen', destDept: 'hot_hall' })).toEqual([
            { account_code: '5000', debit: 45, credit: 0, memo: 'تكلفة تحويل — القسم المستلم', cost_center_code: 'HOT_HALL' },
            { account_code: '5000', debit: 0, credit: 45, memo: 'خصم تكلفة — القسم المرسل', cost_center_code: 'KITCHEN' },
        ]);
    });

    test('الخريطة تغيّر حساب التكلفة على الطرفين معًا', () => {
        const lines = buildTransferCostLines({
            total: 45, sourceDept: 'kitchen', destDept: 'hot_hall',
            accounts: { cost_account: '5110' },
        });
        expect(lines.map((l) => l.account_code)).toEqual(['5110', '5110']);
    });
});

describe('الربط الفعلي في الملفات', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    test('صرف/إرجاع المخزون يقرآن من الخريطة', () => {
        const src = read('backend/accounting-routes.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'inventory', 'stock_dispatch'/);
        expect(src).toMatch(/resolveAccounts\(pool, 'inventory', 'stock_return'/);
    });

    test('مسارات التحويل الثلاثة تقرأ من الخريطة ولا ثوابت inline', () => {
        const src = read('backend/dept-transfer-routes.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'dept_transfer', 'factory_settlement'/);
        expect(src).toMatch(/resolveAccounts\(pool, 'dept_transfer', 'inventory_transfer'/);
        expect(src).toMatch(/resolveAccounts\(pool, 'dept_transfer', 'factory_variance_close'/);
        expect(src).not.toMatch(/account_code: '5000', debit: v/);
        expect(src).not.toMatch(/account_code: '4000', debit: 0, credit: v/);
    });

    test('هجرة 141 تسعة أدوار بـON CONFLICT، والـdown يطابق القيم', () => {
        const up = read('database/migrations/141_coa_mapping_stock_transfer.sql');
        expect(up).toMatch(/ON CONFLICT \(module, operation, role\) DO NOTHING/);
        expect(up).toMatch(/'inventory','stock_dispatch','cogs_account','5000'/);
        expect(up).toMatch(/'dept_transfer','inventory_transfer','cost_account','5000'/);
        expect(up).not.toMatch(/DELETE/i);
        const down = read('database/migrations/141_coa_mapping_stock_transfer_down.sql');
        expect(down).toMatch(/DELETE FROM account_mapping/);
        expect(down).toMatch(/'factory_variance_close','expense_account','5000'/);
    });
});
