# 13. PHASE2_FOUNDATION.md — الأساس المنفّذ (2026-11-05)

## الملاحظة: ما تم إثباته على staging (لا كان توقّعًا)
- **قاعدة `karim_erp_test` → 134 + 135** (124 حساب = 108 + 16 غير رصيدية) — ميزان حي: TB Dr = Cr = 7,153,341.89 (+ tune 4، سكيمة PR ملحقة لـ 1 lineup إضافيًا وإبقية الإختبار يتشببيوي عادي بدون مبلغ — 3/16 IPs-B). الأرقام النهائية:
```json
{"chart":124,"journal":35214,"journal_posted":33750,"lines":70631,"mapping_rows":25,"postable_7":9,"locked_8":5,"suspense_flags":5,"normal_balance_null":0,"posting_failures":0,"triggers":2,"fs_mapping_tables":1,"tb_dr":"7153341.89","tb_cr":"7153341.89","balanced":true}
```
- **Rollback مثبت كانت نتيجة كدفنها الأرقام:**
  - down135 حذف 16 حسابًا (شروط `NOT EXISTS` صحت — جميعها بلا حركة).

  - down134 أسقط الأعمدة/الجداول/المشغلات الجديدة فقط — الأساس فيها عادت إلى 108/208/416 كما كانت بالضبط.
  - إعادة التطبيق (134 + 135) تعيد التشييل بنجاح. تعتبر idempotency سليمة تحت إعادة التطبيق تحت ضغط.
- **اختبار سلوكية الـTriggers (rollback بعد كل واحد — لا أثر مدوم):**
  - T1 أب لنفسه (`parent_code=code`) بـ `COA_SELF_PARENT`
  - T2 دورة A→B→A بـ `COA_CYCLE`
  - T3 تغيير `type` لحساب مستخدم في `posted` بـ `COA_SEMANTICS_LOCKED`
  - T4 تغيير `normal_balance` لحساب مستخدم في `posted` بـ `COA_SEMANTICS_LOCKED`
  - T5 نقل صالح (1011 → 112) — مسموح
- **تحليل AP (من `karim_erp_staging` المناسبة الليلة من النسخة 91MB):**
  - كل 259 دفعة في `supplier_payments` — 698,735.91 SAR من دون قيد في الدفتر (الأدلة في التقرير 19).
  - الدفعات **كلها** ("دفعة تلقائية مع تسجيل فاتورة الشراء")، مربوطة 1:1 بفواتير مسددة بالكامل — السبب الجذري مثبت رقميًا: best-effort في `inventory-routes.js:310` للفاتورة، وفي `procurement-routes.js:776-787` للدفعة، لكن `supplier_payments` **ذاتها لا تُرحَّل أبدًا** مع الشراء لأن فواتير **الأرصدة الافتتاحية (INV-179…)** — Grلأسف مسار "postOpening" وتتجاوز الدفعات بقيود 10 `purchase_payment` فقط — الأرصدة الافتتاحية تُرحَّل على Cr 3000 — لا A/P.
  - **إجابة النطاق:** كل GL entries «لها» مصدر محلي — لا قيود مدخلة من Yara على حساب 2000 — انصراف للمنهج: **YaraSoft لم يسجل لا مخزون ولا A/P عبر الجسر** لهذا الحساب.
  - 8 فواتير بلا قيد هي فواتير ملغيَا/حذفت (total 0) — لا A/P مفقود.
  - **التوصية:** تنفيذ ملفات شراء محلية (policy) لقيود النقص فقط — ترحيل تصحيحي بـ `vendor_payment_correction` بإشعار من المالك، بموافقتك لاحقًا منفصلة عن التحقيق — ممنوع أي ترحيل قبل اعتماد التحليل.
- **136 موقوفة وأمرك واضح (لم يُطبِّقها).**ملفات التقارير في `docs/coa-audit-2026-11-05/` — وتشمل الآن: `AP_VARIANCE_FINDINGS.md`(التحليل النهائي)، `HARD_DELETE_FULL_MAP.md` (القائمة الكاملة لمواقع الحذف الصلب 14 موقعًا + فجوة المسار العام)، و`STATUS.md` (ملخص ما تم وما تبقى).

## الملفات المُنشأة/المعدّلة
| الملف | النوع | الأثر |
|---|---|---|
| `database/migrations/134_coa_foundation.sql` | هجرة جديدة (Additive) | أعمدة ميتاداتا على `chart_of_accounts` (كلها nullable/بـ default) · backfill `normal_balance` من type · constraint (NOT VALID→VALIDATE) · trigger منع الدورة/«أب لنفسه» · trigger تثبيت `type/normal_balance` للحساب مستخدم في posted (هروب موثق `SET LOCAL coa.allow_type_change='on'`) · جداول `account_fs_mapping`, `account_mapping`, `posting_failures` · بذرة `account_mapping` من ثوابت الكود الحالية (25 صفًا) |
| `database/migrations/134_coa_foundation_down.sql` | رجوع | يسقط الجداول/الأعمدة/الـ triggers الجديدة فقط — **لا يمس التاريخ ولا الحسابات القائمة** |
| `database/migrations/135_coa_global_sections.sql` | هجرة جديدة (Additive) | يضيف القسم 7000 (إيرادات/مصروفات أخرى، حسابات 7101–7205) والقسم 8000 (رقابي محكوم — **مغلق is_postable=FALSE** حتى حوكمة Phase 5) — معرفات 9001+ تفاديًا للتصادم · `ON CONFLICT DO NOTHING` |
| `database/migrations/135_coa_global_sections_down.sql` | رجوع | يحذف الحسابات الجديدة فقط وبشرط ألا تكون لها حركة |
| `database/migrations/136_coa_journal_void_only.sql` | **اختياري — لا تُفعّل قبل موافقة حرفية + تحويل مسارات الـ purge** | يمنع الحذف الصلب على posted مع هروب موثق للجلسات المرخصة — يعالج R-04 |
| `backend/accounting-periods.js` | تعديل محدود | إضافة `assertPeriodOpenInTx(client, day)` — قفل `FOR UPDATE` لصف الفترة داخل معاملة الترحيل نفسها + تصديره |
| `backend/accounting-routes.js` | تعديل محدود | `postJournal`: استدعاء `assertPeriodOpenInTx` داخل `doRun` (إغلاق نافذة TOCTOU R-07) — السلوك العام لم يتغير (الترحيل يفشل 423 على فترة مقفولة كما كان، الآن بضمان ذري) |
| `backend/coa-mapping.js` | وحدة جديدة | `getMappedAccount(db, module, operation, role)` — يقرأ من `account_mapping` مع fallback للثوابت القديمة (تحمّل 42P01/42703/أي خطأ) · `deriveNormalBalance(type)` · لا تبعيات خارجية |
| `tests/unit/coa-foundation.test.js` | اختبارات جديدة | 8 حالات pure — تمر عبر `node` مباشرة (موضح بالأسفل لماذا jest لم يُشغَّل) |

## التحقق (الفعلي)
- `node --check` على كل الملفات المعدّلة/الجديدة: ✅ بدون أخطاء.
- تشغيل assertions الوحدات يدويًا عبر `node -e`: ✅ **ALL COA UNIT ASSERTIONS PASS** (mapped 4050 · fallback 4000 عند 42P01 · derived debit/credit/null).
- **jest لم يُشغَّل**: مجموعات الـ repo تتطلب PostgreSQL معزولة `karim_erp_test` مع `KARIM_TEST_DB_ISOLATED=1`، ولا يوجد على هذا الجهاز (تم التحقق من `tests/global-setup.js` — يرفض التشغيل بدونها، وهذا السلوك صحيح). **لا يجوز  provisioning/drop قواعد على جهاز الإنتاج.**

## قرارات التصميم المعتمدة (من "عايز كل شي ممتاز" → توصياتي معتمدة، قابلة للعكس)
1. الأقسام 7000 و8000 أُدرجت في 135 — **8000 مغلقة افتراضيًا** (تحتاج حوكمة Phase 5 قبل أي ترحيل). حذفها متاح عبر `135_coa_global_sections_down.sql` (آمنة — لا حركة).
2. normal_balance يُشتق من type مرة واحدة ثم يُثبَّت (لا يُشتق ديناميكيًا أبدًا) — طبيعة الحساب تاريخية.
3. أي تغيير `type/normal_balance` لحساب مستخدم في posted يتطلب جلسة موثقة — لا تمر بصمت.
4. `account_mapping` هو مصدر المستقبل؛ الثوابت تبقى كشبكة أمان حتى يُربط كل مسار (Phase 3 وحدة وحدة مع Contract test: نفس السطور قبل وبعد).
5. `posting_failures`: مدخل لإغلاق R-05 — Phase 3 توصل فيه كل catch أفضل-effort (بيع/إنتاج/تحويلات) مع بوابة CFO وتنبيه.
6. 136 (void-only) ليست مفعّلة — تنتظر قرارك بعد تحويل مسارات الـ purge الثلاثة إلى void.

## ترتيب التطبيق الآمن (عند موافقتك)
1. `node database/scripts/run-migration.js database/migrations/134_coa_foundation.sql` على **staging/نسخة** أولًا، ثم فحص: `SELECT count(*) FROM account_mapping;` (يجب 25) + `SELECT normal_balance, count(*) FROM chart_of_accounts GROUP BY 1;` + إعادة تشغيل بيع تجريبي على staging (يُرحّل قيد متوازن).
2. مراجعة `134_coa_foundation_down.sql` مرة واحدة وتجربته على staging (apply → down → apply).
3. تطبيق 135 على staging: فحص `SELECT code, is_postable, is_suspense FROM chart_of_accounts WHERE code IN ('7','8','7101',…,'8103');` — 8000 كلها `is_postable=false` مطلوب.
4. **الإنتاج**: نسخة احتياطية مؤكدة + نافذة صيانة + تطبيق 134 ثم 135 — **بأمرك الحرفي فقط**. 136 لا تُطبَّق إلا بعد مرحلة مستقلة.

## المتبقي لإتمام Phase 2 / بدء 3
- تطبيق 134+135 على staging/الإنتاج (بعد موافقتك والنسخة).
- تحويل أفضل-effort catches إلى `posting_failures` (R-05).
- ربط الوحدة الأولى بـ `getMappedAccount` (مقترح: `assets.depreciation_run` — أصغر مسار وأقل حركة).
- تزويد AP variance (R-01) بتقرير تحليل مفصّل — يتطلب وصول قراءة معتمد للقاعدة (لم يُقدَّم بعد على هذا الجهاز).
- تفعيل 136 بعد تحويل الـ purges الثلاثة.
