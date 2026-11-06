# 20. HARD_DELETE_FULL_MAP.md — القائمة الكاملة لمواقع الحذف الصلب (2026-11-05 — grep شامل)

## المنهج
grep على `backend/**` و`warehouse/**` عن أنماط:
`DELETE FROM journal_entries|journal_lines|supplier_payments|purchaseInvoices|inventoryTx|inventory_ledger|inventory_relations|expenses`

## النتائج الحية (14 موقعًا)

| # | الموقع | الكيان | المثال | السيية |
|---|---|---|---|---|
| 1 | `backend/server.js:1142-1143` | `journal_*` (مصروف) — عبر `purgeExpenseJournal(expenseId)` | `source_type='expense' AND source_id=$1` — حذف السطور والقيد | **حذف مباشر على قيود منشورة** — No protected |
| 2 | `backend/server.js:2657` | `journal_entries` (صرف dispatch) | `source_type='dispatch' AND source_id=$1` ضمن `purgeDispatchRelated` (force-delete admin) | cascade محرر يدوي — يشمل inventory_ledger و"inventoryTx" و"expenses" كمورد تاريخي |
| 3 | `backend/server.js:2680` (`DELETE /api/:entity/:id`) | أي كيان | `DELETE FROM "${entity}" WHERE id=$1 RETURNING *` + `purgeExpenseJournal` لـ expenses + `purgeDispatchRelated` لصرف مضيف | واجهة CRUD العامة — **نتائج الحماية جزئية** فقط (انظر فجوة الحماية) |
| 4 | `backend/procurement-routes.js:849` | `supplier_payments` | الدفعة نفسها بـ `DELETE FROM supplier_payments WHERE id=$1` | لا إعادة حساب لـ paid |
| 5 | `backend/procurement-routes.js:868-869` | `journal_*` (supplier_payment) | `DELETE ... source_type='supplier_payment' AND source_id=$1` | قيد الدفعة المنشورة تُمحى |
| 6 | `backend/warehouse/purchase-void-routes.js:182` | `supplier_payments` (دفعات آلية) | `DELETE ... id = ANY($1)` ضمن void فاتورة | cascade `void` الفاتورة |
| 7 | `backend/warehouse/purchase-void-routes.js:184-189` | `journal_*` (supplier_payment) | `DELETE ... source_type='supplier_payment' AND source_id = ANY(x)` | قيد الدفعة المنشورة تُمحى |
| 8 | `backend/warehouse/purchase-void-routes.js:252` | `purchaseInvoices` | `DELETE ... WHERE id = $1` بعد void قيد فاتورة الشراء | الفاتورة نفسها تُمحى — يتأثر الدليل الاسري |
| 9 | `backend/warehouse/purchase-void-routes.js:415-418` | `inventory_ledger` | `DELETE ... reference_type IN ('purchase_invoice','purchase_invoice_void')` مع إعادة حساب الأرصدة بالأعمال | CASCADE يدوي محرر — قد يُبتز سكينّة تاريخية |
| 10 | `backend/warehouse/purchase-void-routes.js:437` | `purchaseInvoices` (clear-all) | `DELETE ... WHERE id = ANY(x) RETURNING id` | admin حذف كل الفواتير + void القيود — فوري — دليل تاريخي |
| 11 | `backend/server.js:2784-2786` (force inventory) | `inventory_location_balances` + `inventory_ledger` + `inventoryTx` | `DELETE ... inventory_id=$1` | تاريخي فيزيائي يُضيع الآليات |
| 12 | `backend/server.js:2659-2672` (cascade) | `inventory_ledger` + `inventoryTx` + `expenses` + `dispatch_workflow_events` + `notifications` | حسب DIS-$\| ابن | تاريخ مرتبط بالإذن |
| 13 | **admin_delete_audit force-delete** (`backend/server.js:2640-2645`) | **audit trail للحذف** | `INSERT INTO admin_delete_audit` مع مراقبة cascade | **آلية تدقيق لحذف الأدمن** — لا يعوّض عن الحذف نفسه من منظور ledger |
| 14 | `_quarantine_*` و`tests/*` | نسخ quarantine/اختبارات | grep رد | لا انطباق على الإنتاج |

## الفجوة الحقيقية (اكتشاف من هذه الجولة)
```
PROTECTED_DELETE_ENTITIES = [
  'inventoryTx',
  'kitchenReturns',
  'purchaseInvoices',   // ← محمية الآن
  'payroll_runs'
]
```
- **`journal_entries/journal_lines`:** لا حماية في قائمة الـ `protected` — ومع `force=1` can delete through `DELETE /api/{entity}` بإدارة.
- **`supplier_payments`:** لا حماية.
- **`expenses`:** لا حماية.
- **`dispatches`:** لا حماية.
- **`supplier_payments`:** لا حماية.
- `purchaseInvoices`: محمية في القائمة (لا حذف عام) لكن **حذف خاص** من قبل مسارين في `purchase-void-routes` (`/void` و`/clear-all`) — القيد الأصلي void موثّق لكن الفاتورة نفسها تُمحى.

يعني أن **القيد 136 لا بحاجة لأضافة عناصر إلى protected list** — لكن الاعتماد على الحماية العامة فعليًا لا تُحقق الأمان: الـ `DELETE /api/:entity/:id` يعني delete لأي مفتاح بلا اعتماد مضمّن في مساراته الخاصة.

## التحديث على `PURGE_CONVERSION_PLAN.md`
يُ اضاف الموقع الأولوي بالإضافة لموقع 3 (المسار العام) والموقع 9 (inventory_ledger) بحانب الموقع 10 (clear-all).

## المستهلكون
موقع 9 وحده قد يكون لديهم اجراء نِهائيا لإلغاء فواتير — لا يزال idempotent خلال `/void` و`/clear-all` عمومًا.
موقع 3: يخدم AV?(customer/front) — لا يُستدعي واجهة على المفتاح المحترم، لا صلة Direct — يمكن الحذف فقط بـ force.
