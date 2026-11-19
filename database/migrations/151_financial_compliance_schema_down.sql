-- Manual rollback for 151_financial_compliance_schema.sql.
-- DESTRUCTIVE: deletes only records created in the new compliance tables and
-- removes import metadata from bank_statements. Back up and obtain approval
-- before running against any database containing operational data. PostgreSQL
-- enum labels PAYROLL_APPROVE and VAT_RETURN_FINALIZE are intentionally retained.

BEGIN;

DROP INDEX IF EXISTS uq_bank_statement_import_line;
ALTER TABLE bank_statements DROP CONSTRAINT IF EXISTS ck_bank_statement_import_line;
ALTER TABLE bank_statements DROP CONSTRAINT IF EXISTS bank_statements_import_account_fk;
ALTER TABLE bank_statements
    DROP COLUMN IF EXISTS bank_reference,
    DROP COLUMN IF EXISTS import_line_no,
    DROP COLUMN IF EXISTS import_id;
DROP TABLE IF EXISTS bank_statement_imports;

DROP TABLE IF EXISTS vat_return_lines;
DROP TABLE IF EXISTS vat_returns;
DROP TABLE IF EXISTS wps_export_runs;
DROP TABLE IF EXISTS payroll_gosi_calculations;
DROP TABLE IF EXISTS gosi_rate_rules;
DROP TABLE IF EXISTS gosi_rate_sets;

COMMIT;
