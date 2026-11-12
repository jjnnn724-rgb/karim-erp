# الجرد الرئيسي للإصدارات — V1 ↔ V2 ↔ V3

**المستودع:** `karim-erp` · **التاريخ:** 2026-11-11 (+03) · **المرجع الزمني للبيانات:** قياسات مباشرة موثّقة في الملحق

> هذا الجرد يغطي **الأسطح** (شاشات، واجهات، بيانات، هجرات، أدوار، اختبارات، نشر) ويعتمد على
> قياسات آلية من الشجرة وقاعدة الإنتاج، لا على الانطباع. الجرد الرقمي التفصيلي للجداول
> موجود في [`v1-v2-v3-inventory.md`](v1-v2-v3-inventory.md) (لقطة 2026-11-11T03:33Z)،
> ومصفوفة تكافؤ V1→V2 في [`V2-PARITY-MATRIX.md`](V2-PARITY-MATRIX.md) (2026-10-17)،
> وقرار الأسطح في [`adr/ADR-009-surfaces-v2-v3.md`](adr/ADR-009-surfaces-v2-v3.md).

---

## ٠. الملخص التنفيذي

| السطح | V1 (القديم) | V2 (`/app/v2.html`) | V3 (`/v3/`) |
|---|---:|---:|---:|
| الشاشات | 46 مفتاحًا في الموجّه (44 حيّة + مفتاحان ميتان) + `pos` مستقل | 63 شاشة قابلة للتركيب + قسم امتثال (65 ملفًا مع المحمّل) | 63 مفتاحًا في `screens.json` (66 مسار شاشة + الجذر) |
| نداءات الشبكة | 349 نداءً / 266 مسارًا (10-17) | 303 نداءات (10-17) / 331 مسارًا متميزًا (11-11) | 3 مسارات `/api/v3/*` + استهلاك الواجهات القديمة |
| الاختبارات المرتبطة | — | 115 مجموعة `tests/v2-*` | 160 ملف اختبار وحدوي + 4 E2E |
| الحالة | مسار كامل للطوارئ | كامل وخلفه V3 | **المدخل الأساسي منذ 2026-11-10 20:22** |

- **مطابقة حرفية: 59 من 64 وحدة V2.** بديل وظيفي لأربعة (`dashboard` → لوحات الأدوار،
  `login` → `/v3/login`، `invoices` → `purchase-invoices`، `wh-invoices` →
  `purchase-invoices`) ⇒ **تغطية وظيفية 63/64**. (`registry.js` محمّل كسول لا شاشة،
  فلا يُحتسب في المقارنة.)
- **الفجوة الوظيفية الوحيدة:** قسم `compliance` (الامتثال السعودي) — مؤجل بقرار ADR-009
  إلى ما بعد قلب 11-16، وهو قسم داخل شاشة الإعدادات لا شاشة مستقلة.
- **أربعة مفاتيح V3 جديدة:** `accounts`, `journal`, `mudad`, `purchase-invoices`
  (الأخير هو الاسم الجديد لـ`wh-invoices`).
- **فصلٌ جديد في V3 لم يكن في V1/V2:** شاشتا `accounts` و`journal` — قارئان جديدان
  فوق نفس قاعدة البيانات بعقد قراءة نصّي معلن (ADR-04/05)، دُشّنا في هذا الجرد.
- **قاعدة الإنتاج:** 147 هجرة مسجّلة (لا وجود لـ146)، 237 جدولًا، 41,774 قيدًا و83,785 سطرًا،
  و165 جدولًا فيها بيانات (1,803,421 صفًّا) منها 61 جدولًا لا يقرأه أي سطح بعد.

**التقييم الإجمالي: 8.4/10** — تغطية شاشات ممتازة، وعقد قراءة V3 نظيف ومُثبَت حيًّا؛
الخصم الأكبر على 61 جدول بيانات بلا قارئ، وعلى انحراف الالتزام (البناء الحي أحدث من HEAD)
وبوابة أمان حمراء في ملفات غير مُلتزَم بها. التفصيل في §11.

---

## ١. تعريف الأجيال الثلاثة (من الأدلة لا من الذاكرة)

| الجيل | التعريف | الدليل |
|---|---|---|
| **V1** | الواجهة القديمة كاملة: صفحات `frontend/app` ووحداتها خارج `js/v2`، بما فيها `pos.html` المستقل | `js/features/page-router.js` (46 حالة: 44 حيّة + مفتاحان ميتان)، `docs/V2-PARITY-MATRIX.md §١`، `README.md:160` («الواجهة القديمة V1 لها لوحتها المستقلة… لا تُعدّلها»)، `DESIGN.md:517` |
| **V2** | قوقعة `/app/v2.html` وشاشاتها في `js/v2/screens/*.js` فوق نفس أبواب الخادم | `frontend/app/js/v2/`، 65 ملف شاشة |
| **V3** | تطبيق React (TanStack Router) يُبنى من `v3/apps/web` ويُقدَّم جاهزًا من `frontend/v3` على `/v3/`، بعقد قراءة نصّي خاص | `v3/packages/shared/src/v3-read.ts`، `backend/v3-static.js` |

**تعريفات صريحة في المستندات:** ADR-009 («أسطح العرض: إعدادات V2 ثم V3») هو المرجع الرسمي
للفصل بين السطحين؛ عقد إكمال V2 (`docs/V2-COMPLETION-CONTRACT.md`) يلزم بأن تكون V2
«طبق الأصل» للقديم قبل الانتقال. لم يظهر تعريف مستقل مكتوب لـ«V1»؛ الحدّ المستخدم هنا هو
حد `js/v2` الذي تعتمده مصفوفة التكافؤ نفسها.

---

## ٢. مسار الانتقال والحالة التشغيلية

| الحدث | التاريخ | الدليل |
|---|---|---|
| تكافؤ V2 مع القديم (#26–#31) | 2026-10-17 → 2026-10-23 | `V2-PARITY-MATRIX.md` §٦ |
| بناء V3 ونشره على `/v3/` | 2026-11-10 | `frontend/v3/index.html` |
| **قلب V3 مدخلًا أساسيًا** | **2026-11-10T20:22+03:00** | `frontend/v3/rollout.json` |
| نشر بناء أحدث (خارج HEAD) | 2026-11-11 06:52 | `frontend/v3/index.html` = `assets/index-xMpf1XHe.js` |
| إعادة تشغيل الخدمة (جلسة خارجية) | 2026-11-11 06:58:00 | `KarimERP-Service.exe` PID 21528 ← node 25840 |
| تطبيق هجرات الإنتاج 127/137/138/144/145/147 | 2026-11-11 00:06:45–47 | `schema_migrations.applied_at` |

> **تعارض وثائقي مسجَّل:** ADR-009 ونصوص إعلان V2 (`v2-announce.js`) وما زال في
> `backend/server.js` يذكرون القلب «2026-11-16 06:00»، بينما `rollout.json` نُفِّذ
> 2026-11-10 20:22 بأمر المالك. الفعلي هو `rollout.json` (مصدر الحقيقة الوحيد في
> `backend/rollout.js`)؛ التحديث الوثائقي مؤجل بقرار.

> لا يوجد مستند يعلن إيقاف V1 رسميًّا بتاريخ محدد (تعريفه مستنبط من README/DESIGN
> وحدّ المجلد `js/` مقابل `js/v2/`). تعليق الخادم: «V2 is the primary shell since
> 2026-10-23» — تاريخ تاريخي لا ينقض قلب V3 في 11-10.

**الخدمة الحية الآن:** `KarimERP-Service.exe` (PID 21528، وعملية node 25840) على
`https://127.0.0.1:5000`، مشغّلة منذ 2026-11-11 06:58 — أي أن إعادة التشغيل الأخيرة
جاءت من جلسة خارجية بعد نشر البناء، لا من هذا الجرد. `/api/health` 200،
`/app/v2.html` و`/v3/` و`/app/sw.js` 200، والروابط العميقة `/v3/accounts`
و`/v3/journal` و`/v3/pos-entry` و`/v3/settings` و`/v3/login` كلها 200، و
`/api/v3/accounting/chart` بلا رمز يعيد 401 (المسار محمّل فعلًا).

**انحراف التزام (يُسجَّل ولا يُعالَج هنا):** البناء الحي `index-xMpf1XHe` أحدث من الملتزَم
`index-vpVeFY1c` في HEAD `5974acb`، وسجل العمل يحمل 4,133 تغييرًا (منها آلاف حذوفات
موجودة في فهرس جلسة أخرى). لا يُلمس الفهرس ولا يُستعمل `git add -A`/`commit -a`.

---

## ٣. جرد الشاشات: V1 → V2 → V3

### ٣.٠ بنية V1 كما هي في الشجرة

| المكوّن | العدد | التفصيل |
|---|---:|---|
| صفحات HTML عليا | 7 | `index.html` (قوقعة V1 الكلاسيكية)، `pos.html` (الكاشير الحيّ)، `menu.html` (**ميتة**: 302 إلى `menu-board.html` بسبب CSP)، `menu-board.html`، `menu-admin.html`، `menu-totem-dashboard.html`، `v2.html` (V2 لا V1) |
| صفحات متداخلة | 1 | `cashier/index.html` — كشك PWA لكنه يستورد `js/v2/screens/login.js` و`pos-entry.js` ⇒ **من عصر V2** |
| وحدات JS أولية | 67 + 3 vendor | الجذر 19 (`app.js`, `main.js`, `pos*.js`…)، `core/` 14، `features/` 32، `ui/` 2، `vendor/` 3 |
| مفاتيح الموجّه | 46 | 44 صفحة حيّة + مفتاحان ميتان في `features/page-router.js` |
| CSS | 18 ملفًا | لوحة التصميم مستقلة (`css/design-tokens.css`) ولا تُعدَّل لمطابقة V2 |

**مقارنة حجم:** `js/v2` = 176 ملف JS و`css/v2` = 45 ملف CSS — أي أن V2 أكبر من V1
كودًا، وV3 تطبيق React مستقل بالكامل في `v3/apps/web`.

### ٣.١ مفتاح المقارنة

- **V1:** 44 مفتاحًا في `page-router.js` + `pos` خارج الموجّه (مصفوفة التكافؤ 2026-10-17).
- **V2:** 65 ملفًا في `frontend/app/js/v2/screens/` = 59 شاشة في سجل التحميل الكسول
  `MOUNTS` + 4 شاشات تُركّب مباشرة من `preview.js` بلا سجل (`dashboard` و`login`
  استيراد ساكن، `cash-register` و`cashier-sales` استيراد ديناميكي) + `compliance`
  (قسم داخل شاشة الإعدادات — قرار ADR-009) + `registry.js` نفسه (محمّل كسول لا شاشة).
  الموزِّع في `preview.js` يحمل **59 مفتاح توجيه حيًّا** (58 فرعًا حرفيًّا + `dashboard`
  الافتراضي)؛ و`briefing` والثلاثة `*-dashboard` تُركّب داخل `dashboard` حسب الدور لا
  بمسار مستقل؛ و`invoices`/`payments` مساراهما `#/procurement-invoices` و
  `#/procurement-payments` فقط (لا `#/invoices`).
  **مرادفات التنقّل** (`NAV_ALIAS`): `yara-daily-locks→daily-locks`، `pos→pos-entry`،
  `query→inventory-inquiry`، `professional→inventory-inquiry-pro`.
- **V3:** 63 مفتاحًا في `frontend/v3/screens.json`، وهي نفسها الـ63 المحقونة حيًّا في
  `<meta name="v3-screens">` (لا شاشات معطلة عبر `V3_DISABLED_SCREENS` وقت القياس).

### ٣.٢ التغطية الحرفية (فرق المفاتيح)

| الفئة | المفاتيح |
|---|---|
| V2 بلا مفتاح V3 مطابق (6) | `compliance` · `dashboard` · `invoices` · `login` · `registry` · `wh-invoices` |
| V3 بلا ملف V2 مطابق (4) | `accounts` · `journal` · `mudad` · `purchase-invoices` |
| مطابقة حرفية | 59 مفتاحًا |

**قراءة الفروق:**
- `dashboard`: استُبدل في V3 بلوحات أدوار مخصصة (`executive`, `accountant-dashboard`,
  `dept-head-dashboard`, `warehouse-dashboard`, `hr-dashboard`, `briefing`).
- `login`: V3 يملك مسار دخول خاصًّا (`/v3/login`) خارج `screens.json`.
- `invoices` و`wh-invoices` ↔ `purchase-invoices`: إعادة تسمية لا فجوة وظيفية — شاشة
  V3 واحدة تقرأ `/purchaseInvoices` و`/procurement/*` وتغطي فواتير الشراء ومدفوعاتها.
- `registry`: محمّل كسول (`loadScreen`) لا شاشة، ولا يحتاج مكافئًا في V3 (التوجيه في V3
  برمجي في `routes.tsx` مع `lazy` لكل شاشة).
- `compliance`: شاشة V2 للامتثال السعودي (GATE 03/06)، وقرار ADR-009 ينص على نقلها إلى V3
  «بعد قلب 2026-11-16» بعقد API نفسه — الحالة: **مؤجلة بقرار موثّق، وهي الفجوة الوظيفية
  الوحيدة**.
- `accounts` و`journal`: **جديدان في V3** لم يكن لهما مفتاح في V2/V1؛ يقرآن
  `chart_of_accounts` و`journal_entries`/`journal_lines` بعقد V3 النصي.
- `mudad`: جديد V3 (مدد/WPS) عبر `/api/integration/wps` (GATE 06).

### ٣.٣ جدول شاشات V2 (64 وحدة)

المصدر: `screens/registry.js` (`MOUNTS`)، و`preview.js` (التركيب والموزِّع والأعلام)،
و`core/i18n.js` (العناوين)، و`data/*-repo.js` (أبواب الخادم). «`data/`» = عدد مستودعات
البيانات التي يستوردها الملف، و«أبواب» = أول ثلاثة أبواب مميزة من عقود تلك المستودعات
(مكتوبة نسبةً إلى بادئة `/api`) بعد استثناء المشترك (`/pos/reports/sales`
و`/settings/main_settings`). الأعلام من `write-flags.js` و`preview.js:60`؛ OFF
افتراضيًّا إلا ما وُسم ON.

| # | المفتاح | دالة التركيب | المسار | العنوان | علم الكتابة | `data/` | أبواب (أمثلة) |
|---:|---|---|---|---|---|---:|---|
| 1 | `branches` | `mountBranchesScreen` | `#/branches` | الفروع | — | 1 | `/branches` · `/branches/:id` |
| 2 | `attendance` | `mountAttendanceScreen` | `#/attendance` | الحضور والانصراف | — | 3 | `/attendance/range` · `/employees` · `/hrDepartments` |
| 3 | `employees` | `mountEmployeesScreen` | `#/employees` | الموظفين | `v2bulkimport` | 5 | `/employees` · `/hrDepartments` · `/employees/:id` |
| 4 | `sessions` | `mountSessionsScreen` | `#/sessions` | الأجهزة والجلسات | — | 2 | `/auth/sessions` · `/auth/sessions/:id` · `/auth/sessions/revoke-others` |
| 5 | `briefing` | `mountBriefingScreen` | (لوحة `dashboard` الافتراضية) | موجز المدير | — | 2 | `/manager/briefing` · `/pos/orders/stats/today` |
| 6 | `executive` | `mountExecutiveScreen` | `#/executive` + لوحة المالك | موجز المدير | — | 0 | `/executive/summary` |
| 7 | `cfo` | `mountCfoScreen` | `#/cfo` | المدير المالي | — | 2 | — |
| 8 | `warehouse` | `mountWarehouseScreen` | `#/warehouse` | المخزن | — | 5 | `/warehouse/inventory/search` · `/shelves` · `/inventory` |
| 9 | `warehouse-gov` | `mountWarehouseGovScreen` | `#/warehouse-gov` | حوكمة المخزن | `v2fiscalwrite` | 2 | `/warehouse/fiscal-years` · `/warehouse/fiscal-years/:id/close` · `/warehouse/fiscal-years/:id/create-next` |
| 10 | `reports` | `mountReportsScreen` | `#/reports` | التقارير | — | 2 | `/yara-reports/departments` · `/yara-reports/cashier-items` · `/yarasoft/sections/invoice-detail` |
| 11 | `procurement` | `mountProcurementScreen` | `#/procurement` | المشتريات والموردون | — | 1 | `/procurement/summary` · `/procurement/suppliers` · `/procurement/suppliers/search` |
| 12 | `invoices` | `mountInvoicesScreen` | `#/procurement-invoices` | فواتير الموردين | `v2invoicevoid` | 3 | `/procurement/invoices/:id/pay` · `/procurement/payments` · `/purchaseInvoices` |
| 13 | `payments` | `mountPaymentsScreen` | `#/procurement-payments` | مدفوعات الموردين | — | 2 | `/procurement/payments/:id` · `/procurement/summary` · `/procurement/suppliers` |
| 14 | `wh-invoices` | `mountWhInvoicesScreen` | `#/wh-invoices` | فواتير الشراء | `v2invoicecreate` (ON) | 4 | `/purchaseInvoices` · `/procurement/summary` · `/procurement/suppliers` |
| 15 | `kitchen` | `mountKitchenScreen` | `#/kitchen` | المطبخ | — | 2 | `/kitchen/overview` · `/kitchen/production/cost-cards` · `/kitchen/stock` |
| 16 | `leaves` | `mountLeavesScreen` | `#/leaves` | طلبات الإجازات | — | 2 | `/hr/leave-workflow` · `/leaveTypes` · `/hr/leave-requests` |
| 17 | `dispatch` | `mountDispatchScreen` | `#/dispatch` | أذون الصرف | — | 3 | `/employees` · `/hrDepartments` · `/employees/:id` |
| 18 | `veg-requests` | `mountVegScreen` | `#/veg-requests` | طلب شراء خضار | — | 2 | `/veg-requests` · `/veg-requests/catalog` · `/veg-requests/:id/receive` |
| 19 | `roster` | `mountRosterScreen` | `#/roster` | دوامات قسمي | — | 2 | `/dept-roster-week` · `/hr/dept-roster-week` · `/hr/dept-roster-approval/request` |
| 20 | `employee-portal` | `mountEmployeePortalScreen` | `#/employee-portal` | بوابة الموظف | `v2portalwrite` · `v2facewrite` | 5 | `/attendance/portal/punch` · `/attendance/portal/punch/client-reject` · `/attendance/portal/face/enroll` |
| 21 | `settings` | `mountSettingsScreen` | `#/settings` | الإعدادات | — | 5 | `/yara-reports/departments` · `/yara-reports/cashier-items` · `/yarasoft/sections/invoice-detail` |
| 22 | `users` | `mountUsersScreen` | `#/users` | المستخدمين | `v2bulkimport` | 3 | `/users` · `/users/:id` · `/users/:id/employee` |
| 23 | `yarasoft` | `mountYarasoftScreen` | `#/yarasoft` | استيراد فواتير الكاشير | — | 2 | — |
| 24 | `whatsapp` | `mountWhatsappScreen` | `#/whatsapp` | محرك واتساب | — | 2 | — |
| 25 | `permissions` | `mountPermissionsScreen` | `#/permissions` | الصلاحيات | — | 2 | `/permissions/catalog` · `/permissions/users/:id` |
| 26 | `cashier-monitor` | `mountCashierMonitorScreen` | `#/cashier-monitor` | متابعة الكاشير | — | 2 | `/yara-reports/departments` · `/yara-reports/cashier-items` · `/yarasoft/sections/invoice-detail` |
| 27 | `oracle-data` | `mountOracleDataScreen` | `#/oracle-data` | بيانات Oracle | — | 2 | `/oracle-data/tables` · `/oracle-data/:table` · `/oracle-data/refresh` |
| 28 | `daily-locks` | `mountDailyLocksScreen` | `#/yara-daily-locks` | تقفيل يومي | — | 2 | `/oracle-data/tables` · `/oracle-data/:table` · `/oracle-data/refresh` |
| 29 | `menu-board` | `mountMenuBoardScreen` | `#/menu-board` | شاشات المنيو | — | 0 | (iframe) /app/menu-admin.html |
| 30 | `pos-entry` | `mountPosEntryScreen` | `#/pos` (مرادف) | الكاشير | `embeddedPos` · `salesEnabled` | 7 | `/pos/products` · `/sales/complete` · `/pos/shifts/open` |
| 31 | `departments` | `mountDepartmentsScreen` | `#/departments` | الأقسام | `v2deptwrite` · `v2deptcashier` | 10 | `/revenues` · `/departments` · `/finance/pnl` |
| 32 | `hr-departments` | `mountHrDepartmentsScreen` | `#/hr-departments` | أقسام HR | `v2hrdeptwrite` | 3 | — |
| 33 | `payroll` | `mountPayrollScreen` | `#/payroll` | الرواتب | — | 4 | `/employees` · `/hrDepartments` · `/employees/:id` |
| 34 | `wh-moves` | `mountWhMovesScreen` | `#/wh-moves` | حركات المخزون | — | 2 | `/warehouse/returns` · `/warehouse/returns/:id` |
| 35 | `wh-returns` | `mountWhReturnsScreen` | `#/wh-returns` | مرتجعات المطبخ | — | 2 | `/warehouse/returns` · `/warehouse/returns/:id` |
| 36 | `wh-prs` | `mountWhPrsScreen` | `#/wh-prs` | طلبات الشراء | — | 2 | `/warehouse/purchase-requests` · `/warehouse/purchase-requests/shortages` · `/warehouse/purchase-requests/:id/chef-approve` |
| 37 | `dept-transfers` | `mountDeptTransfersScreen` | `#/dept-transfers` | التحويلات الداخلية | — | 2 | — |
| 38 | `goods-scan` | `mountGoodsScanScreen` | `#/goods-scan` | مسح الباركود | `v2scan` (OFF) | 4 | `/warehouse/inventory/:id/receipt` · `/warehouse/inventory/search` · `/shelves` |
| 39 | `recipes` | `mountRecipesScreen` | `#/recipes` | الوصفات | `v2recipewrite` (ON) | 4 | `/pos/products/:id/ingredients` · `/recipes` · `/pos/recipes/catalog` |
| 40 | `revenues` | `mountRevenuesScreen` | `#/revenues` | الإيرادات | `v2financewrite` | 3 | `/revenues` · `/departments` · `/finance/pnl` |
| 41 | `expenses` | `mountExpensesScreen` | `#/expenses` | المصاريف | `v2financewrite` | 3 | `/expenses` · `/revenues` · `/departments` |
| 42 | `cost-analysis` | `mountCostAnalysisScreen` | `#/cost-analysis` | تحليل التكاليف | — | 2 | `/revenues` · `/departments` · `/finance/pnl` |
| 43 | `cost-center` | `mountCostCenterScreen` | `#/cost-center` | حساب القسم | — | 5 | `/revenues` · `/departments` · `/finance/pnl` |
| 44 | `pnl` | `mountPnlScreen` | `#/pnl` | الأرباح والخسائر | — | 2 | `/finance/pnl` · `/finance/pnl/print` · `/revenues` |
| 45 | `monthly-comparison` | `mountMonthlyComparisonScreen` | `#/monthly-comparison` | مقارنة الشهور | — | 2 | `/finance/monthly-comparison` · `/finance/monthly-comparison/month` · `/finance/monthly-comparison/print` |
| 46 | `hr-dashboard` | `mountHrDashboardScreen` | `#/hr-dashboard` | لوحة تحكم HR | — | 2 | `/employees` · `/hr/employees/:id/card` |
| 47 | `zkteco` | `mountZktecoScreen` | `#/zkteco` | بصمة الحضور | `v2zkwrite` (ON) | 2 | `/zkteco/status` · `/zkteco/devices` · `/zkteco/mappings` |
| 48 | `dept-employees` | `mountDeptEmployeesScreen` | `#/dept-employees` | موظفو قسمي | — | 2 | `/hr/dept-employees` · `/hr/dept-employees/:id` |
| 49 | `sales-analyzer` | `mountSalesAnalyzerScreen` | `#/sales-analyzer` | تحليل مبيعات الكاشيرية | — | 2 | `/item-sales` · `/orders` · `/received-items` |
| 50 | `sales-inquiry` | `mountSalesInquiryScreen` | `#/sales-inquiry` | استعلام المبيعات | — | 2 | `/item-sales` · `/orders` · `/received-items` |
| 51 | `received-analyzer` | `mountReceivedAnalyzerScreen` | `#/received-analyzer` | استلام المخازن | — | 2 | `/item-sales` · `/orders` · `/received-items` |
| 52 | `wh-vs-pos` | `mountWhVsPosScreen` | `#/wh-vs-pos` | مقارنة الصرف والمبيعات | — | 2 | `/item-sales` · `/orders` · `/received-items` |
| 53 | `inventory-inquiry` | `mountQueryScreen` | `#/query` (مرادف) | محرك الاستعلامات | — | 2 | `/items` · `/item/:id` · `/departments` |
| 54 | `inventory-inquiry-pro` | `mountProfessionalScreen` | `#/professional` (مرادف) | البطاقة الفاخرة | — | 2 | `/items` · `/item/:id` · `/departments` |
| 55 | `shelves` | `mountShelvesScreen` | `#/shelves` | الرفوف | `v2shelfwrite` | 2 | `/shelves` · `/inventory` · `/shelves/:id` |
| 56 | `weight` | `mountWeightScreen` | `#/weight` | الميزان | `v2weightwrite` | 2 | `/weightReadings` · `/inventory/:id` |
| 57 | `accountant-dashboard` | `mountAccountantDashboardScreen` | (لوحة `dashboard` للمحاسب) | لوحة المدير المالي | — | 1 | `/warehouse/dept-panel` |
| 58 | `warehouse-dashboard` | `mountWarehouseDashboardScreen` | (لوحة `dashboard` للمخزن) | لوحة المخزن | — | 2 | `/warehouse/dept-panel` |
| 59 | `dept-head-dashboard` | `mountDeptHeadDashboardScreen` | (لوحة `dashboard` لرئيس القسم) | لوحة رئيس القسم | — | 1 | `/warehouse/dept-panel` |
| 60 | `dashboard` | (تركيب خاص) | `#/dashboard` | لوحة التحكم | — | 1 | `/executive/summary` · `/warehouse/dept-panel` |
| 61 | `login` | (تركيب خاص) | `#/login` | تسجيل الدخول | — | 2 | `/auth/login` · `/auth/refresh` · `/permissions/me` |
| 62 | `cash-register` | (تركيب خاص) | `#/cash-register` | سجلّ الصرف | — | 1 | `/expense-register` · `/expense-register/voucher/:id` |
| 63 | `cashier-sales` | (تركيب خاص) | `#/cashier-sales` | مبيعات الكاشير | — | 1 | `/cashier-sales/summary` · `/cashier-sales/invoice/:id` · `/cashier-sales/items` |
| 64 | `compliance` | (تركيب خاص) | (قسم داخل `#/settings`) | الامتثال السعودي | — | 1 | `/integration/providers` · `/integration/wps/readiness` · `/integration/gosi/rates` |

### ٣.٤ جدول مسارات V3 (66 شاشة + الجذر)

المصدر: `v3/apps/web/src/routes/routes.tsx` (67 كتلة `createRoute`) وملفات
`*.lazy.tsx`. «البوابة» = مفتاح `ScreenGate` الذي يستمد عضويته من
`/api/permissions/me` (قوائم الدور نفسها في V2/القديم)، و«—» تعني بلا بوابة شاشة
(الجذر، `/cashier` كشك، `/integrations`، `/design` أداة داخلية). بوابة الخادم
(`jwtAuth + requireRole`) تبقى الحكم النهائي لكل نداء.

| # | المسار | المكوّن | البوابة | العنوان | أمثلة الأبواب |
|---:|---|---|---|---|---|
| 1 | `/` | `Home` | — | الجذر `/` — الصفحة الرئيسية (خارج عدّ التكافؤ). لا شاشات مفعّلة ⇒ القديم يبقى الوجهة. | `/api/executive/summary` · `/api/manager/briefing` · `/api/pos/orders/stats/today` |
| 2 | `/accounts` | `AccountsTree` | `accounts` | شجرة الحسابات — للقراءة فقط. | `/api/v3/accounting/chart` · `/api/v3/accounting` · `/api/v3/accounting/journal` |
| 3 | `/journal` | `JournalViewer` | `journal` | القيود اليومية — للقراءة فقط. | `/api/v3/accounting/journal` · `/api/v3/accounting` · `/api/v3/accounting/chart` |
| 4 | `/revenues` | `Revenues` | `revenues` | الإيرادات — للقراءة فقط. | `/api/revenues` · `/api/expenses` · `/api/departments` |
| 5 | `/expenses` | `Expenses` | `expenses` | المصروفات — للقراءة فقط. | `/api/revenues` · `/api/expenses` · `/api/departments` |
| 6 | `/cash-register` | `CashRegister` | `cash-register` | سجلّ الصرف + إذن الصرف — قراءة فقط (B4). | `/api/expense-register` · `/api/expense-register/voucher/` · `/api/expense-register/html` |
| 7 | `/daily-locks` | `DailyLocks` | `daily-locks` | التقفيل اليومي — قراءة فقط (B4). | `/api/yara-reports/daily-locks` |
| 8 | `/oracle-data` | `OracleData` | `oracle-data` | بيانات Oracle المنسوخة — عرض قرائي فقط (B4). | `/api/oracle-data/refresh` · `/api/oracle-data/tables` · `/api/oracle-data/` |
| 9 | `/procurement` | `Procurement` | `procurement` | دليل الموردين — للقراءة فقط. | `/api/procurement/suppliers` · `/api/revenues` · `/api/expenses` |
| 10 | `/payments` | `Payments` | `payments` | مدفوعات الموردين — للقراءة فقط. | `/api/procurement/payments` · `/api/revenues` · `/api/expenses` |
| 11 | `/purchase-invoices` | `PurchaseInvoices` | `purchase-invoices` | فواتير الشراء — للقراءة فقط. | `/api/purchaseInvoices` · `/api/revenues` · `/api/expenses` |
| 12 | `/departments` | `Departments` | `departments` | سجل الأقسام — للقراءة فقط. | `/api/departments` · `/api/revenues` · `/api/expenses` |
| 13 | `/wh-moves` | `InventoryMovements` | `wh-moves` | حركات المخزون — للقراءة فقط. | `/api/inventoryTx` · `/api/revenues` · `/api/expenses` |
| 14 | `/dispatch` | `Dispatches` | `dispatch` | أذون الصرف — للقراءة فقط. | `/api/dispatches` · `/api/warehouse/dispatches/` · `/api/dispatches/` |
| 15 | `/warehouse` | `Warehouse` | `warehouse` | المخزون — للقراءة فقط. | `/api/warehouse/inventory/` · `/api/warehouse/inventory` · `/api/inventory/` |
| 16 | `/warehouse-gov` | `WarehouseGov` | `warehouse-gov` | حوكمة المخزن — السنة المالية وتقارير الأرصدة والصحة. | `/api/revenues` · `/api/expenses` · `/api/departments` |
| 17 | `/goods-scan` | `GoodsScan` | `goods-scan` | مسح البضاعة — ربط باركود ووارد وأذون صرف. | `/api/inventory/` · `/api/warehouse/inventory/` · `/api/departments` |
| 18 | `/shelves` | `Shelves` | `shelves` | الرفوف — للقراءة فقط. | `/api/revenues` · `/api/expenses` · `/api/departments` |
| 19 | `/wh-returns` | `KitchenReturns` | `wh-returns` | مرتجعات المطبخ — للقراءة فقط. | `/api/kitchenReturns` · `/api/revenues` · `/api/expenses` |
| 20 | `/wh-prs` | `PurchaseRequests` | `wh-prs` | طلبات شراء النواقص — للقراءة فقط. | `/api/warehouse/purchase-requests` · `/api/revenues` · `/api/expenses` |
| 21 | `/dept-transfers` | `DeptTransfers` | `dept-transfers` | التحويلات الداخلية — للقراءة فقط. | `/api/warehouse/dept-transfers` · `/api/departments` · `/api/warehouse/dept-transfers/summary` |
| 22 | `/employees` | `Employees` | `employees` | دليل الموظفين — للقراءة فقط. | `/api/hr/attendance/report` · `/api/employees/` |
| 23 | `/hr-departments` | `HrDepartments` | `hr-departments` | أقسام الموارد البشرية — دليل وعمليات مقيّدة بعلم الكتابة. | `/api/hrDepartments/` |
| 24 | `/attendance` | `Attendance` | `attendance` | سجل الحضور والانصراف — قراءة فقط. | — |
| 25 | `/leaves` | `Leaves` | `leaves` | طلبات الإجازات وسلسلة الاعتماد — للقراءة فقط. | `/api/leaveTypes` · `/api/users` · `/api/hr/leave-requests` |
| 26 | `/payroll` | `Payroll` | `payroll` | سجل الرواتب وكشف الموظفين — قراءة فقط. | `/api/payroll_runs` |
| 27 | `/mudad` | `Mudad` | `mudad` | مدد والتأمينات وقوى — جاهزية محلية وكشف مراجعة (GATE 06، ADR-008). | `/api/integration/` · `/api/integration/wps/requirements` · `/api/integration/wps/readiness` |
| 28 | `/roster` | `Roster` | `roster` | شبكة الدوام الأسبوعية — للقراءة فقط. | `/api/hr/dept-roster-week` |
| 29 | `/users` | `Users` | `users` | دليل حسابات الدخول — للقراءة فقط. | `/api/users` · `/api/users/` |
| 30 | `/branches` | `Branches` | `branches` | فروع المنشأة — للقراءة فقط. | `/api/branches` · `/api/branches/` |
| 31 | `/permissions` | `Permissions` | `permissions` | الصلاحيات — للقراءة فقط. | `/api/permissions` · `/api/permissions/catalog` · `/api/permissions/users/` |
| 32 | `/veg-requests` | `VegRequests` | `veg-requests` | طلبات شراء الخضار — للقراءة فقط. | `/api/veg-requests` · `/api/revenues` · `/api/expenses` |
| 33 | `/weight` | `Weight` | `weight` | الميزان — للقراءة فقط. | `/api/weightReadings` · `/api/weightReadings/` |
| 34 | `/recipes` | `Recipes` | `recipes` | الوصفات — للقراءة فقط. | `/api/recipes` · `/api/revenues` · `/api/expenses` |
| 35 | `/sessions` | `Sessions` | `sessions` | الأجهزة والجلسات النشطة — قراءة وإبطال. | `/api/auth/sessions` · `/api/auth/sessions/:id` |
| 36 | `/whatsapp` | `Whatsapp` | `whatsapp` | واتساب والتنبيهات — سجل ومتابعة وقوالب. | `/api/whatsapp/status` · `/api/whatsapp/messages` · `/api/whatsapp/outbox` |
| 37 | `/briefing` | `Briefing` | `briefing` | الموجز التنفيذي — لوحة متابعة للمدير. | `/api/manager/briefing` · `/api/pos/orders/stats/today` |
| 38 | `/settings` | `Settings` | `settings` | إعدادات النظام — عامة وفواتير وطابعات. | `/api/settings/` · `/api/zatca/settings` · `/api/zatca/toggle` |
| 39 | `/executive` | `Executive` | `executive` | الموجز التنفيذي — ملخص الأداء للإدارة. | `/api/executive/summary` |
| 40 | `/hr-dashboard` | `HrDashboard` | `hr-dashboard` | لوحة الموارد البشرية — مؤشرات وإجازات بانتظار الاعتماد. | `/api/attendance/range` · `/api/hr/leave-workflow` |
| 41 | `/dept-employees` | `DeptEmployees` | `dept-employees` | موظفو القسم — سجل القائد (قراءة فقط). | `/api/hr/dept-employees` |
| 42 | `/employee-portal` | `EmployeePortal` | `employee-portal` | بوابة الموظف — حالة الحضور والبصمات (قراءة فقط). | `/api/attendance/portal/status` · `/api/zkteco/my-punches` |
| 43 | `/zkteco` | `Zkteco` | `zkteco` | أجهزة البصمة — حالة الأجهزة والربط والسجل. | `/api/zkteco/status` |
| 44 | `/kitchen` | `Kitchen` | `kitchen` | المطبخ — نظرة عامة على الإنتاج والمخزون. | `/api/kitchen/overview` · `/api/kitchen` |
| 45 | `/menu-board` | `MenuBoard` | `menu-board` | شاشة القائمة — أصناف نقاط البيع المعروضة. | — |
| 46 | `/warehouse-dashboard` | `WarehouseDashboard` | `warehouse-dashboard` | لوحة المخزن — مؤشرات المخزون والتدفق. | `/api/dispatches` · `/api/warehouse/purchase-requests` · `/api/warehouse/dept-panel` |
| 47 | `/accountant-dashboard` | `AccountantDashboard` | `accountant-dashboard` | لوحة المحاسب — مؤشرات مالية وتشغيلية. | `/api/dispatches` · `/api/warehouse/purchase-requests` · `/api/warehouse/dept-panel` |
| 48 | `/dept-head-dashboard` | `DeptHeadDashboard` | `dept-head-dashboard` | لوحة رئيس القسم — أداء القسم. | `/api/dispatches` · `/api/warehouse/purchase-requests` · `/api/warehouse/dept-panel` |
| 49 | `/cost-analysis` | `CostAnalysis` | `cost-analysis` | تحليل التكلفة — تكلفة الأصناف والأقسام. | `/api/finance/cost-analysis` · `/api/finance/cost-analysis/dept` |
| 50 | `/cost-center` | `CostCenter` | `cost-center` | مركز التكلفة — مصروفات الأقسام ومقابلتها. | `/api/finance/cost-analysis` · `/api/finance/cost-analysis/dept` |
| 51 | `/inventory-inquiry` | `InventoryInquiry` | `inventory-inquiry` | محرك استعلامات المخزون — قراءة فقط. | `/api/inventory-inquiry` · `/api/inventory-inquiry/items` · `/api/inventory-inquiry/item/` |
| 52 | `/inventory-inquiry-pro` | `inventoryInquiryProRoute` | — | البطاقة الفاخرة للصنف — قراءة فقط. | — |
| 53 | `/pnl` | `Pnl` | `pnl` | الأرباح والخسائر — قائمة الدخل. | `/api/finance/pnl` |
| 54 | `/cfo` | `Cfo` | `cfo` | المدير المالي — ملخص وميزان وقيود وفترات (قراءة فقط). | `/api/accounting/cfo-summary` · `/api/accounting/trial-balance` · `/api/accounting/journal` |
| 55 | `/monthly-comparison` | `MonthlyComparison` | `monthly-comparison` | المقارنة الشهرية — إيراد ومصروف شهرٍ مقابل آخر. | `/api/finance/monthly-comparison` |
| 56 | `/reports` | `Reports` | `reports` | التقارير — تقرير مبيعات نقطة البيع. | `/api/pos/reports/sales` |
| 57 | `/cashier-sales` | `CashierSales` | `cashier-sales` | مبيعات الكاشير — فواتير وأصناف (مرآة YaraSoft). | `/api/cashier-sales/summary` |
| 58 | `/cashier-monitor` | `CashierMonitor` | `cashier-monitor` | متابعة الكاشير — أوردرات حيّة (مرآة YaraSoft). | `/api/cashier-monitor/summary` · `/api/cashier-monitor/orders` · `/api/cashier-sales/invoice/` |
| 59 | `/pos-entry` | `PosEntry` | `pos-entry` | نقطة البيع — الكاشير الحيّ: أصناف وسلة ودفع ووردية وإيصال. | `/api/pos/` · `/api/sales/complete` · `/api/pos/departments` |
| 60 | `/cashier` | `CashierKiosk` | `pos-entry` | كشك الكاشير — نفس نقطة البيع بلا قائمة إدارة أو بيانات خارج الوردية. | `/api/pos/products` · `/sales/complete` · `/pos/shifts/open` |
| 61 | `/integrations` | `LegacySource` | — | مصدر البيانات — فصل Yarasoft/Oracle والاعتماد على PostgreSQL وحده. | `/api/integrations/legacy` |
| 62 | `/sales-analyzer` | `SalesAnalyzer` | `sales-analyzer` | تحليل مبيعات الأصناف (مرآة YaraSoft). | `/api/yara-reports/item-sales` · `/api/yara-reports/orders` · `/api/yara-reports/received-items` |
| 63 | `/sales-inquiry` | `SalesInquiry` | `sales-inquiry` | استعلام المبيعات (مرآة YaraSoft). | `/api/yara-reports/item-sales` · `/api/yara-reports/orders` · `/api/yara-reports/received-items` |
| 64 | `/received-analyzer` | `ReceivedAnalyzer` | `received-analyzer` | تحليل المستلَم (مرآة YaraSoft). | `/api/yara-reports/item-sales` · `/api/yara-reports/orders` · `/api/yara-reports/received-items` |
| 65 | `/wh-vs-pos` | `WhVsPos` | `wh-vs-pos` | مقارنة المخزن بنقطة البيع (مرآة YaraSoft). | `/api/yara-reports/item-sales` · `/api/yara-reports/orders` · `/api/yara-reports/received-items` |
| 66 | `/yarasoft` | `Yarasoft` | `yarasoft` | إيرادات الكاشير — مرآة YaraSoft (قراءة فقط). | `/api/cashier-revenues` |
| 67 | `/design` | `DesignGallery` | — | معرض نظام التصميم — مسار أداة داخلي كسول، خارج عدّ التكافؤ (ADR-002). | — |

---

## ٤. جرد الواجهات (API)

### ٤.١ الأرقام

| المقياس | القيمة |
|---|---:|
| قواعد `/api` صريحة في `server.js` | 52 |
| كيانات CRUD العامة `/api/:entity` | 25 (منها `users` محسوب في الصريحة) |
| **إجمالي القواعد المتميزة** | **77** |
| مسارات `/api/v3/*` | **3 فقط** — كلها GET تحت `/api/v3/accounting` |
| راوترات يتيمة (ملف موجود وغير مركّب) | **صفر** — 49 ملف `express.Router()` كلها قابلة للوصول |
| مسارات تستهلكها شاشات V2 (مقيسة اليوم من عقود `data/*-repo.js`) | **331 مسارًا متميزًا** (مقابل 240 في مسح 2026-10-17) |

### ٤.٢ عقد V3 الخلفي

| # | الطريقة | المسار | الحماية | الملف |
|---:|---|---|---|---|
| 1 | GET | `/api/v3/accounting/chart` | مفتاح التطبيق + `jwtAuth` + `requireRole(admin,accountant,manager,auditor)` | `backend/v3-accounting-read.js:84` |
| 2 | GET | `/api/v3/accounting/journal?limit=N` (1..200، افتراضي 50) | نفسها | `backend/v3-accounting-read.js:94` |
| 3 | GET | `/api/v3/accounting/journal/:id` (معرّف رقمي وإلا 422) | نفسها | `backend/v3-accounting-read.js:106` |

**التركيب:** `app.use('/api/v3/accounting', createV3AccountingReadRouter())` —
`backend/server.js:693`. قراءة فقط، لا POST/PUT/DELETE في الملف.

**الاستنتاج الجوهري:** V3 ليس له خادم مستقل؛ **الشاشات غير المحاسبية في V3 تستهلك
الواجهات القديمة نفسها** (`v3/apps/web/src/lib/finance.ts` → `/api/departments`،
`/api/settings/main_settings`)، وثلاثة مسارات V3 الجديدة تخدم شاشتي `accounts` و`journal`
بعقد نصّي معلن (`v3-read.ts`). أي استدعاء `/api/v3/*` آخر غير موجود ⇒ 404 من
`notFoundHandler`، ولم يُعثر على استدعاء كهذا في مصدر V3.

### ٤.٣ سلسلة الحماية العامة

مفتاح `x-api-key` (timing-safe، معطل إن لم يُضبط `API_KEY`) ← `jwtAuth` ← `requireRole`
أو `requireRoleOrPerm`. ركّزت أولًا: `correlationMiddleware`، `securityHeaders`
(HSTS/CSP/XFO/COOP/CORP)، `hppGuard`، CORS بقائمة أصول، ضغط، حدود جسم،
`autoDbValidation`، `idempotency` للكتابات، ثم `notFoundHandler`/`globalErrorHandler`.

**مسارات عامة مقصودة (بلا JWT):** الدخول/التجديد/استعادة كلمة المرور، تحقق بطاقة
الموظف (HMAC)، شاشات المنيو العامة، i18n، سياسة مسار POS، `rt/version`، `server/info`،
`health`. وكلها إما محدودة السرعة أو بيانات عرض غير حساسة.

### ٤.٤ ملاحظات تدقيق (مسجَّلة لا مُصلَحة)

- `GET /api/accounting/balance-sheet` معرّف مرتين: الأول في `accounting-routes.js:789`
  يحجب الثاني في `accounting-periods.js:212` (الميت فعليًّا للـGET).
- `GET /api/yarasoft/oracle/catch-up/status` مسجَّل مرتين في نفس الراوتر
  (`yarasoft/routes.js:885` و`:892`) — الأول يفوز.
- `jwtAuth` مكرر بلا ضرر على `/api/notifications` و`/api/finance` (ليس تجاوزًا).
- 25 كيان CRUD عام يغطي جداول حساسة (رواتب، عقود، تقييمات) ببوابات أدوار قراءة/كتابة
  منفصلة في `server.js:1422-1437`.

---

## ٥. جرد البيانات (قاعدة الإنتاج)

**لقطة 2026-11-11 07:32 (+03) — `current_database()` = `karim_erp` (استعلام قراءة فقط):**

| المقياس | القيمة |
|---|---:|
| جداول `public` | 237 |
| هجرات مسجّلة في `schema_migrations` | 147 |
| القيود `journal_entries` | 41,774 |
| سطور القيود `journal_lines` | 83,785 |
| شجرة الحسابات `chart_of_accounts` | 124 |
| موظفون نشطون (`employees.status='active'`) | 137 |
| مستخدمون نشطون / الإجمالي (`users.active`) | 147 / 175 |
| أصناف POS | 398 |

**تغطية القراءة (جرد البيانات 03:33Z):** 165 جدولًا فيها بيانات بمجموع 1,803,421 صفًّا؛
**61 جدولًا بلا أي قارئ** في الخادم أو الشاشات (أكبرها جداول Oracle المستوردة
`ora_cc_bill_enter3` 443,600 صف و`ora_e_invline` 441,625 صفًا)، إضافة إلى جداول نسخ
احتياطي مؤقتة (`employees_backup_*`). تبقى هذه فجوة بيانات لا فجوة واجهة — التفصيل في
`docs/v1-v2-v3-inventory.md`.

**تحديث هذا الجرد:** `chart_of_accounts` كان مصنَّفًا «بلا قارئ V3» في لقطة 03:33Z؛
منذ 07:15Z صار له قارئ V3 عبر `/api/v3/accounting/chart` (مع `journal_entries` و
`journal_lines` عبر `/journal` و`/journal/:id`) — إضافة قراءة فقط بنفس سلسلة
`jwtAuth + requireRole`.

---

## ٦. الهجرات وقاعدة البيانات

- **الملفات:** 134→145 و147 موجودة، و**146 غائبة تمامًا** (قرار سلسلة ZATCA لم يُحسم — لا
  ملف ولا سجل تطبيق). تحقّق مباشر: عمود `schema_migrations.version` يحمل اسم الملف لا رقمًا
  مجرّدًا؛ `version like '146%'` يعيد صفر صفوف، و`version like '147%'` يعيد صفًا واحدًا
  (`147_employee_wps_bank.sql`، مُطبَّق `2026-11-10T21:06:47Z` = 00:06:47 +03)، والعدد
  الكلي 147 سجلًا بمدى `001_schema.sql` → `147_employee_wps_bank.sql`.
- **المطبَّق اليوم:** 127، 137، 138، 144، 145، 147 في 00:06:45–47 (+03) — أي أن
  أعمدة `voided_at/voided_by/voided_by_name/void_reason` صارت موجودة في الإنتاج
  (16 عمودًا في `journal_entries` بدل 12). عقد V3 يتحمل الحالتين عبر
  `to_jsonb(e) ->> 'voided_at'` فلا يتوقف على الهجرة.
- 134–143 مطبقة 2026-11-07؛ 147 هو أحدث سجل.
- **قيود سلامة القيود الفعّالة:** 095 (توازن القيد المنشور عند COMMIT + حصانة هوية القيد
  المنشور)، 136 (منع الحذف الصلب لقيد منشور إلا براية صريحة)، 137/138 (تدقيق append-only).

---

## ٧. الأدوار والأمان

- **11 دورًا:** admin, manager, warehouse, kitchen, sous_chef, dept_head, hr, accountant,
  employee, owner, cashier — نفسها في القديم وV2 (مصفوفة التكافؤ §٥)، وV3 يقرأ منها
  مفاتيح أدواره (`v3` role key) ولا يعيد تعريف الأدوار.
- **سلسلة الحماية:** بوابة `x-api-key` لكل `/api/*` ← `jwtAuth` (HS256، رفض تذاكر MFA،
  رفض `must_change_password`، فحص نشاط الحساب في الإنتاج fail-closed) ← `requireRole`.
- **V3 قراءة المحاسبة:** `admin/accountant/manager/auditor` فقط، وقواعد V3 للمصادقة
  معرّفة في `frontend/app`/`v3` بمفاتيح أدوار مستقلة لا تغيّر أدوار الخادم.
- **بوابات جودة الأمان:** `security-gate` فحص 590 ملفًا — **3 إصابات حمراء** كلها في ملفات
  GATE 03/06 غير الملتزَم بها (`backend/integration/routes.js:395`،
  `backend/integration/wps-routes.js:95`، `frontend/app/js/v2/screens/compliance.js:187`)،
  واستثناء موثّق `SEC-ZKTECO-531` ساري حتى 2026-12-06. لا إصابات في ملفات هذا الجرد.

---

## ٨. الاختبارات والبوابات

| المجموعة | العدد | أمثلة |
|---|---:|---|
| مجموعات Jest في `tests/` | 335 | `v2-*` 115، `pos-*` 11، `punch-*` 10، `menu-*` 8، `coa-*` 8، `security-*` 5 |
| اختبارات V3 وحدوية | 160 ملفًا | `v3/apps/web/src` + `v3/packages` |
| E2E لـV3 | 4 ملفات | `v3/apps/web/e2e` |
| اختبار عقد القراءة V3 (هذا الجرد) | 12/12 ناجح | `tests/v3-accounting-read.test.js` |
| فحص حي للإنتاج | 124 حسابًا + 200 قيد + 400 سطر — صفر مخالفة | فحص GET فقط برمز قصير العمر |

**بوابات ثابتة:** `scripts/security-gate.js` (أعلاه)، حارس حذف القيود
`tests/journal-void-only-policy.test.js`، بوابة نسخة الواجهة `frontend:version:bump`،
وميزانية حزمة V3 (`bundle budget`). الاختبارات ليست قبولًا ميدانيًا بحد ذاتها — وهذا
مصرَّح به في `V2-PARITY-MATRIX.md §٧`.

---

## ٩. النشر والتشغيل

- **V3:** SPA مبنية مسبقًا في `frontend/v3` (index + assets)، يحقن الخادم
  `<meta name="v3-screens">` و`<meta name="v3-primary">` ويرصد تغيّر mtime — **نشر
  الواجهة لا يحتاج إعادة تشغيل**. البناء الحي: `index-xMpf1XHe.js` (659,690 بايت) +
  `index-XRIFH15q.css` (195,761 بايت)، `asset-version` = 4.9.311.
- **الأصول:** 2,797 ملفًا (72MB) مقابل **145 ملفًا فقط** في بناء المصدر النظيف
  `v3/apps/web/dist` ⇒ تراكم ~19 جيلًا بناء. HEAD يحمل `index-vpVeFY1c.js`.
  `/v3/*` غير المعطَّل يُخدم بـSPA fallback، والشاشات المعطلة عبر
  `V3_DISABLED_SCREENS` تُحوَّل 302 إلى `/app/v2.html?live=1`.
- **V2:** `/app/v2.html?live=1` من `frontend/app` — يتطلب الخادم فقط.
- **الخادم:** تغيير `backend/*` يستلزم إعادة تشغيل الخدمة. الخدمة الحالية
  `KarimERP-Service.exe` PID 21528 (node 25840) منذ 2026-11-11 06:58، ومسارات
  `/api/v3/accounting` محمّلة فيها (401 بلا رمز، وبيانات حقيقية برمز قراءة).
- **آلية القلبة والرجوع:** `frontend/v3/rollout.json` + `backend/rollout.js`
  (`V3_PRIMARY=0` أو `switchAt` مستقبلي = رجوع فوري إلى V2).

---

## ١٠. الفجوات والمخاطر

| # | الفجوة | الأثر | الأولوية |
|---|---|---|---|
| G1 | 61 جدولًا فيها بيانات بلا قارئ (منها Oracle المستورد) | بيانات محتجزة لا تُستثمر؛ خطر قرار خاطئ | P1 |
| G2 | قسم الامتثال السعودي (`compliance`) غير منقول إلى V3 | تغطية V2→V3 ناقصة بوعي حتى قرار النقل | P2 |
| G3 | بناء V3 الحي (`index-tee0AkRT.js`، 2026-11-11) غير ملتزَم؛ HEAD على بناء أقدم | استرجاع/تدقيق أصعب؛ خطر انحراف | P1 |
| G4 | 3 إصابات بوابة أمان في ملفات GATE 03/06 غير الملتزَم بها | بوابة حمراء تمنع اعتماد نظيف | P1 |
| G5 | 146 (سلسلة ZATCA) غائبة | قرار معلّق لا خطأ تنفيذ | P2 |
| G6 | 2,901 ملف أصول (75MB) مقابل 145 في البناء النظيف | هدر مساحة وفوضى نشر | P2 |
| G7 | طباعة/عامل الطباعة الحرارية غير مشغّل منذ 2026-10-07 | قائمة الطباعة الحرارية لا تنفذ | P2 |
| G8 | لا وثيقة تقاعد رسمية لـV1، وADR-009 ما زال يذكر قلبًا «11-16» بعد تنفيذه فعليًّا 11-10 | مرجعان متعارضان للتاريخ | P3 |
| G9 | خمس شاشات V3 للقراءة فقط بينما V2 يكتب فيها: بوابة الموظف، الحضور، مركز التكلفة، واتساب، يارسوفت | سيناريوهات يومية تُجبر المستخدم على V2 | P1 |
| G10 | أفعال جزئية ناقصة في شاشات مكتملة (ZKTeco مسح/استيراد/ربط/سجل/إعادة بناء، الموظفون QR/بطاقة/استيراد، المستخدمون جماعي/تصفير، الجلسات passkeys، الموجز، التقارير، الإعدادات/server-control، الخضار، كشف حساب المورد) | عمل إداري متقطع يتطلب V2 | P2 |
| G11 | قياس التكافؤ: 252 نداء كتابة في V1/V2 مقابل 164 في V3 (128 مطابق، 124 غير مطابق) | مرجع قياس دقيق للفجوات المتبقية | P2 |

---

## ١١. التقييم المرجّح

| المحور | الوزن | الدرجة | المبرر |
|---|---:|---:|---|
| تغطية الشاشات V2→V3 | 25% | 8.0 | 59/64 مطابقة حرفية + بدائل مبررة لأربعة؛ الفجوة الوظيفية: الامتثال كاملًا، وخمس شاشات قراءة فقط تقابل كتابة V2 (§١٠ G9)، وأفعال جزئية (G10) |
| واجهات API وعقود V3 | 20% | 9.0 | عقد Zod صارم + 0 مخالفة على 200 قيد حقيقي؛ أعداد المسارات في §٤ |
| البيانات وتغطية القراءة | 15% | 6.5 | 61/165 جدولًا بلا قارئ — أكبر ثقب |
| الهجرات وسلامة القيود | 10% | 9.0 | 147 مسجّلة، قيود توازن/تدقيق فعّالة؛ 146 غائبة بقرار |
| الأمان والصلاحيات | 10% | 8.0 | سلسلة صلبة؛ بوابة حمراء في ملفات خارج الجرد |
| الاختبارات والبوابات | 10% | 8.5 | 335 مجموعة Jest + 160 V3 + فحص حي؛ الاختبارات ليست قبولًا ميدانيًا |
| النشر والالتزام | 10% | 7.0 | تشغيل سليم؛ انحراف بناء حي عن HEAD |
| **الإجمالي** | 100% | **8.0** | |

---

## ١٢. التوصيات (كلها تتطلب موافقة قبل التنفيذ)

1. **قرار بشأن 61 جدولًا بلا قارئ:** تصنيفها (أرشيف/مصدر نقل/مهمل) قبل أي حذف — لا حذف بلا قرار مكتوب.
2. **سَدّ G2:** تنفيذ نقل قسم الامتثال إلى V3 بعقد API نفسه، أو تسجيل قرار إبقائه في V2 بعد التقاعد.
3. **تثبيت الالتزام:** commit محدود بالمسارات لبناء V3 الحي وملفات هذا الجرد، بأدوات
   pathspec/temp-index فقط (فهرس الجلسة الشقيقة يحمل 4,133 تغييرًا).
4. **إغلاق بوابة الأمان:** معالجة الإصابات الثلاث في نطاق GATE 03/06 والتزامها.
5. **حسم 146:** قرار سلسلة ZATCA (تنفيذ أو إسقاط موثّق).
6. **تنظيف أصول V3 القديمة** بعد قائمة مسارات وأحجام مقيسة وموافقة.
7. **قبول ميداني:** تشغيل سيناريو مستخدم حقيقي على `/v3/` (POS + محاسبة) قبل إعلان تكافؤ نهائي.

---

## ملحق أ — أوامر إعادة إنتاج القياسات

```bash
# شاشات V3 المنشورة وما يعطّله الخادم
node -e "console.log(require('./frontend/v3/screens.json'))"
curl -sk https://127.0.0.1:5000/v3/ | grep -o 'name="v3-screens"'

# شاشات V2
ls frontend/app/js/v2/screens/*.js | wc -l

# الاختبارات
ls tests/*.test.js | wc -l
find v3/apps/web/src v3/packages -name '*.test.*' | wc -l

# حالة الهجرات (قراءة فقط)
node -e "process.env.DB_NAME='karim_erp';const p=require('./backend/shared-pool').pool;p.query('SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5').then(r=>{console.log(r.rows);return p.end()})"

# تأكيد غياب 146 وحضور 147 (العمود يحمل اسم الملف)
node -e "process.env.DB_NAME='karim_erp';const p=require('./backend/shared-pool').pool;p.query(\"SELECT version, applied_at FROM schema_migrations WHERE version LIKE '146%' OR version LIKE '147%' ORDER BY version\").then(r=>{console.log(r.rows);return p.end()})"

# لقطة أعداد §٥
node -e "process.env.DB_NAME='karim_erp';const p=require('./backend/shared-pool').pool;p.query(\"SELECT to_char(now() at time zone 'Asia/Riyadh','YYYY-MM-DD HH24:MI:SS') ts,(SELECT count(*) FROM information_schema.tables WHERE table_schema='public') tables,(SELECT count(*) FROM schema_migrations) migrations,(SELECT count(*) FROM journal_entries) je,(SELECT count(*) FROM journal_lines) jl,(SELECT count(*) FROM chart_of_accounts) coa,(SELECT count(*) FROM pos_products) pos\").then(r=>{console.log(r.rows[0]);return p.end()})"

# بوابة الأمان
node scripts/security-gate.js
```

**ملاحظة منهجية:** أرقام «نداءات الشبكة» في §٠ لـV1 مأخوذة من المسح الآلي بتاريخ
2026-10-17 (`V2-PARITY-MATRIX.md §١`) ولم تُعَد اليوم؛ أما V2 فقد أُعيد قياس مساراته
اليوم من عقود `data/*-repo.js` (**331** مسارًا في §٤.١). أرقام الشاشات والاختبارات
والهجرات والبيانات والخدمة كلها مقيسة اليوم (البيانات 2026-11-11 07:32 +03). ما لم
يُقَس: سلوك المتصفح الحيّ لكل شاشة (يتطلب جلسة حقيقية)، وجلسات WhatsApp/Oracle الحية
(غير متصلة).
