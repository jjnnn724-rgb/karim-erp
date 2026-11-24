#!/usr/bin/env node
/**
 * coa-migrations-verify.js — تحقق قابل للتكرار من هجرات CoA في معاملة واحدة ثم ROLLBACK
 * ═══════════════════════════════════════════════════════════════════════════════════
 * يُطبّق 134 → 135 → 139 → 140 → 141 ثم يعكسها 141 → 140 → 139 → 135 → 134،
 * ويقيس الأعداد/البنية عند كل خطوة، ثم يرجّع كل شيء بـROLLBACK — لا أثر دائم.
 *
 * الاستخدام:
 *   node scripts/coa-migrations-verify.js            # karim_erp_test فقط (الافتراضي والإلزامي)
 *   node scripts/coa-migrations-verify.js --db NAME  # يُرفض أي اسم غير karim_erp_test
 *
 * الإنتاج لا يُختبر هنا إطلاقًا بلا أمر مالك؛ السكربت يرفض أي قاعدة غير قاعدة
 * الاختبار. هذا قياس بنيوي (DDL داخل معاملة) وليس تطبيقًا.
 */
'use strict';

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'database', 'migrations');

const EXPECTED = {
    mappingAfter134: 25,
    mappingAfter139: 33,
    mappingAfter140: 34,
    mappingAfter141: 43,
    newAccounts135: 16,
};

function stripTx(sql) {
    return sql
        .split('\n')
        .filter((l) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(l))
        .join('\n');
}

function readMig(name) {
    const up = path.join(MIG, `${name}.sql`);
    const down = path.join(MIG, `${name}_down.sql`);
    for (const f of [up, down]) {
        if (!fs.existsSync(f)) {throw new Error('ملف هجرة مفقود: ' + path.basename(f));}
    }
    return { up: stripTx(fs.readFileSync(up, 'utf8')), down: stripTx(fs.readFileSync(down, 'utf8')) };
}

/** استعلام يتحمل غياب الجدول/العمود (بعد down 134) فيعيد 0 */
async function safeCount(c, sql) {
    try { return (await c.query(sql)).rows[0].n; }
    catch (e) {
        if (e.code === '42P01' || e.code === '42703') { return 0; }
        e.queryHint = sql.replace(/\s+/g, ' ').slice(0, 90);
        throw e;
    }
}

async function snapshot(c) {
    // تسلسلي: node-pg لا يسمح باستعلامين متوازيين على نفس الاتصال.
    // جدول مفقود يُفحص بـto_regclass أولًا: خطأ 42P01 يُجهض المعاملة حتى لو
    // التقطناه في JS، فكان الاستعلام التالي يفشل بـ25P02.
    const hasMap = (await c.query(`SELECT to_regclass('public.account_mapping') IS NOT NULL AS ok`)).rows[0].ok;
    const map = hasMap ? await safeCount(c, 'SELECT COUNT(*)::int AS n FROM account_mapping') : 0;
    const cols = await safeCount(c, `SELECT COUNT(*)::int AS n FROM information_schema.columns
               WHERE table_name = 'chart_of_accounts' AND column_name IN
                     ('normal_balance','fs_classification','is_control','is_suspense','is_reconcilable')`);
    const trg = await safeCount(c, `SELECT COUNT(*)::int AS n FROM pg_trigger
               WHERE tgname IN ('trg_coa_no_cycle','trg_coa_lock_posted_semantics') AND NOT tgisinternal`);
    const acc135 = await safeCount(c, `SELECT COUNT(DISTINCT code)::int AS n FROM chart_of_accounts
               WHERE code IN ('8','81','8101','8102','8103','71','72','7101','7102','7103','7104','7201','7202','7203','7204','7205')`);
    return {
        mapping: map,
        coaMetaCols: cols,
        coaTriggers: trg,
        accounts135: acc135,
    };
}

function check(cond, label, detail) {
    if (!cond) {throw new Error('فشل التحقق: ' + label + (detail ? ' — ' + detail : ''));}
    console.log('  ✅ ' + label);
}

(async () => {
    const args = process.argv.slice(2);
    const dbIdx = args.indexOf('--db');
    // الافتراضي قاعدة الاختبار صراحةً — لا نأخذ DB_NAME من .env لأنه يشير للإنتاج
    const dbName = dbIdx >= 0 ? args[dbIdx + 1] : 'karim_erp_test';
    if (dbName !== 'karim_erp_test') {
        console.error('رفض: السكربت يعمل على karim_erp_test فقط (المطلوب "' + dbName + '").');
        process.exit(2);
    }

    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
        database: dbName,
    });
    await client.connect();
    try {
        await client.query('BEGIN');
        const before = await snapshot(client);
        console.log('الحالة قبل (داخل المعاملة):', JSON.stringify(before));
        check(before.mapping === 25 || before.mapping === 0,
            'نقطة البداية 25 صفًا أو جدول غير مطبّق (0)', 'وجد ' + before.mapping);

        const order = [
            ['134_coa_foundation', 'mappingAfter134'],
            ['135_coa_global_sections', null],
            ['139_coa_mapping_phase3', 'mappingAfter139'],
            ['140_coa_mapping_yarasoft', 'mappingAfter140'],
            ['141_coa_mapping_stock_transfer', 'mappingAfter141'],
        ];
        const migs = {};
        for (const [name, expectKey] of order) {
            migs[name] = readMig(name);
            console.log('\n▲ ' + name);
            await client.query(migs[name].up);
            const s = await snapshot(client);
            console.log('  بعد: ' + JSON.stringify(s));
            if (expectKey) {check(s.mapping === EXPECTED[expectKey], expectKey + ' = ' + EXPECTED[expectKey], 'وجد ' + s.mapping);}
            if (name.startsWith('134_')) {
                check(s.coaMetaCols === 5, 'أعمدة الميتاداتا الخمسة موجودة', 'وجد ' + s.coaMetaCols);
                check(s.coaTriggers === 2, 'Trigger الدورة وقفل الدلالة موجودان', 'وجد ' + s.coaTriggers);
            }
            if (name.startsWith('135_')) {
                check(s.accounts135 === EXPECTED.newAccounts135, 'حسابات 135 = 16', 'وجد ' + s.accounts135);
                // إعادة التطبيق idempotent
                await client.query(migs[name].up);
                const again = await snapshot(client);
                check(again.accounts135 === s.accounts135, 'إعادة تطبيق 135 لا تكرر الحسابات');
            }
            if (expectKey) {
                await client.query(migs[name].up);
                const again = await snapshot(client);
                check(again.mapping === s.mapping, 'إعادة تطبيق ' + name + ' لا تكرر الصفوف');
            }
        }

        console.log('\n▼ الرجوع بالعكس');
        for (const [name] of order.slice().reverse()) {
            await client.query(migs[name].down);
            const s = await snapshot(client);
            console.log('  ' + name + ' → mapping=' + s.mapping + ' accounts135=' + s.accounts135);
        }
        const after = await snapshot(client);
        check(after.mapping === 0, 'account_mapping أُسقط فعليًا بعد down 134', JSON.stringify(after));
        check(after.coaMetaCols === 0, 'أعمدة الميتاداتا رجعت صفرًا');
        check(after.coaTriggers === 0, 'Triggers رجعت صفرًا');
        check(after.accounts135 === 0, 'حسابات 135 حُذفت');

        // الإثبات النهائي: بعد ROLLBACK تعود القاعدة حرفيًا كما كانت
        await client.query('ROLLBACK');
        const restored = await snapshot(client);
        check(JSON.stringify(restored) === JSON.stringify(before),
            'بعد ROLLBACK: الحالة مطابقة تمامًا للحالة قبل السكربت', JSON.stringify(restored));
        console.log('\nناجح — ولا تطبيق دائم (ROLLBACK).');
    } catch (e) {
        console.error('\nفشل:', e.code || '', e.message, e.detail || '', e.queryHint ? ('[استعلام: ' + e.queryHint + ']') : '');
        process.exitCode = 1;
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
    }
})();
