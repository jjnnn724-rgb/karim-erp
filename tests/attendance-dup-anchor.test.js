/**
 * attendance-dup-anchor.test.js — حرس «بصمة مكررة خلال 5 دقائق» يقارن الزمن المطلق
 * درس 2026-10-14: بصمة أمس 16:51 (دخول) أبقتها المرساة في الكاش لأن البصمة
 * الوسيطة لم تكتب شيئًا، فلما جاء دخول النهاردة 16:55 حُكم عليه «مكرر» وابتُلع
 * بصمت. التشابه بدقائق الساعة وحده لا يجعل بصمة مكررة — التكرار هو نفس اللحظة.
 */
const { classifyPunch, lastPunchFromRow } = require('../backend/attendance-engine');

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso).getTime();
const base = {
    shiftStartMin: 17 * 60,          // 17:00
    shiftEndMin: 17 * 60 + 12 * 60,  // 05:00 فجر اليوم التالي
    hasOpenRow: false,
    openRowCheckIn: null,
    pattern: { medianIn: 17 * 60 + 3, medianOut: (24 + 5) * 60, samples: 6 },
    dayLogs: { in: [], out: [] },
};

describe('حرس التكرار — التمايز عبر الأيام', () => {
    test('بصمة قبل 3 دقائق بنفس الاتجاه = مكررة فعلًا → تجاهل', () => {
        const punchAt = at('2026-10-14T16:55:00+03:00');
        const v = classifyPunch({ ...base, punchState: 0, wallMin: 16 * 60 + 55, punchAt,
            lastPunch: { min: 16 * 60 + 52, out: false, at: punchAt - 3 * 60000 } });
        expect(v.action).toBe('ignore');
        expect(v.reason).toContain('مكررة');
    });

    test('بصمة أمس في نفس دقيقة الساعة بنفس الاتجاه = دخول جديد، لا تكرار', () => {
        const punchAt = at('2026-10-14T16:55:00+03:00');
        const v = classifyPunch({ ...base, punchState: 0, wallMin: 16 * 60 + 55, punchAt,
            lastPunch: { min: 16 * 60 + 51, out: false, at: punchAt - DAY + 4 * 60000 } });
        expect(v.action).not.toBe('ignore');
        expect(v.action).toBe('in');       // قرب بداية الوردية → دخول
    });

    test('بصمة قبل 12 ساعة بنفس الاتجاه ليست تكرارًا', () => {
        const punchAt = at('2026-10-14T16:50:00+03:00');
        const v = classifyPunch({ ...base, punchState: 0, wallMin: 16 * 60 + 50, punchAt,
            lastPunch: { min: 5 * 60 - 4, out: false, at: punchAt - 12 * 60 * 60000 } });
        expect(v.action).toBe('in');
    });

    test('بلا لحظة مطلقة (مُدخل قديم) → السلوك السابق محفوظ', () => {
        const v = classifyPunch({ ...base, punchState: 0, wallMin: 16 * 60 + 55,
            lastPunch: { min: 16 * 60 + 53, out: false } });
        expect(v.action).toBe('ignore');
    });

    test('الاتجاه المخالف لا يقع في حرس التكرار أصلًا', () => {
        const punchAt = at('2026-10-14T05:00:00+03:00');
        const v = classifyPunch({ ...base, punchState: 1, wallMin: 5 * 60, punchAt,
            lastPunch: { min: 4 * 60 + 58, out: false, at: punchAt - 2 * 60000 } });
        expect(v.reason).not.toContain('مكررة');
    });
});

describe('lastPunchFromRow — المرساة تحمل لحظتها المطلقة', () => {
    test('صف خام → { min, out, at }', () => {
        const r = lastPunchFromRow({ attendanceTime: '2026-10-13T13:51:00.000Z', punchState: 0 });
        expect(r.out).toBe(false);
        expect(typeof r.at).toBe('number');
        expect(r.at).toBe(new Date('2026-10-13T13:51:00.000Z').getTime());
    });
    test('بلا وقت → null', () => {
        expect(lastPunchFromRow({ attendanceTime: null, punchState: 0 })).toBeNull();
    });
});
