# 14. PHASE3_INTEGRATION.md — ربط الوحدات بالخريطة (2026-11-06)

## النطاق المنفَّذ في هذه الدفعة
سبع نقاط ترحيل كانت تقرأ حساباتها كثوابت inline، صارت تقرؤها من `account_mapping`
عبر محرك واحد — **وبنفس السطور حرفيًا** لأن الافتراضي الممرَّر إلى المحرك هو الثابت
القديم نفسه. لا تغيير سلوكي قبل أن يضبط المالك الخريطة.

| الوحدة | العملية | الأدوار | الموقع |
|---|---|---|---|
| بيع POS | `sales_pos.pos_sale` | cash/bank/revenue/vat_output/cogs/inventory | `accounting-routes.js` postSaleToLedger |
| إلغاء بيع | `sales_pos.void` | نفس الستة | `pos-orders-history.js` + `pos-void-lines.js` |
| فاتورة شراء | `purchases.purchase_invoice` | inventory/vat_input/payable | `accounting-routes.js` postPurchaseToLedger |
| رصيد افتتاحي | `purchases.purchase_opening` | inventory/equity | `accounting-routes.js` postOpeningToLedger |
| دفعة مورد | `procurement.supplier_payment` | payable/cash/bank | `procurement-routes.js` POST /payments |
| رواتب | `payroll.payroll_run` | expense/payable | `accounting-routes.js` POST /post-payroll |
| جسر YaraSoft | `yarasoft.gl_bridge` + `yarasoft.prebooks` | cash/revenue · cash/equity | `yarasoft/gl-bridge.js` |
| صرف/إرجاع مخزون | `inventory.stock_dispatch` + `inventory.stock_return` | cogs/inventory | `accounting-routes.js` + `buildStockMoveLines` |
| تحويلات المصنع→المنفذ | `dept_transfer.factory_settlement` + `inventory_transfer` + `factory_variance_close` | revenue/expense · cost | `dept-transfer-routes.js` |
| إهلاك (Phase 2) | `assets.depreciation_run` | expense/accumulated | `accounting-growth.js` |

## المحرك
`backend/coa-mapping.js` → `resolveAccounts(db, module, operation, defaults)`:
- استعلام **واحد** لكل قيد (`role = ANY($3::text[])`) لا ست قراءات.
- أي دور غائب/معطّل يبقى على افتراضيه؛ 42P01/42703 ⇒ صمت كامل (134 غير مطبقة)؛
  أي خطأ آخر ⇒ تحذير واحد ومتابعة بالثوابت. لا يكسر بيعًا ولا ترحيلًا أبدًا.
- `getMappedAccount` بقي كما هو للمسارات التي تحتاج دورًا واحدًا.

## اكتمال الخريطة
`134` بذرت 25 صفًا من الثوابت. الوحدات أعلاه تحتاج أدوارًا لم تكن مبذورة
(المخزون المقابل لـ COGS، رأس المال الافتتاحي، دفعات الموردين) ⇒
`139_coa_mapping_phase3.sql` يضيف 8 صفوف `ON CONFLICT DO NOTHING` (25 → 33)،
و`140_coa_mapping_yarasoft.sql` يضيف دور نقدية الافتتاحي `yarasoft.prebooks.cash_account`
(33 → 34) — كان ناقصًا رغم أن قيده يُرحَّل فعليًا. و`141_coa_mapping_stock_transfer.sql`
يضيف 9 أدوار للصرف/الإرجاع والتحويلات (34 → 43) بأسماء العمليات = `source_type` الفعلي
حتى تُقرأ مباشرة عند التشخيص. ملفا `_down` يحذفان بشرط مطابقة القيمة المبذورة فقط.

## التحقق الفعلي (evidence)
- `jest` على `karim_erp_test`: **95** اختبارًا (Phase 3 + Phase 2 + stock-ledger +
  void integrity + foundation + cfo + void-repost + dept-transfer) ✅
  و**158** اختبارًا على مسارات البيع/المشتريات/الطلبات/الوكيل ✅ — 253/253.
- جسر يارسوفت: **41** اختبارًا (عقد جديد + الجسر الأصلي + حُرّاس الإرسال
  واليوم الرياضي) ✅، منها إثبات أن الخريطة تغيّر الحسابين فعليًا، وأن
  `replay` لا يقرأ الخريطة أصلًا (لا استعلام إضافي على مسار الرفض).
- حي على `karim_erp_test` (قراءة): `resolveAccounts` أعاد 5 أدوار مبذورة
  (1000/1010/4000/2100/5000) من الجدول فعليًا، وأبقى `inventory_account` على
  افتراضيه لأنه غير مبذور ثم — دليل أن القراءة والـfallback يعملان معًا.
- هجرة 139 داخل معاملة ثم `ROLLBACK`: 25 → 33 → 25 والصفوف ترجع 25. لا أثر دائم.
- هجرة 139 + 140 معًا داخل معاملة: 25 → 34 → 25؛ `prebooks` قبل البذر أعاد
  الافتراضي الممرَّر، وبعده `1000/3100`، و`gl_bridge` أعاد `1000/4000` من الجدول.
- مخزون/تحويلات: **82** اختبارًا (جديد + stock-ledger + dept-transfer-factory
  الحي + centers + v2-cost-center + dispatch-guards) ✅، منها إثبات أن الخريطة
  تغيّر الحسابين مع بقاء مراكز التكلفة، وأن `factory_settlement` الحي ما زال
  4000/5000. هجرة 141 داخل معاملة: 25 → 43 → 34 → 25 بالرجوع الكامل؛
  `factory_settlement` قبل البذر أعاد الافتراضيين، وبعده `4000/5000`،
  و`stock_dispatch` أعاد `5000/1200` من الجدول.
- `eslint` على الملفات الملموسة: نظيف. `security-gate`: لا إصابة في ملفاتي
  (الأحمر الوحيد `frontend/app/js/v2/screens/zkteco.js:531` — جلسة أخرى).

## المتبقي في Phase 3 (دفعات تالية)
- إقرار VAT `tax.vat_return` (2100/1150) — يحتاج أولًا قرار سياسة تصفية 1150.
- تدفق نقدي وملخص CFO والتسوية البنكية (قراءة فقط؛ لا قيود تُنشأ منها).
- `136` (void-only) ما زالت موقوفة بانتظار تحويل مسارات purge الثلاثة.

## حالة الإنتاج
134/135/139/140/141 لم تُطبَّق على `karim_erp` (قياس 2026-11-06: `account_mapping` غير
موجود على قاعدة الإنتاج). كل المسارات تعمل بالثوابت كما هي اليوم. التطبيق
يحتاج أمر المالك الحرفي + نسخة احتياطية حديثة (أحدث نسخة 2026-11-06 03:01).
