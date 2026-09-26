# تكامل Yarasoft POS مع karim ERP — دليل كامل (v4.7.1)

> **حد التكامل: مشاركة الشبكة فقط** — لا تعديل على Yarasoft، لا تعديل على مصدره،
> لا كتابة في ملفاته الأصلية، لا لمس لقاعدة بياناته الداخلية.
> كل ما يفعله النظام: **قراءة** ملفات الفواتير الجديدة من
> `\\server\Yarasoft\pos\Invoices` واستيرادها آليًا.

---

## 1) تحليل البنية المعماري (Architecture Analysis)

| العنصر | القرار |
|---|---|
| موقع التكامل | **داخل عملية خادم karim ERP نفسه** (نفس نمط مزامنة البصمة) — ليست خدمة منفصلة |
| لغة/إطار الخادم | Node.js + Express 4 (backend/server.js) |
| قاعدة البيانات | **PostgreSQL المثبتة فقط** عبر shared-pool (لا SQLite ولا مخازن ثانية) |
| إعادة استخدام المنطق | خدمة المخزون الحالية `inventory-ledger.postInventoryLedgerEntry()` + جدول `revenues` + `departments` — **لا نظام مخزون ثانٍ** |
| التشغيل الآلي | يبدأ مع الخادم تلقائيًا + إيقاف آمن مع الـ graceful shutdown |
| الواجهة | صفحة "استيراد Yarasoft" للأدمن والمدير (حالة/سجل/مراجعة/ربط/معاينة) |

### نقاط الاندماج في karim ERP (Integration Points)
1. **الإيراد**: صف في `revenues` (نفس ما يفعله POS الداخلي) مع `external_ref` فريد.
2. **المخزون**: `postInventoryLedgerEntry` بنوع `sale_consumption` — يحترم مواقع
   المخزون وسياسات المخزون السالب والدفعة والتدقيق، ويحدّث `inventory.qty` تلقائيًا.
3. **القسم**: قسم مستهدف قابل للضبط (`YARASOFT_DEPT_CODE`, افتراضي `yarasoft_pos`)
   يُنشأ ذاتيًا أول مرة (self-healing مثل POS).
4. **المراقبة**: `/api/yarasoft/status` + أحداث Socket.io (`yarasoft:imported`,
   `yarasoft:review`, `yarasoft:detected`) + سجل pino المهيكل.
5. **الصلاحيات**: `jwtAuth` + RBAC (قراءة: admin/manager/auditor — كتابة: admin/manager).

---

## 2) حقيقة فحص ملفات Yarasoft الفعلية (Phase 2 — بصدق كامل)

**بيئة التطوير هنا (Linux) لا تصل إلى شبكة العميل**، لذلك لم يُفحص محتوى
`\\server\Yarasoft\pos\Invoices` فعليًا — **ولا افتراض واحد مكتوب في الكود**.

المسار المعتمد بدلًا من الافتراض:
```bat
:: على أي جهاز ويندوز داخل شبكة العميل (من مجلد المشروع):
node tools\yarasoft-inspect.js --share "\\server\Yarasoft\pos"
```
الأداة (قراءة فقط) تُنتج:
- `yarasoft-format-report.json` — الامتدادات، أنماط التسمية، الطوابع الزمنية،
  الترميز (BOM/UTF-16/UTF-8/ANSI)، المحدد، الترويسة، أسماء الأعمدة، تنسيق
  التاريخ والأرقام، شكل رقم الفاتورة، فاتورة لكل ملف أم متعددة، مجلد
  CrdtNote للإشعارات الدائنة، وعينات الأسطر الأولى.
- `yarasoft-format-report.txt` — نسخة مقروءة.
- **ملف تعريف صيغة مقترح** جاهز للنسخ.

ثم تُلصق نتيجة التحليل فورًا في شاشة "استيراد Yarasoft ← معاينة الصيغة"
(تحليل + مطابقة قراءة-فقط بلا أي كتابة) للتأكد قبل أي تشغيل فعلي.

---

## 3) جداول قاعدة البيانات (Database Changes)

Migration **039_yarasoft_import.sql** (يُطبَّق تلقائيًا عند الإقلاع أيضًا — idempotent):

| الجدول/العمود | الغرض |
|---|---|
| `invoice_import_log` | سجل معالجة كل ملف: source_file, **file_hash (UNIQUE)**, external_invoice_number (**UNIQUE**), status, stage, items_count, total_amount, retry_count, error_message, payload (حمولة DRY_RUN), processing_duration_ms, created/updated/processed/archived_at |
| `yarasoft_product_mapping` | ربط صريح external_code/external_barcode → inventory.id (فريد للنشط) |
| `yarasoft_review_items` | أصناف REQUIRES_REVIEW: الكود/الباركود/الاسم/الكمية/السبب/resolved |
| `revenues.external_ref` | عمود جديد + **فهرس فريد جزئي** — الحاجز النهائي ضد ازدواج الإيراد |

---

## 4) آلة الحالات (Processing State Machine)

```
مكتشف
  ↓
WAITING_FOR_STABILITY   ← الحجم ووقت التعديل ثابتان + الملف قابل للقراءة (FILE_STABILITY_DELAY)
  ↓
PROCESSING              ← حجز حصري (لا ملف يُعالج مرتين بالتزامن)
  ↓
PARSING                 ← حسب ملف التعريف أو الشمّام التلقائي
  ↓
VALIDATING              ← الإجمالي: إجمالي السطر يشمل الخصم إن وُجد، وإلا كم×سعر−خصم
  ↓
PRODUCT_MAPPING         ← باركود → ربط صريح بالكود → ربط صريح بالباركود → رقم منتج داخلي
  ↓                       أي صنف بلا مطابقة ⇒ REQUIRES_REVIEW (لا استبدال أبدًا)
DATABASE_TRANSACTION    ← معاملة ACID واحدة: إيراد + كل حركات المخزون + إتمام السجل
  ↓
COMPLETED → نقل إلى Invoices_Archive (فقط بعد الالتزام)

الفشل:        retry_count++ ثم إعادة لاحقة؛ بعد YARASOFT_MAX_RETRIES ⇒ FAILED
              + نقل إلى Invoices_Failed (لا حذف أبدًا)
مخزون ناقص:   فشل قابل للإصلاح — زوّد المخزون ثم "إعادة فتح" من الشاشة
DRY_RUN:      كل المراحل إلا الكتابة والحركة — الحمولة تُعرض في السجل والشاشة
انقطاع شبكة:  الحالة تعود DETECTED وتُعاد المحاولة كل NETWORK_RETRY_INTERVAL بلا انهيار
```

---

## 5) استراتيجية الأخطاء وإعادة المحاولة

| الحالة | السلوك |
|---|---|
| الخادم/SMB/المشاركة/المجلد غير متاح | عدّاد `networkRetries` + إعادة دورة كل `NETWORK_RETRY_INTERVAL` (30ث افتراضيًا) — لا انهيار إطلاقًا |
| ملف ما زال يُكتب | `FileNotStableError` → يُعاد لاحقًا (تأخير/عدد محاولات قابلان للضبط) |
| فشل تحليل | retry_count++ ؛ بعد الحد ⇒ FAILED + مجلد Failed |
| ازدواج | ثلاث حواجز: هش SHA-256 فريد + رقم فاتورة فريد + `revenues.external_ref` فريد ⇒ DUPLICATE (لا إيراد مزدوج ممكن على مستوى قاعدة البيانات) |
| صنف غير مطابق | REQUIRES_REVIEW + سجل مراجعة بالسبب؛ بعد حل الربط تُعاد الفاتورة تلقائيًا |
| فشل منتصف المعاملة | ROLLBACK كامل — يستحيل "إيراد بلا خصم" أو العكس |
| فشل نقل الملف للأرشيف | غير قاتل — يُعاد في الدورة القادمة، والسجل يتتبع archived_at |

---

## 6) بنية المجلدات الجديدة

```
backend/yarasoft/
  config.js      الإعدادات من .env فقط (لا بيانات اعتماد في الكود)
  schema.js      مخطط الجداول (تطبيق تلقائي idempotent)
  files.js       مشاركة الشبكة: فهرسة/استقرار/ترميز/نقل آمن
  parser.js      محلل بلا افتراضات (ملف تعريف + شمّام تلقائي)
  mapping.js     أولويات المطابقة الخمس + إدارة الربط
  importer.js    خط المعالجة + المعاملة الذرية + الحواجز الثلاثة
  watcher.js     فحص بدء التشغيل + دوران مسحي (SMB لا يوفر أحداثًا موثوقة)
  engine.js      المحرك داخل عملية الخادم + مقاييس + إيقاف آمن
  routes.js      /api/yarasoft/* مع RBAC
  index.js       نقطة الدمج في server.js
  format-profile.example.json   قالب ملف التعريف (انسخه إلى format-profile.json)
tools/
  yarasoft-inspect.js   أداة التشخيص لجهاز ويندوز في شبكة العميل (قراءة فقط)
```

---

## 7) الإعدادات (Configuration — من .env فقط)

```env
YARASOFT_ENABLED=false            # لا استيراد قبل تأكيد الصيغة
YARASOFT_DRY_RUN=true             # افتراضيًا: تحليل ومطابقة بلا كتابة
YARASOFT_SHARE=\\server\Yarasoft\pos
YARASOFT_INVOICES_DIR=Invoices
YARASOFT_PROCESSING_DIR=Invoices_Processing
YARASOFT_ARCHIVE_DIR=Invoices_Archive
YARASOFT_FAILED_DIR=Invoices_Failed
FILE_STABILITY_DELAY=2000         # ms بين فحوص الاستقرار
FILE_STABILITY_CHECKS=3           # عدد الفحوص الثابتة المتتالية
NETWORK_RETRY_INTERVAL=30         # ثانية
YARASOFT_SCAN_INTERVAL=10         # ثانية بين كل مسح
YARASOFT_MAX_RETRIES=5
YARASOFT_MAX_FILE_MB=10
YARASOFT_FILE_PATTERNS=.txt,.csv  # فارغة = كل الملفات غير المخفية
YARASOFT_DEPT_CODE=yarasoft_pos
YARASOFT_LOCATION_CODE=MAIN-WAREHOUSE
YARASOFT_LOCATION_ID=             # تجاوز اختياري برقم الموقع
YARASOFT_PROFILE=./backend/yarasoft/format-profile.json
YARASOFT_LOG_RETENTION_DAYS=180
```

الأمان: لا بيانات اعتماد في الكود؛ الوصول عبر مصادقة ويندوز المعتادة للمستخدم
المشغّل للخدمة؛ ملفات الفواتير **لا تُعرض عبر HTTP إطلاقًا**؛ لا تسجيل لكلمات مرور.

---

## 8) التثبيت والتشغيل (Installation)

1. استخدم حزمة karim-erp v4.7.1 (الخادم يطبق migration 039 تلقائيًا عند الإقلاع).
2. على جهاز في شبكة العميل: شغّل أداة التشخيص (فوق) واحصل على التقرير.
3. انسخ ملف التعريف المقترح إلى `backend/yarasoft/format-profile.json`.
4. من شاشة "استيراد Yarasoft ← معاينة الصيغة" ألصق عينة فاتورة حقيقية وتأكد
   من رقم الفاتورة والأصناف والمطابقة.
5. فعّل في .env: `YARASOFT_ENABLED=true` مع إبقاء `YARASOFT_DRY_RUN=true`.
6. راقب السجل أسبوعًا (شارات DRY_RUN خضراء = فواتير تحلل وتطابق بنجاح).
7. أطفئ `YARASOFT_DRY_RUN` وأعد التشغيل → استيراد فعلي.
   (التراجع الفوري في أي لحظة: `YARASOFT_ENABLED=false`.)

## 9) الاختبار (Testing)

```bash
# وحدوية (بلا قاعدة بيانات): 26 اختبارًا
npx jest tests/yarasoft-parser.test.js

# تكامل حي ضد PostgreSQL المثبتة (23 فحصًا — ينظف بياناته بنفسه)
node tests/yarasoft-integration.check.js
```
الفحص الحي يثبت فعليًا: idempotency المخطط، DRY_RUN بلا كتابة، استيراد فعلي
بإيراد + خصم مخزون في معاملة واحدة، ازدواج بالهش، ازدواج بالرقم،
REQUIRES_REVIEW → حل الربط → اكتمال، رفض المعالجة المعلقة المكررة،
مخزون غير كافٍ ⇒ ROLLBACK بلا إيراد، أرشفة الملف بعد الالتزام.

## 10) التراجع (Rollback)

- إيقاف فوري: `YARASOFT_ENABLED=false` (المسارات تبقى للمعاينة فقط).
- تراجع كامل عن المخطط (اختياري — الجداول مستقلة لا تمس جداول ERP):
  ```sql
  DROP TABLE IF EXISTS yarasoft_review_items, yarasoft_product_mapping, invoice_import_log CASCADE;
  DROP INDEX IF EXISTS uq_revenues_external_ref;
  ALTER TABLE revenues DROP COLUMN IF EXISTS external_ref;
  ```
- بيانات Yarasoft الأصلية لم تُمس أبدًا: الفواتير المنقولة كاملة في
  `Invoices_Archive`/`Invoices_Failed` ويمكن إعادتها لمجلد `Invoices` يدويًا
  لإعادة الاستيراد (فريدة بالهش فلن تتكرر).

## 11) قائمة التحقق النهائية (Verification Checklist)

- [ ] أداة التشخيص أنتجت تقريرًا من جهاز الشبكة وملف تعريف مقترحًا
- [ ] معاينة الصيغة في الشاشة تحلل عينة حقيقية: رقم الفاتورة + الأصناف + المطابقة
- [ ] `YARASOFT_ENABLED=true` مع `YARASOFT_DRY_RUN=true`: سجل DRY_RUN بلا أي إيراد
- [ ] إطفاء DRY_RUN: فاتورة تجريبية ⇒ إيراد + حركة مخزون في لوحة ERP
- [ ] نسخ نفس الملف مرة ثانية ⇒ DUPLICATE بلا إيراد مزدوج
- [ ] فاتورة بصنف مجهول ⇒ REQUIRES_REVIEW ويظهر في تبويب المراجعة
- [ ] حل الربط من الشاشة ⇒ الفاتورة تكتمل تلقائيًا في الدورة التالية
- [ ] فصل الشبكة مؤقتًا ⇒ الشارة تصير "المشاركة غير متاحة" ثم تعود وحدها
- [ ] الأرشفة: الملفات المنقلة في Invoices_Archive وYarasoft سليم لم يُمس
