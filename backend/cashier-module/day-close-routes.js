'use strict';

/**
 * day-close-routes.js — Daily Z close for cashiers (manager/admin).
 * ────────────────────────────────────────────────────────────────────────────
 * Rules (accountant-grade): counts per session, variance threshold gate,
 * auto-posted balanced journal (idempotent), accounting period lock respected.
 *
 * @module day-close-routes
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { writeAuditLog } = require('./audit-middleware');
const { logger } = require('../logger');

const router = express.Router();

// CORRECTNESS: `Number('0') || 50` كان يحوّل عتبة الصفر (تسامح صارم) إلى 50 بصمت.
const _vt = Number(process.env.POS_DAY_VARIANCE_THRESHOLD);
const VARIANCE_THRESHOLD = Number.isFinite(_vt) && _vt >= 0 ? _vt : 50;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function bizToday(client) {
    const r = await client.query(
        `SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS d`);
    return r.rows[0].d;
}

function validDate(v) {
    const s = String(v || '').slice(0, 10);
    return (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) ? s : null;
}

async function sessionExpected(client, session) {
    const cashRes = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'in'  THEN ip.amount END), 0) -
                COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'out' THEN ip.amount END), 0) AS net_cash
           FROM pos_invoice_payments ip
           JOIN pos_orders o ON o.id = ip.order_id
          WHERE o.session_id = $1;`,
        [session.id]
    );
    return r2(Number(session.opening_balance) + Number(cashRes.rows[0].net_cash || 0));
}

async function dayMethodTotals(client, sessionIds) {
    if (!sessionIds.length) {return { methods: {}, invoices: 0 };}
    const m = await client.query(
        `SELECT ip.method, ip.direction,
                COALESCE(SUM(ip.amount),0)::numeric(14,2) AS total,
                COUNT(DISTINCT ip.order_id)::int AS invoices
           FROM pos_invoice_payments ip
           JOIN pos_orders o ON o.id = ip.order_id
          WHERE o.session_id = ANY($1::bigint[])
          GROUP BY ip.method, ip.direction`,
        [sessionIds]
    );
    const methods = {};
    for (const r of m.rows) {
        methods[`${r.method}_${r.direction}`] = Number(r.total);
    }
    const inv = await client.query(
        `SELECT COUNT(*)::int AS n FROM pos_orders WHERE session_id = ANY($1::bigint[])`,
        [sessionIds]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    return { methods, invoices: inv.rows[0].n };
}

async function sessionsOfDate(client, date, { lock = false } = {}) {
    const r = await client.query(
        `SELECT s.*, u.username AS cashier_name, d.name_ar AS dept_name,
                TO_CHAR(s.opened_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS biz_date
           FROM pos_shift_sessions s
           LEFT JOIN users u ON u.id = s.cashier_id
           LEFT JOIN pos_departments d ON d.id = s.department_id
          WHERE TO_CHAR(s.opened_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') = $1
          ORDER BY s.opened_at${lock ? ' FOR UPDATE OF s' : ''}`,
        [date]
    );
    return r.rows;
}

// ─── Readiness ──────────────────────────────────────────────────────────────
router.get('/day-close/status', jwtAuth, requireRole('manager', 'admin', 'accountant', 'auditor'), async (req, res) => {
    try {
        const today = await bizToday(pool);
        const date = validDate(req.query.date) || today;
        const sessions = await sessionsOfDate(pool, date);
        const existing = (await pool.query(
            'SELECT * FROM pos_day_closes WHERE close_date = $1::date LIMIT 1', [date])).rows[0] || null;
        const stale = (await pool.query(
            `SELECT id, cashier_id, TO_CHAR(opened_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') AS biz_date
               FROM pos_shift_sessions WHERE status = 'open'
                 AND TO_CHAR(opened_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') < $1`,
            [today]
        )).rows;
        res.json({
            ok: true, date, today,
            existing_z: existing,
            open: sessions.filter((s) => s.status === 'open'),
            closed: sessions.filter((s) => s.status === 'closed'),
            stale_open: stale,
            threshold: VARIANCE_THRESHOLD,
            can_close: !existing && sessions.length > 0,
        });
    } catch (e) {
        logger.error('[day-close/status]', e.message);
        res.status(500).json({ error: 'DAYCLOSE_STATUS_FAILED', message: 'تعذر جلب حالة الإقفال' });
    }
});

// ─── Close day → Z ──────────────────────────────────────────────────────────
router.post('/day-close', jwtAuth, requireRole('manager', 'admin'), async (req, res) => {
    try {
        const today = await bizToday(pool);
        const date = validDate(req.body?.date) || today;
        if (date > today) {
            return res.status(422).json({ error: 'DAYCLOSE_FUTURE', message: 'لا يمكن إقفال يوم مستقبلي' });
        }
        // Period lock first — clear 423 before any heavy work.
        try {
            await require('../accounting-periods').assertPeriodOpen(date);
        } catch (pe) {
            return res.status(423).json({ error: 'PERIOD_LOCKED', message: pe.message });
        }
        const counts = (req.body?.counts && typeof req.body.counts === 'object') ? req.body.counts : {};
        const managerApprove = req.body?.manager_approve === true;
        const note = String(req.body?.note || '').slice(0, 500) || null;

        const result = await withTransaction(async (client) => {
            await client.query(`SELECT set_config('app.user_id', $1, true);`, [String(req.user.id)]);
            await client.query(`SELECT set_config('app.user_role', $1, true);`, [req.user.role]);

            // قفل استشاري على اليوم: يمنع إقفالين متزامنين من السباق على نفس الـ Z
            // (فحص التكرار بـ FOR UPDATE لا يقفل شيئًا عندما لا يوجد صف بعد).
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('pos-day-close:' || $1::text))`, [date]);
            const dup = await client.query(
                'SELECT z_number FROM pos_day_closes WHERE close_date = $1::date LIMIT 1 FOR UPDATE', [date]);
            if (dup.rows[0]) {
                throw Object.assign(new Error(`اليوم مقفل مسبقًا (${dup.rows[0].z_number})`), { code: 409 });
            }
            // FOR UPDATE: أي بيع جارٍ يقفل صف الوردية أولًا (complete-sale) —
            // فبدون القفل هنا كان الدرج يتغير بين حساب المتوقع وكتابة النتيجة
            // ويُرحّل فرق وهمي للأستاذ.
            const sessions = await sessionsOfDate(client, date, { lock: true });
            if (!sessions.length) {
                throw Object.assign(new Error('لا توجد ورديات في هذا اليوم'), { code: 422 });
            }
            const open = sessions.filter((s) => s.status === 'open');
            // Every still-open session needs a physical count.
            const closedNow = [];
            for (const s of open) {
                const raw = counts[String(s.id)];
                const actual = typeof raw === 'number' ? raw : Number(raw);
                if (!Number.isFinite(actual) || actual < 0) {
                    throw Object.assign(
                        new Error(`الجرد الفعلي مطلوب للوردية #${s.id} (${s.cashier_name || ''})`), { code: 422 });
                }
                const expected = await sessionExpected(client, s);
                const variance = r2(actual - expected);
                // حارس الحالة: لا تكتس صف وردية أغلقها الكاشير بنفسه بين القفل والكتابة.
                const upd = await client.query(
                    `UPDATE pos_shift_sessions
                        SET status='closed', actual_cash=$1, expected_cash=$2, cash_variance=$3,
                            closed_at=NOW(), closed_by=$4, closing_notes=COALESCE(closing_notes,'') || ' [day-close]'
                      WHERE id=$5 AND status='open'`,
                    [actual, expected, variance, req.user.id, s.id]
                );
                if (upd.rowCount === 0) {
                    throw Object.assign(
                        new Error(`الوردية #${s.id} أُغلقت للتو من جهاز آخر — أعد المحاولة`), { code: 409 });
                }
                s.expected_cash = expected; s.actual_cash = actual; s.cash_variance = variance;
                s.status = 'closed';
                closedNow.push(s);
            }
            const all = sessions;
            let totalExpected = 0, totalActual = 0;
            const perSession = all.map((s) => {
                const e = r2(Number(s.expected_cash) || 0);
                const a = r2(Number(s.actual_cash) || 0);
                totalExpected = r2(totalExpected + e);
                totalActual = r2(totalActual + a);
                return {
                    id: Number(s.id), cashier: s.cashier_name, dept: s.dept_name,
                    opening: r2(Number(s.opening_balance) || 0),
                    expected: e, actual: a, variance: r2(a - e), status: s.status,
                };
            });
            const totalVariance = r2(totalActual - totalExpected);

            // Threshold gate: big net variance needs explicit manager approval.
            const isManager = req.user.role === 'manager' || req.user.role === 'admin';
            if (Math.abs(totalVariance) > VARIANCE_THRESHOLD && !(managerApprove && isManager)) {
                throw Object.assign(new Error(
                    `صافي الفرق ${totalVariance} يتجاوز العتبة ${VARIANCE_THRESHOLD} — يلزم اعتماد مدير صريح`
                ), { code: 428 });
            }

            // Sequential Z with UNIQUE guard + retry (concurrent closes converge).
            let zNumber = null;
            for (let n = 1; n <= 10; n++) {
                const day = date.replace(/-/g, '');
                const cand = `Z-${day}-${String(
                    ((await client.query(
                        `SELECT COUNT(*)::int AS c FROM pos_day_closes WHERE close_date = $1::date`, [date]
                    )).rows[0].c) + n).padStart(3, '0')}`;
                const clash = await client.query(
                    'SELECT 1 FROM pos_day_closes WHERE z_number = $1 LIMIT 1', [cand]);
                if (!clash.rows[0]) {zNumber = cand; break;}
            }
            if (!zNumber) {zNumber = `Z-${Date.now()}`;}

            const sessionIds = all.map((s) => Number(s.id));
            const mt = await dayMethodTotals(client, sessionIds);
            const totals = { perSession, methods: mt.methods, invoices: mt.invoices, threshold: VARIANCE_THRESHOLD };

            const ins = await client.query(
                `INSERT INTO pos_day_closes
                    (close_date, z_number, session_ids, total_expected, total_actual, total_variance,
                     totals, created_by, approved_by, note)
                 VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [date, zNumber, sessionIds, totalExpected, totalActual, totalVariance,
                 JSON.stringify(totals), req.user.id, isManager ? req.user.id : null, note]
            );

            // ROOT FIX 2026-10-02: حلقة الأمان — أي بيع صادر في هذا اليوم بلا
            // قيد محاسبي (سقط best-effort وقت إتمامه) يُعاد ترحيله الآن قبل
            // إقفال اليوم. postSaleToLedger idempotent — لا تكرار أبدًا.
            let journalsRepaired = 0;
            try {
                const { postSaleToLedger } = require('../accounting-routes');
                const missing = (await client.query(
                    `SELECT o.id FROM pos_orders o
                      WHERE o.status = 'issued' AND o.created_at::date = $1::date
                        AND NOT EXISTS (SELECT 1 FROM journal_entries je
                                         WHERE je.source_type = 'pos_sale' AND je.source_id = o.id::text AND je.status = 'posted')`,
                    [date])).rows;
                for (const row of missing) {
                    try { await postSaleToLedger(row.id); journalsRepaired += 1; }
                    catch (e2) { logger.error('[day-close] journal repair failed for order', row.id, e2.message); }
                }
                if (journalsRepaired) { logger.warn(`[day-close] أُعيد ترحيل ${journalsRepaired} قيد بيع مفقود ليوم ${date}`); }
            } catch (sweepErr) { logger.error('[day-close] journal sweep failed (non-fatal):', sweepErr.message); }

            // Auto-post net variance to the ledger (idempotent on Z number).
            // Shortage: Dr 6900 (تشغيلية أخرى) / Cr 1000 (الصندوق).
            // Overage:  Dr 1000 / Cr 6900 (استرداد).
            let journal = null;
            if (Math.abs(totalVariance) >= 0.01) {
                const { postJournal } = require('../accounting-routes');
                const amt = Math.abs(totalVariance);
                const lines = totalVariance < 0
                    ? [{ account_code: '6900', debit: amt, credit: 0 }, { account_code: '1000', debit: 0, credit: amt }]
                    : [{ account_code: '1000', debit: amt, credit: 0 }, { account_code: '6900', debit: 0, credit: amt }];
                const out = await postJournal(client, {
                    date, memo: `فرق إقفال يومي ${zNumber} (${date})`,
                    source_type: 'pos_day_close', source_id: zNumber,
                    lines, created_by: req.user.id,
                });
                journal = out.entry;
                await client.query(
                    'UPDATE pos_day_closes SET journal_source_id = $1 WHERE id = $2',
                    [zNumber, ins.rows[0].id]
                );
            }
            return { z: ins.rows[0], journal, perSession, methods: mt.methods, invoices: mt.invoices };
        }, { userId: req.user.id, userRole: req.user.role, clientIp: req.ip });

        try {
            await writeAuditLog({
                action: 'CLOSE_DAY', tableName: 'pos_day_closes', rowPk: result.z.id,
                metadata: { z: result.z.z_number, date, variance: result.z.total_variance },
                actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
            });
        } catch (e) { logger.error('[day-close] audit failed (non-fatal):', e.message); }
        if (req.io) {req.io.emit('entity_changed', { entity: 'pos_day_close', action: 'close', data: result.z });}
        res.status(201).json({ ok: true, ...result });
    } catch (err) {
        const map = { 404: 'NOT_FOUND', 409: 'DAYCLOSE_EXISTS', 422: 'DAYCLOSE_INVALID', 423: 'PERIOD_LOCKED', 428: 'NEEDS_MANAGER', 23505: 'DAYCLOSE_EXISTS' };
        const code = err.code || err.statusCode || 500;
        if (map[code]) {return res.status(String(code) === '23505' ? 409 : code).json({ error: map[code], message: err.message });}
        logger.error('[day-close]', err.message);
        res.status(500).json({ error: 'DAYCLOSE_FAILED', message: 'تعذر الإقفال اليومي' });
    }
});

// ─── Z slip ─────────────────────────────────────────────────────────────────
router.get('/day-close/:zNumber', jwtAuth, requireRole('manager', 'admin', 'accountant', 'auditor', 'cashier'), async (req, res) => {
    try {
        const z = String(req.params.zNumber || '').slice(0, 24);
        const { rows } = await pool.query('SELECT * FROM pos_day_closes WHERE z_number = $1 LIMIT 1', [z]);
        if (!rows[0]) {return res.status(404).json({ error: 'Z_NOT_FOUND', message: 'رقم الإقفال غير موجود' });}
        res.json({ ok: true, z: rows[0] });
    } catch (e) {
        logger.error('[day-close/get]', e.message);
        res.status(500).json({ error: 'DAYCLOSE_FETCH_FAILED', message: 'تعذر جلب الإقفال' });
    }
});

function ensureDayCloseSchema() {
    // CORRECTNESS: الملف في database/migrations بمستوى جذر المشروع — الوحدة
    // داخل backend/cashier-module فيحتاج صعودًا اثنين (كان '..' واحدًا فيقرأ
    // backend/database غير الموجود). القراءة داخل async حتى لا يرمي ENOENT
    // استثناءً متزامنًا خارج الـ catch (كان يُسقط تحميل الوحدة كاملة عند الإقلاع).
    const file = path.join(__dirname, '..', '..', 'database', 'migrations', '080_pos_day_close.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf8'));}
        logger.info('[DAY_CLOSE_SCHEMA] ready (pos_day_closes)');
    })().catch((e) => logger.error('[DAY_CLOSE_SCHEMA] skipped:', e.message));
}

module.exports = { router, ensureDayCloseSchema, VARIANCE_THRESHOLD };
