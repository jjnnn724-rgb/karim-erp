# MIGRATION_CHANGE_LOG

سجل كل تغيير هيكلي أثناء الترحيل — كل بند يوثّق: الأصل (file:line) → الوجهة، السبب، الجسور، وطريقة التحقق.
القاعدة: أي تغيير ضروري لعمل ESM يُوثّق هنا صراحةً. لا تغييرات سلوكية صامتة.

---

## EXTRACTION-001 — PWA install + offline bar

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-09-27 |
| **Commit** | `refactor(pwa): extract PWA install block from app.js` |
| **الأصل** | `frontend/app/js/app.js:11701–11727` (block) + `11758–11760` (IIFE re-exports `w.pwaInstall`, `w.pwaUpdateOfflineBar`) |
| **الوجهة** | `frontend/app/js/core/pwa.js` (new, ESM) + `frontend/app/js/main.js` (new, ESM entry + bridge) |
| **الكود المنقول** | verbatim: `_pwaPrompt` state, `beforeinstallprompt` listener, `pwaInstall()`, `pwaUpdateOfflineBar()`, `online`/`offline` listeners |
| **السطران المحذوفان من app.js (إجباري)** | IIFE سطرا `w.pwaInstall = pwaInstall; w.pwaUpdateOfflineBar = pwaUpdateOfflineBar;` — بدون حذفهما كان ReferenceError سيُسقط الـ IIFE كله (لا حماية typeof) — الاستبدال: تعليق مؤشر BRIDGE-001 |
| **الجسور** | BRIDGE-001 في `main.js`: `window.pwaInstall`, `window.pwaUpdateOfflineBar` — قبل تقييم app.js (ترتيب module-before-defer) |
| **index.html** | أُضيف `<script type="module" src="js/main.js?v=4.7.118">` قبل سكربتات defer؛ رفع `app.js`/`realtime.js` إلى `?v=4.7.118` |
| **sw.js** | `CACHE_VERSION` 4.7.12→**4.7.13**؛ أُضيف `main.js?v=4.7.118` و`core/pwa.js` إلى precache؛ صُحّح precache القديم `app.js?v=4.7.10`→`4.7.118` (كان mismatch قائمًا قبل الترحيل) |
| **الاعتماد الخارجي المحفوظ** | `toast()` يُستدعى bare من داخل core/pwa.js — يُحل من window وقت الاستدعاء (سلوك مطابق للكلاسيكي) |
| **توقيت التسجيل** | مستمعو beforeinstallprompt/online/offline سُجلوا أثناء تقييم main.js (قبل app.js) بدل أثناء تقييم app.js — كلاهما قبل DOMContentLoaded: سلوك مراقَب مطابق |
| **التحقق** | `node --check app.js` ✓ (12,324 سطرًا) · smoke آلي: `pwaInstall`/`pwaUpdateOfflineBar` دوال على window، نداء `pwaUpdateOfflineBar()` بلا خطأ، boot مكتمل (STATE.page=dashboard)، JWT حاضر، دوال الدخول سليمة، تنقّل للمخزن يعمل ومطابق للأساس بصريًا ✓ |

---

## EXTRACTION-002 — I18N core (قاموس + لغة)

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-09-27 |
| **Commit** | `refactor(i18n): extract I18N core from app.js (EXTRACTION-002, BRIDGE-002)` |
| **الأصل** | `frontend/app/js/app.js:256–549` (بنرات + `I18N` + `t` + `readLangLocal` + `persistLangLocal` + `ROLE_NAMES` + `MENU_STRINGS` + `applyI18nMaps` + `applyLangAttrs` + `applyLoginI18n`) — 293 سطرًا |
| **الوجهة** | `frontend/app/js/core/i18n.js` (new, ESM) + جسر في `js/main.js` |
| **النقل** | **byte-identical مُتحقق منه آليًا** (22,930 حرفًا مطابقة لقطعة الـ baseline) |
| **الجسر** | BRIDGE-002: 9 bindings على window (`I18N`, `t`, `readLangLocal`, `persistLangLocal`, `ROLE_NAMES`, `MENU_STRINGS`, `applyI18nMaps`, `applyLangAttrs`, `applyLoginI18n`) — استهلاك app.js بأسماء bare يُحل من window |
| **اعتماد خارجي محفوظ** | `STATE.lang` / `STATE.settings` تُقرأ من window وقت الاستدعاء (تقييم الموديول بلا آثار جانبية — بيانات فقط) |
| **قرار تصميمي موثق** | قسم "I18N" الأصلي (257–915) كان مزيجًا (ترجمة + أدوات + إشعارات + دردشة) — الاستخراج اقتصر على نواة الترجمة النقية فقط (cohesion > size)؛ البقية تبقى لاستخراجات لاحقة (utils → ui/notifications) |
| **index.html** | مزامنة preload القديم (4.7.117→4.7.119) + رفع `main.js`/`app.js`/`realtime.js` إلى `?v=4.7.119` |
| **sw.js** | `CACHE_VERSION` 4.7.13→**4.7.14** + إضافة `core/i18n.js` للـ precache |
| **التحقق** | `node --check app.js` ✓ (12,031 سطرًا) · مقارنة بايتية ✓ · **اختبار سلوكي حي:** تبديل اللغة AR→EN (`dir=ltr`, `t('login.btn')='Sign In'`, `localStorage.karim_lang='en'`, إعادة رسم كاملة) ثم العودة EN→AR عبر مسار الإنتاج الرسمي `toggleLang()` (`rtl`, `'تسجيل الدخول'`, `'ar'`) ✓ |

---

## EXTRACTION-003 — core/utils (المنسقات + الهجري)

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-09-27 |
| **Commit** | `refactor(utils): extract formatters and Hijri system from app.js (EXTRACTION-003, BRIDGE-003)` |
| **الأصل** | `frontend/app/js/app.js` (سطرا `uid` + `esc..fDT` بعد استخراج i18n) — 138 سطرًا |
| **الوجهة** | `frontend/app/js/core/utils.js` (new, ESM) + جسر في `js/main.js` |
| **المحرَّك** | `uid, esc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT` — **byte-identical مُتحقق (7,251 حرفًا)** |
| **الجسر** | BRIDGE-003: 16 binding على window |
| **تحليل ساكن قبل النقل** | فحص المعرفات الحرة للكتلة: صفر مراجع غير مضمونة (كلها خصائص/نصوص قوالب + `Intl` builtin + `STATE` من window) |
| **إصلاح أثناء التنفيذ** | سطر `uid` تكرر مؤقتًا (بقي في app.js أثناء النقل) — أُزيل فورًا؛ لا ازدواجية مصدر |
| **index.html / sw.js** | `?v=4.7.120` + `CACHE_VERSION 4.7.15` + `core/utils.js` في precache |
| **تبقى في قسم UTILS (عمدًا)** | `toast`, `cleanNotificationText`, `showLoad/hideLoad`, `destroyCharts`, `metricCard`, عنقود الإشعارات — لوحدات UI/notifications لاحقة |
| **التحقق** | `node --check` ✓ · فحص حي: `fN(1234567.891)='1,234,567.89'`، `fC(250)='250 SAR'`، `esc` يهرّب صحيحًا، `fD` بالعربية `٢٧ سبتمبر ٢٠٢٦`، **الهجري: `gregToHijriParts('2026-09-27')={1448,4,16}` (أم القرى عبر Intl)** ✓ · `today()` يُرجع تاريخ UTC — السلوك الأصلي حرفيًا ✓ · boot=dashboard ✓ |

---

## EXTRACTION-004 — ui/toast (toast + طبقة التحميل)

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-09-27 |
| **Commit** | `refactor(ui): extract toast and loading overlay from app.js (EXTRACTION-004, BRIDGE-004)` |
| **الأصل** | app.js: `toast` (سطر 256 بعد استخراج 003) + `showLoad/hideLoad` (266-267) + 3 سطور IIFE غير محمية (11305-11308) |
| **الوجهة** | `frontend/app/js/ui/toast.js` (new, ESM — أول وحدة في مجلد ui) + جسر في main.js |
| **الجسر** | BRIDGE-004: `window.toast`, `window.showLoad`, `window.hideLoad` — realtime.js مستهلك خارجي (window.toast ×11) |
| **اعتماد خارجي محفوظ** | `enhancedToast()` إعلان top-level في app.js (Enhancement Pack) — يُحل من window وقت النداء؛ `esc()` عبر BRIDGE-003 |
| **index.html / sw.js** | `?v=4.7.121` + `CACHE_VERSION 4.7.16` + `ui/toast.js` في precache |
| **التحقق** | node --check ✓ · فحص حي: الدوال الثلاث على window، **إطلاق toast حقيقي ظهر على الشاشة** (سلسلة كاملة: جسر → موديول → esc → enhancedToast)، boot=dashboard، socket حي ✓ |

---

## EXTRACTIONS 005–010 — الدفعة الكبيرة (العمود الفقري + أول وحدات المزايا)

| # | الوحدة | المحتوى المنقول (verbatim مُتحقق) | الجسر | ملاحظات خاصة |
|---|---|---|---|---|
| 005 | `core/state.js` | `STATE` (36 مفتاحًا) + `PERSISTED_ENTITIES` (24) + `ROLE_ENTITY_EXCLUSIONS` — 40 سطرًا | BRIDGE-005 | أُزيل `window.STATE=STATE` من الوحدة (تأثير جانبي وقت التقييم يناقض التصميم — الجسر في main.js) |
| 006 | `core/api.js` | `API_BASE` + `apiFetch` (50 سطرًا: مصادقة/مهلة 30ث/إعادة 429/دوران مفتاح) + `SERVER_CODE_AR` + `serverErrorInfo` — 74 سطرًا | BRIDGE-006 | **حسم قبل النقل:** `SERVER_CODE_AR` كان `const` غير مؤتمت العولمة — أُدرج في الوحدة وإلا انكسر جسر الأخطاء |
| 007 | `core/config.js` | `CONFIG` | BRIDGE-007 | `DB_NAME/DB_VERSION` ميتان (استخدامان = إعلانهما) — تُركا مكانهما |
| 009-أ | `core/config.js` (إضافة) | `ROLES` (11 سطرًا) | BRIDGE-007 | اكتُشف أثناء تدقيق 009: مستهلك من نطاق bulk-import — لو تُرك `const` في app.js لانكسر |
| 008 | `features/smart-card.js` | 704 أسطر: البطاقة الذكية (توليد بصمة رقمية/QR) + عنقود تقارير الحضور المطبوعة (مجمّعة تاريخيًا بين نفس البنرات) — 29 تصديرًا | BRIDGE-008 (Object.assign) | سطر التصديرات المجمّع (6 تصديرات) استُبدل بالكامل |
| 009 | `features/bulk-import.js` | 581 سطرًا: معالج الاستيراد الجماعي + التوليد التلقائي للمستخدمين — 25 تصديرًا | BRIDGE-009 | فشل تنفيذ أول بسبب مسار cwd خاطئ — أعيد من المسار الصحيح |
| 010 | `features/zkteco.js` | 467 سطرًا: صفحة أجهزة البصمة + الربط + السجل — 20 تصديرًا | BRIDGE-010 | `zkPortalPunchHandler` (عقد realtime) بقي في app.js — يستدعي دوال الوحدة عبر الجسر |

## الدرسان المعماريان من هذه الدفعة (مكتوبان كقواعد صلبة في main.js)

1. **ترتيب التقييم:** بعض عبارات النطاقات المنقولة كانت تُنفَّذ وقت تقييم app.js بعد وجود STATE — الاستيراد الساكن في main.js يقيّمها *قبل* الجسور → انهيار كامل. **الحل:** استيراد ديناميكي لوحدات features بعد تثبيت جسور العمود الفقري، مع top-level await يحافظ على ترتيب سكربتات defer.
2. **كسر الكاش شامل الإصدارات:** import specifier بلا `?v=` + كاش ذاكرة Chromium (لا Cache-Control من express.static) = وحدة قديمة صامتة → SyntaxError رسوم بيانية → شاشة دخول. **القاعدة:** كل specifier في main.js وكل وسم في index.html يتشاركان نفس `?v=` ويُرفع مع كل commit.

**إصلاحان إضافيان أثناء الفحص:** حذف `loadMyBiometricPanel` من قائمة تصديرات zkteco (ليست top-level في النطاق — كان ينزف الرسم البياني كله) · أداة `audits/extract-helper.js` (مراسي + تدقيق معرفات حرة + نقل بايتي) صُنعت لتوحيد بقية الاستخراجات.

## حالة ما بعد الدفعة (فحص حي شامل)

boot=dashboard ✓ · spine كامل ✓ · features كاملة ✓ · apiFetch نداء حقيقي ✓ · **صفحة البصمة ترسم من الموديول** (ZKSTATE.tab=devices، شارة "يعمل") ✓ · realtime حي (toast الأجهزة) ✓ · تسجيل الدخول والجلسة سليمان ✓
app.js: **10,038 سطرًا** (−2,315 من baseline) · 10 جسور موثقة · إصدار متزامن `4.7.131` / `CACHE_VERSION 4.7.25`

---

## EXTRACTIONS 011–015 — الصفحات الوزارية الكبرى

| # | الوحدة | الأسطر | التصديرات | ملاحظات |
|---|---|---|---|---|
| 011 | `features/employees.js` | 512 | 24 (acorn auto) | repoint أزال 9 تصديرات من سطر مجمّع؛ `switchPortalEmployee` بقى (خارج النطاق) |
| 012 | `features/warehouse.js` | 1,888 | 141 | يشمل الرفوف + الوزن + عنقود المشتريات (PCMT). `whCatFilter` (let مشترك مخزن/وزن) تحول لخاصية window — النمط المرجعي للفلاتر |
| 013 | `features/kitchen.js` | 1,118 | 151 | repoint أزال 55 تصديرًا من 5 أسطر مجمّعة |
| 014 | `features/finance.js` | 465 | 43→30 | 11 فلتر (revFilter*/expenseFilter*/costAnalysis*/pnlFrom/pnlTo) تحولت لخصائص window؛ إصلاح ازدواج window.window. وإعادة بناء قائمة التصدير من AST |
| 015 | `features/hr.js` | ~920 | 64 | لوحة HR + الحضور + الإجازات + أقسام HR + الرواتب؛ لا فلاتر تحتاج تحويلًا (معالجات دوال) |

**أداة جديدة:** `extract-helper.js` حصل على وضع move (تصديرات acorn الآلية) وrepoint (تنظيف سطور التصدير المجمعة).

**حادثة موثقة:** أثناء 012 اكتشف أن ترقية إصدارات index.html كانت no-op منذ 011 (sed بحث عن قيمة قديمة) — المتصفح ظل ينفذ مجموعة وحدات قديمة معطوبة. الحل: ضبط الوسوم صراحةً (4.7.133) ثم التحول لترقية بـ node مع تحقق مطبعي. **قاعدة جديدة:** الرفع بـ node + طباعة الوسوم الناتجة للتحقق.

**فحص ما بعد الدفعة:** boot ✓ · employees/warehouse/kitchen/finance/attendance صفحات تنقل وترسم من موديولاتها ✓ · فلاتر window سليمة ✓ · API ✓

app.js بعد الدفعة: **5,157 سطرًا** (−7,196 من baseline — أي ~58%)

---

## EXTRACTIONS 016–023 — الوحدات المعزولة + لوحة التحكم وبوابة الموظف

| # | الوحدة | الأسطر | التصديرات | ملاحظات |
|---|---|---|---|---|
| 016 | `features/yarasoft.js` | 782 | 56 (YSSTATE + صفحة الاستيراد الكاملة) | |
| 017 | `features/whatsapp.js` | 501 | 46 (WASTATE + محرك واتساب) | تبويب Oracle داخلها |
| 018 | `features/departments.js` | ~260 | 25 | |
| 019 | `features/reports.js` | ~667 | 21 | |
| 020 | `features/settings-users.js` | ~675 | 54 | |
| 021 | `features/cfo.js` | ~162 | 13 (CFO_STATE + الدفتر + الميزان) | |
| 022 | `features/dashboard.js` | ~308 | 10 | |
| 023 | `features/employee-portal.js` | ~155 | 5 (منها loadMyBiometricPanel وzkPortalIndicator — عقد البصمة) | ORADATA (حالة متصفح أوراكل) نُقلت إلى whatsapp — كان سينكسر وقت النداء |

**فحص ما بعد الدفعة:** تنقل حي لـ 12 صفحة كلها ok ✓ · 10 دوال مميزة لكل موديول على window ✓ · apiFetch ✓ · الرجوع للوحة ✓

app.js بعد الدفعة: **1,653 سطرًا** (−10,700 من baseline — أي ~87%)

**المتبقي في app.js:** STORAGE (initDatabase/fan-out) · AUTH & NAVIGATION (doLogin/refreshSession/go/buildNav/renderPage) · MODAL & RENDER PAGE · LOGIN GLOBALS IIFE · INITIALIZATION (boot) · ENHANCEMENT PACK — هذه **العمود الفقري الحرج** وستكون الجولة الختامية.

---

## EXTRACTIONS 024–027 — العمود الفقري الحرج (الجولة الختامية)

| # | الوحدة | التصديرات | ملاحظات |
|---|---|---|---|
| 024 | `ui/enhancement.js` | 23 (Enhancement Pack v10) | **مستمع DOMContentLoaded الخاص بالحزمة بقي في app.js** — للحفاظ على ترتيب الإقلاع حرفيًا (كان يُسجل بعد مستمع boot) |
| 025 | `core/storage.js` | 11 (initDatabase + fan-out + saveData/loadData + beforeunload beacon) | |
| 026 | `features/auth-navigation.js` | 35 (doLogin/doLogout/refreshSession/KARIM_RT*/enterApp/showForgotPasswordModal/toggleLang/toggleTheme...) | |
| 027 | `features/page-router.js` | 3 (showModal/closeModal/renderPage) | |

**قرار معماري موثق:** IIFE «exposeLoginCriticalGlobals» (390-461) أُبقي في app.js — مسؤوليتان مشروعتان: (1) كشف دوال الدخول قبل أي مسار فشل في الإقلاع، (2) ربط زر الدخول وحقول كلمة المرور بأحداث DOM. كل مراجعها غير المحمية أصبحت تُحل من window عبر جسور main.js (نفس القيمة — تعيينات لا تضر).

**حادثة توثيق:** فشلت محاولات الدخول عبر الواجهة في الاختبار الأخير — السبب **محدد معدل المصادقة (10 محاولات/15 دقيقة لكل IP+مستخدم)** استُهلك من اختبارات الترحيل نفسها (401s الفاشلة تُحسب عمدًا كإشارة هجوم). الوحدة نفسها مُثبتة: استدعاء doLogin مباشر نجح (jwt + مدير النظام). النافذة تُصفَّر تلقائيًا.

**app.js الختامي:** ~600 سطر (إقلاع + IIFE + غراء التحسينات + مؤشرات) — بقي ENHANCEMENT DOMC وboot لضمان الترتيب الحرفي.

---

## DATA RECOVERY — استعادة بيانات التشغيل (26-27 سبتمبر)

**البلاغ من المالك:** «رابط بالبصمة وقواعد ياراسوفت و5 كاشيرية والموظفين — فين راحو؟ السستم فاضي»

### التشخيص
- الترحيل ESM **واجهة فقط** — لم يلمس قاعدة البيانات ولا السيرفر.
- قاعدة `karim_erp` الحالية على PostgreSQL المثبت (15MB) خالية من البيانات التشغيلية (employees=0، devices=0، yarasoft=0، users=9 نظام فقط).
- السبب: عملية **استعادة سابقة يوم 26 سبتمبر 23:59** (قبل جلستنا) أعادت بناء القاعدة من هيكل قديم — النسخة المسبقة لها (356KB) تحفظ الحالة الفاضية. بيانات المالك كانت في النسخ الاحتياطية القديمة (Docker volume أُزيل مع Docker Desktop).
- الاسم المجمّع «14569» = أرقام الكاشير في فواتير يارسوفت المستوردة (جداول ora_*).

### الاستعادة (من `karim-karim_erp-2026-09-21T12-23-11.sql` — 487MB، أحدث نسخة كاملة)
1. استعادة إلى قاعدة مؤقتة `karim_erp_restore_tmp` والتحقق من المحتوى قبل اللمس.
2. مزامنة السكيما (60+ جدول ora_* ناقص + أعمدة) عبر `audits/schema-sync.js`.
3. تفريغ جداول التشغيل مع الإبقاء على `settings` ثم استيراد data-only بـ `session_replication_role=replica` في معاملة واحدة.
4. إعادة تثبيت باسورد الأدمن عبر آلية ADMIN-PIN.

### النتيجة (مُتحقق منها في القاعدة والواجهة)
| البيان | العدد |
|---|---|
| الموظفون | 130 |
| المستخدمون | 139 |
| أجهزة البصمة | 1 («بصمه العمل» 192.168.1.202 — متصل ويعمل) |
| روابط بصمة الموظفين | 151 |
| سجلات الحضور | 1,451 |
| إجمالي البصمات المرتبطة | 50,952 (مزامنة حية بعد التشغيل) |
| أقسام | 15 |
| فواتير يارسوفت (ora_cc_bill_enter3) | 443,600 |
| خرائط إيراد يارسوفت | 23 |

**الإعدادات الحية محفوظة:** باسورد الأدمن `Admin@2026` (آلية ADMIN-PIN) · إعدادات النظام (settings) · اتصال يارسوفت Oracle في `.env` — الكاشير يعاد سحبهم لايف من يارسوفت عبر المزامنة.

**نسخ الأمان:** الحالة الفاضية قبل الاستعادة محفوظة في `pre-restore-2026-09-26T23-59-15.sql` · ملف الاستعادة نفسه باقٍ في `database/backups/recovery-data-20260921.sql` (487MB) · القاعدة المؤقتة `karim_erp_restore_tmp` قابلة للحذف.

---
