-- 106_branch_autostamp.sql — ختم الفرع للصفوف غير المسندة
-- ─────────────────────────────────────────────────────────────────────────────
-- 102_branches أضافت branch_id (NULLable) وملّت الصفوف القائمة على MAIN،
-- لكن كتابات ما بعدها (Yara importer، POS، المخزن، الجرد، الطلبات) لا تمر
-- على مسار الـCRUD العام الذي يختم الفرع، فبقيت كلها NULL. القوائم المفلترة
-- بالفرع (revenues/expenses) لا تراها، بينما تحليل التكاليف في V2 بلا فلتر
-- يراها — فاختلفت الأرقام بين الواجهتين.
--
-- العلاج هنا من الجذر:
--   1) تعبئة كل NULL بالفرع النشط الوحيد (MAIN اليوم).
--   2) trigger قبل الإدراج يختم الفرع النشط الوحيد تلقائيًا لأي كاتب.
-- Guard: إن تعددت الفروع النشطة لا يعبّئ ولا يختم شيئًا (لا تخمين لفرع).
-- الترحيل idempotent: إعادة تشغيله لا تغيّر صفًا ولا تنشئ trigger مكررًا.

BEGIN;

CREATE OR REPLACE FUNCTION stamp_single_active_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    active_count integer;
    active_id integer;
BEGIN
    IF NEW.branch_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT COUNT(*), MIN(id) INTO active_count, active_id
      FROM branches WHERE is_active = TRUE;
    IF active_count = 1 THEN
        NEW.branch_id := active_id;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    active_count integer;
    active_id integer;
BEGIN
    SELECT COUNT(*), MIN(id) INTO active_count, active_id
      FROM branches WHERE is_active = TRUE;
    IF active_count <> 1 THEN
        RAISE NOTICE 'branch autostamp: % active branches — backfill skipped', active_count;
        RETURN;
    END IF;

    UPDATE users               SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE employees           SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE attendance          SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE pos_orders          SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE pos_shift_sessions  SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE pos_day_closes      SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE expenses            SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE revenues            SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE journal_entries     SET branch_id = active_id WHERE branch_id IS NULL;
    UPDATE "purchaseInvoices"  SET branch_id = active_id WHERE branch_id IS NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_branch_users ON users;
CREATE TRIGGER trg_stamp_branch_users BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_employees ON employees;
CREATE TRIGGER trg_stamp_branch_employees BEFORE INSERT ON employees
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_attendance ON attendance;
CREATE TRIGGER trg_stamp_branch_attendance BEFORE INSERT ON attendance
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_pos_orders ON pos_orders;
CREATE TRIGGER trg_stamp_branch_pos_orders BEFORE INSERT ON pos_orders
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_pos_shift_sessions ON pos_shift_sessions;
CREATE TRIGGER trg_stamp_branch_pos_shift_sessions BEFORE INSERT ON pos_shift_sessions
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_pos_day_closes ON pos_day_closes;
CREATE TRIGGER trg_stamp_branch_pos_day_closes BEFORE INSERT ON pos_day_closes
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_expenses ON expenses;
CREATE TRIGGER trg_stamp_branch_expenses BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_revenues ON revenues;
CREATE TRIGGER trg_stamp_branch_revenues BEFORE INSERT ON revenues
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_journal_entries ON journal_entries;
CREATE TRIGGER trg_stamp_branch_journal_entries BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

DROP TRIGGER IF EXISTS trg_stamp_branch_purchase_invoices ON "purchaseInvoices";
CREATE TRIGGER trg_stamp_branch_purchase_invoices BEFORE INSERT ON "purchaseInvoices"
FOR EACH ROW EXECUTE FUNCTION stamp_single_active_branch();

COMMIT;
