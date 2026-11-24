# 18. TEST_DB_PROVISIONING.md — بيئة الاختبار المعزولة `karim_erp_test` (لم تُنشأ — تنفّذها أنت)

**القاعدة:** اختبارات jest لا تلمس `karim_erp` الإنتاجية إطلاقًا — و`tests/global-setup.js` يرفض التشغيل بدون الشروط التالية كلها:
- `DB_NAME = karim_erp_test` و`KARIM_TEST_DB_NAME = karim_erp_test`
- `KARIM_TEST_DB_ISOLATED = 1` (فقط بعد أن تُجهز قاعدة disposable بها بيانات اصطناعية)
- `NODE_ENV ≠ production`
- `DB_HOST ∈ loopback`

## التزويد (على جهاز معزول/staging — ليس على الإنتاج)
```powershell
# 0) نسخة احتياطية من staging/production لاختبار الاستعادة فقط — ليس هنا
# 1) إنشاء القاعدة الفارغة (على جهاز تست):
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE karim_erp_test OWNER karim_app;"
# 2) تطبيق كل الهجرات على القاعدة الفارغة (001→133 ثم 134/135 لو اختبرناها):
$env:DB_NAME='karim_erp_test'; node database/scripts/run-migration.js          # تشغيل الهجرات المعلقة بالترتيب
# 3) التحقق:
psql -h 127.0.0.1 -U karim_app -d karim_erp_test -c "SELECT count(*) FROM chart_of_accounts;"     # 108
psql -h 127.0.0.1 -U karim_app -d karim_erp_test -c "SELECT count(*) FROM journal_entries;"      # 0 (فارغة اصطناعية) أو بيانات معيّنة
# 4) تشغيل jest (كل suites):
$env:KARIM_TEST_DB_ISOLATED='1'; $env:KARIM_TEST_DB_NAME='karim_erp_test'; npm test
```
ملاحظة: الـ suites الحالية (266+) قد تحتاج بيانات اصطناعية أوسع؛ بوابة `KARIM_TEST_DB_ISOLATED=1` معناها "أنت مسؤول عن disposability" — **لا تُنشأ هذه البيئة على جهاز الإنتاج أبدًا**. للتطوير المحلي (هذا الجهاز): القاعدة غير موجودة عمدًا — لا تُنشئها بلا موافقة isolation حقيقية؛ اختبارات الوحدات (`tests/unit/coa-foundation.test.js`) تعمل بدون قاعدة عبر node مباشرة وقد تُشغّل في CI معزول.

## متطلبات CI/بيئة المعزولة لأي مرحلة حرجة قادمة
- جهاز/VM منفصل أو خدمة bridge loopback فقط.
- نسخة staging من الإنتاج مشفّرة ومُخزّنة خارج الجهاز (أو قاعدة معيّنة من الصفر + هجرات + بيانات اصطناعية).
- `KARIM_TEST_DB_ISOLATED=1` في بيئة CI فقط، مع حذف/استرجاع القاعدة عند الحاجة.
- لا أسرار إنتاج في متغيرات بيئة الاختبار — استخدم أسرار اختبار مولّدة.
