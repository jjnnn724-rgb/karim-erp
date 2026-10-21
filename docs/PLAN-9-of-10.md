# خطة الوصول إلى 9/10 — قابلة للقياس بأمر واحد
## قياس تاريخي (2026-10-02 — لا يُعدّ قياسًا حاليًا)
- بوابة الجودة: `node scripts/quality-gate.js` → **9/9 ✅**
- الاختبارات: 979 ناجح على قاعدة معزولة `karim_erp_test` (الإنتاج لا يُلمس)
- الأداء: 2320 RPS قراءة، p95=41ms — وعاصفة دخول لا تجمد النظام (pw-crypto worker pool)
- الأمان: 225 مسار كتابة مفحوص آليًا (`npm run security:routes`) — الثغرة الوحيدة المكتشفة أُغلقت
- المالية: منسّق قيود `npm run finance:reconcile` — فجوات = 0 (أصلح 2 دفعة يتيمة فعليًا)

> هذه نتائج مؤرخة من 2026-10-02 ولا تثبت الحالة الحالية. لم يُعد تشغيل بوابة الجودة هنا لأنها تتصل صراحةً بقاعدة `karim_erp` وتفحص خادم HTTPS حيًا، كما أن منسّق المالية يكتب قيودًا محاسبية. لا تُشغّلهما على الإنتاج للتحقق من الدرجة.

## القياس المحلي الآمن (2026-10-20)
- TypeScript العادي والصارم: ناجح.
- ESLint: 0 أخطاء، 58 تحذيرًا.
- Jest كامل على PostgreSQL الاختباري المعزول: **199/199 suites، 3,167 اختبارًا ناجحًا، 8 todo** مع `--detectOpenHandles --forceExit` بعد إغلاق pools وإزالة عامل Pino في وضع الاختبار؛ لم يكشف الكاشف مقابض مفتوحة. التشغيل دون `--forceExit` طبع النجاح لكنه ظل حيًا ثم أُوقف، لذا الإنهاء الطبيعي غير مثبت. اختبار POS المركز نجح **8/8**.
- اختبارات وحدوية مركزة: اختبارات دفتر المخزون وoutbox وإيراد POS، ومنها **8/8** لاختبار ذرّية الإيراد وحالات اختيار رصيد الوصفة بعد إصلاح fallback.
- Sandbox PostgreSQL 18.6 على loopback: **109 migrations غير تجريبية** طبقت على قاعدة فارغة؛ استُبعدت `006_demo_seed.sql`. أُعيد تشغيل 090 و095 بنجاح.
- اختبارات DB فعلية: 6/6 (إيراد POS/idempotency، upsert JSONB، دفتر المخزون/replay متزامن بعميلين، خطأ outbox داخل transaction، واتزان/حصانة دفتر اليومية).
- دورة POS عبر HTTP على خادم مربوط بـ`127.0.0.1`: **18/18**. تحققت مصالحة ست مبيعات بين الفواتير والإيرادات والمدفوعات والقيود المتوازنة ومرآة `app_state`؛ كما تحققت نظافة الصفوف التجريبية بعد التنظيف. لا يشمل ذلك طابعة أو درج نقد فعليًا.
- اختبار مخزون وطباعة وصفة عبر HTTP/DB: **7/7** على نسخة مؤقتة من قاعدة الاختبار. بيع fallback خصم 2.5 مرة واحدة من المخزن الرئيسي، ومصالحة الأرصدة أثبتت المطبخ 0.5، الرئيسي 2.5، الإسقاط 3.0. وُضع الإيصال وKOT في queue كـbyte payloads بحالة pending فقط؛ تذكرة المطبخ تضمنت الصنف دون السعر/الإجمالي، ولم يعمل جهاز أو worker. عند تعطيل fallback رُفض البيع بـ409 بلا أمر/قيد/خصم/مفتاح تكرار أو تغيير رصيد. حُذفت النسخة المؤقتة بعد الاختبار، ولم تتغير قاعدة sandbox الأصلية.
- `pg_dump` ثم `pg_restore` على قاعدة اختبار مستنسخة: تطابق عدد الصفوف في **144 جدولًا**، و**1,281 قيدًا**، و**469 فهرسًا**، و**15 trigger**. أزيلت قاعدة النسخة المؤقتة وملف dump بعد التحقق؛ هذا ليس اختبارًا لسكربت التحديث أو استعادة إصدار التطبيق.
- الترقية/التراجع الإنتاجيان، الطباعة الميدانية، الأداء ونتيجة CI عن بُعد: لم تُختبر؛ اختبار الوصفة لا يغطي الطابعة أو دورة تحديث/استعادة التطبيق.
- **لا توجد درجة حالية 9/10 مثبتة بعد.** تقييم الإصلاحات في النطاق المفحوص 6/10؛ تقدير الجاهزية الإنتاجية 4/10. لا تُنسب القياسات التاريخية إلى الحالة الحالية.

## بند معماري كان مقررًا للتحسين (ليس شرطًا وحيدًا أو كافيًا للوصول إلى 9)
**فصل CRUD العام من server.js إلى backend/crud-router.js**

### خريطة الاستخراج الكاملة (التحليل أُنجز — التنفيذ تبقى)
- النطاق: السطور 1554→2230 (حلقة `entities.forEach`) + 17 دالة مساعدة (1232→1552):
  generateLegacyId, prepareDbValue, ensureIdForEntity, validateDeptHeadUserLink,
  validateDeptHeadUserUpdate, enforceAttendanceSelfService, publicEntityRow,
  viewerSafeRow, readRolesFor, ensureEmployeeUserLinkSchema, validateDeptParent,
  validateEmployeeUserLink, payrollMonthOf, payrollPeriodViolation, payrollRowViolation,
  purgeExpenseJournal, postExpenseJournal (+ SOCKET_SIGNAL_ONLY_ENTITIES,
  PAYROLL_GUARDED_ENTITIES, emitEntityChange).
- معرفات خارجية تُمرر كـ deps: app, io, entities, adminEntities, sensitiveReadEntities,
  entityNames, OPEN_ENTITY_WRITE_ROLES, asyncHandler, emitScoped, maskEmployeeRowForRole.
- تتطلب مباشرة في الوحدة الجديدة (بدون تمرير): pool, logger, jwtAuth, requireRole,
  requireRoleOrPerm, permForEntity, crudLimiter, generalLimiter, filterBody,
  validateColumnName, getSortableColumns, getSchema, getEntityWriteRoles, permForEntity,
  parsePaginationParams, buildPaginatedQuery, bcrypt(pw-crypto), encryptForVault,
  schema-registry, resolveDeptHeadDispatch, notifyChainEvent, accounting-periods.
- إجراء آمن: مرحلة أ = نقل الدوال الـ 17 + تشغيل البوابات. مرحلة ب = نقل الحلقة
  كدالة registerGenericCrud(app, deps) + البوابات. أي فشل → git checkout.

### بوابات القبول بعد كل مرحلة
1. node --check (server.js + crud-router.js)
2. jest كامل معزول: 979 ناجح
3. دخان البصمة: 18/18
4. E2E للـ CRUD: إنشاء/قراءة/تعديل/حذف على 3 كيانات عبر API بنتائج متطابقة قبل/بعد
5. بوابة الجودة 9/9

### البنود الأخرى المكتملة أو المجدولة
- ✅ عزل قاعدة الاختبار + النسخ الليلي المجدول + بوابة الصفر-صمت + المصفوفة الأمنية
  + منسّق المالية + أرشفة ياراسوفت (20GB → D:) — كلها منفذة ومقاسة.
- 📌 متبقي تحسيني (لا يعيق 9.0): جرس الإشعارات للأدوار المستهدفة (حاليًا أدمن فقط)،
  تقليص كتل الصمت في whatsapp-engine (118) تدريجيًا.

## أدوات القياس الجاهزة (أي حد يشغلها)
- `node scripts/quality-gate.js` — 9 بوابات PASS/FAIL
- `node scripts/security-route-audit.js` — 225 مسار
- `node scripts/finance-reconcile.js` — فجوات القيود
- `node scripts/audit-silent-catch.js` — خط أساس 253
- `node scripts/verify-punch-live.mjs` — دخان البصمة 18/18
- `npm run test:pos-inventory-http` — ينشئ قاعدة clone مؤقتة من `karim_erp_test` على loopback، يختبر خصم recipe/fallback، رفض نقص المخزون، وطوابير الإيصال وKOT دون طباعة فعلية، ثم يسقط النسخة. يتطلب `NODE_ENV=test`, `DB_HOST=127.0.0.1`, `DB_PORT`, `DB_NAME=karim_erp_test`, `DB_USER`, `DB_PASSWORD`, `KARIM_TEST_DB_NAME=karim_erp_test`, و`KARIM_TEST_DB_ISOLATED=1`.
- `npx jest` — 979 اختبار معزول
