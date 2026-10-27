// ─── مسارات الدمج والإلغاء والتقارير ولوحة النظام
// مُستخرج حرفًا من backend/warehouse-routes.js (السطور 2603-3137).
// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js
// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.
const { __scope } = require('../warehouse-routes');
const { router, pool, jwtAuth, requireRole, logger, postInventoryLedgerEntry, emitDomainEvent, id, n, round, dateOnly, cleanName, emit, fail, getWarehouseLocation, ensureLocationBalance } = __scope;

// ─── طلب المالك 2026-10-05: «في اصناف مثل كده عايز احذف المكرر» — دمج أصناف مكررة في صنف واحد ───
// ينقل رصيد المكرر (كل المواقع) للمُبقي، يعيد توجيه كل المراجع (دفتر المخزون/سجل الحركات/أي جدول مرجعي)،
// يوازن متوسط التكلفة، يورّث الحد الأدنى/الباركود/الفئة/الرف، ثم يحذف الصنف المكرر — معاملة واحدة موثقة.
router.post('/inventory/merge', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const keepId = Number(req.body?.keepId);
        const dupIds = [...new Set((Array.isArray(req.body?.dupIds) ? req.body.dupIds : []).map(Number).filter(Number.isInteger))];
        if (!Number.isInteger(keepId) || keepId <= 0) {return fail(res, 422, 'INVALID_KEEP_ID', 'الصنف المُبقي غير محدد');}
        if (!dupIds.length) {return fail(res, 422, 'NO_DUPLICATES', 'لا توجد أصناف مكررة محددة للدمج');}
        if (dupIds.includes(keepId)) {return fail(res, 422, 'SAME_ITEM', 'لا يمكن دمج الصنف مع نفسه');}
        await client.query('BEGIN');
        const keeper = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [keepId])).rows[0];
        if (!keeper) {await client.query('ROLLBACK'); return fail(res, 404, 'KEEPER_NOT_FOUND', 'الصنف المُبقي غير موجود');}
        const dups = [];
        for (const dupId of dupIds) {
            const d = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [dupId])).rows[0];
            if (!d) {await client.query('ROLLBACK'); return fail(res, 404, 'DUPLICATE_NOT_FOUND', `الصنف المكرر غير موجود: ${dupId}`);}
            dups.push(d);
        }
        // 1) نقل الأرصدة من كل مخزن المكرر إلى المُبقي (نفس المواقع)
        let movedQty = 0;
        let keeperLoc; // موقع الصنف المُبقي — لالتقاط أي رصيد «شبح» في عمود qty بلا صفوف مواقع
        for (const dup of dups) {
            const dupBalances = (await client.query('SELECT location_id, COALESCE(on_hand,0) AS on_hand FROM inventory_location_balances WHERE inventory_id=$1', [dup.id])).rows;
            let dupBalSum = 0;
            for (const b of dupBalances) {
                dupBalSum += Number(b.on_hand) || 0;
                if (!(Number(b.on_hand) !== 0)) {continue;}
                await ensureLocationBalance(client, keepId, b.location_id, 0);
                await client.query(
                    'UPDATE inventory_location_balances SET on_hand = COALESCE(on_hand,0) + $2, updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$3',
                    [keepId, Number(b.on_hand), b.location_id]);
                movedQty += Number(b.on_hand);
            }
            await client.query('DELETE FROM inventory_location_balances WHERE inventory_id=$1', [dup.id]);
            // رصيد موجود في عمود qty دون صف مواقع: يُنقل لموقع المُبقي حتى لا يضيع عند مزامنة qty من الأرصدة
            const phantom = round(n(dup.qty) - dupBalSum, 3);
            if (phantom > 0) {
                if (keeperLoc == null) {
                    keeperLoc = (await client.query('SELECT location_id FROM inventory_location_balances WHERE inventory_id=$1 ORDER BY on_hand DESC LIMIT 1', [keepId])).rows[0]?.location_id
                        ?? (await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse')).id;
                }
                await ensureLocationBalance(client, keepId, keeperLoc, 0);
                await client.query(
                    'UPDATE inventory_location_balances SET on_hand = COALESCE(on_hand,0) + $2, updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$3',
                    [keepId, phantom, keeperLoc]);
                movedQty += phantom;
            }
        }
        // 2) إعادة توجيه كل الجداول المرجعية للصنف المكرر → الصنف المُبقي
        const refCols = (await client.query(`
            SELECT c.table_name, c.column_name, c.data_type
            FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.column_name IN ('itemId','inventory_id','item_id')
              AND c.table_name <> 'inventory_location_balances'
              AND c.table_name <> 'inventory'`)).rows;
        const sweptTables = [];
        for (const dup of dups) {
            for (const c of refCols) {
                const tbl = `"${c.table_name}"`, col = `"${c.column_name}"`;
                await client.query('SAVEPOINT merge_sweep');
                try {
                    const r = await client.query(`UPDATE ${tbl} SET ${col}=$1 WHERE ${col}=$2`, [String(keepId), String(dup.id)]);
                    if (r.rowCount > 0) {sweptTables.push(`${c.table_name}.${c.column_name}(${r.rowCount})`);}
                    await client.query('RELEASE SAVEPOINT merge_sweep');
                } catch (e) {
                    await client.query('ROLLBACK TO SAVEPOINT merge_sweep');
                    logger.warn(`[inventory_merge] تخطي ${c.table_name}.${c.column_name}: ${e.message}`);
                }
            }
        }
        // 3) وراثة الإعدادات + موازنة متوسط التكلفة الموزون + إعادة حساب الإجمالي
        // المقام هو الرصيد الفعلي بعد الدمج (finalQty) — كمية المكرر داخل فيه أصلًا، وجمعها مجددًا يحسبها مرتين
        const kQty = n(keeper.qty);
        let totalCost = kQty * n(keeper.avgCost);
        for (const dup of dups) {
            const dQty = n(dup.qty);
            if (dQty > 0) { totalCost += dQty * n(dup.avgCost); }
        }
        const finalQty = n((await client.query(
            'SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [keepId])).rows[0].q);
        const newCost = finalQty > 0
            ? Math.max(0, round(totalCost / finalQty, 2))
            : n(keeper.avgCost);
        const primary = dups[0];
        const updated = (await client.query(
            `UPDATE inventory SET
                "minQty" = CASE WHEN COALESCE("minQty",0) > 0 THEN "minQty" ELSE COALESCE($2,0) END,
                barcode = COALESCE(NULLIF(barcode,''), NULLIF($3,'')),
                category = CASE WHEN COALESCE(category,'') IN ('','عام') THEN COALESCE(NULLIF($4,''), category) ELSE category END,
                "shelfId" = COALESCE("shelfId", $5),
                "avgCost" = $6,
                qty = $7
             WHERE id=$1 RETURNING *`,
            [keepId, n(primary.minQty) || 0, keeper.barcode || primary.barcode || '',
             (keeper.category && keeper.category !== 'عام') ? keeper.category : (primary.category || 'عام'),
             keeper.shelfId || primary.shelfId || null, newCost, finalQty])).rows[0];
        // 4) توثيق الحركة في سجل الحركات لكل مكرر مدموج
        for (const dup of dups) {
            const dQty = n(dup.qty);
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
                 VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7,$8)`,
                [id(), keepId, keeper.name, round(dQty, 3), dateOnly(new Date()), n(dup.avgCost),
                 round(dQty * n(dup.avgCost), 2), `دمج صنف مكرر «${dup.name}» (#${dup.id}) — نقل الرصيد والسجل إلى «${keeper.name}»`]);
        }
        // 5) حذف المكرر (كل مراجعه أعيد توجيهها)
        await client.query('DELETE FROM inventory WHERE id = ANY($1::bigint[])', [dupIds]);
        await emitDomainEvent(pool, client, 'INVENTORY', {
            eventType: 'INVENTORY_MERGED', aggregateType: 'inventory', aggregateId: keepId,
            payload: { keeper_id: keepId, merged_ids: dupIds, moved_qty: round(movedQty, 3) },
        });
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', updated);
        for (const dup of dups) { emit(req, 'inventory', 'delete', { id: dup.id, mergedInto: keepId }); }
        logger.warn(`[inventory_merge] ${req.user?.username} دمج ${dups.length} صنفًا مكررًا في «${keeper.name}» (${keepId}) — رصيد منقول ${round(movedQty, 3)}، جداول أعيد توجيهها: ${sweptTables.length}`);
        res.json({ ok: true, keeper: updated, movedQty: round(movedQty, 3), sweptTables, mergedCount: dups.length });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_merge]', error);
        return fail(res, 500, 'INVENTORY_MERGE_FAILED', 'تعذر دمج الأصناف: ' + String(error.message).slice(0, 160));
    } finally { client.release(); }
});

// الدفعة التي يولّدها النظام تلقائيًا لحظة تسجيل/تعديل الفاتورة (نفس المعاملة، نفس
// السطر) ليست «مالًا متحركًا» مستقلًا — هي حالة سداد الفاتورة نفسها. لذا تُعكس معها
// عند الإلغاء. أما الدفعة اليدية (من شاشة الدفعات) فتُرفض: لها قصة أخرى ومالك النظام
// هو من يُلغيها. (طلب المالك 2026-10-13 بعد فاتورة INV-1791896153117)
const AUTO_PAYMENT_NOTE_RE = /^دفعة تلقائية مع (تسجيل|تعديل) فاتورة الشراء/;
function classifyInvoicePaymentsForVoid(payRows) {
    const list = Array.isArray(payRows) ? payRows : [];
    const auto = list.filter(p => AUTO_PAYMENT_NOTE_RE.test(String(p.notes || '').trim()));
    const manual = list.filter(p => !AUTO_PAYMENT_NOTE_RE.test(String(p.notes || '').trim()));
    return {
        auto, manual,
        total: round(list.reduce((s, p) => s + Number(p.amount || 0), 0), 2),
        autoTotal: round(auto.reduce((s, p) => s + Number(p.amount || 0), 0), 2),
        autoOnly: list.length > 0 && manual.length === 0,
    };
}

router.post('/purchase-invoices/:id/void', jwtAuth, requireRole('admin'), async (req, res) => {    const client = await pool.connect();
    try {
        const invoiceId = Number(req.params.id);
        if (!Number.isFinite(invoiceId)) {return fail(res, 422, 'INVALID_ID', 'معرف الفاتورة غير صحيح');}
        await client.query('BEGIN');
        const inv = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id = $1 FOR UPDATE', [invoiceId])).rows[0];
        if (!inv) { await client.query('ROLLBACK'); return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة'); }
        const force = req.body?.force === true;
        if (force) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'FORCE_VOID_FORBIDDEN', 'لا يجوز حذف دفعات أو مستند مالي قسريًا — استخدم قيد عكسي موثق');
        }
        const payRows = (await client.query('SELECT id, amount, notes FROM supplier_payments WHERE "invoiceId" = $1 FOR UPDATE', [invoiceId])).rows;
        const payClass = classifyInvoicePaymentsForVoid(payRows);
        const isOpeningBalance = /^OPEN-/i.test(String(inv.invoiceNumber || ''))
            || /^رصيد افتتاحي(?:\s|$)/.test(String(inv.supplierName || ''))
            || /^رصيد افتتاحي(?:\s|$)/.test(String(inv.notes || ''));
        const paidOpeningWithoutPayment = isOpeningBalance
            && Number(inv.paidAmount || 0) > 0
            && payRows.length === 0;
        if (Number(inv.paidAmount || 0) > 0 && !(paidOpeningWithoutPayment || payClass.autoOnly)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_PAID', 'الفاتورة مسدد منها بدفعة يدوية — اعكس الدفعة من شاشة الدفعات أولًا', { paidAmount: Number(inv.paidAmount) });
        }
        if (payClass.manual.length > 0) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_HAS_PAYMENTS', 'الفاتورة مرتبطة بدفعات موردين يدوية — لا يمكن إلغاؤها قبل عكس الدفعة محاسبيًا', { payments: payClass.manual.length, total: round(payClass.manual.reduce((s, p) => s + Number(p.amount || 0), 0), 2) });
        }
        // دفعات آلية حصرًا: تُعكس مع الفاتورة داخل نفس المعاملة (سطر الدفعة + قيدها في الدفتر).
        let deletedPayments = 0;
        if (payClass.autoOnly) {
            const payIds = payClass.auto.map(p => String(p.id));
            await client.query('DELETE FROM supplier_payments WHERE id = ANY($1::bigint[])', [payClass.auto.map(p => Number(p.id))]);
            await client.query(
                `DELETE FROM journal_lines WHERE entry_id IN (
                    SELECT id FROM journal_entries WHERE source_type='supplier_payment' AND source_id = ANY($1::text[]))`,
                [payIds]);
            await client.query(
                `DELETE FROM journal_entries WHERE source_type='supplier_payment' AND source_id = ANY($1::text[])`,
                [payIds]);
            deletedPayments = payClass.auto.length;
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let items = inv.items;
        if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
        if (!Array.isArray(items)) {items = [];}
        let reversed = 0;
        for (const it of items) {
            const invId = Number(it.itemId || it.item_id);
            const qty = Number(it.qty) || 0;
            // كان الكود يتجاوز البنود التالفة silently ثم يحذف الفاتورة — تضخم مخزني صامت.
            // الآن: أي بند غير قابل للعكس يُجهض العملية كلها بدل حذف جزئي.
            if (!Number.isInteger(invId) || !(qty > 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'VOID_ITEM_INVALID', `بند غير صالح في الفاتورة (${it.itemName || it.name || invId}) — تعذر العكس الكامل، راجع البيانات`);
            }
            const row = (await client.query('SELECT id, name, unit, qty, COALESCE("avgCost",0) AS avg_cost, COALESCE(weight,0) AS weight FROM inventory WHERE id = $1 FOR UPDATE', [invId])).rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'VOID_ITEM_DELETED', `الصنف محذوف من المخزن: ${it.itemName || it.name || invId} — عالجه يدويًا بقيد تسوية`);
            }
            const voidPrice = Number(it.price) || 0;
            const voidBoxes = it.packagingQty != null ? n(it.packagingQty) : (it.catch_weight_qty != null ? n(it.catch_weight_qty) : null);
            const voidPackUom = it.packagingUom || it.catch_weight_unit || null;
            const posted = await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId: invId, locationId: mainLocation.id,
                quantityDelta: -qty, unit: row.unit || it.unit || 'وحدة', unitCost: voidPrice,
                referenceType: 'purchase_invoice_void', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-void:${invoiceId}:${invId}`,
                reason: `إلغاء فاتورة شراء ${inv.invoiceNumber || invoiceId} — عكس استلام ${row.name}`,
                metadata: { invoice_id: invoiceId, invoice_number: inv.invoiceNumber || null },
                catchWeightQty: voidBoxes, catchWeightUnit: voidBoxes !== null ? voidPackUom : null,
            });
            if (posted.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'VOID_ALREADY_APPLIED', `عكس الصنف ${row.name} مسجل مسبقًا — الفاتورة ملغاة جزئيًا؟ راجع الدفتر`);
            }
            // قيد تعويضي في سجل الحركات (لا مسح للتاريخ): يعكس الـ in الأصلية
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", "supplierName", weight, catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [id(), invId, row.name, qty, dateOnly(new Date()), voidPrice, round(qty * voidPrice, 2),
                    `إلغاء فاتورة شراء ${inv.invoiceNumber || invoiceId} — عكس استلام`, inv.invoiceNumber, inv.supplierName,
                    -(Number(it.weight) || 0), voidBoxes, voidBoxes !== null ? voidPackUom : null]
            );
            // إعادة حساب المتوسط المرجح بإخراج الكمية الملغاة + إنقاص الوزن المتراكم
            const freshQty = n((await client.query('SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [invId])).rows[0]?.q);
            if (freshQty > 0) {
                const newAvg = Math.max(0, round(((n(row.avg_cost) * (freshQty + qty)) - (voidPrice * qty)) / freshQty, 2));
                await client.query('UPDATE inventory SET "avgCost"=$2, weight=GREATEST(0, COALESCE(weight,0) - $3) WHERE id=$1',
                    [invId, newAvg, Math.max(0, Number(it.weight) || 0)]);
            } else {
                await client.query('UPDATE inventory SET weight=GREATEST(0, COALESCE(weight,0) - $2) WHERE id=$1',
                    [invId, Math.max(0, Number(it.weight) || 0)]);
            }
            reversed++;
        }
        // عكس القيد المحاسبي المرتبط (إن وُجد) — إبطال موثق بدل الحذف الصامت
        await client.query(
            `UPDATE journal_entries SET status='void'
              WHERE source_type='purchase_invoice' AND source_id=$1 AND status='posted'`,
            [String(invoiceId)]);
        await client.query('DELETE FROM "purchaseInvoices" WHERE id = $1', [invoiceId]);
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_VOIDED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: {
                invoice_id: invoiceId, number: inv.invoiceNumber, reversed_items: reversed,
                paid_flag_without_payment: paidOpeningWithoutPayment,
            },
        });
        await client.query('COMMIT');
        emit(req, 'purchaseInvoices', 'delete', { id: invoiceId, invoiceNumber: inv.invoiceNumber, void: true, force: !!force });
        logger.warn(`[purchase_invoice_void] ${req.user?.username} ألغى الفاتورة ${inv.invoiceNumber} (${invoiceId})${paidOpeningWithoutPayment ? ' — حالة السداد كانت بالخطأ دون دفعة مسجلة' : ''}${force ? ' قسريًا' : ''} مع عكس ${reversed} صنفًا وحذف ${deletedPayments} دفعة`);
        res.json({ ok: true, invoiceNumber: inv.invoiceNumber, reversedItems: reversed, deletedPayments, force: !!force });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[purchase_invoice_void]', error);
        res.status(500).json({ error: 'INVOICE_VOID_FAILED', message: 'تعذر إلغاء الفاتورة: ' + String(error.message).slice(0, 160) });
    } finally { client.release(); }
});

// ═══ طلب المالك 2026-10-05: «أعيد الرصيد الافتتاحي مرة أخرى وأحذف القديم — بس اخصم من الرصيد طلبات الصرف» ═══
// تقرير الأرصدة الافتتاحية المسجلة (فواتير OPEN-*): كل فاتورة وبنودها:
// المدخل قديمًا • المنصرف منذذك (مجموع قيود الصرف من دفتر المخزون) • الرصيد الحالي.
// إلغاء الرصيد القديم (PUT void) يعكس استلامه فقط — حركات الصرف تبقى محسوبة —
// ثم يُدخل الرصيد الجديد من شاشة الرصيد الافتتاحي فيعود الرصيد = الجديد − المنصرف.
function parseInvoiceItems(inv) {
    let items = inv?.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    return Array.isArray(items) ? items : [];
}
router.get('/opening-balance/report', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    try {
        const invoices = (await pool.query(
            `SELECT id, "invoiceNumber", date, "totalAmount", notes, items
             FROM "purchaseInvoices"
             WHERE "invoiceNumber" LIKE 'OPEN-%' OR notes LIKE 'رصيد افتتاحي%'
             ORDER BY date DESC, id DESC`)).rows;
        const out = [];
        for (const inv of invoices) {
            const detailed = [];
            for (const it of parseInvoiceItems(inv)) {
                const invId = Number(it.itemId || it.item_id) || null;
                let currentQty = null, issuedSince = 0, itemExists = false;
                if (invId) {
                    const row = (await pool.query('SELECT qty FROM inventory WHERE id=$1', [invId])).rows[0];
                    if (row) { itemExists = true; currentQty = n(row.qty); }
                    issuedSince = round(n((await pool.query(
                        `SELECT COALESCE(SUM(-quantity_delta),0)::float AS q
                         FROM inventory_ledger
                         WHERE inventory_id=$1 AND reference_type='dispatch' AND business_date >= $2`,
                        [invId, String(inv.date || '').slice(0, 10)])).rows[0]?.q), 3);
                }
                detailed.push({ itemId: invId, itemName: it.itemName || it.name || '', qty: n(it.qty),
                    unit: it.unit || '', price: n(it.price), category: it.category || '',
                    packagingQty: it.packagingQty != null ? n(it.packagingQty) : null,
                    currentQty, issuedSince, itemExists });
            }
            out.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date,
                totalAmount: n(inv.totalAmount), notes: inv.notes || '', items: detailed });
        }
        res.json({ invoices: out });
    } catch (error) {
        logger.error('[opening_balance_report]', error);
        return fail(res, 500, 'OPENING_REPORT_FAILED', 'تعذر تقرير الأرصدة الافتتاحية');
    }
});

// الرصيد الفعلي بالمخزن الرئيسي لكل صنف — أساس عرض «المتاح» في طلبات الصرف
// (طلب المالك 2026-10-06: المتاح لإذن الصرف = رصيد الرئيسي، وما في مخازن الأقسام لا يُعاد صرفه)
router.get('/main-availability', jwtAuth, async (req, res) => {
    try {
        const rows = (await pool.query(
            `SELECT b.inventory_id AS id, COALESCE(b.on_hand,0)::float AS on_hand
             FROM inventory_location_balances b
             JOIN inventory_locations l ON l.id = b.location_id
             WHERE l.code='MAIN-WAREHOUSE' AND l.active=true`)).rows;
        res.json({ items: rows.map(r => ({ id: Number(r.id), on_hand: n(r.on_hand) })) });
    } catch (error) {
        logger.error('[main_availability]', error);
        return fail(res, 500, 'MAIN_AVAILABILITY_FAILED', 'تعذر حساب أرصدة المخزن الرئيسي');
    }
});

// ─── فحص النظام الشامل (طلب المالك 2026-10-06: «سهل جدا وزكي جدا وقوي جدا») ───
// تشخيص فوري بضغطة زر: كل صنف — الرصيد = مجموع المخازن = صافي الدفتر —
// وأي خلل يظهر بالاسم ليقرره المالك فورًا بدل البحث اليدوي.
router.get('/system-health', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const anomalies = [];
        const items = (await pool.query('SELECT id, name, qty, unit FROM inventory ORDER BY id')).rows;
        const balRows = (await pool.query('SELECT inventory_id, SUM(on_hand) AS s FROM inventory_location_balances GROUP BY inventory_id')).rows;
        const balMap = new Map(balRows.map(b => [Number(b.inventory_id), Number(b.s)]));
        const ledRows = (await pool.query('SELECT inventory_id, SUM(quantity_delta) AS net, COUNT(*)::int AS c FROM inventory_ledger GROUP BY inventory_id')).rows;
        const ledMap = new Map(ledRows.map(l => [Number(l.inventory_id), l]));
        let consistent = 0;
        for (const it of items) {
            const id = Number(it.id);
            const qty = n(it.qty);
            const bal = balMap.get(id) ?? 0;
            if (Math.abs(qty - bal) > 0.001) {
                anomalies.push({ name: it.name, issue: `الرصيد ${round(qty, 3)} ≠ مجموع المخازن ${round(bal, 3)}` });
                continue;
            }
            const led = ledMap.get(id);
            if (led && Number(led.c) > 0 && Math.abs(Number(led.net) - qty) > 0.001) {
                anomalies.push({ name: it.name, issue: `صافي الدفتر ${round(led.net, 3)} ≠ الرصيد ${round(qty, 3)}` });
                continue;
            }
            consistent++;
        }
        const zeroStock = items.filter(i => n(i.qty) <= 0).length;
        const lowStock = Number((await pool.query(
            'SELECT COUNT(*)::int AS c FROM inventory WHERE qty > 0 AND qty <= COALESCE("minQty",0)')).rows[0].c);
        res.json({
            ok: anomalies.length === 0,
            itemsTotal: items.length,
            consistent,
            anomaliesCount: anomalies.length,
            anomalies: anomalies.slice(0, 30),
            zeroStock,
            lowStock,
        });
    } catch (error) {
        logger.error('[system_health]', error);
        return fail(res, 500, 'SYSTEM_HEALTH_FAILED', 'تعذر فحص النظام: ' + String(error.message).slice(0, 120));
    }
});

// إجمالي المنصرف لكل صنف (قيود أذون الصرف من الدفتر) — لوضع «الرصيد الصافي» في شاشة الافتتاحي
router.get('/issued-totals', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    try {
        const rows = (await pool.query(
            `SELECT l.inventory_id AS "itemId", COALESCE(i.name,'(محذوف)') AS "itemName", COALESCE(i.unit,'') AS unit,
                    COALESCE(SUM(-l.quantity_delta),0)::float AS issued
             FROM inventory_ledger l
             LEFT JOIN inventory i ON i.id = l.inventory_id
             WHERE l.reference_type='dispatch'
             GROUP BY l.inventory_id, i.name, i.unit
             HAVING COALESCE(SUM(-l.quantity_delta),0) > 0
             ORDER BY issued DESC`)).rows;
        res.json({ items: rows });
    } catch (error) {
        logger.error('[issued_totals]', error);
        return fail(res, 500, 'ISSUED_TOTALS_FAILED', 'تعذر حساب إجمالي المنصرف');
    }
});

// ═══ حذف كل فواتير الشراء (أدمن فقط) — يعكس أثرها على كميات المخزون ═══
// يشمل عكس قيود الاستلام (purchase_invoice) وقيود الإلغاء (purchase_invoice_void)
// حتى تعود أرصدة المواقع لما قبل الفواتير، ثم يعيد حساب كميات الأصناف من الأرصدة.
router.post('/purchase-invoices/clear-all', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const confirm = cleanName(req.body?.confirm);
        if (confirm !== 'حذف كل الفواتير') {
            return fail(res, 422, 'CONFIRM_REQUIRED', 'عبارة التأكيد غير صحيحة — فعّل مربع التأكيد');
        }
        await client.query('BEGIN');
        const all = await client.query('SELECT id, "invoiceNumber" FROM "purchaseInvoices"');
        const ids = all.rows.map(r => String(r.id));
        const numbers = all.rows.map(r => r.invoiceNumber).filter(Boolean);
        const led = ids.length ? await client.query(
            `DELETE FROM inventory_ledger
              WHERE reference_type IN ('purchase_invoice','purchase_invoice_void')
                AND reference_id = ANY($1::text[])
             RETURNING inventory_id, location_id, quantity_delta`, [ids]) : { rows: [], rowCount: 0 };
        const balDelta = new Map();
        for (const r of led.rows) {
            const k = `${r.inventory_id}|${r.location_id}`;
            balDelta.set(k, (balDelta.get(k) || 0) - Number(r.quantity_delta));
        }
        for (const [k, d] of balDelta.entries()) {
            const [iid, lid] = k.split('|');
            await client.query(
                `UPDATE inventory_location_balances SET on_hand = on_hand + $1, updated_at = CURRENT_TIMESTAMP
                  WHERE inventory_id = $2::bigint AND location_id = $3::bigint`, [d, iid, lid]);
        }
        await client.query(
            `UPDATE inventory SET qty = COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances WHERE inventory_id = inventory.id), 0)`);
        let txDeleted = 0;
        if (numbers.length) {
            const tx = await client.query(`DELETE FROM "inventoryTx" WHERE "invoiceNumber" = ANY($1::text[])`, [numbers]);
            txDeleted = tx.rowCount;
        }
        const del = ids.length ? await client.query(`DELETE FROM "purchaseInvoices" WHERE id = ANY($1::bigint[]) RETURNING id`, [ids]) : { rowCount: 0 };
        // ROOT FIX 2026-10-02: الحذف الشامل كان يترك قيود المشتريات يتيمة في
        // ميزان المراجعة (فواتيرها محذوفة) — تُبطَّل موثقًا بنفس نمط إلغاء
        // الفاتورة المفردة (status='void'، لا حذف صامت).
        let voidedJournals = 0;
        if (ids.length) {
            const vj = await client.query(
                `UPDATE journal_entries SET status='void'
                  WHERE source_type='purchase_invoice' AND source_id = ANY($1::text[]) AND status='posted'`, [ids]);
            voidedJournals = vj.rowCount;
        }
        await client.query('COMMIT');
        try { emit(req, 'purchaseInvoices', 'reset', {}); emit(req, 'inventory', 'reset', {}); emit(req, 'inventoryTx', 'reset', {}); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
        logger.warn(`[PURCHASE_INVOICES] admin ${req.user?.id} حذف كل الفواتير (${del.rowCount}) وعكس ${led.rowCount} قيد مخزون وأبطأ ${voidedJournals} قيد محاسبي`);
        res.json({ ok: true, deletedInvoices: del.rowCount, reversedLedgerRows: led.rowCount, deletedTransactions: txDeleted, voidedJournals });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[purchase_invoices_clear_all]', e);
        res.status(500).json({ error: 'CLEAR_INVOICES_FAILED', message: 'تعذر حذف الفواتير — راجع سجل الخادم' });
    } finally { client.release(); }
});

// ═══ طلبات شراء النواقص: بيتها المخزن — أمين المخزن ينشئ (تلقائي من الحد الأدنى + يدوي) → الشيف يوقّع → المدير العام يعتمد نهائيًا → المخزن يستلم ═══
// طلب فقط (لا يولّد فاتورة ولا يحرك مخزونًا) — التوثيق بتوقيع صاحب الحساب عبر requireSignature.
// (2026-10-01 بطلب المالك: الإنشاء من المخزن حصرًا — kitchen/dept_head كانا ينشئان سابقًا)
const PR_CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
// الإلغاء أوسع عمدًا: أصحاب الطلبات القديمة (مطبخ/رئيس قسم) يلغون ما أنشأوه — الفحص الحقيقي ملكية داخل المسار
const PR_CANCEL_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
const PR_CHEF_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
const PR_GM_ROLES = ['admin', 'manager'];
// استلام المخزن للبضاعة بعد الاعتماد النهائي (توقيع أمين المخزن + دخول مخزني)
const PR_WH_ROLES = ['admin', 'manager', 'warehouse'];
const PR_READ_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'accountant'];
// UPGRADE 2026-10-04 (طلب المالك): المطبخ ينشئ طلب شراء موقّع من الشيف يروح للمخزن مباشرة
const PR_CHEF_CREATE_ROLES = ['kitchen', 'sous_chef'];

/**
 * نقية: تطبيع أصناف طلب الشراء ودمج المكرر بالاسم (التلقائي + اليدوي معًا).
 * يقبل itemName/name و requestedQty/qty — الكمية المطلوبة موجبة فقط.
 */
function normalizePRItems(items) {
    const grouped = new Map();
    for (const raw of Array.isArray(items) ? items : []) {
        const itemName = cleanName(raw.itemName || raw.name);
        const requestedQty = round(n(raw.requestedQty ?? raw.qty, NaN));
        if (!itemName || !Number.isFinite(requestedQty) || requestedQty <= 0) {continue;}
        const key = itemName.toLowerCase();
        const cur = grouped.get(key) || {
            itemName,
            itemId: Number(raw.itemId || raw.item_id) || null,
            unit: cleanName(raw.unit) || 'وحدة',
            currentQty: null,
            minQty: null,
            requestedQty: 0,
            notes: null,
        };
        cur.requestedQty = round(cur.requestedQty + requestedQty);
        if (!cur.itemId && (raw.itemId || raw.item_id)) {cur.itemId = Number(raw.itemId || raw.item_id) || null;}
        if ((!cur.unit || cur.unit === 'وحدة') && raw.unit) {cur.unit = cleanName(raw.unit);}
        const note = cleanName(raw.notes);
        if (note) {cur.notes = cur.notes ? `${cur.notes}؛ ${note}` : note;}
        grouped.set(key, cur);
    }
    return [...grouped.values()];
}

/**
 * نقية: الكمية المقترحة للنواقص = العجز عن الحد الأدنى (minQty - qty إن كان موجبًا).
 */
function prShortageSuggestion(currentQty, minQty) {
    const deficit = round(n(minQty) - n(currentQty));
    return deficit > 0 ? deficit : 0;
}

/**
 * نقية: هل يجوز للشيف البت في هذا الطلب؟ (pending فقط)
 */
function canPRChefDecide(pr) {
    if (!pr) {return { ok: false, code: 'PR_NOT_FOUND' };}
    if (pr.status === 'pending') {return { ok: true };}
    if (pr.status === 'chef_approved') {return { ok: false, code: 'PR_CHEF_DECIDED' };}
    if (pr.status === 'approved') {return { ok: false, code: 'PR_ALREADY_APPROVED' };}
    if (pr.status === 'rejected') {return { ok: false, code: 'PR_REJECTED' };}
    if (pr.status === 'cancelled') {return { ok: false, code: 'PR_CANCELLED' };}
    return { ok: false, code: 'PR_INVALID_STATUS' };
}

/**
 * نقية: هل يجوز للمدير العام البت؟ — بعد توقيع الشيف حصرًا، وبتوقيع مستخدم
 * مختلف عن شيف الطلب (يلزم توقيعان مختلفان: شيف ثم مدير عام).
 */
function canPRGMDecide(pr, user) {
    if (!pr) {return { ok: false, code: 'PR_NOT_FOUND' };}
    if (pr.status !== 'chef_approved') {
        if (pr.status === 'pending') {return { ok: false, code: 'PR_CHEF_APPROVAL_REQUIRED' };}
        if (pr.status === 'approved') {return { ok: false, code: 'PR_ALREADY_APPROVED' };}
        if (pr.status === 'rejected') {return { ok: false, code: 'PR_REJECTED' };}
        if (pr.status === 'cancelled') {return { ok: false, code: 'PR_CANCELLED' };}
        return { ok: false, code: 'PR_INVALID_STATUS' };
    }
    if (user && pr.chef_approved_by != null && Number(pr.chef_approved_by) === Number(user.id)) {
        return { ok: false, code: 'PR_SELF_APPROVAL' };
    }
    return { ok: true };
}



module.exports = {
    AUTO_PAYMENT_NOTE_RE,
    classifyInvoicePaymentsForVoid,
    normalizePRItems,
    prShortageSuggestion,
    canPRChefDecide,
    canPRGMDecide,
    PR_CREATE_ROLES,
    PR_CANCEL_ROLES,
    PR_CHEF_ROLES,
    PR_GM_ROLES,
    PR_WH_ROLES,
    PR_READ_ROLES,
    PR_CHEF_CREATE_ROLES,
};
