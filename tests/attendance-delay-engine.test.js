const { calculateDelayParts, calculateLateMinutes } = require('../backend/shift-day');

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
    // بلا سماحية (قرار المالك 2026-11-02): 30 دقيقة تبكير تُحسب كاملة.
    expect(completed.earlyLeaveMinutes).toBe(30);
    expect(completed.lateMinutes).toBe(0);
    expect(calculateLateMinutes({ checkIn: '14:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
    // وتأخير الدخول مع تعويضه بالبقاء: وصل 15:30 وخرج 01:30 (10 ساعات) → صفر
    expect(calculateLateMinutes({ checkIn: '15:30', checkOut: '01:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
    // ونقص حقيقي: وصل 15:30 وخرج 00:30 (9 ساعات) → عجز 60 دقيقة كاملًا
    expect(calculateLateMinutes({ checkIn: '15:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(60);
    // بلا ميزانية مشتركة (قرار المالك 2026-11-05): كل دقيقة تُحسب —
    // دخول 1 د + تبكير 9 د، والعجز 10 د عن ساعات البطاقة كاملًا.
    expect(res.arrivalLateMinutes).toBe(1);
    expect(res.earlyLeaveMinutes).toBe(9);
    expect(res.lateMinutes).toBe(10);
    expect(calculateLateMinutes({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toBe(10);
  });

  test('returns safe non-crashing values when check-in is absent or invalid', () => {
    // Deliberate engine rule (shift-day.js): خروج بلا دخول لا يُحتسب تبكيرًا —
    // الخروج وحده لا يثبت شيئًا (was stale: expected 9 before that guard).
    expect(calculateDelayParts({ checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 0,
      lateMinutes: 0,
      arrivalLateRawMinutes: 0,
      earlyLeaveRawMinutes: 0,
    });
    expect(calculateDelayParts({ checkIn: 'x', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 0,
      lateMinutes: 0,
      arrivalLateRawMinutes: 0,
      earlyLeaveRawMinutes: 0,
    });
  });

  // طلب المالك 2026-10-29: «أقدر أعرف كل تأخير ولو دقيقة في بطاقة كل موظف».
  // وقراره الحاسم 2026-11-05: التأخير من أول دقيقة بعد بداية دوام البطاقة —
  // بلا سماحية ولا ميزانية مشتركة.
  test('التأخير من أول دقيقة بعد بداية الدوام (بلا سماحية)', () => {
    const oneMinute = calculateDelayParts({ checkIn: '15:01', checkOut: '01:01' }, { shift_start: '15:00', shift_karim: 10 });
    expect(oneMinute.arrivalLateRawMinutes).toBe(1);
    expect(oneMinute.arrivalLateMinutes).toBe(1);   // من أول دقيقة — بلا سماح
    expect(oneMinute.lateMinutes).toBe(0);          // أكمل 10 ساعات

    const thirteen = calculateDelayParts({ checkIn: '15:13', checkOut: '01:13' }, { shift_start: '15:00', shift_karim: 10 });
    expect(thirteen.arrivalLateRawMinutes).toBe(13);
    expect(thirteen.arrivalLateMinutes).toBe(13);    // بلا سماحية إطلاقًا
    expect(thirteen.lateMinutes).toBe(0);

    // 15:20 مقابل وردية 15:00 =20 دقيقة كاملة (لا اقتطاع)
    const twenty = calculateDelayParts({ checkIn: '15:20', checkOut: '01:20' }, { shift_start: '15:00', shift_karim: 10 });
    expect(twenty.arrivalLateRawMinutes).toBe(20);
    expect(twenty.arrivalLateMinutes).toBe(20);
    expect(twenty.lateMinutes).toBe(0); // أكمل 10 ساعات: العجز صفر رغم الدخول المتأخر

    // مثال المالك حرفيًا: دوام 12:00، وصول 12:25، انصراف 00:25 (12 ساعة) → 25 دقيقة
    const owner = calculateDelayParts({ checkIn: '12:25', checkOut: '00:25' }, { shift_start: '12:00', shift_karim: 12 });
    expect(owner.arrivalLateMinutes).toBe(25);
    expect(owner.lateMinutes).toBe(0);

    // ومثال الانصراف: وردية تنتهي 00:00، خرج 23:30 → 30 دقيقة كاملة
    const earlyOwner = calculateDelayParts({ checkIn: '12:00', checkOut: '23:30' }, { shift_start: '12:00', shift_karim: 12 });
    expect(earlyOwner.earlyLeaveRawMinutes).toBe(30);
    expect(earlyOwner.earlyLeaveMinutes).toBe(30);
    expect(earlyOwner.lateMinutes).toBe(30);
  });

  test('الانصراف المبكر بلا سماحية: ١٥ د تُحسب كاملة مثل ١٦ د (قرار 2026-11-05)', () => {
    // الوردية تنتهي 01:00؛ الخروج 00:45 = 15 دقيقة مبكرًا → تُحسب كاملة
    const fifteen = calculateDelayParts({ checkIn: '15:00', checkOut: '00:45' }, { shift_start: '15:00', shift_karim: 10 });
    expect(fifteen.earlyLeaveRawMinutes).toBe(15);
    expect(fifteen.earlyLeaveMinutes).toBe(15);
    const sixteen = calculateDelayParts({ checkIn: '15:00', checkOut: '00:44' }, { shift_start: '15:00', shift_karim: 10 });
    expect(sixteen.earlyLeaveRawMinutes).toBe(16);
    expect(sixteen.earlyLeaveMinutes).toBe(16);
  });

  test('الحقول الخام والمحتسب: بلا سماحية — المحتسب يساوي الخام', () => {
    const emp = { shift_start: '15:00', shift_karim: 10 };
    // جدول محسوب باليد: وردية 15:00→01:00 (١٠ ساعات) — بلا سماحية إطلاقًا.
    const table = [
      // 15:01→00:51: دخول 1 د + تبكير 9 د + عجز 10 د عن ساعات البطاقة — كلها كاملة
      { checkIn: '15:01', checkOut: '00:51',
        arrivalLateRawMinutes: 1, arrivalLateMinutes: 1,
        earlyLeaveRawMinutes: 9, earlyLeaveMinutes: 9, lateMinutes: 10 },
      // 14:30→00:30: أكمل 10 ساعات → لا عجز، والتبكير 30 دقيقة يُحسب كاملًا
      { checkIn: '14:30', checkOut: '00:30',
        arrivalLateRawMinutes: 0, arrivalLateMinutes: 0,
        earlyLeaveRawMinutes: 30, earlyLeaveMinutes: 30, lateMinutes: 0 },
      // 15:30→00:30: 9 ساعات فقط → عجز 60 دقيقة كاملة، وتأخير الدخول 30 كاملة
      { checkIn: '15:30', checkOut: '00:30',
        arrivalLateRawMinutes: 30, arrivalLateMinutes: 30,
        earlyLeaveRawMinutes: 30, earlyLeaveMinutes: 30, lateMinutes: 60 },
      // 15:30→01:30: تأخير مُعوَّض بالبقاء → 10 ساعات كاملة → عجز صفر
      { checkIn: '15:30', checkOut: '01:30',
        arrivalLateRawMinutes: 30, arrivalLateMinutes: 30,
        earlyLeaveRawMinutes: 0, earlyLeaveMinutes: 0, lateMinutes: 0 },
    ];
    for (const t of table) {
      const { checkIn, checkOut, ...want } = t;
      const got = calculateDelayParts({ checkIn, checkOut }, emp);
      expect(got).toEqual(want);
      // المحتسب لا يتجاوز الخام أبدًا
      expect(got.arrivalLateRawMinutes).toBeGreaterThanOrEqual(got.arrivalLateMinutes);
      expect(got.earlyLeaveRawMinutes).toBeGreaterThanOrEqual(got.earlyLeaveMinutes);
    }
  });

  // اختبار «المحرك الواحد: حالة الجهاز هي المرجع» (classifyPunch) حُذف بقرار
  // المالك 2026-11-05: الدالة نفسها محذوفة — الاتجاه من حالة الجهاز مباشرة
  // داخل processPunch، بلا طبقة تصنيف منفصلة.
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
    expect(calculateLateMinutes({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toBe(0);
    const { isLate, isEarlyLeave } = require('../backend/shift-day');
    expect(isLate(15, 1, '15:00')).toBe(false);
    expect(isEarlyLeave(0, 40, '15:00', 10)).toBe(false);
  });

  test('true: العجز عن ساعات البطاقة يُحتسب كاملًا بلا سماحية', () => {
    process.env.ATTENDANCE_DELAY_ENGINE = 'true';
    expect(delayEngineEnabled()).toBe(true);
    // عجز 60 دقيقة ⇒ كامل
    expect(calculateLateMinutes({ checkIn: '15:30', checkOut: '00:30' }, { shift_start: '15:00', shift_karim: 10 })).toBe(60);
    // وعجز 10 دقائق (15:01→00:51) ⇒ 10 كاملة — بلا سماحية (قرار 2026-11-05)
    expect(calculateLateMinutes({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toBe(10);
  });
});
