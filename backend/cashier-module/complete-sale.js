/**
 * complete-sale.js — POST /api/sales/complete
 * ────────────────────────────────────────────────────────────────────────────
 * Single atomic Database Transaction that performs:
 *   1. Idempotency-Key check (24h TTL, body-hash collision detection)
 *   2. Validates cashier has an OPEN pos_shift_sessions row
 *   3. INSERT pos_orders (status=draft) + pos_order_items (snapshots)
 *   4. SELECT ... FOR UPDATE on pos_products (قفل تنافسي فقط — stock_quantity
 *      عرض يدوي بالتصميم؛ الخصم الفعلي لمستويات المكونات عبر دفتر المخزون)
 *   5. INSERT pos_invoice_payments (split breakdown)
 *   6. UPDATE pos_orders.status='issued' → fires trg_pos_chain_invoice_hash (ZATCA)
 *   7. Compute ZATCA QR TLV payload (Base64) + ECDSA P-256 signature
 *   8. INSERT pos_pending_prints (offline-first ESC/POS queue)
 *   9. INSERT kitchen tickets per production department (KOT, no prices)
 *  10. INSERT pos_zatca_invoice_queue (async reporting)
 *  11. INSERT pos_idempotency_keys (24h cached response)
 *
 * Performance contract: p95 ≤ 200ms under 50 concurrent cashiers.
 */

const crypto = require('crypto');
const { logger } = require("../logger");
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { signInvoice } = require('./zatca-signer');
const { buildZatcaTlvInJs } = require('./zatca-tlv');
const { enqueueZatcaReporting } = require('./zatca-queue');
const { resolveSellerVat } = require('./zatca-vat');
const { buildEscPosReceipt } = require('./escpos-printer');
const { buildKotGroups, buildKotData, buildEscPosKot } = require('./kot-printer');
const { postInventoryLedgerEntry } = require('../inventory-ledger');
const { writeAuditLog } = require('./audit-middleware');
const { riyadhDateOf } = require('../riyadh-date');
const { convertQuantity } = require('../unit-conversion');
const { recordSale } = require('./metrics');

const ALLOWED_METHODS = new Set(['cash', 'card', 'wallet', 'bank_transfer', 'voucher', 'loyalty']);
const MAX_ITEMS = 200;

// ─── تفويض الخصم وتخفيض السعر (fail-closed) ──────────────────────────────
// قبل هذا الإصلاح كان أي كاشير يخفض السعر تحت سعر القائمة أو يطبّق خصماً
// بلا حدّ — تسريب مالي مباشر بلا أثر. القواعد الآن:
//   · SALE_DISCOUNT_MAX_PERCENT       : أقصى خصم (نسبة من إجمالي السطر) لغير المعتمد
//   · SALE_PRICE_OVERRIDE_MAX_PERCENT : أقصى تخفيض سعر (نسبة من سعر القائمة) لغير المعتمد
//   · SALE_DISCOUNT_APPROVER_ROLES    : الأدوار التي تتجاوز الحد (مع سجل تدقيق)
// الافتراضي 0% = مغلق حتى يحدد المالك السياسة بنفسه (لا تخمين لقيم العمل).
// القيمة تُقرأ عند الإقلاع — تغييرها يحتاج إعادة تشغيل الخادم.
const SALE_DISCOUNT_MAX_PERCENT = Math.max(0, Number(process.env.SALE_DISCOUNT_MAX_PERCENT || '0'));
const SALE_PRICE_OVERRIDE_MAX_PERCENT = Math.max(0, Number(process.env.SALE_PRICE_OVERRIDE_MAX_PERCENT || '0'));
const SALE_DISCOUNT_APPROVER_ROLES = new Set(
    String(process.env.SALE_DISCOUNT_APPROVER_ROLES || 'manager,admin')
        .split(',').map((s) => s.trim()).filter(Boolean)
);
function isDiscountApprover(role) {
    return SALE_DISCOUNT_APPROVER_ROLES.has(String(role || ''));
}
const MAX_PAYMENTS = 8;

function generateLegacyId() {
    // Milliseconds × 1000 + crypto-random suffix — collision-resistant under bursts
    return Date.now() * 1000 + crypto.randomInt(0, 1000);
}

function summarizeItemsForNotes(lineItems = []) {
    const byName = new Map();
    for (const li of lineItems) {
        const name = String(li.product_name || '').trim() || '—';
        const qty = Number(li.quantity || 0);
        byName.set(name, (byName.get(name) || 0) + qty);
    }
    const topNames = [...byName.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([n, q]) => `${n}(${q})`)
        .join('، ');
    return topNames;
}

function resolveRecipeStockAvailability({
    required,
    consumptionLocationId,
    consumptionAvailable,
    mainLocationId,
    mainAvailable,
    allowFallback,
}) {
    if (consumptionAvailable >= required) {
        return consumptionAvailable;
    }
    if (allowFallback && mainLocationId && mainLocationId !== consumptionLocationId && mainAvailable >= required) {
        return mainAvailable;
    }
    return consumptionAvailable;
}

async function syncErpRevenueFromPosSale(client, {
    orderId,
    orderRow,
    totals,
    cashier,
    requestId,
}) {
    // Link POS dept → ERP dept (departments.code) through pos_departments.legacy_dept_code
    const posDeptRes = await client.query(
        `SELECT id, code, name_ar, legacy_dept_code FROM pos_departments WHERE id = $1;`,
        [orderRow.department_id]
    );
    const posDept = posDeptRes.rows[0] || null;
    if (!posDept) {
        throw new Error(`POS sale references unknown department ${orderRow.department_id}; refusing to issue a sale without its ERP revenue mapping.`);
    }

    let legacyDeptCode = posDept.legacy_dept_code || null;

    // ─── Self-healing mapping ────────────────────────────────────────
    // Previously: if a POS department had no legacy_dept_code mapping to the
    // `departments` table, the sale was completed but SILENTLY excluded from
    // revenue (only a warn log). A cashier could sell all day and see nothing
    // in the revenue dashboard. Instead we now auto-create/attach a matching
    // `departments` row the first time this happens, so every completed sale
    // is guaranteed to be reflected in revenue — no manual admin setup step.
    if (!legacyDeptCode) {
        const derivedCode = posDept.code || `pos_${posDept.id}`;
        await client.query(
            `INSERT INTO departments (id, code, name, icon, color)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (code) DO NOTHING;`,
            [generateLegacyId(), derivedCode, posDept.name_ar || derivedCode, '🏪', '#6366f1']
        );
        await client.query(
            `UPDATE pos_departments SET legacy_dept_code = $2 WHERE id = $1;`,
            [posDept.id, derivedCode]
        );
        legacyDeptCode = derivedCode;
        logger.info(`[${requestId}] Auto-mapped pos_departments.id=${posDept.id} → departments.code='${derivedCode}' (self-healing revenue sync)`);
    }

    const revenueId = generateLegacyId();
    // FIX (Enterprise 2026-10-21): تاريخ الإيراد بتوقيت الرياض — toISOString()
    // كان يُرجع اليوم السابق لمبيعات 00:00–02:59 الرياض.
    const date = riyadhDateOf(orderRow.created_at || Date.now());
    const itemsText = summarizeItemsForNotes(totals?.line_items || []);

    const notes = [
        `[AUTO:POS]`,
        `order=${orderId}`,
        `invoice=${orderRow.invoice_counter}`,
        `cashier=${cashier?.name || cashier?.username || cashier?.id}`,
        itemsText ? `items=${itemsText}` : null,
    ].filter(Boolean).join(' | ');

    // The normalized revenue row is part of the sale's accounting projection.
    // Keep it in the same transaction and fail the sale if it cannot be persisted.
    const revenueInsert = await client.query(
        `INSERT INTO revenues (id, "deptId", source, amount, date, notes, pos_order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pos_order_id) WHERE pos_order_id IS NOT NULL DO NOTHING
         RETURNING id;`,
        [
            revenueId,
            legacyDeptCode,
            `POS:${posDept.name_ar || posDept.code || 'dept'}`,
            Number(orderRow.total_amount),
            date,
            notes,
            orderId,
        ]
    );
    const insertedRevenueId = revenueInsert.rows[0]?.id;
    const existingRevenueId = insertedRevenueId ? null : (
        await client.query('SELECT id FROM revenues WHERE pos_order_id = $1 LIMIT 1', [orderId])
    ).rows[0]?.id;
    const persistedRevenueId = insertedRevenueId || existingRevenueId;
    if (!persistedRevenueId) {
        throw new Error(`POS revenue projection missing after idempotent insert for order ${orderId}.`);
    }

    // 2) مرآة app_state (لوحة الكلاسيكية) — انتقلت لما بعد الالتزام:
    // كان هذا الكتلة تقرأ وتعيد كتابة JSON كامل داخل المعاملة بقفل FOR UPDATE،
    // مما يُصَلَط كل مبيعات النظام على صف واحد (عنق زجاجة عالمي) ويمنع تزامن البيع.
    // الآن: نبني الحُزمة هنا فقط، والكتابة تتم بعد الالتزام (best-effort، غير قاتلة)
    // بمصفوفة محدودة السقف (آخر 300 إيراد) حتى لا ينمو الـ JSON بلا حد.
    const legacyMirror = {
        id: persistedRevenueId,
        deptId: legacyDeptCode,
        source: `POS:${posDept.name_ar || posDept.code || 'dept'}`,
        amount: Number(orderRow.total_amount),
        date,
        notes,
        autoGenerated: true,
        pos: {
            order_id: orderId,
            invoice_counter: orderRow.invoice_counter,
            pos_department_id: Number(orderRow.department_id),
            pos_department_code: posDept.code || null,
        },
    };

    return { revenueId: persistedRevenueId, legacyDeptCode, legacyMirror };
}

/**
 * appendLegacyRevenueMirror — مرآة الإيرادات للوحة الكلاسيكية (بعد الالتزام)
 * يُحدّث الصف بعملية upsert ذرّية لمنع فقد إضافات متزامنة، مع منع التكرار
 * والاحتفاظ بآخر 300 إيراد. جدول revenues هو السجل المالي الأساسي.
 */
const LEGACY_MIRROR_MAX = 300;
async function appendLegacyRevenueMirror(mirror) {
    if (!mirror || !mirror.pos || !mirror.pos.order_id) {return false;}
    const result = await pool.query(
        `INSERT INTO app_state AS current_state (id, state_data, updated_at)
         VALUES (1, jsonb_build_object('revenues', jsonb_build_array($2::jsonb)), CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE
            SET state_data = jsonb_set(
                    COALESCE(current_state.state_data, '{}'::jsonb),
                    '{revenues}',
                    (
                        SELECT COALESCE(jsonb_agg(recent.item ORDER BY recent.ordinality), '[]'::jsonb)
                               || jsonb_build_array($2::jsonb)
                          FROM (
                              SELECT entry.item, entry.ordinality
                                FROM jsonb_array_elements(
                                    CASE WHEN jsonb_typeof(current_state.state_data->'revenues') = 'array'
                                         THEN current_state.state_data->'revenues'
                                         ELSE '[]'::jsonb END
                                ) WITH ORDINALITY AS entry(item, ordinality)
                               WHERE entry.item #>> '{pos,order_id}' IS DISTINCT FROM $1::text
                               ORDER BY entry.ordinality DESC
                               LIMIT $3
                          ) recent
                    ),
                    true
                ),
                updated_at = CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(current_state.state_data->'revenues') = 'array'
                         THEN current_state.state_data->'revenues'
                         ELSE '[]'::jsonb END
                ) AS existing(item)
               WHERE existing.item #>> '{pos,order_id}' = $1::text
          )
         RETURNING id;`,
        [String(mirror.pos.order_id), JSON.stringify(mirror), LEGACY_MIRROR_MAX - 1]
    );
    return result.rowCount > 0;
}

function sortKeysDeep(obj) {
    if (Array.isArray(obj)) {return obj.map(sortKeysDeep);}
    if (obj && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeysDeep(obj[k]); return acc; }, {});
    }
    return obj;
}
function canonicalBodyHash(body) {
    return crypto.createHash('sha256').update(JSON.stringify(sortKeysDeep(body)), 'utf8').digest('hex');
}

function validateSalePayload(body) {
    const errors = [];
    if (!body || typeof body !== 'object') {return ['Body must be a JSON object.'];}

    // ─── Coerce numeric inputs that may arrive as strings ──
    // pg returns BIGINT columns (pos_products.id, pos_departments.id) as
    // strings to preserve 64-bit precision. The frontend (pos.js) reuses
    // those values verbatim in sale payloads, so we must accept either
    // form here. We normalize to numbers in-place so downstream code can
    // use Number.isInteger / numeric comparisons uniformly.
    if (body.department_id !== undefined && typeof body.department_id !== 'number') {
        const n = Number(body.department_id);
        if (Number.isFinite(n)) {body.department_id = n;}
    }
    if (Array.isArray(body.items)) {
        body.items.forEach((it) => {
            if (it && it.product_id !== undefined && typeof it.product_id !== 'number') {
                const n = Number(it.product_id);
                if (Number.isFinite(n)) {it.product_id = n;}
            }
            if (it && typeof it.quantity !== 'number') {
                const n = Number(it.quantity);
                if (Number.isFinite(n)) {it.quantity = n;}
            }
            if (it && typeof it.unit_price !== 'number') {
                const n = Number(it.unit_price);
                if (Number.isFinite(n)) {it.unit_price = n;}
            }
            if (it && typeof it.discount !== 'number') {
                const n = Number(it.discount);
                if (Number.isFinite(n)) {it.discount = n;}
            }
        });
    }
    if (Array.isArray(body.payments)) {
        body.payments.forEach((p) => {
            if (p && typeof p.amount !== 'number') {
                const n = Number(p.amount);
                if (Number.isFinite(n)) {p.amount = n;}
            }
        });
    }

    if (!Number.isInteger(body.department_id) || body.department_id <= 0) {errors.push('department_id must be a positive integer.');}
    if (!Array.isArray(body.items) || body.items.length === 0) {
        errors.push('items must be a non-empty array.');
    } else if (body.items.length > MAX_ITEMS) {
        errors.push(`items length exceeds ${MAX_ITEMS}.`);
    } else {
        body.items.forEach((it, i) => {
            if (it == null || typeof it !== 'object') {
                errors.push(`items[${i}] must be an object.`);
                return;
            }
            if (!Number.isInteger(it.product_id) || it.product_id <= 0) {errors.push(`items[${i}].product_id invalid.`);}
            if (typeof it.quantity !== 'number' || it.quantity <= 0) {errors.push(`items[${i}].quantity must be > 0.`);}
            if (typeof it.unit_price !== 'number' || it.unit_price < 0) {errors.push(`items[${i}].unit_price must be ≥ 0.`);}
            if (typeof it.discount !== 'number' || it.discount < 0) {errors.push(`items[${i}].discount must be ≥ 0.`);}
            // Discount can never exceed the line value — otherwise the line total
            // goes negative and the drawer pays out “change” on a non-existent sale
            if (typeof it.discount === 'number' && typeof it.quantity === 'number' && typeof it.unit_price === 'number'
                && it.discount > it.quantity * it.unit_price) {
                errors.push(`items[${i}].discount exceeds line value.`);
            }
        });
    }
    if (!Array.isArray(body.payments) || body.payments.length === 0) {
        errors.push('payments must be a non-empty array.');
    } else if (body.payments.length > MAX_PAYMENTS) {
        errors.push(`payments length exceeds ${MAX_PAYMENTS}.`);
    } else {
        body.payments.forEach((p, i) => {
            if (!ALLOWED_METHODS.has(p.method)) {errors.push(`payments[${i}].method invalid.`);}
            if (typeof p.amount !== 'number' || p.amount <= 0) {errors.push(`payments[${i}].amount must be > 0.`);}
        });
    }
    return errors;
}

/**
 * isTransientSaleError — true only for saturation/infra failures that are
 * safe to retry: statement timeout (57014), deadlock (40P01), serialization
 * (40001), connection loss (08xxx/57P0x), pool-checkout timeouts. Business
 * rejections (INSUFFICIENT_STOCK, VALIDATION_FAILED, 23505, …) return false.
 */
function isTransientSaleError(err) {
    if (!err || typeof err !== 'object') {return false;}
    const TRANSIENT_CODES = new Set(['57014', '40P01', '40001', '55P01', '57P03', '08000', '08003', '08006']);
    if (err.code && TRANSIENT_CODES.has(String(err.code))) {return true;}
    return /timeout exceeded when trying to connect|connection terminated|socket hang up|server closed the connection|Connection terminated unexpectedly|remaining connection slots/i.test(String(err.message || ''));
}

/**
 * Sale admission control — big-company burst pattern.
 * A sale transaction is heavy (dozens of statements, row locks on shared
 * inventory). Letting 55 of them pile into PG at once serializes on the
 * same row locks while burning pool connections and statement_timeout,
 * producing mass 500s. Instead, bound concurrent sale transactions; the
 * overflow waits in Node (FIFO, cheap, no timeout pressure) and drains
 * as slots free. Normal POS traffic (a few terminals) never touches the
 * limit. P3 idempotency is unaffected: queued duplicates still serialize
 * on the idempotency-key reservation inside the transaction.
 */
const SALE_MAX_CONCURRENT = Math.max(2, parseInt(process.env.SALE_MAX_CONCURRENT || '8', 10));
let _saleActive = 0;
const _saleQueue = [];
function acquireSaleSlot() {
    if (_saleActive < SALE_MAX_CONCURRENT) { _saleActive += 1; return Promise.resolve(); }
    return new Promise((resolve) => { _saleQueue.push(resolve); });
}
function releaseSaleSlot() {
    const next = _saleQueue.shift();
    if (next) { next(); } // slot transfers directly — active count unchanged
    else { _saleActive -= 1; }
}

function computeTotalsServerSide(items, productsMap, actor = null) {
    let subtotal = 0, discount_total = 0, tax_total = 0;
    const lineItems = [];
    const overrides = [];
    const isApprover = isDiscountApprover(actor?.role);
    for (const it of items) {
        const p = productsMap.get(it.product_id);
        if (!p) {throw Object.assign(new Error(`Product ${it.product_id} not found`), { code: 'PRODUCT_NOT_FOUND' });}
        const listPrice = Number(p.price);
        if (it.unit_price > listPrice) {
            throw Object.assign(
                new Error(`Price override for product ${p.id}: requested ${it.unit_price} > stored ${p.price}`),
                { code: 'PRICE_OVERRIDE_FORBIDDEN' }
            );
        }
        const discount = Number((it.discount || 0).toFixed(2));
        // ── حد تخفيض السعر تحت سعر القائمة (لا يُسمح للسلطة وحدها) ──
        const priceGapPercent = listPrice > 0 ? ((listPrice - Number(it.unit_price)) / listPrice) * 100 : 0;
        if (priceGapPercent > SALE_PRICE_OVERRIDE_MAX_PERCENT + 1e-9) {
            if (!isApprover) {
                throw Object.assign(
                    new Error(`تخفيض السعر للصنف ${p.id} تجاوز الحد (${priceGapPercent.toFixed(2)}% / حد ${SALE_PRICE_OVERRIDE_MAX_PERCENT}%) — يتطلب صلاحية معتمد`),
                    { code: 'DISCOUNT_APPROVAL_REQUIRED', statusCode: 403 }
                );
            }
            overrides.push({
                kind: 'price', product_id: p.id, product_name: p.name_ar,
                list_price: listPrice, charged_price: Number(it.unit_price),
                percent: Number(priceGapPercent.toFixed(2)),
            });
        }
        // ── حد الخصم على السطر ──
        const gross = Number(it.quantity) * Number(it.unit_price);
        const discountPercent = gross > 0 ? (discount / gross) * 100 : 0;
        if (discountPercent > SALE_DISCOUNT_MAX_PERCENT + 1e-9) {
            if (!isApprover) {
                throw Object.assign(
                    new Error(`خصم السطر للصنف ${p.id} تجاوز الحد (${discountPercent.toFixed(2)}% / حد ${SALE_DISCOUNT_MAX_PERCENT}%) — يتطلب صلاحية معتمد`),
                    { code: 'DISCOUNT_APPROVAL_REQUIRED', statusCode: 403 }
                );
            }
            overrides.push({
                kind: 'discount', product_id: p.id, product_name: p.name_ar,
                gross: Number(gross.toFixed(2)), discount,
                percent: Number(discountPercent.toFixed(2)),
            });
        }
        const lineTotal = Number(((it.quantity * it.unit_price) - (it.discount || 0)).toFixed(2));
        if (lineTotal < 0) {
            throw Object.assign(new Error(`Negative line total for product ${p.id}`), { code: 'NEGATIVE_LINE_TOTAL' });
        }
        // A stored vat_rate of 0 is legitimate (zero-rated goods) — only a
        // missing value falls back to the standard 15% rate
        const vatRate = (p.vat_rate === null || p.vat_rate === undefined || Number.isNaN(Number(p.vat_rate))) ? 15.00 : Number(p.vat_rate);
        const vatAmount = Number((lineTotal * vatRate / 100).toFixed(2));
        subtotal += lineTotal;
        discount_total += discount;
        tax_total += vatAmount;
        lineItems.push({
            product_id: p.id, product_name: p.name_ar, product_barcode: p.barcode,
            quantity: it.quantity, unit_price: it.unit_price, discount,
            vat_rate: vatRate, line_total: lineTotal, vat_amount: vatAmount,
        });
    }
    const totals = {
        subtotal: Number(subtotal.toFixed(2)),
        discount_total: Number(discount_total.toFixed(2)),
        tax_total: Number(tax_total.toFixed(2)),
        total_amount: Number((subtotal + tax_total).toFixed(2)),
        line_items: lineItems,
        // تجاوزات مصرّح بها (معتمد تجاوز الحد) — تُكتب في سجل التدقيق
        overrides,
    };
    if (totals.total_amount < 0) {
        throw Object.assign(new Error('Sale total cannot be negative'), { code: 'NEGATIVE_TOTAL' });
    }
    return totals;
}

function reconcilePayments(payments, totalAmount) {
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const diff = Number((paid - totalAmount).toFixed(2));
    if (diff < -0.01) {
        throw Object.assign(new Error(`Underpayment: paid ${paid} < total ${totalAmount}`), { code: 'UNDERPAYMENT' });
    }
    return { paid, diff };
}

async function completeSale(req, res) {
    const requestId = req.id || uuidv4();
    const startedAt = Date.now();

    const cashier = req.user;
    if (!cashier) {return res.status(401).json({ error: 'UNAUTHORIZED' });}

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey || idempotencyKey.length > 128) {
        return res.status(400).json({ error: 'MISSING_OR_INVALID_IDEMPOTENCY_KEY' });
    }

    const validationErrors = validateSalePayload(req.body);
    if (validationErrors.length > 0) {return res.status(422).json({ error: 'VALIDATION_FAILED', details: validationErrors });}

    const bodyHash = canonicalBodyHash(req.body);

    // Admit AFTER cheap validation (400/422 above never consume a slot).
    await acquireSaleSlot();
    let client;
    let orderRow;
    try {
        client = await pool.connect();
        await client.query('BEGIN;');
        await client.query(`SET LOCAL TIME ZONE 'UTC';`);
        // Admitted sales get headroom: the global 30s statement guard is for
        // ordinary queries; a sale admitted through the semaphore may
        // legitimately wait on row locks drained ahead of it in the queue.
        await client.query(`SET LOCAL statement_timeout = '120s';`);
        await client.query(`SELECT set_config('app.user_id', $1, true);`, [String(cashier.id)]);
        await client.query(`SELECT set_config('app.user_role', $1, true);`, [cashier.role]);
        await client.query(`SELECT set_config('app.user_name', $1, true);`, [cashier.name || cashier.username || '']);
        await client.query(`SELECT set_config('app.client_ip', $1, true);`, [req.ip || '']);
        await client.query(`SELECT set_config('app.request_id', $1, true);`, [requestId]);

        // ── Idempotency: RESERVE THE KEY FIRST (insert-before-work) ──────────
        // The old check-then-insert pattern had a TOCTOU race: two concurrent
        // retries with the same key both saw zero rows and executed the full
        // sale twice (double stock consumption, double cash rows). Reserving
        // the key with INSERT ... ON CONFLICT DO NOTHING guarantees exactly
        // one winner; concurrent losers block on the unique index, then read
        // the winner's stored response below.
        const reserveRes = await client.query(
            `INSERT INTO pos_idempotency_keys (key, request_hash, expires_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')
             ON CONFLICT (key) DO NOTHING
             RETURNING key;`,
            [idempotencyKey, bodyHash]
        );
        if (reserveRes.rows.length === 0) {
            // Key already exists — lock it and replay or conflict
            const idemRes = await client.query(
                `SELECT key, request_hash, response_status, response_body, order_id, expires_at
                   FROM pos_idempotency_keys WHERE key = $1 FOR UPDATE;`,
                [idempotencyKey]
            );
            const row = idemRes.rows[0];
            if (row && row.expires_at < new Date()) {
                // Expired: RE-RESERVE the same row atomically instead of DELETE.
                // Deleting the row opened a double-sale hole: a concurrent retry
                // could re-INSERT the same key mid-transaction and execute the
                // sale again, and the final response cache (UPDATE ... WHERE
                // key=$1) matched 0 rows because the row no longer existed —
                // so the response was never cached and every retry re-executed.
                await client.query(
                    `UPDATE pos_idempotency_keys
                        SET request_hash = $2, response_status = NULL, response_body = NULL,
                            order_id = NULL, expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours'
                      WHERE key = $1;`,
                    [idempotencyKey, bodyHash]
                );
            } else if (row && row.request_hash === bodyHash) {
                await client.query('COMMIT;');
                return res.status(row.response_status || 201).json({
                    ...row.response_body,
                    _idempotent_replay: true,
                    _request_id: requestId,
                });
            } else {
                await client.query('ROLLBACK;');
                return res.status(409).json({
                    error: 'IDEMPOTENCY_KEY_CONFLICT',
                    message: 'Idempotency-Key was already used with a different body.',
                    original_order_id: row?.order_id || null,
                });
            }
        }

        // ── Resolve shift session ─────────────────────────────────────────────
        let sessionId = null;
        const shiftHeader = req.headers['x-shift-session-id'];
        if (shiftHeader) {
            sessionId = parseInt(shiftHeader, 10);
            if (!Number.isInteger(sessionId) || sessionId <= 0) {
                // An unparseable header must not silently resolve a DIFFERENT session
                await client.query('ROLLBACK;');
                return res.status(400).json({ error: 'INVALID_SHIFT_SESSION_ID' });
            }
        }

        if (sessionId) {
            const ss = await client.query(
                `SELECT id, department_id, cashier_id, status,
                        TO_CHAR(opened_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS biz_date,
                        TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS today
                   FROM pos_shift_sessions WHERE id = $1 FOR UPDATE;`,
                [sessionId]
            );
            if (ss.rows.length === 0) { await client.query('ROLLBACK;'); return res.status(404).json({ error: 'SHIFT_SESSION_NOT_FOUND' }); }
            if (ss.rows[0].status !== 'open') { await client.query('ROLLBACK;'); return res.status(409).json({ error: 'SHIFT_NOT_OPEN', status: ss.rows[0].status }); }
            // Day-end discipline: never sell on a previous-day shift — close it and open today's.
            if (ss.rows[0].biz_date !== ss.rows[0].today) { await client.query('ROLLBACK;'); return res.status(409).json({ error: 'SHIFT_STALE', message: 'الوردية من يوم سابق — أغلقها وافتح وردية اليوم' }); }
            if (Number(ss.rows[0].cashier_id) !== Number(cashier.id) && cashier.role === 'cashier') {
                await client.query('ROLLBACK;'); return res.status(403).json({ error: 'SHIFT_NOT_OWNED_BY_CASHIER' });
            }
            if (Number(ss.rows[0].department_id) !== Number(req.body.department_id)) {
                await client.query('ROLLBACK;'); return res.status(409).json({ error: 'SHIFT_DEPARTMENT_MISMATCH' });
            }
        } else {
            const ss = await client.query(
                `SELECT id FROM pos_shift_sessions
                  WHERE cashier_id = $1 AND department_id = $2 AND status = 'open'
                    AND TO_CHAR(opened_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') =
                        TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')
                  ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;`,
                [cashier.id, req.body.department_id]
            );
            if (ss.rows.length === 0) { await client.query('ROLLBACK;'); return res.status(409).json({ error: 'NO_OPEN_SHIFT' }); }
            sessionId = ss.rows[0].id;
        }

        // ── FIX R20 (Enterprise 2026-10-03): فحص الفترة المحاسبية قبل أي كتابة ──
        // كان البيع في شهر مُقفل يكتب كل صفوفه ثم يُبتلع فشل قيده المحاسبي
        // بصمت في post-commit (02_deep_dive §2.3). البيع يجري دائمًا بتاريخ
        // الرياض الحالي (الوردية القديمة مرفوضة أعلاه) — فالفحص على اليوم.
        try {
            const bd = await client.query(
                `SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS d`);
            await require('../accounting-periods').assertPeriodOpen(bd.rows[0].d);
        } catch (periodError) {
            await client.query('ROLLBACK;');
            return res.status(periodError.statusCode || 423).json({
                error: 'PERIOD_CLOSED',
                message: periodError.message || 'الشهر المحاسبي مُقفل — لا يمكن البيع فيه',
            });
        }

        // ── Lock menu products + recipe ingredients ──────────────────────────
        // A restaurant menu item is not a supermarket SKU. Its availability is
        // derived from the ingredient BOM in pos_product_ingredients and the
        // live quantities in inventory; all involved rows are locked in this
        // transaction to prevent two cashiers overselling the same ingredient.
        const productIds = [...new Set(req.body.items.map(i => i.product_id))];
        const productRes = await client.query(
            `SELECT id, name_ar, barcode, price, stock_quantity, vat_rate, is_active
               FROM pos_products WHERE id = ANY($1::bigint[]) FOR UPDATE;`,
            [productIds]
        );
        const productsMap = new Map(productRes.rows.map(p => [Number(p.id), p]));
        for (const pid of productIds) {
            if (!productsMap.has(pid)) { await client.query('ROLLBACK;'); return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', product_id: pid }); }
            if (!productsMap.get(pid).is_active) { await client.query('ROLLBACK;'); return res.status(409).json({ error: 'PRODUCT_INACTIVE', product_id: pid }); }
        }

        const posLocationRes = await client.query(
            `SELECT COALESCE(kp.kitchen_location_id, pd.location_id, main.id) AS location_id,
                    COALESCE(kp.operation_mode, 'flexible') AS operation_mode,
                    COALESCE(kp.allow_fallback, false) AS allow_fallback,
                    main.id AS main_location_id
               FROM pos_departments pd
               LEFT JOIN inventory_locations main ON main.code = 'MAIN-WAREHOUSE'
               LEFT JOIN kitchen_policies kp ON kp.department_id = pd.id
              WHERE pd.id = $1
              FOR SHARE OF pd;`,
            [req.body.department_id]
        );
        const locationConfig = posLocationRes.rows[0] || {};
        const consumptionLocationId = Number(locationConfig.location_id || 0);
        const mainLocationId = Number(locationConfig.main_location_id || 0);
        const kitchenMode = String(locationConfig.operation_mode || 'flexible');
        // قرار المالك 2026-10-07: السحب من الرئيسي في البيع ممنوع افتراضيًا —
        // نفاد مخزن القسم يوقف البيع (يُفعَّل الاستثناء لكل قسم من شاشته فقط).
        const allowKitchenFallback = locationConfig.allow_fallback === true || locationConfig.allow_fallback === 1 || String(locationConfig.allow_fallback).toLowerCase() === 'true';
        if (!consumptionLocationId) {
            await client.query('ROLLBACK;');
            return res.status(409).json({ error: 'INVENTORY_LOCATION_NOT_CONFIGURED' });
        }

        const ingredientRes = await client.query(
            `WITH active_bom AS (
                 SELECT rv.product_id, rvi.inventory_id,
                        rvi.quantity_per_yield AS quantity_per_unit,
                        rvi.waste_percent, rvi.unit
                   FROM pos_recipe_versions rv
                   JOIN pos_recipe_version_ingredients rvi ON rvi.recipe_version_id = rv.id
                  WHERE rv.status = 'active'
                    AND rv.effective_from <= CURRENT_TIMESTAMP
                    AND (rv.effective_to IS NULL OR rv.effective_to > CURRENT_TIMESTAMP)
                    AND rv.product_id = ANY($1::bigint[])
             ), legacy_bom AS (
                 SELECT pi.product_id, pi.inventory_id, pi.quantity_per_unit,
                        pi.waste_percent, pi.unit
                   FROM pos_product_ingredients pi
                  WHERE pi.product_id = ANY($1::bigint[])
                    AND NOT EXISTS (SELECT 1 FROM active_bom a WHERE a.product_id = pi.product_id)
             ), selected_bom AS (
                 SELECT * FROM active_bom
                 UNION ALL
                 SELECT * FROM legacy_bom
             )
              SELECT b.product_id, b.inventory_id, b.quantity_per_unit, b.waste_percent,
                     i.name AS inventory_name,
                     COALESCE((SELECT GREATEST(0, on_hand - reserved) FROM inventory_location_balances WHERE inventory_id = i.id AND location_id = $2), 0) AS available_qty,
                     COALESCE((SELECT GREATEST(0, on_hand - reserved) FROM inventory_location_balances WHERE inventory_id = i.id AND location_id = $3), 0) AS main_available_qty,
                     i.unit AS inventory_unit, i.weight AS inventory_weight, b.unit
                FROM selected_bom b
                JOIN inventory i ON i.id = b.inventory_id
               ORDER BY b.product_id, b.inventory_id;`,
            [productIds, consumptionLocationId, mainLocationId]
        );
        const ingredientsByProduct = new Map();
        for (const row of ingredientRes.rows) {
            const pid = Number(row.product_id);
            if (!ingredientsByProduct.has(pid)) {ingredientsByProduct.set(pid, []);}
            ingredientsByProduct.get(pid).push(row);
        }

        const requestedQtyByProduct = new Map();
        for (const it of req.body.items) {
            requestedQtyByProduct.set(it.product_id, (requestedQtyByProduct.get(it.product_id) || 0) + it.quantity);
        }

        const ingredientRequirements = new Map();
        const ingredientConsumption = [];
        for (const [pid, qty] of requestedQtyByProduct) {
            const ingredients = ingredientsByProduct.get(pid) || [];
            if (!ingredients.length) {
                // صنف منيو غير مرتبط بوصفة: يباع كمنتج خدمة، ولا تُدار له كمية من POS.
                // إدارة المخزون تبدأ فقط بعد ربطه بمكونات من المخزن.
                continue;
            }

            for (const ingredient of ingredients) {
                let inventoryQty;
                try {
                    inventoryQty = convertQuantity(Number(ingredient.quantity_per_unit), ingredient.unit, ingredient.inventory_unit, { inventoryWeight: Number(ingredient.inventory_weight || 0) });
                } catch (_) {
                    await client.query('ROLLBACK;');
                    return res.status(422).json({ error: 'INCOMPATIBLE_RECIPE_UNITS', message: `وحدة مكون ${ingredient.inventory_name || ingredient.inventory_id} لا تتوافق مع وحدة المخزن` });
                }
                const required = Number((qty * inventoryQty * (1 + Number(ingredient.waste_percent || 0) / 100)).toFixed(4));
                const inventoryId = Number(ingredient.inventory_id);
                const previous = ingredientRequirements.get(inventoryId) || 0;
                ingredientRequirements.set(inventoryId, Number((previous + required).toFixed(4)));
                ingredientConsumption.push({
                    product_id: pid,
                    inventory_id: inventoryId,
                    quantity: required,
                });
            }
        }

        for (const [inventoryId, required] of ingredientRequirements) {
            const ingredient = ingredientRes.rows.find(row => Number(row.inventory_id) === inventoryId);
            const available = resolveRecipeStockAvailability({
                required,
                consumptionLocationId,
                consumptionAvailable: Number(ingredient?.available_qty || 0),
                mainLocationId,
                mainAvailable: Number(ingredient?.main_available_qty || 0),
                allowFallback: allowKitchenFallback && kitchenMode !== 'strict',
            });
            if (available < required) {
                await client.query('ROLLBACK;');
                return res.status(409).json({
                    error: 'INSUFFICIENT_INGREDIENT_STOCK',
                    message: `المكون ${ingredient?.inventory_name || inventoryId} غير كافٍ. المطلوب ${required} ${ingredient?.unit || ''} والمتاح ${available} ${ingredient?.unit || ''}`.trim(),
                    inventory_id: inventoryId,
                    ingredient: ingredient?.inventory_name || null,
                    requested: required,
                    available,
                });
            }
        }

        // ── Server-side totals ────────────────────────────────────────────────
        const totals = computeTotalsServerSide(req.body.items, productsMap, cashier);
        const { paid, diff } = reconcilePayments(req.body.payments, totals.total_amount);

        // ── Stock reason context ──────────────────────────────────────────────
        await client.query(`SELECT set_config('app.stock_reason', 'sale', true);`);

        // ── Insert order (draft) ──────────────────────────────────────────────
        const orderId = uuidv4();
        await client.query(
            `INSERT INTO pos_orders
                (id, session_id, department_id, cashier_id, status,
                 subtotal, discount_total, tax_total, total_amount, currency_code, notes, created_at)
             VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, 'SAR', $9, CURRENT_TIMESTAMP)
             RETURNING *;`,
            [orderId, sessionId, req.body.department_id, cashier.id,
             totals.subtotal, totals.discount_total, totals.tax_total, totals.total_amount,
             req.body.notes || null]
        );
        await client.query(`SELECT set_config('app.order_id', $1, true);`, [orderId]);

        // ── Insert order_items (batched) ──────────────────────────────────────
        let itemIdx = 1;
        const itemParams = [];
        const itemValues = totals.line_items.map(li => [
            orderId, li.product_id, li.product_name, li.product_barcode,
            li.quantity, li.unit_price, li.discount, li.vat_rate, li.line_total, li.vat_amount,
        ]);
        const itemPlaceholders = itemValues.map(row => `(${row.map(() => `$${itemIdx++}`).join(',')})`).join(',');
        for (const row of itemValues) {itemParams.push(...row);}
        await client.query(
            `INSERT INTO pos_order_items
                (order_id, product_id, product_name, product_barcode, quantity, unit_price,
                 discount, vat_rate, line_total, vat_amount)
             VALUES ${itemPlaceholders};`,
            itemParams
        );

        // ── Atomic inventory ledger posting ───────────────────────────────────
        // Consume recipe ingredients from the POS department location. The
        // immutable ledger is authoritative; inventory.qty remains a projection.
        const kitchenExceptions = [];
        for (const [inventoryId, required] of ingredientRequirements) {
            let postingLocationId = consumptionLocationId;
            let posted;
            try {
                posted = await postInventoryLedgerEntry(client, {
                    transactionType: 'sale_consumption',
                    inventoryId,
                    locationId: postingLocationId,
                quantityDelta: -Number(required),
                referenceType: 'pos_order',
                referenceId: orderId,
                shiftId: sessionId,
                userId: cashier.id,
                correlationId: requestId,
                idempotencyKey: `sale:${orderId}:inventory:${inventoryId}`,
                reason: 'استهلاك مكونات بيع POS',
                    metadata: { department_id: req.body.department_id, order_id: orderId, kitchen_mode: kitchenMode },
                });
            } catch (inventoryError) {
                const canFallback = inventoryError.code === 'INSUFFICIENT_STOCK' && allowKitchenFallback && kitchenMode !== 'strict' && mainLocationId && mainLocationId !== postingLocationId;
                if (!canFallback) {throw inventoryError;}
                postingLocationId = mainLocationId;
                posted = await postInventoryLedgerEntry(client, {
                    transactionType: 'sale_consumption', inventoryId, locationId: postingLocationId,
                    quantityDelta: -Number(required), referenceType: 'pos_order', referenceId: orderId,
                    shiftId: sessionId, userId: cashier.id, correlationId: requestId,
                    idempotencyKey: `sale:${orderId}:inventory:${inventoryId}:fallback`,
                    reason: 'استهلاك بيع من المخزن الرئيسي كاستثناء تشغيل مطبخ',
                    metadata: { department_id: req.body.department_id, order_id: orderId, kitchen_mode: kitchenMode, fallback: true },
                });
                kitchenExceptions.push({ inventory_id: inventoryId, quantity: Number(required), reason: 'لا يوجد رصيد كافٍ في مخزن المطبخ؛ تم السماح بالبيع كاستثناء مرن' });
            }
            ingredientConsumption.find(item => item.inventory_id === inventoryId);
            for (const consumption of ingredientConsumption.filter(item => item.inventory_id === inventoryId)) {
                await client.query(
                    `INSERT INTO pos_stock_movements
                        (product_id, order_id, quantity_delta, balance_after, reason, performed_by, metadata)
                     VALUES ($1, $2, $3, $4, 'sale_recipe', $5, $6);`,
                    [consumption.product_id, orderId, -consumption.quantity, posted.balanceAfter,
                     cashier.id, JSON.stringify({ inventory_id: inventoryId, ledger_id: posted.ledger.id, location_id: postingLocationId, kitchen_mode: kitchenMode })]
                );
            }
        }

        if (kitchenExceptions.length) {
            for (const exception of kitchenExceptions) {
                await client.query(`INSERT INTO kitchen_exceptions(order_id,product_id,department_id,quantity,operation_mode,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [orderId, ingredientConsumption.find(x => x.inventory_id === exception.inventory_id)?.product_id || null, req.body.department_id, exception.quantity, kitchenMode, exception.reason, cashier.id]);
            }
        }
        // NOTE: menu items without a recipe are sold as service products —
        // stock management starts only after linking them to inventory
        // ingredients, so no direct-stock fallback exists here.

        // ── Insert invoice_payments ───────────────────────────────────────────
        let payIdx = 1;
        const payParams = [];
        const payValues = req.body.payments.map(p => [
            orderId, p.method, p.amount, 'in', 'SAR', p.reference || null, JSON.stringify(p.payer_info || {}),
        ]);
        const payPlaceholders = payValues.map(row => `(${row.map(() => `$${payIdx++}`).join(',')})`).join(',');
        for (const row of payValues) {payParams.push(...row);}
        await client.query(
            `INSERT INTO pos_invoice_payments
                (order_id, method, amount, direction, currency, reference, payer_info)
             VALUES ${payPlaceholders};`,
            payParams
        );

        // Change returned to the customer physically leaves the cash drawer —
        // record it as a cash 'out' row, otherwise shift-close math
        // (expected = opening + in − out) reports a phantom negative variance
        // equal to the change on EVERY overpaid cash sale.
        if (diff > 0) {
            await client.query(
                `INSERT INTO pos_invoice_payments
                    (order_id, method, amount, direction, currency, reference, payer_info)
                 VALUES ($1, 'cash', $2, 'out', 'SAR', $3, '{}'::jsonb);`,
                [orderId, diff, JSON.stringify({ reason: 'change', request_id: requestId })]
            );
        }

        // ── Promote to 'issued' → ZATCA hash chain trigger fires ──────────────
        const issuedRes = await client.query(
            `UPDATE pos_orders SET status = 'issued' WHERE id = $1
              RETURNING id, invoice_counter, invoice_uuid, invoice_hash,
                        previous_invoice_hash, total_amount, tax_total, subtotal,
                        discount_total, session_id, department_id, notes, created_at;`,
            [orderId]
        );
        orderRow = issuedRes.rows[0];

        // ── Build ZATCA QR TLV + sign ─────────────────────────────────────────
        const deptRes = await client.query(
            `SELECT name_ar, vat_number, code FROM pos_departments WHERE id = $1;`,
            [orderRow.department_id]
        );
        const dept = deptRes.rows[0];
        // Open-buffet department → the thermal receipt prints PERSON COUNTS
        // (guest tiers) instead of the menu-item table
        const isBuffetDept = dept?.code === 'erp_open_buffet';
        // Seller VAT resolution chain: department → ZATCA settings hub (managed
        // from the settings screen with zero code) → loud placeholder. Previously
        // ONLY the department column was read, so a VAT saved in the ZATCA hub
        // never reached invoices — a settings field that silently did nothing.
        let settingsVat = null;
        await client.query('SAVEPOINT zatca_settings_lookup;');
        try {
            const cfgRes = await client.query(`SELECT vat_number FROM zatca_settings WHERE id = 1;`);
            settingsVat = cfgRes.rows[0]?.vat_number || null;
            await client.query('RELEASE SAVEPOINT zatca_settings_lookup;');
        } catch (settingsError) {
            await client.query('ROLLBACK TO SAVEPOINT zatca_settings_lookup;');
            await client.query('RELEASE SAVEPOINT zatca_settings_lookup;');
            logger.warn(`[${requestId}] ZATCA settings lookup unavailable; resolving VAT from department: ${settingsError.message}`);
        }
        const resolvedVat = resolveSellerVat({ deptVat: dept?.vat_number, settingsVat });
        const vatNumberForQr = resolvedVat.vat;
        const vatNumberPlaceholder = resolvedVat.placeholder;
        if (resolvedVat.source === 'placeholder') {
            logger.error(`[${requestId}] pos_departments.id=${req.body.department_id} AND zatca_settings have NO vat_number — ZATCA QR uses a placeholder. Configure the real VAT number from الضبط ← ZATCA immediately.`);
        } else if (resolvedVat.source === 'settings_hub') {
            logger.info(`[${requestId}] ZATCA QR VAT taken from the settings hub (department has none)`);
        }
        const qrPayload = buildZatcaTlvInJs({
            sellerName: dept.name_ar,
            vatNumber: vatNumberForQr,
            timestamp: orderRow.created_at,
            total: Number(orderRow.total_amount),
            vatTotal: Number(orderRow.tax_total),
            counter: orderRow.invoice_counter,
            uuid: orderRow.invoice_uuid,
        });
        const signature = await signInvoice({
            invoiceHash: orderRow.invoice_hash,
            invoiceUuid: orderRow.invoice_uuid,
            counter: orderRow.invoice_counter,
        });
        await client.query(
            `UPDATE pos_orders SET qr_payload = $1, digital_signature = $2, signature_algorithm = 'ECDSA-P256-SHA256' WHERE id = $3;`,
            [qrPayload, signature, orderId]
        );

        // ── Enqueue print job ─────────────────────────────────────────────────
        const printerId = req.body.printer_id || `pos-${req.body.department_id}`;
        // ⚠ buildEscPosReceipt is async — without await the Promise itself was
        // serialized into the bytea payload (literal "{}" bytes) and every
        // thermal receipt printed garbage. Must await.
        const escposBytes = await buildEscPosReceipt({
            order: orderRow, items: totals.line_items, payments: req.body.payments,
            qrPayload, department: { ...dept, vat_number: vatNumberForQr }, cashier, paid, change: diff > 0 ? diff : 0,
            buffet: isBuffetDept,
        });
        const printRes = await client.query(
            `INSERT INTO pos_pending_prints (order_id, printer_id, payload, status, next_retry_at)
             VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP) RETURNING id;`,
            [orderId, printerId, escposBytes]
        );
        const printJobId = printRes.rows[0].id;

        // ── Kitchen Order Tickets (KOT) — settings-driven, sale-safe ────────
        // Each sold item maps to its PRODUCTION department
        // (pos_products.department_id = the kitchen that prepares it). One
        // thermal ticket per involved department × kot_copies, printer_id
        // `kot-<dept>` — no prices anywhere on the ticket. Buffet/service
        // items (no prep department) get no ticket by design. Any failure
        // here must NEVER block the sale — log loudly and continue.
        const kotJobs = [];
        let kotEnabled = false;
        await client.query('SAVEPOINT pos_kot_enqueue;');
        try {
            const kotCfgRes = await client.query(
                `SELECT kot_enabled, kot_copies, kot_include_notes
                   FROM pos_print_settings WHERE id = 1;`);
            const kotCfg = kotCfgRes.rows[0] || { kot_enabled: true, kot_copies: 1, kot_include_notes: true };
            kotEnabled = !!kotCfg.kot_enabled;
            if (kotEnabled) {
                const productIds = [...new Set(totals.line_items.map((li) => Number(li.product_id)).filter(Number.isFinite))];
                if (productIds.length) {
                    const prepRes = await client.query(
                        `SELECT p.id AS product_id, p.department_id AS prep_dept_id,
                                d.name_ar AS prep_dept_name
                           FROM pos_products p
                           LEFT JOIN pos_departments d ON d.id = p.department_id
                          WHERE p.id = ANY($1::bigint[]);`, [productIds]);
                    const prepMap = new Map();
                    for (const r of prepRes.rows) {
                        if (r.prep_dept_id) {prepMap.set(Number(r.product_id), { department_id: Number(r.prep_dept_id), department_name: r.prep_dept_name });}
                    }
                    const groups = buildKotGroups(totals.line_items, prepMap);
                    const copies = Math.max(1, Math.min(3, Number(kotCfg.kot_copies) || 1));
                    for (const g of groups) {
                        const kotData = buildKotData({ order: orderRow, group: g, cashier, includeNotes: kotCfg.kot_include_notes !== false });
                        const kotBytes = buildEscPosKot(kotData);
                        for (let c = 0; c < copies; c += 1) {
                            const kotJobRes = await client.query(
                                `INSERT INTO pos_pending_prints (order_id, printer_id, payload, status, next_retry_at)
                                 VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP) RETURNING id;`,
                                [orderId, `kot-${g.department_id}`, kotBytes]);
                            kotJobs.push({
                                job_id: kotJobRes.rows[0].id,
                                department_id: g.department_id,
                                department_name: g.department_name,
                                printer_id: `kot-${g.department_id}`,
                            });
                        }
                    }
                }
            }
            await client.query('RELEASE SAVEPOINT pos_kot_enqueue;');
        } catch (kotErr) {
            await client.query('ROLLBACK TO SAVEPOINT pos_kot_enqueue;');
            await client.query('RELEASE SAVEPOINT pos_kot_enqueue;');
            kotJobs.length = 0;
            logger.error(`[${requestId}] KOT enqueue failed — sale continues untouched:`, kotErr.message);
        }

        // ── Enqueue ZATCA reporting ───────────────────────────────────────────
        await client.query(
            `INSERT INTO pos_zatca_invoice_queue (order_id, status, attempts, next_retry_at)
             VALUES ($1, 'queued', 0, CURRENT_TIMESTAMP) ON CONFLICT (order_id) DO NOTHING;`,
            [orderId]
        );

        // ── ERP Automation: map POS sale → department revenue (dashboard) ─────
        const erpSync = await syncErpRevenueFromPosSale(client, {
            orderId,
            orderRow,
            totals,
            cashier,
            requestId,
        });

        // ── Cache idempotency response ────────────────────────────────────────
        const responsePayload = {
            order_id: orderId,
            invoice_counter: orderRow.invoice_counter,
            invoice_uuid: orderRow.invoice_uuid,
            invoice_hash: orderRow.invoice_hash,
            qr_payload: qrPayload,
            digital_signature: signature,
            total_amount: Number(orderRow.total_amount),
            tax_total: Number(orderRow.tax_total),
            subtotal: totals.subtotal,
            discount_total: totals.discount_total,
            paid, change: diff > 0 ? diff : 0,
            print_job_id: printJobId,
            zatca_queued: true,
            kot_enabled: kotEnabled,
            kot_jobs: kotJobs,
            session_id: sessionId,
            // Buffet invoices return a guest summary so the receipt modal shows
            // PERSON counts instead of a plain "sale completed" block
            buffet: isBuffetDept ? {
                persons_total: totals.line_items.reduce((s, li) => s + Number(li.quantity || 0), 0),
                tiers: totals.line_items.map(li => ({
                    name: li.product_name,
                    persons: Number(li.quantity || 0),
                    unit_price: Number(li.unit_price || 0),
                    amount: Number(li.line_total || 0),
                })),
            } : null,
            party_name: isBuffetDept ? (req.body.notes || null) : null,
            erp_revenue_id: erpSync?.revenueId || null,
            erp_dept_code: erpSync?.legacyDeptCode || null,
            zatca_vat_number_placeholder: vatNumberPlaceholder,
            _request_id: requestId,
            _duration_ms: Date.now() - startedAt,
        };
        // Fill in the reserved idempotency row with the final response.
        // (The key row was reserved at the start of this transaction — this is
        // an UPDATE, not a second INSERT, so the response is actually cached.)
        await client.query(
            `UPDATE pos_idempotency_keys
                SET response_status = 201, response_body = $3, order_id = $4,
                    cashier_id = $5, expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours'
              WHERE key = $1 AND request_hash = $2;`,
            [idempotencyKey, bodyHash, JSON.stringify(responsePayload), orderId, cashier.id]
        );

        // ── v7.1 Transactional Outbox: حدث SALE_POSTED داخل نفس معاملة البيع ──
        // العقد C5/G1: إثبات القناة المالية بأسلوب dual-publish — البث القديم
        // sale:completed أدناه يبقى كما هو. الإدراج محمي (فشل-مفتوح) في G1:
        // عدم تطبيق الترحيل 067 لا يؤثر على البيع إطلاقًا.
        await require('../realtime/outbox').tryInsertDomainEvent(pool, client, {
            eventType: 'SALE_POSTED',
            eventVersion: 1,
            aggregateType: 'sale',
            aggregateId: String(orderId),
            payload: {
                order_id: orderId,
                total: Number(orderRow.total_amount),
                cashier_id: cashier.id,
                department_id: req.body.department_id || null,
                at: new Date().toISOString(),
            },
            routingMetadata: {
                rooms: req.body.department_id ? [`dept:${req.body.department_id}`, 'erp:all'] : ['erp:all'],
                target: { type: 'permission', value: 'sale.view' },
            },
        });

        await client.query('COMMIT;');

        // أطلق اتصال المسبح فورًا بعد الالتزام — العمل بعد الالتزام (المرآة،
        // ZATCA، البث) لا يحتاج معاملة أصلًا، وحبس الاتصال طوالها كان يُجَوّع
        // المسبح تحت الحمل الثقيل ويصنع انتظارًا دائريًا: مبيعات تحبس
        // الاتصالات بينما خطواتها اللاحقة تنتظر اتصالًا حرًا من نفس المسبح.
        client.release();
        client = null;
        try { recordSale({ durationMs: Date.now() - startedAt, status: 'success' }); } catch (_) { logger.warn("complete-sale non-fatal:", _ && _.message ? _.message : _); }
        // ── Post-commit: مرآة الإيرادات للوحة الكلاسيكية (غير قاتلة) ──
        if (erpSync?.legacyMirror) {
            try { await appendLegacyRevenueMirror(erpSync.legacyMirror); }
            catch (e) { logger.warn(`[${requestId}] app_state revenue mirror failed (non-fatal): ${e.message}`); }
        }
        // ── Post-commit: BullMQ + Socket.io ───────────────────────────────────
        try { await enqueueZatcaReporting({ orderId, priority: 1 }); }
        catch (e) { logger.error(`[${requestId}] ZATCA enqueue failed (sweeper will retry):`, e.message); }
        // ── Post-commit: ترحيل محاسبي تلقائي لقسم المحاسبة (غير قاتل أبدًا) ──
        try { await require('../accounting-routes').postSaleToLedger(orderId); }
        catch (e) { logger.warn(`[${requestId}] ledger posting failed (non-fatal):`, e.message); }

        // ── سجل تدقيق تجاوزات الخصم/تخفيض السعر (معتمد تجاوز الحد) ──
        if (Array.isArray(totals.overrides) && totals.overrides.length) {
            try {
                await writeAuditLog({
                    action: 'PRICE_OVERRIDE',
                    tableName: 'pos_orders',
                    rowPk: orderId,
                    reason: `تجاوز حد الخصم/تخفيض السعر — ${totals.overrides.length} بند`,
                    metadata: {
                        overrides: totals.overrides,
                        max_discount_percent: SALE_DISCOUNT_MAX_PERCENT,
                        max_price_override_percent: SALE_PRICE_OVERRIDE_MAX_PERCENT,
                        total_amount: totals.total_amount,
                    },
                    actor: {
                        userId: cashier.id,
                        userName: cashier.username || cashier.name,
                        role: cashier.role,
                        ip: req.ip || (req.socket && req.socket.remoteAddress) || '',
                        requestId,
                    },
                });
            } catch (e) { logger.warn(`[${requestId}] discount-override audit failed (non-fatal):`, e.message); }
        }

        if (req.io) {try {
            const salePayload = {
                order_id: orderId,
                total: Number(orderRow.total_amount),
                cashier_id: cashier.id,
                cashier_name: cashier?.name || cashier?.username || null,
                department_id: req.body.department_id,
                department_name: dept?.name_ar || dept?.code || null,
                at: new Date().toISOString(),
            };
            // Targeted event, for any client that has joined this department's room
            // (e.g. a wall display dedicated to one cashier section).
            req.io.to(`dept:${req.body.department_id}`).emit('sale:completed', salePayload);
            // Global broadcast too — so ANY open screen (revenue dashboard, admin
            // view, other POS stations) hears/sees the sale immediately, without
            // requiring every client to remember to join the department room.
            req.io.emit('sale:completed', salePayload);

            // Notify main ERP (app.js) screens to reload state (revenues dashboard, etc.)
            req.io.emit('state_updated', {
                updatedAt: new Date().toISOString(),
                updatedBy: `POS:${cashier?.name || cashier?.username || cashier?.id}`,
                source: 'pos_sale',
                sale: salePayload,
            });
        } catch (e) { logger.warn(`[${requestId}] socket broadcast failed (non-fatal, sale committed): ${e.message}`); }}

        const durationMs = Date.now() - startedAt;
        if (durationMs > 200) {logger.warn(`[${requestId}] ⚠ p95 breach: complete-sale took ${durationMs}ms`);}

        return res.status(201).json(responsePayload);
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK;'); } catch (_) { logger.warn("complete-sale non-fatal:", _ && _.message ? _.message : _); } }
        // ── Transient saturation retry (bounded, exactly-once) ──────────
        // Under heavy bursts, queued transactions can hit statement_timeout
        // (57014), deadlock (40P01) or pool-checkout timeout. The transaction
        // above already rolled back; the idempotency-key reservation rolled
        // back with it, so re-running this same request is safe and cannot
        // double-post. Business errors (409/422/404) never match: they carry
        // custom codes and return directly below.
        if (isTransientSaleError(err) && (req._saleAttempt || 0) < 2) {
            req._saleAttempt = (req._saleAttempt || 0) + 1;
            const waitMs = 150 * Math.pow(2, req._saleAttempt) + Math.floor(Math.random() * 150);
            logger.warn(`[${requestId}] transient sale error (${err.code || err.message}) — retry ${req._saleAttempt}/2 in ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            return completeSale(req, res);
        }
        const code = err.code || err.sqlState;

        if (code === '23505') {return res.status(409).json({ error: 'DUPLICATE', message: err.message, _request_id: requestId });}
        if (err.code === 'PRICE_OVERRIDE_FORBIDDEN') {return res.status(422).json({ error: 'PRICE_OVERRIDE_FORBIDDEN', message: err.message, _request_id: requestId });}
        if (err.code === 'DISCOUNT_APPROVAL_REQUIRED') {return res.status(403).json({ error: 'DISCOUNT_APPROVAL_REQUIRED', message: err.message, _request_id: requestId });}
        if (err.code === 'INSUFFICIENT_STOCK' || code === '23514') {return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: err.message, _request_id: requestId });}
        if (err.code === 'UNDERPAYMENT') {return res.status(422).json({ error: 'UNDERPAYMENT', message: err.message, _request_id: requestId });}
        if (err.code === 'PRODUCT_NOT_FOUND') {return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: err.message, _request_id: requestId });}
        if (code === '40001' || code === '40P01') {return res.status(409).json({ error: 'CONCURRENCY_CONFLICT', message: 'Please retry.', _request_id: requestId });}

        logger.error({
            err: {
                message: err?.message,
                code: err?.code,
                sqlState: err?.sqlState,
                detail: err?.detail,
                constraint: err?.constraint,
                table: err?.table,
                column: err?.column,
                stack: err?.stack,
            },
            requestId,
            appVersion: process.env.APP_VERSION || '3.1.0',
        }, 'complete-sale failed');
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: process.env.NODE_ENV === 'production' ? undefined : err.message,
            _request_id: requestId,
        });
    } finally {
        if (client) {client.release();}
        releaseSaleSlot();
    }
}

function register(app) {
    app.post('/api/sales/complete',
        jwtAuth,
        requireRole('cashier', 'manager', 'admin'),
        completeSale
    );
}

module.exports = { register, completeSale, validateSalePayload, computeTotalsServerSide, appendLegacyRevenueMirror, syncErpRevenueFromPosSale, resolveRecipeStockAvailability };
