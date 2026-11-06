# Phase A — ما نُفِّذ وما ثبت على staging (2026-11-06)

المرجع: `MASTER EXECUTION PROMPT v3` Phase A (A1–A4) + الفجوة R-04 في
`ACCOUNTING_RISK_REGISTER.md`. هذا الملف هو سجل التنفيذ والتحقق، لا خطة.
**لم يُلمس إنتاج `karim_erp`، ولم يُ commit شيء، وYaraSoft/Oracle قراءة فقط ولم يُمسّا.**

---

## 1) ما تغيّر في الكود

لا مسار بعد الآن يمسح قيدًا مُرحّلًا. كل التصحيحات تمرّ من نقطة واحدة:
`backend/journal-void.js` (جديد) — `voidSourceJournals` / `voidJournalById` /
`nextRevisionSourceId`.

| # | الموقع | ما كان | ما صار |
|---|---|---|---|
| A1 | `backend/journal-void.js:94` | — | إبطال موجّه بمرجع المصدر (+`matchPrefix` للمراجعات المتسلسلة) |
| A1 | `backend/journal-void.js:119` | — | إبطال بمعرّف القيد، بنفس سجل الفاعل/السبب |
| A1 | `backend/journal-void.js:137` | — | مرجع المراجعة `#rN` لأن `uq_journal_source` لا يقبل مرجعًا مكرَّرًا والمبطل يحتفظ بمرجعه للأبد |
| A2 | `backend/server.js:1145` (`voidExpenseJournal`) | `DELETE FROM journal_lines/entries WHERE source_type='expense'` | إبطال، والمصروف نفسه يُمحى كما كان (المصروف ليس دفترًا عامًّا) |
| A2 | `backend/server.js:1158` (`postExpenseJournal`) | إعادة ترحيل بمرجع المصدر نفسه ⇒ 23505 صامت | `nextRevisionSourceId` ⇒ `987654#r2` |
| A2 | `backend/server.js:2667` (`purgeDispatchRelated`) | حذف قيود `dispatch` + `expense` للتوصيلة | إبطل النوعين معًا (موقع رابع لم يكن في قائمة v3) |
| A2 | `backend/procurement-routes.js:871` | `DELETE` لقيود المشتريات | إبطال |
| A2 | `backend/warehouse/purchase-void-routes.js:184, 247, 445` | `DELETE` داخل معاملة الإلغاء | إبطال داخل نفس المعاملة |
| A4 | `backend/warehouse/inventory-routes.js:635` | كان يُعدّل `source_type/source_id/memo` للقيد المرحّل ثم يُعيد الترحيل | لا تعديل هوية إطلاقًا: إبطال بـ`matchPrefix` ثم نسخة منقّحة بمرجع مراجعة |
| A1 | `backend/accounting-routes.js:629` (`POST /journal/:id/void`) | `UPDATE … SET status='void'` بلا فاعل/سبب/سجل | `voidJournalById` (فاعل + سبب + `journal_ledger_audit`) |
| A1 | `backend/accounting-routes.js:292` (`postPurchaseToLedger`) | مرجع ثابت فقط | `opts.sourceId` لترحيل نسخة منقّحة بفاتورة مُعدَّلة |
| A3 | `backend/hr-routes.js:422` | `WHERE month=$1 AND status='closed'` على أعمدة غير موجودة ⇒ `42703` يُجهض توليد المسير | `assertPeriodOpenInTx(client, month-01)` — نفس أداة القفل الذرّية |

**عبارات SQL ثابتة، لا بناء نصّي:** كان `journal-void.js` يبني `SET`/`WHERE` بقالب
نصّي يحوي `${}`، فتمسكه بوابة الأمان بقاعدة صفرية (`sql-interp`) — لم أُخفّض الحصّة
ولم أعدّل الأساس، بل استبدلته بستّ عبارات ثابتة (`backend/journal-void.js:44-86`)
تُنتقى بعلَمَين (مُهاجرة 137 نعم/لا × `matchPrefix` نعم/لا) مع مصفوفة وسائط مطابقة
لكل عبارة حرفيًّا. السبب التقني أن PostgreSQL يرفض ربطًا فيه وسائط أكثر ممّا تذكره
الجملة، فلا يمكن اشتقاق `SET` ديناميكيًا بلا قوالب؛ السبب المهني أن القالب النصّي هو
بالضبط ما وُجدت البوابة لمنعه. البوابة الآن: `journal-void.js` صفر إصابات.

**لماذا إبطال بلا قيد عكسي؟** كل قراءات الأستاذ تفلتر `status='posted'`
(`accounting-routes.js:537`، `financial-statements-engine.js:32`،
`accounting-periods.js:93`)، فالإبطال يُخرج القيد من الأرصدة بالكامل؛ إضافة سطور
عكسية فوقه تطرح المبلغ مرتين. مقاس لا مُستنتَج — انظر V6 أدناه.

**الحاجزان في القاعدة:** 136 يرفض `DELETE` لأي `posted` خارج
`SET LOCAL coa.allow_hard_delete='on'`، و095 يرفض تعديل هوية المرحّل. الكود الجديد
لا يحتاج كليهما ليعمل، لكنهما يمنعان أي مسار مستقبلي (أو يدوي) من التحايل عليهما.

## 2) ما طُبِّق على `karim_erp_staging`

`136_coa_journal_void_only.sql` (كان مكتوبًا من جلسة سابقة بلا تطبيق) و
`137_journal_void_audit.sql` (جديد: 4 أعمدة إبطال + `journal_ledger_audit` +
محفّظا انتقال الحالة والحذف الصلب) و`138_journal_lines_audit.sql` (جديد: رصد سطور
المرحّل — §4) — عبر `tests/load/stageA-apply-migrations.js` بقفل advisory، ثم
فحص المخطط بعد التطبيق. `136/137/138_down.sql` مكتوبة؛ 137 و138 مجرَّبتان فعلًا على
staging (هدم ثم إعادة بناء)، و136 مجرَّب نصيًّا فقط.

**ترتيب الرجوع مُلغَم بحرس:** `137_down.sql` يفحص وجود `trg_journal_lines_audit`
ويرفض قبل أن يسقط الأعمدة التي يقرأها محفّظ 138، و`138_down.sql` يحذف صفوف
`line_change` من السجل بعد تنبيه التصدير ثم يُسقط سجل التهيئة لنفسه في
`schema_migrations` حتى لا تُحسب 138 مُطبَّقة وهي معلَّقة. إعادة تطبيق 138 بعد تجربة
الرجوع كشفت هذا بالضبط: المحفّظ غائب والسجل يقول «مُطبَّقة» — فالمسار الصحيح حُذف
صفي `138*.sql` من `schema_migrations` ثم أعيد التطبيق، والآن المحفّظ موجود (V13 أدناه).

**لغم صامت أُصلح في نفس الفرصة:** خمسة مواضع تعدّ `*.sql` من `database/migrations`
بترتيب أبجدي — `database/scripts/run-migration.js:43`، `scripts/install.js:414`،
`scripts/acceptance-auth-flow.mjs:72`، `scripts/acceptance-postgres-init.mjs:49`،
و`electron/main.js:739` (تهيئة قاعدة التطبيق المكتبي). أي ملف `_down.sql` كان سيُطبَّق
تلقائيًّا بعد أخيه (134 ثم 134_down = بنْء ثم هدم في نفس التهيئة). أُضيف
`isRollbackMigration()` في `scripts/shared.js:199` واستُخدم في المواضع التي تشترك
المكتبة؛ مواضع Electron/acceptance تحمل نفس النمط `!/_down\.sql$/i` (لا تستورد
المكتبة). `run-migration.js:137` يرفض صراحةً هدفًا صريحًا من ملفات الرجوع.
المواضع التي تقرأ المجلد للعرض فقط (`scripts/status.js:83`) لم تحتاج شيئًا.

## 3) الأدلة — `tests/load/stageA-verify-journal-void.js` على staging (آخر تشغيل، 2026-11-06)

```
00 بداية (بعد تنظيف البقايا)  قيود 35214 / سطور 70631 / Σ مدين الميزان 7,153,341.89
V1   حذف قيد posted حقيقي     23514 POSTED_JOURNAL_NO_HARD_DELETE (القيد 1790940343162870)
V1c  الصف الحقيقي لم يُمسّ     before 1 → after 1  (كل محاولة مدمِّرة على صف الاختبار، معاملة مجهَضة دائمًا)
V1b  [كان فجوة G-01] سطور المرحّل {"affected":2,"rejected":false} — لا منع؛ 138 ترصد (§4)
V2   coa.allow_hard_delete=on  deleted 1، المحفّظ موجود، ROLLBACK أعاد الصف
V4   تعديل هوية posted         23514 POSTED_JOURNAL_IMMUTABLE (هذا بالضبط ما كان يفعله سطر A4 القديم)
V5   voidSourceJournals        voided 1 → JE-TEST-A1-0001
V5b  أعمدة الإبطال             status=void, voided_at مملوء, voided_by_name=qoder-a1, void_reason مملوء
V5c  journal_ledger_audit      action=void, posted→void, line_count 2, debit_total 100.00, db_user=karim_app
V6   ثبات الميزان              7,153,441.89 → 7,153,341.89  الفرق 100.00 بالضبط (لا 200.00)
V7   unvoid مسجَّل             action=unvoid, void→posted
V8   حذف مسودة مسموح           rowCount 1 · V8b hard_delete مسجَّل للممحو
V9   voidJournalById           voided true · V9b إبطال المُبطل ⇒ voided false (لا إبطال مزدوج)
V9c  nextRevisionSourceId      987654 → 987654#r2 · V9d 555000 → 555000#r2
V10  A3 بالأعمدة الصحيحة       closed=false · V10b الصيغة القديمة 42703 (كما شُخِّصت)
V11  posted غير متوازن         23514 UNBALANCED_POSTED_JOURNAL عند الالتزام (لا تراجع عن 095)
V12  قاعدة بلا 137             UPDATE بلا أعمدة إبطال (3 وسائط) / معها (6 وسائط) — الفحص على اتصال المستدعي
V12b ربط فعلي (stageA-bind-coverage.js)  العبارات الستّ مقبولة على staging المُهاجرة
                                 وkarim_erp_test غير المُهاجرة، كلٌّ في معاملة مجهَضة
                                 (voided=0 لكل الحالات) — لا خطأ 08P01 ولا كتابة باقية
V13a ترحيل عادي (أب+سطوره)     0 صفوف line_change — الإعفاء بنفس المعاملة يعمل، لا ضجيج
V13b نقل 100.00 خارج المسار     صفّ line_change: «مساس بسطر خارج مسار الترحيل — تعديل سطر
                                 #999000000012 (6900: 0.00/100.00 ← 1000: 0.00/100.00) | karim_app»
V13c لا شيء مُنع               Σ مدين 7,153,691.89 = المتوقع حرفيًّا (الرصد لا يعطّل)
V14 جدول audit                 hard_delete 1 · line_change 4 · unvoid 3 · void 3
ZZ   بعد التنظيف               35214 / 70631 / سجل 0 · ZZb الميزان 7,153,341.89 = البداية حرفيًّا
RESULT ✅ كل البوابات مرّت — staging عاد لحالته الأصلية
```

**jest (karim_erp_test — قاعدة غير مهاجرة، وهو اختبار حقيقي لمسار V12):**
بعد إعادة كتابة العبارات الثابتة: `journal-void-only-policy` ✅ (6/6، جديد) ·
`dispatch-financial-guards` ✅ (8/8) · `security-gate` ✅ (51→50 إصابة، لم يُلمس الأساس) ·
`lint-gate` ✅. وربط العبارات على قاعدة غير مهاجرة مُثبَت بـV12b أعلاه.
**ما لم يُعَد تشغيله بعد Rewrite:** `invoice-void-auto-payment` · `pos-void-ledger-integrity` ·
`accounting-cost-centers` — كانت خضراء في التشغيل السابق (47/49 اختبارًا)، والتشغيل الآن
يصطدم بجلسة أخرى تُشغّل jest على نفس القاعدة، فالإعادة مجدولة مع البوابة الكاملة (§7).
الملف الأحمر: `tests/posting-matrix-engine.test.js` (فشلان) — **ليس من Phase A**:
الملف ومحركه غير مُتتبعَيْن في git (عمل جلسة سابقة، 2026-11-03)، و`mockPool` فيه
يصيد `SELECT id, entry_no FROM journal_entries …` بينما `postJournal` يسأل
`SELECT * FROM journal_entries …` (`accounting-routes.js:129` على HEAD) ⇒ كشف
الإعادة ميت، والترحيل الثاني يكتب فعلًا في قاعدة الاختبار فيصطدم بـ`uq_journal_source`.
الإصلاح عندهم: مطابقة نمط الاستعلام + تنقية `ORD-9901/DEL-8801/TR-7701/ORD-DUP-01`.
(نظّفت هذه البقايا مرتين قبل التشغيل؛ تبقى مشكلة التصميم في ملف غيري فلم أمسّه.)

## 4) G-01 مُغلَقة — برصد 138 لا بتعطيل

136 يمنع حذف **الأب** المرحَّل، لكن `DELETE/UPDATE journal_lines` تحت أبٍ مرحَّل
بـSQL المباشر كان مقبولًا بلا أثر (قاسها V1b: سطران مُمحوان بقبول، بلا صف سجل). لا
يوجد أي مسار تطبيق يفعل ذلك — `grep` على المستودع: الكتابة الوحيدة على `journal_lines`
هي `postJournal` (أسطر 177/183) **داخل نفس معاملة إنشاء الأب**.

**لماذا رصد لا منع؟** المنع كان يخسر مرتين: (أ) من يملك psql يفتح
`coa.allow_hard_delete='on'` بنفسه فلا يردعه شيء؛ (ب) أي محفّظ يرفض السطور بلا
استثناء «نفس المعاملة» يُجهض كل ترحيل في النظام — كلفة تشغيلية فادحة مقابل كسب أمني
صفر. فالحلّ الصحيح هو ما يسدّ الفجوة فعليًا: تسجيل ما جرى.

`138_journal_lines_audit.sql` (طُبِّق على staging): محفّظ
`AFTER INSERT OR UPDATE OR DELETE` على `journal_lines` يكتب في `journal_ledger_audit`
بسعة `line_change` **فقط** إن كان الأب `posted` **و** لم تكن معاملته هي معاملتي —
التمييز بـ`e.xmin::text = pg_current_xact_id()::text` (إعفاء دقيق ثبت بـV13a: صفر
صفوف في الترحيل العادي). النص المرصود يحمل لقطة قبل/بعد لكل سطر
(`6900: 0.00/100.00 ← 1000: 0.00/100.00`) مع مستخدم القاعدة، فالتعديل خارج مسار
الترحيل يصبح مقروءًا في السجل بدل أن يكون صامتًا — ولا يُمنع أحد عن أداء عمل مرخّص.
الوسعة في `journal_ledger_audit_action_check` من 4 إلى 5 أفعال، و`138_down.sql`
تحذف صفوف `line_change` بعد تنبيه التصدير وتُرجع القيد.

**تفاعل مقاس مع بوابة 136 (2026-11-06 10:25، staging):** حذف قيد مرحّل بسطرين خلف
`coa.allow_hard_delete='on'` كتب `hard_delete=1` **و** `line_change=2` — أي أن محو
بيانات الاختبار يبقى مرئيًا سطرًا سطرًا ولا يمزج بصمت الإبطال. النتيجة مطلوبة، لكن
كلفتها صفحة سجل إضافية لكل سطر في أي purge مرخّص؛ من يفتح البوابة على آلاف القيود
(تنظيف إنتاج ضخم) سيغمر الجدول — ولهذا البوابة نفسها موثّقة ومشروطة لا اعتيادية.
أثر القياس أُزيل بعد التشغيل (`journal_ledger_audit` = 0 صفوف، والقيود/السطور عند
35,214/70,631).

## 5) شرط النشر (لا يتراجع عنه أحد)

`136 + 137 + 138` تُطبَّق على أي قاعدة **قبل** إعادة تشغيل الـbackend عليها. الكود يعمل
مع قاعدة غير مهاجرة (مُبيَّن في V12: يسقط تسجيل الفاعل/السبب فقط)، لكن النتيجة
حينها سجل أعمى تدقيقيًّا — وهو أسوأ الترتيبين. الترتيب الآمن على الإنتاج:
نسخة احتياطية مؤكدة → 136 → فحص → 137 → فحص → 138 → فحص → إيقاف/تشغيل الـbackend
→ V1–V14 على نسخة من الإنتاج لا على الإنتاج نفسه.

**تنظيفات الاختبارات مُصحَّحة:** كان `tests/expanded-pos-scenarios.js` و
`tests/accounting-cost-centers.test.js` يمحوان قيودًا بالـ`DELETE` المباشر في
teardown — وهو ما ترفضه 136 فتُبتلعه `.catch` صامتة وتترك سطورًا يتيمة. أُضيفت
دالتان محليّتان صريحتان (`purgeJournalsHard` / `purgeDispatchJournals`) تفتحان
بوابة `SET LOCAL coa.allow_hard_delete='on'` داخل معاملة الحذف الخاصة بالتنظيف فقط،
فالبوابة تبقى مغلقة أمام التطبيق وتُفتح حيث القصد موثَّق. 138 تراقب هذا المسار
بالضبط: حذف التنظيف يُسجَّل `hard_delete` لا يُمزج بصمت الإبطال.

## 6) قرارات المالك المطلوبة (هي ما يوقف البقية)

1. تطبيق 136+137+138 على `karim_erp` (الإنتاج) بالترتيب أعلاه — **لا قبل موافقة مكتوبة**.
2. ~~G-01: محفّظ `journal_lines` (138) أم قبول الفجوة موثَّقة؟~~ — نُفِّذ الخيار
   الاحترافي على staging: رصد بصفر كلفة تشغيلية (§4). يبقى اعتماد النشر للإنتاج.
3. سياسة المُبطَل: يبقى بمرجعه إلى الأبد مع مراجعات `#rN` (هي المُنفَّذة الآن في
   `postJournal` وفي كاشفات §8) أم تُستعمل `:revision:` كما في الشراء؟ — القرار
   صار سلوكًا مُختبَرًا لا ترتيب ملفات؛ تغيير اللاحقة يعني تعديل `nextRevisionSourceId`
   والعبارات الثابتة في `journal-void.js` والعقود في `dispatch-financial-guards`.
4. الـ259 دفعة بلا قيد (698,735.91 SAR) — قيد تسوية واحد أم تفصيل؟ (Phase B لا يبدأ قبلها)
5. اعتماد commits هذه التغييرات — الشجرة فيها عمل لجلسات أخرى فلم أُضيف إلا ملفاتي بالاسم.

## 7) جولة الإقفال (2026-11-06 10:10) — ما أُضيف بعد §1–§6

| ما | الملف | الدليل |
|---|---|---|
| عبارة SQL ثابتة بدل البناء النصّي | `backend/journal-void.js:44-86` | البوابة خضراء: `sql-interp` نزلت 51→50 إصابة، حصّة journal-void = 0، الأساس لم يُعدَّل |
| ربط فعلي لكل فرع على قاعدة مهاجرة وغير مهاجرة | `tests/load/stageA-bind-coverage.js` | 6/6 عبارات مقبولة، كلها داخل معاملة مجهَضة (voided=0، لا سطر يبقى) |
| عقد نصّي يمنع رجوع الحذف الصلب | `tests/journal-void-only-policy.test.js` | 6/6: `backend/` صفر `DELETE FROM journal_*`، والاختبارات لا تمحو إلا خلف بوابة صريحة. Canary نصّي لا حارس دلالي — المنع الحقيقي في 136 |
| حرس حدّ التتابع | `tests/dispatch-financial-guards.test.js:41-45,52-58` | 8/8 بعد متابعة توقيع `purgeDispatchRelated(id, req.user)` + عقد منع الرجوع |
| إصلاح مخالفة في ملف جلسة أخرى | `scripts/_tmp-audit-fabricated.js:65-88` | كان يبنى `notes ~ '…'` بقالب نصّي (إصابتان، حصّته صفر). نقلته إلى وسائط مربوطة بصيغتين ثابتتين — **نفس الدلالة، قراءة فقط، لا تغيير في المخرجات**. الأمانة: الملف غير مُتتبَّع وعمل جلسة أخرى؛ لولا أنه يُحمرّ بوابة الأمان كلها ما لمستُه، والتعديل خفيف وعكوس |

**التنسيق مع الجلسات الأخرى:** جلسة أخرى كانت تُشغّل jest على `karim_erp_test`
(v2-mobile-pwa/sessions/branches/api-offline) وقت هذه الجولة، فامتنعت عن البوابة
الكاملة وعن التشغيل المتوازي على نفس القاعدة؛ الأرقام في §3 كلها من staging أو من
فحوص نصية بلا كتابة. البوابة الكاملة مُجدولة لحظة فراغ القاعدة (المهمة #10).

## 8) وعي الإبطال (2026-11-06 11:40) — الثقب الذي صنعه §1 نفسه

سياسة «الإبطال لا المحو» جعلت صفّ `status='void'` يبقى إلى الأبد بنفس مرجع المصدر،
لكن مَسحَ الترحيل لم يُحدَّث لذلك. فجوتان مقاستان لا مستنتجتان:

+ `postJournal` كان يعدّ أي صفٍّ بنفس المرجع «موجودًا» ⇒ المُبطَل يُردّ replay،
  فلا يمكن ترحيل مصدر أُبطل قيدُه مرةً أخرى ولو بقرار بشري صريح
  (`backend/accounting-routes.js:128-134` القديم).
+ ثمانية كاشفات «قيد مفقود» بلا فلتر حالة تعدّ المُبطَل «مُرحَّلًا» فتُخفي ثقب
  الأستاذ عن التقارير؛ وحدها كاشفات `posted` (pos_sale) كانت ستُعيد ترحيل المُبطَل
  صامتةً لو تُركت الفجوة الأولى بلا حارس.

**القاعدة المقرَّة:** الإصلاح الآلي لا يقضي على قرار بشري. المُرحِّلات الآلية
(day-close، منسّق المالية، جسر يارسوفت، تقرير الأذون) لا تُعيد ترحيل مُبطَل أبدًا،
وتُبلّغه في خانة مستقلة. المسار البشري وحده يُعيد الترحيل، بمرجع مراجعة `#rN`.

| ما | الملف | الدليل |
|---|---|---|
| علم صريح `repostVoided` (افتراضي `false` = سلوك حرفي سابق) | `backend/accounting-routes.js:109،156-171،185-189` | 4 عبارات ثابتة `SQL_FIND_ANY/LIVE/VOID/REV_LIVE` + زوج بصمة `SQL_FP_CAND_ANY/LIVE` — لا قوالب مُستخرَبة، حصّة `sql-interp` بقيت 50 |
| المُستدعي البشري الوحيد | `backend/accounting-routes.js:649` (`POST /journal`) | عقد نصّي: `repostVoided:` تظهر مرة واحدة في `accounting-routes.js` وصفر في كل مسار آلي |
| كاشف إقفال اليوم يفرّق «بلا قيد» عن «مُبطَل بقرار» | `backend/cashier-module/day-close-routes.js:235-255،263-291،318` | `was_voided` + `continue` + `voidedSkipped` في الرد، وتحذير في السجل بالعدد |
| منسّق المالية: خمسة مصادر تُصنّف ولا ترحّل | `scripts/finance-reconcile.js:65،88،113،137،164` | خانة `voided` مستقلة في كل تقرير وفي الإجمالي — لا تُعدّ «أُصلح» |
| تقرير الأذون (`--apply`) لا ينقض الإبطال | `scripts/reconcile-dispatch-ledger.js:53،66-68` | `voided` خارج `todo` |
| جسر يارسوفت: لا تغيير سلوكي، توثيق النية | `backend/yarasoft/gl-bridge.js:107-113` | `NOT EXISTS` بلا فلتر حالة **هو** الحماية؛ وُثّق حتى لا «يُصلحه» أحد |
| عقود نصية + طعن غير مُفرَّغ | `tests/dispatch-financial-guards.test.js:79-133` | 13/13؛ الطعن يُزيل كل حماية واحدًا واحدًا ويُثبت سقوط العدّادات |
| عقود سلوكية على SQL حقيقي (مسبح في الذاكرة) | `tests/journal-void-repost-awareness.test.js` | 7/7. الطعن: قلب الافتراضي إلى `true` أسقط اختبارين ثم أُعيد الملف حرفيًا (sha256 `5aca01b1…` مطابق قبل وبعد) |
| V15 على staging | `tests/load/stageA-verify-journal-void.js:242-300` | إبطال ⇒ `voided=1`، الكاشفان يُصنّفان `was_voided=true`، إعادة الترحيل البشري ⇒ `A1-VOIDREPOST#r2` مع `posted=1 voided=1` وΔΣ المدين `0.00`. ZZ أعاد staging إلى أرقامه الأساسية: 35214 قيدًا، 70631 سطرًا، Σ مدين 7,153,341.89، وصفر صفوف في `journal_ledger_audit` |

**حصر آثار القراءة (`tests/load/gl-read-status-coverage.js`):** 47 كتلة قراءة —
مُفلترة 28→30، listing 14→13، ومراجعة يدوية 3→2. المتبقي مقروء ومُبرَّر:
`backend/cashier-module/pos-orders-history.js:864` يسرد سطور قيد مُختار بعد
فلترة `status='posted'` في السطر 845 (عرض لا تجميع)، و`gl-bridge.js:173` هو
المسار المتعمَّد المذكور في الجدول أعلاه.

**حدود معروفة (لا تُخفى):** الكاشفات تفحص مرجع المصدر نفسه، فلا ترى سطر المراجعة
`REF#r2` — الحماية هنا علامة `was_voided` لا العبارة، وهي مُثبَتة في V15e. ومسار
إلغاء البيع (`pos-orders-history.js:843-846`) لا يرى المراجعة أيضًا؛ لا خطر عملي
لأن `postSaleToLedger` لا يمرّر `repostVoided` أصلًا، فمرجع `pos_sale` لا يتفرّع.
ملفان لم ألمسهما لأنهما لجلسة أخرى، وفيهما الفجوة نفسها:
`scripts/accounting-reconciliation.js:106,114` (مُعدَّل الآن من جلسة أخرى: +5/−0) و
`scripts/repair-accounting-2026-10-31.js:71` (غير مُتتبَّع، تشغيل مرة واحدة).

## 9) بوابة jest الكاملة — تشغيل ناجز وفرز سطري (2026-11-06 07:31)

**متى جاز التشغيل**: لم تكن الجلسة السابقة تنتظر فراغًا، بل تنتظر حدثًا. تحقّقت
بالسؤال المباشر لقاعدة الاختبار قبل الإطلاق:

```
SELECT datname, count(*) FROM pg_stat_activity
 WHERE datname IN ('karim_erp_test','karim_erp_staging','karim_erp') GROUP BY datname;
→ karim_erp_test: صفر اتصال | karim_erp_staging: صفر اتصال | karim_erp: 4 (الخدمة الحيّة)
```

(ملاحظة ذنب: أربع عمليات node — تشغيلَا `npx jest` والابنان `jest.js` تحتهما — ما
زالت قائمة منذ 2026-11-02 17:58 و18:05 بلا أي اتصال مفتوح على القاعدة؛ أي أن
الحجز الذي انتظرتُه جولاتٍ لم يكن حجزًا فعليًّا في آخرها. لم أقتل شيئًا منها،
فليست لي.)

**الأمر**: `DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test
KARIM_TEST_DB_ISOLATED=1 PGHOST=127.0.0.1 node node_modules/jest/bin/jest.js
--silent --runInBand --forceExit`

**النتيجة**: `Test Suites: 9 failed, 310 passed, 319 total` ·
`Tests: 16 failed, 8 todo, 4574 passed, 4598 total` · `Time: 75.592 s` — exit=1.

**الفرز (كلّ سطر أحمر مُسند إلى صاحبه بالقياس لا بالحدس):**

| suite | فاشل | السبب الحرفي من اللوج | المِلك |
|---|---|---|---|
| `tests/encoding-hygiene.test.js` | 1 | `scripts/import-menu-from-yara.js:10` يحمل متنين صينيين (U+5165 U+9009) في تعليق — ملف غير متتبَّع | استيراد قائمة Yara |
| `tests/posting-matrix-engine.test.js` | 4 | توازن/إدّاء ماتريكس الطرح — ملف غير متتبَّع، موثّق أحمر من §3 سابقًا | جلسة أخرى |
| `tests/v2-report-presentation.test.js` | 1 | يتوقّع `prepareReportWorkbook(window.XLSX, wb,` في شاشة الحضور | attendance/V2 |
| `tests/v2-form-errors.test.js` | 1 | يتوقّع `for="v2att-sh-month"` في `attendance.js` (ملف حيّ) | attendance/V2 |
| `tests/v2-attendance-tools.test.js` | 4 | أدوات شاشة الحضور (كشك/كاميرا/ورديات) | attendance |
| `tests/payroll-absence-dayoff.test.js` | 1 | `absentDays` 25 مقابل 26 (يوم عطلة `day_off`) | attendance/payroll |
| `tests/cashier-sales.test.js` | 2 | عقد `loadSlip` + عقد ألوان `--erp-*` في طبقة الطباعة | توحيد الطباعة |
| `tests/realtime-scoped-emit.test.js` | 1 | `ENOENT: backend/attendance-push/processor.js` | **دليل على المحذوفات** |
| `tests/security-gate.test.js` | 1 | تجاوزا `html-unescaped`: `dashboard.js:543` (3/2) و`executive.js:106` (6/5) | جلسة أخرى |

**ملكي في هذه البوابة خالص الأخضر**: Suites الأربع التي تغطي سطح المرحلة A
ووعي الإبطال (`journal-void-only-policy`، `journal-void-repost-awareness`،
`dispatch-financial-guards`، `payroll-generate-period-a3`) مع المتجاورتين
(`accounting-cost-centers`، `finance-reconcile-safety`) = **6 suites / 42 اختبارًا
أخضر** (قياس مستقل بعد التشغيل الكامل، لا اقتباسًا من لوج كبير).

**أدنى عينة مشكوك فيها فُحِصت حتى الجذر — `tests/posting-matrix-engine.test.js`
(4 فاشلًا) ليس من عملي، والدليل ثلاثي:**
1. كلُّ فشلٍ يرمي من `backend/accounting-routes.js:208` داخل المعاملة الحقيقية، لأن
   الاختبار يمرّر `mockPool` بلا خاصية `release`، والفرع `if (db.query && !db.release)`
   (موجود في HEAD عند السطر 189 قبل عملي) يفتح عندها اتصالًا من المسبح الحقيقي. فالـmock
   لا يعترض شيئًا والكتابة تذهب إلى `karim_erp_test` فعلًا.
2. نصّ عبارة الفحص المسبق لم يتغيّر حرفيًّا: `git show HEAD:backend/accounting-routes.js`
   سطر 129 = `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2
   LIMIT 1`، وهو نفس نص `SQL_FIND_ANY` الذي وضعته في ثابت؛ والـmock يبحث عن
   `SELECT id, entry_no FROM ...` فلا يطابق أيًّا من الاثنين — أي أن فرع replay داخل
   الـmock كان ميتًا قبل عملي وبعده.
3. التلويث مقيَس على القاعدة، لا مُستنتَج: ثلاثة صفوف `posted` خلّفها تشغيلٌ واحد
   (بالبصمة الزمنية نفسها `2026-11-06 03:42:32`، قبل أول تعديل في وعي الإبطال
   03:59:52) لمعرّفات هذا الاختبار الثابتة بطبيعتها:
   `pos_sale|ORD-9901` و`delivery_sale|DEL-8801` و`pos_sale|ORD-DUP-01`
   (`JE-20261106-0001/2/3`) — فكل تشغيل لاحق يصطدم بـ`uq_journal_source` ويطرح 23505
   بعد ثلاث محاولات. والفشل الرابع ليس مرجعًا بل مفتاحًا خارجيًّا: `TR-7701` يمرّ بـ
   `FACTZZ` وهو مركز تكلفة وهمي لا وجود له في `cost_centers` (قياس: `MAIN/FACTZZ
   موجودة = 1 من 2`) فيسقط على `journal_lines_cost_center_code_fkey`.
   لذلك ارتفع الأحمر من «فشلان» (الملاحظة السابقة في §3) إلى أربعة: عدد المعرّفات
   الملوّثة زاد، لا السلوك تغيّر. **لا أحذف صفوف غيري ولا أُصلح ملف اختباره**؛
   الإصلاح لأصحابه: معرّف موسوم بكل تشغيل + محو في `finally` (كما فُعل في
   `purgeDispatchJournals`/`purgeJournalsHard` عندي).

**الفرز يُلغي «انتظار المالك» في البند السابق، ولا يُلغي حظر النشر**: الأحمر كله
لجلسات أخرى، لكنّه أحمر — لذا قاعدة «لا commit قبل بوابات خضراء» ما زالت قائمة،
وأصبح مطلوب المالك محصورًا في أربعة قرارات، لا في «متى يُشغَّل jest».

**أحمر غير مُحتسب أعلاه وظهر في رأس اللوج**: `scripts/frontend-version.js --check`
يقول «تغيّرت ملفات الواجهة بعد آخر زيادة» و«الإصدار في index.html (4.9.296) ≠
المسجَّل (0.0.1)»؛ ومع ذلك `tests/frontend-version.test.js` أخضر لأن العقد يكتفي
بالتنبيه. أي نشر لملفات الواجهة يستدعي `npm run frontend:version:bump` وهي ورقة
تتشاركها الجلسات المتوازية — لا أُطلقها في وسط تشغيلهنّ.

**تصحيح زمنِي على هذا الملف**: عناوين §7 (10:10) و§8 (11:40) ليست من ساعة هذه
الضيعة؛ القياس المتزامن الآن: نظام `2026-11-06 07:29 +0300` وPostgres `07:29:07
GMT+0300` بهامش `-0` دقيقة. الأرقام والمخرجات كلها مقيسة ومُعلَّبة كما هي؛ تُقرأ
تلك العناوين على أنها «جولتان قبل 07:25 من 2026-11-06» ولا تُقارن بزمن سجلات أخرى.


