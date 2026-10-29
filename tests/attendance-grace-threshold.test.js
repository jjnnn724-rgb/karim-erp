const fs = require('fs');
const path = require('path');
const { calculateDelayParts, overGrace, graceMinutes } = require('../backend/shift-day');

// قرار المالك 2026-10-30: «فتره السماح هي ربع ساعه بس لو زادت التاخير عن ربع ساعه
// يظهر التاخير كامل — دوام 12:00 ووصل 12:25 يظهر خصم 25 دقيقه، وينصرف 12 وخرج
// 11:30 يظهر خصم نصف ساعه كامل». أي أن الربع ساعة عتبةٌ لا اقتطاع.
process.env.ATTENDANCE_DELAY_ENGINE = 'true';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('حدّ السماح ربع ساعة: عتبة لا اقتطاع', () => {
  test('عند الحدّ بالضبط صفر، وفوقه الدقائق كاملة', () => {
    expect(graceMinutes()).toBe(15);
    expect(overGrace(0)).toBe(0);
    expect(overGrace(15)).toBe(0);
    expect(overGrace(16)).toBe(16);
    expect(overGrace(-5)).toBe(0);
    expect(overGrace(NaN)).toBe(0);
  });

  test('مثالا المالك حرفيًا: دخول 12:25 ووردية 12:00 → 25، وخروج 11:30 ليوم ينتهي 12 → 30', () => {
    const arrive = calculateDelayParts({ checkIn: '12:25', checkOut: '00:25' }, { shift_start: '12:00', shift_karim: 12 });
    expect(arrive.arrivalLateRawMinutes).toBe(25);
    expect(arrive.arrivalLateMinutes).toBe(25);
    expect(arrive.lateMinutes).toBe(0);

    const leave = calculateDelayParts({ checkIn: '12:00', checkOut: '23:30' }, { shift_start: '12:00', shift_karim: 12 });
    expect(leave.earlyLeaveRawMinutes).toBe(30);
    expect(leave.earlyLeaveMinutes).toBe(30);
    expect(leave.lateMinutes).toBe(30);

    // ودخول 12:15 تمامًا لا خصم عليه، و12:16 عليه 16 دقيقة
    expect(calculateDelayParts({ checkIn: '12:15', checkOut: '00:15' }, { shift_start: '12:00', shift_karim: 12 }).arrivalLateMinutes).toBe(0);
    expect(calculateDelayParts({ checkIn: '12:16', checkOut: '00:16' }, { shift_start: '12:00', shift_karim: 12 }).arrivalLateMinutes).toBe(16);
  });

  test('المحتسب لا يقع بين صفر والخام أبدًا (لا اقتطاع جزئي)', () => {
    const emp = { shift_start: '09:00', shift_karim: 8 };
    const cases = [
      ['09:00', '17:00'], ['09:05', '17:00'], ['09:14', '17:00'], ['09:15', '17:00'],
      ['09:40', '17:40'], ['10:30', '18:30'], ['11:00', '19:00'],
      ['08:00', '16:00'], ['09:00', '16:00'], ['09:00', '16:30'], ['09:00', '15:45'],
    ];
    for (const [checkIn, checkOut] of cases) {
      const p = calculateDelayParts({ checkIn, checkOut }, emp);
      for (const [rawKey, key] of [
        ['arrivalLateRawMinutes', 'arrivalLateMinutes'],
        ['earlyLeaveRawMinutes', 'earlyLeaveMinutes'],
      ]) {
        expect(p[key]).toBeGreaterThanOrEqual(0);
        expect(p[key]).toBeLessThanOrEqual(p[rawKey]);
        if (p[rawKey] <= graceMinutes()) {expect(p[key]).toBe(0);}
        else {expect(p[key]).toBe(p[rawKey]);}
      }
    }
  });

  test('لا طرح للسماحية في أي محرك: الخادم والواجهتان والشاشة القديمة', () => {
    const files = [
      'backend/shift-day.js',
      'backend/attendance-engine.js',
      'backend/hr-routes.js',
      'backend/strict-audit-lib.js',
      'frontend/app/js/features/smart-card.js',
    ];
    const forbidden = [
      /-\s*graceMinutes\(\)/,      // الطرح القديم في الخادم
      /-\s*GRACE(_MIN)?\b/,        // الطرح القديم في الكشف القديم
      /required\s*-\s*worked\s*-\s*grace/,
    ];
    for (const file of files) {
      const src = read(file);
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const re of forbidden) {
        expect({ file, hit: code.match(re) && code.match(re)[0] }).toEqual({ file, hit: null });
      }
    }
    // والكسور المكتملة تحتفظ بقاعدة «أكمل الوردية = يوم مكتمل» بالسماحية كما هي
    expect(read('backend/hr-routes.js')).toMatch(/worked \+ graceMinutes\(\) >= required/);
    // وضمّ العجز يحسب النقص كاملًا بعد تجاوز الحدّ (لا اقتطاع 15)
    expect(read('backend/hr-routes.js')).toMatch(/a\.deficitMinutes \+= \(required - worked\);/);
    // والواجهة القديمة والشاشة الجديدة تستخدمان العتبة
    expect(read('frontend/app/js/features/smart-card.js')).toMatch(/const short = gap > GRACE \? gap : 0;/);
    expect(read('backend/shift-day.js')).toMatch(/return raw > grace \? raw : 0;/);
  });
});
