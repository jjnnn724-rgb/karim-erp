/**
 * veg-invoice.js — إنشاء فاتورة مورد خضار من طلبية خضروات مُسعَّرة (2026-11-18).
 * ────────────────────────────────────────────────────────────────────────────
 * الطلب يصبح استلام فاتورة حقيقي: الأصناف تُنشأ في المخزون (إن لم تكن موجودة)،
 * الفاتورة تُنشأ بحقول ضريبة متوافقة مع المورد (NOT_REGISTERED → بلا ضريبة)،
 * حركات المخزون purchase_receipt تندرج في inventory_ledger، والقيد المحاسبي
 * يُنشأ عبر postPurchaseToLedger (best-effort، يسجل الفشل بلا كسر).
 *
 * 2026-11-21 (طلب المالك «الخضار تاجر»): إضافة سطر مصروف آلي على قسم المطبخ
 * (expenses.deptId مع adjustmentType='veg_purchase' — يظهر في وعاء المواد
 * المباشرة في تحليل التكلفة) بجانب القيد المحاسبي للفاتورة، وإرجاع معرّف
 * الدفعة النقدية لترحيل قيد سداد المورد بعد الالتزام (في مسار الاستلام).
 */
'use strict';

const VEG_SUPPLIER_NAME = 'مورد خضار';
const VEG_DEFAULT_DEPT = 'kitchen';

/** اسم التطبيع — نفس منطقwarehouse-routes.js (يديه لخميس شر): */
function normName(v) {
    return String(v ?? '')
        .toLowerCase()
        .replace(/[\u064B-\u0652\u0670\u06D6-\u06ED\u0640]/g, '')
        .replace(/[أإآٱا]/g, 'ا').replace(/ى/g, 'ي').replace(/[ةه]/g, 'ه')
        .replace(/[^\u0621-\u064A0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function round2(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getScope() {
    // إعادة قراءة شهرية: warehouse-routes قد يُحمَّل بعد هذا الملف —،()
    // require lazy داخل الدالة نفسها لتفادي دوائر require.
    return require('./warehouse-routes').__scope;
}

/**
 * يطابق خط أصناف طلبية الخضار + يضمن وجودها في المخزون (لو غائبة تُنشأ برصيد صفر).
 * يعيد المصفوفة مع itemId فعلي لكل خط.
 */
async function resolveVegInventory(client, lines) {
    const { id, normItemName } = getScope();
    const { rows: invRows } = await client.query('SELECT id, name FROM inventory');
    const existingByKey = new Map(invRows.map((r) => [normItemName(r.name), Number(r.id)]));
    const resolved = [];
    for (const line of lines) {
        const itemName = String(line.name || '').trim();
        const key = normItemName(itemName);
        let inventoryId = existingByKey.get(key);
        if (inventoryId == null) {
            const created = await client.query(
                `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", weight)
                 VALUES ($1,$2,'خضار','كجم',0,$3,0,0) RETURNING id`,
                [id(), itemName, takePrice(line.price)],
            );
            inventoryId = Number(created.rows[0].id);
            existingByKey.set(key, inventoryId);
        }
        resolved.push({ ...line, inventoryId });
    }
    return resolved;
}

function takePrice(p) {
    const n = Number(p);
    return Number.isFinite(n) && n >= 0 ? round2(n) : 0;
}

/**
 * كود قسم تحميل مصروف الطلبية — مطابقة حقل department بأكواد جدول الأقسام،
 * والافتراضي kitchen (قسم المطبخ — قرار المالك 2026-11-21).
 */
async function resolveVegDeptCode(client, department) {
    const wanted = String(department || '').trim();
    if (wanted) {
        const found = (await client.query(
            'SELECT code FROM departments WHERE LOWER(code) = LOWER($1) LIMIT 1',
            [wanted],
        )).rows[0];
        if (found?.code) {return String(found.code);}
    }
    return VEG_DEFAULT_DEPT;
}

/** ينشئ فاتورة مورد خضار من طلبية مُسعَّرة — يعود بـ{ invoiceId, invoiceNumber, total, expenseId, paymentId, supplierName } */
async function createVegInvoice(client, { requestNo, requestId, items, user, pricedByName, department }) {
    const scope = getScope();
    const {
        id, crypto, riyadhToday, computeInvoicePaymentStatus, computeInvoiceVat, loadStandardRate,
        normItemName, cleanName, json, dateOnly, round, postInventoryLedgerEntry,
        allocatePurchaseDiscount, getWarehouseLocation, ensureLocationBalance,
    } = scope;

    // ─── تفاصيل المورد ────────────────────────────────────────────
    let supplierRow = (await client.query(
        "SELECT id, name, tax_registration_status, vat_number, commercial_register FROM suppliers WHERE name = $1 LIMIT 1",
        [VEG_SUPPLIER_NAME],
    )).rows[0];
    if (!supplierRow) {
        const created = await client.query(
            `INSERT INTO suppliers (id, name, category, "openingBalance", is_active, tax_registration_status)
             VALUES ($1,$2,'خضار',0,true,'NOT_REGISTERED') RETURNING id, name, tax_registration_status, vat_number, commercial_register`,
            [id(), VEG_SUPPLIER_NAME],
        );
        supplierRow = created.rows[0];
    }
    const supplierId = Number(supplierRow.id);

    // ─── تجهيز السطور + ربطها بالمخزون ─────────────────────────────
    const prepared = (Array.isArray(items) ? items : [])
        .map((line) => ({
            name: String(line.name || '').trim(),
            qty: Number(line.qty) || 0,
            unit: String(line.unit || 'كجم').trim() || 'كجم',
            price: takePrice(line.price),
            taxCategory: String(line.taxCategory || 'STANDARD').toUpperCase(),
        }))
        .filter((line) => line.name && line.qty > 0);
    if (!prepared.length) {
        const err = new Error('PRICES_INVALID');
        err.code = 'PRICES_INVALID';
        err.statusCode = 422;
        throw err;
    }
    const resolved = await resolveVegInventory(client, prepared);
    const total = round2(resolved.reduce((sum, l) => sum + l.qty * l.price, 0));

    // ─── ترحيل التكلفة المتوسطة وربط الكميات (متناظر مع warehouse-routes) ───
    const invoiceId = id();
    const invoiceNumber = `VEG-${String(requestNo || '').replace(/^VR-?/, '') || invoiceId}`;
    const chargeDate = riyadhToday();
    const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
    const invoiceItems = [];
    for (const item of resolved) {
        const current = await client.query('SELECT qty, "avgCost" FROM inventory WHERE id = $1 FOR UPDATE', [item.inventoryId]);
        const oldQty = Number(current.rows[0]?.qty ?? 0);
        const oldCost = Number(current.rows[0]?.avgCost ?? 0);
        const nextQty = round((oldQty + item.qty) * 1000) / 1000;
        const nextCost = nextQty > 0
            ? round(((oldQty * oldCost) + (item.qty * item.price)) / nextQty, 2)
            : item.price;
        await client.query('UPDATE inventory SET "avgCost" = $2 WHERE id = $1', [item.inventoryId, nextCost]);
        await ensureLocationBalance(client, item.inventoryId, mainLocation.id, oldQty);
        await postInventoryLedgerEntry(client, {
            transactionType: 'purchase_receipt', inventoryId: item.inventoryId, locationId: mainLocation.id,
            quantityDelta: round(item.qty), unit: item.unit, unitCost: item.price,
            referenceType: 'purchase_invoice', referenceId: String(invoiceId), userId: user?.id || null,
            idempotencyKey: `veg-invoice:${invoiceId}:${item.inventoryId}`,
            reason: `استلام فاتورة خضار VR${requestNo}`.trim(),
            metadata: { invoice_number: invoiceNumber, request_no: requestNo, source: 'veg_requests' },
        });
        const txId = id();
        await client.query(
            `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", "supplierName")
             VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10)`,
            [txId, item.inventoryId, item.name, round(item.qty), dateOnly(chargeDate), item.price,
                round(item.qty * item.price), `استلام فاتورة ${invoiceNumber}`.trim(), invoiceNumber, VEG_SUPPLIER_NAME]);
        invoiceItems.push({
            itemId: Number(item.inventoryId),
            itemName: item.name,
            qty: item.qty,
            unit: item.unit,
            price: item.price,
            total: round(item.qty * item.price),
            category: 'خضار',
            taxCategory: item.taxCategory,
        });
    }

    // ─── ترحيل الفاتورة نفسها (ضريبة + مدفوع + حالة) ───/ptr
    const standardRate = await loadStandardRate(client);
    const supplierProfile = {
        status: supplierRow.tax_registration_status || 'NOT_REGISTERED',
        vat_number: supplierRow.vat_number || null,
        country: 'SA',
    };
    const vatCalc = computeInvoiceVat(
        invoiceItems.map((it) => ({ net: it.total, taxCategory: it.taxCategory || 'STANDARD' })),
        supplierProfile,
        { transactionDate: chargeDate, standardRate },
    );
    const invoiceNet = vatCalc.subtotalNet;
    const invoiceVat = vatCalc.vatTotal;
    const invoiceTotal = vatCalc.grandTotal;
    const paymentStatus = computeInvoicePaymentStatus(invoiceTotal, invoiceTotal); // دائمًا مدفوعة نقدًا
    const invoiceRows = await client.query(
        `INSERT INTO "purchaseInvoices" (id, "invoiceNumber", date, "supplierName", "supplierPhone", items, "totalAmount", "paymentMethod", notes, "createdAt", "createdBy", "supplierId", "paidAmount", "paymentStatus",
            subtotal_net, vat_total, tax_rate_snapshot, tax_rule_code_snapshot,
            supplier_name_snapshot, supplier_vat_number_snapshot, supplier_cr_snapshot,
            supplier_tax_status_snapshot, zatca_uuid, discount_type, discount_value, discount_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id, "invoiceNumber"`,
        [invoiceId, invoiceNumber, chargeDate, VEG_SUPPLIER_NAME, null, json(invoiceItems), invoiceTotal, 'cash',
            `استلام فاتورة — طلبية خضار ${requestNo}`.trim(), new Date().toISOString(), user?.username || String(user?.id ?? ''),
            supplierId, invoiceTotal, paymentStatus,
            invoiceNet, invoiceVat, Math.max(...vatCalc.lines.map((l) => l.rate), 0), vatCalc.ruleCode,
            supplierRow.name, supplierRow.vat_number || null, supplierRow.commercial_register || null,
            supplierRow.tax_registration_status || 'NOT_REGISTERED', crypto.randomUUID(), 'none', 0, 0],
    );
    // ─── قيد الدفع (إن كان مدفوعًا) ───────────────────────────
    let paymentId = null;
    if (invoiceTotal > 0) {
        paymentId = id();
        await client.query(
            `INSERT INTO supplier_payments (id, "supplierId", amount, method, date, "invoiceId", notes, "createdBy")
             VALUES ($1,$2,$3,'cash',$4,$5,$6,$7)`,
            [paymentId, supplierId, invoiceTotal, chargeDate, invoiceId, 'دفعة تلقائية مع فاتورة خضار', user?.username || String(user?.id ?? '')]);
    }

    // ─── مصروف القسم الآلي (طلب المالك 2026-11-21) ───────────────
    // سطر في جدول expenses على قسم المطبخ بنفس نمط المشتريات المباشرة —
    // هذا ما يجعل مال الخضار يظهر في تحليل تكلفة القسم (وعاء المواد المباشرة)،
    // بلا قيد مستقل (المصدر المحاسبي واحد: قيد فاتورة الشراء المسددة).
    const deptCode = await resolveVegDeptCode(client, department);
    const expenseRow = (await client.query(
        `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
         VALUES ($1,$2,$3,$4,$5,$6,true,'خضار','veg_purchase') RETURNING id`,
        [id(), deptCode, `فاتورة خضار ${invoiceNumber}`.trim(), invoiceTotal, dateOnly(chargeDate),
            `طلبية خضار ${requestNo} — مصروف آلي من فاتورة الشراء المسددة (مورد: ${VEG_SUPPLIER_NAME})`],
    )).rows[0];
    if (requestId != null) {
        await client.query('UPDATE veg_requests SET expense_id = $2 WHERE id = $1', [requestId, expenseRow.id]);
    }

    return {
        invoiceId: Number(invoiceRows.rows[0].id), invoiceNumber, total: invoiceTotal, supplierId,
        expenseId: String(expenseRow.id), paymentId, supplierName: VEG_SUPPLIER_NAME, deptCode,
    };
}

module.exports = { createVegInvoice, VEG_SUPPLIER_NAME, normName };
