-- ============================================================
-- Migration 005: Performance Indexes for Pagination & Sorting
-- ============================================================
-- Phase 2.2: Add indexes on commonly filtered/sorted columns.
-- These indexes optimize: WHERE clauses, ORDER BY, JOINs.
--
-- IMPORTANT: Column names MUST match the actual schema in
--   database/migrations/001_schema.sql (camelCase quoted
--   identifiers for legacy tables: "employeeId", "deptId",
--   "minQty", "shelfId", etc.). snake_case columns only
--   exist on the pos_* tables created in migration 003.
--
-- Created: 2026-07-17
-- Applies to: PostgreSQL 12+
-- ============================================================

BEGIN;

-- ─── Users Table Indexes ─────────────────────────────────────
-- Schema: users(id, username, password, role, name, active)
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active     ON users(active) WHERE active = false;

-- ─── Employees Table Indexes ────────────────────────────────
-- Schema: employees(... "employeeId", department, status, "userId" ...)
CREATE INDEX IF NOT EXISTS idx_employees_employeeId ON employees("employeeId");
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department) WHERE department IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_status     ON employees(status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_userId     ON employees("userId") WHERE "userId" IS NOT NULL;

-- ─── Attendance Table Indexes ───────────────────────────────
-- Schema: attendance("employeeId", date, "checkIn", "checkOut", late)
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance("employeeId", date);
CREATE INDEX IF NOT EXISTS idx_attendance_date          ON attendance(date);

-- ─── Leave Requests Indexes ─────────────────────────────────
-- Schema: "leaveRequests"("employeeId", "leaveTypeId", "startDate", "endDate", status)
CREATE INDEX IF NOT EXISTS idx_leaverequests_employee ON "leaveRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_leaverequests_status   ON "leaveRequests"(status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leaverequests_type     ON "leaveRequests"("leaveTypeId");
CREATE INDEX IF NOT EXISTS idx_leaverequests_dates    ON "leaveRequests"("startDate", "endDate");

-- ─── Payroll Indexes ────────────────────────────────────────
-- Schema: payroll("employeeId", month, year, status)
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll("employeeId");
CREATE INDEX IF NOT EXISTS idx_payroll_period   ON payroll(month, year);
CREATE INDEX IF NOT EXISTS idx_payroll_status   ON payroll(status) WHERE status IS NOT NULL;

-- ─── Inventory Indexes ──────────────────────────────────────
-- Schema: inventory(name, category, unit, qty, "avgCost", "minQty", "shelfId", weight)
CREATE INDEX IF NOT EXISTS idx_inventory_shelf     ON inventory("shelfId") WHERE "shelfId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_category  ON inventory(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_quantity  ON inventory(qty);
-- Partial index for low-stock queries (very common): qty <= minQty
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory(id) WHERE qty <= "minQty" AND "minQty" IS NOT NULL;

-- ─── Inventory Transactions ("inventoryTx") ─────────────────
-- Schema: "inventoryTx"("itemId", "itemName", qty, type, date, cost, ...)
CREATE INDEX IF NOT EXISTS idx_inventorytx_item ON "inventoryTx"("itemId");
CREATE INDEX IF NOT EXISTS idx_inventorytx_type ON "inventoryTx"(type) WHERE type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventorytx_date ON "inventoryTx"(date);

-- ─── Dispatches Indexes ─────────────────────────────────────
-- Schema: dispatches("deptCode", "deptName", items, status, date, "createdBy")
CREATE INDEX IF NOT EXISTS idx_dispatches_status  ON dispatches(status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatches_deptCode ON dispatches("deptCode");
CREATE INDEX IF NOT EXISTS idx_dispatches_date     ON dispatches(date);

-- ─── Purchase Invoices ("purchaseInvoices") ─────────────────
-- Schema: "purchaseInvoices"("invoiceNumber", date, "supplierName", "totalAmount", ...)
CREATE INDEX IF NOT EXISTS idx_purchaseinvoices_supplier ON "purchaseInvoices"("supplierName") WHERE "supplierName" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchaseinvoices_date     ON "purchaseInvoices"(date);

-- ─── Expenses / Revenues Indexes ────────────────────────────
-- Schema: expenses("deptId", "desc", amount, date)
-- Schema: revenues("deptId", source, amount, date)
CREATE INDEX IF NOT EXISTS idx_expenses_dept   ON expenses("deptId");
CREATE INDEX IF NOT EXISTS idx_expenses_date   ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_revenues_dept   ON revenues("deptId");
CREATE INDEX IF NOT EXISTS idx_revenues_date   ON revenues(date);

-- ─── Notifications Indexes ──────────────────────────────────
-- Schema: notifications(title, message, type, date, read)
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(date);

-- ─── Settings Indexes ───────────────────────────────────────
-- Schema: settings(id VARCHAR PK, name, currency, ...)
-- Primary key index already exists; no additional indexes needed.

-- ─── HR Departments / Departments ───────────────────────────
-- Schema: "hrDepartments"(id, name, code, manager)
-- Schema: departments(id, code, name, icon, color)
CREATE INDEX IF NOT EXISTS idx_hrdepartments_code ON "hrDepartments"(code);
CREATE INDEX IF NOT EXISTS idx_departments_code  ON departments(code);

-- ─── Kitchen Returns / Weight Readings ──────────────────────
-- Schema: "kitchenReturns"(date, items, status)
-- Schema: "weightReadings"(weight, unit, date, "itemId")
CREATE INDEX IF NOT EXISTS idx_kitchenreturns_date ON "kitchenReturns"(date);
CREATE INDEX IF NOT EXISTS idx_weightreadings_date ON "weightReadings"(date);
CREATE INDEX IF NOT EXISTS idx_weightreadings_item ON "weightReadings"("itemId");

-- ─── POS Module Tables (snake_case — from migration 003) ────
-- These tables have high traffic and benefit from extra indexes.
CREATE INDEX IF NOT EXISTS idx_pos_orders_session    ON pos_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_cashier    ON pos_orders(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_status     ON pos_orders(status);
CREATE INDEX IF NOT EXISTS idx_pos_orders_created_at ON pos_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_order ON pos_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_product ON pos_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_pos_invoice_payments_order ON pos_invoice_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_invoice_payments_method ON pos_invoice_payments(method);
CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_cashier_status ON pos_shift_sessions(cashier_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_dept_status   ON pos_shift_sessions(department_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_products_barcode   ON pos_products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_products_dept      ON pos_products(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_zatca_queue_status ON pos_zatca_invoice_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_pos_pending_prints_status ON pos_pending_prints(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_pos_idempotency_expires ON pos_idempotency_keys(expires_at);

COMMIT;

-- ============================================================
-- Verification Query (run after migration):
-- ============================================================
-- SELECT indexname, tablename
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
-- ============================================================
