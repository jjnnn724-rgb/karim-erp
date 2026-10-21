// ═══════════════════════════════════════════════════════════════════
// Karim ERP — استوديو جرد المخزون الاحترافي (Stocktaking Studio)
// ───────────────────────────────────────────────────────────────────
// يبني على جلسات inventory_audits الموجودة ويضيف دورة عدّ حقيقية:
//   • تفاصيل جلسة حية (تقدم + فروقات متوقعة + كشف انحراف الرصيد)
//   • حفظ العد صنفاً بصنف (تلقائي) أو دفعة واحدة — بدون فقدان عمل
//   • مسح عدّ صنف (إرجاعه إلى "غير معدود")
//   • إلغاء جلسة مسودة/مُرسلة بسبب موثّق
//   • ورقة جرد ورقية قابلة للطباعة (عدّ يدوي ثم إدخال)
//   • تقرير فروقات نهائي قابل للطباعة بعد الاعتماد
// كل شيء يمر عبر سجل الأحداث والتوقيعات الموجودة أصلاً في inventory-control-routes
// ═══════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const router = express.Router();
const AUDIT_READ_ROLES = ['admin', 'manager', 'warehouse', 'accountant'];
const AUDIT_WRITE_ROLES = ['admin', 'manager', 'warehouse'];

// ─── أدوات مساعدة نقية (قابلة للاختبار) ─────────────────────────────
function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
}

function computeVariance(countedQty, systemQty, avgCost = 0) {
    const varianceQty = round(Number(countedQty) - Number(systemQty));
    const varianceValue = round(varianceQty * (Number(avgCost) || 0), 2);
    return { varianceQty, varianceValue };
}

function validateCountPayload(body) {
    const errors = [];
    const raw = Number(body?.countedQty);
    if (!Number.isFinite(raw)) {errors.push('الكمية المعدودة يجب أن تكون رقمًا صالحًا');}
    else if (raw < 0) {errors.push('الكمية المعدودة لا يمكن أن تكون سالبة');}
    else if (raw > 1e9) {errors.push('الكمية المعدودة كبيرة بشكل غير منطقي');}
    const notes = String(body?.notes ?? '').trim();
    if (notes.length > 500) {errors.push('الملاحظة أطول من 500 حرف');}
    return { errors, countedQty: round(raw), notes: notes || null };
}

function validateCancelPayload(body) {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) {return { error: 'سبب الإلغاء مطلوب (3 أحرف على الأقل)' };}
    if (reason.length > 500) {return { error: 'سبب الإلغاء أطول من 500 حرف' };}
    return { reason };
}

function normalizeScopeFilter(raw) {
    const scope = raw && typeof raw === 'object' ? raw : {};
    return {
        mode: ['all', 'category', 'search', 'in_stock'].includes(String(scope.mode)) ? String(scope.mode) : 'all',
        category: String(scope.category || '').slice(0, 120) || null,
        search: String(scope.search || '').slice(0, 120) || null,
    };
}

/**
 * نقية (Task 20): تطبيق فلتر النطاق على صفوف لقطة الجرد الخاصة بمخزن معين.
 * كل صف: { name, category, barcode, systemQty }. في الجرد بمخزن محدد
 * «ذات رصيد» تعني رصيد هذا المخزن نفسه وليس الرصيد العالمي للصنف.
 */
function filterSnapshotRows(rows, scopeFilter) {
    const scope = normalizeScopeFilter(scopeFilter);
    const search = String(scope.search || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter((row) => {
        if (scope.mode === 'in_stock' && !(Number(row.systemQty) > 0)) {return false;}
        if (scope.mode === 'category' && String(row.category || '') !== String(scope.category || '')) {return false;}
        if (scope.mode === 'search' && search) {
            const haystack = `${row.name || ''} ${row.barcode || ''}`.toLowerCase();
            if (!haystack.includes(search)) {return false;}
        }
        return true;
    });
}

/** نقية: اسم المخزن الظاهر في التقارير — من صف الموقع إن توفر وإلا من النطاق القديم. */
function resolveScopeLabel(warehouseScope, locationRow) {
    if (locationRow?.name_ar) {return String(locationRow.name_ar);}
    if (locationRow?.code) {return String(locationRow.code);}
    const raw = String(warehouseScope || 'main');
    return raw === 'main' ? 'المخزن الرئيسي' : raw;
}

function statusLabelAr(status) {
    return { draft: 'مسودة قيد العد', submitted: 'بانتظار الاعتماد', approved: 'معتمد', cancelled: 'ملغاة' }[status] || status;
}

function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtQty(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('ar-EG', { maximumFractionDigits: 3 });
}

function fmtMoney(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── مخطط ذاتي الترقية (idempotent) ────────────────────────────────
let schemaReady = null;
async function ensureStocktakingSchema() {
    if (schemaReady) {return schemaReady;}
    // FIX 2026-10-11 (M13): reset schemaReady on failure — was never reset,
    // so one transient DB error permanently poisons the schema initializer.
    schemaReady = (async () => {
        await pool.query(`
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS scope_filter JSONB NOT NULL DEFAULT '{}'::jsonb;
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS counted_items INT NOT NULL DEFAULT 0;
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(150);
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
            ALTER TABLE inventory_audit_items ADD COLUMN IF NOT EXISTS counted_at TIMESTAMPTZ;
        `);
    })().catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
}

// ─── Task 20: جرد كل مخزن على حدة ──────────────────────────────
// عمود location_id على الجلسات + ترحيل تلقائي للجلسات القديمة:
// 'main' → MAIN-WAREHOUSE، وإلا يُستنتج من كود warehouse_scope إن وُجد.
let locationSchemaReady = null;
async function ensureAuditLocationSchema() {
    if (locationSchemaReady) {return locationSchemaReady;}
    locationSchemaReady = (async () => {
        await pool.query(`
            ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS location_id BIGINT;
            CREATE INDEX IF NOT EXISTS idx_inventory_audits_location ON inventory_audits (location_id);
            UPDATE inventory_audits a
               SET location_id = l.id
              FROM inventory_locations l
             WHERE a.location_id IS NULL
               AND l.code = (CASE WHEN a.warehouse_scope = 'main' THEN 'MAIN-WAREHOUSE' ELSE a.warehouse_scope END);
        `);
    })().catch(error => { locationSchemaReady = null; throw error; });
    return locationSchemaReady;
}

// ─── استعلامات مشتركة ──────────────────────────────────────────────
async function loadAudit(client, auditId) {
    const result = await client.query('SELECT * FROM inventory_audits WHERE id = $1 FOR UPDATE', [auditId]);
    return result.rows[0] || null;
}

async function recountCountedItems(client, auditId) {
    const result = await client.query(
        `UPDATE inventory_audits a SET counted_items = s.cnt, updated_at = CURRENT_TIMESTAMP
           FROM (SELECT COUNT(*)::int AS cnt FROM inventory_audit_items
                  WHERE audit_id = $1 AND counted_at IS NOT NULL) s
         WHERE a.id = $1 RETURNING counted_items`,
        [auditId]
    );
    return Number(result.rows[0]?.counted_items || 0);
}

async function loadDetail(auditId) {
    const auditResult = await pool.query('SELECT * FROM inventory_audits WHERE id = $1', [auditId]);
    if (!auditResult.rows.length) {return null;}
    const audit = auditResult.rows[0];
    const itemsResult = await pool.query(
        `SELECT i.id, i.item_id, i.item_name, i.unit, i.system_qty, i.counted_qty,
                i.variance_qty, i.avg_cost, i.variance_value, i.notes, i.counted_at,
                CASE WHEN a.location_id IS NOT NULL
                     THEN COALESCE(lb.on_hand, 0)
                     ELSE COALESCE(inv.qty, 0) END AS live_qty,
                COALESCE(inv.category, '') AS category,
                COALESCE(inv.barcode, '') AS barcode,
                loc.name_ar AS location_name
           FROM inventory_audit_items i
           JOIN inventory_audits a ON a.id = i.audit_id
      LEFT JOIN inventory inv ON inv.id = i.item_id
      LEFT JOIN inventory_location_balances lb
             ON lb.inventory_id = i.item_id AND lb.location_id = a.location_id
      LEFT JOIN inventory_locations loc ON loc.id = a.location_id
          WHERE i.audit_id = $1
          ORDER BY i.counted_at DESC NULLS LAST, i.item_name`,
        [auditId]
    );
    const items = itemsResult.rows.map((row) => {
        const counted = row.counted_at != null;
        const stale = counted && Math.abs(Number(row.live_qty) - Number(row.system_qty)) > 0.0005;
        return {
            ...row,
            is_counted: counted,
            is_stale: stale,
            system_qty: Number(row.system_qty),
            counted_qty: Number(row.counted_qty),
            variance_qty: Number(row.variance_qty),
            variance_value: Number(row.variance_value),
            avg_cost: Number(row.avg_cost),
            live_qty: Number(row.live_qty),
        };
    });
    const countedItems = items.filter((item) => item.is_counted);
    const varianceItems = countedItems.filter((item) => item.variance_qty !== 0);
    const progress = {
        total: items.length,
        counted: countedItems.length,
        remaining: items.length - countedItems.length,
        percent: items.length ? Math.round((countedItems.length / items.length) * 100) : 0,
    };
    const summary = {
        items_with_variance: varianceItems.length,
        shortage_items: varianceItems.filter((item) => item.variance_qty < 0).length,
        surplus_items: varianceItems.filter((item) => item.variance_qty > 0).length,
        projected_variance_value: round(varianceItems.reduce((sum, item) => sum + item.variance_value, 0), 2),
        stale_items: items.filter((item) => item.is_stale).length,
    };
    const eventsResult = await pool.query(
        'SELECT event_type, from_status, to_status, actor_role, event_payload, created_at FROM inventory_audit_workflow_events WHERE audit_id = $1 ORDER BY id ASC',
        [auditId]
    );
    return { audit, items, progress, summary, events: eventsResult.rows, location_name: itemsResult.rows[0]?.location_name || resolveScopeLabel(audit.warehouse_scope, null) };
}

// ─── 0) قائمة مخازن الجرد المتاحة (منتقي المخزن في الاستوديو) ─────
router.get('/inventory/locations', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        await ensureAuditLocationSchema();
        const rows = (await pool.query(`
            SELECT l.id, l.code, l.name_ar, l.location_type, l.dept_code,
                   COALESCE(d.name, l.dept_code) AS dept_name,
                   COUNT(b.inventory_id)::int AS items_count,
                   COALESCE(SUM(GREATEST(b.on_hand, 0) * inv."avgCost"), 0)::numeric(14,2) AS on_hand_value,
                   COALESCE(SUM(GREATEST(b.on_hand, 0)), 0)::numeric(14,3) AS on_hand_qty
              FROM inventory_locations l
         LEFT JOIN inventory_location_balances b ON b.location_id = l.id
         LEFT JOIN inventory inv ON inv.id = b.inventory_id
         LEFT JOIN departments d ON d.code = l.dept_code
             WHERE l.active = true
          GROUP BY l.id, d.name
          ORDER BY (l.code = 'MAIN-WAREHOUSE') DESC, l.name_ar
        `)).rows;
        res.json(rows);
    } catch (error) {
        logger.error('[stocktaking_locations]', error);
        res.status(500).json({ error: 'STOCKTAKING_LOCATIONS_FAILED', message: 'تعذر تحميل مخازن الجرد' });
    }
});

// ─── 0-ب) معاينة حية لنطاق الجرد على مخزن محدد ─────────────────────
router.get('/inventory/locations/:id/preview', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        await ensureAuditLocationSchema();
        const locationId = Number(req.params.id);
        if (!Number.isInteger(locationId) || locationId <= 0) {return res.status(422).json({ error: 'LOCATION_ID_INVALID', message: 'معرف المخزن غير صحيح' });}
        const scope = normalizeScopeFilter(req.query);
        String(scope.search || '').trim().toLowerCase();
        const rows = (await pool.query(`
            SELECT inv.name, COALESCE(inv.barcode,'') AS barcode, COALESCE(inv.category,'') AS category, b.on_hand AS system_qty, inv."avgCost"
              FROM inventory inv
              JOIN inventory_location_balances b ON b.inventory_id = inv.id AND b.location_id = $1
        `, [locationId])).rows;
        const filtered = filterSnapshotRows(rows, scope);
        const value = filtered.reduce((sum, row) => sum + (Math.max(Number(row.system_qty), 0) * Number(row.avgCost || 0)), 0);
        const qty = filtered.reduce((sum, row) => sum + Math.max(Number(row.system_qty), 0), 0);
        res.json({ items_count: filtered.length, on_hand_value: Math.round(value * 100) / 100, on_hand_qty: Math.round(qty * 1000) / 1000 });
    } catch (error) {
        logger.error('[stocktaking_location_preview]', error);
        res.status(500).json({ error: 'STOCKTAKING_PREVIEW_FAILED', message: 'تعذر توليد معاينة نطاق الجرد' });
    }
});

// ─── 1) تفاصيل الجلسة (تقدم + فروقات + أحداث) ──────────────────────
router.get('/inventory/audits/:id', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        await ensureStocktakingSchema();
        const detail = await loadDetail(Number(req.params.id));
        if (!detail) {return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' });}
        res.json(detail);
    } catch (error) {
        logger.error('[stocktaking_detail]', error);
        res.status(500).json({ error: 'STOCKTAKING_DETAIL_FAILED', message: 'تعذر تحميل تفاصيل جلسة الجرد' });
    }
});

// ─── 2) حفظ عدّ صنف واحد (تلقائي أثناء العد) ───────────────────────
router.put('/inventory/audits/:id/counts/:itemId', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureStocktakingSchema();
        const { errors, countedQty, notes } = validateCountPayload(req.body || {});
        if (errors.length) {return res.status(422).json({ error: 'INVALID_COUNT', message: errors.join(' — ') });}
        await client.query('BEGIN');
        const audit = await loadAudit(client, Number(req.params.id));
        if (!audit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' }); }
        if (audit.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'AUDIT_LOCKED', message: 'لا يمكن تعديل العد إلا في الجلسات المسودة' });
        }
        const itemResult = await client.query(
            'SELECT * FROM inventory_audit_items WHERE audit_id = $1 AND item_id = $2 FOR UPDATE',
            [audit.id, Number(req.params.itemId)]
        );
        const item = itemResult.rows[0];
        if (!item) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_ITEM_NOT_FOUND', message: 'الصنف غير مضمّن في هذه الجلسة' }); }
        const { varianceQty, varianceValue } = computeVariance(countedQty, item.system_qty, item.avg_cost);
        const updatedItem = (await client.query(
            `UPDATE inventory_audit_items
                SET counted_qty = $3, notes = $4, counted_at = CURRENT_TIMESTAMP,
                    variance_qty = $5, variance_value = $6
              WHERE id = $1 AND audit_id = $2
              RETURNING *`,
            [item.id, audit.id, countedQty, notes, varianceQty, varianceValue]
        )).rows[0];
        const countedItems = await recountCountedItems(client, audit.id);
        await client.query('COMMIT');
        req.io?.emit('entity_changed', { entity: 'inventoryAudits', entityName: 'inventoryAudits', action: 'update', data: { id: audit.id, counted_items: countedItems }, changedBy: req.user?.username || req.ip, changedAt: new Date().toISOString() });
        res.json({
            item: { ...updatedItem, is_counted: true, counted_qty: Number(updatedItem.counted_qty), variance_qty: Number(updatedItem.variance_qty), variance_value: Number(updatedItem.variance_value) },
            counted_items: countedItems,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[stocktaking_save_count]', error);
        res.status(500).json({ error: 'STOCKTAKING_COUNT_SAVE_FAILED', message: 'تعذر حفظ العد' });
    } finally { client.release(); }
});

// ─── 3) حفظ دفعة عدّ (للمسح المتواصل أو الإدخال الورقي دفعة واحدة) ──
router.post('/inventory/audits/:id/counts', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureStocktakingSchema();
        const counts = Array.isArray(req.body?.counts) ? req.body.counts.slice(0, 2000) : [];
        if (!counts.length) {return res.status(422).json({ error: 'EMPTY_BATCH', message: 'لا توجد كميات في الدفعة' });}
        await client.query('BEGIN');
        const audit = await loadAudit(client, Number(req.params.id));
        if (!audit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' }); }
        if (audit.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'AUDIT_LOCKED', message: 'لا يمكن تعديل العد إلا في الجلسات المسودة' });
        }
        const saved = [], rejected = [];
        for (const raw of counts) {
            const { errors, countedQty, notes } = validateCountPayload(raw || {});
            if (errors.length) { rejected.push({ itemId: Number(raw?.itemId), reason: errors.join(' — ') }); continue; }
            const itemResult = await client.query(
                'SELECT id, system_qty, avg_cost FROM inventory_audit_items WHERE audit_id = $1 AND item_id = $2 FOR UPDATE',
                [audit.id, Number(raw?.itemId)]
            );
            const item = itemResult.rows[0];
            if (!item) { rejected.push({ itemId: Number(raw?.itemId), reason: 'الصنف غير مضمّن في الجلسة' }); continue; }
            const { varianceQty, varianceValue } = computeVariance(countedQty, item.system_qty, item.avg_cost);
            const row = (await client.query(
                `UPDATE inventory_audit_items
                    SET counted_qty = $3, notes = $4, counted_at = CURRENT_TIMESTAMP,
                        variance_qty = $5, variance_value = $6
                  WHERE id = $1 AND audit_id = $2 RETURNING id, item_id, counted_qty, variance_qty, variance_value`,
                [item.id, audit.id, countedQty, notes, varianceQty, varianceValue]
            )).rows[0];
            saved.push(row);
        }
        const countedItems = await recountCountedItems(client, audit.id);
        await client.query('COMMIT');
        req.io?.emit('entity_changed', { entity: 'inventoryAudits', entityName: 'inventoryAudits', action: 'update', data: { id: audit.id, counted_items: countedItems }, changedBy: req.user?.username || req.ip, changedAt: new Date().toISOString() });
        res.json({ saved_count: saved.length, rejected, counted_items: countedItems });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[stocktaking_bulk_counts]', error);
        res.status(500).json({ error: 'STOCKTAKING_BULK_FAILED', message: 'تعذر حفظ دفعة العد' });
    } finally { client.release(); }
});

// ─── 4) مسح عدّ صنف (إرجاعه إلى "غير معدود") ───────────────────────
router.delete('/inventory/audits/:id/counts/:itemId', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureStocktakingSchema();
        await client.query('BEGIN');
        const audit = await loadAudit(client, Number(req.params.id));
        if (!audit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' }); }
        if (audit.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'AUDIT_LOCKED', message: 'لا يمكن تعديل العد إلا في الجلسات المسودة' });
        }
        const itemResult = await client.query(
            'SELECT * FROM inventory_audit_items WHERE audit_id = $1 AND item_id = $2 FOR UPDATE',
            [audit.id, Number(req.params.itemId)]
        );
        const item = itemResult.rows[0];
        if (!item) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_ITEM_NOT_FOUND', message: 'الصنف غير مضمّن في هذه الجلسة' }); }
        const cleared = (await client.query(
            `UPDATE inventory_audit_items
                SET counted_qty = system_qty, notes = NULL, counted_at = NULL,
                    variance_qty = 0, variance_value = 0
              WHERE id = $1 RETURNING *`,
            [item.id]
        )).rows[0];
        const countedItems = await recountCountedItems(client, audit.id);
        await client.query('COMMIT');
        res.json({ item: { ...cleared, is_counted: false }, counted_items: countedItems });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[stocktaking_clear_count]', error);
        res.status(500).json({ error: 'STOCKTAKING_CLEAR_FAILED', message: 'تعذر مسح العد' });
    } finally { client.release(); }
});

// ─── 5) إلغاء الجلسة (مسودة أو مُرسلة) بسبب موثّق ───────────────────
router.post('/inventory/audits/:id/cancel', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureStocktakingSchema();
        const { error, reason } = validateCancelPayload(req.body || {});
        if (error) {return res.status(422).json({ error: 'CANCEL_REASON_REQUIRED', message: error });}
        await client.query('BEGIN');
        const audit = await loadAudit(client, Number(req.params.id));
        if (!audit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' }); }
        if (!['draft', 'submitted'].includes(audit.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'AUDIT_NOT_CANCELLABLE', message: 'لا يمكن إلغاء جلسة معتمدة أو ملغاة مسبقاً' });
        }
        const actor = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(
            `UPDATE inventory_audits
                SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
                    cancelled_by = $2, cancel_reason = $3, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 RETURNING *`,
            [audit.id, actor, reason]
        )).rows[0];
        // حدث سلسلة ربط موثّق بنفس آلية appendInventoryAuditEvent (event_hash متسلسل)
        const actorRole = req.user?.role || 'unknown';
        const previousHash = (await client.query('SELECT event_hash FROM inventory_audit_workflow_events WHERE audit_id=$1 ORDER BY id DESC LIMIT 1', [audit.id])).rows[0]?.event_hash || null;
        const canonicalPayload = { auditId: audit.id, eventType: 'cancelled', fromStatus: audit.status, toStatus: 'cancelled', actorUserId: req.user?.id || null, actorRole, signatureHash: null, payload: { reason, actor }, previous: previousHash };
        const eventHash = crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
        await client.query(
            `INSERT INTO inventory_audit_workflow_events
                (audit_id, event_type, from_status, to_status, actor_user_id, actor_role, event_payload, previous_event_hash, event_hash)
             VALUES ($1, 'cancelled', $2, 'cancelled', $3, $4, $5, $6, $7)`,
            [audit.id, audit.status, req.user?.id || null, actorRole, JSON.stringify({ reason, actor }), previousHash, eventHash]
        );
        await client.query('COMMIT');
        req.io?.emit('entity_changed', { entity: 'inventoryAudits', entityName: 'inventoryAudits', action: 'update', data: updated, changedBy: req.user?.username || req.ip, changedAt: new Date().toISOString() });
        res.json({ audit: updated, message: 'تم إلغاء جلسة الجرد دون أي تأثير على الأرصدة' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[stocktaking_cancel]', error);
        res.status(500).json({ error: 'STOCKTAKING_CANCEL_FAILED', message: 'تعذر إلغاء جلسة الجرد' });
    } finally { client.release(); }
});

// ─── طباعة: هياكل HTML مشتركة ──────────────────────────────────────
const PRINT_BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1a1a1a; padding: 22px 26px; max-width: 210mm; margin: 0 auto; }
  .ph { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #d4a843; padding-bottom: 12px; margin-bottom: 14px; }
  .ph h1 { font-size: 20px; color: #7a5c14; }
  .ph .brand { font-size: 15px; font-weight: 800; }
  .ph .sub { font-size: 11.5px; color: #666; margin-top: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .meta div { border: 1px solid #e3dcc8; background: #faf7ef; border-radius: 8px; padding: 6px 12px; font-size: 12px; min-width: 150px; }
  .meta span { display: block; color: #8a7a4e; font-size: 10.5px; }
  .meta strong { font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #d9d2bd; padding: 6px 8px; font-size: 11.5px; text-align: right; vertical-align: middle; }
  th { background: #f5f0e6; color: #6b5417; font-weight: 800; }
  td.c, th.c { text-align: center; }
  .stamp { display: inline-block; border: 2.5px solid; border-radius: 8px; padding: 4px 16px; font-weight: 900; font-size: 15px; transform: rotate(-6deg); }
  .stamp.draft { color: #b7791f; border-color: #b7791f; }
  .stamp.submitted { color: #1d4ed8; border-color: #1d4ed8; }
  .stamp.approved { color: #047857; border-color: #047857; }
  .stamp.cancelled { color: #b91c1c; border-color: #b91c1c; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .card { flex: 1; min-width: 140px; border: 1px solid #e3dcc8; border-radius: 10px; padding: 10px 12px; background: #faf7ef; }
  .card span { display: block; font-size: 10.5px; color: #8a7a4e; margin-bottom: 3px; }
  .card strong { font-size: 17px; }
  .card.neg strong { color: #b91c1c; }
  .card.pos strong { color: #047857; }
  .sig-row { display: flex; gap: 40px; margin-top: 30px; }
  .sig-row div { flex: 1; border-top: 1.5px solid #999; padding-top: 6px; font-size: 11.5px; color: #555; text-align: center; }
  .footer { margin-top: 18px; border-top: 1px dashed #bbb; padding-top: 8px; font-size: 10.5px; color: #888; display: flex; justify-content: space-between; }
  .no-print { margin-bottom: 14px; }
  .no-print button { font-family: inherit; background: #d4a843; border: 0; color: #fff; font-weight: 800; padding: 9px 22px; border-radius: 9px; cursor: pointer; font-size: 13px; }
  @media print { .no-print { display: none; } body { padding: 0; } }
`;

function printShell(title, bodyHtml) {
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;800;900&display=swap" rel="stylesheet">
<style>${PRINT_BASE_CSS}</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">🖨 طباعة</button></div>
${bodyHtml}
</body>
</html>`;
}

function auditHeader(audit, subtitle, locationName) {
    const scope = audit.scope_filter && typeof audit.scope_filter === 'object' ? audit.scope_filter : {};
    const scopeText = scope.mode === 'category' ? `فئة: ${scope.category}` : scope.mode === 'search' ? `بحث: ${scope.search}` : scope.mode === 'in_stock' ? 'أصناف ذات رصيد فقط' : 'كل الأصناف';
    const storeLabel = locationName || resolveScopeLabel(audit.warehouse_scope, null);
    return `
<div class="ph">
  <div>
    <div class="brand">مطاعم الشرفه العالمي</div>
    <h1>${escHtml(subtitle)}</h1>
    <div class="sub">جلسة الجرد ${escHtml(audit.audit_number)} — المخزن: ${escHtml(storeLabel)} — النطاق: ${escHtml(scopeText)}</div>
  </div>
  <div style="text-align:left">
    <span class="stamp ${escHtml(audit.status)}">${statusLabelAr(audit.status)}</span>
    <div class="sub">تاريخ العد: ${escHtml(String(audit.counted_at).slice(0, 10))}</div>
  </div>
</div>`;
}

// ─── 6) ورقة جرد ورقية (للطباعة والعد اليدوي) ──────────────────────
router.get('/inventory/audits/:id/count-sheet', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        await ensureStocktakingSchema();
        const detail = await loadDetail(Number(req.params.id));
        if (!detail) {return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' });}
        const rows = detail.items.map((item, index) => `
<tr>
  <td class="c">${index + 1}</td>
  <td><strong>${escHtml(item.item_name)}</strong></td>
  <td class="c">${escHtml(item.barcode || '—')}</td>
  <td class="c">${escHtml(item.category || '—')}</td>
  <td class="c">${escHtml(item.unit || '—')}</td>
  <td class="c">${fmtQty(item.system_qty)}</td>
  <td style="height:30px"></td>
  <td style="width:110px"></td>
</tr>`).join('');
        const body = `
${auditHeader(detail.audit, 'ورقة جرد المخزون — عدّ يدوي', detail.location_name)}
<div class="meta">
  <div><span>عدد الأصناف</span><strong>${detail.items.length}</strong></div>
  <div><span>الفترة</span><strong>${escHtml(String(detail.audit.period_start || ''))} ← ${escHtml(String(detail.audit.period_end || ''))}</strong></div>
  <div><span>أنشأها</span><strong>${escHtml(detail.audit.created_by)}</strong></div>
</div>
<table>
<thead><tr><th class="c">#</th><th>الصنف</th><th class="c">الباركود</th><th class="c">الفئة</th><th class="c">الوحدة</th><th class="c">رصيد النظام</th><th class="c">العدّ الفعلي</th><th class="c">ملاحظات</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="sig-row"><div>مندوب الجرد — الاسم والتوقيع</div><div>المراجع / المعتمد — الاسم والتوقيع</div></div>
<div class="footer"><span>تُعدّ هذه الورقة ورقياً ثم تُدخل الكميات في النظام وتُحفظ مع الجلسة.</span><span>Karim ERP — ${new Date().toLocaleString('ar-EG')}</span></div>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(printShell(`ورقة جرد ${detail.audit.audit_number}`, body));
    } catch (error) {
        logger.error('[stocktaking_count_sheet]', error);
        res.status(500).json({ error: 'STOCKTAKING_SHEET_FAILED', message: 'تعذر توليد ورقة الجرد' });
    }
});

// ─── 7) تقرير فروقات قابل للطباعة ──────────────────────────────────
router.get('/inventory/audits/:id/report', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        await ensureStocktakingSchema();
        const detail = await loadDetail(Number(req.params.id));
        if (!detail) {return res.status(404).json({ error: 'AUDIT_NOT_FOUND', message: 'جلسة الجرد غير موجودة' });}
        const { audit, items, progress, summary } = detail;
        const varianceRows = items.filter((item) => item.is_counted && item.variance_qty !== 0).map((item) => `
<tr${item.variance_qty < 0 ? ' style="background:#fdf0ef"' : ' style="background:#f0faf5"'}>
  <td><strong>${escHtml(item.item_name)}</strong></td>
  <td class="c">${escHtml(item.unit || '—')}</td>
  <td class="c">${fmtQty(item.system_qty)}</td>
  <td class="c">${fmtQty(item.counted_qty)}</td>
  <td class="c" style="font-weight:800;color:${item.variance_qty < 0 ? '#b91c1c' : '#047857'}">${item.variance_qty > 0 ? '+' : ''}${fmtQty(item.variance_qty)}</td>
  <td class="c">${fmtMoney(item.avg_cost)}</td>
  <td class="c" style="font-weight:800;color:${item.variance_value < 0 ? '#b91c1c' : '#047857'}">${fmtMoney(item.variance_value)}</td>
  <td>${escHtml(item.notes || '—')}</td>
</tr>`).join('') || '<tr><td colspan="8" class="c" style="color:#888;padding:14px">لا توجد فروقات — العد مطابق تماماً لرصيد النظام</td></tr>';
        const allRows = items.map((item) => `
<tr>
  <td>${escHtml(item.item_name)}</td>
  <td class="c">${fmtQty(item.system_qty)}</td>
  <td class="c">${item.is_counted ? fmtQty(item.counted_qty) : '<span style="color:#aaa">لم يُعدّ</span>'}</td>
  <td class="c">${item.is_counted ? (item.variance_qty === 0 ? 'مطابق' : item.variance_qty > 0 ? `+${fmtQty(item.variance_qty)}` : fmtQty(item.variance_qty)) : '—'}</td>
</tr>`).join('');
        const projected = audit.status === 'approved' ? Number(audit.total_variance_value) : summary.projected_variance_value;
        const body = `
${auditHeader(audit, 'تقرير فروقات الجرد', detail.location_name)}
<div class="cards">
  <div class="card"><span>الأصناف</span><strong>${progress.total}</strong></div>
  <div class="card"><span>معدود</span><strong>${progress.counted} (${progress.percent}%)</strong></div>
  <div class="card"><span>أصناف بفروقات</span><strong>${summary.items_with_variance}</strong></div>
  <div class="card neg"><span>نقص</span><strong>${summary.shortage_items}</strong></div>
  <div class="card pos"><span>زيادة</span><strong>${summary.surplus_items}</strong></div>
  <div class="card ${projected < 0 ? 'neg' : 'pos'}"><span>صافي قيمة الفروقات</span><strong>${fmtMoney(projected)}</strong></div>
</div>
<h2 style="font-size:14px;color:#6b5417;margin-bottom:8px">تفصيل الفروقات</h2>
<table>
<thead><tr><th>الصنف</th><th class="c">الوحدة</th><th class="c">رصيد النظام</th><th class="c">العدّ الفعلي</th><th class="c">الفرق</th><th class="c">متوسط التكلفة</th><th class="c">قيمة الفرق</th><th>ملاحظة</th></tr></thead>
<tbody>${varianceRows}</tbody>
</table>
${audit.status === 'cancelled' ? `<div class="meta"><div><span>سبب الإلغاء</span><strong>${escHtml(audit.cancel_reason || '—')}</strong></div><div><span>ألغاها</span><strong>${escHtml(audit.cancelled_by || '—')}</strong></div></div>` : ''}
<h2 style="font-size:14px;color:#6b5417;margin:14px 0 8px">كل الأصناف (${items.length})</h2>
<table>
<thead><tr><th>الصنف</th><th class="c">رصيد النظام</th><th class="c">العدّ الفعلي</th><th class="c">الفرق</th></tr></thead>
<tbody>${allRows}</tbody>
</table>
${audit.status === 'approved' ? `<div class="meta"><div><span>اعتُمد بواسطة</span><strong>${escHtml(audit.approved_by || '—')}</strong></div><div><span>تاريخ الاعتماد</span><strong>${escHtml(String(audit.approved_at || '').slice(0, 16).replace('T', ' '))}</strong></div></div>` : ''}
<div class="sig-row"><div>مندوب الجرد</div><div>المحاسب</div><div>المدير المسؤول</div></div>
<div class="footer"><span>الفروقات المعتمدة تُسجَّل كحركات تصحيح جرد في سجل المخزون ولا تُحذف أبداً.</span><span>Karim ERP</span></div>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(printShell(`تقرير جرد ${audit.audit_number}`, body));
    } catch (error) {
        logger.error('[stocktaking_report]', error);
        res.status(500).json({ error: 'STOCKTAKING_REPORT_FAILED', message: 'تعذر توليد تقرير الجرد' });
    }
});

module.exports = {
    router,
    ensureStocktakingSchema,
    ensureAuditLocationSchema,
    // نقية — للاختبارات
    computeVariance,
    validateCountPayload,
    validateCancelPayload,
    normalizeScopeFilter,
    filterSnapshotRows,
    resolveScopeLabel,
    buildCountSheetHtml: printShell,
};
