# Runbook: النسخ الاحتياطي والتعافي من الكوارث (DR)
**تحديث:** 2026-10-03 · **الأدلة:** drill مُنفذ فعليًا (06_hardening_round1 §2)

## الأهداف المقاسة فعليًا
| المؤشر | القيمة المقاسة | كيف |
|---|---|---|
| **RPO** | ≤ 24 ساعة (عمليًا ≈ 7 ساعات عند آخر حادثة) | nightly 03:00 يوميًا + backup عند الإقلاع |
| **RTO (القاعدة)** | **~33 ثانية** استرجاع من `karim_erp-latest.dump` (527MB→53MB -Fc) | مقاس في drill 2026-10-03 |
| **RTO (كامل الخدمة)** | دقائق: استرجاع + ترحيلات أمامية + تشغيل الخدمة | إجراء §2 |

## 1. طبقات النسخ الموجودة
1. `KarimERP-NightlyBackup` (03:00): `pg_dump -Fc` → `database/backups/karim_erp-nightly-YYYYMMDD.dump` + `latest.dump` + إزالة >3 أيام.
2. `KarimERP-Backup` (02:00): شامل (DB + كود + .env + SSL + Yarasoft) → `C:\KarimData\backups`.
3. `scheduleBackup()` عند إقلاع الخادم (throttle 15 ثانية).
4. أرشيف التكامل: `C:\HorusData\yarasoft-archive\` (65 جدولًا).

## 2. إجراء الاسترجاع القياسي (مُختبر)
```bat
:: 1) قاعدة جديدة من أحدث نسخة
createdb -h 127.0.0.1 -U postgres -T template0 karim_erp_restored
pg_restore -h 127.0.0.1 -U postgres -d karim_erp_restored -j4 database\backups\karim_erp-latest.dump

:: 2) ترحيلات أمامية — إلزامي إن كانت النسخة أقدم من آخر ترحيل:
::    طبّق صراحة كل ترحيل أحدث من تاريخ النسخة (المشغّل يدعم ملفًا محددًا):
set DB_NAME=karim_erp_restored
node database\scripts\run-migration.js 094_opening_balances_ledger.sql
node database\scripts\run-migration.js 095_journal_db_invariants.sql
:: (مثال — القاعدة: أي ترحيل أحدث من تاريخ النسخة يُطبق صراحة بهذا النمط)

:: 3) عطّل أجهزة البصمة إن كانت النسخة ستشتغل بالتوازي مع إنتاج حي:
UPDATE attendance_devices SET enabled=false;

:: 4) شغّل الخادم عليها أو بدّل DB_NAME في .env وأعد تشغيل خدمة KarimERP-Server
```
**فحص سجل الترحيلات دون كتابة:** قبل تطبيق ترحيلات على نسخة اختبار مستعادة، اضبط
`DB_NAME` على قاعدة الاستعادة فقط ثم شغّل
`node database\scripts\run-migration.js --status`. يعرض الملفات غير المسجلة
والإصدارات المسجلة التي لا يقابلها ملف. يتطلب الأمر `DB_NAME` صريحًا، ويقرأ
`schema_migrations` داخل معاملة `READ ONLY`؛ لا ينشئ الجدول ولا يطبّق SQL.
الخروج بالرمز 2 يعني أن الفحص غير حاسم (اسم القاعدة غير محدد أو السجل غائب)،
وغياب الجدول لا يثبت أن المخطط فارغ. لا تستخدم قاعدة النظام الحية لإجراء تحقق
تجريبي.

⚠️ **ملاحظة R5 (محدثة):** التتبع أصبح مزدوجًا (ملف + `schema_migrations`) منذ 2026-10-03 — لكن النسخ القديمة (قبل 2026-10-03) جدولُها فارغ، فالاسترجاع منها يتطلب خطوة (2) صراحةً. النسخ الجديدة القادمة ستضم الجدول ممتلئًا فتختفي الحاجة تدريجيًا.

## 3. التحقق بعد الاسترجاع (بوابات)
1. `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';` → **200**
2. `SELECT count(*) FROM schema_migrations;` → مطابق لعدد الترحيلات المتوقع
3. توازن GL: `SUM(debit)=SUM(credit)` للمنشور → متوازن
4. مطابقة الدفتر↔الأرصدة → صفر انحرافات (بعد 094)
5. `node tests/load/final-sanity.js` بعد تشغيل الخادم → 5/5

## 4. ما لا يغطيه هذا الإجراء
- **خارج الجهاز**: النسخ على نفس القرص حاليًا — انسخ `database/backups` أسبوعيًا لقرص/سحابة خارجية (توصية: `C:\HorusData\backups-mirror` + مجدول).
- **تشفير النسخ أثناء التخزين**: غير مطبق — القرص محمي بحماية ويندوز على جهاز فعلي؛ يُوصى BitLocker للقرص.
- **PITR/WAL**: غير مفعّل (نسخ يومية فقط) — فجوة ساعات بين النسختين تُفقد؛ مقبول لحجم العملية الحالي، قرار ترقية لاحق.
