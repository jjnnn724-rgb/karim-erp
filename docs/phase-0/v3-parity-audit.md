# جرد فجوات التكافؤ: V2 مقابل V3

**التاريخ:** 2026-11-10 · **آخر تحديث:** 2026-11-11 (بعد جرد الكتابة النهائي وإغلاق دفعات الـworkbenches)
**النطاق:** `frontend/app/js/v2/screens/*.js` و`frontend/app/js/v2/features` مقابل `v3/apps/web/src/routes/*`
**طريقة العمل:** جرد آلي لسمات الأفعال في V2 (`data-v2-*` و`data-pos-*` و`data-wa-*` و`data-ys-*` و`data-sa-*` و`data-cr-*`)، وجرد آلي لنداءات الكتابة في V3 (`useWriteMutation|writeAck|writeJson`) ونداءات `/api/...` في `v3/apps/web/src/lib/*.ts`، ثم قراءة يدوية لرؤوس الملفات وتعليقاتها التوثيقية. لا تخمين: ما لم يُتحقق منه مكتوب صراحةً «غير مؤكد».

**قياس الكتابة (2026-11-11، محلّل وسائط كامل — لا regex سطحي):**
- V1+V2: **252** نداء كتابة فريدًا (`method+endpoint`) في `frontend/app/js/**`.
- V3: **164** نداء كتابة فريدًا في `v3/apps/web/src/**`.
- **128** منها مطابق حرفيًا؛ **124** غير مطابق. جزء من الـ124 يغطّي الوظيفة بمسار مختلف (مثل `/warehouse/purchase-invoices` بدل `/procurement/invoices`)، والجزء الباقي فجوة فعلية موزّعة في §2 و§3 و§4.
- مسح شاشات V3 بمخطط الواردات (حتى 3 مستويات، مُعاد قياسه 2026-11-11 بعد دفعة واتساب والحضور ويارسوفت): **35** شاشة فيها كتابة فعلية؛ الشاشة القراءة-فقط الوحيدة التي كانت V2 تكتب فيها: **مركز التكلفة**.

**خطوط الأساس المقروءة:**
- `v3/apps/web/src/routes/routes.tsx` - 63 مسارًا + الجذر `/` + `/design` (سطر 475-541).
- `v3/apps/web/src/lib/screens.ts` - `V3_SCREENS` 63 مفتاحًا (سطر 10-74)، و`isScreenEnabled` (سطر 92).
- `v3/apps/web/src/lib/navigation.ts` - 7 مجموعات تغطي 63 مفتاحًا (سطر 43-143)، وعناوين المسارات (سطر 151-216).
- `v3/apps/web/src/lib/write.ts` - طبقة الكتابة الموحّدة `writeAck`/`writeJson`/`useWriteMutation`.
- `backend/*-routes.js` + `backend/{zkteco,whatsapp-engine,yarasoft}/routes.js` - لتأكيد وجود نقاط النهاية المطلوبة.

**ملاحظات كمية:**
- V2: 68 ملفًا في `frontend/app/js/v2/screens/`، منها `registry.js` سجل شاشات لا شاشة، و`login.js` صار بوابة `AuthGate` لا مسارًا.
- V3: 63 مفتاح شاشة معلن + `Home` + `AccountsTree` + `JournalViewer` + `Mudad` + `DesignGallery` + `FinanceRegister` (مكوّن مشترك لشاشتي الإيرادات والمصروفات).
- V3 لا يملك مسارًا لـ`compliance.js` (مركز تكامل WPS/GOSI/قوى)؛ أقرب تغطية هي `Mudad` وهي قراءة فقط.
- كل شاشات V3 تقريبًا تعتمد `PrintActions` للطباعة، فهذه ليست فجوة إلا حيث يغيب التصدير أو كشف السجل.

**الرموز:** «كاملة» = كل قراءة وكتابة V2 لها مقابل في V3 بعقدٍ مطابق. «ناقصة» = الشاشة موجودة وتفقد أفعالًا/حقولًا محددة. «غير منقولة» = لا شاشة ولا مسار.

---

## 1) مصفوفة الشاشات

| الشاشة (عربي) | مسار V2 | مسار V3 | الحالة | الفجوات المحددة | نقاط النهاية المطلوبة |
|---|---|---|---|---|---|
| تسجيل الدخول | `screens/login.js` | `AuthGate` (بلا مسار) | منقولة كاملة | البوابة تغطي كلمة المرور + TOTP + التسجيل + رموز الاسترداد + مفتاح المرور + تدوير كلمة المرور (`AuthGate.tsx:24-32`) | لا شيء |
| الرئيسية | `screens/dashboard.js` | `/` (`Home.tsx`) | منقولة كاملة | V2 فيه تحديث + روابط `data-dash-go` فقط؛ V3 يعرض مؤشرات وروابط سريعة حسب الدور | لا شيء |
| لوحة المحاسب | `screens/accountant-dashboard.js` | `/accountant-dashboard` | منقولة كاملة | قراءة فقط في الاثنين | لا شيء |
| لوحة رئيس القسم | `screens/dept-head-dashboard.js` | `/dept-head-dashboard` | منقولة كاملة | قراءة فقط في الاثنين | لا شيء |
| لوحة الموارد البشرية | `screens/hr-dashboard.js` | `/hr-dashboard` | منقولة كاملة | قراءة + طباعة في الاثنين | لا شيء |
| لوحة المخزن | `screens/warehouse-dashboard.js` | `/warehouse-dashboard` | منقولة كاملة | قراءة فقط في الاثنين | لا شيء |
| الموجز التنفيذي | `screens/executive.js` | `/executive` | منقولة كاملة | قراءة فقط في الاثنين | لا شيء |
| موجز المدير | `screens/briefing.js` | `/briefing` | منقولة ناقصة | لا كشف طلب ولا طباعة إيصال ولا زر «كل الطلبات» (`briefing.js:195`، `:326`، `:378`) | `GET /pos/orders/list`، `GET /pos/orders/ys/:docNo` |
| المدير المالي | `screens/cfo.js` | `/cfo` + `CfoGrowth` | منقولة كاملة (كتابات CFO) | أُغلق في V3 (2026-11-10): القيود (إنشاء/ترحيل/اعتماد/إلغاء)، الفترات (إقفال/فتح)، البنك (كشف/مطابقة تلقائية)، الأصول (إضافة/استبعاد/إهلاك شهري)، ترحيل الرواتب، الموازنات (إضافة/حذف)، إقرار العهد، وتشغيل التنبيهات — `cfo-write.ts` + `cfo-ops.ts` + `CfoWorkbench.tsx` + `CfoOpsPanel.tsx`. V3 يقرأ 7 تبويبات (`CfoGrowth.tsx:30-38`). يبقى تسليم العهدة (دور كاشير، خارج مسار المحاسب) وتسوية الضريبة وإنشاء الحسابات/المراكز | `GET /accounting/balance-sheet`, `GET /accounting/cash-flow`, `POST /accounting/vat-settlement`, `/accounting/chart`, `/accounting/cost-centers` |
| تحليل التكلفة | `screens/cost-analysis.js` | `/cost-analysis` | منقولة ناقصة | لوحة التوزيع/التدفق بين الأقسام (`data-v2-flow*`، `data-v2-attribution`) وترتيب الأصناف (`data-v2-rank`) وطباعة الخادم `/finance/cost-analysis/print` | `GET /finance/cost-analysis/print` |
| مركز التكلفة | `screens/cost-center.js` | `/cost-center` | منقولة ناقصة | إضافة بند مصروف/إيراد (`data-v2-add-*`)، وتشغيل دفعة إنتاج (`data-v2-prod-run`) وجدولها | `POST /expenses`, `GET/POST /productions` |
| الأرباح والخسائر | `screens/pnl.js` | `/pnl` | منقولة كاملة | قراءة + طباعة | لا شيء |
| المقارنة الشهرية | `screens/monthly-comparison.js` | `/monthly-comparison` | منقولة ناقصة | لوحة تفصيل الشهر (`data-v2-open-month`/`panel`)، مخطط أذون الصرف، فلتر الكاشير | `GET /finance/monthly-comparison/month` |
| التقفيل اليومي | `screens/daily-locks.js` | `/daily-locks` | منقولة كاملة | قراءة فقط في الاثنين | لا شيء |
| بيانات Oracle | `screens/oracle-data.js` | `/oracle-data` | منقولة كاملة | V3 يغطي البحث والتفصيل والطباعة وتحديث النسخة | لا شيء |
| المصروفات | `screens/expenses.js` | `/expenses` (`FinanceRegister`) | منقولة كاملة | إضافة/تعديل/حذف + فلاتر + طباعة | لا شيء |
| الإيرادات | `screens/revenues.js` | `/revenues` (`FinanceRegister`) | منقولة كاملة | مطابق للمصروفات | لا شيء |
| سجل الصرف | `screens/cash-register.js` | `/cash-register` | منقولة كاملة | قراءة فقط في الاثنين + كشف الإذن وطباعته | لا شيء |
| فواتير الموردين | `screens/invoices.js` | `/purchase-invoices` | منقولة كاملة | تسديد كامل/جزئي، إلغاء، مسح الكل | لا شيء |
| مدفوعات الموردين | `screens/payments.js` | `/payments` | منقولة كاملة | إضافة/حذف + عكس الدفع | لا شيء |
| الموردون | `screens/procurement.js` | `/procurement` | منقولة ناقصة | كشف حساب المورد (بحث/مستحق/مدفوع `data-v2-st-*`)، وتصدير الكشف | `GET /procurement/suppliers/:id/statement` |
| فواتير الشراء (مخزن) | `screens/wh-invoices.js` | `/purchase-invoices` | منقولة كاملة | إنشاء/تعديل/إلغاء/طباعة | لا شيء |
| طلبات الشراء | `screens/wh-prs.js` | `/wh-prs` | منقولة كاملة | إنشاء + اعتماد الشيف + اعتماد المدير + رفض/إلغاء/حذف | لا شيء |
| مرتجعات المطبخ | `screens/wh-returns.js` | `/wh-returns` | منقولة كاملة | إنشاء/حذف + إرجاع مباشر أو مرتبط بإذن | لا شيء |
| حركات المخزون | `screens/wh-moves.js` | `/wh-moves` | منقولة كاملة | قراءة + طباعة | لا شيء |
| المخزن مقابل POS | `screens/wh-vs-pos.js` | `/wh-vs-pos` | منقولة ناقصة | تصدير Excel (`data-v2-excel`)، اقتراح الأصناف (`data-v2-suggest`)، التحديث التلقائي/العد التنازلي (`data-v2-auto`/`countdown`) | `GET /yara-reports/item-suggest` |
| المخزون | `screens/warehouse.js` | `/warehouse` | منقولة ناقصة | جرد المخزون كامل (فتح/بدء/عدّ/إرسال/اعتماد/إلغاء)، استلام مجمّع، مواقع الرفوف، استيراد أرصدة افتتاحية Excel، أدوات الصلاحية | `GET/POST /warehouse/inventory/audits`, `/audits/:id/counts`, `/audits/:id/submit`, `/audits/:id/approve`, `/audits/:id/cancel`, `POST /warehouse/inventory/bulk-receipt`, `GET /warehouse/inventory/locations`, `/locations/:id/preview` |
| حوكمة المخزن | `screens/warehouse-gov.js` | `/warehouse-gov` | منقولة كاملة | إنشاء سنة مالية/إقفالها/إنشاء التالية + تقرير الأرصدة | لا شيء |
| الرفوف | `screens/shelves.js` | `/shelves` | منقولة كاملة | إضافة/تعديل/حذف + شبكة | لا شيء |
| مسح البضاعة | `screens/goods-scan.js` | `/goods-scan` | منقولة كاملة | ربط باركود + وارد + إذن صرف + كاميرا | لا شيء |
| محرك الاستعلامات | `screens/inventory-inquiry.js` | `/inventory-inquiry` | منقولة كاملة | فلاتر + بطاقة صنف + تصدير + طباعة | لا شيء |
| البطاقة الفاخرة | `screens/inventory-inquiry-pro.js` | `/inventory-inquiry-pro` | منقولة كاملة | قراءة + تصدير | لا شيء |
| الوصفات | `screens/recipes.js` | `/recipes` | منقولة ناقصة | محرر BOM (إضافة/حذف مكوّن، الوحدة، الهالك، التكلفة)، رفع صورة الصنف، مزامنة الوصفات القديمة، وحدات الوصفة | `PUT /pos/products/:id/ingredients`, `POST /pos/products/:id/image`, `POST /pos/recipes/sync-legacy`, `GET /pos/recipe-units`, `GET /pos/ingredients` |
| المطبخ | `screens/kitchen.js` | `/kitchen` | منقولة ناقصة | إنتاج جديد، جرد مطبخ جديد، تحويل جديد، اعتماد الجرد، سياسات، مستندات، بطاقات التكلفة؛ V3 يعرض `overview` فقط (`Kitchen.tsx:1-40`) | `POST /kitchen/production`, `/kitchen/audits`, `/audits/:id/count|submit|approve`, `/kitchen/transfers/receive`, `/kitchen/policies`, `GET /kitchen/documents`, `/kitchen/stock`, `/production/cost-cards` |
| الأقسام | `screens/departments.js` | `/departments` | منقولة ناقصة | روابط مراكز التكلفة (`data-v2-link-*`)، إضافة مصروف/إيراد من بطاقة القسم (`data-v2-exp-add`/`rev-add`)، علم المصنع (`data-v2-d-factory`) | غير مؤكد (روابط الأقسام تُقرأ من `dept-cashier-repo` V2) |
| أقسام الموارد البشرية | `screens/hr-departments.js` | `/hr-departments` | منقولة كاملة | إضافة/تعديل/حذف | لا شيء |
| موظفو القسم | `screens/dept-employees.js` | `/dept-employees` | منقولة كاملة | إضافة/تعديل/تعطيل + طباعة | لا شيء |
| دليل الموظفين | `screens/employees.js` | `/employees` | منقولة ناقصة | استيراد/تصدير Excel، رفع صورة، بطاقة QR (توليد/حفظ/طباعة/تجديد)، كشف الحضور داخل البطاقة | `POST /hr/employees/:id/qr/regenerate`, `GET /hr/employees/:id/card`, `/hr/employees/:id/lux-card`, `/hr/attendance/report`, `/hr/shift-schedule/:id` |
| الحضور والانصراف | `screens/attendance.js` | `/attendance` | منقولة كاملة (2026-11-11) | لا شيء — التصحيح والعذر ومعالجة الفجوات والتدقيق والكشف الشهري في `AttendanceWorkbench` | `AttendanceWorkbench.tsx` + `lib/attendance-write.ts` |
| بوابة الموظف | `screens/employee-portal.js` | `/employee-portal` | منقولة كاملة (2026-11-11) | لا شيء — الكتابة: البصمة الذاتية بنقرة واحدة (كاميرا + 6 قراءات موقع + رفض محلي موثَّق)، وتقوالب الوجه v1/v2 وإزالتها لـ admin/hr؛ الصرامة تحدد العيّنات وتمنع المعرض. القراءة: مبدّل موظف لـ admin/hr/manager، سجل حضور سنة-حتى-اليوم مع شارات الحالة والمصدر، طباعة اليوم/الشهر، سجل الإجازات، وملف الموظف (الراتب يُقنَّع خادميًا لغير المصرَّح). مُرحَّل `EmployeePortal.tsx` + `lib/employee-portal.ts` + `lib/portal-write.ts` + `FaceCaptureDialog.tsx` — 26 اختبار وحدة (17 كتابة + 9 قراءة) + 2 شاشة. مفاتيح V2 التجريبية `v2portalwrite`/`v2facewrite` غير منقولة (تحكم العميل، والخادم هو الحاكم) | `POST /attendance/portal/punch`, `/punch/client-reject`, `/face/enroll`, `/face/enroll-v2`, `DELETE /face/enroll/:userId` — قراءة: `GET /hr/attendance/report`, `/hr/leave-workflow`, `/leaveTypes`, `/settings/main_settings`, `/employees` |
| الإجازات | `screens/leaves.js` | `/leaves` | منقولة كاملة | إنشاء + اعتماد/رفض + إرجاع، مع سلسلة الاعتماد | لا شيء |
| الرواتب | `screens/payroll.js` | `/payroll` | منقولة كاملة (2026-11-11) | لا شيء — التوليد والخصومات في `PayrollWorkbench`، والسلف والبنود والعقود والتقييمات في `PayrollSuite` (CRUD عام بعقود `schema-registry` نفسها، أدوار admin/manager/hr)، وتصدير كشف الشهر CSV. `PayrollSuite.tsx` + `lib/payroll-suite.ts` — 5 اختبارات وحدة | `POST /hr/payroll-runs/generate`, `GET /hr/deductions/preview`, `POST /hr/deductions/apply`, `CRUD /salary_advances`, `/payroll_adjustments`, `/employee_contracts`, `/employee_evaluations` |
| مدد والتأمينات وقوى | `screens/compliance.js` | `/mudad` | منقولة كاملة (2026-11-11) | لا شيء — WPS/GOSI/قوى في `Mudad.tsx`، وتشغيل التكامل في `MudadDelivery.tsx` + `lib/integration-ops.ts`: سجل المزوّدين (التصنيف والدليل وآخر تحقق وتفعيل الموثّق فقط)، صندوق الصادر (عدّادات + dead_letter بإعادة/اعتماد/إلغاء بسبب مكتوب)، آخر 20 حدثًا. 6 اختبار وحدة | `GET /integration/health`, `/integration/providers`, `/integration/outbox`, `/integration/events`, `PUT /integration/providers/:code/settings`, `POST /integration/outbox/:id/retry|review` |
| الدوام | `screens/roster.js` | `/roster` | منقولة ناقصة | حفظ الأسبوع، نسخ الأسبوع السابق، طلب اعتماد، اعتماد رئيس القسم؛ `lib/roster.ts` لا يحوي أي دالة كتابة | `POST /hr/dept-roster-week`, `/hr/dept-roster-approval/request`, `/hr/dept-roster-approval/approve`, `GET /hr/dept-roster-approval/pending` |
| الأجهزة والجلسات | `screens/sessions.js` | `/sessions` | منقولة ناقصة | إدارة مفاتيح المرور (إضافة/حذف) غائبة عن V3 (`Sessions.tsx` لا يذكر `passkey`) | `GET /auth/webauthn/status` + مسارا تسجيل/حذف المفتاح (غير مؤكد المسار الدقيق) |
| المستخدمون | `screens/users.js` | `/users` | منقولة ناقصة (2026-11-11: رمز الاستعادة أُغلق) | إنشاء جماعي فقط (`data-v2-bulk` على `POST /users` دفعة) — يبقى مؤجلًا لأن V2 يحجبه خلف `v2bulkimport` افتراضيًا OFF. رمز الاستعادة منقول: زر «رمز استعادة» للمستخدم النشط غير الذاتي، `POST /auth/forgot-password/request-code`، عرضه LTR ونسخه (`data-v2-copy`)، 2 اختبار وحدة | `POST /users` (دفعة) |
| الفروع | `screens/branches.js` | `/branches` | منقولة كاملة | إنشاء/تعديل/تعطيل/تنشيط | لا شيء |
| الصلاحيات | `screens/permissions.js` | `/permissions` | منقولة كاملة | حفظ تجاوزات + سبب إلزامي | لا شيء |
| الإعدادات | `screens/settings.js` | `/settings` | منقولة كاملة (2026-11-11) | لا شيء — الأقسام الثمانية في V2 كلها موجودة (عام، القائمة الجانبية، ZATCA، تذاكر المطبخ، البطاقات، البصمة الذاتية، النسخ الاحتياطي، التصدير والتصفير) وقائمة الوجوه وفك ربط الجهاز وتجاهل المحاولات كانت منقولة سابقًا في `PunchSection`. أُضيف قسم «تحكم الخادم» (admin فقط) في `ServerControlSection.tsx` + `lib/server-control.ts`: حالة ERP وخدمة النظام وخدمة التحكم، وضع الصيانة، تشغيل/إيقاف/إعادة تشغيل بتأكيد حرفي (`بلا عبارة`/`STOP`/`RESTART`)، آخر عملية، وسجل الأوامر. 5 اختبارات وحدة للدوال | `GET /server-control/status`, `POST /server-control/actions`, `GET /attendance/portal/face/list`, `DELETE /attendance/portal/punch-devices/:userId` |
| طلبات الخضار | `screens/veg-requests.js` | `/veg-requests` | منقولة كاملة (2026-11-11) | لا شيء — إنشاء/استلام/تسعير/تعديل كميات/إلغاء + طباعة ورقة الطلب من صفّه مع عدّاد `print_count` (`lib/veg-print.ts` يبني A4 بنفس حقول V2، و`VegRequests.tsx` يطلق `markVegPrinted` فور الطباعة بلا انتظار مثل V2)، 4 اختبارات وحدة | `POST /veg-requests/:id/printed` |
| الميزان | `screens/weight.js` | `/weight` | منقولة كاملة | تسجيل/تعديل/حذف + سجل | لا شيء |
| أجهزة البصمة | `screens/zkteco.js` | `/zkteco` | منقولة كاملة (2026-11-11) | لا شيء — الأجهزة (إضافة/تعديل/حذف/فحص/مزامنة)، المحرك (تشغيل/إيقاف/إعادة بسبب مكتوب)، مسح الشبكة وإضافة المكتشَف، استيراد مستخدمي الجهاز، الربط التلقائي واليدوي مع كشف تعارض البديل، تجاهل/استعادة البصمة، التغطية والتشخيص، المطابقة، ومركز التحكم مع إعادة بناء الأيام. `ZktecoWorkbench.tsx` + `ZktecoAdmin.tsx` + `ZktecoControl.tsx` + `lib/zkteco-write.ts` + `lib/zkteco-admin.ts` — 12 اختبار وحدة + 2 شاشة | `GET/POST/PUT/DELETE /zkteco/devices`, `/:id/test|sync|stored-users|import-users`, `PUT /zkteco/mappings/:employeeId`, `POST /mappings/auto`, `GET /logs`, `/logs/:id/ignore|restore`, `POST /scan`, `/engine/:action`, `/rebuild-days`, `GET /control`, `/coverage`, `/reconciliation` |
| واتساب والتنبيهات | `screens/whatsapp.js` | `/whatsapp` | منقولة كاملة (2026-11-11) | لا شيء — كل تبويبات V2 في `WhatsappWorkbench` (الربط وQR، الوارد وحالة المحادثة، الصادر والإرسال، القوالب حفظًا وإرسالًا، الحملات، قواعد الرد، أرقام الإدارة، التنبيهات، سجل الأحداث، اسأل النظام) | `WhatsappWorkbench.tsx` + `lib/whatsapp-write.ts` يغطيان `POST /whatsapp/start|stop|logout|qr/refresh|pairing|send`, `GET /whatsapp/qr`, `/rules` (+POST/DELETE), `/managers` (+POST/DELETE), `/campaigns` (+approve/pause/cancel), `/templates` (+send), `/query`, `/automation` (+test), `GET /logs`, و`POST /chats/:jid/meta` |
| يارسوفت | `screens/yarasoft.js` | `/yarasoft` | منقولة كاملة (2026-11-11) | لا شيء — كل تبويبات V2 الثمانية في `YarasoftWorkbench` (الحالة والسجل، مراجعة الأصناف، الأقسام المعلقة بفواتيرها وإعادة تصنيفها، ربط المنتجات، Oracle، جودة البيانات، معاينة الصيغة، مرآة الكاشيرية)، مع الحفاظ على تقرير الإيرادات المحلية كتبويب ثانٍ | `YarasoftWorkbench.tsx` + `lib/yarasoft-write.ts` يغطيان `POST /yarasoft/run-now`, `/reprocess/:id`, `/review/:id/resolve`, `/mappings` (+DELETE), `/oracle/test|poll-now|import-items|organize|sync-balances`, `/sections/unmapped/:id/approve`، `/sections/map/:id/rename`, `/sections/manual`, `/sections/reclassify`, `POST /oracle/catch-up`, `POST /dry-run-preview`, `POST /mirror/refresh`, وقراءات `/status`, `/log`, `/log/:id/detail`, `/review`, `/mappings`, `/sections/map|unmapped|invoices|invoice-detail`, `/oracle/status|catch-up/status|reconcile|catalog-status`, `/quality/quarantine`, `/mirror/cashiers|orders|orders/:doc|close` (`daily-closing` خارج النقل: V2 لا يستدعيه) |
| مبيعات الكاشير | `screens/cashier-sales.js` | `/cashier-sales` | منقولة ناقصة | كشف الفاتورة/الصنف، طباعة سندات متعددة، لوحة الطلبات | `GET /cashier-sales/invoice/:doc`, `/cashier-sales/item/:code`, `/cashier-sales/orders` |
| متابعة الكاشير | `screens/cashier-monitor.js` | `/cashier-monitor` | منقولة ناقصة | تصدير Excel (`data-v2-excel`), كشف الطلب (`data-v2-order`) | `GET /cashier-monitor/orders/:docNo` |
| تحليل المبيعات | `screens/sales-analyzer.js` | `/sales-analyzer` | منقولة ناقصة | تبويبات الصنف/الطلب، كشف الطلب وطباعته، تصدير Excel | `GET /yara-reports/order-detail/:docNo` |
| استعلام المبيعات | `screens/sales-inquiry.js` | `/sales-inquiry` | منقولة ناقصة | بحث صنف/فاتورة، كشف الفاتورة، ورقة الطباعة | `GET /yara-reports/item-invoices`, `/item-outflow`, `/item-suggest` |
| تحليل المستلَم | `screens/received-analyzer.js` | `/received-analyzer` | منقولة ناقصة | كشف إذن الصرف وطباعته، تبديل التجميع، تصدير Excel | `GET /yara-reports/received-dispatch-detail/:id` |
| التقارير | `screens/reports.js` | `/reports` | منقولة ناقصة | خمس عائلات تقارير (عام/أقسام/مطبخ/مرتجعات/مخزن/موارد بشرية) وتصدير Excel؛ V3 تقرير مبيعات POS فقط (`Reports.tsx:18-36`) | `GET /yara-reports/cashier-items`, `/yara-reports/departments`, وحزمة `reports-extra` المحلية |
| نقطة البيع | `screens/pos-entry.js` | `/pos-entry` | منقولة كاملة | بوفيه + وردية + طلبات معلّقة + تقفيل + إعادة طباعة + إلغاء + درج | لا شيء |
| شاشة القائمة | `screens/menu-board.js` | `/menu-board` | منقولة كاملة | إطار العرض الكامل | لا شيء |
| سجل الشاشات | `screens/registry.js` | - | ليس شاشة | ملف تسجيل داخلي لا واجهة | - |
| شجرة الحسابات | - (كانت تبويبًا في `cfo.js`) | `/accounts` | شاشة V3 جديدة | قراءة فقط من `/api/v3/accounting/chart` | - |
| القيود اليومية | - (كانت تبويبًا في `cfo.js`) | `/journal` | شاشة V3 جديدة | قراءة فقط من `/api/v3/accounting/journal` | - |
| مركز التكامل (امتثال) | `screens/compliance.js` | - | غير منقولة | لا مسار في V3؛ غطّى `Mudad` قراءة WPS/GOSI/قوى فقط | (انظر صف مدد) |

---

## 2) أعلى 10 فجوات تأثيرًا

الترتيب مبني على سؤالين: هل الفجوة تمنع إتمام دورة عمل يومية أو شهرية بالكامل من داخل V3؟ وهل تدفع المستخدم للرجوع إلى V2 أو للتدخل اليدوي؟ الأدلة كلها من ملفات V2 داخل `frontend/app/js/v2/screens/`، والخادم المقابل مذكور لبيان أن الـ endpoint موجود ومفعّل وليس ناقصًا.

### 1) جرد المخزون الفعلي وترحيل الفروق والرصيد الافتتاحي
- **الأثر:** بعد أول جرد لا يمكن إغلاق الجلسة ولا ترحيل الفروق من V3، فتصبح أرصدة النظام غير موثوقة وتُدار التسويات يدويًا.
- **دليل V2:** `warehouse.js:1534` و`warehouse.js:1621` (فتح/إدارة جلسة الجرد)، `warehouse.js:1877` و`warehouse.js:1879` (اعتماد وترحيل فروق الجرد)، `warehouse.js:617` و`warehouse.js:620` و`warehouse.js:2293` (الرصيد الافتتاحي وإعادة الاحتساب).
- **الخادم:** `backend/stocktaking-routes.js` و`backend/inventory-control-routes.js` (مسارات الجرد والمواقع والسنوات المالية موجودة).
- **V3:** أُغلقت (2026-11-10/11): `InventoryAuditStudio.tsx` + `lib/inventory-audits.ts` يغطيان فتح الجلسة، العدّ، الإرسال، الاعتماد، الإلغاء، والاستلام المجمّع؛ و`lib/inventory-write.ts` للمخزون. الواجهة موصولة في `Warehouse.tsx`.

### 2) الرواتب: توليد المسير والاستقطاعات
- **الأثر:** مسير الرواتب الشهري لا يُنشأ من V3؛ كل شهر يعني الرجوع إلى V2 أو إدخال خارج النظام.
- **دليل V2:** `payroll.js:61` (زر التوليد generate)، `payroll.js:67` (معاينة الاستقطاع)، `payroll.js:369` (تطبيق الاستقطاع على المسير).
- **الخادم:** `backend/hr-routes.js` (توليد مسير الرواتب + الاستقطاعات + اعتمادات الجدول).
- **V3:** أُغلقت (2026-11-10): `PayrollWorkbench.tsx` + `lib/payroll-write.ts` يغطيان توليد المسير، معاينة الاستقطاع وتطبيقه، واعتمادات المسير؛ الشاشة موصولة في `Payroll.tsx`، مع اختبارات وحدة (`payroll-write.test.ts`).

### 3) كتابات CFO: القيود والتسويات وإقفال الفترات — أُغلقت (2026-11-10)
- **الأثر:** كان لا قيد يدوي ولا إقفال فترة من V3 — وهي عمليات لا تحتمل التأجيل نهاية الشهر.
- **دليل V2:** `cfo.js:162`، `cfo.js:252` و`cfo.js:253`، `cfo.js:435` و`cfo.js:436`، `cfo.js:649`، `cfo.js:672` و`cfo.js:673`.
- **الخادم:** `backend/accounting-routes.js:833` (قيد)، `:856` (إلغاء)، `backend/accounting-periods.js:165` (اعتماد)، `:108` (إقفال فترة)، `:135` (إعادة فتح — admin وحده).
- **V3:** `lib/cfo-write.ts` (تحقق بالسنت وتوازن + أبواب القيود والفترات)، `lib/cfo-ops.ts` (بنك/أصول/إهلاك/رواتب/موازنات/عهد/تنبيهات)، `CfoWorkbench.tsx` + `CfoOpsPanel.tsx` مربوطان في `screens/Cfo.tsx`، مع 12 اختبار وحدة للطبقتين. الأدوار: كتابة `admin|accountant`، إعادة فتح الفترة `admin`، وإقرار العهدة لمن هي له. المتبقي: تسليم العهدة (كاشير)، تسوية ضريبة، إنشاء حساب/مركز تكلفة.

### 4) المطبخ: الإنتاج والتحويلات وسياسات التكلفة
- **الأثر:** دورة الإنتاج اليومي (أمر إنتاج ثم استهلاك ثم تحويل ثم تكلفة) غير مكتملة، فتكلفة الأصناف المُنتَجة تبقى تقديرية.
- **دليل V2:** `kitchen.js:226` و`kitchen.js:229` و`kitchen.js:232` (إنتاج/استهلاك)، `kitchen.js:1035` (تحويل)، `kitchen.js:1226` و`kitchen.js:1235` (سياسات/تكلفة)، `kitchen.js:1412` (إجراء إداري).
- **الخادم:** `backend/kitchen-production-routes.js` (إنتاج، تدقيق، تحويلات، سياسات، مستندات، بطاقات تكلفة).
- **V3:** أُغلقت (2026-11-10): `KitchenStudio.tsx` + `lib/kitchen-ops.ts` يغطيان أمر إنتاج، استلام التحويلات، جلسات جرد المطبخ (فتح/عدّ/إرسال/اعتماد)، والمستندات؛ موصولة في `Kitchen.tsx`.

### 5) ZKTeco: الأجهزة والمزامنة وربط المستخدمين
- **الأثر:** أي جهاز بصمة جديد أو إعادة مزامنة أو ربط موظف ببصمة يتطلب V2؛ وترحيل الحضور يعتمد على ذلك.
- **دليل V2:** `zkteco.js:121`، `zkteco.js:189`، `zkteco.js:526`، `zkteco.js:812`، `zkteco.js:1263`.
- **الخادم:** `backend/zkteco/routes.js` (devices CRUD، test/sync، users/stored-users/import، mappings، logs ignore/restore، engine actions، rebuild-days).
- **V3:** أُغلقت كاملة (2026-11-11): `ZktecoWorkbench.tsx` (إضافة/تعديل/حذف الجهاز، فحص الاتصال، المزامنة، تشغيل/إيقاف/إعادة المحرك) + `ZktecoAdmin.tsx` (مسح الشبكة وإضافة المكتشَف، استيراد المستخدمين مع قسم اختياري، الربط التلقائي واليدوي مع عرض البديل المخاطِر) + `ZktecoControl.tsx` (سجل البصمات الخام بتجاهل/استعادة بسبب مكتوب، مركز التحكم وسجل التدقيق، تغطية الربط وتشخيص كل موظف، مطابقة دفتر الجهاز بدفتر النظام، وإعادة بناء الأيام بحدّ 31 يومًا). الطبقتان `lib/zkteco-write.ts` + `lib/zkteco-admin.ts` — 12 اختبار وحدة + 2 شاشة.
### 6) واتساب: تشغيل المحرك وربط الجلسة والحملات
- **الأثر:** لا يمكن تشغيل المحرك أو إعادة ربط QR أو إرسال حملة من V3؛ أي انقطاع في الجلسة يعني توقف الإشعارات حتى يُفتح V2.
- **دليل V2:** `whatsapp.js:264` إلى `whatsapp.js:267` (start/stop، QR، pairing، إرسال).
- **الخادم:** `backend/whatsapp-engine/routes.js` (start/stop/qr/refresh/pairing/send، rules، managers، campaigns مع approve/pause/cancel، templates، query، automation مع test).
- **V3:** أُغلقت (2026-11-11): `WhatsappWorkbench.tsx` + `lib/whatsapp-write.ts` ينقلان تبويبات V2 كاملة (الربط وQR مع توليد الصورة محليًا، السجل وحالة المحادثة، الصادر والإرسال، القوالب، الحملات، القواعد، أرقام الإدارة، التنبيهات، السجل، اسأل النظام) مع حجب الأزرار بحسب الدور كما V2. وأُصلحت ثلاثة عقود قراءة كانت مكسورة: الحالة من `connection.state` (لا `status`)، محادثات الوارد من `remote_jid`، الصادر من `preview`، والقوالب من `templates`. 25 اختبارًا (وحدة + شاشة) لعقود V2 الحرفية.

### 7) Yarasoft: إعادة المعالجة والتسويات والأقسام وربط Oracle والمرآة
- **الأثر:** أخطاء المطابقة مع يارا سوفت لا تُصلح من V3، والأقسام غير المعيّنة وفواتيرها لا تُعتمد أو تُعاد تصنيفها.
- **دليل V2:** `yarasoft.js:331`، `yarasoft.js:601`، `yarasoft.js:772`.
- **الخادم:** `backend/yarasoft/routes.js` (run-now، reprocess، review resolve، mappings، oracle test/poll/import/organize/sync-balances/catch-up/reconcile، sections approve/rename/manual/reclassify، dry-run-preview، mirror refresh).
- **V3:** أُغلقت (2026-11-11): `YarasoftWorkbench.tsx` + `lib/yarasoft-write.ts` ينقلان تبويبات V2 الثمانية بنفس العقود، مع حجب الكتابة عن غير `admin|manager` كما V2. الإقفال اليومي (`daily-closing/close|reopen`) **لم يُنقل عن قصد**: فحص V2 أثبت أنه لا يستدعيه، وV3 يغطي القراءة في `DailyLocks`. 25 اختبار وحدة لعقود الكتابة/التحقق + 5 اختبارات شاشة (التبويبان، قراءة الإيرادات المحلية، الفلترة، رسالة الخطأ).

### 8) تصحيحات الحضور والبصمات
- **الأثر:** لا تصحيح بصمة منسية ولا تعديل وردية ولا اعتماد إذن من V3، فتتسرب الأخطاء إلى الرواتب مباشرة.
- **دليل V2:** `attendance.js:402`، `attendance.js:688`، `attendance.js:781`، `attendance.js:830`.
- **V3:** أُغلقت (2026-11-11): `AttendanceWorkbench.tsx` + `lib/attendance-write.ts` يغطيان تصحيح البصمة، العذر الإداري، معالجة فجوات الفترة، التدقيق الصارم، وكشف الحضور الشهري؛ موصولة في `Attendance.tsx` مع اختبارات وحدة (`attendance-write.test.ts`).

### 9) الموظفون: البطاقة و QR والاستيراد
- **الأثر:** إصدار بطاقة موظف أو QR أو استيراد كشف موظفين من ملف يتطلب V2؛ V3 يغطي تحرير بيانات الموظف فقط.
- **دليل V2:** `employees.js:413`، `employees.js:956`، `employees.js:1254`، `employees.js:1317`.
- **الخادم:** `backend/hr-routes.js` (بطاقة الموظف و QR وإجراءات الاستيراد).
- **V3:** `Employees.tsx` فيه كتابة أساسية (إنشاء/تعديل) لكن لا أزرار بطاقة أو QR أو استيراد. التفصيل الدقيق لكل إجراء: **غير مؤكد** ويحتاج جردًا يدويًا للأزرار.

### 10) الدوام (Roster) والامتثال
- **الأثر:** لا نشر جدول أسبوعي ولا اعتماد ورديات من V3، وتقارير الامتثال (WPS/GOSI) غير مكتملة لأن شاشة الامتثال القديمة لم تُنقل.
- **دليل V2:** `roster.js:71` و`roster.js:74` و`roster.js:337` و`roster.js:346` (نشر/اعتماد/تعديل ورديات)، و`screens/compliance.js` (شاشة كاملة).
- **V3:** أُغلق الدوام (2026-11-10): `RosterWorkbench.tsx` + `lib/roster-write.ts` يحفظان الأسبوع ويطلبان الاعتماد ويعتمدانه. وأُغلقت شاشة الامتثال (2026-11-11): `Mudad.tsx` يغطي WPS/GOSI/قوى، و`MudadDelivery.tsx` يغطي المزوّدين وصندوق الصادر والأحداث.

### فجوات أخرى مؤثرة (خارج العشرة الأولى)
- **التقارير:** `reports.js:40` إلى `reports.js:46` تغطي خمس عائلات تقارير، وV3 `Reports.tsx:18-36` يعرض تقارير POS فقط.
- **الإحاطة اليومية (Briefing):** `briefing.js:195` و`briefing.js:326` و`briefing.js:378` فيها إجراءات كتابة غير موجودة في V3.
- **طلبات الخضار (veg-requests):** `veg-requests.js:781` إجراء كتابة غير منقول. (أُغلق 2026-11-11: `markVegPrinted` منقول مع ورقة الطلب الواحدة في `VegRequests.tsx` + `lib/veg-print.ts`.)
- **جلسات الدخول (Sessions):** `sessions.js:42-43` فيها تسجيل/إزالة passkey، وV3 `Sessions.tsx` فيه إبطال جلسة وإبطال الجلسات الأخرى فقط، بلا passkeys.
- **ملاحظة منهجية:** المسح أظهر صفر كتابة في شاشات مثل `CashierSales` و`CashierMonitor` و`SalesAnalyzer` و`SalesInquiry` و`ReceivedAnalyzer` و`WhVsPos` و`CostAnalysis` و`MonthlyComparison` و`HrDashboard` و`Executive` و`WarehouseDashboard` و`MenuBoard` و`CostCenter` و`AccountantDashboard` و`DeptHeadDashboard`، وهذه للقراءة فقط في V2 أيضًا، فلا تُحسب فجوات وظيفية.

---

## 3) شاشات V3 للقراءة فقط بينما V2 كان يكتب (مُعاد قياسه 2026-11-11)

المسح الجديد لم يعد يقرأ ملف الشاشة وحده، بل يتتبّع وارداتها حتى ثلاث مستويات (`screens/*.tsx` ← `components/*` ← `lib/*`) ويعتبر الشاشة كاتبة إذا وصل منها أي مسار إلى `writeJson`/`writeAck`/`useWriteMutation` أو `fetch(... method: 'POST'|'PUT'|'PATCH'|'DELETE')`، مع استثناء `lib/auth.ts` (تسجيل الدخول) و`lib/write.ts` (الطبقة نفسها).

| الشاشة في V3 | الملف | دليل غياب الكتابة في V3 (2026-11-11) | الكتابة في V2 (دليل) |
|---|---|---|---|
| مركز التكلفة | `screens/CostCenter.tsx` | لا واردات كتابة؛ إضافة مصروف/إيراد وتشغيل دفعة الإنتاج غير موجودة | `cost-center.js:198`, `:405` — `POST /expenses`, `GET/POST /productions` |

**أُغلقت بعد الجرد الأول (ولم تعد فجوات):** الرواتب (`PayrollWorkbench` + `payroll-write`)، الدوام (`RosterWorkbench` + `roster-write`)، المطبخ (`KitchenStudio` + `kitchen-ops`)، جرد المخزون (`InventoryAuditStudio` + `inventory-audits`)، الميزان (`weight-write`)، الوصفات (`recipes-write`)، أجهزة البصمة جزئيًا (`ZktecoWorkbench` + `zkteco-write`)، الحوكمة (`warehouse-gov`)، الحضور (`AttendanceWorkbench` + `attendance-write`، 2026-11-11)، واتساب (`WhatsappWorkbench` + `whatsapp-write`، 2026-11-11)، ويارسوفت (`YarasoftWorkbench` + `yarasoft-write`، 2026-11-11)، وبوابة الموظف (`EmployeePortal` + `portal-write` + `FaceCaptureDialog`، 2026-11-11).

**ملاحظة مهمة:** الشاشات التي ظهرت بصفر كتابة في V2 أيضًا (`CashierSales`, `CashierMonitor`, `SalesAnalyzer`, `SalesInquiry`, `ReceivedAnalyzer`, `WhVsPos`, `CostAnalysis`, `MonthlyComparison`, `Executive`, `HrDashboard`, `WarehouseDashboard`, `AccountantDashboard`, `DeptHeadDashboard`, `MenuBoard`, `Pnl`, `JournalViewer`, `AccountsTree`, `InventoryInquiry`, `InventoryInquiryPro`, `DailyLocks`, `CashRegister`, `Briefing`) ليست فجوات كتابة، وتم استبعادها.

### 3-أ) إغلاق فجوة الكاشير (2026-11-11)

`pos_shift_sessions.id=5` بقي مفتوحًا من يوم 2026-11-10 (الرياض)، فصار الخادم يرفض كل بيع بـ`409 SHIFT_STALE` (121 بايت). الإصلاح في V3 يكتشف وردية اليوم السابق من `opened_at` بتوقيت الرياض، يمنع عرض الأصناف والبيع، ويعرض لوحة «إغلاق وردية الأمس» تفتح حوار الإغلاق القائم (عدّ نقدي فعلي)، ويعالج `409 SHIFT_STALE` بإعادة جلب الوردية ورسالة عربية صريحة. لا تغيير خلفي ولا بيانات مالية مُستحدثة.

---

## 4) ملحق: نقاط نهاية موجودة على الخادم وغير مستخدمة من V3 (مُعاد قياسه 2026-11-11)

هذه المسارات مُسجَّلة في الخادم ومفعّلة، ولا يصل إليها أي مسار كتابة من `v3/apps/web/src`. ما أُغلق منذ الجرد الأول (الجرد والمخزون، المطبخ، الرواتب والاستقطاعات، الاعتمادات، المحاسبة والفترات، الدوام، أجهزة ZKTeco الأساسية) أُزيل من هذه القائمة لأنه صار له مقابل مقيس:

- **ZKTeco:** أُغلق بالكامل (2026-11-11) عبر `ZktecoWorkbench` + `ZktecoAdmin` + `ZktecoControl` — مسح الشبكة، استيراد المستخدمين، الربط التلقائي/اليدوي، تجاهل/استعادة البصمة، إعادة بناء الأيام، وقراءات `/control`، `/coverage`، `/reconciliation`.
- **Yarasoft:** أُغلق (2026-11-11) بكل مسارات V2 عبر `YarasoftWorkbench`. يبقى `daily-closing/close|reopen` بلا واجهة عن قصد (V2 لا يستدعيه، والقراءة متاحة في `DailyLocks`).
- **مركز التكلفة:** `POST /expenses` و`POST /revenues` من بطاقة القسم، و`GET/POST /productions` لتشغيل دفعة الإنتاج وجدولها.
- **الامتثال والتكامل:** `GET /integration/outbox` و`/events` و`/providers` و`/health`، `POST /integration/outbox/:id/retry|review`، `/integration/providers/:code/settings`، و`/integration/credentials/:provider/:key` — `Mudad` يقرأ WPS/GOSI/قوى فقط.
- **الموظفون:** `POST /hr/employees/:id/qr/regenerate`، `GET /hr/employees/:id/card` و`/lux-card`، `GET /hr/attendance/report`، `GET /hr/shift-schedule/:id`، واستيراد/تصدير Excel ورفع الصورة.
- **المستخدمون والجلسات:** الإنشاء الجماعي (`v2bulkimport`، OFF افتراضيًا في V2)، وتسجيل/حذف مفاتيح المرور (`/auth/webauthn/*`). (رمز الاستعادة/نسخه أُغلق 2026-11-11 في `Users.tsx`.)
- **أفعال متفرقة:** كشف طلب المدير من الموجز، وتصدير Excel في شاشات التحليل، وطباعة تقرير التكلفة على الخادم (`/finance/cost-analysis/print`)، وكشف حساب المورد، واقتراح الأصناف في «المخزن مقابل POS»، وعائلات التقارير الخمس. (تحكم الخادم `/server-control/*` أُغلق 2026-11-11 في `ServerControlSection`، وتعليم طلب الخضار مطبوعًا أُغلق في `VegRequests`.)

**الخلاصة:** بعد دفعات 2026-11-10/11 لم يبقَ في الخادم مسار وظيفي بلا مقابل إلا ما بُني في V2 ولم يُنقل بعد؛ النقص في طبقة الواجهة لا في الخادم، والعلاج هو ربط الشاشات عبر `lib/write.ts` بعقود V2 نفسها دون تغيير قواعد العمل.