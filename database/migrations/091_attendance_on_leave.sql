-- 091_attendance_on_leave.sql — سد فجوة مخطط: عمود يكتبه محرك الحضور بلا ترحيل
-- attendance-engine.js (handleCheckIn/handleCheckOut) يكتب on_leave منذ إدخال
-- الإجازات المعتمدة في المحرك، لكن العمود لم يُنشأ في أي ترحيل — كان موجودًا في
-- قواعد الإنتاج القديمة فقط. تثبيت نظيف كان سيفشل عند أول بصمة (column does not exist).
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS on_leave BOOLEAN NOT NULL DEFAULT FALSE;
