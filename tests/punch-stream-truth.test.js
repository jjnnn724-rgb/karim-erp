// ────────────────────────────────────────────────────────────────────────────
// punch-stream-truth.test.js — قرار المالك 2026-11-05 (مساءً):
// «عايز البصمة تكون مصدر الحقيقة الوحيد، سواء بصمة الجهاز أو بصمة الكاميرا،
//  دون ذلك لا — لا إكملة ولا تعقيدات.»
//
// القاعدة الواحدة في attendance-engine.js: أطراف يوم الوردية من بصمات الموظف —
// أقدم بصمة دخول وأحدثها انصراف، للمصدرين معًا بلا تفريق وبلا ترتيب ورود.
// ملصق حالة الجهاز (0/1) لا يُقرأ، ولا حارس تكرار ولا نافذة ولا استثناء
// (قرار المالك 2026-11-05 مساءً: «مش عايز تقيدات ولا شفاعات ولا حراس»).
//
// الداء الذي يُغلقه هذا الملف: انقلب الملصق على خمسة موظفين (EMP-002 انصرافه
// ملصوق «دخولًا» فهُمل كيوم مفتوح، ومازن دخوله ملصوق «انصرافًا» فأُيِّم يومه)
// و223 قرار «check_out_without_in» في ثلاثين يومًا.
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');
const { engine, instantToWall } = require('../backend/attendance-engine');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');

// معرّفات تركيبية لا تصادم الإنتاج
const P_LABEL_FLIP = 900000001; //EMP-002 — انصراف ملصوق دخولًا
const P_DOUBLE_TAP = 900000002; //EMP-019 — نقرتان عند الدخول ثم انصراف حقيقي
const P_NIGHT_ENTRY = 900000003; //مازن — دخول الليل ملصوق انصرافًا
const P_NO_PUNCH = 900000004;   // لا بصمة ⇒ لا صف

async function mk(id, name, start, hours, code) {
    await pool.query(
        `INSERT INTO employees (id, name, "employeeId", shift_start, shift_karim, status)
         VALUES ($1,$2,$3,$4,$5,'active') ON CONFLICT (id) DO NOTHING`,
        [id, name, code, start, hours]);
}

/** بصمة: وقت مطلق (UTC) + ملصق الجهاز اختياري + مصدر */
async function punch(id, isoUtc, state, source = 'device') {
    const instant = new Date(isoUtc);
    return engine.processPunch({
        employeeId: id, punchState: state === undefined ? null : state,
        instant, wall: instantToWall(instant), device: { id: 1, name: 'بصمه العمل' }, source,
    });
}

async function rowOf(id, date) {
    const { rows } = await pool.query('SELECT * FROM attendance WHERE "employeeId"=$1 AND date=$2', [id, date]);
    return rows[0] || null;
}
async function rowCount(id) {
    const { rows } = await pool.query('SELECT count(*)::int n FROM attendance WHERE "employeeId"=$1', [id]);
    return rows[0].n;
}
async function decisionsOf(id, decision) {
    const { rows } = await pool.query(
        'SELECT reason FROM attendance_decisions WHERE "employeeId"=$1 AND decision=$2', [id, decision]);
    return rows;
}

beforeAll(async () => {
    for (const id of [P_LABEL_FLIP, P_DOUBLE_TAP, P_NIGHT_ENTRY, P_NO_PUNCH]) {
        await pool.query('DELETE FROM attendance WHERE "employeeId" = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM attendance_decisions WHERE "employeeId" = $1', [id]).catch(() => {});
    }
    await mk(P_LABEL_FLIP, 'Probe — ملصق مقلوب', '07:00', 10, 'PROBE-FLIP');
    await mk(P_DOUBLE_TAP, 'Probe — نقرة مزدوجة', '14:00', 10, 'PROBE-TAP');
    await mk(P_NIGHT_ENTRY, 'Probe — دخول الليل', '17:00', 12, 'PROBE-NIGHT');
    await mk(P_NO_PUNCH, 'Probe — بلا بصمة', '09:00', 9, 'PROBE-NONE');
});

afterAll(async () => {
    const ids = [P_LABEL_FLIP, P_DOUBLE_TAP, P_NIGHT_ENTRY, P_NO_PUNCH];
    for (const id of ids) {
        await pool.query('DELETE FROM attendance WHERE "employeeId" = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM attendance_decisions WHERE "employeeId" = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM employees WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
});

describe('عقد المصدر: البصمة حاكمة — لا ملصق ولا مصدر ولا حارس', () => {
    test('أطراف اليوم = أقدم بصمة وأحدثها — المعادلة لا تعرف ترتيب الوصول', () => {
        expect(ENGINE).toContain('const entryAt = points[0];');
        expect(ENGINE).toContain('const exitAt = points.length > 1 ? points[points.length - 1] : null;');
        expect(ENGINE).not.toMatch(/const dir = /);
        expect(ENGINE).not.toMatch(/source === 'portal'/);
    });

    test('ملصق الجهاز لا يُقرأ في الحكم أصلًا — لا وسيط ولا بروتوكول ولا مجموعة حالات', () => {
        expect(ENGINE).not.toMatch(/IN_STATES|OUT_STATES/);
        expect(ENGINE).not.toMatch(/require\(['"]\.\/zkteco\/protocol['"]\)/);
        expect(ENGINE).not.toMatch(/state_conflict/);
        expect(ENGINE).not.toMatch(/deviceIn|deviceOut/);
        // processPunch لا يستقبل punchState أصلًا (الوسيط محذوف من قائمة الوسائط)
        expect(ENGINE).toMatch(/async processPunch\(\{[^}]*\}\)/);
        expect(ENGINE.match(/async processPunch\(\{[^}]*\}\)/)[0]).not.toMatch(/punchState/);
    });

    test('لا حراس ولا «تجاهل» إطلاقًا: لا ignore ولا تبريد ولا كاش ولا مفتاح بيئة', () => {
        expect(ENGINE).not.toMatch(/action: 'ignore'/);
        expect(ENGINE).not.toMatch(/COOLDOWN|cooldownMs|outOfOrder|alreadyBooked/i);
        expect(ENGINE).not.toMatch(/BETWEEN \$4 AND \$5/);
        expect(ENGINE).not.toMatch(/process\.env\.ATTENDANCE_/);
        expect(ENGINE).not.toMatch(/this\.lastPunches|punchCache|recentPunch/);
        expect(ENGINE).toContain('لا يُخترع انصراف ولا حضور من فراغ');
        expect(ENGINE).not.toMatch(/checkout_inferred\s*=\s*true/);
        // ولا صف «انصراف بلا دخول» ولا حالة مجهولة تُسقط بصمة
        expect(ENGINE).not.toMatch(/حالة بصمة غير معروفة|انصراف بلا بصمة دخول|check_out_without_in/);
    });
});

describe('إعادة بناء يوم الموظف من بصماته هو — الحالات الأربع المرصودة', () => {
    test('ملصق مقلوب: انصراف ملصوق «دخولًا» يُحجز انصرافًا ولا يُمحى اليوم', async () => {
        await punch(P_LABEL_FLIP, '2026-11-05T03:52:27.000Z', 0); // 06:52 دخول
        const out = await punch(P_LABEL_FLIP, '2026-11-05T14:02:39.000Z', 0); // 17:02 والملصق كاذب
        expect(out.action).toBe('check_out');
        const r = await rowOf(P_LABEL_FLIP, '2026-11-05');
        expect(r.checkIn).toBe('06:52');
        expect(r.checkOut).toBe('17:02');
        expect(r.workMinutes).toBe(610);   // 06:52 → 17:02 = 10 ساعات و10 دقائق
        expect(await rowCount(P_LABEL_FLIP)).toBe(1);
        // الملصق لم يُقرأ: لا قرار مخالفة ولا سجل — البصمة حُجزت وخلا
        expect((await decisionsOf(P_LABEL_FLIP, 'state_conflict')).length).toBe(0);
        expect((await decisionsOf(P_LABEL_FLIP, 'ignore')).length).toBe(0);
    });

    test('نقرة مزدوجة عند الدخول: آخر بصمة هي الانصراف — لا يوم 5 دقائق', async () => {
        await punch(P_DOUBLE_TAP, '2026-11-05T10:47:22.000Z', null, 'portal'); // 13:47 كاميرا
        await punch(P_DOUBLE_TAP, '2026-11-05T10:52:45.000Z', 0);              // 13:52 جهاز
        const last = await punch(P_DOUBLE_TAP, '2026-11-05T20:43:16.000Z', 1); // 23:43 الانصراف
        expect(last.action).toBe('check_out');
        const r = await rowOf(P_DOUBLE_TAP, '2026-11-05');
        expect(r.checkIn).toBe('13:47');
        expect(r.checkOut).toBe('23:43');
        expect(r.workMinutes).toBe(596);   // 13:47 → 23:43
        expect(await rowCount(P_DOUBLE_TAP)).toBe(1);
        // لا مخالفة موثَّقة: الملصق «دخول» عند 13:52 لم يُقرأ، والبصمة مدّت الانصراف
        expect((await decisionsOf(P_DOUBLE_TAP, 'state_conflict')).length).toBe(0);
    });

    test('دخول الليل ملصوق «انصرافًا»: يُحجز حضورًا ولا يُترَك اليوم يتيمًا', async () => {
        const inRes = await punch(P_NIGHT_ENTRY, '2026-11-05T14:04:11.000Z', 1); // 17:04
        expect(inRes.action).toBe('check_in');
        let r = await rowOf(P_NIGHT_ENTRY, '2026-11-05');
        expect(r.checkIn).toBe('17:04');
        expect(r.checkOut).toBeNull();
        expect(r.late).toBe(true);          // بدايته 17:00 — أربع دقائق من أول دقيقة
        expect((await decisionsOf(P_NIGHT_ENTRY, 'state_conflict')).length).toBe(0);

        const outRes = await punch(P_NIGHT_ENTRY, '2026-11-05T23:51:40.000Z', 1); // 02:51 فجر 11-06
        expect(outRes.action).toBe('check_out');
        r = await rowOf(P_NIGHT_ENTRY, '2026-11-05');
        expect(r.checkOut).toBe('02:51');   // انصراف الوردية الليلية على صف يومها
        expect(await rowCount(P_NIGHT_ENTRY)).toBe(1);
    });

    test('بلا بصمة ⇒ بلا صف: لا دخول ولا انصراف من فراغ', async () => {
        expect(await rowCount(P_NO_PUNCH)).toBe(0);
    });

    test('بصمة أسبق من الدخول المحجوز تُصحّح أطراف اليوم (وصلت متأخرة من الجهاز)', async () => {
        const res = await punch(P_LABEL_FLIP, '2026-11-05T01:00:00.000Z', 1); // 04:00 — قبل دخوله 06:52
        expect(res.action).toBe('check_in');   // الدخول صار أقدم بصمة
        const r = await rowOf(P_LABEL_FLIP, '2026-11-05');
        expect(r.checkIn).toBe('04:00');
        expect(r.checkOut).toBe('17:02');      // الانصراف لا يتزحزح عن آخر بصمة
        expect(r.workMinutes).toBe(783);       // 04:00:00 → 17:02:39
        expect(r.late).toBe(false);            // 04:00 قبل بداية 07:00
        expect(await rowCount(P_LABEL_FLIP)).toBe(1);
    });

    test('بصمة وسط اليوم لا تعيد رسمه: لا كتابة ولا تغيير في الأطراف', async () => {
        const before = await rowOf(P_LABEL_FLIP, '2026-11-05');
        const mid = await punch(P_LABEL_FLIP, '2026-11-05T08:30:00.000Z', 0); // 11:30 — بين الدخولين
        expect(mid.changed).toBe(false);
        expect(mid.record.id).toBe(before.id);
        const r = await rowOf(P_LABEL_FLIP, '2026-11-05');
        expect(r.checkIn).toBe('04:00');
        expect(r.workMinutes).toBe(783);
    });
});

describe('لا حارس تكرار: إعادة نفس البصمة لا تغيّر شيئًا (بلا نافذة ولا كاش)', () => {
    test('نفس البصمة ثانيةً ثانيةً: لا كتابة ولا انصراف مزدوج ولا صف متخلَّق', async () => {
        const first = await punch(P_DOUBLE_TAP, '2026-11-05T21:00:00.000Z', 1); // 00:00 → يمتد الانصراف
        expect(first.action).toBe('check_out');
        const clone = await punch(P_DOUBLE_TAP, '2026-11-05T21:00:00.099Z', 1); // نفس الثانية +99 مللي
        expect(clone.changed).toBe(false);
        expect(clone.action).toBe('check_out');
        const r = await rowOf(P_DOUBLE_TAP, '2026-11-05');
        expect(r.checkOut).toBe('00:00');
        expect(new Date(r.checkOutAt).toISOString()).toBe('2026-11-05T21:00:00.000Z');
        expect(await rowCount(P_DOUBLE_TAP)).toBe(1); // لا صف متخلَّق لليوم التالي
        expect((await decisionsOf(P_DOUBLE_TAP, 'ignore')).length).toBe(0);
    });

    test('بصمة حقيقية بعد ثانية واحدة تُطبَّق — لا سماحية ولا نافذة تبتلعها', async () => {
        const later = await punch(P_DOUBLE_TAP, '2026-11-05T21:00:01.500Z', 0); // 00:00:01.5
        expect(later.changed).toBe(true);
        expect(later.action).toBe('check_out');
        const r = await rowOf(P_DOUBLE_TAP, '2026-11-05');
        expect(r.checkOut).toBe('00:00');
        expect(new Date(r.checkOutAt).toISOString()).toBe('2026-11-05T21:00:01.500Z');
    });
});
