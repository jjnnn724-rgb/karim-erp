-- 142_account_mapping_guardrails.sql — حراس account_mapping (Phase 3 hardening)
-- ══════════════════════════════════════════════════════════════════════════════
-- ثلاثة حراس، كلها Additive على الجدول القائم (لا تعديل صف قائم):
--   1) مطابقة النوع: كل دور له أنواع حسابات مسموحة في account_mapping_type_rule،
--      وأي INSERT/UPDATE مخالف يفشل ACCOUNT_MAPPING_TYPE_MISMATCH (23514).
--   2) سجل تدقيق: account_mapping_audit يسجّل كل INSERT/UPDATE/DELETE بالقيم
--      القديمة/الجديدة ومن غيّر ومتى ولماذا (coa.mapping_change_reason اختياري).
--   3) قفل الحساب المستخدم: لا يُغيَّر account_code ولا يُحذف الصف إذا كان
--      الحساب القديم عليه قيود posted — إلا بجلسة تعتمد صراحة:
--        SET LOCAL coa.allow_mapping_change = 'on';
--      (نفس نمط 134 في قفل type/normal_balance).
--
-- الدور غير المذكور في جدول الأنواع مسموح (سجل تدقيق فقط) حتى لا نكسر أدوارًا
-- مستقبلية؛ إضافة دور جديد = صف واحد في type_rule بعد مراجعة محاسبية.
-- التطبيق على الإنتاج يحتاج أمر المالك + نسخة احتياطية (مثل 134/135/139/140/141).
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── 1) جدول أنواع الحسابات المسموحة لكل دور ─────────────────────────────────
CREATE TABLE IF NOT EXISTS account_mapping_type_rule (
    role          VARCHAR(40) PRIMARY KEY,
    allowed_types TEXT[]      NOT NULL CHECK (cardinality(allowed_types) > 0),
    note          TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO account_mapping_type_rule (role, allowed_types, note) VALUES
('cash_account',        ARRAY['asset'],           'نقدية — أصل'),
('bank_account',        ARRAY['asset'],           'بنك — أصل'),
('inventory_account',   ARRAY['asset'],           'مخزون — أصل'),
('vat_input_account',   ARRAY['asset'],           'ضريبة مدخلات مستردة — أصل'),
('recoverable_account', ARRAY['asset'],           'ضريبة قابلة للاسترداد — أصل'),
('accumulated_account', ARRAY['asset'],           'مجمع إهلاك — أصل مقابل'),
('payable_account',     ARRAY['liability'],       'دائن/مستحق — التزام'),
('vat_output_account',  ARRAY['liability'],       'ضريبة مخرجات مستحقة — التزام'),
('revenue_account',     ARRAY['revenue'],         'إيراد'),
('cogs_account',        ARRAY['cogs'],            'تكلفة مبيعات'),
('expense_account',     ARRAY['expense','cogs'],  'مصروف (يُسمح بـcogs للتحميل)'),
('cost_account',        ARRAY['expense','cogs'],  'حساب تكلفة تحويل'),
('equity_account',      ARRAY['equity'],          'حقوق ملكية')
ON CONFLICT (role) DO NOTHING;

-- فحص الصفوف القائمة قبل تفعيل الحارس: مخالفة واحدة توقف الهجرة (fail-closed)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT m.module, m.operation, m.role, m.account_code, c.type, t.allowed_types
          FROM account_mapping m
          JOIN account_mapping_type_rule t ON t.role = m.role
          JOIN chart_of_accounts c ON c.code = m.account_code
         WHERE NOT (c.type = ANY (t.allowed_types))
    LOOP
        RAISE EXCEPTION 'ACCOUNT_MAPPING_TYPE_MISMATCH (قائم): %.%.% → % نوعه % المسموح %',
            r.module, r.operation, r.role, r.account_code, r.type, r.allowed_types
            USING ERRCODE = '23514';
    END LOOP;
END $$;

-- ─── 2) سجل التدقيق ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_mapping_audit (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module               VARCHAR(40) NOT NULL,
    operation            VARCHAR(40) NOT NULL,
    role                 VARCHAR(40) NOT NULL,
    action               VARCHAR(6)  NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    old_account_code     VARCHAR(20),
    new_account_code     VARCHAR(20),
    old_active           BOOLEAN,
    new_active           BOOLEAN,
    old_cost_center_policy VARCHAR(20),
    new_cost_center_policy VARCHAR(20),
    changed_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
    changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    db_user              TEXT NOT NULL DEFAULT current_user,
    reason               TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_mapping_audit_key
    ON account_mapping_audit(module, operation, role, changed_at DESC);

-- ─── 3) دالة الحارس (BEFORE) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_account_mapping_guard()
RETURNS trigger AS $$
DECLARE
    v_allowed TEXT[];
    v_type    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(current_setting('coa.allow_mapping_change', TRUE), '') <> 'on'
           AND EXISTS (
               SELECT 1 FROM public.journal_lines jl
                 JOIN public.journal_entries e ON e.id = jl.entry_id
                WHERE jl.account_code = OLD.account_code AND e.status = 'posted'
           ) THEN
            RAISE EXCEPTION 'ACCOUNT_MAPPING_LOCKED: لا يمكن حذف ربط %.%.% — الحساب % عليه قيود مرحّلة (يتطلب SET LOCAL coa.allow_mapping_change = ''on'')',
                OLD.module, OLD.operation, OLD.role, OLD.account_code
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    SELECT allowed_types INTO v_allowed FROM public.account_mapping_type_rule WHERE role = NEW.role;
    IF v_allowed IS NOT NULL THEN
        SELECT type INTO v_type FROM public.chart_of_accounts WHERE code = NEW.account_code;
        IF v_type IS NOT NULL AND NOT (v_type = ANY (v_allowed)) THEN
            RAISE EXCEPTION 'ACCOUNT_MAPPING_TYPE_MISMATCH: الدور % يقبل % لكن الحساب % نوعه %',
                NEW.role, v_allowed, NEW.account_code, v_type
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.account_code IS DISTINCT FROM OLD.account_code
       AND COALESCE(current_setting('coa.allow_mapping_change', TRUE), '') <> 'on'
       AND EXISTS (
           SELECT 1 FROM public.journal_lines jl
             JOIN public.journal_entries e ON e.id = jl.entry_id
            WHERE jl.account_code = OLD.account_code AND e.status = 'posted'
       ) THEN
        RAISE EXCEPTION 'ACCOUNT_MAPPING_LOCKED: لا يمكن تحويل ربط %.%.% بعيدًا عن الحساب % لأن عليه قيود مرحّلة (يتطلب SET LOCAL coa.allow_mapping_change = ''on'')',
            OLD.module, OLD.operation, OLD.role, OLD.account_code
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_mapping_guard ON public.account_mapping;
CREATE TRIGGER trg_account_mapping_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.account_mapping
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_account_mapping_guard();

-- ─── 4) دالة التدقيق (AFTER) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_account_mapping_audit()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.account_mapping_audit
        (module, operation, role, action,
         old_account_code, new_account_code, old_active, new_active,
         old_cost_center_policy, new_cost_center_policy, changed_by, reason)
    VALUES
        (COALESCE(NEW.module, OLD.module),
         COALESCE(NEW.operation, OLD.operation),
         COALESCE(NEW.role, OLD.role),
         TG_OP,
         OLD.account_code, NEW.account_code,
         OLD.active, NEW.active,
         OLD.cost_center_policy, NEW.cost_center_policy,
         COALESCE(NEW.updated_by, OLD.updated_by),
         NULLIF(current_setting('coa.mapping_change_reason', TRUE), ''));
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_mapping_audit ON public.account_mapping;
CREATE TRIGGER trg_account_mapping_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.account_mapping
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_account_mapping_audit();

COMMIT;
