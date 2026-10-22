/**
 * yarasoft/importer.js — خط معالجة الفواتير (Phases 5-10)
 * ────────────────────────────────────────────────────────────────────────────
 * DETECTED → WAITING_FOR_STABILITY → PROCESSING → PARSING → VALIDATING
 *          → PRODUCT_MAPPING → DATABASE_TRANSACTION → COMPLETED → ARCHIVED
 * فشل:     PROCESSING → RETRY (backoff) → FAILED
 * ازدواج:  DUPLICATE (بالهش/بالرقم/بمرجع الإيراد الفريد — ثلاث حواجز)
 * مراجعة:  REQUIRES_REVIEW (أصناف بلا مطابقة — لا استبدال أبدًا)
 * DRY_RUN: يقرأ ويحلل ويطابق ويعرض الحمولة — بلا أي كتابة أو حركة ملفات.
 *
 * المعاملة الذرية (Phase 8): إيراد + خصم مخزون + سجل استيراد في ACID واحدة؛
 * أي إخفاق → ROLLBACK كامل. لا حالة "فاتورة بلا خصم" أو العكس.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { postInventoryLedgerEntry } = require('../inventory-ledger');
const { parseInvoiceFile, ParseError } = require('./parser');
const { resolveItems } = require('./mapping');
const { deviceKeyFromPath, resolveDevice } = require('./config');
const files = require('./files');

// حالات السجل المسموحة (توثيق صريح — انظر docs/YARASOFT-INTEGRATION-AR.md)
const STATUS = {
    DETECTED: 'DETECTED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    DUPLICATE: 'DUPLICATE',
    FAILED: 'FAILED',
    REQUIRES_REVIEW: 'REQUIRES_REVIEW',
    NEEDS_MAPPING: 'NEEDS_MAPPING',
    DRY_RUN: 'DRY_RUN',
};

const STAGES = ['DETECTED', 'WAITING_FOR_STABILITY', 'PROCESSING', 'PARSING', 'VALIDATING',
    'PRODUCT_MAPPING', 'DATABASE_TRANSACTION', 'COMPLETED'];

function externalRefFor(sourceName, invoiceNumber, deviceKey = '') {
    // نطاق فريد لكل جهاز: نفس رقم الفاتورة على جهازين ≠ ازدواج
    const raw = String(deviceKey || sourceName || 'Yarasoft');
    let prefix = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!prefix) {prefix = `ys${Buffer.from(raw, 'utf8').toString('hex').slice(0, 8)}`;}
    return `${prefix}:${invoiceNumber}`.slice(0, 120);
}

function summarizeNotes(parsed, invoiceNumber) {
    const itemsText = (parsed.items || []).slice(0, 15)
        .map(it => `${it.name || it.externalCode || it.barcode || '?'}(${it.quantity})`)
        .join('، ');
    return [
        `[AUTO:YARASOFT]`,
        `invoice=${invoiceNumber}`,
        parsed.sectionName ? `sec=${parsed.sectionName}` : null,
        itemsText ? `items=${itemsText}` : null,
    ].filter(Boolean).join(' | ');
}

/**
 * تسجيل/جلب صف السجل لهذا الملف. يُنشئ صفًا عند أول رؤية (status DETECTED)
 * ثم يُرجع الصف دائمًا — الهش (SHA-256) هو المفتاح الفريد المستقر.
 */
async function upsertLogRow({ sourceFile, fileHash }) {
    const { rows } = await pool.query(
        `INSERT INTO invoice_import_log (source_file, file_hash, status, stage)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (file_hash) DO UPDATE
            SET source_file = EXCLUDED.source_file,
                updated_at = NOW()
         RETURNING *`,
        [sourceFile, fileHash, STATUS.DETECTED, STAGES[0]]
    );
    return rows[0];
}

async function setStage(logId, stage, extra = {}) {
    const keys = ['stage = $2', 'updated_at = NOW()'];
    const params = [logId, stage];
    for (const [k, v] of Object.entries(extra)) {
        params.push(v);
        keys.push(`"${k}" = $${params.length}`);
    }
    await pool.query(`UPDATE invoice_import_log SET ${keys.join(', ')} WHERE id = $1`, params);
}

/** حجز الملف للمعالجة (Phase 12: قفل ضد المعالجة المتزامنة لنفس الملف) */
async function claimForProcessing(logId) {
    const { rows } = await pool.query(
        `UPDATE invoice_import_log
            SET status = $2, stage = $3, updated_at = NOW()
          WHERE id = $1 AND status <> $2
          RETURNING *`,
        [logId, STATUS.PROCESSING, STAGES[1]]
    );
    return rows[0] || null; // null = يحوّله معالج آخر الآن
}

class ImportResult {
    constructor(status, extra = {}) {
        this.status = status;
        Object.assign(this, extra);
    }
}

/**
 * معالجة ملف فاتورة كاملًا. يُرمي فقط أخطاء غير متوقعة؛ النتائج المنطقية
 * (ازدواج/مراجعة/فشل صيغة) تُعاد ككائنات ImportResult مع تحديث السجل.
 */
async function processFile({ filePath, fileName, deviceKey = '', config, importer }) {
    const started = Date.now();
    const io = importer.io;
    // الجهاز صاحب الملف (مجلده الفرعي) — المصدر والقسم يُحلّان منه تلقائيًا
    const device = resolveDevice(config, deviceKey || deviceKeyFromPath(config, filePath));

    // ─── 1) الصبر على اكتمال كتابة الملف (Phase 4) قبل أي قراءة نهائية ───
    // (صف السجل يُنشأ بعد قراءة الهش المستقر فقط — لا صفوف وهمية بمفتاح PENDING)
    try {
        await files.waitForFileStability(filePath, {
            stabilityDelayMs: config.stabilityDelayMs,
            stabilityChecks: config.stabilityChecks,
        });
    } catch (error) {
        if (error instanceof files.FileNotStableError) {
            logger.warn(`[YARASOFT] ${error.message} — سيُعاد لاحقًا`);
            return new ImportResult('RETRY_LATER', { reason: error.reason });
        }
        if (files.isTransientError(error)) {throw error;} // شبكة — الدورة القادمة
        throw error;
    }

    const meta = await files.readFileWithMeta(filePath, { maxBytes: config.maxFileSizeMB * 1048576 });
    const logRow = await upsertLogRow({ sourceFile: filePath, fileHash: meta.hash });

    // فاتورة معلّمة REQUIRES_REVIEW: لا تُعالج حتى تُحل أصنافها كلها (منع تكرار سجلات المراجعة)
    if (logRow.status === STATUS.REQUIRES_REVIEW) {
        const open = await pool.query(
            `SELECT COUNT(*)::int AS c FROM yarasoft_review_items WHERE import_id = $1 AND resolved = false`,
            [logRow.id]);
        if (open.rows[0]?.c > 0) {
            return new ImportResult('REVIEW_PENDING', { logId: logRow.id, openItems: open.rows[0].c });
        }
        // حُلّت كل الأصناف (ربط يدوي جديد) — نظّف سجل المراجعة القديم وأكمل
        await pool.query(`DELETE FROM yarasoft_review_items WHERE import_id = $1`, [logRow.id]);
    }

    // ─── 2) الحواجز الثلاثة ضد الازدواج (Phase 5) ───
    if (['COMPLETED', 'DUPLICATE'].includes(logRow.status)) {
        await safeArchive(config, filePath, logRow, 'duplicate');
        return new ImportResult(STATUS.DUPLICATE, { logId: logRow.id, reason: 'هش مكرر' });
    }

    const claimed = await claimForProcessing(logRow.id);
    if (!claimed) {return new ImportResult('BUSY', { logId: logRow.id });}

    try {
        // ─── 3) التحليل (Phase 6: PARSING) ───
        await setStage(logRow.id, 'PARSING');
        let parsedBundle;
        try {
            parsedBundle = parseInvoiceFile(meta.text, importer.profile);
        } catch (error) {
            if (error instanceof ParseError) {
                await fail(logRow.id, `فشل التحليل: ${error.message}`, config, { final: false });
                return new ImportResult(STATUS.FAILED, { logId: logRow.id, reason: error.message });
            }
            throw error;
        }
        if (!parsedBundle.invoices.length) {
            await fail(logRow.id, 'الملف لا يحتوي فواتير قابلة للقراءة', config, { final: false });
            return new ImportResult(STATUS.FAILED, { logId: logRow.id });
        }

        const results = [];
        for (const invoice of parsedBundle.invoices) {
            results.push(await processOneInvoice({ invoice, meta, filePath, config, importer, logRow, io, started, device }));
        }
        // ملف بفاتورة واحدة هو الحال المعتادة؛ متعدد الفواتير ينجح إذا نجحت كلها
        const allDone = results.every(r => r.status === STATUS.COMPLETED || r.status === STATUS.DRY_RUN);
        const anyReview = results.some(r => r.status === STATUS.REQUIRES_REVIEW);
        const anyDup = results.some(r => r.status === STATUS.DUPLICATE);

        if (allDone) {
            if (results.some(r => r.status === STATUS.COMPLETED)) {
                await safeArchive(config, filePath, logRow, 'archive');
            }
            return results.length === 1 ? results[0] : new ImportResult(STATUS.COMPLETED, { results });
        }
        if (anyReview) {
            // انقل إلى مجلد المعالجة وينتظر حل الربط ثم إعادة المعالجة
            await safeMove(config, filePath, joinProcessing(config));
            return results.length === 1 ? results[0] : new ImportResult(STATUS.REQUIRES_REVIEW, { results });
        }
        if (anyDup && results.every(r => r.status === STATUS.DUPLICATE)) {
            await safeArchive(config, filePath, logRow, 'duplicate');
            return results.length === 1 ? results[0] : new ImportResult(STATUS.DUPLICATE, { results });
        }
        if (!allDone) {
            const firstFail = results.find(r => r.status === STATUS.FAILED);
            return firstFail || new ImportResult(STATUS.FAILED, { results });
        }
        return results.length === 1 ? results[0] : new ImportResult(STATUS.COMPLETED, { results });
    } catch (error) {
        if (files.isTransientError(error)) {
            // شبكة سقطت منتصف العمل — أعِد لاحقًا، لا تحسبها فشلًا نهائيًا
            await pool.query(
                `UPDATE invoice_import_log SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1`,
                [logRow.id, STATUS.DETECTED, `انقطاع شبكة مؤقت: ${error.message}`]
            ).catch(() => {});
            throw error;
        }
        logger.error(`[YARASOFT] خطأ غير متوقع أثناء معالجة ${fileName}:`, error.message);
        await fail(logRow.id, error.message, config, { final: true });
        await safeMove(config, filePath, joinFailed(config)).catch(() => {});
        return new ImportResult(STATUS.FAILED, { logId: logRow.id, reason: error.message });
    }
}

function joinProcessing(config) { return require('./config').joinShare(config, config.processingDir); }
function joinFailed(config) { return require('./config').joinShare(config, config.failedDir); }
function joinArchive(config) { return require('./config').joinShare(config, config.archiveDir); }

/** أرشفة/فشل بعد الالتزام فقط — أفضل جهد مع تتبع في السجل */
async function safeMove(config, fromPath, toDir) {
    try {
        const r = await files.moveFile(fromPath, toDir);
        logger.info(`[YARASOFT] نُقل الملف إلى ${r.to}`);
        return r;
    } catch (error) {
        logger.warn(`[YARASOFT] تعذر نقل ${fromPath} إلى ${toDir}: ${error.message} — سيُعاد في الدورة القادمة`);
        return null;
    }
}

async function safeArchive(config, filePath, logRow, kind) {
    const dir = kind === 'failed' ? joinFailed(config) : joinArchive(config);
    const r = await safeMove(config, filePath, dir);
    if (r) {
        await pool.query(
            `UPDATE invoice_import_log SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`, [logRow.id]
        ).catch(() => {});
    }
    return r;
}

async function fail(logId, message, config, { final }) {
    const { rows } = await pool.query(
        `UPDATE invoice_import_log
            SET retry_count = retry_count + 1,
                error_message = $2,
                status = $3,
                updated_at = NOW()
          WHERE id = $1
          RETURNING retry_count`,
        [logId, String(message).slice(0, 2000), final ? STATUS.FAILED : STATUS.DETECTED]
    );
    const retryCount = rows[0]?.retry_count || 1;
    if (final || retryCount >= config.maxRetries) {
        await pool.query(
            `UPDATE invoice_import_log SET status = $2, updated_at = NOW() WHERE id = $1`,
            [logId, STATUS.FAILED]
        );
    }
    logger.warn(`[YARASOFT] فشل معالجة (محاولة ${retryCount}/${config.maxRetries}): ${message}`);
    return retryCount;
}

/** معالجة فاتورة واحدة (من ملف قد يحوي أكثر من فاتورة) */
async function processOneInvoice({ invoice, meta, filePath, config, importer: _importer, logRow, io, started, device }) {
    const dev = device || { key: '', sourceName: config.sourceName, deptCode: config.defaultDeptCode };
    const invoiceNumber = String(invoice.invoiceNumber || '').trim()
        || `NO_${meta.hash.slice(0, 12)}`; // فاتورة بلا رقم: الهش هو هويتها
    const extRef = externalRefFor(dev.sourceName, invoiceNumber, dev.key);

    // ─── حاجز الرقم الخارجي ───
    const byExt = await pool.query(
        `SELECT id, status FROM invoice_import_log WHERE external_invoice_number = $1 AND file_hash <> $2 LIMIT 1`,
        [invoiceNumber, meta.hash]);
    if (byExt.rows[0]) {
        await pool.query(
            `UPDATE invoice_import_log SET status = $2, updated_at = NOW() WHERE id = $1`,
            [logRow.id, STATUS.DUPLICATE]);
        return new ImportResult(STATUS.DUPLICATE, { invoiceNumber, reason: 'رقم فاتورة مكرر' });
    }

    // ─── المطابقة (Phase 7) — تُتخطى في وضع الإجماليات (مصدر خارجي بمخزون منفصل) ───
    await setStage(logRow.id, 'PRODUCT_MAPPING');
    let resolved = new Map();
    if (!dev.totalsOnly) {
    const { resolved: res, unmapped } = await resolveItems(invoice.items || []);
    resolved = res;

    if (unmapped.length) {
        // لا استبدال تلقائي أبدًا — سجّل أصناف المراجعة وعلّم الفاتورة
        await pool.query(
            `INSERT INTO yarasoft_review_items (import_id, external_item_code, external_barcode, item_name, quantity, unit_price, reason)
             SELECT $1, x.code, x.barcode, x.name, x.qty, x.price, x.reason
             FROM UNNEST($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::text[])
                  AS x(code, barcode, name, qty, price, reason)`,
            [
                logRow.id,
                unmapped.map(u => u.externalItemCode),
                unmapped.map(u => u.externalBarcode),
                unmapped.map(u => u.itemName),
                unmapped.map(u => u.quantity),
                unmapped.map(_u => null),
                unmapped.map(u => u.reason),
            ]
        );
        await pool.query(
            `UPDATE invoice_import_log
                SET status = $2, stage = $3, external_invoice_number = $4, error_message = $5, updated_at = NOW()
              WHERE id = $1`,
            [logRow.id, STATUS.REQUIRES_REVIEW, 'PRODUCT_MAPPING',
                invoiceNumber,
                `${unmapped.length} صنفًا بلا مطابقة: ${unmapped.map(u => u.itemName || u.externalItemCode || u.externalBarcode).join('، ').slice(0, 500)}`]
        );
        if (io) {io.emit('yarasoft:review', { invoiceNumber, count: unmapped.length, items: unmapped });}
        return new ImportResult(STATUS.REQUIRES_REVIEW, { logId: logRow.id, invoiceNumber, unmapped });
    }
    } // نهاية وضع المطابقة الكاملة — وضع الإجماليات يتابع مباشرة للتحقق والترحيل

    // ─── التحقق (VALIDATING): الحساب يتطابق مع الإجمالي إن وُجد ───
    await setStage(logRow.id, 'VALIDATING');
    // اصطلاح قياسي: إجمالي السطر الموجود يشمل الخصم — يُستخدم كما هو
    const lineSum = (it) => (it.total !== null && it.total !== undefined)
        ? it.total
        : ((it.quantity || 0) * (it.unitPrice || 0)) - (it.discount || 0);
    const total = (invoice.totals && invoice.totals.total !== null && invoice.totals.total !== undefined)
        ? Number(invoice.totals.total)
        : Number((invoice.items || []).reduce((s, it) => s + lineSum(it), 0).toFixed(2));

    // ─── DRY_RUN (Phase 15): اعرض الحمولة فقط ───
    if (config.dryRun) {
        const payload = buildPayload({ invoice, invoiceNumber, extRef, resolved, total, config, device: dev });
        await pool.query(
            `UPDATE invoice_import_log
                SET status = $2, stage = $3, external_invoice_number = $4, items_count = $5,
                    total_amount = $6, payload = $7, error_message = $8, updated_at = NOW()
              WHERE id = $1`,
            [logRow.id, STATUS.DRY_RUN, 'VALIDATING', invoiceNumber, invoice.items.length,
                total, JSON.stringify(payload), 'DRY_RUN — لم تُكتب أي بيانات ولم يُحرَّك الملف']
        );
        logger.info(`[YARASOFT][DRY_RUN] فاتورة ${invoiceNumber}: ${invoice.items.length} صنفًا بإجمالي ${total}`);
        return new ImportResult(STATUS.DRY_RUN, { invoiceNumber, payload });
    }

    // ─── المعاملة الذرية (Phase 8) ───
    await setStage(logRow.id, 'DATABASE_TRANSACTION');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // حجز صف السجل داخل المعاملة (دفاع أخير ضد التزامن)
        const lock = await client.query(
            `SELECT id, status FROM invoice_import_log WHERE id = $1 FOR UPDATE`, [logRow.id]);
        if (lock.rows[0]?.status === STATUS.COMPLETED) {
            await client.query('ROLLBACK');
            return new ImportResult(STATUS.DUPLICATE, { invoiceNumber, reason: 'أُكملت للتو بمسار آخر' });
        }

        // حاجز revenues الفريد النهائي
        const revenueClash = await client.query(
            `SELECT id FROM revenues WHERE external_ref = $1 LIMIT 1`, [extRef]);
        if (revenueClash.rows[0]) {
            await client.query('ROLLBACK');
            await pool.query(
                `UPDATE invoice_import_log SET status = $2, updated_at = NOW() WHERE id = $1`,
                [logRow.id, STATUS.DUPLICATE]);
            return new ImportResult(STATUS.DUPLICATE, { invoiceNumber, reason: 'مرجع إيراد موجود' });
        }

        // القسم المستهدف (self-healing مثل POS: أنشئ القسم إن لم يوجد)
        // قسم الجهاز (مجلده) أو الافتراضي — يُنشأ تلقائيًا باسمه عند الحاجة
        const deptName = dev.deptCode === config.defaultDeptCode
            ? config.defaultDeptName
            : `مبيعات ${dev.sourceName}`;
        let dept = await client.query(`SELECT code FROM departments WHERE code = $1 LIMIT 1`, [dev.deptCode]);
        if (!dept.rows[0]) {
            const deptId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
            await client.query(
                `INSERT INTO departments (id, code, name, icon, color)
                 VALUES ($1, $2, $3, '🧾', '#8b6fc1')
                 ON CONFLICT (code) DO NOTHING`,
                [deptId, dev.deptCode, deptName]);
            dept = await client.query(`SELECT code FROM departments WHERE code = $1 LIMIT 1`, [dev.deptCode]);
        }

        // موقع المخزون الافتراضي (نفس منطق MAIN-WAREHOUSE في POS)
        let locationId = config.locationIdOverride;
        if (!locationId) {
            const loc = await client.query(
                `SELECT id FROM inventory_locations WHERE code = $1 AND active = true LIMIT 1`, [config.locationCode]);
            locationId = loc.rows[0]?.id || null;
            if (!locationId) {
                const anyLoc = await client.query(
                    `SELECT id FROM inventory_locations WHERE active = true ORDER BY id LIMIT 1`);
                locationId = anyLoc.rows[0]?.id || null;
            }
        }

        // الإيراد — المصدر = اسم جهاز الكاشير تلقائيًا
        const date = (invoice.date || new Date().toISOString()).slice(0, 10);
        const revenueId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        await client.query(
            `INSERT INTO revenues (id, "deptId", source, amount, date, notes, external_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                revenueId,
                dept.rows[0]?.code || dev.deptCode,
                dev.sourceName,
                total,
                date,
                summarizeNotes(invoice, invoiceNumber),
                extRef,
            ]
        );

        // خصم المخزون — يُتخطى لمصدر بمخزون منفصل (skipInventory) أو وضع الإجماليات
        if (!dev.skipInventory && !dev.totalsOnly) {
        let lineIdx = 0;
        for (const [idx, mapping] of resolved) {
            const it = invoice.items[idx];
            const qty = Math.abs(Number(it.quantity ?? 0));
            if (qty > 0) {
                if (!locationId) {throw new Error('NO_INVENTORY_LOCATION: لا يوجد موقع مخزون نشط — أضف MAIN-WAREHOUSE أو حدّد موقع الاستيراد في الإعدادات');}
                await postInventoryLedgerEntry(client, {
                    transactionType: 'sale_consumption',
                    inventoryId: mapping.inventoryId,
                    locationId: Number(locationId),
                    quantityDelta: -qty,
                    unit: it.unit || mapping.unit || undefined,
                    unitCost: it.unitPrice ?? undefined,
                    idempotencyKey: `yarasoft:${meta.hash}:${lineIdx}`,
                    referenceType: 'yarasoft_invoice',
                    referenceId: invoiceNumber,
                    businessDate: date,
                    reason: `استهلاك بيع الكاشير — فاتورة ${invoiceNumber}`,
                    metadata: { externalCode: it.externalCode, barcode: it.barcode, fileName: filePath },
                });
            }
            lineIdx++;
        }
        } // نهاية خصم المخزون (مُتخطى لوضع الإجماليات/المخزون المنفصل)

        // إتمام السجل داخل المعاملة نفسها (مع حفظ نسخة العرض)
        const duration = Date.now() - started;
        await client.query(
            `UPDATE invoice_import_log
                SET status = $2, stage = $3, external_invoice_number = $4,
                    items_count = $5, total_amount = $6, payload = $7,
                    processing_duration_ms = $8, processed_at = NOW(), updated_at = NOW(),
                    error_message = NULL
              WHERE id = $1`,
            [logRow.id, STATUS.COMPLETED, 'COMPLETED', invoiceNumber,
                invoice.items.length, total, JSON.stringify({ invoiceNumber, date, customer: invoice.customer || null, sectionName: invoice.sectionName || null, srcTable: invoice.srcTable || null, items: invoice.items || [], total }), duration]
        );

        await client.query('COMMIT');
        logger.info(`[YARASOFT] ✓ فاتورة ${invoiceNumber} [${dev.sourceName}]: ${invoice.items.length} صنفًا، ${total} — التزام في ${duration}ms`);
        // R3 (قرار المالك 2026-10-03): جسر الإيراد اللحظي للدفتر — بعد COMMIT
        // حصرًا وبأثر غير قاتل؛ أي فشل يلتقطه sweep دوري (gl-bridge).
        try {
            const { bridgeRevenueToGl } = require('./gl-bridge');
            await bridgeRevenueToGl(pool, { revenueId, source: dev.sourceName, amount: total, date });
        } catch (glError) {
            logger.warn(`[YARA-GL] تعذر الترحيل اللحظي لفاتورة ${invoiceNumber} (سيلتقطه sweep): ${glError.message}`);
        }
        if (io) {io.emit('yarasoft:imported', { invoiceNumber, total, items: invoice.items.length, source: dev.sourceName });}
        return new ImportResult(STATUS.COMPLETED, { invoiceNumber, total, duration });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (String(error.message).includes('INSUFFICIENT_STOCK')) {
            // مخزون لا يكفي: فشل قابل للإصلاح (زود المخزون ثم أعد المعالجة) — ليس نهائيًا
            await fail(logRow.id, `مخزون غير كافٍ: ${error.message}`, config, { final: false });
            return new ImportResult(STATUS.FAILED, { invoiceNumber, reason: 'مخزون غير كافٍ — أعد المعالجة بعد التزويد' });
        }
        throw error;
    } finally {
        client.release();
    }
}

function buildPayload({ invoice, invoiceNumber, extRef, resolved, total, config, device }) {
    const dev = device || { sourceName: config.sourceName, deptCode: config.defaultDeptCode };
    return {
        dryRun: true,
        invoiceNumber,
        externalRef: extRef,
        device: dev.key || null,
        source: dev.sourceName,
        date: invoice.date,
        customer: invoice.customer,
        paymentMethod: invoice.paymentMethod,
        department: dev.deptCode,
        total,
        revenue: { table: 'revenues', deptId: dev.deptCode, source: dev.sourceName, amount: total },
        inventory: [...resolved.entries()].map(([idx, m]) => ({
            item: invoice.items[idx],
            inventoryId: m.inventoryId,
            inventoryName: m.name,
            matchedVia: m.via,
            deduction: -Math.abs(Number(invoice.items[idx].quantity ?? 0)),
        })),
    };
}

module.exports = { STATUS, STAGES, processFile, processOneInvoice, upsertLogRow, externalRefFor };
