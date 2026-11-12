# GATE 03 — تنفيذ البنية التحتية للامتثال (هجرة 145 + مسارات + قسم V2)

- **التاريخ:** 2026-11-10
- **الحالة:** منفَّذ ومُتحقَّق في المستودع وقاعدة الاختبار — **بانتظار موافقة المالك**
  لتطبيق 145 في الإنتاج وإعادة تشغيل الخدمة.
- **لم يُنفَّذ (مقصود):** أي تطبيق هجرة على الإنتاج، أي إعادة تشغيل للخدمة،
  أي نشر، أي commit، أي push، أي إرسال خارجي لأي جهة.

## 1. الملفات

| الملف | الحالة | الغرض |
|---|---|---|
| [database/migrations/145_integration_infra.sql](../../database/migrations/145_integration_infra.sql) | جديد | 4 أنواع + 4 جداول integration_* + مشغّلات append-only/immutability + بذور التصنيف |
| [database/migrations/145_integration_infra_down.sql](../../database/migrations/145_integration_infra_down.sql) | جديد | رجوع مرتب بلا CASCADE، مع تحذير سجل التسليم |
| [backend/integration/lib.js](../../backend/integration/lib.js) | جديد | ثوابت ودوال نقية: بوابة VERIFIED، مفتاح إعادة ≤200 حتمي، maker-checker، أشكال عامة |
| [backend/integration/routes.js](../../backend/integration/routes.js) | جديد | 8 مسارات تحت /api/integration (قراءة/كتابة إدارية فقط، لا إرسال) |
| [backend/permissions.js](../../backend/permissions.js) | تعديل | 4 مفاتيح امتثال + `SOD_CONFLICTS` + `sodConflict()` |
| [backend/permission-routes.js](../../backend/permission-routes.js) | تعديل | رفض 409 `SOD_CONFLICT` عند جمع مهام متعارضة |
| [backend/server.js](../../backend/server.js) | تعديل (3 أسطر) | `app.use('/api/integration', …)` بعد /api/system |
| [frontend/app/js/v2/data/integration-repo.js](../../frontend/app/js/v2/data/integration-repo.js) | جديد | مستودع V2 للمسارات (بلا قراءة اعتماد) |
| [frontend/app/js/v2/screens/compliance.js](../../frontend/app/js/v2/screens/compliance.js) | جديد | قسم الامتثال: بطاقات المزوّدين، عدّادات التسليم، الميت وإجراءاته، الأحداث |
| [frontend/app/js/v2/screens/settings.js](../../frontend/app/js/v2/screens/settings.js) | تعديل | ربط القسم بصلاحية `compliance.view`، تحميل عند الطلب، وتنظيف عند destroy |
| [tests/integration-compliance.test.js](../../tests/integration-compliance.test.js) | جديد | 17 اختبارًا: دوال نقية + مسارات على قاعدة الاختبار |
| [tests/v2-compliance.test.js](../../tests/v2-compliance.test.js) | جديد | 8 اختبارات عقد للمستودع والشاشة والربط |

## 2. واجهة API (كلها `Cache-Control: no-store` + JWT)

| المسار | الدور/الصلاحية | ملاحظات |
|---|---|---|
| `GET /api/integration/health` | admin/manager أو `compliance.view` | تصنيف المزوّدين + عدّادات الصادر + حالة ZATCA (قراءة فقط إن وُجد الجدول) |
| `GET /api/integration/providers` | `compliance.view` | بلا `evidence_url` |
| `PUT /api/integration/providers/:code/settings` | admin أو `compliance.configure` | تفعيل يتطلب VERIFIED وإلا 409 `PROVIDER_NOT_VERIFIED` |
| `PUT /api/integration/credentials/:provider/:key` | `compliance.configure` | write-only، يتطلب `VAULT_KEY` ≥32 وإلا 503، لا يعيد السر ولا الشيفرة |
| `GET /api/integration/outbox` | `compliance.view` | بلا `payload` أو `last_error_sha256` |
| `POST /api/integration/outbox/:id/retry` | admin أو `compliance.submit` | failed/dead_letter فقط؛ صف جديد بمفتاح `:retry:N` |
| `POST /api/integration/outbox/:id/review` | admin أو `compliance.review` | dead_letter فقط؛ retry/abandon بسبب ≥3؛ 409 `SELF_REVIEW_FORBIDDEN` لغير admin |
| `GET /api/integration/events` | `compliance.view` | بلا `error_message` / `response_excerpt` |

## 3. الصلاحيات وفصل المهام (ADR-005)

- `compliance.view` — عرض الحالة والتسليم.
- `compliance.configure` — إعدادات المزوّدين وكتابة الاعتمادات.
- `compliance.submit` — إعادة المحاولة.
- `compliance.review` — مراجعة الميت واعتماد الاستثناءات.
- أزواج متعارضة تُرفض عند المنح (409): (configure, submit) · (configure, review) · (submit, review)،
  والمسحوب (`deny`) لا يُحسب ضمن الفعال.
- maker-checker وقت التنفيذ: منشئ الصف لا يعتمده (admin مستثنى بحكم السيادة).

## 4. التحقق المنفَّذ (أدلة)

| البوابة | النتيجة |
|---|---|
| `node --check` على كل ملفات backend/tests والوحدات الثلاث ESM | ✅ |
| `eslint` على الملفات المتغيرة/الجديدة | ✅ بلا ملاحظات |
| `jest tests/integration-compliance.test.js` | ✅ 17/17 |
| `jest tests/v2-compliance.test.js` | ✅ 8/8 |
| `jest tests/v2-settings.test.js` | ✅ 7/7 |
| `jest tests/permissions.test.js` | ✅ (عقد المفاتيح يقبل المفاتيح الجديدة) |
| `tests/phase2-rate-limiter` + `phase6b-server-boot` + `security-rbac-hardening` | ✅ |
| `node scripts/frontend-version.js --bump` ثم `--check` | ✅ 4.9.310 |
| هجرة 145 على `karim_erp_test` | ✅ الجداول الأربعة موجودة (providers=4 بذور) |

- **إعادة تشغيل اختبار الحزمة الخلفية آمنة:** الهجرة idempotent، والاختبار يطبّقها
  تلقائيًا إن غابت. صفوف الاختبار تبقى في `karim_erp_test` لأن
  `integration_events` يرفض الحذف بمشغّل (ADR-010) — كل صف موسوم `gate03-`.
- **أُصلح:** `tests/encoding-hygiene.test.js` كان يرصد متنًا شرق آسيويًا في تعليق
  `scripts/import-menu-from-yara.js` ومرجعه في هذا السجل؛ استُبدل النص بعبارة عربية.

## 5. خطوات التفعيل (تحتاج موافقة منفصلة)

1. نسخة احتياطية موثقة + التحقق من الاستعادة.
2. تطبيق `145_integration_infra.sql` على الإنتاج (additive فقط، لا يمس جدولًا قائمًا).
3. التأكد من `VAULT_KEY` في `.env` (≥32 حرفًا) قبل أي كتابة اعتماد.
4. إعادة تشغيل الخدمة (مطلوبة لتحميل المسار الجديد).
5. منح `compliance.view` للمديرين المعنيين؛ والكتابة/الإرسال/المراجعة لمستخدمين
   منفصلين (SoD يمنع الجمع).
6. فتح الإعدادات → «الامتثال السعودي»: كل المزوّدين غير مفعّلين لأن لا تصنيف VERIFIED بعد.

## 6. حدود المرحلة

- لا إرسال خارجي؛ الصادر يُنشأ ويُدار فقط.
- ZATCA: لازال UNVERIFIED في السجل (كود قائم، لا إثبات قبول إنتاجي).
- MUDAD: BLOCKED (لا واجهة عامة موثقة) — لا عمل عليه.
- 146 (سلسلة فواتير ZATCA) باقية مسودة في `docs/phase-0/drafts/` ولم تُنقل للمستودع.
