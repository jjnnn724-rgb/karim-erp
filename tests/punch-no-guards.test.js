// ────────────────────────────────────────────────────────────────────────────
// punch-no-guards.test.js — قرار المالك 2026-11-05 مساءً:
// «مش عايز تقيدات ولا شفاعات ولا حراس — بصم تظهر، مش بصم مش تظهر».
//
// المحرك لم يعد يحرس البصمة من نفسها: لا قرار «تجاهل» ولا نافذة تبريد ولا كاش
// ولا ملصق جهاز ولا مفتاح بيئة. اليوم يُبنى من أطراف بصمات الموظف (أقدمها دخول،
// أحدثها انصراف)، والبناء لا يعتمد على ترتيب الوصول — فتكرار البصمة أو تأخر
// مزامنتها لا يبتلعها ولا يصنع صفًّا ثانيًا. الدرس القديم يبقى: الدليل من القاعدة.
//
// استُبدل هذا الملف بـ punch-dedup-guard.test.js و punch-cooldown-guard.test.js
// (كانا يقفلان حراسًا حُذفت، والدرس الأصلي — الكاش الراسب — مقفول هنا بالوجه الإيجابي).
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');
const { engine, instantToWall } = require('../backend/attendance-engine');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');

const G_ORDER = 900000011; // بصم تصل بالمقلوب
const G_TWICE = 900000012; // نفس البصمة تصل مرتين من مصدرين

async function mk(id, name, start, hours, code) {
    await pool.query(
        `INSERT INTO employees (id, name, "employeeId", shift_start, shift_karim, status)
         VALUES ($1,$2,$3,$4,$5,'active') ON CONFLICT (id) DO NOTHING`,
        [id, name, code, start, hours]);
}
async function punch(id, isoUtc, source = 'device') {
    const instant = new Date(isoUtc);
    return engine.processPunch({ employeeId: id, instant, wall: instantToWall(instant),
        device: { id: 1, name: 'بصمه العمل' }, source });
}
const rowOf = async (id, date) => (await pool.query(
    'SELECT * FROM attendance WHERE "employeeId"=$1 AND date=$2', [id, date])).rows[0] || null;

beforeAll(async () => {
    for (const id of [G_ORDER, G_TWICE]) {
        await pool.query('DELETE FROM attendance WHERE "employeeId" = $1', [id]).catch(() => {});
    }
    await mk(G_ORDER, 'Probe — بلا ترتيب', '07:00', 10, 'PROBE-ORDER');
    await mk(G_TWICE, 'Probe — بلا حارس', '20:00', 10, 'PROBE-TWICE');
});
afterAll(async () => {
    for (const id of [G_ORDER, G_TWICE]) {
        await pool.query('DELETE FROM attendance WHERE "employeeId" = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM employees WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
});

describe('عقد «لا حراس» في الكود', () => {
    test('لا قرار تجاهل إطلاقًا: كل بصمة تُطبَّق أو لا تحتاج شيئًا', () => {
        expect(ENGINE).not.toMatch(/action: 'ignore'/);
        expect(ENGINE).not.toMatch(/duplicate: true|outOfOrder|alreadyBooked|cooldown/i);
        expect(ENGINE).not.toMatch(/attendance_decisions/); // لا صفحة مراجعة لبصمة صحيحة
    });
    test('لا حالة بين الطلبات: لا كاش ولا مفتاح بيئة ولا قراءة env في المحرك', () => {
        expect(ENGINE).not.toMatch(/lastPunches|punchCache|recentPunch|dedupCache/);
        expect(ENGINE).not.toMatch(/process\.env\./);
        const ctor = ENGINE.slice(ENGINE.indexOf('constructor() {'), ENGINE.indexOf('setIO(io)'));
        expect(ctor).toContain('this.io = null;');
        expect(ctor).not.toMatch(/new Map\(\)|new Set\(\)/);
    });
    test('قفل واحد لكل موظف (hashtext لا معرّف خام) يسبق كل قراءة وكتابة', () => {
        const lockAt = ENGINE.indexOf('pg_advisory_xact_lock(hashtext($1::text))');
        expect(lockAt).toBeGreaterThan(-1);
        expect((ENGINE.match(/pg_advisory_xact_lock/g) || []).length).toBe(1);
        const firstRead = ENGINE.indexOf('FROM attendance', lockAt);
        expect(firstRead).toBeGreaterThan(lockAt);
        expect(ENGINE.slice(lockAt, firstRead)).not.toMatch(/INSERT INTO attendance|UPDATE attendance/);
        // صفا يوم الوردية ويومه السابق في قراءة واحدة — الدليل من القاعدة
        expect(ENGINE).toContain('WHERE "employeeId" = $1 AND date IN ($2, $3)');
    });
    test('قراءتان مقفلتان فقط: يوم البصمة ويومُها السابق — لا ثالث لهما', () => {
        // إحداهما الصفان معًا (date IN ($2,$3))، والثانية استطلاع انصراف الليل على
        // يومٍ مفتوح حين لا صفّ لليوم — ولا قراءة ثالثة تُبتنى عليها كتابة.
        expect((ENGINE.match(/FOR UPDATE/g) || []).length).toBe(2);
    });
});

describe('سلوك «لا حراس» على القاعدة', () => {
    test('بصم تصل بالمقلوب تبني نفس اليوم: أقدمها دخول وأحدثها انصراف', async () => {
        await punch(G_ORDER, '2026-11-05T14:02:39.000Z'); // 17:02 الانصراف وصل أول
        await punch(G_ORDER, '2026-11-05T03:52:27.000Z'); // 06:52 الدخول وصل متأخرًا
        const r = await rowOf(G_ORDER, '2026-11-05');
        expect(r.checkIn).toBe('06:52');
        expect(r.checkOut).toBe('17:02');
        expect(r.workMinutes).toBe(610);
    });

    test('نفس البصمة من مصدرين لا تصنع صفًّا ثانيًا ولا انصرافًا زائفًا', async () => {
        await punch(G_TWICE, '2026-11-05T05:00:00.000Z', 'portal'); // 08:00 كاميرا
        const again = await punch(G_TWICE, '2026-11-05T05:00:00.123Z', 'device'); // نفس الثانية جهاز
        expect(again.changed).toBe(false);
        const r = await rowOf(G_TWICE, '2026-11-05');
        expect(r.checkIn).toBe('08:00');
        expect(r.checkOut).toBeNull();          // لا انصراف بلا بصمة ثانية حقيقية
        expect(r.workMinutes).toBeNull();
        await punch(G_TWICE, '2026-11-05T17:30:00.000Z', 'device'); // 20:30 انصراف
        const done = await rowOf(G_TWICE, '2026-11-05');
        expect(done.checkOut).toBe('20:30');
        expect(done.workMinutes).toBe(750);
    });

    test('لا صف لليوم القادم من بصمة الفجر المحجوزة على يومها (لا دخول متخلَّق)', async () => {
        const dawn = await punch(G_TWICE, '2026-11-05T21:04:54.000Z', 'device'); // 00:04:54 من 11-06
        expect(dawn.day).toBe('2026-11-05');  // يوم الوردية لا يوم التقويم
        const next = await rowOf(G_TWICE, '2026-11-06');
        expect(next).toBeNull();              // ولا صف دخول متخلَّق للغد
        const r = await rowOf(G_TWICE, '2026-11-05');
        expect(r.checkOut).toBe('00:04');
    });
});
