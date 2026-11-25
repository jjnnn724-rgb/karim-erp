# تغييرات الأمان — 2026-11-26

كل التعديلات أدناه **fail-closed**: الإعداد الناقص يوقف التشغيل بدل ما يفتح النظام.

## ما اتصلح
| الملف | الإصلاح |
|---|---|
| `scripts/reset-admin-pw.js` | كلمة المرور الثابتة اتنشالت. التشغيل يحتاج `KARIM_ALLOW_ADMIN_RESET=1` + كلمة من `KARIM_ADMIN_PASSWORD`/argv، و`must_change_password=true` دايمًا. |
| `backend/ops-inspect-routes.js` | حذف `GET /api/users/:id/password` اللي كان يرجع كلمة مقروءة. زر "عرض كلمة المرور" اتنقل من شاشة المستخدمين؛ مسار إعادة التعيين موجود. |
| `backend/password-vault.js` | مفيش fallback لـ JWT secret. `VAULT_KEY` إلزامي (32+ حرف) وإلا الإقلاع يفشل. |
| `backend/cashier-module/complete-sale.js` | QR/التوقيع/Hاش ZATCA بيتولّدوا بس لو `ZATCA_ENABLED=true`؛ غير كده مفيش بيانات ZATCA مزيفة في الفاتورة. |
| `backend/cashier-module/zatca-vat.js` | الرقم الضريبي التجريبي اتنشف؛ لما مفيش رقم حقيقي → `vat:null, source:'unconfigured'`. |
| `backend/cashier-module/zatca-signer.js` | المفتاح المؤقت مسموح بس خارج الإنتاج مع `ZATCA_ALLOW_DEV_KEY=true`؛ في الإنتاج غياب المفتاح = خطأ واضح. |
| `backend/branch-context.js` | مستخدم غير admin بلا `branch_id` → `-1` (قائمة فاضية) بدل "كل الفروع". والإنشاء بلا فرع = `403 BRANCH_REQUIRED`. |
| `backend/realtime/guard.js` | `RT_REQUIRE_AUTH` افتراضيه `true`. |
| `backend/server.js` | `API_KEY` إلزامي في الإنتاج (الإقلاع يفشل لو غاير)؛ `ALLOWED_ORIGINS` الافتراضي loopback بدل `*`. |
| `.github/workflows/ci.yml` | تجهيز الإصدار بقى يعتمد على `unit-tests` + `integration-tests` + `smoke-test`؛ integration بقى شغّال على push main كمان. |

## متغيرات بيئة جديدة/معدّلة
- `KARIM_ALLOW_ADMIN_RESET=1`, `KARIM_ADMIN_PASSWORD` — تشغيل سكربت إعادة التعيين.
- `VAULT_KEY` — إلزامي (32+ حرف).
- `API_KEY` — إلزامي في الإنتاج.
- `RT_REQUIRE_AUTH` — افتراضيه `true`.
- `BRANCH_LEGACY_FAIL_OPEN=true` — للترقيات القديمة فقط (قبل backfill الفروع).
- `ZATCA_ALLOW_DEV_KEY=true` — خارج الإنتاج فقط.
- `ZATCA_ENABLED` — لازم `true` صراحةً لتوليد QR/توقيع.

## تحذيرات نشر مهمة
1. أي production كان شغّال بـ `API_KEY` فاضي لازم يضيفه قبل الإقلاع.
2. أي production بمستخدمين بلا `branch_id` لازم يعمل backfill أو يضبط `BRANCH_LEGACY_FAIL_OPEN=true` مؤقتًا.
3. ZATCA لازم رقم ضريبي حقيقي + مفتاح توقيع؛ غير كده البيعة تكمل بدون QR (مش بتوقيع وهمي).

## الفحص
- `node --check` نجح على كل ملفات backend/scripts المعدّلة.
- `eslint` على الملفات المعدّلة: **0 errors / 0 warnings**.
- اختبارات `zatca-settings` و`boot-report-honest` و`v2-users` و`realtime-guard` اتنفّذت (النتيجة في سجل الجلسة).
