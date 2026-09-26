/**
 * yarasoft/oracle-data-routes.js — API ديناميكي لعرض جداول Oracle المنسوخة
 * ────────────────────────────────────────────────────────────────────────────
 * GET /api/oracle-data/tables          → قائمة كل الجداول + عدد الصفوف
 * GET /api/oracle-data/:table          → محتوى الجدول (بحث + pagination)
 * GET /api/oracle-data/:table/columns  → أعمدة الجدول
 */

'use strict';

const express = require('express');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { sanitizeError } = require('./oracle-link');

const router = express.Router();
const ROLES = ['admin', 'manager', 'accountant', 'auditor', 'hr'];

router.use(jwtAuth);

// ─── قائمة كل الجداول ──────────────────────────────────────────────────────
router.get('/tables', requireRole(...ROLES), async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT pg_name, oracle_name, oracle_rows, imported_at
            FROM ora_table_meta
            ORDER BY oracle_rows DESC
        `);
        // Live counts
        const tables = [];
        for (const row of r.rows) {
            try {
                const cnt = await pool.query(`SELECT count(*)::int AS n FROM "${row.pg_name}"`);
                tables.push({ ...row, live_count: cnt.rows[0].n });
            } catch {
                tables.push({ ...row, live_count: -1 });
            }
        }
        res.json({ ok: true, tables });
    } catch (e) {
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
});

// ─── أعمدة جدول ─────────────────────────────────────────────────────────────
router.get('/:table/columns', requireRole(...ROLES), async (req, res) => {
    const tbl = `ora_${String(req.params.table).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    try {
        const r = await pool.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position
        `, [tbl]);
        res.json({ ok: true, table: tbl, columns: r.rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
});

// ─── محتوى جدول مع بحث وpagination ──────────────────────────────────────────
router.get('/:table', requireRole(...ROLES), async (req, res) => {
    const tbl = `ora_${String(req.params.table).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;

    try {
        // Get columns
        const cols = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1 ORDER BY ordinal_position
        `, [tbl]);
        if (!cols.rows.length) {return res.status(404).json({ ok: false, error: 'الجدول غير موجود' });}

        const colNames = cols.rows.map(c => c.column_name);

        // Count
        let countSQL, params;
        if (search) {
            // Search across all text columns
            const likeClauses = colNames.map((c, i) => `"${c}"::text ILIKE $${i + 1}`);
            const likeParams = colNames.map(() => `%${search}%`);
            countSQL = `SELECT count(*)::int AS n FROM "${tbl}" WHERE ${likeClauses.join(' OR ')}`;
            params = likeParams;
        } else {
            countSQL = `SELECT count(*)::int AS n FROM "${tbl}"`;
            params = [];
        }
        const cnt = await pool.query(countSQL, params);

        // Data
        let dataSQL;
        let dataParams;
        if (search) {
            const likeClauses = colNames.map((c, i) => `"${c}"::text ILIKE $${i + 1}`);
            const likeParams = colNames.map(() => `%${search}%`);
            dataSQL = `SELECT * FROM "${tbl}" WHERE ${likeClauses.join(' OR ')} ORDER BY 1 LIMIT $${colNames.length + 1} OFFSET $${colNames.length + 2}`;
            dataParams = [...likeParams, limit, offset];
        } else {
            dataSQL = `SELECT * FROM "${tbl}" ORDER BY 1 LIMIT $1 OFFSET $2`;
            dataParams = [limit, offset];
        }
        const data = await pool.query(dataSQL, dataParams);

        res.json({
            ok: true,
            table: tbl,
            columns: colNames,
            rows: data.rows,
            total: cnt.rows[0].n,
            page,
            limit,
            totalPages: Math.ceil(cnt.rows[0].n / limit),
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
});


// ─── تحديث عدد الصفوف من Oracle ────────────────────────────────────────
router.post('/refresh', requireRole(...ROLES), async (req, res) => {
    try {
        const meta = await pool.query(`SELECT pg_name, oracle_name FROM ora_table_meta ORDER BY pg_name`);
        let refreshed = 0, failed = 0;
        for (const row of meta.rows) {
            try {
                const cnt = await pool.query(`SELECT count(*)::int AS n FROM "${row.pg_name}"`);
                await pool.query(`UPDATE ora_table_meta SET oracle_rows = $1, imported_at = NOW() WHERE pg_name = $2`, [cnt.rows[0].n, row.pg_name]);
                refreshed++;
            } catch { failed++; }
        }
        res.json({ ok: true, refreshed, failed, total: meta.rows.length });
    } catch (e) {
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
});


// ─── تحديث يومي تلقائي لكل 24 ساعة ────────────────────────────────
const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours
setTimeout(() => {
    setInterval(async () => {
        try {
            const meta = await pool.query(`SELECT pg_name FROM ora_table_meta`);
            let refreshed = 0;
            for (const row of meta.rows) {
                try {
                    const cnt = await pool.query(`SELECT count(*)::int AS n FROM "${row.pg_name}"`);
                    await pool.query(`UPDATE ora_table_meta SET oracle_rows = $1, imported_at = NOW() WHERE pg_name = $2`, [cnt.rows[0].n, row.pg_name]);
                    refreshed++;
                } catch {}
            }
            logger.info(`[Oracle Refresh] ${refreshed}/${meta.rows.length} tables updated`);
        } catch (e) { logger.error('[Oracle Refresh]', e.message); }
    }, DAILY_REFRESH_MS);
    logger.info('[Oracle Refresh] Daily scheduler started (every 24h)');
}, 5000); // start after 5 seconds

module.exports = router;
