BEGIN;

ALTER TABLE tax_config
    DROP CONSTRAINT IF EXISTS tax_config_filing_frequency_check;

ALTER TABLE tax_config
    DROP COLUMN IF EXISTS filing_frequency;

COMMIT;
