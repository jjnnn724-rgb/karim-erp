const { calculateDelayParts, calculateLateMinutes } = require('../backend/shift-day');
const { classifyPunch } = require('../backend/attendance-engine');

describe('attendance delay engine', () => {
  test('counts both late arrival and early departure as one total shortfall for the shift', () => {
    const res = calculateDelayParts({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 });

    expect(res.arrivalLateMinutes).toBe(1);
    expect(res.earlyLeaveMinutes).toBe(9);
    expect(res.lateMinutes).toBe(10);
    expect(calculateLateMinutes({ checkIn: '15:01', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toBe(10);
  });

  test('returns safe non-crashing values when check-in is absent or invalid', () => {
    expect(calculateDelayParts({ checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 9,
      lateMinutes: 9,
    });
    expect(calculateDelayParts({ checkIn: 'x', checkOut: '00:51' }, { shift_start: '15:00', shift_karim: 10 })).toEqual({
      arrivalLateMinutes: 0,
      earlyLeaveMinutes: 9,
      lateMinutes: 9,
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
