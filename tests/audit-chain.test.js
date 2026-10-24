/**
 * audit-chain.test.js — سلسلة hash لسجل التدقيق (البند ١١) على قاعدة معزولة
 * ────────────────────────────────────────────────────────────────────────────
 * يثبت أن:
 *   1) كل صف جديد يُختم ويُربط بسابقه — أيًّا كان الكاتب.
 *   2) قيم prev_hash/entry_hash التي يرسلها الكاتب تُستبدل ولا تُقبل.
 *   3) تغيير حقل في صف قائم يُكشف (hash_mismatch) ويُعاد بعد الترميم.
 *   4) حذف صف يُكشف عند الصف التالي (prev_mismatch) ويُعاد بعد الترميم.
 *   5) صف أُدرج ومشغّلات الجدول معطّلة (مسار التصفير) يُبلَّغ عنه
 *      «غير مختوم» ولا يُحسب كسرًا.
 *   6) الحِمل القانوني حتميّ: ترتيب مفاتيح JSON لا يغيّر الـhash.
 *
 * يحتاج الترحيل 118 مطبَّقًا على قاعدة الاختبار (fail-fast برسالة صريحة).
 * التلاعب يجري بمشغّلات معطّلة داخل نافذة قصيرة ثم يُرمَّم — فالسلسلة تبقى
 * سليمة بعد كل اختبار، ولا تتراكم صفوف مكسورة بين التشغيلات.
 *
 * Run (isolated DB):
 *   NODE_ENV=test DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test \
 *   KARIM_TEST_DB_ISOLATED=1 npx jest tests/audit-chain.test.js --runInBand
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { writeAuditLog } = require('../backend/cashier-module/audit-middleware');
const { pool } = require('../backend/shared-pool');

const TAG = `chain-probe-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
let linkRequestId = null;
let linkRowId = null;

async function verify(fromId = null) {
    const r = await pool.query('SELECT pos_audit_verify_chain($1::bigint) AS result;', [fromId]);
    return r.rows[0].result;
}

async function setTrigger(name, enabled) {
    await pool.query(`ALTER TABLE pos_audit_logs ${enabled ? 'ENABLE' : 'DISABLE'} TRIGGER ${name};`);
}

/** USER لا ALL: مشغّلات قيود المفاتيح الأجنبية مشغّلات نظام، وتعطيلها يحتاج
 *  صلاحية أعلى من مالك الجدول، فتفشل ALL هنا وتُبقي السلسلة مكسورة. */
async function setUserTriggers(enabled) {
    await pool.query(`ALTER TABLE pos_audit_logs ${enabled ? 'ENABLE' : 'DISABLE'} TRIGGER USER;`);
}

/** يحذف صفوف هذا الملف فقط إن كانت ما تزال في الذيل. صفوف probe حُذفت في
 *  تشغيلٍ سابق بينما كُتبت بعده صفوف أخرى تحمل بصمتها لا يمكن حذفها: هي الآن
 *  جزء من السلسلة، وحذفها يكسرها أكثر لا يصلحها. */
async function removeProbeRows() {
    const probe = await pool.query(
        `SELECT MIN(id) AS min_id FROM pos_audit_logs WHERE request_id LIKE 'chain-probe-%';`
    );
    const minId = probe.rows[0].min_id;
    if (minId == null) {return;}
    const later = await pool.query(
        `SELECT COUNT(*)::int AS n FROM pos_audit_logs
          WHERE id >= $1 AND request_id NOT LIKE 'chain-probe-%';`,
        [minId]
    );
    if (later.rows[0].n > 0) {
        throw new Error('صفوف chain-probe لم تعد في ذيل السلسلة؛ نظّف قاعدة الاختبار يدويًا قبل إعادة التشغيل.');
    }
    await setUserTriggers(false);
    try {
        await pool.query(`DELETE FROM pos_audit_logs WHERE request_id LIKE 'chain-probe-%';`);
    } finally {
        await setUserTriggers(true);
    }
}

async function rowByRequest(requestId) {
    const r = await pool.query(
        'SELECT * FROM pos_audit_logs WHERE request_id = $1 ORDER BY id;',
        [requestId]
    );
    return r.rows;
}

beforeAll(async () => {
    const installed = await pool.query(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'pos_audit_verify_chain' AND n.nspname = 'public';`
    );
    if (!installed.rowCount) {
        throw new Error('سلسلة التدقيق غير مثبتة: طبّق database/migrations/118_audit_hash_chain.sql على قاعدة الاختبار أولًا.');
    }
    // تشغيل سابق قُطع بين الحذف والترميم يترك صفوف probe يتيمة تكسر السلسلة.
    // removeProbeRows يحذفها فقط إن كانت في الذيل، فيعود الرأس إلى آخر صف
    // حقيقي بدل أن يظل الاختبار يفشل للأبد.
    await removeProbeRows();
    const baseline = await verify();
    if (!baseline.ok) {
        throw new Error(`السلسلة مكسورة قبل بدء الاختبار: ${JSON.stringify(baseline)}`);
    }
});

afterAll(async () => {
    // الصفوف التي كتبها هذا الملف آخر ما في السلسلة (runInBand)، فحذفها هنا
    // يترك قاعدة الاختبار نظيفة ولا يورّث تشغيلًا قادمًا ديونًا.
    await removeProbeRows().catch((e) => console.warn('[audit-chain] cleanup:', e.message));
    await pool.end().catch(() => {});
});

describe('الختم عند الإدراج — لكل الكتّاب', () => {
    it('writeAuditLog يُنتج صفًا مختومًا مرتبطًا بآخر صف مختوم', async () => {
        linkRequestId = `${TAG}-link`;
        await writeAuditLog({
            action: 'VOID',
            tableName: 'audit_chain_probe',
            rowPk: '1',
            reason: 'probe',
            metadata: { probe: TAG },
            actor: { userId: null, userName: 'probe', role: 'tester', requestId: linkRequestId },
        });

        const rows = await rowByRequest(linkRequestId);
        expect(rows).toHaveLength(1);
        linkRowId = rows[0].id;
        expect(rows[0].entry_hash).toMatch(/^[0-9a-f]{64}$/);

        const prev = await pool.query(
            `SELECT entry_hash FROM pos_audit_logs
              WHERE entry_hash IS NOT NULL AND id < $1
              ORDER BY id DESC LIMIT 1;`,
            [linkRowId]
        );
        expect(rows[0].prev_hash).toBe(prev.rows[0].entry_hash);
        expect((await verify()).ok).toBe(true);
    });

    it('قيم prev_hash/entry_hash المُرسَلة من الكاتب تُستبدل ولا تُقبل', async () => {
        const requestId = `${TAG}-forge`;
        const ins = await pool.query(
            `INSERT INTO pos_audit_logs
                (actor_username, actor_role, action, table_name, row_pk, reason,
                 request_id, metadata, prev_hash, entry_hash)
             VALUES ($1, 'tester', 'VOID', 'audit_chain_probe', '2', 'forge',
                 $2, '{}'::jsonb, 'deadbeef', 'deadbeef')
             RETURNING id, prev_hash, entry_hash;`,
            ['probe', requestId]
        );
        expect(ins.rows[0].prev_hash).not.toBe('deadbeef');
        expect(ins.rows[0].entry_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(ins.rows[0].entry_hash).not.toBe('deadbeef');
        expect((await verify()).ok).toBe(true);
    });
});

describe('الكشف عن العبث', () => {
    it('تعديل حقل في صف قائم يُكشف كـhash_mismatch، والترميم يعيد السلسلة', async () => {
        const [row] = await rowByRequest(linkRequestId);
        const originalReason = row.reason;

        await setTrigger('trg_pos_prevent_audit_update', false);
        try {
            await pool.query('UPDATE pos_audit_logs SET reason = $2 WHERE id = $1;', [row.id, 'tampered']);
        } finally {
            await setTrigger('trg_pos_prevent_audit_update', true);
        }

        const broken = await verify();
        expect(broken.ok).toBe(false);
        expect(broken.reason).toBe('hash_mismatch');
        expect(Number(broken.broken_at)).toBe(Number(row.id));

        await setTrigger('trg_pos_prevent_audit_update', false);
        try {
            await pool.query('UPDATE pos_audit_logs SET reason = $2 WHERE id = $1;', [row.id, originalReason]);
        } finally {
            await setTrigger('trg_pos_prevent_audit_update', true);
        }
        expect((await verify()).ok).toBe(true);
    });

    it('حذف صف يُكشف عند الصف التالي كـprev_mismatch، والتـرميم يعيد السلسلة', async () => {
        const [row] = await rowByRequest(linkRequestId);
        const next = await pool.query(
            'SELECT id FROM pos_audit_logs WHERE entry_hash IS NOT NULL AND id > $1 ORDER BY id LIMIT 1;',
            [row.id]
        );
        expect(next.rowCount).toBeGreaterThan(0); // يوجد صف تالٍ فعلًا
        // occurred_at نصًّا لا Date: تحويله إلى Date يقطع الميكروثانية فيتغيّر
        // الحِمل عند الترميم ويظهر كسر وهمي.
        const raw = await pool.query(
            'SELECT occurred_at::text AS occurred_at_text FROM pos_audit_logs WHERE id = $1;',
            [row.id]
        );
        const occurredAtText = raw.rows[0].occurred_at_text;

        await setTrigger('trg_pos_prevent_audit_delete', false);
        try {
            await pool.query('DELETE FROM pos_audit_logs WHERE id = $1;', [row.id]);
        } finally {
            await setTrigger('trg_pos_prevent_audit_delete', true);
        }

        const broken = await verify();
        expect(broken.ok).toBe(false);
        expect(broken.reason).toBe('prev_mismatch');
        expect(Number(broken.broken_at)).toBe(Number(next.rows[0].id));

        // الترميم: إعادة الصف بمعرّفه وختمه الأصليين، ومشغّل السلسلة معطّل
        // حتى لا يعيد حسابهما من الذيل الحالي.
        await setUserTriggers(false);
        try {
            await pool.query(
                `INSERT INTO pos_audit_logs
                    (id, occurred_at, actor_user_id, actor_username, actor_role, actor_ip,
                     action, table_name, row_pk, data_before, data_after, reason,
                     request_id, metadata, prev_hash, entry_hash)
                 OVERRIDING SYSTEM VALUE
                 VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16);`,
                [row.id, occurredAtText, row.actor_user_id, row.actor_username, row.actor_role,
                    row.actor_ip, row.action, row.table_name, row.row_pk, row.data_before,
                    row.data_after, row.reason, row.request_id, row.metadata,
                    row.prev_hash, row.entry_hash]
            );
        } finally {
            await setUserTriggers(true);
        }
        expect((await verify()).ok).toBe(true);
    });
});

describe('الفجوات المشروعة والمدقّق', () => {
    it('صف أُدرج والمشغّلات معطّلة يُعدّ «غير مختوم» لا كسرًا', async () => {
        const requestId = `${TAG}-unchained`;
        await setUserTriggers(false);
        try {
            await pool.query(
                `INSERT INTO pos_audit_logs
                    (actor_username, actor_role, action, table_name, row_pk, reason, request_id)
                 VALUES ('probe', 'tester', 'VOID', 'audit_chain_probe', '3', 'unchained', $1);`,
                [requestId]
            );
        } finally {
            await setUserTriggers(true);
        }

        const result = await verify();
        expect(result.ok).toBe(true);
        expect(Number(result.unchained)).toBeGreaterThanOrEqual(1);

        // تنظيف: حذف صف غير مختوم لا يمسّ السلسلة.
        await setTrigger('trg_pos_prevent_audit_delete', false);
        try {
            await pool.query('DELETE FROM pos_audit_logs WHERE request_id = $1;', [requestId]);
        } finally {
            await setTrigger('trg_pos_prevent_audit_delete', true);
        }
        expect((await verify()).ok).toBe(true);
    });

    it('الحِمل القانوني حتميّ: ترتيب مفاتيح JSON لا يغيّر الـhash، وتغيير قيمة يغيّره', async () => {
        const r = await pool.query(
            `SELECT
                pos_audit_chain_payload(1, '2026-01-01T00:00:00.123456Z'::timestamptz, 'a', 'r',
                    '10.0.0.1'::inet, 'VOID', 't', '1', '{"x":1}'::jsonb, '{}'::jsonb,
                    'why', 'req', '{"b":2,"a":1}'::jsonb, 'GENESIS') AS p1,
                pos_audit_chain_payload(1, '2026-01-01T00:00:00.123456Z'::timestamptz, 'a', 'r',
                    '10.0.0.1'::inet, 'VOID', 't', '1', '{"x":1}'::jsonb, '{}'::jsonb,
                    'why', 'req', '{"a":1,"b":2}'::jsonb, 'GENESIS') AS p2,
                pos_audit_chain_payload(1, '2026-01-01T00:00:00.123456Z'::timestamptz, 'a', 'r',
                    '10.0.0.1'::inet, 'VOID', 't', '1', '{"x":1}'::jsonb, '{}'::jsonb,
                    'why', 'req', '{"a":1,"b":3}'::jsonb, 'GENESIS') AS p3;`
        );
        expect(r.rows[0].p1).toBe(r.rows[0].p2);
        expect(r.rows[0].p3).not.toBe(r.rows[0].p1);
    });

    it('الفحص من معرّف يبدأ بالسلسلة عنده ويربطها بما قبلها', async () => {
        const result = await verify(linkRowId);
        expect(result.ok).toBe(true);
        expect(Number(result.checked)).toBeGreaterThanOrEqual(1);
    });
});
