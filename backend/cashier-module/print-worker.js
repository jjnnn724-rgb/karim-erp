/**
 * print-worker.js — Drains pos_pending_prints to thermal printers with
 * exponential backoff. Run as: `node backend/cashier-module/print-worker.js`
 */

const net = require('net');
const { logger } = require("../logger");
const { spawn } = require('child_process');
const { pool } = require('./db-pool');
const { pickPrinterForJob, kindOfPrinterId } = require('./printer-logic');

// أخطاء اتصال الشبكة التي تعني أن الطابعة غير متاحة فعلاً (لا خطأ إعدادات)
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND']);

const POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

async function pollAndPrint() {
    const client = await pool.connect();
    try {
        // Reclaim jobs stranded in 'printing' by a crash between claim and completion
        await client.query(
            `UPDATE pos_pending_prints SET status='failed',
                last_error=COALESCE(last_error,'Reclaimed stale printing job')
              WHERE status='printing' AND next_retry_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes';`
        );
        const claimRes = await client.query(
            `UPDATE pos_pending_prints
                SET status='printing', attempts=attempts+1
              WHERE id IN (
                SELECT id FROM pos_pending_prints
                 WHERE status IN ('pending','failed')
                   AND next_retry_at <= CURRENT_TIMESTAMP
                   AND attempts < $1
                 ORDER BY next_retry_at LIMIT 10 FOR UPDATE SKIP LOCKED
              )
              RETURNING id, order_id, printer_id, payload, attempts;`,
            [MAX_ATTEMPTS]
        );
        for (const job of claimRes.rows) {await attemptPrint(client, job);}

        await client.query(
            `UPDATE pos_pending_prints SET status='abandoned',
                last_error=COALESCE(last_error,'Max attempts reached')
              WHERE status='failed' AND attempts >= $1 AND next_retry_at <= CURRENT_TIMESTAMP;`,
            [MAX_ATTEMPTS]
        );
    } finally {
        client.release();
    }
}

async function attemptPrint(client, job) {
    // قاعدة الطابعات صغيرة — نحملها كاملة ليعمل التراجع الذكي (Task 36):
    // المطلوب بالمعرف إن كان متصلًا، وإلا أول طابعة متصلة من نفس kind.
    const printerRes = await client.query(`SELECT * FROM pos_printers;`);
    const chosen = pickPrinterForJob(printerRes.rows, job.printer_id);
    if (!chosen) {
        return markPrintFailed(
            client, job.id,
            `لا توجد طابعة متاحة للمهمة ${job.printer_id} — سجّل طابعة ${kindOfPrinterId(job.printer_id) === 'kot' ? 'للمطبخ' : 'للإيصالات'} وفعّلها من إعدادات الطابعات`,
            job.attempts
        );
    }
    const printer = chosen.printer;
    if (chosen.fallback) {
        // نثبت الطابعة الفعلية على المهمة — أثر التدقيق يطابق ما طُبع عليه
        await client.query(`UPDATE pos_pending_prints SET printer_id = $2 WHERE id = $1;`, [job.id, printer.id]);
        logger.warn(`[print-worker] تراجع: المهمة ${job.id} (${job.printer_id} غير متاحة) → ${printer.id}`);
        job.printer_id = printer.id;
    }
    try {
        await sendToPrinter(printer, job.payload);
        await client.query(`UPDATE pos_pending_prints SET status='printed', completed_at=CURRENT_TIMESTAMP WHERE id=$1;`, [job.id]);
        // شفاء ذاتي: نجاح الإرسال يرفع حالة الاتصال ويحدّث آخر ظهور
        await client.query(
            `UPDATE pos_printers SET is_online = true, last_seen_at = CURRENT_TIMESTAMP WHERE id = $1;`,
            [printer.id]
        );
        logger.info(`[print-worker] ✓ job ${job.id} on ${printer.id}`);
    } catch (err) {
        // فشل اتصال شبكي حقيقي يهبط حالة الطابعة (خطأ الإعدادات لا يغيّرها)
        const isConnErr = printer.connection_type === 'network'
            && (CONNECTION_ERROR_CODES.has(err.code) || err.message === 'Printer timeout');
        if (isConnErr) {
            await client.query(
                `UPDATE pos_printers SET is_online = false WHERE id = $1;`,
                [printer.id]
            );
        }
        await markPrintFailed(client, job.id, err.message, job.attempts);
    }
}

async function markPrintFailed(client, jobId, errorMsg, attempts = 1) {
    // Exponential backoff keyed on the job's attempt count (the old call used
    // Math.pow(2, 0) — a constant 2s retry for all 8 attempts)
    const backoffMs = Math.min(2_000 * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
    await client.query(
        `UPDATE pos_pending_prints SET status='failed', last_error=$2,
            next_retry_at=CURRENT_TIMESTAMP + (INTERVAL '1 millisecond' * $3)
          WHERE id=$1;`,
        [jobId, errorMsg, backoffMs]
    );
    logger.warn(`[print-worker] ✗ job ${jobId}: ${errorMsg} (retry in ${backoffMs}ms)`);
}

async function sendToPrinter(printer, payloadBuffer) {
    if (printer.connection_type === 'network') {
        const [host, port] = (printer.address || '').split(':');
        if (!host) { throw new Error('Missing printer address'); }
        const socket = new net.Socket();
        socket.setTimeout(5_000);
        return new Promise((resolve, reject) => {
            socket.on('connect', () => {
                socket.write(Buffer.from(payloadBuffer), (err) => {
                    if (err) { socket.destroy(); return reject(err); }
                    socket.end(); resolve();
                });
            });
            socket.on('timeout', () => { socket.destroy(); reject(new Error('Printer timeout')); });
            socket.on('error', reject);
            socket.connect(parseInt(port || '9100', 10), host);
        });
    } else if (printer.connection_type === 'windows_share') {
        const [server, share] = (printer.address || '').split('/');
        if (!server || !share) { throw new Error('Bad share (expected server/share)'); }
        // كتابة RAW مباشرة للمشاركة (بدون lpr — غير مثبت غالبًا) ثم التراجع لـ lpr
        const unc = `\\\\${server}\\${share}`;
        const fs = require('fs');
        const data = Buffer.from(payloadBuffer);
        const tryUnc = () => new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Printer share timeout')), 15000);
            fs.writeFile(unc, data, (err) => {
                clearTimeout(timer);
                if (err) {rej(err);}
                else {res();}
            });
        });
        try {
            await tryUnc();
            return;
        } catch (uncErr) {
            // تراجع: lpr إن وُجد
            try {
                await new Promise((res, rej) => {
                    const lpr = spawn('lpr', ['-S', server, '-P', share], { stdio: ['pipe', 'ignore', 'pipe'] });
                    lpr.on('error', rej);
                    lpr.stdin.on('error', rej);
                    lpr.stdin.write(data);
                    lpr.stdin.end();
                    lpr.on('exit', (code) => code === 0 ? res() : rej(new Error(`lpr exit ${code}`)));
                });
                return;
            } catch (_) { /* سقط الاثنان — أرجع خطأ UNC الأوضح */ }
            const err = new Error(`تعذر الوصول للمشاركة ${unc}: ${uncErr.message}`);
            err.cause = uncErr;
            throw err;
}
        } else if (printer.connection_type === 'usb') {
            throw new Error('USB printing requires escpos-usb package');
        } else {
            throw new Error(`Unsupported: ${printer.connection_type}`);
        }
}

if (require.main === module) {
    logger.info('[print-worker] 🖨 started, polling every 2s');
    const timer = setInterval(() => {
        pollAndPrint().catch(err => logger.error('[print-worker] poll error:', err.message));
    }, POLL_INTERVAL_MS);

    async function shutdown(signal) {
        logger.info(`[print-worker] received ${signal}, stopping...`);
        clearInterval(timer);
        await pool.end();
        process.exit(0);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { pollAndPrint, attemptPrint, sendToPrinter, markPrintFailed };
