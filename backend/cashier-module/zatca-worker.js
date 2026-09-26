/**
 * zatca-worker.js — BullMQ worker for async ZATCA invoice submission.
 * Run as a separate process: `node backend/cashier-module/zatca-worker.js`
 *
 * If BullMQ is unavailable, runs in SQL-only polling mode (every 10s).
 */

const { pool } = require('./db-pool');
const { ZATCA_QUEUE_NAME, SKIP_BULLMQ } = require('./zatca-queue');
const axios = require('axios');
const { logger } = require("../logger");
const { reclaimStaleProcessing } = require('./zatca-reclaim');
const ZATCA_API_BASE = process.env.ZATCA_API_BASE || 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const zatcaHttpClient = axios.create({ timeout: 30_000 });

const MAX_ATTEMPTS = parseInt(process.env.ZATCA_MAX_ATTEMPTS || '10', 10);
const POLL_INTERVAL_MS = 10_000;
// If Redis never becomes ready (not installed, stopped, wrong URL), BullMQ
// mode would sit SILENTLY INERT — the queue freezes with no error anywhere.
// A production POS must not depend on remembering a flag: after this grace
// period without a ready connection, fall back to SQL polling automatically.
const BULLMQ_READY_TIMEOUT_MS = parseInt(process.env.BULLMQ_READY_TIMEOUT_MS || '8000', 10);

let worker = null;
let connection = null;
let sqlPollingStarted = false;
if (!SKIP_BULLMQ) {
    try {
        const { Worker } = require('bullmq');
        const IORedis = require('ioredis');
        const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
        connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
        // ioredis emits 'error' on unreachable servers — without a listener
        // Node throws an uncaught exception and the whole worker dies.
        connection.on('error', (e) => logger.warn(`[zatca-worker] redis connection error: ${e.message}`));

        worker = new Worker(ZATCA_QUEUE_NAME, async (job) => {
            const { orderId } = job.data;
            logger.info(`[zatca-worker] processing ${orderId} (attempt ${job.attemptsMade + 1}/${MAX_ATTEMPTS})`);
            return await submitInvoiceToZatca(orderId);
        }, {
            connection,
            concurrency: parseInt(process.env.ZATCA_WORKER_CONCURRENCY || '5', 10),
        });

        worker.on('completed', (job) => logger.info(`[zatca-worker] ✓ ${job.id} done`));
        worker.on('failed', (job, err) => logger.error(`[zatca-worker] ✗ ${job.id} failed:`, err.message));
        logger.info(`[zatca-worker] 🚀 BullMQ mode, concurrency=${process.env.ZATCA_WORKER_CONCURRENCY || 5}`);
    } catch (err) {
        logger.warn('[zatca-worker] BullMQ unavailable, switching to SQL polling:', err.message);
    }
}

// Load the integration config from the settings hub (single source of truth).
// Lazy require — zatca-settings-routes lazily requires this module too.
async function loadZatcaConfig() {
    try {
        const { ensureZatcaSchema } = require('./zatca-settings-routes');
        await ensureZatcaSchema();
        const { pool: p } = require('./db-pool');
        const res = await p.query(`SELECT * FROM zatca_settings WHERE id = 1;`);
        return res.rows[0] || null;
    } catch (e) {
        logger.warn('[zatca-worker] config load failed (continuing with env defaults):', e.message);
        return null;
    }
}

function resolveEndpoint(cfg) {
    const base = (cfg?.api_base
        || (cfg?.environment === 'simulation' ? 'https://gw-factoora.zatca.gov.sa/e-invoicing/simulation' : null)
        || (cfg?.environment === 'production' ? 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core' : null)
        || ZATCA_API_BASE).replace(/\/+$/, '');
    // Restaurant POS invoices are B2C simplified → REPORTING (not clearance).
    return `${base}/invoices/reporting/single`;
}

function zatcaHeaders(cfg) {
    const headers = {
        'accept': 'application/json',
        'accept-language': 'en',
        'Accept-Version': 'V2',
        'Content-Type': 'application/json',
    };
    if (cfg?.csid) {headers['Authorization'] = `Basic ${cfg.csid}`;}
    return headers;
}

function buildZatcaUblXml(order, items, payments, dept) {
    // Lightweight UBL-style payload with the real seller, lines and totals —
    // the earlier stub shipped an almost-empty <Invoice> and flipped the order
    // to 'reported', which is a compliance lie. NOTE: full Phase-2 clearance
    // still requires CSID/mutual-TLS + XML-DSig (see integration TODO below).
    const lines = items.map((it, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">${Number(it.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${Number(it.line_total).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${escapeXml(it.product_name)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">${Number(it.unit_price).toFixed(2)}</cbc:PriceAmount></cac:Price>
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${Number(it.vat_amount).toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  </cac:InvoiceLine>`).join('\n');
    // Only incoming payment rows belong in <PaymentMeans> — change given to the
    // customer (direction='out', payer_info.reason='change') and refunds are not
    // payment methods and would inflate the declared paid amounts.
    const inPayments = payments.filter(p => p.direction === 'in');
    const paymentMeans = inPayments.length ? inPayments.map(p => `  <cac:PaymentMeans><cbc:PaymentMeansCode>${p.method}</cbc:PaymentMeansCode><cbc:PaidAmount currencyID="SAR">${Number(p.amount).toFixed(2)}</cbc:PaidAmount></cac:PaymentMeans>`).join('\n') : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${order.invoice_counter}</cbc:ID>
  <cbc:UUID>${order.invoice_uuid}</cbc:UUID>
  <cbc:IssueDate>${new Date(order.created_at).toISOString().slice(0,10)}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party><cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(dept?.vat_number || '')}</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(dept?.name_ar || '')}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
${paymentMeans}
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${Number(order.tax_total).toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="SAR">${Number(order.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${Number(order.total_amount).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${Number(order.total_amount).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function submitInvoiceToZatca(orderId, config = null) {
    const client = await pool.connect();
    try {
        const cfg = config || await loadZatcaConfig();
        // The settings hub is the master switch. When the integration is OFF
        // nothing may be submitted and no attempt must be burned.
        if (!cfg || !cfg.enabled) {
            const err = new Error('ZATCA_DISABLED: الربط مع هيئة الزكاة موقوف من قائمة الضبط');
            err.code = 'ZATCA_DISABLED';
            throw err;
        }
        const orderRes = await client.query(
            `SELECT o.*, pd.name_ar AS dept_name, pd.vat_number AS dept_vat,
                    u.name AS cashier_name
               FROM pos_orders o
               JOIN pos_departments pd ON pd.id = o.department_id
               JOIN users u ON u.id = o.cashier_id
              WHERE o.id = $1;`,
            [orderId]
        );
        if (orderRes.rows.length === 0) {throw new Error(`Order ${orderId} not found`);}
        const order = orderRes.rows[0];

        // A voided invoice must NEVER reach the tax authority as a valid sale.
        // Previously the submitter ignored order.status and force-flipped even
        // 'cancelled' rows to 'reported'. Skip and mark the queue row instead.
        if (order.status === 'cancelled') {
            await client.query(
                `UPDATE pos_zatca_invoice_queue
                    SET status = 'skipped_cancelled', last_error = 'الفاتورة ملغاة قبل التقرير الضريبي — تم منع الإرسال',
                        next_retry_at = NULL
                  WHERE order_id = $1;`,
                [orderId]
            );
            return { skipped: true, reason: 'cancelled' };
        }

        const itemsRes    = await client.query(`SELECT * FROM pos_order_items WHERE order_id = $1;`,    [orderId]);
        const paymentsRes = await client.query(`SELECT * FROM pos_invoice_payments WHERE order_id = $1;`, [orderId]);

        const ublXml = buildZatcaUblXml(order, itemsRes.rows, paymentsRes.rows, {
            name_ar: order.dept_name, vat_number: order.dept_vat,
        });

        // Real Fatoora V2 reporting call — simplified (B2C) invoices.
        // No CSID → the call itself is expected to fail with an honest 401
        // instead of pretending success.
        const endpoint = resolveEndpoint(cfg);
        const response = await zatcaHttpClient.post(endpoint, {
            uuid: order.invoice_uuid,
            invoiceHash: order.invoice_hash,
            invoice: Buffer.from(ublXml).toString('base64'),
        }, { headers: zatcaHeaders(cfg), validateStatus: () => true });

        const body = response.data || {};
        const validation = body.validationResults || {};
        const hasErrors = validation.status === 'ERROR'
            || (Array.isArray(validation.errorMessages) && validation.errorMessages.length > 0);
        if (response.status >= 300 || hasErrors || !body.uuid) {
            let detail;
            if (response.status === 401) {detail = 'رفض التصريح — CSID غير صالح أو لا يطابق هذه البيئة';}
            else if (Array.isArray(validation.errorMessages) && validation.errorMessages.length)
                {detail = validation.errorMessages.map((e) => `${e.type || 'ERROR'} ${e.code || ''}: ${e.message || ''}`).join(' | ');}
            else if (response.status >= 500) {detail = 'خطأ في بوابة الهيئة (HTTP ' + response.status + ') — سيُعاد المحاولة تلقائيًا';}
            else {detail = JSON.stringify(body).slice(0, 400);}
            const err = new Error(`ZATCA HTTP ${response.status}: ${detail}`);
            err.code = 'ZATCA_REJECTED';
            err.httpStatus = response.status;
            throw err;
        }

        const zatcaUuid = body.uuid;
        const zatcaPih  = body.invoiceHash || body.pin;

        await client.query(
            `UPDATE pos_orders SET status='reported', zatca_reported_at=CURRENT_TIMESTAMP, zatca_pi_hmac=$2
              WHERE id=$1 AND status IN ('issued','failed');`,
            [orderId, zatcaPih]
        );
        await client.query(
            `UPDATE pos_zatca_invoice_queue
                SET status='reported', reported_at=CURRENT_TIMESTAMP, zatca_uuid=$2, zatca_pih=$3, last_error=NULL
              WHERE order_id=$1;`,
            [orderId, zatcaUuid, zatcaPih]
        );
        return { zatcaUuid, zatcaPih, invoiceStatus: body.invoiceStatus || 'REPORTED' };
    } finally {
        client.release();
    }
}

async function moveToDeadLetter(orderId, lastError) {
    const client = await pool.connect();
    try {
        // SET LOCAL throws outside a transaction block — use session-level
        // set_config so the audit row below is actually written.
        await client.query(`SELECT set_config('app.user_role', 'bg_worker', false);`);
        await client.query(
            `UPDATE pos_zatca_invoice_queue SET status='dead_letter', last_error=$2, next_retry_at=NULL WHERE order_id=$1;`,
            [orderId, lastError]
        );
        // Record the DLQ event honestly against the QUEUE table — the old code
        // wrote a 'VOID' audit row on pos_orders, poisoning the append-only
        // trail with a fake void for a perfectly valid sold order.
        await client.query(
            `INSERT INTO pos_audit_logs(action, table_name, row_pk, reason, metadata)
             VALUES ('UPDATE', 'pos_zatca_invoice_queue', $1, 'ZATCA dead-letter', $2::jsonb);`,
            [String(orderId), JSON.stringify({ error: lastError })]
        );
    } finally {
        client.release();
    }
}

// SQL-only fallback poller (standalone worker process mode)
async function pollSqlQueue() {
    const cfg = await loadZatcaConfig();
    const client = await pool.connect();
    try {
        // Crash recovery FIRST — deliberately independent of the master
        // switch (see zatca-reclaim.js): rows stranded by a crashed worker
        // must be released even when ZATCA is now disabled, otherwise a
        // disable-after-crash leaves them stuck in 'processing' forever.
        const reclaimed = await reclaimStaleProcessing(client);
        if (reclaimed > 0) {
            logger.warn(`[zatca-worker:poller] reclaimed ${reclaimed} stale 'processing' job(s) after crash`);
        }
        if (!cfg || !cfg.enabled) {return;} // master switch OFF → freeze (recovery already done)
        const claim = await client.query(
            `UPDATE pos_zatca_invoice_queue
                SET status='processing', attempts=attempts+1, last_attempt_at=CURRENT_TIMESTAMP
              WHERE id IN (
                SELECT id FROM pos_zatca_invoice_queue
                 WHERE status IN ('queued', 'failed') AND attempts < $1
                   AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
                 ORDER BY queued_at LIMIT 10 FOR UPDATE SKIP LOCKED
              )
              RETURNING order_id, attempts;`,
            [cfg.max_attempts || MAX_ATTEMPTS]
        );
        for (const job of claim.rows) {
            try {
                await submitInvoiceToZatca(job.order_id, cfg);
                logger.info(`[zatca-worker:poller] ✓ ${job.order_id}`);
            } catch (err) {
                if (err.code === 'ZATCA_DISABLED') {
                    await client.query(
                        `UPDATE pos_zatca_invoice_queue SET status='queued', next_retry_at=CURRENT_TIMESTAMP WHERE order_id=$1;`,
                        [job.order_id]
                    );
                    return; // switch was flipped mid-cycle — stop the whole batch
                }
                const maxAttempts = cfg.max_attempts || MAX_ATTEMPTS;
                const backoffMs = Math.min(2_000 * Math.pow(2, job.attempts), 5 * 60_000);
                await client.query(
                    `UPDATE pos_zatca_invoice_queue
                        SET status = CASE WHEN $2 >= $3 THEN 'dead_letter' ELSE 'failed' END::pos_zatca_status,
                            last_error = $4,
                            next_retry_at = CASE WHEN $2 < $3
                                THEN CURRENT_TIMESTAMP + (INTERVAL '1 millisecond' * $5)
                                ELSE NULL END
                      WHERE order_id = $1;`,
                    [job.order_id, job.attempts, maxAttempts, err.message, backoffMs]
                );
                if (job.attempts >= maxAttempts) {
                    await moveToDeadLetter(job.order_id, err.message);
                }
            }
        }
    } finally {
        client.release();
    }
}

// Start the standalone poller ONLY when this file is the entry process
// (`node zatca-worker.js`). When required as a library (e.g. by the settings
// hub's in-server poller) a second engine must not start inside the server.
function startSqlPolling() {
    if (sqlPollingStarted) {return;}
    sqlPollingStarted = true;
    logger.info(`[zatca-worker] 🚀 SQL polling mode, interval=${POLL_INTERVAL_MS}ms`);
    setInterval(() => { pollSqlQueue().catch(e => logger.error('[zatca-worker:poller]', e.message)); }, POLL_INTERVAL_MS);
}

if (!worker && require.main === module) {
    startSqlPolling();
} else if (require.main === module && connection) {
    // BullMQ mode selected — arm the readiness watchdog: if Redis is not
    // ready after the grace period, tear it down and fall back to SQL
    // polling instead of freezing silently.
    let redisReady = false;
    connection.once('ready', () => { redisReady = true; });
    const fallbackTimer = setTimeout(() => {
        if (redisReady || worker === null) {return;} // healthy, or already switched
        logger.warn(`[zatca-worker] Redis not ready after ${BULLMQ_READY_TIMEOUT_MS}ms — falling back to SQL polling`);
        try { if (worker) { worker.close().catch(() => {}); } } catch (_) {}
        try { if (connection) { connection.disconnect(); } } catch (_) {}
        worker = null;
        connection = null;
        startSqlPolling();
    }, BULLMQ_READY_TIMEOUT_MS);
    if (typeof fallbackTimer.unref === 'function') {fallbackTimer.unref();}
}

async function shutdown(signal) {
    logger.info(`[zatca-worker] received ${signal}, shutting down...`);
    if (worker) {await worker.close();}
    if (connection) {await connection.quit();}
    await pool.end();
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { worker, submitInvoiceToZatca, pollSqlQueue, reclaimStaleProcessing };
