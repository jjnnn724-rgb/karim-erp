-- 134_coa_foundation.sql — Phase 2 FOUNDATION (Additive فقط) — 2026-11-05
-- ══════════════════════════════════════════════════════════════════════════════
-- القاعدة الذهبية لهذا الملف: لا حذف، لا إعادة تسمية، لا إعادة ترميز، لا تغيير
-- دلالة حساب قائم. كل ما هنا إضافي (أعمدة nullable + جداول جديدة + triggers).
-- يُطبّق على karim_erp_test أولًا، ثم staging، وبموافقة صريحة + نسخة احتياطية على الإنتاج.
--
-- المحتوى:
--   1) أعمدة ميتاداتا على chart_of_accounts (nullable — لا تكسر أي INSERT قائم)
--   2) Backfill آمن: normal_balance من type فقط
--   3) Trigger منع الدورة و«الحساب أب لنفسه» (قبل أي أب ينتقل لاحقًا)
--   4) Trigger منع تغيير type/normal_balance لحساب مستخدم في قيود posted
--   5) جداول: account_fs_mapping (تصنيف القوائم لكل حساب مستقل عن الشجرة)
--              account_mapping   (module.operation.role → account_code)
--              posting_failures  (طابور قيود فاشلة بدل الصمت)
--   6) بذرة account_mapping من ثوابت الكود الحالية — صفر تغيير سلوكي
-- ──────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ─── 1) أعمدة ميتاداتا (nullable بالكامل) ─────────────────────────────────────
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS account_subtype      VARCHAR(40);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS normal_balance       VARCHAR(6);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS fs_classification    VARCHAR(20);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS cash_flow_class      VARCHAR(20);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS tax_category         VARCHAR(30);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_control           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_suspense          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_reconcilable      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS accounting_policy_ref TEXT;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS effective_from       DATE;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS effective_to         DATE;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS updated_by           BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ;

-- ─── 2) Backfill آمن: normal_balance من type فقط (deterministic) ─────────────
UPDATE chart_of_accounts
   SET normal_balance = CASE
       WHEN type IN ('asset','cogs','expense') THEN 'debit'
       WHEN type IN ('liability','equity','revenue') THEN 'credit'
   END
 WHERE normal_balance IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coa_normal_balance_check') THEN
        ALTER TABLE chart_of_accounts
            ADD CONSTRAINT coa_normal_balance_check
            CHECK (normal_balance IN ('debit','credit')) NOT VALID;
        ALTER TABLE chart_of_accounts VALIDATE CONSTRAINT coa_normal_balance_check;
    END IF;
END $$;

-- تصنيف قوائم خشن كنقطة بداية (مراجعة محاسبية مطلوبة للبنود التفصيلية في Phase 4)
UPDATE chart_of_accounts SET fs_classification = CASE
    WHEN type IN ('asset','liability','equity') THEN 'BS'
    ELSE 'IS'
END WHERE fs_classification IS NULL;

CREATE INDEX IF NOT EXISTS idx_coa_fs_classification ON chart_of_accounts(fs_classification);
CREATE INDEX IF NOT EXISTS idx_coa_suspense ON chart_of_accounts(is_suspense) WHERE is_suspense;

-- ─── 3) منع الدورة و«الحساب أب لنفسه» ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_coa_no_cycle()
RETURNS trigger AS $$
DECLARE
    v_current VARCHAR(20);
    v_hops    INT := 0;
BEGIN
    IF NEW.parent_code IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_code = NEW.code THEN
        RAISE EXCEPTION 'COA_SELF_PARENT: الحساب % لا يمكن أن يكون أبًا لنفسه', NEW.code
            USING ERRCODE = '23514';
    END IF;
    v_current := NEW.parent_code;
    WHILE v_current IS NOT NULL LOOP
        v_hops := v_hops + 1;
        IF v_hops > 100 THEN
            RAISE EXCEPTION 'COA_TOO_DEEP: مسار شجرة الحسابات أعمق من 100 مستوى عند %', NEW.code
                USING ERRCODE = '23514';
        END IF;
        IF v_current = NEW.code THEN
            RAISE EXCEPTION 'COA_CYCLE: تعيين الأب % للحساب % ينشئ دورة في شجرة الحسابات', NEW.parent_code, NEW.code
                USING ERRCODE = '23514';
        END IF;
        SELECT parent_code INTO v_current FROM public.chart_of_accounts WHERE code = v_current;
        IF NOT FOUND THEN
            EXIT; -- الأب غير موجود — الـ FK سيرفض ذلك (اتساق محفوظ)
        END IF;
    END LOOP;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coa_no_cycle ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_no_cycle
    BEFORE INSERT OR UPDATE OF parent_code ON public.chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_coa_no_cycle();

-- ─── 4) تثبيت النوع والطبيعة لحساب مستخدم في قيود posted ─────────────────────
-- التغيير مسموح فقط بجلسة تضع:  SET LOCAL coa.allow_type_change = 'on';  (إجراء موثّق ثنائي)
CREATE OR REPLACE FUNCTION public.trg_fn_coa_lock_posted_semantics()
RETURNS trigger AS $$
BEGIN
    IF (OLD.type IS DISTINCT FROM NEW.type OR OLD.normal_balance IS DISTINCT FROM NEW.normal_balance)
       AND EXISTS (
           SELECT 1
             FROM public.journal_lines jl
             JOIN public.journal_entries e ON e.id = jl.entry_id
            WHERE jl.account_code = OLD.code
              AND e.status = 'posted'
       )
       AND COALESCE(current_setting('coa.allow_type_change', TRUE), '') <> 'on' THEN
        RAISE EXCEPTION 'COA_SEMANTICS_LOCKED: لا يمكن تغيير type/normal_balance للحساب % لأنه مستخدم في قيود مرحّلة — التغيير يتطلب إجراءً موثقًا (SET LOCAL coa.allow_type_change = ''on'')', OLD.code
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coa_lock_posted_semantics ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_lock_posted_semantics
    BEFORE UPDATE OF type, normal_balance ON public.chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_coa_lock_posted_semantics();

-- ─── 5) جدول تصنيف القوائم لكل حساب مستقل عن الشجرة ──────────────────────────
CREATE TABLE IF NOT EXISTS account_fs_mapping (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    statement     VARCHAR(10)  NOT NULL CHECK (statement IN ('BS','IS','CF','SOCE','TB')),
    section_code  VARCHAR(20)  NOT NULL,               -- e.g. BS.CA, IS.REV, CF.OPERATING
    line_code     VARCHAR(30)  NOT NULL,               -- e.g. BS.CA.CASH, IS.REV.NET_SALES
    account_code  VARCHAR(20)  NOT NULL REFERENCES chart_of_accounts(code) ON DELETE CASCADE,
    side          VARCHAR(6)   NOT NULL DEFAULT 'balance' CHECK (side IN ('debit','credit','balance')),
    sign          SMALLINT     NOT NULL DEFAULT 1 CHECK (sign IN (1, -1)),
    priority      INT          NOT NULL DEFAULT 100,
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    valid_from    DATE,
    valid_to      DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    BIGINT       REFERENCES users(id) ON DELETE SET NULL
);
-- قيد فريد جزئي: صف واحد نشط لكل (قائمة، بند، حساب) — NULL في valid_from لا يُضعف التفرّد
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsmap_open ON account_fs_mapping(statement, line_code, account_code) WHERE valid_from IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsmap_dated ON account_fs_mapping(statement, line_code, account_code, valid_from) WHERE valid_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsmap_statement_line ON account_fs_mapping(statement, line_code) WHERE active;
CREATE INDEX IF NOT EXISTS idx_fsmap_account ON account_fs_mapping(account_code) WHERE active;

-- ─── 5b) جدول ربط الوحدات بالحسابات (بديل الثوابت المتناثرة) ─────────────────
CREATE TABLE IF NOT EXISTS account_mapping (
    module        VARCHAR(40) NOT NULL,
    operation     VARCHAR(40) NOT NULL,
    role          VARCHAR(40) NOT NULL,
    account_code  VARCHAR(20) NOT NULL REFERENCES chart_of_accounts(code),
    cost_center_policy VARCHAR(20),   -- optional hint: e.g. 'required' | 'inherit' | NULL
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    note          TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (module, operation, role)
);
CREATE INDEX IF NOT EXISTS idx_acctmap_code ON account_mapping(account_code);

INSERT INTO account_mapping (module, operation, role, account_code, note) VALUES
('sales_pos','pos_sale','cash_account','1000','legacy constant — accounting-routes.js'),
('sales_pos','pos_sale','bank_account','1010','legacy constant'),
('sales_pos','pos_sale','revenue_account','4000','legacy constant'),
('sales_pos','pos_sale','vat_output_account','2100','legacy constant'),
('sales_pos','pos_sale','cogs_account','5000','legacy constant'),
('sales_pos','void','cash_account','1000','legacy constant — pos-void-lines.js'),
('sales_pos','void','bank_account','1010','legacy constant'),
('sales_pos','void','revenue_account','4000','legacy constant'),
('sales_pos','void','vat_output_account','2100','legacy constant'),
('sales_pos','void','cogs_account','5000','legacy constant'),
('purchases','purchase_invoice','vat_input_account','1150','legacy constant (ضريبة مدخلات وسيطة — بانتظار سياسة تصفية)'),
('purchases','purchase_invoice','payable_account','2000','legacy constant'),
('payroll','payroll_run','expense_account','6000','legacy constant'),
('payroll','payroll_run','payable_account','2200','legacy constant'),
('assets','depreciation_run','expense_account','6600','legacy constant'),
('assets','depreciation_run','accumulated_account','1520','legacy constant'),
('yarasoft','gl_bridge','cash_account','1000','legacy constant — gl-bridge.js'),
('yarasoft','gl_bridge','revenue_account','4000','legacy constant (net, no VAT — policy)'),
('yarasoft','prebooks','equity_account','3100','legacy constant — pre-cutover opening'),
('inventory','dispatch_load','revenue_account','4000','legacy constant — dept-transfer-routes.js'),
('inventory','dispatch_load','cogs_account','5000','legacy constant'),
('inventory','dispatch_unload','revenue_account','4000','legacy constant'),
('inventory','dispatch_unload','cogs_account','5000','legacy constant'),
('tax','vat_return','payable_account','2100','legacy constant — VAT return'),
('tax','vat_return','recoverable_account','1150','legacy constant')
ON CONFLICT (module, operation, role) DO NOTHING;

-- ─── 5c) طابور القيود الفاشلة (لا صمت بعد اليوم) ─────────────────────────────
CREATE TABLE IF NOT EXISTS posting_failures (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module       VARCHAR(40) NOT NULL,
    source_type  VARCHAR(60) NOT NULL,
    source_id    VARCHAR(120),
    payload      JSONB,
    error        TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_posting_failures_open
    ON posting_failures(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posting_failures_source
    ON posting_failures(source_type, source_id);

COMMIT;
