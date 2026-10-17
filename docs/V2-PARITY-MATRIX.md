# مصفوفة التكافؤ V2 ↔ الواجهة القديمة

**التاريخ:** 2026‑10‑17 · **الفرع:** `refactor/esm-migration`
**المصدر:** جرد آلي من شجرة المستودع (لا من الماستر برومبت ولا من `MIGRATION.md`)،
مع تصنيف يدوي لكل فجوة. البند المرجعي: قرار المالك 2026‑10‑17 في
`docs/V2-COMPLETION-CONTRACT.md`.

---

## ١. المنهج والحدود

**ما جُرِد:**

| السطح | العدد | كيف |
|---|---|---|
| تسجيلات مسارات الخادم | **483** في 52 ملفًا (GET 232 · POST 194 · PUT 25 · PATCH 2 · DELETE 30) | `router/app.<verb>('<path>'` |
| نداءات V2 إلى الشبكة | **303** نداءً · **240** مسارًا مختلفًا | `apiFetch(` داخل `js/v2` |
| نداءات الواجهة القديمة | **349** نداءً · **266** مسارًا مختلفًا | `apiFetch/fetch(` داخل `js` عدا `v2` |
| صفحات القديم | **44** مفتاحًا في `page-router.js:28-123` | `case '<key>'` |
| شاشات V2 | **53** ملفًا في `js/v2/screens` | ومنها شاشات أدوار ودخول ليست صفحات قديمة |

**حدّ الآلية — يُقرأ قبل الأرقام:** الجرد النصّي **يُخطئ في الاتجاهين**:
`apiFetch(q)` بمتغير لا يُلتقط أصلًا، والقالب المتداخل `` `${qs({...})}` `` يُقطع
عند علامة داخلية فيظهر المسار ناقصًا. لذلك أرقام «93 مسارًا في القديم بلا V2»
الخام **ليست فجوات**؛ صُنِّفت يدويًّا في §٤، وأكثرها إما:
(أ) باب مكافئ مختلف (`/finance/pnl` يُستدعى بقالب متداخل)،
(ب) `fetch` خام في V2 (`menu-board/public` في `board/boot.js:19`،
`auth/refresh` في `session.js:123`)،
(ج) باب يستخدمه POS المستقل وحده (`/api/pos/*`).

**الرموز:**

| الرمز | المعنى |
|---|---|
| ✅ | تكافؤ وظيفي: نفس الشاشة/الوظيفة ونفس الأبواب أو أبواب مكافئة مثبتة |
| ◐ | الشاشة موجودة وبها فجوة وظيفية محددة مذكورة في العمود الأخير |
| ⬜ | غائبة عن V2 |
| 🔗 | إحالة مقصودة إلى صفحة قائمة (لا إعادة بناء) |
| ❌ | مفتاح ميت في القديم نفسه — لا يُبنى |

---

## ٢. مصفوفة الصفحات (47 مفتاحًا: 44 صفحة في الموجّه + `pos` خارج `page-router` + مفتاحان ميتان)

مفاتيح V2 وأرقام التركيب من `js/v2/preview.js` (الكتلة `2115-2357`).

| مفتاح القديم | حالة V2 | الدليل / الفجوة |
|---|---|---|
| `dashboard` | ✅ | `screens/dashboard.js` + لوحات الأدوار (`role-dashboard.js`) + لجنة `briefing` داخلية (`preview.js:2357`). لا صفحة `briefing` مستقلة في القديم. |
| `revenues` | ✅ | `screens/revenues.js` · `data/finance-repo.js` |
| `expenses` | ✅ | `screens/expenses.js` · نفس الـrepo |
| `cost-analysis` | ✅ | `screens/cost-analysis.js` |
| `pnl` | ✅ | `screens/pnl.js` · `/finance/pnl` (`finance-repo.js:77`) |
| `cfo` | ✅ | `screens/cfo.js` + `data/cfo-repo.js` — **31/31** بابًا مطابقًا لـ`features/cfo.js` (قيود، ميزان، موازنة، أصول، فترات، إغلاق يوم/وردية…) |
| `departments` | ◐ | CRUD + تفكيك + تفاصيل داخلية ✅ (`screens/departments.js:29`) — **ناقص**: لوحة الكاشيرية الحية (`features/departments.js:162` على `/yara-reports/cashiers-live` و`cashiers-today`) وبطاقة ترحيل المطبخ (`:45`) → #31 |
| `departmentDetail` | ✅ | لم تُبنَ صفحة مستقلة؛ التفاصيل داخل شاشة الأقسام بنفس الحقول (`screens/departments.js:231-282`). المفتاح القديم يبقى عنوانًا فقط. |
| `warehouse` | ◐ | سجل المخزون + وارد/استيراد يدوي + حذف (`screens/warehouse.js`)، واستيراد Excel جزئي (شبكة يدوية بدل ملف `.xlsx`) — **ناقص**: الرصيد الافتتاحي السريع ووضع «الصافي بعد المنصرف» (`features/warehouse.js:1785-1805`، الباب `/warehouse/issued-totals`) → #31 |
| `wh-invoices` | ✅ | `screens/wh-invoices.js` + `data/purchase-invoices-repo.js` (قراءة) + `purchase-invoices-write-repo.js` (كتابة خلف علم): إنشاء/تعديل في نفس الصفحة خلف `v2invoicecreate`، وتسديد كامل؛ الإلغاء والحذف الجماعي في شاشة ٠٦ خلف `v2invoicevoid` |
| `wh-moves` | ✅ | `screens/wh-moves.js` |
| `wh-returns` | ✅ | `screens/wh-returns.js` + `warehouse-repo.js:244-249` |
| `wh-prs` | ✅ | `screens/wh-prs.js` + `data/pr-repo.js` (11 بابًا: إنشاء/إلغاء/اعتماد شيف/مدير) |
| `procurement` | ✅ | `screens/procurement.js` — الموردون (قائمة/إضافة/تعديل/تعطيل/حذف/كشف حساب بفاتورة)، المدفوعات وحذفها؛ `procurement/invoices` و`procurement/payments` مفاتيح V2 إضافية (`preview.js:2160/2165`). |
| `roster` | ✅ | `screens/roster.js` + `data/roster-repo.js` (أسبوع القسم + طلب/اعتماد) |
| `dept-employees` | ✅ | `screens/dept-employees.js` |
| `shelves` | ✅ | `screens/shelves.js` |
| `weight` | ✅ | `screens/weight.js` |
| `dispatch` | ✅ | `screens/dispatch.js` + `data/dispatch-repo.js` (12 بابًا: اعتماد مخزن/شيف/رفض/استلام/تعديل) + طباعة إذن |
| `kitchen` | ◐ | `screens/kitchen.js` + `data/kitchen-repo.js` (اطّلاع، إنتاج، مستندات، جرد، تحويلات) — **ناقص**: بطاقات التكلفة (الصرف الفعلي مقابل الإيراد + طباعة) `features/kitchen.js:1495` → #31 |
| `recipes` | ✅ | `screens/recipes.js` — BOM، مكوّنات المنتج، الوحدات، مزامنة الكاشير، تكلفة السطر (`data/recipes-repo.js` + `recipes-edit-repo.js`) |
| `reports` | ◐ | `screens/reports.js` — تقارير المبيعات/الأقسام/الكاشير/المطبخ/المرتجعات/المخزن/HR + Yara departments/cashier-items + طباعة الصفحة الحالية. **ناقص**: عارض التقرير داخل التطبيق (WebView) + تصدير Excel في بعض الشاشات → #26 |
| `settings` | ✅ | `screens/settings.js` — يغطي أبواب `settings-users.js` (23) عبر `settings-repo.js` و`users-repo.js`: ZATCA (طابور/retry/CSR/تفعيل)، KOT، البوابة (أجهزة/محاولات/وجوه)، نسخ واستعادة، reset-all. |
| `users` | ✅ | CRUD + كلمة مرور + ربط موظف + صلاحيات + معالج الاستيراد الجماعي خلف `v2bulkimport` (`c3556d9`) |
| `permissions` | ✅ | `screens/permissions.js` + `data/permissions-repo.js` (كتالوج + حفظ مستخدم) |
| `hr-dashboard` | ✅ | `screens/hr-dashboard.js` |
| `employees` | ✅ | CRUD + بطاقة الموظف الكاملة + معالج الاستيراد الجماعي خلف `v2bulkimport` (`c3556d9`) |
| `leaves` | ✅ | `screens/leaves.js` |
| `attendance` | ✅ | `screens/attendance.js` + `data/attendance-repo.js` (فترة/مسح/تجاوزات/تحليلات شيفتات) |
| `zkteco` | ✅ | `screens/zkteco.js` + `data/zkteco-repo.js` (16 نداءً — تغطية P2‑2) |
| `yarasoft` | ◐ | `screens/yarasoft.js` **قراءة فقط**: الحالة + سجل الاستيراد (`portal-repo.js`). القديم يستدعي **32 بابًا** (مزامنة Oracle، مرايا، أقسام، quarantines، reprocess) → #28 |
| `cashier-monitor` | ✅ | `screens/cashier-monitor.js` — مرآة كاملة لـ`features/cashier-monitor.js` (ملخص/أوردرات/تفاصيل/تصدير) |
| `sales-analyzer` | ◐ | `screens/sales-analyzer.js` — جدول + طباعة + تصدير Excel للتبويب النشط بأعمدة القديم (`9438a9b`). **ناقص**: بحث عربي متسامح، تفاصيل/طباعة أوردر (`/yara-reports/order-detail/:docNo`) → #27 |
| `received-analyzer` | ◐ | `screens/received-analyzer.js` — جدولان + طباعة + مصنف Excel بثلاث أوراق بأعمدة القديم (`9438a9b`). **ناقص**: جدول صفوف الاستهلاك (الخادم يعيدها وV2 يعرض ملخصًا فقط)، تفاصيل/طباعة إذن صرف (`/yara-reports/received-dispatch-detail/:id`) → #27 |
| `wh-vs-pos` | ◐ | `screens/wh-vs-pos.js` — جدول + طباعة + Excel بأعمدة القديم (`9438a9b`). **ناقص**: فترات جاهزة، بحث صنف باقتراحات + «المختلفة فقط»، تحديث تلقائي 60 ثانية، ملخص/تنبيهات/رسم القديم → #27 |
| `yara-daily-locks` | ✅ | `screens/daily-locks.js` + `data/oracle-repo.js:48` |
| `oracle-data` | ✅ | `screens/oracle-data.js` + `data/oracle-repo.js` |
| `whatsapp` | ◐ | `screens/whatsapp.js` — الحالة + الرسائل فقط. القديم يستدعي **19 بابًا** (QR/إقران/قواعد/حملات/outbox/قوالب/query…) → #29 |
| `employee-portal` | ✅ | `screens/employee-portal.js` — البصمة الذاتية وGPS والوجه وشريط الجوال السفلي المتجاوب |
| `veg-requests` | ✅ | `screens/veg-requests.js` + `data/veg-repo.js` (طلب/تسعير/طباعة/استلام/إلغاء/كتالوج) |
| `branches` | ✅ | `screens/branches.js` + `data/branches-repo.js` |
| `hr-departments` | ✅ | `screens/hr-departments.js` |
| `payroll` | ✅ | `screens/payroll.js` + `data/payroll-suite.js` |
| `menu-board` | ✅ | `screens/menu-board.js` — تضمين `/app/menu-admin.html` حرفيًّا كالقديم (`page-router.js:123-130`) + لوحة V2 خلف `?v2board` |
| `pos` | 🔗 | مدخل V2 (`screens/pos-entry.js`) يفتح `/app/pos.html` بمرساة `noopener` — **إعادة البناء داخل V2 بند مستقل** (#30) |
| `query` | ❌ | مفتاح في `NAV_GROUPS`/`ALL_PERMISSIONS` فقط (`auth-navigation.js:284`، `i18n.js:275`)؛ **لا قائمة دور تحمله ولا `case` له** في `page-router.js` → يقع على `default: renderDashboard()`. V2 يرث السلوك نفسه. |
| `professional` | ❌ | نفس العلة (`i18n.js:276`) — لا صفحة في القديم أصلًا. |

---

## ٣. الأسطح المشتركة (غير المرتبطة بمفتاح صفحة)

| السطح | القديم | V2 | الحالة | الفجوة / المهمة |
|---|---|---|---|---|
| الشات الداخلي | `app.js:332-466` | `chat.js` + `chat-repo.js` + `realtime.js` خلف `?v2chat` | ✅ | مغلق — `76edd2e` · `v2-parity-chat-2026-10-17` · 15 اختبارًا |
| عارض التقارير داخل التطبيق | `report-viewer.js` (`openInAppReport` → iframe `srcdoc`) مستخدم في 13 وحدة | `report-viewer.js` + 10 شاشات طباعة + `erp-report-viewer.css`، حوار Escape/تركيز، خلف لا شيء لأنه عرض فقط | ✅ | مغلق — `350bc3e` · `v2-report-viewer-2026-10-17` · 20 اختبارًا ودليل 1180/360 |
| الاستيراد الجماعي للموظفين/المستخدمين | `bulk-import.js` (معاينة، توليد يوزر/كلمة مرور، بصمات، تصدير، طباعة) | `bulk-import-wizard.js` + `bulk-import.js` + `bulk-import-repo.js` خلف `?v2bulkimport` | ✅ | مغلق — `c3556d9` · 20 اختبارًا ودليل 1180/360 |
| استيراد المخزون من Excel | `warehouse.js:2396-2567` (ملف `.xlsx` + قائمة أصناف) | زر «استيراد Excel» + «كتالوج الأصناف» بجانب «إدخال يدوي» (`screens/warehouse.js`) | ✅ | مغلق — `ad01b05` · `v2-warehouse-excel-2026-10-17` · 16 اختبارًا ودليل 1180/360 |
| شريط الجوال السفلي | `mobile-shell.js` — `mobileNavItems()`، يظهر ≤900px، أدوار محددة | `mobile-shell.js` + `erp-mobile-shell.css` (شريط 5 أزرار، بصمتي، والمزيد) | ✅ | مغلق — `v2-mobile-shell` · 9 اختبارات ودليل 360/900 |
| بحث الأصناف الذكي | `smart-item-search.js` — تطبيع عربي/همزات، تنقل ↑↓، يعبّئ الوحدة والسعر | `item-search.js` + `invoice-editor.js` داخل شاشة ٠٨ خلف `v2invoicecreate` — التطبيع والترتيب والتنقل ↑↓/Enter/Esc وتعبئة الوحدة/السعر نفسها | ✅ | مغلق — `9b4ff17` · `v2-invoice-create-2026-10-17` · 32 اختبارًا ودليل 1180/360 |
| بطاقة الموظف وQR | `smart-card.js` | `employee-card-repo.js` + شاشة الموظفين (P0‑5) | ✅ | — |
| شارة حالة الخادم | `main.js:204` (`/system/server-info`، محدّث/قديم) | مصابيح صحة فقط (`/health`) | ⬜ | #31 |
| قيود قاعدة البيانات للعميل | `db-constraints-client.js` (`/api/schema/constraints`) | لا شيء | ⬜ | تحقق عميل استرشادي؛ الخادم يبقى الحكم → #31 |
| بديل realtime بالاستقصاء | `realtime.js` (`/api/rt/events`، `/ack`، `/version`) | socket.io فقط (`v2/realtime.js`) | ⬜ | مسار احتياطي عند حجب websocket → #31 |
| الدخول/الخروج/كلمة المرور | `auth-navigation.js` | `screens/login.js` + `shell-extras.js` + `shell-repo.js` | ✅ | نفس الأبواب والحقول |
| اللغة والاتجاه والثيم | `karim-i18n.js` + theme | `shell-extras.js` + `theme.js` | ✅ | نفس مفتاح `karim_lang` |

---

## ٤. الوحدات المؤجلة — أرقام الأبواب

| الوحدة | أبواب الخادم | ما يستدعيه القديم | ما يغطيه V2 | الفجوة | المهمة |
|---|---|---|---|---|---|
| تقارير Yara | **23** (`backend/yarasoft/`) | **14** بابًا | **10** (`yara-reports-repo.js` 7 + `reports-extra.js:174/185/198` 3) + `daily-locks` من `oracle-repo` | **4**: `cashiers-live`, `cashiers-today`, `order-detail/:docNo`, `received-dispatch-detail/:id` | #27 |
| YaraSoft | **60** في 20 ملفًا | **32** | **3**: `status`, `log`, `sections/invoice-detail` | 29 بابًا + كتابات خلف أعلام مستقلة | #28 |
| WhatsApp | **60** | **19** | **2**: `status`, `messages` | 17 بابًا + QR/إقران حيّ + كتابات خلف أعلام | #29 |
| POS | تطبيق مستقل + `/api/pos/*` | كل `pos.js`/`pos-orders.js` | 🔗 مدخل فقط | إعادة بناء كاملة (بند #30، `pos.html` بلا مسّ) | #30 |
| ZATCA | 9 أبواب في `settings` | 9 | 9 في `screens/settings.js:158-224` (طابور/retry/CSR/تفعيل/اختبار) | — | ✅ |
| بقية الأبواب بلا مستهلك | — | — | — | الخادم 483 مسارًا؛ بعض الأبواب لا يستهلكها أي واجهة (تشخيص/صيانة). تُحسم في #31 بعد مسح الاستخدام. | #31 |

**ملاحظة منهجية:** «60 بابًا» لـYaraSoft/WhatsApp هي تسجيلات `router` في
`backend/yarasoft/` و`backend/whatsapp-engine/`، لا كلها واجهة؛ مصفوفة البند
الخاص ستفرز القراءة من الكتابة قبل التنفيذ، والكتابة لا تُفعَّل إلا بعلمها.

---

## ٥. الأدوار والتنقّل

- V2 لا يعرّف قوائم أدوار بنفسه: `layout/nav-model.js` يقرأ `window.ROLES`
  (نفس `core/config.js`) و`window.NAV_GROUPS` (نفس `auth-navigation.js:279`)
  و`permissions.deniedMenus`، بنفس قاعدة `(menus ∪ grants) − denied` مع إعفاء
  admin — فقائمة كل دور **هي** قائمة القديم حرفيًّا.
- الأدوار الأحد عشر كلها موجودة: admin, manager, warehouse, kitchen, sous_chef,
  dept_head, hr, accountant, employee, owner, cashier.
- البوابات في V2 مزدوجة: الدور + `canWrite` من الخادم، وأعلام كتابة مستقلة
  OFF افتراضيًّا (`write-flags.js`). القديم لا يبوّب التنقّل عند العميل إلا
  بـ`deniedMenus`؛ V2 يطابق ذلك عمدًا (انظر قاعدة «بوابة التوجيه» في العقد).
- لا فرق أدوار غير مغطّى إلا ما يخص الوحدات المؤجلة نفسها (#27‑#31).

---

## ٦. خطة الإغلاق

| المهمة | المحتوى | تُغلق عندما |
|---|---|---|
| #26 الأسطح المشتركة | عارض تقارير V2 + تصدير Excel (wh-vs-pos والتحليلان) + استيراد المخزون وكتالوج الأصناف + معالج الاستيراد الجماعي للموظفين/المستخدمين + بحث الأصناف الذكي + شريط الجوال السفلي | ✅ مغلق بالكامل — 6/6 سطوح منفّذة ومختبرة ومطابقة (`c3556d9` + `v2-mobile-shell`) |
| #27 تقارير Yara | الأبواب الأربعة الناقصة + فرز 23 بابًا: مستهلك/غير مستهلك | 14/14 مما يستدعيه القديم + قرار موثّق للباقي |
| #28 YaraSoft | 29 بابًا خلف واجهة V2، قراءة أولًا ثم كتابات بأعلام مستقلة | 32/32 + اختبارات + دليل |
| #29 WhatsApp | 17 بابًا + QR/إقران + كتابات بأعلام مستقلة | 19/19 + دليل بمقبس/جلسة حيّة أو تصريح بما لم يُختبر |
| #30 POS | إعادة بناء كاملة داخل V2 على نفس `/api/pos/*`، خلف علم OFF | شاشة V2 بكل وظائف `pos.html` + دليل + `pos.html` بلا تغيير |
| #31 البقية | بطاقات التكلفة، لوحة الكاشيرية في الأقسام، الرصيد الافتتاحي الصافي، شارة الخادم، قيود العميل، بديل realtime | كل بند مغلق بدليله أو مصرَّح ببقائه |
| #32 التوقيع | إعادة تشغيل هذه المصفوفة بعد الإغلاق + متصفح شامل + لقطة تكافؤ | صفر ◐/⬜ بلا قرار |

---

## ٧. حالة الإثبات

- هذه المصفوفة **جرد مصادر** (ملفات وأسطر وأبواب)، لا شهادة سلوك: كل صفّ ✅
  يستند إلى شاشة V2 وباب مطابق أو مكافئ، وأغلبها سبق إثباته في بنوده.
- أرقام §١ آلية بتاريخ 2026‑10‑17؛ تُعاد بتشغيل الجرد نفسه عند #32.
- ما **لم** يُختبر هنا: لا جلسة حيّة ولا قاعدة بيانات ولا متصفح لهذا البند؛
  الدليل السلوكي يبقى مسؤولية كل بند تنفيذي عند إغلاقه.
