'use strict';

/**
 * accounting-growth.js — Cost centers + AP aging + bank rec + custody + assets.
 * ────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/accounting (merges with existing routers). All additive.
 * Every mutating path is JWT + role gated; failures never break POS/ledger.
 *
 * @module accounting-growth
 * @typedef {object} MoneyRow
 * @property {number} total
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { riyadhToday, riyadhMonth } = require('./riyadh-date');

const router = express.Router();
const READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const WRITE_ROLES = ['admin', 'accountant'];
/** @param {unknown} n @returns {number} */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** @param {unknown} v @returns {string|null} YYYY-MM-DD or null */
const okD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

// ─── مراكز التكلفة ──────────────────────────────────────────────────────────
router.get('/cost-centers', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM cost_centers ORDER BY code');
        res.json({ ok: true, centers: rows });
    } catch (e) { next(e); }
});

router.post('/cost-centers', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase().slice(0, 20);
        const nameAr = String(req.body?.name_ar || '').trim().slice(0, 150);
        if (!/^[A-Z0-9_-]{1,20}$/.test(code) || !nameAr) {
            return res.status(422).json({ error: 'CC_INVALID', message: 'الكود لاتيني والاسم العربي إجباري' });
        }
        const { rows } = await pool.query(
            `INSERT INTO cost_centers (code, name_ar, name_en) VALUES ($1,$2,$3)
             ON CONFLICT (code) DO UPDATE SET name_ar = $2, name_en = $3 RETURNING *`,
            [code, nameAr, String(req.body?.name_en || '').slice(0, 150) || null]
        );
        res.status(201).json({ ok: true, center: rows[0] });
    } catch (e) { next(e); }
});

// ─── ربحية المراكز ──────────────────────────────────────────────────────────
router.get('/profit-by-cost-center', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const to = okD(req.query.to) || riyadhToday();
        const from = okD(req.query.from) || `${to.slice(0, 7)}-01`;
        const { rows } = await pool.query(
            `SELECT COALESCE(l.cost_center_code, '—') AS cc,
                    c.name_ar AS cc_name,
                    SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END)::numeric(14,2) AS revenue,
                    SUM(CASE WHEN a.type = 'cogs' THEN l.debit - l.credit ELSE 0 END)::numeric(14,2) AS cogs,
                    SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END)::numeric(14,2) AS expense
               FROM journal_lines l
               JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
                 AND e.date BETWEEN $1::date AND $2::date
               JOIN chart_of_accounts a ON a.code = l.account_code
               LEFT JOIN cost_centers c ON c.code = l.cost_center_code
              WHERE a.type IN ('revenue','cogs','expense')
              GROUP BY 1, 2 ORDER BY 1`,
            [from, to]
        );
        const out = rows.map((r) => ({
            ...r,
            revenue: Number(r.revenue), cogs: Number(r.cogs), expense: Number(r.expense),
            net: r2(Number(r.revenue) - Number(r.cogs) - Number(r.expense)),
        }));
        res.json({ ok: true, from, to, centers: out });
    } catch (e) { next(e); }
});

// ─── أعمار ذمم الموردين ─────────────────────────────────────────────────────
router.get('/ap-aging', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const inv = await pool.query(
            `SELECT COALESCE("supplierId", NULL) AS sid, "supplierName",
                    "totalAmount", COALESCE("paidAmount", 0) AS paid,
                    SUBSTRING(date FROM 1 FOR 10) AS idate
               FROM "purchaseInvoices"`
        );
        const sup = await pool.query('SELECT id, name, "openingBalance" FROM suppliers WHERE is_active = TRUE');
        const byId = new Map(sup.rows.map((s) => [Number(s.id), s]));
        const buckets = {};
        const bump = (key, name, bal, age) => {
            const b = buckets[key] || (buckets[key] = {
                supplier: name, total: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0,
            });
            b.total = r2(b.total + bal);
            // FIX 2026-10-11: AP aging buckets were wrong — 0-30 day invoices were
            // bucketed as d30 instead of current. Standard aging: 0-30=current,
            // 31-60=d30, 61-90=d60, 91+=d90, 120+=over90
            const k = age == null ? 'current' : age <= 30 ? 'current' : age <= 60 ? 'd30' : age <= 90 ? 'd60' : age <= 120 ? 'd90' : 'over90';
            b[k] = r2(b[k] + bal);
        };
        const today = new Date();
        for (const r of inv.rows) {
            const bal = r2(Number(r.totalAmount || 0) - Number(r.paid || 0));
            if (bal <= 0) {continue;}
            const sid = r.sid != null ? Number(r.sid) : null;
            const name = (sid != null && byId.get(sid)?.name) || r.supplierName || 'غير محدد';
            const key = sid != null ? `id:${sid}` : `name:${name}`;
            const dt = /^\d{4}-\d{2}-\d{2}/.test(String(r.idate || '')) ? new Date(String(r.idate).slice(0, 10)) : null;
            bump(key, name, bal, dt ? Math.floor((today - dt) / 86400000) : null);
        }
        for (const s of sup.rows) {
            const ob = r2(Number(s.openingBalance || 0));
            if (ob > 0) {bump(`id:${Number(s.id)}`, s.name, ob, null);}
        }
        const list = Object.values(buckets).sort((a, b) => b.total - a.total);
        res.json({ ok: true, count: list.length, total: r2(list.reduce((x, b) => x + b.total, 0)), aging: list });
    } catch (e) { next(e); }
});

// ─── كشوف البنك والمطابقة ───────────────────────────────────────────────────
router.get('/bank-statements', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const account = String(req.query.account || '1010').slice(0, 20);
        const { rows } = await pool.query(
            `SELECT * FROM bank_statements WHERE account_code = $1 ORDER BY stmt_date DESC LIMIT 200`, [account]);
        res.json({ ok: true, statements: rows });
    } catch (e) { next(e); }
});

router.post('/bank-statements', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [req.body];
        let inserted = 0;
        for (const r of rows.slice(0, 500)) {
            const d = okD(r.stmt_date);
            const amt = Number(r.amount);
            if (!d || !Number.isFinite(amt) || amt === 0) {continue;}
            // CORRECTNESS: القيد الفريد يشمل description — و NULL لا يتعارض أبدًا في
            // Postgres، فكان رفع نفس الكشف بوصف فارغ يكرر سطوره. نطبّع NULL إلى ''.
            await pool.query(
                `INSERT INTO bank_statements (account_code, stmt_date, description, amount, created_by)
                 VALUES ($1,$2,COALESCE(NULLIF($3,'') , ''),$4,$5) ON CONFLICT DO NOTHING`,
                [String(r.account_code || '1010').slice(0, 20), d,
                 String(r.description || '').slice(0, 255).trim(), r2(amt), req.user?.id || null]
            );
            inserted++;
        }
        res.status(201).json({ ok: true, inserted });
    } catch (e) { next(e); }
});

router.get('/bank-rec', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const account = String(req.query.account || '1010').slice(0, 20);
        const to = okD(req.query.to) || riyadhToday();
        const from = okD(req.query.from) || `${to.slice(0, 7)}-01`;
        const book = await pool.query(
            `SELECT (COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0))::numeric(14,2) AS b
               FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
              WHERE l.account_code = $1 AND e.status = 'posted' AND e.date BETWEEN $2::date AND $3::date`,
            [account, from, to]
        );
        const stmt = await pool.query(
            `SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS s FROM bank_statements
              WHERE account_code = $1 AND stmt_date BETWEEN $2::date AND $3::date`,
            [account, from, to]
        );
        const open = await pool.query(
            `SELECT * FROM bank_statements
              WHERE account_code = $1 AND matched = FALSE AND stmt_date BETWEEN $2::date AND $3::date
              ORDER BY stmt_date LIMIT 100`,
            [account, from, to]
        );
        const bookB = Number(book.rows[0]?.b || 0), stmtS = Number(stmt.rows[0]?.s || 0);
        res.json({
            ok: true, account, from, to,
            book: r2(bookB), statement: r2(stmtS), diff: r2(stmtS - bookB),
            unmatched: open.rows,
        });
    } catch (e) { next(e); }
});

router.post('/bank-rec/auto-match', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    const client = await pool.connect();
    try {
        const account = String(req.body?.account || '1010').slice(0, 20);
        // قفل استشاري يمنع سباق تشغيلين متوازيين من ربط نفس القيد بكشفيين.
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('bank-rec-auto-match'))`);
        const open = (await client.query(
            `SELECT * FROM bank_statements WHERE account_code = $1 AND matched = FALSE ORDER BY stmt_date LIMIT 200`,
            [account]
        )).rows;
        let matched = 0;
        for (const st of open) {
            // مطابقة: نفس المبلغ (مقربًا لخانتين) على نفس الحساب بتاريخ ±3 أيام — أول قيد غير مطابق يُلتقط.
            const cand = await client.query(
                `SELECT e.id FROM journal_entries e
                   JOIN journal_lines l ON l.entry_id = e.id AND l.account_code = $1
                  WHERE e.status = 'posted'
                    AND ABS(e.date - $2::date) <= 3
                    AND ROUND(l.debit - l.credit, 2) = $3::numeric
                    AND NOT EXISTS (SELECT 1 FROM bank_statements b WHERE b.matched_entry = e.id)
                  LIMIT 1`,
                [account, st.stmt_date, Number(st.amount)]
            );
            if (cand.rows[0]) {
                // المطالبة ذرية: تنجح مرة واحدة حتى لو سبقنا تشغيل آخر.
                const claim = await client.query(
                    'UPDATE bank_statements SET matched = TRUE, matched_entry = $1 WHERE id = $2 AND matched = FALSE',
                    [cand.rows[0].id, st.id]
                );
                if (claim.rowCount > 0) {matched++;}
            }
        }
        await client.query('COMMIT');
        res.json({ ok: true, matched, scanned: open.length });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        next(e);
    } finally { client.release(); }
});

// ─── عهد الكاشير ────────────────────────────────────────────────────────────
router.get('/cash-custody', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const date = okD(req.query.date) || riyadhToday();
        const { rows } = await pool.query(
            `SELECT c.*, uf.username AS from_name, ut.username AS to_name
               FROM pos_cash_custody c
               JOIN users uf ON uf.id = c.from_cashier
               JOIN users ut ON ut.id = c.to_cashier
              WHERE c.custody_date = $1::date ORDER BY c.created_at DESC LIMIT 100`,
            [date]
        );
        const pending = await pool.query(
            `SELECT COUNT(*)::int AS n FROM pos_cash_custody WHERE to_cashier = $1 AND ack_at IS NULL`,
            [req.user?.id || 0]
        );
        res.json({ ok: true, date, rows, myPending: pending.rows[0]?.n || 0 });
    } catch (e) { next(e); }
});

router.post('/cash-custody', jwtAuth, requireRole('admin', 'manager', 'cashier'), async (req, res, next) => {
    try {
        const to = Number(req.body?.to_cashier);
        const amount = Number(req.body?.amount);
        if (!Number.isInteger(to) || to <= 0 || !Number.isFinite(amount) || amount <= 0) {
            return res.status(422).json({ error: 'CUSTODY_INVALID', message: 'المستلم والمبلغ إجباري' });
        }
        if (to === Number(req.user?.id)) {
            return res.status(422).json({ error: 'CUSTODY_SELF', message: 'لا تسلم العهدة لنفسك' });
        }
        const { rows } = await pool.query(
            `INSERT INTO pos_cash_custody (from_cashier, to_cashier, amount, session_id, note)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.user.id, to, r2(amount),
             Number(req.body?.session_id) || null, String(req.body?.note || '').slice(0, 255) || null]
        );
        if (req.io) {req.io.emit('entity_changed', { entity: 'cash_custody', action: 'hand', data: rows[0] });}
        res.status(201).json({ ok: true, custody: rows[0] });
    } catch (e) { next(e); }
});

router.post('/cash-custody/:id/ack', jwtAuth, async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ error: 'CUSTODY_ID_INVALID', message: 'معرف العهدة غير صالح' });
        }
        const { rows } = await pool.query(
            `UPDATE pos_cash_custody SET ack_at = NOW() WHERE id = $1 AND to_cashier = $2 AND ack_at IS NULL RETURNING *`,
            [id, req.user.id]
        );
        if (!rows[0]) {
            return res.status(404).json({ error: 'CUSTODY_NOT_FOUND', message: 'لا عهدة معلقة لك بهذا الرقم' });
        }
        res.json({ ok: true, custody: rows[0] });
    } catch (e) { next(e); }
});

// ─── الأصول الثابتة والإهلاك ────────────────────────────────────────────────
router.get('/fixed-assets', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM fixed_assets ORDER BY status, id DESC LIMIT 500');
        const out = rows.map((a) => {
            const depreciable = Math.max(0, Number(a.cost) - Number(a.salvage) - Number(a.accumulated));
            const monthly = Number(a.life_months) > 0
                ? r2((Number(a.cost) - Number(a.salvage)) / Number(a.life_months)) : 0;
            return { ...a, monthly, remaining: r2(depreciable) };
        });
        res.json({ ok: true, assets: out });
    } catch (e) { next(e); }
});

router.post('/fixed-assets', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const name = String(req.body?.name || '').trim().slice(0, 255);
        const cost = Number(req.body?.cost);
        const life = Number(req.body?.life_months);
        const pdate = okD(req.body?.purchase_date) || riyadhToday();
        if (!name || !Number.isFinite(cost) || cost <= 0 || !Number.isInteger(life) || life <= 0) {
            return res.status(422).json({ error: 'ASSET_INVALID', message: 'الاسم والتكلفة والعمر بالشهور إجباري' });
        }
        const { rows } = await pool.query(
            `INSERT INTO fixed_assets (name, category, purchase_date, cost, salvage, life_months, cost_center_code, notes, created_by)
             VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [name, String(req.body?.category || '').slice(0, 100) || null, pdate, r2(cost),
             r2(Number(req.body?.salvage) || 0), life,
             String(req.body?.cost_center_code || '').toUpperCase().slice(0, 20) || null,
             String(req.body?.notes || '').slice(0, 500) || null, req.user?.id || null]
        );
        res.status(201).json({ ok: true, asset: rows[0] });
    } catch (e) { next(e); }
});

router.post('/fixed-assets/:id/dispose', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const assetId = Number(req.params.id);
        if (!Number.isInteger(assetId) || assetId <= 0) {
            return res.status(422).json({ error: 'ASSET_ID_INVALID', message: 'معرف الأصل غير صالح' });
        }
        const { rows } = await pool.query(
            `UPDATE fixed_assets SET status = 'disposed' WHERE id = $1 AND status = 'active' RETURNING *`,
            [assetId]
        );
        if (!rows[0]) {return res.status(404).json({ error: 'ASSET_NOT_FOUND', message: 'الأصل غير موجود أو مستبعد' });}
        res.json({ ok: true, asset: rows[0] });
    } catch (e) { next(e); }
});

// تشغيل الإهلاك الشهري: قيد واحد مجمع (6600 / 1520) + تحديث كل أصل. Idempotent بالشهر.
// CORRECTNESS: كل شيء داخل معاملة واحدة — تحديث الأصول وقيد GL يُرفعان معًا أو
// لا يُرفعان (كان القيد بعد COMMIT فيتباعد دفتر الأصول عن دفتر الأستاذ عند فشله).
// FOR UPDATE يمنع سباق تشغيلين متوازيين من مضاعفة الإهلاك المتراكم.
router.post('/depreciation/run', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, _next) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || ''))
            ? String(req.body.month) : riyadhMonth();
        try {
            await require('./accounting-periods').assertPeriodOpen(`${month}-01`);
        } catch (pe) {
            return res.status(423).json({ error: 'PERIOD_LOCKED', message: pe.message });
        }
        let total = 0;
        const lines = [];
        let journal = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const assets = (await client.query(
                `SELECT * FROM fixed_assets WHERE status = 'active'
                   AND (last_month IS NULL OR last_month < $1)
                 ORDER BY id FOR UPDATE`, [month])).rows;
            if (!assets.length) {
                await client.query('COMMIT');
                return res.json({ ok: true, month, posted: 0, total: 0 });
            }
            for (const a of assets) {
                const monthly = r2((Number(a.cost) - Number(a.salvage)) / Number(a.life_months));
                const remaining = Math.max(0, Number(a.cost) - Number(a.salvage) - Number(a.accumulated));
                const amt = r2(Math.min(monthly, remaining));
                if (amt <= 0) {
                    await client.query('UPDATE fixed_assets SET last_month = $1 WHERE id = $2', [month, a.id]);
                    continue;
                }
                total = r2(total + amt);
                lines.push({ asset: a, amt });
                await client.query(
                    'UPDATE fixed_assets SET accumulated = accumulated + $1, last_month = $2 WHERE id = $3',
                    [amt, month, a.id]
                );
            }
            if (total > 0) {
                const { postJournal } = require('./accounting-routes');
                const out = await postJournal(client, {
                    date: `${month}-28`,
                    memo: `إهلاك شهري ${month} (${lines.length} أصل)`,
                    source_type: 'depreciation', source_id: month,
                    lines: [
                        { account_code: '6600', debit: total, credit: 0 },
                        { account_code: '1520', debit: 0, credit: total },
                    ],
                    created_by: req.user?.id || null,
                });
                journal = out.replay ? { replay: true, entry: out.entry } : out.entry;
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally { client.release(); }
        logger.info(`[DEPRECIATION] شهر ${month}: ${total} على ${lines.length} أصل بواسطة ${req.user?.name || req.user?.id}`);
        res.json({ ok: true, month, posted: lines.length, total, journal });
    } catch (e) {
        logger.error('[DEPRECIATION]', e.message);
        const code = e.statusCode || 500;
        res.status(code).json({
            error: code === 423 ? 'PERIOD_LOCKED' : 'DEPRECIATION_FAILED',
            message: code === 423 ? e.message : 'تعذر تشغيل الإهلاك — راجع سجل الخادم',
        });
    }
});

function ensureAccountingGrowthSchema() {
    const file = path.join(__dirname, '..', 'database', 'migrations', '081_accounting_growth.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf-8'));}
        try { require('./accounting-routes').resetCcCache?.(); } catch (_) {}
        logger.info('[ACCOUNTING_GROWTH] ready (cc/assets/bank/custody)');
    })().catch((e) => { logger.error('[ACCOUNTING_GROWTH] init skipped:', e.message); });
}

module.exports = { router, ensureAccountingGrowthSchema };
