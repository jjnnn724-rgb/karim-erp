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

## EXTRACTION-003 — (التالي المخطط: core/utils — esc/today/nowTime/fN/fC/fD/fDT/metricCard + الهجري — لم يُنفذ بعد)
