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

## EXTRACTION-005 — (التالي المخطط: core/state + core/api — لم يُنفذ بعد)
