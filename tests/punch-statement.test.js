/**
 * punch-statement.test.js — كشف البصمات الخام: التسلسل لا الوردية، والمصرية لا +3
 * (درس 2026-11-02 · EMP-052: انصرافٌ مختلَق 05:17 من مدة الوردية ابتلع
 *  انصرافه الحقيقي فجرًا، فحوّل المحرك دخوله المسائي إلى «انصراف 416 د».)
 */
const { pairBySequence, toRow, SAME_EVENT_WINDOW_MS } = require('../backend/punch-statement');
const { wallTime, wallDate, offsetMinutes, BUSINESS_TZ } = require('../backend/business-time');
const fs = require('fs');
const path = require('path');

const P = (iso, direction = null, source = 'device') => ({ ms: new Date(iso).getTime(), direction, source, note: source });

describe('pairBySequence — إزدواج بالتسلسل وحده', () => {
    test('واقعة EMP-052: دخول 17:21 → انصراف 09:39 = 977 د، ثم دخول مفتوح بلا اختلاق', () => {
        const segs = pairBySequence([
            P('2026-11-01T14:21:51.110Z', 'in', 'portal'),   // 16:21 القاهرة
            P('2026-11-02T06:39:09.254Z', 'in', 'portal'),   // 08:39 — انصرافه الحقيقي، والمحرك سماه «دخول»
            P('2026-11-02T14:04:31.000Z', 'in'),             // 16:04 — دخوله المسائي (state=0 من الجهاز)
        ]);
        expect(segs.map(s => s.minutes)).toEqual([977, null]);
        expect(segs[0].overnight).toBe(true);
        expect(segs[1].closedBy).toBe('open');
        expect(toRow(segs[1]).exitTime).toBeNull();      // لا وقت خروج من عدم
        expect(toRow(segs[1]).hours).toBeNull();         // ولا ساعات مُختلَقة
    });

    test('لا بصمةٌ تُستهلك مرتين: عدد البصمات = 2×مقاطع + مقطعٌ مفتوح', () => {
        const punches = [P('2026-11-01T08:00:00Z'), P('2026-11-01T20:00:00Z'), P('2026-11-02T08:00:00Z'), P('2026-11-02T20:00:00Z'), P('2026-11-03T08:00:00Z')];
        const segs = pairBySequence(punches);
        expect(segs).toHaveLength(3);
        expect(segs.slice(0, 2).every(s => s.minutes === 720)).toBe(true);
        expect(segs[2].exit).toBeNull();
    });

    test('التعارض مع تسمية الجهاز يُعلَّم ولا يُتَّبَع', () => {
        const segs = pairBySequence([P('2026-11-01T08:00:00Z', 'in'), P('2026-11-01T20:00:00Z', 'in')]);
        expect(segs[0].minutes).toBe(720);
        expect(segs[0].flags.join(' ')).toContain('التصنيف الآلي قال');
    });

    test('طول المقطع من الفرق الحقيقي لا من نص HH:MM: 21:50Z → 22:10Z = 24 س 20 د', () => {
        const segs = pairBySequence([P('2026-10-31T21:50:00Z'), P('2026-11-01T22:10:00Z')]);
        expect(segs[0].minutes).toBe(1460);
        expect(segs[0].overnight).toBe(true);
    });

    test('نافذة إزالة التكرار تُعَرَّف ولا تُصفِر التسلسل', () => {
        expect(SAME_EVENT_WINDOW_MS).toBeGreaterThan(0);
    });
});

describe('business-time — ساعة واحدة للنظام كله: توقيت مكة بلا استثناء', () => {
    test('المنطقة Asia/Riyadh هي المعتمدة', () => {
        expect(BUSINESS_TZ).toBe('Asia/Riyadh');
    });

    test('الإزاحة +180 د شتاءً وصيفًا — لا تغييرٍ موسمي يزيح البصمات', () => {
        expect(offsetMinutes(new Date('2026-11-02T12:00:00Z'))).toBe(180);
        expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'))).toBe(180);
    });

    test('لحظات EMP-052 تُعرض كما تراها كل شاشات النظام', () => {
        expect(wallTime('2026-11-01T14:21:51.110Z')).toBe('17:21');
        expect(wallDate('2026-11-01T14:21:51.110Z')).toBe('2026-11-01');
        expect(wallTime('2026-11-02T06:39:09.254Z')).toBe('09:39');
        expect(wallTime('2026-11-02T14:04:31Z')).toBe('17:04');
    });

    test('بصمة بعد منتصف الليل تُنسب ليومها المدني الصحيح', () => {
        expect(wallDate('2026-11-02T00:30:00Z')).toBe('2026-11-02');
        expect(wallTime('2026-11-02T00:30:00Z')).toBe('03:30');
    });
});

describe('اختلاق الانصراف محذوف من الجذور (قرار المالك 2026-11-05)', () => {
    const engine = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');

    test('دالة inventionAllowed ومفتاح الاستثناء محذوفان — لا بوابة تُفتح', () => {
        const eng = require('../backend/attendance-engine');
        expect(eng.inventionAllowed).toBeUndefined();
        expect(engine).not.toMatch(/inventionAllowed/);
        expect(engine).not.toMatch(/ATTENDANCE_INVENT_MISSING_EXIT/);
    });

    test('المحرك لا يكتب checkout_inferred ولا يستكمل انصرافًا ناقصًا', () => {
        expect(engine).not.toMatch(/checkout_inferred\s*=\s*true/);
        expect(engine).toContain('صفٌ بلا انصراف يبقى مفتوحًا');
    });
});
