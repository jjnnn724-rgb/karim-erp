'use strict';
// ═══════════════════════════════════════════════════════════════════
// Karim ERP — التحويلات الداخلية بين الأقسام (Department Transfers)
// ───────────────────────────────────────────────────────────────────
// ملف جديد معزول تمامًا — لا يمس inventory-transfer-routes.js إطلاقًا.
//
//   المسار A (بموافقة): أي قسم → أي قسم. الطلب من رئيس القسم (مُجبر على
//   قسمه)، واعتماد الشيف/السو-شيف = تنفيذ فوري: خصم من مخزن المرسل +
//   إضافة على مخزن المستلم بالتكلفة الفعلية (avgCost لحظة التنفيذ)،
//   مع قيد نقل تكلفة بين مركزي القسمين (مدين 5000 مستلم / دائن 5000 مرسل).
//
//   المسار B (مباشر): تحويل للبيع الخارجي — خطوة واحدة بلا اعتماد لأي
//   قسم؛ الوجهة ثابتة = مخزن البيع الخارجي (external_sales / STORE-EXTERNAL).
//
// البنية المخزنية نفسها: inventory_transfers + البنود + الأحداث، والحركات
// عبر postInventoryLedgerEntry (idempotent). مخازن STORE-* تُنشأ تلقائيًا.
// كل SQL نصوص قصيرة باقتباس مفرد بدون حروف مدمجة (نمط اجتياز ماسح Mimosa).
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { postJournal, ensureCostCenters, normalizeCostCenterCode } = require('./accounting-routes');
const { resolveAccounts } = require('./coa-mapping');
const { resolveSourceStore, resolveDestinationStore } = require('./dept-stores');
const { notifyTransferEvent } = require('./transfer-notifier');
const { logger } = require('./logger');

const router = express.Router();

const WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
const APPROVE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
const EXTERNAL_SALE_DEPT = 'external_sales';
const KITCHEN_DEPT = 'kitchen';
/* قرار المالك 2026-11-01: أي قسم يسلّم بضاعته إلى منافذ البيع الخارجية
   الثلاثة (البيع الخارجي · كافيه · كافيه ناصر) بلا اعتماد الشيف، من بضاعة
   أذونات الصرف المعتمدة منذ بداية الشهر الحالي بتوقيت الرياض. */
const EXTERNAL_DESTS = ['external_sales', 'caf', 'nas'];
// قيد الجدول inventory_transfers_status_check لا يحوي completed —
// received هي الحالة المغلقة المعتمدة (overview يستثنيها من المفتوح).
const STATUS_DONE = 'received';

function fail(res, status, error, message, extra) {
  return res.status(status).json(Object.assign({ error, message }, extra || {}));
}

function newTransferNumber() {
  // crypto.randomInt بدل Math.random — درس Mimosa الموثق في production-routes
  return 'TR-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + crypto.randomInt(100, 1000);
}

async function writeEvent(client, transferId, fromStatus, toStatus, userId, reason, metadataObj) {
  const fromDb = fromStatus ? String(fromStatus) : null;
  const userDb = userId != null ? Number(userId) : null;
  const reasonDb = reason ? String(reason) : null;
  const metaDb = JSON.stringify(metadataObj || {});
  await client.query(
    'INSERT INTO inventory_transfer_events (transfer_id, from_status, to_status, actor_user_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6)',
    [transferId, fromDb, toStatus, userDb, reasonDb, metaDb]
  );
}

function deptList(user) {
  return String(user && user.dept_code ? user.dept_code : '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function deptCodeEquals(a, b) {
  return String(a ? a : '').trim().toLowerCase() === String(b ? b : '').trim().toLowerCase();
}

/** أسماء الأقسام لرسائل الإشعار — استعلام بسيط واحد. */
async function lookupDeptNames(codes) {
  const wanted = codes.filter(Boolean).map(function (c) { return String(c).trim().toLowerCase(); }).filter(Boolean);
  const map = {};
  if (!wanted.length) {return map;}
  try {
    const r = await pool.query('SELECT code, name FROM departments WHERE LOWER(code) = ANY($1)', [wanted]);
    for (const row of r.rows) { map[String(row.code).toLowerCase()] = row.name; }
  } catch (_) { /* الأسماء تظل الأكواد — لا يفشل الإشعار */ }
  return map;
}

/** مصدر الطلب مُجبر على قسم الطالب — عقيدة resolveDeptHeadDispatch
 *  (warehouse-routes.js:145): dept_head ⇒ قسمه فقط؛ kitchen/sous_chef بلا
 *  قسم ⇒ المطبخ (KITCHEN-MAIN)؛ admin/manager/warehouse ⇒ حرّون بتحديد صريح. */
function resolveSourceDept(user, requestedDept) {
  const role = String(user && user.role ? user.role : '').toLowerCase();
  const own = deptList(user);
  if (['admin', 'manager', 'warehouse'].indexOf(role) !== -1) {
    const code = String(requestedDept ? requestedDept : '').trim();
    if (!code) {return { ok: false, code: 'SOURCE_DEPT_REQUIRED', message: 'حدد القسم المرسل' };}
    return { ok: true, deptCode: code };
  }
  if (!own.length) {
    if (role === 'kitchen' || role === 'sous_chef') {return { ok: true, deptCode: KITCHEN_DEPT };}
    return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT', message: 'حسابك غير مربوط بقسم — راجع مدير النظام' };
  }
  const requested = String(requestedDept ? requestedDept : '').trim();
  if (requested) {
    const match = own.find(function (c) { return deptCodeEquals(c, requested); });
    if (!match) {return { ok: false, code: 'DEPT_MISMATCH', message: 'لا يمكنك التحويل من قسم غير قسمك' };}
    return { ok: true, deptCode: match };
  }
  return { ok: true, deptCode: own[0] };
}

/** مخزن القسم: يُحسم من dept-stores.js (مصدر واحد للحقيقة).
 *  - مصدر التحويل: الموقع الذي استُلمت فيه أذونات صرف القسم فعليًا.
 *  - وجهة التحويل: مخزن مخصص أو مرتبط بـ dept_code أو STORE-<القسم>. */
async function ensureDeptLocation(client, deptCode, role) {
  return role === 'destination'
    ? resolveDestinationStore(client, deptCode)
    : resolveSourceStore(client, deptCode);
}

/** تجميع بنود الطلب: {inventory_id, qty} — تكرار الصنف يُجمع ولا يُرفض. */
function collectItems(rawItems) {
  const items = new Map();
  for (const raw of rawItems) {
    const inventoryId = Number(raw.inventory_id);
    const rawQty = raw.requested_qty !== undefined && raw.requested_qty !== null ? raw.requested_qty : raw.qty;
    const qty = Number(rawQty);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error('بيانات الصنف أو الكمية غير صحيحة'), { code: 'INVALID_TRANSFER_ITEM' });
    }
    items.set(inventoryId, (items.get(inventoryId) || 0) + qty);
  }
  if (!items.size) {throw Object.assign(new Error('أضف أصنافًا للتحويل'), { code: 'INVALID_TRANSFER' });}
  return items;
}

/** إدخال بنود التحويل — بتكلفة الإذن الفعلي إن توفّرت (costOverrides)
 *  وبوحدة الإذن نفسها إن توفّرت (unitOverrides)، وإلا بلقطة التكلفة
 *  ووحدة الصنف العامة (تُحدَّث بلقطة التنفيذ عند الاعتماد). */
async function insertTransferItems(client, transferId, items, costOverrides, unitOverrides) {
  for (const [inventoryId, qty] of items) {
    const item = (await client.query(
      'SELECT id, unit, COALESCE("avgCost",0) avg_cost FROM inventory WHERE id=$1', [inventoryId])).rows[0];
    if (!item) {
      throw Object.assign(new Error('الصنف ' + inventoryId + ' غير موجود'), { code: 'INVENTORY_ITEM_NOT_FOUND' });
    }
    const unitDb = (unitOverrides && unitOverrides.get(inventoryId)) || item.unit || 'وحدة';
    const hasVoucherCost = costOverrides && costOverrides.has(inventoryId);
    const unitCost = hasVoucherCost ? Number(costOverrides.get(inventoryId)) : item.avg_cost;
    await client.query(
      'INSERT INTO inventory_transfer_items (transfer_id, inventory_id, unit, requested_qty, unit_cost) VALUES ($1,$2,$3,$4,$5)',
      [transferId, inventoryId, unitDb, qty, unitCost]);
  }
}

/** يعلِّم سطر الإذن بالمستلَم في dispatches.receivedItems ويحدّث حالته.
 *  نفس الحقل الذي يقرأه مسار الاستلام اليدوي (dispatch-routes /receive)
 *  كسقف، فتحديثه هنا يمنع أي ازدواج: لا يُستلم مرة ثانية ما استُلم
 *  تلقائيًا، ويظل المتبقي غير المستلَم قابلًا للتوقيع من رئيس القسم. */
async function markDispatchReceived(client, transfer, source, inventoryId, take, unit) {
  const row = (await client.query(
    'SELECT "approvedItems", "receivedItems", status FROM dispatches WHERE id=$1 FOR UPDATE',
    [source.dispatch_id])).rows[0];
  if (!row) {return;}
  const received = (Array.isArray(row.receivedItems) ? row.receivedItems : []).map(function (r) {
    return Object.assign({}, r);
  });
  const name = String(source.item_name || '').trim();
  const nameKey = name.toLowerCase();
  let line = null;
  for (const r of received) {
    const rid = Number(r.itemId);
    const rName = String(r.itemName || r.name || '').trim().toLowerCase();
    if ((Number.isFinite(rid) && rid > 0 && rid === inventoryId) || (nameKey && rName === nameKey)) {
      line = r;
      break;
    }
  }
  const approvedQty = Number(source.qty) || 0;
  const round6 = function (v) { return Number(Number(v).toFixed(6)); };
  if (line) {
    line.itemId = line.itemId || inventoryId;
    line.itemName = line.itemName || name;
    line.approvedQty = line.approvedQty || approvedQty;
    line.receivedQty = round6((Number(line.receivedQty) || 0) + take);
    line.receivedDeltaQty = round6((Number(line.receivedDeltaQty) || 0) + take);
    line.varianceQty = round6((Number(line.receivedQty) || 0) - (Number(line.approvedQty) || 0));
    line.unit = line.unit || unit || source.unit || 'وحدة';
  } else {
    received.push({
      itemName: name, itemId: inventoryId, unit: unit || source.unit || 'وحدة',
      approvedQty: round6(approvedQty), receivedQty: round6(take), receivedDeltaQty: round6(take),
      varianceQty: round6(take - approvedQty), notes: 'استلام تلقائي عند التحويل',
    });
  }
  const approvedLines = Array.isArray(row.approvedItems) ? row.approvedItems : [];
  const complete = approvedLines.length > 0 && approvedLines.every(function (a) {
    return receivedQtyForSource(received, a, Number(a.itemId)) >= (Number(a.approvedQty) || 0) - 0.000001;
  });
  let nextStatus = row.status;
  if (complete) {nextStatus = 'received';}
  else if (String(row.status) === 'approved') {nextStatus = 'partially_received';}
  const receivedDb = JSON.stringify(received);
  const byDb = 'استلام تلقائي — تحويل ' + transfer.transfer_number;
  await client.query(
    'UPDATE dispatches SET status=$2, "receivedItems"=$3::jsonb, "kitchenReceivedAt"=COALESCE("kitchenReceivedAt", CURRENT_TIMESTAMP), "kitchenReceivedBy"=COALESCE("kitchenReceivedBy", $4) WHERE id=$1',
    [source.dispatch_id, nextStatus, receivedDb, byDb]);
}

/** القسم مخزنٌ صغير: الكمية التي اعتمدها إذن الصرف للقسم ولم تُسجَّل
 *  مستلَمة في مخزنه تُستلم تلقائيًا — بوحدة الإذن وتكلفته الفعلية — قبل خصم
 *  التحويل في نفس المعاملة. بدون هذا تقف البضاعة «في الطريق» فلا يملك القسم
 *  شيئًا يحوّله، وكان المتاح يُصفَّر بصمت. التخصيص FIFO على أذونات الإصدار،
 *  وكل قيد idempotent بمفتاح يحمل معرّف التحويل والصنف والإذن. */
async function receiveInTransitVoucherStock(client, transfer, items, userId) {
  const meta = transfer.metadata || {};
  const deptCode = String(meta.sourceDeptCode || '');
  if (!deptCode || String(meta.cost_basis || '') !== 'issue_voucher') {return;}
  const ids = items.map(function (i) { return Number(i.inventory_id); });
  const basis = await loadMonthVoucherBasis(client, deptCode, ids);
  for (const item of items) {
    const inventoryId = Number(item.inventory_id);
    const entry = basis.get(inventoryId);
    if (!entry || !(entry.in_transit > 0)) {continue;}
    const bal = (await client.query(
      'SELECT COALESCE(on_hand, 0) AS on_hand FROM inventory_location_balances WHERE location_id=$1 AND inventory_id=$2 FOR UPDATE',
      [transfer.source_location_id, inventoryId])).rows[0];
    const onHand = Number(bal ? bal.on_hand : 0) || 0;
    let need = Number(item.requested_qty) - onHand;
    while (need > 0.000001) {
      const source = entry.sources.find(function (s) { return s.in_transit > 0.000001; });
      if (!source) {
        throw Object.assign(new Error('متاح القسم من إذن الصرف أقل من الكمية المطلوبة — راجع تحويلات القسم أو استلامات الإذن'), {
          code: 'INSUFFICIENT_STOCK', available: Number(onHand.toFixed(3)), requested: Number(item.requested_qty), inventoryId: inventoryId,
        });
      }
      const take = Math.min(need, source.in_transit);
      const unit = String(source.unit || item.unit || '').trim();
      await postInventoryLedgerEntry(client, {
        transactionType: 'transfer_in', inventoryId: inventoryId,
        locationId: transfer.source_location_id, quantityDelta: take,
        unit: unit || undefined, unitCost: Number(source.unit_cost) || 0,
        destinationLocationId: transfer.source_location_id,
        referenceType: 'dispatch_receipt', referenceId: source.dispatch_id, userId: userId,
        idempotencyKey: 'transfer:' + transfer.id + ':receipt:' + inventoryId + ':' + source.dispatch_id,
        reason: 'استلام تلقائي لمخزن القسم — بضاعة إذن صرف ' + source.ref + ' معتمدة ولم تُسجَّل مستلَمة',
        metadata: {
          dispatch_id: source.dispatch_id, transfer_id: transfer.id,
          transfer_number: transfer.transfer_number, auto_receipt_on_transfer: true,
        },
      });
      await markDispatchReceived(client, transfer, source, inventoryId, take, unit);
      source.in_transit = Number((source.in_transit - take).toFixed(6));
      entry.in_transit = Number((entry.in_transit - take).toFixed(6));
      need = Number((need - take).toFixed(6));
    }
  }
}

/** التنفيذ المخزني: خصم من المرسل + إضافة للمستلم — قيدان بمفاتيح idempotency،
 *  ومنع السلبيات بسياسة الموقع (deny).
 *  تكلفة التحويل حين يكون cost_basis=issue_voucher هي تكلفة أذونات الصرف
 *  نفسها (ما وقفت به القسم فعلًا)، لا متوسط المخزون. */
async function executeStockMove(client, transfer, items, userId) {
  let totalValue = 0;
  const meta = transfer.metadata || {};
  const useVoucherCost = String(meta.cost_basis || '') === 'issue_voucher';
  const sourceDept = String(meta.sourceDeptCode || '');
  const destDept = String(meta.destDeptCode || '');
  const ledgerMeta = {
    transfer_id: transfer.id,
    transfer_number: transfer.transfer_number,
    source_dept: sourceDept,
    dest_dept: destDept,
  };
  // بضاعة الأذونات المعتمدة التي لم تُسجَّل مستلَمة تدخل مخزن القسم أولًا،
  // وإلا فشل الخصم على رصيدٍ لا يملكه القسم بعد.
  await receiveInTransitVoucherStock(client, transfer, items, userId);
  for (const item of items) {
    const fresh = (await client.query(
      'SELECT COALESCE("avgCost",0) avg_cost FROM inventory WHERE id=$1', [item.inventory_id])).rows[0];
    const currentCost = Number((fresh && fresh.avg_cost) ? fresh.avg_cost : item.unit_cost) || 0;
    const voucherCost = Number(item.unit_cost) || 0;
    const unitCost = useVoucherCost ? voucherCost : currentCost;
    const qty = Number(item.requested_qty);
    const idOut = 'transfer:' + transfer.id + ':out:' + item.inventory_id;
    const idIn = 'transfer:' + transfer.id + ':in:' + item.inventory_id;
    await postInventoryLedgerEntry(client, {
      transactionType: 'transfer_out', inventoryId: item.inventory_id,
      locationId: transfer.source_location_id, quantityDelta: -qty,
      unit: item.unit || undefined,
      sourceLocationId: transfer.source_location_id, destinationLocationId: transfer.destination_location_id,
      referenceType: 'inventory_transfer', referenceId: transfer.id, userId,
      idempotencyKey: idOut,
      unitCost, reason: 'تحويل بين الأقسام — خصم من القسم المرسل',
      metadata: ledgerMeta,
    });
    await postInventoryLedgerEntry(client, {
      transactionType: 'transfer_in', inventoryId: item.inventory_id,
      locationId: transfer.destination_location_id, quantityDelta: qty,
      unit: item.unit || undefined,
      sourceLocationId: transfer.source_location_id, destinationLocationId: transfer.destination_location_id,
      referenceType: 'inventory_transfer', referenceId: transfer.id, userId,
      idempotencyKey: idIn,
      unitCost, reason: 'تحويل بين الأقسام — إضافة للقسم المستلم',
      metadata: ledgerMeta,
    });
    await client.query(
      'UPDATE inventory_transfer_items SET dispatched_qty=$2, received_qty=$3, unit_cost=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$1',
      [item.id, qty, qty, unitCost]);
    totalValue += qty * unitCost;
  }
  return Number(totalValue.toFixed(4));
}

/** تنسيق YYYY-MM-DD بتوقيت الرياض لقيد المحاسبة — نفس نهج inventory-ledger.js:116. */
function riyadhDayOf(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value ? value : '').slice(0, 10))) {return String(value).slice(0, 10);}
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(value ? value : Date.now()));
}

/** أول يوم في الشهر الحالي بتوقيت الرياض — بداية العمل الفعلي 2026-11-01. */
function monthStartRiyadh() {
  return riyadhDayOf(Date.now()).slice(0, 7) + '-01';
}

/** وقت بداية أهلية أذونات الصرف: أول الشهر الحالي بتوقيت الرياض. */
function monthVoucherStartAtRiyadh() {
  return monthStartRiyadh() + 'T00:00:00+03:00';
}

function isExternalDest(code) {
  return EXTERNAL_DESTS.indexOf(String(code ? code : '').trim().toLowerCase()) !== -1;
}

/** وجهة بيع خارجية بمسارها الرسمي في departments (CAF/NAS/external_sales). */
async function resolveExternalDest(client, raw) {
  const wanted = String(raw ? raw : '').trim();
  const code = wanted || EXTERNAL_SALE_DEPT;
  if (!isExternalDest(code)) {return null;}
  const row = (await client.query(
    'SELECT code, name FROM departments WHERE LOWER(code) = LOWER($1)', [code])).rows[0];
  return row || null;
}

/** معرّف مصروف ثابت لكل (تحويل، اتجاه) — يجعل كتابة القيد idempotent
 *  حتى لو أُعيد الطلب بعد انقطاع الشبكة، بلا اعتماد على notes LIKE. */
function expenseIdFor(transferId, side) {
  const h = crypto.createHash('sha256').update('transfer-expense:' + transferId + ':' + side).digest();
  return Number(BigInt('0x' + h.subarray(0, 6).toString('hex')));
}

/** حالات إذن الصرف التي تعني «صادر فعلًا»: اعتمدها المخزن وخرجت البضاعة
 *  من المخزن الرئيسي. القسم كأنّه مخزن صغير: ما اعتمده له إذنُ صرف هو
 *  بضاعته، حتى لو لم يُسجَّل استلامها بعد في مخزنه (في الطريق إليه). */
const ISSUED_DISPATCH_STATUSES = ['approved', 'received', 'partially_received'];

/** كمية هذا السطر المعتمد من الإذن التي استلمها القسم فعلًا.
 *  صفوف الاستلام في dispatches.receivedItems — نفس مصدر المسار اليدوي،
 *  بالمعرّف أولًا ثم بالاسم بعد التسوية. */
function receivedQtyForSource(receivedItems, approvedItem, inventoryId) {
  if (!Array.isArray(receivedItems) || !receivedItems.length) {return 0;}
  const name = String(approvedItem.name || approvedItem.itemName || '').trim().toLowerCase();
  for (const r of receivedItems) {
    const rid = Number(r.itemId);
    if (Number.isFinite(rid) && rid > 0 && rid === inventoryId) {
      return Math.max(0, Number(r.receivedQty !== undefined ? r.receivedQty : r.qty) || 0);
    }
    const rName = String(r.itemName || r.name || '').trim().toLowerCase();
    if (name && rName === name) {
      return Math.max(0, Number(r.receivedQty !== undefined ? r.receivedQty : r.qty) || 0);
    }
  }
  return 0;
}

/** أساس التحويل: أذونات صرف القسم الصادرة من بداية الشهر الحالي.
 *  لكل صنف: الكمية المصروفة، وقيمتها بالتكلفة الفعلية للإذن، والوحدة التي
 *  صدر بها الإذن (كيلو/كرتونة/علبة/حبة)، وكمية لم تُستلم بعد (in_transit)،
 *  وقائمة أذونات الصرف المصدر بترتيب الإصدار (تخصيص FIFO عند الاستلام
 *  التلقائي). التاريخ يعتمد على وقت اعتماد المخزن الفعلي، لا تاريخ إنشاء
 *  الطلب في `dispatches.date`. */
async function loadMonthVoucherBasis(client, deptCode, inventoryIds) {
  const out = new Map();
  if (inventoryIds && !inventoryIds.length) {return out;}
  const wanted = inventoryIds ? new Set(inventoryIds.map(Number)) : null;
  const rows = (await client.query(
    `SELECT id, date, status, "approvedItems", "receivedItems",
            to_char("warehouseApprovedAt" AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') AS issued_at
       FROM dispatches
      WHERE LOWER("deptCode") = LOWER($1) AND "warehouseApprovedAt" >= $2::timestamptz
        AND status = ANY($3::text[])
      ORDER BY "warehouseApprovedAt" ASC, id ASC`,
    [deptCode, monthVoucherStartAtRiyadh(), ISSUED_DISPATCH_STATUSES])).rows;
  for (const row of rows) {
    const arr = Array.isArray(row.approvedItems) ? row.approvedItems : [];
    const receipts = Array.isArray(row.receivedItems) ? row.receivedItems : [];
    const ref = 'DS-' + String(row.id || '').slice(-8);
    for (const it of arr) {
      const id = Number(it.itemId);
      if (wanted && !wanted.has(id)) {continue;}
      const qty = Number(it.approvedQty) || 0;
      if (!(qty > 0)) {continue;}
      const unitCost = Number(it.avgCost) || 0;
      const approvedValue = Number(it.approvedValue);
      const value = Number.isFinite(approvedValue) && approvedValue > 0 ? approvedValue : qty * unitCost;
      const unit = String(it.unit || '').trim();
      const receivedQty = Math.min(qty, receivedQtyForSource(receipts, it, id));
      const inTransit = Number(Math.max(0, qty - receivedQty).toFixed(6));
      const prev = out.get(id) || { qty: 0, value: 0, in_transit: 0, unit: '', sources: [] };
      prev.qty += qty;
      prev.value += value;
      prev.in_transit = Number((prev.in_transit + inTransit).toFixed(6));
      if (!prev.unit && unit) {prev.unit = unit;}
      prev.sources.push({
        dispatch_id: String(row.id),
        ref: ref,
        date: String(row.date || '').slice(0, 10),
        issued_at: row.issued_at || '',
        status: row.status,
        qty: qty,
        unit: unit,
        item_name: String(it.name || it.itemName || '').trim(),
        unit_cost: unitCost,
        value: Number(value.toFixed(4)),
        received_qty: Number(receivedQty.toFixed(6)),
        in_transit: inTransit,
      });
      out.set(id, prev);
    }
  }
  return out;
}

/** التكلفة الفعلية للإذن (تكلفة الصرف نفسها لا متوسط المخزون) — أساس
 *  تقييم التحويل حتى يحتسب ما يقف القسم به فعلًا. */
function voucherUnitCost(basis) {
  if (!basis || !(basis.qty > 0)) {return 0;}
  return Number((basis.value / basis.qty).toFixed(6));
}

function voucherCostOverrides(basis) {
  const costOverrides = new Map();
  for (const [inventoryId, entry] of basis) {
    costOverrides.set(inventoryId, voucherUnitCost(entry));
  }
  return costOverrides;
}

/** وحدة الصنف كما صدرت في إذن الصرف — توجيه المالك 2026-11-02: «يكون نفس
 *  التصنيف اللي طلعت بيه في إذن الصرف، مثلا كيلو / كرتونة / حبة / علبة».
 *  تُتَّبع في بنود التحويل وقيود الدفتر بدل وحدة الصنف العامة. */
function voucherUnitOverrides(basis) {
  const unitOverrides = new Map();
  for (const [inventoryId, entry] of basis) {
    if (entry.unit) {unitOverrides.set(inventoryId, entry.unit);}
  }
  return unitOverrides;
}

// ═══════════════════════════════════════════════════════════════════
// المصنع — قرار المالك 2026-11-03
// ───────────────────────────────────────────────────────────────────
// قسم مُصنِّع (departments.is_factory) يسلّم إنتاجه لمنافذ البيع الخارجية،
// ويُقيَّم التحويل تلقائيًا بسعر القائمة الحالي (pos_products.price) — بلا
// قائمة أسعار يدوية. الإيراد يُقيَّد للمصنع (4000 دائن بمركزه) ويُحمَّل المنفذ
// (5000 مدين بمركزه)، والتكلفة تبقى على المصنع: لا قيود تكلفة تحويل إطلاقًا.
// ربط صنف المخزون بمنتج القائمة إما pos_products.legacy_inventory_id أو
// تطابق الاسم بعد التسوية العربية. صنف بلا سعر = رفض صريح (لا صفر صامت).
// ═══════════════════════════════════════════════════════════════════

function normalizeMenuName(s) {
  return String(s || '')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '')
    .toLowerCase();
}

async function isFactoryDept(client, deptCode) {
  const row = (await client.query(
    'SELECT COALESCE(is_factory, false) AS f FROM departments WHERE LOWER(code) = LOWER($1)', [deptCode])).rows[0];
  return Boolean(row && row.f);
}

/** لقطة تسعير القائمة لكل صنف: الربط الصريح أولًا ثم تطابق الاسم. أكثر من
 *  سعر مختلف لنفس الصنف = رفض دائمًا (الغموض يُحسم بالربط لا بالتخمين)،
 *  والمفقود يُجمع في missing — يرميه resolveMenuPricing أو يعرضه المستدعي. */
async function menuPricingSnapshot(client, items) {
  const products = (await client.query(
    `SELECT id, name_ar, price, legacy_inventory_id, COALESCE(metadata->>'yara_code','') AS yara_code
       FROM pos_products WHERE COALESCE(is_active, true) AND price > 0`)).rows;
  const byLink = new Map();
  const byName = new Map();
  for (const p of products) {
    if (p.legacy_inventory_id != null) {
      const k = Number(p.legacy_inventory_id);
      if (!byLink.has(k)) {byLink.set(k, []);}
      byLink.get(k).push(p);
    }
    const n = normalizeMenuName(p.name_ar);
    if (n) {
      if (!byName.has(n)) {byName.set(n, []);}
      byName.get(n).push(p);
    }
  }
  const pricing = new Map();
  const missing = [];
  const pick = (cands, invName, inventoryId) => {
    if (!cands || !cands.length) {return null;}
    const prices = new Set(cands.map(function (p) { return Number(p.price); }));
    if (prices.size > 1) {
      throw Object.assign(new Error('أكثر من سعر قائمة للصنف «' + invName + '» — اربطه بمنتج واحد من القائمة'), {
        code: 'FACTORY_PRICE_AMBIGUOUS', inventoryId: inventoryId,
        candidates: cands.map(function (p) { return { product_id: Number(p.id), name_ar: p.name_ar, price: Number(p.price) }; }),
      });
    }
    return cands[0];
  };
  for (const item of items) {
    const inv = (await client.query('SELECT id, name FROM inventory WHERE id=$1', [item.inventory_id])).rows[0];
    const name = inv ? String(inv.name) : '';
    const chosen = pick(byLink.get(Number(item.inventory_id)), name, item.inventory_id)
      || pick(byName.get(normalizeMenuName(name)), name, item.inventory_id);
    if (!chosen) {
      missing.push(name || ('صنف ' + item.inventory_id));
      continue;
    }
    pricing.set(Number(item.inventory_id), {
      menu_product_id: Number(chosen.id),
      menu_name: String(chosen.name_ar),
      price: Number(Number(chosen.price).toFixed(2)),
      yara_code: String(chosen.yara_code || ''),
    });
  }
  return { pricing: pricing, missing: missing };
}

/** سعر القائمة الإلزامي لبنود تحويل المصنع — أي صنف بلا سعر = رفض صريح
 *  (لا يُقيَّم التحويل بصفر صامت). */
async function resolveMenuPricing(client, items) {
  const snap = await menuPricingSnapshot(client, items);
  if (snap.missing.length) {
    throw Object.assign(new Error('أصناف بلا سعر في قائمة البيع: ' + snap.missing.join('، ')
      + ' — اربط كل صنف بمنتج القائمة أولًا'), { code: 'FACTORY_PRICE_MISSING', missing: snap.missing });
  }
  return snap.pricing;
}

/** قيمة تسوية المصنع لكل بند: الكمية × سعر القائمة لحظة التحويل. */
function factoryPricingRows(pricing, items) {
  const rows = [];
  let total = 0;
  for (const item of items) {
    const p = pricing.get(Number(item.inventory_id));
    if (!p) {continue;}
    const qty = Number(item.requested_qty);
    const value = Number((qty * p.price).toFixed(2));
    total += value;
    rows.push({ inventory_id: Number(item.inventory_id), qty: qty, price: p.price, value: value,
      menu_product_id: p.menu_product_id, menu_name: p.menu_name, yara_code: p.yara_code });
  }
  return { rows: rows, total: Number(total.toFixed(2)) };
}

/** معرّفا تسوية المصنع (إيراد للمصنع / تحميل على المنفذ) — ثابتان لكل تحويل
 *  فيجعلان الكتابة idempotent، نفس نمط expenseIdFor. */
function factorySettlementIds(transferId) {
  const h = (prefix) => Number(BigInt('0x' + crypto.createHash('sha256').update(prefix + ':' + transferId).digest().subarray(0, 6).toString('hex')));
  return { revId: h('factory-rev'), expId: h('factory-exp') };
}

/** تسوية المصنع داخل المعاملة: إيراد +قيمة القائمة على قسم المصنع في جدول
 *  الإيرادات (ما يقرأه تحليل التكاليف كإيراد القسم)، وتحميل +نفس القيمة على
 *  المنفذ كمصروف factory_settlement (يظهر في تكاليف التشغيل للمنفذ).
 *  التكلفة لا تُنقل: يبقى استهلاك المواد على المصنع من أذون الصرف. */
async function writeFactorySettlement(client, transfer, settlement, sourceDept, destDept, day) {
  const v = Number(settlement.total);
  if (!(v > 0) || !sourceDept || !destDept) {return 0;}
  const ids = factorySettlementIds(transfer.id);
  const dayText = riyadhDayOf(day);
  const base = 'مصنع — ' + transfer.transfer_number;
  let written = 0;
  const rev = await client.query(
    `INSERT INTO revenues (id, "deptId", source, amount, date, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING`,
    [ids.revId, sourceDept, base, v, dayText, 'تسوية مصنع إلى ' + destDept + ' بسعر القائمة']);
  written += rev.rowCount || 0;
  const exp = await client.query(
    `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
     VALUES ($1,$2,$3,$4,$5,$6,true,'تحويلات','factory_settlement')
     ON CONFLICT (id) DO NOTHING`,
    [ids.expId, destDept, base + ' — وارد مصنع من ' + sourceDept, v, dayText, 'تسوية مصنع بسعر القائمة']);
  written += exp.rowCount || 0;
  return written;
}

/** سطور قيد تسوية المصنع — نقية للاختبار (عقد Phase 3: الافتراضي 4000/5000). */
function buildFactorySettlementLines({ total, sourceDept, destDept, accounts = {} }) {
  const v = Number(total);
  const src = normalizeCostCenterCode(sourceDept);
  const dst = normalizeCostCenterCode(destDept);
  const revenueAcct = accounts.revenue_account || '4000';
  const expenseAcct = accounts.expense_account || '5000';
  return [
    { account_code: revenueAcct, debit: 0, credit: v, memo: 'إيراد مصنع — ' + sourceDept, cost_center_code: src },
    { account_code: expenseAcct, debit: v, credit: 0, memo: 'تحميل منفذ — ' + destDept, cost_center_code: dst },
  ];
}

/** سطور نقل التكلفة بين مركزي القسمين — نقية للاختبار (الافتراضي 5000). */
function buildTransferCostLines({ total, sourceDept, destDept, accounts = {} }) {
  const v = Number(total);
  const src = normalizeCostCenterCode(sourceDept);
  const dst = normalizeCostCenterCode(destDept);
  const costAcct = accounts.cost_account || '5000';
  return [
    { account_code: costAcct, debit: v, credit: 0, memo: 'تكلفة تحويل — القسم المستلم', cost_center_code: dst },
    { account_code: costAcct, debit: 0, credit: v, memo: 'خصم تكلفة — القسم المرسل', cost_center_code: src },
  ];
}

/** قيد تسوية المصنع: 4000 دائن بمركز المصنع (إيراده) / 5000 مدين بمركز
 *  المنفذ (تحميله) بقيمة القائمة — idempotent بمفتاح (factory_settlement, id)
 *  منفصل عن مفتاح تحويل التكلفة فلا يمس القيود القديمة. */
async function postFactoryJournal(transfer, total, sourceDept, destDept, day) {
  const v = Number(total);
  const src = normalizeCostCenterCode(sourceDept);
  const dst = normalizeCostCenterCode(destDept);
  if (!(v > 0) || !src || !dst) {return;}
  try {
    await ensureCostCenters([src, dst]);
    const accounts = await resolveAccounts(pool, 'dept_transfer', 'factory_settlement', {
      revenue_account: '4000',
      expense_account: '5000',
    });
    const memo = 'تسوية مصنع — ' + transfer.transfer_number + ' (' + sourceDept + ' → ' + destDept + ') بسعر القائمة';
    const out = await postJournal(pool, {
      date: riyadhDayOf(day),
      memo: memo,
      source_type: 'factory_settlement',
      source_id: String(transfer.id),
      lines: buildFactorySettlementLines({ total: v, sourceDept, destDept, accounts }),
    });
    logger.info('[LEDGER] factory settlement ' + transfer.transfer_number + ': ' + (out.replay ? 'replayed' : 'entry ' + out.entry.entry_no));
  } catch (e) {
    logger.error('[LEDGER] factory settlement failed ' + transfer.transfer_number + ': ' + e.message);
  }
}


/** ما خرج من القسم بتحويلات هذا الشهر — يُخصم من سقف أذونات القسم.
 *  التصفية بمصدر التحويل (source_dept) لا بالموقع وحده: المخزن المشترك
 *  KITCHEN-MAIN يخدم عدة أقسام، فخصم تحويل الجزار من رصيد المطبخ خطأ. */
async function loadTransferredOutQty(client, locationId, inventoryIds, deptCode) {
  const out = new Map();
  if (!inventoryIds.length) {return out;}
  const rows = (await client.query(
    `SELECT b.inventory_id, COALESCE(SUM(-b.quantity_delta), 0) AS qty
       FROM inventory_ledger b
       LEFT JOIN inventory_transfers t ON t.id::text = b.reference_id
      WHERE b.location_id = $1 AND b.quantity_delta < 0
        AND b.reference_type = 'inventory_transfer'
        AND b.business_date >= $2::date
        AND b.inventory_id = ANY($3::bigint[])
        AND LOWER(COALESCE(b.metadata->>'source_dept', t.metadata->>'sourceDeptCode', '')) = LOWER($4)
      GROUP BY b.inventory_id`,
    [locationId, monthStartRiyadh(), inventoryIds, String(deptCode || '')])).rows;
  for (const r of rows) {out.set(Number(r.inventory_id), Number(r.qty) || 0);}
  return out;
}

/** المتاح للتحويل = سقف إذن الصرف، لا رصيد المخزن (توجيه المالك 2026-11-02:
 *  «أنا بتعامل على إذن الصرف وليس المخزن» و«كل قسم كأنه مخزن صغير»).
 *  البضاعة التي اعتمدها إذن الصرف للقسم هي بضاعته حتى لو لم تُسجَّل مستلَمة
 *  في مخزنه بعد، لذلك تُحسب «لم يُستلم بعد» ضمن المتاح؛ يُستلم تلقائيًا
 *  عند التنفيذ (receiveInTransitVoucherStock). الحدّ المادي يبقى احتياطيًا
 *  لليتامى: نصيب القسم في مخزن مشترك أكله قسمٌ آخر. */
function transferAvailability(entry, alreadyOut, onHand) {
  const headroom = Math.max(0, Number(entry.qty) || 0) - Math.max(0, Number(alreadyOut) || 0);
  const inTransit = Math.max(0, Number(entry.in_transit) || 0);
  const physical = Math.max(0, Number(onHand) || 0) + inTransit;
  return {
    headroom: Number(Math.max(0, headroom).toFixed(6)),
    inTransit: Number(inTransit.toFixed(6)),
    onHand: Number((Math.max(0, Number(onHand) || 0)).toFixed(6)),
    available: Number(Math.min(Math.max(0, headroom), physical).toFixed(6)),
  };
}

/** حارس المصدر: لا يُحوَّل إلا ما اعتمده المخزن فعليًا للقسم منذ بداية
 *  الشهر الحالي — السقف أذنُ الصرف نفسها. الرسالة تحسب للمستخدم من أي حد
 *  جاء المتاح (إذن / في المخزن / لم يُستلم بعد) فلا يفشل «إضافة» بصمت. */
async function assertMonthSourced(client, deptCode, locationId, items) {
  const ids = items.map(function (i) { return Number(i.inventory_id); });
  // Serialize eligibility checks by source location and item so concurrent
  // transfers cannot both spend the same dispatch quantity.
  const balances = await client.query(
    'SELECT inventory_id, COALESCE(on_hand, 0) AS on_hand FROM inventory_location_balances WHERE location_id = $1 AND inventory_id = ANY($2::bigint[]) ORDER BY inventory_id FOR UPDATE',
    [locationId, ids]);
  const [basis, transferredOut] = await Promise.all([
    loadMonthVoucherBasis(client, deptCode, ids),
    loadTransferredOutQty(client, locationId, ids, deptCode),
  ]);
  const onHand = new Map(balances.rows.map(function (r) { return [Number(r.inventory_id), Number(r.on_hand) || 0]; }));
  for (const item of items) {
    const id = Number(item.inventory_id);
    const entry = basis.get(id) || { qty: 0, value: 0, in_transit: 0, unit: '', sources: [] };
    const already = transferredOut.get(id) || 0;
    const room = transferAvailability(entry, already, onHand.get(id) || 0);
    const wanted = Number(item.requested_qty);
    if (!(entry.qty > 0)) {
      throw Object.assign(new Error('الصنف ' + id + ' ليس له إذن صرف مؤهل للتحويل منذ بدء النظام — التحويل من أذونات صرف القسم فقط'), {
        code: 'NOT_FROM_CURRENT_DISPATCH', inventoryId: id,
      });
    }
    if (wanted > room.available + 0.000001) {
      throw Object.assign(new Error('الكمية تتجاوز المتاح من أذونات الصرف — المتاح ' + Number(room.available.toFixed(3))
        + ' (سقف الإذن ' + Number(room.headroom.toFixed(3))
        + ' · في مخزن القسم ' + Number(room.onHand.toFixed(3))
        + ' · لم يُستلم بعد ' + Number(room.inTransit.toFixed(3)) + ')'), {
        code: 'INSUFFICIENT_STOCK', available: Number(room.available.toFixed(3)), requested: wanted, inventoryId: id,
      });
    }
  }
  return basis;
}

/** تحويل التكلفة بين القسمين في دفتر المصروفات (نفس مصدر شاشة تحليل
 *  التكاليف): صادر سالب على المرسل، وارد موجب على المستلم — بلا ازدواج
 *  لأن المعرّف ثابت لكل اتجاه. القيد المحاسبي 5000/5000 يبقى في postJournal. */
async function writeTransferExpenses(client, transfer, totalValue, sourceDept, destDept, day) {
  const v = Number(totalValue);
  if (!(v > 0) || !sourceDept || !destDept) {return 0;}
  const dayText = riyadhDayOf(day);
  const base = 'تحويل مخزون ' + transfer.transfer_number;
  const rows = [
    [expenseIdFor(transfer.id, 'out'), sourceDept, base + ' — صادر إلى ' + destDept, -v,
      dayText, 'transfer:' + transfer.id + ':out'],
    [expenseIdFor(transfer.id, 'in'), destDept, base + ' — وارد من ' + sourceDept, v,
      dayText, 'transfer:' + transfer.id + ':in'],
  ];
  let written = 0;
  for (const r of rows) {
    const res = await client.query(
      `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
       VALUES ($1,$2,$3,$4,$5,$6,true,'تحويلات','inventory_transfer')
       ON CONFLICT (id) DO NOTHING`,
      r);
    written += res.rowCount || 0;
  }
  return written;
}


/** قيد نقل التكلفة بين مركزي القسمين: مدين 5000 مركز المستلم / دائن 5000
 *  مركز المرسل بالتكلفة الفعلية — idempotent بمفتاح (inventory_transfer, id)
 *  مثل postDispatchToLedger، best-effort بعد COMMIT بنمط سلسلة الصرف. */
async function postTransferJournal(transfer, totalValue, sourceDept, destDept, day) {
  const v = Number(totalValue);
  const src = normalizeCostCenterCode(sourceDept);
  const dst = normalizeCostCenterCode(destDept);
  if (!(v > 0) || !src || !dst) {return;}
  try {
    await ensureCostCenters([src, dst]);
    const accounts = await resolveAccounts(pool, 'dept_transfer', 'inventory_transfer', {
      cost_account: '5000',
    });
    const memo = 'تحويل مخزون — ' + transfer.transfer_number + ' (' + sourceDept + ' → ' + destDept + ')';
    const out = await postJournal(pool, {
      date: riyadhDayOf(day),
      memo: memo,
      source_type: 'inventory_transfer',
      source_id: String(transfer.id),
      lines: buildTransferCostLines({ total: v, sourceDept, destDept, accounts }),
    });
    logger.info('[LEDGER] transfer ' + transfer.transfer_number + ': ' + (out.replay ? 'replayed' : 'entry ' + out.entry.entry_no));
  } catch (e) {
    logger.error('[LEDGER] transfer journal failed ' + transfer.transfer_number + ': ' + e.message);
  }
}

// ─── المسارات ────────────────────────────────────────────────────────

/** رصيد مخزن قسم (لاختيار أصناف التحويل من مخزن المرسل).
 *  scope=month — التحويل يسحب من أذونات الصرف المعتمدة فعليًا منذ بداية
 *  الشهر الحالي، لا من كامل المخزون المتراكم. */
router.get('/dept-transfers/stock', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const dept = String(req.query.dept ? req.query.dept : '').trim();
    if (!dept) {return fail(res, 422, 'DEPT_REQUIRED', 'حدد القسم');}
    const scope = String(req.query.scope ? req.query.scope : '');
    const client = await pool.connect();
    try {
      const loc = await ensureDeptLocation(client, dept);
      if (scope === 'month') {
        // المصدر = أذونات الصرف نفسها: كل ما اعتمده المخزن فعليًا للقسم منذ
        // بداية أهليته (approvedItems: itemId/approvedQty/avgCost/approvedValue
        // بتكلفة الإذن الفعلية) — لا كامل رصيد المخزن المتراكم.
        const monthStart = monthStartRiyadh();
        const voucherStartAt = monthVoucherStartAtRiyadh();
        const basis = await loadMonthVoucherBasis(client, dept, null);
        const ids = [...basis.keys()];
        const items = [];
        if (ids.length) {
          const [details, balances, outRows] = await Promise.all([
            client.query(
              'SELECT id, name item_name, unit, COALESCE("avgCost",0) avg_cost FROM inventory WHERE id = ANY($1::bigint[])',
              [ids]
            ),
            client.query(
              'SELECT inventory_id, on_hand FROM inventory_location_balances WHERE location_id = $1 AND inventory_id = ANY($2::bigint[])',
              [loc.id, ids]
            ),
            loadTransferredOutQty(client, loc.id, ids, dept),
          ]);
          const balMap = new Map(balances.rows.map(function (r) { return [Number(r.inventory_id), Number(r.on_hand)]; }));
          for (const d of details.rows) {
            const id = Number(d.id);
            const m = basis.get(id) || { qty: 0, value: 0, in_transit: 0, unit: '', sources: [] };
            const already = outRows.get(id) || 0;
            const room = transferAvailability(m, already, balMap.get(id) || 0);
            const voucherCost = voucherUnitCost(m);
            const voucherUnit = String(m.unit || '').trim();
            items.push({
              inventory_id: id,
              item_name: d.item_name,
              unit: voucherUnit || d.unit,
              voucher_unit: voucherUnit || d.unit,
              item_unit: d.unit,
              avg_cost: m.qty > 0 ? voucherCost : d.avg_cost,
              month_qty: m.qty,
              transferred_qty: already,
              on_hand: room.onHand,
              in_transit: room.inTransit,
              transferable_headroom: room.headroom,
              available: room.available,
              voucher_value: Number(Number(m.value || 0).toFixed(4)),
              vouchers: m.sources.length,
              sources: m.sources,
            });
          }
          items.sort(function (a, b) { return String(a.item_name).localeCompare(String(b.item_name), 'ar'); });
        }
        // المصنع: سعر القائمة لكل صنف مؤهل — يعرضه العميل على البند، والتنفيذ
        // يرفض ما لا سعر له (لا يُقيَّم بصفر صامت).
        let factory = false;
        let menu_pricing = [];
        try {
          factory = await isFactoryDept(client, dept);
          if (factory && items.length) {
            const snap = await menuPricingSnapshot(client, items);
            menu_pricing = items.map(function (it) {
              const p = snap.pricing.get(Number(it.inventory_id));
              return p ? { inventory_id: it.inventory_id, menu_product_id: p.menu_product_id, menu_name: p.menu_name, price: p.price } : null;
            });
          }
        } catch (_) { /* تسعير العرض مساعد — لا يفشل الجلب */ }
        return res.json({
          location: loc,
          scope: 'month',
          source: 'issue_vouchers',
          month_start: monthStart,
          voucher_start_at: voucherStartAt,
          factory: factory,
          basis: 'أذونات صرف صادرة فعليًا إلى القسم منذ ' + voucherStartAt + ' — لا كامل رصيد المخزن',
          availability: 'السقف إذنُ الصرف: المتاح = المعتمد للقسم هذا الشهر ناقص ما حوَّله، وما لم يُسجَّل مستلَمًا بعد يُستلم تلقائيًا في مخزن القسم عند التنفيذ',
          items: items.map(function (it, i) { return Object.assign({}, it, { menu_price: factory ? menu_pricing[i] : null }); }),
        });
      }
      const rows = await client.query(
        'SELECT b.inventory_id, i.name item_name, i.unit, b.on_hand, i."avgCost" avg_cost FROM inventory_location_balances b JOIN inventory i ON i.id = b.inventory_id WHERE b.location_id = $1 AND b.on_hand <> 0 ORDER BY i.name',
        [loc.id]
      );
      res.json({ location: loc, items: rows.rows });
    } finally { client.release(); }
  } catch (e) {
    logger.error('[transfers] stock failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب رصيد مخزن القسم' });
  }
});

/** قائمة التحويلات — استعلامان ساكنان بلا JOIN؛ تجميع البنود في JS،
 *  وأسماء الأقسام يحلها العميل من قائمة الأقسام (metadata فيها الأكواد). */
router.get('/dept-transfers', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head', 'auditor', 'accountant'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 200);
    const rows = await pool.query(
      'SELECT * FROM inventory_transfers ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    const ids = rows.rows.map(function (r) { return r.id; });
    const itemsByTransfer = {};
    if (ids.length) {
      const itemRows = await pool.query(
        'SELECT transfer_id, id, inventory_id, unit, requested_qty, received_qty, variance_qty, unit_cost FROM inventory_transfer_items WHERE transfer_id = ANY($1::uuid[])',
        [ids]
      );
      for (const it of itemRows.rows) {
        const key = String(it.transfer_id);
        if (!itemsByTransfer[key]) {itemsByTransfer[key] = [];}
        itemsByTransfer[key].push(it);
      }
    }
    res.json(rows.rows.map(function (r) {
      return Object.assign({}, r, { items: itemsByTransfer[String(r.id)] || [] });
    }));
  } catch (e) {
    logger.error('[transfers] list failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب قائمة التحويلات' });
  }
});

/** لوحة التحويلات — إجماليات وتوزيعات من نفس جداول التحويل (status=received)
 *  على مدى تاريخي بتوقيت الرياض. القيمة = الكمية المستلمة × التكلفة الفعلية. */
router.get('/dept-transfers/summary', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head', 'auditor', 'accountant'), async (req, res) => {
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const fromRaw = String(req.query.from ? req.query.from : '').slice(0, 10);
  const toRaw = String(req.query.to ? req.query.to : '').slice(0, 10);
  const from = dayRe.test(fromRaw) ? fromRaw : monthStartRiyadh();
  const to = dayRe.test(toRaw) ? toRaw : riyadhDayOf(Date.now());
  // نطاق المسار: كل التحويلات · البيع الخارجي فقط · التحويلات الداخلية فقط
  const mode = String(req.query.mode ? req.query.mode : '').trim().toLowerCase();
  const MODE_CLAUSE = (mode === 'external')
    ? "AND t.metadata->>'mode' = 'external_sale'"
    : (mode === 'internal' ? "AND COALESCE(t.metadata->>'mode', '') <> 'external_sale'" : '');
  const RANGE = `t.status = 'received'
      AND (t.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
      AND COALESCE(t.metadata->>'test', 'false') <> 'true'
      ${MODE_CLAUSE}`;
  const QTY = 'COALESCE(NULLIF(it.received_qty, 0), it.requested_qty)';
  const VAL = QTY + ' * COALESCE(it.unit_cost, 0)';
  // نصوص اللوحة تُجهَّز قبل الاستدعاء: التراكيب ثابتة وMODE_CLAUSE أحد
  // ثلاثة نصوص حرفية، والمدخلات التاريخية تبقى معامَلات $1/$2.
  const SQL_TOTALS = `SELECT COUNT(DISTINCT t.id)::int AS transfers,
          COUNT(it.id)::int AS lines,
          COALESCE(SUM(${QTY}), 0) AS qty,
          COALESCE(SUM(${VAL}), 0) AS value,
          COUNT(DISTINCT NULLIF(t.metadata->>'sourceDeptCode', ''))::int AS sources,
          COUNT(DISTINCT NULLIF(t.metadata->>'destDeptCode', ''))::int AS destinations
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
    WHERE ${RANGE}`;
  const SQL_BY_SOURCE = `SELECT COALESCE(NULLIF(t.metadata->>'sourceDeptCode', ''), '') AS dept_code,
          COUNT(DISTINCT t.id)::int AS transfers,
          COALESCE(SUM(${QTY}), 0) AS qty,
          COALESCE(SUM(${VAL}), 0) AS value
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
    WHERE ${RANGE}
    GROUP BY 1 ORDER BY 4 DESC`;
  const SQL_BY_DEST = `SELECT COALESCE(NULLIF(t.metadata->>'destDeptCode', ''), '') AS dept_code,
          COUNT(DISTINCT t.id)::int AS transfers,
          COALESCE(SUM(${QTY}), 0) AS qty,
          COALESCE(SUM(${VAL}), 0) AS value
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
    WHERE ${RANGE}
    GROUP BY 1 ORDER BY 4 DESC`;
  const SQL_TOP_ITEMS = `SELECT it.inventory_id, COALESCE(i.name, 'صنف #' || it.inventory_id) AS item_name,
          COALESCE(i.unit, it.unit, '') AS unit,
          COALESCE(SUM(${QTY}), 0) AS qty,
          COALESCE(SUM(${VAL}), 0) AS value
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
     LEFT JOIN inventory i ON i.id = it.inventory_id
    WHERE ${RANGE}
    GROUP BY it.inventory_id, i.name, i.unit, it.unit
    ORDER BY 5 DESC LIMIT 12`;
  const SQL_DAILY = `SELECT to_char((t.created_at AT TIME ZONE 'Asia/Riyadh')::date, 'YYYY-MM-DD') AS day,
          COUNT(DISTINCT t.id)::int AS transfers,
          COALESCE(SUM(${VAL}), 0) AS value
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
    WHERE ${RANGE}
    GROUP BY 1 ORDER BY 1`;
  const SQL_RECENT = `SELECT t.id, t.transfer_number, t.created_at,
          COALESCE(t.metadata->>'sourceDeptCode', '') AS source_dept,
          COALESCE(t.metadata->>'destDeptCode', '') AS dest_dept,
          COUNT(it.id)::int AS lines,
          COALESCE(SUM(${VAL}), 0) AS value
     FROM inventory_transfers t
     JOIN inventory_transfer_items it ON it.transfer_id = t.id
    WHERE ${RANGE}
    GROUP BY t.id ORDER BY t.created_at DESC LIMIT 10`;
  try {
    const [totals, bySource, byDest, topItems, daily, recent] = await Promise.all([
      pool.query(SQL_TOTALS, [from, to]),
      pool.query(SQL_BY_SOURCE, [from, to]),
      pool.query(SQL_BY_DEST, [from, to]),
      pool.query(SQL_TOP_ITEMS, [from, to]),
      pool.query(SQL_DAILY, [from, to]),
      pool.query(SQL_RECENT, [from, to]),
    ]);
    const codes = [];
    for (const r of bySource.rows) {if (r.dept_code) {codes.push(r.dept_code);}}
    for (const r of byDest.rows) {if (r.dept_code) {codes.push(r.dept_code);}}
    const names = await lookupDeptNames(codes);
    const withName = (r) => Object.assign({}, r, {
      dept_name: r.dept_code ? (names[String(r.dept_code).toLowerCase()] || r.dept_code) : 'غير محدد',
      value: Number(Number(r.value).toFixed(2)), qty: Number(Number(r.qty).toFixed(3)),
    });
    res.json({
      from: from, to: to,
      mode: mode || 'all',
      totals: Object.assign({}, totals.rows[0], {
        value: Number(Number(totals.rows[0].value).toFixed(2)),
        qty: Number(Number(totals.rows[0].qty).toFixed(3)),
      }),
      bySource: bySource.rows.map(withName),
      byDest: byDest.rows.map(withName),
      topItems: topItems.rows.map(function (r) {
        return Object.assign({}, r, {
          qty: Number(Number(r.qty).toFixed(3)), value: Number(Number(r.value).toFixed(2)),
        });
      }),
      daily: daily.rows.map(function (r) { return Object.assign({}, r, { value: Number(Number(r.value).toFixed(2)) }); }),
      recent: recent.rows.map(function (r) {
        return Object.assign({}, r, {
          value: Number(Number(r.value).toFixed(2)),
          source_name: names[String(r.source_dept).toLowerCase()] || r.source_dept,
          dest_name: names[String(r.dest_dept).toLowerCase()] || r.dest_dept,
        });
      }),
    });
  } catch (e) {
    logger.error('[transfers] summary failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب ملخص التحويلات' });
  }
});

/** ربط أسعار المصنع: أصناف مخزن قسم مُصنِّع (أساس أذون صرف الشهر) مع
 *  منتجات قائمة الكاشير — ربط هوية لا قائمة أسعار (السعر يُقرأ من القائمة
 *  لحظة التنفيذ). الربط عبر pos_products.legacy_inventory_id. */
router.get('/dept-transfers/factory-links', jwtAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const dept = String(req.query.dept ? req.query.dept : '').trim();
    if (!dept) {return fail(res, 422, 'DEPT_REQUIRED', 'حدد القسم');}
    const client = await pool.connect();
    try {
      const basis = await loadMonthVoucherBasis(client, dept, null);
      const ids = [...basis.keys()];
      const rows = [];
      if (ids.length) {
        const [items, links] = await Promise.all([
          client.query('SELECT id, name, unit FROM inventory WHERE id = ANY($1::bigint[])', [ids]),
          client.query('SELECT id, name_ar, price, legacy_inventory_id FROM pos_products ORDER BY name_ar'),
        ]);
        const linkedByInv = new Map();
        for (const p of links.rows) {
          if (p.legacy_inventory_id == null) {continue;}
          const k = Number(p.legacy_inventory_id);
          if (!linkedByInv.has(k)) {linkedByInv.set(k, []);}
          linkedByInv.get(k).push(p);
        }
        for (const it of items.rows) {
          const linked = linkedByInv.get(Number(it.id)) || [];
          rows.push({
            inventory_id: Number(it.id), item_name: it.name, unit: it.unit,
            menu_product_id: linked.length ? Number(linked[0].id) : null,
            menu_name: linked.length ? linked[0].name_ar : null,
            price: linked.length ? Number(linked[0].price) : null,
          });
        }
      }
      res.json({
        dept: dept, factory: await isFactoryDept(client, dept), items: rows,
        menu_products: (await client.query('SELECT id, name_ar, price FROM pos_products WHERE COALESCE(is_active, true) AND price > 0 ORDER BY name_ar')).rows,
      });
    } finally { client.release(); }
  } catch (e) {
    logger.error('[transfers] factory-links failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب روابط أسعار المصنع' });
  }
});

/** ربط/فك صنف مخزن بمنتج قائمة — ربط واحد لكل صنف (فك القديم عند الربط الجديد). */
router.put('/dept-transfers/factory-links', jwtAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const inventoryId = Number(req.body && req.body.inventory_id);
    const rawProduct = (req.body && req.body.product_id) == null ? null : Number(req.body.product_id);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return fail(res, 422, 'INVALID_INVENTORY', 'الصنف غير صحيح');
    }
    if (rawProduct !== null && (!Number.isInteger(rawProduct) || rawProduct <= 0)) {
      return fail(res, 422, 'INVALID_PRODUCT', 'منتج القائمة غير صحيح');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inv = (await client.query('SELECT id, name FROM inventory WHERE id=$1', [inventoryId])).rows[0];
      if (!inv) { await client.query('ROLLBACK'); return fail(res, 404, 'INVENTORY_ITEM_NOT_FOUND', 'الصنف غير موجود'); }
      if (rawProduct === null) {
        await client.query('UPDATE pos_products SET legacy_inventory_id = NULL WHERE legacy_inventory_id = $1', [inventoryId]);
      } else {
        const product = (await client.query('SELECT id, name_ar, price FROM pos_products WHERE id=$1', [rawProduct])).rows[0];
        if (!product) { await client.query('ROLLBACK'); return fail(res, 404, 'PRODUCT_NOT_FOUND', 'منتج القائمة غير موجود'); }
        await client.query('UPDATE pos_products SET legacy_inventory_id = NULL WHERE legacy_inventory_id = $1 AND id <> $2', [inventoryId, rawProduct]);
        await client.query('UPDATE pos_products SET legacy_inventory_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [inventoryId, rawProduct]);
      }
      await client.query('COMMIT');
      res.json({ ok: true, inventory_id: inventoryId, product_id: rawProduct });
    } catch (e) {
      await client.query('ROLLBACK').catch(function () {});
      logger.error('[transfers] factory-link save failed: ' + e.message);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر حفظ ربط سعر المصنع' });
    } finally { client.release(); }
  } catch (e) {
    logger.error('[transfers] factory-link failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر حفظ ربط سعر المصنع' });
  }
});

/** كاشيرات قسم (وأبنائه) من dept_cashier_links — مصدر واحد لربط الإيراد. */
async function deptCashiers(client, deptCode) {
  const rows = (await client.query(
    `WITH RECURSIVE tree AS (
       SELECT code FROM departments WHERE LOWER(code) = LOWER($1)
       UNION ALL
       SELECT d.code FROM departments d JOIN tree t ON LOWER(d.parent_code) = LOWER(t.code)
     )
     SELECT l.cashier_no FROM dept_cashier_links l
      WHERE LOWER(l.dept_code) IN (SELECT LOWER(code) FROM tree)`, [deptCode])).rows;
  return rows.map(function (r) { return String(r.cashier_no).trim(); }).filter(Boolean);
}

/** مبيعات منتجات القائمة الفعلية من مرآة الكاشير (ys_mirror_orders) لشهر —
 *  المطابقة بكود Yara في بنود الفاتورة، محصورة بكاشيرات المنفذ الذي استلم
 *  التحويل (لا كاشيرات المصنع نفسه ولا غيره). القيمة = سعر البند × الكمية
 *  (بدون ضريبة — نفس أساس pos_products.price). */
async function loadMenuSalesForMonth(client, from, to, cashiers, yaraCodes) {
  if (!cashiers.length || !yaraCodes.length) {return new Map();}
  const rows = (await client.query(
    `SELECT it->>'code' AS code,
            COALESCE(SUM((it->>'qty')::numeric), 0) AS qty,
            COALESCE(SUM((it->>'price')::numeric * (it->>'qty')::numeric), 0) AS value
       FROM ys_mirror_orders o, jsonb_array_elements(o.lines) it
      WHERE o.doc_date >= $1::date AND o.doc_date < $2::date
        AND o.cashier_no = ANY($3::text[])
        AND it->>'code' = ANY($4::text[])
      GROUP BY 1`, [from, to, cashiers, yaraCodes])).rows;
  const map = new Map();
  for (const r of rows) { map.set(String(r.code).trim(), { qty: Number(r.qty) || 0, value: Number(r.value) || 0 }); }
  return map;
}

/** صفوف تقرير فرق المصنع لشهر: قيمة التحويل بسعر القائمة لحظة التنفيذ
 *  مقابل مبيعات كل منفذ الفعلية لنفس المنتجات (بكود Yara وبكاشيرات المنفذ
 *  نفسه فقط). التوزيع per-dest محفوظ في by_dest ليُستخدمه القفل بدقة. */
async function factoryVarianceRows(client, month) {
  const from = month + '-01';
  const d = new Date(month + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10);
  const rows = (await client.query(
    `SELECT t.id, t.transfer_number, t.created_at, t.metadata,
            t.metadata->>'sourceDeptCode' AS src, t.metadata->>'destDeptCode' AS dst,
            it.inventory_id, it.requested_qty, it.unit, i.name AS item_name
       FROM inventory_transfers t
       JOIN inventory_transfer_items it ON it.transfer_id = t.id
       LEFT JOIN inventory i ON i.id = it.inventory_id
      WHERE t.status = 'received'
        AND COALESCE(t.metadata->>'factory', 'false') = 'true'
        AND COALESCE(t.metadata->>'test', 'false') <> 'true'
        AND (t.created_at AT TIME ZONE 'Asia/Riyadh')::date >= $1::date
        AND (t.created_at AT TIME ZONE 'Asia/Riyadh')::date < $2::date
      ORDER BY t.created_at`, [from, to])).rows;
  const cashiersByDest = new Map();
  const byFactory = new Map();
  for (const r of rows) {
    const meta = r.metadata || {};
    const fp = Array.isArray(meta.factory_pricing) ? meta.factory_pricing : [];
    const priceRow = fp.find(function (p) { return Number(p.inventory_id) === Number(r.inventory_id); }) || null;
    const src = String(r.src || '');
    const dst = String(r.dst || '');
    if (!byFactory.has(src)) {byFactory.set(src, []);}
    byFactory.get(src).push(Object.assign({}, r, { price_row: priceRow, dest: dst }));
    if (!cashiersByDest.has(dst)) {
      cashiersByDest.set(dst, await deptCashiers(client, dst));
    }
  }
  const factories = [];
  for (const [src, transfers] of byFactory) {
    const codes = new Set();
    const products = new Map();
    for (const t of transfers) {
      const p = t.price_row;
      const key = String(t.inventory_id);
      const entry = products.get(key) || {
        inventory_id: Number(t.inventory_id), item_name: t.item_name, unit: t.unit,
        menu_product_id: p ? Number(p.menu_product_id) : null,
        menu_name: p ? String(p.menu_name) : null,
        yara_code: p ? String(p.yara_code || '') : '',
        price: p ? Number(p.price) : 0,
        transferred_qty: 0, transferred_value: 0, by_dest: {},
      };
      const qty = Number(t.requested_qty) || 0;
      const price = p ? Number(p.price) : 0;
      entry.transferred_qty += qty;
      entry.transferred_value += qty * price;
      if (p && p.yara_code) {codes.add(String(p.yara_code));}
      const dk = t.dest;
      const part = entry.by_dest[dk] || { t_qty: 0, t_value: 0 };
      part.t_qty += qty;
      part.t_value += qty * price;
      entry.by_dest[dk] = part;
      products.set(key, entry);
    }
    // مبيعات كل منفذ بكاشيراته — تبقى منفصلة لكل منفذ للقفل الدقيق
    const salesByDestCode = new Map();
    for (const [dst, cashiers] of cashiersByDest) {
      salesByDestCode.set(dst, await loadMenuSalesForMonth(client, from, to, cashiers, [...codes]));
    }
    const rowsOut = [];
    let tQty = 0, tValue = 0, sQty = 0, sValue = 0, closable = 0;
    for (const entry of products.values()) {
      let soldQty = 0, soldValue = 0;
      for (const [dk, part] of Object.entries(entry.by_dest)) {
        const per = entry.yara_code && salesByDestCode.get(dk) ? (salesByDestCode.get(dk).get(entry.yara_code) || { qty: 0, value: 0 }) : { qty: 0, value: 0 };
        part.s_qty = Number(Number(per.qty).toFixed(3));
        part.s_value = Number(Number(per.value).toFixed(2));
        part.diff = Number((part.s_value - part.t_value).toFixed(2));
        soldQty += part.s_qty;
        soldValue += part.s_value;
      }
      const matchable = Boolean(entry.yara_code);
      entry.transferred_qty = Number(Number(entry.transferred_qty).toFixed(3));
      entry.transferred_value = Number(Number(entry.transferred_value).toFixed(2));
      entry.sold_qty = Number(Number(soldQty).toFixed(3));
      entry.sold_value = Number(Number(soldValue).toFixed(2));
      entry.diff_qty = Number((entry.sold_qty - entry.transferred_qty).toFixed(3));
      entry.diff_value = Number((entry.sold_value - entry.transferred_value).toFixed(2));
      entry.matchable = matchable;
      if (matchable) {closable += entry.diff_value;}
      tQty += entry.transferred_qty; tValue += entry.transferred_value;
      sQty += entry.sold_qty; sValue += entry.sold_value;
      rowsOut.push(entry);
    }
    rowsOut.sort(function (a, b) { return Math.abs(b.diff_value) - Math.abs(a.diff_value); });
    factories.push({
      dept_code: src,
      transfers: transfers.length,
      rows: rowsOut,
      totals: {
        transferred_qty: Number(tQty.toFixed(3)), transferred_value: Number(tValue.toFixed(2)),
        sold_qty: Number(sQty.toFixed(3)), sold_value: Number(sValue.toFixed(2)),
        diff_value: Number((sValue - tValue).toFixed(2)),
        closable_diff_value: Number(closable.toFixed(2)),
      },
    });
  }
  return { from: from, to: to, factories: factories };
}

/** تقرير الفرق الشهري للمصنع: قيمة التسوية بسعر القائمة مقابل مبيعات
 *  المنفذ الفعلية لنفس المنتجات — لا يغيّر شيئًا، يُقرأ فقط. */
router.get('/dept-transfers/factory-variance', jwtAuth, requireRole('admin', 'manager', 'auditor', 'accountant'), async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ? req.query.month : '').trim())
      ? String(req.query.month).trim() : riyadhDayOf(Date.now()).slice(0, 7);
    const data = await factoryVarianceRows(pool, month);
    res.json({ month: month, ...data });
  } catch (e) {
    logger.error('[transfers] factory-variance failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب تقرير فرق المصنع' });
  }
});

/** قفل فرق الشهر لمصنع: يقيّد فرق كل منفذ (المنتجات القابلة للمطابقة بكود
 *  Yara فقط) تعديلًا واحدًا لكل (مصنع، منفذ، شهر): فرق موجب = إيراد إضافي
 *  للمصنع وتحميل إضافي على المنفذ، والسالب عكسه — idempotent بمفتاح الشهر. */
router.post('/dept-transfers/factory-variance/:month/close', jwtAuth, requireRole('admin', 'manager'), async (req, res) => {
  const month = String(req.params.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return fail(res, 422, 'INVALID_MONTH', 'الشهر بصيغة YYYY-MM');
  }
  const deptCode = String(req.body && req.body.deptCode ? req.body.deptCode : '').trim();
  if (!deptCode) {return fail(res, 422, 'DEPT_REQUIRED', 'حدد قسم المصنع');}
  try {
    const data = await factoryVarianceRows(pool, month);
    const factory = data.factories.find(function (f) { return String(f.dept_code).toLowerCase() === deptCode.toLowerCase(); });
    if (!factory) {
      return res.status(404).json({ error: 'FACTORY_NOT_FOUND', message: 'لا تحويلات مصنع لهذا القسم في الشهر المحدد' });
    }
    // دلتا كل منفذ = مجموع فروق منتجاته القابلة للمطابقة
    const perDest = new Map();
    for (const row of factory.rows) {
      if (!row.matchable) {continue;}
      for (const [dst, part] of Object.entries(row.by_dest)) {
        perDest.set(dst, (perDest.get(dst) || 0) + part.diff);
      }
    }
    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const [dst, deltaRaw] of perDest) {
        const delta = Number(deltaRaw.toFixed(2));
        if (Math.abs(delta) < 0.01) {continue;}
        const ids = factorySettlementIds('close:' + deptCode + ':' + dst + ':' + month);
        const base = 'تسوية فرق مصنع ' + month;
        await client.query(
          `INSERT INTO revenues (id, "deptId", source, amount, date, notes)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [ids.revId, deptCode, base, delta, month + '-01', 'فرق مبيعات منفذ ' + dst + ' عن تسوية التحويل']);
        await client.query(
          `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
           VALUES ($1,$2,$3,$4,$5,$6,true,'تحويلات','factory_settlement')
           ON CONFLICT (id) DO NOTHING`,
          [ids.expId, dst, base + ' — فرق عن تحويلات المصنع ' + deptCode, delta, month + '-01', 'قفل فرق المصنع الشهري']);
        results.push({ dest: dst, delta: delta });
      }
      await client.query('COMMIT');
      const posted = results;
      const varianceAccounts = await resolveAccounts(pool, 'dept_transfer', 'factory_variance_close', {
        revenue_account: '4000',
        expense_account: '5000',
      });
      for (const r of posted) {
        const src = normalizeCostCenterCode(deptCode);
        const dstCc = normalizeCostCenterCode(r.dest);
        if (!src || !dstCc) {continue;}
        void (async () => {
          try {
            await ensureCostCenters([src, dstCc]);
            const lines = r.delta > 0
              ? [
                { account_code: varianceAccounts.revenue_account, debit: 0, credit: Math.abs(r.delta), memo: 'فرق مصنع ' + deptCode, cost_center_code: src },
                { account_code: varianceAccounts.expense_account, debit: Math.abs(r.delta), credit: 0, memo: 'فرق منفذ ' + r.dest, cost_center_code: dstCc },
              ]
              : [
                { account_code: varianceAccounts.revenue_account, debit: Math.abs(r.delta), credit: 0, memo: 'عكس فرق مصنع ' + deptCode, cost_center_code: src },
                { account_code: varianceAccounts.expense_account, debit: 0, credit: Math.abs(r.delta), memo: 'عكس فرق منفذ ' + r.dest, cost_center_code: dstCc },
              ];
            await postJournal(pool, {
              date: month + '-01', memo: 'قفل فرق المصنع ' + month + ' — ' + deptCode + ' → ' + r.dest,
              source_type: 'factory_variance_close', source_id: deptCode + ':' + r.dest + ':' + month,
              lines: lines,
            });
          } catch (e) {
            logger.error('[LEDGER] factory variance close failed: ' + e.message);
          }
        })();
      }
      res.json({ ok: true, month: month, dept_code: deptCode, closed: posted, closable_diff_value: factory.totals.closable_diff_value });
    } catch (e) {
      await client.query('ROLLBACK').catch(function () {});
      logger.error('[transfers] factory-variance close failed: ' + e.message);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر قفل فرق المصنع' });
    } finally { client.release(); }
  } catch (e) {
    logger.error('[transfers] factory-variance close failed: ' + e.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر قفل فرق المصنع' });
  }
});

/** المسار A — طلب تحويل بين قسمين (بموافقة الشيف، اكتمال فوري عند الاعتماد). */
router.post('/dept-transfers', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const srcRes = resolveSourceDept(req.user, req.body ? req.body.sourceDeptCode : null);
  if (!srcRes.ok) {return fail(res, 403, srcRes.code, srcRes.message);}
  const destDept = String(req.body && req.body.destDeptCode ? req.body.destDeptCode : '').trim();
  if (!destDept) {return fail(res, 422, 'DEST_DEPT_REQUIRED', 'حدد القسم المستلم');}
  if (deptCodeEquals(destDept, srcRes.deptCode)) {return fail(res, 422, 'SAME_DEPT', 'القسم المرسل والمستلم واحد');}
  if (isExternalDest(destDept)) {
    return fail(res, 422, 'EXTERNAL_SALE_USE_DIRECT', 'منافذ البيع الخارجية مسار مباشر بلا اعتماد — استخدم «تحويل للبيع الخارجي»');
  }
  let items;
  try { items = collectItems(Array.isArray(req.body && req.body.items) ? req.body.items : []); }
  catch (e) { return fail(res, 422, e.code, e.message); }
  const client = await pool.connect();
  let transfer;
  try {
    await client.query('BEGIN');
    const sourceLoc = await ensureDeptLocation(client, srcRes.deptCode);
    const destLoc = await ensureDeptLocation(client, destDept, 'destination');
    const basis = await assertMonthSourced(client, srcRes.deptCode, sourceLoc.id, [...items.entries()].map(function (e) {
      return { inventory_id: e[0], requested_qty: e[1] };
    }));
    const costOverrides = voucherCostOverrides(basis);
    const unitOverrides = voucherUnitOverrides(basis);
    const meta = {
      mode: 'dept_transfer', sourceDeptCode: srcRes.deptCode, destDeptCode: destDept,
      scope: 'month', cost_basis: 'issue_voucher', vouchers: basis.size,
      source_location: sourceLoc.code, dest_location: destLoc.code,
    };
    const metaDb = JSON.stringify(meta);
    const notesDb = (req.body && req.body.notes) ? String(req.body.notes) : null;
    transfer = (await client.query(
      'INSERT INTO inventory_transfers (transfer_number, status, source_location_id, destination_location_id, requested_by, notes, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *',
      [newTransferNumber(), 'requested', sourceLoc.id, destLoc.id, req.user.id, notesDb, metaDb])).rows[0];
    await insertTransferItems(client, transfer.id, items, costOverrides, unitOverrides);
    await writeEvent(client, transfer.id, null, 'requested', req.user.id, 'إنشاء طلب تحويل بين قسمين');
    await client.query('COMMIT');
    res.status(201).json(transfer);
    const names = await lookupDeptNames([srcRes.deptCode, destDept]);
    const fromName = names[String(srcRes.deptCode).toLowerCase()] || srcRes.deptCode;
    const toName = names[String(destDept).toLowerCase()] || destDept;
    void notifyTransferEvent(transfer, 'created_pending_chef', {
      io: req.io, actorUserId: req.user.id, fromName: fromName, toName: toName,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    if (e.code === 'INSUFFICIENT_STOCK' || e.code === 'NOT_FROM_CURRENT_DISPATCH') {
      return fail(res, 409, e.code, e.message, { available: e.available, requested: e.requested, inventoryId: e.inventoryId });
    }
    const soft = ['DEPT_NOT_FOUND', 'INVENTORY_ITEM_NOT_FOUND', 'INVALID_TRANSFER_ITEM', 'INVALID_TRANSFER', 'DEPT_CODE_REQUIRED'];
    res.status(soft.indexOf(e.code) !== -1 ? 422 : 500).json({ error: e.code || 'INTERNAL_ERROR', message: e.message || 'تعذر إنشاء طلب التحويل' });
  } finally { client.release(); }
});

/** المسار B — تحويل لمنافذ البيع الخارجية: تنفيذ مباشر بلا اعتماد.
 *  قرار المالك (2026-11-01): أي قسم (المطبخ، الجزار، الحلواني، الخباز...)
 *  يسلّم بضاعته إلى external_sales · CAF (كافيهshop) · NAS (كافيه ناصر)
 *  مباشرة بلا اعتماد الشيف. المصدر = قسم المستخدم نفسه (resolveSourceDept:
 *  رئيس القسم مُجبر على قسمه، الأدمن/المدير/المخزن يحددون صراحة)، والبضاعة
 *  المسموح تحويلها هي ما دخل القسم بأذونات صرف معتمدة في الشهر الحالي فقط
 *  (assertMonthSourced) — فيُخصم من القسم المرسل ويُحمَّل على الوجهة فعليًا،
 *  مع قيدَي مصروف متقابلين وقيد 5000/5000. */
router.post('/dept-transfers/external', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const srcRes = resolveSourceDept(req.user, req.body ? req.body.sourceDeptCode : null);
  if (!srcRes.ok) {return fail(res, 403, srcRes.code, srcRes.message);}
  const destRaw = String(req.body && req.body.destDeptCode ? req.body.destDeptCode : EXTERNAL_SALE_DEPT).trim();
  if (!isExternalDest(destRaw)) {
    return fail(res, 422, 'INVALID_EXTERNAL_DEST', 'الوجهة يجب أن تكون أحد منافذ البيع الخارجية: external_sales · CAF · NAS');
  }
  if (deptCodeEquals(destRaw, srcRes.deptCode)) {
    return fail(res, 422, 'SAME_DEPT', 'القسم المرسل والوجهة واحد');
  }
  let items;
  try { items = collectItems(Array.isArray(req.body && req.body.items) ? req.body.items : []); }
  catch (e) { return fail(res, 422, e.code, e.message); }
  const client = await pool.connect();
  let transfer;
  let destDept;
  try {
    await client.query('BEGIN');
    const destRow = await resolveExternalDest(client, destRaw);
    if (!destRow) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'DEST_DEPT_NOT_FOUND', 'وجهة البيع الخارجية ' + destRaw + ' غير معرّفة في الأقسام');
    }
    destDept = String(destRow.code);
    // مخزن المصدر = حيث تقف بضاعته فعليًا (مستلمة أذونات صرفه)،
    // ومخزن الوجهة = مخزنها المخصص (البيع الخارجي STORE-EXTERNAL،
    // والكافيهات مخازن مستقلة) — مصدر واحد للحقيقة في dept-stores.js.
    const sourceLoc = await ensureDeptLocation(client, srcRes.deptCode);
    const destLoc = await ensureDeptLocation(client, destDept, 'destination');
    // حارس المصدر: أذونات الصرف المعتمدة بعد بدء الأهلية + عدم تكرار
    // التحويل — السقف إذنُ الصرف نفسه لا رصيد المخزن.
    const basis = await assertMonthSourced(client, srcRes.deptCode, sourceLoc.id, [...items.entries()].map(function (e) {
      return { inventory_id: e[0], requested_qty: e[1] };
    }));
    // تكلفة التحويل = تكلفة أذونات الصرف نفسها (ما وقفت به القسم فعلًا)،
    // ووحدة البند = وحدة الإذن الذي خرجت به البضاعة.
    const costOverrides = voucherCostOverrides(basis);
    const unitOverrides = voucherUnitOverrides(basis);
    // المصنع: القيمة المالية للتحويل = سعر القائمة (يُقرأ الآن تلقائيًا)،
    // والتكلفة تبقى على المصنع — قيود التكلفة لا تُكتب إطلاقًا لهذا المسار.
    const itemShape = [...items.entries()].map(function (e) { return { inventory_id: e[0], requested_qty: e[1] }; });
    const factory = await isFactoryDept(client, srcRes.deptCode);
    let factoryPricing = null;
    let settlement = null;
    if (factory) {
      factoryPricing = await resolveMenuPricing(client, itemShape);
      settlement = factoryPricingRows(factoryPricing, itemShape);
    }
    const meta = {
      mode: 'external_sale', sourceDeptCode: srcRes.deptCode, destDeptCode: destDept,
      scope: 'month', cost_basis: 'issue_voucher',
      source_location: sourceLoc.code, dest_location: destLoc.code,
      vouchers: basis.size,
    };
    if (factory) {
      meta.factory = true;
      meta.pricing_basis = 'menu_price';
      meta.factory_total_value = settlement.total;
      meta.factory_pricing = settlement.rows;
    }
    const metaDb = JSON.stringify(meta);
    const notesDefault = 'تحويل بيع خارجي مباشر — ' + destDept;
    const notesDb = (req.body && req.body.notes) ? String(req.body.notes) : notesDefault;
    transfer = (await client.query(
      'INSERT INTO inventory_transfers (transfer_number, status, source_location_id, destination_location_id, requested_by, approved_by, approved_at, notes, metadata) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,$7,$8::jsonb) RETURNING *',
      [newTransferNumber(), 'received', sourceLoc.id, destLoc.id, req.user.id, req.user.id, notesDb, metaDb])).rows[0];
    await insertTransferItems(client, transfer.id, items, costOverrides, unitOverrides);
    const saved = (await client.query(
      'SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 ORDER BY id', [transfer.id])).rows;
    const totalValue = await executeStockMove(client, transfer, saved, req.user.id);
    if (factory) {
      // تسوية المصنع بسعر القائمة داخل نفس المعاملة: إيراد للمصنع + تحميل
      // على المنفذ — ولا قيود تكلفة (التكلفة تبقى على المصنع).
      await writeFactorySettlement(client, transfer, settlement, srcRes.deptCode, destDept, transfer.created_at);
    } else {
      // نقل التكلفة في دفتر المصروفات داخل نفس المعاملة (صادر سالب/وارد موجب)
      await writeTransferExpenses(client, transfer, totalValue, srcRes.deptCode, destDept, transfer.created_at);
    }
    await writeEvent(client, transfer.id, null, STATUS_DONE, req.user.id,
      factory ? 'تحويل مصنع لمنفذ بيع خارجي — تسوية بسعر القائمة' : 'تحويل بيع خارجي — تنفيذ مباشر بلا اعتماد');
    await client.query('COMMIT');
    res.status(201).json(Object.assign({}, transfer, {
      total_value: totalValue,
      factory_total_value: factory ? settlement.total : undefined,
      factory_pricing: factory ? settlement.rows : undefined,
    }));
    const names = await lookupDeptNames([srcRes.deptCode, destDept]);
    const fromName = names[String(srcRes.deptCode).toLowerCase()] || srcRes.deptCode;
    if (factory) {
      void postFactoryJournal(transfer, settlement.total, srcRes.deptCode, destDept, transfer.created_at);
    } else {
      void postTransferJournal(transfer, totalValue, srcRes.deptCode, destDept, transfer.created_at);
    }
    void notifyTransferEvent(transfer, 'external_sale', {
      io: req.io, actorUserId: req.user.id, fromName: fromName, toName: names[String(destDept).toLowerCase()] || destDept,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    if (e.code === 'INSUFFICIENT_STOCK' || e.code === 'NOT_FROM_CURRENT_DISPATCH') {
      return fail(res, 409, e.code, e.message, { available: e.available, requested: e.requested, inventoryId: e.inventoryId });
    }
    const soft = ['DEPT_NOT_FOUND', 'INVENTORY_ITEM_NOT_FOUND', 'INVALID_TRANSFER_ITEM', 'INVALID_TRANSFER', 'DEPT_CODE_REQUIRED',
      'FACTORY_PRICE_MISSING', 'FACTORY_PRICE_AMBIGUOUS'];
    res.status(soft.indexOf(e.code) !== -1 ? 422 : 500).json({ error: e.code || 'INTERNAL_ERROR', message: e.message || 'تعذر تنفيذ تحويل البيع الخارجي' });
  } finally { client.release(); }
});

/** الاعتماد = التنفيذ الفوري: خصم من المرسل + إضافة للمستلم في معاملة واحدة
 *  + قيد محاسبي + إشعارات. لا يعتمد أحدُ طلبه بنفسه (SELF_APPROVAL). */
router.post('/dept-transfers/:id/approve', jwtAuth, requireRole(...APPROVE_ROLES), async (req, res) => {
  const client = await pool.connect();
  let transfer;
  let totalValue;
  let sourceDept;
  let destDept;
  try {
    await client.query('BEGIN');
    transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (transfer.status !== 'requested') { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'التحويل ليس في انتظار الاعتماد'); }
    if (Number(transfer.requested_by) === Number(req.user.id)) { await client.query('ROLLBACK'); return fail(res, 409, 'SELF_APPROVAL', 'لا يعتمد أحد طلبه بنفسه'); }
    const items = (await client.query('SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 ORDER BY id FOR UPDATE', [transfer.id])).rows;
    sourceDept = transfer.metadata && transfer.metadata.sourceDeptCode ? String(transfer.metadata.sourceDeptCode) : '';
    destDept = transfer.metadata && transfer.metadata.destDeptCode ? String(transfer.metadata.destDeptCode) : '';
    if (transfer.metadata && transfer.metadata.mode === 'dept_transfer') {
      await assertMonthSourced(client, sourceDept, transfer.source_location_id, items.map(function (item) {
        return { inventory_id: item.inventory_id, requested_qty: item.requested_qty };
      }));
    }
    totalValue = await executeStockMove(client, transfer, items, req.user.id);
    // نقل التكلفة في دفتر المصروفات — نفس معاملة التنفيذ المخزني
    await writeTransferExpenses(client, transfer, totalValue, sourceDept, destDept, transfer.created_at);
    const metaDb = JSON.stringify({ completed_mode: 'chef_instant' });
    await client.query(
      'UPDATE inventory_transfers SET status=$2, approved_by=$3, approved_at=CURRENT_TIMESTAMP, metadata = metadata || $4::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=$1',
      [transfer.id, 'received', req.user.id, metaDb]);
    await writeEvent(client, transfer.id, transfer.status, STATUS_DONE, req.user.id, 'اعتماد الشيف وتنفيذ فوري');
    await client.query('COMMIT');
    const fresh = Object.assign({}, transfer, { status: STATUS_DONE });
    res.json({ transfer_id: transfer.id, status: STATUS_DONE, total_value: totalValue });
    void postTransferJournal(fresh, totalValue, sourceDept, destDept, transfer.business_date);
    const names = await lookupDeptNames([sourceDept, destDept].filter(Boolean));
    const fromName = sourceDept ? (names[sourceDept.toLowerCase()] || sourceDept) : null;
    const toName = destDept ? (names[destDept.toLowerCase()] || destDept) : null;
    void notifyTransferEvent(fresh, 'approved', {
      io: req.io, actorUserId: req.user.id, toDeptCode: destDept, fromName: fromName, toName: toName,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    if (e.code === 'INSUFFICIENT_STOCK' || e.code === 'NOT_FROM_CURRENT_DISPATCH') {
      const availText = e.available !== undefined ? String(e.available) : '0';
      return fail(res, 409, e.code, e.message || ('الرصيد/الكمية المؤهلة غير كافية — المتاح ' + availText), {
        available: e.available, requested: e.requested, inventoryId: e.inventoryId,
      });
    }
    res.status(500).json({ error: e.code || 'INTERNAL_ERROR', message: e.message || 'تعذر اعتماد التحويل' });
  } finally { client.release(); }
});

router.post('/dept-transfers/:id/reject', jwtAuth, requireRole(...APPROVE_ROLES), async (req, res) => {
  const client = await pool.connect();
  let transfer;
  try {
    await client.query('BEGIN');
    transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (transfer.status !== 'requested') { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'التحويل ليس في انتظار الاعتماد'); }
    const reason = String(req.body && req.body.reason ? req.body.reason : '').trim();
    if (reason.length < 3) { await client.query('ROLLBACK'); return fail(res, 422, 'REASON_REQUIRED', 'اكتب سبب الرفض'); }
    const reasonDb = reason;
    const rejectedBy = req.user.id;
    const metaDb = JSON.stringify({ rejection_reason: reasonDb, rejected_by: rejectedBy });
    await client.query(
      'UPDATE inventory_transfers SET status=$2, metadata = metadata || $3::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=$1',
      [transfer.id, 'rejected', metaDb]);
    await writeEvent(client, transfer.id, transfer.status, 'rejected', req.user.id, reasonDb);
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: 'rejected' });
    const sourceDept = transfer.metadata && transfer.metadata.sourceDeptCode ? String(transfer.metadata.sourceDeptCode) : '';
    const destDept = transfer.metadata && transfer.metadata.destDeptCode ? String(transfer.metadata.destDeptCode) : '';
    const names = await lookupDeptNames([sourceDept, destDept].filter(Boolean));
    void notifyTransferEvent(transfer, 'rejected', {
      io: req.io, actorUserId: req.user.id, reason: reasonDb,
      fromName: sourceDept ? (names[sourceDept.toLowerCase()] || sourceDept) : null,
      toName: destDept ? (names[destDept.toLowerCase()] || destDept) : null,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    res.status(500).json({ error: e.code || 'INTERNAL_ERROR', message: 'تعذر رفض التحويل' });
  } finally { client.release(); }
});

router.post('/dept-transfers/:id/cancel', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (transfer.status !== 'requested') { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'لا يمكن إلغاء تحويل منفَّذ — استخدم الرفض قبل الاعتماد'); }
    const isOwner = Number(transfer.requested_by) === Number(req.user.id);
    const roleText = String(req.user.role).toLowerCase();
    const isManager = roleText === 'admin' || roleText === 'manager';
    if (!isOwner && !isManager) { await client.query('ROLLBACK'); return fail(res, 403, 'CANCEL_FORBIDDEN', 'الإلغاء لمقدم الطلب أو الإدارة فقط'); }
    await client.query(
      'UPDATE inventory_transfers SET status=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1',
      [transfer.id, 'cancelled']);
    await writeEvent(client, transfer.id, transfer.status, 'cancelled', req.user.id, 'إلغاء طلب التحويل');
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: 'cancelled' });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    res.status(500).json({ error: e.code || 'INTERNAL_ERROR', message: 'تعذر إلغاء التحويل' });
  } finally { client.release(); }
});

module.exports = { router, buildFactorySettlementLines, buildTransferCostLines };
