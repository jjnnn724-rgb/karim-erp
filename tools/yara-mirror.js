#!/usr/bin/env node
/**
 * tools/yara-mirror.js — مرآة مرحلية من Oracle (قراءة فقط) إلى جداول ora_* في Postgres
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام:
 *   node tools/yara-mirror.js --tables ITEMS,CUSTOMER,SUPLIERS --batch 2000 --phase masters-1 [--refresh]
 *
 * القواعد (أمر مالك النظام):
 *  - Oracle: SELECT فقط عبر oraExecute (حارس القراءة فقط يرفض أي كتابة قبل الشبكة).
 *  - Postgres: الكتابة فقط في جداول ora_* المحلية + ora_table_meta.
 *  - Idempotent: يتخطى أي جدول فيه بيانات، إلا مع --refresh (يعيد التعبئة).
 *  - كل تشغيل يسجّل ملخصًا في ora_mirror_runs للتدقيق والـ rollback.
 */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool } = require('../backend/shared-pool');
const { oraExecute, loadOracleConfig, sanitizeError } = require('../backend/yarasoft/oracle-link');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return def;
    const v = process.argv[i + 1];
    return (v === undefined || v.startsWith('--')) ? true : v;
}
const sanitizeName = (n) => {
    let s = String(n).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (/^\d/.test(s)) s = 'y_' + s;
    return s;
};
const valToText = (v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    return String(v);
};

async function main() {
    const tables = String(arg('tables', '')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const batch = Math.max(100, Math.min(10000, Number(arg('batch', 2000)) || 2000));
    const phase = String(arg('phase', 'adhoc')).slice(0, 60);
    const refresh = arg('refresh', false) === true || String(arg('refresh', '')).toLowerCase() === 'true';
    if (!tables.length) { console.error('حدد الجداول: --tables ITEMS,CUSTOMER'); process.exit(1); }

    const cfg = loadOracleConfig();
    if (!cfg.enabled) { console.error('YARASOFT_ORACLE_ENABLED غير مفعّل في .env'); process.exit(1); }
    const oracledb = require('oracledb');
    if (cfg.icPath) {
        const fs = require('fs');
        if (fs.existsSync(cfg.icPath)) {
            if (!process.env.NLS_LANG) process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';
            oracledb.initOracleClient({ libDir: cfg.icPath });
        }
    }
    const conn = await oracledb.getConnection({
        user: cfg.user, password: process.env.YARASOFT_ORACLE_PASSWORD,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
    });
    const pg = await pool.connect();
    const summary = { phase, tables: [], startedAt: new Date().toISOString() };
    try {
        await pg.query(`CREATE TABLE IF NOT EXISTS ora_mirror_runs (id SERIAL PRIMARY KEY, phase TEXT, table_name TEXT, rows_loaded INT, refreshed BOOL DEFAULT FALSE, started_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const t of tables) {
            const pgName = 'ora_' + sanitizeName(t);
            const hasTable = (await pg.query(`SELECT 1 FROM information_schema.tables WHERE table_name=$1`, [pgName])).rows.length > 0;
            if (!hasTable) { summary.tables.push({ table: t, status: 'missing-table' }); continue; }
            const cur = (await pg.query(`SELECT count(*)::int n FROM "${pgName}"`)).rows[0].n;
            if (cur > 0 && !refresh) { summary.tables.push({ table: t, status: 'skipped-nonempty', rows: cur }); continue; }
            if (refresh && cur > 0) await pg.query(`TRUNCATE "${pgName}"`);
            const cols = (await oraExecute(conn, `SELECT column_name FROM user_tab_columns WHERE table_name=:t ORDER BY column_id`, { t })).rows.map(r => r[0]);
            const pgCols = cols.map(sanitizeName);
            const total = (await oraExecute(conn, `SELECT count(*) FROM ${t}`)).rows[0][0];
            let loaded = 0, offset = 0;
            const sel = cols.join(', ');
            while (true) {
                // Oracle 11g: لا يدعم OFFSET/FETCH — ترقيم بـ ROWNUM
                const r = await oraExecute(conn, `SELECT * FROM (SELECT t.*, ROWNUM rnum FROM (SELECT ${sel} FROM ${t}) t WHERE ROWNUM <= :hi) WHERE rnum > :lo`, { hi: offset + batch, lo: offset });
                if (!r.rows.length) break;
                const placeholders = r.rows.map((_, i) => `(${pgCols.map((_, j) => `$${i * pgCols.length + j + 1}`).join(',')})`).join(',');
                const flat = [];
                for (const row of r.rows) for (const v of row.slice(0, pgCols.length)) flat.push(valToText(v));
                await pg.query(`INSERT INTO "${pgName}" (${pgCols.map(c => `"${c}"`).join(',')}) VALUES ${placeholders}`, flat);
                loaded += r.rows.length; offset += r.rows.length;
                process.stdout.write(`\r  ${t}: ${loaded}/${total}`);
                if (r.rows.length < batch) break;
            }
            process.stdout.write('\n');
            await pg.query(`INSERT INTO ora_mirror_runs (phase, table_name, rows_loaded, refreshed) VALUES ($1,$2,$3,$4)`, [phase, pgName, loaded, refresh]);
            await pg.query(`INSERT INTO ora_table_meta (pg_name, oracle_name, oracle_rows) VALUES ($1,$2,$3)
                ON CONFLICT (pg_name) DO UPDATE SET oracle_rows=EXCLUDED.oracle_rows, imported_at=NOW()`, [pgName, t, loaded]);
            summary.tables.push({ table: t, status: 'loaded', rows: loaded });
        }
        // إصلاح عدّادات meta للجداول المملوءة مسبقًا
        await pg.query(`INSERT INTO ora_table_meta (pg_name, oracle_name, oracle_rows)
            SELECT table_name, UPPER(SUBSTRING(table_name FROM 5)), 0 FROM information_schema.tables
            WHERE table_name LIKE 'ora\\_%' AND table_name NOT IN ('ora_table_meta','ora_mirror_runs','ora_write_queue')
            ON CONFLICT (pg_name) DO NOTHING`);
        summary.finishedAt = new Date().toISOString();
        console.log('SUMMARY:', JSON.stringify(summary));
    } catch (e) {
        console.error('FAIL:', sanitizeError(e.message));
        process.exitCode = 1;
    } finally {
        try { pg.release(); } catch (_) {}
        try { await conn.close(); } catch (_) {}
        try { await pool.end(); } catch (_) {}
    }
}

main();
