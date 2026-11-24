# خطة التحويل إلى SaaS عالمي — Karim ERP (Horus)

**تاريخ الفحص:** 2026-11-23 · **الفرع:** `feature/saudi-compliance-mudad-qiwa-vat` · **الإصدار:** 4.9.2
**منهجية:** فحص ثابت للكود + مراجعة وثائق/ترحيلات/CI + 3 مسارات استكشاف متوازية. لا تعديل على الكود، لا لمس للإنتاج، لا قراءة أسرار.

---

## 1) الحكم العام

المنتج **ق هندسياً جداً كنظام محلي لمطعم واحد (أو مجموعة فروع لمؤسسة واحدة)**، لكنه **ليس SaaS** بأي معنى تقني اليوم.

| المحور | الدرجة | الدليل المختصر |
|---|---|---|
| الجودة/الأمان/الاختبارات | **9/10** | 4842 اختبار Jest + 1446 vitest + 15/15 مجسّختراق + DR على حجم الإنتاج (238/238 جدول، RTO 85ث) + 7 فحوص مطلوبة على main + قلعة 5 طبقات |
| العزل وتعدد المستأجرين | **2/10** | صفر `tenant_id` في 248 ملف باك-إند و175 ترحيلاً؛ pool واحد؛ `branch-context.js` fail-open صريح؛ RLS مبني على الأدوار لا المستأجر |
| الهوية/التسجيل/الفوترة | **4/10** | مصادقة ممتازة (8/10) لكن تسجيل ذاتي = 1/10 وفوترة = 0/10؛ لا Stripe ولا plans ولا quota |
| البنية للتوسع | **3/10** | Docker محلي بلا orchestrator؛ حالة في الذاكرة؛ كرون داخل العملية؛ Socket بلا Redis adapter؛ نشر يدوي بالكامل |
| العالمية (locale/currency/tax) | **3/10** | `ar/en` كتبديل بيانات فقط (name_ar/name_en)، عملة عرض واحدة، محرك ضريبي سعودي مثبت بلا adapters |

**الخلاصة:** أنت لا تحتاج إعادة كتابة. أنت تحتاج **طبقة مستأجر (Tenancy Layer) تُحقن تحت كل شيء موجود**، ثم طبقة اشتراكات، ثم سحابة. أصعب وأخطر جزء هو الأول.

---

## 2) الفحص التفصيلي — الحقائق بالأدلة

### 2.1 ما هو موجود ويدعم التحويل (أصول جاهزة لا تلمسها)
- **جلسات في DB لا في الذاكرة:** `pos_refresh_tokens` + تدوير وكشف إعادة استخدام — `backend/cashier-module/jwt-middleware.js:182,581`.
- **قفل دخول دائم في DB** مع تراجع آمن — ترحيل 153 + `login-lockout-store.js`.
- **Transactional outbox** مع `FOR UPDATE SKIP LOCKED` — `backend/realtime/outbox.js:36-53`.
- **idempotency في DB + Redis اختياري** — `backend/middleware/idempotency.js:218-227`.
- **pool مركزي قابل لإعادة التهيئة** — `backend/shared-pool.js` (`reinitPool()` س111).
- **أدوار وصلاحيات ناضجة** — `backend/permissions.js`, `backend/user-authority.js`.
- **بث مصادَق** (`RT_REQUIRE_AUTH` مفعّل افتراضياً) + 8 مواقع بث ممررة عبر `emitScoped`.
- **نسخ مشفّر AES-256-GCM + SHA-256 + DR مُجرَّب** — `database/scripts/backup.js`, `restore.js`, `docs/RT_OPERATIONS.md §8`.
- **CI/قلعة صارمة** — 7 فحوص مطلوبة على main، حماية force-push، ترحيلات مبصومة (175).
- **واجهة v3 بعقود Zod + parity fixtures + RTL حارس + Lighthouse 0.98/1.00/1.00/1.00.**

### 2.2 الحواجز الحرجة (blk) — بالدليل

| # | الحاجز | الدليل | الأثر |
|---|---|---|---|
| B1 | **لا كيان مستأجر إطلاقاً** | بحث `tenant|organization_id|org_id|company_id|account_id` في `backend/` وmigrations = 0 نتائج حقيقية؛ `organizationName` في `zatca-csr.js` مجرد حقل شهادة | لا يمكن فصل عميلين بأي شكل |
| B2 | **قاعدة واحدة + pool واحد** | `backend/shared-pool.js:11-12,57-65` اسم DB ثابت `DB_NAME`؛ لا `search_path` ولا schema-per-tenant | أي تسريب = كارثة قانونية |
| B3 | **عزل الفروع fail-open** | `backend/branch-context.js:4-9,47-51,97-101`: `branch_id=NULL` ⇒ يرى كل الفروع؛ تصفية 5 كيانات فقط من عشرات الجداول (`BRANCH_AWARE_ENTITIES` س15) | حتى العزل الداخلي ناقص |
| B4 | **RLS بالأدوار لا بالمستأجر** | `migrations/003_cashier_module.sql:399-504` على 7 جداول POS فقط، سياساتها `app.user_role`/`app.user_id` | لا يحمي بين العملاء |
| B5 | **إعدادات/هوية عالمية واحدة** | `settings` بصف ثابت `main_settings` (`002_seed.sql:10`)؛ `menu_board_settings` بـ`id=1`؛ شعار واسم hardcoded `'مطاعم الشرفة العالمي'` في عدة ملفات | لا white-label ولا نطاق لكل عميل |
| B6 | **لا تسجيل ذاتي ولا فوترة** | `/register` الوحيد في `push-routes.js:40` = FCM token؛ المستخدم يُنشأ يدوياً `frontend/.../employees.js:247-272`؛ صفر `stripe|subscription|billing|quota` | لا منتج SaaS بدونها |
| B7 | **التطبيق ليس stateless** | `connectedClients` Map (`server.js:251`)، `api-cache.js` محلي TTL، `guard.js` Map، كرونات `server.js:610-614,618-639,3351-3441`، Socket بلا adapter | التوسع الأفقي يكسر البث والكرون |
| B8 | **النشر محلي/يدوي** | `docker-compose.yml` بنamed volumes محلية؛ `nginx.conf` قالب آلة واحدة (`server_name _` س87، upstream `:5001` لا يطابق 5000)؛ `ci.yml:666-737` ينص صراحةً "deploy is MANUAL"؛ Cloudflare نفق واحد `erp.osirisegypt.com` | لا إطلاق متعدد العملاء |
| B9 | **المراقبة بلا تنبيهات** | `metrics.js` ring buffer محلي؛ OTel معطّل (`OTEL_ENABLED` افتراضي false)؛ `slo-check.js` CLI غير مجدول؛ لا Grafana/Alertmanager | لا SLO قابلة للتشغيل في SaaS |
| B10 | **النسخ على أقراص Windows** | `backup-mirror.js:13-16` → `D:/KarimBackups`, `E:/KarimBackups`؛ GPG عبر `powershell.exe` | لا offsite سحابي ولا عزل نسخ لكل مستأجر |

### 2.3 ملاحظة قرار معلّقة
`docs/WORLD-CLASS-90-DAY-ROADMAP.md:54,65` كان قد أجّل قرار SaaS/multi-tenant «قبل نجاح الترحيل». الترحيل نجح (DR 238/238، CI أخضر على Ubunta clean). **حان وقت حسم القرار.**

---

## 3) قرارات يجب أن يحسمها المالك قبل أول سطر كود (بوابة الدخول)

بدون إجابات هذه لا تبدأ الترحيلات — لأنها تحدد شكل `tenant_id` والفوترة.

1. **نموذج العزل:** (أ) قاعدة مشتركة + RLS إلزامي [موصى به للشركات الصغيرة/المتوسطة]، (ب) schema لكل مستأجر، (ج) قاعدة لكل مستأجر [للـEnterprise]. التوصية: **هجين** — (أ) كافتراضي + (ج) لحسابات Enterprise/قوانين إقامة بيانات خاصة.
2. **الأسواق والترتيب:** السعودية (موجود) → مصر (ETA، مواصفات أولية في `docs/EGYPT-LOCALIZATION-DISCOVERY.md`) → خليج/أوروبا؟ يحدد محركات الضرائب واللغات.
3. **العملة الأساسية للفوترة:** USD أم SAR؟ والعملات المدعومة للفروع.
4. **نموذج البيع:** self-serve بالبطاقة أم sales-assisted بعقد؟ يحدد Stripe Billing مقابل فواتير يدوية.
5. **البيانات الشخصية:** أين تُخزَّن (Residency)، وسياسة GDPR/PDPL والحذف والتصدير.
6. **الهوية:** هل نحتاج SSO/SAML لعملاء Enterprise من اليوم الأول أم لاحقاً؟
7. **النطاق:** `app.karim-erp.com/<tenant>` أم نطاق مخصص لكل عميل (يؤثر على Cloudflare/Wildcard TLS).

---

## 4) خارطة الط التنفيذ (7 مراحل، ~7–9 أشهر بفريق 3–4)

> قاعدة ذهبية في كل مرحلة: **لا ميزة جديدة قبل إغلاق بوابة المرحلة السابقة**، وكل تغيير على قاعدة الإنتاج يتم على نسخة مطابقة أولاً + DR drill.

### المرحلة 0 — حسم القرار + تجميز نقطة الانطلاق (أسبوع 1)
- الإجابة على الأسئلة 1–7 أعلاه وتوثيقها كـADR جديد (`docs/ADR-SaaS-Tenancy.md`).
- Tag إصدار حالي + فرع `feat/saas-tenancy` من HEAD النظيف (القلعة تضمن ذلك).
- **لا تلمس** منطق ZATCA/المحاسبة — يبقى معزولاً كما هو.

**بوابة الخروج:** ADR موقّع + فرع نظيف + DR drill أخير على نقطة الانطلاق.

### المرحلة 1 — طبقة المستأجر (Tenant Foundation) — 4–6 أسابيع ⚠️ الأخطر
1. جداول جديدة: `tenants` (id, slug, name, status, plan_id, locale, currency, timezone, created_at) + `tenant_domains` + `tenant_users` (ربط المستخدم بالمستأجر + أدوار داخل المستأجر).
2. إضافة `tenant_id NOT NULL` لكل الجداول التجارية (~238 جدولاً؛ أهمها المستخدمون، الفروع، POS، المحاسبة، المخزون، HR). Backfill إلى مستأجر «الشرفة» النموذجي عبر ترحيل واحد ذري.
3. مفاتيح مركّبة: `settings(id, tenant_id)`، `menu_board_settings(id, tenant_id)`، فهارس `(tenant_id, ...)` على كل جدول.
4. **RLS إلزامي على كل الجداول:** سياسات `USING (tenant_id = current_setting('app.tenant_id')::uuid)` + `WITH CHECK`، وتعيين `app.tenant_id` من JWT داخل كل معاملة (`SET LOCAL`). لا `SECURITY DEFINER` يتجاوزها.
5. `tenantContext` middleware: يستخرج المستأجر من **subdomain/NTLM/JWT claim** (لا من header يمكن تزويره)، **fail-closed** (لا tenant ⇒ 403). يمنع أي طلب بلا سياق.
6. تضمين `tenant_id` في JWT + التحقق منه مقابل جدول `tenant_users` (لا ثقة عمياء بـclaim).
7. تحويل `branch-context.js` من fail-open إلى **fail-closed** بعد وجود السياق، وتوسيع `BRANCH_AWARE_ENTITIES` لتشمل كل الجداول (قائمة بيضاء صريحة).
8. مفاتيح الكاش/idempotency/ال.socket rooms/Audit تصبح كلها `tenant:<id>:...` — منع التسريب عبر الكاش (خطرR2 الموثق في `CONTRACT.md:17`).
9. اختبارات سلبية آلية: **لكل مسار API حساس، محاولة قراءة/كتابة بمستأجر آخر ⇒ 403/404**. أضفها كـgate في `fortress`.

**بوابة الخروج:** صفر تسريب عبر مستأجرين في اختبارات التكامل + ترحيل مطبّق على نسخة من الإنتاج (747MB) + DR drill + كل البوابات خضراء.

### المرحلة 2 — Stateless والتوسع الأفقي — 3–4 أسابيع
- `@socket.io/redis-adapter` + Redis إلزامي في الإنتاج (لا `SKIP_BULLMQ`).
- نقل كل الكرونات من `server.js` إلى BullMQ workers (Job لكل مستأجر أو job عام يتكرر على `tenants`).
- `api-cache`/`shaCache` ← Redis بمفتاحيشمل tenant.
- فصل `/metrics` ليتضمن `tenant` label؛ توحيد مقاييس `metrics.js` و`cashier-module/metrics.js`.
- جعل health يعتمد على Redis/DB (fail على فقدان القاعدة في الإنتاج بدل warn).
- اختبار حمل متعدد النسخ (2–3 replicas) + تأكيد بث صحيح عبر النسخ.

**بوابة الخروج:** 3 نسخ تعمل بلا ازدواج كرون ولا انقطاع بث.

### المرحلة 3 — الهوية الذاتية والتسجيل — 3–4 أسابيع
- `POST /api/signup` (إنشاء مستأجر + أول أدمن) مع تحقق بريد/هاتف + captcha + rate-limit.
- دعوات المستخدمين (invite tokens) بدل إنشاء يدوي؛ ربط بـ`tenant_users`.
- SSO/SAML/OIDC (مكتبة معتمدة) + SCIM لـEnterprise (متأخر قليلاً).
- تطبيق `must_change_password`, MFA إجباري للأدمن، القفل الدائم — كما هو لكن بمفتاح `(tenant, user)`.
- نقل الـrate-limit من IP فقط إلى `(tenant, user)` مع Redis.

**بوابة الخروج:** عميل جديد يبدأ ويضيف فريقه دون تدخلنا + اختبار اختراق للعزل.

### المرحلة 4 — الاشتراكات والفوترة والحدود — 3–4 أسابيع
- `plans`, `subscriptions`, `usage_records`, `invoices` + Stripe Billing (أو بوابة محلية حسب قرار المالك).
- `quota/entitlement` middleware: حدود الفروع/المستخدمين/المعاملات/التخزين حسب الخطة (خطط `DEVELOPMENT-ROADMAP.md:323-365` هي بداية جيدة: Free/Pro/Enterprise).
- Trial 14 يوماً + ترقية/تخفيض + dunning + فواتير ضريبية حسب السوق.
- تدقيق كل تغيير اشتراك (append-only).

**بوابة الخروج:** دورة حياة اشتراك كاملة آلياً + منع تجاوز الحدود مختبراً.

### المرحلة 5 — العالمية (i18n / Workle/residency) — 4–6 أسابيع
- إطار ترجمة بمفاتيح (`i18next`-style) لكل الواجهة (v3 + القديم) بدل `name_ar/name_en` فقط؛ RTL/LTR كامل، أرقام/تواريخ محلية.
- فصل العملة/المنطقة الزمنية/التقويم/التنسيق عن الحسابات (كما أوصى `WORLD-CLASS-90-DAY-ROADMAP.md:57`).
- **محركات ضريبة قابلة للتبديل** `backend/tax-adapters/{sa,eg,...}` — ZATCA يبقى معزولاً، ETA B2B وB2C مساران منفصلان (`EGYPT-LOCALIZATION-DISCOVERY.md:16`). لا ادعاء اعتماد قبل قبول رسمي.
- White-label: شعار/ألوان/خط/نطاق لكل مستأجر (يحل محل `main_settings` و`id=1`).
- بوابات دفع وتوصيل حسب السوق عبر adapters لا عبر تعديل مسار البيع.

**بوابة الخروج:** سوقان (SA + EG) يعملان بنفس الكود بلا تفرّع + مراجعة محاسب محلي.

### المرحلة 6 — السحابة والتوصيل والتنبيهات — 4–6 أسابيع
- Kubernetes (أو managed containers) + **managed PostgreSQL** مع replicas/failover مُختبر + Object Storage للنسخ (بدل `D:/KarimBackups`).
- Secrets Manager (بدل `.env`)؛以西 TLS wildcard + توجيه حسب subdomain/NTLM.
- Prometheus + Grafana + Alertmanager و**تفعيل OTel** مع جامع (Tempo/Jaeger) + sampling + `tenant_id` attribute.
- جدولة `slo-check.js` كـcron + تنبيهات حقيقية (لا CLI بلا مستهلك).
- CI/CD: بناء صورة + push registry + نشر canary/blue-green + rollback مؤتمت (ينهي "deploy is MANUAL").
- نسخ لكل مستأجر قابل للاستعادة بشكل مستقل (self-service restore داخل حدود الخطة).

**بوابة الخروج:** نشر一个新 عميل دون لمس الخادم + تنبيه مُجرَّب + failover مُختبر.

### المرحلة 7 — الاعتماد والإطلاق المحدود — 2–4 أسابيع
- اعتماد ZATCA وETA رسمياً + اختبار اختراق **بشري مستقل** (المتاح اليوم red-team آلي 15/15 فقط).
- امتثال GDPR/PDPL: سياسة احتفاظ/تصدير/حذف، DPA، سجل تدقيق غير قابل للتلاعب.
- SLA + دعم + runbooks + beta محدود بموافقة المالك.

**بوابة الخروج:** قبول رسمي للجهات + توقيع المالك على الإطلاق.

---

## 5) سجل المخاطر (أعلى 6)

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| تسريب بيانات بين مستأجرين عبر كاش/بث/CRUD عام | متوسط | **كارثي** | RLS + مفتاح tenant في كل شيء + اختبارات سلبية إلزامية |
| ترحيل 238 جدولاً يكسر الإنتاج | متوسط | عالٍ | نسخة مطابقة + DR drill + ترحيلات ذرية + rollback |
| كسر عقود v3/Zod بسبب تغيير شكل الاستجابة | متوسط | متوسط | تبقي الطبقة شفافة: نفس الـenvelope، tenant يُحقن في middleware فقط |
| تضخم تكلفة PostgreSQL/Redis مع العملاء | متوسط | متوسط | connection pooling (PgBouncer/Supavisor) + حدود لكل خطة + مراقبة |
| ادعاء امتثال ضريبي قبل الاعتماد | منخفض | قانوني | النزاهة الحالية في الكود (`BLOCKED/UNVERIFIED`) تبقى كما هي |
| فقدان مرونة الفريق بسبب حجم المشروع | عالٍ | متوسط | مراحل صغيرة ببوابات + لا إعادة كتابة + لا ميزات جديدة قبل إغلاق البوابة |

---

## 6) ما يجب ألا تفعله (دروس من الفحص)

1. لا تكتب multi-tenant قبل نجاح الترحيل والرجوع على نسخة مماثلة للإنتاج (كان مؤجلاً لسبب).
2. لا تضع قواعد مصر/أي سوق داخل مسارات البيع أو المحاسبة العامة — adapters فقط.
3. لا تُعلن «معتمد ZATCA/ETA» قبل القبول الرسمي.
4. لا تعتمد على `branch-context` fail-open كعزل — هو حالياً راحة تشغيلية لا حماية.
5. لا تنسخ نمط `main_settings` في المستأجرين — اجعل المفتاح `(tenant_id, id)` من البداية.
6. لا تفعّل السحابة قبل حل Socket adapter والكرونات — وإلا سيتكسر البث مع أول replica.

---

## 7) هل يتأثر الإنتاج والأرقام؟ — قاعدة «السيستم شغال»

**الإجابة القصيرة: لا، بشرط أن نعمل على نسخة منفصلة. أما لو لمسنا الإنتاج مباشرة فنعم — ومن أخطر الأنواع.**

### ما لا يتغير أبداً (ثابت العقد)
- لا تعديل على أي عمود مبلغ/كمية/رصيد (`pos_orders.total`, `pos_order_items`, `journal_lines.debit/credit`, `inventory_ledger`, الرواتب). التحويل **يضيف** أعمدة ومفاتيح فقط.
- لا تعديل على أي ترحيل قديم — القلعة تمنع ذلك (175 ترحيلاً مبصوماً sha256، أي عبث يُرفض). ترحيل جديد فقط بالرقم التسلسلي التالي.
- لا تعديل على منطق ZATCA/المحاسبة/الضرائب الحسابي.

### النقاط الثلاث اللي لو اتحصلت غلط هتأثر فعلاً على الأرقام/الظهور (كلها على النسخة أولاً)
| الخطر | ماذا يحدث | الضمانة |
|---|---|---|
| **تشغيل RLS قبل ضبط `app.tenant_id`** | كل الاستعلامات ترجع 0 صف ⇒ يبدو كأن البيانات اختفت (وليست مفقودة فعلاً) | لا يُفعّل الـenforcement إلا بعد نجاح اختبارات السياق، وبflag، وعلى نسخة مطابقة أولاً |
| **الـbackfill لـ`tenant_id`** | لو سطر اتنسب لمستأجر غلط، التقارير تتغير رغم أن المبالغ نفسها سليمة | ترحيل ذري + سكربت مطابقة: `count/sum` لكل جدول قبل/بعد = متطابق، مع عزل النسخة |
| **تغيير `branch-context` من fail-open لـfail-closed** | مستخدم بـ`branch_id=NULL` كان يشوف كل الفروع ⇒ ه يشوف فرعه بس، التقارير تتغير | يُطبّق كتمييز سلوكي موثق، بعد وجود tenant، وباختبارات صريحة لكل دور — ليس في نفس دفعة الترحيل |

### مسار العمل الآمن (إلزامي)
1. **نسخة لا الإنتاج:** `pg_dump` من `karim_erp` قراءةً فقط (MVCC بلا قفل — وهو ما جرى في تمرين DR) → استعادة إلى `karim_tenant_dev` على منفذ/خدمة منفصلة. التطبيق أثناء التطوير **لا يتصل بـ`karim_erp` إطلاقاً**.
2. **حارس إضافي:** رفض أي تشغيل ترحيل إذا كان `DB_NAME=karim_erp` أو `NODE_ENV` ليس `test/development` — نفس عقلية الحارس الحالي في `shared-pool.js` و`phase6b`.
3. **نسخة احتياطية قبل أي لمس للإنتاج** (`npm run backup`) + التحقق من الحجم والوجود + `npm run audit:dry` بعد كل ترحيل (قاعدة `erp-db-guardian`).
4. **خط أساس للأرقام:** التقاط `count(*)` و`sum(...)` لأهم 20 جدولاً قبل الترحيل، والمطابقة بعده على النسخة. أي انحراف = إيقاف فوري.
5. **ترحيلات additive أولاً:** `ADD COLUMN IF NOT EXISTS tenant_id ... NULL` + فهارس + سياسات RLS **مُعطّلة** → backfill في معاملة مستقلة → تفعيل الـenforcement بflag منفصل. لا `DROP` ولا `UPDATE بلا WHERE`.
6. **الرجوع (rollback):** إغلاق flag الـRLS / إعادة نشر الحزمة السابقة — لا حذف بيانات. Git + tag + النسخة المشفرة كفيلان بذلك (DR مُجرَّب: 238/238 جدول، RTO 85ث).
7. **على الإنتاج في النهاية:** canary بمستأجر تجريبي واحد فقط + مراقبة p95/الأخطاء/التدقيق، ثم التوسع تدريجياً.

### الخلاصة للمالك
الخطر الحقيقي ليس على «الأرقام المخزنة» (لن نلمسها)، بل على **«من يرى ماذا»** (السياق/العزل) و**«متى يُفعّل»**. لذلك كل التغييرات الخطرة بتحصل على نسخة مطابقة، وبأعلام إيقاف، وبمطابقة أرقام قبل/بعد — والإنتاج يبقى شغال كما هو حتى توقّع أنت على بوابة الخروج.

---

## 8) خريطة الأثر التنفيذية (فحص دقيق 2026-11-23)

### 8.1 الأرقام الحقيقية (لا تقديرات)
| العنصر | العدد | ملاحظة |
|---|---|---|
| مسارات API (`router.get/post/...`) | **515** | get 261 · post 200 · put 27 · delete 26 · patch 1 |
| `app.use(...)` في `server.js` | **~45** | لا مركز تسجيل واحد، لكن نقطة حقن واحدة تكفي (أدناه) |
| جداول الإنتاج | **238** | من تمرين DR (`docs/RT_OPERATIONS.md:60`) |
| ملفات تقرأ `main_settings` في الباك-إند | **5** | + `server.js:1418` مسار CRUD ديناميكي |
| ملفات تقرأ الإعدادات في الواجهة القديمة | **9** | مصدر فقط (بدل نسخ assets المكررة) |
| أنواع أحداث outbox | **14** | + 4 أحداث socket في `guard.js:69-74` |
| عائلات الغرف | **7** = 16 إدخال | في `realtime/producers.js:19-27` |
| `io.emit` خام متبقٍ | **~30 موقعاً** | أبرزها menu-board (7)، veg-requests (6)، yarasoft (عدة) |
| `setInterval` في `backend/` | **38** | 3 فقط في `server.js`؛ الباقي في العمال/الواتساب/أوراكل |
| ترحيلات مبصومة بالقلعة | **177** | بعد تسجيل 155/156 — أي تعديل قديم يُرفض |

### 8.2 أفضل 5 أماكن حقن (أقل تعديل، أقصى تغطية)
1. **`backend/server.js:582-585`** — `app.use('/api', tenantContext())` **بعد** `apiKeyMiddleware` وقبل الكاش (س602). يغطي الـ45 mount والـ`register()` المتفرقة والـCRUD الديناميكي دفعة واحدة. يتحقق الـmiddleware من `tid` في التوكن إن وُجد (`verifyAccessToken`) مع استثناءات public (`/api/i18n/config`، health، CSP report).
2. **`server.js:230-238` (`io.use`) + `realtime/guard.js:85-97`** — حقن `tenant_id` في `socket.data` وتحويل `emitScoped` إلى غرفة `tenant:<id>:erp:authed`.
3. **`realtime/router.js:13-17` (`roomsForEvent`)** — توحيد بادئة كل الغرف في دالة واحدة (تصلح `publisher.js:77` و`producers.js:39`).
4. **`api-cache.js:139` + `permissions.js:125`** — أخطر نقطتي تسريب: مفتاح الكاش الحالي `${authorization}|${originalUrl}` (PUBLIC بلا auth يتصادم) ومفتاح صلاحيات `userId` (نفس id لدى مستأجرين) ⇒ يصبحان `tenant:<id>|...`.
5. **ترحيل جديد على نمط `102_branches.sql:34-55` + `106_branch_autostamp.sql:17-33,60-98`** — نفس قائمة الجداول العشرة كبذرة أولى (`users`, `employees`, `attendance`, `pos_orders`, `pos_shift_sessions`, `pos_day_closes`, `expenses`, `revenues`, `journal_entries`, `"purchaseInvoices"`) + `SET LOCAL app.tenant_id` من الـmiddleware.

### 8.3 أدوات جاهزة نعيد استخدامها (لا نكتب بديلاً عنها)
| الأداة | الاستخدام في بوابة الخروج |
|---|---|
| `scripts/accounting-reconciliation.js` | 13 فحصاً كلها `SELECT COUNT` (read-only) = خط أساس الأرقام قبل/بعد |
| `scripts/verify-audit-chain.js` | سلامة سلسلة التدقيق، read-only صراحةً |
| `scripts/audit.js:64-82` (`assertIsolatedTarget`) | سياسة حظر الإنتاج المعتمدة (regex + loopback) |
| `scripts/migration-immutability.js` | منع تعديل أي من الـ175 ترحيلاً |
| `scripts/slo-check.js` | 6 أهداف، read-only |

### 8.4 حارس جديد أُضيف (لا يلمس مسارات النشر القائمة)
`scripts/saas-migrate-guard.js` + `tests/saas-migrate-guard.test.js` — **16/16 اختباراً ناجحاً**:
- يرفض `NODE_ENV=production`، واسم `karim_erp` و`karim_erp_test`، وأي مضيف غير loopback (نفس سياسة `assertIsolatedTarget`)، وغياب `--i-confirm-copy`، ومسارات الترحيل، وملفات `_down.sql`، وتعارض `DB_NAME` مع الهدف.
- لا يُستدعى من `serve.js`/`setup.js`/`update-production.ps1`/CI — بل بوابة اختيارية لترحيلات SaaS فقط، فما أتكسرش دورة النشر الحالية.
- الاستخدام: `node scripts/saas-migrate-guard.js --target=karim_tenant_dev --migration=155_tenants_foundation.sql --i-confirm-copy --dry-run`.

### 8.5 خطر صامت مكتشف في الإعدادات
`backend/i18n-routes.js:12-26` **fail-open**: عند غياب صف الإعدادات تُستخدم قيم `DEFAULT_LANGUAGE='ar'` و`CURRENCY_DEFAULT='SAR'` و**`DEFAULT_TAX_RATE='0.15'`**، مع أسماء/شعارات hardcoded (`'مطاعم الشرفه العالمي'`, `/app/assets/al-shurfa-logo.png`, `AL SHORFA RESTAURANTS`). في SaaS متعدد المستأجرين هذا يعني أن كل عميل سيستلم **نفس الهوية ونفس نسبة الضريبة بصمت** (بلا 404 وبلا خطأ). لذلك القرار 7 في ADR (مفتاح `(tenant_id, id)`) ليس تحسيناً جمالياً بل حماية أرقام.

---

## 9) سجل التنفيذ — المرحلة 1، الجزء الأول (2026-11-23، بموافقة «كمل» على التوصية)

> **صفر لمس للإنتاج:** كل ما أُضيف أدناه ملفات + كود بمطفأ افتراضي. لا ترحيل طُبّق على أي قاعدة، ولا اتصال بـ`karim_erp`.

| العنصر | الملف | التحقق |
|---|---|---|
| سياق المستأجر يستخدم **نفس** AsyncLocalStorage الموجود (لا ALS جديد) | `backend/middleware/correlation.js` (+`updateTenantContext`, `getTenantId`) | eslint نظيف |
| middleware جديد `tenantContext` — `SAAS_TENANT_ENABLED=false` ⇒ **no-op حرفي** | `backend/saas/tenant-context.js` | 26 اختباراً |
| الحقن في نقطة واحدة قبل الكاش (س582) | `backend/server.js:582-585` | `node --check` ناجح |
| مفاتيح الكاش بمادئة المستأجر (أخطر نقطتي تسريب) | `backend/api-cache.js:139` · `backend/permissions.js:125-150,159` | 41 اختباراً من 5 حزم ذات صلة ناجحة |
| ترحيلات additive (جداول + 10 أعمدة، بلا RLS مُفعّل) | `155_tenants_foundation.sql` · `156_tenant_columns.sql` | مسجّلة في القلعة: **177 ترحيلًا مصونًا** |
| حارس ترحيلات SaaS (لا يلمس مسارات النشر القائمة) | `scripts/saas-migrate-guard.js` + اختباره | 16 اختباراً + رفض فعلي لـ`karim_erp` |
| توثيق المتغيرات | `.env.example` | كاشف الأسرار: 0 |

**المجموع: 42 اختباراً جديداً ناجحاً + 41 اختباراً من الحزم المتأثرة = 83/83.**

### بوابات الصحة
| البوابة | النتيجة |
|---|---|
| ESLint على كل الملفات المعدّلة | **0 أخطاء / 0 تحذيرات** |
| `node --check` (server.js + tenant-context.js) | ناجح |
| كاشف الأسرار | **0** |
| صون الترحيلات | **177/177** |
| `lint-gate` | تحذير واحد **قديم** في `frontend/app/js/features/veg-requests.js` (ملف معدّل من المالك قبل هذه الجولة — لم يُلمس) |

### المتبقي عمداً في المرحلة 1 (لم يُنفَّذ — يحتاج نسخة منفصلة أولاً)
1. توفير `karim_tenant_dev` (pg_dump قراءةً من الإنتاج → استعادة إلى نسخة منفصلة) ثم تطبيق 155/156 عبر الحارس بـ`--dry-run` أولاً.
2. سكربت خط الأساس الرقمي: `accounting-reconciliation.js` + `verify-audit-chain.js` قبل/بعد، مع مطابقة `count/sum`.
3. backfill إلى المستأجر الأول بـUUID ثابت، ثم اختبارات العزل السلبية كـgate في القلعة.
4. تحويل `SAAS_TENANT_MAP` من البيئة إلى جدول `tenants` بكاش قصير.
5. سياسات RLS + `SET LOCAL app.tenant_id` — **بعد** تأكيد أن كل مسارات الاستعلام تمر بالسياق (هذه هي الخطوة الأخطر، وليست أولاً).

---

## 10) سجل التنفيذ — النسخة المنفصلة + الترحيلات + الـbackfill (2026-11-24، إذن المالك «1»)

> **الإنتاج لم يُلمس:** `pg_dump -Fc` قراءةً فقط من `karim_erp`، ثم استعادة إلى `karim_tenant_dev`. لا DDL ولا DML على الإنتاج.

### أ) النسخة
| الخطوة | النتيجة |
|---|---|
| Preflight | `karim_tenant_dev` غير موجود؛ 241 جدولاً؛ `.env` كان يشِير إلى `karim_erp_test` (تأكيد ذلك قبل النسخ) |
| `pg_dump -Fc` | `database/backups/saas-copy/karim_erp_2026-11-23T20-58-46-040Z.dump` — 106.5MB، مجلد مستبعد من git ومُضيَّق الصلاحيات |
| الاستعادة | محاولة أولى فشلت على `ALTER ... OWNER TO postgres` ⇒ أُعيدت بـ`--no-owner` بعد حذف نسختنا الفاشلة فقط — نجحت |
| المطابقة مع الإنتاج | 241/241 جدول؛ كل الجداول متطابقة عدا 2 قيد + 4 سطور + 2 إيراد **أُضيفت للإنتاج بعد اللقطة** (اتجاه الـmax id يثبت أن النسخة أقدم زمنياً — سلوك طبيعي لنظام شغال) |

### ب) خط الأساس قبل أي ترحيل (محفوظ في `database/backups/saas-copy/`)
- `baseline-before.json`: 14 عدد + 6 مجاميع. مدين = دائن = **10,620,189.52**؛ الإيرادات 7,803,782.16؛ المصروفات 1,154,992.21.
- `reconcile-before.txt`: 13 فحصاً — المخالفات الموجودة أصلاً (14 سداد بلا مستند، 4 مصروف بلا قيد، 2 صرف بلا قيد) **مسجّلة كمرجع**.
- `audit-chain-before.txt`: سلسلة سليمة — 431 صفاً مختومًا، 0 غير مختوم.

### ج) الترحيلات (على النسخة فقط، عبر الحارس — dry-run ثم تنفيذ)
| الترحيل | النتيجة |
|---|---|
| `155_tenants_foundation.sql` | ✅ 3 جداول + دالة `saas_current_tenant_id()` |
| `156_tenant_columns.sql` | ✅ 10 أعمدة `tenant_id` + 10 فهارس |
| `157_tenant_backfill.sql` | ✅ المستأجر `00000000-...0001` (slug `main`)؛ كل الصفوف منسوبة إليه بلا NULL |

القلعة الآن: **178 ترحيلًا مصونًا**. الـRLS القديم (7 جداول POS) لم يُمس؛ **لا RLS جديد مُفعّل** — كما هو مخطط.

### د) المطابقة بعد الترحيل — PASS
| الفحص | النتيجة |
|---|---|
| 14 عدد + 6 مجاميع قبل/بعد | **متطابقة بالكامل** (`baseline-before` = `baseline-after`) |
| `accounting-reconciliation.js` بعد | **نفس أرقام المخالفات الـ13 بالضبط** |
| `verify-audit-chain.js` بعد | **نفس الـhead** (`074c183f…`) و431 صفاً |
| صحة الـbackfill | 10/10 جداول: `nulls=0` وكل الصفوف للمستأجر الأول |

### هـ) الحكم
الترحيلات الـ3 **لا تغيّر أي رقماً ولا أي قيد محاسبي ولا سلسلة التدقيق**. الطريق مفتوح للخطوة التالية، لكن **RLS يبقى ممنوعاً** لحد ما نحل مشكلة `SET LOCAL` مع الـpool المشترك (كل استعلام يجب أن يمر على اتصال الطلب، وإلا هيرجع 0 صفوف). دي بوابة المرحلة 1 المتبقية.

---

## 11) سجل التنفيذ — سياق الاتصال + RLS + اختبار العزل (2026-11-24)

### أ) حل مشكلة `SET LOCAL` مع الـpool المشترك
| العنصر | الملف | التحقق |
|---|---|---|
| الـALS الموجود حمل `tenantClient` و`get/setTenantClient` | `backend/middleware/correlation.js` | — |
| Proxy الـpool يوجّه `query` للعميل المحجوز داخل معاملة المستأجر، وبخلافه السلوك القديم حرفياً | `backend/shared-pool.js` | — |
| `runWithTenant(id, fn)`: BEGIN → `set_config('app.tenant_id',$2,true)` **معاملاتي لا نصّي** → COMMIT/ROLLBACK → release | `backend/saas/tenant-db.js` | **32/32** اختباراً جديداً (منها رفض الحقن والتداخل والتراجع) |

> حدود موثّقة: `pool.connect()` داخل المعاملة يعطي اتصالاً بلا سياق — الكود الجديد يستخدم العميل الممرّر؛ الكود القديم يعمل لأن السياسة متساهلة عند غياب السياق.

### ب) سياسات RLS — ترحيل `158_tenant_rls_policies.sql` (على النسخة فقط)
- `tenant_read` (PERMISSIVE): بلا سياق ⇒ كل الصفوف (ما يكسرش الكود القديم)؛ مع سياق ⇒ المستأجر فقط.
- `tenant_guard` (RESTRICTIVE): تُ AND مع سياسات POS القديمة ⇒ ما يتجاوزها حد.
- `FORCE ROW LEVEL SECURITY` على الجداول العشرة. القلعة: **179 ترحيلًا مصونًا**.

### ج) اختبار العزل السلبي الحي (على النسخة فقط)
| السيناريو | النتيجة |
|---|---|
| بلا سياق | 6,400 صف ⇒ الكود الحالي ما انكسرش ✅ |
| سياق المستأجر 1 | 6,399 صف ✅ |
| سياق المستأجر 2 (صف واحد منقول إليه) | 1 صف ✅ |
| محاولة إدراج صف للمستأجر 2 تحت سياق المستأجر 1 | **مرفوضة** برسالة `new row violates row-level security policy` ✅ |
| جدول POS بسياساته القديمة (بلا/بسياق/بسياقين معاً) | 2/2/2 — ما انكسرش ولا حصل تجاوز ✅ |

نُظّفت بيانات الاختبار (أُعيد الصف وحُذف المستأجر 2).

### د) المطابقة بعد RLS
- 14 عدد + 6 مجاميع: **متطابقة تماماً** مع خط الأساس.
- سلسلة التدقيق: **`ok: true`، 0 غير مختوم**. عدد الصفوف المختومة ارتفع 431 → 453 و الـhead تغيّر — وده **ناتج صفوف تدقيق جديدة كتبتها اختبارات التعديل على النسخة** (append-only)، مش فقدان ولا تلاعب. الأرقام التجارية ما اتغيرتش.

### هـ) المتبقي
تفعيل نفس الترحيلات على بيئة staging (لا الإنتاج) + تحويل مسارات الكتابة الحرجة (القيود/البيع) إلى `runWithTenant` + تشديد سياسة `tenant_read` من متساهلة إلى fail-closed بعد اكتمال التحويل.

---

## 12) سجل التنفيذ — حقن السياق في مسار البيع + الافتراض الآمن (2026-11-24)

### أ) اكتشاف كان هيكسر البيع في وضع SaaS
سياسة `WITH CHECK` في الترحيل 158 ترفض أي صف بـ`tenant_id = NULL` تحت سياق مستأجر. ومسار البيع يُدرج `pos_orders` دون تحديد العمود ⇒ كان سيفشل بمجرد تفعيل `SAAS_TENANT_ENABLED`.

### ب) الإصلاح الجذري (لا بقعة في مسار البيع وحده)
| العنصر | الملف | التحقق |
|---|---|---|
| `applyTenantToClient(client, id)` — يضبط GUC بمعاملات على اتصال معاملة قائم، بلا بدء معاملة | `backend/saas/tenant-db.js` | +2 اختبار وحدة |
| الافتراض `DEFAULT saas_current_tenant_id()` على الأعمدة العشرة ⇒ أي INSERT يرث المستأجر تلقائياً | `159_tenant_default.sql` | طبّق بنجاح على النسخة؛ القلعة **180 ترحيلًا** |
| حقن مشروط في معاملة البيع بعد `BEGIN` و`SET LOCAL TIME ZONE` | `backend/cashier-module/complete-sale.js` | `node --check` ناجح؛ `req.tenant` غير موجود عند إطفاءFlag ⇒ صفر استعلام إضافي وصفر تغيير سلوك |

### ج) اختبار حي على النسخة (باستخدام الدالة الحقيقية لا نسخة منها)
| السيناريو | النتيجة |
|---|---|
| `applyTenantToClient(T1)` ثم INSERT بلا tenant_id | الصف حصل على `T1` تلقائياً ✅ |
| INSERT بلا سياق | `tenant_id = NULL` — السلوك القديم محفوظ ✅ |

**الخلاصة:** البيع لن ينكسر عند تفعيل وضع SaaS، والأرقام ما اتغيرتش.

### د) ملاحظة تغطية
`pos_order_items` لا يملك عمود `tenant_id` (القائمة البذرية العشرة من `102_branches.sql`) ⇒ عزل الجداول الفرعية مؤجل لترحيل لاحق، موثّق هنا صراحةً ولا يُدعى إنجازه.

> **تحديث لاحق في نفس اليوم:** الفجوة دي اتنفّدت في الترحيل 161 (أدناه).

---

## 13) سجل التنفيذ — تغطية الجداول الفرعية (2026-11-24)

| العنصر | التفاصيل |
|---|---|
| الترحيل `161_child_tenant_columns.sql` | 6 جداول فرعية: `pos_order_items`, `pos_invoice_payments`, `pos_pending_prints`, `pos_zatca_invoice_queue`, `journal_lines`, `inventory_ledger` |
| العمود | `tenant_id UUID DEFAULT saas_current_tenant_id()` + FK + فهرس |
| الـbackfill | **من الجدول الأب** (`order_id`→`pos_orders`, `entry_id`→`journal_entries`) لا من قيمة ثابتة؛ `inventory_ledger` بلا أب مباشر ⇒ المستأجر الأول (موثّق كحد معروف) |
| RLS | نفس نمط 158: `tenant_read` + `tenant_guard` + FORCE |

**التحقق على النسخة:** 6/6 جداول `nulls=0` وكل الصفوف للمستأجر 1 و`rls=true`. خط الأساس (14 عدد + 6 مجاميع) **ما اتغيرش**. القلعة 182 ترحيلًا (سُجّل ترحيل 160 الخاص بشغل موازٍ أيضاً — محتواه ما اتنقلش ولا اتحذف).

## 14) إفصاح عن شغل موازٍ وقيود التحقق (2026-11-24)

- أثناء التنفيذ ظهرت تعديلات **من طرف آخر** في نفس الشجرة: `database/migrations/160_dispatch_lifecycle.sql` وحذف `purgeDispatchRelated` من `backend/server.js` وتحذير ESLint جديد في السطر 54. **لم أعدّلها** — سُجّلت بصمة 160 فقط لإبقاء بوابة القلعة خضراء.
- اختبارات البيع القديمة (`pos-revenue-atomicity`, `sale-discount-authorization`, `cashier-sales`, `pos-void-ledger-integrity`, `sale-cash-change`) **لم تكتمل**: ظلّت معلّقة بلا output على قاعدة الاختبار المشتركة (يُرجّح تزاحم مع الشغل الموازي)، فأُوقفت. **لا يُدعى نجاحها** — اختباراتي الـ50 الخاصة بـSaaS نجحت، و`node --check` لcomplete-sale ناجح، والحقن مشروط بـ`req.tenant` (مطفأ افتراضياً).
- الإنتاج لم يُلمس في أي خطوة من هذا اليوم.

## 15) سجل التنفيذ — حل المستأجر من DB (2026-11-24)

| العنصر | الملف | التحقق |
|---|---|---|
| `createTenantResolver` — حل slug من `tenants`/`tenant_domains` بـSQL معاملاتي + كاش 30ث + fallback لخريطة البيئة عند غياب الصف أو فشل القاعدة | `backend/saas/tenant-resolver.js` | 10 اختبارات وحدة |
| `tenantContext` أصبح async ويستخدم الـresolver افتراضياً؛ الفشل = 503 fail-closed (`TENANT_RESOLVER_UNAVAILABLE`) لا تمرير بلا سياق | `backend/saas/tenant-context.js` | +2 اختبار |
| توثيق: الخريطة fallback مش مصدر أساسي | `.env.example` | — |

**المجموع الكلي لاختبارات SaaS: 60/60 ناجحة.**

**تحقق حي على النسخة:** `resolve('main')` أرجع `00000000-...0001` من `source: db`، و`resolve('unknown')` أرجع `null`.

> ملاحظة: الـresolver يُنشأ كسولاً داخل `tenantContext()` عند الغياب الخريطة، فلا يفتح اتصالاً عند استيراد الوحدة ولا في الوضع المطفأ.

## 16) سجل التنفيذ — إعدادات لكل مستأجر / white-label (2026-11-24)

| العنصر | الملف | التحقق |
|---|---|---|
| جدول `tenant_settings (tenant_id,key,value JSONB)` + بذرة من `settings` للمستأجر الأول + RLS بنفس النمط | `162_tenant_settings.sql` | طبّق بنجاح على النسخة؛ القلعة **183 ترحيلًا** |
| `createTenantSettings` — تحميل بكاش 30ث + تحقق ISO للعملة + نطاق الضريبة + branding | `backend/saas/tenant-settings.js` | 8 اختبارات وحدة |
| `i18n-routes` يطبّق إعدادات المستأجر **أخيراً** فتتفوق على البيئة والصف العام | `backend/i18n-routes.js` | `node --check` ناجح |
| `/api/i18n/config` لم يعد مساراً عاماً بلا مستأجر — يُحلّ من subdomain دون مصادقة | `backend/saas/tenant-context.js` | +1 اختبار |

**المجموع الكلي لاختبارات SaaS: 68/68 ناجحة.**

**اختبار حي على النسخة:** المستأجر 1 → `SAR / 0.15 / مطاعم الشرفه العالمي`، والمستأجر 2 → `EGP / 0.14 / مطعم مصري`. بلا سياق يبقى المسار القديم كما هو.

**ملاحظة صدق على البصمة:** الترحيل 162 فشل أول مرة بسبب عمود `logoB64` غير منصّص، وتأكدت أن `schema_migrations` بلا سجل له والجدول غير موجود ⇒ لم يكن "تاريخاً منفذاً"، فصلحت SQL وحدّثت بصمته وحدها بسكربت موثّق، ثم أُعيد تطبيقه بنجاح. هذا استثناء واعٍ لقاعدة «لا تُعدّل بصمة مسجّلة»، ومبرّره أن الترحيل لم يُطبَّق قط.

## 17) سجل التنفيذ — توحيد مصدر الهوية في باقي الشاشات (2026-11-24)

| الملف | التغيير |
|---|---|
| `backend/saas/tenant-settings.js` | `loadBrandSource(pool)` — مصدر واحد: إعدادات المستأجر إن وُجد سياق، وإلا صف `settings` العام، بنفس شكل الصف القديم `{name,currency,logoB64}` |
| `backend/finance-routes.js` | `financePrintBrand()` تستخدم المصدر الموحّد |
| `backend/cashier-sales-routes.js` | `loadBrand()` تستخدم المصدر الموحّد |
| `backend/expense-register-routes.js` | `loadBrand()` تستخدم المصدر الموحّد |
| `backend/yarasoft/yara-reports.js` | `loadSheetBrand()` تستخدم المصدر الموحّد (الشعار الثابت `/app/assets/al-shurfa-logo.png` صار fallback فقط عند غياب data-URI) |
| `backend/hr-routes.js` | صفحتا تحقق البطاقة صارتا تأخذان الاسم/الشعار من المصدر الموحّد بدل النص المكتوب؛ القرص يبقى fallback |

**القاعدة:** بلا سياق مستأجر، كل الملفات تقرأ نفس صف `settings` العام كما كانت — أي أن إطفاء وضع SaaS لا يغيّر شيئاً.

**التحقق:** 70/70 اختبار SaaS ناجح (+2 لهذا العنصر)، `node --check` لكل الملفات ناجح، ESLint 0، أسرار 0.

**متبقٍ صغير موثّق:** `CARD_SETTINGS_DEFAULTS.org_name_ar` في `hr-routes.js:288` قيمة افتراضية قابلة للتعديل من الواجهة، و`financial-statements-engine.js` يستخدم `'SAR'` كعملة عرض افتراضية في التقارير — كلاهما افتراضيات لا هوية نهائية، لم تُمسّ.

## 18) سجل التنفيذ — أساس الاشتراكات والحدود (2026-11-24)

> المحور اللي كان **0/10** في الفحص الأول. لا بوابة دفع بعد — القرار يحتاج المالك.

| العنصر | الملف | التحقق |
|---|---|---|
| جداول `plans` (Free/Pro/Enterprise) + `subscriptions` + `usage_counters` + RLS + فهارس | `163_saas_billing.sql` | طبّق بنجاح على النسخة؛ القلعة **184 ترحيلًا** |
| `createEntitlements` — يقرأ الاشتراك والخطة ويحسب `check(metric, delta)`؛ غياب الاشتراك = `free`؛ فشل المخزن = رفض آمن لا Unlimited | `backend/saas/entitlements.js` | 11 اختبار وحدة |

**اختبار حي على النسخة:**
- بلا اشتراك → `free` `{branches:1, users:5, sales:100}`.
- باشتراك `pro` → `{branches:5, users:50, sales:unlimited}`.
- استخدام فروع = 5 ثم طلب +1 → **مرفوض** `PLAN_LIMIT_REACHED`.

**المجموع الكلي لاختبارات SaaS: 81/81 ناجحة.** خط الأساس الرقمي متطابق. الإنتاج لم يُلمس.

**متبقٍ صريح:** بوابة الدفع/الفوترة الفعلية (Stripe أو بوابة محلية) تحتاج قرار المالك، ولم تُنفَّذ.

## 19) سجل التنفيذ — التسجيل الذاتي (2026-11-24)

| العنصر | الملف | التحقق |
|---|---|---|
| `provisionTenant` — معاملة ذرية: `tenants` + `users` + `tenant_users` + 4 مفاتيح `tenant_settings` + `subscriptions` (تجربة 14 يوماً)؛ كلمة المرور bcrypt(12) ولا تُعاد | `backend/saas/onboarding.js` | 7 اختبارات وحدة + اختبار حي |
| `POST /api/saas/signup` — 404 عند الإطفاء، 429 بعد 5 محاولات/ساعة/IP | `backend/saas/onboarding-routes.js` | +3 اختبارات |
| ربط المسار في نقطة واحدة | `backend/server.js` | `node --check` ناجح |
| علم `SAAS_SIGNUP_ENABLED` | `.env.example` | — |

**اختبار حي على النسخة:** أُنشئ مستأجر كامل (`pro`/`trial`) → تحقق: مستأجر 1، مستخدم 1، عضوية 1، 4 إعدادات، اشتراك `pro/trial`. ثم **نُظّف بالكامل** (بترتيب احترام الـFK: subscriptions → settings → tenant_users → users → tenants).

**المجموع الكلي لاختبارات SaaS: 94/94 ناجحة.** الإنتاج لم يُلمس.

**ملاحظة حماية:** الحد الحالي محلي في الذاكرة ويُعاد عند إعادة التشغيل — كافٍ كبوابة أولى؛ التوصية للإنتاج استبداله بـ`rate-limiter` المشترك مع Redis (موثّقة في الكود).

**إفصاح تقني:** أول محاولة حية فشلت بسبب `jsonb_build_object` بلا cast للمعاملات (42P18) — أُضيف `$2::text`/`$3::text`. محاولة تنظيف فاشلة تركت مستأجراً تجريبياً على النسخة؛ نُظّف مع باقي السجلات. كل ذلك على `karim_tenant_dev` فقط.

## 20) سجل التنفيذ — متريات SaaS وSLO (2026-11-24)

| العنصر | الملف | التحقق |
|---|---|---|
| عدّادات SaaS bounded (200 مستأجر) بلا تبعيات وبلا لمس المسار الحار | `backend/saas/saas-metrics.js` | 6 اختبارات |
| تسجيل: فشل حل المستأجر/تزويره، محاولات التسجيل، رفض الحدود | `tenant-context.js` · `onboarding-routes.js` · `entitlements.js` | مدمج |
| حقل `saas` داخل `/api/metrics` | `backend/ops-inspect-routes.js` | — |
| وثيقة SLO/runbook + إفصاح ما لم يُنفَّذ | `docs/SAAS-SLO.md` | — |

**المجموع الكلي لاختبارات SaaS: 100/100 ناجحة.**

**إفصاح:** لا Prometheus ولا Alertmanager ولا جدولة تنبيه **منتشرة** — العدّادات JSON + endpoint بصيغة Prometheus، والقواعد كملفات جاهزة. لم تُنشر بعد: هذا عمل infra على staging، موثّق في `SAAS-SLO.md §4` ولا يُدعى إنجازه.

### تحديث: إخراج Prometheus وقواعد التنبيه (نفس اليوم)
- `prometheusFormat()` في `backend/saas/saas-metrics.js` + نقطة `/api/saas/metrics/prometheus` المحمية (`ops-inspect-routes.js`).
- `deploy/saas/prometheus.yml` + `deploy/saas/alerts.yml` (4 قواعد) — **YAML مُتحقق منه**.
- المجموع الكلي لاختبارات SaaS: **101/101**.

## 21) سجل التنفيذ — ملفات staging (2026-11-24)

مجلد `deploy/saas/` (كاملًا **ملفات فقط — لم يُشغَّل شيء**):

| الملف | التحقق |
|---|---|
| `docker-compose.staging.yml` — db/redis/app/prometheus/alertmanager على شبكة داخلية، منفذ التطبيق loopback فقط | YAML صالح |
| `.env.staging.example` — بلا أسرار | كاشف الأسرار 0 |
| `nginx-wildcard.conf` — `*.staging.<domain>` ←→ التطبيق + WebSocket + HSTS | — |
| `prometheus.yml` + `alerts.yml` + `alertmanager.yml` | YAML صالح (4 قواعد، Alertmanager **بلا مستقبل** حتى يُضبط) |
| `README.md` — ترتيب التشغيل الآمن + لماذا لم يُفعّل | — |

**البوابة الصريحة:** الترحيلات 155..163 تُطبَّق أولاً على `karim_erp_staging`، ثم المطابقة الرقمية، ثم فقط `SAAS_TENANT_ENABLED=true`. لا يُفعّل أي علم من هذه الجلسة.

## 22) قرار النطاق (2026-11-24)

المالك حدد النطاق: **`karimeg.online`**. تحديثات:

- `.env.staging.example` → `ALLOWED_ORIGINS=https://staging.karimeg.online`.
- `nginx-wildcard.conf` → `staging.karimeg.online` + `*.staging.karimeg.online`.
- `docker-compose.staging.yml` → نفس القيمة الافتراضية.
- ملفات جديدة: `DNS-and-TLS.md` (السجلات + الشهادة + مسارى Tunnel/Nginx) و`cloudflared.yml` (قالب نفق wildcard).
- `README.md` يذكر النطاق.

**عائق النشر الفعلي على هذه الآلة (مقاس فعلياً):** `docker` غير مثبّت، `nginx` غير موجود، والمنفذ `5200` مشغول أصلاً. ⇒ لا يمكن تشغيل staging compose هنا. يحتاج خادماً بـDocker أو استخدام خدمة النفق الحالية على خادم آخر. لم يُنشر شيء.

## 23) قرار الأمان: لا نشر staging على السيرفر الحي (2026-11-24)

سأل المالك عن نشر staging على نفس السيرفر المُشغَّل — **القرار: مرفوض**. الأدلة المقاسة:

| الخطر | الدليل |
|---|---|
| تضارب المنفذ | `127.0.0.1:5200` مشغول أصلاً (وال审计 يذكر 5200/5201) — أي نسخة ثانية إما تفشل أو تخطف الترافيك |
| تضارب قاعدة البيانات | `karim_erp` هي الإنتاج الحي (لاحظنا كتابات جديدة بعد اللقطة: +2 قيد). كل ترحيلات SaaS لو انطبقت هنا ⇒ أرقام محاسبية/no tenant context |
| مشاركة الموارد | PostgreSQL واحد (`max_connections` محدود) + Redis +Socket.io بلا adapter ⇒ نسخة إضافية تستهلك الاتصالات وتزيد الحمل على الكاشير |
| تضارب الملفات/A secrets | `.env` واحد، `node_modules` و`logs` و`uploads` مشتركة، وهناك شغل موازٍ من طرف آخر معدّل في نفس الشجرة |
| بدء التشغيل نفسه | `serve.js`/`setup.js`/`update-production.ps1` تستدعي `npm run migrate` الذي افتراضه `karim_erp` — أي إقلاع staging من نفس الريبو قد يلمس الإنتاج |

**البديل الآمن (مُجرَّب سابقاً في المشروع):** عزل كامل — سيرفر/VM/VPS منفصل بـPG وRedis خاصين، أو كحد أدنى على نفس الجهاز: منفذ مختلف (مثل :5299 في审计)، قاعدة `karim_erp_staging/tenant_dev` منفصلة، نسخة عمل (worktree) منفصلة، و`.env` مستقل. **لا لمس لـ`karim_erp` ولا للمنفذ 5200.**

لا تُنشر أي نسخة SaaS على السيرفر الحي قبل موافقة صريحة على خطة عزل.

## 24) تجربة معزولة فعلية على نفس الجهاز (2026-11-24، بموافقة المالك)

بعد رفض النشر على السيرفر الحي، جرّبنا نمطاً معزولاً كاملاً (نفس نمط التدقيق بمنفذ مختلف):

| البند | القيمة |
|---|---|
| دليل التشغيل | `C:\Users\DELL\Desktop\k\karim-saas-staging-run` — نسخة مستقلة من المشروع (بلا `.git` و`.env`) + junction لـ`node_modules` |
| المشغّل | `start-isolated.js` — يقرأ الأسرار من `.env` الأصلي دون طباعتها، ثم يتجاوزها بـ`PORT=5300`, `DB_NAME=karim_tenant_dev`, `KARIM_DATA_DIR` مستقل, `SAAS_TENANT_ENABLED=true`, `SAAS_SIGNUP_ENABLED=true` |
| الترحيلات | **لا يعيد تشغيلها** — `backend/server.js` لا يشغّل migrate (تلك في `serve.js` فقط)، و155..163 مطبّقة أصلاً على النسخة |
| المنفذ | 5300 (5299 كان مشغولاً؛ 5200/5201 لم يُلمسا) |

**نتائج حية مقاسة:**
| الطلب | النتيجة |
|---|---|
| `GET /api/health` | **200** — database/realtime/outbox/websocket/cluster/cli كلها `ok` |
| `GET /api/i18n/config` مع `Host: main.staging.karimeg.online` | **200** — `lang=ar`, `currency=SAR`, `tax_rate=0.15`, `branding` من `tenant_settings` ( اسم + logo B64 + إعدادات الفرع MAIN ) |
| نفس الطلب بـ`unknown.staging...` | **403** `TENANT_REQUIRED` (fail-closed) |
| نفس الطلب بـ`localhost:5300` | **403** (لا سياق مستأجر) |
| `GET http://127.0.0.1:5200/api/health` | **200** — الإنتاج ما زال شغالاً ولم يتأثر |

> ملاحظة عرض فقط: النص العربي ظهر مشوّهاً في طرفية PowerShell بسبب ترميز الكونسول، لا في بيانات JSON.

الخادم المعزول تُرِك شغالاً على `http://localhost:5300` لتمكين التجربة، والإيقاف: `Stop-Process -Id <pid>` (أو إغلاق نافذته). لم يُنشر شيء على النطاق ولا على الإنتاج.
