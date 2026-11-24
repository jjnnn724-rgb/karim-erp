/**
 * attendance-shift-day-builder.test.js — قواعد البساطة الثلاث (قرار المالك 2026-11-07)
 * ──────────────────────────────────────────────────────────────────────────────
 * R1: أول بصمة دخول وآخرها انصراف، والتكرار يُهمل، وبصمة واحدة لا تصير دخولًا
 *     وانصرافًا في اللحظة نفسها.
 * R2: لا بصمة بلا مصدر معروف وهوية جهاز (أو مستخدم/سبب/اعتماد للبصمة اليدوية).
 * R3: الوردية من بدايتها لا من تاريخ التقويم؛ 23:45 + 00:15 وردية واحدة
 *     لبطاقة 14:00+10h أو 20:00+12h.
 * الاختبارات هنا نقية (بلا قاعدة بيانات) — الدليل الحي منفصل.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
    validatePunch, shiftDayForPunch, buildShiftDay, classifyStoredDay,
} = require('../backend/shift-day-builder');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const devicePunch = (at, extra = {}) => ({ at, source: 'device', deviceId: 1, ...extra });
const at = (date, time) => new Date(`${date}T${time}:00+03:00`);

describe('R2 — لا بصمة بلا مصدر وهوية', () => {
    test('بلا source ⇒ مرفوضة', () => {
        expect(validatePunch({ deviceId: 1 })).toMatchObject({
            ok: false, code: 'PUNCH_SOURCE_REQUIRED',
        });
    });

    test('بلا deviceId ⇒ مرفوضة (device و portal)', () => {
        expect(validatePunch({ source: 'device' })).toMatchObject({
            ok: false, code: 'PUNCH_DEVICE_REQUIRED',
        });
        expect(validatePunch({ source: 'portal' })).toMatchObject({
            ok: false, code: 'PUNCH_DEVICE_REQUIRED',
        });
    });

    test('مصدر خارج القائمة البيضاء ⇒ مرفوض', () => {
        expect(validatePunch({ source: 'telepathy', deviceId: 1 })).toMatchObject({
            ok: false, code: 'PUNCH_SOURCE_REQUIRED',
        });
    });

    test('اليدوية: هوية مستخدم + سبب + اعتماد — كلها إلزامية', () => {
        expect(validatePunch({ source: 'manual' })).toMatchObject({
            ok: false, code: 'MANUAL_PUNCH_USER_REQUIRED',
        });
        expect(validatePunch({ source: 'manual', userId: 7 })).toMatchObject({
            ok: false, code: 'MANUAL_PUNCH_REASON_REQUIRED',
        });
        expect(validatePunch({ source: 'manual', userId: 7, reason: 'تصحيح' })).toMatchObject({
            ok: false, code: 'MANUAL_PUNCH_APPROVAL_REQUIRED',
        });
        expect(validatePunch({
            source: 'manual', userId: 7, reason: 'تصحيح', approved: true,
        })).toEqual({ ok: true });
    });

    test('بناء يوم فيه بصمة بلا مصدر ⇒ اليوم كله تحت المراجعة ولا يُبنى', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [{ at: at('2026-11-01', '13:43') }],
        });
        expect(result.status).toBe('invalid_punch');
        expect(result.needsReview).toBe(true);
        expect(result.reviewReason).toBe('PUNCH_SOURCE_REQUIRED');
        expect(result.entryAt).toBeNull();
    });

    test('DDL: source بلا default + قيد القائمة البيضاء + كاتبان يعلنان مصدرهما', () => {
        const schema = read('backend', 'zkteco', 'schema.js');
        const migration = read('database', 'migrations', '144_attendance_punch_source.sql');
        const zkteco = read('backend', 'zkteco', 'engine.js');
        const portal = read('backend', 'attendance-portal-routes.js');
        const engine = read('backend', 'attendance-engine.js');

        expect(schema).not.toMatch(/source VARCHAR\(20\) NOT NULL DEFAULT/);
        expect(schema).toContain("CHECK (source IN ('device', 'portal', 'manual'))");
        expect(migration).toContain('DROP DEFAULT');
        expect(migration).toContain("CHECK (source IN ('device', 'portal', 'manual'))");
        expect(migration).toContain('NOT VALID');
        // كاتبان فقط: الجهاز يعلن 'device' والبوابة تعلن 'portal'
        expect((zkteco.match(/INSERT INTO attendance_logs/g) || []).length).toBe(1);
        expect(zkteco).toContain("SELECT $1, u, e, t, v, p, 'device'");
        expect(portal).toContain("VALUES ($1, $2::text, $3, $4, 15, $5, 'portal')");
        // المحرك لا يفترض مصدرًا
        expect(engine).not.toMatch(/source = 'device'/);
        expect(engine).toContain('validatePunch({ source, deviceId, device })');
    });
});

describe('R1 — أول بصمة دخول وآخرها انصراف', () => {
    test('بصمتان في نفس الثانية: الثانية تُهمل ⇒ بصمة واحدة تحتاج مراجعة لا انصرافًا وهميًا', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [
                devicePunch(at('2026-11-01', '13:43')),
                devicePunch(new Date(at('2026-11-01', '13:43').getTime() + 400), { source: 'portal' }),
            ],
        });
        expect(result.duplicates).toHaveLength(1);
        expect(result.punches).toHaveLength(1);
        expect(result.entryAt.toISOString()).toBe(at('2026-11-01', '13:43').toISOString());
        expect(result.exitAt).toBeNull();       // لا حضور + انصراف في نفس اللحظة
        expect(result.status).toBe('single_punch');
        expect(result.needsReview).toBe(true);
        expect(result.reviewReason).toBe('single_punch');
    });

    test('بصمة واحدة في اليوم ⇒ «تحتاج مراجعة» لا تخمين', () => {
        const built = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '09:00', shiftKarim: 9,
            punches: [devicePunch(at('2026-11-01', '09:02'))],
        });
        expect(built.status).toBe('single_punch');
        expect(built.needsReview).toBe(true);
        expect(built.exitAt).toBeNull();

        const stored = classifyStoredDay({ checkIn: '09:02', checkOut: null });
        expect(stored).toMatchObject({
            status: 'single_punch', needsReview: true, reviewReason: 'single_punch',
        });
    });

    test('ثلاث بصمات: الوسطى للعرض فقط ولا تدخل الساعات (10 ساعات مكتملة)', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [
                devicePunch(at('2026-11-01', '13:43')),
                devicePunch(at('2026-11-01', '18:10')),
                devicePunch(at('2026-11-01', '23:45')),
            ],
        });
        expect(result.middle).toHaveLength(1);
        expect(result.middle[0].at.toISOString()).toBe(at('2026-11-01', '18:10').toISOString());
        expect(result.entryAt.toISOString()).toBe(at('2026-11-01', '13:43').toISOString());
        expect(result.exitAt.toISOString()).toBe(at('2026-11-01', '23:45').toISOString());
        expect(result.workMinutes).toBe(602);
        expect(result.completedHours).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.needsReview).toBe(false);
    });
});

describe('R3 — الوردية من بدايتها لا من تاريخ التقويم', () => {
    test('14:00+10h: 23:45 من اليوم و00:15 من الغد وردية واحدة', () => {
        expect(shiftDayForPunch({ date: '2026-11-01', hour: 23, minute: 45 }, '14:00', 10))
            .toMatchObject({ date: '2026-11-01', confident: true });
        expect(shiftDayForPunch({ date: '2026-11-02', hour: 0, minute: 15 }, '14:00', 10))
            .toMatchObject({ date: '2026-11-01', confident: true });

        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [
                devicePunch(at('2026-11-01', '23:45')),
                devicePunch(at('2026-11-02', '00:15')),
            ],
        });
        expect(result.shiftDate).toBe('2026-11-01');
        expect(result.otherShift).toHaveLength(0); // وردية واحدة لا ورديتان
        expect(result.middle).toHaveLength(0);
        expect(result.entryAt.toISOString()).toBe(at('2026-11-01', '23:45').toISOString());
        expect(result.exitAt.toISOString()).toBe(at('2026-11-02', '00:15').toISOString());
        expect(result.workMinutes).toBe(30);
    });

    test('20:00+12h: 23:45 و07:00 من الغد وردية واحدة', () => {
        expect(shiftDayForPunch({ date: '2026-11-02', hour: 7, minute: 0 }, '20:00', 12))
            .toMatchObject({ date: '2026-11-01', confident: true });
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '20:00', shiftKarim: 12,
            punches: [
                devicePunch(at('2026-11-01', '23:45')),
                devicePunch(at('2026-11-02', '07:00')),
            ],
        });
        expect(result.entryAt.toISOString()).toBe(at('2026-11-01', '23:45').toISOString());
        expect(result.exitAt.toISOString()).toBe(at('2026-11-02', '07:00').toISOString());
        expect(result.workMinutes).toBe(435);
    });

    test('وردية نهارية لا تُسحب لليوم السابق', () => {
        expect(shiftDayForPunch({ date: '2026-11-01', hour: 8, minute: 30 }, '09:00', 9))
            .toMatchObject({ date: '2026-11-01', confident: true });
    });
});

describe('10 و12 ساعة — الإكمال يحسم الحكم', () => {
    test('10 ساعات: 13:43 → 23:45 = 602 دقيقة ⇒ مكتملة ولا مراجعة', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [
                devicePunch(at('2026-11-01', '13:43')),
                devicePunch(at('2026-11-01', '23:45')),
            ],
        });
        expect(result.requiredMinutes).toBe(600);
        expect(result.workMinutes).toBe(602);
        expect(result.completedHours).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.needsReview).toBe(false);
    });

    test('10 ساعات ناقصة: 13:30 → 23:20 = 590 دقيقة ⇒ غير مكتملة (نقص 10)', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '14:00', shiftKarim: 10,
            punches: [
                devicePunch(at('2026-11-01', '13:30')),
                devicePunch(at('2026-11-01', '23:20')),
            ],
        });
        expect(result.workMinutes).toBe(590);
        expect(result.completedHours).toBe(false);
        expect(result.requiredMinutes - result.workMinutes).toBe(10);
    });

    test('12 ساعة: 20:00 → 08:00 من الغد = 720 دقيقة ⇒ مكتملة تمامًا', () => {
        const result = buildShiftDay({
            shiftDate: '2026-11-01', shiftStart: '20:00', shiftKarim: 12,
            punches: [
                devicePunch(at('2026-11-01', '20:00')),
                devicePunch(at('2026-11-02', '08:00')),
            ],
        });
        expect(result.requiredMinutes).toBe(720);
        expect(result.workMinutes).toBe(720);
        expect(result.completedHours).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.needsReview).toBe(false);
    });
});

describe('الصف المحفوظ — نفس الحكم للمراجعة', () => {
    test('بصمة واحدة، صفر ساعات، ومدة مشكوك فيها كلها «تحتاج مراجعة»', () => {
        expect(classifyStoredDay({ checkIn: '13:43', checkOut: null }).needsReview).toBe(true);
        expect(classifyStoredDay({ checkIn: '13:43', checkOut: '13:43' })).toMatchObject({
            needsReview: true, reviewReason: 'zero_span',
        });
        expect(classifyStoredDay({ checkIn: '13:43', checkOut: '13:50' })).toMatchObject({
            needsReview: true, reviewReason: 'suspicious_span',
        });
    });

    test('يوم كامل 602 دقيقة ليس مراجعة', () => {
        expect(classifyStoredDay({ checkIn: '13:43', checkOut: '23:45' })).toMatchObject({
            workMinutes: 602, status: 'complete', needsReview: false,
        });
    });
});

describe('المرحلة 1 — واجهة النطاق تُرسل الحكم المحسوب للشاشات', () => {
    test('/api/attendance/range يرفق lateMinutes وstatus من نفس منطق البصمة', () => {
        const server = read('backend', 'server.js');
        expect(server).toMatch(/calculateDelayParts\(row, empShift\)/);
        expect(server).toMatch(/classifyStoredDay\(row, \{ shiftKarim/);
        expect(server).toMatch(/delayEngineEnabled\(\)/);
    });
});
