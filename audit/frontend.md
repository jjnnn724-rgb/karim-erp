# تدقيق الواجهة الأمامية — Karim ERP (Frontend Only)

**النطاق:** `frontend/app/**` (خاصًّا `js/features/*.js`, `index.html`, `css/*`) — لم يُفحص `backend/` ولا `scripts/`.
**طريقة الفحص:** قراءة ثابتة (static analysis) + مطابقة تعريف/استدعاء عبر grep آلي، دون تشغيل النظام.
**التاريخ:** 2026-10-10 · **الإصدار قيد الفحص:** `?v=4.9.69` (main.js) مقابل `4.9.33` (app.js) و`4.9.32` (CSS/realtime).

---

## ملخص تنفيذي (أعلى 10 مشكلة)

1. **زر «تغيير كلمة المرور» في الشريط العلوي ميّت بالكامل** — `showChangeMyPasswordModal` و`submitChangeMyPassword` معرّفتان في `js/features/auth-navigation.js:25,34` لكناهما **غير موجودتين في قائمة التصدير** (`auth-navigation.js:464`) → `onclick="showChangeMyPasswordModal()"` في `index.html:215` يرمي `ReferenceError`، وزر الحفظ داخل المودال likewise. (HIGH)
2. **`go()` تتجاهل صلاحيات المنح/السحب** — `auth-navigation.js:366-368` تتحقق من `role.menus` فقط، بينما القائمة الجانبية تُبنى بـ `userMenus()` = الدور ∪ المنح − السحب (`auth-navigation.js:286-294`) → صلاحية مُمنوحة تظهر ولا تُفتح («لا تملك صلاحية الوصول»)، وصلاحية **مسحوبة تظل قابلة للوصول** عبر command palette / روابط الإشعارات. (HIGH)
3. **العمل دون اتصال (Offline) معطّل لتجراف الوحدات** — `sw.js:24,41-46,58` يسبّق تخزين `main.js?v=4.9.32` و`settings-users/veg-requests/cfo/auth-navigation.js?v=4.9.32` بينما `index.html:248` و`main.js` يطلبان `?v=4.9.69` → الـ URL لا يتطابق → بدون شبكة تفشل الوحدات ويظهر شاشة دخول ميّتة. (HIGH)
4. **XSS مخزَّن: بيانات من قاعدة البيانات تُحقن في `innerHTML` بلا `esc()`** — 52 موقعًا مباشرًا (مثل `kitchen.js:1148-1158` ‏`item.itemName`، `dashboard.js:363-371` ‏`emp.name`، `reports.js:352`، `smart-card.js:9,22`، `hr.js:364`) من أصل **133** حقنًا خامًا؛ مع 444 عملية `innerHTML=` في الملفات. وظيفة الحماية `safeImgSrc` (المعلَّمة كإصلاح XSS) **لم تُستدعَ أبدًا** (`core/utils.js:15`، 0 مواقع استدعاء). (HIGH)
5. **صفحة «موظفو قسمي» (dept-employees) غير قابلة للوصول إطلاقًا** — الدور `dept_head` يملك المفتاح (`core/config.js:15`) والمفتاح في `NAV_GROUPS` (`auth-navigation.js:283`) لكنه **غير موجود في `ALL_PERMISSIONS.menus`** (`app.js:187-228`)، والحرس في `auth-navigation.js:349` يرفض المفاتيح غير المعرّفة → لا يظهر في القائمة، ولا يوجد أي `go('dept-employees')` في الكود كله. (HIGH)
6. **بوابات الأدوار مبنية على `aria-label` عربي → تفشل بالفاتح/الإنجليزي (fail-open)** — `auth-navigation.js:306-309` تختار `.fab-action[aria-label="لوحة التحكم"]`… إلخ، و`i18n-auto.js:27,55-59` يعيد كتابة `aria-label` إلى الإنجليزية (المفاتيح موجودة في الكتالوج) → بعد `toggleLang()` تختفي الحصرية وتظهر كل الإجراءات لكل الأدوار. (MED)
7. **صفحتان ميتتان/ناقصتان في الراوتر:** `yara-daily-locks` لها `case` في `page-router.js:71` ومفتاح دور في `config.js:9,17` لكنها غائبة عن `ALL_PERMISSIONS.menus` (لا تظهر في التنقل ولا في خريطة العناوين `auth-navigation.js:372`)؛ ومفتاحا `query` و`professional` (`app.js:225-226`, `auth-navigation.js:284`) **ليس لهما `case` في `renderPage`** → يسقطان في `default: renderDashboard()` (`page-router.js:103`) مع عنوان خام. (MED)
8. **وظائف مكسورة في المخزن/طلبات الخضار:** `addSecUnitPreset` (`warehouse.js:1399` نداء داخل `onclick` مقابل تعريف `warehouse.js:1429` غير مُصدَّر في `warehouse.js:2770`)، و`vegUpdateCount` (`veg-requests.js:215` مقابل `:254` غير مُصدَّر في `:697-702`) → أزرار لا تفعل شيئًا سوى `ReferenceError`. (MED)
9. **ازدواج وحدات ESM بسبب `?v=` مختلف في `import`:** `reports.js:7` يستورد `./smart-card.js?v=4.9.1` و`report-viewer.js:16` يستورد `../core/utils.js?v=4.9.13` بينما الجسر يحمل `?v=4.9.69` (`main.js:24-187`) → **نسخة مزدوجة** من الوحدة (حالة داخلية منفصلة + تحميل شبكة خاملة). مع تشتّت عام للإصدارات (`index.html` يخلط 4.9.32/4.9.33/4.9.69/2.0.0، `menu-admin.html:105` و`menu-board.html:101` لا يزالا `?v=4.0.0`). (MED)
10. **الترجمة سطحية فقط:** ‏5,663 نصًا عربيًا مضمّنًا مقابل **365** استدعاء `t()` في `js/features/*`؛ وشاشات `pos.html`/`menu-admin.html`/`menu-board.html` **لا تحمّل `i18n-auto.js` أصلًا** → الوضع الإنجليزي معطّل فيها، وأربعة مفاتيح `pg.wh-*` مفقودة في قسم `en` فتظهر عربية في واجهة إنجليزية. (MED)

**الإجمالي: 34 مشكلة — HIGH: 5 · MED: 13 · LOW: 16**

---

## جرد ملفات الميزات (`frontend/app/js/features/`)

| الملف | الأسطر | الدوال | أزرار/`onclick` | الغرض |
|---|---:|---:|---:|---|
| warehouse.js | 2770 | 191 | 145 | المخزن، الفواتير، الرفوف، الميزان، الجرد، المشتريات |
| kitchen.js | 1542 | 158 | 135 | مركز المطبخ: صرف/استلام/إنتاج/وصفات/طلبات شراء |
| hr.js | 1047 | 69 | 70 | الحضور، الإجازات، الورديات، لوحة HR |
| settings-users.js | 1014 | 69 | 56 | الإعدادات، المستخدمون، الشعار، ZATCA، إعادة الضبط |
| smart-card.js | 965 | 36 | 12 | البطاقة الذكية/QR/طباعة التقارير الشهرية |
| yarasoft.js | 905 | 63 | 68 | استيراد فواتير Yarasoft/Oracle |
| employees.js | 559 | 24 | 30 | إدارة الموظفين والحسابات والبصمة |
| bulk-import.js | 587 | 23 | 21 | الاستيراد الجماعي (Excel/CSV) |
| finance.js | 498 | 29 | 30 | الإيرادات/المصاريف/التكاليف/الأرباح |
| cfo.js | 477 | 39 | 41 | المدير المالي: قيود، ميزان، ميزانية، أصول |
| auth-navigation.js | 464 | 37 | 7 | الدخول/الخروج/التنقل/القوائم/تغيير كلمة المرور |
| reports.js | 681 | 20 | 9 | التقارير (عام/أقسام/مطبخ/مخزن/POS) |
| whatsapp.js | 511 | 45 | 40 | محرك واتساب: QR، حملات، قوالب |
| zkteco.js | 510 | 32 | 27 | أجهزة البصمة ZKTeco |
| dashboard.js | 387 | 12 | 45 | لوحة التحكم + KPIs + تنبيهات الصلاحية |
| departments.js | 385 | 27 | 20 | الأقسام وتفاصيل القسم |
| roster.js | 384 | 17 | 11 | دوامات القسم والاعتماد |
| veg-requests.js | 702 | 36 | 21 | طلبات شراء الخضار (مطبخ→مخزن) |
| mobile-shell.js | 1055 | 32 | 1 | قشرة الجوال: بصمة/بصمة وجه/_geofence |
| pos-orders.js (خارج features) | — | — | — | طلبات/فواتير POS (صفحة منفصلة) |
| smart-item-search.js | 306 | 19 | 0 | **تجربة** بحث ذكي (IIFE، محمّلة عبر `index.html:257`) |
| cashier-monitor.js | 275 | 15 | 11 | متابعة الكاشير (للمالك) |
| employee-portal.js | 170 | 6 | 2 | بوابة الموظف |
| dept-employees.js | 121 | 10 | 5 | موظفو القسم (رئيس القسم) |
| permissions.js | 116 | 5 | 1 | منح/سحب الصلاحيات الفردية |
| page-router.js | 149 | 3 | 1 | `renderPage`/`showModal`/`closeModal` |
| report-viewer.js | 83 | 2 | 0 | عارض التقارير داخل التطبيق |
| **الإجمالي** | **16,663** | **1,019** | **809** | (26 ملفًا) |

---

## قائمة المشاكل

### HIGH

**H1 — زر تغيير كلمة المرور الشخصي ميّت**
- `js/features/auth-navigation.js:25` + `:34` (التعريف) مقابل `auth-navigation.js:464` (قائمة التصدير) · `index.html:215` (المستهلك)
- **المشكلة:** `showChangeMyPasswordModal` و`submitChangeMyPassword` غير مُصدَّرَين من الوحدة، و`Object.assign(window, await import(...))` في `main.js:126` لا يعرّفهما على `window` → النقر على أيقونة المفتاح في الشريط العلوي يرمي `ReferenceError`، وأزرار المودال «إلغاء/تغيير كلمة المرور» نفسها معطّلة.
- **الإصلاح:** إضافتهما (و`cpFail`) إلى `export { ... }` في `auth-navigation.js:464`.

**H2 — `go()` لا تراعي المنح/السحب (تباين أمني داخلي)**
- `js/features/auth-navigation.js:366-368` مقابل `:286-294` و`:452` · `js/app.js:283`
- **المشكلة:** الحارس `if(!role || !role.menus.includes(page))` يتجاهل `STATE.permissions.menus/deniedMenus` بينما `userMenus()` و`checkMenuAccessLocal()` و`buildNav()` تراعيهما → عنصر مُمنوح يظهر ولا يُفتح، وعنصر **مسحوب** يظل قابلًا للوصول من command palette (`ui/enhancement.js:12-28`) والإشعارات (`app.js:281-289`).
- **الإصلاح:** جعل `go()` و`navigateNotification()` يستدعيان `userMenus()` (وبالترتيب: السحب يغلب) بدل `role.menus`.

**H3 — Service Worker يسبّق تخزين نسخ `?v=` قديمة → تعطّل وضع Offline**
- `sw.js:24,41,42,43,46,58` مقابل `index.html:248` و`main.js:24-187`
- **المشكلة:** قائمة `STATIC_ASSETS` تسبّك `main.js?v=4.9.32` و`settings-users.js?v=4.9.32`… إلخ، بينما المرجع الحقيقي `?v=4.9.69`. لأن المتصفح يطابق الكاش بالمفتاح الكامل للـ URL، فإن الوحدات الأساسية غير مخزَّنة تحت مفتاحها الفعلي → بدون شبكة يفشل استيراد `main.js` (كل الشاشات).
- **الإصلاح:** توليد `STATIC_ASSETS` من نفس ثابت الإصدار (مصدر واحد)، أو حذف `?v=` من قائمة التسبيق مع `ignoreSearch` في `cache.match`.

**H4 — XSS مخزَّن عبر `innerHTML` بدون ترميز**
- أمثلة: `js/features/kitchen.js:1148,1149,1150,1158` (`item.itemName`) · `js/features/dashboard.js:363,367,371` (`emp.name`) · `js/features/reports.js:293,352` (`dept.name`, `i.itemName`) · `js/features/smart-card.js:9,22` (`emp.name`) · `js/features/hr.js:364` (`g.emp.name`) · `js/features/dept-employees.js:55,58` (`fieldsHtml.name/phone`) · `js/features/mobile-shell.js:604` (ترميز يدوي ناقص `replace(/</g,'&lt;')` فقط)
- **المشكلة:** 52 حقنًا مباشرًا لحقول قاعدة بيانات داخل قوالب HTML تُسند إلى `innerHTML` (444 عملية `innerHTML=` كلها)، مقابل 1,446 استدعاء `esc()` — أي أن الترميز يدوي وغير إلزامي. بيانات مثل اسم الصنف/الموظف يُدخلها مستخدمون مخوّلون → سكربت خبيث يُخزَّن ثم ينفَّذ بجلسة الضحية (`window._jwt` في الذاكرة + `apiFetch`).
- **الإصلاح:** مرحلة انتقالية: تغليف `renderPage`/`showModal` بطبقة ترميز تلقائي للقيم غير المعروفة، أو ضبط lint rule يمنع `${` داخل قوالب HTML لمتغيّر غير مغلّف بـ `esc()`؛ وتفعيل `safeImgSrc` لحقول `<img src>`.

**H5 — صفحة `dept-employees` ميتة لدور `dept_head`**
- `js/core/config.js:15` · `js/app.js:187-228` (لا يحوي المفتاح) · `js/features/auth-navigation.js:349,356-362` · `js/features/page-router.js:42`
- **المشكلة:** المفتاح ممنوح للدور وموجود في `NAV_GROUPS` لكن غائب عن `ALL_PERMISSIONS.menus` → شرط `!(key in ALL_PERMISSIONS.menus)` يستبعده، وشبكة الأمان بعدها تمرّر فقط ما هو داخل `ALL_PERMISSIONS.menus`. لا يوجد أي `go('dept-employees')` في الكود → لا يمكن الوصول للصفحة إطلاقًا (رغم وجود `renderDeptEmployeesPage`).
- **الإصلاح:** إضافة `dept-employees: '<i class=ji data-i=users></i>'` إلى `ALL_PERMISSIONS.menus` (+ خريطة عنوان في `go()` `auth-navigation.js:372`).

### MED

**M1 — بوابات الأدوار تعتمد على `aria-label` عربي (fail-open في الإنجليزية)**
- `js/features/auth-navigation.js:306-309` · `js/core/i18n-auto.js:27,55-59` · `js/core/i18n-auto-catalog.js` (يحوي `لوحة التحكم`/`طلب صرف`/`إضافة إيراد`/`إضافة مصروف`)
- **المشكلة:** `i18n-auto` يعيد كتابة `aria-label` لحظيًا عبر MutationObserver، فتصبح `aria-label="Dashboard"` وselectors الحصرية لا تطابق شيئًا → كل إجراءات FAB تظهر لكل الأدوار (بما فيها `employee`/`cashier`).
- **الإصلاح:** استخدام `data-fab="dashboard"` ثابت كمُحدِّد، أو ربط الحصرية بـ `dataset.role` بدل النص.

**M2 — صفحة `yara-daily-locks` غير قابلة للوصول + عنوان خام**
- `js/core/config.js:9,17` · `js/app.js:187-228` (غائبة) · `js/features/page-router.js:71` · `js/features/auth-navigation.js:372` (غائبة عن `titles`)
- **المشكلة:** `case` للصفحة ومفتاح دور لكن لا مفتاح قائمة ولا عنوان → لا تظهر في الشريط، ومن يصلها يرى العنوان `yara-daily-locks`.
- **الإصلاح:** إضافتها لـ `ALL_PERMISSIONS.menus` + `titles` + `NAV_GROUPS.sys`، أو حذفها من `ROLES` إن كانت مهجورة.

**M3 — مفتاحا `query` و`professional` بلا صفحة**
- `js/app.js:225,226` · `js/features/auth-navigation.js:284` · `js/features/page-router.js:103`
- **المشكلة:** كلا المفتاحين في `ALL_PERMISSIONS.menus` و`NAV_GROUPS.sys` لكن لا `case` في `renderPage` → عند منحهما يظهر عنصر قائمة يفتح… لوحة التحكم بعنوان `query`. ولا دور يملكهما افتراضيًا (`shelves`/`weight` كذلك: مفاتيح بلا دور).
- **الإصلاح:** حذفهما من `ALL_PERMISSIONS`/`NAV_GROUPS` أو إضافة صفحاتهما فعلًا.

**M4 — `addSecUnitPreset` غير مصدَّر (أزرار الوحدات الثانوية في المخزن)**
- `js/features/warehouse.js:1399` (onclick) مقابل `:1429` (التعريف) مقابل `:2770` (قائمة التصدير)
- **المشكلة:** النقر على أزرار `كيلو/قطنة/كرتونة…` داخل مودال تعديل الصنف يرمي `ReferenceError` ولا يضيف صفًا.
- **الإصلاح:** إضافة `addSecUnitPreset` إلى `export` (مع التأكد من عدم وجود `window.` يدوي).

**M5 — `vegUpdateCount` غير مصدَّر (عدّاد طلبات الخضار)**
- `js/features/veg-requests.js:215` (onclick في صف مخصص) مقابل `:254` مقابل التصدير `:697-702`
- **المشكلة:** حذف الصف المخصص ينجح لكن العدّاد لا يتحدث ويُرمى `ReferenceError`.
- **الإصلاح:** إضافة `vegUpdateCount` إلى `export`.

**M6 — `renderHRDashboard` معرَّفة مرتين بت implementations مختلفة**
- `js/features/hr.js:8` (تستدعي `renderHRCharts`) مقابل `js/features/dashboard.js:91` (نسخة بصرية مختلفة)
- **المشكلة:** كلا الوحدتين تُعرِّف على `window` عبر `Object.assign`؛ ترتيب `main.js:139` ثم `:157` يجعل نسخة `dashboard.js` **تظلَّل** نسخة `hr.js` → نداء `setTimeout(renderHRCharts)` لا يحدث والصفحة تختلف عن المقصود.
- **الإصلاح:** إبقاء نسخة واحدة (نقلها للملف المسؤول) وحذف الأخرى.

**M7 — `import` بـ `?v=` مختلف → نسخ وحدات مزدوجة**
- `js/features/reports.js:7` (`smart-card.js?v=4.9.1`) · `js/features/report-viewer.js:16` (`utils.js?v=4.9.13`) مقابل `js/main.js:129,26` (`?v=4.9.69`)
- **المشكلة:** هوية الوحدة = الـ URL الكامل → تنفيذ مزدوج لـ `smart-card.js` (حالة/`qrCache` منفصلة) وشبكة استيراد خاملة، خلافًا لـ «قاعدة الانضباط» المكتوبة في `main.js:9-13`.
- **الإصلاح:** توحيد كل `?v=` في كل `import` مع `index.html` (يفضَّل توليد آلي).

**M8 — تشتّت إصدارات `?v=` cache-busting**
- `index.html:4,32-34,37-39,43,45-47,246-257` (4.9.32 / 4.9.33 / 4.9.69 / 2.0.0) · `pos.html:534` (4.9.33) · `menu-admin.html:105` و`menu-board.html:101` (**4.0.0**) · `js/main.js:24-187` (4.9.69) · `js/core/config.js:6` (`VERSION: '4.9.2'`)
- **المشكلة:** أربع حزم إصدار مختلفة في نفس الصفحة + إصدار قديم جدًا لصفحتي القائمة → خطر تقديم كاش قديم (`app.js` بـ 4.9.33 قد لا يطابق `main.js` 4.9.69).
- **الإصلاح:** مصدر واحد للاصدار يستعمله `index.html` و`main.js` و`sw.js`.

**M9 — i18n: نص عربي مضمَّن ضخم + شاشات بلا مترجم**
- `js/features/*` (‏5,663 نصًا عربيًا مقابل **365** `t()`) · `index.html:252-253` (يحمّل `i18n-auto`) مقابل `pos.html`/`menu-admin.html`/`menu-board.html` (لا يحمّلانه)
- **المشكلة:** الترجمة تعتمد على كتالوج DOM من1,411 مفتاحًا يعمل فقط في `index.html`؛ شاشة الكاشير/إدارة القائمة تبقى عربية في الوضع الإنجليزية. أي نص جديد لا يوجد في الكتالوج يبقى عربيًا.
- **الإصلاح:** تحميل `i18n-auto*.js` في بقية الصفحات، وتوحيد المصدر على `t()` للنصوص المتغيّرة.

**M10 — حقن داخل سياق `onclick="...('${x}')"` و`esc()` لا يحجب اقتباس JS**
- 218 موقعًا `on*="...${...}"` بقيم غير مُهرَّبة · أمثلة خامّة: `js/features/departments.js:104,381` (`d.code`)، `js/features/hr.js:660,661` (`dept.code`) · موضع `esc()` غير كافٍ: `js/features/permissions.js:46` (`permSet('${esc(p.key)}'…`)
- **المشكلة:** `esc()` يحوّل `'` إلى `&#39;` لكن محلِّل HTML **يفكّ الترميز قبل** تنفيذ JS → الاقباس ينكسر/يُحقَّن. كود قسم يُدخله مستخدم → كسر الزر أو تنفيذ سكربت.
- **الإصلاح:** منع القيم غير المحسوبة داخل `onclick`: استخدام `data-*` + `addEventListener`، أو `JSON.stringify` للقيمة داخل السياق.

**M11 — فشل واحد في التسبيق يُفشل الكاش كله**
- `sw.js:89,90` (`cache.addAll(...).catch(()=>undefined)`)
- **المشكلة:** `addAll` ذرّية؛ أي ملف 404 واحد (مثل `?v=` قديم) يُلغي تخزين الـ 59 ملفًا معًا دون تسجيل.
- **الإصلاح:** `Promise.allSettled(assets.map(a=>cache.add(a)))`.

**M12 — بوابات صلاحيات من جانب العميل فقط**
- `js/features/permissions.js:8` (فحص `role !== 'admin'` للعرض فقط) · `js/features/auth-navigation.js:298-313` (`applyTopbarRoleGates` يغيّر `display` فقط) · `js/core/state.js:26-33` (`ROLE_ENTITY_EXCLUSIONS` معلَّم صراحةً بأنه «يمنع ضجيج 403»)
- **المشكلة:** كل الحصرية المذكورة قابلة للتجاوز من console (تغيير `STATE.page` أو استدعاء `renderPage` مباشرة)، والاعتماد كله على أن الخادم يرفض. (لم يُفحص الخادم خارج النطاق).
- **الإصلاح:** في الواجهة: تمرير القرار لحارس واحد (`can(page)`) يستهلك `userMenus()` + رفض الطلب الأمامي للمسارات الحساسة، مع التأكد من التطابق مع سياسة الخادم.

**M13 — قوائم أدوار غير متسقة بين الشاشات**
- `js/features/auth-navigation.js:451` (`['admin','kitchen','manager','dept_head']` لزر «طلب صرف» العلوي) مقابل `:307` (`+sous_chef, +warehouse` لزر FAB نفسه) · `:306` (لوحة التحكم بدون `kitchen`) · `:114,119` في `page-router.js` (`['admin','hr','manager']` لرفع البطاقة)
- **المشكلة:** نفس الإجراء له قائمتا أدوار مختلفتان → زر ظاهر في مكان وغائب في آخر (مثال: `sous_chef` و`warehouse` يملكان زر FAB لكن ليسما زر الشريط العلوي).
- **الإصلاح:** استخراج `const DISPATCH_ROLES = [...]` مركزية في `config.js` واستهلاكها من الجميع.

### LOW

**L1 — `console.log` في كود الإنتاج (6)**
- `js/features/smart-card.js:538,540,542,544` (تتبّع `printMonthlyAttendance`) · `js/realtime.js:394` (بانر اتصال) · `js/core/storage.js:14` (بانر `[HRP]`)
- **الإصلاح:** حذف تتبّع `smart-card`، وإبقاء البانرات خلف `CONFIG.DEBUG`.

**L2 — `alert` (1) و`prompt` (24)**
- `js/login-boot.js:58` (`alert` احتياطي) · تغيير كلمة المرور الإلزامي عبر `window.prompt` في `js/features/auth-navigation.js:9,11` و`js/pos.js:257,259` · 12 استدعاء `prompt` في `js/features/cfo.js:125,191-193,273-275,296-298,336-337`
- **المشكلة:** `prompt` لكشف/قيد مالي يمنع اللصق ويعرض البيانات في واجهة بدائية؛ وواجهة تغيير كلمة المرور الإلزامي بـ `prompt` لا تتحقق من قوة كلمة المرور بصريًا.
- **الإصلاح:** استبدالها بمودال موجود (`showModal`) — القالب موجود بالفعل.

**L3 — 17 تصديرًا لا يُستدعى أبدًا**
- `js/features/kitchen.js`: `prCanReceive, openPRReceiveModal, prDeliverModeSync, prFreshSuggest, confirmPRReceive, syncDispatchRowUnit, clearSignaturePad` (تدل على ترحيل ناقص لمسار «استلام طلبات الشراء»)
- `js/features/hr.js`: `attCorrectModal, approveLeave, rejectLeave, returnLeaveToEmployee` · `employees.js: revertInference` · `veg-requests.js: vegReceive` · `auth-navigation.js: accountingExpenseAmount` · `warehouse.js: whGoSec, pcmtRerenderSuppliers`
- **الإصلاح:** ربطها بالأزرار إن كانت مقصودة، أو حذفها.

**L4 — دوال ميتة + كود تصحيح/تأجيل**
- `js/app.js:247 metricCard` · `js/app.js chatIsOn/chatPeerName/initLoginParticles` · `js/menu-admin.js printWeeklyAll` · `js/features/roster.js rosterRiyadhToday`
- `js/features/warehouse.js:2769` دالة تصحيح صريحة `__dbgInvoiceState` **مُصدَّرة** في `:2770`
- `js/features/auth-navigation.js:380` ‏`const deptDetailFrom='',deptDetailTo=''` (قيمتان فارغتان مُصدَّرتان بلا استخدام)
- **الإصلاح:** حذفها.

**L5 — دوال مساعدة مكررة في ملفات متعددة (تعدد مصادر للحقيقة)**
- `esc`/`fN`: `menu-admin.js`, `menu-board.js`, `smart-item-search.js`, `core/utils.js` · `escapeHtml` منفصل في `js/pos.js:36`
- `portalWorkHours`: `employee-portal.js:7` و`employees.js:7` (نفس الكود حرفيًا) · `toggleSidebar`: `app.js:43` و`auth-navigation.js:392` · `normalizeAr`/`arSearchKey`: `employees.js` و`smart-item-search.js` (وفوقها `utils.js:165 arSearchKey` ونسخة محلية في `hr.js:116`) · `renderHRDashboard` (انظر M6)
- **الإصلاح:** استيراد كل المساعدات من `core/utils.js`.

**L6 — تلف ترميز في ملفات CSS**
- `css/pos.css:897` ببايت `0x97` غير صالح UTF-8 داخل تعليق (‏offset ≈62443) · `css/mobile.css:242` يحوي `U+FFFD` حرفيًا
- **المشكلة:** ليس خطأ parse (التعليق يُبلَّع) لكنه علامة تلف تمنع الترميز الصارم وتظهر `?` عند الفتح.
- **الإصلاح:** إعادة كتابة السطرين بـ UTF-8 نظيف.

**L7 — ‏`!important` كثيف (‏~35)**
- `css/pos.css` (‏13 فعلية: 74,127,128,344,481,482,633,636,644,647) · `css/styles.css` (‏12: 486,971,1022,1026,1027,1032,1163,1343,1489) · `css/pro-theme.css:155-157` · `css/mobile.css:299,419` · `menu-admin.css:8` · `scanner.css:18`
- **ملاحظة:** الأغلبية في `@media print` و`prefers-reduced-motion` (مقبول)، أما `pos.css:127,128` و`pro-theme.css:155-157` فتلاعب بالكاسكيد.
- **الإصلاح:** رفع أولويات المحددات بدل `!important`.

**L8 — خصائص اتجاه فيزيائية (`left`/`right`) بدل منطقية + تجاوزات LTR ناقصة**
- `css/styles.css`: 21 إعلانًا فيزيائيًا مع تجاوزات `html[dir="ltr"]` جزئية (`:601-609,1299-1301`) لكن `.fab{left:22px}` (`:685`) و`.fab-menu{left:22px}` (`:693`) **بلا تجاوز** → في الوضع الإنجليزي يبقى زر الإجراءات في الأسفل اليسار (معكوس).
- `css/menu-board.css`: 24 إعلانًا فيزيائيًا (‏17 `left:`) بلا `html[dir=ltr]` إطلاقًا.
- **الإصلاح:** `inset-inline-start`/`margin-inline-*`/`text-align:start`.

**L9 — مفاتيح i18n ناقصة/ميتة**
- **ناقصة في قسم `en`:** `pg.wh-invoices`, `pg.wh-moves`, `pg.wh-returns`, `pg.wh-prs` (موجودة في `ar` عند `core/i18n.js:15` وغير موجودة في `:108-117`) → واجهة إنجليزية تعرض عناوين عربية.
- **مستخدمة ومفقودة في الاثنين:** ديناميكية `t('pg.'+k)` في `js/features/settings-users.js:67` (والعبارة `||k` **ميتة** لأن `t()` تُعيد المفتاح نفسه ولا تُعيد falsy — `core/i18n.js:221`).
- **غير مستخدمة (19):** `act.add/back/close/print/view`, `db.thisMonth`, `dept.add`, `dept.title`, `hrd.noDepts`, `login.forgot`, `login.hint`, `nav.grp.*` (‏5), `pg.yara-daily-locks`, `wh.invBills`, `wh.qty`.
- **الإصلاح:** ملء الفجوات في `en`، حذف المفاتيح الميتة، وتغيير `t() ?? fallback`.

**L10 — `safeImgSrc` مكتوبة لكنها ميتة (إصلاح XSS لم يُطبَّق)**
- `js/core/utils.js:15-21` (تعليق يشرح أنه إصلاح XSS بتاريخ 2026-10-01) · تصدير في `:178` · جسر في `js/main.js:26` · **0 مواقع استدعاء** في الكود كله.
- **الإصلاح:** تطبيقها على كل `<img src>` القادمة من المستخدم (شعار الإعدادات، صور الأصناف، صور الموظفين) — `getLogoSrc` في `auth-navigation.js:256-259` تتحقق يدويًا فقط.

**L11 — بنية HTML غير صالحة في `index.html`**
- `index.html:4` (سكربت قبل `<meta charset>`) · `:254` و`:258` **`</body>` مرتان** · `:257` سكربت خارج `<body>` بينهما
- **المشكلة:** المتصفح يتسامح، لكن ترتيب charset قبل السكربت قد يُفسِّر محتوى غير متوقع، والبنية تربك أدوات البناء/PWA.
- **الإصلاح:** دمج السكربت داخل `<body>` الأول وحذف الوسم الزائد.

**L12 — رقم الإصدار المعروض للمستخدم خاطئ**
- `index.html:112` يبدأ بـ `4.8.0` (يُستبدل وقت التشغيل في `app.js:494,526,527` بـ `CONFIG.VERSION`) · `js/core/config.js:6` ‏`VERSION: '4.9.2'` · فعليًا الإصدار المستخدم `4.9.69`.
- **الإصلاح:** مزامنة `CONFIG.VERSION` مع ثابت الـ cache-busting.

**L13 — تراجع صامت للصفحات + عناوين ناقصة/مُكرَّسة**
- `js/features/page-router.js:103` `default: html=renderDashboard()` → أي مفتاح مجهول يفتح لوحة التحكم دون تحذير · `:41,42` حواجز `typeof` تُعيد بطاقة خطأ بدل التعطل (سلوك جيد) · `auth-navigation.js:372` خريطة العناوين تفتقر إلى `yara-daily-locks` و`cashier-monitor`/`veg-requests`/`dept-employees` مكتوبة عربيًا مضمَّنًا بدل `t()`.
- **الإصلاح:** `default` يعرض «صفحة غير موجودة» + توحيد العناوين على `t()`.

**L14 — تعليقات/تقنيات هشّة**
- `sw.js:1` تعليق «v4.7.2» مقابل `sw.js:13` ‏`CACHE_VERSION='4.25.41'` (تعليق قديم يضلّ) · `js/ui/enhancement.js:387-389` **monkey-patch** لـ `window.renderPage` (يلتف على أي تغيير لاحق) · `main.js:193-230` مؤقّت `setInterval` لشارة الخادم يعمل حتى بعد تسجيل الخروج (يُوقف عند غياب `window._jwt` جزئيًا فقط).
- **الإصلاح:** تعليق مُحدَّث، واستبدال الـ monkey-patch بنداء hook في `renderPage`.

**L15 — أصول ميتة محمَّلة في الإنتاج**
- `js/core/i18n-harvest.json` (‏42,855 بايت) يُشار إليه فقط في تعليق `i18n-auto-catalog.js:6` → لا يُحمَّل أبدًا · `index.html:257` محمّل تجربة `smart-item-search.js?v=2.0.0` خارج `<body>` مع تعليق «قابل للحذف» — نسخة `?v=2.0.0` منفصلة تمامًا عن بقية الـ `4.9.x` (مُكرَّر أيضًا في `sw.js:53`).
- **الإصلاح:** حذف الأصول الميتة أو نقلها خارج شجرة الإنتاج.

**L16 — عناصر قائمة بلا دور + شبكة أمان تُسقط أقسامًا**
- `js/features/auth-navigation.js:284` (‏`query`, `professional`) و`:282` (‏`shelves`, `weight`) بلا أي دور في `core/config.js:8-22` → تظهر فقط عبر منح يدوي؛ وشبكة الأمان `:356-362` تضع أي مفتاح غير مغطى تحت ترويسة «الرئيسية» (`nav-fallback`) مما يخفي أخطاء الإعداد بدل إظهارها.
- **الإصلاح:** تصفية `NAV_GROUPS` على المفاتيح الموجودة فعليًا في `ALL_PERMISSIONS.menus` وتسجيل تحذير للمفقود.

---

## إحصاءات

### حجم وبنية
| البند | القيمة |
|---|---:|
| ملفات `js/features/` | 26 |
| أسطر `js/features/` | 16,663 |
| إجمالي أسطر JS (بلا `vendor/`) — 49 ملفًا | 26,689 |
| إجمالي أسطر CSS — 10 ملفات | 4,139 |
| دوال معرَّفة في `features/` | 1,019 |
| إجراءات `onclick=` في `features/` | 809 |
| إجمالي `onclick=` (JS+HTML) | 875 |
| إسنادات `innerHTML =` | 444 |
| استدعاءات `esc()` / `escapeHtml()` | 1,446 / 41 |

### التنقّل والصلاحيات
| البند | القيمة |
|---|---:|
| أسماء معالجات `on*` مفحوصة | 586 |
| معالجات غير معرَّفة إطلاقًا (مكسورة) | 0 (كلها تُعرَّف، لكن 3 خارج نطاق `export` — H1/M4/M5) |
| قوائم أدوار مختلطة مكتشفة (`['admin',...].includes(role)`) | 26 تشكيلة |
| مفاتيح قوائم بلا دور (منح-يدوي فقط) | 4 (`shelves, weight, query, professional`) |
| مفاتيح أدوار مفقودة من `ALL_PERMISSIONS.menus` | 2 (`dept-employees, yara-daily-locks`) |
| `case` مفقود في `renderPage` لمفتاح قائمة | 2 (`query`, `professional`) |

### الترجمة (i18n)
| البند | القيمة |
|---|---:|
| مفاتيح في القاموس (`core/i18n.js`) | ‏276 (ar) / 336 (en) |
| مفاتيح `t()` مستخدمة فعليًا | 258 |
| مفاتيح ناقصة في `en` | 4 (`pg.wh-invoices/moves/returns/prs`) |
| مفاتيح غير مستخدمة في `ar` | 19 |
| مواقع `t()` | 365 |
| نصوص عربية مضمَّنة في `features/*` | 5,663 |
| مدخلات كتالوج الترجمة التلقائية | 1,411 (تعمل في `index.html` فقط) |
| حقن بيانات خام بلا `esc()` داخل قوالب HTML | 133 (‏52 منها اسم/صنف/موظف) |
| `on*="..."` بحقن غير مُهرَّب | 218 |

### الكود الميت / المكرَّر
| البند | القيمة |
|---|---:|
| دوال لا تُستدعى أبدًا | 6 (+2 دالتان مُعلَّمتان كـ IIFE بشكل خاطئ في فحص القراءة) |
| تصديرات لا تُستدعى | 17 |
| أسماء دوال معرَّفة في أكثر من ملف | 17 (أشدها `renderHRDashboard`) |
| أدوات مساعدة مكررة (`esc`, `fN`, `portalWorkHours`, `toggleSidebar`, `normalizeAr`, `escapeHtml`) | 6 عائلات |
| كود debug مُصدَّر | 1 (`warehouse.js:2769 __dbgInvoiceState`) |
| أصول ميتة | `i18n-harvest.json` (‏42KB)، `deptDetailFrom/To` |

### التصحيح والتشخيص
| البند | القيمة |
|---|---:|
| `console.log` | **6** (`smart-card.js` ×4, `realtime.js` ×1, `storage.js` ×1) |
| `console.warn` | 29 |
| `console.error` | 20 |
| `debugger` | **0** |
| `alert()` | **1** (`login-boot.js:58`) |
| `prompt()`/`window.prompt()` | **24** (منها 4 لمسار كلمة المرور) |

### CSS (عيّنة على 10 ملفات كاملة الأقواس)
| البند | القيمة |
|---|---:|
| أقواس `{`/`}` متوازنة | 10/10 ملفات |
| `!important` | 35 (‏`pos.css` 13 · `styles.css` 12 · `pro-theme.css` 3 · `mobile.css` 2+1 تعليق · `menu-admin` 1 · `scanner` 1) |
| إعلانات `left:`/`right:` فيزيائية | `styles.css` 21 · `menu-board.css` 24 · `pos.css` 3 · `mobile.css` 6 |
| تجاوزات `html[dir="ltr"]` | 10 في `styles.css` فقط (‏`menu-board.css` لا شيء) |
| تلف ترميز UTF-8 | 2 ملف (`pos.css:897` byte `0x97` غير صالح · `mobile.css:242` `U+FFFD`) |

### إصدارات الـ Cache-Busting الجارية
| الموقع | الإصدار |
|---|---|
| `js/main.js` + كل `safeBridge`/`import` | **4.9.69** |
| `index.html` → `main.js`, `pro-theme.css` | **4.9.69** |
| `index.html` → CSS و`realtime.js` و`vendor/*` و`qrcode` | 4.9.32 |
| `index.html` → `app.js` · `pos.html` → `pos.js` | 4.9.33 |
| `index.html:257` → `smart-item-search.js` | 2.0.0 |
| `js/features/reports.js:7` → `smart-card.js` | **4.9.1** (مختلف) |
| `js/features/report-viewer.js:16` → `utils.js` | **4.9.13** (مختلف) |
| `menu-admin.html:105`, `menu-board.html:101` | **4.0.0** (قديم) |
| `sw.js:13` ‏`CACHE_VERSION` | 4.25.41 (تعليقه يقول v4.7.2) |
| `js/core/config.js:6` ‏`CONFIG.VERSION` (المعروض للمستخدم) | 4.9.2 |
| `index.html:112` (قيمة افتراضية في HTML) | 4.8.0 |

**خلاصة:** لا يوجد «إصدار واحد» سائد؛ أقرب شيء للمرجع هو **4.9.69** (`main.js`)، وأربعة مواقع تخالفه داخل نفس الصفحة.

---

### ملاحظة على النطاق
لم يُفحص `backend/`، لذا كل ما يتعلق بـ «هل يرفض الخادم فعلًا؟» (H4 أثر التنفيذ، M12) مُصنَّف بحسب سلوك الواجهة فقط ويحتاج تحققًا من طرف الخادم.
