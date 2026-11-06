#!/usr/bin/env node
/**
 * coa-migrations-rehearse-7.js — بروفة كاملة 134 → 143 ثم الرجوع بالعكس
 * ═══════════════════════════════════════════════════════════════════════════
 * يُطبّق الهجرات السبع **فعليًا** على قاعدة اختبار/نسخة، ويقيس بعد كل خطوة:
 * الخريطة، الحراس، قواعد الأنواع، أعمدة الميتاداتا، حسابات 135، وأعداد
 * users/chart/journal، وميزان المراجعة المرحّل وأرصدة الحسابات الستة.
 * ثم يرجع بالعكس ويتحقق أن كل شيء عاد إلى لقطة البداية — عدا
 * account_mapping_audit الذي يُحفظ بالتصميم (142_down لا يسقطه).
 *
 * ممنوع على الإنتاج: يرفض أي قاعدة خارج القائمة المسموحة.
 * الاستخدام:
 *   node scripts/coa-migrations-rehearse-7.js --db karim_erp_window_restore
 */
'use strict';

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ALLOWED = new Set(['karim_erp_test', 'karim_erp_staging', 'karim_erp_window_restore', 'karim_erp_apply_verify']);
const MIG = path.join(__dirname, '..', 'database', 'migrations');
const BAL_ACCOUNTS = ['2100', '1150', '5000', '1200', '4000', '3100'];

const MIGRATIONS = [
    '134_coa_foundation',
    '135_coa_global_sections',
    '139_coa_mapping_phase3',
    '140_coa_mapping_yarasoft',
    '141_coa_mapping_stock_transfer',
    '142_account_mapping_guardrails',
    '143_coa_mapping_read_paths',
];

function readMig(name) {
    const up = path.join(MIG, `${name}.sql`);
    const down = path.join(MIG, `${name}_down.sql`);
    for (const f of [up, down]) {
        if (!fs.existsSync(f)) { throw new Error('ملف هجرة مفقود: ' + path.basename(f)); }
    }
    return { up: fs.readFileSync(up, 'utf8'), down: fs.readFileSync(down, 'utf8') };
}

async function snapshot(c) {
    const s = {};
    const one = async (sql, fallback) => {
        try { return (await c.query(sql)).rows[0].n; } catch (e) {
            if (e.code === '42P01' || e.code === '42703') { return fallback; }
            throw e;
        }
    };
    s.mapping = await one(`SELECT CASE WHEN to_regclass('public.account_mapping') IS NULL
        THEN -1 ELSE (SELECT COUNT(*)::int FROM account_mapping) END AS n`, -1);
    s.reports = s.mapping < 0 ? -1 : await one(
        `SELECT COUNT(*)::int AS n FROM account_mapping WHERE module='reports'`, 0);
    s.rules = await one(`SELECT CASE WHEN to_regclass('public.account_mapping_type_rule') IS NULL
        THEN -1 ELSE (SELECT COUNT(*)::int FROM account_mapping_type_rule) END AS n`, -1);
    s.audit = await one(`SELECT CASE WHEN to_regclass('public.account_mapping_audit') IS NULL
        THEN -1 ELSE (SELECT COUNT(*)::int FROM account_mapping_audit) END AS n`, -1);
    s.mappingTrig = await one(`SELECT COUNT(*)::int AS n FROM pg_trigger
        WHERE tgname IN ('trg_account_mapping_guard','trg_account_mapping_audit') AND NOT tgisinternal`, 0);
    s.coaMetaCols = await one(`SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name='chart_of_accounts' AND column_name IN
        ('normal_balance','fs_classification','is_control','is_suspense','is_reconcilable')`, 0);
    s.coaTriggers = await one(`SELECT COUNT(*)::int AS n FROM pg_trigger
        WHERE tgname IN ('trg_coa_no_cycle','trg_coa_lock_posted_semantics') AND NOT tgisinternal`, 0);
    s.accounts135 = await one(`SELECT COUNT(DISTINCT code)::int AS n FROM chart_of_accounts
        WHERE code IN ('8','81','8101','8102','8103','71','72','7101','7102','7103','7104','7201','7202','7203','7204','7205')`, 0);
    s.users = await one('SELECT COUNT(*)::int AS n FROM users', 0);
    s.chart = await one('SELECT COUNT(*)::int AS n FROM chart_of_accounts', 0);
    s.je = await one('SELECT COUNT(*)::int AS n FROM journal_entries', 0);
    s.jl = await one('SELECT COUNT(*)::int AS n FROM journal_lines', 0);
    const tb = (await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(18,2) AS dr,
        COALESCE(SUM(l.credit),0)::numeric(18,2) AS cr
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.status='posted'`)).rows[0];
    s.tb = { dr: String(tb.dr), cr: String(tb.cr) };
    const rows = (await c.query(`SELECT l.account_code, ROUND(SUM(l.debit-l.credit),2)::numeric(18,2) AS bal
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.status='posted' AND l.account_code = ANY($1::text[])
        GROUP BY l.account_code ORDER BY l.account_code`, [BAL_ACCOUNTS])).rows;
    s.balances = {};
    for (const a of BAL_ACCOUNTS) { s.balances[a] = '0.00'; }
    for (const r of rows) { s.balances[r.account_code] = String(r.bal); }
    return s;
}

function expectStep(label, got, want) {
    for (const [k, v] of Object.entries(want)) {
        if (got[k] !== v) {
            throw new Error(`${label}: ${k} = ${JSON.stringify(got[k])} والمتوقع ${JSON.stringify(v)}`);
        }
    }
    console.log(`  ✅ ${label}`);
}

function baselineOf(s) {
    // audit مُستثنى: 142_down يحفظه بالتصميم
    const copy = { ...s };
    delete copy.audit;
    return JSON.stringify(copy);
}

(async () => {
    const args = process.argv.slice(2);
    const idx = args.indexOf('--db');
    const db = idx >= 0 ? args[idx + 1] : 'karim_erp_window_restore';
    if (!ALLOWED.has(db)) {
        console.error(`رفض: قاعدة "${db}" غير مسموحة. المسموح: ${[...ALLOWED].join(', ')} — الإنتاج karim_erp ممنوع.`);
        process.exit(2);
    }

    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
        database: db,
    });
    await client.connect();
    try {
        const before = await snapshot(client);
        console.log(`== ${db}`);
        console.log('baseline:', JSON.stringify(before));
        if (before.mapping !== -1 && before.mapping !== 25) {
            throw new Error(`نقطة بداية غير متوقعة: mapping=${before.mapping} (المتوقع -1 غير مطبّق أو 25 أساس)`);
        }
        if (before.coaMetaCols !== 0 || before.coaTriggers !== 0 || before.rules !== -1) {
            throw new Error('نقطة البداية ليست نظيفة: الميتاداتا/الحراس/القواعد موجودة — استخدم نسخة مستعادة جديدة');
        }

        const migs = {};
        for (const name of MIGRATIONS) { migs[name] = readMig(name); }

        console.log('\n▲ التطبيق 134 → 143');
        const steps = {
            '134_coa_foundation': { mapping: 25, coaMetaCols: 5, coaTriggers: 2 },
            '135_coa_global_sections': { accounts135: 16, mapping: 25 },
            '139_coa_mapping_phase3': { mapping: 33 },
            '140_coa_mapping_yarasoft': { mapping: 34 },
            '141_coa_mapping_stock_transfer': { mapping: 43 },
            '142_account_mapping_guardrails': { rules: 13, mappingTrig: 2, mapping: 43 },
            '143_coa_mapping_read_paths': { mapping: 49, reports: 6, rules: 13, mappingTrig: 2 },
        };
        for (const name of MIGRATIONS) {
            console.log(`\n▲ ${name}`);
            await client.query(migs[name].up);
            const s = await snapshot(client);
            console.log('  ' + JSON.stringify(s));
            expectStep(name, s, steps[name]);
        }

        console.log('\n▼ الرجوع 143 → 134');
        const downSteps = {
            '143_coa_mapping_read_paths': { mapping: 43, reports: 0, rules: 13, mappingTrig: 2 },
            '142_account_mapping_guardrails': { mapping: 43, rules: -1, mappingTrig: 0 },
            '141_coa_mapping_stock_transfer': { mapping: 34, rules: -1, mappingTrig: 0 },
            '140_coa_mapping_yarasoft': { mapping: 33 },
            '139_coa_mapping_phase3': { mapping: 25 },
            '135_coa_global_sections': { accounts135: 0, mapping: 25 },
            '134_coa_foundation': { mapping: -1, coaMetaCols: 0, coaTriggers: 0, accounts135: 0 },
        };
        for (const name of MIGRATIONS.slice().reverse()) {
            console.log(`\n▼ ${name}`);
            await client.query(migs[name].down);
            const s = await snapshot(client);
            console.log('  ' + JSON.stringify(s));
            expectStep(name, s, downSteps[name]);
            if (name === '142_account_mapping_guardrails' && s.audit < 0) {
                throw new Error('142_down أسقط account_mapping_audit — يجب أن يُحفظ');
            }
        }

        const after = await snapshot(client);
        console.log('\nafter:', JSON.stringify(after));
        if (baselineOf(after) !== baselineOf(before)) {
            throw new Error(`بعد الرجوع لا يطابق الأساس:\n قبل=${baselineOf(before)}\n بعد=${baselineOf(after)}`);
        }
        console.log('  ✅ العودة إلى الأساس: users/chart/journal/TB/الأرصدة/البنية مطابقة');
        console.log(`  ℹ account_mapping_audit محفوظ: ${before.audit} → ${after.audit} صفًا (بالنمو المتوقع من أحداث الحذف)`);
        console.log('\nناجح: 7 up + 7 down — القاعدة عادت للحالة الأصلية.');
    } catch (e) {
        console.error('\nفشل:', e.code || '', e.message);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
})();
