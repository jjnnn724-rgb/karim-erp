-- 086_drop_shift_schedules.sql — حذف جذري لوحدة جدول الدومات (2026-09-30)
-- الوحدة حُذفت من الكود نهائيًا؛ هذه الجداول لم يعد يقرأها شيء.
-- آمنة التكرار: IF EXISTS في كل سطر.

DROP TABLE IF EXISTS shift_schedule_acks;
DROP TABLE IF EXISTS shift_schedule_days;
DROP TABLE IF EXISTS shift_schedule_events;
DROP TABLE IF EXISTS shift_schedules;
