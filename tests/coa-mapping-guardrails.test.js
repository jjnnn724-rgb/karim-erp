/**
 * coa-mapping-guardrails.test.js — حراس account_mapping (هجرة 142)
 * ══════════════════════════════════════════════════════════════════════════════
 * كل شيء داخل معاملة واحدة على karim_erp_test:
 *   BEGIN ➜ تطبيق 142 ➜ إثبات السلوك ➜ تطبيق 142 ثانيةً (idempotent)
 *   ➜ 142_down ➜ ROLLBACK، ثم مطابقة الحالة حرفيًا بما كانت قبل الاختبار.
 *
 * المطلوب من المالك، وكل بند له إثبات هنا:
 *   1) نوع الحساب يطابق الدور        → account_mapping_type_rule + ACCOUNT_MAPPING_TYPE_MISMATCH
 *   2) سجل تدقيق لكل تغيير           → account_mapping_audit (INSERT/UPDATE/DELETE، من/إلى/من/by/لماذا)
 *   3) منع تغيير/حذف ربط حساب مرحّل   → ACCOUNT_MAPPING_LOCKED إلا بـ coa.allow_mapping_change='on'
 *
 * لا كتابة دائمة: لا COMMIT في أي مسار، وROLLBACK في النهاية حتى لو فشل اختبار.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');

jest.setTimeout(60000);

const UP_PATH = path.join(__dirname, '..', 'database/migrations/142_account_mapping_guardrails.sql');
const DOWN_PATH = path.join(__dirname, '..', 'database/migrations/142_account_mapping_guardrails_down.sql');

function withoutTx(sqlText) {
    return sqlText
        .split('\n')
        .filter((line) => !['BEGIN;', 'COMMIT;'].includes(line.trim()))
        .join('\n');
}

const UP = withoutTx(fs.readFileSync(UP_PATH, 'utf8'));
const DOWN = withoutTx(fs.readFileSync(DOWN_PATH, 'utf8'));

let client;

async function snap() {
    const out = {};
    const q = (t) => client.query(t).then((r) => r.rows);
    out.mapping = (await q('SELECT COUNT(*)::int AS n FROM account_mapping'))[0].n;
    const tables = (await q(
        `SELECT to_regclass('public.account_mapping_type_rule') IS NOT NULL AS rules,
                to_regclass('public.account_mapping_audit') IS NOT NULL AS audit`))[0];
    out.rules = tables.rules ? (await q('SELECT COUNT(*)::int AS n FROM account_mapping_type_rule'))[0].n : 0;
    out.audit = tables.audit ? (await q('SELECT COUNT(*)::int AS n FROM account_mapping_audit'))[0].n : 0;
    out.triggers = (await q(
        `SELECT COUNT(*)::int AS n FROM pg_trigger
          WHERE tgrelid = 'public.account_mapping'::regclass AND NOT tgisinternal
            AND tgname IN ('trg_account_mapping_guard','trg_account_mapping_audit')`))[0].n;
    out.guardFn = (await q(
        `SELECT to_regprocedure('public.trg_fn_account_mapping_guard()') IS NOT NULL AS x`))[0].x;
    return out;
}

async function expectFailure(fn, code, messageRe) {
    await client.query('SAVEPOINT sp_expect');
    let err = null;
    try {
        await fn();
    } catch (e) {
        err = e;
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_expect');
    expect(err).toBeTruthy();
    expect(String(err.code)).toBe(String(code));
    expect(err.message).toMatch(messageRe);
    return err;
}

const mappingCount = async () =>
    (await client.query('SELECT COUNT(*)::int AS n FROM account_mapping')).rows[0].n;
// ستأتي القراءات دائمًا مقيّدة بالوحدة التي تختبرها — جدول التدقيق يراكم
// صفوفًا من سويتات أخرى على نفس القاعدة الإقليمية، والعدد المطلق لا يصح.
const auditRows = async (module) => {
    let sql = `SELECT action, module, operation, role, old_account_code, new_account_code,
                old_active, new_active, changed_by::int AS changed_by, reason
           FROM account_mapping_audit`;
    const params = [];
    if (module) {
        sql += ' WHERE module = $1';
        params.push(module);
    }
    sql += ' ORDER BY id';
    return (await client.query(sql, params)).rows;
};

let before;

beforeAll(async () => {
    client = await pool.connect();
    before = await snap();
    await client.query('BEGIN');
    await client.query(UP);
});

afterAll(async () => {
    try {
        await client.query('ROLLBACK');
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
});

describe('تطبيق 142 — البنية والفحص المسبق', () => {
    test('القواعد 13 صفًا، والأدوار المحاسبية الأساسية موجودة بأنواعها', async () => {
        const rows = (await client.query(
            `SELECT role, allowed_types FROM account_mapping_type_rule ORDER BY role`)).rows;
        expect(rows).toHaveLength(13);
        const byRole = Object.fromEntries(rows.map((r) => [r.role, r.allowed_types]));
        expect(byRole.cash_account).toEqual(['asset']);
        expect(byRole.payable_account).toEqual(['liability']);
        expect(byRole.revenue_account).toEqual(['revenue']);
        expect(byRole.cogs_account).toEqual(['cogs']);
        expect(byRole.expense_account).toEqual(['expense', 'cogs']);
        expect(byRole.equity_account).toEqual(['equity']);
    });

    test('Trigger حارس واحد + Trigger تدقيق واحد، وجدول التدقيق موجود', async () => {
        const s = await snap();
        expect(s.triggers).toBe(2);
        expect(s.guardFn).toBe(true);
        expect(s.audit).toBe(before.audit);
    });

    test('الفحص المسبق: الـ25 صفًا القائمة كلها مطابقة لأدوارها (وإلا كان التطبيق فشل)', async () => {
        const bad = (await client.query(
            `SELECT COUNT(*)::int AS n
               FROM account_mapping m
               JOIN account_mapping_type_rule t ON t.role = m.role
               JOIN chart_of_accounts c ON c.code = m.account_code
              WHERE NOT (c.type = ANY (t.allowed_types))`)).rows[0].n;
        expect(bad).toBe(0);
    });
});

describe('1) مطابقة النوع (fail-closed)', () => {
    test('إدراج صحيح يُقبل ويُسجَّل في التدقيق بقيمة جديدة', async () => {
        await client.query(
            `INSERT INTO account_mapping (module, operation, role, account_code, updated_by)
             VALUES ('zz_guard','report','revenue_account','4000',1)`);
        const a = await auditRows('zz_guard');
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({
            action: 'INSERT', module: 'zz_guard', operation: 'report', role: 'revenue_account',
            old_account_code: null, new_account_code: '4000', changed_by: 1,
        });
    });

    test('دور التزام على حساب إيراد يُرفض 23514 ولا يترك صفًا ولا أثر تدقيق', async () => {
        const n0 = await mappingCount();
        const e = await expectFailure(
            () => client.query(
                `INSERT INTO account_mapping (module, operation, role, account_code)
                 VALUES ('zz_guard','bad','payable_account','4000')`),
            23514, /ACCOUNT_MAPPING_TYPE_MISMATCH/);
        expect(e.message).toContain('4000');
        expect(await mappingCount()).toBe(n0);
        expect(await auditRows('zz_guard')).toHaveLength(1);
    });

    test('تعديل الحساب إلى نوع غير مسموح يُرفض قبل الكتابة', async () => {
        await expectFailure(
            () => client.query(
                `UPDATE account_mapping SET account_code = '2000'
                  WHERE module='zz_guard' AND operation='report' AND role='revenue_account'`),
            23514, /ACCOUNT_MAPPING_TYPE_MISMATCH/);
        const row = (await client.query(
            `SELECT account_code FROM account_mapping
              WHERE module='zz_guard' AND operation='report' AND role='revenue_account'`)).rows[0];
        expect(row.account_code).toBe('4000');
    });

    test('الدور غير المذكور مسموح (open-world) لكنه يُسجَّل في التدقيق', async () => {
        await client.query(
            `INSERT INTO account_mapping (module, operation, role, account_code)
             VALUES ('zz_guard','future','future_role','4000')`);
        const row = (await client.query(
            `SELECT account_code FROM account_mapping
              WHERE module='zz_guard' AND operation='future' AND role='future_role'`)).rows[0];
        expect(row.account_code).toBe('4000');
        const a = await auditRows('zz_guard');
        expect(a[a.length - 1].action).toBe('INSERT');
        expect(a[a.length - 1].role).toBe('future_role');
    });
});

describe('2) سجل التدقيق لكل تغيير', () => {
    test('تعديل active يُسجَّل كـUPDATE بقيم قديمة/جديدة حتى لو لم يتغير الحساب', async () => {
        await client.query(
            `UPDATE account_mapping SET active = false, updated_by = 1
              WHERE module='sales_pos' AND operation='pos_sale' AND role='revenue_account'`);
        const a = (await auditRows('sales_pos')).filter((r) => r.action === 'UPDATE').pop();
        expect(a).toMatchObject({
            module: 'sales_pos', operation: 'pos_sale', role: 'revenue_account',
            old_account_code: '4000', new_account_code: '4000',
            old_active: true, new_active: false, changed_by: 1,
        });
    });
});

describe('3) قفل الحساب الذي عليه قيود مرحّلة', () => {
    test('تحويل cash_account 1000 (عليه قيود) إلى 1010 يُرفض ACCOUNT_MAPPING_LOCKED', async () => {
        await expectFailure(
            () => client.query(
                `UPDATE account_mapping SET account_code = '1010'
                  WHERE module='sales_pos' AND operation='pos_sale' AND role='cash_account'`),
            23514, /ACCOUNT_MAPPING_LOCKED/);
        const row = (await client.query(
            `SELECT account_code FROM account_mapping
              WHERE module='sales_pos' AND operation='pos_sale' AND role='cash_account'`)).rows[0];
        expect(row.account_code).toBe('1000');
    });

    test('نفس التغيير بموافقة صريحة + سبب يُقبل ويُسجَّل بالسبب ومن غيّر', async () => {
        await client.query(`SET LOCAL coa.allow_mapping_change = 'on'`);
        await client.query(`SET LOCAL coa.mapping_change_reason = 'zz guard test approval'`);
        await client.query(
            `UPDATE account_mapping SET account_code = '1010', updated_by = 1
              WHERE module='sales_pos' AND operation='pos_sale' AND role='cash_account'`);
        await client.query(`SET LOCAL coa.allow_mapping_change = 'off'`);
        await client.query(`SET LOCAL coa.mapping_change_reason = ''`);

        const a = (await auditRows('sales_pos')).filter(
            (r) => r.module === 'sales_pos' && r.operation === 'pos_sale' && r.role === 'cash_account').pop();
        expect(a).toMatchObject({
            action: 'UPDATE', old_account_code: '1000', new_account_code: '1010',
            changed_by: 1, reason: 'zz guard test approval',
        });
    });

    test('الحساب غير المرحّل يُعدَّل بلا موافقة (القفل على المرحّل فقط)', async () => {
        await client.query(
            `UPDATE account_mapping SET account_code = '1010'
              WHERE module='assets' AND operation='depreciation_run' AND role='accumulated_account'`);
        const row = (await client.query(
            `SELECT account_code FROM account_mapping
              WHERE module='assets' AND operation='depreciation_run' AND role='accumulated_account'`)).rows[0];
        expect(row.account_code).toBe('1010');
    });

    test('حذف ربط حساب مرحّل (cogs 5000) يُرفض بلا موافقة', async () => {
        await expectFailure(
            () => client.query(
                `DELETE FROM account_mapping
                  WHERE module='sales_pos' AND operation='pos_sale' AND role='cogs_account'`),
            23514, /ACCOUNT_MAPPING_LOCKED/);
        const n = (await client.query(
            `SELECT COUNT(*)::int AS n FROM account_mapping
              WHERE module='sales_pos' AND operation='pos_sale' AND role='cogs_account'`)).rows[0].n;
        expect(n).toBe(1);
    });

    test('نفس الحذف بموافقة صريحة يُقبل ويُسجَّل DELETE، والحذف غير المرحّل مسموح', async () => {
        await client.query(`SET LOCAL coa.allow_mapping_change = 'on'`);
        await client.query(`SET LOCAL coa.mapping_change_reason = 'zz guard test delete'`);
        await client.query(
            `DELETE FROM account_mapping
              WHERE module='sales_pos' AND operation='pos_sale' AND role='cogs_account'`);
        await client.query(`SET LOCAL coa.allow_mapping_change = 'off'`);
        await client.query(`SET LOCAL coa.mapping_change_reason = ''`);

        const del = (await auditRows('sales_pos')).filter(
            (r) => r.action === 'DELETE' && r.role === 'cogs_account').pop();
        expect(del).toMatchObject({
            module: 'sales_pos', operation: 'pos_sale', role: 'cogs_account',
            old_account_code: '5000', new_account_code: null, reason: 'zz guard test delete',
        });

        // 6600 بلا قيود مرحّلة → الحذف مسموح بلا موافقة، ومع ذلك يُسجَّل
        await client.query(
            `DELETE FROM account_mapping
              WHERE module='assets' AND operation='depreciation_run' AND role='expense_account'`);
        const last = (await auditRows('assets')).pop();
        expect(last).toMatchObject({
            action: 'DELETE', module: 'assets', operation: 'depreciation_run',
            role: 'expense_account', old_account_code: '6600',
        });
    });
});

describe('إعادة التطبيق والرجوع', () => {
    test('إعادة تطبيق 142 آمنة: لا تكرار قواعد ولا أثر تدقيق جديد', async () => {
        const s0 = await snap();
        await client.query(UP);
        const s1 = await snap();
        expect(s1.rules).toBe(13);
        expect(s1.triggers).toBe(2);
        expect(s1.audit).toBe(s0.audit);
    });

    test('142_down يسقط الحراس والقواعد ويحفظ سجل التدقيق كأثر', async () => {
        const auditBefore = (await snap()).audit;
        await client.query(DOWN);
        const s = await snap();
        expect(s.triggers).toBe(0);
        expect(s.guardFn).toBe(false);
        expect(s.rules).toBe(0);
        expect(s.audit).toBe(auditBefore);
        expect(s.audit).toBeGreaterThan(0);
    });

    test('ROLLBACK يعيد قاعدة الاختبار حرفيًا للحالة قبل السكربت', async () => {
        await client.query('ROLLBACK');
        const after = await snap();
        expect(after).toEqual(before);
        expect(after.rules).toBe(before.rules);
        expect(after.audit).toBe(before.audit);
        expect(after.triggers).toBe(before.triggers);
    });
});

describe('ملفات الهجرة نفسها', () => {
    const upSrc = fs.readFileSync(UP_PATH, 'utf8');
    const downSrc = fs.readFileSync(DOWN_PATH, 'utf8');

    test('الأنواع والموافقة موثّقة داخل الملف بالـGUC نفسه المستخدم في 134', () => {
        expect(upSrc).toContain('account_mapping_type_rule');
        expect(upSrc).toContain("current_setting('coa.allow_mapping_change', TRUE)");
        expect(upSrc).toContain("current_setting('coa.mapping_change_reason', TRUE)");
        expect(upSrc.match(/ACCOUNT_MAPPING_LOCKED/g).length).toBeGreaterThanOrEqual(2);
        expect(upSrc).toMatch(/ON CONFLICT \(role\) DO NOTHING/);
    });

    test('down لا يُسقط سجل التدقيق (قرار رقمي موثّق في رأس الملف)', () => {
        expect(downSrc).not.toMatch(/DROP TABLE IF EXISTS account_mapping_audit/);
        expect(downSrc).toMatch(/DROP TABLE IF EXISTS account_mapping_type_rule/);
    });
});
