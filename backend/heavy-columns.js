/**
 * heavy-columns.js — إسقاط قوائم بلا أعمدة ثقيلة (2026-10-29)
 * ────────────────────────────────────────────────────────────────────────────
 * بعض الجداول تحمل أعمدةً لا تعني شاشة القائمة: صور تواقيع base64 في أعمدة
 * TEXT (dispatches, kitchen_audits, inventory_audits). كانت تُقرأ من القرص
 * وتُحوَّل وتُحلَّل ثم تُحذف بعد الجلب — أو تُشحن للعميل بلا مستهلك.
 *
 * listColumnsExcluding(table, heavy) يرجع أسماء الأعمدة المتبقية لاستخدامها
 * إسقاطًا في SELECT. الأسماء تُقرأ من information_schema مرة واحدة وتُخزَّن
 * لكل جدول، وتُصفَّى بقاعدة المعرّف الآمن قبل حقنها بين علامتي اقتباس.
 *
 * السلوك الآمن: عند أي فشل أو جدول بلا أعمدة معروفة يُرجع null، وعلى المستدعي
 * أن يعود إلى `*` (السلوك القديم) — لا تتغير أسماء الحقول في الاستجابة.
 */
const { pool } = require('./shared-pool');

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const cache = new Map();

/**
 * @param {*} table اسم الجدول (مُتحقَّق منه مسبقًا بالناطق)
 * @param {*} [heavyColumns] الأعمدة الثقيلة المستثناة
 */
async function listColumnsExcluding(table, heavyColumns) {
    const name = String(table);
    if (cache.has(name)) {return cache.get(name);}
    const heavy = new Set((heavyColumns || []).map(String));
    try {
        const { rows } = await pool.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = $1
              ORDER BY ordinal_position`,
            [name]
        );
        const kept = rows
            .map((r) => String(r.column_name))
            .filter((c) => IDENT.test(c) && !heavy.has(c));
        if (!kept.length) {return null;}
        cache.set(name, kept);
        return kept;
    } catch {
        // فشل الاستعلام لا يُخزَّن: القراءة التالية تعيد المحاولة بدل تعطيل
        // الإسقاط لعمر العملية بسبب خطأ عابر.
        return null;
    }
}

module.exports = { listColumnsExcluding };
