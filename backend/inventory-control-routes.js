const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { normalizeScopeFilter, filterSnapshotRows, ensureAuditLocationSchema } = require('./stocktaking-routes');

const router = express.Router();
const AUDIT_READ_ROLES = ['admin', 'manager', 'warehouse', 'accountant'];
const AUDIT_WRITE_ROLES = ['admin', 'manager', 'warehouse'];
const RESET_ROLES = ['admin'];
const FULL_RESET_CONFIRMATION = 'CONFIRM PRODUCTION RESET';

function id() { return Date.now() + Math.floor(Math.random() * 9999); }
function n(value, fallback = 0) { const v = Number(value); return Number.isFinite(v) ? v : fallback; }
function round(value, decimals = 3) { const factor = 10 ** decimals; return Math.round(n(value) * factor) / factor; }
function dateOnly(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {return raw.slice(0, 10);}
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}
function json(value) { return JSON.stringify(value ?? null); }
function fail(res, status, error, message, extra = {}) { return res.status(status).json({ error, message, ...extra }); }
function normalizeSignature(value) {
    const signature = String(value || '').trim();
    if (!signature || signature.length > 250000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signature)) {return null;}
    return signature;
}
function signatureHash(signature) { return signature ? crypto.createHash('sha256').update(signature).digest('hex') : null; }
// صاحب الحساب فقط يوقّع باسمه — لا يجوز توقيع أي اسم آخر
function normalizeSignerName(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function signerMatchesAccount(provided, user) {
    const p = normalizeSignerName(provided).toLowerCase();
    if (!p) {return false;}
    return [user?.name, user?.username].map(v => normalizeSignerName(v).toLowerCase()).filter(Boolean).includes(p);
}
function accountDisplayName(user) { return normalizeSignerName(user?.name || user?.username || ''); }
function getSignature(req, res) {
    const signature = normalizeSignature(req.body?.signatureData);
    if (!signature) { fail(res, 422, 'SIGNATURE_REQUIRED', 'التوقيع الإلكتروني مطلوب لإرسال أو اعتماد الجرد'); return null; }
    const signerName = req.body?.signerName ?? req.body?.signatureName ?? req.body?.signer;
    if (!normalizeSignerName(signerName)) { fail(res, 422, 'SIGNER_NAME_REQUIRED', 'اسم الموقّع مطلوب ويجب أن يطابق اسم صاحب الحساب المسجل دخوله'); return null; }
    if (!signerMatchesAccount(signerName, req.user)) { fail(res, 403, 'SIGNER_MISMATCH', `التوقيع باسم صاحب الحساب فقط — لا يجوز توقيع اسم آخر (الحساب: ${accountDisplayName(req.user) || 'غير معروف'})`); return null; }
    return signature;
}
async function appendInventoryAuditEvent(client, auditId, eventType, fromStatus, toStatus, req, signature, payload = {}) {
    const previous = (await client.query('SELECT event_hash FROM inventory_audit_workflow_events WHERE audit_id=$1 ORDER BY id DESC LIMIT 1', [auditId])).rows[0]?.event_hash || null;
    const actorRole = req.user?.role || 'unknown';
    const canonicalPayload = { auditId, eventType, fromStatus: fromStatus || null, toStatus, actorUserId: req.user?.id || null, actorRole, signatureHash: signatureHash(signature), payload, previous };
    const eventHash = crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
    const row = (await client.query(`INSERT INTO inventory_audit_workflow_events(audit_id,event_type,from_status,to_status,actor_user_id,actor_role,signature_hash,event_payload,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [auditId, eventType, fromStatus || null, toStatus, req.user?.id || null, actorRole, signatureHash(signature), json(payload), previous, eventHash])).rows[0];
    return row;
}
function emit(req, entity, action, data) {
    req.io?.emit('entity_changed', { entity, entityName: entity, action, data, changedBy: req.user?.username || req.ip, changedAt: new Date().toISOString() });
}
function normalizeCountedItems(items) {
    const rows = Array.isArray(items) ? items : [];
    const seen = new Set();
    return rows.map(raw => ({
        itemId: Number(raw.itemId),
        countedQty: round(raw.countedQty),
        notes: String(raw.notes || '').trim() || null,
    })).filter(row => row.itemId > 0 && row.countedQty >= 0 && !seen.has(row.itemId) && seen.add(row.itemId));
}

// ─── كلفة الأقسام: كل فروق الجرد تُسجَّل مصروفًا على القسم صاحب المخزن ───
// النقص (عجز) = مصروف موجب، الزيادة = مصروف سالب (دائن) بنمط عكس الصرف.
// دالة نقية قابلة للاختبار — تُستخدم في مسار الاعتماد لكل صنف بفارق فعلي.
function buildStocktakeExpense({ itemName, unit, varianceQty, varianceValue, deptCode, auditNumber, txId, countedAt }) {
    const qty = round(Math.abs(n(varianceQty)));
    const value = round(Math.abs(n(varianceValue)), 2);
    const isShortage = n(varianceQty) < 0;
    const desc = `${isShortage ? 'عجز جرد' : 'زيادة جرد'} — ${itemName} (${qty} ${unit || 'وحدة'})`;
    return {
        desc,
        // عجز: مصروف موجب يرفع كلفة القسم — زيادة: مصروف سالب (دائن) يعيدها
        amount: isShortage ? value : -value,
        deptId: deptCode || null,
        autoGenerated: true,
        category: 'مواد خام',
        adjustmentType: 'count_correction',
        date: dateOnly(countedAt),
        notes: `جرد ${auditNumber} — حركة مخزون ${txId}`,
    };
}

// مخطط ذاتي الترقية: ربط مخازن المواقع بالأقسام حتى تُحمَّل كلفة المخزون
// (عجز الجرد/الفاقد) على القسم صاحب المخزن تلقائيًا بدون أي إعداد يدوي.
let locationDeptSchemaReady = null;
function ensureLocationDeptSchema() {
    if (locationDeptSchemaReady) {return locationDeptSchemaReady;}
    locationDeptSchemaReady = (async () => {
        await pool.query(`
            ALTER TABLE inventory_locations ADD COLUMN IF NOT EXISTS dept_code VARCHAR(50) REFERENCES departments(code) ON DELETE SET NULL;
            UPDATE inventory_locations SET dept_code='kitchen' WHERE code='KITCHEN-MAIN' AND dept_code IS NULL;
        `);
    })().catch(error => { locationDeptSchemaReady = null; throw error; });
    return locationDeptSchemaReady;
}

router.get('/inventory/audits', jwtAuth, requireRole(...AUDIT_READ_ROLES), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, COALESCE(COUNT(i.id), 0)::int AS item_count
            FROM inventory_audits a
            LEFT JOIN inventory_audit_items i ON i.audit_id = a.id
            GROUP BY a.id
            ORDER BY a.created_at DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('[inventory_audits_list]', error);
        res.status(500).json({ error: 'INVENTORY_AUDITS_LIST_FAILED', message: 'تعذر تحميل سجلات الجرد' });
    }
});

router.post('/inventory/audits', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Task 20: جرد كل مخزن على حدة — اللقطة تُبنى من رصيد المخزن المختار
        // (inventory_location_balances) وليس من الإسقاط العالمي inventory.qty.
        try { await ensureAuditLocationSchema(); } catch (error) { logger.error('[inventory_audits_location_schema]', error); }
        const countedItems = normalizeCountedItems(req.body?.items);
        const locationRow = (await client.query(
            `SELECT id, code, name_ar, dept_code FROM inventory_locations
              WHERE active = true AND ($1::bigint IS NOT NULL AND id = $1 OR $2::text IS NOT NULL AND LOWER(code) = LOWER($2))
              LIMIT 1`,
            [req.body?.locationId ? Number(req.body.locationId) : null, req.body?.locationCode ? String(req.body.locationCode).trim() : null]
        )).rows[0];
        if ((req.body?.locationId || req.body?.locationCode) && !locationRow) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'AUDIT_LOCATION_NOT_FOUND', 'مخزن الجرد المطلوب غير موجود أو غير مفعّل');
        }
        const auditLocation = locationRow || (await client.query(`SELECT id, code, name_ar, dept_code FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1`)).rows[0];
        if (!auditLocation) { await client.query('ROLLBACK'); return fail(res, 500, 'AUDIT_LOCATION_UNCONFIGURED', 'المخزن الرئيسي غير مهيأ — لا يمكن بدء الجرد'); }
        const scopeFilter = normalizeScopeFilter(req.body?.scopeFilter);
        // لقطة رصيد المخزن المختار: أصناف له سجل رصيد في هذا الموقع،
        // والأصناف المحددة صراحة تُقبل حتى بلا سجل (رصيدها 0).
        const snapshotRows = (await client.query(`
            SELECT inv.id AS item_id, inv.name, inv.unit, COALESCE(inv.category,'') AS category,
                   COALESCE(inv.barcode,'') AS barcode, inv."avgCost" AS avg_cost, COALESCE(b.on_hand, 0) AS system_qty
              FROM inventory inv
              LEFT JOIN inventory_location_balances b ON b.inventory_id = inv.id AND b.location_id = $1
             ORDER BY inv.name
        `, [auditLocation.id])).rows;

        const selected = countedItems.length
            ? countedItems
            : filterSnapshotRows(snapshotRows, scopeFilter).map(row => ({ itemId: Number(row.item_id), countedQty: n(row.system_qty), notes: null }));
        const byId = new Map(snapshotRows.map(row => [Number(row.item_id), row]));
        // الأصناف المحددة صراحة بلا سجل رصيد في هذا المخزن تُقبل برصيد 0
        for (const row of countedItems) {
            if (byId.has(row.itemId)) {continue;}
            const inv = (await client.query('SELECT id, name, unit, COALESCE(category,\'\') AS category, COALESCE(barcode,\'\') AS barcode, "avgCost" FROM inventory WHERE id = $1', [row.itemId])).rows[0];
            if (inv) {byId.set(Number(inv.id), { item_id: inv.id, name: inv.name, unit: inv.unit, category: inv.category, barcode: inv.barcode, avg_cost: n(inv.avgCost), system_qty: 0 });}
        }
        const valid = selected.filter(row => byId.has(row.itemId));
        if (!valid.length) { await client.query('ROLLBACK'); return fail(res, 422, 'EMPTY_AUDIT', 'لا توجد أصناف في هذا المخزن مطابقة للنطاق المختار'); }
        const auditId = id();
        // معرّفات متسلسلة فريدة لبنود الجرد: id() وحده (ms + عشوائي صغير)
        // يتصادم حتمًا في الحلقات السريعة (1085 صنفًا في نفس الميلي ثانية)
        const itemIdBase = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        const auditNumber = `AUD-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${String(auditId).slice(-4)}`;
        const countedAt = dateOnly(req.body?.countedAt);
        const periodType = ['daily','weekly','monthly','custom','annual'].includes(String(req.body?.periodType)) ? String(req.body.periodType) : 'custom';
        const periodStart = dateOnly(req.body?.periodStart || countedAt);
        const periodEnd = dateOnly(req.body?.periodEnd || periodStart);
        if (periodEnd < periodStart) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_AUDIT_PERIOD', 'نهاية فترة الجرد لا يمكن أن تسبق بدايتها'); }
        const audit = (await client.query(`
            INSERT INTO inventory_audits (id, audit_number, status, warehouse_scope, location_id, counted_at, created_by, notes, total_items, period_type, period_start, period_end, scope_filter)
            VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
        `, [auditId, auditNumber, auditLocation.code, auditLocation.id, countedAt, req.user.name || req.user.username || String(req.user.id), req.body?.notes || null, valid.length, periodType, periodStart, periodEnd, JSON.stringify(scopeFilter)])).rows[0];
        for (const [idx, row] of valid.entries()) {
            const item = byId.get(row.itemId);
            const systemQty = round(n(item.system_qty));
            const varianceQty = round(row.countedQty - systemQty);
            const varianceValue = round(varianceQty * n(item.avg_cost), 2);
            await client.query(`
                INSERT INTO inventory_audit_items (id, audit_id, item_id, item_name, unit, system_qty, counted_qty, variance_qty, avg_cost, variance_value, notes)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            `, [itemIdBase + idx, auditId, item.item_id, item.name, item.unit, systemQty, row.countedQty, varianceQty, n(item.avg_cost), varianceValue, row.notes]);
        }
        await appendInventoryAuditEvent(client, auditId, 'created', null, 'draft', req, null, { periodType, periodStart, periodEnd, warehouseScope: audit.warehouse_scope, location: auditLocation.code, totalItems: valid.length });
        await client.query('COMMIT');
        emit(req, 'inventoryAudits', 'create', audit);
        res.status(201).json({ audit, itemCount: valid.length, location: { id: auditLocation.id, code: auditLocation.code, name: auditLocation.name_ar } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_audit_create] ' + String(error?.stack || error?.message || error).slice(0, 600));
        res.status(500).json({ error: 'INVENTORY_AUDIT_CREATE_FAILED', message: 'تعذر إنشاء جلسة الجرد' });
    } finally { client.release(); }
});

router.post('/inventory/audits/:id/submit', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const submitSignature = getSignature(req, res);
    if (!submitSignature) {return;}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = (await client.query('SELECT * FROM inventory_audits WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!current || current.status !== 'draft') { await client.query('ROLLBACK'); return fail(res, 409, 'AUDIT_NOT_DRAFT', 'لا يمكن إرسال جلسة الجرد إلا إذا كانت مسودة'); }
        const submittedAt = new Date().toISOString();
        const actor = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE inventory_audits SET status='submitted', submitted_at=$1, submitted_by=$2, counted_by=$2, count_signature_data=$3, count_signature_hash=$4, submit_signature_data=$3, submit_signature_hash=$4 WHERE id=$5 RETURNING *`, [submittedAt, req.user.id, submitSignature, signatureHash(submitSignature), req.params.id])).rows[0];
        await appendInventoryAuditEvent(client, current.id, 'submitted', current.status, 'submitted', req, submitSignature, { actor, periodType: current.period_type, periodStart: current.period_start, periodEnd: current.period_end });
        await client.query('COMMIT');
        emit(req, 'inventoryAudits', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_audit_submit]', error);
        res.status(500).json({ error: 'INVENTORY_AUDIT_SUBMIT_FAILED', message: 'تعذر إرسال الجرد للمراجعة' });
    } finally { client.release(); }
});

router.post('/inventory/audits/:id/approve', jwtAuth, requireRole(...AUDIT_WRITE_ROLES), async (req, res) => {
    const approvalSignature = getSignature(req, res);
    if (!approvalSignature) {return;}
    try { await ensureLocationDeptSchema(); } catch (error) { logger.error('[inventory_location_dept_schema]', error); }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const auditResult = await client.query('SELECT * FROM inventory_audits WHERE id=$1 FOR UPDATE', [req.params.id]);
        const audit = auditResult.rows[0];
        if (!audit) { await client.query('ROLLBACK'); return fail(res, 404, 'AUDIT_NOT_FOUND', 'جلسة الجرد غير موجودة'); }
        if (!['draft', 'submitted'].includes(audit.status)) { await client.query('ROLLBACK'); return fail(res, 409, 'AUDIT_ALREADY_FINAL', 'تم اعتماد أو إلغاء جلسة الجرد مسبقاً'); }
        const items = (await client.query('SELECT * FROM inventory_audit_items WHERE audit_id=$1 ORDER BY id FOR UPDATE', [audit.id])).rows;
        if (!items.length) { await client.query('ROLLBACK'); return fail(res, 422, 'AUDIT_EMPTY', 'جلسة الجرد لا تحتوي أصنافاً'); }
        // Task 20: المخزن يُقرأ من جلسة الجرد نفسها (location_id) مع ترحيل آمن
        // للجلسات القديمة عبر warehouse_scope، ثم يُقفل رصيد المخزن المقصود.
        try { await ensureAuditLocationSchema(); } catch (error) { logger.error('[inventory_audits_location_schema]', error); }
        let auditLocationId = Number(audit.location_id || 0);
        if (!auditLocationId) {
            const legacyCode = audit.warehouse_scope === 'main' ? 'MAIN-WAREHOUSE' : audit.warehouse_scope;
            auditLocationId = Number((await client.query('SELECT id FROM inventory_locations WHERE code=$1 AND active=true', [legacyCode])).rows[0]?.id || 0);
        }
        if (!auditLocationId) {throw new Error('INVENTORY_AUDIT_LOCATION_NOT_CONFIGURED');}
        const locationRow = (await client.query('SELECT id, code, name_ar, dept_code FROM inventory_locations WHERE id=$1', [auditLocationId])).rows[0] || {};
        const locationDeptCode = locationRow.dept_code || null;
        const stockChanges = [], transactions = [], expenses = [];
        let totalVarianceValue = 0;
        // معرّفات متسلسلة فريدة لحركات/مصروفات الاعتماد (نفس علة التصادم في الإنشاء)
        const approveIdBase = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        let approveIdx = 0;
        for (const auditItem of items) {
            const current = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [auditItem.item_id])).rows[0];
            if (!current) { await client.query('ROLLBACK'); return fail(res, 409, 'AUDIT_ITEM_DELETED', `الصنف محذوف من المخزن: ${auditItem.item_name}`); }
            // قفل صف رصيد المخزن المقصود — الفروقات تُحسب على رصيد هذا المخزن
            const balanceRow = (await client.query(
                'SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2 FOR UPDATE',
                [auditItem.item_id, auditLocationId]
            )).rows[0];
            const locationOnHand = n(balanceRow?.on_hand);
            if (Math.abs(locationOnHand - n(auditItem.system_qty)) > 0.0005) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'AUDIT_STALE_SNAPSHOT', `تغير رصيد ${current.name} في ${locationRow.name_ar || 'المخزن المختار'} بعد بدء الجرد. أعد فتح جلسة جرد جديدة.`);
            }
            const varianceQty = round(n(auditItem.counted_qty) - locationOnHand);
            const varianceValue = round(varianceQty * n(current.avgCost), 2);
            if (varianceQty !== 0) {
                await postInventoryLedgerEntry(client, {
                    transactionType: 'count_correction',
                    inventoryId: current.id,
                    locationId: auditLocationId,
                    quantityDelta: varianceQty,
                    unit: current.unit || auditItem.unit || 'وحدة',
                    unitCost: n(current.avgCost),
                    referenceType: 'inventory_audit',
                    referenceId: audit.id,
                    userId: req.user.id,
                    idempotencyKey: `audit:${audit.id}:item:${auditItem.item_id}`,
                    reason: `تصحيح جرد ${audit.audit_number}`,
                    metadata: { counted_qty: auditItem.counted_qty, system_qty: auditItem.system_qty, location_on_hand: locationOnHand, variance_qty: varianceQty, location: locationRow.code || null },
                });
            }
            // Record a transaction row only when there is an actual variance —
            // zero-qty 'adjustment' rows are noise in the ledger history
            if (varianceQty !== 0) {
                const tx = (await client.query(`
                    INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
                    VALUES ($1,$2,$3,$4,'adjustment',$5,$6,$7,$8) RETURNING *
                `, [approveIdBase + (approveIdx++), current.id, current.name, Math.abs(varianceQty), dateOnly(audit.counted_at), n(current.avgCost), Math.abs(varianceValue), `جرد ${audit.audit_number} — فرق ${varianceQty}`])).rows[0];
                transactions.push(tx);
                // كلفة القسم: كل فرق جرد بقيمة فعلية يتحوّل مصروفًا على القسم
                // صاحب المخزن حتى لا يتبخر المخزون من الدفاتر بدون كلفة معروفة
                const expenseRow = buildStocktakeExpense({
                    itemName: current.name,
                    unit: current.unit || auditItem.unit || 'وحدة',
                    varianceQty,
                    varianceValue,
                    deptCode: locationDeptCode,
                    auditNumber: audit.audit_number,
                    txId: tx.id,
                    countedAt: audit.counted_at,
                });
                const expense = (await client.query(
                    `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                    [approveIdBase + (approveIdx++), expenseRow.deptId, expenseRow.desc, expenseRow.amount, expenseRow.date,
                        expenseRow.notes, expenseRow.autoGenerated, expenseRow.category, expenseRow.adjustmentType]
                )).rows[0];
                expenses.push(expense);
            }
            stockChanges.push({ ...current, qty: round(auditItem.counted_qty) });
            totalVarianceValue += varianceValue;
        }
        const updated = (await client.query(`
            UPDATE inventory_audits SET status='approved', approved_at=$1, approved_by=$2, approval_signature_data=$3, approval_signature_hash=$4, total_variance_value=$5 WHERE id=$6 RETURNING *
        `, [new Date().toISOString(), req.user.name || req.user.username || String(req.user.id), approvalSignature, signatureHash(approvalSignature), round(totalVarianceValue, 2), audit.id])).rows[0];
        await appendInventoryAuditEvent(client, audit.id, 'approved', audit.status, 'approved', req, approvalSignature, { totalVarianceValue: round(totalVarianceValue, 2), itemCount: items.length, expenseCount: expenses.length });
        await client.query('COMMIT');
        emit(req, 'inventoryAudits', 'update', updated);
        stockChanges.forEach(item => emit(req, 'inventory', 'update', item));
        transactions.forEach(tx => emit(req, 'inventoryTx', 'create', tx));
        expenses.forEach(expense => emit(req, 'expenses', 'create', expense));
        res.json({ audit: updated, stockChanges, transactions, expenses, totalVarianceValue: round(totalVarianceValue, 2) });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_audit_approve]', error);
        res.status(500).json({ error: 'INVENTORY_AUDIT_APPROVE_FAILED', message: 'تعذر اعتماد الجرد وتطبيق الفروقات' });
    } finally { client.release(); }
});

router.get('/fiscal-years', jwtAuth, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM fiscal_years ORDER BY start_date DESC');
        res.json(result.rows);
    } catch (error) {
        logger.error('[fiscal_years_list]', error);
        res.status(500).json({ error: 'FISCAL_YEARS_LIST_FAILED', message: 'تعذر تحميل السنوات المالية' });
    }
});

router.post('/fiscal-years', jwtAuth, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
    const start = String(req.body?.startDate || '').slice(0, 10);
    const end = String(req.body?.endDate || '').slice(0, 10);
    const yearCode = String(req.body?.yearCode || start.slice(0, 4)).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {return fail(res, 422, 'INVALID_FISCAL_DATES', 'تواريخ السنة المالية غير صحيحة');}
    const client = await pool.connect();
    try {
        const row = (await client.query(`INSERT INTO fiscal_years (id, year_code, name, start_date, end_date, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id(), yearCode, String(req.body?.name || `السنة المالية ${yearCode}`).slice(0, 120), start, end, req.body?.notes || null])).rows[0];
        emit(req, 'fiscalYears', 'create', row);
        res.status(201).json(row);
    } catch (error) {
        if (error.code === '23505') {return fail(res, 409, 'FISCAL_YEAR_EXISTS', 'السنة المالية موجودة أو توجد سنة مفتوحة بالفعل');}
        logger.error('[fiscal_year_create]', error);
        res.status(500).json({ error: 'FISCAL_YEAR_CREATE_FAILED', message: 'تعذر إنشاء السنة المالية' });
    } finally { client.release(); }
});

router.post('/fiscal-years/:id/close', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const year = (await client.query('SELECT * FROM fiscal_years WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!year) { await client.query('ROLLBACK'); return fail(res, 404, 'FISCAL_YEAR_NOT_FOUND', 'السنة المالية غير موجودة'); }
        if (year.status === 'closed') { await client.query('ROLLBACK'); return fail(res, 409, 'FISCAL_YEAR_ALREADY_CLOSED', 'السنة المالية مغلقة بالفعل'); }
        const openShifts = (await client.query(`SELECT COUNT(*)::int AS count FROM pos_shift_sessions WHERE status='open'`)).rows[0].count;
        if (Number(openShifts) > 0) { await client.query('ROLLBACK'); return fail(res, 409, 'OPEN_SHIFT_EXISTS', 'يجب إغلاق جميع الورديات قبل إقفال السنة المالية'); }
        const pendingAudits = (await client.query(`SELECT COUNT(*)::int AS count FROM inventory_audits WHERE counted_at >= $1 AND counted_at <= $2 AND status IN ('draft','submitted')`, [year.start_date, year.end_date])).rows[0].count;
        if (Number(pendingAudits) > 0) { await client.query('ROLLBACK'); return fail(res, 409, 'PENDING_INVENTORY_AUDITS', 'يوجد جرد مسودة أو بانتظار الاعتماد داخل السنة المالية'); }
        const revenues = (await client.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM revenues WHERE date >= $1 AND date <= $2 AND "deptId" != 'ys_b4_ext'`, [year.start_date, year.end_date])).rows[0];
        const expenses = (await client.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM expenses WHERE date >= $1 AND date <= $2 AND COALESCE("adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`, [year.start_date, year.end_date])).rows[0];
        const purchases = (await client.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM("totalAmount"),0)::numeric(14,2) AS total FROM "purchaseInvoices" WHERE date >= $1 AND date <= $2`, [year.start_date, year.end_date])).rows[0];
        const inventory = (await client.query(`SELECT id, name, unit, qty, "avgCost", ROUND((qty * "avgCost")::numeric, 2) AS value FROM inventory ORDER BY id`)).rows;
        const closingSnapshot = { closed_at: new Date().toISOString(), revenue_count: Number(revenues.count), revenue_total: Number(revenues.total), expense_count: Number(expenses.count), expense_total: Number(expenses.total), purchase_count: Number(purchases.count), purchase_total: Number(purchases.total), net_result: Number((Number(revenues.total) - Number(expenses.total)).toFixed(2)), inventory_value: inventory.reduce((sum, item) => sum + Number(item.value || 0), 0), inventory_count: inventory.length };
        const updated = (await client.query(`UPDATE fiscal_years SET status='closed', closed_at=CURRENT_TIMESTAMP, closed_by=$1, closing_snapshot=$2, opening_balances=$3 WHERE id=$4 RETURNING *`, [req.user.id, JSON.stringify(closingSnapshot), JSON.stringify({ inventory, source_fiscal_year: year.year_code }), year.id])).rows[0];
        await client.query('COMMIT');
        emit(req, 'fiscalYears', 'close', updated);
        res.json({ fiscalYear: updated, closingSnapshot });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[fiscal_year_close]', error);
        res.status(500).json({ error: 'FISCAL_YEAR_CLOSE_FAILED', message: 'تعذر إقفال السنة المالية؛ لم يتم تطبيق أي تغيير' });
    } finally { client.release(); }
});

router.post('/fiscal-years/:id/create-next', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const previous = (await client.query(`SELECT * FROM fiscal_years WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
        if (!previous || previous.status !== 'closed') { await client.query('ROLLBACK'); return fail(res, 409, 'PREVIOUS_YEAR_NOT_CLOSED', 'يجب إقفال السنة السابقة أولًا'); }
        const start = new Date(`${dateOnly(previous.end_date)}T00:00:00Z`); start.setUTCDate(start.getUTCDate() + 1);
        const end = new Date(Date.UTC(start.getUTCFullYear(), 11, 31));
        const code = String(start.getUTCFullYear());
        const next = (await client.query(`INSERT INTO fiscal_years (id, year_code, name, start_date, end_date, opening_balances, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id(), code, `السنة المالية ${code}`, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), JSON.stringify({ inventory: previous.opening_balances?.inventory || [], source_fiscal_year: previous.year_code }), 'تم ترحيل الأرصدة الافتتاحية من السنة السابقة'])).rows[0];
        await client.query('COMMIT');
        emit(req, 'fiscalYears', 'create', next);
        res.status(201).json(next);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') {return fail(res, 409, 'OPEN_FISCAL_YEAR_EXISTS', 'توجد سنة مالية مفتوحة بالفعل');}
        logger.error('[fiscal_year_create_next]', error);
        res.status(500).json({ error: 'FISCAL_YEAR_CREATE_NEXT_FAILED', message: 'تعذر إنشاء السنة الجديدة' });
    } finally { client.release(); }
});

// ─── نطاق التصفير التشغيلي: بيانات رئيسية تُحفظ دائمًا (لا تُمسح أبدًا) ───
// أي مسار تصفير (كامل أو تشغيلي) لا يحذف سجل التدقيق — السجل فوق التصفير.
const RESET_AUDIT_TABLES = new Set(['pos_audit_logs', 'system_reset_audit']);
const OPERATIONAL_PRESERVE = new Set([
    ...RESET_AUDIT_TABLES,
    'users', 'employees', 'inventory', 'inventory_locations', 'suppliers',
    'settings', 'app_state', 'departments', 'shelves', 'hrDepartments',
    'chart_of_accounts', 'fiscal_years', 'pos_departments', 'pos_products',
    'pos_product_departments', 'pos_product_ingredients', 'pos_recipe_versions',
    'pos_recipe_version_ingredients', 'recipes', 'kitchen_policies',
    'yarasoft_revenue_map', 'yarasoft_product_mapping',
    'attendance_devices', 'leaveTypes', 'zatca_settings', 'pos_print_settings',
]);
function resetRouteScope(path) {
    if (String(path || '').endsWith('/reset-all')) {return 'full';}
    return 'operational';
}
router.post(['/system/reset-production', '/system/reset-operational-numbers', '/system/reset-all'], jwtAuth, requireRole(...RESET_ROLES), async (req, res) => {
    const confirmation = String(req.body?.confirmation || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const force = req.body?.force === true;
    // النطاق من المسار نفسه (وليس من body) — منعًا لالتباس أدى سابقًا لمسح كامل عبر مسار تشغيلي
    const scope = resetRouteScope(req.path);
    if (confirmation !== FULL_RESET_CONFIRMATION) {return fail(res, 422, 'RESET_CONFIRMATION_REQUIRED', `اكتب عبارة التأكيد ${FULL_RESET_CONFIRMATION} كما هي`);}
    if (reason.length < 10) {return fail(res, 422, 'RESET_REASON_REQUIRED', 'سبب التصفير يجب أن يكون 10 أحرف على الأقل');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const openShifts = await client.query(`SELECT COUNT(*)::int AS count FROM pos_shift_sessions WHERE status='open'`);
        const openCount = n(openShifts.rows[0]?.count);
        if (openCount > 0 && !force) { await client.query('ROLLBACK'); return fail(res, 409, 'OPEN_SHIFT_EXISTS', 'أغلق الورديات المفتوحة قبل تنفيذ التصفير'); }
        // جمع العدادات قبل الحذف
        const counts = {};
        for (const [key, sql] of Object.entries({
            users: 'SELECT COUNT(*)::int AS count FROM users WHERE role <> \'admin\'',
            employees: 'SELECT COUNT(*)::int AS count FROM employees',
            payroll: 'SELECT COUNT(*)::int AS count FROM payroll',
            attendance: 'SELECT COUNT(*)::int AS count FROM attendance',
            leaveRequests: 'SELECT COUNT(*)::int AS count FROM "leaveRequests"',
            revenues: 'SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS total FROM revenues WHERE "deptId" != \'ys_b4_ext\'',
            expenses: 'SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS total FROM expenses',
            dispatches: 'SELECT COUNT(*)::int AS count FROM dispatches',
            purchaseInvoices: 'SELECT COUNT(*)::int AS count, COALESCE(SUM("totalAmount"),0)::numeric AS total FROM "purchaseInvoices"',
            inventory: 'SELECT COUNT(*)::int AS count, COALESCE(SUM(qty * "avgCost"),0)::numeric AS value FROM inventory',
            posProducts: 'SELECT COUNT(*)::int AS count FROM pos_products',
            orders: 'SELECT COUNT(*)::int AS count FROM pos_orders',
            oracleTables: 'SELECT COUNT(*)::int AS count FROM ora_table_meta',
        })) {counts[key] = (await client.query(sql)).rows[0];}

        // ─── حذف كل البيانات ──────────────────────────────────────────────────
        // حذف كل جداول Oracle المنسوخة
        const oraTables = await client.query(`SELECT pg_name FROM ora_table_meta`);
        for (const row of oraTables.rows) {
            try {
                await client.query(`SAVEPOINT sp_ora_${row.pg_name}`);
                await client.query(`DELETE FROM "${row.pg_name}"`);
                await client.query(`RELEASE SAVEPOINT sp_ora_${row.pg_name}`);
            } catch (_) {
                try { await client.query(`ROLLBACK TO SAVEPOINT sp_ora_${row.pg_name}`); } catch (_) {}
            }
        }
        await client.query(`DELETE FROM ora_table_meta`);

        // تعطيل مؤقت للـ triggers التي تمنع الحذف
        // FIX 2026-10-11 (M15): DISABLE runs on client (inside txn), but the
        // RE-ENABLE was on pool (separate connection). If COMMIT succeeds but
        // process crashes before the pool-based RE-ENABLE, triggers stay
        // disabled forever → all logins blocked. Now RE-ENABLE uses same client
        // inside the transaction, and pool-based re-enable is a safety net only.
        try {
            await client.query(`SAVEPOINT sp_triggers`);
            await client.query(`ALTER TABLE pos_audit_logs DISABLE TRIGGER ALL`);
            await client.query(`ALTER TABLE users DISABLE TRIGGER ALL`);
            await client.query(`RELEASE SAVEPOINT sp_triggers`);
        } catch (trigErr) {
            try { await client.query(`ROLLBACK TO SAVEPOINT sp_triggers`); } catch (_) {}
            logger.warn(`[reset] disable triggers: ${trigErr.message?.slice(0,80)}`);
        }

        // حذف كل بيانات karim — ترتيب من الأبناء إلى الأباء (FK-safe)
        // الاستراتيجية: SAVEPOINT لكل حذف حتى لا ي溯回 الكائن بأكمله
        const allTables = [
            // ─── أولاً: أحفاد البعيد ──────────────────────────────────────
            'advance_applications', 'employee_evaluations', 'employee_contracts',
            'payroll_adjustments', 'payroll_runs',
            'attendance_decisions', 'attendance_brain_log', 'attendance_logs', 'attendance',
            'pos_stock_movements', 'pos_invoice_payments', 'pos_order_items', 'pos_pending_prints',
            'pos_zatca_invoice_queue', 'pos_idempotency_keys', 'pos_held_orders',
            'pos_orders',
            'pos_department_daily_revenues', 'pos_shift_sessions', 'pos_refresh_tokens',
            'pos_product_departments', '"pos_product_ingredients"',
            '"pos_recipe_version_ingredients"', 'pos_recipe_versions',
            'inventory_transfer_events', 'inventory_transfer_items', 'inventory_transfers',
            'inventory_ledger', 'inventory_location_balances',
            'inventory_audit_workflow_events', 'inventory_audit_items', 'inventory_audits',
            '"inventoryTx"', 'inventory',
            'device_sync_state', 'dispatch_workflow_events',
            'order_items', 'orders',
            'revenues', 'expenses',
            'dispatches', '"kitchenReturns"', '"purchaseInvoices"',
            'salary_advances',
            'recipes',
            'notifications',
            'pos_products', 'pos_printers',
            'payroll',
            '"leaveRequests"',
            'journal_lines', 'journal_entries',
            'kitchen_audit_items', 'kitchen_audit_workflow_events', 'kitchen_audits',
            'kitchen_exceptions', 'kitchen_policies', 'kitchen_production_batches',
            'kitchen_production_distributions', 'kitchen_production_events',
            'invoice_import_log', 'supplier_payments', 'suppliers',
            'settings', 'attendance_devices', 'inventory_locations',
            'leaveTypes', 'leave_approval_events', 'leave_approval_workflows',
            'pos_departments',
            // ─── ثانياً: جداول الحذف من VL ──────────────────────────────
            'employees',
            'pos_audit_logs', 'system_reset_audit',
            'users',
            'departments', 'shelves', 'hrDepartments',
            'fiscal_years',
            'chart_of_accounts',
            'yarasoft_import_log', 'yarasoft_review_items', 'yarasoft_product_mapping',
            'yarasoft_revenue_map', 'yarasoft_unmapped_sections', 'yarasoft_quality_quarantine',
            'yarasoft_pos', 'yarasoft_staging',
            'ys_customers', 'ys_assets',
            'app_state', 'pos_password_reset_codes',
            'pos_print_settings', 'zatca_settings', 'weightReadings',
        ];
        for (const tbl of allTables) {
            const plain = tbl.replace(/^"|"$/g, '');
            if (RESET_AUDIT_TABLES.has(plain)) {continue;} // سجل التدقيق لا يُمسح أبدًا
            if (scope !== 'full' && OPERATIONAL_PRESERVE.has(plain)) {continue;} // التشغيلي يُبقي البيانات الرئيسية
            const spName = `sp_del_${tbl.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            try {
                await client.query(`SAVEPOINT ${spName}`);
                await client.query(`DELETE FROM ${tbl}`);
                await client.query(`RELEASE SAVEPOINT ${spName}`);
            } catch (delErr) {
                try { await client.query(`ROLLBACK TO SAVEPOINT ${spName}`); } catch (_) {}
                logger.warn(`[reset] skip ${tbl}: ${delErr.message?.slice(0,80)}`);
            }
        }

        let freshCredentials = null;
        if (scope === 'full') {
            // ─── تصفير كل الـ sequences (الكامل فقط — الجداول فارغة فلا تعارض) ──
            const seqs = await client.query(`
                SELECT sequence_name FROM information_schema.sequences
                WHERE sequence_schema = 'public'
                AND sequence_name NOT LIKE 'pg_%'
            `);
            for (const row of seqs.rows) {
                try { await client.query(`ALTER SEQUENCE "${row.sequence_name}" RESTART WITH 1`); } catch (_) {}
            }

            // ─── إعادة إنشاء المستخدم الأساسي بكلمات مرور عشوائية لمرة واحدة ──
            // تُعرض مرة واحدة في الرد ويجب حفظها فورًا — لا كلمات مرور ثابتة ضعيفة
            const bcrypt = require('bcryptjs');
            const crypto = require('crypto');
            const adminPassword = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + 'A1';
            const accPassword = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + 'B2';
            await client.query(
                `INSERT INTO users (id, username, password, role, name, active) VALUES ($1,$2,$3,'admin','مدير النظام',true)`,
                [Date.now() * 1000 + 1, 'admin', bcrypt.hashSync(adminPassword, 12)]
            );
            await client.query(
                `INSERT INTO users (id, username, password, role, name, active) VALUES ($1,$2,$3,'accountant','محاسب',true)`,
                [Date.now() * 1000 + 2, 'admin1', bcrypt.hashSync(accPassword, 12)]
            );
            freshCredentials = { adminPassword, accPassword, warning: 'احفظ كلمتي المرور الآن — لن تظهرا مرة أخرى' };

            // ─── إعادة إعدادات الافتراضية ────────────────────────────────────
            await client.query(`INSERT INTO app_state (id, state_data) VALUES (1, '{"lastOrderNumber":0,"lastInvoiceNumber":0,"lastProductSku":0}'::jsonb) ON CONFLICT (id) DO UPDATE SET state_data = '{"lastOrderNumber":0,"lastInvoiceNumber":0,"lastProductSku":0}'::jsonb`);
        }

        const snapshot = { counts, scope: scope === 'full' ? 'nuclear_full_reset' : 'operational_reset', forced: force, openShiftsBypassed: openCount, clearedOracleTables: oraTables.rows.length, excluded: [...RESET_AUDIT_TABLES, ...(scope === 'full' ? [] : [...OPERATIONAL_PRESERVE].filter(t => !RESET_AUDIT_TABLES.has(t)))] };
        const resetNumber = `RESET-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${String(id()).slice(-4)}`;
        const reset = (await client.query(`
            INSERT INTO system_reset_audit (id, reset_number, reason, confirmation_phrase, actor_user_id, actor_username, actor_role, snapshot)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        `, [id(), resetNumber, reason, confirmation, req.user.id || null, req.user.username || String(req.user.id), req.user.role || 'admin', json(snapshot)])).rows[0];
        await client.query(`
            INSERT INTO pos_audit_logs (actor_user_id, actor_username, actor_role, action, table_name, row_pk, reason, metadata)
            VALUES ($1,$2,$3,'VOID','system_reset_audit',$4,$5,$6)
        `, [req.user.id || null, req.user.username || String(req.user.id), req.user.role || 'admin', String(reset.id), reason, json({ resetNumber, scope: snapshot.scope })]);
        // FIX 2026-10-11 (M15): RE-ENABLE triggers INSIDE the transaction before
        // COMMIT — if COMMIT succeeds and process crashes, triggers are already
        // re-enabled in the same atomic unit.
        try { await client.query(`ALTER TABLE pos_audit_logs ENABLE TRIGGER ALL`); } catch (_) {}
        try { await client.query(`ALTER TABLE users ENABLE TRIGGER ALL`); } catch (_) {}
        await client.query('COMMIT');
        // Safety net: re-enable on separate connection (in case DISABLE was
        // done outside txn in an older code path)
        try { await pool.query(`ALTER TABLE pos_audit_logs ENABLE TRIGGER ALL`); } catch (_) {}
        try { await pool.query(`ALTER TABLE users ENABLE TRIGGER ALL`); } catch (_) {}
        ['users','employees','payroll','attendance','leaveRequests','revenues','expenses','dispatches','kitchenReturns','purchaseInvoices','inventoryTx','inventoryAudits','posProducts','posOrders','notifications'].forEach(entity => emit(req, entity, 'reset', { resetNumber }));
        emit(req, 'inventory', 'reset', { resetNumber });
        emit(req, 'oracle', 'reset', { resetNumber });
        res.json({ reset, snapshot,
            ...(freshCredentials ? { credentials: freshCredentials } : {}),
            message: scope === 'full'
                ? 'تم التصفير الكامل — كل البيانات اتمسحت والأرقام رجعت للصفر'
                : 'تم التصفير التشغيلي — اتمسحت الحركات والمعاملات وبقيت البيانات الرئيسية (الأصناف/المستخدمون/الموردون/الإعدادات)' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        // إعادة تفعيل الـ triggers في حالة فشل
        try { await pool.query(`ALTER TABLE pos_audit_logs ENABLE TRIGGER ALL`); } catch (_) {}
        try { await pool.query(`ALTER TABLE users ENABLE TRIGGER ALL`); } catch (_) {}
        logger.error('[system_reset_all]', error?.message || error);
        console.error('[system_reset_all] FULL ERROR:', error?.message, error?.stack?.slice(0,200));
        res.status(500).json({ error: 'SYSTEM_RESET_FAILED', message: 'تعذر تنفيذ التصفير؛ لم يتم تطبيق أي تغيير', detail: error?.message?.slice(0,120) });
    } finally { client.release(); }
});

module.exports = { router, buildStocktakeExpense, ensureLocationDeptSchema };
