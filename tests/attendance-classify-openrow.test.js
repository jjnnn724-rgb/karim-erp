/**
 * attendance-classify-openrow.test.js — تغطية سيناريوهات الصف المفتوح
 * ─────────────────────────────────────────────────────────────────────
 * ROOT FIX 2026-10-02: classifyPunch كانت تستخدم openRowCheckIn دون
 * استقباله في التفكيك → ReferenceError على كل بصمة على صف مفتوح →
 * الصفقة تتراجع والبصمة تضيع (أغلب بصمات الخروج من الأجهزة!).
 * الاختبارات القديمة غطت hasOpenRow:false فقط — هذه تغطي الفرع الآخر.
 */
'use strict';

const { classifyPunch, lastPunchFromRow } = require('../backend/attendance-engine');

const BASE = {
    wallMin: 17 * 60,            // 17:00
    shiftStartMin: 9 * 60,       // 09:00
    shiftEndMin: 17 * 60,        // نهاية الوردية
    lastPunch: null,
    pattern: { medianIn: 9 * 60, medianOut: 17 * 60, samples: 10 },
    dayLogs: { in: [], out: [] },
};

describe('classifyPunch — صف مفتوح (hasOpenRow:true) لا يرمي ويصنف صح', () => {
    it('خروج بعد 3 ساعات من الدخول على صف مفتوح → يقفل الصف', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: true, openRowCheckIn: '09:05',
        });
        expect(v.action).toBe('out');
        expect(v.confidence).toBeGreaterThan(0);
        expect(v.reason).toBeTruthy();
    });

    it('خروج خلال 30 دقيقة من الدخول (حرس الارتداد) → تجاهل ضغط مزدوج', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: true, openRowCheckIn: '09:05', wallMin: 9 * 60 + 35,
        });
        expect(v.action).toBe('ignore');
    });

    it('خروج بعد فجوة 65 دقيقة (فوق حرس الساعة <= 60) → يقفل الصف', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: true, openRowCheckIn: '09:05', wallMin: 9 * 60 + 70,
        });
        expect(v.action).toBe('out');
    });

    it('زر دخول على صف مفتوح بفجوة قصيرة (ضغط مزدوج) → تجاهل', () => {
        const v = classifyPunch({
            ...BASE, punchState: 0, hasOpenRow: true, openRowCheckIn: '09:05', wallMin: 9 * 60 + 20,
        });
        expect(v.action).toBe('ignore');
    });

    it('زر دخول على صف مفتوح بفجوة 4 ساعات (الزر المنسي عند الخروج) → خروج بتجاوز', () => {
        const v = classifyPunch({
            ...BASE, punchState: 0, hasOpenRow: true, openRowCheckIn: '09:05', wallMin: 13 * 60 + 10,
        });
        expect(v.action).toBe('out');
        expect(v.override).toBe(true);
    });

    it('بلا openRowCheckIn ولا lastPunch → لا يرمي، والفجوة غير معروفة → الخروج يُقبل', () => {
        // الحد الدفاعي: fجوة 999 دقيقة خارج حرس الارتداد
        const out = classifyPunch({ ...BASE, punchState: 1, hasOpenRow: true, openRowCheckIn: null });
        expect(out.action).toBe('out');
        const inn = classifyPunch({ ...BASE, punchState: 0, hasOpenRow: true, openRowCheckIn: null, wallMin: 12 * 60 });
        // بلا فجوة معروفة لا يطبق حرس الزر المنسي ولا ضغط الارتداد الزمني
        expect(['ignore', 'out']).toContain(inn.action);
    });

    it('بصمة مكررة بنفس الاتجاه خلال 5 دقائق → تجاهل (حتى مع صف مفتوح)', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: true, openRowCheckIn: '09:05',
            lastPunch: { min: 16 * 60 + 57, out: true },
        });
        expect(v.action).toBe('ignore');
    });
});

describe('classifyPunch — بلا صف مفتوح (regression للسلوك القديم)', () => {
    it('زر خروج قرب بداية الوردية → دخول بتجاوز (الزمن هو المرجع)', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: false, wallMin: 9 * 60 + 15,
        });
        expect(v.action).toBe('in');
    });

    it('قرب نهاية الوردية بلا صف → خروج', () => {
        const v = classifyPunch({
            ...BASE, punchState: 1, hasOpenRow: false, wallMin: 17 * 60 - 30,
        });
        expect(v.action).toBe('out');
    });
});

describe('lastPunchFromRow — ترطيب كاش التكرار من القاعدة (بعد إعادة التشغيل)', () => {
    it('صف سليم → دقائق بتوقيت الرياض + اتجاه صحيح', () => {
        // 06:45 UTC = 09:45 الرياض → min = 585
        const v = lastPunchFromRow({ attendanceTime: '2026-10-02T06:45:00.000Z', punchState: 0 });
        expect(v).toEqual({ min: 585, out: false });
    });

    it('punchState خروج (1/3/5) → out:true، ودخول (0/2/4) → out:false', () => {
        for (const s of [1, 3, 5]) {
            expect(lastPunchFromRow({ attendanceTime: '2026-10-02T06:45:00.000Z', punchState: s }).out).toBe(true);
        }
        for (const s of [0, 2, 4]) {
            expect(lastPunchFromRow({ attendanceTime: '2026-10-02T06:45:00.000Z', punchState: s }).out).toBe(false);
        }
    });

    it('عبور منتصف الليل: 21:30 UTC = 00:30 الرياض (تاريخ الغد) → min = 30', () => {
        const v = lastPunchFromRow({ attendanceTime: '2026-10-02T21:30:00.000Z', punchState: 1 });
        expect(v.min).toBe(30);
        expect(v.out).toBe(true);
    });

    it('صف ناقص/زمن تالف → null (fail-open بلا رمي)', () => {
        expect(lastPunchFromRow(null)).toBeNull();
        expect(lastPunchFromRow({})).toBeNull();
        expect(lastPunchFromRow({ attendanceTime: 'not-a-date', punchState: 0 })).toBeNull();
    });
});
