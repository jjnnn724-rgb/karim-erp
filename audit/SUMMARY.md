# التقرير الشامل — Karim ERP (فحص 2026-10-10)
التقارير التفصيلية: `frontend.md` · `backend.md` · `database.md` · `ops.md` · `quality.md`

## الصورة الكبيرة
نظام قوي في الأساس: صفر خلل syntax، صفر انتهاك FK، مخزون متوازن تمامًا، اختبارات 1119/1156، المهام الخمس تعمل. لكن 4 طبقات من المخاطر:

## أخطار حرجة (ACT NOW)
1. **XSS مخزَّن** — 52 حقنًا داخل `innerHTML` بلا `esc()` (kitchen, dashboard, smart-card) + `safeImgSrc` مكتوبة ولا تُستدعى أبدًا.
2. **كلمة المرور مكشوفة في 23 ملفًا** (`.env`, docker-compose, سكربتات ps1) + `KARIM_FIXED_ADMIN_PASSWORD` في البيئة — تدوير فوري.
3. **سرّ JWT قابل للتخمين** (مبني على hostname+totalmem) + بديل ثابت `karim-dev-secret`.
4. **زرا تغيير كلمة المرور ميّتان** — دوال غير مصدَّرة في `auth-navigation.js:25,34`.
5. **Offline معطّل** — `sw.js` يطلب `?v=4.9.32` بينما التطبيق `4.9.69`.
6. **`ora_*` 1.38M صف (89% من البيانات) بلا فهرس واحد** — كلها seq scan.

## صحة الجودة
| الفحص | النتيجة |
|---|---|
| Syntax (336 ملف) | ✅ 0 أخطاء |
| Typecheck | ✅ 0 أخطاء |
| Lint | ✅ 0 (1931 تحذير) |
| Tests | ⚠️ 1119 ✅ / **37 ❌** — سبب واحد: `today is not defined` في harness الاختبارات |
| Formatted | ❌ exit 2 — ~780 ملف غير منسّق (CI سيتوقف) |

## صحة التشغيل
- المهام الخمس: كلها ✅ (Punch-Reconcile 12/12، Backups نجحت 58MB).
- الخدمة: Running + استرداد ذاتي ✅ — لكن مربوطة بمسار Desktop (أي نقل يكسرها).
- النفق: موصول ✅.
- ⚠️ `logs/app-out.log` = **590MB** بلا تدوير · **11 مهمة مفقودة** يُستدعى من الكود.

## التنظيف المؤجل (آمن)
- قمامة الجذر: `NUL`، `{console.log(b.slice(0`، `query/`، `start/`، `stop/`، `'2026-10-05'`، نسخة `INSTALL-PERMENANT` مكرّرة، 16 تقرير md (الاحتفاظ بـ README + CHANGELOG + ARCHITECTURE).
- 7 جداول backup داخل القاعدة · 63 جدولًا فارغًا (ميزات مهجورة) · dispatches فهرسان متطابقان.

## فجوات التدقيق (audit)
audit triggers موجودة على users + POS فقط — **بدونها**: attendance_logs, inventory_ledger, journal_lines, dispatches, expenses, employees.

## إصلاحات مقترحة بالترتيب
1. تدوير كلمات المرور + سرّ JWT ثابت حقيقي.
2. إصلاح XSS (esc في 52 موضعًا) + تصدير الدوال المفقودة + sw.js الديناميكي (تم سابقًا — تأكيد).
3. فهرس `ora_*` + تشغيل الاختبارات (harness today).
4. نسخ `logs/` + تنظيف الجذر + التقسيم المؤجل لـ SERVICE.
