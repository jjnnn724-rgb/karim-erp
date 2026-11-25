# تقرير فحص شامل — Karim ERP
**التاريخ:** 2026-11-25 · **النطاق:** `C:\Users\DELL\Desktop\k` (كل النسخ + الـ repo الحقيقي)
**المنهج:** قراءة كود + تشغيل اختبارات فعلي + مراجعة سجلات/تقارير موجودة. لا تعديل على الكود.

---

## 1) الحكم النهائي

### التقييم: **5.0 / 10** (واقعي، مش مجاملة)

| المحور | الدرجة | الوزن | السبب المختصر |
|---|---|---|---|
| غنى المزايا والمعمارية | 7.0 | 20% | 70–81 شاشة، ~540 مسار API، POS/مخازن/HR/محاسبة/ZATCA حقيقية |
| سلامة البيانات والمحاسبة | 4.5 | 20% | NUMERIC سليم، لكن تدقيق محاسبي مستقل = **3.1/10**، idempotency عشوائي، عزل فروع fail-open |
| الأمان | 4.0 | 20% | أسرار على القرص، كلمات مرور ثابتة، API_KEY اختياري، ZATCA ببيانات تجريبية؛ في المقابل لا SQL injection ولا eval |
| الاختبارات والجودة | 5.0 | 15% | 274 ملف اختبار حقيقي، لكن **85 اختبار فاشل** في التشغيل الفعلي وفجوات تغطية كبيرة |
| CI والنشر | 6.0 | 15% | بوابات كثيرة + نشر يدوي بـ SHA-256، لكن خطوات `continue-on-error` وفجوة في سلسلة الإصدار |
| الحوكمة ونظافة المستودع | 2.0 | 10% | 5 نسخ مت divergence، root repo بصفر ملفات متتبعة، تقارير متناقضة، 1.1GB أرشيفات وملفات مؤقتة |

**الخلاصة:** المنتج غني شغال وله معمارية حقيقية، لكنه **غير جاهز كإنتاج آمن/منضبط**. المشكلة الأكبر مش في المزايا — المشكلة في الحوكمة وتضارب النسخ وغياب مصدر واحد للحقيقة.

---

## 2) أين المصدر الحقيقي؟ (أهم نتيجة)

- الـ repo الوحيد الذي له **Git history + remote** هو: `karim-erp-ci-release-fix` (v4.9.2، 1598 ملف متتبع، origin على GitHub، 15 فرع).
- **لكن** أحدث frontend (v3) **خارج Git تماماً** ومكرر في 5 أماكن:
  - `karim-erp-phase5-8\v3` → **70 مسار**
  - `karim-saas-staging-run\v3` → 70 مسار
  - `KARIM-ERP-PORTABLE\APP\v3`, `KARIM-ERP-TRIAL\APP\v3`, `karimabdelhamedeldsouky\...\karim-erp\v3` → **81 مسار** (11 ميزة إضافية: `/buffet`, `/bank-rec`, `/balance-sheet`, `/cash-flow`, `/command-center`, `/compliance-center`, `/employee-card`, `/dept-cost`, `/pos-reports`, `/ext-sales`, `/punch-control`)
- الـ root نفسه git repo بـ **0 commit / 0 ملف متتبع** وكل حاجة `??`.
- **النتيجة:** أحدث كود frontend غير محمي بإصدار، والنسخة "الأساسية" اللي اتدققت ليست الأحدث. ده أخطر خلل إداري في النظام.

---

## 3) الملاحظات الحرجة (تحتاج تدخل فوري)

| # | الخطورة | الملاحظة | الدليل |
|---|---|---|---|
| 1 | 🔴 حرجة | سكربت `reset-admin-pw.js` يزرع كلمة مرور ثابتة كـ fallback ويضبط `must_change_password=false` بلا حاجز إنتاج | `karim-erp-ci-release-fix\scripts\reset-admin-pw.js:7,18-25` |
| 2 | 🔴 حرجة | QR (TLV) + توقيع ECDSA يُولَّدان لكل بيع **دون فحص `ZATCA_ENABLED`**، ورقم ضريبي تجريبي كـ placeholder | `backend\cashier-module\complete-sale.js:959-975`, `zatca-vat.js:18,48` |
| 3 | 🔴 حرجة | أسرار حقيقية على القرص في 6+ ملفات `.env` (خارج Git) — JWT/DB/API keys/backup passphrase | `karim-erp-phase5-8\.env`، `karimabdelhamedeldsouky\...\karim-erp\.env` و `docker-deploy\.env` ونسخ backup |
| 4 | 🟠 عالية | خزنة كلمات المرور قابلة للفك ومفتاحها يسقط إلى JWT secret | `backend\password-vault.js:29-43` |
| 5 | 🟠 عالية | `GET /api/users/:id/password` يُرجع كلمة المرور مقروءة (لـ admin) | `backend\ops-inspect-routes.js:17-30` |
| 6 | 🟠 عالية | عزل الفروع fail-open ويغطي 5 كيانات فقط؛ v3 لا يرسل `x-branch-id` أصلاً | `backend\branch-context.js:4-9,60-82` |
| 7 | 🟠 عالية | `API_KEY` اختياري — لو فاضي يُتخطّى الـ middleware بالكامل | `backend\server.js:494-501` |
| 8 | 🟠 عالية | مفاتيح idempotency تُولَّد عشوائياً في كل طلب → إعادة المحاولة تكرر الحركة | `v3\apps\web\src\lib\api.ts:58-73`, `inventory-write.ts:172,226,246,338` |
| 9 | 🟠 عالية | تدقيق محاسبي مستقل قيّم الوحدة **3.1/10**: قيود بلا سند، ترقيم `MAX+1`، فجوة 2.25M في قيد واحد، تحويل 13,447.47 بلا reversal | `PHASE0-ACCOUNTING-AUDIT-2026-11-06.md`, `A5_REPORT.md` |
| 10 | 🟡 متوسطة | توكنات الجلسة في `localStorage` + بوابة مصادقة عميلة فقط (لا `beforeLoad`) | `v3\...\lib\auth.ts:16-20,598-604`, `routes\routes.tsx` |
| 11 | 🟡 متوسطة | بث realtime غير مصادَق افتراضياً (`RT_REQUIRE_AUTH=false`) وCORS `*` خارج الإنتاج | `backend\realtime\guard.js:12-14`, `server.js:155-163` |
| 12 | 🟡 متوسطة | تفعيل كتابة محاسبية/HR بـ query param أو `localStorage` من المتصفح بلا تحقق صلاحية | `v3\...\lib\warehouse-gov.ts:301-316`, `hr-departments.ts:127-142` |
| 13 | 🟡 متوسطة | `rejectUnauthorized:false` في الـ proxy وفي 8+ سكربتات backend | `v3\serve.mjs:37`, `backend\ai-assistant\tools.js:168` … |
| 14 | 🟡 متوسطة | 188 ملف SQL بأرقام مكررة (`067/067a`, `089`×2, `097`×2, `154`×2) → غموض ترتيب التطبيق؛ RLS على 7 جداول POS فقط | `database\migrations\` |
| 15 | 🟡 متوسطة | تقارير تدقيق متناقضة: `SUMMARY.md` says 41 متبقية، `ISSUES.md` في نفس المجلد says صفر متبقٍ؛ تقارير قديمة تدّعي 0 فشل مقابل 37 فاشل موثّق | `audit-results\SUMMARY.md` مقابل `ISSUES.md`، `audit\quality.md` |
| 16 | 🟡 متوسطة | سلسلة الإصدار لا تعتمد على unit/integration tests؛ `integration-tests` لا يعمل على push main | `.github\workflows\ci.yml` |
| 17 | 🟡 متوسطة | بوابات `continue-on-error`: format، frontend-version، audit عند انقطاع endpoint | `.github\workflows\ci.yml:82-85` وغيرها |
| 18 | 🟡 متوسطة | ZATCA: worker يرسل UBL لكنه لا يستخدم توقيع `zatca-signer` ولا CSID كتوقيع طلب؛ لا HSM/KMS | `zatca-worker.js:195-199` مقابل `393-399` |

---

## 4) نتائج الاختبارات الفعلية (مش تقدير)

### الـ repo الحقيقي (Jest)
```
Test Suites: 18 failed, 256 passed, 274 total
Tests:       85 failed, 8 todo, 3882 passed, 3975 total
Time:        134.5s
```
السبب المباشر للفشل في هذه البيئة: لا توجد قاعدة `karim_erp_test` مهيأة — `SASL: client password must be a string`. يعني لازم تجهيز بيئة test قبل أي حكم نهائي على الكود.

### v3 (Vitest — من سجل موجود، لنسخة **مجاورة** مش نفس الشجرة)
```
Test Files: 1 failed | 184 passed (185)
Tests:      1 failed | 1354 passed (1355)
الفشل: DesignGallery.test.tsx — timeout 5000ms
```
تحذير: السجل من `karimabdelhamedeldsouky\...\v3`، و17 ملف اختبار حالي غير موجود فيه ⇒ **لا يثبت نجاح النسخة اللي اتدققت**.

### إيجابيات مثبتة
- `packages/shared` coverage: lines/statements **99.12%**، functions **100%**، branches **97.08%** (فوق عتبة 90%).
- TypeScript `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` في v3.
- لا `any` صريح في `v3\apps\web\src`، لا `eval`/`new Function` في backend، لا SQL injection صريح، كلمات المرور bcrypt cost 12.
- `.gitignore` يغطي `.env` و`node_modules` والمفاتيح الخاصة في الـ repo الحقيقي.
- النشر يدوي بموافقة + manifest + SHA-256 (مقصود وموثّق).

### فجوات changelog
- **21** وحدة backend بلا أي اختبار (منها `accounting-periods`, `permission-routes`, `password-vault`, `unit-conversion`…).
- **190** وحدة frontend من 405 بلا ملف اختبار بنفس الاسم، و142 غائبة تماماً عن الاختبارات.
- عتبات coverage في Jest منخفضة: stmts 28% / lines 29% / funcs 30% / branches 23%.
- ZATCA عليه اختبارات جزئية فقط بلا وحدة اختبار مخصّصة.

---

## 5) اللي اتنفّذ فعلاً بعد الفحص

1. ✅ `WORKSPACE-MAP.md` — خريطة كل مجلد والمصدر الحقيقي.
2. ✅ `.gitignore` في الجذر — يمنع إضافة node_modules/الأرشيفات/اللوجات بالغلط.
3. ✅ عزل 26 ملف مؤقت/فارغ في `_quarantine-2026-11-25\` مع README للرجوع. (ملفان باسم غريب ` ' ` لسه في الجذر — 0 بايت، Windows ما سمحش بنقلهم.)
4. ✅ **النسخة المعتمدة اختارت بالدليل:** `KARIM-ERP-PORTABLE\APP\v3` (81 مسار، مطابقة تقريباً لنسخة الإنتاج، نظيفة من `.mimosa`). اتنسخ داخل `karim-erp-ci-release-fix\v3` (1164 ملف / 19.32MB، غير متتبعة لحد ما تعمل commit).
5. ✅ `MERGE-PENDING.md` داخل v3 يسجّل **286 ملف أحدث** + **10 ملفات موجودة فقط** في `karim-erp-phase5-8` — محتاجة مراجعة قبل الدمج، ما حصلش دمج آلي لأن النسختين مش سابقة/لاحقة لبعض (كل واحدة فيها حاجات مش عند التانية).
6. ✅ حذفت الأرشيفات الثلاثة (1.1GB) بأمرك الصريح، مع `DELETION-LOG-2026-11-25.md`. المجلدات المستخرجة و`backups` سليمة.
7. ✅ الـ `.git` الفاضي في الجزر اتنقل لـ `_quarantine-2026-11-25/root-git-backup/.git` (قابل للرجوع) — الجذر لم يعد repo، والمعتمد هو `karim-erp-ci-release-fix`.

---

## 6) لسه محتاج قرارك

1. **دمج تعديلات `phase5-8`:** 286 ملف أحدث (UI primitives، Shell، Workbenches، auth.ts/api.ts). محتاج مراجعة ملف-بملف — أبدأ بالأهم (`auth.ts`, `api.ts`, `Shell.tsx`) ولا سيبها معلّقة؟
2. **عمل commit للـ v3 داخل repo الحقيقي** عشان يبقى محمي بالإصدار.
3. **تدوير الأسرار** في ملفات `.env` على القرص — محتاج تحدد مين يملك القيم الجديدة.
4. **إصلاح مشاكل الأمان الحرجة** (كلمة admin الثابتة، ZATCA placeholder، عزل الفروع) — لازم أولوية منك قبل أي نشر.

---

## 7) ملحق: تكرار إضافي اكتُشف بعد التقرير
- `karim-saas-staging-run\frontend\v3\assets\` فيه **6 أجيال** من نفس حزم JS المبنية بأhash مختلفة (Select-*, Sessions.lazy-*, Settings.lazy-*, Warehouse.lazy-* …) + نسخة `dist` كاملة (~100 ملف) في `karim-saas-staging-run\v3\apps\web\dist`. مخرجات بناء قديمة متراكمة — مش كود مصدر.
- `karim-saas-staging-run\scripts\` ~130 سكربت و`tests\` ~250 ملف، مقابل سكربت واحد في `phase5-8\v3\scripts` — الاختلاف بين النسخ مش في المسارات بس، بل في حجم الأدوات كمان.
- مجلدات `backend\v3` و`frontend\v3` موجودة داخل `karim-erp-phase5-8` و`karim-saas-staging-run` (التقارير القديمة كانت تشير لمسارات `/app/v3.html`) — لم تُفحص سطر-بسطر، لكنها تُضيف طبقة تكرار أخرى.
- عشرات سكربتات `tmp-*.js` / `*.tmp.cjs` موزّعة على النسخ (الجذر اتعزل منه 26، والباقي في النسخ).

---

*ملاحظة: كل المسارات相对 لمجلد العمل `C:\Users\DELL\Desktop\k`. لم يُعدَّل أي كود مصدر، ولم يُنفَّذ أي أمر SQL. الأرشيفات حُذفت بأمر صريح منك، وكل الباقي منقول لمجلد عزل قابل للرجوع.*
