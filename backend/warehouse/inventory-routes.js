// ─── مسارات فواتير الشراء وحركات المخزون
// مُستخرج حرفًا من backend/warehouse-routes.js (السطور 1839-2602).
// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js
// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.
const { __scope } = require('../warehouse-routes');
const { crypto, router, pool, riyadhToday, jwtAuth, requireRole, logger, postInventoryLedgerEntry, computeInvoicePaymentStatus, computeInvoiceVat, loadStandardRate, emitDomainEvent, normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor, id, normItemName, n, round, allocatePurchaseDiscount, dateOnly, cleanName, json, emit, fail, getWarehouseLocation, ensureLocationBalance } = __scope;

router.post('/purchase-invoices', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const requestedInvoiceNumber = cleanName(req.body?.invoiceNumber);
        const requestedDate = req.body?.date;
        const paymentMethod = cleanName(req.body?.paymentMethod || 'cash').toLowerCase();
        const allowedPaymentMethods = new Set(['cash', 'bank', 'card', 'cheque', 'credit']);
        if (requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate)) || Number.isNaN(new Date(`${requestedDate}T00:00:00Z`).getTime()))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_DATE', 'تاريخ الفاتورة غير صحيح');
        }
        if (!allowedPaymentMethods.has(paymentMethod)) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_PAYMENT_METHOD', 'طريقة الدفع غير معتمدة');
        }
        if (requestedInvoiceNumber) {
            const duplicateNumber = await client.query('SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber"=$1 LIMIT 1', [requestedInvoiceNumber]);
            if (duplicateNumber.rows.length) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'DUPLICATE_INVOICE_NUMBER', 'رقم الفاتورة مستخدم من قبل');
            }
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        // سطر صنف حقيقي — نفس المعيار في التطبيع وفي حرس الصلاحية (لا ازدواج).
        const isInvoiceLine = (raw) => Boolean(raw) && cleanName(raw.itemName || raw.name) !== ''
            && n(raw.qty) > 0 && n(raw.price) >= 0;
        // سياسة 2026-10-20: الصلاحية اختيارية — لا تُرفض الفاتورة لغيابها،
        // ويُرفض فقط السطر الذي جاء بتاريخ فاسد (INVALID_EXPIRY_DATE).
        const expiryGate = checkExpiryOnLines(rawItems.filter(isInvoiceLine));
        if (!expiryGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, 422, expiryGate.code, expiryGate.message, { missing: expiryGate.missing, invalid: expiryGate.invalid });
        }
        const validItems = rawItems.map(raw => {
            const pkg = raw.packagingQty ?? raw.packaging_qty ?? raw.catch_weight_qty ?? null;
            const pkgQty = pkg === null || pkg === undefined || pkg === '' ? null : n(pkg);
            return {
                itemName: cleanName(raw.itemName || raw.name),
                itemId: raw.itemId || raw.item_id || null,
                category: cleanName(raw.category) || 'عام',
                unit: cleanName(raw.unit) || 'وحدة',
                unitProvided: raw.unit !== undefined && raw.unit !== null && cleanName(raw.unit) !== '',
                qty: round(n(raw.qty), 3),
                price: round(n(raw.price), 2),
                taxCategory: String(raw.tax_category ?? raw.taxCategory ?? 'STANDARD').trim().toUpperCase(),
                weight: Math.max(0, n(raw.weight)),
                packagingQty: pkgQty !== null && Number.isFinite(pkgQty) && pkgQty >= 0 ? pkgQty : null,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom || raw.catch_weight_unit) || null,
                expiryDate: normalizeExpiryDate(readExpiryField(raw)),
            };
        }).filter(item => item.itemName && item.qty > 0 && item.price >= 0);
        if (!validItems.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_INVOICE_ITEMS', 'أضف صنفاً واحداً على الأقل بكمية صحيحة');
        }
        if (validItems.some(item => !Number.isFinite(item.qty) || !Number.isFinite(item.price) ||
            item.qty <= 0 || item.price < 0 || !['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].includes(item.taxCategory))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_ITEM', 'تحقق من الكمية والسعر والفئة الضريبية لكل صنف');
        }
        const discountType = String(req.body?.discountType || 'none').toLowerCase();
        const discountValue = Number(req.body?.discountValue || 0);
        let discount;
        try {
            discount = allocatePurchaseDiscount(validItems, discountType, discountValue);
        } catch (error) {
            await client.query('ROLLBACK');
            return fail(res, 422, error.code || 'INVALID_INVOICE_DISCOUNT', error.message);
        }
        const discountAmount = discount.discountAmount;
        validItems.splice(0, validItems.length, ...discount.items);

        const inventoryRows = [];
        const transactions = [];
        const invoiceItems = [];
        const createdNames = [];
        const invoiceId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        // PERF: جلب مجمع واحد لكل الأسماء بأقفالها — نفس إصلاح bulk-receipt:
        // LOWER(name) بلا فهرس كان = مسح كامل للجدول لكل صنف (349 صنفًا = انقطاع مهلة 30 ثانية).
        // PERF + حديد: مطابقة بالمفتاح المطبع — الأسماء المتشابهة شكلًا تطابق الموجود بدل إنشاء مكرر
        const allRows = await client.query('SELECT id, name FROM inventory');
        const existingByKey = new Map(allRows.rows.map(r => [normItemName(r.name), Number(r.id)]));
        for (const item of validItems) {
            const matchKey = normItemName(item.itemName);
            const matchedId = existingByKey.get(matchKey);
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && item.unitProvided && String(item.unit).trim().toLowerCase() !== String(inv.unit || 'وحدة').trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'وحدة'}» وليس «${item.unit}»`);
            }
            if (!inv) {
                // The quantity is added by the ledger posting below — create at 0 to avoid double counting
                inv = (await client.query(
                    `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", weight)
                     VALUES ($1,$2,$3,$4,0,$5,0,$6) RETURNING *`,
                    [id(), item.itemName, item.category, item.unit, item.effectivePrice, round(item.weight)]
                )).rows[0];
                createdNames.push(inv.name);
                existingByKey.set(matchKey, Number(inv.id));
            } else {
                const oldQty = n(inv.qty);
                const nextQty = round(oldQty + item.qty);
                const nextCost = nextQty > 0 ? round(((oldQty * n(inv.avgCost)) + (item.qty * item.effectivePrice)) / nextQty, 2) : round(item.effectivePrice, 2);
                // qty itself is maintained by the inventory ledger (recomputed from location balances)
                inv = (await client.query(
                    `UPDATE inventory SET "avgCost"=$2, weight=COALESCE(weight,0)+$3 WHERE id=$1 RETURNING *`,
                    [inv.id, nextCost, round(item.weight)]
                )).rows[0];
            }
            // Post the receipt through the inventory ledger so the purchase is never
            // silently erased by the next ledger recomputation
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: round(item.qty), unit: inv.unit || item.unit || 'وحدة', unitCost: item.effectivePrice,
                referenceType: 'purchase_invoice', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase:${invoiceId}:${inv.id}`,
                expiryDate: item.expiryDate || null,
                reason: `استلام فاتورة شراء ${req.body?.invoiceNumber || invoiceId}`.trim(),
                metadata: { invoice_id: invoiceId, invoice_number: req.body?.invoiceNumber || null, supplier_name: req.body?.supplierName || null,
                    ...(item.packagingQty !== null ? { packaging_qty: item.packagingQty, packaging_uom: item.packagingUom || inv.packaging_uom || 'كرتون' } : {}) },
                catchWeightQty: item.packagingQty, catchWeightUnit: item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null,
            });
            const lineTotal = item.total;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", "supplierName", weight, catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inv.id, inv.name, round(item.qty), dateOnly(req.body?.date), item.effectivePrice, lineTotal,
                    `استلام فاتورة شراء ${req.body?.invoiceNumber || ''}`.trim(), req.body?.invoiceNumber || null,
                    req.body?.supplierName || null, round(item.weight), item.packagingQty, item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null]
            )).rows[0];
            inventoryRows.push(inv);
            transactions.push(tx);
            invoiceItems.push({ ...item, itemId: Number(inv.id), itemName: inv.name, total: lineTotal });
        }

        // ─── قراءة نهائية للكميات بعد ترحيل الدفتر ───
        // كميات الصفوف أعلاه تُلتقط قبل ترحيل الاستلام (الكمية تُعاد حسابها
        // من أرصدة المواقع داخل الدفتر) — إرسالها كما هي كان يجعل الواجهة
        // والبث المباشر يعرضان رصيدًا قديمًا حتى تحديث يدوي للصفحة.
        const freshInventory = inventoryRows.length
            ? (await client.query(
                'SELECT * FROM inventory WHERE id = ANY($1::bigint[]) ORDER BY id',
                [inventoryRows.map(r => r.id)]
            )).rows
            : [];
        inventoryRows.length = 0;
        inventoryRows.push(...freshInventory);

        // ─── الربط المالي: مورد الدفعة + المسدد + حالة السداد ───
        let supplierId = req.body?.supplierId !== undefined && req.body?.supplierId !== null && req.body?.supplierId !== ''
            ? Number(req.body.supplierId) : null;
        let supplierRow = null;
        const requestedSupplierName = cleanName(req.body?.supplierName);
        // ذكاء الربط: اسم حر يطابق موردًا مسجلًا (تطابق تام بعد التطبيع) → يُربط تلقائيًا
        // حتى لا تُنشأ فاتورة «بدون ربط» لنفس المورد الموجود أصلًا في دليل الموردين.
        if (supplierId === null && requestedSupplierName) {
            const byName = (await client.query(
                `SELECT id, name, is_active FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                [requestedSupplierName])).rows[0];
            if (byName) { supplierId = Number(byName.id); supplierRow = byName; }
        }
        if (supplierId === null && /افتتاحي/.test(requestedSupplierName)) {
            supplierRow = (await client.query(
                `SELECT id, name, is_active FROM suppliers
                 WHERE category = 'افتتاحي' OR name ILIKE '%افتتاحي%'
                 ORDER BY id LIMIT 1`
            )).rows[0] || null;
            if (!supplierRow) {
                supplierRow = (await client.query(
                    `INSERT INTO suppliers (id, name, category, "openingBalance", is_active)
                     VALUES ($1,$2,'افتتاحي',0,true) RETURNING id, name, is_active`,
                    [id(), requestedSupplierName || 'رصيد افتتاحي - بداية الفترة']
                )).rows[0];
            }
            supplierId = Number(supplierRow.id);
        }
        if (supplierId !== null) {
            if (!Number.isInteger(supplierId)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_SUPPLIER', 'معرف المورد غير صحيح');
            }
            supplierRow = (await client.query(
                `SELECT id, name, is_active, tax_registration_status, vat_number, commercial_register
                  FROM suppliers WHERE id=$1`, [supplierId])).rows[0];
            if (!supplierRow) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'SUPPLIER_NOT_FOUND', 'المورد المحدد غير موجود');
            }
            if (!supplierRow.is_active) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'SUPPLIER_INACTIVE', `المورد «${supplierRow.name}» موقوف — فعّله قبل إنشاء الفواتير`);
            }
        }
        // ─── VAT engine: Supplier → Tax Profile → Rule → Line VAT ──────────
        // بدون مورد مربوط: لا ملف ضريبي → ضريبة صفر (لا يُدَّعى input VAT).
        // بمورد NOT_REGISTERED/EXEMPT أو أصناف معفاة: القاعدة تقرر (غالبًا صفر).
        // totalAmount = الإجمالي الشامل (صافي + ضريبة) — الدفعات والحالة عليه.
        const standardRate = await loadStandardRate(pool);
        const supplierProfile = supplierRow
            ? {
                status: supplierRow.tax_registration_status || 'NOT_REGISTERED',
                vat_number: supplierRow.vat_number || null,
                country: 'SA',
            }
            : { status: 'NOT_REGISTERED', vat_number: null, country: 'SA' };
        let vatCalc;
        try {
            vatCalc = computeInvoiceVat(
                invoiceItems.map((it) => ({ net: it.total, taxCategory: it.taxCategory || 'STANDARD' })),
                supplierProfile,
                { transactionDate: dateOnly(requestedDate) || riyadhToday(), standardRate }
            );
        } catch (taxErr) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_TAX_CATEGORY', String(taxErr.message).slice(0, 200));
        }
        const invoiceNet = vatCalc.subtotalNet;
        const invoiceVat = vatCalc.vatTotal;
        const invoiceTotal = vatCalc.grandTotal;
        // ─── منع الإضافة المكررة (نفس المستخدم + مورد + مبلغ خلال 10 دقائق) ───
        // FIX: كانت هذه الكتلة داخل منطق المورد أعلاه وتقرأ invoiceTotal قبل
        // تعريفه → ReferenceError 500 لأي فاتورة بمورد. مكانها الصحيح هنا.
        // HARDENED 2026-10-07: النافذة كانت 10 ثوانٍ فقط فتسرّبت 5 نسخ متطابقة
        // بفارق 20-60 ثانية (ضغطات مكررة على حفظ). الآن 10 دقائق + مطابقة باسم
        // المورد أيضًا عند غياب supplierId (اسم حر غير مربوط).
        if (invoiceTotal > 0 && req.user?.id) {
            const dupName = cleanName(supplierRow ? supplierRow.name : req.body?.supplierName);
            const dupWho = [String(req.user.id), req.user.username ? String(req.user.username) : null].filter(Boolean);
            const dupCheck = await client.query(
                `SELECT id, "invoiceNumber" FROM "purchaseInvoices"
                 WHERE "totalAmount" = $1
                   AND "createdAt"::timestamptz >= NOW() - INTERVAL '10 minutes'
                   AND "createdBy" = ANY($2)
                   AND (($3::bigint IS NOT NULL AND "supplierId" = $3)
                        OR ($3::bigint IS NULL AND $4 <> '' AND LOWER(COALESCE("supplierName",'')) = LOWER($4)))
                 ORDER BY "createdAt" DESC LIMIT 1`,
                [invoiceTotal, dupWho, supplierId, dupName || '']);
            if (dupCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ ok: false, code: 'DUPLICATE_INVOICE', message: 'فاتورة مشابهة تم إنشاؤها قبل أقل من 10 دقائق — تم تجاهل الطلب المكرر', duplicateOf: dupCheck.rows[0] });
            }
        }
        const headerRate = vatCalc.lines.reduce((m, l) => Math.max(m, l.rate), 0);
        let paidAmount;
        if (req.body?.paidAmount !== undefined && req.body?.paidAmount !== null && req.body?.paidAmount !== '') {
            const rawPaidAmount = Number(req.body.paidAmount);
            if (!Number.isFinite(rawPaidAmount) || rawPaidAmount < 0 || rawPaidAmount > invoiceTotal) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_PAID_AMOUNT', 'المبلغ المسدد يجب أن يكون بين صفر وإجمالي الفاتورة');
            }
            paidAmount = round(rawPaidAmount, 2);
        } else {
            paidAmount = paymentMethod === 'credit' ? 0 : invoiceTotal;
        }
        const paymentStatus = computeInvoicePaymentStatus(invoiceTotal, paidAmount);
        const invoiceSupplierName = supplierRow ? supplierRow.name : req.body?.supplierName || null;

        const invoice = (await client.query(
            `INSERT INTO "purchaseInvoices" (id, "invoiceNumber", date, "supplierName", "supplierPhone", items, "totalAmount", "paymentMethod", notes, "createdAt", "createdBy", "supplierId", "paidAmount", "paymentStatus",
                subtotal_net, vat_total, tax_rate_snapshot, tax_rule_code_snapshot,
                supplier_name_snapshot, supplier_vat_number_snapshot, supplier_cr_snapshot,
                supplier_tax_status_snapshot, zatca_uuid, discount_type, discount_value, discount_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
            [invoiceId, requestedInvoiceNumber || `INV-${id()}`, dateOnly(requestedDate), invoiceSupplierName,
                req.body?.supplierPhone || null, json(invoiceItems), invoiceTotal, paymentMethod,
                req.body?.notes || null, new Date().toISOString(), req.user.username || String(req.user.id),
                supplierId, paidAmount, paymentStatus,
                invoiceNet, invoiceVat, headerRate, vatCalc.ruleCode,
                supplierRow ? supplierRow.name : (req.body?.supplierName || null),
                supplierRow ? (supplierRow.vat_number || null) : null,
                supplierRow ? (supplierRow.commercial_register || null) : null,
                supplierRow ? (supplierRow.tax_registration_status || 'NOT_REGISTERED') : 'NOT_REGISTERED',
                crypto.randomUUID(), discountType, discountValue, discountAmount]
        )).rows[0];
        if (supplierId !== null && paidAmount > 0) {
            await client.query(
                `INSERT INTO supplier_payments (id, "supplierId", amount, method, date, "invoiceId", notes, "createdBy")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [id(), supplierId, paidAmount, paymentMethod === 'credit' ? 'cash' : paymentMethod,
                    dateOnly(requestedDate), invoiceId, 'دفعة تلقائية مع تسجيل فاتورة الشراء', req.user.username || String(req.user.id)]
            );
        }
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_CREATED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: { invoice_id: invoiceId, number: invoice.invoiceNumber, total: invoiceTotal, vat: invoiceVat, supplier_id: supplierId },
        });
        await client.query('COMMIT');

        // ترحيل محاسبي best-effort (لا يُسقط الشراء عند غياب شجرة الحسابات).
        // الرصيد الافتتاحي (OPEN-) ليس مشتريات: Dr 1200 مخزون ← Cr 3000 رأس المال
        // — لا مورد دائن ولا ضريبة مدخلات وهمية في ميزان المراجعة.
        try {
            const _acct = require('../accounting-routes');
            const _isOpen = String(invoice.invoiceNumber || '').startsWith('OPEN-');
            await (_isOpen ? _acct.postOpeningToLedger : _acct.postPurchaseToLedger)(invoiceId);
        }
        catch (ledgerErr) {
            logger.error(`[purchase_ledger] FAILED invoice=${invoiceId} number=${invoice.invoiceNumber || '?'} total=${round(invoiceTotal, 2)} :: ${(ledgerErr && (ledgerErr.message || ledgerErr.code)) || String(ledgerErr)}`);
        }

        emit(req, 'purchaseInvoices', 'create', invoice);
        for (const item of inventoryRows) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        res.status(201).json({
            invoice, inventory: inventoryRows, transactions, createdNames,
            totalAmount: invoiceTotal, subtotalNet: invoiceNet, vatTotal: invoiceVat,
            taxRule: vatCalc.ruleCode,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_purchase_invoice]', error);
        res.status(500).json({ error: 'PURCHASE_INVOICE_FAILED', message: 'تعذر حفظ فاتورة الشراء وتحديث المخزن', detail: error?.message || String(error) });
    } finally {
        client.release();
    }
});

router.put('/purchase-invoices/:id', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const invoiceId = Number(req.params.id);
        if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الفاتورة غير صحيح');}
        await client.query('BEGIN');
        const oldInvoice = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
        if (!oldInvoice) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة');
        }
        const payments = (await client.query(
            'SELECT COUNT(*)::int AS count FROM supplier_payments WHERE "invoiceId"=$1', [invoiceId]
        )).rows[0];
        if (Number(oldInvoice.paidAmount || 0) > 0 || Number(payments?.count || 0) > 0) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_HAS_PAYMENTS', 'لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا');
        }

        const requestedDate = req.body?.date || oldInvoice.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || '')) ||
            Number.isNaN(new Date(`${requestedDate}T00:00:00Z`).getTime())) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_DATE', 'تاريخ الفاتورة غير صحيح');
        }
        const paymentMethod = cleanName(req.body?.paymentMethod || oldInvoice.paymentMethod || 'cash').toLowerCase();
        const allowedPaymentMethods = new Set(['cash', 'bank', 'card', 'cheque', 'credit']);
        if (!allowedPaymentMethods.has(paymentMethod)) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_PAYMENT_METHOD', 'طريقة الدفع غير معتمدة');
        }
        const requestedInvoiceNumber = cleanName(req.body?.invoiceNumber || oldInvoice.invoiceNumber);
        if (requestedInvoiceNumber) {
            const duplicate = await client.query(
                'SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber"=$1 AND id<>$2 LIMIT 1',
                [requestedInvoiceNumber, invoiceId]);
            if (duplicate.rows.length) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'DUPLICATE_INVOICE_NUMBER', 'رقم الفاتورة مستخدم من قبل');
            }
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        // التعديل يعيد الاستلام فعليًا — نفس حرس الإنشاء: الغياب مقبول،
        // والصيغة الفاسدة وحدها تُرفض (سياسة 2026-10-20).
        const expiryGateEdit = checkExpiryOnLines(rawItems.filter(raw => raw
            && cleanName(raw.itemName || raw.name) !== '' && n(raw.qty) > 0 && n(raw.price) >= 0));
        if (!expiryGateEdit.ok) {
            await client.query('ROLLBACK');
            return fail(res, 422, expiryGateEdit.code, expiryGateEdit.message, { missing: expiryGateEdit.missing, invalid: expiryGateEdit.invalid });
        }
        const items = rawItems.map(raw => {
            const pkg = raw.packagingQty ?? raw.packaging_qty ?? raw.catch_weight_qty ?? null;
            const pkgQty = pkg === null || pkg === undefined || pkg === '' ? null : n(pkg);
            return {
                itemName: cleanName(raw.itemName || raw.name),
                category: cleanName(raw.category) || 'عام',
                unit: cleanName(raw.unit) || 'وحدة',
                unitProvided: raw.unit !== undefined && raw.unit !== null && cleanName(raw.unit) !== '',
                qty: round(n(raw.qty), 3),
                price: round(n(raw.price), 2),
                taxCategory: String(raw.tax_category ?? raw.taxCategory ?? 'STANDARD').trim().toUpperCase(),
                weight: Math.max(0, n(raw.weight)),
                packagingQty: pkgQty !== null && Number.isFinite(pkgQty) && pkgQty >= 0 ? pkgQty : null,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom || raw.catch_weight_unit) || null,
                expiryDate: normalizeExpiryDate(readExpiryField(raw)),
            };
        }).filter(item => item.itemName && item.qty > 0 && item.price >= 0);
        if (!items.length || items.some(item => !Number.isFinite(item.qty) || !Number.isFinite(item.price) ||
            item.qty <= 0 || item.price < 0 || !['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].includes(item.taxCategory))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_ITEM', 'تحقق من وجود صنف واحد على الأقل وصحة الكمية والسعر والفئة الضريبية');
        }
        const discountType = String(req.body?.discountType || 'none').toLowerCase();
        const discountValue = Number(req.body?.discountValue ?? 0);
        let discount;
        try {
            discount = allocatePurchaseDiscount(items, discountType, discountValue);
        } catch (error) {
            await client.query('ROLLBACK');
            return fail(res, 422, error.code || 'INVALID_INVOICE_DISCOUNT', error.message);
        }
        const discountAmount = discount.discountAmount;
        items.splice(0, items.length, ...discount.items);

        let supplierId = req.body?.supplierId !== undefined && req.body?.supplierId !== null && req.body?.supplierId !== ''
            ? Number(req.body.supplierId) : null;
        let supplierRow = null;
        const supplierName = cleanName(req.body?.supplierName);
        if (supplierId === null && supplierName) {
            const matched = (await client.query(
                'SELECT id FROM suppliers WHERE LOWER(name)=LOWER($1) LIMIT 1', [supplierName])).rows[0];
            if (matched) {supplierId = Number(matched.id);}
        }
        if (supplierId !== null) {
            if (!Number.isSafeInteger(supplierId)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_SUPPLIER', 'معرف المورد غير صحيح');
            }
            supplierRow = (await client.query(
                `SELECT id, name, is_active, tax_registration_status, vat_number, commercial_register
                   FROM suppliers WHERE id=$1`, [supplierId])).rows[0];
            if (!supplierRow) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'SUPPLIER_NOT_FOUND', 'المورد المحدد غير موجود');
            }
            if (!supplierRow.is_active && Number(oldInvoice.supplierId) !== supplierId) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'SUPPLIER_INACTIVE', `المورد «${supplierRow.name}» موقوف — فعّله قبل ربط الفاتورة`);
            }
        }
        const standardRate = await loadStandardRate(pool);
        const supplierProfile = supplierRow
            ? { status: supplierRow.tax_registration_status || 'NOT_REGISTERED', vat_number: supplierRow.vat_number || null, country: 'SA' }
            : { status: 'NOT_REGISTERED', vat_number: null, country: 'SA' };
        let vatCalc;
        try {
            vatCalc = computeInvoiceVat(
                items.map(item => ({ net: item.total, taxCategory: item.taxCategory })),
                supplierProfile, { transactionDate: dateOnly(requestedDate) || riyadhToday(), standardRate });
        } catch (taxError) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_TAX_CATEGORY', String(taxError.message).slice(0, 200));
        }
        const invoiceNet = vatCalc.subtotalNet;
        const invoiceVat = vatCalc.vatTotal;
        const invoiceTotal = vatCalc.grandTotal;
        let paidAmount = 0;
        if (req.body?.paidAmount !== undefined && req.body?.paidAmount !== null && req.body?.paidAmount !== '') {
            const rawPaid = Number(req.body.paidAmount);
            if (!Number.isFinite(rawPaid) || rawPaid < 0 || rawPaid > invoiceTotal) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_PAID_AMOUNT', 'المبلغ المسدد يجب أن يكون بين صفر وإجمالي الفاتورة');
            }
            paidAmount = round(rawPaid, 2);
        } else if (paymentMethod !== 'credit') {
            paidAmount = invoiceTotal;
        }
        const paymentStatus = computeInvoicePaymentStatus(invoiceTotal, paidAmount);
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let oldItems = oldInvoice.items;
        if (typeof oldItems === 'string') {try {oldItems = JSON.parse(oldItems);} catch (_) {oldItems = [];} }
        if (!Array.isArray(oldItems)) {oldItems = [];}
        const revision = id();
        const inventoryRows = [];
        const transactions = [];
        for (let index = 0; index < oldItems.length; index++) {
            const old = oldItems[index];
            const inventoryId = Number(old.itemId || old.item_id);
            const qty = round(n(old.qty), 3);
            if (!Number.isSafeInteger(inventoryId) || qty <= 0) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_ITEM_INVALID', 'تعذر عكس بند قديم غير صالح؛ راجع بيانات الفاتورة قبل تعديلها');
            }
            const row = (await client.query(
                'SELECT id,name,unit,qty,"avgCost",COALESCE(weight,0) AS weight FROM inventory WHERE id=$1 FOR UPDATE', [inventoryId]
            )).rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_ITEM_MISSING', `الصنف «${old.itemName || old.name || inventoryId}» غير موجود بالمخزون`);
            }
            const oldUnitCost = n(old.effectivePrice ?? old.price);
            const oldWeight = Math.max(0, n(old.weight));
            const boxes = old.packagingQty ?? old.packaging_qty ?? old.catch_weight_qty ?? null;
            const boxesUnit = old.packagingUom || old.packaging_uom || old.catch_weight_unit || null;
            const reversal = await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId, locationId: mainLocation.id, quantityDelta: -qty,
                unit: row.unit || old.unit || 'وحدة', unitCost: oldUnitCost,
                referenceType: 'purchase_invoice_edit_reversal', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-edit-reversal:${invoiceId}:${revision}:${index}`,
                reason: `عكس بند فاتورة شراء ${oldInvoice.invoiceNumber || invoiceId} قبل التعديل`,
                metadata: { invoice_id: invoiceId, revision },
                catchWeightQty: boxes === null ? null : n(boxes), catchWeightUnit: boxes === null ? null : boxesUnit,
            });
            if (reversal.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_REVERSAL_EXISTS', 'وجد قيد عكس سابق لهذا التعديل؛ راجع دفتر المخزون');
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes,"invoiceNumber","supplierName",weight,catch_weight_qty,catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inventoryId, row.name, qty, dateOnly(new Date()), oldUnitCost, round(qty * oldUnitCost, 2),
                    `عكس فاتورة شراء ${oldInvoice.invoiceNumber || invoiceId} قبل التعديل`, oldInvoice.invoiceNumber,
                    oldInvoice.supplierName, -oldWeight, boxes, boxes === null ? null : boxesUnit]
            )).rows[0];
            transactions.push(tx);
            const remaining = n((await client.query(
                'SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [inventoryId]
            )).rows[0]?.q);
            if (remaining > 0) {
                const nextAvg = Math.max(0, round(((n(row.avgCost) * (remaining + qty)) - (oldUnitCost * qty)) / remaining, 2));
                await client.query(
                    'UPDATE inventory SET "avgCost"=$2,weight=GREATEST(0,COALESCE(weight,0)-$3) WHERE id=$1',
                    [inventoryId, nextAvg, oldWeight]);
            } else {
                await client.query('UPDATE inventory SET weight=GREATEST(0,COALESCE(weight,0)-$2) WHERE id=$1', [inventoryId, oldWeight]);
            }
        }

        const existingRows = await client.query('SELECT id,name FROM inventory');
        const existingByKey = new Map(existingRows.rows.map(row => [normItemName(row.name), Number(row.id)]));
        const updatedItems = [];
        for (const item of items) {
            const matchedId = existingByKey.get(normItemName(item.itemName));
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && item.unitProvided && String(item.unit).trim().toLowerCase() !== String(inv.unit || 'وحدة').trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'وحدة'}» وليس «${item.unit}»`);
            }
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id,name,category,unit,qty,"avgCost","minQty",weight)
                     VALUES ($1,$2,$3,$4,0,$5,0,0) RETURNING *`,
                    [id(), item.itemName, item.category, item.unit, item.effectivePrice]
                )).rows[0];
                existingByKey.set(normItemName(item.itemName), Number(inv.id));
            } else {
                const oldQty = n(inv.qty);
                const nextQty = round(oldQty + item.qty, 3);
                const nextCost = nextQty > 0
                    ? round(((oldQty * n(inv.avgCost)) + (item.qty * item.effectivePrice)) / nextQty, 2)
                    : round(item.effectivePrice, 2);
                inv = (await client.query(
                    'UPDATE inventory SET "avgCost"=$2,weight=COALESCE(weight,0)+$3 WHERE id=$1 RETURNING *',
                    [inv.id, nextCost, round(item.weight, 3)]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            const receipt = await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: item.qty, unit: inv.unit || item.unit || 'وحدة', unitCost: item.effectivePrice,
                referenceType: 'purchase_invoice_edit', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-edit:${invoiceId}:${revision}:${inv.id}`,
                expiryDate: item.expiryDate || null,
                reason: `تعديل استلام فاتورة شراء ${requestedInvoiceNumber || invoiceId}`,
                metadata: { invoice_id: invoiceId, invoice_number: requestedInvoiceNumber, revision },
                catchWeightQty: item.packagingQty,
                catchWeightUnit: item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null,
            });
            if (receipt.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_RECEIPT_EXISTS', 'وجد قيد استلام سابق لهذا التعديل؛ راجع دفتر المخزون');
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes,"invoiceNumber","supplierName",weight,catch_weight_qty,catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inv.id, inv.name, item.qty, dateOnly(requestedDate), item.effectivePrice, item.total,
                    `استلام فاتورة شراء معدلة ${requestedInvoiceNumber || ''}`.trim(), requestedInvoiceNumber,
                    supplierRow?.name || supplierName || null, round(item.weight, 3), item.packagingQty,
                    item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null]
            )).rows[0];
            inventoryRows.push(Number(inv.id));
            transactions.push(tx);
            updatedItems.push({ ...item, itemId: Number(inv.id), itemName: inv.name });
        }
        const headerRate = vatCalc.lines.reduce((max, line) => Math.max(max, line.rate), 0);
        const updated = (await client.query(
            `UPDATE "purchaseInvoices" SET "invoiceNumber"=$2,date=$3,"supplierName"=$4,"supplierPhone"=$5,
             items=$6,"totalAmount"=$7,"paymentMethod"=$8,notes=$9,"supplierId"=$10,"paidAmount"=$11,"paymentStatus"=$12,
             subtotal_net=$13,vat_total=$14,tax_rate_snapshot=$15,tax_rule_code_snapshot=$16,
             supplier_name_snapshot=$17,supplier_vat_number_snapshot=$18,supplier_cr_snapshot=$19,
             supplier_tax_status_snapshot=$20,zatca_uuid=$21,zatca_qr=NULL,discount_type=$22,discount_value=$23,discount_amount=$24
             WHERE id=$1 RETURNING *`,
            [invoiceId, requestedInvoiceNumber, dateOnly(requestedDate), supplierRow?.name || supplierName || null,
                req.body?.supplierPhone || null, json(updatedItems), invoiceTotal, paymentMethod, req.body?.notes || null,
                supplierId, paidAmount, paymentStatus, invoiceNet, invoiceVat, headerRate, vatCalc.ruleCode,
                supplierRow?.name || supplierName || null, supplierRow?.vat_number || null,
                supplierRow?.commercial_register || null, supplierRow?.tax_registration_status || 'NOT_REGISTERED',
                crypto.randomUUID(), discountType, discountValue, discountAmount]
        )).rows[0];
        if (supplierId !== null && paidAmount > 0) {
            await client.query(
                `INSERT INTO supplier_payments (id,"supplierId",amount,method,date,"invoiceId",notes,"createdBy")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [id(), supplierId, paidAmount, paymentMethod === 'credit' ? 'cash' : paymentMethod,
                    dateOnly(requestedDate), invoiceId, 'دفعة تلقائية مع تعديل فاتورة الشراء',
                    req.user.username || String(req.user.id)]);
        }
        await client.query(
            `UPDATE journal_entries SET status='void',source_type='purchase_invoice_edit_void',source_id=$2
              WHERE source_type='purchase_invoice' AND source_id=$1 AND status='posted'`,
            [String(invoiceId), `${invoiceId}:revision:${revision}`]);
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_UPDATED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: { invoice_id: invoiceId, number: updated.invoiceNumber, total: invoiceTotal, revision },
        });
        await client.query('COMMIT');

        try {
            await require('../accounting-routes').postPurchaseToLedger(invoiceId);
        } catch (ledgerError) {
            logger.warn('[purchase_edit_ledger] best-effort posting skipped:', ledgerError.message);
        }
        const freshInventory = inventoryRows.length
            ? (await pool.query('SELECT * FROM inventory WHERE id=ANY($1::bigint[]) ORDER BY id', [inventoryRows])).rows
            : [];
        emit(req, 'purchaseInvoices', 'update', updated);
        for (const row of freshInventory) {emit(req, 'inventory', 'update', row);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        res.json({ invoice: updated, inventory: freshInventory, transactions });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_purchase_invoice_edit]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return fail(res, 409, 'EDIT_INSUFFICIENT_STOCK', 'لا يمكن تعديل الفاتورة لأن بعض كمياتها صُرفت بالفعل؛ راجع رصيد المخزون قبل التعديل');
        }
        res.status(500).json({ error: 'PURCHASE_INVOICE_EDIT_FAILED', message: 'تعذر تعديل فاتورة الشراء وتحديث المخزون', detail: error?.message || String(error) });
    } finally {
        client.release();
    }
});

// ─── حذف نهائي لصنف مخزون مع كل حركاته (قرار المالك — مدير فقط) ───
// يمحو السجل المرتبط (دفتر/أرصدة/تحويلات/جرد/وصفات/ربط) في معاملة واحدة.
// يُستخدم فقط بعد رفض الحذف العادي (409) — بتأكيد صريح من الواجهة.
router.delete('/inventory/:id/force', jwtAuth, requireRole('admin', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const itemId = Number(req.params.id);
        if (!Number.isFinite(itemId)) {return fail(res, 422, 'INVALID_ID', 'معرف الصنف غير صحيح');}
        await client.query('BEGIN');
        const item = (await client.query('SELECT id, name FROM inventory WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
        if (!item) { await client.query('ROLLBACK'); return fail(res, 404, 'ITEM_NOT_FOUND', 'الصنف غير موجود'); }
        // فحص الاستخدام أولًا: مراجع JSONB وأعمدة مالية لا تُمسح تلقائيًا — الحذف معها يتيم بيانات
        const usage = [];
        const usedIn = async (label, sql, params) => {
            const r = await client.query(sql, params);
            const c = Number(r.rows[0]?.c || 0);
            if (c > 0) {usage.push({ where: label, count: c });}
        };
        await usedIn('purchaseInvoices', `SELECT COUNT(*)::int AS c FROM "purchaseInvoices" WHERE items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('kitchenReturns', `SELECT COUNT(*)::int AS c FROM "kitchenReturns" WHERE items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('dispatches', `SELECT COUNT(*)::int AS c FROM dispatches WHERE items::text LIKE $1 OR "approvedItems"::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('expenses', `SELECT COUNT(*)::int AS c FROM expenses WHERE notes LIKE $1 OR "desc" LIKE $1`, [`%${item.name}%`]);
        await usedIn('purchase_requests', `SELECT COUNT(*)::int AS c FROM purchase_requests WHERE items::text LIKE $1 OR received_items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('supplier_payments', `SELECT COUNT(*)::int AS c FROM supplier_payments WHERE notes LIKE $1`, [`%${item.name}%`]);
        if (usage.length) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'ITEM_REFERENCED', `الصنف "${item.name}" مستخدم في مستندات — ألغِ/سوِّ المستندات أولًا ثم احذف`, { usage });
        }
        const counts = {};
        const del = async (table, col) => {
            const r = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [itemId]);
            counts[table] = r.rowCount;
        };
        await del('inventory_ledger', 'inventory_id');
        await del('inventory_location_balances', 'inventory_id');
        await del('inventory_transfer_items', 'inventory_id');
        await del('inventory_audit_items', 'item_id');
        await del('pos_recipe_version_ingredients', 'inventory_id');
        await del('pos_product_ingredients', 'inventory_id');
        await del('"inventoryTx"', '"itemId"');
        await del('yarasoft_product_mapping', 'internal_product_id');
        await client.query('DELETE FROM inventory WHERE id = $1', [itemId]);
        await client.query('COMMIT');
        emit(req, 'inventory', 'delete', { id: itemId, name: item.name, force: true });
        logger.warn(`[inventory_force_delete] ${req.user?.username} حذف نهائيًا الصنف ${item.name} (${itemId}) مع ${JSON.stringify(counts)}`);
        res.json({ ok: true, item: { id: itemId, name: item.name }, removed: counts });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[inventory_force_delete]', error);
        res.status(500).json({ error: 'FORCE_DELETE_FAILED', message: 'تعذر الحذف النهائي: ' + String(error.message).slice(0, 160) });
    } finally { client.release(); }
});

// ─── إلغاء فاتورة شراء مع عكس أثرها المخزني (قرار المالك) ───
// الشروط: بلا مدفوعات (paidAmount=0 وبلا supplier_payments مرتبطة) — المال المتحرك لا يُمحى.
// يعكس الاستلام في الدفتر (حركة عكسية موثقة) ويحذف حركات الـ in ثم الفاتورة — كله في معاملة واحدة.
// ─── صلاحية الأدمن المطلقة: تعديل مباشر للكمية/متوسط التكلفة بقيد تسوية موثق ──
// (طلب المالك 2026-10-04) — أدمن فقط. الفرق يُقيَّد count_correction في الدفتر
// ويُسجَّل في inventoryTx مع السبب — لا تعديل صامت أبدًا.
router.put('/inventory/:id/direct', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const itemId = Number(req.params.id);
        const newCost = Number(req.body?.avgCost);
        const reason = cleanName(req.body?.reason).slice(0, 200) || 'تعديل مباشر بواسطة الأدمن';
        // طلب المالك 2026-10-06: «الرصيد ناقص أذونات الصرف يظهر قدامي الرقم الفعلي في المخزن» —
        // mainQty يجعل الصافي يقع على المخزن الرئيسي تحديدًا ورصيد مخازن الأقسام يبقى كما هو،
        // بدل إجبار الإجمالي = الصافي الذي كان يبعثر أرصدة الرئيسي عند وجود مخزون بأقسام أخرى.
        const hasMainQty = req.body?.mainQty !== undefined && req.body?.mainQty !== null && String(req.body.mainQty).trim() !== '';
        const newMainQty = hasMainQty ? Number(req.body.mainQty) : null;
        const newQty = hasMainQty ? null : Number(req.body?.qty);
        if (!Number.isInteger(itemId) || itemId <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الصنف غير صحيح');}
        if (hasMainQty) {
            if (!Number.isFinite(newMainQty) || newMainQty < 0) {return fail(res, 422, 'INVALID_QTY', 'رصيد المخزن الرئيسي يجب أن يكون رقمًا ≥ صفر');}
        } else if (!Number.isFinite(newQty) || newQty < 0) {return fail(res, 422, 'INVALID_QTY', 'الكمية يجب أن تكون رقمًا ≥ صفر');}
        if (!Number.isFinite(newCost) || newCost < 0) {return fail(res, 422, 'INVALID_COST', 'التكلفة يجب أن تكون رقمًا ≥ صفر');}
        await client.query('BEGIN');
        const item = (await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
        if (!item) { await client.query('ROLLBACK'); return fail(res, 404, 'ITEM_NOT_FOUND', 'الصنف غير موجود'); }
        const oldQty = n(item.qty);
        const oldCost = n(item.avgCost);
        const location = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        await ensureLocationBalance(client, itemId, location.id, oldQty);
        let delta;
        if (hasMainQty) {
            const curMain = n((await client.query(
                'SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2 FOR UPDATE',
                [itemId, location.id])).rows[0]?.on_hand);
            delta = round(newMainQty - curMain, 3);
        } else {
            delta = round(newQty - oldQty, 4);
        }
        if (delta !== 0) {
            await postInventoryLedgerEntry(client, {
                transactionType: 'count_correction', inventoryId: itemId, locationId: location.id,
                quantityDelta: delta, unit: item.unit || 'وحدة',
                unitCost: newCost, referenceType: 'admin_direct_edit', referenceId: String(itemId),
                userId: req.user.id, idempotencyKey: `admin-direct:${itemId}:${Date.now()}`,
                // تصحيح جرد: تاريخ صريح من الطلب وإلا تاريخ الدُفعة المسجل — لا يُخترع تاريخ
                expiryDate: normalizeExpiryDate(readExpiryField(req.body || {})) || await latestExpiryFor(client, itemId),
                reason, metadata: { admin_direct: true, old_qty: oldQty, new_qty: hasMainQty ? null : newQty, old_cost: oldCost, new_cost: newCost, ...(hasMainQty ? { main_qty_target: newMainQty } : {}) },
            });
            await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes)
                 VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7,$8)`,
                [id(), itemId, item.name, round(Math.abs(delta)), dateOnly(new Date()), newCost,
                 round(Math.abs(delta) * newCost, 2), reason]
            );
        }
        const upd = hasMainQty
            ? (await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1 RETURNING *', [itemId, newCost])).rows[0]
            : (await client.query('UPDATE inventory SET qty=$2, "avgCost"=$3 WHERE id=$1 RETURNING *', [itemId, newQty, newCost])).rows[0];
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', upd);
        logger.warn(`[inventory_direct_edit] ${req.user?.username} عدّل مباشرة «${item.name}»: qty ${oldQty}→${newQty}, avgCost ${oldCost}→${newCost} — ${reason}`);
        res.json({ ok: true, item: upd, delta });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_direct_edit]', error);
        return fail(res, 500, 'DIRECT_EDIT_FAILED', 'تعذر التعديل المباشر: ' + String(error.message).slice(0, 160));
    } finally { client.release(); }
});



module.exports = {};
