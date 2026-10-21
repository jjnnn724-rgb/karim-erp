/**
 * shift-day-boundary.test.js — حافّات ربط بصمات الفجر بوردية الأمس
 * (درس 2026-10-14: انصراف 05:01 لوردية 17:00+12h، وانصراف 00:13 لوردية
 *  12:00+12h، أُسندا لليوم الجديد فأغلقا سطره بلا دخول وحجبا دخوله المسائي)
 */
process.env.ATTENDANCE_SHIFT_DAY_MODE = 'on';
delete process.env.NIGHT_CUTOFF_HOUR;

const {
    shiftDateForEmployee, crossesMidnight, morningEndHour, nightCutoffHour,
} = require('../backend/shift-day');

const shift = (shift_start, shift_karim) => ({ shift_start, shift_karim });

describe('crossesMidnight — نهاية الوردية عند الفجر تمامًا عابرة', () => {
    test('12:00+12h (تنتهي 24:00) عابرة', () => {
        expect(crossesMidnight('12:00', 12)).toBe(true);
    });
    test('17:00+12h و22:00+12h عاديتان', () => {
        expect(crossesMidnight('17:00', 12)).toBe(true);
        expect(crossesMidnight('22:00', 12)).toBe(true);
    });
    test('وردية نهار 09:00+9h غير عابرة', () => {
        expect(crossesMidnight('09:00', 9)).toBe(false);
    });
    test('13:00+8.5h (تنتهي 21:30) غير عابرة', () => {
        expect(crossesMidnight('13:00', 8.5)).toBe(false);
    });
});

describe('morningEndHour — ساعة الفصل من الوردية نفسها', () => {
    test.each([
        ['17:00', 12, 5],
        ['16:30', 12, 4],
        ['22:00', 12, 10],
        ['12:00', 12, 0],
        ['14:00', 10, 0],
    ])('%s+%sh → ساعة الفجر %i', (start, karim, expected) => {
        expect(morningEndHour(start, karim)).toBe(expected);
    });
});

describe('shiftDateForEmployee — بصمات الفجر تُنسب لوردية الأمس', () => {
    test('القواطع مفعّلة والساعة الافتراضية 5', () => {
        expect(nightCutoffHour()).toBe(5);
    });

    test('17:00+12h: انصراف 05:01 (ساعة الحائط 5) ختام وردية الأمس', () => {
        expect(shiftDateForEmployee('2026-10-14', 5, shift('17:00', 12))).toBe('2026-10-13');
    });

    test('17:00+12h: حضور 16:55 لليوم نفسه', () => {
        expect(shiftDateForEmployee('2026-10-14', 16, shift('17:00', 12))).toBe('2026-10-14');
    });

    test('12:00+12h: انصراف 00:13 ختام وردية الأمس، وحضور 11:57 لليوم', () => {
        expect(shiftDateForEmployee('2026-10-14', 0, shift('12:00', 12))).toBe('2026-10-13');
        expect(shiftDateForEmployee('2026-10-14', 11, shift('12:00', 12))).toBe('2026-10-14');
    });

    test('14:00+10h (تنتهي 24:00): انصراف 00:03 ختام وردية الأمس', () => {
        expect(shiftDateForEmployee('2026-10-14', 0, shift('14:00', 10))).toBe('2026-10-13');
    });

    test('22:00+12h (تنتهي 10:00): بصمة 09:30 ختام وردية الأمس', () => {
        expect(shiftDateForEmployee('2026-10-14', 9, shift('22:00', 12))).toBe('2026-10-13');
    });

    test('وردية نهار 09:00+9h: بصمة الفجر تظل بتاريخها الميلادي', () => {
        expect(shiftDateForEmployee('2026-10-14', 1, shift('09:00', 9))).toBe('2026-10-14');
    });

    test('وضع off يُعطّل الترحيل كليًا', () => {
        const prev = process.env.ATTENDANCE_SHIFT_DAY_MODE;
        process.env.ATTENDANCE_SHIFT_DAY_MODE = 'off';
        try {
            expect(shiftDateForEmployee('2026-10-14', 1, shift('17:00', 12))).toBe('2026-10-14');
        } finally {
            process.env.ATTENDANCE_SHIFT_DAY_MODE = prev;
        }
    });

    test('NIGHT_CUTOFF_HOUR الأعلى يبقى مُعتبرًا (سقف أدنى لا حدّ صارم)', () => {
        const prev = process.env.NIGHT_CUTOFF_HOUR;
        process.env.NIGHT_CUTOFF_HOUR = '7';
        try {
            expect(shiftDateForEmployee('2026-10-14', 6, shift('17:00', 12))).toBe('2026-10-13');
        } finally {
            if (prev === undefined) {delete process.env.NIGHT_CUTOFF_HOUR;} else {process.env.NIGHT_CUTOFF_HOUR = prev;}
        }
    });
});
