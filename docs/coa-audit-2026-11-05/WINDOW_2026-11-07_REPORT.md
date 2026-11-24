# تقرير نافذة تطبيق الإنتاج 134 → 143 — 2026-11-07

- **الحالة:** **تم التطبيق بنجاح** — 7/7 هجرات، Reconciliation خضراء، الخدمة
  تعمل 200/200/200.
- **البداية/النهاية (UTC):** T0 = `2026-11-06T23:02:09.921Z`، آخر هجرة =
  `23:03:03.165Z`، الصحة بعد التشغيل = `23:03:22.282Z`.
- **التوقيت المحلي:** 02:02 – 02:03 (UTC+3). بدأ التنفيذ بأمر المالك الصريح
  «ابدأ الآن» خارج النافذة الأصلية 23:00–01:00، مع الالتزام بشرط النافذة
  المغلقة (الخدمة متوقفة، صفر اتصالات).
- **لم تُنفَّذ أي كتابة اختبارية على `karim_erp`** — Phase 6b شُغّل على نسخة
  مستعادة منفصلة.

## 1) النسخة الاحتياطية المستخدمة (T-15)

| البند | القيمة |
|---|---|
| الملف المشفّر | `database/backups/karim_erp-nightly-20261106225951.dump.kbak` |
| الحجم المشفّر / الصريح | 93,313,149 / 93,313,098 بايت |
| sha256 مشفّر | `5790d1b4396df784290f510643fa41dc8d5b1211caa2d3d4234f153b73b820e9` |
| sha256 صريح | `2a5e56aae3347d29efb9f47e9ce54bef76440005c484a6b9e328b02cd30d5245` |
| المرايا | D:/E: — نفس الملف والبصمة، `status.ok=true` |
| فك + تحقق | مطابقة حرفية للبصمة الصريحة |
| استعادة تحقق | `karim_erp_preapply_verify` في **8,441 ms**، تطابق تام مع الإنتاج لحظة الاستعادة: je=37,848، jl=75,911، الميزان 7,522,333.29، الأرصدة الستة، mapping غائب، migrations=133 |

## 2) إغلاق النافذة وT0

- `Stop-Service KarimERP-Server` → **Stopped**.
- `pg_stat_activity`: **0** `client backend` على `karim_erp` خلال 25 ms.
- لا استماع على `0.0.0.0:5000`، ولا عملية `backend/server.js` أو
  `oracle-poll-worker.js`.
- T0 محفوظ في `window-T0.json`:

| البند | T0 |
|---|---:|
| `chart_of_accounts` | 108 (بصمة `550c7e40…a0eb`) |
| `journal_entries` | 37,848 |
| `journal_lines` | 75,911 |
| الميزان المرحّل | 7,522,333.29 / 7,522,333.29 |
| 2100 / 1150 / 1200 | 0.00 / 100,667.93 / -915.77 |
| 3100 / 4000 / 5000 | -2,252,293.42 / -3,667,229.74 / 722,533.01 |
| `account_mapping` | غائب |
| `schema_migrations` | 133 |
| آخر قيد | JE-20261107-0036 (yarasoft) |

## 3) نتائج التطبيق (واحد واحد)

| # | الهجرة | لحظة التسجيل (UTC) | التحقق |
|---|---|---|---|
| 1 | 134_coa_foundation | 23:02:36.007 | mapping موجود، 25 صفًا، meta=5، مشغلا COA=2 |
| 2 | 135_coa_global_sections | 23:02:43.013 | 16 كودًا جديدًا، chart=124 |
| 3 | 139_coa_mapping_phase3 | 23:02:46.399 | mapping=33 |
| 4 | 140_coa_mapping_yarasoft | 23:02:50.137 | mapping=34 |
| 5 | 141_coa_mapping_stock_transfer | 23:02:53.860 | mapping=43 |
| 6 | 142_account_mapping_guardrails | 23:02:58.445 | type_rule=13، مشغلان، audit موجود |
| 7 | 143_coa_mapping_read_paths | 23:03:03.165 | mapping=49، reports=6 |

`psql -v ON_ERROR_STOP=1` لكل ملف، وكل نسخة سُجّلت في `schema_migrations`
**بعد** نجاح التحقق. لا فشل في أي خطوة.

**شفافية:** أثناء تحقق 134 توقعت خطأً وجود مشغلي `account_mapping_guard/audit`
(يُنشآن في 142). فحص القراءة فقط رفض التسجيل، والهجرة كانت ناجحة، فصُحّح
التحقق (مشغلا COA=2، mappingTrig=0) وسُجّلت 134. **لا أثر على البيانات ولم
يُستخدم التراجع.**

## 4) Reconciliation (T0 vs T1)

`window-T1.json`: **ok=true, fails=[]**

| البند | T0 | T1 | الحكم |
|---|---:|---:|---|
| الحسابات الأصلية (108) | بصمة `550c7e40…a0eb` | نفس البصمة، لا كود مفقود | ✅ |
| `chart_of_accounts` | 108 | 124 (+16) | ✅ |
| `journal_entries` | 37,848 | 37,848 | ✅ |
| `journal_lines` | 75,911 | 75,911 | ✅ |
| الميزان المرحّل | 7,522,333.29 | 7,522,333.29 | ✅ |
| 2100/1150/1200/3100/4000/5000 | كما هي | كما هي | ✅ |
| `account_mapping` | 0 | 49 (reports=6) | ✅ |
| `account_mapping_type_rule` | — | 13 | ✅ |
| `account_mapping_audit` | — | 6 | ✅ |
| `schema_migrations` | 133 | 140 | ✅ |

## 5) الخدمة

- `Start-Service KarimERP-Server` → **Running** (pid 11276، استماع
  `0.0.0.0:5000`).
- `GET /api/health/live` = 200، `/startup` = 200، `/ready` = 200
  (`ready.status=ok`) خلال 31 ms من التشغيل.
- إعادة فحص بعد دقائق: 200/200/200 عند `23:05:45Z`، والقاعدة سليمة
  (mapping=49، audit=6، je/jl والميزان كما هما).

## 6) Phase 6b بعد التطبيق (على نسخة منفصلة)

- dump بعد الترقيات (93,338,825 بايت) → استعادة إلى
  `karim_erp_phase6b_post` في 8,853 ms، والنسخة تحمل mapping=49 وmigrations=140.
- تشغيل الهارنس مرتين: **6/6** ثم **6/6** (25.6s)، `mode: staging`،
  `accountMappingTable=account_mapping`، `blocked=[]`، `oracleAttempts=0`،
  `listen-forced 18973 → 127.0.0.1`، LAN مرفوض.
- **البصمة (SHA-256 لسطر الأدلة، بلا newline):**
  `4a714f321aa3bb0d3878a11758c1aa60db551b95a8f94714ffafe27ca6f2b436`
- سطر الأدلة الكامل:
  ```
  PHASE6B_EVIDENCE {"db":"karim_erp_phase6b_post","port":18973,"restoredByTest":false,"window":{"mode":"staging","db":"karim_erp_phase6b_post"},"accountMappingTable":"account_mapping","user":{"id":"1","role":"admin","username":"admin"},"health":{"live":200,"startup":200,"ready":200,"readyState":"ok"},"journal":{"status":201,"entryNo":"JE-20261107-0038","debit":250,"credit":250,"lines":2},"tb":{"totalDebit":500,"totalCredit":500,"balanced":true},"cashFlow":{"status":200,"inflow":500,"outflow":0},"cfo":{"status":200,"revenue":0,"net":0},"bankRec":{"status":200,"before":250,"book":500,"statement":0,"diff":-500},"period":{"close":200,"blocked":423,"reopen":200},"egress":{"guardLoadedPids":[22412,22412],"serverPid":22412,"blocked":[],"oracleAttempts":0,"listenForced":[{"kind":"listen-forced","port":18973,"from":"0.0.0.0","to":"127.0.0.1"}],"recordedLines":3,"lanProbe":{"host":"100.67.162.108","connected":false}},"serverExit":null}
  ```
  (tb=500 لأن الجولة الثانية قرأت قيد الجولة الأولى داخل **نسخة الاختبار**؛
  لا علاقة للإنتاج بهذا الرقم.)

## 7) التنظيف

- حُذفت `karim_erp_phase6b_post` و`karim_erp_preapply_verify` بعد صفر اتصالات.
- حُذفت ملفات dump المؤقتة (النسخة المشفّرة الرسمية باقية في `database/backups`
  وD:/E:).
- `schema_migrations` سُجّلت فيه السبع بصيغة `*.sql`.

## 8) التراجع

لم يُستخدم. النسخة الاحتياطية `…225951` كاملة ومتحقق منها، وRunbook التراجع
جاهز (`PRODUCTION_ROLLBACK_RUNBOOK.md`) إذا ظهر أي خلل لاحق.
