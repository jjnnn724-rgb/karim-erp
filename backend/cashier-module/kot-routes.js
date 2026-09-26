/**
 * kot-routes.js — Kitchen Order Tickets: settings + HTML view
 * ────────────────────────────────────────────────────────────────────────────
 * The owner manages kitchen tickets from the SETTINGS screen (no code):
 *
 *   GET  /api/pos/kot/settings       — current KOT config (read roles)
 *   PUT  /api/pos/kot/settings       — save enable / copies / notes (admin+)
 *   GET  /api/pos/kot/orders/:id/html — printable RTL ticket page for the
 *                                      kitchen tablet (any authenticated staff)
 *
 * The sale pipeline (complete-sale.js) reads the same settings row and queues
 * one thermal ticket per production department into pos_pending_prints with
 * printer_id = `kot-<department_id>` — the existing print worker drains them
 * with no changes.
 */

const express = require('express');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { logger } = require('../logger');
const { buildKotGroups, buildKotData, buildEscPosKot, kotHtml } = require('./kot-printer');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'];
const WRITE_ROLES = ['admin', 'manager'];

// ─── Schema (self-healing, like zatca_settings) ──────────────────────────────
let schemaReady = null;
function ensureKotSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_print_settings (
                    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                    kot_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
                    kot_copies       SMALLINT NOT NULL DEFAULT 1 CHECK (kot_copies BETWEEN 1 AND 3),
                    kot_include_notes BOOLEAN NOT NULL DEFAULT TRUE,
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_by       TEXT
                );`);
            await pool.query(`
                INSERT INTO pos_print_settings (id) VALUES (1)
                ON CONFLICT (id) DO NOTHING;`);
        })();
    }
    return schemaReady;
}

// Tolerant read: if the table cannot be provisioned the sale pipeline still
// works with the documented defaults (enabled, 1 copy, notes on).
async function getPrintSettings() {
    try {
        await ensureKotSchema();
        const r = await pool.query(
            `SELECT kot_enabled, kot_copies, kot_include_notes, updated_at, updated_by
               FROM pos_print_settings WHERE id = 1;`);
        if (!r.rows.length) {return { kot_enabled: true, kot_copies: 1, kot_include_notes: true };}
        const row = r.rows[0];
        return {
            kot_enabled: !!row.kot_enabled,
            kot_copies: Number(row.kot_copies) || 1,
            kot_include_notes: !!row.kot_include_notes,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
        };
    } catch (e) {
        logger.warn('[kot] settings read failed — using defaults:', e.message);
        return { kot_enabled: true, kot_copies: 1, kot_include_notes: true };
    }
}

// ─── Validation (pure, unit-tested) ──────────────────────────────────────────
function validateKotSettings(body) {
    if (!body || typeof body !== 'object') {return { error: 'BODY_REQUIRED' };}
    const out = {};
    if (body.kot_enabled !== undefined) {
        if (typeof body.kot_enabled !== 'boolean') {return { error: 'KOT_ENABLED_MUST_BE_BOOLEAN' };}
        out.kot_enabled = body.kot_enabled;
    }
    if (body.kot_copies !== undefined) {
        const n = Number(body.kot_copies);
        if (!Number.isInteger(n) || n < 1 || n > 3) {return { error: 'KOT_COPIES_OUT_OF_RANGE' };}
        out.kot_copies = n;
    }
    if (body.kot_include_notes !== undefined) {
        if (typeof body.kot_include_notes !== 'boolean') {return { error: 'KOT_NOTES_MUST_BE_BOOLEAN' };}
        out.kot_include_notes = body.kot_include_notes;
    }
    if (!Object.keys(out).length) {return { error: 'NOTHING_TO_UPDATE' };}
    return { value: out };
}

// ─── Routes ──────────────────────────────────────────────────────────────────
router.get('/settings', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const cfg = await getPrintSettings();
        res.json(cfg);
    } catch (e) {
        logger.error('[kot/settings GET]', e);
        res.status(500).json({ error: 'KOT_SETTINGS_READ_FAILED' });
    }
});

router.put('/settings', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const v = validateKotSettings(req.body);
    if (v.error) {
        return res.status(422).json({ error: v.error, message: 'قيم تذاكر المطبخ غير صالحة' });
    }
    try {
        await ensureKotSchema();
        const cols = Object.keys(v.value);
        const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        const params = cols.map((c) => v.value[c]);
        params.push(req.user?.username || 'unknown');
        const r = await pool.query(
            `UPDATE pos_print_settings SET ${sets}, updated_at = CURRENT_TIMESTAMP, updated_by = $${params.length}
              WHERE id = 1 RETURNING kot_enabled, kot_copies, kot_include_notes, updated_at, updated_by;`, params);
        // audit trail like every settings action (UPDATE enum + table_name)
        try {
            await pool.query(
                `INSERT INTO pos_audit_logs(action, table_name, row_pk, reason, metadata)
                 VALUES ('UPDATE', 'pos_print_settings', '1', $1, $2::jsonb);`,
                [`تحديث إعدادات تذاكر المطبخ بواسطة ${req.user?.username || 'unknown'}`,
                 JSON.stringify({ ...v.value, by: req.user?.id || null })]);
        } catch (_) { /* audit write is non-fatal — never block the save */ }
        const row = r.rows[0];
        logger.info(`[kot] settings updated by ${req.user?.username}: ${JSON.stringify(v.value)}`);
        res.json({
            kot_enabled: !!row.kot_enabled,
            kot_copies: Number(row.kot_copies),
            kot_include_notes: !!row.kot_include_notes,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
        });
    } catch (e) {
        logger.error('[kot/settings PUT]', e);
        res.status(500).json({ error: 'KOT_SETTINGS_SAVE_FAILED' });
    }
});

// Printable kitchen ticket page for one order (kitchen tablet / browser).
router.get('/orders/:id/html', jwtAuth, async (req, res) => {  // any authenticated staff may view kitchen tickets
    try {
        const { rows } = await pool.query(
            `SELECT id, invoice_counter, invoice_uuid, notes, created_at, status
               FROM pos_orders WHERE id = $1;`, [req.params.id]);
        if (!rows.length) {return res.status(404).json({ error: 'ORDER_NOT_FOUND' });}
        const order = rows[0];
        const itemsRes = await pool.query(
            `SELECT oi.product_id, oi.quantity, p.name_ar AS product_name,
                    p.department_id AS prep_dept_id, d.name_ar AS prep_dept_name
               FROM pos_order_items oi
               JOIN pos_products p ON p.id = oi.product_id
               LEFT JOIN pos_departments d ON d.id = p.department_id
              WHERE oi.order_id = $1;`, [req.params.id]);
        const map = new Map();
        for (const r of itemsRes.rows) {
            if (r.prep_dept_id) {map.set(Number(r.product_id), { department_id: Number(r.prep_dept_id), department_name: r.prep_dept_name });}
        }
        const groups = buildKotGroups(itemsRes.rows, map);
        const cfg = await getPrintSettings();
        const datas = [];
        for (const g of groups) {
            const copies = cfg.kot_enabled ? Math.max(1, Math.min(3, Number(cfg.kot_copies) || 1)) : 1;
            for (let c = 0; c < copies; c += 1) {
                datas.push(buildKotData({ order, group: g, cashier: null, includeNotes: cfg.kot_include_notes }));
            }
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(kotHtml(datas));
    } catch (e) {
        logger.error('[kot/orders/:id/html]', e);
        res.status(500).json({ error: 'KOT_HTML_FAILED' });
    }
});

module.exports = { router, ensureKotSchema, getPrintSettings, validateKotSettings };
