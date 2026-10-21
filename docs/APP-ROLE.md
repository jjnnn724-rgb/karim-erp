# تفعيل دور التطبيق + تطهير سجل GRANT

**الحالة:** التطبيق الآن يعمل بدور `karim_app` (بلا superuser) — مُفعَّل على الإنتاج.

## ما الذي تغيّر

| | قبل | بعد |
|---|---|---|
| دور اتصال التطبيق | `postgres` (**superuser**) | `karim_app` (مالك جداول التطبيق فقط) |
| `PUBLIC` على جداول public | SELECT على 4 + INSERT على 1 (من migration 003) | **صفر** |
| `karim_app` | `NOLOGIN` | `LOGIN` + كلمة مرور 32 بايت |
| امتيازات الدور | DML فقط | DML + REFERENCES/TRIGGER/TRUNCATE + **ملكية الجداول** (DDL وقت التشغيل) |

الدور **ليس** superuser: لا `CREATEDB` · لا `CREATEROLE` · لا `REPLICATION` · لا `BYPASSRLS` ·
ولا يستطيع قراءة قواعد أخرى أو-owned objects .

## لماذا الملكية (OWNER) وليس DML فقط؟
التطبيق ينفّذ DDL وقت التشغيل (idempotent):
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` (attendance-portal، dispatch-notifier) ·
`CREATE TABLE IF NOT EXISTS` (hr-routes) · `CREATE INDEX IF NOT EXISTS`.
و`ALTER TABLE` يتطلب **ملكية** الجدول ⇒ دور بلا ملكية يفشل ⇒ المالكون هم الحدّ الأدنى
عمليًا ( able to ALTER/DROP جداوله، لكن ليس غيره ولا القاعدة كلها).

## الملفات
- `database/migrations/113_app_role_activation.sql` — التفعيل + نقل الملكية + تطهير PUBLIC (idempotent).
- `scripts/activate-app-role.js` — التفعيل الآمن: نسخة .env ← migration ← كلمة مرور ← تعديل .env ← تحقّق (قراءة + كتابة داخل BEGIN/ROLLBACK) ← تعليمات تراجع.
- `backend/audit-engine/checks/database.js` — فحصان جديدان يمنعان العودة:
  `db.app_role_not_superuser` (HIGH) و`db.public_grants_purged` (MEDIUM).

## التشغيل
```bash
node scripts/activate-app-role.js            # خطة (dry-run)
node scripts/activate-app-role.js --apply    # تنفيذ + تحقّق
node scripts/activate-app-role.js --rollback  # استعادة .envbak
```

## التراجع
```sql
-- إعادة ملكية الجداول إلى postgres + (إن لزم) استعادة امتيازات PUBLIC
```
مذكور في رأس ملف الـmigration (تعليق `--rollback`) ✓، ونسخة `.env` قبل التفعيل في
`logs/env.before-app-role.<ts>.bak` ✓.

## ملاحظات
- كلمة المرور **لا تُطبع** في أي مخرجات ولا تُحفظ خارج `.env` (المُتجاهَل من git) ✓.
- النسخة الاحتياطية قبل التغيير: `database/backups/karim-karim_erp-2026-10-21T04-40-59.sql`
  (518MB · SHA-256 معتمد) ✓.
- الـmigrations نفسها لا يحتاجها التطبيق وقت التشغيل (يقرأ السجل فقط) ⇒ يمكن تشغيلها
  بدور إداري منفصل في أي وقت ✓.
