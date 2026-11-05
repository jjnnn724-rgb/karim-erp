// ────────────────────────────────────────────────────────────────────────────
// punch-cooldown-guard.test.js — بلاغ المالك 2026-11-05 (دخول الخميس المتخلَّق)
// بصمة واحدة طُبِّقت مرتين بفارق 99 مللي ثانية: المرّة الأولى سكرت بها سطر
// الليل (checkOutAt 06:04:54.542) والثانية أنشأت سطر اليوم التالي دخولًا
// (checkInAt 06:04:54.443) بلا بصمة خاصة به.
// يقفل الإصلاح في attendance-engine.js — حارس داخل نفس قفل الموظف+يوم الوردية:
//  1) الدليل من القاعدة (attendance endpoints) لا من كاش في الذاكرة — درس 2026-10-14
//  2) يسبق أي INSERT/UPDATE، فيرجع ignore بلا صفّ وبلا تسجيل طرف
//  3) يُعلَّم في attendance_decisions للمراجعة، والنافذة مفتاحُ طوارئ موثَّق
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');
const ENV_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

describe('حارس التبريد — البصمة الواحدة لا تُحجز مرتين', () => {
    it('يستعلم عن أطراف صفوف الحضور في القاعدة داخل نفس قفل الموظف+يوم الوردية', () => {
        expect(ENGINE).toContain('AND ("checkInAt" BETWEEN $4 AND $5 OR "checkOutAt" BETWEEN $4 AND $5)');
        const lockAt = ENGINE.indexOf('pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))');
        const guardAt = ENGINE.indexOf('حارس التبريد');
        expect(lockAt).toBeGreaterThan(-1);
        expect(guardAt).toBeGreaterThan(lockAt); // بعد القفل: لا سباق بين طلبين متتاليين
    });

    it('يسبق أي كتابة في attendance، ويرجع ignore بلا record', () => {
        const guardAt = ENGINE.indexOf('حارس التبريد');
        const firstWrite = ENGINE.indexOf('INSERT INTO attendance');
        expect(firstWrite).toBeGreaterThan(guardAt);
        expect(ENGINE).toContain("{ action: 'ignore', record: null, cooldown: true }");
    });

    it('نافذة اليوم السابق مغطّاة (انصراف الفجر على سطر الأمس هو الدليل)', () => {
        expect(ENGINE).toContain('[employeeId, shiftDate, prevDay(shiftDate), winStart, winEnd]');
    });

    it('الدليل من القاعدة وحدها — لا كاش في الذاكرة يبتلع بصمة موثقة', () => {
        expect(ENGINE).not.toMatch(/this\.lastPunches/);
    });

    it('البصمة المهمولة تُعلَّم للمراجعة في attendance_decisions', () => {
        const guardAt = ENGINE.indexOf('حارس التبريد');
        const block = ENGINE.slice(guardAt, guardAt + 1800);
        expect(block).toContain('decision: \'ignore\'');
        expect(block).toContain('نافذة التبريد');
        expect(block).toContain('await client.query(\'COMMIT\');');
    });

    it('المفتاح موثَّق في النموذج بحدوده وقيمة 0 كتعطيل', () => {
        expect(ENV_TEMPLATE).toContain('ATTENDANCE_PUNCH_COOLDOWN_MS=');
    });

    it('قراءة المفتاح: فارغ/شاذ = الافتراضي 2000، و0 يعطّل الحارس', () => {
        const eng = require('../backend/attendance-engine');
        const saved = process.env.ATTENDANCE_PUNCH_COOLDOWN_MS;
        try {
            delete process.env.ATTENDANCE_PUNCH_COOLDOWN_MS;
            expect(eng.punchCooldownMs()).toBe(2000);
            process.env.ATTENDANCE_PUNCH_COOLDOWN_MS = '0';
            expect(eng.punchCooldownMs()).toBe(0);
            process.env.ATTENDANCE_PUNCH_COOLDOWN_MS = '5000';
            expect(eng.punchCooldownMs()).toBe(5000);
            for (const bad of ['-5', 'abc', '60001', '']) {
                process.env.ATTENDANCE_PUNCH_COOLDOWN_MS = bad;
                expect(eng.punchCooldownMs()).toBe(2000);
            }
        } finally {
            if (saved === undefined) {delete process.env.ATTENDANCE_PUNCH_COOLDOWN_MS;}
            else {process.env.ATTENDANCE_PUNCH_COOLDOWN_MS = saved;}
        }
    });
});
