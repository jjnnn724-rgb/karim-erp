'use strict';

const { generateBalanceSheet, generateIncomeStatement } = require('../backend/financial-statements-engine');

describe('financial statements use posted ledger entries', () => {
  it('excludes unposted lines from the balance sheet and reports entry integrity', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ posted_entries: 4, unbalanced_posted_entries: 1 }] }),
    };

    const result = await generateBalanceSheet(pool, '2026-11-10');
    const balanceSheetSql = pool.query.mock.calls[0][0];

    expect(balanceSheetSql).toContain("e.status = 'posted'");
    expect(balanceSheetSql).toContain('l.entry_id = e.id AND l.account_code = c.code');
    expect(pool.query.mock.calls[1][0]).toContain('entry_totals.line_count < 2');
    expect(pool.query.mock.calls[1][0]).toContain('> 0.01');
    expect(result.integrity).toEqual({
      posted_entries: 4,
      unbalanced_posted_entries: 1,
      balanced: false,
    });
  });

  it('calculates the income statement from posted entries and flags unbalanced entries', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ posted_entries: 2, unbalanced_posted_entries: 0 }] }),
    };

    const result = await generateIncomeStatement(pool, '2026-11-01', '2026-11-30');

    expect(pool.query.mock.calls[0][0]).toContain("e.status = 'posted'");
    expect(pool.query.mock.calls[0][1]).toEqual(['2026-11-01', '2026-11-30']);
    expect(result.integrity).toEqual({
      posted_entries: 2,
      unbalanced_posted_entries: 0,
      balanced: true,
    });
  });
});
