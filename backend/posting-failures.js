'use strict';

/**
 * posting-failures.js — R-05: الترحيل الفاشل لا يمرّ صامتًا.
 * ────────────────────────────────────────────────────────────────────────────
 * المسارات التلقائية (شراء، دفعة مورد، …) تُرحّل best-effort حتى لا يسقط
 * المستند التجاري عند تعذّر القيد. المشكلة كانت أن الـcatch يكتب سطرًا في
 * السجل ويعود، فلا أحد يعرف أن الأستاذ ناقص. هنا يُسجَّل الفشل في
 * `posting_failures` (هجرة 134) ليجده CFO في تقرير واحد.
 *
 * القاعدة: هذه الوحدة لا ترمي أبدًا. غياب الجدول (134 لم تُطبَّق) أو أي خطأ
 * اتصال يعني فقط أن التسجيل لم يحدث — المستند التجاري لا يتأثر.
 *
 * @module posting-failures
 */

/**
 * يسجّل فشل ترحيل واحدًا ويعيد معرّفه، أو null إن تعذّر التسجيل.
 * @param {{query:(sql:string, params?:any[])=>Promise<{rows:any[]}>}|null} db — pool أو client بعد COMMIT
 * @param {{module:string, source_type:string, source_id?:string|number|null, payload?:object|null, error:unknown}} info
 * @returns {Promise<number|string|null>}
 */
async function recordPostingFailure(db, info = {}) {
    try {
        if (!db || typeof db.query !== 'function') {return null;}
        const errorText = String(
            (info.error && (info.error.message || info.error.code)) || info.error || 'unknown'
        );
        const payload = info.payload == null ? null : JSON.stringify(info.payload);
        const r = await db.query(
            `INSERT INTO posting_failures (module, source_type, source_id, payload, error)
             VALUES ($1, $2, $3, $4::jsonb, $5)
             RETURNING id`,
            [
                String(info.module || 'unknown'),
                String(info.source_type || 'unknown'),
                info.source_id == null ? null : String(info.source_id),
                payload,
                errorText,
            ]
        );
        return (r && r.rows && r.rows[0] && r.rows[0].id) || null;
    } catch (e) {
        // 42P01 = الجدول غير موجود (134 لم تُطبَّق). الباقي خطأ اتصال/صلاحية.
        // في الحالتين: لا نرمي — التجارة أولى بالتسجيل من تقرير التشغيل.
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(`[posting-failures] تعذر تسجيل الفشل (${info && info.source_type}/${info && info.source_id}): ${e && e.message ? e.message : e}`);
        }
        return null;
    }
}

module.exports = { recordPostingFailure };
