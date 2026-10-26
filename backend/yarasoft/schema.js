/**
 * yarasoft/schema.js — مخطط تكامل Yarasoft داخل قاعدة البيانات المثبتة
 * ────────────────────────────────────────────────────────────────────────────
 * يعتمد كليًا على PostgreSQL المثبت (لا ملفات ولا SQLite ولا مخزن ثانٍ):
 *   • invoice_import_log        سجل معالجة كل ملف (idempotency متعدد المستويات)
 *   • yarasoft_product_mapping  ربط أكواد/باركود Yarasoft بمنتجات karim
 *   • yarasoft_review_items     أصناف لم تُطابَق تحتاج مراجعة يدوية
 *   • revenues.external_ref     مرجع خارجي فريد — حماية ازدواج على مستوى قاعدة البيانات
 *
 * يُطبَّق تلقائيًا عند بدء الخادم (idempotent) وكذلك migration 039.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const SCHEMA_SQL = `
-- ─── سجل استيراد الفواتير (Phase 5: idempotency) ───
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

-- ─── ربط المنتجات (Phase 7: never blindly match) ───
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

-- ─── أصناف تحت المراجعة (لا استبدال أعمى أبدًا) ───
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

-- ─── حماية الازدواج النهائية على جدول الإيرادات نفسه ───
ALTER TABLE revenues ADD COLUMN IF NOT EXISTS external_ref VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_revenues_external_ref
    ON revenues (external_ref) WHERE external_ref IS NOT NULL;

-- ─── خريطة تصنيف إيرادات يارا سوفت (قرار المالك: كل قسم لوحده، بلا دمج) ───
-- src_name = NULL تعني "الافتراضي للجدول كله" (مستخدم لـ BILLS4 → بيع خارجي)
CREATE TABLE IF NOT EXISTS yarasoft_revenue_map (
    id            BIGSERIAL PRIMARY KEY,
    src_table     VARCHAR(32) NOT NULL,
    src_name      TEXT,
    dept_code     VARCHAR(50) NOT NULL,
    display_ar    VARCHAR(255) NOT NULL,
    display_en    VARCHAR(255),
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ys_revenue_map
    ON yarasoft_revenue_map (src_table, COALESCE(src_name, ''));
CREATE INDEX IF NOT EXISTS idx_ys_revenue_map_dept
    ON yarasoft_revenue_map (dept_code);

-- ─── الأقسام غير المصنفة (ذكاء التعلم: اعتماد واحد يعلّم السيستم) ───
CREATE TABLE IF NOT EXISTS yarasoft_unmapped_sections (
    id            BIGSERIAL PRIMARY KEY,
    src_table     VARCHAR(32) NOT NULL,
    src_name      TEXT NOT NULL,
    first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invoices_count INTEGER NOT NULL DEFAULT 0,
    total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    resolved      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ys_unmapped
    ON yarasoft_unmapped_sections (src_table, src_name)
    WHERE resolved = false;

-- ─── مفتاح خارجي لأصناف يارا سوفت على مخزوننا (idempotent) ───
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS external_code VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_external_code
    ON inventory (external_code) WHERE external_code IS NOT NULL;

-- ─── تقرير جودة أرصدة يارا سوفت (القيم الشاذة المعزولة) ───
CREATE TABLE IF NOT EXISTS yarasoft_quality_quarantine (
    id            BIGSERIAL PRIMARY KEY,
    kind          VARCHAR(32) NOT NULL,
    ref_code      TEXT,
    ref_name      TEXT,
    qty           NUMERIC(14,4),
    value_amount  NUMERIC(14,2),
    unit_cost     NUMERIC(14,2),
    reason        TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ys_quarantine_kind
    ON yarasoft_quality_quarantine (kind, created_at DESC);
`;

let applied = null;

// ─── البذرة: الأقسام المكتشفة فعليًا من قاعدة يارا سوفت (فحص قراءة 2026-09-13) ───
// BILLS6: عمود TO_FOR_NM هو التصنيف — كل اسم قسم لوحده بلا دمج (قرار المالك).
// BILLS4: فواتير شركات بلا كاشير مسجل → قسم واحد "بيع خارجي" بلا تفصيل (قرار المالك).
const REVENUE_MAP_SEED = [
    // [src_table, src_name, dept_code, display_ar, display_en]
    // ─── كاشيرات نقاط البيع الحقيقية (CC_BILLS3.CSHR_NO — مبيعات الكاشير) ───
    // أعد التسمية من الواجهة لأسماء المنافذ (كاشير الأوبن بوفيه/كوفي شوب 1...)
    ['CC', '1', 'ys_cc_1', 'كاشير 1', 'Cashier 1'],
    ['CC', '2', 'ys_cc_2', 'كاشير 2', 'Cashier 2'],
    ['CC', '3', 'ys_cc_3', 'كاشير 3', 'Cashier 3'],
    ['CC', '4', 'ys_cc_4', 'كاشير 4', 'Cashier 4'],
    ['CC', '5', 'ys_cc_5', 'كاشير 5', 'Cashier 5'],
    ['CC', '6', 'ys_cc_6', 'كاشير 6', 'Cashier 6'],
    ['CC', '9', 'ys_cc_9', 'كاشير 9', 'Cashier 9'],
    ['BILLS6', 'المطبخ - الاوبن بوفيه', 'ys_b6_kitchen_buffet', 'المطبخ - الاوبن بوفيه', 'Kitchen – Open Buffet'],
    ['BILLS6', 'البيع الخارجي', 'ys_b6_external', 'البيع الخارجي', 'External Sales'],
    ['BILLS6', 'الاوزبك', 'ys_b6_uzbek', 'الاوزبك', 'Uzbek'],
    ['BILLS6', 'الصالة - الاوبن بوفيه', 'ys_b6_hall_buffet', 'الصالة - الاوبن بوفيه', 'Hall – Open Buffet'],
    ['BILLS6', 'أطراف ذات علاقة -مقهي ناصر العنزي', 'ys_b6_nasser_cafe', 'مقهي ناصر العنزي', 'Nasser Al-Enezi Cafe'],
    ['BILLS6', 'الحلواني', 'ys_b6_sweets', 'الحلواني', 'Confectionery'],
    ['BILLS6', 'الماليزي', 'ys_b6_malaysian', 'الماليزي', 'Malaysian'],
    ['BILLS6', 'العصائر', 'ys_b6_juices', 'العصائر', 'Juices'],
    ['BILLS6', 'المطبخ - البيع الخارجي', 'ys_b6_kitchen_ext', 'المطبخ - البيع الخارجي', 'Kitchen – External Sales'],
    ['BILLS6', 'الكوفي شوب', 'ys_b6_coffee', 'الكوفي شوب', 'Coffee Shop'],
    ['BILLS6', 'الخباز', 'ys_b6_bakery', 'الخباز', 'Bakery'],
    ['BILLS6', 'الكافي شوب', 'ys_b6_cafe', 'الكافي شوب', 'Cafe'],
    ['BILLS6', 'المطبخ - الماليزي', 'ys_b6_kitchen_malay', 'المطبخ - الماليزي', 'Kitchen – Malaysian'],
    ['BILLS6', 'الاستيوارد', 'ys_b6_steward', 'الاستيوارد', 'Steward'],
    ['BILLS6', 'الاستيوارد اوزبك', 'ys_b6_steward_uzbek', 'الاستيوارد اوزبك', 'Steward Uzbek'],
    ['BILLS6', '', 'ys_b6_unspecified', 'غير محدد', 'Unspecified'],
];

async function seedRevenueMap() {
    for (const [srcTable, srcName, deptCode, displayAr, displayEn] of REVENUE_MAP_SEED) {
        await pool.query(
            `INSERT INTO yarasoft_revenue_map (src_table, src_name, dept_code, display_ar, display_en, active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT DO NOTHING`,
            [srcTable, srcName, deptCode, displayAr, displayEn]
        );
    }
}

async function ensureYarasoftSchema() {
    if (applied) {return applied;}
    applied = (async () => {
        await pool.query(SCHEMA_SQL);
        await seedRevenueMap();
        logger.info('[YARASOFT] تم تطبيق مخطط تكامل Yarasoft (idempotent)');
        return true;
    })();
    try {
        return await applied;
    } catch (error) {
        applied = null; // اسمح بإعادة المحاولة في الدورة القادمة
        throw error;
    }
}

module.exports = { ensureYarasoftSchema, SCHEMA_SQL };
