-- Migration 006: Production master data
-- This migration intentionally contains reference data only.
-- Transactional data (employees, inventory, menu products, orders, revenues,
-- expenses, payroll, attendance and notifications) is created through the UI/API.
BEGIN;

INSERT INTO departments (id, code, name, icon, color) VALUES
(101, 'MAL', 'الماليزي', '🍜', '#e91e63'),
(102, 'EXT', 'البيع الخارجي', '🚚', '#ff9800'),
(103, 'JUC', 'العصائر', '🥤', '#2ecc71'),
(104, 'COF', 'الكوفي شوب', '☕', '#795548'),
(105, 'GRILL', 'المشاوي', '🍗', '#c0392b')
ON CONFLICT (id) DO NOTHING;

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

-- POS departments are synchronized dynamically from departments by the API.
-- No fixed menu products or stock quantities are inserted here.
COMMIT;
