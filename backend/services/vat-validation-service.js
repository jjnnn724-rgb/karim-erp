'use strict';

const { NotFoundError, ValidationError } = require('../errors/app-error');
const { isValidDateOnly } = require('../vat-reporting');
const { resolveAccounts } = require('../coa-mapping');

const DRAFT_AND_UNPOSTED_SQL = `
  SELECT source_type, document_id, invoice_reference, invoice_date, status, blocker
    FROM (
      SELECT 'pos_order'::text AS source_type,
             o.id::text AS document_id,
             COALESCE(o.invoice_counter::text, o.id::text) AS invoice_reference,
             (o.created_at AT TIME ZONE 'Asia/Riyadh')::date::text AS invoice_date,
             o.status::text AS status,
             CASE
               WHEN o.status = 'draft' THEN 'draft_invoice'
               WHEN o.status = 'cancelled' AND o.voided_at IS NULL THEN 'cancelled_without_void_date'
               WHEN o.status = 'cancelled' THEN 'unposted_void'
               ELSE 'unposted_invoice'
             END AS blocker
        FROM pos_orders o
       WHERE (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
         AND (
           o.status = 'draft'
           OR (o.status = 'cancelled' AND o.voided_at IS NULL)
           OR (o.status IN ('issued', 'reported', 'failed') AND NOT EXISTS (
                 SELECT 1 FROM journal_entries e
                  WHERE e.source_type = 'pos_sale'
                    AND e.source_id = o.id::text
                    AND e.status = 'posted'
               ))
         )
      UNION ALL
      SELECT 'purchase_invoice'::text,
             p.id::text,
             COALESCE(NULLIF(p."invoiceNumber", ''), p.id::text),
             LEFT(COALESCE(p.date, ''), 10),
             COALESCE(p."paymentStatus", 'unposted'),
             'unposted_invoice'
        FROM "purchaseInvoices" p
       WHERE LEFT(COALESCE(p.date, ''), 10) BETWEEN $1 AND $2
         AND COALESCE(p."invoiceNumber", '') NOT LIKE 'OPEN-%'
         AND COALESCE(p.notes, '') NOT LIKE 'رصيد افتتاحي%'
         AND NOT EXISTS (
               SELECT 1 FROM journal_entries e
                WHERE e.source_type = 'purchase_invoice'
                  AND e.status = 'posted'
                  AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
             )
      UNION ALL
      SELECT 'pos_order'::text,
             o.id::text,
             COALESCE(o.invoice_counter::text, o.id::text),
             (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date::text,
             o.status::text,
             'unposted_void'
        FROM pos_orders o
       WHERE o.status = 'cancelled'
         AND o.voided_at IS NOT NULL
         AND (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
         AND NOT EXISTS (
               SELECT 1 FROM journal_entries e
                WHERE e.source_type = 'pos_void'
                  AND e.source_id = o.id::text
                  AND e.status = 'posted'
             )
    ) blockers
   ORDER BY invoice_date, source_type, document_id`;

const VAT_BREAKDOWN_SQL = `
  WITH standard_rate AS (
    SELECT standard_vat_rate::numeric AS rate
      FROM tax_config
     WHERE id = 1
  ),
  source_rows AS (
    SELECT 'output'::text AS direction,
           CASE
             WHEN oi.vat_rate = CASE
               WHEN (o.created_at AT TIME ZONE 'Asia/Riyadh')::date < DATE '2020-07-01'
                 THEN 5.00::numeric ELSE cfg.rate END THEN 'STANDARD'
             WHEN oi.vat_rate = 0 THEN 'ZERO_RATED'
             ELSE 'UNCLASSIFIED'
           END::text AS tax_category,
           SUM(oi.line_total)::numeric AS taxable_amount,
           SUM(oi.vat_amount)::numeric AS vat_amount
      FROM pos_orders o
      JOIN pos_order_items oi ON oi.order_id = o.id
      CROSS JOIN standard_rate cfg
     WHERE o.status IN ('issued', 'reported')
       AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
       AND EXISTS (
         SELECT 1 FROM journal_entries e
          WHERE e.source_type = 'pos_sale'
            AND e.source_id = o.id::text
            AND e.status = 'posted'
       )
     GROUP BY tax_category
    UNION ALL
    SELECT 'output',
           CASE
             WHEN oi.vat_rate = CASE
               WHEN (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date < DATE '2020-07-01'
                 THEN 5.00::numeric ELSE cfg.rate END THEN 'STANDARD'
             WHEN oi.vat_rate = 0 THEN 'ZERO_RATED'
             ELSE 'UNCLASSIFIED'
           END,
           -SUM(oi.line_total)::numeric,
           -SUM(oi.vat_amount)::numeric
      FROM pos_orders o
      JOIN pos_order_items oi ON oi.order_id = o.id
      CROSS JOIN standard_rate cfg
     WHERE o.status = 'cancelled'
       AND o.voided_at IS NOT NULL
       AND (o.voided_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
       AND EXISTS (
         SELECT 1 FROM journal_entries e
          WHERE e.source_type = 'pos_void'
            AND e.source_id = o.id::text
            AND e.status = 'posted'
       )
     GROUP BY tax_category
    UNION ALL
    SELECT 'input',
           CASE
             WHEN upper(COALESCE(p.tax_rule_code_snapshot, '')) LIKE '%ZERO_RATED%' THEN 'ZERO_RATED'
             WHEN upper(COALESCE(p.tax_rule_code_snapshot, '')) LIKE '%EXEMPT%' THEN 'EXEMPT'
             WHEN upper(COALESCE(p.tax_rule_code_snapshot, '')) LIKE '%OUT_OF_SCOPE%' THEN 'OUT_OF_SCOPE'
             WHEN upper(COALESCE(p.tax_rule_code_snapshot, '')) LIKE '%NOT_REGISTERED%' THEN 'NON_RECOVERABLE'
             WHEN upper(COALESCE(p.tax_rule_code_snapshot, '')) LIKE '%STANDARD%'
               AND p.tax_rate_snapshot = CASE WHEN p.date < '2020-07-01'
                 THEN 5.00::numeric ELSE cfg.rate END THEN 'STANDARD'
             ELSE 'UNCLASSIFIED'
           END,
           SUM(p.subtotal_net)::numeric,
           SUM(p.vat_total)::numeric
      FROM "purchaseInvoices" p
      CROSS JOIN standard_rate cfg
     WHERE LEFT(COALESCE(p.date, ''), 10) BETWEEN $1 AND $2
       AND COALESCE(p."invoiceNumber", '') NOT LIKE 'OPEN-%'
       AND COALESCE(p.notes, '') NOT LIKE 'رصيد افتتاحي%'
       AND EXISTS (
         SELECT 1 FROM journal_entries e
          WHERE e.source_type = 'purchase_invoice'
            AND e.status = 'posted'
            AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
       )
     GROUP BY 2
  )
  SELECT direction, tax_category,
         ROUND(SUM(taxable_amount), 2)::text AS taxable_amount,
         ROUND(SUM(vat_amount), 2)::text AS vat_amount,
         COUNT(*)::integer AS source_groups,
         COUNT(*) FILTER (
           WHERE tax_category = 'UNCLASSIFIED'
              OR (tax_category IN ('ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'NON_RECOVERABLE')
                  AND vat_amount <> 0)
         )::integer AS invalid_tax_groups
    FROM source_rows
   GROUP BY direction, tax_category
   ORDER BY direction, tax_category`;

function emptyBuckets() {
  return {
    STANDARD: { taxableAmount: '0.00', vatAmount: '0.00' },
    ZERO_RATED: { taxableAmount: '0.00', vatAmount: '0.00' },
    EXEMPT: { taxableAmount: '0.00', vatAmount: '0.00' },
    OUT_OF_SCOPE: { taxableAmount: '0.00', vatAmount: '0.00' },
    NON_RECOVERABLE: { taxableAmount: '0.00', vatAmount: '0.00' },
    UNCLASSIFIED: { taxableAmount: '0.00', vatAmount: '0.00' },
  };
}

function addMoney(left, right) {
  const toCents = value => {
    const text = String(value);
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
    return negative ? -cents : cents;
  };
  const cents = toCents(left) + toCents(right);
  const absolute = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function isPositiveInteger(value) {
  return /^\d+$/.test(String(value)) && BigInt(String(value)) > 0n;
}

class VatValidationService {
  constructor(pool = require('../shared-pool').pool, accountResolver = resolveAccounts) {
    this.pool = pool;
    this.accountResolver = accountResolver;
  }

  async resolvePeriod({ taxPeriodId, tax_period_id: taxPeriodIdSnake, from, to } = {}) {
    taxPeriodId = taxPeriodId ?? taxPeriodIdSnake;
    if (taxPeriodId !== undefined && taxPeriodId !== null) {
      if (!isPositiveInteger(taxPeriodId)) {
        throw new ValidationError('taxPeriodId', 'must be a positive integer');
      }
      const { rows } = await this.pool.query(
        `SELECT id, period_start::text, period_end::text, status
           FROM vat_returns
          WHERE id = $1`,
        [String(taxPeriodId)]
      );
      if (!rows[0]) {
        throw new NotFoundError('VAT return', taxPeriodId);
      }
      if (rows[0].status === 'finalized' || rows[0].status === 'void') {
        return {
          error: {
            code: 'VAT_PERIOD_NOT_DRAFT',
            statusCode: 422,
            message: `VAT return ${taxPeriodId} is ${rows[0].status}; it cannot be finalized again.`,
            blockingInvoices: [],
          },
        };
      }
      return {
        taxPeriodId: String(rows[0].id),
        from: String(rows[0].period_start).slice(0, 10),
        to: String(rows[0].period_end).slice(0, 10),
      };
    }

    if (!isValidDateOnly(String(from ?? '')) || !isValidDateOnly(String(to ?? '')) || from > to) {
      throw new ValidationError('period', 'from and to must be valid ISO dates with from <= to');
    }
    return { taxPeriodId: null, from, to };
  }

  async validatePeriod(period) {
    const resolved = await this.resolvePeriod(period);
    if (resolved.error) {
      return { ok: false, valid: false, error: resolved.error };
    }

    const blockingResult = await this.pool.query(DRAFT_AND_UNPOSTED_SQL, [resolved.from, resolved.to]);
    const blockingInvoices = blockingResult.rows.map(row => ({
      sourceType: row.source_type,
      documentId: String(row.document_id),
      invoiceReference: row.invoice_reference,
      invoiceDate: String(row.invoice_date).slice(0, 10),
      status: row.status,
      blocker: row.blocker,
    }));
    if (blockingInvoices.length > 0) {
      return {
        ok: false,
        valid: false,
        period: { taxPeriodId: resolved.taxPeriodId, from: resolved.from, to: resolved.to },
        error: {
          code: 'VAT_PERIOD_BLOCKED',
          statusCode: 422,
          message: 'Draft or unposted source invoices must be resolved before VAT finalization.',
          blockingInvoices,
        },
        blockingInvoices,
      };
    }

    const [{ rows: configRows }, breakdownResult] = await Promise.all([
      this.pool.query('SELECT standard_vat_rate::text FROM tax_config WHERE id = 1'),
      this.pool.query(VAT_BREAKDOWN_SQL, [resolved.from, resolved.to]),
    ]);
    const standardRate = Number(configRows[0]?.standard_vat_rate);
    if (!Number.isFinite(standardRate) || standardRate < 0 || standardRate > 100) {
      throw new ValidationError('standardVatRate', 'must be configured between 0 and 100 before this return can be prepared');
    }

    const output = emptyBuckets();
    const input = emptyBuckets();
    let invalidTaxGroups = 0;
    for (const row of breakdownResult.rows) {
      const side = row.direction === 'output' ? output : input;
      const category = side[row.tax_category];
      if (!category) {
        invalidTaxGroups += Number(row.invalid_tax_groups) || 0;
        continue;
      }
      category.taxableAmount = addMoney(category.taxableAmount, row.taxable_amount);
      category.vatAmount = addMoney(category.vatAmount, row.vat_amount);
      invalidTaxGroups += Number(row.invalid_tax_groups) || 0;
    }

    const total = buckets => Object.values(buckets).reduce(
      (sum, category) => addMoney(sum, category.vatAmount),
      '0.00'
    );
    const outputVat = total(output);
    const inputVat = total(input);
    const netVatPayable = addMoney(outputVat, `-${inputVat}`);
    const accounts = await this.accountResolver(this.pool, 'tax', 'vat_return', {
      payable_account: '2100',
      recoverable_account: '1150',
    });
    const ledgerResult = await this.pool.query(
      `SELECT ROUND(COALESCE(SUM(
                CASE WHEN l.account_code = $3 THEN l.credit - l.debit
                     WHEN l.account_code = $4 THEN -(l.debit - l.credit)
                     ELSE 0 END
              ), 0), 2)::text AS net_vat
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
        WHERE e.date BETWEEN $1::date AND $2::date
          AND l.account_code IN ($3, $4)
          AND e.source_type <> 'vat_settlement'`,
      [resolved.from, resolved.to, accounts.payable_account, accounts.recoverable_account]
    );
    const ledgerNetVat = ledgerResult.rows[0]?.net_vat ?? '0.00';

    const taxBlockers = [];
    if (invalidTaxGroups > 0) {
      taxBlockers.push({
        sourceType: 'tax_classification',
        documentId: null,
        invoiceReference: null,
        invoiceDate: null,
        status: null,
        blocker: 'unclassified_or_inconsistent_tax_category',
        count: invalidTaxGroups,
      });
    }
    if (Math.abs(Number(netVatPayable) - Number(ledgerNetVat)) > 0.01) {
      taxBlockers.push({
        sourceType: 'general_ledger',
        documentId: null,
        invoiceReference: null,
        invoiceDate: null,
        status: null,
        blocker: 'source_ledger_vat_mismatch',
        sourceNetVat: netVatPayable,
        ledgerNetVat,
      });
    }
    if (taxBlockers.length > 0) {
      return {
        ok: false,
        valid: false,
        period: { taxPeriodId: resolved.taxPeriodId, from: resolved.from, to: resolved.to },
        error: {
          code: invalidTaxGroups > 0 ? 'VAT_TAX_CLASSIFICATION_BLOCKED' : 'VAT_LEDGER_RECONCILIATION_BLOCKED',
          statusCode: 422,
          message: invalidTaxGroups > 0
            ? 'One or more invoices have missing or inconsistent tax classification.'
            : 'Invoice tax snapshots do not reconcile to the posted VAT control accounts.',
          blockingInvoices: taxBlockers,
        },
        blockingInvoices: taxBlockers,
        summary: { standardRate, output, input, outputVat, inputVat, netVatPayable, ledgerNetVat },
      };
    }

    return {
      ok: true,
      valid: true,
      period: { taxPeriodId: resolved.taxPeriodId, from: resolved.from, to: resolved.to },
      summary: {
        standardRate,
        output,
        input,
        outputVat,
        inputVat,
        netVatPayable,
        ledgerNetVat,
      },
    };
  }
}

module.exports = {
  VatValidationService,
  DRAFT_AND_UNPOSTED_SQL,
  VAT_BREAKDOWN_SQL,
  emptyBuckets,
  addMoney,
};
