# موثوقية البصمة — 2026-11-26

## المطلوب
كل بصمة على الجهاز تُسجَّل تلقائياً في التطبيق بأعلى كفاءة، وتظهر فوراً.

## الأسباب اللي اتصلّحت
| # | السبب | الإصلاح |
|---|---|---|
| 1 | `zkteco/engine.js::_loadEmployeeMapping` كان يقرأ `deviceUserId` فقط، فيضيع رقم الجهاز البديل (`deviceUserIdAlt`) | صار يقرأ الاثنين + `auto_lock` مثل `attendance-engine.loadEmployeeMapping` |
| 2 | بصمات رُبطت متأخرة بالخام دون إنشاء صف `attendance` | `reconcileAttendance` يعيد `processPunch` للسجلات المرتبطة للتو (بقيد منع الاستخدام المزدوج) |
| 3 | طابور Push كان يختار `queued` فقط؛ `failed` لا يُعاد | poller وworker يختاران `queued OR (failed AND attempts < 5)` |
| 4 | `attendance:updated` لم يكن مسموعاً في v3 | `realtime.ts` يستمع الحدث ويبطل استعلامات TanStack فوراً |
| 5 | migrate للتخمة: `ignored` و`zk_control_audit` كانت تُضاف يدوياً | migration `121_zkteco_control_schema.sql` idempotent |
| 6 | `backup.js` كان يرمي `line.startsWith is not a function` على Buffer | تحويل الخط لـ string قبل startsWith |

## التحقق
- نسخة احتياطية كاملة قبل التغيير: **652.8MB + مرآتين**، SHA-256 موثّق.
- migration 121 طُبّق: نجح 1 / فشل 0.
- Jest: **274/274 حزمة، 3980 اختبار**.
- `pnpm gate` = 0 · الخدمة `Running` · `/api/health/live` = 200.
- بيانات 29 بصمة غير مرتبطة: كلها لأرقام جهاز `NN-82/105/71` بلا موظف مقابل — مش فقدان.

## ملاحظة
المحاسبة (3.1/10) مؤجلة بقرار المستخدم — لم يُمسّ أي قيد أو رقم مالي.
