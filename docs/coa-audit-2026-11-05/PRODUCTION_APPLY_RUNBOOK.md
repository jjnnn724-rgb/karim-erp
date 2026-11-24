# Runbook تطبيق الإنتاج 134 → 143

- **التاريخ:** 2026-11-07
- **النافذة المعتمدة:** 2026-11-07 23:00 (توقيت الجهاز UTC+3) — موافقة
  المالك مسجّلة في محادثة 2026-11-07 01:00.
- **القاعدة:** `karim_erp` فقط. الخدمة `KarimERP-Server`.
- **قاعدة ذهبية:** خطوة واحدة → تحقق → تسجيل → التالية. أي فشل = توقف فوري
  وانتقال إلى `PRODUCTION_ROLLBACK_RUNBOOK.md`.

## 0) T-15 دقيقة (22:45) — نسخة جديدة إلزامية

نسخة الليلة (215153) ستكون عمرها ~22 ساعة وقت النافذة، فلا تُستخدم.

```bash
cd <repo>
node scripts/backup-nightly.js
```
1. احفظ اسم الملف المشفّر الجديد وبصمتيه من `database/backups/*.sha256`.
2. فك التشفير وتحقق أن sha256 الصريح مطابق:
   ```bash
   node scripts/decrypt-backup.js database/backups/karim_erp-nightly-<stamp>.dump.kbak
   sha256sum database/backups/karim_erp-nightly-<stamp>.dump
   ```
3. استعد إلى قاعدة تحقق جديدة `karim_erp_preapply_verify` (8–10 ثوان) وطابق
   العدادات مع الإنتاج لحظة الاستعادة (مع استثناء أي قيود أُنشئت بعد لحظة
   النسخ عبر `created_at`).
4. لا تبدأ التطبيق قبل نجاح 1–3.

## 1) T0 — إغلاق النافذة

```powershell
Stop-Service KarimERP-Server
Get-Service KarimERP-Server        # Stopped
```
انتظر حتى يعود صفرًا (حتى 60 ثانية):
```sql
SELECT count(*) FROM pg_stat_activity
 WHERE backend_type='client backend' AND datname='karim_erp';
```
تأكد من عدم بقاء عامل Oracle ولا استماع:
```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node*' } |
  Select-Object Id,StartTime
Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
```
> عامل `oracle-poll-worker.js` يُشغّله الـbackend؛ إذا بقيت عملية منه بعد
> الإيقاف، انتظر انتهاءها ولا تقتلها إلا بعد التأكد أنها ليست جولة كتابة
> جارية.

ثم لقطة T0 (احفظها في `docs/coa-audit-2026-11-05/window-T0.json`):

```sql
SELECT now() AS t0;
SELECT COUNT(*) AS accounts FROM chart_of_accounts;
SELECT COUNT(*) AS je FROM journal_entries;
SELECT COUNT(*) AS jl FROM journal_lines;
SELECT COALESCE(SUM(l.debit),0)::numeric(18,2) dr,
       COALESCE(SUM(l.credit),0)::numeric(18,2) cr
  FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
 WHERE e.status='posted';
SELECT l.account_code, ROUND(SUM(l.debit-l.credit),2)::numeric(18,2) bal
  FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
 WHERE e.status='posted'
   AND l.account_code = ANY(ARRAY['2100','1150','5000','1200','4000','3100'])
 GROUP BY l.account_code ORDER BY l.account_code;
SELECT code FROM chart_of_accounts ORDER BY code;  -- بصمة الحسابات الـ108
SELECT to_regclass('public.account_mapping') AS mapping;  -- يجب null
```

## 2) التطبيق — 134 → 143

```bash
export PGPASSWORD="$(grep -m1 '^DB_PASSWORD=' .env | cut -d= -f2-)"
PSQL="C:/Program Files/PostgreSQL/18/bin/psql.exe"
MIG="database/migrations"
DB="-h 127.0.0.1 -p 5432 -U karim_app -d karim_erp"
```
كل ملف يحتوي `BEGIN/COMMIT`؛ لا تستخدم `psql -1`. التسجيل في
`schema_migrations` **بعد** نجاح التحقق، بصيغة `*.sql` كما في السجلات
السابقة.

| الخطوة | الملف | تحقق النجاح | سطر التسجيل |
|---|---|---|---|
| 1 | `134_coa_foundation.sql` | `to_regclass(account_mapping)` موجود، COUNT=25، metaCols=5، triggerان | `134_coa_foundation.sql` |
| 2 | `135_coa_global_sections.sql` | الحسابات الـ16 موجودة، `chart=108+16` | `135_coa_global_sections.sql` |
| 3 | `139_coa_mapping_phase3.sql` | `mapping=33` | `139_coa_mapping_phase3.sql` |
| 4 | `140_coa_mapping_yarasoft.sql` | `mapping=34` | `140_coa_mapping_yarasoft.sql` |
| 5 | `141_coa_mapping_stock_transfer.sql` | `mapping=43` | `141_coa_mapping_stock_transfer.sql` |
| 6 | `142_account_mapping_guardrails.sql` | `type_rule=13`، triggerان، audit موجود | `142_account_mapping_guardrails.sql` |
| 7 | `143_coa_mapping_read_paths.sql` | `mapping=49`، `reports=6` | `143_coa_mapping_read_paths.sql` |

لكل خطوة:
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/<file>.sql"
"$PSQL" $DB -v ON_ERROR_STOP=1 -c \
  "INSERT INTO schema_migrations(version) VALUES ('<file>.sql') ON CONFLICT (version) DO NOTHING"
```
ثم استعلام التحقق (أمثلة):
```sql
-- 134
SELECT to_regclass('public.account_mapping') t,
       (SELECT count(*) FROM account_mapping) n,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='chart_of_accounts' AND column_name IN
         ('normal_balance','fs_classification','is_control','is_suspense','is_reconcilable')) meta,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN
         ('trg_account_mapping_guard','trg_account_mapping_audit') AND NOT tgisinternal) trg;
-- 135
SELECT count(*) FROM chart_of_accounts;   -- T0.accounts + 16
-- 139/140/141/143
SELECT count(*) FROM account_mapping;     -- 33 / 34 / 43 / 49
SELECT count(*) FROM account_mapping WHERE module='reports';  -- 6 بعد 143
-- 142
SELECT (SELECT count(*) FROM account_mapping_type_rule) rules,
       (SELECT count(*) FROM account_mapping_audit) audit;
```

**قاعدة التوقف:** أي `psql` يخرج بغير 0، أو أي تحقق مخالف ⇒ توقف فورًا،
لا تسجّل الهجرة، وانتقل إلى §5.

## 3) Reconciliation بعد 143

| البند | القبول |
|---|---|
| الحسابات الـ108 السابقة | نفس البصمة المرتبة — لا حذف/تعديل |
| `chart_of_accounts` | T0 + 16 فقط |
| `journal_entries` / `journal_lines` | **T0 = T1** حرفيًا |
| ميزان المراجعة (posted) | مدين = دائن، وT0 = T1 |
| أرصدة 2100/1150/5000/1200/4000/3100 | T0 = T1 لكل حساب |
| `account_mapping` | 49، ولا صف قائم تغيّر |
| `account_mapping_audit` | موجود، غير فارغ |

```sql
SELECT (SELECT count(*) FROM journal_entries) je,
       (SELECT count(*) FROM journal_lines) jl,
       (SELECT COALESCE(SUM(debit),0) FROM journal_lines) dr,
       (SELECT COALESCE(SUM(credit),0) FROM journal_lines) cr;
```
أي فرق في JE/JL/Mizan/الأرصدة ⇒ **توقف فوري** ولا تُشغّل الخدمة.

## 4) ما بعد التطبيق

1. dump جديد بعد الترقيات:
   ```bash
   pg_dump -h 127.0.0.1 -p 5432 -U karim_app -d karim_erp -Fc \
     -f "$TEMP/karim_erp_post_migrations.dump"
   ```
2. استعد إلى `karim_erp_phase6b_post` (قاعدة منفصلة) — **لا تكتب اختبارًا على
   الإنتاج**:
   ```bash
   createdb -h 127.0.0.1 -U karim_app karim_erp_phase6b_post
   pg_restore -h 127.0.0.1 -U karim_app -d karim_erp_phase6b_post --jobs=4 \
     "$TEMP/karim_erp_post_migrations.dump"
   ```
3. شغّل الخدمة وافحص الصحة:
   ```powershell
   Start-Service KarimERP-Server
   ```
   ```bash
   curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/live
   curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/startup
   curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/ready
   ```
   المتوقع 200/200/200 و`ready.status=ok`.
4. Phase 6b على القاعدة المنفصلة:
   ```bash
   KARIM_TEST_DB_ISOLATED=1 KARIM_TEST_DB_NAME=karim_erp_test DB_NAME=karim_erp_test \
   PHASE6B_DB=karim_erp_phase6b_post PHASE6B_PORT=18973 \
   node node_modules/jest/bin/jest.js tests/phase6b-server-boot.test.js \
     --runInBand --forceExit
   ```
   المتوقع 6/6، `mode: staging`، `blocked=[]`، `oracleAttempts=0`،
   `listen-forced` على 18973.
5. البصمة الجديدة = SHA-256 لسطر `PHASE6B_EVIDENCE` الكامل.
6. تقرير الإغلاق: T0/T1، نتائج Reconciliation، بصمة Phase 6b، حالة الخدمة،
   والملفات المسجّلة في `schema_migrations`.

## 5) عند أي فشل

- لا تُشغّل الخدمة على حالة نصف مطبقة.
- نفّذ `PRODUCTION_ROLLBACK_RUNBOOK.md` من الخطوة المعاكسة الأخيرة الناجحة
  فقط (143→…)، مع حذف سجلات `schema_migrations` للخطوات التي رُجعت.
- إن فشل التراجع نفسه: استعد النسخة الجديدة (§0) **إلى قاعدة جديدة**،
  وتحقق، ثم قرّر مع المالك التحويل — لا استبدال مباشر للإنتاج.

## 6) التوقيت المتوقع

| المرحلة | الزمن |
|---|---|
| T-15: نسخة + فك + استعادة تحقق | 3–4 دقائق |
| إيقاف الخدمة + T0 | 2–3 دقائق |
| 134 → 143 + تحقق | 4–7 دقائق |
| Reconciliation | 2–3 دقائق |
| dump + استعادة + Phase 6b | 5–7 دقائق |
| إعادة تشغيل + صحة | 1–2 دقيقة |
| **الإجمالي** | **~17–26 دقيقة** |
