# 10. COA_MIGRATION_PLAN.md — خطة الانتقال الآمنة (Additive-First — لم تبدأ)

## بوابة البدء: لا خطوة بلا: (1) اعتماد المرحلة 1، (2) نسخة احتياطية مؤكدة (اختبار استرجاع)، (3) بيئة staging = نسخة الإنتاج، (4) موافقة حرفية على كل تغيير DDL.

### Phase 0 — READ-ONLY AUDIT ✅ (هذا الملف + 11 آخر — اكتمل)
### Phase 1 — DESIGN APPROVAL (أنت)
يُعتمد: الهيكل الـ 8 أقسام · ترقيم الجديد (7000/8000) · أعمدة الميتاداتا · جدول `account_fs_mapping` · جدول `account_mapping` · سياسات (منع دورة · تثبيت النوع · R-04 void-only) · خطة الاختبار · خطة الرجوع. **لا كود قبل هذه الموافقة.**

### Phase 2 — FOUNDATION (PostgreSQL — Additive فقط)
ترتيب مقترح (كل خطوة migration منفصل، idempotent، قابلة للرجوع):
1. `ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS …` (normal_balance, subtype, fs_classification, cash_flow_class, tax_category, is_control, is_suspense, is_reconcilable, accounting_policy_ref, effective_from/to, created_by/updated_by) — **بأسماء جديدة، لا إعادة استخدام/تغيير دلالة عمود قائم**.
2. Backfill `normal_balance` من `type` (asset/cogs/expense/debit · liability/equity/revenue/credit) عبر UPDATE صريح موثق + تقرير قبل/بعد (SELECT فقط المراجعة).
3. Triggers: منع دورة أب↔ابن (recursive CTE check) · منع "حساب أب لنفسه" · منع تغيير `type`/`normal_balance` إن وُجدت حركة `posted` (إلا بـ إجراء ثنائي موثق).
4. جدول `account_fs_mapping` ببذرة مبدئية من النوع الحالي + مراجعة محاسبية بشرية لكل بند.
5. جدول `account_mapping` ببذرة من الثوابت الحالية بالكود (40+ موقعًا) — **نفس القيم، صفر تغيير سلوكي**.
6. حسابات جديدة 7000/* و (اختياري معتمد) 8000/* — `ON CONFLICT DO NOTHING` فقط.
7. (R-04) منع `DELETE` صلب على `journal_entries WHERE status='posted'` — استبدال بأرشفة/void — **قرار مالك منفصل وإلزامي**.
8. (R-07) `assertPeriodOpen` داخل معاملة الترحيل نفسها (`SELECT id FROM accounting_periods WHERE period=$1 FOR UPDATE`) — تعديل postJournal داخل معاملة واحدة.
9. (R-05) جدول `posting_failures` + poller + شاشة CFO.
10. حسابات رقابية إن اعتُمدت: `is_suspense=true` + جدول `suspense_followups` + تنبيه ≥ סף رصيد/عمر.

**ممنوع في Phase 2:** حذف/إعادة تسمية/إعادة ترميز أي حساب قائم؛ أي `DROP COLUMN`؛ أي تغيير على دلالة `is_postable` للحسابات الترحيلية الحالية؛ لمس ora_* أو YaraSoft.

### Phase 3 — ACCOUNTING INTEGRATION
- استبدال الثوابت تدريجيًا بقراءة من `account_mapping` لكل وحدة على حدى (مبيعات←مشتريات←مخزون←رواتب←إهلاك←تحويلات←جسر Yara) — كل وحدة بـ PR مستقل + اختبار عقد (Contract test: نفس القيد الناتج قبل/بعد).
- ربط تشغيلي بالحسابات التفصيلية (4010..4050 للمبيعات حسب القناة عبر mapping لا عبر حسابات جديدة لكل فرع).
- ختم `branch_id` على السطور/الرأس صراحة من السياق (R-17).

### Phase 4 — FINANCIAL REPORTING
- silencer البيانات: `statement_mapping` + محرك BS/IS/CF/SOCE من الـ mapping (لا من `type`) + TB افتتاحي/حركة/ختامي + مقارنة فترات + نسبة مالية + تتبع reversal (`reversal_of_entry_id` + `reversed_by`) + تقارير استثناء (حسابات سالبة/غير مستخدمة/انحرافات) + **إقفال سنة** كتسوية رسمية (إغلاق 4xxx/5xxx/6xxx → 3100 مع `source_type='year_close'`) + أرصدة افتتاحية محلية من PostgreSQL (يُعمم نمط 094).
- رٌبط `fiscal_years` (الجدول موجود غير مفعّل) بقيد الإقفال.

### Phase 5 — PREMIUM UX
- Enterprise Command Center للمحاسب/CFO: Luxury Corporate (Navy/Official Blue/White)، RTL/LTR، شجرة تفاعلية (آلاف الحسابات — virtualization)، تفاصيل حساب، إجراءات مع "اشرح المنع" (قاعدة + بديل + أثر)، لوحة CFO قابلة للdrill-down (القائمة←حساب←قيود←مستند) — **بلا اختراع بيانات**؛ كل رقم من PostgreSQL.
- لا نسخ قوالب ERP؛ لا Dashboard استهلاكي.

### Phase 6 — INDEPENDENCE VALIDATION (staging)
نسخة staging ← تعطيل `YARASOFT_ORACLE_ENABLED=false`, `YARASOFT_ENABLED=false` ← إثبات: إقلاع، ترحيل بيع محلي، TB، BS، IS، إقفال فترة، AR/AP — **كلها بدون Oracle** + تقرير موقع + إثبات عدم أي استعلام خارجي (egress log). الإنتاج **لا** يُعدّل، ولا يُوقف التكامل الحالي قبل موافقة صريحة.

### Phase 7 — FINAL ACCEPTANCE
نتائج اختبارات · قبل/بعد أرصدة (مطابقة بالهللة) · تسويات AR/AP · إثبات عدم تغيير التاريخ المالي (git diff على journal_entries/lines فارغ) · دليل محاسبين · خطة رجوع موثقة.

## خطة الرجوع (Rollback)
- كل migration جديدة ملف `NNN_*.sql` + `NNN_*_down.sql` موثق، أو بوابة استعادة من النسخة الاحتياطية.
- لا تغيير سلوك ترحيل في Phase 2 — يكفي استبدال الكود للرجوع.
- أي فشل ⇒ استرجاع النسخة + إعادة تطبيق المايجر بشكل انتقائي بعد التحقيق — **بموافقة**.

## ضمان حماية التاريخ المالي
لا `UPDATE journal_lines` / لا `DELETE` لأي قيد تاريخي؛ أي "تصحيح تصنيف" عبر mapping جديد ساري من تاريخ؛ النسخ الاحتياطية قبل وبعد + بصمات (count/sum) موقعة بالتقرير.
