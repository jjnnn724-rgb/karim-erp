# Phase 6b — server.js الكامل في بيئة معزولة (شبكة مقطوعة)

- **التاريخ:** 2026-11-07
- **الملف:** `tests/phase6b-server-boot.test.js` + الحارس `scripts/phase6b-egress-guard.js`
- **النتيجة:** **6/6 ✅** في 24.3 ثانية
- **الحكم:** نقطة الإقلاع الإنتاجية نفسها (`backend/server.js`) تعمل كاملةً على
  نسخة مستعادة من النسخة الاحتياطية، بلا `account_mapping` (مسار fallback
  الحقيقي)، بلا أي اتصال خارج loopback، وبلا تحميل `oracledb`.

## كيف تُعزل البيئة

1. **قاعدة مستعادة:** `karim_erp_phase6b` استُعيدت من
   `karim_erp-nightly-20261106210048.dump` (انظر `BACKUP_RESTORE_EVIDENCE.md`).
   `schema_migrations` = 133 (**قبل 134**) ⇒ `account_mapping` غير موجودة،
   فكل مسارات المحاسبة تمر بالثوابت الافتراضية.
2. **المتغيرات:** `YARASOFT_ENABLED=false`, `YARASOFT_ORACLE_ENABLED=false`,
   `KARIM_LAN_BEACON=false`, `WARMUP_ENABLED=false`, `WHATSAPP_ENABLED=false`,
   `PUSH_ENABLED=false`, `SKIP_BULLMQ=true`, `GOVERNANCE_SCHEDULER=false`,
   `PORT=18973`, `NODE_ENV=production`.
3. **الحارس عبر `NODE_OPTIONS=--require`** يُحمَّل قبل server.js ويقوم بـ:
   - قطع `net.Socket.prototype.connect` لأي مضيف غير loopback (وسجل JSONL)؛
   - قطع `dgram.send` لأي عنوان غير loopback (يشمل بيكل LAN)؛
   - منع `dns.lookup` لأي اسم غير محلي وغير اسم الجهاز نفسه؛
   - منع تحميل `oracledb` نهائيًا وتسجيل المحاولة؛
   - **إجبار any `listen` على 0.0.0.0/:: إلى 127.0.0.1**.

## النتائج المقيسة

| # | الفحص | النتيجة |
|---|-------|---------|
| 1 | `/api/health/live` + `/startup` + `/ready` | 200 / 200 / 200، `ready.status=ok` |
| 2 | `account_mapping` في القاعدة المستعادة | `to_regclass = null` ✅ (fallback حقيقي) |
| 3 | ترحيل قيد عبر `POST /api/accounting/journal` | 201، `JE-20261107-0006`، مدين 250 = دائن 250، سطران |
| 4 | ميزان المراجعة 2019-07 | مدين 1000.00 = دائن 1000.00، `balanced: true` |
| 5 | دلتا التسوية البنكية 1010 | **+250.00** بالضبط بعد الترحيل |
| 6 | التدفق النقدي / CFO | 200، الداخل 1000.00، CFO يعود بأرقام رقمية |
| 7 | إقفال 2019-07 ثم ترحيل عليه | إقفال 200؛ الترحيل مرفوض **423**؛ إعادة فتح 200 |
| 8 | سجل الحارس | `guard-loaded` داخل pid السيرفر نفسه، **0 محاولة محجوبة**، **0 oracledb** |
| 9 | الاستماع | `listen-forced: 0.0.0.0 → 127.0.0.1` على المنفذ 18973 |
| 10 | فحص LAN حي | الاتصال بـ`100.67.162.108:18973` **مرفوض** (المنفذ غير مفتوح على الشبكة) |

## عيوب اكتُشفت وأُصلحت أثناء بناء الهارنس (شفافية)

1. **`PORT` نصي من `.env` كان يفلت من شبكة الحارس** — `server.js:153` يستخدمه
   كما هو، وشرط الحارس كان `typeof args[0] === 'number'`، فبقي السيرفر يستمع
   على `0.0.0.0` في أول تشغيل. أُصلح بتحويل البورت إلى رقم داخل الحارس،
   وأُثبت بالفحص الحي على عنوان LAN (مرفوض) و`listen-forced` في السجل.
2. **`guard-loaded` يظهر مرتين بنفس pid** — ليس تكرار تحميل: خيط عامل
   (`backend/pw-crypto.js:34` → `pw-worker.js`) يشترك في pid ويُعيد تشغيل
   `--require` لكل worker thread. لا أثر على العزل (الحارس يُطبَّق في الخيط
   والعملية معًا).
3. **كاش GET (30 ثانية)** في `backend/api-cache.js` لا يُبطَل بكتابة
   `accounting/journal` (الموردَان `accounting`+`journal` مقابل
   `accounting`+`bank-rec` ليسا على غصن واحد). الهارنس يقرأ بـ`?live=1` —
   وهو المسار المخصص لتجاوز الكاش — حتى تقيس التقارير أثر الترحيل فورًا.

## حدود الإثبات (مقصودة)

- **لا اتصال بـOracle أو YaraSoft إطلاقًا**؛ المتغيران معطلان، والحارس يمنع
  تحميل `oracledb` ويسجل أي محاولة (كانت صفرًا). هذا إثبات استقلالية لا إثبات
  تكامل مع المصادر الخارجية.
- القاعدة **staging مستعادة**، وليست الإنتاج؛ قيود الاختبار موسومة
  `zz-phase6b-*` وتبقى في قاعدة الاختبار عند `PHASE6B_KEEP_DB=1`.
- لا يُقاس الأداء أو التزامن هنا؛ الغرض إثبات الإقلاع والدورة المحاسبية.

## إعادة الإنتاج

```bash
# 1) فك تشفير نسخة الليلة (يتطلب KARIM_BACKUP_PASSPHRASE)
node scripts/decrypt-backup.js database/backups/karim_erp-nightly-20261106210048.dump.kbak

# 2) تشغيل الهارنس (ينشئ القاعدة من dump إن لم تكن موجودة)
PHASE6B_DUMP="$TEMP/karim_erp_phase6b.dump" PHASE6B_KEEP_DB=1 \
KARIM_TEST_DB_ISOLATED=1 KARIM_TEST_DB_NAME=karim_erp_test DB_NAME=karim_erp_test \
node node_modules/jest/bin/jest.js tests/phase6b-server-boot.test.js --runInBand --forceExit
```
