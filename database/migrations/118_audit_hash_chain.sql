-- ════════════════════════════════════════════════════════════════════════════
-- 118_audit_hash_chain.sql — سلسلة hash لسجل التدقيق (البند ١١)
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة: pos_audit_logs «append-only» بمشغّلات تمنع UPDATE/DELETE، لكن من
-- يملك صلاحية الجدول (أو يعطّل المشغّلات) يستطيع تغيير صفٍّ قائم أو حذفه بلا
-- أن يظهر ذلك في أي مكان. القيد يمنع الخطأ العابر لا العبث المتعمّد.
--
-- الحل: كل صف يُربط بسابقه. عند الإدراج — أيًّا كان الكاتب: التطبيق أو مشغّل
-- الالتقاط في القاعدة — يحسب مشغّل BEFORE INSERT:
--     prev_hash  = entry_hash لآخر صفٍّ مختوم (أو 'GENESIS' للبداية)
--     entry_hash = SHA-256(حِمل JSON قانوني للصف + prev_hash)
-- تغييرُ حرفٍ في أي صف يكسر سلسلته، وحذفُ صف يكسر رابط الصف التالي، وإعادةُ
-- حساب السلسلة كلها تتطلب وعيًا وتعديلًا جماعيًا — ويظل الفحص يكشف أي فجوة.
--
-- لماذا الحساب في القاعدة لا في Node:
--   • هناك ثلاثة كتّاب مباشرين (kot/zatca/worker) بعيدًا عن writeAuditLog،
--     ومشغّل التقاط SQL يُدرج بنفسه. أي حلٍّ في طبقة التطبيق يترك فجوات.
--   • الكاتب لا يستطيع تزوير prev_hash/entry_hash: المشغّل يستبدلهما دائمًا.
--
-- لماذا يُستثنى actor_user_id من الحِمل:
--   users.id عليه ON DELETE SET NULL، فحذف مستخدم (تصفير/تنظيف) يكتب NULL
--   في صفوف قديمة. إدخالُه في الـhash كان سيجعل كل تصفير «اختراقًا». الاسم
--   والدور وIP باقية ومحمية — وهي ما يُقرأ في التحقيق أصلًا.
--
-- الصفوف القديمة تُختَم هنا مرة واحدة (خط أساس)، والصفوف التي تُدرج ومشغّلات
-- الجدول معطّلة (مسار التصفير يحقّق ذلك مؤقتًا) تبقى بلا hash ويُبلّغ عنها
-- المدقّق صراحةً كـ«غير مختومة» لا ككسرٍ في السلسلة.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- لا يُفترض وجود pgcrypto؟ نُفشل الترحيل بوضوح بدل سلسلة بـmd5.
DO $ext$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE p.proname = 'digest' AND n.nspname = 'public') THEN
        RAISE EXCEPTION '118_audit_hash_chain: pgcrypto (public.digest) غير متاح — ثبّته ثم أعد الترحيل.';
    END IF;
END
$ext$;

ALTER TABLE pos_audit_logs ADD COLUMN IF NOT EXISTS prev_hash  TEXT;
ALTER TABLE pos_audit_logs ADD COLUMN IF NOT EXISTS entry_hash TEXT;

COMMENT ON COLUMN pos_audit_logs.prev_hash IS
    'entry_hash للصف السابق (أو GENESIS) — يكتبه مشغّل السلسلة قبل الإدراج.';
COMMENT ON COLUMN pos_audit_logs.entry_hash IS
    'SHA-256 للحِمل القانوني + prev_hash — يكتبه المشغّل، ولا يُقبل من الكاتب.';

-- البحث عن آخر صفٍّ مختوم يجري مع كل إدراج؛ فهرس جزئي يجعله O(1).
CREATE INDEX IF NOT EXISTS idx_pos_audit_logs_chain_head
    ON pos_audit_logs (id DESC)
    WHERE entry_hash IS NOT NULL;

-- ─── 1. الحِمل القانوني: jsonb_build_object ثم ::text ────────────────────────
-- PostgreSQL يُخرج jsonb بترتيب مفاتيح حتمي (الطول ثم البايتات)، فالسلسلة
-- النصية نفسها تعود من نفس القيم على أي إصدار — وهي الأساس الذي يعيد المدقّق
-- حسابَه. الأوقات UTC بدقة ميكروثانية، وعنوان IP بلا قناع.
CREATE OR REPLACE FUNCTION pos_audit_chain_payload(
    p_id            BIGINT,
    p_occurred_at   TIMESTAMPTZ,
    p_actor_user    TEXT,
    p_actor_role    TEXT,
    p_actor_ip      INET,
    p_action        TEXT,
    p_table_name    TEXT,
    p_row_pk        TEXT,
    p_data_before   JSONB,
    p_data_after    JSONB,
    p_reason        TEXT,
    p_request_id    TEXT,
    p_metadata      JSONB,
    p_prev_hash     TEXT
) RETURNS TEXT
-- STABLE لا IMMUTABLE: to_char/jsonb_build_object مُعلَّمتان STABLE في الكتالوج،
-- وإعلانُ دالةٍ أعلى منهما IMMUTABLE ادّعاءٌ غير صحيح — والحساب لا يحتاجه.
LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT jsonb_build_object(
        'v',      1,
        'id',     p_id,
        'at',     to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'actor',  p_actor_user,
        'role',   p_actor_role,
        'ip',     host(p_actor_ip),
        'action', p_action,
        'table',  p_table_name,
        'row',    p_row_pk,
        'before', p_data_before,
        'after',  p_data_after,
        'reason', p_reason,
        'request', p_request_id,
        'meta',   COALESCE(p_metadata, '{}'::jsonb),
        'prev',   p_prev_hash
    )::text;
$fn$;

-- ─── 2. المشغّل: الختم قبل الإدراج ─────────────────────────────────────────
-- القفل الاستشاري (transaction-scoped) يُسلسِل الإدراجات المتزامنة حتى لا
-- يختار صفّان متوازيان السابقَ نفسه. المفتاح ثابت ومخصّص لهذه السلسلة.
CREATE OR REPLACE FUNCTION trg_fn_pos_audit_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE
    v_prev TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(824301117);

    SELECT entry_hash INTO v_prev
      FROM pos_audit_logs
     WHERE entry_hash IS NOT NULL
     ORDER BY id DESC
     LIMIT 1;
    IF v_prev IS NULL THEN v_prev := 'GENESIS'; END IF;

    NEW.prev_hash  := v_prev;
    NEW.entry_hash := encode(digest(pos_audit_chain_payload(
        NEW.id, NEW.occurred_at, NEW.actor_username, NEW.actor_role, NEW.actor_ip,
        NEW.action::text, NEW.table_name, NEW.row_pk, NEW.data_before, NEW.data_after,
        NEW.reason, NEW.request_id, NEW.metadata, v_prev
    ), 'sha256'), 'hex');
    RETURN NEW;
END
$fn$;

-- ─── 3. خط الأساس: ختم الصفوف القائمة ──────────────────────────────────────
DO $backfill$
DECLARE
    r        RECORD;
    v_prev   TEXT;
    v_hash   TEXT;
    v_filled INT := 0;
BEGIN
    SELECT entry_hash INTO v_prev
      FROM pos_audit_logs
     WHERE entry_hash IS NOT NULL
     ORDER BY id DESC
     LIMIT 1;
    IF v_prev IS NULL THEN v_prev := 'GENESIS'; END IF;

    IF EXISTS (SELECT 1 FROM pos_audit_logs WHERE entry_hash IS NULL) THEN
        -- UPDATE على جدول append-only: نعطّل مشغّل الحظر وحده، داخل نفس
        -- المعاملة — فأي فشل يُرجع كل شيء بما فيه حالة المشغّل.
        ALTER TABLE pos_audit_logs DISABLE TRIGGER trg_pos_prevent_audit_update;
        FOR r IN SELECT * FROM pos_audit_logs WHERE entry_hash IS NULL ORDER BY id LOOP
            v_hash := encode(digest(pos_audit_chain_payload(
                r.id, r.occurred_at, r.actor_username, r.actor_role, r.actor_ip,
                r.action::text, r.table_name, r.row_pk, r.data_before, r.data_after,
                r.reason, r.request_id, r.metadata, v_prev
            ), 'sha256'), 'hex');
            UPDATE pos_audit_logs SET prev_hash = v_prev, entry_hash = v_hash WHERE id = r.id;
            v_prev := v_hash;
            v_filled := v_filled + 1;
        END LOOP;
        ALTER TABLE pos_audit_logs ENABLE TRIGGER trg_pos_prevent_audit_update;
        RAISE NOTICE '118_audit_hash_chain: sealed % legacy row(s)', v_filled;
    END IF;
END
$backfill$;

DROP TRIGGER IF EXISTS trg_pos_audit_chain ON pos_audit_logs;
CREATE TRIGGER trg_pos_audit_chain
    BEFORE INSERT ON pos_audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_audit_chain();

-- ─── 4. المدقّق ─────────────────────────────────────────────────────────────
-- يمرّ على الصفوف بترتيب id ويعيد بناء السلسلة. الصفوف بلا entry_hash (أُدرجت
-- ومشغّلات الجدول معطّلة) تُعدّ «غير مختومة» وتُتخطّى — لا تُحسب كسرًا.
-- p_from_id يسمح بفحص الجزء الجديد وحده (يربطه بآخر صفٍّ مختوم قبله).
CREATE OR REPLACE FUNCTION pos_audit_verify_chain(p_from_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
    r           RECORD;
    v_prev      TEXT := 'GENESIS';
    v_hash      TEXT;
    v_checked   BIGINT := 0;
    v_unchained BIGINT := 0;
BEGIN
    IF p_from_id IS NOT NULL THEN
        SELECT entry_hash INTO v_prev
          FROM pos_audit_logs
         WHERE entry_hash IS NOT NULL AND id < p_from_id
         ORDER BY id DESC
         LIMIT 1;
        IF v_prev IS NULL THEN v_prev := 'GENESIS'; END IF;
    END IF;

    FOR r IN SELECT * FROM pos_audit_logs
              WHERE (p_from_id IS NULL OR id >= p_from_id)
              ORDER BY id
    LOOP
        IF r.entry_hash IS NULL THEN
            v_unchained := v_unchained + 1;
            CONTINUE;
        END IF;

        IF r.prev_hash IS DISTINCT FROM v_prev THEN
            RETURN jsonb_build_object(
                'ok', false, 'reason', 'prev_mismatch',
                'broken_at', r.id, 'checked', v_checked, 'unchained', v_unchained);
        END IF;

        v_hash := encode(digest(pos_audit_chain_payload(
            r.id, r.occurred_at, r.actor_username, r.actor_role, r.actor_ip,
            r.action::text, r.table_name, r.row_pk, r.data_before, r.data_after,
            r.reason, r.request_id, r.metadata, r.prev_hash
        ), 'sha256'), 'hex');

        IF v_hash IS DISTINCT FROM r.entry_hash THEN
            RETURN jsonb_build_object(
                'ok', false, 'reason', 'hash_mismatch',
                'broken_at', r.id, 'checked', v_checked, 'unchained', v_unchained);
        END IF;

        v_prev := r.entry_hash;
        v_checked := v_checked + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true, 'checked', v_checked, 'unchained', v_unchained,
        'head', CASE WHEN v_checked = 0 THEN NULL ELSE v_prev END);
END
$fn$;

COMMENT ON FUNCTION pos_audit_verify_chain(BIGINT) IS
    'يعيد {ok, checked, unchained, head} أو {ok:false, reason, broken_at}. للقراءة فقط.';

COMMIT;
