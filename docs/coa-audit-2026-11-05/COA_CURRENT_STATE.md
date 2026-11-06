# 1. COA_CURRENT_STATE.md — الحالة الحالية لشجرة الحسابات (READ-ONLY)

**المشروع:** Karim ERP v4.9.2 · **التاريخ:** 2026-11-05 · **النوع:** Phase 0 Audit — بدون أي تعديل على الكود أو PostgreSQL أو Oracle.
**المرجع:** `karimabdelhamedeldsouky/karimabdelhamed12/karim-erp`

## 1. المنصة والتشغيل
- نظام تشغيل: Windows، التطبيق على المنفذ `5000` (`.env` الفعلي) و`127.0.0.1`/واجهات الشبكة.
- PostgreSQL **18.6** كـ Windows Service `postgresql-x64-18` (RUNNING) على `:5432` — فحص حي مؤكد.
- **لا يوجد Docker مثبت** على الجهاز. `docker-compose.yml` يوجد كتجهيز نشر مستقبلي (postgres:18-alpine loopback `5433`) — غير مستخدم حاليًا.
- قاعدة البيانات: `karim_erp` — يُعتمد عليها لإقلاع النظام كاملًا (`backend/startup.js` يرفض الإقلاع بدونها — `BOOT_VALIDATION_FAILED`).
- متغيرات `.env` الفعلي (القيم الحساسة مموّهة): `DB_USER=karim_app`، `DB_ADMIN_USER=postgres`، `DB_MODE=system`، `DB_POOL_MAX=60`، `SKIP_BULLMQ=1`، `YARASOFT_ENABLED=true`، `YARASOFT_ORACLE_LIVE=true` — **الإعداد الإنتاجي يعتمد فعليًا على YaraSoft/Oracle للبيانات الحيّة للكاشير.**
- المايجريشنز: **135 ملف مطبّقًا** (`database/migrations/001→133`)، `.migrations_applied` بعدد 135.

## 2. الحجم الحي (فحوص قراءة فقط سابقة — SELECT فقط)
| المقياس | القيمة |
|---|---|
| جداول public | 221 (147 في ملفات المايجريشن + ~70 مرآة تشغيل/نسخ) |
| `chart_of_accounts` | **108** |
| `journal_entries` | **35,278** (posted 33,814 · void 1,464 · draft 0) |
| `journal_lines` | **70,759** |
| أقدم/أحدث قيد | 2026-09-30 → 2026-11-05 |
| `accounting_periods` | 12 فترة `2026-01..2026-12` — كلها **مفتوحة** |
| `customers` | 4 (جاهز/هنقر/تويو/نينجا — كلها `delivery_platform`، control `1310`) |
| `suppliers` | 28 |
| الفروع | `branches` (مايجر 102) + `branch_id` على القيود/الطلبات |
| مراكز التكلفة | `cost_centers` (مايجر 081 + 122 من الأقسام) |
| `ora_*` (نسخ Oracle) | ~52 جدول ≈ **1.38 مليون صف** بلا فهارس/PK |

## 3. نواة المحاسبة الموجودة (ملفات بأدلة)
- `database/migrations/042_accounting_core.sql` — `chart_of_accounts` (code UNIQUE)، `journal_entries` (`uq_journal_source UNIQUE NULLS NOT DISTINCT (source_type, source_id)`)، `journal_lines` (مدين/دائن، `ck_journal_line_side` سطر واحد لطرف واحد، NUMERIC(14,2)).
- `database/migrations/079_accounting_controls.sql` — `status ∈ (draft/posted/void)` + `approved_by/at` + فترات `accounting_periods`.
- `database/migrations/081_accounting_growth.sql` — `cost_centers`، `journal_lines.cost_center_code`، `fixed_assets`، `bank_statements`، `pos_cash_custody`.
- `database/migrations/095_journal_db_invariants.sql` — Constraint Trigger توازن عند `posted` (≥2 سطر، ±0.01) + حصانة هوية القيد المنشور (date/memo/source_*).
- `database/migrations/131_professional_chart_of_accounts.sql` — ترقية الشجرة إلى 4 مستويات IFRS-ish (المستوى 1: `1..6`؛ المستوى 2: `11/12/21/...`؛ المستوى 3: `111..214` تجميعية `is_postable=false`؛ المستوى 4: تشغيلية `is_postable=true`) + 28 حسابًا قديمًا مربوطًا بآباء.
- `database/migrations/132_subledger_architecture.sql` — `customers` + `customer_transactions` + `view_ar_reconciliation` / `view_ap_reconciliation`.
- `database/migrations/102_branches.sql`, `123_external_sales_root.sql` — الفروع + جذور البيع.
- المحركات: `backend/accounting-routes.js` (`postJournal`)، `backend/financial-statements-engine.js`، `backend/accounting-periods.js` (قفل الفترات + اعتماد المسودات)، `backend/accounting-growth.js` (إهلاك/بنوك/عهد/أرصدة)، `backend/budget-alerts.js`.

## 4. ما هو موجود فعليًا ويعمل محليًا (بدون Oracle)
- القيود والتوازن والترقيم المقاوم للسباق (postJournal + إعادة المحاولة ×3).
- منع التكرار: مفتاح المصدر `(source_type, source_id)` + بصمة محتوى (10 دقائق) للقيود اليدوية.
- قفل الفترة المغلقة (`assertPeriodOpen` — أي ترحيل على شهر مقفول يُرفض 423).
- ميزان المراجعة، قائمة المركز المالي، قائمة الدخل (`financial-statements-engine` — **SAR ثابتة في الكود**).
- دفتر العملاء/الموردين + المطابقة الرقابية AR/AP، موازنات، إهلاك شهري (Dr 6600 / Cr 1520)، إقرار VAT (من 2100 و1150).
- الفصل الوظيفي: `READ_ROLES = admin/accountant/manager/auditor` · `WRITE_ROLES = admin/accountant` · إعادة فتح فترة = `admin` فقط.

## 5. ما هو ناقص / معطوب (تفصيل في التقارير 2–12)
- لا يوجد حقول `normal_balance / fs_classification / account_subtype / cash_flow_class / tax_category / currency_policy / effective_date / created_by` على `chart_of_accounts` — التنبؤ من `type` فقط.
- لا يوجد تعدد شركات/عملات محاسبي؛ العملة عرضية (SAR) وليس معاملات تحويل.
- لا يوجد جدول Mapping للقوائم؛ `financial-statements-engine` يشتق كل شيء من `type`.
- AP reconciliation: **انحراف −706,091.83** (subledger 50,251.51 مقابل GL 756,343.34) — لم يُحلّ بعد.
- AR reconciliation: متوازنة (0.00).
- `pos_orders` محلية شبه فارغة — مبيعات الكاشير تصل للدفتر عبر `yarasoft/gl-bridge` (غير متاح دون Oracle).
- `journal_entries.branch_id` موجود في القاعدة (مايجر 102) وتُختم عبر triggers، لكن `postJournal` لا يمرر branch_id صراحة — يحتاج توثيق/تحقق.

## 6. الحكم
النظام **يملك نواة محاسبية PostgreSQL حقيقية تعمل دون Oracle**، لكنه **ليس بعد Accounting Foundation كاملة**: الشجرة موجودة بلا ميتاداتا محاسبية ذكية، والقوائم سطحية، و¥~ اعتماد الإيراد التشغيلي على YaraSoft هو أكبر مخاطرة استقلالية.
