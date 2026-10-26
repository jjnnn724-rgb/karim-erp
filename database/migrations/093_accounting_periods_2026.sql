-- 093_accounting_periods_2026.sql — FIX R20 (Enterprise Stage 6, 2026-10-03)
-- جدول الفترات كان فارغًا (القفل نائم). توليد فترات السنة الحالية بحالة
-- مفتوحة = صفر تغيير سلوكي فوري (assertPeriodOpen يمنع فقط عند closed=true)
-- لكنه يفعّل القدرة: إقفال شهر من CFO/periods يمنع فورًا أي قيد أو بيع فيه
-- (complete-sale أُضيف له فحص الفترة في نفس الجولة).
INSERT INTO public.accounting_periods (period, closed)
SELECT y || '-' || LPAD(m::text, 2, '0'), false
FROM generate_series(2026, 2026) y, generate_series(1, 12) m
ON CONFLICT (period) DO NOTHING;
