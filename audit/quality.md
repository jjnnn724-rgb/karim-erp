# تقرير مراجعة الصحة النوعية وصحة البناء — Karim ERP

- **التاريخ:** 2026-10-10
- **النطاق:** `tests/`، `jest.config.js`، `eslint.config.js`، `package.json`، `tsconfig*.json`، `build/`، `updates/`، `tools/`، `android/`، `electron/`، `common/` (نظرة عامة)
- **البيئة:** Node v20.19.0 / npm 10.8.2 / Windows
- **الوضع:** قراءة فقط (شغّلت فقط: `node --check`، `npx jest`، `npm test`، `npx eslint`، `npx prettier --check`، `npx tsc --noEmit`)

---

## ملخص تنفيذي (Top 10)

1. **فحص الصياغة نظيف تمامًا:** صفر أعطال `node --check` على **336 ملف** (backend 174 + frontend/app/js 49 + scripts + tools 336 إجمالًا). لا يوجد ملف JavaScript بنيته معطلة.
2. **حزمة الاختبارات مكسورة الآن:** ‏`npm test` يخرج برمز **1** — ‏84 حزمة اختبار: **75 ناجحة / 9 فاشلة**، و1164 اختبارًا: **1119 ناجحًا / 37 فاشلًا / 8 todo**. الـ CI (`unit-tests` job) سيفشل بنفس السبب.
3. **سبب جذري واحد يُفسِّر 5 حزم من الـ 9 الفاشلة:** ‏`ReferenceError: today is not defined` — الاختبارات تحمّل كود الواجهة عبر `new Function(...)` (harness في `tests/inventory-merge.test.js:14` وأخواتها) وتُمرّر له globals يدوية (`esc,fN,fC,t`)، بينما `frontend/app/js/features/warehouse.js` استخدم دالة عالمية جديدة `today()` (سطر 218/231/705/965) ولم يُحدَّث الـ harness. ‏`warehouse.js` عُدِّل 2026-10-09 والاختبارات 2026-10-05 → **انزياح بين المصدر والاختبار**.
4. **لا يوجد سكربت اسمه `lint`:** الموجود هو `test:lint` = ‏`npx eslint . --ext .js,.mjs` → **0 أخطاء / 1931 تحذيرًا** على 232 ملفًا (خروج 0). أعلى القواعد: `no-unused-vars` 1107، `no-empty` 485، `eqeqeq` 256، `curly` 61.
5. **بوابة التنسيق مكسورة (CI سيفشل):** ‏`npm run test:format` يخرج برمز **2** مع ‏~780 ملفًا غير منسّق، منها **148 ملفًا داخل `android/app/build/`** غير مغطاة بـ `.prettierignore`، إضافةً إلى خيار مُهمل في الإعداد: `.prettierrc.js:13` يحوي `ignorePath` وهو خيار CLI فقط → تحذير ‏"Ignored unknown option" عند كل تحميل للملف.
6. **‏TypeScript سليم:** ‏`tsc --noEmit` = ‏0 أخطاء في 10.8 ثانية. لكن الغطاء شكلي: `checkJs:false` في الإعداد الأساسي، و`tsconfig.strict.json` يضم ملفًا واحدًا فقط (`backend/punch-portal-logic.js`) رغم قاعدة النمو المكتوبة في `tsconfig.json` نفسها.
7. **انزياح التوثيق/السكربتات:** ‏3 سكربتات مفقودة تُستشهد في التوثيق: `build` (DISCOVERY_REPORT.md — ويقول كذلك إنها موجودة!)، `download-pg` (docs/ELECTRON-BUILD-GUIDE.md)، `audit:silent` (docs/ROADMAP-9.5.md). وسكربتات package.json الـ57 كلها تشير لملفات موجودة (فحصحتها).
8. **انزياح `.env` (بدون كشف القيم):** ‏6 مفاتيح فعّالة غير موثّقة في `.env.example`: `ATTENDANCE_SHIFT_DAY_MODE`, `DB_POOL_MAX`, `API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, **`KARIM_FIXED_ADMIN_PASSWORD`** (علم أحمر أمني)، ومفتاحان موثّقان فعّالا في المثال لكن مُعلَّقان في `.env`: `DB_MODE`, `CARD_VERIFY_BASE`. و`docker-deploy/.env` فعليًا يحوي `API_KEY` + `KARIM_FIXED_ADMIN_PASSWORD` داخل شجرة المشروع.
9. **مراجع بناء/نشر مكسورة أو قديمة:** ‏(أ) `package.json` ‏`build.files` يشير إلى `build/templates/**/*` و`build/AlShorfa-ERP-Setup.nsi` **غير موجودين** (‏build/ فيها الأيقونات فقط، 29/9). (ب) ‏`updates/` **مجلد فارغ** (آخر لمسة 28/9) بينما `backend/server.js` و`electron/main.js` يقدّمان `{SERVER}/updates/latest.yml` → مسار التحديث التلقائي بلا محتوى. (ج) ‏`docker-deploy/` يحوي `full-backup.sql` بحجم **470MB** (30/9) وملف `.bat` باسمه تالف الترميز. (د) ‏حذوفات ضخمة: `logs/` 595MB، ONNX models داخل `backend/` 311MB (تدخل حزمة electron عبر `backend/**/*`).
10. **ازدواجية التوثيق وتسرّب بيانات مؤقتة:** ‏18 ملف `.md` في الجذر (11 منها مؤرخة 29/9 وتحوي ادعاءات قديمة: `HANDOVER_REPORT.md` يقول ‏"64 حزمة / 932 اختبارًا / 0 فشل" بينما اليوم ‏84/1164/37 فاشلًا). إضافةً لملفات قذرة: `NUL` (‏39KB ومتزايد — أثر تحويل خرج إلى `NUL`)، `query`، `start`، `stop`، `{console.log(b.slice(0`، ونسختان مطبعيتان متطابقتان `INSTALL-PERMANENT-OFFLINE.bat` / `INSTALL-PERMENANT-OFFLINE.bat` (الصحيحة الأولى، والثانية خطأ إملائي)، و`tests/` يحوي 136 ملفًا منها سكربتات `survey*.ps1` و`diag-*.js` ليست اختبارات.

---

## نتائج الفحوص

### 1) Syntax sweep — `node --check`

| المجموعة | عدد الملفات | فاشلة |
|---|---|---|
| `backend/**/*.js` (recursive) | 174 | **0** |
| `frontend/app/js/**/*.js` | 49 | **0** |
| `scripts/**/*.{js,mjs}` | 78 | **0** |
| `tools/**/*.{js,mjs}` | 35 | **0** |
| **الإجمالي** | **336** | **0** |

**قائمة الملفات الفاشلة: لا شيء.** (ملاحظة: التنفيذ على Windows/PowerShell يستدعي `node --check` لكل ملف؛ لم يُفحص `electron/` ضمن هذا الطلب لكنه مُستبعد عن lint كذلك بقرار `eslint.config.js`.)

### 2) Test suite

- `npx jest --listTests` → **84 حزمة** (كلها داخل `tests/*.test.js`، مطابق لعدد ملفات `*.test.js`).
- التشغيل الكامل (`npx jest --silent --ci` و`npm test` مكرران لنفس النتيجة):

```
Test Suites: 9 failed, 75 passed, 84 total
Tests:       37 failed, 8 todo, 1119 passed, 1164 total
Time:        ~6–15 s          → npm test EXIT: 1
```

**الحزم الـ9 الفاشلة + السبب:**

| الحزمة | عدد الاختبارات الفاشلة | سبب أولي |
|---|---|---|
| `tests/warehouse-search-nojump.test.js` | 10 | `ReferenceError: today is not defined` (harness) |
| `tests/opening-balance-grid.test.js` | 6 | `ReferenceError: today is not defined` (harness) |
| `tests/opening-net-mode.test.js` | 6 | `TypeError: Cannot read ... (reading 'slice')` — نفس الجذر (`today()` تُستدعى داخل الكود المُقيَّم) |
| `tests/opening-excel-parse.test.js` | 6 | `ReferenceError: today is not defined` (harness) |
| `tests/inventory-merge.test.js` | 4 | `ReferenceError: today is not defined` (harness) |
| `tests/attendance-delay-engine.test.js` | 2 | فشل سلوكي: التأخير+الخروج المبكر (Expected 10 / Received 0) |
| `tests/dispatch-chain-guard.test.js` | 1 | `toContain` — نص رسالة/سلاسل الإرسال تغيّر |
| `tests/whatsapp-engine.test.js` | 1 | `toBe` — حساب عجز ساعات الوردية |
| `tests/dept-panel.test.js` | 1 | `toEqual` — استجابة/قالب تغيّر |

كما يظهر تحذير `Force exiting Jest: --detectOpenHandles` (مقبض مفتوح بعد انتهاء الاختبارات).

**التغطية مقابل المناطق الحرجة (عدّادات ملفات `tests/*.test.js`):**

| المنطقة | عدد ملفات الاختبار | الحالة |
|---|---|---|
| Attendance engine | 12 (`attendance-*`, `punch-*`, `shifts-*`, `monthly-attendance`, `zkteco-*`, `leave-chain`) | موجودة لكن **`attendance-delay-engine` فاشل** |
| Inventory | 7 (`stock-ledger`, `stocktaking*`, `inventory-merge`, `catch-weight`, `dispatch-stock-gate`, `warehouse-search-nojump`) | **2 فاشل** (`inventory-merge`, `warehouse-search-nojump`) |
| Dispatch | 3 (`dispatch-chain-guard`, `dispatch-stock-gate`, `kot`) | **1 فاشل** |
| Veg requests | 1 (`veg-requests` — يختبر `backend/veg-requests-logic` فقط) | ناجح، لكن **`veg-requests-routes.js` غير مُختبَر إطلاقًا** |
| Leave workflow | 1 (`leave-chain`) — يغطي `leave-workflow-routes` | ناجح (غطاء رفيع: ملف واحد) |

**صفر اختبار فعلي (moduless backend top-level لا يُشار إليها في أي اختبار — 21 من 59):**
`veg-requests-routes`, `inventory-transfer-routes`, `unit-conversion`, `attendance-portal-routes`, `permission-routes`, `accounting-periods`, `accounting-growth`, `budget-alerts`, `manager-briefing`, `menu-board-routes`, `cashier-monitor-routes`, `face-engine-v2`, `media-storage`, `password-vault`, `pw-crypto`, `pw-worker`, `riyadh-date`, `strict-audit-lib`, `submit-guard`, `system-routes`, `db-validation-middleware`.

> الخلاصة: لا توجد منطقة "صفر ملفات اختبار" من الخمس المطلوبة، لكن **مسارات HTTP (routes) للمخزون/التحويل/طلبات الخضار غير مغطاة**، و3 من الخمس تعاني اختبارات فاشلة الآن.

### 3) Lint / Format / Type

| الأمر | موجود؟ | النتيجة |
|---|---|---|
| `npm run lint` | **غير موجود** | — |
| `npm run test:lint` (وهو ما يشغّله CI) | نعم | **0 أخطاء / 1931 تحذيرًا**، 232 ملفًا، exit **0** |
| `npm run test:format` (prettier) | نعم | **exit 2** — ‏~780 ملفًا غير منسّق |
| `npm run typecheck` / `tsc --noEmit` | نعم | **0 أخطاء** (10.8 ثانية) |

**أعلى 5 قواعد في ESLint:**

| القاعدة | العدد | النوع |
|---|---|---|
| `no-unused-vars` | 1107 | warn |
| `no-empty` | 485 | warn |
| `eqeqeq` | 256 | warn |
| `curly` | 61 | warn |
| `no-useless-assignment` | 11 | warn |

(‏0 `error` — أي أن البوابة الحالية لا تُحجب على أي شيء، وكل التحذيرات "ديكور".)

**أكثر الملفات تحذيرًا:** `backend/whatsapp-engine/routes.js` (66)، `frontend/app/js/realtime.js` (64)، `frontend/app/js/features/mobile-shell.js` (62)، `backend/whatsapp-engine/genius.js` (56)، `backend/whatsapp-engine/answer.js` (54)، `backend/server.js` (51).

**توزيع ملفات Prettier غير المنسّقة حسب المجلد:** backend 174، tests 121، docs 96، scripts 74، frontend 71، tools 41، **android 148 (مخرجات build)**، logs 13، أخرى ~43.

### 4) Config health

- **package.json:** ‏`version 4.9.2`، ‏57 سكربتًا، `engines.node >=20.0.0` ⇐ الفعلي **v24.20.0 مطابق**. Electron 44.9.2 يضم Node 24.22.0 (تم التحقق بتشغيل تطبيق مؤقت)؛ إعداد `pkg.targets: node18-win-x64` ميت/قديم ولا يستخدمه مسار بناء Electron المعتمد. كل مدخلات السكربتات تشير لملفات موجودة (لا سكربت مكسور).
- **سكربتات مفقودة تُستشهد في التوثيق:** `build`، `download-pg`، `audit:silent`.
- **معاملات (dependencies) مشبوهة:** `html5-qrcode` و`chart.js` مُصرَّحان في npm لكن الصفحة تحمّل نسخ vendor (`frontend/app/vendor/html5-qrcode.min.js`, `chart.umd.min.js`) ولا يوجد `require('chart.js')`/`html5-qrcode` في أي كود → **معاملات مكررة/غير مستخدمة**. `@capacitor/*` + `@aparajita/capacitor-biometric-auth` تُستخدم عبر Android/Capacitor فقط (لا استدعاء JS مباشر). باقي المعاملات كبيرة (baileys 22، oracledb 73، bullmq 72، zod 690، xlsx 391) مستخدمة فعليًا.
- **لا يوجد `frontend/package.json`** إطلاقًا (يعمل بـ vanilla ESM + vendor) → لا ازدواجية مع الجذر.
- **`.env` مقابل `.env.example`:** المثال 49 مفتاحًا فعّالًا، `.env` ‏55 مفتاحًا فعّالًا. الانزياح: 6 مفاتيح غير موثّقة (`ATTENDANCE_SHIFT_DAY_MODE`, `DB_POOL_MAX`, `API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `KARIM_FIXED_ADMIN_PASSWORD`) + موثّقة في المثال لكن مُعلَّقة في `.env` (`DB_MODE`, `CARD_VERIFY_BASE`) + موثّقة كمعلّقة فقط (`RT_REQUIRE_AUTH`, `WA_WARMUP_SCHEDULE`). (لم تُطبع أي قيم.)
- **`.gitignore`** يغطي `.env`، `docker-deploy/.env`، `docker-deploy/full-backup.sql` — جيد، لكن الملفات نفسها موجودة فعليًا على القرص.

### 5) Build / deploy artifacts

| المسار | آخر تحديث | الحالة |
|---|---|---|
| `build/` | 29/9/2026 | الأيقونات فقط؛ **ينقص** `build/templates/**` و`build/AlShorfa-ERP-Setup.nsi` المُستشهدَين في `package.json` `build.files` |
| `updates/` | 28/9/2026 | **فارغ تمامًا**، بينما `backend/server.js` و`electron/main.js` يقدّمان `updates/latest.yml` للتحديث التلقائي |
| `docker-deploy/` | 30/9/2026 | `full-backup.sql` **470MB**، `.env` يحوي أسرارًا، ملف `.bat` باسم تالف الترميز |
| `release/` | — | غير موجود (لم يُبنَ installer محليًا) |
| `android/` | 7/10/2026 | **128MB من مخرجات `app/build/intermediates/` موجودة داخل الشجرة** (وليست git-ignored بوضوح في eslint/prettier ignores) |
| `backend/` | — | **311MB** منها ONNX (`arcface-r100-int8.onnx` ‏249MB + `arcface-r100.onnx` ‏63MB) تدخل حزمة electron بسبب `backend/**/*` |
| `logs/` | 10/10/2026 | **595MB** |
| CI (`.github/workflows/ci.yml`) | 21/9/2026 | يشغّل `test:lint` + `test:format` + `test:type` + `npm test` → **الخطوة `test:format` و`unit-tests` ستfailان اليوم** |

### 6) Encoding / Mojibake

فحص بايتاتي (بحث عن U+FFFD `EF BF BD`) في backend/frontend/scripts/tests/common/electron/tools/docs + ملفات الجذر:

| الملف | عدد U+FFFD | ملاحظة |
|---|---|---|
| `backend/yarasoft/oracle-link.js` | 4 | تعليق عربي تالف داخل وصف `AR8MSWIN1256` |
| `backend/zkteco/protocol.js` | 2 | تعليق تالف + **حرف تالف داخل regex**: `.replace(/�/g, '')` |
| `frontend/app/css/mobile.css` | 1 | تعليق `/* UI/UX PHASE 3 ... */` العربي بُدِّل بـ U+FFFD |
| `frontend/app/css/pos.css` | 1 | الحال نفسه |
| `scripts/live_security_audit.py` | 2 | تعليق تالف |
| **الإجمالي** | **5 ملفات / 10 حالات** | |

ملف إضافي خارج المصدر: **اسم ملف** داخل `docker-deploy/` تالف (`�...bat`). لم يُعثر على U+FFFD في `README/CHANGELOG/worklog/todo/.env.example/tsconfig/jest/eslint/ci.yml` (نظيفة). تحذير: ظهور "�" عند فتح ملفات عربية في PowerShell هو أزيز عرض الطرفية (ANSI) وليس عيبًا في الملف — الاعتماد في هذا القسم على فحص البايتات.

### 7) التوثيق المكرر/المتعارض (18 ملف md في الجذر)

| الملف | التاريخ | الحجم | الحكم |
|---|---|---|---|
| `worklog.md` | 05/10/2026 | 180KB | سجل حي — يُنقل لـ `docs/` |
| `CHANGELOG.md` | 05/10/2026 | 92KB | **أساسي — يبقى** |
| `README-DEPLOY-DOCKER.md` | 01/10/2026 | 3KB | فرعي — يُدمج في docs/ |
| `HANDOVER_REPORT.md` | 30/09/2026 | 3KB | **قديم ومُضلِّل** (يدّعي 64 حزمة/0 فشل) — يُحدَّث أو يُؤرشف |
| `IMPLEMENTATION_REPORT.md` | 30/09/2026 | 2KB | تقرير لقطة — أرشفة |
| `ARCHITECTURE_DECISIONS.md` | 30/09/2026 | 4KB | **أساسي (ADR) — يبقى** |
| `DISCOVERY_REPORT.md` | 30/09/2026 | 9KB | قديم (يدّعي Node v26.3.0 و`npm run build` موجود) — أرشفة |
| `todo.md` | 29/09/2026 | 16KB | نشط نسبيًا — يبقى في docs/ |
| `README.md` | 29/09/2026 | 12KB | **أساسي — يبقى** |
| `README-WINDOWS.md` | 29/09/2026 | 9KB | فرعي — docs/ |
| `QUICK-START.md` | 29/09/2026 | 2KB | تكرار لـ README — دمج |
| `QA_REPORT.md` | 29/09/2026 | 4KB | لقطة QA — أرشفة |
| `FIX-AND-RUN-GUIDE.md` | 29/09/2026 | 9KB | لقطة — أرشفة |
| `FINAL_REPORT.md` | 29/09/2026 | 5KB | لقطة — أرشفة |
| `DISCOVERY_ARTIFACT.md` | 29/09/2026 | 8KB | مكرر مع docs/ — أرشفة |
| `DEVELOPMENT-ROADMAP.md` | 29/09/2026 | 12KB | مكرر مع docs/ROADMAP-9.5.md — دمج |
| `CONTRACT.md` | 29/09/2026 | 8KB | مكرر مع docs/ARCHITECTURE_CONTRACT.md — أرشفة |
| `START-HERE.md` | 29/09/2026 | 1.4KB | تكرار README — دمج |

**الثلاثة الكانونية المقترحة للإبقاء في الجذر:** ‏`README.md` (النقطة Entrance) + `CHANGELOG.md` (التاريخ) + `ARCHITECTURE_DECISIONS.md` (لماذا بُني هكذا). والبقية → `docs/archive/`، مع ترقية `worklog.md` إلى `docs/worklog.md` (أو إبقاؤه مُحدَّثًا لأنه الوحيد المتجدد).

---

## قائمة المشاكل

| # | الخطورة | المشكلة | الأثر | الإصلاح المقترح |
|---|---|---|---|---|
| P1 | **حرج** | 9 حزم/37 اختبارًا فاشلة في `npm test` (سبب رئيسي: `today is not defined` في harness) | CI يفشل، الإقلاع اليدوي يفشل، ثقة التغطية الراجعة (regression) مفقودة | إضافة `today` (وما ينقص بقية الواجهة) إلى معاملات `new Function` في 5 ملفات اختبار، أو حقن helpers في `tests/setup-env.js`؛ ثم إصلاح الفشل السلوكي في `attendance-delay-engine` |
| P2 | **حرج** | `npm run test:format` exit 2 (~780 ملفًا) | خطوة CI `lint-and-typecheck` تفشل دائمًا | إضافة `android/`, `logs/`, `audit/`, `docker-deploy/`, `**/*.md` (أو على الأقل `android/app/build/`) إلى `.prettierignore`؛ نقل `ignorePath` من `.prettierrc.js` إلى سطر الأمر؛ ثم `prettier --write` لمجلدات المصدر فقط |
| P3 | **حرج** | مراجع بناء مكسورة: `build/templates/**` و`build/AlShorfa-ERP-Setup.nsi` غير موجودين | `electron:build:nsis` قد يفشل أو يبني بدون قالب مخصص | إنشاء القالب أو حذف السطر من `build.files` |
| P4 | **عالي** | `updates/` فارغ بينما مسار التحديث التلقائي يخدم منه | Auto-update للعملاء لن يجد `latest.yml` | خطوة نشر تنسخ `release/latest.yml` + installers إلى `updates/`، أو تغيير المصدر إلى GitHub provider فقط |
| P5 | **عالي** | أسرار/بيانات في الشجرة: `docker-deploy/.env` (‏API_KEY, KARIM_FIXED_ADMIN_PASSWORD)، `full-backup.sql` ‏470MB، `NUL` ‏39KB متزايد، ملفات قذرة (`query`,`start`,`stop`,`{console.log(b.slice(0`) | تسريب محتمل، انتشار الشجرة، نصوص أدوات تفهم `NUL` كملف | تدوير المفاتيح، حذف الملفات، إضافة `.gitignore` أوسع، حذف `full-backup.sql` من الشجرة |
| P6 | **عالي** | `KARIM_FIXED_ADMIN_PASSWORD` و`GEMINI_API_KEY`/`API_KEY` غير موثّقة في `.env.example` | تثبيت جديد يعمل بلا ضبط أو بقيم افتراضية خطيرة | توثيق المفاتيح (بقيم placeholder) في `.env.example` + التحقق في `scripts/verify-env.js` |
| P7 | **عالي** | 21 module في backend بلا أي إشارة اختبار (incl. `inventory-transfer-routes`, `unit-conversion`, `veg-requests-routes`, `attendance-portal-routes`, `permission-routes`) | مناطق حرجة بلا شبكة أمان | أولوية: مسارات التحويل/الوحدات/الصلاحيات — اختبارات `supertest` أو منطق صافٍ كما في `veg-requests-logic` |
| P8 | **متوسط** | `docs/*.md` تستشهد سكربتات مفقودة (`build`, `download-pg`, `audit:silent`) وتُقدِّم بيانات خاطئة (Node v26.3.0) | إحباط المستخدم، أوامر لا تعمل | تصحيح التوثيق أو إضافة السكربتات المفقودة |
| P9 | **متوسط** | 1931 تحذير lint و0 أخطاء (قواعد كُتبت كـ warn كلها) + `no-undef` مُعطَّل | البوابة لا تحجب أي تدهور | رفع `no-unused-vars`/`eqeqeq` تدريجيًا لـ error في `backend/`، إعادة تفعيل `no-undef` على backend |
| P10 | **متوسط** | ازدواجية توثيق: 18 ملف md جذري، 3 منها تقارير لقطات قديمة تُناقض الواقع | قراء يسترشدون بأرقام خاطئة (64/932/0 فشل) | الإبقاء على 3 كانونية، نقل الباقي إلى `docs/archive/` |
| P11 | **متوسط** | ‏10 حالات U+FFFD في 5 ملفات مصدر + اسم ملف تالف في `docker-deploy/` | تعليقات عربية مفقودة، سلوك مخفي داخل regex في `zkteco/protocol.js` | إعادة كتابة التعليقات بالعربية الصحيحة، مراجعة `protocol.js` سطر الـ replace |
| P12 | **متوسط** | مخرجات build داخل المستودع: `android/app/build` ‏128MB، `logs/` ‏595MB، ONNX ‏311MB داخل `backend/` (تدخل حزمة electron) | حجم مستودع/حزمة ضخم، نسخ مكررة | `.gitignore` لمخرجات android/logs، نقل نماذج ONNX خارج `backend/**` أو استثناؤها من `build.files` |
| P13 | **منخفض** | معاملات غير مستخدمة: `html5-qrcode`, `chart.js` (الصفحة تستخدم vendor) | ~ Maintenance/audit ضوضاء | حذفهما من `dependencies` أو التوقف عن تحميل vendor |
| P14 | **منخفض** | `tests/` ممزوج بسكربتات (`survey*.ps1`, `diag-*.js`, `download-dish-images.js`, `load/`) | تشوش في استكشاف الاختبارات (‏`roots` يقتصر على `*.test.js` فهذا مقبول مؤقتًا) | نقلها إلى `scripts/` أو `tools/` |
| P15 | **منخفض** | ملفان متطابقان بخط إملائي: `INSTALL-PERMANENT-OFFLINE.bat` و`INSTALL-PERMENANT-OFFLINE.bat` | حارس يختار الخطأ | حذف النسخة المخطئة (PERMENANT) |
| P16 | **منخفض** | `tsconfig.strict.json` يغطي ملفًا واحدًا فقط رغم قاعدة "كل ملف جديد يُضاف" | الـ type gate شبه صوري | إضافة وحدات backend الجديدة للقائمة الصارمة |

---

## إحصاءات

| المؤشر | القيمة |
|---|---|
| ملفات مفحوصة بـ `node --check` | 336 |
| **أعطال صياغة (syntax fails)** | **0** |
| حزم الاختبار (jest --listTests) | 84 |
| حزم ناجحة / فاشلة | **75 / 9** |
| اختبارات: ناجح / فشل / todo / الإجمالي | **1119 / 37 / 8 / 1164** |
| زمن تشغيل الحزمة | ‏6–15 ثانية |
| رمز خروج `npm test` | 1 |
| سكربت lint موجود؟ | لا (البديل `test:lint`) |
| **أخطاء ESLint / تحذيرات** | **0 / 1931** (232 ملفًا) |
| أعلى 5 قواعد | no-unused-vars 1107، no-empty 485، eqeqeq 256، curly 61، no-useless-assignment 11 |
| Prettier (test:format) | exit 2 — ‏~780 ملفًا غير منسّق (‏148 داخل android/app/build) |
| `tsc --noEmit` | 0 أخطاء (10.8 ثانية) |
| سكربتات package.json | 57 |
| سكربتات مفقودة تُستشهد في التوثيق | 3 (`build`, `download-pg`, `audit:silent`) |
| engines node | >=20.0.0 (الفعلي 24.20.0 ✔) |
| مفاتيح `.env.example` / `.env` فعّالة | 49 / 55 |
| مفاتيح غير موثّقة في المثال | 6 (+2 موثّقة لكن مُعلَّقة) |
| ملفات بها U+FFFD (حالات) | 5 (10) |
| ملفات md في الجذر / في docs/ | 18 / 36 |
| ملفات backend غير المُشار إليها في أي اختبار | 21 من 59 |
| حجم مجلدات: logs / docker-deploy / backend / android / node_modules | 595 / 470 / 316 / 152 / 908 MB |
| أعطال صياغة في build/+updates/+tools/+android/+electron/+common | 0 (فحص syntax عام 0/336؛ `common/` و‏`electron/` مُستبعدان من lint بقرار `eslint.config.js`) |
