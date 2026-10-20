-- 105_schema_parity.sql — تطابق المخطط مع الإنتاج (2026-10-21)
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة: بعض الجداول والأعمدة أُنشئت على قواعد الإنتاج وقت التشغيل
-- (ensureXxxSchema) أو يدويًا، بلا migration — فأي بناء جديد من الترحيلات
-- ينتج مخططًا مختلفًا (تنقصه جداول وأعمدة).
--
-- هذا الملف يجعل المخطط قابلًا لإعادة الإنتاج: يضيف ما ينقص،
-- مستخرجًا آليًا من مخطط الإنتاج الفعلي (pg_dump --schema-only) —
-- لا كتابة يدوية، ولا بيانات (DDL فقط).
--
-- idempotent: كل جملة بصيغة IF NOT EXISTS أو محمية بـDO guard،
-- فإعادة التطبيق لا تفعل شيئًا جديدًا ولا تفشل.
--
-- ملاحظة: جداول استيراد Oracle (ora_*) تُنشأ وقت التشغيل بحكم تصميمها
-- (محرّك المزامنة) — لا تُدرج هنا.

-- ── 1) الجداول الناقصة ─────────────────────────────────────────────
-- admin_delete_audit, hr_card_settings, internal_chat, kitchen_production_distributions, menu_board_items, menu_board_settings_meta, notification_reads, pos_print_settings, roster_approvals, user_change_log, veg_requests, yarasoft_quality_quarantine, yarasoft_revenue_map, yarasoft_unmapped_sections, zatca_settings

CREATE TABLE IF NOT EXISTS public.admin_delete_audit (
    id bigint NOT NULL,
    entity text NOT NULL,
    record_id text NOT NULL,
    deleted_by text,
    deleted_by_id bigint,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.admin_delete_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.admin_delete_audit_id_seq OWNED BY public.admin_delete_audit.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.hr_card_settings (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.internal_chat (
    id bigint NOT NULL,
    from_user_id bigint,
    from_name character varying(120) DEFAULT '—'::character varying NOT NULL,
    from_device character varying(160) DEFAULT ''::character varying NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    to_user_id bigint
);

CREATE SEQUENCE IF NOT EXISTS public.internal_chat_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.internal_chat_id_seq OWNED BY public.internal_chat.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.kitchen_production_distributions (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    destination_type character varying(20) DEFAULT 'channel'::character varying NOT NULL,
    destination_code character varying(80) NOT NULL,
    destination_name character varying(200) NOT NULL,
    department_id bigint,
    allocated_qty numeric(14,4) NOT NULL,
    notes text,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT kitchen_production_distributions_allocated_qty_check CHECK ((allocated_qty > (0)::numeric)),
    CONSTRAINT kitchen_production_distributions_destination_type_check CHECK (((destination_type)::text = ANY (ARRAY[('department'::character varying)::text, ('channel'::character varying)::text, ('custom'::character varying)::text])))
);

CREATE SEQUENCE IF NOT EXISTS public.kitchen_production_distributions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.kitchen_production_distributions_id_seq OWNED BY public.kitchen_production_distributions.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.menu_board_items (
    id integer NOT NULL,
    name_ar character varying(120) NOT NULL,
    name_en character varying(120),
    section character varying(20) DEFAULT 'mains'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.menu_board_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.menu_board_items_id_seq OWNED BY public.menu_board_items.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.menu_board_settings_meta (
    key character varying(60) NOT NULL,
    value text,
    at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
    notification_id bigint NOT NULL,
    user_id bigint NOT NULL,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pos_print_settings (
    id smallint DEFAULT 1 NOT NULL,
    kot_enabled boolean DEFAULT true NOT NULL,
    kot_copies smallint DEFAULT 1 NOT NULL,
    kot_include_notes boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by text,
    CONSTRAINT pos_print_settings_id_check CHECK ((id = 1)),
    CONSTRAINT pos_print_settings_kot_copies_check CHECK (((kot_copies >= 1) AND (kot_copies <= 3)))
);

CREATE TABLE IF NOT EXISTS public.roster_approvals (
    id bigint NOT NULL,
    dept_key text NOT NULL,
    week_start date NOT NULL,
    requested_by bigint,
    requested_name text,
    requested_at timestamp with time zone,
    approved_by bigint,
    approved_name text,
    approved_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.user_change_log (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    field character varying(40) NOT NULL,
    old_value text,
    new_value text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.user_change_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.user_change_log_id_seq OWNED BY public.user_change_log.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.veg_requests (
    id bigint NOT NULL,
    request_no character varying(24),
    created_by bigint NOT NULL,
    created_by_name character varying(120),
    created_by_role character varying(40),
    department character varying(80) DEFAULT 'مطبخ'::character varying NOT NULL,
    priority character varying(10) DEFAULT 'normal'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    items jsonb NOT NULL,
    items_count integer DEFAULT 0 NOT NULL,
    notes text,
    received_by bigint,
    received_by_name character varying(120),
    received_at timestamp with time zone,
    cancelled_by bigint,
    cancelled_by_name character varying(120),
    cancelled_reason text,
    print_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    received_by_dept character varying(80),
    total numeric(14,2),
    priced_by bigint,
    priced_by_name character varying(120),
    priced_at timestamp with time zone,
    expense_id bigint,
    CONSTRAINT veg_requests_priority_check CHECK (((priority)::text = ANY (ARRAY[('normal'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT veg_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'received'::character varying, 'priced'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE SEQUENCE IF NOT EXISTS public.veg_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.veg_requests_id_seq OWNED BY public.veg_requests.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.yarasoft_quality_quarantine (
    id bigint NOT NULL,
    kind character varying(32) NOT NULL,
    ref_code text,
    ref_name text,
    qty numeric(14,4),
    value_amount numeric(14,2),
    unit_cost numeric(14,2),
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.yarasoft_quality_quarantine_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.yarasoft_quality_quarantine_id_seq OWNED BY public.yarasoft_quality_quarantine.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.yarasoft_revenue_map (
    id bigint NOT NULL,
    src_table character varying(32) NOT NULL,
    src_name text,
    dept_code character varying(50) NOT NULL,
    display_ar character varying(255) NOT NULL,
    display_en character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.yarasoft_revenue_map_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.yarasoft_revenue_map_id_seq OWNED BY public.yarasoft_revenue_map.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.yarasoft_unmapped_sections (
    id bigint NOT NULL,
    src_table character varying(32) NOT NULL,
    src_name text NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    invoices_count integer DEFAULT 0 NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.yarasoft_unmapped_sections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$ BEGIN
    EXECUTE $ddl$ ALTER SEQUENCE public.yarasoft_unmapped_sections_id_seq OWNED BY public.yarasoft_unmapped_sections.id; $ddl$;
END $$;

CREATE TABLE IF NOT EXISTS public.zatca_settings (
    id smallint DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    environment character varying(20) DEFAULT 'developer_portal'::character varying NOT NULL,
    api_base text,
    seller_name text,
    vat_number character varying(20),
    crn character varying(40),
    address text,
    branch_name text,
    eid character varying(60),
    solution_name text,
    csid text,
    csid_obtained_at timestamp with time zone,
    csr_pem text,
    private_key_pem text,
    poll_in_server boolean DEFAULT true NOT NULL,
    max_attempts smallint DEFAULT 10 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint,
    CONSTRAINT zatca_settings_id_check CHECK ((id = 1))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_delete_audit_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.admin_delete_audit
    ADD CONSTRAINT admin_delete_audit_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_card_settings_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.hr_card_settings
    ADD CONSTRAINT hr_card_settings_pkey PRIMARY KEY (key); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_chat_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.internal_chat
    ADD CONSTRAINT internal_chat_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_production_distributions_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.kitchen_production_distributions
    ADD CONSTRAINT kitchen_production_distributions_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_board_items_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.menu_board_items
    ADD CONSTRAINT menu_board_items_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_board_settings_meta_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.menu_board_settings_meta
    ADD CONSTRAINT menu_board_settings_meta_pkey PRIMARY KEY (key); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_reads_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (notification_id, user_id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_print_settings_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.pos_print_settings
    ADD CONSTRAINT pos_print_settings_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_approvals_dept_key_week_start_key') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.roster_approvals
    ADD CONSTRAINT roster_approvals_dept_key_week_start_key UNIQUE (dept_key, week_start); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_approvals_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.roster_approvals
    ADD CONSTRAINT roster_approvals_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_change_log_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.user_change_log
    ADD CONSTRAINT user_change_log_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'veg_requests_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.veg_requests
    ADD CONSTRAINT veg_requests_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'veg_requests_request_no_key') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.veg_requests
    ADD CONSTRAINT veg_requests_request_no_key UNIQUE (request_no); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'yarasoft_quality_quarantine_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.yarasoft_quality_quarantine
    ADD CONSTRAINT yarasoft_quality_quarantine_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'yarasoft_revenue_map_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.yarasoft_revenue_map
    ADD CONSTRAINT yarasoft_revenue_map_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'yarasoft_unmapped_sections_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.yarasoft_unmapped_sections
    ADD CONSTRAINT yarasoft_unmapped_sections_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zatca_settings_pkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.zatca_settings
    ADD CONSTRAINT zatca_settings_pkey PRIMARY KEY (id); $ddl$;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_internal_chat_created ON public.internal_chat USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_chat_pair ON public.internal_chat USING btree (from_user_id, to_user_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_kitchen_production_distributions_batch ON public.kitchen_production_distributions USING btree (batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kitchen_production_distributions_destination ON public.kitchen_production_distributions USING btree (destination_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_menu_board_items_active ON public.menu_board_items USING btree (is_active) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_menu_board_items_section ON public.menu_board_items USING btree (section, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON public.notification_reads USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_veg_requests_created_at ON public.veg_requests USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_veg_requests_status ON public.veg_requests USING btree (status);

CREATE INDEX IF NOT EXISTS idx_ys_quarantine_kind ON public.yarasoft_quality_quarantine USING btree (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ys_revenue_map_dept ON public.yarasoft_revenue_map USING btree (dept_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ys_revenue_map ON public.yarasoft_revenue_map USING btree (src_table, COALESCE(src_name, ''::text));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ys_unmapped ON public.yarasoft_unmapped_sections USING btree (src_table, src_name) WHERE (resolved = false);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_chat_from_user_id_fkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.internal_chat
    ADD CONSTRAINT internal_chat_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE SET NULL; $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_chat_to_user_id_fkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.internal_chat
    ADD CONSTRAINT internal_chat_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE SET NULL; $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_production_distributions_batch_id_fkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.kitchen_production_distributions
    ADD CONSTRAINT kitchen_production_distributions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.kitchen_production_batches(id) ON DELETE CASCADE; $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_reads_notification_id_fkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE; $ddl$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_reads_user_id_fkey') THEN
        EXECUTE $ddl$ ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE; $ddl$;
    END IF;
END $$;

-- ── 2) الأعمدة الناقصة في الجداول القائمة ───────────────────────────
-- dispatches.creatorUserId bigint
ALTER TABLE public."dispatches" ADD COLUMN IF NOT EXISTS "creatorUserId" bigint;
-- employees.deviceUserIdAlt character varying(64)
ALTER TABLE public."employees" ADD COLUMN IF NOT EXISTS "deviceUserIdAlt" character varying(64);
-- employees.iqamaNumber character varying(20)
ALTER TABLE public."employees" ADD COLUMN IF NOT EXISTS "iqamaNumber" character varying(20);
-- idempotency_keys.locked_until timestamp with time zone
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
-- idempotency_keys.response_body jsonb
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "response_body" jsonb;
-- idempotency_keys.status_code integer
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "status_code" integer;
-- inventory.external_code character varying(64)
ALTER TABLE public."inventory" ADD COLUMN IF NOT EXISTS "external_code" character varying(64);
-- inventory_audit_items.counted_at timestamp with time zone
ALTER TABLE public."inventory_audit_items" ADD COLUMN IF NOT EXISTS "counted_at" timestamp with time zone;
-- inventory_audits.cancel_reason text
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
-- inventory_audits.cancelled_at timestamp with time zone
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
-- inventory_audits.cancelled_by character varying(150)
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "cancelled_by" character varying(150);
-- inventory_audits.counted_items integer NOT NULL
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "counted_items" integer DEFAULT 0 NOT NULL;
-- inventory_audits.location_id bigint
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "location_id" bigint;
-- inventory_audits.scope_filter jsonb NOT NULL
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "scope_filter" jsonb DEFAULT '{}'::jsonb NOT NULL;
-- inventory_audits.updated_at timestamp with time zone NOT NULL
ALTER TABLE public."inventory_audits" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL;
-- kitchen_production_batches.distributed_qty numeric(14,4) NOT NULL
ALTER TABLE public."kitchen_production_batches" ADD COLUMN IF NOT EXISTS "distributed_qty" numeric(14,4) DEFAULT 0 NOT NULL;
-- kitchen_production_batches.product_name text
ALTER TABLE public."kitchen_production_batches" ADD COLUMN IF NOT EXISTS "product_name" text;
-- kitchen_production_batches.product_unit character varying(40)
ALTER TABLE public."kitchen_production_batches" ADD COLUMN IF NOT EXISTS "product_unit" character varying(40) DEFAULT 'وحدة'::character varying;
-- notifications.created_at timestamp with time zone NOT NULL
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL;
-- notifications.entity character varying(60)
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "entity" character varying(60);
-- notifications.entity_id character varying(60)
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "entity_id" character varying(60);
-- notifications.link character varying(255)
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "link" character varying(255);
-- notifications.read_at timestamp with time zone
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
-- notifications.user_id bigint
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "user_id" bigint;
-- purchase_requests.deliver_mode text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "deliver_mode" text;
-- purchase_requests.dept_code text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "dept_code" text;
-- purchase_requests.dept_name text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "dept_name" text;
-- purchase_requests.received_items jsonb
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "received_items" jsonb;
-- purchase_requests.wh_notes text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_notes" text;
-- purchase_requests.wh_received_at timestamp with time zone
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_received_at" timestamp with time zone;
-- purchase_requests.wh_received_by bigint
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_received_by" bigint;
-- purchase_requests.wh_received_name text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_received_name" text;
-- purchase_requests.wh_signature_data text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_signature_data" text;
-- purchase_requests.wh_signature_hash text
ALTER TABLE public."purchase_requests" ADD COLUMN IF NOT EXISTS "wh_signature_hash" text;
-- users.last_login_at timestamp with time zone
ALTER TABLE public."users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;

-- ── 3) دالة + trigger تدقيق تغييرات المستخدمين ────────────────────
-- log_users_changes موجودة في الإنتاج بلا أي مصدر في المستودع (لا migration
-- ولا كود) — أي أن أي تثبيت جديد بلا سجل تدقيق لتغييرات الصلاحيات.
CREATE OR REPLACE FUNCTION public.log_users_changes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.dept_code IS DISTINCT FROM NEW.dept_code THEN
    INSERT INTO user_change_log (user_id, field, old_value, new_value) VALUES (NEW.id, 'dept_code', OLD.dept_code, NEW.dept_code);
  END IF;
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO user_change_log (user_id, field, old_value, new_value) VALUES (NEW.id, 'role', OLD.role, NEW.role);
  END IF;
  RETURN NEW;
END; $function$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_audit' AND NOT tgisinternal) THEN
        CREATE TRIGGER trg_users_audit AFTER UPDATE ON public.users
            FOR EACH ROW EXECUTE FUNCTION log_users_changes();
    END IF;
END $$;

-- ── 4) أعمدة موجودة في القاعدة الجديدة وناقصة في الإنتاج ────────────
-- (المحرك لا يقرأها اليوم، لكن التطابق يمنع انحرافاً مستقبلياً)
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "endpoint" text;
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "response" jsonb;
ALTER TABLE public."idempotency_keys" ADD COLUMN IF NOT EXISTS "user_id" bigint;
