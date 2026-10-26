/**
 * yarasoft/section-resolver.js — التصنيف الذكي لإيرادات يارا سوفت
 * ────────────────────────────────────────────────────────────────────────────
 * كل فاتورة (جدول المصدر + اسم الجهة) → قسم karim + اسم مصدر.
 *  - التصنيف يبدأ من YARASOFT_CLASSIFY_FROM (الافتراضي: اليوم) — ما قبله
 *    يسلك المسار القديم (قسم افتراضي واحد) دون أي تغيير.
 *  - BILLS4 بلا تفصيل شركات: أي اسم جهة → قسم "بيع خارجي" (قرار المالك).
 *  - اسم جديد غير مسجل → يُسجَّل في yarasoft_unmapped_sections ولا يدخل
 *    الدفاتر (حالة NEEDS_MAPPING) — الاعتماد بزر واحد يعلّم السيستم.
 *  - مفتاح منع التكرار ثابت: ora:<TABLE>:<DOC_NO> (key=ORA دائمًا) —
 *    تغيير القسم/المصدر لا يخلق ازدواجًا مع ما سُجّل سابقًا.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { loadConfig } = require('./config');

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function classifyFrom() {
    const raw = String(process.env.YARASOFT_CLASSIFY_FROM || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {return raw;}
    return todayISO();
}

const normTable = (t) => String(t || '').trim().toUpperCase();
const normName = (n) => String(n == null ? '' : n).trim();

/** تطبيع للمطابقة الذكية: يمحو الفروق الإملائية (مسافات/تطويل/همزات/ة-ه/ى-ي) */
function normLoose(s) {
    return String(s == null ? '' : s)
        .replace(/[\s\u0640\u200c\u200d]+/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .trim();
}

/** القسم الافتراضي القديم (ما قبل تاريخ التصنيف) */
function legacyDevice(config) {
    return {
        key: 'ORA',
        sourceName: 'قاعدة الكاشير',
        deptCode: config.defaultDeptCode,
        totalsOnly: true,
        skipInventory: true,
    };
}

/**
 * حلّ القسم لفاتورة. يُرجع:
 *  { device } عند النجاح — أو { unmapped, srcTable, srcName } عند اسم جديد.
 */
async function resolveSection(srcTable, srcName, docDate) {
    const config = loadConfig();
    const table = normTable(srcTable);
    const name = normName(srcName);
    const day = String(docDate || '').slice(0, 10);

    if (!day || day < classifyFrom()) {
        return { device: legacyDevice(config), legacy: true };
    }

    // BILLS4: قسم واحد "بيع خارجي" مهما كان اسم العميل (قرار المالك)
    if (table === 'BILLS4') {
        const row = (await pool.query(
            `SELECT dept_code, display_ar FROM yarasoft_revenue_map
              WHERE src_table = 'BILLS4' AND src_name IS NULL AND active = true LIMIT 1`
        )).rows[0];
        if (row) {
            return {
                device: { key: 'ORA', sourceName: row.display_ar, deptCode: row.dept_code, totalsOnly: true, skipInventory: true },
                mapId: null, tableDefault: true,
            };
        }
    }

    const exact = (await pool.query(
        `SELECT id, dept_code, display_ar FROM yarasoft_revenue_map
          WHERE src_table = $1 AND COALESCE(src_name, '') = $2 AND active = true LIMIT 1`,
        [table, name]
    )).rows[0];
    if (exact) {
        return {
            device: { key: 'ORA', sourceName: exact.display_ar, deptCode: exact.dept_code, totalsOnly: true, skipInventory: true },
            mapId: exact.id,
        };
    }

    // مطابقة مطبعة: تهجئات مختلفة لنفس القسم (مسافة/همزة/ة-ه) → نفس القسم
    const loose = normLoose(name);
    if (loose) {
        const candidates = (await pool.query(
            `SELECT id, src_name, dept_code, display_ar FROM yarasoft_revenue_map
              WHERE src_table = $1 AND src_name IS NOT NULL AND active = true`,
            [table])).rows;
        const hit = candidates.find(c => normLoose(c.src_name) === loose);
        if (hit) {
            return {
                device: { key: 'ORA', sourceName: hit.display_ar, deptCode: hit.dept_code, totalsOnly: true, skipInventory: true },
                mapId: hit.id, looseMatch: true,
            };
        }
    }

    // اسم جديد → سجّله للمراجعة (upsert) ولا تُدخله الدفاتر
    await pool.query(
        `INSERT INTO yarasoft_unmapped_sections (src_table, src_name, last_seen, invoices_count, total_amount)
         VALUES ($1, $2, NOW(), 1, $3)
         ON CONFLICT (src_table, src_name) WHERE resolved = false
         DO UPDATE SET last_seen = NOW(), invoices_count = yarasoft_unmapped_sections.invoices_count + 1,
                       total_amount = yarasoft_unmapped_sections.total_amount + EXCLUDED.total_amount,
                       updated_at = NOW()`,
        [table, name || '(غير محدد)', 0]
    );
    return { unmapped: true, srcTable: table, srcName: name || '(غير محدد)' };
}

/** تحديث مبلغ قسم غير مصنف بعد معرفة إجمالي الفاتورة */
async function bumpUnmappedAmount(srcTable, srcName, amount) {
    try {
        await pool.query(
            `UPDATE yarasoft_unmapped_sections SET total_amount = total_amount + $3, updated_at = NOW()
              WHERE src_table = $1 AND src_name = $2 AND resolved = false`,
            [srcTable, srcName, Number(amount) || 0]
        );
    } catch (e) {
        logger.warn && logger.warn('[ys-resolver] bump failed: ' + String(e.message).slice(0, 120));
    }
}

module.exports = { resolveSection, bumpUnmappedAmount, classifyFrom, legacyDevice };
