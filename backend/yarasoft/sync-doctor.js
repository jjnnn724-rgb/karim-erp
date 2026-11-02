/**
 * yarasoft/sync-doctor.js — محرك المزامنة الذكي (لحاق تلقائي + كشف الفجوات)
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة: السحب الدوري يغطي آخر 3 أيام فقط — لو الجهاز اتقفل يومًا أو أكثر،
 * فواتير تقع خارج النافذة ولا تُسحب أبدًا.
 *
 * الحل:
 *  1) reconcile(days): يقارن عدّادات Oracle لكل يوم بعدّادات الإيرادات المحلية
 *     ويكشف الأيام الناقصة (تقرير فجوات).
 *  2) catchUp(days): يسحب النوافذ الناقصة فقط (مقارنة ذكية قبل السحب)، مقسمة
 *     لمقاطع 7 أيام، والاستهلاك idempotent — الآمن إعادة تشغيله دائمًا.
 *  3) bootCatchUp(io): يعمل تلقائيًا بعد إقلاع السيرفر بـ 60 ثانية في الخلفية
 *     (YARASOFT_CATCHUP_DAYS، الافتراضي 14) — الجهاز لو اتقفل واشتغل، يلحق كل
 *     اللي فات لوحده بلا أي زر.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { loadOracleConfig, getDriver, oraExecute } = require('./oracle-link');

const isoDay = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return isoDay(x);
};
const todayLocal = () => isoDay(new Date());

function catchupDays() {
    return Math.max(1, Math.min(90, Number(process.env.YARASOFT_CATCHUP_DAYS) || 14));
}

async function oraConnect() {
    const cfg = loadOracleConfig();
    // Thick mode إلزامي: خادم يارسوفت لا تدعمه node-oracledb Thin (NJS-138)
    const oracledb = getDriver();
    const conn = await oracledb.getConnection({
        user: (process.env.YARASOFT_ORACLE_USER || '').trim(),
        password: process.env.YARASOFT_ORACLE_PASSWORD || '',
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
        connectTimeout: 20,
    });
    return { conn, cfg };
}

/** عدّادات Oracle لكل يوم في [fromDay, toDay) — فواتير CC + BILLS4 */
// عدّ بمستند واحد وبمرشّح المبلغ الموجب: المستهلِك يرفض NET_VAL<=0 ولا يسجّله أبدًا،
// فعدّها كان يُبقي كل نافذة «ناقصة» للأبد ويعيد سحبها كاملة كل دورة (مخلفات staging).
async function oracleDailyCounts(fromDay, toDay) {
    const { conn } = await oraConnect();
    try {
        const oracledb = require('oracledb');
        const r = await oraExecute(conn, `
            SELECT TO_CHAR(DOC_DATE, 'YYYY-MM-DD') AS DAY, 'CC' AS SRC
                 , COUNT(DISTINCT CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN DOC_NO END) AS CNT
                 , SUM(CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN NET_VAL END) AS TOTAL
              FROM CC_BILLS3 WHERE DOC_DATE >= TO_DATE(:fromDay, 'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:toDay, 'YYYY-MM-DD') AND PSTD = 'Y' AND TRIM(CSHR_NO) <> '2'
             GROUP BY TO_CHAR(DOC_DATE, 'YYYY-MM-DD')
            UNION ALL
            SELECT TO_CHAR(DOC_DATE, 'YYYY-MM-DD') AS DAY, 'BILLS4' AS SRC
                 , COUNT(DISTINCT CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN DOC_NO END) AS CNT
                 , SUM(CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN NET_VAL END) AS TOTAL
              FROM BILLS4 WHERE DOC_DATE >= TO_DATE(:fromDay, 'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:toDay, 'YYYY-MM-DD') AND PSTD = 'Y'
             GROUP BY TO_CHAR(DOC_DATE, 'YYYY-MM-DD')`,
            { fromDay, toDay }, { outFormat: oracledb.OBJECT });
        return r.rows || [];
    } finally { try { await conn.close(); } catch (_) {} }
}

/** عدّاداتنا المحلية لكل يوم من مرجع ora */
async function localDailyCounts(fromDay, toDay) {
    const r = await pool.query(`
        SELECT date AS day, COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0)::float AS total
          FROM revenues WHERE external_ref LIKE 'ora:%' AND date >= $1 AND date < $2 GROUP BY date`, [fromDay, toDay]);
    return r.rows;
}

/** تقرير الفجوات لآخر N يوم */
async function reconcile(days) {
    const n = Math.max(1, Math.min(90, Number(days) || catchupDays()));
    const toDay = addDays(todayLocal(), 1);
    const fromDay = addDays(todayLocal(), 1 - n);
    const [ora, local] = await Promise.all([
        oracleDailyCounts(fromDay, toDay).catch((e) => { throw new Error('ORACLE_UNREACHABLE: ' + String(e.message).slice(0, 150)); }),
        localDailyCounts(fromDay, toDay),
    ]);
    const byDay = new Map();
    for (let i = 0; i < n; i++) {
        const day = addDays(fromDay, i);
        byDay.set(day, { day, ora_cc: 0, ora_cc_total: 0, ora_b4: 0, ora_b4_total: 0, local_count: 0, local_total: 0 });
    }
    for (const r of ora) {
        const d = byDay.get(String(r.DAY).slice(0, 10));
        if (!d) {continue;}
        if (String(r.SRC).toUpperCase() === 'CC') { d.ora_cc = Number(r.CNT || 0); d.ora_cc_total = Number(r.TOTAL || 0); }
        else { d.ora_b4 = Number(r.CNT || 0); d.ora_b4_total = Number(r.TOTAL || 0); }
    }
    for (const r of local) {
        const d = byDay.get(String(r.day).slice(0, 10));
        if (!d) {continue;}
        d.local_count = Number(r.cnt || 0); d.local_total = Number(r.total || 0);
    }
    const rows = [...byDay.values()].reverse().map((d) => {
        const oraAll = d.ora_cc + d.ora_b4;
        return { ...d, status: d.local_count + 2 >= oraAll ? 'ok' : 'missing' };
    });
    const tOra = rows.reduce((s, r) => s + r.ora_cc + r.ora_b4, 0);
    const tLocal = rows.reduce((s, r) => s + r.local_count, 0);
    return { ok: true, fromDay, toDay, days: n, rows, missingDays: rows.filter((r) => r.status === 'missing').map((r) => r.day), totalOra: tOra, totalLocal: tLocal, overall: tLocal + n * 2 >= tOra ? 'ok' : 'missing' };
}

const job = { running: false, startedAt: null, finishedAt: null, totalPosted: 0, totalDups: 0, chunks: [], error: '' };

/** سحب نافذة [fromDay, toDay) بنفس استعلام السحب مع استبدال حد التاريخ */
async function pullWindow(fromDay, toDay, label) {
    const cfg = loadOracleConfig();
    if (!cfg.enabled || !cfg.invoiceSql) {return { skipped: true };}
    const sql = cfg.invoiceSql.split('b.DOC_DATE >= TRUNC(SYSDATE) - 3').join(
        `(b.DOC_DATE >= TO_DATE('${fromDay}','YYYY-MM-DD') AND b.DOC_DATE < TO_DATE('${toDay}','YYYY-MM-DD'))`);
    const { conn } = await oraConnect();
    try {
        const oracledb = require('oracledb');
        const r = await oraExecute(conn, sql, {}, { outFormat: oracledb.OBJECT });
        const rows = r.rows || [];
        if (rows.length && cfg.stagingDir) {
            fs.mkdirSync(cfg.stagingDir, { recursive: true });
            const fname = `ys_ora_catchup_${label}_${Date.now()}.json`;
            fs.writeFileSync(path.join(cfg.stagingDir, fname),
                JSON.stringify({ source: 'yarasoft_catchup', window: [fromDay, toDay], pulledAt: new Date().toISOString(), rows }));
        }
        return { ok: true, rows: rows.length };
    } finally { try { await conn.close(); } catch (_) {} }
}

/** لحاق ذكي: يقارن كل مقطع ويتخطى المغطى، ويسحب الناقص فقط */
async function catchUp(days, io) {
    if (job.running) {return { ok: false, error: 'ALREADY_RUNNING', job: jobStatus() };}
    const n = Math.max(1, Math.min(90, Number(days) || catchupDays()));
    job.running = true; job.startedAt = new Date().toISOString();
    job.finishedAt = null; job.error = ''; job.totalPosted = 0; job.totalDups = 0; job.chunks = [];
    const emit = (ev, data) => { try { if (io) {io.emit(ev, data);} } catch (_) {} };
    try {
        const CH = 7;
        for (let end = 0; end < n; end += CH) {
            const toDay = addDays(todayLocal(), 1 - end);
            const fromDay = addDays(todayLocal(), 1 - Math.min(n, end + CH));
            // مقارنة ذكية: عدّاد Oracle مقابل عدّادنا في المقطع
            const { conn } = await oraConnect();
            let oraCnt = 0;
            try {
                const oracledb = require('oracledb');
                const c1 = await oraExecute(conn, `SELECT COUNT(DISTINCT CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN DOC_NO END) AS C FROM CC_BILLS3 WHERE DOC_DATE >= TO_DATE(:f,'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:t,'YYYY-MM-DD') AND PSTD='Y' AND TRIM(CSHR_NO) <> '2'`, { f: fromDay, t: toDay }, { outFormat: oracledb.OBJECT });
                const c2 = await oraExecute(conn, `SELECT COUNT(DISTINCT CASE WHEN COALESCE(NET_VAL, TOTAL_VAL, 0) > 0 THEN DOC_NO END) AS C FROM BILLS4 WHERE DOC_DATE >= TO_DATE(:f,'YYYY-MM-DD') AND DOC_DATE < TO_DATE(:t,'YYYY-MM-DD') AND PSTD='Y'`, { f: fromDay, t: toDay }, { outFormat: oracledb.OBJECT });
                oraCnt = Number(c1.rows?.[0]?.C || 0) + Number(c2.rows?.[0]?.C || 0);
            } finally { try { await conn.close(); } catch (_) {} }
            const loc = (await pool.query(
                `SELECT COUNT(*)::int AS c FROM revenues WHERE external_ref LIKE 'ora:%' AND date >= $1 AND date < $2`, [fromDay, toDay])).rows[0].c;
            if (loc + 2 >= oraCnt) {
                job.chunks.push({ fromDay, toDay, skipped: true, ora: oraCnt, local: loc });
                continue;
            }
            await pullWindow(fromDay, toDay, `${fromDay}_${toDay}`);
            const { consumeAllPending } = require('./oracle-consume');
            const c = await consumeAllPending({ io });
            let done = 0, dups = 0;
            for (const x of (c.results || [])) { done += (x.completed || 0); dups += (x.duplicates || 0); }
            job.totalPosted += done; job.totalDups += dups;
            job.chunks.push({ fromDay, toDay, skipped: false, ora: oraCnt, local: loc, posted: done, dups });
            emit('yarasoft:catchup-progress', { fromDay, toDay, posted: done, dups });
        }
        // BILLS4 بلا TO_FOR ولا كاشير تُستهلك ضمن نفس الملفات — لا خطوة إضافية
        job.finishedAt = new Date().toISOString();
        emit('yarasoft:catchup-done', { posted: job.totalPosted, dups: job.totalDups });
        logger.info(`[sync-doctor] catch-up done: ${job.totalPosted} posted, ${job.totalDups} dups, ${job.chunks.length} chunks`);
        return { ok: true, job: jobStatus() };
    } catch (e) {
        job.error = String(e.message).slice(0, 300);
        logger.error('[sync-doctor] catch-up failed: ' + job.error);
        return { ok: false, error: job.error, job: jobStatus() };
    } finally { job.running = false; }
}
function jobStatus() {
    return { running: job.running, startedAt: job.startedAt, finishedAt: job.finishedAt, posted: job.totalPosted, dups: job.totalDups, chunks: job.chunks, error: job.error };
}

/* ── استرداد الصفوف العالقة في PROCESSING ────────────────────────────────
   العامل قصير العمر بحارس 8 دقائق، وقد يُقتل بين حجز صف السجل وإتمام
   المعاملة (stage=DATABASE_TRANSACTION) — فيبقى عالقًا أبدًا: يظهر «معلّقًا»
   في /status، ويعترض إعادة استيراد فاتورته لأن الحجز يرفض معالجًا ثانيًا.
   الاسترداد يعيد بناء الفاتورة من payload المحفوظ ويعيد مسارها نفسه:
   حاجز external_ref داخل المعاملة ينهي الحالة كـ DUPLICATE إن كان الإيراد
   قد سُجّل فعلًا، فيُصحّح السجل بلا أي تكرار، ويُدخله إن كان ناقصًا. */
async function recoverStaleImports({ olderThanMinutes = 15, io = null } = {}) {
    const minutes = String(Math.max(1, Number(olderThanMinutes) || 15));
    const { rows: stale } = await pool.query(
        `UPDATE invoice_import_log SET updated_at = NOW()
          WHERE status = 'PROCESSING'
            AND updated_at < NOW() - ($1 || ' minutes')::interval
          RETURNING id, external_invoice_number, payload, file_hash, total_amount`,
        [minutes]);

    const out = { scanned: stale.length, recovered: 0, duplicates: 0, failed: 0, needsMapping: 0 };
    if (!stale.length) {return out;}

    const crypto = require('crypto');
    const { STATUS, processOneInvoice } = require('./importer');
    const { resolveSection, bumpUnmappedAmount } = require('./section-resolver');
    const { loadConfig } = require('./config');
    const { liveConsume } = require('./oracle-consume');
    const baseConfig = loadConfig();
    const config = liveConsume() ? { ...baseConfig, dryRun: false } : baseConfig;

    /** @param {number} id @param {string} message */
    const markFailed = async (id, message) => {
        await pool.query(
            `UPDATE invoice_import_log SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1`,
            [id, STATUS.FAILED, String(message).slice(0, 500)]);
        out.failed++;
    };

    for (const row of stale) {
        // pg يحلّل jsonb إلى كائن أصلًا — لا نفترض نصًّا (JSON.parse يرمي).
        const rawPayload = row.payload;
        let saved = null;
        if (rawPayload) {
            try { saved = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload; }
            catch (_) { saved = null; }
        }
        const invoiceNumber = String(saved?.invoiceNumber || row.external_invoice_number || '').trim();

        /* 1) حاجز الإيراد المسجَّل يسبق كل شيء: إن كان مسجّلًا بأي بادئة
              (ora:/…/جهاز) فالسجل يحتاج تصحيح حالة فقط — لا إعادة معالجة
              تدخل بمرجع مختلف لو تغيّر اشتقاق الجهاز منذ آخر تشغيل. يعمل
              حتى لو فقدنا payload، فلا يبقى فاتورة مسجَّلة عالقة. */
        if (invoiceNumber) {
            const already = await pool.query(
                `SELECT id FROM revenues WHERE external_ref LIKE '%' || $1 LIMIT 1`,
                [invoiceNumber]);
            if (already.rows[0]) {
                await pool.query(
                    `UPDATE invoice_import_log SET status = $2, stage = $3, error_message = NULL, updated_at = NOW()
                      WHERE id = $1`,
                    [row.id, STATUS.COMPLETED, 'COMPLETED']);
                out.duplicates++;
                continue;
            }
        }

        /* 2) بلا بيانات قابلة للإعادة — يُعلَّم FAILED صريحًا لا يبقى معلقًا */
        if (!saved || !invoiceNumber) {
            await markFailed(row.id, 'انقطعت المعالجة قبل حفظ بيانات الفاتورة — أعد استيرادها من شاشة الاستيراد');
            continue;
        }
        const total = Number(saved.total);
        if (!Number.isFinite(total) || total <= 0) {
            await markFailed(row.id, `مبلغ غير صالح (${saved.total}) — لا يُعاد تلقائيًا`);
            continue;
        }
        try {
            const invoice = {
                key: invoiceNumber,
                invoiceNumber,
                srcTable: String(saved.srcTable || 'CC').toUpperCase(),
                sectionName: String(saved.sectionName || ''),
                date: String(saved.date || ''),
                customer: saved.customer ?? null,
                totals: { total },
                items: Array.isArray(saved.items) ? saved.items : [],
            };
            const hash = String(row.file_hash || '')
                || crypto.createHash('sha256').update(JSON.stringify(invoice)).digest('hex');
            const resolution = await resolveSection(invoice.srcTable, invoice.sectionName, invoice.date);
            if (resolution.unmapped) {
                await pool.query(
                    `UPDATE invoice_import_log SET status = $2, stage = $3, error_message = $4, updated_at = NOW()
                      WHERE id = $1`,
                    [row.id, STATUS.NEEDS_MAPPING, 'SECTION_MAPPING',
                        `قسم جديد يحتاج اعتماد: ${resolution.srcTable} / ${resolution.srcName}`]);
                await bumpUnmappedAmount(resolution.srcTable, resolution.srcName, total);
                out.needsMapping++;
                continue;
            }
            const res = await processOneInvoice({
                invoice, meta: { hash }, filePath: `oracle:${invoiceNumber}`,
                config, importer: null, logRow: row, io, started: Date.now(), device: resolution.device,
            });
            if (res.status === STATUS.COMPLETED) {out.recovered++;}
            else if (res.status === STATUS.DUPLICATE) {out.duplicates++;}
            else {out.failed++;}
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await markFailed(row.id, 'تعذّر الاسترداد: ' + msg.slice(0, 300));
            logger.error('[sync-doctor] recover failed: ' + msg);
        }
    }
    logger.info(`[sync-doctor] stale-log recovery: ${JSON.stringify(out)}`);
    return out;
}

/** لحاق تلقائي عند الإقلاع: لو الجهاز اتقفل واشتغل، يلحق كل اللي فات لوحده */
function bootCatchUp(io) {
    const cfg = loadOracleConfig();
    if (!cfg.enabled) {return;}
    setTimeout(() => {
        logger.info('[sync-doctor] boot catch-up starting...');
        catchUp(catchupDays(), io).catch((e) => logger.error('[sync-doctor] boot catch-up error: ' + e.message));
    }, 60_000).unref?.();
}

module.exports = { reconcile, catchUp, jobStatus, bootCatchUp, catchupDays, recoverStaleImports };
