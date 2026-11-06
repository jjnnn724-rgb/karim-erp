/**
 * callout-escalation.test.js — «المنادي» التصعيد (المرحلة التانية 2026-11-02)
 * ═════════════════════════════════════════════════════════════════════════
 * العقد الذي يُثبت هنا:
 *   ١. السلّم نفسه: 15د → النائب (sous_chef)، 45د → المدير (manager·admin)،
 *      ودقّة الحدود (14:59 صامت / 15:00 يُصعَّد).
 *   ٢. idempotent: الحجز `UPDATE … WHERE escalation_level < $1` ذرّي —
 *      دورةٌ ثانية لا تُعيد تصعيدًا اكتمل.
 *   ٣. لا حلقات: صفوف التصعيد تُعلَّم `escalation_level = 2` فور إنشائها،
 *      وصعود المدير يأتي من *الصف الأصلي* لا من صفة النائب.
 *   ٤. لا إشعار للشخص نفسه: actorUserId = صاحب الصف الأصلي.
 *   ٥. التصعيد يحفظ تصنيف الأصل — ليبقى صوت المنادي فوريًّا للمستهدف.
 *   ٦. الفشل لا يرمي: عاملٌ يجب ألّا يُسقط الخادم أبدًا.
 *
 * كل شيء هنا يجري على عميلٍ وهمي — لا اتصال بقاعدة البيانات.
 */
'use strict';

const {
    ESCALATION_LEVELS,
    ESCALATION_DONE,
    SWEEP_MS,
    levelFor,
    buildEscalationText,
    sweepEscalations,
    startEscalationWorker,
} = require('../backend/callout-escalation');
const { PRIORITY_CATEGORIES } = require('../backend/notification-service');

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0); // 2026-11-02T12:00:00Z
const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();

/** صف إشعار حقيقي الشكل كما يعيده مرشّح المرشّحين. */
const row = (over = {}) => ({
    id: 9001,
    user_id: 42,
    user_name: 'سيف الدين',
    user_username: 'seif',
    title: 'طلب صرف جديد من المخزن بانتظار اعتمادك',
    message: 'TR-88 — ثلاثة أصناف',
    category: 'dispatch',
    entity: 'dispatch',
    entity_id: 'TR-88',
    link: '/app/#dispatch/TR-88',
    created_at: at(20),
    escalation_level: 0,
    ...over,
});

/**
 * عميل وهمي يحفظ حالة notifications نفسها: SELECT/UPDATE حقيقيّي السلوك
 * (الحجز يخسر إن سبقه أحد، وعدم الترقية يمنع الحلقات).
 */
function fakeDb(seed) {
    const state = { rows: seed.map((r) => ({ ...r })) };
    const log = [];
    const db = {
        state,
        log,
        async query(sql, params = []) {
            const q = String(sql).replace(/\s+/g, ' ').trim();
            log.push({ sql: q, params });
            // 1) المرشّحون
            if (q.startsWith('SELECT n.id, n.user_id')) {
                return {
                    rows: state.rows
                        .filter((r) => r.read !== true
                            && r.user_id != null
                            && PRIORITY_CATEGORIES.includes(r.category)
                            && Number(r.escalation_level || 0) < ESCALATION_DONE
                            && new Date(r.created_at).getTime() <= NOW - params[2] * MIN)
                        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                        .map((r) => ({ ...r })),
                };
            }
            // 2) الحجز الذرّي
            if (q.startsWith('UPDATE notifications SET escalation_level = $1, escalated_at')) {
                const [level, id] = params;
                const target = state.rows.find((r) => Number(r.id) === Number(id));
                if (!target || Number(target.escalation_level || 0) >= Number(level)) {return { rowCount: 0 };}
                target.escalation_level = Number(level);
                target.escalated_at = new Date(NOW).toISOString();
                return { rowCount: 1 };
            }
            // 3) تعليم صفوف التصعيد نهايةً للسلّم
            if (q.startsWith('UPDATE notifications SET escalation_level = $1 WHERE id = ANY')) {
                const [level, ids] = params;
                let n = 0;
                for (const id of ids) {
                    const target = state.rows.find((r) => Number(r.id) === Number(id));
                    if (target && Number(target.escalation_level || 0) < Number(level)) {
                        target.escalation_level = Number(level);
                        n += 1;
                    }
                }
                return { rowCount: n };
            }
            return { rows: [], rowCount: 0 };
        },
    };
    return db;
}

/** مُشعِر وهمي يُرجع صفوفًا كـ createNotifications (كائن { rows } أو مصفوفة). */
function recorder({ shape = 'rows', fail = false } = {}) {
    const calls = [];
    const fn = async (opts) => {
        calls.push(opts);
        if (fail) {throw new Error('db down');}
        /* المعرّفات يأتي من المُشعِر نفسه (fn._ids) لا من الحمولة — المُنشئ
           الوحيد لصفوف التصيع في الإنتاج هو createNotifications. */
        const ids = Array.isArray(fn._ids) ? fn._ids : [501];
        const made = ids.map((id) => ({ id, user_id: 9, title: opts.title, category: opts.category }));
        return shape === 'object' ? { rows: made } : made;
    };
    fn.calls = calls;
    fn._ids = null;
    return fn;
}

const baseDeps = (db, notify) => ({
    db,
    notify,
    now: NOW,
    ensureSchema: async () => {}, // لا مخطط عالمي في الاختبار
    io: null,
});

describe('المنادي التصعيد — السلّم', () => {
    test('ترتيب مستويات التصعيد وأدوارها مجمّدة ومتزايدة', () => {
        expect(ESCALATION_LEVELS.length).toBe(2);
        expect(ESCALATION_LEVELS.map((l) => [l.level, l.minutes])).toEqual([[1, 15], [2, 45]]);
        expect(ESCALATION_LEVELS[0].roles).toEqual(['sous_chef']);
        expect([...ESCALATION_LEVELS[1].roles].sort()).toEqual(['admin', 'manager']);
        // أدوار النائب لا تشمل المدير — وإلا صعد المدير مرّتين
        expect(ESCALATION_LEVELS[0].roles).not.toContain('manager');
        expect(ESCALATION_LEVELS[0].roles).not.toContain('admin');
        // مجمّد على المستويات ومستوياتها
        expect(Object.isFrozen(ESCALATION_LEVELS)).toBe(true);
        expect(Object.isFrozen(ESCALATION_LEVELS[0])).toBe(true);
        expect(Object.isFrozen(ESCALATION_LEVELS[1].roles)).toBe(true);
        // الدقّة عند الحدود
        expect(ESCALATION_LEVELS[1].minutes).toBeGreaterThan(ESCALATION_LEVELS[0].minutes);
        expect(ESCALATION_DONE).toBe(2);
        expect(SWEEP_MS).toBe(60_000);
    });

    test('levelFor: 14:59 صامت · 15:00 نائب · 44:59 نائب · 45:00 مدير', () => {
        expect(levelFor(at(0), NOW)).toBe(0);
        expect(levelFor(at(14), NOW)).toBe(0);
        expect(levelFor(at(15), NOW)).toBe(1);
        expect(levelFor(at(44), NOW)).toBe(1);
        expect(levelFor(at(45), NOW)).toBe(2);
        expect(levelFor(at(600), NOW)).toBe(2);
        // تاريخ فاسد لا يُصعِّد شيئًا ولا يرمي
        expect(levelFor('not-a-date', NOW)).toBe(0);
        expect(levelFor(null, NOW)).toBe(0);
        expect(levelFor(undefined, NOW)).toBe(0);
        // مستقبلًا = عمر سالب = لم يحن
        expect(levelFor(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
    });

    test('buildEscalationText: العنوان يشرح التأخير والرسالة تربطه بأصله', () => {
        const spec = ESCALATION_LEVELS[0];
        const t = buildEscalationText(row(), spec);
        expect(t.title).toContain('15');
        expect(t.title).toContain('طلب صرف جديد');
        expect(t.title.length).toBeLessThanOrEqual(255);
        expect(t.message).toContain('سيف الدين');
        expect(t.message).toContain('نائب الشيف');
        expect(t.message).toContain('TR-88');
        expect(t.message.length).toBeLessThanOrEqual(500);
        // بلا اسم → نصٌّ سليم بلا «undefined»
        const noName = buildEscalationText(row({ user_name: '', user_username: '', title: '' }), ESCALATION_LEVELS[1]);
        expect(noName.title).toContain('إشعار');
        expect(noName.title).toContain('45');
        expect(noName.message).not.toMatch(/undefined|null/);
        expect(noName.message).toContain('مدير النظام');
        // سقف الطول يُحترم مهما طال الأصل
        const huge = buildEscalationText(row({ title: 'ط'.repeat(400), message: 'م'.repeat(600) }), ESCALATION_LEVELS[1]);
        expect(huge.title.length).toBeLessThanOrEqual(255);
        expect(huge.message.length).toBeLessThanOrEqual(500);
    });
});

describe('المنادي التصعيد — المسح', () => {
    test('لا تصعيد لصفٍّ طازج أو مقروء أو بلا تصنيف', async () => {
        const db = fakeDb([
            row({ id: 1, created_at: at(5) }),      // 5 دقائق فقط
            row({ id: 2, created_at: at(30), read: true }),   // مفتوح
            row({ id: 3, created_at: at(30), category: null }), // «عام» ليس أولوية
            row({ id: 4, created_at: at(30), user_id: null }),  // بلا صاحب
        ]);
        const notify = recorder();
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res).toEqual({ candidates: 0, claimed: 0, escalated: 0, failed: 0 });
        expect(notify.calls.length).toBe(0);
    });

    test('15 دقيقة: يُحجز ويُصعَّد للنائب بتصنيف الأصل ودون إشعار الذات', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder();
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res).toEqual({ candidates: 1, claimed: 1, escalated: 1, failed: 0 });

        expect(notify.calls.length).toBe(1);
        const sent = notify.calls[0];
        expect(sent.targetRoles).toEqual(['sous_chef']);
        // الحفاظ على تصنيف الأصل: صوت المنادي ينادي النائب فورًا (أولوية)
        expect(sent.category).toBe('dispatch');
        expect(sent.actorUserId).toBe(42); // صاحب الصف الأصلي — لا يُشعَّر بنفسه
        expect(sent.message).toContain('نائب الشيف');
        expect(sent.title).toContain('15');
        expect(sent.type).toBe('warning');

        // الحجز على الصف الأصلي
        expect(db.state.rows[0].escalation_level).toBe(1);
        expect(db.state.rows[0].escalated_at).toBeTruthy();
        // وصفوف التصعيد المُنشأة نهاية السلّم (2) فلا تُصعَّد ولا مرة
        const terminal = db.log.filter((l) => l.sql.includes('WHERE id = ANY'));
        expect(terminal.length).toBe(1);
        expect(terminal[0].params[0]).toBe(ESCALATION_DONE);
        expect(terminal[0].params[1]).toEqual([501]);
    });

    test('idempotent: الدورة الثانية لا تُعيد تصعيدًا اكتمل', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder();
        const first = await sweepEscalations(baseDeps(db, notify));
        expect(first.claimed).toBe(1);

        const second = await sweepEscalations(baseDeps(db, notify));
        // مرشَّح ظاهر (الأصل level 1 < 2) لكن levelFor(1) ≤ 1 فيُتخطّى بلا حجز
        expect(second.candidates).toBe(1);
        expect(second.claimed).toBe(0);
        expect(second.escalated).toBe(0);
        expect(notify.calls.length).toBe(1);
        expect(db.state.rows[0].escalation_level).toBe(1);
    });

    test('45 دقيقة: الصعود للمدير من الصف الأصلي نفسه، لا من صف النائب', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(50), escalation_level: 1 })]);
        const notify = recorder();
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res).toEqual({ candidates: 1, claimed: 1, escalated: 1, failed: 0 });
        expect(notify.calls[0].targetRoles).toEqual(['manager', 'admin']);
        expect(notify.calls[0].title).toContain('45');
        expect(db.state.rows[0].escalation_level).toBe(2);
    });

    test('نهاية السلّم: level 2 لا يُراجَع أبدًا ولو تقدّم عمره', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(600), escalation_level: 2 })]);
        const notify = recorder();
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res).toEqual({ candidates: 0, claimed: 0, escalated: 0, failed: 0 });
        expect(notify.calls.length).toBe(0);
    });

    test('لا حلقة: صفوف التصعيد نفسها تبقى خارج المرشّحين', async () => {
        const notify = recorder();
        notify._ids = [777];
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        // المُشعِر يُنفِّذ إدراجه فعلًا داخل نفس العميل (كما في الإنتاج)
        const wrapped = async (opts) => {
            const out = await notify(opts);
            db.state.rows.push({
                id: 777, user_id: 9, title: opts.title, message: opts.message,
                category: opts.category, created_at: new Date(NOW).toISOString(),
                escalation_level: 0, read: false,
            });
            return out;
        };
        const res = await sweepEscalations(baseDeps(db, wrapped));
        expect(res.escalated).toBe(1);

        const escalationRow = db.state.rows.find((r) => r.id === 777);
        expect(escalationRow).toBeTruthy();
        expect(escalationRow.escalation_level).toBe(ESCALATION_DONE);
        // دورةٌ تالية: الأصل وحده لا يزال مرشّحًا (20د < 45د) فلا يصعد،
        // وصف التصعيد نفسه level 2 فلا يُرشَّح أصلًا
        const next = await sweepEscalations(baseDeps(db, wrapped));
        expect(next.candidates).toBe(1);
        expect(next.claimed).toBe(0);
        expect(db.state.rows.find((r) => r.id === 777).escalation_level).toBe(ESCALATION_DONE);
        expect(notify.calls.length).toBe(1);
    });

    test('لا مستخدم بالنפקיד المطلوب: لا يفشل شيء، ويُسجَّل تحذير', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder();
        notify._ids = []; // لا أحد يستلم
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res).toEqual({ candidates: 1, claimed: 1, escalated: 0, failed: 0 });
        // الصف مُحجز رغم غياب الهدف — وإلا حاول كل دورة للأبد
        expect(db.state.rows[0].escalation_level).toBe(1);
    });

    test('المُشعِر يرمي: الفشل يُحسب ولا يُسقط الدورة', async () => {
        const db = fakeDb([
            row({ id: 1, created_at: at(20) }),
            row({ id: 2, created_at: at(30) }),
        ]);
        const notify = recorder({ fail: true });
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res.claimed).toBe(2);
        expect(res.escalated).toBe(0);
        expect(res.failed).toBe(2);
        expect(res.candidates).toBe(2);
    });

    test('يقبل كائن { rows } كما يعيده createNotifications فعليًا', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder({ shape: 'object' });
        const res = await sweepEscalations(baseDeps(db, notify));
        expect(res.escalated).toBe(1);
        expect(db.log.some((l) => l.sql.includes('WHERE id = ANY'))).toBe(true);
    });

    test('حارس المخطط يُستدعى مرة واحدة على الاتصال نفسه', async () => {
        const db = fakeDb([]);
        let schemaCalls = 0;
        const res = await sweepEscalations({
            ...baseDeps(db, recorder()),
            ensureSchema: async () => { schemaCalls += 1; },
        });
        expect(schemaCalls).toBe(1);
        expect(res.candidates).toBe(0);
    });
});

describe('المنادي التصعيد — العامل', () => {
    test('دورة واحدة تعمل عند الإقلاع، وموصّل الإيقاف يوقف المؤقّت', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder();
        const stop = startEscalationWorker({
            io: null, intervalMs: 60 * 60 * 1000, // لا يُطلق دورة ثانية أثناء الانتظار
            ...baseDeps(db, notify),
        });
        expect(typeof stop).toBe('function');
        // تُ flushing لعدة دورات حتى تكتمل الدورة الآنية
        for (let i = 0; i < 50 && notify.calls.length === 0; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(notify.calls.length).toBe(1);
        expect(db.state.rows[0].escalation_level).toBe(1);
        stop();
    });

    test('عطلٌ في الدورة لا يُسقط العامل — الدورة التالية تعمل', async () => {
        const db = fakeDb([row({ id: 9001, created_at: at(20) })]);
        const notify = recorder();
        let schemaCalls = 0;
        const stop = startEscalationWorker({
            io: null,
            intervalMs: 10,
            db,
            notify,
            now: NOW,
            ensureSchema: async () => {
                schemaCalls += 1;
                if (schemaCalls === 1) {throw new Error('schema boom');}
            },
        });
        for (let i = 0; i < 200 && db.state.rows[0].escalation_level !== 1; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        stop();
        // الدورة الأولى رُفضت بعطل، والثانية أكملت — العامل لم يمت
        expect(schemaCalls).toBeGreaterThanOrEqual(2);
        expect(db.state.rows[0].escalation_level).toBe(1);
        expect(notify.calls.length).toBe(1);
    });
});
