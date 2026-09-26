#!/usr/bin/env node
/**
 * tools/yara-daily-close.js — تعبئة الإغلاق اليومي للأقسام من Oracle (قراءة فقط)
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام:
 *   node tools/yara-daily-close.js --from 2026-09-01 --to 2026-09-18
 *
 *  - Oracle: SELECT فقط عبر oraExecute (حارس القراءة فقط).
 *  - كاشير 2 (الماليزي المستقل): للمعلومية فقط — يُستبعد.
 *  - يضمن صفوف pos_departments من yarasoft_revenue_map ثم يجمع
 *    (قسم/يوم/طريقة): gross/refund/counts في pos_department_daily_revenues.
 *  - Idempotent: upsert بالمفتاح (department_id, revenue_date, method).
 */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const { pool } = require('../backend/shared-pool');
const { oraExecute, loadOracleConfig, sanitizeError } = require('../backend/yarasoft/oracle-link');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return def;
    const v = process.argv[i + 1];
    return (v === undefined || v.startsWith('--')) ? true : v;
}
const isoDay = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function main() {
    const from = String(arg('from', '2026-09-01'));
    const to = String(arg('to', isoDay(new Date())));
    const cfg = loadOracleConfig();
    if (!cfg.enabled) { console.error('YARASOFT_ORACLE_ENABLED غير مفعّل'); process.exit(1); }
    const oracledb = require('oracledb');
    if (cfg.icPath && fs.existsSync(cfg.icPath)) {
        if (!process.env.NLS_LANG) process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';
        oracledb.initOracleClient({ libDir: cfg.icPath });
    }
    const conn = await oracledb.getConnection({
        user: cfg.user, password: process.env.YARASOFT_ORACLE_PASSWORD,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
    });
    const pg = await pool.connect();
    try {
        // طريقة credit قد لا توجد في enum الدفع — إضافتها آمنة
        const labels = (await pg.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='pos_payment_method'`)).rows.map(r => r.enumlabel);
        if (!labels.includes('credit')) { await pg.query(`ALTER TYPE pos_payment_method ADD VALUE 'credit'`); console.log('added enum credit'); }
        // أقسام POS من خريطة الإيرادات
        const map = (await pg.query(`SELECT src_table, COALESCE(src_name,'') AS src_name, dept_code, display_ar, display_en FROM yarasoft_revenue_map WHERE active=true`)).rows;
        const deptIdByCode = new Map();
        for (const m of map) {
            let r = (await pg.query(`SELECT id FROM pos_departments WHERE code=$1`, [m.dept_code])).rows[0];
            if (!r) {
                const hasMain = (await pg.query(`SELECT 1 FROM departments WHERE code=$1`, [m.dept_code])).rows.length > 0;
                r = (await pg.query(`INSERT INTO pos_departments (code, name_ar, name_en, legacy_dept_code, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [m.dept_code, m.display_ar, m.display_en || m.dept_code, hasMain ? m.dept_code : null])).rows[0];
            }
            deptIdByCode.set(m.src_table + '|' + m.src_name, r.id);
        }
        const ccDept = (cshr) => deptIdByCode.get('CC|' + String(cshr || '').trim());
        const b4Dept = deptIdByCode.get('BILLS4|');
        for (let day = from; day < to; day = addDays(day, 1)) {
            const next = addDays(day, 1);
            const agg = new Map(); // deptId|method -> {gross, refund, n, rn}
            const add = (deptId, method, gross, refund) => {
                if (!deptId) return;
                const k = deptId + '|' + method;
                if (!agg.has(k)) agg.set(k, { gross: 0, refund: 0, n: 0, rn: 0 });
                const a = agg.get(k);
                a.gross += gross; a.refund += refund;
                if (gross > 0) a.n++; if (refund > 0) a.rn++;
            };
            const cc = (await oraExecute(conn,
                `SELECT TRIM(CSHR_NO) AS CSHR, NVL(CASH_PYD,0) CASH_PYD, NVL(SPAN_PYD,0) SPAN_PYD, NVL(CRDT_PYD,0) CRDT_PYD, NVL(MBL_PYD,0) MBL_PYD, NET_VAL
                   FROM CC_BILLS3 WHERE DOC_DATE >= TO_DATE(:f,'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:t,'YYYY-MM-DD')
                     AND PSTD='Y' AND TRIM(CSHR_NO) <> '2'`,
                { f: day, t: next }, { outFormat: oracledb.OBJECT })).rows || [];
            for (const h of cc) {
                const d = ccDept(h.CSHR);
                const net = num(h.NET_VAL);
                if (net < 0) { add(d, 'cash', 0, Math.abs(net)); continue; }
                const parts = [['cash', num(h.CASH_PYD)], ['card', num(h.SPAN_PYD)], ['credit', num(h.CRDT_PYD)], ['wallet', num(h.MBL_PYD)]].filter(p => p[1] > 0);
                if (!parts.length && net > 0) parts.push(['cash', net]);
                for (const [m, v] of parts) add(d, m, v, 0);
            }
            if (b4Dept) {
                const b4 = (await oraExecute(conn,
                    `SELECT FCASH, FVISA, FCRDT, FBNQCHQ, NET_VAL FROM BILLS4
                      WHERE DOC_DATE >= TO_DATE(:f,'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:t,'YYYY-MM-DD') AND PSTD='Y'`,
                    { f: day, t: next }, { outFormat: oracledb.OBJECT })).rows || [];
                const yn = (v) => String(v).trim() === '1';
                for (const b of b4) {
                    const net = num(b.NET_VAL);
                    if (net < 0) { add(b4Dept, 'cash', 0, Math.abs(net)); continue; }
                    let m = 'cash';
                    if (yn(b.FVISA)) m = 'card'; else if (yn(b.FCRDT)) m = 'credit'; else if (yn(b.FBNQCHQ)) m = 'bank_transfer';
                    add(b4Dept, m, net, 0);
                }
            }
            for (const [k, a] of agg) {
                const [deptId, method] = k.split('|');
                await pg.query(`INSERT INTO pos_department_daily_revenues (department_id, revenue_date, method, gross_amount, refund_amount, invoice_count, refund_count, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                    ON CONFLICT (department_id, revenue_date, method) DO UPDATE SET gross_amount=EXCLUDED.gross_amount, refund_amount=EXCLUDED.refund_amount, invoice_count=EXCLUDED.invoice_count, refund_count=EXCLUDED.refund_count, updated_at=NOW()`,
                    [Number(deptId), day, method, Math.round(a.gross * 100) / 100, Math.round(a.refund * 100) / 100, a.n, a.rn]);
            }
            console.log(`${day}: ${agg.size} صف إغلاق`);
        }
        console.log('SUMMARY: daily close done', from, '->', to);
    } catch (e) {
        console.error('FAIL:', sanitizeError(e.message));
        process.exitCode = 1;
    } finally {
        try { await conn.close(); } catch (_) {}
        try { pg.release(); } catch (_) {}
        try { await pool.end(); } catch (_) {}
    }
}

main();
