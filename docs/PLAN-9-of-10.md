# خطة الوصول إلى 9/10 — قابلة للقياس بأمر واحد
## الوضع الحالي (مقاس فعليًا — 2026-10-02)
- بوابة الجودة: `node scripts/quality-gate.js` → **9/9 ✅**
- الاختبارات: 979 ناجح على قاعدة معزولة `karim_erp_test` (الإنتاج لا يُلمس)
- الأداء: 2320 RPS قراءة، p95=41ms — وعاصفة دخول لا تجمد النظام (pw-crypto worker pool)
- الأمان: 225 مسار كتابة مفحوص آليًا (`npm run security:routes`) — الثغرة الوحيدة المكتشفة أُغلقت
- المالية: منسّق قيود `npm run finance:reconcile` — فجوات = 0 (أصلح 2 دفعة يتيمة فعليًا)
- **الدرجة المقاسة الآن: 8.5/10** (كانت 5.5 قبل جولتي التصلد)

## البند الوحيد المتبقي للوصول إلى 9.0
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
- `npx jest` — 979 اختبار معزول
