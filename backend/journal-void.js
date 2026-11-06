'use strict';

/**
 * journal-void.js — مسار التصحيح الوحيد للقيود المرحّلة: إبطال، لا مسح.
 * ─────────────────────────────────────────────────────────────────────
 * يستبدل مسارات `DELETE FROM journal_*` القديمة. البوابة في القاعدة
 * (136_coa_journal_void_only) ترفض الحذف الصلب لأي قيد status='posted'.
 *
 * لماذا لا قيد عكسي فوق الإبطال؟ كل قراءات الأستاذ العام والميزان تفلتر
 * status='posted' (accounting-routes.js:537، financial-statements-engine.js:32،
 * accounting-periods.js:93)، فالإبطال يُخرج القيد من الأرصدة بالكامل. إضافة
 * سطور عكسية فوقه تطرح المبلغ مرتين — خطأ، ليس حذرًا زائدًا.
 */

const toId = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * ترتيب النشر: أعمدة الإبطال من 137 قد تتأخر عن الكود (خادم يعمل قبل تطبيق
 * الـ migration ⇒ كل UPDATE بها يُجهض العملية بـ 42703). الفحص على اتصال
 * المستدعي نفسه وبجملة لا تفشل أبدًا (قراءة catalog بـ EXISTS) في نفس المعاملة
 * وبلا savepoint، ويُقيَّد بـ current_database حتى لا يخلط قاعدة بأخرى.
 * الفحص لكل نداء (نداءات الإبطال نادرة) — لا حالة عملية تُخفي اختلاف قاعدة.
 */
async function hasVoidColumns(db) {
    const r = await db.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_catalog = current_database()
                            AND table_name = 'journal_entries'
                            AND column_name = 'voided_at') AS ready`);
    return !!r.rows[0].ready;
}

function normIds(sourceIds) {
    const list = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
    return [...new Set(list.map((v) => String(v ?? '').trim()).filter(Boolean))];
}

// ترقيم المعاملات ثابت في كل عبارة، ومتّصل من $1 بلا فجوات: PostgreSQL يرفض
// أي ربط فيه معاملات زائدة عمّا تذكره الجملة، فلا يمكن اشتقاق SET ديناميكيًا
// بأمان. العبارة الثابتة أيضًا هي ما تقيسه بوابة الأمان (sql-interp حصّتها صفر).
//   migrated (بعد 137): $1 نوع، $2 معرّفات، $3 مُبطِل، $4 اسمه، $5 السبب
//   prefix   (مراجعات): يضيف $6 أنماط LIKE
const SQL_SRC_MIG = `
    UPDATE journal_entries
       SET status = 'void', voided_at = NOW(), voided_by = $3,
           voided_by_name = $4, void_reason = $5
     WHERE source_type = $1 AND source_id = ANY($2::text[]) AND status = 'posted'
    RETURNING id, entry_no, source_id, date`;

const SQL_SRC_MIG_PREFIX = `
    UPDATE journal_entries
       SET status = 'void', voided_at = NOW(), voided_by = $3,
           voided_by_name = $4, void_reason = $5
     WHERE source_type = $1 AND status = 'posted'
       AND (source_id = ANY($2::text[]) OR source_id LIKE ANY($6::text[]))
    RETURNING id, entry_no, source_id, date`;

const SQL_SRC_LEGACY = `
    UPDATE journal_entries
       SET status = 'void'
     WHERE source_type = $1 AND source_id = ANY($2::text[]) AND status = 'posted'
    RETURNING id, entry_no, source_id, date`;

const SQL_SRC_LEGACY_PREFIX = `
    UPDATE journal_entries
       SET status = 'void'
     WHERE source_type = $1 AND status = 'posted'
       AND (source_id = ANY($2::text[]) OR source_id LIKE ANY($3::text[]))
    RETURNING id, entry_no, source_id, date`;

const SQL_BY_ID_MIG = `
    UPDATE journal_entries
       SET status = 'void', voided_at = NOW(), voided_by = $2,
           voided_by_name = $3, void_reason = $4
     WHERE id = $1 AND status = 'posted'
    RETURNING *`;

const SQL_BY_ID_LEGACY = `
    UPDATE journal_entries
       SET status = 'void'
     WHERE id = $1 AND status = 'posted'
    RETURNING *`;

/**
 * إبطال كل القيود المرحّلة لمصدر (أو مصادر) — داخل نفس اتصال/معاملة المستدعي.
 * لا يلمس المسودات ولا المُبطلة أصلًا، ولا يغيّر أي حقل هوية (الحصانة 095).
 * @param {{query:Function}} db - client المعاملة أو المسبح
 * @param {{sourceType:string, sourceIds:string|number|Array, matchPrefix?:boolean,
 *          reason?:string, actorUserId?:number|string, actor?:string}} o
 *   matchPrefix=true يُبطل أيضًا كل المراجعات `المعرف:…` (قيود التعديلات المتسلسلة).
 * @returns {Promise<{voided:number, entries:Array<{id:string, entry_no:string, source_id:string}>}>}
 */
async function voidSourceJournals(db, { sourceType, sourceIds, matchPrefix = false, reason, actorUserId, actor } = {}) {
    const ids = normIds(sourceIds);
    if (!sourceType || !ids.length) {return { voided: 0, entries: [] };}
    const note = String(reason || 'إبطال تشغيلي').slice(0, 500);
    const who = String(actor || '').slice(0, 120) || null;
    const migrated = await hasVoidColumns(db);
    const patterns = matchPrefix ? ids.map((s) => `${likeEscape(s)}:%`) : null;
    let sql;
    let params;
    if (migrated) {
        sql = patterns ? SQL_SRC_MIG_PREFIX : SQL_SRC_MIG;
        params = patterns ? [String(sourceType), ids, toId(actorUserId), who, note, patterns]
            : [String(sourceType), ids, toId(actorUserId), who, note];
    } else {
        sql = patterns ? SQL_SRC_LEGACY_PREFIX : SQL_SRC_LEGACY;
        params = patterns ? [String(sourceType), ids, patterns] : [String(sourceType), ids];
    }
    const r = await db.query(sql, params);
    return { voided: r.rows.length, entries: r.rows.map((e) => ({ id: String(e.id), entry_no: e.entry_no, source_id: e.source_id })) };
}

/**
 * إبطال قيد بمعرّفه (المسار اليدوي /journal/:id/void) بنفس سجل التصحيح.
 * @returns {Promise<{voided:boolean, entry:object|null}>}
 */
async function voidJournalById(db, { entryId, reason, actorUserId, actor } = {}) {
    const migrated = await hasVoidColumns(db);
    const sql = migrated ? SQL_BY_ID_MIG : SQL_BY_ID_LEGACY;
    const params = migrated
        ? [Number(entryId), toId(actorUserId), String(actor || '').slice(0, 120) || null,
            String(reason || 'إبطال يدوي').slice(0, 500)]
        : [Number(entryId)];
    const r = await db.query(sql, params);
    return { voided: !!r.rows[0], entry: r.rows[0] || null };
}

/**
 * المرجع التالي لإعادة ترحيل نسخة منقّحة من قيد مصدر أُبطل.
 * `uq_journal_source UNIQUE NULLS NOT DISTINCT (source_type, source_id)` لا يسمح
 * بصف ثانٍ بنفس المرجع، والقيد المُبطل يحتفظ به إلى الأبد — فالنسخة الجديدة تأخذ
 * اللاحقة `#rN` (لا تُعيد ترقيم التاريخ ولا تعدّل هوية أي قيد قائم).
 * @returns {Promise<string>} مثل `412#r2`
 */
async function nextRevisionSourceId(db, sourceType, baseSourceId) {
    const base = String(baseSourceId);
    const r = await db.query(
        `SELECT source_id FROM journal_entries
          WHERE source_type = $1 AND (source_id = $2::text OR source_id LIKE $2::text || '#r%')`,
        [String(sourceType), base]);
    let max = 1;
    for (const row of r.rows) {
        const m = /^#r(\d+)$/.exec(String(row.source_id).slice(base.length));
        if (m) {max = Math.max(max, Number(m[1]));}
    }
    return `${base}#r${max + 1}`;
}

module.exports = { voidSourceJournals, voidJournalById, nextRevisionSourceId };
