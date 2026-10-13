const { calculateDelayParts, calculateLateMinutes } = require('../backend/shift-day');
const { classifyPunch } = require('../backend/attendance-engine');

// shared-pool.js loads .env at require time (may carry ATTENDANCE_DELAY_ENGINE=false
// in production) — the legacy suite below pins the ENABLED behavior explicitly;
// the kill-switch describe at the end covers both modes.
process.env.ATTENDANCE_DELAY_ENGINE = 'true';

describe('attendance delay engine', () => {
  test('counts both late arrival and early departure as one total shortfall for the shift', () => {
    const res = calculateDelayParts({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 });

    // قرار المالك (2026-09): الإتمام هو المعيار — دوام 15:00→01:00، وصل 14:30
    // وخرج 00:30 (أكمل 10 ساعات) → صفر تأخير رغم الانصراف قبل نهاية الوردية.
    const completed = calculateDelayParts({ checkIn: '14:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 });
    expect(completed.arrivalLateMinutes).toBe(0);
    // سماحية 15 دقيقة — قرار المالك 2026-10-10: تبكير/انصراف داخل الربع ساعة لا يُحاسب
    expect(completed.earlyLeaveMinutes).toBe(15);
    expect(completed.lateMinutes).toBe(0);
    expect(calculateLateMinutes({ checkIn: '14:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
    // وتأخير الدخول مع تعويضه بالبقاء: وصل 15:30 وخرج 01:30 (10 ساعات) → صفر
    expect(calculateLateMinutes({ checkIn: '15:30', checkOut: '01:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
    // ونقص حقيقي: وصل 15:30 وخرج 00:30 (9 ساعات) → عجز 60 − سماحية 15 = 45 دقيقة
    expect(calculateLateMinutes({ checkIn: '15:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(45);
    // سماحية 15 دقيقة — قرار المالك 2026-10-10: دقيقة واحدة هنا وهناك داخل الربع ساعة → صفر
    expect(res.arrivalLateMinutes).toBe(0);
    expect(res.earlyLeaveMinutes).toBe(0);
    expect(res.lateMinutes).toBe(0);
    expect(calculateLateMinutes({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
  });

  test('returns safe non-crashing values when check-in is absent or invalid', () => {
    // Deliberate engine rule (shift-day.js): خروج بلا دخول لا يُحتسب تبكيرًا —
    // الخروج وحده لا يثبت شيئًا (was stale: expected 9 before that guard).
    expect(calculateDelayParts({ checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 0,
      lateMinutes: 0,
    });
    expect(calculateDelayParts({ checkIn: 'x', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 0,
      lateMinutes: 0,
    });
  });

  test('prefers shift-window timing over raw device state for overnight shifts', () => {
    const rawDeviceOutAtShiftStart = classifyPunch({
      punchState: 1,
      wallMin: 15 * 60,
      shiftStartMin: 15 * 60,
      shiftEndMin: 25 * 60,
      hasOpenRow: false,
      lastPunch: null,
      pattern: { medianIn: 15 * 60, medianOut: 25 * 60, samples: 1 },
      dayLogs: { in: [], out: [] },
    });
    const rawDeviceInAtShiftEnd = classifyPunch({
      punchState: 0,
      wallMin: 35,
      shiftStartMin: 15 * 60,
      shiftEndMin: 25 * 60,
      hasOpenRow: false,
      lastPunch: null,
      pattern: { medianIn: 15 * 60, medianOut: 25 * 60, samples: 1 },
      dayLogs: { in: [], out: [] },
    });

    expect(rawDeviceOutAtShiftStart.action).toBe('in');
    expect(rawDeviceInAtShiftEnd.action).toBe('out');
  });
});

describe('calculateMinutes — الساعات من النصوص المعروضة (إصلاح 25:43)', () => {
  const { calculateMinutes } = require('../backend/hr-routes');

  test('09:54 → 11:37 = 103 دقيقة (لا 1543)', () => {
    expect(calculateMinutes({ checkIn: '09:54', checkOut: '11:37', workMinutes: 1543 })).toBe(103);
  });

  test('يومي عادي من النصوص', () => {
    expect(calculateMinutes({ checkIn: '10:30', checkOut: '20:14' })).toBe(584);
  });

  test('التفاف ليلي فقط عند out<in', () => {
    expect(calculateMinutes({ checkIn: '22:00', checkOut: '06:00' })).toBe(480);
  });

  test('نصوص ناقصة → workMinutes المخزن → 0', () => {
    expect(calculateMinutes({ checkIn: '10:30', workMinutes: 500 })).toBe(500);
    expect(calculateMinutes({})).toBe(0);
  });
});

describe('ATTENDANCE_DELAY_ENGINE kill-switch (بصمة خام فقط)', () => {
  const { delayEngineEnabled } = require('../backend/shift-day');
  const { calculateTotalLateMinutes } = require('../backend/attendance-engine');
  const prev = process.env.ATTENDANCE_DELAY_ENGINE;
  afterEach(() => {
    if (prev === undefined) {delete process.env.ATTENDANCE_DELAY_ENGINE;}
    else {process.env.ATTENDANCE_DELAY_ENGINE = prev;}
  });

  test('الافتراضي: المحرك مفعّل', () => {
    delete process.env.ATTENDANCE_DELAY_ENGINE;
    expect(delayEngineEnabled()).toBe(true);
  });

  test('false: كل الحسابات صفرية (بصمة خام)', () => {
    process.env.ATTENDANCE_DELAY_ENGINE = 'false';
    expect(delayEngineEnabled()).toBe(false);
    expect(calculateTotalLateMinutes({ checkIn: '15:01', checkOut: '00:51', shiftStart: '15:00', shift_karim: 10 })).toBe(0);
    const { isLate, isEarlyLeave } = require('../backend/shift-day');
    expect(isLate(15, 1, '15:00')).toBe(false);
    expect(isEarlyLeave(0, 40, '15:00', 10)).toBe(false);
  });

  test('true: السلوك الأصلي محفوظ', () => {
    process.env.ATTENDANCE_DELAY_ENGINE = 'true';
    expect(delayEngineEnabled()).toBe(true);
    // عجز 60 دقيقة − سماحية 15 (قرار المالك 2026-10-10) = 45 — حالة تتجاوز
    // الربع ساعة حتى يميّز الاختبار فعلًا بين المحرك مفعّل/معطّل.
    expect(calculateTotalLateMinutes({ checkIn: '15:30', checkOut: '00:30', shiftStart: '15:00', shift_karim: 10 })).toBe(45);
    // وداخل السماحية → صفر رغم وجود بصمة متأخرة بدقيقة
    expect(calculateTotalLateMinutes({ checkIn: '15:01', checkOut: '00:51', shiftStart: '15:00', shift_karim: 10 })).toBe(0);
  });
});
