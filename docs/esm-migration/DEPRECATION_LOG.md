# DEPRECATION_LOG — سجل الجسور المؤقتة (Compatibility Bridges)

القاعدة: كل جسر `window.*` مؤقت. لا يُحذف إلا بعد انتقال جميع مستهلكاته وتوثيق ذلك.
إزالة الجسر = commit مستقل بعدد مستهلكين صفر مُتحقق منه آليًا.

| ID | الجسر (window.*) | الموديول | المستهلكون المعروفون (مُتحقق آليًا) | معيار الإزالة | الموعد المستهدف |
|---|---|---|---|---|---|
| BRIDGE-001 | `pwaInstall` | `js/core/pwa.js` | index.html:148 `onclick="pwaInstall()"` | انتقال index.html للتحميل عبر module entry (نهاية P3.6) | P3.6 |
| BRIDGE-001 | `pwaUpdateOfflineBar` | `js/core/pwa.js` | app.js boot (نداء واحد bare — يُحل من window)؛ IIFE سابقًا | إعادة توجيه نداء app.js لاستيراد مباشر عند تفكيك boot | P3.6 |
| BRIDGE-002 | `I18N`, `t`, `readLangLocal`, `persistLangLocal`, `ROLE_NAMES`, `MENU_STRINGS`, `applyI18nMaps`, `applyLangAttrs`, `applyLoginI18n` | `js/core/i18n.js` | app.js فقط (مراجع bare: t ×مئات، applyLangAttrs ×5، وغيرها — `audits/inline-handlers.json`)؛ لا مستهلكين خارجيين | استبدال المراجع bare باستيرادات مباشرة عند تفكيك app.js لوحدات | P3.6 |
| BRIDGE-003 | `uid`, `esc`, `today`, `nowTime`, `fN`, `fC`, `fD`, `fHijri`, `HIJRI_MONTHS`, `gregToHijriParts`, `hijriToGregorian`, `hijriDateField`, `toggleDateMode`, `syncGregToHijri`, `syncHijriToGreg`, `fDT` | `js/core/utils.js` | app.js (مراجع bare ×مئات — esc/fN/fD في كل قوالب الصفحات)؛ `toggleDateMode`/`syncGregToHijri`/`syncHijriToGreg` مستهلكة من inline handlers (`audits/inline-handlers.json`)؛ لا مستهلكين خارجيين لغير app.js | استبدال المراجع bare عند تفكيك app.js | P3.6 |
| BRIDGE-002+ | (كل جسر استخراج لاحق يُسجل هنا بنفس البنية) | | | | |
| — | جسور 415 دالة auto-global المستهلكة من onclick strings | سيُولَّد `bridges/window-exports.js` آليًا من `audits/inline-handlers.json` عند P3.3+ | 417 اسم مستهلك داخل templates + 12 في index.html | استبدال onclick strings بـ addEventListener بعد بناء طبقة events | P3.7 |
| — | عقد realtime.js الخمس (`STATE`, `toast`, `renderPage`, `zkPortalPunchHandler`, `_jwt`) | يبقى كجسر دائم إلى أن يُحوَّل realtime.js نفسه ESM | realtime.js (17/11/10/4/2 مرجع) | تحويل realtime.js لاستيراد مباشر | مرحلة لاحقة اختيارية |
| — | ملفات ميتة `pos.js`, `bilingual.js`, `pos-orders.js` | غير محمّلة إطلاقًا | لا شيء (لكن sw.js يعمل لها precache) | حذف من sw.js + الأرشيف بعد تأكيد المالك | P3.7 |
