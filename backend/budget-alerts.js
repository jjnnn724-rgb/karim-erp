'use strict';

/**
 * budget-alerts.js — Budgets vs actual + scheduled exception alerts.
 * ────────────────────────────────────────────────────────────────────────────
 * Scheduler (every 30 min, unref'd) checks 4 rules and notifies:
 *   bell → admin/manager/accountant (always) + WhatsApp managers (best-effort,
 *   only when WHATSAPP_ENABLED=true and engine is up). Dedup: 1 alert / 24h.
 *
 * @module budget-alerts
 * @typedef {object} BudgetLine
 * @property {number} id
 * @property {number} budget
 * @property {number} actual
 * @property {number} variance
 * @property {boolean} over
 * @property {number|null} pct
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
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

let _io = null;
let _timer = null;

// ─── الموازنات ─────────────────────────────────────────────────────────────
router.get('/budgets', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const period = /^\d{4}-\d{2}$/.test(String(req.query.period || ''))
            ? String(req.query.period) : riyadhMonth();
        const { rows } = await pool.query(
            `SELECT b.*, c.name_ar AS account_name FROM budgets b
              LEFT JOIN chart_of_accounts c ON c.code = b.account_code
             WHERE b.period = $1 ORDER BY b.id`, [period]);
        res.json({ ok: true, period, budgets: rows });
    } catch (e) { next(e); }
});

router.post('/budgets', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const period = String(req.body?.period || '');
        const amount = Number(req.body?.amount);
        if (!/^\d{4}-\d{2}$/.test(period) || !Number.isFinite(amount) || amount < 0) {
            return res.status(422).json({ error: 'BUDGET_INVALID', message: 'الشهر (YYYY-MM) والمبلغ إجباري' });
        }
        const { rows } = await pool.query(
            `INSERT INTO budgets (period, account_code, cost_center_code, label, amount, note, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [period,
             String(req.body?.account_code || '').trim() || null,
             String(req.body?.cost_center_code || '').trim().toUpperCase() || null,
             String(req.body?.label || '').slice(0, 150) || null,
             r2(amount), String(req.body?.note || '').slice(0, 255) || null,
             req.user?.id || null]
        );
        res.status(201).json({ ok: true, budget: rows[0] });
    } catch (e) { next(e); }
});

router.delete('/budgets/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ error: 'BUDGET_ID_INVALID', message: 'معرف الموازنة غير صالح' });
        }
        const { rows } = await pool.query('DELETE FROM budgets WHERE id = $1 RETURNING id', [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'BUDGET_NOT_FOUND', message: 'غير موجود' });}
        res.json({ ok: true });
    } catch (e) { next(e); }
});

/** @param {string} period - YYYY-MM @returns {Promise<BudgetLine[]>} */
async function budgetActuals(period) {
    const { rows } = await pool.query(
        `SELECT b.id, b.label, b.amount::numeric(14,2) AS budget,
                b.account_code, a.type AS acc_type, a.name_ar AS account_name,
                COALESCE((
                  SELECT SUM(CASE WHEN a2.type = 'revenue' THEN l.credit - l.debit
                                  ELSE l.debit - l.credit END)
                    FROM journal_lines l
                    JOIN journal_entries e ON e.id = l.entry_id
                      AND e.status = 'posted' AND TO_CHAR(e.date, 'YYYY-MM') = b.period
                    JOIN chart_of_accounts a2 ON a2.code = l.account_code
                   WHERE (b.account_code IS NULL OR l.account_code = b.account_code)
                     AND (b.cost_center_code IS NULL OR l.cost_center_code = b.cost_center_code)
                ), 0)::numeric(14,2) AS actual
           FROM budgets b LEFT JOIN chart_of_accounts a ON a.code = b.account_code
          WHERE b.period = $1 ORDER BY b.id`,
        [period]
    );
    return rows.map((r) => {
        const budget = Number(r.budget), actual = r2(Number(r.actual));
        const isRevenue = r.acc_type === 'revenue';
        return {
            ...r, budget, actual,
            variance: r2(actual - budget),
            // للموازنات السقفية (مصروف/تكلفة): التجاوز = فعلي > موازنة.
            over: !isRevenue && actual > budget && budget >= 0,
            // لموازنة الإيراد الخطر هو العجز (فعلي < موازنة) — تجاوز الإيراد شيء جيد.
            under: isRevenue && budget > 0 && actual < budget,
            alert: isRevenue ? (budget > 0 && actual < budget) : (actual > budget && budget >= 0),
            pct: budget > 0 ? r2((actual / budget) * 100) : null,
        };
    });
}

router.get('/budget-vs-actual', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const period = /^\d{4}-\d{2}$/.test(String(req.query.period || ''))
            ? String(req.query.period) : riyadhMonth();
        res.json({ ok: true, period, rows: await budgetActuals(period) });
    } catch (e) { next(e); }
});

// ─── محرك التنبيهات ────────────────────────────────────────────────────────
/** @param {string} key @returns {Promise<boolean>} true when allowed to send */
async function shouldSend(key) {
    const r = await pool.query('SELECT last_sent_at FROM alert_state WHERE key = $1', [key])
        .catch(() => ({ rows: [] }));
    if (!r.rows[0]) {return true;}
    return (Date.now() - new Date(r.rows[0].last_sent_at).getTime()) > 24 * 3600 * 1000;
}

async function markSent(key, title) {
    await pool.query(
        `INSERT INTO alert_state (key, last_sent_at, last_title, times_sent)
         VALUES ($1, NOW(), $2, 1)
         ON CONFLICT (key) DO UPDATE SET last_sent_at = NOW(), last_title = $2,
           times_sent = alert_state.times_sent + 1`,
        [key, String(title).slice(0, 255)]
    ).catch(() => {});
}

async function sendBell(title, message) {
    try {
        const { notifyBestEffort } = require('./notification-service');
        await notifyBestEffort(pool, {
            type: 'warning', title, message,
            entity: 'alert', targetRoles: ['admin', 'manager', 'accountant'], io: _io,
        });
    } catch (e) { logger.warn('[alerts] bell failed: ' + e.message); }
}

async function sendWhatsApp(text) {
    try {
        if (String(process.env.WHATSAPP_ENABLED || '').toLowerCase() !== 'true') {return false;}
        const jids = String(process.env.WHATSAPP_MANAGER_JIDS || '')
            .split(',').map((s) => s.trim()).filter(Boolean);
        if (!jids.length) {return false;}
        const mod = require('./whatsapp-engine');
        const engine = (typeof mod.getEngine === 'function' ? mod.getEngine() : null)
            || mod.whatsappEngine || mod.engine || null;
        const sender = engine?.sender || engine;
        if (!sender || typeof sender.enqueue !== 'function') {return false;}
        for (const jid of jids.slice(0, 10)) {
            try { await sender.enqueue(jid, text); } catch (e) {
                logger.warn('[alerts] wa enqueue failed: ' + e.message);
            }
        }
        return true;
    } catch (e) {
        logger.warn('[alerts] whatsapp failed (non-fatal): ' + e.message);
        return false;
    }
}

async function emitAlert(key, title, message) {
    if (!(await shouldSend(key))) {return false;}
    await sendBell(title, message);
    await sendWhatsApp(`⚠ تنبيه Karim ERP\n${title}\n${message}`);
    await markSent(key, title);
    logger.info(`[alerts] sent: ${key}`);
    return true;
}

/** @returns {Promise<string[]>} keys actually sent */
async function runAlertChecks() {
    const sent = [];
    const today = riyadhToday();
    const month = today.slice(0, 7);
    try {
        // 1) انحراف الموازنات (سقف مصروف تجاوز / إيراد عجز)
        try {
            const rows = await budgetActuals(month).catch(() => []);
            for (const r of rows) {
                if (r.alert && Number(r.budget) > 0) {
                    const key = `over-budget:${month}:${r.id}`;
                    const title = `${r.acc_type === 'revenue' ? 'عجز موازنة إيراد' : 'تجاوز موازنة'}: ${r.label || r.account_name || r.account_code}`;
                    if (await emitAlert(key, title,
                        `الفعلي ${r.actual} مقابل ${r.budget} (${r.pct}%) لشهر ${month}`)) {sent.push(key);}
                }
            }
        } catch (e) { logger.warn('[alerts] budgets check: ' + e.message); }
        // 2) فرق صندوق اليوم فوق العتبة
        try {
            const z = await pool.query(
                `SELECT z_number, total_variance FROM pos_day_closes WHERE close_date = $1::date LIMIT 1`,
                [today]
            ).catch(() => ({ rows: [] }));
            // CORRECTNESS: `Number('0') || 50` كان يجعل عتبة الصفر تصبح 50 بصمت —
            // الصفر (تسامح صارم) قيمة مشروعة.
            const t = Number(process.env.POS_DAY_VARIANCE_THRESHOLD);
            const threshold = Number.isFinite(t) && t >= 0 ? t : 50;
            const v = Number(z.rows[0]?.total_variance || 0);
            if (z.rows[0] && Math.abs(v) > threshold) {
                const key = `cash-variance:${today}`;
                if (await emitAlert(key, 'فرق صندوق فوق العتبة',
                    `${z.rows[0].z_number}: الفرق ${v} (العتبة ${threshold})`)) {sent.push(key);}
            }
        } catch (e) { logger.warn('[alerts] variance check: ' + e.message); }
        // 3) ورديات عالقة > 12 ساعة
        try {
            const stale = await pool.query(
                `SELECT COUNT(*)::int AS n FROM pos_shift_sessions
                  WHERE status = 'open' AND opened_at < NOW() - INTERVAL '12 hours'`
            ).catch(() => ({ rows: [{ n: 0 }] }));
            if (stale.rows[0].n > 0) {
                const key = `stale-shifts:${today}`;
                if (await emitAlert(key, 'ورديات عالقة',
                    `${stale.rows[0].n} وردية مفتوحة منذ أكثر من 12 ساعة — راجع الإغلاق المركزي`)) {sent.push(key);}
            }
        } catch (e) { logger.warn('[alerts] stale check: ' + e.message); }
        // 4) ذمم متأخرة +90 يوم
        try {
            const od = await pool.query(
                `SELECT COALESCE(SUM(GREATEST(COALESCE("totalAmount",0) - COALESCE("paidAmount",0), 0)),0)::numeric(14,2) AS t
                   FROM "purchaseInvoices"
                  WHERE COALESCE("totalAmount",0) > COALESCE("paidAmount",0)
                    AND SUBSTRING(date FROM 1 FOR 10) < (CURRENT_DATE - INTERVAL '90 days')::text`
            ).catch(() => ({ rows: [{ t: 0 }] }));
            if (Number(od.rows[0]?.t || 0) > 0) {
                const key = `ap-over90:${month}`;
                if (await emitAlert(key, 'ذمم متأخرة +90 يوم',
                    `إجمالي المتأخر ${Number(od.rows[0].t)} — راجع أعمار الذمم`)) {sent.push(key);}
            }
        } catch (e) { logger.warn('[alerts] ap check: ' + e.message); }
    } catch (e) {
        logger.error('[alerts] run failed: ' + e.message);
    }
    return sent;
}

router.get('/alerts/log', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM alert_state ORDER BY last_sent_at DESC LIMIT 100').catch(() => ({ rows: [] }));
        res.json({ ok: true, log: rows });
    } catch (e) { next(e); }
});

router.post('/alerts/run', jwtAuth, requireRole(...WRITE_ROLES), async (req, res, next) => {
    try {
        const sent = await runAlertChecks();
        res.json({ ok: true, sent });
    } catch (e) { next(e); }
});

function startAlertsScheduler(io) {
    _io = io || null;
    if (_timer) {return;}
    // فحص كل 30 دقيقة + مرة بعد الإقلاع بدقيقتين (يلتقط التحذيرات الصباحية).
    const tick = () => { runAlertChecks().catch(() => {}); };
    _timer = setInterval(tick, 30 * 60 * 1000);
    if (typeof _timer.unref === 'function') {_timer.unref();}
    const bootTimer = setTimeout(tick, 2 * 60 * 1000);
    if (typeof bootTimer.unref === 'function') {bootTimer.unref();}
    logger.info('[alerts] scheduler on (30m + boot+2m)');
}

function ensureBudgetAlertsSchema() {
    const file = path.join(__dirname, '..', 'database', 'migrations', '082_budgets_alerts.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf8'));}
        logger.info('[BUDGET_ALERTS] ready (budgets/alert_state)');
    })().catch((e) => { logger.error('[BUDGET_ALERTS] init skipped:', e.message); });
}

module.exports = {
    router, ensureBudgetAlertsSchema, startAlertsScheduler, runAlertChecks, budgetActuals,
};
