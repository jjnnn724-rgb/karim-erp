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
(33 → 34) — كان ناقصًا رغم أن قيده يُرحَّل فعليًا. ملفا `_down` يحذفان بشرط
مطابقة القيمة المبذورة فقط (لا يمحوان قرارًا إداريًا لاحقًا).

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
- `eslint` على الملفات الملموسة: نظيف. `security-gate`: لا إصابة في ملفاتي
  (الأحمر الوحيد `frontend/app/js/v2/screens/zkteco.js:531` — جلسة أخرى).

## المتبقي في Phase 3 (دفعات تالية)
- صرف/إرجاع المخزون `buildStockMoveLines` (5000/1200) ومسارات التحويل المصنع→المنفذ.
- إقرار VAT `tax.vat_return` (2100/1150) — يحتاج أولًا قرار سياسة تصفية 1150.
- تدفق نقدي وملخص CFO والتسوية البنكية (قراءة فقط؛ لا قيود تُنشأ منها).
- `136` (void-only) ما زالت موقوفة بانتظار تحويل مسارات purge الثلاثة.

## حالة الإنتاج
134/135/139 لم تُطبَّق على `karim_erp` (قياس 2026-11-06: `account_mapping` غير
موجود على قاعدة الإنتاج). كل المسارات تعمل بالثوابت كما هي اليوم. التطبيق
يحتاج أمر المالك الحرفي + نسخة احتياطية حديثة (أحدث نسخة 2026-11-06 03:01).
