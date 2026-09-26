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

## EXTRACTION-002 — (التالي المخطط: core/i18n — لم يُنفذ بعد)
