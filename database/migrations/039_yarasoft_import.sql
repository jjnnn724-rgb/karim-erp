-- =====================================================
-- Migration 039: Yarasoft POS Invoice Import (تكامل نقاط البيع)
-- =====================================================
-- استيراد آلي لفواتير Yarasoft من مشاركة الشبكة \\server\Yarasoft\pos
-- بلا أي تعديل على Yarasoft نفسها (حد التكامل: نظام الملفات للقراءة فقط).
--
-- الجداول:
--   invoice_import_log        سجل معالجة كل ملف — idempotency متعدد المستويات:
--                             UNIQUE(file_hash) + UNIQUE(external_invoice_number)
--   yarasoft_product_mapping  ربط صريح أكواد/باركود Yarasoft → inventory
--   yarasoft_review_items     أصناف بلا مطابقة تحتاج مراجعة يدوية (REQUIRES_REVIEW)
--   revenues.external_ref     مرجع خارجي فريد — حاجز ازدواج نهائي على الإيراد
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS indexes.
-- يُطبَّق أيضًا تلقائيًا عند بدء الخادم من backend/yarasoft/schema.js.
-- =====================================================

BEGIN;

-- ─── سجل استيراد الفواتير (Phase 5) ───
CREATE TABLE IF NOT EXISTS invoice_import_log (
    id                      BIGSERIAL PRIMARY KEY,
    source_file             TEXT NOT NULL,
    file_hash               VARCHAR(64) NOT NULL,
    external_invoice_number TEXT,
    external_transaction_id TEXT,
    status                  VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
    stage                   VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
    items_count             INTEGER,
    total_amount            NUMERIC(12,2),
    retry_count             INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,
    payload                 JSONB,
    processing_duration_ms  INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    archived_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_import_hash
    ON invoice_import_log (file_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_import_ext
    ON invoice_import_log (external_invoice_number)
    WHERE external_invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_import_status
    ON invoice_import_log (status, created_at DESC);

-- ─── ربط المنتجات (Phase 7) ───
CREATE TABLE IF NOT EXISTS yarasoft_product_mapping (
    id                  BIGSERIAL PRIMARY KEY,
    external_code       TEXT,
    external_barcode    TEXT,
    internal_product_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_yarasoft_map_code
    ON yarasoft_product_mapping (external_code)
    WHERE external_code IS NOT NULL AND active = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_yarasoft_map_barcode
    ON yarasoft_product_mapping (external_barcode)
    WHERE external_barcode IS NOT NULL AND active = true;
CREATE INDEX IF NOT EXISTS idx_yarasoft_map_product
    ON yarasoft_product_mapping (internal_product_id);

-- ─── أصناف تحت المراجعة ───
CREATE TABLE IF NOT EXISTS yarasoft_review_items (
    id                  BIGSERIAL PRIMARY KEY,
    import_id           BIGINT NOT NULL REFERENCES invoice_import_log(id) ON DELETE CASCADE,
    external_item_code  TEXT,
    external_barcode    TEXT,
    item_name           TEXT,
    quantity            NUMERIC(12,3),
    unit_price          NUMERIC(12,2),
    reason              TEXT NOT NULL,
    resolved            BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yarasoft_review_import
    ON yarasoft_review_items (import_id);
CREATE INDEX IF NOT EXISTS idx_yarasoft_review_open
    ON yarasoft_review_items (resolved) WHERE resolved = false;

-- ─── حماية الازدواج النهائية على جدول الإيرادات ───
ALTER TABLE revenues ADD COLUMN IF NOT EXISTS external_ref VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_revenues_external_ref
    ON revenues (external_ref) WHERE external_ref IS NOT NULL;

COMMIT;
