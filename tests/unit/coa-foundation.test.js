'use strict';

/**
 * coa-foundation.test.js — اختبارات وحدات Phase 2 (بدون قاعدة بيانات).
 * تشتغل على karim_erp_test في CI (بعد KARIM_TEST_DB_ISOLATED=1) أو عبر node هنا.
 * ملاحظة: suites الموجودة في tests/ تتكلم مع PostgreSQL معزولة — هذه الوحدات
 * pure وتستخدم stub لـ db.query، فلا تلمس أي قاعدة.
 */
const { getMappedAccount, deriveNormalBalance, LEGACY_MAPPING, keyOf } = require('../../backend/coa-mapping');

describe('deriveNormalBalance', () => {
    test('asset/cogs/expense ⇒ debit', () => {
        expect(deriveNormalBalance('asset')).toBe('debit');
        expect(deriveNormalBalance('cogs')).toBe('debit');
        expect(deriveNormalBalance('expense')).toBe('debit');
    });
    test('liability/equity/revenue ⇒ credit', () => {
        expect(deriveNormalBalance('liability')).toBe('credit');
        expect(deriveNormalBalance('equity')).toBe('credit');
        expect(deriveNormalBalance('revenue')).toBe('credit');
    });
    test('نوع غير معروف ⇒ null وcase-insensitive', () => {
        expect(deriveNormalBalance('banana')).toBeNull();
        expect(deriveNormalBalance('ASSET')).toBe('debit');
        expect(deriveNormalBalance(undefined)).toBeNull();
    });
});

describe('keyOf', () => {
    test('ينظف و يوحد المفتاح', () => {
        expect(keyOf(' sales_pos ', 'pos_sale', 'revenue_account')).toBe('sales_pos.pos_sale.revenue_account');
    });
});

describe('getMappedAccount', () => {
    const stubWith = (rows) => ({ query: async () => ({ rows }) });
    const failingWith = (code) => ({ query: async () => { const e = new Error('db'); e.code = code; throw e; } });

    test('يقرأ من account_mapping عندما يكون موجودًا', async () => {
        const db = stubWith([{ account_code: '4050' }]);
        await expect(getMappedAccount(db, 'sales_pos', 'pos_sale', 'revenue_account')).resolves.toBe('4050');
    });
    test('fallback إلى الثابت القديم عند غياب الصف', async () => {
        const db = stubWith([]);
        await expect(getMappedAccount(db, 'sales_pos', 'pos_sale', 'revenue_account')).resolves.toBe('4000');
    });
    test('fallback عندما لا تُطبق 134 بعد (42P01)', async () => {
        const db = failingWith('42P01');
        await expect(getMappedAccount(db, 'yarasoft', 'gl_bridge', 'revenue_account')).resolves.toBe('4000');
    });
    test('يفشل بأمان عندما لا يوجد ثابت أيضًا', async () => {
        const db = failingWith('42P01');
        await expect(getMappedAccount(db, 'x', 'y', 'z')).resolves.toBeNull();
    });
    test('db غير صالح يمر للثوابت مباشرة', async () => {
        await expect(getMappedAccount(null, 'assets', 'depreciation_run', 'expense_account')).resolves.toBe('6600');
    });
    test('كل الثوابت القديمة قيمها أكواد صحيحة النمط', () => {
        for (const [, v] of Object.entries(LEGACY_MAPPING)) {
            expect(v).toMatch(/^[0-9]{3,4}$/);
        }
    });
});
