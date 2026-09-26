-- Migration 002: Production bootstrap
-- Creates only the initial administrator and core settings.
-- scripts/setup.js migrates the bootstrap password to bcrypt before startup.
BEGIN;
INSERT INTO users (id, username, password, role, name, active) VALUES
(1, 'admin', '__SETUP_PENDING__', 'admin', 'مدير النظام', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (id, name, logo, "logoB64", currency, "lowStockAlert", "workStartHour") VALUES
('main_settings', 'مطاعم الشرفة العالمية', '🍽️', NULL, 'SAR', true, 9)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    currency = EXCLUDED.currency,
    "lowStockAlert" = EXCLUDED."lowStockAlert",
    "workStartHour" = EXCLUDED."workStartHour";
COMMIT;

-- No usable default password, demo users, employees, inventory, orders,
-- revenues, or expenses are seeded. Setup replaces the pending marker with a
-- random one-time credential and forces rotation before operational access.
