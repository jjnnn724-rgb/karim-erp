# 15. MIGRATION_MANIFEST.md — هجرات CoA (134/135/139/140/141) + حراس 142

> الغرض: مرجع واحد للموافقة على تطبيق الإنتاج. كل رقم أدناه مقيس فعليًا على
> `karim_erp_test` داخل معاملة واحدة ثم `ROLLBACK` — لا تطبيق دائم.
> أمر القياس لـ134/135/139/140/141: `node scripts/coa-migrations-verify.js`
> (يرفض أي قاعدة غير قاعدة الاختبار).
> أمر القياس لـ142: `jest tests/coa-mapping-guardrails.test.js` (نفس قاعدة
> الاختبار، معاملة واحدة + SAVEPOINTs + ROLLBACK؛ 18/18).

## الجدول

| # | الغرض | up بيعمل إيه | down بيعمل إيه | اتحقق منه إزاي |
|---|---|---|---|---|
| **134** | أساس CoA: ميتاداتا + حراس شجرة + جداول الربط | يضيف 14 عمودًا nullable على `chart_of_accounts` (subtype/normal_balance/fs_classification/cash_flow_class/tax_category/is_control/is_suspense/is_reconcilable/policy_ref/effective_from‑to/created_by/updated_by/updated_at)، يعبّئ `normal_balance` و`fs_classification` مرة واحدة، ينشئ `account_fs_mapping` + `account_mapping` (بذر **25** دورًا من ثوابت الكود) + `posting_failures`، وtriggerين: منع دورة الشجرة ومنع تغيير type/normal_balance لحساب مستخدم في قيود posted (يتجاوزه فقط `SET LOCAL coa.allow_type_change='on'`) | يحذف الtriggerين والدالتين والجداول الثلاثة، ثم يسقط الـ14 عمودًا والكونسترينت والفهرسين. **مدمّر بطبيعته** (يسقط `account_mapping` وقيمه) ⇒ طوارئ فقط | `coa-migrations-verify.js`: البذر = 25 صفًا، 5 أعمدة ميتاداتا مفقودة قبل/موجودة بعد، triggerان، وإعادة تطبيق up لا تكرّر شيئًا (ON CONFLICT/IF NOT EXISTS) |
| **135** | أقسام عالمية 7000 و8000 | يُنشئ **16** حسابًا جديدًا: `71/7101‑7104` (إيرادات أخرى)، `72/7201‑7205` (مصروفات أخرى)، `8/81/8101‑8103` (رقابية/وسيطة، `is_postable=false`)، يضبط `normal_balance`/`fs_classification`، ويعلّم 8xxx `is_suspense` + `is_reconcilable` + `policy_ref`. لا يلمس أي حساب قائم | يحذف الحسابات الـ16 **بشرط ألا يكون لأي منها سطر قيد** (`NOT EXISTS journal_lines`) — لا يحذف حسابًا عليه حركة | السكربت: عدد الحسابات = 16 بعد up و0 بعد down؛ إعادة up لا تكرّر (ON CONFLICT code)؛ كل 8xxx غير قابلة للترحيل |
| **139** | أدوار الخريطة الناقصة (بيع/شراء/افتتاحي/موردون) | يضيف **8** صفوف `account_mapping`: `inventory_account=1200` لبيع POS وإلغائه وفاتورة الشراء والافتتاحي، `equity_account=3000` للافتتاحي، و`procurement.supplier_payment` payable 2000/cash 1000/bank 1010. ON CONFLICT DO NOTHING | يحذف نفس الـ8 صفوف **فقط إذا طابق الحساب المبذور** — تعديل إداري لاحق لا يُمحى | السكربت: 25 → 33؛ إعادة up تبقى 33؛ down يرجع 25 |
| **140** | نقدية الافتتاحي في جسر يارسوفت | يضيف صفًا واحدًا `yarasoft.prebooks.cash_account=1000` (كان القيد يُرحَّل بالثابت بدون دور مبذور) | يحذف الصف بشرط `account_code='1000'` | السكربت: 33 → 34؛ إعادة up تبقى 34؛ down يرجع 33 |
| **141** | صرف/إرجاع المخزون وتحويلات الأقسام | يضيف **9** صفوف: `inventory.stock_dispatch` و`stock_return` (cogs 5000/inventory 1200)، `dept_transfer.factory_settlement` (revenue 4000/expense 5000)، `inventory_transfer.cost_account=5000`، `factory_variance_close` (4000/5000). أسماء العمليات = `source_type` الفعلي | يحذف نفس الـ9 صفوف بشرط مطابقة القيمة المبذورة | السكربت: 34 → 43؛ إعادة up تبقى 43؛ down يرجع 34 |
| **142** | حراس `account_mapping` الثلاثة (تقوية Phase 3) | (أ) جدول `account_mapping_type_rule` بـ**13** دورًا → أنواع مسموحة، وفحص مسبق **fail-closed** يرفض التطبيق لو أي صف قائم مخالف؛ (ب) `account_mapping_audit` يسجّل كل INSERT/UPDATE/DELETE (قديم/جديد/من/by/متى/لماذا)؛ (ج) Trigger `ACCOUNT_MAPPING_TYPE_MISMATCH` للسطر المخالف، و`ACCOUNT_MAPPING_LOCKED` لمنع تغيير/حذف ربط حساب عليه قيود posted إلا بـ `SET LOCAL coa.allow_mapping_change='on'` (ونفس النمط لـ134) | يسقط الtriggerين والدالتين وجدول `account_mapping_type_rule`؛ **يُبقي `account_mapping_audit`** كأثر رقابي (موثّق في رأس الملف) | `tests/coa-mapping-guardrails.test.js` داخل معاملة: 13 قاعدة، triggerان، رفض 23514 للنوع وللقفل، قبول صريح بالـGUC مع سبب في التدقيق، open-world للدور غير المذكور، إعادة up لا تكرّر، down يسقط الحراس ويحفظ التدقيق، وROLLBACK يعيد الحالة حرفيًا |

## النتيجة المقيسة (2026-11-06، `karim_erp_test`)

```
before: mapping=25, coaMetaCols=5, coaTriggers=2, accounts135=16
134 → 25 ✅   135 → 16 حسابًا ✅   139 → 33 ✅   140 → 34 ✅   141 → 43 ✅
down: 141→34, 140→33, 139→25, 135→0, 134→(جداول مسقطة)
ROLLBACK → الحالة مطابقة تمامًا لما قبل السكربت ✅

142 (اختبار Jest مستقل، same DB، معاملة واحدة):
before: rules=0, audit=0, mappingTriggers=0, mapping=25
apply → rules=13, mappingTriggers=2 (حارس+تدقيق), audit=0
النوع: payable→4000 ⇒ 23514 ACCOUNT_MAPPING_TYPE_MISMATCH (بلا صف/أثر)
القفل: cash 1000→1010 ⇒ ACCOUNT_MAPPING_LOCKED؛ وبـcoa.allow_mapping_change='on'
       + reason ⇒ يُقبل ويُسجَّل UPDATE (1000→1010, changed_by=1, reason)
الحذف: cogs 5000 بلا موافقة ⇒ LOCKED؛ وبموافقة ⇒ DELETE مسجَّل؛ 6600 (غير مرحّل) ⇒ مسموح
إعادة apply: rules=13, triggers=2, audit unchanged ✅ (idempotent)
142_down: triggers=0, guardFn=false, rules=0, audit محفوظ (>0) ✅
ROLLBACK: مطابقة تامة للحالة قبل الاختبار (rules=0, audit=0, triggers=0, mapping=25) ✅
```

## شروط تطبيق الإنتاج (karim_erp) — لم تُطبَّق بعد

1. أمر المالك الحرفي.
2. نسخة احتياطية حديثة **مُختبرة الاستعادة** (أحدث نسخة مرصودة 2026-11-06 03:01).
3. تشغيل `node scripts/coa-migrations-verify.js` على staging/نسخة مطابقة أولًا.
4. التطبيق بالترتيب 134 → 135 → 139 → 140 → 141 ثم 142 داخل نافذة صيانة.
5. التحقق بعد التطبيق (قراءة فقط، **بلا SELECT من Oracle/YaraSoft**):
   - `SELECT COUNT(*) FROM account_mapping;` = 43
   - `SELECT COUNT(DISTINCT code) FROM chart_of_accounts WHERE code IN (…135…);` = 16
   - `SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('trg_coa_no_cycle','trg_coa_lock_posted_semantics');` = 2
   - `SELECT COUNT(*) FROM account_mapping_type_rule;` = 13
   - `SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('trg_account_mapping_guard','trg_account_mapping_audit');` = 2
   - تشغيل اختبارات Jest المعزولة كما هي.
6. الرجوع: 142 ← 141 ← 140 ← 139 ← 135 ← 134. **135/139/140/141 رجوعها مشروط** بالقيمة المبذورة/عدم وجود حركة. **134 down مدمّر** (يسقط جداول الخريطة) — لا يُستخدم إلا بقرار مالك + نسخة. **142 down** يسقط الحراس ولا يُسقط سجل التدقيق.

## ما لا تفعله الهجرات

- لا تعدّل/تحذف أي حساب قائم، ولا تغيّر `type`/`normal_balance` لأي حساب.
- لا تكتب في `journal_entries`/`journal_lines`.
- لا تلمس YaraSoft أو Oracle، ولا أي مصدر خارج PostgreSQL.
