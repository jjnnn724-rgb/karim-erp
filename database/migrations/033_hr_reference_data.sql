-- 033_hr_reference_data.sql — HR reference data required by employee workflows
-- Reference rows only; no transactional employees, attendance or payroll data.
BEGIN;

INSERT INTO "hrDepartments" (id, name, code, manager) VALUES
  (201, 'المطبخ', 'KITCHEN', 'رئيس الطهاة'),
  (202, 'الخدمة', 'SERVICE', 'مدير الخدمة'),
  (203, 'المخزن', 'WAREHOUSE', 'أمين المخزن'),
  (204, 'الإدارة', 'ADMIN', 'المدير العام'),
  (205, 'المشاوي', 'GRILL', 'شيف المشاوي')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "leaveTypes" (id, name, days, icon, paid) VALUES
  (601, 'إجازة سنوية', 21, '🏖️', true),
  (602, 'إجازة مرضية', 30, '🏥', true),
  (603, 'إجازة طارئة', 7, '🚨', false),
  (604, 'إجازة بدون راتب', 0, '📝', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
