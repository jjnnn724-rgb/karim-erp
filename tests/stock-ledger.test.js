/**
 * stock-ledger.test.js — الترحيل المتماثل للمخزون (صرف/إرجاع)
 * ─────────────────────────────────────────────────────────────
 * يغطي الباني النقي buildStockMoveLines: اتجاهات، توازن، قيم حدّية.
 * دوال post* تختبر حيًا (idempotent) — لا قاعدة بيانات هنا.
 */

const { buildStockMoveLines } = require('../backend/accounting-routes');

describe('buildStockMoveLines — صرف (OUT)', () => {
  test('Dr 5000 / Cr 1200 بالقيمة', () => {
    expect(buildStockMoveLines(1250.5, 'out')).toEqual([
      { account_code: '5000', debit: 1250.5, credit: 0, memo: 'تكلفة صرف' },
      { account_code: '1200', debit: 0, credit: 1250.5, memo: 'صرف مخزون' },
    ]);
  });

  test('متوازن دائمًا (مدين = دائن)', () => {
    for (const v of [1, 99.99, 1000000]) {
      const lines = buildStockMoveLines(v, 'out');
      const dr = lines.reduce((s, l) => s + l.debit, 0);
      const cr = lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(dr - cr)).toBeLessThan(0.005);
    }
  });
});

describe('buildStockMoveLines — إرجاع (IN: عكس متماثل)', () => {
  test('Dr 1200 / Cr 5000 بنفس القيمة', () => {
    expect(buildStockMoveLines(300, 'in')).toEqual([
      { account_code: '1200', debit: 300, credit: 0, memo: 'إرجاع مخزون' },
      { account_code: '5000', debit: 0, credit: 300, memo: 'عكس تكلفة' },
    ]);
  });

  test('الصرف والإرجاع لنفس القيمة يتصافران (صافي صفري)', () => {
    const out = buildStockMoveLines(500, 'out');
    const back = buildStockMoveLines(500, 'in');
    const net = {};
    for (const l of [...out, ...back]) {
      net[l.account_code] = (net[l.account_code] || 0) + l.debit - l.credit;
    }
    expect(net['5000']).toBe(0);
    expect(net['1200']).toBe(0);
  });
});

describe('buildStockMoveLines — قيم حدّية', () => {
  test.each([[0], [-5], [null], [undefined], ['abc']])('لا قيد لقيمة غير موجبة (%s)', v => {
    expect(buildStockMoveLines(v, 'out')).toEqual([]);
    expect(buildStockMoveLines(v, 'in')).toEqual([]);
  });

  test('اتجاه غير معروف → صرف (آمن)', () => {
    expect(buildStockMoveLines(10, 'xyz')[0].account_code).toBe('5000');
  });

  test('تقريب لخانتين', () => {
    expect(buildStockMoveLines(10.005, 'out')[0].debit).toBe(10.01);
  });
});
