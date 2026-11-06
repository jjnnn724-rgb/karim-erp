# خطة النشر إلى git — Phase A (2026-11-06)

الشجرة الحالية فيها عمل **غيري غير مُستلَّم**: مراجعة `git diff` على الملفات المشتركة
يُظهر جلسات موازية (attendance/FCM/V2 shell/items-only invoices/balance-sheet)،
فإضافة ملف كامل بـ`git add <file>` تسرق ذلك العمل وتنسبه لهذه الجلسة. الخطة التالية
تُنشر ما لهذه الجلسة فقط، بالاسم وبالكشف لا بالافتراض. **لا شيء نُفِّذ بعد — awaiting
موافقة المالك (القرار رقم 5 في `A_VERIFY_PHASE_A.md` §6).**

## 1) ما هو لي بالكامل (آمن: `git add <file>`)

| ملف | نوعه |
|---|---|
| `backend/journal-void.js` | جديد — نقطة التصحيح الوحيدة (عبارات SQL ثابتة) |
| `database/migrations/136_coa_journal_void_only.sql` + `_down` | جديد |
| `database/migrations/137_journal_void_audit.sql` + `_down` | جديد |
| `database/migrations/138_journal_lines_audit.sql` + `_down` | جديد |
| `tests/load/stageA-verify-journal-void.js` | جديد — V1–V14 على staging |
| `tests/load/stageA-apply-migrations.js` | جديد — تطبيق staging فقط (القاعدة مكتوبة نصيًّا) |
| `tests/load/stageA-bind-coverage.js` | جديد — ربط العبارات الستّ على مهاجرة/غير مهاجرة |
| `tests/journal-void-only-policy.test.js` | جديد — عقد السياسة النصّي (6 اختبارات) |
| `tests/payroll-generate-period-a3.test.js` | جديد — عقد A3 (5 اختبارات، مُتحقق من أنها تعضّ) |
| `tests/journal-void-repost-awareness.test.js` | جديد — عقد §8 السلوكي (7 اختبارات + طعن sha256) |
| `docs/coa-audit-2026-11-05/*` (23 ملفًا) | جديد — تقرير المرحلة 0 + سجل التنفيذ |

## 2) ما مختلط (يُنشر بالـhunk لا بالملف)

قياس فعلي لعدد الـhunks الخاصة بالمرحلة A من إجمالي الـhunks في الملف، مع
`git apply --check --cached` على patch مُصفّى (نتيجته OK للجميع — الفهرس لم يُمسّ):

| ملف | hunks لي | hunks في الملف | dry-run |
|---|---|---|---|
| `backend/server.js` | 8 | 29 | OK |
| `backend/accounting-routes.js` | 6 | 11 | OK (أُعيد القياس بعد §8 — كان 2/5) |
| `backend/cashier-module/day-close-routes.js` | 4 | 4 | OK |
| `backend/yarasoft/gl-bridge.js` | 1 | 1 | OK |
| `scripts/finance-reconcile.js` | 6 | 6 | OK |
| `scripts/reconcile-dispatch-ledger.js` | 2 | 2 | OK |
| `backend/hr-routes.js` | 1 | 16 | OK |
| `backend/procurement-routes.js` | 1 | 1 | OK |
| `backend/warehouse/inventory-routes.js` | 1 | 9 | OK |
| `backend/warehouse/purchase-void-routes.js` | 3 | 3 | OK |
| `database/scripts/run-migration.js` | 3 | 3 | OK |
| `electron/main.js` | 1 | 6 | OK |
| `scripts/shared.js` | 2 | 2 | OK |
| `scripts/install.js` / `scripts/acceptance-auth-flow.mjs` / `scripts/acceptance-postgres-init.mjs` | 1 | 1 | OK |
| `tests/dispatch-financial-guards.test.js` | 4 | 5 | OK (hunk خامس لجلسة أخرى) |
| `tests/accounting-cost-centers.test.js` | 3 | 1 | OK **بآلية التطبيع أدناه فقط** (patch الملف العادي = churn) |
| `tests/expanded-pos-scenarios.js` | 2 | 1 | OK بنفس الآلية |

> **فخّ نهاية السطر (اكتُشف 2026-11-06 07:30).** المستودع يُصرّح في `.gitattributes`
> «لا تحويل لنهايات الأسطر إطلاقًا» (`core.autocrlf=false`) لأن سياسة `eol=crlf` جُرّبت
> سابقًا ورُدّت: كانت تُعيد كتابة ملفات القوالب وتكسر العقود التي تقرأ `\n` حرفيًّا.
> اثنان من ملفات الجدول أعلاه كُتبا في الشجرة بـCRLF بينما HEAD عندهما LF، فصار الـdiff
> كامل-الملف hunk واحدًا خادعًا: `accounting-cost-centers.test.js` HEAD{LF:123} →
> العمل{CRLF:141}، و`expanded-pos-scenarios.js` HEAD{LF:265} → العمل{CRLF:281}.
> تطبيق ذلك الـhunk بـ`git apply --cached` يستلّم 141/281 سطرًا من churn لا علاقة لها
> بالمرحلة A ويخالف السياسة. القياس الصحيح بـ`git diff -w --ignore-cr-at-eol` يُظهر
> أن المحتوى الحقيقي لي فيهما 3 hunks و2 hunks بالترتيب (جميعها بوابة المحو 136:
> `purgeDispatchJournals`/`purgeJournalsHard` + مواضع استدعائها).
> المسار الآمن لملف كهذا: `git show HEAD:<f> > base` ← `sed 's/\r$//' <f> > wt_lf` ←
> `diff -u --label a/<f> --label b/<f> base wt_lf > p` ← `git apply --cached p` ←
> التحقق أن الـblob المُستلَّم LF وأن `git diff --cached --stat` عدديًّا صغير.
> **الآلية مُجرَّبة الآن بـ`--check` فقط (07:36، الفهرس بقي فارغًا بعد التشغيلين)**:
> `tests/accounting-cost-centers.test.js` → 3 hunks و`apply --check --cached` = OK
> (blob مُطبَّع متوقَّع `8a3de501` من base `03c3dd81`)؛ `tests/expanded-pos-scenarios.js`
> → 2 hunks وOK (blob متوقَّع `e15de74a` من base `036061e3`). عند الاستلام الحقيقي
> يجب أن تُقرأ الأرقام **24/6 و20/4** لا 141/123 و281/265 — وأي قراءتك للأكبر تعني
> أن الـpatch وُلّد من `git diff` العادي وأن churn نهاية السطر دخلت الـcommit.
> المسح الكامل للشجرة (قياس 07:33؛ الشجرة حيّة فأرقامها تتحرّك): **11 ملفًا من 388**
> مُعدَّلة وفيها churn نهاية سطر — سبعة منها `frontend` لجلسات أخرى
> (`js/core/print-branding.js`، `js/features/auth-navigation.js`، `js/features/hr.js`،
> `js/features/kitchen.js`، `js/features/smart-card.js`، `js/v2/print-branding.js`،
> `js/v2/screens/zkteco.js`)، واثنان اختبارات لجلسات أخرى
> (`tests/v2-cost-analysis-ui.test.js`، `tests/v2-registers.test.js`)، والملفَّان
> الباقيان هما ملفايا أعلاه. لا أُصحّح نهاية سطر ملفًا لجلسة أخرى ولا أُنظّم الشجرة
> سرًّا؛ بل أُنَبِّه وأستلّم محتواي فقط.

المسار الآمن لكل ملف مختلط: `git diff -- <file>` ← تصفية الـhunks بعلامات المرحلة A
(`journal-void|void*Journal|nextRevisionSourceId|allow_hard_delete|isRollbackMigration|
purgeDispatchRelated|assertPeriodOpenInTx|repostVoided|SQL_FIND_|SQL_FP_CAND_|was_voided|
voidedSkipped|Voided\+\+|totalVoided|وعي الإبطال|إبطال`) ← `git apply --cached <patch>` ←
فحص `git diff --cached` بصريًّا قبل الـcommit. الباقي في الشجرة يبقى غير مُستلَّم كما هو.
**الأداتان المستعملتان للقياس لا تُعدّلان الفهرس** (`--check` فقط)، وكلتا تشغيلتي
العدّ والتصفية أُعيدتا بعد §8 لأن أرقام العمود كانت من جولة سابقة.

## 3) ما لا يُنشر إطلاقًا من هذه الجلسة

- `scripts/_tmp-audit-fabricated.js` — **ملف غير مُتتبَّع لجلسة أخرى** (تدقيق حضور
  قراءة فقط، 2026-11-05 08:08). نُظّفت مخالفة `sql-interp` فيه حرفيًّا (وسيط `$1`
  بنفس الدلالة) لأن البوابة كلها كانت ستبقى حمراء، لكن صاحبه هو من يقرر حفظه أو حذفه؛
  لا أنشره ولا أُدين به.
- أي ملف `frontend/app/**` — لم ألمس شيئًا، فلا داعي لـ`frontend:version:bump`.

## 4) الترتيب المقترح للـcommits (واحد لكل بند، بلا `git add -A`)

1. `backend/journal-void.js` + migration 136/137 + الـhunks الأمامية في `server.js`
   و`accounting-routes.js` و`procurement-routes.js` و`purchase-void-routes.js`
   و`inventory-routes.js` — «لا مسار يمسح قيدًا مرحّلًا».
2. `backend/hr-routes.js` (hunk A3) + `tests/payroll-generate-period-a3.test.js` —
   «توليد المسير لا يسقط بـ42703».
3. migration 137/138 + `electron/main.js`/`scripts/*` (حارس `_down`) — «سجل الدفتر
   ومنع تطبيق ملفات الرجوع».
4. `tests/load/stageA-*` + `tests/journal-void-only-policy.test.js` +
   `tests/dispatch-financial-guards.test.js` + تنظيفات `accounting-cost-centers` /
   `expanded-pos-scenarios` — «أدلة التحقق والعقود».
5. `docs/coa-audit-2026-11-05/` — «سجل المرحلة 0 وA».

قبل كل commit: `node scripts/security-gate.js` + `node scripts/lint-gate.js` +
`node --test`-style تشغيل الـsuites النصية المعنية، وبعده `git show --stat` للمطابقة.
**push لا يكون إلا بعد قرار المالك** (القناة الحالية snapshot بسبب Blobs >100MB).

## 5) ما زال يسبق أي commit

+ **بوابة الأمان حمراء الآن ولا علاقة لهذا العمل بها**: `node scripts/security-gate.js`
  ترجع فشلًا بـ2 تجاوزين في حصّة `html-unescaped` بملفين لجلسة أخرى (إعادة قياس
  2026-11-06 07:38): `frontend/app/js/v2/screens/dashboard.js:543` (3 مواضع مقابل حصّة
  2؛ كانت 536 قبل دقائق — الملف يتغيّر الآن) و`frontend/app/js/v2/screens/executive.js:106`
  (6 مقابل 5). وكلاهما `M` في الشجرة.
  `sql-interp` عندي بقيت عند الأساس 50 ولم يُعدَّل الأساس. أي commit من هذه الجلسة
  يسبق إصلاح هذين (أو رجوع صاحبيهما) يُسجَّل كمخالفة على عاتقها — فالمطلوب من
  المالك: إمّا إمساك الجلستين بهما، أو قرار استثناء مؤقّت، ولا أستعمل `--no-verify`.
+ بوابة jest الكاملة **شُغِّلت** (2026-11-06 07:31، حين أظهر `pg_stat_activity` صفر
  اتصالات على `karim_erp_test`): `310/319 suite` و`4574/4598` اختبارًا أخضر، و9
  suites حمراء مفصولة سطرًا بسطر في `A_VERIFY_PHASE_A.md` §9 — كلها لجلسات أخرى.
  الأحمر البنيوي الذي يبقى: `tests/posting-matrix-engine.test.js` يمرّ بمسبح حقيقي
  رغم `mockPool` (فرع `db.query && !db.release`) فيلوّث القاعدة بمعرّفات ثابتة؛
  ثلاثة صفوف `posted` من 03:42:32 ما زالت هناك (`ORD-9901`/`DEL-8801`/`ORD-DUP-01`)
  ولا أمحوها لأنها ليست قيودي ولا قرارى — تُذكر لأصحاب الاختبار ليُوسَم معرّفُه
  بكل تشغيل.
+ **فخّ نهاية السطر في ملفَّين من خطتي (§2)** — لا يُستلَّم patch الملف كما يُولّده
  `git diff` وإلا دخلت 141+281 سطرًا من churn تخالف سياسة `.gitattributes`؛ المسار
  الصحيح مُفصَّل في §2 ومطلوب تنفيذه بحرفيته عند أول commit يمسّ
  `tests/accounting-cost-centers.test.js` أو `tests/expanded-pos-scenarios.js`.
+ **حذف 22 ملفًا متتبَّعًا في الشجرة ليس من هذه الجلسة** (قياس 07:34، الفهرس نظيف
  `staged=0` فالحذف غير مُستلَّم بعد): وحدة `backend/attendance-push/` كاملة
  (`index/processor/queue/routes/schema/worker/device-auth` = 7)، وسبعة في `tests/`
  (`attendance-classify-openrow`، `attendance-dup-anchor`، `attendance-grace-threshold`،
  `attendance-lone-checkout`، `attendance-reconcile-double-use`، `punch-cooldown-guard`،
  `punch-dedup-guard`)، وثمانية في `scripts/` (`attendance-backfill`،
  `attendance-shift-mismatch`، `fix-null-checkins`، `reconcile-portal-punches.js`،
  `reconcile-portal-punches-task.bat`، `zk-close-stale`، `zk-reconcile`،
  `_tmp-find-empty-catch.js`) ⇒ 7+7+8 = 22. كلها عمل جلسة attendance/FCM. لا أُعيد
  إنشاءها ولا أستلّم حذفها؛ تُذكر للمالك لأن حذف اختبارات حرسة
  (punch-cooldown/punch-dedup) وإسقاط وحدة تشغيل كاملة قرارٌ ليس لي، ولو استُلِّم
  بالخطأ مع دفعتي لكان حذفًا صامتًا لميزانية حيّة.
+ **بوابة lint (`node scripts/lint-gate.js`) حمراء، والفرز مُنجَز ومُصحَّح بقدر ما
  هو لي** (قياس 2026-11-06 07:25 بالتوقيت المحلي):
  - ما كان لي وأُغلق: 4 تحذيرات `curly` وخطأ `preserve-caught-error` واحد —
    `tests/journal-void-only-policy.test.js:28,60`،
    `tests/load/gl-read-status-coverage.js:37`،
    `tests/load/stageA-verify-journal-void.js:39` (صار `throw new Error(..., { cause: e })`)،
    وتحذير `no-unused-vars` في `tests/accounting-cost-centers.test.js:43` (الـhunk
    الخاص بي هناك: `purgeDispatchJournals` بعد 136). بعد الإصلاح: الأربعة ملفات
    نظيفة تمامًا (`errs=0 warns=0`)، والعقود النصية ما زالت 26/26، وحصار القراءة
    أعاد نفس الأرقام 47 كتلة ⇒ 30/13/2.
  - الباقي ليس لي ولا يلمس هذه الجلسة: خطأ `no-undef` في
    `frontend/app/js/v2/screens/attendance.js:1120` (`doExport` غير معرَّف؛ الملف
    يتغيّر الآن — آخر mtime 07:23:50 قبل القياس بدقائق) وخطأ `no-useless-escape` في
    `scripts/check-secrets.js:79` (تعديل N3 بتاريخ 2026-11-04 04:56، لم تلمسه هذه
    الجلسة)، و36 تحذيرًا في ملفات غير متتبَّعة لجلسات أخرى (`scripts/_tmp-*`
    25، `scripts/_tb_baseline.js` 1، `scripts/gen-m3-palette.js` 3،
    `tests/posting-matrix-engine.test.js` 4، `tests/unit/coa-foundation.test.js` 1)
    و6 في ملفات `M` لجلسات أخرى (`backend/hr-routes.js` 2: `makeEmitScoped` السطر
    10 و`riyadhNowParts` السطر 113 — كلاهما خارج الـhunk الخاص بي؛
    `attendance.js` 4).
  - المجموع بعد إخلاء نصيبي: 40 تحذيرًا وخطآن، والأساس صفر. **لا رُفع
    `scripts/lint-baseline.json` ولا عُطِّلت القاعدة ولا استُعمل `--no-verify`** —
    الأحمر يبقى مرئيًّا حتى تُغلقه جلساته.
