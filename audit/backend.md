# تقرير تدقيق الـ Backend — Karim ERP

> **نطاق التدقيق:** قراءة فقط (read-only) لـ `backend/*.js` و`backend/*-routes.js` ومحركات الفروع (`engines/`, `cashier-module/`, `realtime/`, `whatsapp-engine/`, `yarasoft/`, `audit-engine/`, `errors/`, `middleware/`, `startup.js`, `server.js`).
> **لم يُعدَّل أي ملف** خلال التدقيق باستثناء هذا التقرير.
> **التاريخ:** 2026-10-10.

---

## ملخص تنفيذي (أعلى 10 مشكلة خطورة)

| # | المشكلة | الموقع | الخطورة |
|---|---------|--------|---------|
| 1 | **أي `dept_head` يعدّل أي طلب خضار** — لا يوجد تقييد قسم في مسار التعديل؛ رأس القسم في قسم «المطبخ» يستطيع تعديل طلب قسم «الخدمة» | `backend/veg-requests-routes.js:371-376` | **HIGH** |
| 2 | **أي `kitchen`/`sous_chef` يعدّل أي إذن صرف من أي قسم** — التحقق اليدوي يسمح لأي شيف بتعديل `dispatch` لا يخصّ قسمه | `backend/warehouse-routes.js:879` | **HIGH** |
| 3 | **تسريب رسائل أخطاء قاعدة البيانات للمستخدم** — `e.message` يظهر مباشرة في ~60 نقطة (4xx/5xx) وقد يفضح أسماء جداول/أعمدة/قيود | `backend/hr-routes.js:1009,1017,1026,1031` · `backend/kitchen-production-routes.js:149,151` · `backend/cashier-module/orders-routes.js:250` + ~55 نقطة أخرى | **HIGH** |
| 4 | **سرّ افتراضي قابل للتنبؤ** — `fallbackDevSecret()` يبني المفتاح من `hostname+totalmem+cpus` (قابل للحذف)، وله بديل ثابت `karim-dev-secret-change-me-...` | `backend/startup.js:131-141` (يُستخدم عندما لا يضبط `NODE_ENV=production`) | **HIGH** |
| 5 | **CORS مفتوح افتراضيًا** — `ALLOWED_ORIGINS` يسقط إلى `'*'` مع `credentials` معطّل، وتحذير يُطبع فقط ولا يمنع الإقلاع | `backend/server.js:142-174` | **MED** |
| 6 | **`dept_code` يُقارن بـ `===` رغم أنه قائمة فواصل** — رأس قسم متعدد الأقسام يُمنع (fail-closed) من اعتماد الإجازات/عرض الجداول/الاتصال بالغرف | `backend/realtime/router.js:40,43` · `backend/hr-routes.js:1622` · `backend/leave-workflow-routes.js:200-201` · `backend/server.js:718` | **MED** |
| 7 | **أي مستخدم مصادَق يقرأ توفّر المخزن الرئيسي** — `GET /main-availability` بلا `requireRole` | `backend/warehouse-routes.js:2444` | **MED** |
| 8 | **لا معالج لخطأ `httpServer`** — `EADDRINUSE`/`EACCES` يُحدثان `uncaughtException` بدل رسالة إقلاع نظيفة | `backend/server.js:~2611` (لا يوجد `httpServer.on('error')`) | **MED** |
| 9 | **تهيئة الخدمات تجري بعد `listen`** — `startup.runAll({failFast:false})` + `markBootComplete()` تُستدعى رغم فشل التحقق، فتُعلن الخدمة «جاهزة» قبل اكتمال المدققات | `backend/server.js:2580-2709` | **MED** |
| 10 | **20 معالج `async` بلا `try/catch` وبدون `asyncHandler`** — أي رفض غير مُتوقّع يصل إلى `express` 5؛ من أخطرها مسارات بطاقة الموظف والصحة | `backend/hr-routes.js:172` · `backend/menu-board-routes.js:136` · `backend/middleware/health.js:315,333,346` · `backend/cashier-module/excel-import-routes.js:394` | **MED** |

**ملاحظات إيجابية (لا تُعدّ مشاكل):**
- لا توجد أسرار مُقنّنة في الكود (`password|secret|token = '...'` → 0 نتيجة). الـ 75 افتراض `process.env.X || 'default'` أغلبها قيم بيئية غير حسّاسة.
- كل تدفقات الكتابة متعدّدة الجداول مغلقة بمعاملات (`BEGIN`/`COMMIT`) في: `warehouse-routes` (25/26)، `inventory-transfer-routes` (6/6)، `cashier-module/complete-sale.js`، `hr-routes` (7/7)، `inventory-control-routes` (6/6)، `attendance-engine` (1/1).
- `errors/app-error.js` **لا** يُسرب الـ stack في `toJSON()`.
- `apiKeyMiddleware` يستخدم `crypto.timingSafeEqual` مع تغليف فرق الطول (`server.js:480-484`).
- كل تحققات `LIMIT/OFFSET` مُرقَّمة ومقيّدة بـ `Math.min/Math.max`/`parseInt` (لا حقن SQL).

---

## جدول الـEndpoints (مختصر)

**الإجمالي: 582 نقطة نهاية** = 457 صريحة + 125 ديناميكية (25 كيانًا × 5).

### حسب طريقة HTTP (المسارات الصريحة فقط)

| الطريقة | العدد |
|---------|-------|
| GET | 214 |
| POST | 189 |
| PUT | 24 |
| DELETE | 29 |
| PATCH | 1 |
| **المجموع الصريح** | **457** |

### المجموعات الوظيفية الرئيسية

| المجموعة | الملفات | أبرز المسارات |
|----------|---------|---------------|
| **المصادقة/الجلسات** | `auth-routes.js`, `cashier-module/jwt-middleware.js`, `password-recovery-routes.js` | `POST /api/auth/login`, `/refresh`, `/change-password`, `/logout`, `/forgot-password/*` |
| **الموارد البشرية** | `hr-routes.js` (32)، `attendance-portal-routes.js`، `leave-workflow-routes.js`، `shifts-engine.js` | `GET /api/hr/attendance/report`, `/employees/:id/card`, `/dept-employees`, `POST /api/attendance-portal/punch` (Geofence+ Gerät) |
| **المخزون/التوزيع** | `warehouse-routes.js` (32)، `inventory-control-routes.js`، `inventory-transfer-routes.js`، `stocktaking-routes.js` | `GET /api/warehouse/dept-panel`, `/dispatches`, `/main-availability`, `PUT /api/warehouse/dispatches/:id/edit`, `POST /api/warehouse/receive` |
| **المطبخ/الإنتاج** | `kitchen-production-routes.js`، `veg-requests-routes.js`، `buffet-routes.js` | `POST /api/veg-requests`, `GET /api/buffet/live`, `/invoices` |
| **المالية** | `finance-routes.js`، `procurement-routes.js` | `GET /api/finance/...` (محميّة بـ `router.use(jwtAuth, requireRole(...READ_ROLES))` على `:544`) |
| **الكاشير/POS** | `cashier-module/*` (complete-sale, orders, day-close, kot, printer, zatca) | `POST /api/sales/complete`, `GET /api/metrics` (محميّ بـ JWT/METRICS_API_KEY) |
| **الإشعارات/الواتساب** | `notification-routes.js` (محميّ بـ `router.use(jwtAuth)` على `:26`)، `whatsapp-engine/routes.js` | `GET /api/notifications`, `GET /api/whatsapp/inbox` |
| **الأنظمة/التشغيل** | `system-routes.js`, `middleware/health.js`, `realtime/*`, `startup.js` | `GET /api/health`, `/api/verbose`, `/api/server/info` (عام)، `/api/state` |
| **التكامل الخارجي** | `yarasoft/routes.js`, `oracle-full-import.js` | `GET /api/yarasoft/revenues`, `/orders` |
| **CRUD الديناميكي** | `server.js:1611-2471` | `GET/POST/PUT/DELETE /api/{entity}` لـ 25 كيانًا |

### الكيانات الديناميكية (25 × 5 = 125)

`users`, `hrDepartments`, `employees`, `attendance`, `leaveTypes`, `leaveRequests`, `payroll`, `departments`, `revenues`, `expenses`, `shelves`, `inventory`, `inventoryTx`, `dispatches`, `recipes`, `purchaseInvoices`, `kitchenReturns`, `weightReadings`, `notifications`, `settings`, `salary_advances`, `payroll_adjustments`, `employee_contracts`, `employee_evaluations`, `payroll_runs`

- **كتابة إدارية مشدّدة:** `users`, `payroll`, `settings` (`adminEntities`).
- **قراءة حسّاسة:** `users`, `payroll`, `revenues`, `expenses`, `purchaseInvoices` → أدوار `admin|manager|accountant|auditor` + امتدادات (`hr` للرواتب، `warehouse` لفواتير الشراء).
- **حذف محميّ (append-only):** دفتر الحركات، مرتجعات الأقسام، فواتير الموردين → يتطلب `admin` + `?force=1`.

### المسارات غير المصادَق عليها (عُدّدت — أغلبها مقصود)

| المسار | المبرّر |
|--------|---------|
| `GET /api/hr/card/verify`, `/api/hr/card/v/:code` | موقّعة بـ HMAC + `cardVerifyLimiter` (مسح QR بالهاتف) |
| `GET /api/menu-board/public` | شاشة عرض عامة (أسماء/أسعار معروضة أصلًا) |
| `GET /metrics` (كاشير) | محميّ بـ `jwtAuth`+`requireRole('admin','auditor')` أو `METRICS_API_KEY` |
| `middleware/health.js` (`/health`, `/api/health`, `/verbose`) | `/verbose` يتطلب admin **أو** localhost **أو** internal token |
| `GET /api/server/info` | اسم/إصدار/وقت فقط (عامة للاكتشاف) |
| `realtime/recovery-routes.js:145 /version` | إصدار التعافي |

**ملاحظة أمنية:** `finance-routes.js:26` و`notification-routes.js:544` يضعان `router.use(jwtAuth)` في مستوى الموجّه — كل المسارات اللاحقة محميّة رغم غياب `jwtAuth` في تعريف المسار الفردي (وهذا **ليس** ثغرة).

---

## قائمة المشاكل

### HIGH

| الموقع | المشكلة | الإصلاح المقترح |
|--------|---------|-----------------|
| `veg-requests-routes.js:371-376` | تعديل طلب الخضار متاح لأي `dept_head` دون تقييد قسمه (`isKitchenFamilyDeptHead` يُستخدم فقط في مسار الإنشاء `:35-40`) | تطبيق `resolveDeptHeadDispatch`/`inEmpScope` على مسار التعديل؛ رفض إن لم يكن `req.user.dept_code` ضمن `emp.department` |
| `warehouse-routes.js:879` | `PUT /dispatches/:id/edit` يسمح لأي `kitchen`/`sous_chef` بتعديل أي `dispatch` من أي قسم (التحقق يفحص الدور فقط لا القسم) | إضافة فحص قسم: `dept_code` الخاص بالمستخدم يجب أن يساوي `dispatches.dept` (مع دعم قائمة الفواصل) |
| `hr-routes.js:1009,1017,1026,1031`<br>`kitchen-production-routes.js:149,151`<br>`cashier-module/orders-routes.js:250` + ~55 أخرى | إرجاع `message: e.message` مباشرة — يُسرب أسماء الجداول/الأعمدة/قيود الـFK وتفاصيل التخطيط الداخلي | استخدام `AppError` (الذي يُخفي الـ stack في `toJSON`)؛ تسجيل `e` في `logger.error` وإرجاع رسالة عامة ثابتة لكل كود خطأ |
| `startup.js:131-141` | `fallbackDevSecret()` يبني JWT من `os.hostname()+totalmem()+cpus` (قابل للتخمين)، وله بديل ثابت `karim-dev-secret-change-me-...` | إلغاء الـ fallback نهائيًا؛ في الإنتاج `process.exit(1)` (يوجد بالفعل في `cashier-module/jwt-middleware.js:47-57`)؛ اجعل `startup.js` يرفض الإقلاع إن لم يوجد `JWT_*_SECRET` |

### MED

| الموقع | المشكلة | الإصلاح المقترح |
|--------|---------|-----------------|
| `server.js:142-174` | `ALLOWED_ORIGINS \|\| '*'` → CORS مفتوح؛ التحذير لا يمنع الإقلاع | جعل `ALLOWED_ORIGINS` إلزاميًا في الإنتاج (مثل سلوك `JWT_*_SECRET`) |
| `realtime/router.js:40,43`<br>`hr-routes.js:1622`<br>`leave-workflow-routes.js:200-201` | `dept_code` يُقارن بـ `===`/`!==` رغم أنه قائمة فواصل → رؤساء الأقسام متعددي الأقسام مُنعون (fail-closed، وظيفي معطوب) | استيراد دالة `split` موحّدة مثل `deptHeadEmpScope` (`hr-routes.js:1679-1684`) وتطبيقها في كل المقارنات |
| `server.js:718` | `identityRooms.push(\`dept:${user.dept_code}\`)` يسجّل اسم غرفة يحوي الفواصل الخام (`dept:CAF,SERVICE`) — لا أحد يستمع لها | تقسيم `dept_code` ودفع غرفة لكل قسم |
| `warehouse-routes.js:2444` | `GET /main-availability` متاح لأي مستخدم مصادَق — يكشف توفّر المخزن الرئيسي | إضافة `requireRoleOrPerm(['admin','manager','warehouse','accountant'], 'inventory.view')` |
| `warehouse-routes.js:520` | `DEPT_PANEL_ROLES` يتضمن `kitchen`/`sous_chef` — قد يفتح لوحة أقسام أوسع من اللازم | مراجعة القائمة؛ إبقاء `resolvePanelDept` كحاجز قسم كافٍ |
| `warehouse-routes.js:893` (و`veg-requests-routes.js:207`) | `veg-requests-routes.js:207` يستخدم `.split(',')[0]` (القسم الأول فقط) بينما `:35-40` تستخدم القائمة كاملة — تناقض دلالي | توحيد السلوك على `split(',')` الكامل |
| `server.js:~2611` | لا يوجد `httpServer.on('error')` — `EADDRINUSE`/`EACCES` يُحدثان `uncaughtException` | إضافة معالج: سجل الفحص ثم `process.exit(1)` |
| `server.js:2580-2709` | `startup.runAll({failFast:false})` يجري **بعد** `listen`، و`markBootComplete()` تُستدعى رغم فشل التحقق | نقل `runAll` قبل `listen`؛ إرجاع `markBootComplete()` شرطيًا على `result.ok` |
| `hr-routes.js:172`<br>`menu-board-routes.js:136`<br>`middleware/health.js:315,333,346`<br>`cashier-module/excel-import-routes.js:394` + 16 أخرى | 20 معالج `async` بلا `try/catch` وبدون `asyncHandler` | لفّها بـ `asyncHandler` الموجود في `server.js` أو إضافة `try/catch` يُعيد 500 برسالة عامة |
| `cashier-module/metrics.js:90` | `req.headers['x-api-key'] === METRICS_API_KEY` — مقارنة غير مقاومة للتوقيت | استخدام `crypto.timingSafeEqual` مع تغليف الطول (نفس نمط `server.js:482-484`) |
| `veg-requests-routes.js:371-376` | (مضمّنة في HIGH#1) | — |
| 60 دالة مُعرّفة في أكثر من ملف | `signatureHash`/`normalizeSignature`/`requireSignature`/`normalizeSignerName`/`signerMatchesAccount`/`accountDisplayName` مكرّرة في `warehouse-routes.js:291-326` و`inventory-control-routes.js:26-55` و`kitchen-production-routes.js:125-164`؛ `asyncHandler` مكرّر في `finance-routes.js:661`؛ `fail()` في 9 ملفات؛ مساعدات الوردية في `hr-routes.js:94-165` مقابل `shift-day.js` | استخراج إلى وحدة مشتركة `shared/` (مثال: `shared/signature.js`, `shared/async-handler.js`) وتصديرها |
| `server.js:507` | `setInterval(yaraGlSweep, 5*60_000)` بلا `.unref()` (الباقي في `:2669,:2691` مُرقّع) | إضافة `.unref()` لمنع حظر إنهاء العملية |

### LOW

| الموقع | المشكلة | الإصلاح المقترح |
|--------|---------|-----------------|
| `server.js:977-987` | `/api/server/info` عامة — تكشف `os.hostname()` و`version` | تقييدها بـ LAN/Tailscale أو إخفاء `serverName` |
| `hr-routes.js:269` | افتراض `https://192.168.1.165:5000` لـ `CARD_VERIFY_BASE` | إزالة الافتراض؛ اجعله إلزاميًا عبر `.env` |
| `attendance-portal-routes.js` (0 `BEGIN`، 5 `INSERT`) | الكتابة متعدّدة الجداول (punch_attempts + attendance + attendance_logs + notifications) بلا معاملة صريحة — لكن `attendance-engine.js:443-583` يغلق البصمة الأساسية بمعاملة | توثيق أن المسارات الباقية «كتابة واحدة لكل استدعاء» أو تغليفها |
| `whatsapp-engine/store.js` (0 `BEGIN`، 8 `INSERT`) | نفس الملاحظة — كتابات فردية غير حرجة | توثيق أو تغليف |
| التغليف (Envelope) غير موحّد | أول مفتاح في `res.json`: `error` 680، `ok` 417، `data` 11، `status` 9؛ `status:'success'` في 3 أماكن فقط؛ معالج الأخطاء العام يستخدم `{error:{id,code,status,...},requestId}` مقابل مستوى المسارات `{error:'CODE', message}` | توحيد على `{ok:boolean, data?, error?:{code,message}}` على مستوى `middleware` واحد |
| `cashier-module/metrics.js:94-97` | نمط `const auth = jwtAuth(req,res,(err)=>{...})` — إن نادى `jwtAuth` بالـ callback بخطأ قد يُعلّق الطلب بلا استجابة | استبدال بـ `asyncHandler` + `await` أو استخدام `Promise` |
| `middleware/health.js:293,301` | `/health` و`/verbose` بلا `requireRole` (لكن `/verbose` محميّ بـ admin/localhost/internal) | توثيق الصلاحية في تعليق صريح |
| `realtime/recovery-routes.js:145` | `/version` عامة | لا بأس إن كان الإصدار غير حسّاس |

---

## إحصاءات

| البند | القيمة |
|-------|--------|
| **إجمالي نقاط النهاية** | **582** (457 صريحة + 125 ديناميكية) |
| ملفات المسارات المُصدَّرة (router) | 42 |
| نقاط `use` للتوجيه (mounts) | 50 |
| مسارات صريحة: GET / POST / PUT / DELETE / PATCH | 214 / 189 / 24 / 29 / 1 |
| كيانات CRUD الديناميكية | 25 (× 5 مسارات = 125) |
| معالجات `async` بلا `try/catch` وبدون `asyncHandler` | 20 |
| مطابقات `query(\`...\${}\`)` (كلها مُرقّمة/مُعرّفة داخلية) | 30 |
| مطابقات `ORDER BY\|LIMIT\|OFFSET ${}` | 5 (كلها مقيّدة بـ `Math.min/Math.max`) |
| أسرار مُقنّنة في الكود | 0 |
| افتراضات `process.env.X \|\| 'default'` | 75 (أغلبها غير حسّاسة) |
| أخطاء `e.message` مُسربة في الاستجابة | ~60 |
| معاملات `BEGIN`/`COMMIT` (flows متعددة الكتابة) | مغلقة في: `warehouse-routes` (25/26)، `inventory-transfer` (6/6)، `complete-sale`، `hr-routes` (7/7)، `inventory-control` (6/6)، `attendance-engine` (1/1) |
| دوال مُعرّفة في أكثر من ملف | 60 |
| حجم `server.js` | 2709 سطرًا / 164,438 بايت |
| أول مفتاح في `res.json`: error / ok / data / status | 680 / 417 / 11 / 9 |
| `status:'success'` | 3 فقط (غير موحّد) |
| معالجات `JSON.parse` غير المحميّة | 6 (كلها داخل `try/catch` أو `next(e)`) |
| خيوط/مؤقّتات بلا `.unref()` | 1 (`server.js:507`) |

---

## خلاصة التوصيات حسب الأولوية

1. **أغلق فجوتَي الصلاحية** (`veg-requests` التعديل + `dispatches/:id/edit`) — تسمحان بتزوير بيانات قسم آخر.
2. **أوقف تسريب `e.message`** — استبدل بنمط `AppError` الموحّد.
3. **أجبر إعداد `JWT_*_SECRET` و`ALLOWED_ORIGINS`** في الإنتاج (سلوك `process.exit(1)` موجود للـ JWT؛ وسّعه للـ CORS).
4. **وحّد مقارنات `dept_code`** عبر دالة `split` واحدة تُصدَّر من `shared/`.
5. **انقل `startup.runAll` قبل `listen`** وأضف `httpServer.on('error')`.
6. **استخرج الدوال المكرّرة** إلى `shared/` لتقليل انحراف السلوك بين النسخ.
