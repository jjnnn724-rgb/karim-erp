'use strict';

/**
 * accounting-periods.js — Period lock + draft/approve + closing statements.
 * ────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/accounting alongside accounting-routes.js (Express merges).
 * All additive: existing posted/void flows keep working untouched.
 *
 * @module accounting-periods
 * @typedef {object} PeriodRow
 * @property {string} period - YYYY-MM
 * @property {boolean} closed
 * @property {number} posted
 * @property {number} drafts
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { riyadhToday } = require('./riyadh-date');

const router = express.Router();
const READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const WRITE_ROLES = ['admin', 'accountant'];

// node-pg يُرجع عمود DATE ككائن Date (منتصف الليل المحلي) — String(date) كان
// يعطي "Mon Sep ..." فيفشل اختبار YYYY-MM فيُتخطى فحص القفل بصمت. نجدد الشهر
// من مكونات التاريخ المحلية (لا toISOString — ينزح يومًا في UTC+3).
const periodOf = (dateStr) => {
    if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) {
        return `${dateStr.getFullYear()}-${String(dateStr.getMonth() + 1).padStart(2, '0')}`;
    }
    return String(dateStr || '').slice(0, 7);
};

/** @param {string} period - YYYY-MM @returns {Promise<boolean>} */
async function isPeriodClosed(period) {
    if (!/^\d{4}-\d{2}$/.test(period)) {return false;}
    const r = await pool.query('SELECT closed FROM accounting_periods WHERE period = $1 LIMIT 1', [period]);
    return r.rows[0] ? r.rows[0].closed === true : false;
}

/** @param {string} period - YYYY-MM @returns {Error & {statusCode:number}} */
function closedError(period) {
    return Object.assign(new Error(`الفترة ${period} مقفلة — افتحها أولًا من الإغلاق الشهري`), { statusCode: 423 });
}

/** @param {string} dateStr - YYYY-MM-DD @returns {Promise<void>} @throws {Error} 423 when locked */
async function assertPeriodOpen(dateStr) {
    const p = periodOf(dateStr);
    if (/^\d{4}-\d{2}$/.test(p) && await isPeriodClosed(p)) {throw closedError(p);}
}

// ─── الفترات ────────────────────────────────────────────────────────────────
router.get('/periods', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `WITH months AS (
               SELECT TO_CHAR(d, 'YYYY-MM') AS period FROM
                 generate_series(date_trunc('month', NOW()) - INTERVAL '23 months',
                                 date_trunc('month', NOW()), INTERVAL '1 month') d
             )
             SELECT m.period,
                    COALESCE(p.closed, FALSE) AS closed,
                    p.closed_at, u.username AS closed_by_name,
                    COALESCE((SELECT COUNT(*)::int FROM journal_entries j
                               WHERE TO_CHAR(j.date, 'YYYY-MM') = m.period AND j.status = 'posted'), 0) AS posted,
                    COALESCE((SELECT COUNT(*)::int FROM journal_entries j
                               WHERE TO_CHAR(j.date, 'YYYY-MM') = m.period AND j.status = 'draft'), 0) AS drafts
               FROM months m
               LEFT JOIN accounting_periods p ON p.period = m.period
               LEFT JOIN users u ON u.id = p.closed_by
               ORDER BY m.period DESC`
        );
        res.json({ ok: true, periods: rows });
    } catch (e) { next(e); }
});

router.post('/periods/:period/close', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const period = String(req.params.period || '');
        if (!/^\d{4}-\d{2}$/.test(period)) {
            return res.status(422).json({ error: 'PERIOD_INVALID', message: 'الفترة بصيغة YYYY-MM' });
        }
        const drafts = (await pool.query(
            `SELECT COUNT(*)::int AS n FROM journal_entries
              WHERE TO_CHAR(date, 'YYYY-MM') = $1 AND status = 'draft'`, [period])).rows[0].n;
        if (drafts > 0) {
            return res.status(422).json({
                error: 'PERIOD_HAS_DRAFTS',
                message: `لا يمكن القفل: ${drafts} مسودة معلقة في ${period} — اعتمدها أو ألغها أولًا`,
            });
        }
        await pool.query(
            `INSERT INTO accounting_periods (period, closed, closed_by, closed_at, note)
             VALUES ($1, TRUE, $2, NOW(), $3)
             ON CONFLICT (period) DO UPDATE SET closed = TRUE, closed_by = $2, closed_at = NOW(), note = $3`,
            [period, req.user?.id || null, String(req.body?.note || '').slice(0, 255) || null]
        );
        logger.info(`[PERIOD] أُقفلت ${period} بواسطة ${req.user?.name || req.user?.id}`);
        if (req.io) {req.io.emit('entity_changed', { entity: 'accounting_period', action: 'close', data: { period } });}
        res.json({ ok: true, period, closed: true });
    } catch (e) { next(e); }
});

router.post('/periods/:period/open', jwtAuth, requireRole('admin'), async (req, res, next) => {
    try {
        const period = String(req.params.period || '');
        if (!/^\d{4}-\d{2}$/.test(period)) {
            return res.status(422).json({ error: 'PERIOD_INVALID', message: 'الفترة بصيغة YYYY-MM' });
        }
        await pool.query(
            `INSERT INTO accounting_periods (period, closed, note)
             VALUES ($1, FALSE, $2)
             ON CONFLICT (period) DO UPDATE SET closed = FALSE, note = $2`,
            [period, `reopened by ${req.user?.name || req.user?.id}: ${String(req.body?.note || '').slice(0, 200)}`]
        );
        logger.info(`[PERIOD] أُعيد فتح ${period} بواسطة ${req.user?.name || req.user?.id} — حدث مسجل`);
        res.json({ ok: true, period, closed: false });
    } catch (e) { next(e); }
});

// ─── المسودات والاعتماد ─────────────────────────────────────────────────────
router.get('/drafts', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT e.*, u.username AS created_by_name,
                    COALESCE((SELECT SUM(debit)::numeric(14,2) FROM journal_lines l WHERE l.entry_id = e.id), 0) AS total
               FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by
              WHERE e.status = 'draft' ORDER BY e.date DESC, e.id DESC LIMIT 200`
        );
        res.json({ ok: true, count: rows.length, drafts: rows });
    } catch (e) { next(e); }
});

router.post('/journal/:id/approve', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ error: 'LEDGER_ID_INVALID', message: 'معرف القيد غير صالح' });
        }
        const cur = (await pool.query('SELECT * FROM journal_entries WHERE id = $1', [id])).rows[0];
        if (!cur) {return res.status(404).json({ error: 'LEDGER_ENTRY_NOT_FOUND', message: 'القيد غير موجود' });}
        if (cur.status !== 'draft') {
            return res.status(422).json({ error: 'LEDGER_NOT_DRAFT', message: 'الاعتماد للمسودات فقط' });
        }
        await assertPeriodOpen(cur.date);
        const { rows } = await pool.query(
            `UPDATE journal_entries SET status = 'posted', approved_by = $2, approved_at = NOW()
              WHERE id = $1 AND status = 'draft' RETURNING *`,
            [id, req.user?.id || null]
        );
        if (!rows[0]) {
            // سباق: طلب اعتماد آخر سبقنا — القيد لم يعد مسودة.
            return res.status(409).json({ error: 'LEDGER_ALREADY_APPROVED', message: 'القيد اعتُمد للتو من جهاز آخر' });
        }
        logger.info(`[LEDGER] اعتُمد القيد ${rows[0].entry_no} بواسطة ${req.user?.name || req.user?.username || req.user?.id}`);
        if (req.io) {req.io.emit('entity_changed', { entity: 'journal', action: 'approve', data: rows[0] });}
        res.json({ ok: true, entry: rows[0] });
    } catch (e) {
        logger.error('[LEDGER_APPROVE]', e.message);
        const code = e.statusCode || 500;
        res.status(code).json({
            error: code === 423 ? 'PERIOD_LOCKED' : 'LEDGER_APPROVE_FAILED',
            message: code === 423 ? e.message : 'تعذر اعتماد القيد — راجع سجل الخادم',
        });
    }
});

// ─── الميزانية العمومية ─────────────────────────────────────────────────────
router.get('/balance-sheet', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.as_of || ''))
            ? String(req.query.as_of) : riyadhToday();
        const { rows } = await pool.query(
            `SELECT c.code, c.name_ar, c.name_en, c.type,
                    COALESCE(SUM(l.debit), 0)::numeric(14,2) AS dr,
                    COALESCE(SUM(l.credit), 0)::numeric(14,2) AS cr
               FROM chart_of_accounts c
               LEFT JOIN journal_lines l ON l.account_code = c.code
                AND EXISTS (SELECT 1 FROM journal_entries e
                             WHERE e.id = l.entry_id
                               AND e.status = 'posted' AND e.date <= $1::date)
              WHERE c.is_active = TRUE
              GROUP BY c.code, c.name_ar, c.name_en, c.type
              ORDER BY c.code`,
            [asOf]
        );
        const bal = (r) => Number(r.dr) - Number(r.cr); // مدين موجب
        const isDr = (t) => t === 'asset' || t === 'cogs' || t === 'expense';
        const accounts = rows.map((r) => ({ ...r, balance: isDr(r.type) ? bal(r) : -bal(r) }));
        const sum = (t) => accounts.filter((a) => a.type === t)
            .reduce((s, a) => s + a.balance, 0);
        const profit = sum('revenue') - sum('cogs') - sum('expense');
        const assets = sum('asset'), liabilities = sum('liability');
        const equity = sum('equity') + profit;
        res.json({
            ok: true, as_of: asOf,
            assets: accounts.filter((a) => a.type === 'asset'),
            liabilities: accounts.filter((a) => a.type === 'liability'),
            equity: accounts.filter((a) => a.type === 'equity'),
            totals: {
                assets: Math.round(assets * 100) / 100,
                liabilities: Math.round(liabilities * 100) / 100,
                equity: Math.round(equity * 100) / 100,
                currentProfit: Math.round(profit * 100) / 100,
                balanced: Math.abs(assets - liabilities - equity) < 0.02,
            },
        });
    } catch (e) { next(e); }
});

// ─── التدفق النقدي (الطريقة المباشرة على 1000/1010) ─────────────────────────
router.get('/cash-flow', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const okD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
        const to = okD(req.query.to) || riyadhToday();
        const from = okD(req.query.from) || `${to.slice(0, 7)}-01`;
        const { rows } = await pool.query(
            `SELECT l.debit::numeric(14,2) AS dr, l.credit::numeric(14,2) AS cr,
                    oc.type AS counter_type, oc.name_ar AS counter_name, oc.code AS counter_code
               FROM journal_lines l
               JOIN journal_entries e ON e.id = l.entry_id
                 AND e.status = 'posted' AND e.date BETWEEN $1::date AND $2::date
               JOIN LATERAL (
                 SELECT oc2.type, oc2.name_ar, oc2.code FROM journal_lines l2
                 JOIN chart_of_accounts oc2 ON oc2.code = l2.account_code
                 WHERE l2.entry_id = l.entry_id AND l2.id <> l.id
                 ORDER BY (l2.debit + l2.credit) DESC LIMIT 1
               ) oc ON TRUE
              WHERE l.account_code IN ('1000', '1010')`,
            [from, to]
        );
        let openBal = 0;
        try {
            const ob = await pool.query(
                `SELECT (COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0))::numeric(14,2) AS b
                   FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                  WHERE l.account_code IN ('1000','1010') AND e.status = 'posted' AND e.date < $1::date`,
                [from]
            );
            openBal = Number(ob.rows[0]?.b || 0);
        } catch (e) {
            // رقم مالي تحميلي — لا يصح تجاهله بصمت؛ نُبلغ ونُعلّم الاستجابة.
            logger.error('[CASH_FLOW] opening balance query failed:', e.message);
            openBal = 0;
            res.locals.openingUnavailable = true;
        }
        let inflow = 0, outflow = 0;
        const byCounter = {};
        for (const r of rows) {
            const net = Number(r.dr) - Number(r.cr); // موجب = داخل للصندوق
            if (net > 0) {inflow += net;} else {outflow -= net;}
            const k = `${r.counter_code} ${r.counter_name || ''}`.trim();
            byCounter[k] = (byCounter[k] || 0) + net;
        }
        const r2 = (n) => Math.round(n * 100) / 100;
        res.json({
            ok: true, from, to,
            opening: r2(openBal), inflow: r2(inflow), outflow: r2(outflow),
            opening_available: !res.locals.openingUnavailable,
            net: r2(inflow - outflow), closing: r2(openBal + inflow - outflow),
            byCounterparty: Object.entries(byCounter)
                .map(([k, v]) => ({ account: k, net: r2(v) }))
                .sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
        });
    } catch (e) { next(e); }
});

function ensureAccountingPeriodsSchema() {
    const file = path.join(__dirname, '..', 'database', 'migrations', '079_accounting_controls.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf-8'));}
        logger.info('[ACCOUNTING_PERIODS] controls ready (status/draft/periods)');
    })().catch((e) => { logger.error('[ACCOUNTING_PERIODS] init skipped:', e.message); });
}

module.exports = { router, isPeriodClosed, assertPeriodOpen, closedError, ensureAccountingPeriodsSchema };
