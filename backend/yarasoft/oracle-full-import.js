/**
 * yarasoft/oracle-full-import.js
 * ────────────────────────────────────────────────────────────────────────────
 * سكريبت عام لنسخ كل جداول Oracle إلى PostgreSQL
 * 1. يكتشف كل جداول Oracle (user_tables + user_tab_columns)
 * 2. ينظف أسماء الأعمدة (لا يسمح بحروف كبيرة في PG)
 * 3. ينشئ جداول في PostgreSQL بـ TEXT فقط (بدون فقدان بيانات)
 * 4. يسحب كل الصفوف من Oracle ويلحقها في PG
 *
 * الاستخدام: node yarasoft/oracle-full-import.js
 * لا يمس أي جدول موجود مسبقًا في Karim.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { oraExecute } = require('./oracle-link');

let _oracledb = null;
function ora() {
    if (!_oracledb) {
        _oracledb = require('oracledb');
        const ic = (process.env.YARASOFT_ORACLE_IC_PATH || '').trim();
        if (ic) { try { if (!process.env.NLS_LANG) {process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';} _oracledb.initOracleClient({ libDir: ic }); } catch (_) {} }
    }
    return _oracledb;
}

function sanitizeName(name) {
    let n = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (/^\d/.test(n)) {n = 'y_' + n;}
    return n;
}

function oraConn() {
    const oracledb = ora();
    return oracledb.getConnection({
        user: process.env.YARASOFT_ORACLE_USER,
        password: process.env.YARASOFT_ORACLE_PASSWORD,
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${process.env.YARASOFT_ORACLE_HOST || '192.168.1.188'})(PORT=${Number(process.env.YARASOFT_ORACLE_PORT) || 1521}))(CONNECT_DATA=(SERVICE_NAME=${process.env.YARASOFT_ORACLE_SERVICE || 'ORACLE'})))`,
    });
}

async function discover(oraConnInst) {
    const tables = await oraExecute(oraConnInst,
        `SELECT table_name FROM user_tables ORDER BY table_name`
    );
    const result = [];
    for (const row of tables.rows) {
        const rawName = row[0];
        const cols = await oraExecute(oraConnInst,
            `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable
             FROM user_tab_columns WHERE table_name = :t ORDER BY column_id`,
            { t: rawName }
        );
        const cnt = await oraExecute(oraConnInst, `SELECT count(*) FROM ${rawName}`);
        result.push({
            rawName,
            pgName: 'ora_' + sanitizeName(rawName),
            rows: cnt.rows[0][0],
            cols: cols.rows.map(c => ({
                rawCol: c[0],
                pgCol: sanitizeName(c[0]),
                type: c[1],
                nullable: c[5] === 'Y',
            })),
        });
    }
    return result;
}

async function tableExists(pgClient, tableName) {
    const r = await pgClient.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
        [tableName]
    );
    return r.rows[0].exists;
}

async function createTable(pgClient, tbl) {
    if (await tableExists(pgClient, tbl.pgName)) {
        logger.info(`SKIP (exists): ${tbl.pgName}`);
        return false;
    }
    const colDefs = tbl.cols.map(c => `"${c.pgCol}" TEXT`).join(', ');
    await pgClient.query(`CREATE TABLE IF NOT EXISTS "${tbl.pgName}" (${colDefs})`);
    // metadata table to track Oracle source
    if (!await tableExists(pgClient, 'ora_table_meta')) {
        await pgClient.query(`CREATE TABLE IF NOT EXISTS ora_table_meta (
            pg_name TEXT PRIMARY KEY,
            oracle_name TEXT,
            oracle_rows INT,
            imported_at TIMESTAMPTZ DEFAULT NOW()
        )`);
    }
    await pgClient.query(
        `INSERT INTO ora_table_meta (pg_name, oracle_name, oracle_rows) VALUES ($1, $2, $3)
         ON CONFLICT (pg_name) DO UPDATE SET oracle_rows = EXCLUDED.oracle_rows, imported_at = NOW()`,
        [tbl.pgName, tbl.rawName, tbl.rows]
    );
    logger.info(`CREATED: ${tbl.pgName} (${tbl.cols.length} cols)`);
    return true;
}

async function importTable(pgClient, oraConnInst, tbl, batchSize = 5000) {
    const pgCols = tbl.cols.map(c => c.pgCol);
    const placeholders = pgCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertSQL = `INSERT INTO "${tbl.pgName}" (${pgCols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

    const oracledb = ora();
    const result = await oraExecute(oraConnInst,
        `SELECT * FROM ${tbl.rawName}`,
        {},
        { outFormat: oracledb.ARRAY, fetchTypeHandler: () => oracledb.STRING }
    );

    const rows = result.rows || [];
    if (!rows.length) {
        logger.info(`EMPTY: ${tbl.pgName} (0 rows)`);
        return 0;
    }

    // Paginate
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await pgClient.query('BEGIN');
        try {
            for (const row of batch) {
                const vals = row.map(v => v === undefined || v === null ? null : String(v));
                // Pad if row has fewer cols than expected
                while (vals.length < pgCols.length) {vals.push(null);}
                await pgClient.query(insertSQL, vals);
            }
            await pgClient.query('COMMIT');
            inserted += batch.length;
        } catch (e) {
            await pgClient.query('ROLLBACK');
            logger.error(`BATCH FAIL ${tbl.pgName} @ ${i}: ${e.message.slice(0, 120)}`);
        }
    }
    logger.info(`IMPORTED: ${tbl.pgName} = ${inserted}/${rows.length} rows`);
    return inserted;
}

async function main() {
    const oraConnInst = await oraConn();
    logger.info('Oracle connected — discovering tables...');

    const tables = await discover(oraConnInst);
    const withData = tables.filter(t => t.rows > 0);
    logger.info(`Found ${tables.length} tables, ${withData.length} with data`);

    const pgClient = await pool.connect();
    let created = 0, imported = 0, skipped = 0;

    try {
        for (const tbl of withData) {
            const isNew = await createTable(pgClient, tbl);
            if (isNew) {
                const n = await importTable(pgClient, oraConnInst, tbl);
                imported += n;
                created++;
            } else {
                skipped++;
            }
        }
    } finally {
        pgClient.release();
        await oraConnInst.close();
    }

    const summary = { tables: tables.length, withData: withData.length, created, imported, skipped };
    logger.info(`DONE: ${JSON.stringify(summary)}`);
    return summary;
}

if (require.main === module) {
    main()
        .then(s => { console.log('SUMMARY:', JSON.stringify(s)); process.exit(0); })
        .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
}

module.exports = { main };
