/**
 * yarasoft/oracle-consume.js — ترحيل staging المسحوب من Oracle إلى إيرادات karim
 * ────────────────────────────────────────────────────────────────────────────
 * وضع "إجماليات": إيراد واحد لكل فاتورة يارسوفت (NET_VAL) بمصدر Yarasoft Oracle.
 *  - نفس idempotency خط الملفات: external_invoice_number + revenues.external_ref
 *    (مفتاح `ora:<TABLE>:<DOC_NO>` — يمنع أي تكرار مهما أُعيد التشغيل).
 *  - بلا خصم مخزون: مخزون يارسوفت منفصل عن مخزون karim (totalsOnly).
 *  - يحترم YARASOFT_ORACLE_LIVE: false = تسجيل DRY_RUN فقط (الافتراضي الآمن).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { loadConfig } = require('./config');
const { STATUS, processOneInvoice, upsertLogRow } = require('./importer');

function liveConsume() {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.YARASOFT_ORACLE_LIVE || 'false').trim().toLowerCase());
}

function isoDay(v) {
    // يوم الرياض المحلي — toISOString (UTC) كان يزيح فواتير منتصف الليل يومًا كاملًا للخلف
    try {
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) {throw new Error('bad date');}
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (_) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    }
}

/** تجميع سطور staging إلى فواتير {(SRC,DOC_NO) → header + lines} */
function groupStaged(rows) {
    const map = new Map();
    const skipped = [];
    for (const r of rows || []) {
        const docNo = r.DOC_NO != null ? String(r.DOC_NO).trim() : '';
        if (!docNo) { skipped.push(`سطر بلا رقم فاتورة (${String(r.SRC_TABLE || '?')})`); continue; }
        const srcTable = String(r.SRC_TABLE || 'BILLS').toUpperCase();
        const key = `${srcTable}:${docNo}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                invoiceNumber: key,
                srcTable,
                sectionName: r.TO_FOR_NM != null ? String(r.TO_FOR_NM).trim() : '',
                date: isoDay(r.DOC_DATE),
                customer: r.TO_FOR_NM || null,
                totals: { total: Number(r.NET_VAL ?? r.TOTAL_VAL ?? 0) },
                items: [],
            });
        }
        const inv = map.get(key);
        // سطور بلا صنف (فاتورة كاشير بلا تفاصيل سطور) تُتخطى — الإجمالي من الترويسة محفوظ
        if (r.ITM_NO == null && r.BAR_CODE == null && (r.OUT_QNT == null || Number(r.OUT_QNT) === 0)) {continue;}
        inv.items.push({
            externalCode: r.ITM_NO != null ? String(r.ITM_NO) : null,
            barcode: r.BAR_CODE != null ? String(r.BAR_CODE) : null,
            name: r.ITMNAME || null,
            quantity: Number(r.OUT_QNT ?? 0),
            unitPrice: Number(r.SALE_PRICE ?? 0),
            total: Number(r.LINE_TOTAL ?? 0),
        });
    }
    return { invoices: [...map.values()], skipped };
}

async function consumeStagingFile(filePath, { io = null } = {}) {
    const base = loadConfig();
    const config = liveConsume() ? { ...base, dryRun: false } : base;
    const { resolveSection, bumpUnmappedAmount } = require('./section-resolver');
    let bundle;
    try {
        bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return { ok: false, error: 'ملف staging غير صالح: ' + e.message };
    }
    const { invoices, skipped } = groupStaged(bundle.rows);
    const out = { file: path.basename(filePath), invoices: invoices.length, completed: 0, duplicates: 0, dryRuns: 0, needsMapping: 0, skipped: skipped.length, failed: 0, errors: [...skipped] };
    for (const inv of invoices) {
        // مبلغ غير صالح (صفر/سالب) لا يدخل الدفاتر — يُسجَّل سببًا ويُتخطى
        const invTotal = Number(inv.totals?.total);
        if (!Number.isFinite(invTotal) || invTotal <= 0) {
            out.skipped++;
            out.errors.push(`${inv.key}: مبلغ غير صالح (${inv.totals?.total}) — تُخطي`);
            continue;
        }
        try {
            const hash = crypto.createHash('sha256').update(JSON.stringify(inv)).digest('hex');
            const logRow = await upsertLogRow({ sourceFile: `ora:${inv.key}`, fileHash: hash });
            if (logRow.status === STATUS.COMPLETED) { out.duplicates++; continue; }
            if (logRow.status === STATUS.NEEDS_MAPPING) { out.needsMapping++; continue; }
            // ─── التصنيف الذكي: القسم من (الجدول + اسم الجهة) ───
            const resolution = await resolveSection(inv.srcTable, inv.sectionName, inv.date);
            if (resolution.unmapped) {
                await pool.query(
                    `UPDATE invoice_import_log SET status = $2, stage = $3, external_invoice_number = $4,
                        items_count = $5, total_amount = $6, payload = $7, error_message = $8, updated_at = NOW()
                     WHERE id = $1`,
                    [logRow.id, STATUS.NEEDS_MAPPING, 'SECTION_MAPPING', inv.key, inv.items.length,
                        Number(inv.totals?.total) || 0, JSON.stringify(inv),
                        `قسم جديد يحتاج اعتماد: ${resolution.srcTable} / ${resolution.srcName}`]
                );
                await bumpUnmappedAmount(resolution.srcTable, resolution.srcName, inv.totals?.total);
                out.needsMapping++;
                if (io) {io.emit('yarasoft:needs-mapping', { invoiceNumber: inv.key, section: resolution.srcName });}
                continue;
            }
            const device = resolution.device;
            // حجز المعالجة (نفس منطق claimForProcessing — ضد التزامن)
            const claimed = (await pool.query(
                `UPDATE invoice_import_log SET status = $2, stage = $3, updated_at = NOW()
                  WHERE id = $1 AND status <> $2 RETURNING *`,
                [logRow.id, STATUS.PROCESSING, 'PROCESSING'])).rows[0];
            if (!claimed) { out.duplicates++; continue; }
            const res = await processOneInvoice({
                invoice: inv, meta: { hash }, filePath: `oracle:${inv.key}`,
                config, importer: null, logRow: claimed, io, started: Date.now(), device,
            });
            if (res.status === STATUS.COMPLETED) {out.completed++;}
            else if (res.status === STATUS.DUPLICATE) {out.duplicates++;}
            else if (res.status === STATUS.DRY_RUN) {out.dryRuns++;}
            else { out.failed++; out.errors.push(`${inv.key}: ${res.reason || res.status}`); }
        } catch (e) {
            out.failed++;
            out.errors.push(`${inv.key}: ${String(e.message).slice(0, 160)}`);
            logger.error('[yarasoft_oracle_consume]', e.message);
        }
    }
    // أرشفة الملف المستهلك (لا يُعاد قراءته)
    try { fs.renameSync(filePath, filePath + '.done'); } catch (_) {}
    return { ok: true, ...out };
}

/** استهلاك كل ملفات staging المعلقة — يُستدعى بعد كل سحب دوري */
async function consumeAllPending(opts = {}) {
    const cfg = loadConfig();
    const { loadOracleConfig } = require('./oracle-link');
    const dir = loadOracleConfig().stagingDir;
    if (!dir || !fs.existsSync(dir)) {return { ok: true, files: 0, results: [] };}
    const files = fs.readdirSync(dir).filter(f => f.startsWith('ys_ora_') && f.endsWith('.json')).sort();
    const results = [];
    for (const f of files) {
        results.push(await consumeStagingFile(path.join(dir, f), opts));
    }
    void cfg;
    return { ok: true, files: files.length, results };
}

module.exports = { consumeStagingFile, consumeAllPending, liveConsume };
