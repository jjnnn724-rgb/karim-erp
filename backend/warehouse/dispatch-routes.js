// ─── مسارات الصرف والاعتماد والاستلام
// مُستخرج حرفًا من backend/warehouse-routes.js (السطور 551-1328).
// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js
// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.
const { __scope } = require('../warehouse-routes');
const crypto = require('crypto');
const { router, CREATE_ROLES, APPROVAL_ROLES, RECEIVE_ROLES, CHEF_APPROVAL_ROLES, pool, jwtAuth, requireRoleOrPerm, idempotency, logger, postInventoryLedgerEntry, emitDomainEvent, ensureDispatchCreatorSchema, notifyChainEvent, latestExpiryFor, beginDispatchOp, endDispatchOp, canReceiveDispatch, canWarehouseApprove, canChefDecide, dispatchSelfDecisionGuard, deptsMatch, resolveDeptHeadDispatch, canAccessDeptPanel, resolvePanelDept, aggregatePanelExpenses, id, n, round, dateOnly, cleanName, json, emit, fail, signatureHash, appendDispatchEvent, requireSignature, normalizeRequestedItems, dispatchStockGate, getWarehouseLocation, getDispatchTargetLocation, ensureLocationBalance, ensureLegacyKitchenReceiptLedger } = __scope;

router.use(async (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    try { await ensureLegacyKitchenReceiptLedger(); } catch (error) { logger.error('[dispatch_kitchen_receipt_backfill]', error); }
    next();
});

async function dispatchRevision(/** @type {any} */ client, /** @type {any} */ dispatchId) {
    const result = await client.query(
        `SELECT COUNT(*)::int AS revision FROM dispatch_workflow_events
          WHERE dispatch_id=$1 AND event_type='reopened'`, [dispatchId]);
    return Number(result.rows[0]?.revision || 0);
}

async function reverseDispatchStock(/** @type {any} */ client, /** @type {any} */ dispatch, /** @type {any} */ req, /** @type {any} */ action) {
    const includeReceipts = action === 'void';
    const revision = await dispatchRevision(client, dispatch.id);
    const result = await client.query(
        `SELECT inventory_id, location_id, unit, unit_cost,
                SUM(quantity_delta) AS quantity_delta,
                SUM(COALESCE(catch_weight_qty, 0)) AS catch_weight_qty,
                MAX(catch_weight_unit) AS catch_weight_unit
           FROM inventory_ledger
          WHERE ((reference_type='dispatch' AND reference_id IN ($1,$2))
             OR ($4::boolean AND reference_type='dispatch_receipt' AND reference_id=$2))
            AND COALESCE(metadata->>'approval_revision','0') = $3::text
          GROUP BY inventory_id, location_id, unit, unit_cost, catch_weight_unit
          HAVING ABS(SUM(quantity_delta)) > 0.000001`,
        [`DIS-${dispatch.id}`, String(dispatch.id), String(revision), includeReceipts]);
    if (!result.rows.length) {
        throw Object.assign(new Error('DISPATCH_STOCK_MOVEMENTS_MISSING'), { code: 'DISPATCH_STOCK_MOVEMENTS_MISSING' });
    }
    const movements = [];
    const costAdjustments = new Map();
    for (const row of result.rows) {
        const item = (await client.query('SELECT id,name,qty,"avgCost" FROM inventory WHERE id=$1 FOR UPDATE', [row.inventory_id])).rows[0];
        if (!item) {
            throw Object.assign(new Error('INVENTORY_ITEM_NOT_FOUND'), { code: 'INVENTORY_ITEM_NOT_FOUND' });
        }
        const quantityDelta = -n(row.quantity_delta);
        const unitCost = n(row.unit_cost);
        const packagingQty = n(row.catch_weight_qty);
        const reversalUnitKey = crypto.createHash('sha256')
            .update(`${row.unit || ''}\u0000${row.catch_weight_unit || ''}`).digest('hex').slice(0, 16);
        const movement = await postInventoryLedgerEntry(client, {
            transactionType: 'reversal', inventoryId: Number(row.inventory_id), locationId: Number(row.location_id),
            quantityDelta, unit: row.unit, unitCost,
            referenceType: action === 'void' ? 'dispatch_void' : 'dispatch_reopen', referenceId: String(dispatch.id),
            userId: req.user.id, idempotencyKey: `dispatch-${action}:${dispatch.id}:r${revision}:${row.inventory_id}:${row.location_id}:${unitCost}:${reversalUnitKey}`,
            expiryDate: await latestExpiryFor(client, Number(row.inventory_id)),
            reason: `${action === 'void' ? 'إبطال' : 'إرجاع'} إذن صرف #${dispatch.id} — عكس الأثر المخزني`,
            metadata: { dispatch_id: dispatch.id, action, approval_revision: revision, original_reference: includeReceipts ? 'dispatch+dispatch_receipt' : 'dispatch' },
            catchWeightQty: Math.abs(packagingQty) > 0.000001 ? -packagingQty : null,
            catchWeightUnit: Math.abs(packagingQty) > 0.000001 ? (row.catch_weight_unit || 'كرتون') : null,
        });
        const adjustment = costAdjustments.get(Number(item.id)) || {
            oldQty: n(item.qty), oldAvg: n(item.avgCost), quantityDelta: 0, valueDelta: 0,
        };
        adjustment.quantityDelta += quantityDelta;
        adjustment.valueDelta += quantityDelta * unitCost;
        costAdjustments.set(Number(item.id), adjustment);
        movements.push({ inventoryId: Number(row.inventory_id), locationId: Number(row.location_id), quantityDelta, unitCost, revision, ledgerId: movement.ledger.id });
    }
    for (const [inventoryId, adjustment] of costAdjustments) {
        const nextQty = round(adjustment.oldQty + adjustment.quantityDelta);
        const nextCost = nextQty > 0
            ? round(((adjustment.oldQty * adjustment.oldAvg) + adjustment.valueDelta) / nextQty, 2)
            : n(adjustment.oldAvg);
        await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1', [inventoryId, nextCost]);
    }
    return movements;
}

async function voidDispatchExpenses(/** @type {any} */ client, /** @type {any} */ dispatch, /** @type {any} */ req, /** @type {any} */ reason) {
    const { voidSourceJournals } = require('../journal-void');
    const actor = req.user.name || req.user.username || String(req.user.id);
    const journal = await voidSourceJournals(client, {
        sourceType: 'dispatch', sourceIds: String(dispatch.id), matchPrefix: true, reason,
        actorUserId: req.user.id, actor,
    });
    const linkedExpenseIds = (Array.isArray(dispatch.approvedItems) ? dispatch.approvedItems : [])
        .map(/** @type {any} */ (item) => Number(item.expenseId)).filter(/** @type {any} */ (value) => Number.isInteger(value) && value > 0);
    const expenseRows = (await client.query(
        `SELECT id FROM expenses
          WHERE id=ANY($1::bigint[])
             OR (COALESCE("adjustmentType",'')='dispatch' AND (notes LIKE $2 OR "desc" LIKE $2))
          FOR UPDATE`, [linkedExpenseIds, `%طلب صرف #${dispatch.id}%`])).rows;
    const expenseJournal = await voidSourceJournals(client, {
        sourceType: 'expense', sourceIds: expenseRows.map(/** @type {any} */ (row) => row.id), reason,
        actorUserId: req.user.id, actor,
    });
    const expenses = (await client.query(
        `UPDATE expenses SET amount=0, "voidedAt"=NOW(), "voidedBy"=$2, "voidReason"=$3
          WHERE id=ANY($1::bigint[]) RETURNING *`, [expenseRows.map(/** @type {any} */ (row) => row.id), actor, reason])).rows;
    return { journalCount: journal.voided + expenseJournal.voided, expenses: expenses.map(/** @type {any} */ (row) => ({ id: row.id, amount: row.amount })) };
}

router.post('/dispatches/:id/cancel', jwtAuth, requireRoleOrPerm(CREATE_ROLES, 'dispatch.cancel'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'DISPATCH_REASON_REQUIRED', 'أدخل سبب إلغاء إذن الصرف');}
    if (!beginDispatchOp(req.params.id, 'cancel')) {return fail(res, 409, 'DISPATCH_CANCEL_IN_PROGRESS', 'إلغاء هذا الإذن قيد التنفيذ الآن');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) {await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');}
        const actorId = Number(req.user.id);
        const creatorId = Number(dispatch.creatorUserId);
        if (!['admin', 'manager', 'warehouse'].includes(req.user.role) && !(actorId > 0 && actorId === creatorId)) {
            await client.query('ROLLBACK');
            return fail(res, 403, 'DISPATCH_CANCEL_FORBIDDEN', 'لا يجوز إلغاء إذن صرف لم تنشئه');
        }
        if (!['pending', 'chef_approved', 'rejected'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_CANCELLABLE', 'الإلغاء متاح قبل صرف المخزون فقط — الإذن المرحّل يحتاج إرجاعًا أو إبطالًا');
        }
        const actor = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(
            `UPDATE dispatches SET status='cancelled', "cancelledAt"=NOW(), "cancelledBy"=$2, "cancellationReason"=$3 WHERE id=$1 RETURNING *`,
            [dispatch.id, actor, reason])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'cancelled', dispatch.status, 'cancelled', req, null, { reason });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        res.json({ dispatch: updated });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dispatch_cancel]', error);
        res.status(500).json({ error: 'DISPATCH_CANCEL_FAILED', message: 'تعذر إلغاء إذن الصرف' });
    } finally {endDispatchOp(req.params.id, 'cancel'); client.release();}
});

router.post('/dispatches/:id/reopen', jwtAuth, requireRoleOrPerm(['admin', 'manager'], 'dispatch.void'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'DISPATCH_REASON_REQUIRED', 'أدخل سبب إرجاع الإذن للمراجعة');}
    if (!beginDispatchOp(req.params.id, 'reopen')) {return fail(res, 409, 'DISPATCH_REOPEN_IN_PROGRESS', 'إرجاع هذا الإذن قيد التنفيذ الآن');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '8000ms'");
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) {await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');}
        if (dispatch.status !== 'approved' || dispatch.kitchenReceivedAt || (Array.isArray(dispatch.receivedItems) && dispatch.receivedItems.length > 0)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_REOPENABLE', 'الإرجاع متاح للإذن المعتمد الذي لم يبدأ استلامه فقط');
        }
        const activeReturn = (await client.query(
            `SELECT id FROM "kitchenReturns" WHERE "dispatchId"=$1 AND "voidedAt" IS NULL LIMIT 1`, [String(dispatch.id)])).rows[0];
        if (activeReturn) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_ACTIVE_RETURN', 'أبطل المرتجع المرتبط أولًا قبل إرجاع إذن الصرف للمراجعة');
        }
        const receiptMovement = (await client.query(
            `SELECT id FROM inventory_ledger WHERE reference_type='dispatch_receipt' AND reference_id=$1 LIMIT 1`,
            [String(dispatch.id)])).rows[0];
        if (receiptMovement) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_RECEIPT_ALREADY_RECORDED', 'توجد حركات استلام مسجلة لهذا الإذن — استخدم الإبطال بعد إنهاء المرتجعات');
        }
        await require('../accounting-periods').assertPeriodOpenInTx(client, dispatch.date);
        const movements = await reverseDispatchStock(client, dispatch, req, 'reopen');
        const financial = await voidDispatchExpenses(client, dispatch, req, `إرجاع إذن صرف #${dispatch.id} للمراجعة: ${reason}`);
        const actor = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(
            `UPDATE dispatches SET status='pending', "approvedDate"=NULL, "approvedBy"=NULL,
             "approvedItems"=NULL, "warehouseApprovedAt"=NULL, "warehouseApprovedBy"=NULL,
             "warehouseApprovalSignatureData"=NULL, "warehouseApprovalSignatureHash"=NULL,
             "reopenedAt"=NOW(), "reopenedBy"=$2, "reopenReason"=$3 WHERE id=$1 RETURNING *`,
            [dispatch.id, actor, reason])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'reopened', dispatch.status, 'pending', req, signature, { reason, movements, ...financial });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        res.json({ dispatch: updated, movements });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dispatch_reopen]', error);
        if (error.code === 'DISPATCH_STOCK_MOVEMENTS_MISSING') {return fail(res, 409, error.code, 'لا توجد حركات صرف أصلية قابلة للعكس — راجع دفتر المخزون');}
        if (error.code === 'INSUFFICIENT_STOCK') {return fail(res, 409, error.code, 'تعذر عكس الصرف بسبب حركات لاحقة أو رصيد غير كافٍ');}
        if (error.statusCode === 423) {return fail(res, 423, 'ACCOUNTING_PERIOD_CLOSED', error.message);}
        res.status(500).json({ error: 'DISPATCH_REOPEN_FAILED', message: 'تعذر إرجاع الإذن وعكس أثره بشكل ذري' });
    } finally {endDispatchOp(req.params.id, 'reopen'); client.release();}
});

router.post('/dispatches/:id/void', jwtAuth, requireRoleOrPerm(['admin', 'manager'], 'dispatch.void'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'DISPATCH_REASON_REQUIRED', 'أدخل سبب إبطال إذن الصرف');}
    if (!beginDispatchOp(req.params.id, 'void')) {return fail(res, 409, 'DISPATCH_VOID_IN_PROGRESS', 'إبطال هذا الإذن قيد التنفيذ الآن');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '8000ms'");
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) {await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');}
        if (!['approved', 'partially_received', 'received'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_VOIDABLE', 'الإبطال متاح للمستند المرحّل فقط — استخدم الإلغاء قبل الصرف');
        }
        const activeReturn = (await client.query(
            `SELECT id FROM "kitchenReturns" WHERE "dispatchId"=$1 AND "voidedAt" IS NULL LIMIT 1`, [String(dispatch.id)])).rows[0];
        if (activeReturn) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_ACTIVE_RETURN', 'أبطل المرتجع المرتبط أولًا قبل إبطال إذن الصرف');
        }
        await require('../accounting-periods').assertPeriodOpenInTx(client, dispatch.date);
        const movements = await reverseDispatchStock(client, dispatch, req, 'void');
        const financial = await voidDispatchExpenses(client, dispatch, req, `إبطال إذن صرف #${dispatch.id}: ${reason}`);
        const actor = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(
            `UPDATE dispatches SET status='voided', "voidedAt"=NOW(), "voidedBy"=$2, "voidReason"=$3,
             "voidedJournalCount"=$4 WHERE id=$1 RETURNING *`,
            [dispatch.id, actor, reason, financial.journalCount])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'voided', dispatch.status, 'voided', req, signature, { reason, movements, ...financial });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        res.json({ dispatch: updated, movements, journalCount: financial.journalCount });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dispatch_void]', error);
        if (error.code === 'DISPATCH_STOCK_MOVEMENTS_MISSING') {return fail(res, 409, error.code, 'لا توجد حركات أصلية قابلة للعكس — راجع دفتر المخزون');}
        if (error.code === 'INSUFFICIENT_STOCK') {return fail(res, 409, error.code, 'تعذر عكس الإذن لأن المواد المستلمة استُهلكت أو تحوّلت أو رصيد الموقع غير كافٍ');}
        if (error.statusCode === 423) {return fail(res, 423, 'ACCOUNTING_PERIOD_CLOSED', error.message);}
        res.status(500).json({ error: 'DISPATCH_VOID_FAILED', message: 'تعذر إبطال الإذن وعكس آثاره بشكل ذري' });
    } finally {endDispatchOp(req.params.id, 'void'); client.release();}
});

/**
 * Task 28: لوحة رئيس القسم — مصروفات القسم حسب المصدر + أذونات الصرف + الأقسام الفرعية.
 * رئيس القسم محبوس في قسمه، والشيف يرى المطبخ وأقسامه، وadmin/manager أي قسم.
 */
router.get('/dept-panel', jwtAuth, async (/** @type {any} */ req, /** @type {any} */ res) => {
    const gate = canAccessDeptPanel(req.user);
    if (!gate.ok) {
        const status = gate.code === 'IDENTITY_REQUIRED' ? 401 : 403;
        return fail(res, status, gate.code, 'لا تملك صلاحية الوصول للوحة القسم');
    }
    const scope = resolvePanelDept(req.user, req.query.dept);
    if (!scope.ok) {
        return fail(res, 403, scope.code, scope.code === 'DEPT_MISMATCH' ? 'لا يمكنك عرض لوحة قسم غير قسمك' : 'حسابك بلا قسم مرتبط');
    }
    const client = await pool.connect();
    try {
        let department = null;
        let subDepartments = [];
        let scopeCodes = [];
        if (scope.deptCode) {
            department = (await client.query('SELECT code, name, icon, color, parent_code FROM departments WHERE code=$1', [scope.deptCode])).rows[0] || null;
            if (!department) {
                // UPGRADE 2026-10-01: fallback لأقسام HR — أقسام الموارد البشرية
                // التي لا توأم تشغيلي لها تعمل في اللوحة تلقائيًا (تكاليفها تبدأ صفرًا)
                department = (await client.query('SELECT code, name FROM "hrDepartments" WHERE code=$1', [scope.deptCode])).rows[0] || null;
                if (department) {department.icon = department.icon || null; department.color = department.color || null; department.parent_code = null;}
            }
            if (!department) {return fail(res, 404, 'DEPARTMENT_NOT_FOUND', 'القسم غير موجود');}
            subDepartments = (await client.query('SELECT code, name FROM departments WHERE parent_code=$1 ORDER BY code', [department.code])).rows;
            scopeCodes = [department.code, ...subDepartments.map(d => d.code)];
        } else {
            // نظرة عامة (admin/manager بلا ?dept=): كل الأقسام
            const all = (await client.query('SELECT code, name FROM departments ORDER BY code')).rows;
            scopeCodes = all.map(d => d.code);
        }

        // ملاحظة: "desc" عمود محجوز في PostgreSQL — يجب اقتباسه صراحة
        const expenses = (await client.query(`SELECT id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType"
            FROM expenses WHERE "deptId" = ANY($1::varchar[]) ORDER BY date DESC, id DESC LIMIT 400`, [scopeCodes])).rows;
        const expenseSummary = aggregatePanelExpenses(expenses);

        const dispatchRows = (await client.query(`SELECT status, COUNT(*)::int AS count FROM dispatches WHERE "deptCode" = ANY($1::varchar[]) GROUP BY status`, [scopeCodes])).rows;
        const byStatus = {};
        let dispatchTotal = 0;
        for (const row of dispatchRows) { byStatus[row.status] = row.count; dispatchTotal += row.count; }

        res.json({
            scope: {
                deptCode: scope.deptCode,
                role: req.user.role,
                view: scope.deptCode ? 'department' : 'overview',
                subDepartmentCodes: subDepartments.map(d => d.code),
            },
            department: department ? { code: department.code, name: department.name, icon: department.icon, color: department.color, parentCode: department.parent_code } : null,
            subDepartments,
            expenses: expenseSummary,
            dispatches: { total: dispatchTotal, byStatus },
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('[warehouse_dept_panel]', error);
        res.status(500).json({ error: 'DEPT_PANEL_FAILED', message: 'تعذر تحميل لوحة القسم' });
    } finally {
        client.release();
    }
});

router.post('/dispatches/:id/approve', jwtAuth, requireRoleOrPerm(APPROVAL_ROLES, 'dispatch.approve'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const approvalSignature = requireSignature(req, res);
    if (!approvalSignature) {return;}
    if (!beginDispatchOp(req.params.id, 'approve')) {
        return fail(res, 409, 'DISPATCH_APPROVE_IN_PROGRESS', 'اعتماد هذا الإذن قيد التنفيذ الآن — انتظر النتيجة ولا تُكرر الضغط');
    }
    let client = null;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        // حدّ الانتظار على القفل: تعامل متزامن على نفس الأصناف يظل معقولًا، لكن
        // الاصطفاف الطويل هو ما كان يجمّد الشاشة كلها (كان 20 ثانية في اللوج).
        await client.query("SET LOCAL lock_timeout = '8000'");
        const dispatchResult = await client.query('SELECT * FROM dispatches WHERE id = $1 FOR UPDATE', [req.params.id]);
        const dispatch = dispatchResult.rows[0];
        if (!dispatch) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');
        }
        // Task 19: بوابة سلسلة الاعتماد — طلب رئيس القسم يجب أن يعتمده الشيف العمومي أولًا،
        // ولا يجوز اعتماد إذن معتمد/مرفوض/مستلم سلفًا (كان يسمح بخصم مزدوج لإذن مستلم)
        const guard = canWarehouseApprove(dispatch, req.user);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            if (guard.code === 'DISPATCH_SELF_DECISION_FORBIDDEN') {
                return fail(res, 403, guard.code, 'فصل المهام: لا يجوز اعتماد أو رفض إذن أنشأته بنفسك');
            }
            const messages = {
                CHEF_APPROVAL_REQUIRED: 'طلب الصرف مقدم من رئيس قسم ويجب اعتماد الشيف العمومي أولًا قبل صرف المخازن',
                DISPATCH_ALREADY_APPROVED: 'تم اعتماد طلب الصرف مسبقاً',
                DISPATCH_REJECTED: 'لا يمكن اعتماد طلب مرفوض',
                DISPATCH_ALREADY_RECEIVED: 'تم استلام هذا الإذن — لا يمكن اعتماده مرة أخرى',
                DISPATCH_INVALID_STATUS: 'حالة طلب الصرف لا تسمح بالاعتماد',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'حالة طلب الصرف لا تسمح بالاعتماد',
                { status: dispatch.status, dispatchId: dispatch.id });
        }

        const revision = await dispatchRevision(client, dispatch.id);
        const requested = normalizeRequestedItems(req.body?.approvedItems?.length ? req.body.approvedItems : dispatch.items);
        const requestedLines = normalizeRequestedItems(dispatch.items);
        const requestedByName = new Map(requestedLines.map(item => [item.itemName.toLowerCase(), item]));
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_APPROVED_ITEMS', 'يجب تحديد صنف وكمية معتمدة');
        }
        for (const item of requested) {
            if (!requestedByName.has(item.itemName.toLowerCase())) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'APPROVAL_ITEM_NOT_REQUESTED', `الصنف "${item.itemName}" غير موجود في طلب الصرف الأصلي`);
            }
        }

        const approvedItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
let totalValue = 0;
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');

        for (const requestedItem of requested) {
            const invResult = await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE',
                [requestedItem.itemName]);
            const inv = invResult.rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            // ─── Catch Weight احترافي: الاستلام بالكيلو، والطلب بالكرتون، والوزن الفعلي من الميزان ───
            // للأصناف ذات الوزن المتغير: عدد الكراتين + الوزن الفعلي إجباري، والخصم والتكلفة بالكيلو الفعلي
            const isCatchWeight = Boolean(inv.catch_weight_enabled);
            const packagingUom = inv.packaging_uom || 'كرتون';
            const catchUom = inv.catch_weight_uom || 'kg';
            const actualWeight = isCatchWeight ? n(requestedItem.actualWeight, 0) : 0;
            const packagingQty = isCatchWeight ? n(requestedItem.packagingQty, 0) : 0;
            if (isCatchWeight && (!(actualWeight > 0) || !(packagingQty > 0))) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'CATCH_WEIGHT_REQUIRED', `الصنف "${inv.name}" وزن متغير: أدخل الوزن الفعلي بالكيلو وعدد الكراتين`, {
                    itemName: inv.name,
                });
            }
            // الكمية المؤثرة مخزنيًا ومحاسبيًا: الوزن الفعلي لأصناف CW، والكمية العادية لغيرها
            const effectiveQty = isCatchWeight ? round(actualWeight, 3) : requestedItem.qty;
            const requestedLine = requestedByName.get(requestedItem.itemName.toLowerCase());
            const exceedsRequest = isCatchWeight
                ? packagingQty > n(requestedLine.qty) + 1e-6
                : effectiveQty > n(requestedLine.qty) + 1e-6;
            if (exceedsRequest) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'APPROVAL_QTY_EXCEEDED', `الكمية المعتمدة للصنف "${inv.name}" أكبر من الكمية المطلوبة`, {
                    itemName: inv.name, requested: n(requestedLine.qty),
                    approved: isCatchWeight ? packagingQty : effectiveQty,
                });
            }
            // قرار المالك 2026-10-07: مخزن رئيسي واحد فقط للخصم — الفروع للمطبخ لا تُمس.
            // التحقق من رصيد الرئيسي فقط، وأي عجز = رفض (لا سحب تلقائي من الفروع).
            const mainAvailableResult = await client.query(
                `SELECT COALESCE(GREATEST(0, on_hand - reserved), 0) AS main_available
                 FROM inventory_location_balances
                 WHERE inventory_id = $1 AND location_id = $2`,
                [inv.id, mainLocation.id]);
            const totalAvailable = n(mainAvailableResult.rows[0]?.main_available);
            if (effectiveQty > totalAvailable) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'INSUFFICIENT_STOCK', `الرصيد غير كافٍ من ${inv.name} في المخزن الرئيسي (الفروع لا تُمس)`, {
                    itemName: inv.name, requested: effectiveQty, available: totalAvailable,
                });
            }

            const value = round(effectiveQty * n(inv.avgCost), 2);
            const dispatchRef = `DIS-${dispatch.id}`;

// الخصم من المخزن الرئيسي فقط — مباشرة وبدون توزيع على الفروع
            const unitForLedger = isCatchWeight ? catchUom : (inv.unit || requestedItem.unit || 'وحدة');

            await postInventoryLedgerEntry(client, {
                transactionType: 'transfer_out',
                inventoryId: Number(inv.id),
                locationId: mainLocation.id,
                quantityDelta: -effectiveQty,
                unit: unitForLedger,
                unitCost: n(inv.avgCost),
                sourceLocationId: mainLocation.id,
                referenceType: 'dispatch',
                referenceId: dispatchRef,
                userId: req.user.id,
                idempotencyKey: `dispatch:${dispatch.id}:approve:r${revision}:${inv.id}:${mainLocation.id}`,
                reason: `اعتماد صرف ${inv.name} من المخزن الرئيسي`,
                metadata: { dispatch_id: dispatch.id, approval_revision: revision, location_id: mainLocation.id,
                    ...(isCatchWeight ? { packaging_qty: packagingQty, packaging_uom: packagingUom } : {}) },
                catchWeightQty: isCatchWeight ? packagingQty : null,
                catchWeightUnit: isCatchWeight ? packagingUom : null,
            });

        // للـ inventoryTx: الكمية الأساسية = الوزن الفعلي (kg)، وحقول Catch = عدد الكراتين
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, effectiveQty, dateOnly(dispatch.date), n(inv.avgCost), value,
                    req.body?.approveNotes || `اعتماد طلب صرف #${dispatch.id}`, dispatchRef,
                    isCatchWeight ? packagingQty : null, isCatchWeight ? packagingUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','dispatch') RETURNING *`,
                [id(), dispatch.deptCode, isCatchWeight
                    ? `صرف مخزون - ${inv.name} (${packagingQty} ${packagingUom} = ${effectiveQty} ${catchUom})`
                    : `صرف مخزون - ${inv.name} (${requestedItem.qty} ${inv.unit || requestedItem.unit})`, value,
                    dateOnly(dispatch.date), `من طلب صرف #${dispatch.id} — حركة مخزون ${tx.id}`]
            )).rows[0];

            const approved = {
                name: inv.name,
                itemName: inv.name,
                itemId: Number(inv.id),
                unit: isCatchWeight ? catchUom : (inv.unit || requestedItem.unit || 'وحدة'),
                requestedQty: requestedItem.qty,
                requestedPackagingQty: isCatchWeight ? n(requestedItem.packagingQty, 0) || null : null,
                approvedQty: effectiveQty,
                avgCost: n(inv.avgCost),
                approvedValue: value,
                expenseId: expense.id,
                // Catch weight fields
                catchWeightEnabled: isCatchWeight,
                actualWeight: isCatchWeight ? effectiveQty : null,
                packagingQty: isCatchWeight ? packagingQty : null,
                packagingUom: isCatchWeight ? packagingUom : null,
                catchWeightUom: catchUom,
            };
            approvedItems.push(approved);
            const globalBalance = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            stockChanges.push({ ...inv, qty: globalBalance });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
        }

        const approvedDate = new Date().toISOString();
        const updatedDispatch = (await client.query(
            `UPDATE dispatches SET status='approved', "approvedDate"=$1, "approvedBy"=$2,
             "approveNotes"=$3, "approvedItems"=$4, "warehouseApprovedAt"=$5,
             "warehouseApprovedBy"=$6, "warehouseApprovalSignatureData"=$7,
             "warehouseApprovalSignatureHash"=$8 WHERE id=$9 RETURNING *`,
            [approvedDate, req.user.name || req.user.username || String(req.user.id), req.body?.approveNotes || null, json(approvedItems), approvedDate,
                req.user.name || req.user.username || String(req.user.id), approvalSignature, signatureHash(approvalSignature), dispatch.id]
        )).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'warehouse_approved', dispatch.status, 'approved', req, approvalSignature, { approvedItems, notes: req.body?.approveNotes || null });
        // TASK 9: حدثا دومين داخل نفس المعاملة (fail-open): الصرف + المصروف المولد
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_APPROVED', aggregateType: 'dispatch', aggregateId: dispatch.id,
            deptCode: dispatch.deptCode,
            payload: { dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2), items: approvedItems.length },
        });
        await emitDomainEvent(pool, client, 'EXPENSE', {
            eventType: 'EXPENSE_CREATED', aggregateType: 'dispatch', aggregateId: dispatch.id,
            deptCode: dispatch.deptCode,
            payload: { dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2), kind: 'dispatch_materials' },
        });
        await require('../accounting-routes').postDispatchToLedger(dispatch.id, {
            totalValue, date: dateOnly(dispatch.date), deptCode: dispatch.deptCode, db: client, revision,
        });
        await client.query('COMMIT');

        emit(req, 'dispatches', 'update', updatedDispatch);
        // Task 20: إشعار فوري — المخازن صرفت: مقدم الطلب والشيف العمومي
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'warehouse_approved', { io: req.io });
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ dispatch: updatedDispatch, stockChanges, transactions, expenses, totalValue: round(totalValue, 2), revision });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        logger.error('[warehouse_dispatch_approve]', error);
        if (error.code === '55P03') {
            return fail(res, 409, 'DISPATCH_STOCK_BUSY', 'الصنف مستخدم في عملية صرف أخرى الآن — أعد المحاولة بعد ثانية');
        }
        const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : (error.statusCode || 500);
        const message = error.code === 'INSUFFICIENT_STOCK' ? 'الرصيد غير كافٍ في المخزن الرئيسي لاعتماد إذن الصرف'
            : (error.statusCode === 423 ? 'الفترة المحاسبية مقفلة — افتحها قبل اعتماد الصرف'
                : (error.statusCode === 422 ? error.message : 'تعذر اعتماد طلب الصرف بشكل ذري'));
        res.status(status).json({ error: error.code || (error.statusCode === 423 ? 'ACCOUNTING_PERIOD_CLOSED' : 'DISPATCH_APPROVE_FAILED'), message });
    } finally {
        endDispatchOp(req.params.id, 'approve');
        if (client) {client.release();}
    }
});

// ═══ Task 19: اعتماد الشيف العمومي لطلب رئيس القسم ═══
// pending → chef_approved (بدون أي خصم مخزني — الخصم عند اعتماد المخازن فقط)
router.post('/dispatches/:id/chef-approve', jwtAuth, requireRoleOrPerm(CHEF_APPROVAL_ROLES, 'dispatch.chef_approve'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const chefSignature = requireSignature(req, res);
    if (!chefSignature) {return;}
    if (!beginDispatchOp(req.params.id, 'chef-approve')) {
        return fail(res, 409, 'DISPATCH_CHEF_APPROVE_IN_PROGRESS', 'اعتماد الشيف العمومي لهذا الإذن قيد التنفيذ الآن — انتظر النتيجة');
    }
    let client = null;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        const guard = canChefDecide(dispatch, req.user);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            if (guard.code === 'DISPATCH_SELF_DECISION_FORBIDDEN') {
                return fail(res, 403, guard.code, 'فصل المهام: لا يجوز اعتماد أو رفض إذن أنشأته بنفسك');
            }
            const messages = {
                CHEF_APPROVAL_NOT_REQUIRED: 'هذا الطلب لا يحتاج اعتماد الشيف العمومي (ليس مقدمًا من رئيس قسم)',
                DISPATCH_NOT_PENDING: 'الإذن ليس في حالة الانتظار — اعتمد أو رفض سابقًا، فلا حاجة لإعادة الضغط',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'لا يمكن اعتماد الطلب حاليًا',
                { status: dispatch.status, dispatchId: dispatch.id });
        }
        // طلب المالك 2026-10-05: المنع قاطع — لا يُعتمد إذن صرف صنفه بلا رصيد كافٍ
        // (كان مجرد تنبيه في الرد ثم رفض متأخر عند المخازن، فيعلق الإذن في السلسلة)
        const stockGate = await dispatchStockGate(client, dispatch.items);
        if (!stockGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INSUFFICIENT_STOCK',
                'لا يمكن اعتماد إذن الصرف — الرصيد غير كافٍ في المخزن: ' + stockGate.shortages.map(s => s.message).join('، '),
                { shortages: stockGate.shortages });
        }
        const availabilityWarnings = [];
        const chefApprovedAt = new Date().toISOString();
        const chefName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='chef_approved',
          "chefApprovedAt"=$1, "chefApprovedBy"=$2, "chefApprovalSignatureData"=$3, "chefApprovalSignatureHash"=$4
          WHERE id=$5 RETURNING *`,
          [chefApprovedAt, chefName, chefSignature, signatureHash(chefSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'chef_approved', dispatch.status, 'chef_approved', req, chefSignature, {
            chefNotes: String(req.body?.notes || '').trim() || null,
            availabilityWarnings,
        });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — الشيف اعتمد: مقدم الطلب + المخازن (بانتظار الصرف)
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'chef_approved', { io: req.io });
        res.json({ dispatch: updated, availabilityWarnings });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        logger.error('[pr_create]', error);
        logger.error('[chef_dispatch_approve]', error);
        res.status(500).json({ error: 'CHEF_APPROVE_FAILED', message: 'تعذر اعتماد الطلب من الشيف العمومي بشكل موثق' });
    } finally { endDispatchOp(req.params.id, 'chef-approve'); if (client) {client.release();} }
});

// ═══ Task 19: رفض الشيف العمومي لطلب رئيس القسم ═══
// pending → rejected مع توثيق سبب الرفض وتوقيع الشيف
router.post('/dispatches/:id/chef-reject', jwtAuth, requireRoleOrPerm(CHEF_APPROVAL_ROLES, 'dispatch.chef_approve'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const chefSignature = requireSignature(req, res);
    if (!chefSignature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'REJECTION_REASON_REQUIRED', 'سبب رفض الشيف العمومي مطلوب');}
    if (!beginDispatchOp(req.params.id, 'chef-reject')) {
        return fail(res, 409, 'DISPATCH_CHEF_REJECT_IN_PROGRESS', 'رفض الشيف لهذا الإذن قيد التنفيذ الآن — انتظر النتيجة');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        const guard = canChefDecide(dispatch, req.user);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            if (guard.code === 'DISPATCH_SELF_DECISION_FORBIDDEN') {
                return fail(res, 403, guard.code, 'فصل المهام: لا يجوز اعتماد أو رفض إذن أنشأته بنفسك');
            }
            const messages = {
                CHEF_APPROVAL_NOT_REQUIRED: 'هذا الطلب لا يحتاج اعتماد الشيف العمومي (ليس مقدمًا من رئيس قسم)',
                DISPATCH_NOT_PENDING: 'الإذن ليس في حالة الانتظار — حُسِم قراره سابقًا، فلا حاجة لإعادة الضغط',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'لا يمكن رفض الطلب حاليًا',
                { status: dispatch.status, dispatchId: dispatch.id });
        }
        const chefRejectedAt = new Date().toISOString();
        const chefName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='rejected',
          "rejectionReason"=$1, "rejectedBy"=$2, "rejectedDate"=$3,
          "chefRejectedAt"=$4, "chefRejectedBy"=$5, "chefRejectionSignatureData"=$6, "chefRejectionSignatureHash"=$7
          WHERE id=$8 RETURNING *`,
          [reason, chefName, chefRejectedAt, chefRejectedAt, chefName, chefSignature, signatureHash(chefSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'chef_rejected', dispatch.status, 'rejected', req, chefSignature, { reason });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — الشيف رفض: مقدم الطلب يرى السبب
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'chef_rejected', { io: req.io, reason });
        res.json({ dispatch: updated });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[chef_dispatch_reject]', error);
        res.status(500).json({ error: 'CHEF_REJECT_FAILED', message: 'تعذر رفض الطلب من الشيف العمومي بشكل موثق' });
    } finally { endDispatchOp(req.params.id, 'chef-reject'); client.release(); }
});

// ─── تعديل إذن الصرف قبل وصوله للمخزن (طلب المالك 2026-10-04) ────────────────
// من يعدل: صاحب الإذن، أو الشيف/السو شيف، أو admin/manager.
// متى: فقط وهو 'pending' أو 'chef_approved' (قبل اعتماد المخازن).
// الأثر: لو كان معتمدًا من الشيف يُلغى اعتماده وتُمسح تواقيعه ويرجع «قيد الانتظار»
// ليُعتمد من جديد على الأرقام الجديدة. كل تعديل يُوثَّق في سلسلة أحداث الإذن.
router.put('/dispatches/:id/edit', jwtAuth, requireRoleOrPerm(CREATE_ROLES, 'dispatch.edit'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        if (!['pending', 'chef_approved'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_EDITABLE', `لا يمكن تعديل الطلب في حالته الحالية (${dispatch.status}) — التعديل متاح قبل اعتماد المخازن فقط`);
        }
        const isCreator = dispatch.creatorUserId != null && Number(dispatch.creatorUserId) === Number(req.user.id);
        const isChef = ['kitchen', 'sous_chef'].includes(req.user.role);
        const isBoss = ['admin', 'manager'].includes(req.user.role);
        // قرار المالك 2026-10-09: رئيس القسم يعدّل أذونات قسمه قبل الاعتماد
        const isDeptHeadOfDept = req.user?.role === 'dept_head' && String(req.user?.dept_code || '')
            .split(',').map(s => s.trim()).filter(Boolean).some(code => deptsMatch(code, dispatch.deptCode));
        if (!isCreator && !isChef && !isBoss && !isDeptHeadOfDept) {
            await client.query('ROLLBACK');
            return fail(res, 403, 'EDIT_FORBIDDEN', 'التعديل متاح لصاحب الطلب أو رئيس القسم أو للشيف أو للإدارة فقط');
        }
        // نفس تحققات بناء الطلب: أصناف صالحة فقط
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems
            .map((/** @type {any} */ r) => ({
                itemName: cleanName(r.itemName || r.name).slice(0, 200),
                qty: n(r.qty),
                unit: (cleanName(r.unit) || 'وحدة').slice(0, 50),
                ...(r.itemId || r.item_id ? { itemId: Number(r.itemId || r.item_id) || null } : {}),
                ...(r.actualWeight != null && r.actualWeight !== '' ? { actualWeight: n(r.actualWeight) } : {}),
                ...(r.packagingQty != null && r.packagingQty !== '' ? { packagingQty: n(r.packagingQty) } : {}),
                ...(r.packagingUom ? { packagingUom: cleanName(r.packagingUom).slice(0, 50) } : {}),
                ...(r.requestedQty != null && r.requestedQty !== '' ? { requestedQty: n(r.requestedQty) } : {}),
                ...(r.requestedUom ? { requestedUom: cleanName(r.requestedUom).slice(0, 50) } : {}),
                ...(r.estWeightKg != null && r.estWeightKg !== '' ? { estWeightKg: n(r.estWeightKg) } : {}),
            }))
            .filter((/** @type {any} */ i) => i.itemName && i.qty > 0 && i.qty <= 999999999);
        if (!items.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'NO_VALID_ITEMS', 'لا توجد أصناف صالحة — كل صنف يحتاج اسمًا وكمية أكبر من صفر');
        }
        if (items.length > 200) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'TOO_MANY_ITEMS', 'الحد الأقصى 200 صنف في الإذن');
        }
        // طلب المالك 2026-10-05: التعديل لا يتجاوز بوابة الرصيد — لا يُقبل إذن بلا رصيد كافٍ
        const editStockGate = await dispatchStockGate(client, items);
        if (!editStockGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INSUFFICIENT_STOCK',
                'لا يمكن تعديل إذن الصرف — الرصيد غير كافٍ في المخزن: ' + editStockGate.shortages.map(s => s.message).join('، '),
                { shortages: editStockGate.shortages });
        }
        const reason = cleanName(req.body?.reason).slice(0, 200) || 'تعديل قبل الاعتماد';
        // تعديل القسم الطالب (طلب المالك 2026-10-04): رئيس القسم مُجبر على قسمه دائمًا،
        // والشيف/الإدارة قد ينقلان الطلب لقسم آخر موجود في دليل الأقسام.
        let deptCode = dispatch.deptCode;
        let deptName = dispatch.deptName;
        let deptChanged = false;
        const newDeptRaw = req.body?.deptCode !== undefined && req.body?.deptCode !== null ? cleanName(req.body.deptCode).slice(0, 50) : '';
        if (newDeptRaw && newDeptRaw.toLowerCase() !== String(dispatch.deptCode || '').toLowerCase()) {
            if (req.user.role === 'dept_head') {
                const forced = resolveDeptHeadDispatch(req.user, newDeptRaw);
                if (!forced.ok) {
                    await client.query('ROLLBACK');
                    return fail(res, 403, forced.code, 'رئيس القسم يعدل في قسمه فقط');
                }
                deptCode = forced.deptCode;
            } else {
                const dep = (await client.query(
                    'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1',
                    [newDeptRaw]
                )).rows[0] || (await client.query(
                    'SELECT code, name AS name FROM "hrDepartments" WHERE LOWER(code)=LOWER($1) LIMIT 1',
                    [newDeptRaw]
                )).rows[0];
                if (!dep) {
                    await client.query('ROLLBACK');
                    return fail(res, 422, 'DEPT_NOT_FOUND', `القسم المختار غير موجود: ${newDeptRaw}`);
                }
                deptCode = dep.code;
                deptName = dep.name;
            }
            deptChanged = String(deptCode).toLowerCase() !== String(dispatch.deptCode || '').toLowerCase();
        }
        const wasChefApproved = dispatch.status === 'chef_approved';
        const updated = (await client.query(
            `UPDATE dispatches SET items=$1, status='pending',
               "deptCode"=$2, "deptName"=$3,
               notes = COALESCE(NULLIF($4,''), notes),
               "chefApprovedAt"=NULL, "chefApprovedBy"=NULL,
               "chefApprovalSignatureData"=NULL, "chefApprovalSignatureHash"=NULL
             WHERE id=$5 RETURNING *`,
            [JSON.stringify(items), deptCode, deptName, wasChefApproved ? `عدّل المحتوى ${req.user.name || req.user.username}: ${reason}` : '', dispatch.id]
        )).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'edited', dispatch.status, 'pending', req, null, {
            reason,
            chefApprovalReset: wasChefApproved,
            deptChanged,
            oldDept: dispatch.deptCode,
            newDept: deptCode,
            oldItems: Array.isArray(dispatch.items) ? dispatch.items : (() => { try { return JSON.parse(dispatch.items || '[]'); } catch (_) { return []; } })(),
            newItems: items,
        });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        logger.info(`[dispatch_edit] ${req.user?.username} عدّل إذن الصرف ${dispatch.id} (${items.length} صنفًا) — ${reason}${deptChanged ? ` — القسم: ${dispatch.deptCode} → ${deptCode}` : ''}${wasChefApproved ? ' — اعتماد الشيف أُلغي لإعادة المراجعة' : ''}`);
        res.json({ ok: true, dispatch: updated, chefApprovalReset: wasChefApproved, deptChanged });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dispatch_edit]', error);
        res.status(500).json({ error: 'DISPATCH_EDIT_FAILED', message: 'تعذر تعديل إذن الصرف' });
    } finally { client.release(); }
});

router.post('/dispatches/:id/reject', jwtAuth, requireRoleOrPerm(APPROVAL_ROLES, 'dispatch.approve'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const rejectionSignature = requireSignature(req, res);
    if (!rejectionSignature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'REJECTION_REASON_REQUIRED', 'سبب رفض إذن الصرف مطلوب');}
    if (!beginDispatchOp(req.params.id, 'reject')) {
        return fail(res, 409, 'DISPATCH_REJECT_IN_PROGRESS', 'رفض هذا الإذن قيد التنفيذ الآن — انتظر النتيجة');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        const selfGuard = dispatchSelfDecisionGuard(req.user, dispatch);
        if (!selfGuard.ok) {
            await client.query('ROLLBACK');
            return fail(res, 403, selfGuard.code, 'فصل المهام: لا يجوز اعتماد أو رفض إذن أنشأته بنفسك');
        }
        if (dispatch.needsChefApproval && dispatch.status === 'pending') {
            await client.query('ROLLBACK');
            return fail(res, 409, 'CHEF_APPROVAL_REQUIRED', 'طلب رئيس القسم في مرحلة اعتماد الشيف العمومي — استخدم مسار رفض الشيف');
        }
        const rejectableStatuses = dispatch.needsChefApproval ? ['chef_approved'] : ['pending'];
        if (!rejectableStatuses.includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_PENDING', 'الإذن ليس في حالة الانتظار — حُسِم قراره سابقًا',
                { status: dispatch.status, dispatchId: dispatch.id });
        }
        const rejectedAt = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='rejected', "rejectionReason"=$1,
          "rejectedBy"=$2, "rejectedDate"=$3, "warehouseRejectedAt"=$4,
          "warehouseRejectedBy"=$5, "warehouseRejectionSignatureData"=$6,
          "warehouseRejectionSignatureHash"=$7 WHERE id=$8 RETURNING *`,
          [reason, actorName, rejectedAt, rejectedAt, actorName, rejectionSignature, signatureHash(rejectionSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'warehouse_rejected', dispatch.status, 'rejected', req, rejectionSignature, { reason });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — المخازن رفضت: مقدم الطلب يرى السبب
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'warehouse_rejected', { io: req.io, reason });
        res.json({ dispatch: updated });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_dispatch_reject]', error);
        res.status(500).json({ error: 'DISPATCH_REJECT_FAILED', message: 'تعذر رفض طلب الصرف بشكل موثق' });
    } finally { endDispatchOp(req.params.id, 'reject'); client.release(); }
});

router.post('/dispatches/:id/receive', jwtAuth, requireRoleOrPerm(RECEIVE_ROLES, 'dispatch.receive'), idempotency({ requireKey: true }), async (/** @type {any} */ req, /** @type {any} */ res) => {
    const receiptSignature = requireSignature(req, res);
    if (!receiptSignature) {return;}
    if (!beginDispatchOp(req.params.id, 'receive')) {
        return fail(res, 409, 'DISPATCH_RECEIVE_IN_PROGRESS', 'استلام هذا الإذن قيد التنفيذ الآن — انتظر النتيجة ولا تُكرر الضغط');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        if (!['approved', 'partially_received'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_RECEIVABLE', 'الإذن غير قابل للاستلام في حالته الحالية — القرار مسجَّل فعلًا',
                { status: dispatch.status, dispatchId: dispatch.id });
        }
        if (dispatch.kitchenReceivedAt && dispatch.status !== 'partially_received') {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_RECEIPT_ALREADY_RECORDED', 'تم تسجيل الاستلام لهذا الإذن مسبقًا',
                { status: dispatch.status, dispatchId: dispatch.id });
        }
        // رئيس القسم يستلم إذن قسمه هو فقط — عزل الأقسام على مستوى الاستلام
        const receiveGate = canReceiveDispatch(req.user, dispatch);
        if (!receiveGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, receiveGate.code === 'INVALID_INPUT' ? 422 : 403, receiveGate.code,
                receiveGate.code === 'DEPT_MISMATCH' ? 'لا يمكنك استلام إذن صرف لقسم غير قسمك'
                    : receiveGate.code === 'DISPATCH_SELF_DECISION_FORBIDDEN' ? 'فصل المهام: لا يجوز استلام إذن صرف أنشأته بنفسك'
                    : receiveGate.code === 'DEPT_HEAD_WITHOUT_DEPARTMENT' ? 'حساب رئيس القسم غير مرتبط بقسم — راجع إدارة المستخدمين'
                        : 'بيانات الاستلام غير مكتملة');
        }
        const revision = await dispatchRevision(client, dispatch.id);
        const approved = normalizeRequestedItems(dispatch.approvedItems || dispatch.items);
        const approvedNames = new Set(approved.map(item => item.itemName.toLowerCase()));
        const priorReceived = new Map((Array.isArray(dispatch.receivedItems) ? dispatch.receivedItems : [])
            .map(/** @type {any} */ (item) => [cleanName(item.itemName || item.name).toLowerCase(), item]));
        const requested = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!requested.length) { await client.query('ROLLBACK'); return fail(res, 422, 'RECEIVED_ITEMS_REQUIRED', 'أدخل الكميات المستلمة للصنف'); }
        const requestedNames = new Set();
        let hasDelta = false;
        for (const raw of requested) {
            const itemName = cleanName(raw.itemName || raw.name);
            const nameKey = itemName.toLowerCase();
            if (requestedNames.has(nameKey)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'RECEIPT_ITEM_DUPLICATED', `الصنف "${itemName}" مكرر في الاستلام`);
            }
            requestedNames.add(nameKey);
            if (!approvedNames.has(nameKey)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'RECEIPT_ITEM_NOT_APPROVED', `الصنف "${itemName || 'غير المحدد'}" غير معتمد في إذن الصرف`);
            }
            const receivedDeltaQty = n(raw.receivedQty ?? raw.qty, -1);
            if (receivedDeltaQty > 0) {hasDelta = true;}
        }
        if (!hasDelta) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'RECEIPT_DELTA_REQUIRED', 'يجب إدخال كمية مستلمة أكبر من صفر لصنف واحد على الأقل');
        }
        const receivedItems = approved.map((allowed) => {
            const nameKey = allowed.itemName.toLowerCase();
            const prior = priorReceived.get(nameKey) || {};
            const raw = requested.find(/** @type {any} */ (item) => cleanName(item.itemName || item.name).toLowerCase() === nameKey);
            const receivedDeltaQty = raw ? n(raw.receivedQty ?? raw.qty, -1) : 0;
            const alreadyReceivedQty = n(prior.receivedQty, 0);
            const receivedQty = round(alreadyReceivedQty + receivedDeltaQty);
            if ((raw && receivedDeltaQty < 0) || receivedQty > n(allowed.qty) + 1e-6) {
                throw Object.assign(new Error('INVALID_RECEIPT_QTY'), { code: 'INVALID_RECEIPT_QTY', itemName: allowed.itemName });
            }
            const allowedPkg = n(allowed.packagingQty, 0);
            const isCwReceipt = allowedPkg > 0;
            const receivedPackagingDelta = isCwReceipt ? (raw ? n(raw.receivedPackagingQty ?? raw.packagingQty, -1) : 0) : null;
            const receivedPackagingQty = isCwReceipt ? round(n(prior.receivedPackagingQty, 0) + receivedPackagingDelta) : null;
            if (isCwReceipt && raw && (!Number.isFinite(receivedPackagingDelta) || receivedPackagingDelta < 0 || receivedPackagingQty > allowedPkg + 1e-6)) {
                throw Object.assign(new Error('INVALID_RECEIPT_PACKAGING_QTY'), { code: 'INVALID_RECEIPT_PACKAGING_QTY', itemName: allowed.itemName });
            }
            return {
                itemName: allowed.itemName, itemId: allowed.itemId || null, unit: allowed.unit,
                approvedQty: round(allowed.qty), receivedQty, receivedDeltaQty: round(receivedDeltaQty),
                varianceQty: round(receivedQty - n(allowed.qty)),
                ...(isCwReceipt ? {
                    approvedPackagingQty: allowedPkg, receivedPackagingQty,
                    receivedPackagingDeltaQty: round(receivedPackagingDelta),
                    packagingUom: allowed.packagingUom || 'كرتون',
                } : {}),
                notes: String(raw?.notes || '').trim() || null,
            };
        });
        const allReceived = receivedItems.every(item => item.receivedQty + 1e-6 >= n(item.approvedQty)
            && (item.receivedPackagingQty == null || item.receivedPackagingQty + 1e-6 >= n(item.approvedPackagingQty)));
        // Task 19: الاستلام إلى مخزن القسم الخاص (سلطات/حلواني/خباز/مطبخ ساخن/بيع خارجي)
        // والأقسام بلا مخزن مخصص تكمل في مخزن المطبخ كما في السلوك القديم
        const targetLocation = await getDispatchTargetLocation(client, dispatch.deptCode);
        const ledgerMovements = [];
        for (const received of receivedItems) {
            if (received.receivedDeltaQty <= 0) {continue;}
            const item = received.itemId
                ? (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE id=$1 FOR UPDATE', [received.itemId])).rows[0]
                : (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE LOWER(name)=LOWER($1) FOR UPDATE', [received.itemName])).rows[0];
            if (!item) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${received.itemName}`);
            }
            received.itemId = Number(item.id);
            received.itemName = item.name;
            received.unit = item.unit || received.unit || 'وحدة';
            const base = `dispatch:${dispatch.id}:receipt:r${revision}:${item.id}`;
            const receiptKey = signatureHash(receiptSignature);
            const receiptOperationKey = String(req.headers['x-idempotency-key']);
            const inn = await postInventoryLedgerEntry(client, { transactionType:'transfer_in', inventoryId:item.id, locationId:targetLocation.id, quantityDelta:received.receivedDeltaQty, unit:received.unit, unitCost:n(item.avgCost), destinationLocationId:targetLocation.id, referenceType:'dispatch_receipt', referenceId:String(dispatch.id), userId:req.user.id, idempotencyKey:`${base}:${receiptOperationKey}:in`, expiryDate: await latestExpiryFor(client, item.id), reason:`استلام مواد في ${targetLocation.name_ar} من إذن #${dispatch.id}`, metadata:{dispatch_id:dispatch.id, approval_revision:revision, receipt_operation_key:receiptOperationKey, receipt_signature_hash:receiptKey, target_location:targetLocation.code,
                ...(received.receivedPackagingDeltaQty != null ? { received_packaging_qty: received.receivedPackagingDeltaQty, packaging_uom: received.packagingUom || 'كرتون' } : {}) },
                catchWeightQty: received.receivedPackagingDeltaQty != null ? received.receivedPackagingDeltaQty : null,
                catchWeightUnit: received.receivedPackagingDeltaQty != null ? (received.packagingUom || 'كرتون') : null });
            ledgerMovements.push({inventory_id:item.id,quantity:received.receivedDeltaQty,target_location:targetLocation.code,balance:inn.balanceAfter});
            // FIX C5 (Enterprise 2026-10-03): الاستلام كان يكتب الدفتر فقط —
            // صف "inventoryTx" الناقص جعل الاستلامات غير مرئية في شاشة سجل
            // الحركات. نفس نمط اعتماد الصرف (type='in') بدون أي أثر رصيدي
            // (الجدول تاريخي مجمد).
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId")
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9)`,
                [id(), item.id, item.name, received.receivedDeltaQty, dateOnly(dispatch.date),
                 n(item.avgCost), n(received.receivedDeltaQty) * n(item.avgCost),
                 `استلام مواد من إذن صرف #${dispatch.id} — ${targetLocation.name_ar || targetLocation.code}`,
                 String(dispatch.id)]);
            // ملاحظة: قيد مصروف القسم يُقيَّد عند الاعتماد (adjustmentType='dispatch') —
            // لا يُقيَّد هنا عند الاستلام تجنّبًا للاحتساب المزدوج؛ الإرجاع يعكسه بمصروف سالب.
        }
        const receivedAt = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const nextStatus = allReceived ? 'received' : 'partially_received';
        const updated = (await client.query(`UPDATE dispatches SET status=$1, "receivedItems"=$2, "receiptNotes"=$3,
          "kitchenReceivedAt"=$4, "kitchenReceivedBy"=$5, "kitchenReceiptSignatureData"=$6,
          "kitchenReceiptSignatureHash"=$7 WHERE id=$8 RETURNING *`,
          [nextStatus, json(receivedItems), req.body?.notes || null, receivedAt, actorName, receiptSignature, signatureHash(receiptSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'kitchen_received', dispatch.status, nextStatus, req, receiptSignature, { receivedItems, operationKey: String(req.headers['x-idempotency-key']), notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — القسم استلم: المخازن والشيف يعرفان أن السلسلة أُغلقت
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'received', { io: req.io });
        res.json({ dispatch: updated, receivedItems, ledgerMovements });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === 'INVALID_RECEIPT_QTY' || error.code === 'INVALID_RECEIPT_PACKAGING_QTY') {
            return fail(res, 422, error.code, `كمية الاستلام غير صحيحة للصنف ${error.itemName || 'غير المحدد'}`);
        }
        logger.error('[pr_create]', error);
        logger.error('[kitchen_dispatch_receive]', error);
        const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 500;
        const message = error.code === 'INSUFFICIENT_STOCK' ? 'تعذر إضافة الاستلام؛ تحقق من رصيد المخزن الرئيسي' : 'تعذر تسجيل استلام المطبخ بشكل موثق';
        res.status(status).json({ error: error.code || 'DISPATCH_RECEIVE_FAILED', message });
    } finally { endDispatchOp(req.params.id, 'receive'); client.release(); }
});

/**
 * إرجاع مباشر من قسم للمخزن الرئيسي (بلا إذن صرف مسبق):
 * فائض إنتاج/تشغيل يُعيده المطبخ أو أي قسم — يُطابق الأصناف بالمخزون،
 * يزيد الرصيد عبر الدفتر، ويسجل حركة + عكس مصروف القسم. لا سقف كميات
 * (لا إذن مرجعي) — الاعتماد على مطابقة الاسم والكمية الموجبة فقط.
 */
async function directReturn(/** @type {any} */ client, /** @type {any} */ req, /** @type {any} */ res) {
    try {
        const deptCode = String(req.body?.deptCode || '').trim();
        if (!deptCode) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'DEPT_REQUIRED', 'اختر القسم المُرجِع');
        }
        const dept = (await client.query(
            'SELECT code, name FROM departments WHERE LOWER(code) = LOWER($1) LIMIT 1', [deptCode])).rows[0];
        if (!dept) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'DEPT_NOT_FOUND', `القسم غير موجود: ${deptCode}`);
        }
        const requested = normalizeRequestedItems(req.body?.items);
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');
        }
        const returnId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const returnItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let totalValue = 0;
        for (const requestedItem of requested) {
            if (!(requestedItem.qty > 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_RETURN_QTY', `كمية غير صحيحة للصنف ${requestedItem.itemName}`);
            }
            const inv = (await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE', [requestedItem.itemName])).rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            const cost = n(inv.avgCost);
            const value = round(requestedItem.qty * cost, 2);
            const drBoxes = requestedItem.packagingQty ? n(requestedItem.packagingQty) : null;
            const drPackUom = requestedItem.packagingUom || inv.packaging_uom || null;
            const returnUnit = inv.catch_weight_enabled ? (inv.catch_weight_uom || 'kg') : (inv.unit || requestedItem.unit || 'وحدة');
            if (inv.catch_weight_enabled && !(drBoxes > 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'RETURN_PACKAGING_REQUIRED', `أدخل عدد الكراتين المرتجعة للصنف ${requestedItem.itemName}`);
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            await postInventoryLedgerEntry(client, {
                transactionType: 'return', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: requestedItem.qty, unit: returnUnit, unitCost: cost,
                destinationLocationId: mainLocation.id,
                referenceType: 'direct_return', referenceId: String(returnId), userId: req.user.id,
                idempotencyKey: `direct-return:${returnId}:${inv.id}`,
                expiryDate: await latestExpiryFor(client, inv.id),
                reason: `إرجاع مباشر من ${dept.name} — ${req.body?.reason || 'فائض'}`,
                metadata: { return_id: returnId, dept_code: dept.code, direct: true },
                catchWeightQty: drBoxes, catchWeightUnit: drBoxes !== null ? drPackUom : null,
            });
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            // المتوسط المرجح يشمل الكمية المرجعة بسعرها
            const drOldQty = n(inv.qty);
            if (round(drOldQty + requestedItem.qty) > 0) {
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1',
                    [inv.id, round(((drOldQty * n(inv.avgCost)) + (requestedItem.qty * cost)) / round(drOldQty + requestedItem.qty), 2)]);
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,NULL,$9,$10) RETURNING *`,
                [id(), inv.id, inv.name, requestedItem.qty, dateOnly(new Date()), cost, value,
                    `إرجاع مباشر من ${dept.name} — ${req.body?.reason || 'إرجاع'}`, drBoxes, drBoxes !== null ? drPackUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','direct_return') RETURNING *`,
                [id(), dept.code, `عكس صرف - ${inv.name} (${requestedItem.qty} ${inv.unit || ''})`, -value,
                    dateOnly(new Date()), `إرجاع مباشر #${returnId} — حركة مخزون ${tx.id}`]
            )).rows[0];
            returnItems.push({ name: inv.name, itemName: inv.name, itemId: Number(inv.id), unit: returnUnit, qty: requestedItem.qty, avgCost: cost, totalValue: value,
                txId: tx.id, expenseId: expense.id,
                ...(drBoxes !== null ? { packagingQty: drBoxes, packagingUom: drPackUom } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
        }
        const returnRow = (await client.query(
            `INSERT INTO "kitchenReturns" (id, date, items, status, notes, reason, "dispatchId", "deptCode", "deptName", "totalValue", "createdBy")
             VALUES ($1,$2,$3,'approved',$4,$5,NULL,$6,$7,$8,$9) RETURNING *`,
            [returnId, dateOnly(new Date()), json(returnItems), req.body?.notes || null, req.body?.reason || 'إرجاع مباشر',
                dept.code, dept.name, round(totalValue, 2), req.user.username || String(req.user.id)]
        )).rows[0];
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_RETURNED', aggregateType: 'kitchen_return', aggregateId: returnId,
            deptCode: dept.code,
            payload: { return_id: returnId, direct: true, dept: dept.code, total: round(totalValue, 2) },
        });
        await require('../accounting-routes').postReturnToLedger(returnRow.id, {
            totalValue, date: returnRow.date, deptCode: returnRow.deptCode, db: client,
        });
        await client.query('COMMIT');
        emit(req, 'kitchenReturns', 'create', returnRow);
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ return: returnRow, stockChanges, transactions, expenses, totalValue: round(totalValue, 2), direct: true });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse/direct-return]', error.message);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: 'رصيد المخزن لا يكفي لإتمام الإرجاع المباشر' });
        }
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.statusCode === 423 ? 'ACCOUNTING_PERIOD_CLOSED' : 'RETURN_ACCOUNTING_INVALID', message: error.message });
        }
        res.status(500).json({ error: 'DIRECT_RETURN_FAILED', message: 'تعذر تنفيذ الإرجاع المباشر' });
    }
    // ملاحظة: التحرير على المتصل الخارجي (finally في POST /returns) — تحرير مزدوج يفسد الـ pool
}



module.exports = { directReturn };
