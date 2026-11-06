-- 132_subledger_architecture.sql — الحسابات المساعدة للموردين والعملاء والمطابقة الآلية
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- قرار الحوكمة المالية 2026-11-03:
-- ربط الحسابات المساعدة بالدفتر العام (General Ledger Integration):
--   1. إنشاء جدول العملاء وإدارة الذمم المدينة (AR Customers) للحفلات والشركات ومنصات التوصيل.
--   2. ربط حسابات المراقبة الرقابية (Control Accounts):
--      - الموردون AP Control = 2000
--      - العملاء AR Control = 1300
--      - منصات التوصيل Aggregators Control = 1310
--   3. جدول حركات وتتبع الذمم المدينة (customer_transactions).
--   4. منظومة مطابقة الأستاذ المساعد مع الأستاذ العام (Subledger Reconciliation Views).
--
-- idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. جدول العملاء وإدارة الذمم المدينة (Customers Subledger) ───
CREATE TABLE IF NOT EXISTS customers (
    id BIGINT PRIMARY KEY,
    code VARCHAR(50) UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'corporate' CHECK (category IN ('corporate', 'catering', 'delivery_platform', 'individual')),
    phone VARCHAR(50),
    vat_number VARCHAR(50),
    credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    control_account_code VARCHAR(20) NOT NULL DEFAULT '1300' REFERENCES chart_of_accounts(code),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_category ON customers(category);
CREATE INDEX IF NOT EXISTS idx_customers_control_account ON customers(control_account_code);

-- ─── 2. جدول حركات الذمم المدينة ومقبوضات العملاء (Customer Transactions) ───
CREATE TABLE IF NOT EXISTS customer_transactions (
    id BIGINT PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    trans_date DATE NOT NULL,
    trans_type VARCHAR(30) NOT NULL CHECK (trans_type IN ('invoice', 'payment', 'return', 'adjustment')),
    reference_no VARCHAR(100),
    debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    journal_entry_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
    memo TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_cust_trans_side CHECK ((debit > 0)::int + (credit > 0)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_cust_trans_customer ON customer_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_trans_date ON customer_transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_cust_trans_journal ON customer_transactions(journal_entry_id);

-- ─── 3. بذور منصات التوصيل الرئيسية كعملاء ذمم معتمدين ───
INSERT INTO customers (id, code, name, category, control_account_code) VALUES
(8001, 'CUST-JAHEZ', 'شركة جاهز الدولية (منصة توصيل)', 'delivery_platform', '1310'),
(8002, 'CUST-HUNGER', 'شركة هنقرستيشن (منصة توصيل)', 'delivery_platform', '1310'),
(8003, 'CUST-TOYOU', 'شركة تويو (منصة توصيل)', 'delivery_platform', '1310'),
(8004, 'CUST-NINJA', 'شركة نينجا (منصة توصيل)', 'delivery_platform', '1310')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. عرض مطابقة الأستاذ المساعد للموردين مع الأستاذ العام (AP Reconciliation View) ───
CREATE OR REPLACE VIEW view_ap_reconciliation AS
WITH subledger_totals AS (
    SELECT 
        COALESCE(SUM("totalAmount"), 0)::numeric(14,2) AS total_invoiced,
        COALESCE(SUM("paidAmount"), 0)::numeric(14,2) AS total_paid,
        (COALESCE(SUM("totalAmount"), 0) - COALESCE(SUM("paidAmount"), 0))::numeric(14,2) AS subledger_balance
    FROM "purchaseInvoices"
    WHERE "paymentStatus" <> 'cancelled' OR "paymentStatus" IS NULL
),
gl_totals AS (
    SELECT 
        COALESCE(SUM(l.credit - l.debit), 0)::numeric(14,2) AS gl_balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    WHERE l.account_code = '2000'
)
SELECT 
    s.subledger_balance,
    g.gl_balance,
    (s.subledger_balance - g.gl_balance)::numeric(14,2) AS variance,
    CASE WHEN ABS(s.subledger_balance - g.gl_balance) < 0.01 THEN 'MATCHED' ELSE 'DISCREPANCY' END AS status
FROM subledger_totals s CROSS JOIN gl_totals g;

-- ─── 5. عرض مطابقة الأستاذ المساعد للعملاء مع الأستاذ العام (AR Reconciliation View) ───
CREATE OR REPLACE VIEW view_ar_reconciliation AS
WITH subledger_totals AS (
    SELECT 
        COALESCE(SUM(debit - credit), 0)::numeric(14,2) AS subledger_balance
    FROM customer_transactions
),
gl_totals AS (
    SELECT 
        COALESCE(SUM(l.debit - l.credit), 0)::numeric(14,2) AS gl_balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    WHERE l.account_code IN ('1300', '1310', '1320')
)
SELECT 
    s.subledger_balance,
    g.gl_balance,
    (s.subledger_balance - g.gl_balance)::numeric(14,2) AS variance,
    CASE WHEN ABS(s.subledger_balance - g.gl_balance) < 0.01 THEN 'MATCHED' ELSE 'DISCREPANCY' END AS status
FROM subledger_totals s CROSS JOIN gl_totals g;

COMMIT;
