-- 092_payroll_emp_month_unique.sql — FIX 2026-10-03 (Enterprise Stage 6)
-- السباق الموثق والمُثبت تجريبيًا (tests/load/stage3-concurrency-tests.js T3):
-- توليدان متزامنان لـ payroll-runs/generate أنتجا ازدواجية (employeeId, month)
-- لأن المولد find-then-insert بلا قيد فريد ولا قفل (hr-routes.js:606 يعترف بذلك).
-- الإنتاج payroll=0 صفوف → القيد آمن بلا backfill، ويمنع السباق قبل أول استخدام.
-- التوافق: المعاملات القديمة ليست متأثرة (لا صفوف موجودة)؛ التوليد المتزامن
-- بعد القيد: المولد يفشل بمحاولة مكررة 23505 بدل ازدواج صامت — ويُعاد تشغيله.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_emp_month
    ON public."payroll" ("employeeId", month) NULLS NOT DISTINCT;
