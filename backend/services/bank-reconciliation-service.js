'use strict';

const { ValidationError } = require('../errors/app-error');

const MAX_TRANSACTIONS_PER_RUN = 500;

class BankReconciliationService {
  constructor(pool = require('../shared-pool').pool) {
    this.pool = pool;
  }

  async matchTransactions(transactions) {
    if (!Array.isArray(transactions) || transactions.length > MAX_TRANSACTIONS_PER_RUN) {
      throw new ValidationError('transactions', `must be an array of at most ${MAX_TRANSACTIONS_PER_RUN} persisted bank statement IDs`);
    }

    const ids = transactions.map(transaction => String(transaction?.id ?? ''));
    if (ids.some(id => !/^\d+$/.test(id) || BigInt(id) <= 0n)) {
      throw new ValidationError('transactions', 'every transaction must include a positive bank statement id');
    }
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('transactions', 'duplicate bank statement IDs are not allowed');
    }

    const client = await this.pool.connect();
    const matched = [];
    const unmatched = [];
    try {
      await client.query('BEGIN');
      // Serialize match attempts so an entry cannot be assigned to two imported
      // bank rows by concurrent workers.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bank-rec-auto-match'))`);

      for (const id of ids) {
        const statementResult = await client.query(
          `SELECT id, account_code, stmt_date::text AS stmt_date,
                  amount::numeric(14,2)::text AS amount, matched, matched_entry
             FROM bank_statements
            WHERE id = $1
            FOR UPDATE`,
          [id]
        );
        const statement = statementResult.rows[0];
        if (!statement) {
          unmatched.push({ bankTransactionId: id, reason: 'statement_not_found' });
          continue;
        }
        if (statement.matched || statement.matched_entry !== null) {
          unmatched.push({
            bankTransactionId: String(statement.id),
            reason: 'already_matched',
            journalEntryId: statement.matched_entry === null ? null : String(statement.matched_entry),
          });
          continue;
        }
        if (Number(statement.amount) === 0) {
          unmatched.push({ bankTransactionId: String(statement.id), reason: 'zero_amount' });
          continue;
        }

        const candidates = await client.query(
          `SELECT e.id
             FROM journal_entries e
             JOIN journal_lines l ON l.entry_id = e.id AND l.account_code = $1
            WHERE e.status = 'posted'
              AND e.date BETWEEN $2::date - 2 AND $2::date + 2
              AND NOT EXISTS (
                    SELECT 1 FROM bank_statements b
                     WHERE b.matched_entry = e.id
                  )
            GROUP BY e.id
           HAVING ROUND(SUM(l.debit - l.credit), 2) = $3::numeric
            ORDER BY ABS(e.date - $2::date), e.id
            LIMIT 2`,
          [statement.account_code, statement.stmt_date, statement.amount]
        );

        if (candidates.rows.length === 0) {
          unmatched.push({ bankTransactionId: String(statement.id), reason: 'no_exact_amount_date_match' });
          continue;
        }
        if (candidates.rows.length > 1) {
          unmatched.push({ bankTransactionId: String(statement.id), reason: 'ambiguous_candidates' });
          continue;
        }

        const journalEntryId = String(candidates.rows[0].id);
        const claim = await client.query(
          `UPDATE bank_statements
              SET matched = TRUE, matched_entry = $1
            WHERE id = $2 AND matched = FALSE AND matched_entry IS NULL
            RETURNING id`,
          [journalEntryId, String(statement.id)]
        );
        if (claim.rowCount !== 1) {
          unmatched.push({ bankTransactionId: String(statement.id), reason: 'statement_claim_lost' });
          continue;
        }
        matched.push({
          bankTransactionId: String(statement.id),
          journalEntryId,
        });
      }

      await client.query('COMMIT');
      return { matched, unmatched };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { BankReconciliationService, MAX_TRANSACTIONS_PER_RUN };
