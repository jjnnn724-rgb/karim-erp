// ═══════════════════════════════════════════════════════════════════
// «المنادي» — Callout Escalation (المرحلة التانية · 2026-11-02)
// ───────────────────────────────────────────────────────────────────
// النداء الصوتي يصل باسم صاحبه، لكن لو لم يُفتح الإشعار يبقى صوتًا
// في الفراغ. القاعدة الجديدة (طلب المالك):
//
//     15 دقيقة بلا فتح  → تصعيد إلى «النائب»  (sous_chef)
//     45 دقيقة بلا فتح  → تصعيد إلى «المدير»  (manager · admin)
//
// لماذا هذا الملف هنا وليس في notification-service:
//   • التصعيد سلوك دوري (عامل يمسح كل دقيقة) بينما notification-service
//     منطق لحظي يُستدعى من داخل معاملات العمليات — خلطهما يجعل كل عملية
//     تنتظر عاملًا.
//   • التصعيد يعيد استخدام createNotifications/emitNotificationRows
//     نفسها: نفس الغرف، نفس التنظيف، نفس حماية SAVEPOINT.
//
// الضمانات:
//   1. idempotent: الحجز عبر `UPDATE … WHERE escalation_level < $1` ذريّ —
//      دورة تسرّع لن تُكرّر تصعيدًا واحدًا مرتين ولو تداخلت.
//   2. لا حلقات: الصفوف المُصدَّرة تحمل escalation_level = 2 (نهاية السلّم)
//      فالتصعيد الأول لا يُصعَّد مرة أخرى، والذين أُنشئت منه تبقى صامتة —
//      صعود «المدير» يأتي من الصف الأصلي نفسه عند 45 دقيقة.
//   3. لا إشعار للشخص نفسه: actorUserId = صاحب الصف الأصلي.
//   4. الإشعار المُصدَّر يحمل تصنيف الأصل (dispatch/procurement/transfers)
//      فيصل المنادي الصوتي للنائب/المدير فورًا متجاوزًا حصة النداء العادية.
//   5. الفشل لا يكسر شيئًا: العامل يلتقط استثناءه ويستمر في الدورة التالية.
//
// ROLLBACK: أوقف استدعاء startEscalationWorker في server.js واحذف
//   عمودَي escalation_level/escalated_at (migration 124) — جرس الإشعارات
//   الأسلي كما هو.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const {
    createNotifications,
    emitNotificationRows,
    sendRowsAsPush,
    PRIORITY_CATEGORIES,
} = require('./notification-service');

/** الدورات: دقيقة واحدة — التصعيد يجب أن يُشعر الإنسان لا أن يصل بعد نص ساعة. */
const SWEEP_MS = 60_000;
/** أقصى صفوف تُراجَع في الدورة الواحدة — حماية من طوفان إشعارات قديمة. */
const SWEEP_BATCH = 200;
/** مستوى نهائي: لا يُصعَّد بعد. */
const ESCALATION_DONE = 2;

/**
 * سلّم التصعيد — مصدر واحد للحقيقة (الواجهة تقرأ نفس القيم من هنا عبر API
 * أو من نصّها المنسوخ، والاختبار يثبت ترتيبها).
 *   roles: أدوار المستهدَفين الجدد — تُقرأ من users النشطين فقط.
 */
const ESCALATION_LEVELS = Object.freeze([
    Object.freeze({
        level: 1,
        minutes: 15,
        roles: Object.freeze(['sous_chef']),
        who: 'نائب الشيف',
    }),
    Object.freeze({
        level: 2,
        minutes: 45,
        roles: Object.freeze(['manager', 'admin']),
        who: 'مدير النظام',
    }),
]);

let schemaReady = null;

/**
 * SQL المخطط — نصٌّ واحد مبنيٌّ خارج الاستدعاء. ممنوع `${}` داخل نصّ
 * الاستعلام (بوابة sql-interp): القيمة هنا ثابت صريح مُنمَّط لا مدخلة،
 * فالبناء بالتجزئة يُبطل التتبّع دون إخفاء أي حقن محتمل.
 */
const ESCALATION_SCHEMA_SQL = [
    'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0;',
    'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;',
    // الفهرس الجزئي يغطي مسار المسح كله: مقروء + لم يكمل السلّم + أولوية.
    'CREATE INDEX IF NOT EXISTS idx_notifications_escalation ON notifications (created_at)'
        + ' WHERE read = false AND escalation_level < ' + String(ESCALATION_DONE)
        + ' AND category IS NOT NULL;',
].join('\n');

/** مخطط ذاتي الترقية (idempotent): عمودان + فهرس جزئي للمسح. */
function ensureEscalationSchema() {
    if (schemaReady) {return schemaReady;}
    schemaReady = pool.query(ESCALATION_SCHEMA_SQL)
        .then(() => undefined)
        .catch((error) => {schemaReady = null; throw error;});
    return schemaReady;
}

/**
 * نقية: مستوى التصعيد المستحقّ لصفٍّ بُثّ في `createdAt`.
 * @returns {0|1|2} 0 = لم يحن وقته بعد.
 */
function levelFor(createdAt, now = Date.now()) {
    /* حارس مسبق: new Date(null) تعطي الحقبة (1970) لا NaN — وبدونه يبدو
       صفٌّ بلا تاريخ «عالجًا» بنصف قرن فيُصعَّد فور أول دورة. */
    if (createdAt == null || createdAt === '') {return 0;}
    const at = new Date(createdAt).getTime();
    if (!Number.isFinite(at) || at <= 0) {return 0;}
    const ageMs = now - at;
    if (ageMs >= ESCALATION_LEVELS[1].minutes * 60_000) {return 2;}
    if (ageMs >= ESCALATION_LEVELS[0].minutes * 60_000) {return 1;}
    return 0;
}

/** نقية: نص التصعيد — العنوان يشرح التأخير، والرسالة تربطه بأصله. */
function buildEscalationText(row, spec) {
    const minutes = Number(spec.minutes) || 0;
    const original = String(row?.title || '').trim() || 'إشعار';
    const holder = String(row?.user_name || row?.user_username || '').trim();
    const detail = String(row?.message || '').trim();
    const title = `لم يُفتح منذ ${minutes} دقيقة: ${original}`.slice(0, 255);
    const parts = [
        holder ? `الموجَّه إليه ${holder} لم يفتح الإشعار` : 'لم يُفتح الإشعار',
        `صُعِّد الآن إلى ${spec.who}`,
    ];
    let message = parts.join(' — ');
    if (detail) {message += `. ${detail}`;}
    return { title, message: message.slice(0, 500) };
}

/**
 * المسح: يبحث عن إشعارات أولوية غير مفتوحة، ويحجز مستوى التصعيد، ثم ينشئ
 * صفوفًا جديدة للنائب/المدير.
 *
 * المعاملات قابلة للحقن للاختبارات: { db, io, now, notify, ensureSchema }.
 * `ensureSchema` يُحقن في الاختبار حتى لا يتصل بعمود المخطط العالمي.
 *
 * @returns {Promise<{candidates:number, escalated:number, claimed:number, failed:number}>}
 */
async function sweepEscalations({ db, io, now = Date.now(), notify, ensureSchema = ensureEscalationSchema } = {}) {
    if (typeof ensureSchema === 'function') {await ensureSchema();}
    const conn = db || pool;
    const send = typeof notify === 'function'
        ? notify
        : async (opts) => {
            const { rows } = await createNotifications(conn, opts);
            emitNotificationRows(io, rows);
            if (rows.length) {void sendRowsAsPush(rows);}
            return rows;
        };

    const candidates = (await conn.query(
        `SELECT n.id, n.user_id, n.title, n.message, n.category, n.entity, n.entity_id, n.link,
                n.created_at, n.escalation_level, u.name AS user_name, u.username AS user_username
           FROM notifications n
           JOIN users u ON u.id = n.user_id
          WHERE n.read = false
            AND n.user_id IS NOT NULL
            AND n.category = ANY($1::text[])
            AND n.escalation_level < $2
            AND n.created_at <= NOW() - make_interval(mins => $3)
          ORDER BY n.created_at
          LIMIT $4`,
        [PRIORITY_CATEGORIES, ESCALATION_DONE, ESCALATION_LEVELS[0].minutes, SWEEP_BATCH],
    )).rows;

    let claimed = 0;
    let escalated = 0;
    let failed = 0;

    for (const row of candidates) {
        const level = levelFor(row.created_at, now);
        if (!level || level <= Number(row.escalation_level || 0)) {continue;}
        const spec = ESCALATION_LEVELS[level - 1];
        // الحجز الذري: مَن سبقنا في هذه الدورة نفسها يفوز بالصف، والآخر يرى 0.
        const held = await conn.query(
            'UPDATE notifications SET escalation_level = $1, escalated_at = NOW() WHERE id = $2 AND escalation_level < $1',
            [level, row.id],
        ).catch(() => ({ rowCount: 0 }));
        if (!held.rowCount) {continue;}
        claimed += 1;

        const text = buildEscalationText(row, spec);
        try {
            const created = await send({
                type: 'warning',
                title: text.title,
                message: text.message,
                entity: row.entity,
                entityId: row.entity_id,
                link: row.link,
                category: row.category,
                targetRoles: spec.roles,
                actorUserId: row.user_id,
                io,
            });
            // createNotifications تعيد { rows } بينما notify المحقون قد يعيد
            // المصفوفة مباشرة — نتقبل الصيورتين.
            const made = Array.isArray(created) ? created : (Array.isArray(created?.rows) ? created.rows : []);
            escalated += made.length;
            if (!made.length) {
                logger.warn(`[callout-escalation] لا مستخدم بدور ${spec.roles.join('/')} — تصعيد المستوى ${level} بلا هدف`);
            } else {
                /* صفوف التصعيد نفسها نهاية السلّم: لا تُصعَّد ولا مرة ثانية،
                   وصعود المدير يأتي من الصف الأصلي عند 45 دقيقة. */
                const ids = made.map((r) => Number(r.id)).filter(Number.isInteger);
                if (ids.length) {
                    await conn.query(
                        `UPDATE notifications SET escalation_level = $1
                          WHERE id = ANY($2::bigint[]) AND escalation_level < $1`,
                        [ESCALATION_DONE, ids],
                    ).catch((markErr) => {
                        // لا نبتلع الفشل: صفٌّ لم يُعلَّم قد يُصعَّد ثانيةً بعد 15د.
                        logger.warn('[callout-escalation] تعذر تعليم صفوف التصعيد نهايةً للسلّم:', markErr.message);
                    });
                }
                logger.info(`[callout-escalation] ${level === 1 ? 'نائب' : 'مدير'} ← تصعيد مستوى ${level} لإشعار ${row.id} (${made.length} مستلم)`);
            }
        } catch (error) {
            failed += 1;
            logger.warn('[callout-escalation] فشل تصعيد الإشعار', row.id, error.message);
        }
    }

    return { candidates: candidates.length, claimed, escalated, failed };
}

/**
 * عامل دوري unref'd: لا يمنع إنهاء العملية، ولا يُشغَّل في الاختبارات
 * (server.js وحده من يستدعيه).
 */
function startEscalationWorker({ io, intervalMs = SWEEP_MS, ...sweepDeps } = {}) {
    let running = false;
    const tick = async () => {
        if (running) {return;} // دورة سابقة ما زالت تعمل — لا تكدّس
        running = true;
        try {
            const r = await sweepEscalations({ io, ...sweepDeps });
            if (r.claimed) {logger.info(`[callout-escalation] دورة: ${r.claimed} تصعيد من ${r.candidates} مرشّح`);}
        } catch (error) {
            logger.warn('[callout-escalation] دورة متعثرة (ستُعاد في الدورة التالية):', error.message);
        } finally {
            running = false;
        }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    if (timer.unref) {timer.unref();}
    return () => clearInterval(timer);
}

module.exports = {
    ESCALATION_LEVELS,
    ESCALATION_DONE,
    SWEEP_MS,
    ensureEscalationSchema,
    levelFor,
    buildEscalationText,
    sweepEscalations,
    startEscalationWorker,
};
