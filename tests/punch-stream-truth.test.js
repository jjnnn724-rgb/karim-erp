// ────────────────────────────────────────────────────────────────────────────
// punch-stream-truth.test.js — قرار المالك 2026-11-05 (مساءً):
// «عايز البصمة تكون مصدر الحقيقة الوحيد، سواء بصمة الجهاز أو بصمة الكاميرا،
//  دون ذلك لا — لا إكملة ولا تعقيدات.»
//
// القاعدة الواحدة في attendance-engine.js: أول بصمة في يوم الوردية = حضور،
// وكل بصمة بعدها = انصراف (آخر بصمة هي الانصراف) — للمصدرين معًا بلا تفريق.
// ملصق حالة الجهاز (0/1) يبقى دليلًا خامًا في attendance_logs ويُسجَّل مخالفةً
// في attendance_decisions، لكنه لا يبتلع بصمة ولا يُنشئ صفًّا ولا يُخلِّف يتيمًا.
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

describe('عقد المصدر: البصمة حاكمة — لا ملصق ولا مصدر يُلغيها', () => {
    test('الاتجاه من التسلسل وحده — لا فرع خاص بالبوابة ولا ملصق يحكم', () => {
        expect(ENGINE).toContain("const dir = (openRow || (rowForDay && rowForDay.checkIn)) ? 'out' : 'in';");
        expect(ENGINE).not.toMatch(/source === 'portal' && !known/);
        expect(ENGINE).not.toMatch(/else if \(deviceIn\)/);
    });

    test('لا مسار يُسقط بصمة بـ«حالة غير معروفة»، ولا صف «انصراف بلا دخول» يُنشأ', () => {
        expect(ENGINE).not.toMatch(/حالة بصمة غير معروفة/);
        expect(ENGINE).not.toMatch(/انصراف بلا بصمة دخول/);
        expect(ENGINE).not.toMatch(/check_out_without_in/);
    });

    test('الملصق المخالف يُعلَّم في attendance_decisions ولا يغيّر الحكم', () => {
        const at = ENGINE.indexOf("decision: 'state_conflict'");
        expect(at).toBeGreaterThan(-1);
        const block = ENGINE.slice(at - 260, at + 700);
        expect(block).toContain('ملصق الجهاز');
        expect(block).toContain('البصمة حاكمة');
        expect(block).toMatch(/saysIn && dir === 'out'|saysOut && dir === 'in'/);
    });

    test('الحارسان الباقيان: التبريد (بصمة واحدة مرة) ومنع الاختلاق', () => {
        expect(ENGINE).toContain('AND ("checkInAt" BETWEEN $4 AND $5 OR "checkOutAt" BETWEEN $4 AND $5)');
        expect(ENGINE).toContain('لا يُخترع انصراف ولا حضور من فراغ');
        expect(ENGINE).not.toMatch(/checkout_inferred\s*=\s*true/);
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
        expect((await decisionsOf(P_LABEL_FLIP, 'state_conflict')).length).toBe(1);
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
        // مخالفة واحدة موثَّقة: بصمة 13:52 ملصوقها «دخول» والتسلسل يحكم بانصراف مُمتدّ
        expect((await decisionsOf(P_DOUBLE_TAP, 'state_conflict')).length).toBe(1);
    });

    test('دخول الليل ملصوق «انصرافًا»: يُحجز حضورًا ولا يُترَك اليوم يتيمًا', async () => {
        const inRes = await punch(P_NIGHT_ENTRY, '2026-11-05T14:04:11.000Z', 1); // 17:04
        expect(inRes.action).toBe('check_in');
        let r = await rowOf(P_NIGHT_ENTRY, '2026-11-05');
        expect(r.checkIn).toBe('17:04');
        expect(r.checkOut).toBeNull();
        expect(r.late).toBe(true);          // بدايته 17:00 — أربع دقائق من أول دقيقة
        expect((await decisionsOf(P_NIGHT_ENTRY, 'state_conflict')).length).toBe(1);

        const outRes = await punch(P_NIGHT_ENTRY, '2026-11-05T23:51:40.000Z', 1); // 02:51 فجر 11-06
        expect(outRes.action).toBe('check_out');
        r = await rowOf(P_NIGHT_ENTRY, '2026-11-05');
        expect(r.checkOut).toBe('02:51');   // انصراف الوردية الليلية على صف يومها
        expect(await rowCount(P_NIGHT_ENTRY)).toBe(1);
    });

    test('بلا بصمة ⇒ بلا صف: لا دخول ولا انصراف من فراغ', async () => {
        expect(await rowCount(P_NO_PUNCH)).toBe(0);
    });

    test('بصمة أقدم من انصراف محجوز لا تعيد عقارب اليوم (إعادة بناء مؤرخة)', async () => {
        await punch(P_LABEL_FLIP, '2026-11-05T01:00:00.000Z', 1); // 04:00 — بعد انصرافه المحجوز
        const r = await rowOf(P_LABEL_FLIP, '2026-11-05');
        expect(r.checkOut).toBe('17:02');
        expect(r.workMinutes).toBe(610);
    });
});

describe('حارس التبريد يبقى فوق القاعدة الجديدة', () => {
    test('نفس البصمة تُطبَّق مرة: النسخة الثانية تُهمَل وتُعلَّم ولا تصنع انصرافًا', async () => {
        const first = await punch(P_DOUBLE_TAP, '2026-11-05T21:00:00.000Z', 1); // 00:00 → يمتد الانصراف
        expect(first.action).toBe('check_out');
        const clone = await punch(P_DOUBLE_TAP, '2026-11-05T21:00:00.099Z', 1); // نفس اللحظة +99 مللي
        expect(clone.action).toBe('ignore');
        expect(clone.cooldown).toBe(true);
        const r = await rowOf(P_DOUBLE_TAP, '2026-11-05');
        expect(r.checkOut).toBe('00:00');
        expect(await rowCount(P_DOUBLE_TAP)).toBe(1); // لا صف متخلَّق لليوم التالي
    });
});
