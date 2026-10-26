/**
 * cashier-monitor-routes.js — متابعة الكاشير للأونر (قراءة فقط)
 * ────────────────────────────────────────────────────────────────────────────
 * /api/cashier-monitor   (الوصول: admin حصرًا أو من مُنح صلاحية 'cashier-monitor.view')
 *   GET /summary?date=YYYY-MM-DD            ملخص كاشير 1/4/5/6/9 (فواتير/إيراد/متوسط/مدفوعات)
 *   GET /orders?date=&cashier=&limit=&offset=  قائمة الأوردرات (الأحدث أولًا)
 *   GET /orders/:doc                        تفاصيل أوردر بسطوره
 *
 * نطاق الكاشير من مصدر الحقيقة الوحيد: yarasoft/mirror.js → MIRROR_CASHIERS
 * (نفس الكاشيرية الخمسة المطبوعة في المرآة والتقارير — كاشير 2 مستثنى هناك وهنا).
 * لا كتابة إطلاقًا — الشاشة دي للمراقبة فقط.
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { requireRoleOrPerm } = require('./permissions');
const { logger } = require('./logger');
const { MIRROR_CASHIERS, refreshMirrorOrders } = require('./yarasoft/mirror');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// الأدمن يعبر بالدور؛ المالك يعبر بالمنح؛ أي حد تاني 403
const GUARD = [jwtAuth, requireRoleOrPerm([], 'cashier-monitor.view')];

// ─── محرك اللايف ─────────────────────────────────────────────────────────────
// شاشة المالك لوحدها هي اللي بتطلب المزامنة الحية (live=1): كل 45 ثانية على
// الأكثر نشغّل مزامنة خفيفة (يوم واحد بس × الكاشير الخمسة) من يارا سوفت،
// وعند اكتمالها يُبث 'yarasoft:mirror' فالشاشة تتحدث فورًا. لو محدش
// فاتح الشاشة — صفر حمل على Oracle.
let _liveBusy = false;
let _liveLast = 0;
const LIVE_MIN_GAP_MS = 45_000;

function maybeTriggerLiveRefresh(req, day) {
    if (String(req.query.live || '') !== '1') {return;}
    if (day !== mirrorDay(req)) {return;} // المزامنة الحية لليوم الحالي فقط
    if (_liveBusy || Date.now() - _liveLast < LIVE_MIN_GAP_MS) {return;}
    _liveBusy = true;
    _liveLast = Date.now();
    logger.info && logger.info('[cashier-monitor] live mirror refresh triggered');
    refreshMirrorOrders({ days: 1, io: req.io })
        .then(() => { _liveBusy = false; })
        .catch((e) => { _liveBusy = false; logger.warn && logger.warn('[cashier-monitor] live refresh failed: ' + (e.message || e)); });
}

function mirrorDay(req) {
    const d = String(req.query.date || '').slice(0, 10);
    if (DATE_RE.test(d)) {return d;}
    return new Date().toISOString().slice(0, 10);
}

// ─── ملخص الكاشيرية ليوم محدد ────────────────────────────────────────────────
router.get('/summary', GUARD, async (req, res) => {
    try {
        const day = mirrorDay(req);
        maybeTriggerLiveRefresh(req, day);
        const rows = (await pool.query(
            `SELECT cashier_no,
                    COUNT(*)::int AS invoices,
                    COALESCE(SUM(net),0)::float AS revenue,
                    COALESCE(SUM(total),0)::float AS revenue_ex_vat,
                    COALESCE(SUM(discount),0)::float AS discount,
                    COALESCE(SUM(vat),0)::float AS vat,
                    COALESCE(SUM(payed),0)::float AS payed,
                    COALESCE(SUM(pay_cash),0)::float AS pay_cash,
                    COALESCE(SUM(pay_network),0)::float AS pay_network,
                    COALESCE(SUM(pay_credit),0)::float AS pay_credit,
                    COALESCE(SUM(pay_mobile),0)::float AS pay_mobile,
                    MAX(doc_time) AS last_time,
                    MAX(synced_at) AS synced_at
             FROM ys_mirror_orders
             WHERE doc_date = $1::date AND cashier_no = ANY($2)
             GROUP BY cashier_no ORDER BY cashier_no`,
            [day, MIRROR_CASHIERS])).rows;
        const byCashier = new Map(rows.map((r) => [r.cashier_no, r]));
        res.json({
            ok: true, date: day,
            cashiers: MIRROR_CASHIERS.map((c) => {
                const r = byCashier.get(c) || {};
                const n = Number(r.invoices || 0);
                return {
                    cashier_no: c, invoices: n,
                    // revenue = شامل الضريبة (NET) — مطابق لشاشة الإيرادات/الأدمن
                    revenue: Number(r.revenue || 0),
                    revenue_ex_vat: Number(r.revenue_ex_vat || 0),
                    net: Number(r.net || 0),
                    discount: Number(r.discount || 0), vat: Number(r.vat || 0),
                    payed: Number(r.payed || 0),
                    pay_cash: Number(r.pay_cash || 0), pay_network: Number(r.pay_network || 0),
                    pay_credit: Number(r.pay_credit || 0), pay_mobile: Number(r.pay_mobile || 0),
                    open: Math.round((Number(r.net || r.revenue || 0) - Number(r.payed || 0)) * 100) / 100,
                    avg: n ? Math.round((Number(r.revenue || 0) / n) * 100) / 100 : 0,
                    last_time: r.last_time, synced_at: r.synced_at,
                };
            }),
        });
    } catch (error) {
        logger.error('[cashier-monitor/summary]', error);
        res.status(500).json({ error: 'CM_SUMMARY_FAILED', message: 'تعذر جلب ملخص الكاشيرية' });
    }
});

// ─── قائمة أوردرات اليوم (مع فلتر كاشير اختياري) ─────────────────────────────
router.get('/orders', GUARD, async (req, res) => {
    try {
        const day = mirrorDay(req);
        const cashier = String(req.query.cashier || '').trim();
        if (cashier && !MIRROR_CASHIERS.includes(cashier)) {
            return res.status(422).json({ error: 'INVALID_CASHIER', message: 'كاشير غير مشمول بالمراقبة (1/4/5/6/9)' });
        }
        const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const clauses = [`doc_date = $1::date`];
        const params = [day];
        if (cashier) { params.push(cashier); clauses.push(`cashier_no = $${params.length}`); }
        else { params.push(MIRROR_CASHIERS); clauses.push(`cashier_no = ANY($${params.length})`); }
        const where = `WHERE ${clauses.join(' AND ')}`;
        const total = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM ys_mirror_orders ${where}`, params)).rows[0].c);
        const rows = (await pool.query(
            `SELECT doc_no, cashier_no, doc_date, doc_time, shift_no, net, total, discount, vat, payed, saler_id,
                    pay_cash, pay_network, pay_credit, pay_mobile, table_name, zone_name, printed,
                    COALESCE(jsonb_array_length(lines),0)::int AS lines_count, synced_at
             FROM ys_mirror_orders ${where}
             ORDER BY doc_time DESC NULLS LAST, doc_no DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset])).rows;
        res.json({ ok: true, date: day, cashier: cashier || null, total, limit, offset, orders: rows });
    } catch (error) {
        logger.error('[cashier-monitor/orders]', error);
        res.status(500).json({ error: 'CM_ORDERS_FAILED', message: 'تعذر جلب الأوردرات' });
    }
});

// ─── تفاصيل أوردر بسطوره (قراءة فقط) ─────────────────────────────────────────
router.get('/orders/:doc', GUARD, async (req, res) => {
    try {
        // FIX 2026-10-11 (M16): scope check — was raw doc_no lookup without
        // cashier scope filter, letting any permitted user access ANY order
        // by guessing doc_no. Now restricted to MIRROR_CASHIERS only.
        const docNo = String(req.params.doc);
        const placeholders = MIRROR_CASHIERS.map((_, i) => `$${i + 2}`).join(',');
        const row = (await pool.query(
            `SELECT * FROM ys_mirror_orders WHERE doc_no = $1 AND cashier_no IN (${placeholders}) LIMIT 1`,
            [docNo, ...MIRROR_CASHIERS])).rows[0];
        if (!row) {return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'الأوردر غير موجود في المراقبة' });}
        res.json({ ok: true, order: row });
    } catch (error) {
        logger.error('[cashier-monitor/orders/:doc]', error);
        res.status(500).json({ error: 'CM_ORDER_FAILED', message: 'تعذر جلب الأوردر' });
    }
});

module.exports = router;
