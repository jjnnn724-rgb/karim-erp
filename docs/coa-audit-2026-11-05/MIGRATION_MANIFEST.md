# 15. MIGRATION_MANIFEST.md — هجرات CoA الخمس (134/135/139/140/141)

> الغرض: مرجع واحد للموافقة على تطبيق الإنتاج. كل رقم أدناه مقيس فعليًا على
> `karim_erp_test` داخل معاملة واحدة ثم `ROLLBACK` — لا تطبيق دائم.
> أمر القياس: `node scripts/coa-migrations-verify.js` (يرفض أي قاعدة غير قاعدة الاختبار).

## الجدول

| # | الغرض | up بيعمل إيه | down بيعمل إيه | اتحقق منه إزاي |
|---|---|---|---|---|
| **134** | أساس CoA: ميتاداتا + حراس شجرة + جداول الربط | يضيف 14 عمودًا nullable على `chart_of_accounts` (subtype/normal_balance/fs_classification/cash_flow_class/tax_category/is_control/is_suspense/is_reconcilable/policy_ref/effective_from‑to/created_by/updated_by/updated_at)، يعبّئ `normal_balance` و`fs_classification` مرة واحدة، ينشئ `account_fs_mapping` + `account_mapping` (بذر **25** دورًا من ثوابت الكود) + `posting_failures`، وtriggerين: منع دورة الشجرة ومنع تغيير type/normal_balance لحساب مستخدم في قيود posted (يتجاوزه فقط `SET LOCAL coa.allow_type_change='on'`) | يحذف الtriggerين والدالتين والجداول الثلاثة، ثم يسقط الـ14 عمودًا والكونسترينت والفهرسين. **مدمّر بطبيعته** (يسقط `account_mapping` وقيمه) ⇒ طوارئ فقط | `coa-migrations-verify.js`: البذر = 25 صفًا، 5 أعمدة ميتاداتا مفقودة قبل/موجودة بعد، triggerان، وإعادة تطبيق up لا تكرّر شيئًا (ON CONFLICT/IF NOT EXISTS) |
| **135** | أقسام عالمية 7000 و8000 | يُنشئ **16** حسابًا جديدًا: `71/7101‑7104` (إيرادات أخرى)، `72/7201‑7205` (مصروفات أخرى)، `8/81/8101‑8103` (رقابية/وسيطة، `is_postable=false`)، يضبط `normal_balance`/`fs_classification`، ويعلّم 8xxx `is_suspense` + `is_reconcilable` + `policy_ref`. لا يلمس أي حساب قائم | يحذف الحسابات الـ16 **بشرط ألا يكون لأي منها سطر قيد** (`NOT EXISTS journal_lines`) — لا يحذف حسابًا عليه حركة | السكربت: عدد الحسابات = 16 بعد up و0 بعد down؛ إعادة up لا تكرّر (ON CONFLICT code)؛ كل 8xxx غير قابلة للترحيل |
| **139** | أدوار الخريطة الناقصة (بيع/شراء/افتتاحي/موردون) | يضيف **8** صفوف `account_mapping`: `inventory_account=1200` لبيع POS وإلغائه وفاتورة الشراء والافتتاحي، `equity_account=3000` للافتتاحي، و`procurement.supplier_payment` payable 2000/cash 1000/bank 1010. ON CONFLICT DO NOTHING | يحذف نفس الـ8 صفوف **فقط إذا طابق الحساب المبذور** — تعديل إداري لاحق لا يُمحى | السكربت: 25 → 33؛ إعادة up تبقى 33؛ down يرجع 25 |
| **140** | نقدية الافتتاحي في جسر يارسوفت | يضيف صفًا واحدًا `yarasoft.prebooks.cash_account=1000` (كان القيد يُرحَّل بالثابت بدون دور مبذور) | يحذف الصف بشرط `account_code='1000'` | السكربت: 33 → 34؛ إعادة up تبقى 34؛ down يرجع 33 |
| **141** | صرف/إرجاع المخزون وتحويلات الأقسام | يضيف **9** صفوف: `inventory.stock_dispatch` و`stock_return` (cogs 5000/inventory 1200)، `dept_transfer.factory_settlement` (revenue 4000/expense 5000)، `inventory_transfer.cost_account=5000`، `factory_variance_close` (4000/5000). أسماء العمليات = `source_type` الفعلي | يحذف نفس الـ9 صفوف بشرط مطابقة القيمة المبذورة | السكربت: 34 → 43؛ إعادة up تبقى 43؛ down يرجع 34 |

## النتيجة المقيسة (2026-11-06، `karim_erp_test`)

```
before: mapping=25, coaMetaCols=5, coaTriggers=2, accounts135=16
134 → 25 ✅   135 → 16 حسابًا ✅   139 → 33 ✅   140 → 34 ✅   141 → 43 ✅
down: 141→34, 140→33, 139→25, 135→0, 134→(جداول مسقطة)
ROLLBACK → الحالة مطابقة تمامًا لما قبل السكربت ✅
```

## شروط تطبيق الإنتاج (karim_erp) — لم تُطبَّق بعد

1. أمر المالك الحرفي.
2. نسخة احتياطية حديثة **مُختبرة الاستعادة** (أحدث نسخة مرصودة 2026-11-06 03:01).
3. تشغيل `node scripts/coa-migrations-verify.js` على staging/نسخة مطابقة أولًا.
4. التطبيق بالترتيب 134 → 135 → 139 → 140 → 141 داخل نافذة صيانة.
5. التحقق بعد التطبيق (قراءة فقط، **بلا SELECT من Oracle/YaraSoft**):
   - `SELECT COUNT(*) FROM account_mapping;` = 43
   - `SELECT COUNT(DISTINCT code) FROM chart_of_accounts WHERE code IN (…135…);` = 16
   - `SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('trg_coa_no_cycle','trg_coa_lock_posted_semantics');` = 2
   - تشغيل اختبارات Jest المعزولة كما هي.
6. الرجوع: 141 ← 140 ← 139 ← 135 ← 134. **135/139/140/141 رجوعها مشروط** بالقيمة المبذورة/عدم وجود حركة. **134 down مدمّر** (يسقط جداول الخريطة) — لا يُستخدم إلا بقرار مالك + نسخة.

## ما لا تفعله الهجرات

- لا تعدّل/تحذف أي حساب قائم، ولا تغيّر `type`/`normal_balance` لأي حساب.
- لا تكتب في `journal_entries`/`journal_lines`.
- لا تلمس YaraSoft أو Oracle، ولا أي مصدر خارج PostgreSQL.
