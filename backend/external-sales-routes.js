/**
 * external-sales-routes.js — «البيع الخارجي: المبيعات مقابل المسحوبات»
 * ══════════════════════════════════════════════════════════════════════
 *  يجيب من قاعدة الإنتاج (قراءة فقط) لكل فترة [from, to]:
 *   • المسحوبات الصادرة لقسم البيع الخارجي من المخزن عبر أذون الصرف
 *     (حركات الخروج inventoryTx مرتبطة بإذن صرف + اسم منتج المخزن).
 *   • المبيعات الحقيقية لبضاعة البيع الخارجي من مرآة أوراكل (BILLS4)،
 *     مسجّلة في جدول revenues بمصدر 'بيع خارجي' مع بنود الفاتورة
 *     النصّية داخل notes — يُفك تحليلها هنا (100% تغطية في الإنتاج).
 *
 *  الأدوار: admin | owner | manager (تقرير مالي تشغيلي).
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const router = express.Router();
const READ_ROLES = ['admin', 'owner', 'manager'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => todayIso().slice(0, 7) + '-01';
const round3 = (v) => Math.round(Number(v || 0) * 1000) / 1000;
const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

/**
 * يُحلّل بنود الفاتورة المخزّنة كنصّ داخل notes إلى
 * [{ name, unit, qty }] بأقصى دقة ممكنة (لا يتجاهل أي بند).
 * الشكل المتاح فعليًا في الإنتاج (RB=540 فاتورة — 4,631 صنف — 0 فشل):
 *   "items=بند-وحدة(كمية)، بند آخر-وحدة(كمية)…"
 */
function parseRevenueItems(notes) {
    const match = /items=(.*)$/.exec(String(notes ?? ''));
    if (!match) { return []; }
    const tokens = match[1].split('،').map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const token of tokens) {
        // بند-وحدة(كمية) — مثل «كاتشب رنا جالون-كرتون(1)»
        let q = /^(.*)-\s*([^-()،]+)\(([\d.]+)\)\s*$/.exec(token);
        if (q) {
            items.push({ name: q[1].trim().replace(/\s+/g, ' '), unit: q[2].trim(), qty: Number(q[3]), parsed: true });
            continue;
        }
        // بند(كمية) — مثل «شاي ربيع احمر (0.13)»
        q = /^(.*)\(([\d.]+)\)\s*$/.exec(token);
        if (q) {
            items.push({ name: q[1].trim().replace(/\s+/g, ' '), unit: null, qty: Number(q[2]), parsed: true });
            continue;
        }
        items.push({ name: token, unit: null, qty: 1, parsed: false });
    }
    return items;
}

/**
 * ABS: 400-بند/100-صنف في الذيل هما حد التكلفة (النافذة) — لا نمرر 2000 قيد
 * لأن تفاصيل شاشة التكلفة تُعرض بتفاصيلها الكاملة في الدفتر.
 */
const ISSUED_LIMIT = 600;

router.get('/summary', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = ISO.test(String(req.query.from ?? '')) ? String(req.query.from) : monthStart();
        const to = ISO.test(String(req.query.to ?? '')) ? String(req.query.to) : todayIso();
        if (from > to) {
            return res.status(422).json({ error: 'INVALID_RANGE', message: 'تاريخ البداية بعد تاريخ النهاية' });
        }

        /* ── 1) المسحوبات (إذون الصرف) لقسم البيع الخارجي ─────────────── */
        const issuedRows = (await pool.query(
            `SELECT replace(tx."dispatchId", 'DIS-', '') AS doc_id,
                    tx.date,
                    tx."itemName" AS item,
                    tx.qty::numeric AS qty,
                    COALESCE(tx.catch_weight_unit, i.unit, 'وحدة') AS unit,
                    tx.cost::numeric AS cost,
                    tx."totalValue"::numeric AS value,
                    d.status,
                    d."deptName"
               FROM "inventoryTx" tx
               JOIN dispatches d ON ('DIS-' || d.id::text) = tx."dispatchId"
               LEFT JOIN inventory i ON i.id = tx."itemId"
              WHERE tx.type = 'out'
                AND d."deptCode" = 'external_sales'
                AND tx.date >= $1 AND tx.date <= $2
              ORDER BY tx.date DESC, tx.id DESC`,
            [from, to])).rows;

        const issuedByItemMap = new Map();
        const issuedDocs = new Set();
        let issuedQty = 0;
        let issuedValue = 0;
        for (const row of issuedRows) {
            const item = String(row.item ?? '');
            const qty = Number(row.qty ?? 0);
            const value = Number(row.value ?? 0);
            issuedQty += qty;
            issuedValue += value;
            issuedDocs.add(String(row.doc_id));
            const cur = issuedByItemMap.get(item) ?? { item, lines: 0, qty: 0, value: 0 };
            cur.lines += 1;
            cur.qty += qty;
            cur.value += value;
            issuedByItemMap.set(item, cur);
        }
        const issuedByItem = [...issuedByItemMap.values()]
            .map((x) => ({ item: x.item, lines: x.lines, qty: round3(x.qty), value: round2(x.value) }))
            .sort((a, b) => b.value - a.value);

        /* ── 2) المبيعات الحقيقية لليبيع الخارجي (مرآة Oracle) ─────────── */
        const revenueRows = (await pool.query(
            `SELECT id, date, external_ref, notes, amount::numeric AS amount
               FROM revenues
              WHERE source = 'بيع خارجي' AND date >= $1 AND date <= $2
              ORDER BY date DESC, id`,
            [from, to])).rows;

        const soldByItemMap = new Map();
        const soldInvoices = [];
        let soldAmount = 0;
        let soldQty = 0;
        let soldLines = 0;
        let unparsedLines = 0;
        for (const row of revenueRows) {
            const items = parseRevenueItems(row.notes);
            soldAmount += Number(row.amount ?? 0);
            soldQty += items.reduce((s, it) => s + it.qty, 0);
            soldLines += items.length;
            unparsedLines += items.filter((it) => !it.parsed).length;
            const secMatch = /\| sec=([^|]+) \|/.exec(String(row.notes ?? ''));
            soldInvoices.push({
                id: String(row.id),
                date: String(row.date),
                ref: String(row.external_ref ?? '').replace(/^ora:BILLS4:/, 'BILLS4:'),
                customer: secMatch ? secMatch[1].trim() : null,
                amount: round2(row.amount),
                items: items.length,
                qty: round3(items.reduce((s, it) => s + it.qty, 0)),
            });
            for (const it of items) {
                soldByItemMap.set(it.name, (soldByItemMap.get(it.name) ?? 0) + it.qty);
            }
        }
        const soldByItem = [...soldByItemMap.entries()]
            .map(([item, qty]) => ({ item, qty: round3(qty) }))
            .sort((a, b) => b.qty - a.qty);

        res.json({
            ok: true,
            from,
            to,
            issued: {
                totals: {
                    lines: issuedRows.length,
                    docs: issuedDocs.size,
                    qty: round3(issuedQty),
                    value: round2(issuedValue),
                },
                rows: issuedRows.slice(0, ISSUED_LIMIT).map((r) => ({
                    date: String(r.date),
                    doc: String(r.doc_id),
                    item: String(r.item ?? ''),
                    qty: round3(r.qty),
                    unit: String(r.unit ?? ''),
                    cost: round3(r.cost),
                    value: round2(r.value),
                    status: String(r.status ?? ''),
                })),
                capped: issuedRows.length > ISSUED_LIMIT,
                byItem: issuedByItem,
            },
            sold: {
                totals: {
                    invoices: revenueRows.length,
                    amount: round2(soldAmount),
                    qty: round3(soldQty),
                    lines: soldLines,
                    unparsedLines,
                },
                rows: soldInvoices,
                byItem: soldByItem,
            },
        });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack } }, '[external-sales/summary]');
        res.status(500).json({ error: 'EXTERNAL_SALES_FAILED', message: 'تعذر حساب تقرير البيع الخارجي — يرجى المحاولة مرة أخرى' });
    }
});

module.exports = { router, parseRevenueItems };
