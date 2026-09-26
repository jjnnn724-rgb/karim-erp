#!/usr/bin/env node
/**
 * tools/yara-cc-backfill.js — تعبئة فواتير الكاشير (CC) من Oracle لسبتمبر
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام:
 *   node tools/yara-cc-backfill.js --from 2026-09-01 --to 2026-09-18 [--dry]
 *
 * القواعد (أمر مالك النظام):
 *  - Oracle: SELECT فقط عبر oraExecute (حارس القراءة فقط).
 *  - كاشير 2 (الماليزي المستقل): للمعلومية فقط — يُستبعد من الدفاتر تمامًا.
 *  - نفس خط الاستهلاك: ملف staging بنفس الصيغة + consumeAllPending
 *    (نفس idempotency ora:CC:DOC_NO + نفس سكيب المبالغ غير الصالحة).
 *  - بدون --dry: يرحّل فعليًا (LIVE من .env). مع --dry: سحب وكتابة staging فقط دون استهلاك.
 */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
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

async function main() {
    const dry = arg('dry', false) === true || String(arg('dry', '')).toLowerCase() === 'true';
    const from = String(arg('from', '2026-09-01'));
    const to = String(arg('to', isoDay(new Date())));
    const cfg = loadOracleConfig();
    if (!cfg.enabled) { console.error('YARASOFT_ORACLE_ENABLED غير مفعّل'); process.exit(1); }
    if (!cfg.stagingDir) { console.error('YARASOFT_ORACLE_STAGING غير مضبوط'); process.exit(1); }
    const oracledb = require('oracledb');
    if (cfg.icPath && fs.existsSync(cfg.icPath)) {
        if (!process.env.NLS_LANG) process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';
        oracledb.initOracleClient({ libDir: cfg.icPath });
    }
    const conn = await oracledb.getConnection({
        user: cfg.user, password: process.env.YARASOFT_ORACLE_PASSWORD,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
    });
    console.log('TRACE connected, starting days', from, '->', to);
    const out = { from, to, dry, days: [] };
    try {
        fs.mkdirSync(cfg.stagingDir, { recursive: true });
        for (let day = from; day < to; day = addDays(day, 1)) {
            const next = addDays(day, 1);
            // JOIN واحد على السيرفر: الترويسة + السطور معًا (تجنب N+1 فوق Tailscale)
            const jr = (await oraExecute(conn,
                `SELECT h.DOC_NO, h.DOC_DATE, h.NET_VAL, h.TOTAL_VAL, TRIM(h.CSHR_NO) AS CSHR,
                        e.ITM_NO, e.ITM_NAME, e.QNT, e.SALE_PRICE, e.SALE_VAL
                   FROM CC_BILLS3 h LEFT JOIN CC_BILL_ENTER3 e ON e.DOC_NO = h.DOC_NO
                  WHERE h.DOC_DATE >= TO_DATE(:f,'YYYY-MM-DD') AND h.DOC_DATE < TO_DATE(:t,'YYYY-MM-DD')
                    AND h.PSTD = 'Y' AND TRIM(h.CSHR_NO) <> '2'
                  ORDER BY h.DOC_NO`,
                { f: day, t: next }, { outFormat: oracledb.OBJECT })).rows || [];
            const heads = new Map();
            for (const r of jr) {
                const k = String(r.DOC_NO);
                if (!heads.has(k)) heads.set(k, { DOC_NO: k, DOC_DATE: r.DOC_DATE, NET_VAL: r.NET_VAL, TOTAL_VAL: r.TOTAL_VAL, CSHR: r.CSHR, lines: [] });
                if (r.ITM_NO != null) heads.get(k).lines.push(r);
            }
            if (!heads.size) { out.days.push({ day, bills: 0 }); continue; }
            const rows = [];
            for (const h of heads.values()) {
                const k = h.DOC_NO;
                const ls = h.lines;
                if (!ls.length) {
                    rows.push({ SRC_TABLE: 'CC', DOC_NO: k, DOC_DATE: h.DOC_DATE, NET_VAL: h.NET_VAL, TOTAL_VAL: h.TOTAL_VAL, TO_FOR_NM: h.CSHR, ITM_NO: null, BAR_CODE: null, ITMNAME: null, OUT_QNT: null, SALE_PRICE: null, LINE_TOTAL: null });
                } else for (const l of ls) {
                    rows.push({ SRC_TABLE: 'CC', DOC_NO: k, DOC_DATE: h.DOC_DATE, NET_VAL: h.NET_VAL, TOTAL_VAL: h.TOTAL_VAL, TO_FOR_NM: h.CSHR, ITM_NO: l.ITM_NO, BAR_CODE: null, ITMNAME: l.ITM_NAME, OUT_QNT: l.QNT, SALE_PRICE: l.SALE_PRICE, LINE_TOTAL: l.SALE_VAL });
                }
            }
            const fname = `ys_ora_ccback_${day.replace(/-/g, '')}_${Date.now()}.json`;
            fs.writeFileSync(path.join(cfg.stagingDir, fname),
                JSON.stringify({ source: 'yarasoft_cc_backfill', window: [day, next], pulledAt: new Date().toISOString(), rows }));
            let consumed = null;
            if (!dry) {
                const { consumeAllPending } = require('../backend/yarasoft/oracle-consume');
                const c = await consumeAllPending({});
                const r = (c.results || [])[0] || {};
                consumed = { completed: r.completed || 0, duplicates: r.duplicates || 0, failed: r.failed || 0, needsMapping: r.needsMapping || 0 };
            }
            out.days.push({ day, bills: heads.size, rows: rows.length, consumed });
            console.log(`${day}: ${heads.size} bills / ${rows.length} rows` + (consumed ? ` -> posted ${consumed.completed} dups ${consumed.duplicates} failed ${consumed.failed}` : ' (dry)'));
        }
        console.log('SUMMARY:', JSON.stringify({ ...out, days: out.days.length }));
    } catch (e) {
        console.error('FAIL:', sanitizeError(e.message));
        process.exitCode = 1;
    } finally {
        try { await conn.close(); } catch (_) {}
        try { await pool.end(); } catch (_) {}
    }
}

main();
