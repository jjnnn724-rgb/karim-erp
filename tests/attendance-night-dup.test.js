'use strict';
/** حارس انصراف ما بعد منتصف الليل — عقود نقية بلا قاعدة بيانات. */
const { isDuplicateNightCheckout } = require('../backend/attendance-engine');

const PREV = {
    date: '2026-11-23',
    checkInAt: new Date('2026-11-23T10:04:39.000Z'),
    checkOutAt: new Date('2026-11-23T22:10:53.000Z'),
};

describe('isDuplicateNightCheckout', () => {
    test('انصرافان متقاربان بعد منتصف الليل ⇒ تكرار (لا وردية جديدة)', () => {
        expect(isDuplicateNightCheckout(PREV, '2026-11-24', new Date('2026-11-23T22:14:22.000Z'), 10)).toBe(true);
    });

    test('حد النافذة بالدقيقة', () => {
        expect(isDuplicateNightCheckout(PREV, '2026-11-24', new Date('2026-11-23T22:20:53.000Z'), 10)).toBe(true);
        expect(isDuplicateNightCheckout(PREV, '2026-11-24', new Date('2026-11-23T22:20:54.000Z'), 10)).toBe(false);
    });

    test('بصمة أقدم من الانصراف أو بلا انصراف سابق ⇒ ليس تكرارًا', () => {
        expect(isDuplicateNightCheckout(PREV, '2026-11-24', new Date('2026-11-23T22:05:00.000Z'))).toBe(false);
        expect(isDuplicateNightCheckout({ date: PREV.date }, '2026-11-24', new Date('2026-11-23T22:12:00.000Z'))).toBe(false);
    });

    test('يوم غير اليوم التالي مباشرة ⇒ ليس تكرارًا ليليًا', () => {
        expect(isDuplicateNightCheckout(PREV, '2026-11-25', new Date('2026-11-24T22:12:00.000Z'))).toBe(false);
    });

    test('بلا صف سابق ⇒ ليس تكرارًا', () => {
        expect(isDuplicateNightCheckout(null, '2026-11-24', new Date('2026-11-23T22:12:00.000Z'))).toBe(false);
    });
});
