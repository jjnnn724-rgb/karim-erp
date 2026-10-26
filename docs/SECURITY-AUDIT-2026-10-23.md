# تقرير فحص أمني — Karim ERP

**التاريخ:** 2026‑10‑23 · **النطاق:** المستودع المحلي + إعدادات الخدمة الحيّة على `127.0.0.1:5000` + قراءة فقط لقاعدة البيانات
**المنهج:** مراجعة كود وتكوين، بوابات المشروع (`check-secrets`, `security-route-audit`, `npm audit`)، فحص رؤوس HTTP/CORS على الخدمة الحيّة. **لم يُجرَ** اختبار اختراق أو هجوم فعلي، ولم تُنفَّذ أي كتابة في قاعدة البيانات.
**حدود:** لا يثبت التقرير خلوّ النظام من الثغرات؛ يثبت حالة الضوابط المفحوصة في هذه اللحظة.

---

## ١. الملخص التنفيذي

ضوابط طبقة التطبيق **أقوى من المتوسط**: رؤوس أمان كاملة، CSP بصلاحية nonce و`script-src-attr 'none'`، CORS مقيّد فعليًا، تحديد معدل وقفل دخول، `bcrypt` وحده، سجل تدقيق append-only، نسخ مشفّرة مع تحقق SHA‑256، وتبعيات إنتاج بلا ثغرات معروفة. هذه ليست سمعة مستندات؛ فُحصت حيًّا.

الفجوة الحقيقية **ليست في الكود بل في دورة حياة الأسرار وحيازة النسخ ونافذة اختطاف الحساب**:

| الخطورة | العدد | الخلاصة |
|---|---|---|
| عالية | 4 | أسرار في تاريخ Git محلي · `.env` نص صريح داخل النسخ · صلاحيات مجلد النسخ · جلسة V2 لا تُبطل عند الخروج وعمر تجديد 365 يومًا |
| متوسطة | 8 | غياب MFA · سياسة كلمة مرور دنيا · عمر access 24 ساعة · مفتاح API ثابت · تدقيق غير مقاوم للتلاعب · CI/Dependabot · CORS fallback · مفتاح التشفير مع النسخ |
| منخفضة | 5 | CSP واسع الاتصال · سجل غير مخفي الحقول كلها · صور عامة · لا دليل استعادة · تحذير CORS لا يمنع الإقلاع |

**التقييم الأمني الحالي: 6/10** — قويّ في بناء التطبيق، ضعيف في إدارة الهوية والأسرار والاحتفاظ. الأربعة العالية قابلة للإغلاق في **48 ساعة** بلا أي إعادة كتابة.

---

## ٢. النتائج — خطورة عالية

### H‑1 · أسرار حقيقية داخل تاريخ Git المحلي
**الدليل:** الالتزام `8e71c05` أضاف ملفين `‎.env.preflight-backup-…` و`‎.env.example.audit-backup-…` يحتويان قيمًا غير فارغة لـ`DB_PASSWORD` و`JWT_ACCESS_SECRET` و`JWT_REFRESH_SECRET` و`EMPLOYEE_QR_SECRET` (فُحصت أسماء المفاتيح فقط، دون طباعة القيم). `git branch -r --contains 8e71c05` = فارغ، أي **غير مدفوع للريموت حاليًا**.
**الأثر:** أي دفع كامل للتاريخ، أو نسخة مستنسخة من المستودع، أو أرشيف `.git` منسوخ خارج الجهاز ⇒ تسريب مباشر لمفاتيح توقيع كل الجلسات.
**الإصلاح:** (١) تدوير الأسرار الأربعة فورًا وكل ما كان في الملف، (٢) تطهير التاريخ بـ`git filter-repo` **قبل** أي دفع كامل، (٣) إبقاء سياسة «لقطة جديدة على `main`» حتى يكتمل التطهير.

### H‑2 · ملفات `.env` بنص صريح داخل مجلد النسخ
**الدليل:** 8 ملفات `*.sql.env` في `database/backups/` (من 2026‑09‑17 إلى 2026‑10‑20) تحمل كلمة مرور القاعدة وكلمة مرور المدير الأولية. النسخ نفسها مشفّرة `.gpg/.kbak`، لكن هذه الملفات الجانبية **غير مشفّرة**.
**الأثر:** التشفير بلا قيمة إذا وُجدت نسخة نصّية للمفاتيح بجانبه.
**الإصلاح:** حذف آمن (shred) بعد التحقق من عدم لزومها للاستعادة، ومنع توليدها مستقبلًا في `database/scripts/backup.js`، والاحتفاظ ببيانات الاستعادة في خزنة منفصلة.

### H‑3 · صلاحيات مجلد النسخ تسمح لأي مستخدم محلي بالتعديل
**الدليل:** `icacls database/backups` ⇒ `BUILTIN\Users:(OI)(CI)(M)`.
**الأثر:** أي جلسة محلية (أو برمجية خبيثة بأي حساب مستخدم) تستطيع حذف أو تلف النسخ — التشفير لا يحمي من الحذف.
**الإصلاح:** إزالة `Users` والسماح لـ`Administrators` و`SYSTEM` (وحساب الخدمة قراءةً فقط إن احتاج)، وتطبيق المبدأ نفسه على `D:/KarimBackups` و`E:/KarimBackups`.

### H‑4 · الخروج في V2 لا يُبطل جلسة التجديد، وعمرها سنة
**الدليل:** `ACCESS_TTL = '24h'` ([jwt-middleware.js:66](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/cashier-module/jwt-middleware.js#L66))، والافتراضي `365` يومًا للتجديد ([jwt-middleware.js:69](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/cashier-module/jwt-middleware.js#L69)) بلا تجاوز في `.env`. الواجهة القديمة تنادي `/api/auth/logout` ([auth-navigation.js:224](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/frontend/app/js/features/auth-navigation.js#L224))، أما V2 فتعريف `doLogout` محليًا يمسح الرمز من الذاكرة فقط ([session.js:109](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/frontend/app/js/v2/session.js#L109)) دون نداء الخادم.
**الأثر:** رمز تجديد مسروق (من جهاز مشترك أو نسخة احتياطية للمتصفح) يظل صالحًا حتى سنة، والخروج الواعي لا يقطعه.
**الإصلاح:** نداء `/api/auth/logout` من V2، تقصير `JWT_REFRESH_DAYS` إلى 30، وشاشة «الجلسات» لإبطال جهاز بعينه.

---

## ٣. النتائج — خطورة متوسطة

| # | النتيجة | الدليل | الإصلاح |
|---|---|---|---|
| M‑1 | لا مصادقة ثانية للأدوار الإدارية؛ خدمة التحكم تشارك كلمة المرور نفسها | لا وجود لـTOTP في `package.json` أو `backend` | TOTP إلزامي لـadmin/owner/manager/accountant + رموز احتياطية |
| M‑2 | سياسة كلمة المرور: 8 أحرف + حرف + رقم فقط | [jwt-middleware.js:87](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/cashier-module/jwt-middleware.js#L87) | 12+ حرفًا، رفض كلمات breache، ومنع إعادة آخر 5 |
| M‑3 | access token 24 ساعة ويُخزَّن في `localStorage` | `ACCESS_TTL` + `window._jwt` | 30–60 دقيقة + تجديد صامت؛ يقلّل أثر أي XSS متبقٍ |
| M‑4 | `API_KEY` ثابت مشترك ويُعاد ضمن استجابة الدخول، والطبقة تُعطَّل إن فُرّغ | [server.js:488](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/server.js#L488) (مضبوط حاليًا، طول 43) | تدوير دوري + عدم إرجاعه في الاستجابة + جعله إلزاميًا في الإنتاج |
| M‑5 | سجل التدقيق append-only لكنه غير مقاوم للتلاعب حسابيًّا | [003_cashier_module.sql:291](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/database/migrations/003_cashier_module.sql#L291) | سلسلة hash لكل سطر + ختم يومي خارجي |
| M‑6 | CI لا يعمل على فرع العمل، ولا Dependabot، والإجراءات مثبّتة بوسم لا SHA | [ci.yml:4](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/.github/workflows/ci.yml#L4) | PR إلزامي إلى `main` + حماية فرع + Dependabot أسبوعي + تثبيت SHA |
| M‑7 | في الكود: غياب `ALLOWED_ORIGINS` يعني `*` | [server.js:155](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/server.js#L155) | رفض الإقلاع في الإنتاج إن لم تُضبط |
| M‑8 | مفتاح تشفير النسخ في `.env` على المضيف نفسه | `KARIM_BACKUP_PASSPHRASE` | مفتاح في خزنة/جهاز منفصل، والمرآة بمفاتيح مستقلة |

---

## ٤. النتائج — خطورة منخفضة

1. **CSP:** `connect-src http: https:` يسمح بأي وجهة اتصال (مع بقاء `script-src` مقيدًا) و`style-src 'unsafe-inline'` — قيود الواجهة القديمة؛ يمكن تضييق `connect-src` على النطاقات الفعلية لـV2 أولًا.
2. **إخفاء السجلات:** `redact` يغطي authorization/password/token/secret لكن ليس `refresh_token` ولا `x-api-key` ([logger.js:113](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/logger.js#L113)).
3. **`/uploads`:** الصور عامة بالتصميم ([server.js:2641](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/server.js#L2641)) — يجب التأكد أن مستندات الموظفين لا تُحفظ بامتداد صورة.
4. **الاستعادة:** لا دليل موثّق على تمرين استعادة مع RTO/RPO، رغم وجود `database/scripts/restore.js`.
5. **تحذير CORS** يُسجَّل ولا يوقف الإقلاع — مقبول في LAN، خطر عند نشر عام.

---

## ٥. ما نجح فعليًا (مُتحقَّق، لا مفترض)

- **أسرار المتتبَّع:** `check-secrets` = **0**. `npm audit --omit=dev` = **0** ثغرات (منخفضة/متوسطة/عالية/حرجة).
- **رؤوس الأمان الحيّة:** CSP بـnonce، `script-src-attr 'none'`، `frame-ancestors 'none'`، HSTS، `nosniff`، Permissions‑Policy، `Server: KarimERP` بلا نسخة Node.
- **CORS حيّ:** طلب من أصل خارجي `https://evil.example` لم يُرجِع `Access-Control-Allow-Origin` إطلاقًا.
- **المصادقة:** `bcrypt` فقط، رفض أسرار placeholder، قفل مؤقت بعد محاولات فاشلة، `authLimiter` على الدخول/التجديد، تدوير رمز التجديد وحفظه مُهشَّرًا.
- **الصلاحيات:** `security-route-audit` — **236/259** مسار كتابة محمي بدور صريح. الأحد عشر «بلا مصادقة» فُحصت يدويًا: كلها محمية في طبقة الراوتر أو بوابات محلية (مثال `receiveGate` في [`veg-requests-routes.js:181`](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/veg-requests-routes.js#L181))، أو webhook بتوكن جهاز. **لا ثغرة سلطة مفتوحة.**
- **النسخ:** تشفير `.gpg/.kbak` + تحقق SHA‑256 قبل المرآة، ورفض المرآة لأي ملف نصّي ([backup-mirror.js:96](file:///C:/Users/DELL/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/scripts/backup-mirror.js#L96)).
- **الرفع:** فحص البصمة السحرية للصور (PNG/JPEG/WEBP)، حد 5MB، ورفع النسخ محصور بـadmin وامتداد `.sql`.
- **خدمة التحكم:** محلية فقط، جلسة admin، CSRF token، مقارنة بزمن ثابت، وتحقق Host/CF‑Ray.
- **الواجهة القديمة** تنادي إبطال جلسات الخادم عند الخروج.

---

## ٦. خطة الإغلاق

**خلال 48 ساعة (بلا كود ولا إعادة تشغيل):**
1. تدوير `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `EMPLOYEE_QR_SECRET`, `DB_PASSWORD`, `API_KEY`, وكلمة مرور المدير.
2. shred لملفات `*.sql.env` الثمانية، ثم تعديل `backup.js` لمنع توليدها.
3. `icacls` لتقييد `database/backups` و`D:/KarimBackups` و`E:/KarimBackups`.
4. تطهير تاريخ Git من `8e71c05` قبل أي دفع كامل.

**خلال أسبوعين:**
5. V2 ينادي `/api/auth/logout`؛ `JWT_REFRESH_DAYS=30`؛ شاشة جلسات وإبطال.
6. TOTP للأدوار الإدارية (إلزامي، مع رموز احتياطية).
7. سياسة كلمة مرور 12+ حرفًا ورفض الكلمات الشائعة.
8. CI على PR فقط، Dependabot، تثبيت الإجراءات بـSHA، وحماية `main`.

**خلال 30 يومًا:**
9. سلسلة hash لسجل التدقيق + ختم يومي خارجي.
10. عمر access 30–60 دقيقة وتجديد صامت.
11. مفتاح التشفير خارج `.env` + تدوير ومفتاح مستقل للمرآة.
12. تمرين استعادة موثّق: RPO ≤ 15 دقيقة، RTO ≤ 60 دقيقة.

**خلال 90 يومًا:**
13. اختبار اختراق خارجي مستقل.
14. مراجعة أذونات قاعدة البيانات بأثر فعلي (`104_app_role_least_privilege.sql` مُطبَّق ومُقاس).
15. خطة استجابة للحوادث واتصال أسرار بمخزن مركزي.

**مؤشرات القبول:** صفر سرّ بنص صريح خارج الخزنة · زمن جلسة مسروقة ≤ 30 يومًا وقابل للإبطال · استعادة مُختبرة شهريًا · CI أخضر إلزامي على كل دمج · لا نتائج عالية في اختبار الاختراق.

---

*هذا التقرير قراءة فقط؛ لم يُعدَّل أي ملف إنتاجي ولم تُطلب فيه موافقة على إعادة تشغيل الخدمة أو تدوير الأسرار — الخطوة التالية قرار المالك.*
