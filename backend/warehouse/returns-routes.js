// ─── مسارات المرتجعات ووارد المخزن والبحث الذكي
// مُستخرج حرفًا من backend/warehouse-routes.js (السطور 1329-1838).
// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js
// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.
const { __scope } = require('../warehouse-routes');
const { router, RETURN_ROLES, pool, jwtAuth, requireRole, logger, postInventoryLedgerEntry, emitDomainEvent, ensureDispatchCreatorSchema, notifyChainEvent, normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor, id, normItemName, n, round, dateOnly, cleanName, json, emit, fail, normalizeRequestedItems, getWarehouseLocation, getDispatchTargetLocation, ensureLocationBalance } = __scope;
const { directReturn } = require('./dispatch-routes');

router.post('/returns', jwtAuth, requireRole(...RETURN_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatchId = req.body?.dispatchId;
        // ─── إرجاع مباشر (بلا إذن صرف): قسم + أصناف مطابقة للمخزون ───
        // await إجبارية: الدالة تدير COMMIT/ROLLBACK وتحرر العميل بنفسها — بدونها
        // يُحرَّر العميل من finally الخارجي أثناء تنفيذ المعاملة (تلف بيانات)
        if (dispatchId === undefined || dispatchId === null || String(dispatchId).trim() === '') {
            return await directReturn(client, req, res);
        }
        const dispatchResult = await client.query('SELECT * FROM dispatches WHERE id = $1 FOR UPDATE', [dispatchId]);
        const dispatch = dispatchResult.rows[0];
        if (!dispatch) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');
        }
        if (!['approved', 'partially_received', 'received'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_APPROVED', 'لا يمكن إرجاع طلب غير معتمد');
        }

        // Once the kitchen has received (partially or fully), the returnable amount
        // for each item is capped by what was actually received
        const receivedRows = Array.isArray(dispatch.receivedItems) ? dispatch.receivedItems : [];
        const receivedByName = new Map(receivedRows.map(raw => [cleanName(raw.itemName || raw.name).toLowerCase(), n(raw.receivedQty ?? raw.qty)]));

        const approvedItems = normalizeRequestedItems(dispatch.approvedItems || dispatch.items);
        const alreadyReturned = new Map();
        const oldReturns = await client.query(
            'SELECT items FROM "kitchenReturns" WHERE "dispatchId" = $1 FOR UPDATE', [String(dispatch.id)]);
        for (const oldReturn of oldReturns.rows) {
            for (const raw of (oldReturn.items || [])) {
                const name = cleanName(raw.itemName || raw.name).toLowerCase();
                alreadyReturned.set(name, (alreadyReturned.get(name) || 0) + n(raw.qty));
            }
        }

        const requested = normalizeRequestedItems(req.body?.items);
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');
        }
        const approvedByName = new Map(approvedItems.map(item => [item.itemName.toLowerCase(), item]));
        const returnItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let totalValue = 0;
        const returnId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        // Task 19: الإرجاع من مخزن القسم الذي استلم فعليًا (وليس مخزن المطبخ الثابت)
        const deptLocation = await getDispatchTargetLocation(client, dispatch.deptCode);

        for (const requestedItem of requested) {
            const approved = approvedByName.get(requestedItem.itemName.toLowerCase());
            const previouslyReturned = alreadyReturned.get(requestedItem.itemName.toLowerCase()) || 0;
            const approvedQty = n(approved?.qty);
            const receivedQty = receivedByName.has(requestedItem.itemName.toLowerCase())
                ? receivedByName.get(requestedItem.itemName.toLowerCase())
                : approvedQty;
            const returnableBase = receivedByName.size ? Math.min(approvedQty, receivedQty) : approvedQty;
            const remaining = round(returnableBase - previouslyReturned);
            if (!approved || requestedItem.qty > remaining) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'RETURN_QTY_EXCEEDED', `كمية الإرجاع أكبر من الكمية المتبقية للصنف ${requestedItem.itemName}`, {
                    itemName: requestedItem.itemName, requested: requestedItem.qty, remaining,
                });
            }
            const invResult = await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE', [requestedItem.itemName]);
            const inv = invResult.rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            const cost = n(approved.avgCost, n(inv.avgCost));
            const value = round(requestedItem.qty * cost, 2);
            // Post the return through the inventory ledger so it persists across
            // ledger recomputations (direct qty writes are erased by the next posting)
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            // إذا كان القسم قد استلم فعليًا (استلام مسجل) فإن البضاعة تقع في مخزن القسم،
            // فيجب خصمها من مخزن القسم أولاً وإلا بقيت محتسبة هناك ومُضافة للمخزن الرئيسي
            // معًا (ازدواج عالمي في المخزون). إذن لم يُستلم بعد، فالبضاعة لم تغادر المخزن
            // الرئيسي فعليًا — يكفي إرجاعها لرصيده مباشرة.
            const retBoxes = requestedItem.packagingQty ? n(requestedItem.packagingQty) : null;
            const retPackUom = requestedItem.packagingUom || inv.packaging_uom || null;
            // حركة داخلية: الصنف دخل النظام من قبل — يُحمل تاريخ دُفعته المسجل في
            // الدفتر. لا تاريخ يُخترع ولا إرجاع يُرفض: الرفض هنا كان يعطّل المرتجعات
            // بلا فائدة، والتاريخ الأصلي يبقى مقيَّدًا في كل قيد.
            const carriedExpiry = await latestExpiryFor(client, inv.id);
            if (receivedByName.size) {
                await postInventoryLedgerEntry(client, {
                    transactionType: 'transfer_out', inventoryId: Number(inv.id), locationId: deptLocation.id,
                    quantityDelta: -requestedItem.qty, unit: inv.unit || requestedItem.unit || 'وحدة', unitCost: cost,
                    sourceLocationId: deptLocation.id, destinationLocationId: mainLocation.id,
                    referenceType: 'kitchen_return', referenceId: String(dispatch.id), userId: req.user.id,
                    idempotencyKey: `dispatch-return:${returnId}:${inv.id}:out`,
                    expiryDate: carriedExpiry,
                    reason: `خروج المرتجع من مخزن القسم ${dispatch.deptName || dispatch.deptCode} — إذن #${dispatch.id}`,
                    metadata: { dispatch_id: dispatch.id, return_id: returnId, note: 'returned_from_department_store' },
                    catchWeightQty: retBoxes, catchWeightUnit: retBoxes !== null ? retPackUom : null,
                });
            }
            await postInventoryLedgerEntry(client, {
                transactionType: 'return', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: requestedItem.qty, unit: inv.unit || requestedItem.unit || 'وحدة', unitCost: cost,
                sourceLocationId: deptLocation.id, destinationLocationId: mainLocation.id,
                referenceType: 'kitchen_return', referenceId: String(dispatch.id), userId: req.user.id,
                idempotencyKey: `dispatch-return:${returnId}:${inv.id}`,
                expiryDate: carriedExpiry,
                reason: `إرجاع من القسم ${dispatch.deptName || dispatch.deptCode} — إذن #${dispatch.id}`,
                metadata: { dispatch_id: dispatch.id, return_id: returnId, note: 'returned_to_main_warehouse' },
                catchWeightQty: retBoxes, catchWeightUnit: retBoxes !== null ? retPackUom : null,
            });
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            // المتوسط المرجح يشمل الكمية المرجعة بسعرها — وإلا انحرف متوسط التكلفة
            const retOldQty = n(inv.qty);
            const retNewQty = round(retOldQty + requestedItem.qty);
            if (retNewQty > 0) {
                const retNewAvg = round(((retOldQty * n(inv.avgCost)) + (requestedItem.qty * cost)) / retNewQty, 2);
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1', [inv.id, retNewAvg]);
            }
            const dispatchRef = `DIS-${dispatch.id}`;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, requestedItem.qty, dateOnly(new Date()), cost, value,
                    `إرجاع من القسم ${dispatch.deptName || dispatch.deptCode} — ${req.body?.reason || 'إرجاع'}`, dispatchRef, retBoxes, retBoxes !== null ? retPackUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','dispatch_return') RETURNING *`,
                [id(), dispatch.deptCode, `عكس صرف - ${inv.name} (${requestedItem.qty} ${inv.unit || requestedItem.unit})`, -value,
                    dateOnly(new Date()), `إرجاع طلب صرف #${dispatch.id} — حركة مخزون ${tx.id}`]
            )).rows[0];
            returnItems.push({ name: inv.name, itemName: inv.name, itemId: Number(inv.id), unit: inv.unit || requestedItem.unit || 'وحدة', qty: requestedItem.qty, avgCost: cost, totalValue: value,
                txId: tx.id, expenseId: expense.id,
                ...(requestedItem.actualWeight ? { actualWeight: requestedItem.actualWeight, packagingQty: requestedItem.packagingQty || null, packagingUom: requestedItem.packagingUom || inv.packaging_uom || null } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
            alreadyReturned.set(requestedItem.itemName.toLowerCase(), previouslyReturned + requestedItem.qty);
        }

        const returnRow = (await client.query(
            `INSERT INTO "kitchenReturns" (id, date, items, status, notes, reason, "dispatchId", "deptCode", "deptName", "totalValue", "createdBy")
             VALUES ($1,$2,$3,'approved',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [returnId, dateOnly(new Date()), json(returnItems), req.body?.notes || null, req.body?.reason || null,
                String(dispatch.id), dispatch.deptCode, dispatch.deptName, round(totalValue, 2), req.user.username || String(req.user.id)]
        )).rows[0];
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_RETURNED', aggregateType: 'kitchen_return', aggregateId: returnId,
            deptCode: dispatch.deptCode,
            payload: { return_id: returnId, dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2) },
        });
        await client.query('COMMIT');

        // عكس محاسبي متماثل best-effort: Dr مخزون / Cr COGS
        try {
            await require('../accounting-routes').postReturnToLedger(returnRow.id, {
                totalValue, date: returnRow.date, deptCode: returnRow.deptCode,
            });
        } catch (ledgerErr) {
            logger.error(`[return_ledger] FAILED return=${returnRow.id} dept=${returnRow.deptCode || '?'} value=${round(totalValue, 2)} :: ${(ledgerErr && (ledgerErr.message || ledgerErr.code)) || String(ledgerErr)}`);
        }

        emit(req, 'kitchenReturns', 'create', returnRow);
        // Task 20: إشعار فوري — إرجاع أصناف للقسم: المخازن والشيف يعرفان بالعكس
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'returned', { io: req.io });
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.status(201).json({ return: returnRow, stockChanges, transactions, expenses, totalValue: round(totalValue, 2) });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_return]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: 'رصيد مخزن القسم لا يكفي لإرجاع هذه الكمية — قد تكون المواد مستهلكة بالفعل', available: error.available, requested: error.requested });
        }
        res.status(500).json({ error: 'KITCHEN_RETURN_FAILED', message: 'تعذر تنفيذ الإرجاع العكسي بشكل ذري' });
    } finally {
        client.release();
    }
});



// ─── DELETE /api/warehouse/returns/:id — حذف سجل مرتجع مع عكس أثره المخزني ───
// الحذف الصامت كان يُبقي المخزون متضخمًا (+qty بلا عكس). الآن: قيدان تعويضيان
// (عكس كل حركة) + حذف حركات Tx والمصاريف المرتبطة + حذف السجل — كله ذريًا.
// السجلات القديمة بلا ربط (txId) تُرفض بـ 409 لحمايتها من العكس الأعمى.
router.delete('/returns/:id', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const returnId = req.params.id;
        const existing = (await client.query('SELECT * FROM "kitchenReturns" WHERE id = $1 FOR UPDATE', [returnId])).rows[0];
        if (!existing) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'NOT_FOUND', message: 'سجل المرتجع غير موجود' });
        }
        const items = Array.isArray(existing.items) ? existing.items : [];
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let deptLocation = mainLocation;
        if (existing.dispatchId) {
            const dispatchRow = (await client.query('SELECT "deptCode" FROM dispatches WHERE id = $1', [existing.dispatchId])).rows[0];
            if (!dispatchRow) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_DEPT_UNKNOWN', message: 'إذن الصرف الأصلي محذوف — تعذر تحديد مخزن القسم للعكس، عالجه يدويًا بقيد تسوية' });
            }
            deptLocation = await getDispatchTargetLocation(client, dispatchRow.deptCode);
        }
        for (const raw of items) {
            const itemId = Number(raw.itemId || raw.item_id);
            const qty = n(raw.qty);
            if (!Number.isInteger(itemId) || !(qty > 0)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_NOT_REVERSIBLE', message: `سجل قديم بلا بيانات ربط كافية للصنف ${raw.itemName || raw.name || '؟'} — عالجه يدويًا بقيد تسوية` });
            }
            const hasLinkage = raw.txId != null;
            // حركة داخلية: تاريخ الدُفعة المسجل يُحمل ولا يُخترع (سياسة الصلاحية)
            const voidExpiry = await latestExpiryFor(client, itemId);
            // عكس أثر المرتجع: سحب ما أُضيف للمخزن الرئيسي، وإعادة ما خُصم من مخزن القسم
            await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId: itemId, locationId: mainLocation.id,
                quantityDelta: -qty, unit: raw.unit || 'وحدة', unitCost: n(raw.avgCost),
                referenceType: 'kitchen_return_void', referenceId: String(returnId), userId: req.user.id,
                idempotencyKey: `return-void:${returnId}:${itemId}:main`,
                expiryDate: voidExpiry,
                reason: `إلغاء مرتجع #${returnId} — عكس الإضافة للمخزن الرئيسي`,
                metadata: { return_id: returnId },
                catchWeightQty: raw.packagingQty != null ? n(raw.packagingQty) : null,
                catchWeightUnit: raw.packagingQty != null ? (raw.packagingUom || 'كرتون') : null,
            });
            if (existing.dispatchId) {
                await postInventoryLedgerEntry(client, {
                    transactionType: 'transfer_in', inventoryId: itemId, locationId: deptLocation.id,
                    quantityDelta: qty, unit: raw.unit || 'وحدة', unitCost: n(raw.avgCost),
                    sourceLocationId: mainLocation.id, destinationLocationId: deptLocation.id,
                    referenceType: 'kitchen_return_void', referenceId: String(returnId), userId: req.user.id,
                    idempotencyKey: `return-void:${returnId}:${itemId}:dept`,
                    expiryDate: voidExpiry,
                    reason: `إلغاء مرتجع #${returnId} — إعادة الكمية لمخزن القسم`,
                    metadata: { return_id: returnId },
                    catchWeightQty: raw.packagingQty != null ? n(raw.packagingQty) : null,
                    catchWeightUnit: raw.packagingQty != null ? (raw.packagingUom || 'كرتون') : null,
                });
            }
            if (hasLinkage) {
                await client.query('DELETE FROM "inventoryTx" WHERE id = $1', [raw.txId]);
                await client.query('DELETE FROM expenses WHERE id = $1 AND "adjustmentType" IN (\'dispatch_return\', \'direct_return\')', [raw.expenseId]);
            } else {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_NOT_REVERSIBLE', message: `المرتجع #${returnId} قديم بلا ربط حركات — احذفه يدويًا بقيد تسوية موثق` });
            }
        }
        await client.query('DELETE FROM "kitchenReturns" WHERE id = $1', [returnId]);
        await client.query('COMMIT');
        emit(req, 'kitchenReturns', 'delete', { id: returnId });
        res.json({ ok: true, message: 'تم حذف سجل المرتجع وعكس أثره المخزني بالكامل' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_return_delete]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: 'رصيد المخزن الرئيسي لا يكفي لعكس المرتجع — راجع الحركات اللاحقة' });
        }
        res.status(500).json({ error: 'KITCHEN_RETURN_DELETE_FAILED', message: 'تعذر حذف سجل المرتجع' });
    } finally {
        client.release();
    }
});

router.post('/inventory/:id/receipt', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const inventoryId = Number(req.params.id);
        const qty = n(req.body?.qty);
        const price = n(req.body?.price);
        if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !(qty > 0) || price < 0) {
            return fail(res, 422, 'INVALID_RECEIPT', 'أدخل صنفًا وكمية وسعرًا صحيحين');
        }
        // تاريخ الصلاحية اختياري (سياسة 2026-10-20) — يُرفض فقط إن جاء فاسدًا
        const rawReceiptExpiry = readExpiryField(req.body || {});
        const receiptExpiry = normalizeExpiryDate(rawReceiptExpiry);
        if (rawReceiptExpiry && !receiptExpiry) {
            return fail(res, 422, 'INVALID_EXPIRY_DATE',
                'تاريخ الصلاحية غير صحيح — الصيغة المطلوبة YYYY-MM-DD');
        }
        await client.query('BEGIN');
        const item = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [inventoryId])).rows[0];
        if (!item) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'INVENTORY_ITEM_NOT_FOUND', 'الصنف غير موجود');
        }
        const requestedUnit = cleanName(req.body?.unit) || item.unit || 'وحدة';
        if (requestedUnit.trim().toLowerCase() !== String(item.unit || 'وحدة').trim().toLowerCase()) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'UNIT_MISMATCH', `وحدة الصنف المسجلة هي «${item.unit || 'وحدة'}» — لا يمكن إضافة كمية بوحدة «${requestedUnit}»`);
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const oldQty = n(item.qty);
        const oldCost = n(item.avgCost);
        const nextQty = oldQty + qty;
        const nextCost = nextQty > 0 ? round(((oldQty * oldCost) + (qty * price)) / nextQty, 2) : round(price, 2);
        await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1', [inventoryId, nextCost]);
        const referenceId = `MANUAL-${id()}`;
        await ensureLocationBalance(client, inventoryId, mainLocation.id, oldQty);
        await postInventoryLedgerEntry(client, {
            transactionType: 'purchase_receipt', inventoryId, locationId: mainLocation.id,
            quantityDelta: round(qty), unit: item.unit || requestedUnit, unitCost: price,
            referenceType: 'manual_receipt', referenceId, userId: req.user.id,
            idempotencyKey: `manual-receipt:${referenceId}`,
            expiryDate: receiptExpiry,
            reason: 'إضافة مخزون يدوية عبر المسح', metadata: { manual_receipt: true },
        });
        const tx = (await client.query(
            `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
             VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8) RETURNING *`,
            [id(), inventoryId, item.name, round(qty), dateOnly(new Date()), price, round(qty * price, 2), 'إضافة مخزون يدوية عبر المسح']
        )).rows[0];
        const fresh = (await client.query('SELECT * FROM inventory WHERE id=$1', [inventoryId])).rows[0];
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', fresh);
        emit(req, 'inventoryTx', 'create', tx);
        return res.status(201).json({ inventory: fresh, transaction: tx });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_manual_receipt]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {return fail(res, 409, 'INSUFFICIENT_STOCK', 'رصيد المخزن لا يسمح بإتمام الحركة');}
        return res.status(500).json({ error: 'MANUAL_RECEIPT_FAILED', message: 'تعذر تسجيل حركة الإضافة المخزنية' });
    } finally { client.release(); }
});

router.post('/inventory/bulk-receipt', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        // استيراد دفعي = بضاعة تدخل المخزن: الصلاحية اختيارية (2026-10-20)، والفساد وحده يُرفض.
        const bulkExpiry = checkExpiryOnLines(rawItems.filter(raw => raw && cleanName(raw.name || raw.itemName)
            && n(raw.qty) > 0 && n(raw.price) >= 0), (raw) => cleanName(raw.name || raw.itemName));
        if (!bulkExpiry.ok) {return fail(res, 422, bulkExpiry.code, bulkExpiry.message, { missing: bulkExpiry.missing, invalid: bulkExpiry.invalid });}
        const items = rawItems.map(raw => ({
            name: cleanName(raw.name || raw.itemName), category: cleanName(raw.category) || 'عام',
            unit: cleanName(raw.unit) || 'قطعة', qty: n(raw.qty), price: n(raw.price), minQty: Math.max(0, n(raw.minQty, 5)),
            expiryDate: normalizeExpiryDate(readExpiryField(raw)),
        })).filter(item => item.name && item.qty > 0 && item.price >= 0);
        if (!items.length) {return fail(res, 422, 'EMPTY_BULK_RECEIPT', 'لا توجد أصناف صالحة للاستيراد');}
        await client.query('BEGIN');
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const inventory = [], transactions = [];
        const batchId = `BULK-${id()}`;
        // إصلاح جذري 2026-10-04 (من اختبار استيراد 329 صنفًا): id() العام = مللي ثانية +
        // عشوائي صغير — الإدخالات المتتالية السريعة تصطدم بمفتاح أساسي → تراجع كامل → 500.
        // مولّد محلي رتيب للدفعة يضمن التفرد داخل الحلقة بلا أي تغيير على باقي النظام.
        let _bulkSeq = 0;
        const bulkId = () => Date.now() * 1000 + (_bulkSeq++);
        // PERF + حديد: جلب واحد لكل الأسماء والمطابقة بالمفتاح المطبع — الأسماء المتشابهة
        // شكلًا (مسافات زايدة/همزات) تطابق الصنف الموجود بدل إنشاء مكرر، والأقفال لكل صف
        // مطابق عند لمسه (نفس دلالات FOR UPDATE الأصلية)
        const allRows = await client.query('SELECT id, name FROM inventory');
        const existingByKey = new Map(allRows.rows.map(r => [normItemName(r.name), Number(r.id)]));
        for (const item of items) {
            const matchKey = normItemName(item.name);
            const matchedId = existingByKey.get(matchKey);
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && String(inv.unit || 'قطعة').trim().toLowerCase() !== item.unit.trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'قطعة'}» وليس «${item.unit}»`);
            }
            const oldQty = inv ? n(inv.qty) : 0;
            const oldCost = inv ? n(inv.avgCost) : 0;
            const nextQty = oldQty + item.qty;
            const nextCost = nextQty > 0 ? round(((oldQty * oldCost) + (item.qty * item.price)) / nextQty, 2) : round(item.price, 2);
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id,name,category,unit,qty,"avgCost","minQty",weight)
                     VALUES ($1,$2,$3,$4,0,$5,$6,0) RETURNING *`,
                    [bulkId(), item.name, item.category, item.unit, nextCost, item.minQty]
                )).rows[0];
                existingByKey.set(matchKey, Number(inv.id));
            } else {
                inv = (await client.query(
                    `UPDATE inventory SET "avgCost"=$2, category=COALESCE(NULLIF($3,''),category), "minQty"=$4 WHERE id=$1 RETURNING *`,
                    [inv.id, nextCost, item.category, item.minQty]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, oldQty);
            await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: round(item.qty), unit: inv.unit || item.unit, unitCost: item.price,
                referenceType: 'bulk_receipt', referenceId: batchId, userId: req.user.id,
                expiryDate: item.expiryDate || null,
                idempotencyKey: `bulk-receipt:${batchId}:${inv.id}`, reason: 'استيراد مخزون دفعي من Excel',
                metadata: { bulk_receipt: true, batch_id: batchId },
            });
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8) RETURNING *`,
                [bulkId(), inv.id, inv.name, round(item.qty), dateOnly(new Date()), item.price, round(item.qty * item.price, 2), 'استيراد مخزون دفعي من Excel']
            )).rows[0];
            inventory.push(inv); transactions.push(tx);
        }
        const freshInventory = (await client.query('SELECT * FROM inventory WHERE id=ANY($1::bigint[]) ORDER BY id', [inventory.map(row => row.id)])).rows;
        await client.query('COMMIT');
        for (const row of freshInventory) {emit(req, 'inventory', 'update', row);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        return res.status(201).json({ inventory: freshInventory, transactions, batchId });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_bulk_receipt]', error);
        return res.status(500).json({ error: 'BULK_RECEIPT_FAILED', message: 'تعذر تسجيل استيراد المخزون' });
    } finally { client.release(); }
});

// ─── Smart inventory search: GET /warehouse/inventory/search ────────────────
// ─── ذكاء البحث العربي (طلب المالك 2026-10-06: «بكتب بازنجان مش جايبها اكتب باذنجان يجيبها») ───
// كل حرف من استعلام المستخدم يتوسع لعائلة الحروف المتشابهة بالنقاط — فتجد الصنف رغم الخطأ المطبعي
// (المنطق في ar-search.js — مشترك بين كل مسارات البحث بالخادم)
const { arFuzzyPattern } = require('../ar-search');

// q → name (partial, trgm) OR barcode OR category · category exact · stock
// filter (all|low|out|ok) server-side · always paginated · parameterized.
router.get('/inventory/search', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'accountant'), async (req, res) => {
    try {
        const q = String(req.query.q ?? '').trim().slice(0, 100);
        const category = String(req.query.category ?? 'all').trim().slice(0, 100);
        const stock = String(req.query.stock ?? 'all').trim().toLowerCase();
        if (!['all', 'low', 'out', 'ok'].includes(stock)) {
            return fail(res, 422, 'INVALID_STOCK_FILTER', 'فلتر المخزون غير معروف');
        }
        let page = Number.parseInt(req.query.page, 10);
        if (!Number.isInteger(page) || page < 1) {page = 1;}
        let limit = Number.parseInt(req.query.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {limit = 50;}
        limit = Math.min(limit, 200);
        const offset = (page - 1) * limit;

        const buildClauses = (term) => {
            const cl = []; const ps = [];
            if (term) {
                ps.push(term);
                const i = ps.length;
                cl.push(`(i.name ILIKE '%' || $${i} || '%' OR COALESCE(i.barcode,'') ILIKE '%' || $${i} || '%' OR COALESCE(i.category,'') ILIKE '%' || $${i} || '%')`);
            }
            if (category && category !== 'all') {
                ps.push(category);
                cl.push(`i.category = $${ps.length}`);
            }
            if (stock === 'out') {cl.push(`COALESCE(i.qty,0) <= 0`);}
            else if (stock === 'low') {cl.push(`COALESCE(i.qty,0) > 0 AND COALESCE(i.qty,0) <= COALESCE(i."minQty",0)`);}
            else if (stock === 'ok') {cl.push(`COALESCE(i.qty,0) > COALESCE(i."minQty",0)`);}
            return { cl, ps };
        };

        let { cl: clauses, ps: params } = buildClauses(q || '');
        let where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        let total = Number((await pool.query(
            `SELECT COUNT(*)::int AS c FROM inventory i ${where}`, params)).rows[0].c);

        // طبقة التسامح: لا نتائج بالبحث الحرفي → البحث بعائلات الحروف (بازنجان تجد باذنجان)
        let fuzzyUsed = false;
        if (q && total === 0) {
            const pattern = arFuzzyPattern(q);
            if (pattern) {
                const f = buildClauses('');
                f.ps.push(pattern);
                f.cl.unshift(`i.name ~* $1`);
                const fWhere = f.cl.length ? `WHERE ${f.cl.join(' AND ')}` : '';
                total = Number((await pool.query(
                    `SELECT COUNT(*)::int AS c FROM inventory i ${fWhere}`, f.ps)).rows[0].c);
                if (total > 0) {
                    fuzzyUsed = true;
                    clauses = f.cl; params = f.ps; where = fWhere;
                }
            }
        }

        // 2026-10-05 (طلب المالك): «إذن صرف 4 يعني الباقي 4» — العمود الأساسي يعرض
        // رصيد المخزن الرئيسي، وما ذهب لمخازن الأقسام في عمود مستقل، والإجمالي كما هو
        const rows = (await pool.query(
            `SELECT i.id, i.name, i.category, i.unit, i.qty, i."avgCost", i."minQty",
                    i.weight, i.barcode, i."shelfId",
                    COALESCE(mb.on_hand, 0) AS "mainQty"
             FROM inventory i
             LEFT JOIN inventory_location_balances mb
                    ON mb.inventory_id = i.id
                   AND mb.location_id = (SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1)
             ${where}
             ORDER BY i.category NULLS LAST, i.name ASC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset])).rows;
        const categories = (await pool.query(
            `SELECT DISTINCT category FROM inventory WHERE category IS NOT NULL AND category <> '' ORDER BY category`)).rows
            .map(r => r.category);
        const pages = total === 0 ? 0 : Math.ceil(total / limit);
        res.json({ data: rows, pagination: { page, limit, total, pages }, categories, fuzzy: fuzzyUsed });
    } catch (error) {
        logger.error('[warehouse_inventory_search]', error);
        fail(res, 500, 'INVENTORY_SEARCH_FAILED', 'تعذر البحث في الأصناف');
    }
});



module.exports = {};
