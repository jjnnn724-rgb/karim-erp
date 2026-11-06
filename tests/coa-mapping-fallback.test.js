/**
 * coa-mapping-fallback.test.js — عقد الرجوع الآمن في coa-mapping.js
 * ══════════════════════════════════════════════════════════════════════════════
 * سبب الاختبار: الإنتاج لم يطبّق 134 بعد، وكل مسارات الترحيل تقرأ الخريطة عبر
 * resolveAccounts/getMappedAccount. يجب أن يثبت أن أي غياب للجدول أو فراغه لا
 * يغيّر رقمًا واحدًا ولا يرمي خطأ — بل يرجع الثوابت القديمة نفسها.
 *
 * يغطي:
 *   1) جدول غير موجود (42P01) وعمود غير موجود (42703) ⇒ افتراضي بلا رمي.
 *   2) جدول موجود وفارغ ⇒ كل دور يبقى على افتراضيه.
 *   3) ربط جزئي ⇒ المربوط يُقرأ والباقي افتراضي (لا تلوّث بين الأدوار).
 *   4) دور غير معروف في LEGACY_MAPPING ⇒ يبقى افتراضي المُمرَّر.
 *   5) حي على karim_erp_test داخل معاملة: قراءة الربط المبذور، ثم UPDATE مؤقت،
 *      ثم DELETE كامل ⇒ افتراضي، ثم ROLLBACK يعيد العدد والقيمة حرفيًا.
 */

'use strict';

const { pool } = require('../backend/shared-pool');
const { resolveAccounts, getMappedAccount, LEGACY_MAPPING } = require('../backend/coa-mapping');

const DEFAULTS = {
    cash_account: '1000',
    bank_account: '1010',
    revenue_account: '4000',
    vat_output_account: '2100',
    cogs_account: '5000',
    inventory_account: '1200',
};

const emptyDb = { query: async () => ({ rows: [] }) };
const throwingDb = (code) => ({
    query: async () => {
        const e = new Error(`simulated ${code}`);
        e.code = code;
        throw e;
    },
});

jest.setTimeout(30000);

describe('coa-mapping — الرجوع الآمن إلى الثوابت', () => {
    test('42P01 (جدول مفقود) ⇒ الافتراضي كاملًا بلا رمي', async () => {
        await expect(resolveAccounts(throwingDb('42P01'), 'sales_pos', 'pos_sale', DEFAULTS))
            .resolves.toEqual(DEFAULTS);
        await expect(getMappedAccount(throwingDb('42P01'), 'sales_pos', 'pos_sale', 'revenue_account'))
            .resolves.toBe('4000');
    });

    test('42703 (عمود مفقود) ⇒ نفس السياسة', async () => {
        await expect(resolveAccounts(throwingDb('42703'), 'purchases', 'purchase_invoice', DEFAULTS))
            .resolves.toEqual(DEFAULTS);
        await expect(getMappedAccount(throwingDb('42703'), 'tax', 'vat_return', 'recoverable_account'))
            .resolves.toBe('1150');
    });

    test('جدول موجود وفارغ ⇒ كل دور على افتراضيه', async () => {
        await expect(resolveAccounts(emptyDb, 'payroll', 'payroll_run', {
            expense_account: '6000', payable_account: '2200',
        })).resolves.toEqual({ expense_account: '6000', payable_account: '2200' });
    });

    test('ربط جزئي ⇒ المربوط من الجدول والغائب افتراضي', async () => {
        const partial = {
            query: async () => ({ rows: [{ role: 'revenue_account', account_code: '4100' }] }),
        };
        await expect(resolveAccounts(partial, 'sales_pos', 'pos_sale', DEFAULTS)).resolves.toEqual({
            ...DEFAULTS,
            revenue_account: '4100',
        });
        // صف لدور غير مطلوب لا يُدخل مفتاحًا جديدًا ولا يرمي
        const stray = { query: async () => ({ rows: [{ role: 'not_requested', account_code: '9999' }] }) };
        await expect(resolveAccounts(stray, 'sales_pos', 'pos_sale', DEFAULTS)).resolves.toEqual(DEFAULTS);
    });

    test('دور غير معروف في LEGACY ⇒ يبقى افتراضي المُمرَّر', async () => {
        expect(LEGACY_MAPPING['sales_pos.pos_sale.unknown_role']).toBeUndefined();
        await expect(resolveAccounts(emptyDb, 'sales_pos', 'pos_sale', { unknown_role: '7777' }))
            .resolves.toEqual({ unknown_role: '7777' });
        await expect(getMappedAccount(emptyDb, 'sales_pos', 'pos_sale', 'unknown_role'))
            .resolves.toBeNull();
    });

    test('حي: قراءة مبذورة ← تعديل مؤقت ← جدول فارغ ← ROLLBACK يعيد الحالة', async () => {
        const client = await pool.connect();
        try {
            const before = (await client.query('SELECT COUNT(*)::int AS n FROM account_mapping')).rows[0].n;
            expect(before).toBeGreaterThan(0);

            await client.query('BEGIN');
            const seeded = await resolveAccounts(client, 'sales_pos', 'pos_sale', DEFAULTS);
            expect(seeded).toEqual(DEFAULTS); // البذر يطابق الثوابت حرفيًا

            await client.query(
                `UPDATE account_mapping SET account_code = '1150'
                  WHERE module = 'sales_pos' AND operation = 'pos_sale' AND role = 'revenue_account'`);
            const changed = await resolveAccounts(client, 'sales_pos', 'pos_sale', DEFAULTS);
            expect(changed.revenue_account).toBe('1150');

            await client.query('DELETE FROM account_mapping');
            await expect(resolveAccounts(client, 'sales_pos', 'pos_sale', DEFAULTS)).resolves.toEqual(DEFAULTS);
            await expect(getMappedAccount(client, 'sales_pos', 'pos_sale', 'cash_account')).resolves.toBe('1000');

            await client.query('ROLLBACK');
            const after = (await client.query('SELECT COUNT(*)::int AS n FROM account_mapping')).rows[0].n;
            const restored = await resolveAccounts(client, 'sales_pos', 'pos_sale', DEFAULTS);
            expect(after).toBe(before);
            expect(restored).toEqual(DEFAULTS);
        } finally {
            client.release();
        }
    });
});
