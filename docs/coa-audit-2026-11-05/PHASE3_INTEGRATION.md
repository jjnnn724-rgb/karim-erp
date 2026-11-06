# 14. PHASE3_INTEGRATION.md — ربط الوحدات بالخريطة (2026-11-06)

## النطاق المنفَّذ في هذه الدفعة
نقاط الترحيل التي كانت تقرأ حساباتها كثوابت inline صارت تقرؤها من `account_mapping`
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
| إقرار VAT وتصفيته | `tax.vat_return` | payable/recoverable | `accounting-routes.js` GET /vat-return + POST /vat-settlement |

## المحرك
`backend/coa-mapping.js` → `resolveAccounts(db, module, operation, defaults)`:
- استعلام **واحد** لكل قيد (`role = ANY($3::text[])`) لا ست قراءات.
- أي دور غائب/معطّل يبقى على افتراضيه؛ 42P01/42703 ⇒ صمت كامل (134 غير مطبقة)؛
  أي خطأ آخر ⇒ تحذير واحد ومتابعة بالثوابت. لا يكسر بيعًا ولا ترحيلًا أبدًا.
- `getMappedAccount` بقي كما هو للمسارات التي تحتاج دورًا واحدًا.

## سياسة تصفية 1150 (2026-11-06)
قبلها كان رصيد ضريبة المدخلات يتراكم بلا إقفال. القرار: تصفية شهرية على أساس
**الأرصدة المرحّلة** حتى نهاية الشهر (لا حركة الشهر):
- الإطفاء = `min(رصيد 2100 الدائن، رصيد 1150 المدين)` ⇒ قيد واحد Dr 2100 / Cr 1150.
- صافي المستحق يبقى رصيدًا على 2100 (يُسدَّد بقيد Dr 2100 / Cr بنك يدويًا)،
  ورصيد الترحيل يبقى على 1150 — لا يُنشئ المسار سطرًا لأي منهما.
- التقرير GET `/vat-return` قراءة فقط؛ التصفية POST `/vat-settlement`:
  `preview` افتراضيًا، والترحيل بـ`apply:true` فقط، ومفتاح ثابت
  `(vat_settlement, month)`؛ الإعادة 409 `LEDGER_DUPLICATE`، والفترة المقفلة 423،
  والشهر الجاري 422 `LEDGER_VAT_PERIOD_OPEN`، وبلا أرصدة `nothing_to_clear`.
- لا هجرة جديدة: `134` تبذر دورَي `tax.vat_return` أصلًا (2100/1150).

## حراس `account_mapping` (142_account_mapping_guardrails)
الخريطة صارت مُدخلًا إداريًا مؤثرًا في القيود، فحُميت بثلاثة حراس Additive:
1. **مطابقة النوع:** `account_mapping_type_rule` (13 دورًا) يحدد الأنواع المسموحة
   (cash/bank/inventory/vat_input/recoverable/accumulated → asset، payable/vat_output
   → liability، revenue → revenue، cogs → cogs، expense/cost → expense|cogs، equity
   → equity). أي سطر مخالف يفشل `23514 ACCOUNT_MAPPING_TYPE_MISMATCH`، وفحص مسبق
   fail-closed يمنع تطبيق الهجرة لو أي صف قائم مخالف. الدور غير المذكور مسموح
   (open-world) لكنه يُسجَّل — إضافة دور جديد = صف مراجَع في الجدول.
2. **سجل تدقيق:** `account_mapping_audit` يسجّل كل INSERT/UPDATE/DELETE مع القيم
   القديمة/الجديدة والحساب و`changed_by` و`changed_at` و`db_user`، والسبب يُقرأ
   من `coa.mapping_change_reason` الاختياري.
3. **قفل الحساب المرحّل:** لا يُغيَّر `account_code` ولا يُحذف الصف إذا كان الحساب
   القديم عليه سطور في قيود `posted` — إلا بجلسة تعتمد صراحةً:
   `SET LOCAL coa.allow_mapping_change='on'` (نفس نمط 134 في `coa.allow_type_change`).
   تغيير `active`/`note` مسموح دائمًا ومُدقَّق.

`142_down` يسقط الحراس وجدول الأنواع فقط، ويحتفظ بسجل التدقيق كأثر رقابي.

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
- VAT: **16** اختبارًا جديدًا (بنّاء التصفية النقي + مسارا GET/POST حيّان على
  `karim_erp_test`) إلى جانب **54** في الملفات ذات الصلة ✅. أثبتت: مدخلات 150
  ومخرجات 30 ⇒ إطفاء 30 وبقاء ترحيل 120؛ القيد المخزَّن بتاريخ 2019-01-31
  (نص القاعدة) Dr 2100 30 / Cr 1150 30؛ الإعادة 409؛ الفترة المقفلة 423؛
  والشهر الفارغ `nothing_to_clear`. بعد الاختبار: صفر صفوف متبقية بوسم الاختبار.
- حراس 142: **18** اختبارًا داخل معاملة واحدة على `karim_erp_test` (ثم ROLLBACK):
  13 قاعدة نوع، triggerان، رفض النوع والقفل بـ23514، القبول الصريح بالـGUC مع
  سبب في التدقيق، open-world، idempotent re-apply، down يحفظ التدقيق، وعودة
  الحالة حرفيًا (mapping=25) ✅. بعد التشغيل: لا جدول rules/audit ولا trigger متبقٍ.
- `eslint` على الملفات الملموسة: نظيف. `security-gate`: **أخضر** — الاستثناء
  الموثّق `SEC-ZKTECO-531` (`zkteco.js` عدّ=10) ساري حتى 2026-12-06 بسبب ومرجع،
  وقاعدة الصفر لا تُستثنى؛ اختبارات البوابة 13/13 ✅.

## المتبقي في Phase 3 (دفعات تالية)
- تدفق نقدي وملخص CFO والتسوية البنكية (قراءة فقط؛ لا قيود تُنشأ منها).
- `136` (void-only) ما زالت موقوفة بانتظار تحويل مسارات purge الثلاثة.

## حالة الإنتاج
134/135/139/140/141/142 لم تُطبَّق على `karim_erp` (قياس 2026-11-06: `account_mapping`
غير موجود على قاعدة الإنتاج). كل المسارات تعمل بالثوابت كما هي اليوم. التطبيق
يحتاج أمر المالك الحرفي + نسخة احتياطية حديثة (أحدث نسخة 2026-11-06 03:01).
