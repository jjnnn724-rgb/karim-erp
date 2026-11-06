const { pool } = require('../backend/shared-pool');

async function getTrialBalance() {
  const { rows } = await pool.query(`
    SELECT c.code, c.name_ar, c.type, c.is_postable,
           COALESCE(SUM(l.debit), 0)::numeric(14,2) AS debit,
           COALESCE(SUM(l.credit), 0)::numeric(14,2) AS credit
    FROM chart_of_accounts c
    LEFT JOIN journal_lines l ON l.account_code = c.code
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    GROUP BY c.code, c.name_ar, c.type, c.is_postable
    ORDER BY c.code
  `);
  
  const totalDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit), 0);
  
  return {
    rows: rows.filter(r => Number(r.debit) > 0 || Number(r.credit) > 0),
    allRows: rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    diff: Math.abs(totalDebit - totalCredit)
  };
}

async function run() {
  const tb = await getTrialBalance();
  console.log('=== GOLDEN TRIAL BALANCE BASELINE ===');
  console.log('Total Debit :', tb.totalDebit);
  console.log('Total Credit:', tb.totalCredit);
  console.log('Difference  :', tb.diff);
  console.log('\nActive Accounts with Balances:');
  console.table(tb.rows);
  await pool.end();
}

run();
