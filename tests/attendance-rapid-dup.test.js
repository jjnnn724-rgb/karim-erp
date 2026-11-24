'use strict';
/**
 * حارس التكرار العام — عقود نقية بلا قاعدة بيانات.
 * القاعدة: بصمتان متقاربتان في نفس الاتجاه = ضغطة واحدة؛ الاتجاه المعاكس
 * دائمًا يُنفَّذ (لا نافذة تبريد تبتلع بصمة حقيقية).
 */
const { isRapidDuplicatePunch, PUNCH_DEDUP_WINDOW_MIN } = require('../backend/attendance-engine');

const AT = '2026-11-24T09:51:09.000Z';
function log(isoUtc, punchState) {
    return { attendanceTime: new Date(isoUtc), punchState };
}
function check(lastLog, action, punchState, row = null, instant = AT) {
    return isRapidDuplicatePunch({ lastLog, instant, action, punchState, row });
}

describe('isRapidDuplicatePunch —Device (الاتجاه معلن)', () => {
    test('نافذة التكرار الافتراضية تغطي حالة أحمد سعد (3.5 دقيقة)', () => {
        expect(PUNCH_DEDUP_WINDOW_MIN).toBeGreaterThanOrEqual(10);
        const prev = log('2026-11-23T22:14:22.000Z', 1); // 01:14 انصراف مكرر
        expect(check(prev, 'check_out', 1, null, '2026-11-23T22:10:53.000Z')).toBe(false); // الأقدم يبقى
        expect(check(log('2026-11-23T22:10:53.000Z', 1), 'check_out', 1, null, '2026-11-23T22:14:22.000Z')).toBe(true);
    });

    test('انصرافان متقاربان ⇒ تكرار (لا صف جديد)', () => {
        expect(check(log('2026-11-24T09:46:00.000Z', 1), 'check_out', 1)).toBe(true);
    });

    test('دخولان متقاربان ⇒ تكرار', () => {
        expect(check(log('2026-11-24T09:44:00.000Z', 0), 'check_in', 0)).toBe(true);
    });

    test('الاتجاه المعاكس حتى بعد ثانية واحدة ⇒ يُنفَّذ (قرار لا نافذة تبريد)', () => {
        expect(check(log('2026-11-24T09:51:07.500Z', 1), 'check_out', 0)).toBe(false);
        expect(check(log('2026-11-24T09:51:07.500Z', 0), 'check_in', 1)).toBe(false);
    });

    test('خارج النافذة / بصمة أقدم / بلا سابق ⇒ ليس تكرارًا', () => {
        expect(check(log('2026-11-24T09:30:00.000Z', 1), 'check_out', 1)).toBe(false);
        expect(check(log('2026-11-24T10:00:00.000Z', 1), 'check_out', 1)).toBe(false);
        expect(check(null, 'check_out', 1)).toBe(false);
    });

    test('حالة خام مجهولة (-1) ⇒ لا حكم، لا منع', () => {
        expect(check(log('2026-11-24T09:49:00.000Z', -1), 'check_out', 1)).toBe(false);
    });
});

describe('isRapidDuplicatePunch — بوابة الجوال (بلا زر)', () => {
    const rowOut = { checkInAt: new Date('2026-11-24T09:00:00.000Z'), checkOutAt: new Date('2026-11-24T09:49:00.000Z') };
    const rowIn = { checkInAt: new Date('2026-11-24T09:49:00.000Z'), checkOutAt: null };

    test('ضغطة كاميرا مكررة عند الانصراف ⇒ تكرار', () => {
        expect(check(log('2026-11-24T09:49:00.000Z', 1), 'check_out', null, rowOut)).toBe(true);
    });

    test('ضغطة كاميرا مكررة عند الدخول ⇒ تكرار رغم أن الباني يحسبها انصرافًا', () => {
        expect(check(log('2026-11-24T09:49:00.000Z', 0), 'check_out', null, rowIn)).toBe(true);
    });

    test('دخول كاميرا بعد انصراف جهاز خلال دقائق ⇒ يُنفَّذ', () => {
        expect(check(log('2026-11-24T09:49:00.000Z', 1), 'check_in', null, rowOut)).toBe(false);
    });
});
