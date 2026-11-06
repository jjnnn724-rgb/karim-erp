'use strict';

/**
 * coa-phase2-r05.test.js — عقد R-05: الترحيل الفاشل لا يمرّ صامتًا.
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 2 أوصلت مسارَي best-effort (فاتورة الشراء، دفعة المورد) بـ
 * `posting_failures`، وربطت الإهلاك بـ `account_mapping`. هذا الملف pure:
 * يستخدم stub للـ db ولا يلمس أي قاعدة، ويُثبّت الاثنين نصيًّا وسلوكيًّا حتى لا
 * يعود catch صامت ولا يعود ثابت حساب مكتوبًا في مسار الإهلاك.
 */
const fs = require('fs');
const path = require('path');
const { recordPostingFailure } = require('../backend/posting-failures');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('recordPostingFailure — السلوك', () => {
    test('يكتب INSERT بوسائط مربوطة ويعيد المعرّف', async () => {
        const calls = [];
        const db = {
            query: async (sql, params) => {
                calls.push({ sql, params });
                return { rows: [{ id: 42 }] };
            },
        };
        const id = await recordPostingFailure(db, {
            module: 'purchases',
            source_type: 'purchase_invoice',
            source_id: 1338,
            payload: { total: 10 },
            error: new Error('boom'),
        });

        expect(id).toBe(42);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain('INSERT INTO posting_failures');
        expect(calls[0].sql).toContain('$1');
        expect(calls[0].sql).toContain('$5');
        expect(calls[0].sql).not.toContain('boom');
        expect(calls[0].params).toEqual(['purchases', 'purchase_invoice', '1338', '{"total":10}', 'boom']);
    });

    test('جدول مفقود (42P01) لا يرمي — يعيد null', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const db = {
            query: async () => { const e = new Error('relation "posting_failures" does not exist'); e.code = '42P01'; throw e; },
        };
        await expect(recordPostingFailure(db, { module: 'm', source_type: 's', error: new Error('x') })).resolves.toBeNull();
        warn.mockRestore();
    });

    test('غياب db أو payload لا يرمي', async () => {
        await expect(recordPostingFailure(null, { module: 'm', source_type: 's', error: 'x' })).resolves.toBeNull();
        const db = { query: async () => ({ rows: [{ id: 1 }] }) };
        await expect(recordPostingFailure(db, { module: 'm', source_type: 's', payload: null, error: 'x' })).resolves.toBe(1);
    });
});

describe('التوصيل النصّي — لا catch صامت', () => {
    test('فاتورة الشراء تسجّل الفشل بـ purchase_invoice', () => {
        const src = read('backend/warehouse/inventory-routes.js');
        expect(src).toContain('recordPostingFailure(pool');
        expect(src).toContain("source_type: 'purchase_invoice'");
    });

    test('دفعة المورد تسجّل الفشل بـ supplier_payment', () => {
        const src = read('backend/procurement-routes.js');
        expect(src).toContain('recordPostingFailure(pool');
        expect(src).toContain("source_type: 'supplier_payment'");
    });

    test('هجرة 134 تُنشئ الجدول بالأعمدة التي تعتمد عليها الوحدة', () => {
        const sql = read('database/migrations/134_coa_foundation.sql');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS posting_failures');
        for (const col of ['module', 'source_type', 'source_id', 'payload', 'error']) {
            expect(sql).toContain(col);
        }
    });
});

describe('الإهلاك — الحساب من mapping مع رجوع آمن', () => {
    const src = read('backend/accounting-growth.js');

    test('يقرأ الطرفين من assets.depreciation_run', () => {
        expect(src).toContain("getMappedAccount(client, 'assets', 'depreciation_run', 'expense_account')");
        expect(src).toContain("getMappedAccount(client, 'assets', 'depreciation_run', 'accumulated_account')");
    });

    test('السطور تستخدم المتغيّرين لا ثابتًا مكتوبًا', () => {
        expect(src).toContain('{ account_code: expenseAcct, debit: total, credit: 0 }');
        expect(src).toContain('{ account_code: accumAcct, debit: 0, credit: total }');
        expect(src).not.toContain("account_code: '6600'");
        expect(src).not.toContain("account_code: '1520'");
    });
});
