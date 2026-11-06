# Runbook تراجع الإنتاج — 143 → 134

- **التاريخ:** 2026-11-07
- **النطاق:** تراجع هجرات COA السبع على قاعدة الإنتاج `karim_erp` فقط.
- **مبرهن على:** `karim_erp_apply_verify` المستعادة من النسخة
  `karim_erp-nightly-20261106215153.dump.kbak` — 7 up ثم 7 down وعادت
  القاعدة إلى الأساس (انظر `BACKUP_RESTORE_EVIDENCE.md` §8).
- **قاعدة ذهبية:** خطوة واحدة، تحقق، ثم التالية. أي انحراف = توقف فوري.

## 0) قبل بدء التراجع

1. الخدمة متوقفة:
   ```powershell
   Stop-Service KarimERP-Server
   Get-Service KarimERP-Server   # Status = Stopped
   ```
2. لا اتصالات على الإنتاج (يجب أن يعود صفرًا خلال 15 ثانية):
   ```sql
   SELECT pid, usename, client_addr, state FROM pg_stat_activity
    WHERE backend_type='client backend' AND datname='karim_erp';
   ```
3. لا استماع على 5000:
   ```powershell
   Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
   ```
4. النسخة الاحتياطية جاهزة ومفكوكة ومتحقق منها (sha256 مطابق):
   `karim_erp-nightly-20261106215153.dump.kbak` — مسار الاستعادة إن لزم
   في §5.
5. سجّل لقطة الأساس الحالية:
   ```sql
   SELECT COUNT(*) FROM account_mapping;                    -- المتوقع 49 بعد التطبيق
   SELECT COUNT(*) FROM chart_of_accounts;                   -- 124 بعد التطبيق
   SELECT COUNT(*) FROM journal_entries;                     -- 37,833 لحظة النسخة
   SELECT COUNT(*) FROM journal_lines;                       -- 75,881
   ```
   وميزان المرحّل + أرصدة 2100/1150/5000/1200/4000/3100 كما في §3.

## 1) ترتيب التنفيذ (عكس التطبيق)

التطبيق: 134 → 135 → 139 → 140 → 141 → 142 → 143
التراجع: **143 → 142 → 141 → 140 → 139 → 135 → 134**

كل ملف down يحتوي `BEGIN/COMMIT` خاصًا به، فلا تستخدم `psql -1` (تمنع
التداخل). استخدم `ON_ERROR_STOP=1` حتى يتوقف psql عند أول خطأ داخل الملف.

```bash
export PGPASSWORD="<DB_PASSWORD من .env>"
PSQL="C:/Program Files/PostgreSQL/18/bin/psql.exe"
MIG="database/migrations"
DB="-h 127.0.0.1 -p 5432 -U karim_app -d karim_erp"
```

> المستخدم `karim_app` هو مالك جداول المحاسبة في الإنتاج. ملفات 139/140/141/143
> تضبط `SET LOCAL coa.allow_mapping_change='on'` داخليًا — لا حاجة لأي GUC يدوي.

### الخطوة 1 — 143
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/143_coa_mapping_read_paths_down.sql"
```
تحقق: `mapping = 43`، `reports = 0`، جدول `account_mapping_type_rule` ما زال موجودًا،
`account_mapping_audit` زاد بعدد أحداث الحذف (لا ينقص أبدًا).
```sql
SELECT (SELECT COUNT(*) FROM account_mapping) mapping,
       (SELECT COUNT(*) FROM account_mapping WHERE module='reports') reports,
       (SELECT COUNT(*) FROM account_mapping_audit) audit;
```

### الخطوة 2 — 142
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/142_account_mapping_guardrails_down.sql"
```
تحقق: `to_regclass('public.account_mapping_type_rule') IS NULL`، و`pg_trigger`
لا يحوي `trg_account_mapping_guard` ولا `trg_account_mapping_audit`،
و`account_mapping_audit` **يبقى** (تصميم 142_down).
```sql
SELECT to_regclass('public.account_mapping_type_rule') rules_table,
       (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN
         ('trg_account_mapping_guard','trg_account_mapping_audit') AND NOT tgisinternal) mapping_triggers;
```

### الخطوة 3 — 141
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/141_coa_mapping_stock_transfer_down.sql"
```
تحقق: `mapping = 34`.

### الخطوة 4 — 140
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/140_coa_mapping_yarasoft_down.sql"
```
تحقق: `mapping = 33`.

### الخطوة 5 — 139
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/139_coa_mapping_phase3_down.sql"
```
تحقق: `mapping = 25`.

### الخطوة 6 — 135
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/135_coa_global_sections_down.sql"
```
تحقق: الحسابات الـ16 المدخلة بـ135 اختفت و`chart_of_accounts = 108`:
```sql
SELECT COUNT(*) FROM chart_of_accounts WHERE code IN
 ('8','81','8101','8102','8103','71','72','7101','7102','7103','7104',
  '7201','7202','7203','7204','7205');           -- 0
SELECT COUNT(*) FROM chart_of_accounts;          -- 108
```

### الخطوة 7 — 134
```bash
"$PSQL" $DB -v ON_ERROR_STOP=1 -f "$MIG/134_coa_foundation_down.sql"
```
تحقق نهائي: `account_mapping` و`account_fs_mapping` و`posting_failures` غائبة،
أعمدة الميتاداتا على `chart_of_accounts` = 0، مشغلات COA = 0.
```sql
SELECT to_regclass('public.account_mapping') mapping,
       to_regclass('public.account_fs_mapping') fs_mapping,
       to_regclass('public.posting_failures') failures,
       (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_name='chart_of_accounts' AND column_name IN
         ('normal_balance','fs_classification','is_control','is_suspense','is_reconcilable')) meta_cols,
       (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN
         ('trg_coa_no_cycle','trg_coa_lock_posted_semantics') AND NOT tgisinternal) coa_triggers;
```

## 2) التحقق بعد كل خطوة (إلزامي)

```sql
SELECT COUNT(*) AS je FROM journal_entries;      -- يجب ألا يتغير
SELECT COUNT(*) AS jl FROM journal_lines;        -- يجب ألا يتغير
SELECT COALESCE(SUM(l.debit),0)::numeric(18,2) dr,
       COALESCE(SUM(l.credit),0)::numeric(18,2) cr
  FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
 WHERE e.status='posted';                        -- مدين = دائن
SELECT l.account_code, ROUND(SUM(l.debit-l.credit),2)::numeric(18,2) bal
  FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
 WHERE e.status='posted'
   AND l.account_code = ANY(ARRAY['2100','1150','5000','1200','4000','3100'])
 GROUP BY l.account_code ORDER BY l.account_code;
```
المرجع المقيس على نسخة النافذة: `je=37833`, `jl=75881`,
`TB=7,521,733.29`، والأرصدة 1150=100,667.93، 1200=-915.77، 2100=0.00،
3100=-2,252,293.42، 4000=-3,666,629.74، 5000=722,533.01.
التراجع لا يمس أي قيد أو سطر أو رصيد؛ أي فرق = توقف.

## 3) قواعد التوقف

1. أي خطأ SQL (code ≠ 0) → **توقف فورًا**، لا تشغّل الملفات التالية.
2. أي فرق في je/jl/TB/الأرصدة → **توقف فورًا** وابدأ تحقيقًا.
3. لا تحذف قاعدة الإنتاج ولا تعمل `DROP DATABASE karim_erp` تحت أي ظرف.
4. إذا فشل التراجع في منتصفه:
   - أصلح سبب الفشل ثم أكمل من الخطوة الفاشلة (الملفات idempotent عمليًا:
     `DROP ... IF EXISTS` / `DELETE` محدد).
   - إن تعذّر الإصلاح: استعد النسخة الاحتياطية **إلى قاعدة جديدة** (§5)،
     وتحقق منها، ثم قرّر مع المالك كيفية التحويل — لا استبدال مباشر للإنتاج.
5. `account_mapping_audit` لا يُحذف بالتراجع؛ نموّه دليل تدقيق مقصود.

## 4) بعد اكتمال التراجع

```powershell
Start-Service KarimERP-Server
Get-Service KarimERP-Server
```
ثم فحوص الصحة (بمفتاح API):
```bash
curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/live
curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/startup
curl -sk -H "x-api-key: $API_KEY" https://127.0.0.1:5000/api/health/ready
```
المتوقع 200/200/200 و`ready.status=ok`، وبصمة إصدار جديدة تُسجَّل في تقرير
النافذة.

## 5) خطة الاستعادة الكاملة (إن فشل التراجع)

1. فك النسخة والتحقق من البصمة (متوقع
   `bb3786171f07a01664fde842f7c91b72c635878ca4eab8354651ec52e57895e7`):
   ```bash
   node scripts/decrypt-backup.js database/backups/karim_erp-nightly-20261106215153.dump.kbak
   sha256sum karim_erp-nightly-20261106215153.dump
   ```
2. أنشئ قاعدة جديدة `karim_erp_restore_<stamp>` واستعد إليها:
   ```bash
   createdb -h 127.0.0.1 -p 5432 -U karim_app karim_erp_restore_YYYYMMDDHHMM
   pg_restore -h 127.0.0.1 -p 5432 -U karim_app -d karim_erp_restore_YYYYMMDDHHMM \
     --jobs=4 karim_erp-nightly-20261106215153.dump
   ```
3. طابق العدادات والميزان والأرصدة مع §2 قبل أي قرار تحويل.
4. التحويل الفعلي للإنتاج يحتاج أمرًا صريحًا من المالك + نافذة مغلقة + إعادة
   تسمية قواعد (وليس حذفًا) مع الاحتفاظ بالأصل.

## 6) تنظيف سجل الهجرات (بعد نجاح 134 فقط)

إن سجّل التطبيق الهجرات السبع في `schema_migrations` (بصيغة `*.sql`)، يجب
حذف سجلاتها بعد اكتمال التراجع، وإلا سيتخطاها أي مشغّل هجرات لاحق:

```sql
DELETE FROM schema_migrations WHERE version IN (
  '134_coa_foundation.sql', '135_coa_global_sections.sql',
  '139_coa_mapping_phase3.sql', '140_coa_mapping_yarasoft.sql',
  '141_coa_mapping_stock_transfer.sql', '142_account_mapping_guardrails.sql',
  '143_coa_mapping_read_paths.sql');

SELECT COUNT(*) FROM schema_migrations;   -- المتوقع 133
```

> الملفات السبع `*_down.sql` لا تلمس `schema_migrations` (تحقق مقروء)، لذا
> الحذف أعلاه مسؤولية المشغّل بعد التأكد من نجاح التراجع.

## 7) ما تمت برهنته فعليًا

| البند | الدليل |
|---|---|
| 7 up ثم 7 down على نسخة النافذة نفسها | `karim_erp_apply_verify` المستعادة من `...215153.kbak`: عادت إلى الأساس (mapping غائبة، chart=108، je/jl/TB/الأرصدة بلا تغيير) |
| المدة | استعادة 8,677 ms، ثم 7 up + 7 down كاملة في جولة واحدة بلا أخطاء |
| حفظ سجل التدقيق | `account_mapping_audit` نما (6 → 12) ولم يُحذف |
| القيود والأرصدة | `je=37,833`, `jl=75,881`, `TB=7,521,733.29` قبل وبعد التراجع |

> ملاحظة: هذا Runbook مكتوب ولم يُنفَّذ على الإنتاج. تنفيذه يحتاج موافقة
> المالك داخل نافذة مغلقة.
