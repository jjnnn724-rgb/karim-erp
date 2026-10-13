/**
 * yarasoft/routes.js — مسارات API لتكامل Yarasoft (RBAC كما في بقية النظام)
 * ────────────────────────────────────────────────────────────────────────────
 * GET    /status               حالة المحرك والمشاركة والمقاييس   (admin/manager/auditor)
 * GET    /log                  سجل الاستيراد                     (admin/manager/auditor)
 * POST   /run-now              دورة فورية                        (admin/manager)
 * POST   /reprocess/:id        إعادة معالجة فاتورة فاشلة         (admin/manager)
 * GET    /review               أصناف تحتاج مراجعة                (admin/manager/auditor)
 * POST   /review/:id/resolve   ربط صنف مراجعة بمنتج وإعادة فتح   (admin/manager)
 * GET    /mappings             روابط المنتجات                    (admin/manager/auditor)
 * POST   /mappings             إنشاء/تحديث ربط                   (admin/manager)
 * DELETE /mappings/:id         تعطيل ربط                         (admin/manager)
 * GET    /sections/map         خريطة أقسام الإيرادات             (admin/manager/auditor/accountant)
 * GET    /sections/unmapped    أقسام جديدة تحتاج اعتماد          (admin/manager/auditor/accountant)
 * POST   /sections/unmapped/:id/approve اعتماد قسم + ترحيل فواتيره (admin/manager)
 * POST   /dry-run-preview      معاينة تحليل ملف نصي ملصق         (admin/manager)
 */

'use strict';

const express = require('express');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const files = require('./files');
const { parseInvoiceFile, suggestProfile, ParseError } = require('./parser');
const { resolveItems } = require('./mapping');
const { STATUS } = require('./importer');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'auditor', 'accountant'];
const WRITE_ROLES = ['admin', 'manager'];

let engineRef = null;
function engine(req) {
    return engineRef || req.app.locals.yarasoftEngine || null;
}

// ─── الحالة الحية (Phase 14) ───
router.get('/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const eng = engine(req);
        const counts = (await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                COUNT(*) FILTER (WHERE status = 'DUPLICATE')::int AS duplicates,
                COUNT(*) FILTER (WHERE status = 'REQUIRES_REVIEW')::int AS review,
                COUNT(*) FILTER (WHERE status = 'NEEDS_MAPPING')::int AS needs_mapping,
                COUNT(*) FILTER (WHERE status = 'DRY_RUN')::int AS dry_runs,
                COUNT(*) FILTER (WHERE status IN ('DETECTED','PROCESSING'))::int AS pending
             FROM invoice_import_log`
        )).rows[0];
        const openReview = (await pool.query(
            `SELECT COUNT(*)::int AS c FROM yarasoft_review_items WHERE resolved = false`
        )).rows[0];
        const openSections = (await pool.query(
            `SELECT COUNT(*)::int AS c FROM yarasoft_unmapped_sections WHERE resolved = false`
        )).rows[0].c;
        res.json({
            engine: eng ? eng.getStatus() : { enabled: false, running: false },
            logCounts: counts,
            openReviewItems: openReview.c,
            openSections,
        });
    } catch (error) {
        logger.error('[yarasoft/status]', error);
        res.status(500).json({ error: 'YARASOFT_STATUS_FAILED', message: 'تعذر جلب حالة تكامل Yarasoft' });
    }
});

// ─── سجل الاستيراد ───
router.get('/log', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        const status = req.query.status ? String(req.query.status).toUpperCase() : null;
        const params = [limit];
        let where = 'TRUE';
        if (status && Object.values(STATUS).includes(status)) {
            params.push(status);
            where = `status = $2`;
        }
        const { rows } = await pool.query(
            `SELECT id, source_file, file_hash, external_invoice_number, status, stage,
                    items_count, total_amount, retry_count, error_message,
                    processing_duration_ms, created_at, processed_at, archived_at
             FROM invoice_import_log WHERE ${where}
             ORDER BY created_at DESC LIMIT $1`, params);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/log]', error);
        res.status(500).json({ error: 'YARASOFT_LOG_FAILED', message: 'تعذر جلب سجل الاستيراد' });
    }
});

// ─── دورة فورية ───
router.post('/run-now', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const eng = engine(req);
        if (!eng) {return res.status(409).json({ error: 'YARASOFT_ENGINE_MISSING', message: 'المحرك غير مهيأ' });}
        const r = await eng.runNow();
        res.json({ ok: true, ...r, status: eng.getStatus() });
    } catch (error) {
        logger.error('[yarasoft/run-now]', error);
        res.status(502).json({ error: 'YARASOFT_RUN_FAILED', message: error.message });
    }
});

// ─── إعادة معالجة فاتورة فاشلة (بعد إصلاح سببها) ───
router.post('/reprocess/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const row = (await pool.query(
            `UPDATE invoice_import_log
                SET status = 'DETECTED', retry_count = 0, error_message = NULL, updated_at = NOW()
              WHERE id = $1 AND status IN ('FAILED','REQUIRES_REVIEW')
              RETURNING id, source_file`, [id]));
        if (!row.rows[0]) {return res.status(404).json({ error: 'NOT_REPROCESSABLE', message: 'الفاتورة غير موجودة أو ليست في حالة قابلة لإعادة المعالجة' });}
        // أعد الملف من Failed/Processing إلى Invoices ليكتشفه المحرك من جديد
        res.json({ ok: true, message: 'أُعيد فتح الفاتورة — سيُعاد اكتشاف الملف في الدورة القادمة', row: row.rows[0] });
    } catch (error) {
        logger.error('[yarasoft/reprocess]', error);
        res.status(500).json({ error: 'YARASOFT_REPROCESS_FAILED', message: 'تعذر إعادة فتح الفاتورة' });
    }
});

// ─── أصناف المراجعة ───
router.get('/review', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT r.id, r.import_id, r.external_item_code, r.external_barcode, r.item_name,
                    r.quantity, r.unit_price, r.reason, r.resolved, r.created_at,
                    l.external_invoice_number, l.source_file
             FROM yarasoft_review_items r JOIN invoice_import_log l ON l.id = r.import_id
             WHERE $1::boolean IS NULL OR r.resolved = $1
             ORDER BY r.created_at DESC LIMIT 300`,
            [req.query.open === '1' ? false : req.query.open === '0' ? true : null]);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/review]', error);
        res.status(500).json({ error: 'YARASOFT_REVIEW_FAILED', message: 'تعذر جلب أصناف المراجعة' });
    }
});

router.post('/review/:id/resolve', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const id = Number(req.params.id);
        const productId = Number(req.body?.internalProductId);
        if (!productId) {return res.status(422).json({ error: 'PRODUCT_REQUIRED', message: 'اختر المنتج الداخلي المطلوب' });}
        await client.query('BEGIN');
        const item = (await client.query(`SELECT * FROM yarasoft_review_items WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!item) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'REVIEW_ITEM_NOT_FOUND', message: 'صنف المراجعة غير موجود' }); }
        // أنشئ الربط الصريح ليغطي بقية الفواتير القادمة لنفس الصنف
        const code = item.external_item_code, barcode = item.external_barcode;
        if (code || barcode) {
            await client.query(
                `INSERT INTO yarasoft_product_mapping (external_code, external_barcode, internal_product_id, active)
                 SELECT $1, $2, $3, true WHERE NOT EXISTS (
                    SELECT 1 FROM yarasoft_product_mapping
                    WHERE active = true AND (
                        (external_code IS NOT NULL AND external_code = $1)
                     OR (external_barcode IS NOT NULL AND external_barcode = $2)))
                 ON CONFLICT DO NOTHING`,
                [code || null, barcode || null, productId]);
        }
        await client.query(`UPDATE yarasoft_review_items SET resolved = true WHERE id = $1`, [id]);
        // هل اكتملت كل أصناف الفاتورة؟ علّم الفاتورة لتُعالج من جديد
        const remaining = (await client.query(
            `SELECT COUNT(*)::int AS c FROM yarasoft_review_items WHERE import_id = $1 AND resolved = false`,
            [item.import_id])).rows[0].c;
        await client.query(
            `UPDATE invoice_import_log
                SET status = CASE WHEN $2 = 0 THEN 'DETECTED' ELSE status END,
                    retry_count = CASE WHEN $2 = 0 THEN 0 ELSE retry_count END,
                    error_message = CASE WHEN $2 = 0 THEN NULL ELSE error_message END,
                    updated_at = NOW()
              WHERE id = $1`,
            [item.import_id, remaining]);
        await client.query('COMMIT');
        res.json({ ok: true, remainingForInvoice: remaining, message: remaining === 0 ? 'اكتملت أصناف الفاتورة — ستُستورد في الدورة القادمة' : `بقي ${remaining} صنفًا بلا ربط لهذه الفاتورة` });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[yarasoft/review/resolve]', error);
        res.status(500).json({ error: 'YARASOFT_RESOLVE_FAILED', message: 'تعذر حل صنف المراجعة' });
    } finally {
        client.release();
    }
});

// ─── روابط المنتجات ───
router.get('/mappings', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT m.id, m.external_code, m.external_barcode, m.internal_product_id,
                    m.active, m.created_at, m.updated_at,
                    i.name AS product_name, i.barcode AS product_barcode, i.unit
             FROM yarasoft_product_mapping m JOIN inventory i ON i.id = m.internal_product_id
             ORDER BY m.updated_at DESC LIMIT 500`);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/mappings]', error);
        res.status(500).json({ error: 'YARASOFT_MAPPINGS_FAILED', message: 'تعذر جلب روابط المنتجات' });
    }
});

router.post('/mappings', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { externalCode, externalBarcode, internalProductId, active } = req.body || {};
        const { upsertMapping } = require('./mapping');
        const row = await upsertMapping({ externalCode, externalBarcode, internalProductId, active });
        res.status(201).json(row);
    } catch (error) {
        if (error.code === 'MAPPING_CLASH') {return res.status(409).json({ error: error.code, message: error.message });}
        if (['INTERNAL_PRODUCT_REQUIRED', 'EXTERNAL_KEY_REQUIRED', 'PRODUCT_NOT_FOUND'].includes(error.code)) {
            return res.status(422).json({ error: error.code, message: error.message });
        }
        logger.error('[yarasoft/mappings POST]', error);
        res.status(500).json({ error: 'YARASOFT_MAPPING_FAILED', message: 'تعذر حفظ الربط' });
    }
});

router.delete('/mappings/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE yarasoft_product_mapping SET active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
            [Number(req.params.id)]);
        if (!rows[0]) {return res.status(404).json({ error: 'NOT_FOUND', message: 'الربط غير موجود' });}
        res.json({ ok: true });
    } catch (error) {
        logger.error('[yarasoft/mappings DELETE]', error);
        res.status(500).json({ error: 'YARASOFT_MAPPING_DELETE_FAILED', message: 'تعذر تعطيل الربط' });
    }
});

// ─── خريطة أقسام الإيرادات (قراءة) ───
router.get('/sections/map', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT m.id, m.src_table, m.src_name, m.dept_code, m.display_ar, m.display_en, m.active,
                    (SELECT COUNT(*)::int FROM revenues r WHERE r."deptId" = m.dept_code) AS posted_count,
                    (SELECT COALESCE(SUM(r.amount),0)::float FROM revenues r WHERE r."deptId" = m.dept_code) AS posted_total,
                    (SELECT COALESCE(SUM(e.amount),0)::float FROM expenses e WHERE e."deptId" = m.dept_code) AS posted_expenses
             FROM yarasoft_revenue_map m ORDER BY m.src_table, m.display_ar`);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/sections-map]', error);
        res.status(500).json({ error: 'YS_SECTIONS_FAILED', message: 'تعذر جلب خريطة الأقسام' });
    }
});

// ─── أقسام جديدة تحتاج اعتماد (الذكاء: اسم جديد = صف واحد هنا) ───
router.get('/sections/unmapped', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, src_table, src_name, first_seen, last_seen, invoices_count, total_amount, resolved
             FROM yarasoft_unmapped_sections WHERE resolved = false ORDER BY last_seen DESC LIMIT 200`);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/sections-unmapped]', error);
        res.status(500).json({ error: 'YS_UNMAPPED_FAILED', message: 'تعذر جلب الأقسام غير المعتمدة' });
    }
});

// ─── اعتماد قسم جديد بزر واحد: ينشئ القسم + يرحّل فواتيره المعلقة ───
router.post('/sections/unmapped/:id/approve', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const id = Number(req.params.id);
        const displayAr = String(req.body?.displayAr || '').trim();
        const displayEn = String(req.body?.displayEn || '').trim() || null;
        await client.query('BEGIN');
        const sec = (await client.query(
            `SELECT * FROM yarasoft_unmapped_sections WHERE id = $1 AND resolved = false FOR UPDATE`, [id])).rows[0];
        if (!sec) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'SECTION_NOT_FOUND', message: 'القسم غير موجود أو اعتُمد مسبقًا' }); }
        const table = String(sec.src_table).toUpperCase();
        if (table === 'BILLS4') {
            await client.query('ROLLBACK');
            return res.status(422).json({ error: 'BILLS4_SINGLE_SECTION', message: 'فواتير BILLS4 تتبع قسم "بيع خارجي" الواحد — لا تفصيل شركات (قرار المالك)' });
        }
        const name = displayAr || sec.src_name;
        // دمج: وجّه الاسم الجديد لقسم موجود بدل إنشاء قسم (يعالج الأخطاء الإملائية)
        let deptCode = `ys_${table.toLowerCase()}_u${sec.id}`.slice(0, 50);
        const mergeMapId = Number(req.body?.mergeMapId) || null;
        if (mergeMapId) {
            const target = (await client.query(
                `SELECT dept_code, display_ar FROM yarasoft_revenue_map WHERE id = $1 AND active = true LIMIT 1`,
                [mergeMapId])).rows[0];
            if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'TARGET_SECTION_NOT_FOUND', message: 'القسم المستهدف غير موجود' }); }
            deptCode = target.dept_code;
        }
        const mapRow = (await client.query(
            `INSERT INTO yarasoft_revenue_map (src_table, src_name, dept_code, display_ar, display_en, active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT DO NOTHING RETURNING id`,
            [table, sec.src_name, deptCode, name.slice(0, 255), displayEn])).rows[0];
        // أنشئ القسم فورًا ليظهر في الواجهة قبل أول ترحيل
        await client.query(
            `INSERT INTO departments (id, code, name, icon, color) VALUES ($1, $2, $3, '🧾', '#8b6fc1')
             ON CONFLICT (code) DO NOTHING`,
            [Date.now() * 1000 + Math.floor(Math.random() * 1000), deptCode, name.slice(0, 255)]);
        await client.query(`UPDATE yarasoft_unmapped_sections SET resolved = true, updated_at = NOW() WHERE id = $1`, [id]);
        // أعد فتح فواتيره المعلقة — تُرحّل مصنفة فورًا أدناه (تبقى NEEDS_MAPPING حتى تُحجز)
        await client.query(
            `UPDATE invoice_import_log SET retry_count = 0, error_message = NULL, updated_at = NOW()
              WHERE status = 'NEEDS_MAPPING' AND external_invoice_number LIKE $1 || ':%'
                AND payload->>'sectionName' = $2`,
            [table, sec.src_name]);
        await client.query('COMMIT');
        // ─── إعادة تشغيل فورية للفواتير المعلقة (الذكاء: الاعتماد يرحّل فورًا) ───
        let replayed = 0;
        try {
            const { processOneInvoice, STATUS: IMP_STATUS } = require('./importer');
            const { loadConfig } = require('./config');
            const { resolveSection } = require('./section-resolver');
            const cfg = loadConfig();
            const pend = await pool.query(
                `SELECT id, file_hash, payload, external_invoice_number FROM invoice_import_log
                  WHERE status = 'NEEDS_MAPPING' AND external_invoice_number LIKE $1 || ':%'
                    AND payload->>'sectionName' = $2`,
                [table, sec.src_name]);
            for (const prow of pend.rows) {
                try {
                    const inv = typeof prow.payload === 'string' ? JSON.parse(prow.payload) : prow.payload;
                    if (!inv || !inv.key) {continue;}
                    const rs = await resolveSection(inv.srcTable, inv.sectionName, inv.date);
                    if (rs.unmapped || !rs.device) {continue;}
                    const claimed = (await pool.query(
                        `UPDATE invoice_import_log SET status = $2, stage = $3, updated_at = NOW()
                          WHERE id = $1 AND status = 'NEEDS_MAPPING' RETURNING *`,
                        [prow.id, IMP_STATUS.PROCESSING, 'PROCESSING'])).rows[0];
                    if (!claimed) {continue;}
                    const rr = await processOneInvoice({
                        invoice: inv, meta: { hash: prow.file_hash }, filePath: `oracle:${inv.key}`,
                        config: { ...cfg, dryRun: false }, importer: null, logRow: claimed,
                        io: req.io || null, started: Date.now(), device: rs.device,
                    });
                    if (rr.status === IMP_STATUS.COMPLETED) {replayed++;}
                } catch (e) {
                    logger.warn('[yarasoft/sections-replay] ' + prow.external_invoice_number + ': ' + String(e.message).slice(0, 120));
                }
            }
        } catch (e) {
            logger.warn('[yarasoft/sections-replay] ' + String(e.message).slice(0, 160));
        }
        res.json({ ok: true, mapId: mapRow?.id || null, deptCode, displayAr: name, reopenedInvoices: replayed || 0 });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[yarasoft/sections-approve]', error);
        res.status(500).json({ error: 'YS_APPROVE_FAILED', message: 'تعذر اعتماد القسم' });
    } finally {
        client.release();
    }
});

// ─── تفاصيل فاتورة (أصنافها المحفوظة — للعرض والطباعة لاحقًا) ───
router.get('/log/:id/detail', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, source_file, external_invoice_number, status, items_count, total_amount,
                    payload, created_at, processed_at
             FROM invoice_import_log WHERE id = $1 LIMIT 1`, [Number(req.params.id)]);
        if (!rows[0]) {return res.status(404).json({ error: 'NOT_FOUND', message: 'الفاتورة غير موجودة' });}
        let payload = rows[0].payload;
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { payload = null; } }
        res.json({ ...rows[0], payload });
    } catch (error) {
        logger.error('[yarasoft/log-detail]', error);
        res.status(500).json({ error: 'YS_DETAIL_FAILED', message: 'تعذر جلب تفاصيل الفاتورة' });
    }
});

// ─── إعادة تسمية قسم (مثال: كاشير 9 ← كاشير الأوبن بوفيه) ───
router.post('/sections/map/:id/rename', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const id = Number(req.params.id);
        const displayAr = String(req.body?.displayAr || '').trim();
        const displayEn = String(req.body?.displayEn || '').trim() || null;
        if (!displayAr) {return res.status(422).json({ error: 'NAME_REQUIRED', message: 'أدخل الاسم الجديد' });}
        await client.query('BEGIN');
        const m = (await client.query(`SELECT * FROM yarasoft_revenue_map WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'SECTION_NOT_FOUND', message: 'القسم غير موجود' }); }
        await client.query(`UPDATE yarasoft_revenue_map SET display_ar = $2, display_en = $3, updated_at = NOW() WHERE id = $1`,
            [id, displayAr.slice(0, 255), displayEn]);
        await client.query(`UPDATE departments SET name = $2 WHERE code = $1`, [m.dept_code, displayAr.slice(0, 255)]);
        // حدّث اسم المصدر في الإيرادات المرحلة ليتسق العرض
        await client.query(`UPDATE revenues SET source = $2 WHERE "deptId" = $1`, [m.dept_code, displayAr.slice(0, 255)]);
        await client.query('COMMIT');
        res.json({ ok: true, id, displayAr });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[yarasoft/sections-rename]', error);
        res.status(500).json({ error: 'YS_RENAME_FAILED', message: 'تعذر إعادة التسمية' });
    } finally {
        client.release();
    }
});

// ─── قسم يدوي (كاشير/منفذ غير موجود في يارا سوفت — للإدخال اليدوي) ───
router.post('/sections/manual', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const displayAr = String(req.body?.displayAr || '').trim();
        const displayEn = String(req.body?.displayEn || '').trim() || null;
        if (!displayAr) {return res.status(422).json({ error: 'NAME_REQUIRED', message: 'أدخل اسم القسم' });}
        const deptCode = `ys_manual_${Date.now().toString(36)}`.slice(0, 50);
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO departments (id, code, name, icon, color) VALUES ($1, $2, $3, '🧾', '#8b6fc1')
             ON CONFLICT (code) DO NOTHING`,
            [Date.now() * 1000 + Math.floor(Math.random() * 1000), deptCode, displayAr.slice(0, 255)]);
        const mapRow = (await client.query(
            `INSERT INTO yarasoft_revenue_map (src_table, src_name, dept_code, display_ar, display_en, active)
             VALUES ('MANUAL', $1, $2, $3, $4, true) RETURNING id`,
            [displayAr.slice(0, 255), deptCode, displayAr.slice(0, 255), displayEn])).rows[0];
        await client.query('COMMIT');
        res.status(201).json({ ok: true, mapId: mapRow?.id || null, deptCode, displayAr });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[yarasoft/sections-manual]', error);
        res.status(500).json({ error: 'YS_MANUAL_FAILED', message: 'تعذر إنشاء القسم اليدوي' });
    } finally {
        client.release();
    }
});

// ─── معاينة تحليل نص ملصق (بلا كتابة — أداة ضبط الصيغة) ───
router.post('/dry-run-preview', jwtAuth, requireRole(...WRITE_ROLES), express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const text = String(req.body?.text || '');
        if (!text.trim()) {return res.status(422).json({ error: 'EMPTY_TEXT', message: 'ألصق محتوى ملف فاتورة للمعاينة' });}
        let profile = req.body?.profile || null;
        const eng = engine(req);
        if (!profile && eng?.profile) {profile = eng.profile;}
        try {
            const parsed = parseInvoiceFile(text, profile);
            // جرّب المطابقة مقابل المنتجات الفعلية (قراءة فقط)
            for (const inv of parsed.invoices) {
                const { resolved, unmapped } = await resolveItems(inv.items || []);
                inv.matching = {
                    resolved: [...resolved.entries()].map(([idx, m]) => ({ item: inv.items[idx].name, productId: m.inventoryId, product: m.name, via: m.via })),
                    unmapped: unmapped.map(u => ({ code: u.externalItemCode, barcode: u.externalBarcode, name: u.itemName, reason: u.reason })),
                };
            }
            res.json({ ok: true, parsed, suggestedProfile: profile ? null : suggestProfile(text) });
        } catch (error) {
            if (error instanceof ParseError) {
                return res.status(422).json({ ok: false, error: 'PARSE_FAILED', message: error.message, suggestedProfile: suggestProfile(text) });
            }
            throw error;
        }
    } catch (error) {
        logger.error('[yarasoft/dry-run-preview]', error);
        res.status(500).json({ error: 'YARASOFT_PREVIEW_FAILED', message: 'تعذر تحليل النص' });
    }
});

const { testConnection, discoverTables, pullItems, oracleEngine } = require('./oracle-link');

// ─── الربط المباشر Oracle: حالة + فحص + اكتشاف جداول ───
router.get('/oracle/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { oracleBreakerStatus } = require('./oracle-link');
        res.json({ ok: true, oracle: oracleEngine.status(), breaker: oracleBreakerStatus() });
    }
    catch (error) { logger.error('[yarasoft/oracle-status]', error); res.status(500).json({ error: 'ORACLE_STATUS_FAILED', message: 'تعذر جلب حالة الربط المباشر' }); }
});
router.post('/oracle/test', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { res.json(await testConnection()); }
    catch (error) { logger.error('[yarasoft/oracle-test]', error); res.status(500).json({ ok: false, error: 'ORACLE_TEST_FAILED', message: 'تعذر فحص الاتصال' }); }
});
router.get('/oracle/tables', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { res.json(await discoverTables(Number(req.query.limit) || 100)); }
    catch (error) { logger.error('[yarasoft/oracle-tables]', error); res.status(500).json({ ok: false, error: 'ORACLE_TABLES_FAILED', message: 'تعذر اكتشاف الجداول' }); }
});
router.post('/oracle/consume', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { consumeAllPending } = require('./oracle-consume');
        res.json(await consumeAllPending({ io: req.io || null }));
    }
    catch (error) { logger.error('[yarasoft/oracle-consume]', error); res.status(500).json({ error: 'ORACLE_CONSUME_FAILED', message: 'تعذر ترحيل المسحوب' }); }
});
// ─── سحب فوري من Oracle الآن (تجاوز المؤقت الدوري) ───
router.post('/oracle/poll-now', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        if (oracleEngine.io !== undefined && req.io) {oracleEngine.io = req.io;}
        const r = await oracleEngine.pollNow();
        res.json({ ok: r.ok !== false, ...r });
    }
    catch (error) { logger.error('[yarasoft/oracle-poll-now]', error); res.status(502).json({ ok: false, error: 'ORACLE_POLL_FAILED', message: 'تعذر السحب الفوري' }); }
});
// ─── استيراد دليل أصناف يارسوفت إلى مخزون karim (idempotent، كمية صفر) ───
router.get('/oracle/import-items/preview', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { res.json(await previewItemImport()); }
    catch (error) { logger.error('[yarasoft/oracle-item-preview]', error); res.status(500).json({ ok: false, error: 'ITEM_PREVIEW_FAILED', message: 'تعذر المعاينة' }); }
});
router.post('/oracle/import-items', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { res.json(await importItems()); }
    catch (error) { logger.error('[yarasoft/oracle-item-import]', error); res.status(500).json({ ok: false, error: 'ITEM_IMPORT_FAILED', message: 'تعذر استيراد الأصناف' }); }
});

async function previewItemImport() {
    const pulled = await pullItems();
    if (!pulled.ok) {return pulled;}
    const inv = await pool.query(`SELECT id, name, barcode FROM inventory`);
    const byBarcode = new Set(inv.rows.filter(r => r.barcode).map(r => String(r.barcode).trim()));
    const byName = new Set(inv.rows.map(r => String(r.name).trim()));
    const mapped = await pool.query(`SELECT external_code, external_barcode FROM yarasoft_product_mapping WHERE active = true`);
    const mapCodes = new Set(mapped.rows.map(r => r.external_code).filter(Boolean));
    const mapBarcodes = new Set(mapped.rows.map(r => r.external_barcode).filter(Boolean));
    let fresh = 0, skipped = 0, groups = 0;
    for (const it of pulled.items) {
        if ((it.lvl || 0) < 3 || (it.itemType !== '' && it.itemType !== '0')) {groups++;continue;} // رؤوس المجموعات وأصناف البيع ليست خامات مخزنية
        if ((it.code && mapCodes.has(it.code)) || (it.barcode && (mapBarcodes.has(it.barcode) || byBarcode.has(it.barcode))) || (it.name && byName.has(it.name))) {skipped++;}
        else {fresh++;}
    }
    return { ok: true, total: pulled.items.length, fresh, skipped, groups };
}

async function importItems() {
    const pulled = await pullItems();
    if (!pulled.ok) {return pulled;}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let imported = 0, skipped = 0;
        const idBase = Date.now() * 1000 + Math.floor(Math.random() * 500);
        const safeMoney = (v) => {
            let n = Number(v);
            if (!Number.isFinite(n)) {n = 0;}
            n = Math.round(n * 100) / 100;
            return Math.max(0, Math.min(999999999999.99, n));
        };
        let i = 0, groups = 0;
        for (const it of pulled.items) {
            if ((it.lvl || 0) < 3 || (it.itemType !== '' && it.itemType !== '0')) {groups++;continue;} // رؤوس المجموعات وأصناف البيع ليست خامات
            i++;
            const code = it.code || null, barcode = it.barcode || null;
            // idempotency: ربط موجود؟ باركود/اسم موجود؟
            const dup = await client.query(
                `SELECT 1 FROM yarasoft_product_mapping WHERE active = true AND ((external_code IS NOT DISTINCT FROM $1 AND $1 IS NOT NULL) OR (external_barcode IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL)) LIMIT 1`,
                [code, barcode]);
            if (dup.rows[0]) { skipped++; continue; }
            const invDup = await client.query(
                `SELECT id FROM inventory WHERE ($2::text IS NOT NULL AND barcode = $2) OR (name = $1 AND ($2::text IS NULL OR barcode IS NULL)) LIMIT 1`,
                [it.name || code || 'صنف', barcode]);
            let internalId;
            if (invDup.rows[0]) {
                internalId = invDup.rows[0].id;
                skipped++;
            } else {
                const nid = idBase + i;
                const minQty = Math.max(0, Math.min(999999, Number(it.minBal) || 0)); // الحد الأدنى من Oracle
                await client.query(
                    `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", barcode, external_code)
                     VALUES ($1, $2, 'يارسوفت', $3, 0, $4, $5, $6, $7)`,
                    [nid, (it.name || code || 'صنف').slice(0, 255), (it.unit || 'حبة').slice(0, 50), safeMoney(it.cost), minQty, barcode, code ? String(code).slice(0, 64) : null]);
                internalId = nid;
                imported++;
            }
            if (code || barcode) {
                await client.query(
                    `INSERT INTO yarasoft_product_mapping (external_code, external_barcode, internal_product_id)
                     VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING`,
                    [code, barcode, internalId]);
            }
        }
        await client.query('COMMIT');
        return { ok: true, total: pulled.items.length, imported, skipped, groups };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        return { ok: false, error: String(e.message).slice(0, 300) };
    } finally { client.release(); }
}

// ─── تنظيم فئات المخزن من شجرة يارا سوفت (category فقط — المزامنة لا تُمس) ───
router.post('/oracle/organize', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { organizeCategories } = require('./oracle-catalog');
        res.json(await organizeCategories());
    } catch (error) {
        logger.error('[yarasoft/oracle-organize]', error);
        res.status(500).json({ error: 'ORGANIZE_FAILED', message: 'تعذر تنظيم الفئات' });
    }
});
// ─── نسخ أرصدة المخازن بمصفاة جودة (force=true يعيد الكتابة فوق غير الصفر) ───
router.post('/oracle/sync-balances', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { syncBalancesSafe } = require('./oracle-catalog');
        res.json(await syncBalancesSafe({ force: req.body?.force === true }));
    } catch (error) {
        logger.error('[yarasoft/oracle-balances]', error);
        res.status(500).json({ error: 'BALANCE_SYNC_FAILED', message: 'تعذر مزامنة الأرصدة' });
    }
});
// ─── تقرير الحجر الصحي للقيم الشاذة ───
router.get('/quality/quarantine', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, kind, ref_code, ref_name, qty, value_amount, unit_cost, reason, created_at
             FROM yarasoft_quality_quarantine ORDER BY created_at DESC LIMIT 300`);
        res.json(rows);
    } catch (error) {
        logger.error('[yarasoft/quarantine]', error);
        res.status(500).json({ error: 'YS_QUARANTINE_FAILED', message: 'تعذر جلب تقرير الجودة' });
    }
});
// ─── حالة كتالوج يارا سوفت (مشتريات/مخزون/عملاء/أصول) ───
router.get('/oracle/catalog-status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { catalogStatus } = require('./oracle-catalog');
        res.json({ ok: true, ...(await catalogStatus()) });
    } catch (error) {
        logger.error('[yarasoft/catalog-status]', error);
        res.status(500).json({ error: 'CATALOG_STATUS_FAILED', message: 'تعذر جلب حالة الكتالوج' });
    }
});

// ─── التقفيل اليومي لكاشيرية ياراسوفت (1، 4و5، 6، 9) ───
// GET  /daily-closing?date=YYYY-MM-DD   إجماليات حية + حالة القفل لكل قسم
// POST /daily-closing/close             قفل يوم (لقطة ثابتة) {date, dept_codes?, notes}
// POST /daily-closing/reopen            إعادة فتح يوم/قسم {date, dept_code}
const YS_CASHIER_DEPTS = ['ys_cc_1', 'ys_cc_4', 'ys_cc_5', 'ys_cc_45', 'ys_cc_6', 'ys_cc_9'];

function parseCloseDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {return null;}
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {return null;}
    return raw;
}

router.get('/daily-closing', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const day = parseCloseDate(req.query.date) || new Date().toISOString().slice(0, 10);
        const live = (await pool.query(
            `SELECT r."deptId" AS dept_code,
                    COALESCE(m.display_ar, d.name, r."deptId") AS display_ar,
                    COUNT(*)::int AS invoices,
                    COALESCE(SUM(r.amount), 0)::float AS total
               FROM revenues r
               LEFT JOIN yarasoft_revenue_map m ON m.dept_code = r."deptId" AND m.active = true
               LEFT JOIN departments d ON d.code = r."deptId"
              WHERE r.date = $1 AND r."deptId" = ANY($2)
              GROUP BY r."deptId", m.display_ar, d.name`,
            [day, YS_CASHIER_DEPTS]
        )).rows;
        const liveBy = new Map(live.map(r => [r.dept_code, r]));
        const closed = (await pool.query(
            `SELECT day::text AS day, dept_code, display_ar, invoices, total::float AS total,
                    notes, closed_by, closed_by_name, created_at, updated_at
               FROM ys_daily_closings WHERE day = $1::date`,
            [day]
        )).rows;
        const closedBy = new Map(closed.map(r => [r.dept_code, r]));
        const names = (await pool.query(
            `SELECT dept_code, display_ar FROM yarasoft_revenue_map
              WHERE dept_code = ANY($1) AND active = true`,
            [YS_CASHIER_DEPTS]
        )).rows;
        const nameBy = new Map();
        for (const n of names) {if (!nameBy.has(n.dept_code)) {nameBy.set(n.dept_code, n.display_ar);}}
        const departments = YS_CASHIER_DEPTS.map(code => {
            const l = liveBy.get(code) || { invoices: 0, total: 0 };
            const c = closedBy.get(code) || null;
            return {
                dept_code: code,
                display_ar: nameBy.get(code) || l.display_ar || code,
                live_invoices: Number(l.invoices || 0),
                live_total: Number(l.total || 0),
                closed: Boolean(c),
                closed_invoices: c ? Number(c.invoices) : null,
                closed_total: c ? Number(c.total) : null,
                variance: c ? Number((Number(l.total || 0) - Number(c.total)).toFixed(2)) : null,
                closed_by_name: c ? c.closed_by_name : null,
                closed_at: c ? c.updated_at : null,
                notes: c ? c.notes : null,
            };
        });
        res.json({ ok: true, day, departments });
    } catch (error) {
        logger.error('[yarasoft/daily-closing]', error);
        res.status(500).json({ error: 'YS_DAILY_CLOSE_FAILED', message: 'تعذر جلب تقرير التقفيل اليومي' });
    }
});

router.post('/daily-closing/close', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const day = parseCloseDate(req.body?.date) || new Date().toISOString().slice(0, 10);
        let codes = Array.isArray(req.body?.dept_codes) ? req.body.dept_codes : YS_CASHIER_DEPTS;
        codes = [...new Set(codes.map(String))].filter(c => YS_CASHIER_DEPTS.includes(c));
        if (!codes.length) {return res.status(422).json({ error: 'INVALID_DEPT_CODES' });}
        const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 500) : null;
        const who = req.user?.name || req.user?.username || 'مدير';
        const out = [];
        for (const code of codes) {
            const live = (await pool.query(
                `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(amount), 0)::float AS total
                   FROM revenues WHERE date = $1 AND "deptId" = $2`,
                [day, code]
            )).rows[0];
            const nm = (await pool.query(
                `SELECT display_ar FROM yarasoft_revenue_map
                  WHERE dept_code = $1 AND active = true LIMIT 1`,
                [code]
            )).rows[0];
            const row = (await pool.query(
                `INSERT INTO ys_daily_closings (day, dept_code, display_ar, invoices, total, notes, closed_by, closed_by_name, updated_at)
                 VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (day, dept_code) DO UPDATE SET
                    display_ar = EXCLUDED.display_ar,
                    invoices = EXCLUDED.invoices,
                    total = EXCLUDED.total,
                    notes = COALESCE(EXCLUDED.notes, ys_daily_closings.notes),
                    closed_by = EXCLUDED.closed_by,
                    closed_by_name = EXCLUDED.closed_by_name,
                    updated_at = NOW()
                 RETURNING day::text AS day, dept_code, display_ar, invoices, total::float AS total, updated_at`,
                [day, code, nm?.display_ar || code, live.invoices, live.total, notes, req.user?.id || null, String(who).slice(0, 255)]
            )).rows[0];
            out.push(row);
        }
        res.json({ ok: true, day, closed: out });
    } catch (error) {
        logger.error('[yarasoft/daily-close]', error);
        res.status(500).json({ error: 'YS_CLOSE_FAILED', message: 'تعذر قفل اليوم' });
    }
});

router.post('/daily-closing/reopen', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const day = parseCloseDate(req.body?.date);
        const code = String(req.body?.dept_code || '').trim();
        if (!day || !YS_CASHIER_DEPTS.includes(code)) {return res.status(422).json({ error: 'INVALID_REOPEN' });}
        await pool.query(`DELETE FROM ys_daily_closings WHERE day = $1::date AND dept_code = $2`, [day, code]);
        res.json({ ok: true, day, dept_code: code, reopened: true });
    } catch (error) {
        logger.error('[yarasoft/daily-reopen]', error);
        res.status(500).json({ error: 'YS_REOPEN_FAILED', message: 'تعذر إعادة الفتح' });
    }
});

// ─── فواتير قسم (تفاصيل للتصميم الجديد: ترقيم + فلترة بالتاريخ + بحث) ───
// GET /sections/invoices?map_id=&page=1&limit=20&date_from&date_to&q=
router.get('/sections/invoices', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const mapId = Number(req.query.map_id);
        if (!Number.isInteger(mapId) || mapId <= 0) {return res.status(422).json({ error: 'INVALID_MAP_ID' });}
        const map = (await pool.query(
            `SELECT id, dept_code, display_ar FROM yarasoft_revenue_map WHERE id = $1 LIMIT 1`, [mapId])).rows[0];
        if (!map) {return res.status(404).json({ error: 'SECTION_NOT_FOUND', message: 'القسم غير موجود' });}
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 20));
        const off = (page - 1) * limit;
        const conds = [`r."deptId" = $1`];
        const params = [map.dept_code];
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_from || ''))) { params.push(String(req.query.date_from)); conds.push(`r.date >= $${params.length}`); }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_to || ''))) { params.push(String(req.query.date_to)); conds.push(`r.date <= $${params.length}`); }
        const q = String(req.query.q || '').trim().slice(0, 60);
        if (q) { params.push(`%${q}%`); conds.push(`(r.external_ref ILIKE $${params.length} OR r.notes ILIKE $${params.length} OR r.source ILIKE $${params.length})`); }
        const where = conds.join(' AND ');
        const total = (await pool.query(`SELECT COUNT(*)::int AS c FROM revenues r WHERE ${where}`, params)).rows[0].c;
        const rows = (await pool.query(
            `SELECT r.id, r."deptId" AS dept_code, r.source, r.amount::float AS amount,
                    r.date, r.notes, r.external_ref,
                    l.status AS import_status, l.items_count
               FROM revenues r LEFT JOIN invoice_import_log l ON l.external_invoice_number = SUBSTRING(r.external_ref FROM 5)
              WHERE ${where} ORDER BY r.date DESC, r.id DESC LIMIT ${limit} OFFSET ${off}`, params)).rows;
        res.json({ ok: true, section: map, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), rows });
    } catch (error) {
        logger.error('[yarasoft/section-invoices]', error);
        res.status(500).json({ error: 'YS_SEC_INV_FAILED', message: 'تعذر جلب فواتير القسم' });
    }
});

// ─── إعادة تصنيف فواتير (نقل من قسم لقسم) ───
// POST /sections/reclassify { revenue_ids:[...], to_map_id }
router.post('/sections/reclassify', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const ids = [...new Set((Array.isArray(req.body?.revenue_ids) ? req.body.revenue_ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
        const toMapId = Number(req.body?.to_map_id);
        if (!ids.length) {return res.status(422).json({ error: 'NO_INVOICES', message: 'اختر فاتورة واحدة على الأقل' });}
        const target = (await pool.query(
            `SELECT dept_code, display_ar FROM yarasoft_revenue_map WHERE id = $1 AND active = true LIMIT 1`, [toMapId])).rows[0];
        if (!target) {return res.status(422).json({ error: 'INVALID_TARGET', message: 'القسم المستهدف غير صالح' });}
        const r = await pool.query(
            `UPDATE revenues SET "deptId" = $2, source = $3 WHERE id = ANY($1::bigint[]) AND "deptId" <> $2`,
            [ids, target.dept_code, target.display_ar]);
        try {
            const { writeAuditLog } = require('../cashier-module/audit-middleware');
            await writeAuditLog({
                action: 'YS_RECLASSIFY', tableName: 'revenues', rowPk: ids[0],
                metadata: { count: r.rowCount, to_dept: target.dept_code, sample_ids: ids.slice(0, 10) },
                actor: { userId: req.user?.id, userName: req.user?.name, role: req.user?.role, ip: req.ip, requestId: req.id },
            });
        } catch (_) { /* التدقيق غير حرج */ }
        res.json({ ok: true, moved: r.rowCount, to_dept: target.dept_code, to_name: target.display_ar });
    } catch (error) {
        logger.error('[yarasoft/reclassify]', error);
        res.status(500).json({ error: 'YS_RECLASSIFY_FAILED', message: 'تعذر نقل الفواتير' });
    }
});

// ─── تفاصيل فاتورة بالضبط (ترويسة + أصناف حية من Oracle) ───
// GET /sections/invoice-detail?ref=ora:CC:1280596
router.get('/sections/invoice-detail', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const ref = String(req.query.ref || '').trim();
        const m = ref.match(/^ora:(CC|BILLS4):(.+)$/);
        if (!m) {return res.status(422).json({ error: 'INVALID_REF' });}
        const [, table, doc] = m;
        const local = (await pool.query(
            `SELECT id, "deptId" AS dept_code, source, amount::float AS amount, date, notes, external_ref
               FROM revenues WHERE external_ref = $1 LIMIT 1`, [ref])).rows[0] || null;
        if (table === 'CC') {
            const { loadOracleConfig, oraExecute, oracleConnect } = require('./oracle-link');
            const oracledb = require('oracledb');
            const cfg = loadOracleConfig();
            // مهلة + كسر دائرة: بلا connectTimeout كان الافتراضي 60 ثانية تعليقًا
            // عندما يكون جهاز اليارسوفت مطفأ (اللوج: شاشات تتجمد بالكامل).
            const conn = await oracleConnect(() => oracledb.getConnection({
                user: (process.env.YARASOFT_ORACLE_USER || '').trim(),
                password: process.env.YARASOFT_ORACLE_PASSWORD || '',
                connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
                connectTimeout: 8,
            }));
            try {
                const h = await oraExecute(conn,
                    `SELECT DOC_NO, TRIM(CSHR_NO) AS CSHR, DOC_DATE, NET_VAL, TOTAL_VAL, DSCNT_VL, SHFT_NO, PAYED, NOTES
                       FROM CC_BILLS3 WHERE DOC_NO = :doc`, { doc }, { outFormat: oracledb.OBJECT });
                const l = await oraExecute(conn,
                    `SELECT ITM_NO, ITM_NAME, QNT, UNIT_NM, SALE_PRICE, SALE_VAL, DISC_VAL, VAT_RATE, VAT_AMNT, SHIFT_ID
                       FROM CC_BILL_ENTER3 WHERE DOC_NO = :doc ORDER BY ESER, KEY`, { doc }, { outFormat: oracledb.OBJECT });
                const header = (h.rows || [])[0] || null;
                const lines = (l.rows || []).map(x => ({
                    code: x.ITM_NO != null ? String(x.ITM_NO).trim() : '',
                    name: x.ITM_NAME != null ? String(x.ITM_NAME).trim() : '',
                    qty: Number(x.QNT || 0), unit: x.UNIT_NM != null ? String(x.UNIT_NM).trim() : '',
                    price: Number(x.SALE_PRICE || 0), total: Number(x.SALE_VAL || 0),
                    discount: Number(x.DISC_VAL || 0), vat_rate: Number(x.VAT_RATE || 0), vat: Number(x.VAT_AMNT || 0),
                }));
                return res.json({ ok: true, ref, local, header, lines, live: true });
            } finally { try { await conn.close(); } catch (_) {} }
        }
        const log = (await pool.query(
            `SELECT payload FROM invoice_import_log WHERE external_invoice_number = $1 LIMIT 1`, [`${table}:${doc}`])).rows[0];
        const items = (log?.payload?.items || []).map(it => ({
            code: it.externalCode || '', name: it.name || '', qty: Number(it.quantity || 0),
            price: Number(it.unitPrice || 0), total: Number(it.total || 0),
        }));
        res.json({ ok: true, ref, local, header: null, lines: items, live: false });
    } catch (error) {
        logger.error('[yarasoft/invoice-detail]', error);
        res.status(500).json({ error: 'YS_INV_DETAIL_FAILED', message: 'تعذر جلب تفاصيل الفاتورة' });
    }
});

// ─── محرك المزامنة الذكي: كشف الفجوات + لحاق تلقائي ───
// GET  /oracle/reconcile?days=14   مقارنة Oracle بالمحلي لكل يوم
// POST /oracle/catch-up {days}      سحب النوافذ الناقصة (خلفية + حالة)
// GET  /oracle/catch-up/status      حالة مهمة اللحاق
router.get('/oracle/reconcile', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { reconcile } = require('./sync-doctor');
        res.json(await reconcile(req.query.days));
    } catch (error) {
        logger.error('[yarasoft/reconcile]', error);
        res.status(502).json({ ok: false, error: 'RECONCILE_FAILED', message: String(error.message).slice(0, 200) });
    }
});
router.post('/oracle/catch-up', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { catchUp, jobStatus } = require('./sync-doctor');
        const cur = jobStatus();
        if (cur.running) {return res.json({ ok: true, alreadyRunning: true, job: cur });}
        if (typeof req.io !== 'undefined') { try { require('./oracle-link').oracleEngine.io = req.io; } catch (_) {} }
        res.json({ ok: true, started: true, job: jobStatus() });
        setImmediate(() => catchUp(req.body?.days, req.io || null).catch(() => {}));
    } catch (error) {
        logger.error('[yarasoft/catch-up]', error);
        res.status(502).json({ ok: false, error: 'CATCHUP_FAILED', message: 'تعذر بدء اللحاق' });
    }
});
router.get('/oracle/catch-up/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { jobStatus } = require('./sync-doctor');
        res.json({ ok: true, job: jobStatus() });
    } catch (error) { res.status(500).json({ error: 'CATCHUP_STATUS_FAILED' }); }
});

router.get('/oracle/catch-up/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { jobStatus } = require('./sync-doctor');
        res.json({ ok: true, job: jobStatus() });
    } catch (error) { res.status(500).json({ error: 'CATCHUP_STATUS_FAILED' }); }
});

// ═══ مرآة الكاشيرية الحية (1/4/5/6/9): أوامر يارا سوفت داخل نظامنا ═══
// GET  /mirror/cashiers?date=YYYY-MM-DD   ملخص كل كاشير (فواتير/إيراد/متوسط/آخر فاتورة/المتبقي)
// GET  /mirror/orders?cashier=&date=&limit=&offset=  قائمة الأوردرات (الأحدث أولًا)
// GET  /mirror/orders/:doc                 تفاصيل أوردر بسطوره
// GET  /mirror/close?cashier=&date=        تقرير التقفيل (Z): إجماليات + خصم + ضريبة + مدفوع + متبقي + ساعات + أعلى أصناف
// POST /mirror/refresh                     تحديث يدوي فوري
const MIRROR_CASHIERS = ['1', '4', '5', '6', '9'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function mirrorDay(req) {
    const d = String(req.query.date || '').slice(0, 10);
    if (DATE_RE.test(d)) {return d;}
    return new Date().toISOString().slice(0, 10);
}

router.get('/mirror/cashiers', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const day = mirrorDay(req);
        const rows = (await pool.query(
            `SELECT cashier_no,
                    COUNT(*)::int AS invoices,
                    COALESCE(SUM(total),0)::float AS revenue,
                    COALESCE(SUM(net),0)::float AS net,
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
                    revenue: Number(r.revenue || 0), net: Number(r.net || 0),
                    discount: Number(r.discount || 0), vat: Number(r.vat || 0),
                    payed: Number(r.payed || 0),
                    pay_cash: Number(r.pay_cash || 0), pay_network: Number(r.pay_network || 0),
                    pay_credit: Number(r.pay_credit || 0), pay_mobile: Number(r.pay_mobile || 0),
                    open: Math.round((Number(r.total || r.revenue || 0) - Number(r.payed || 0)) * 100) / 100,
                    avg: n ? Math.round((Number(r.revenue || 0) / n) * 100) / 100 : 0,
                    last_time: r.last_time, synced_at: r.synced_at,
                };
            }),
        });
    } catch (error) {
        logger.error('[mirror/cashiers]', error);
        res.status(500).json({ error: 'MIRROR_CASHIERS_FAILED', message: 'تعذر جلب ملخص الكاشيرية' });
    }
});

router.get('/mirror/orders', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const day = mirrorDay(req);
        const cashier = String(req.query.cashier || '').trim();
        if (cashier && !MIRROR_CASHIERS.includes(cashier)) {
            return res.status(422).json({ error: 'INVALID_CASHIER', message: 'كاشير غير مشمول بالمرآة (1/4/5/6/9)' });
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
        logger.error('[mirror/orders]', error);
        res.status(500).json({ error: 'MIRROR_ORDERS_FAILED', message: 'تعذر جلب الأوردرات' });
    }
});

router.get('/mirror/orders/:doc', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const row = (await pool.query(`SELECT * FROM ys_mirror_orders WHERE doc_no = $1 LIMIT 1`, [String(req.params.doc)])).rows[0];
        if (!row) {return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'الأوردر غير موجود في المرآة' });}
        res.json({ ok: true, order: row });
    } catch (error) {
        logger.error('[mirror/order-detail]', error);
        res.status(500).json({ error: 'MIRROR_ORDER_FAILED', message: 'تعذر جلب تفاصيل الأوردر' });
    }
});

router.get('/mirror/close', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const day = mirrorDay(req);
        const cashier = String(req.query.cashier || '').trim();
        if (!cashier || !MIRROR_CASHIERS.includes(cashier)) {
            return res.status(422).json({ error: 'CASHIER_REQUIRED', message: 'حدد الكاشير (1/4/5/6/9) لتقرير التقفيل' });
        }
        const rows = (await pool.query(`SELECT * FROM ys_mirror_orders WHERE doc_date = $1::date AND cashier_no = $2 ORDER BY doc_time`, [day, cashier])).rows;
        const sum = (f) => Math.round(rows.reduce((s, r) => s + Number(r[f] || 0), 0) * 100) / 100;
        const total = sum('total');
        const payed = sum('payed');
        const paySplit = {
            cash: sum('pay_cash'), network: sum('pay_network'),
            credit: sum('pay_credit'), mobile: sum('pay_mobile'),
        };
        const byHour = {};
        for (const r of rows) {
            const h = String(r.doc_time || '').slice(0, 2).padStart(2, '0');
            if (!/^\d{2}$/.test(h)) {continue;}
            byHour[h] = byHour[h] || { invoices: 0, revenue: 0 };
            byHour[h].invoices++;
            byHour[h].revenue = Math.round((byHour[h].revenue + Number(r.total || 0)) * 100) / 100;
        }
        const items = {};
        for (const r of rows) {
            for (const l of (Array.isArray(r.lines) ? r.lines : [])) {
                const k = `${l.code || ''}¦${l.name || ''}`;
                items[k] = items[k] || { code: l.code || '', name: l.name || '', qty: 0, total: 0 };
                items[k].qty = Math.round((items[k].qty + Number(l.qty || 0)) * 1000) / 1000;
                items[k].total = Math.round((items[k].total + Number(l.total || 0)) * 100) / 100;
            }
        }
        const topItems = Object.values(items).sort((a, b) => b.total - a.total).slice(0, 15);
        res.json({
            ok: true, date: day, cashier_no: cashier,
            invoices: rows.length, gross: total,
            discount: sum('discount'), vat: sum('vat'), net: sum('net'),
            payed, pay_split: paySplit, open: Math.round((total - payed) * 100) / 100,
            avg: rows.length ? Math.round((total / rows.length) * 100) / 100 : 0,
            printed: rows.filter((r) => r.printed).length,
            first_time: rows.length ? rows[0].doc_time : null,
            last_time: rows.length ? rows[rows.length - 1].doc_time : null,
            by_hour: byHour, top_items: topItems,
        });
    } catch (error) {
        logger.error('[mirror/close]', error);
        res.status(500).json({ error: 'MIRROR_CLOSE_FAILED', message: 'تعذر تقرير التقفيل' });
    }
});

router.post('/mirror/refresh', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const { refreshMirrorOrders } = require('./mirror');
        const out = await refreshMirrorOrders({ days: 2, io: req.io || null });
        res.json(out);
    } catch (error) {
        logger.error('[mirror/refresh]', error);
        res.status(500).json({ error: 'MIRROR_REFRESH_FAILED', message: 'تعذر التحديث اليدوي' });
    }
});

module.exports = { router, setEngine: (e) => { engineRef = e; }, previewItemImport, importItems };
