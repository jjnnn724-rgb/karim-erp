BEGIN;

ALTER TABLE tax_config
    ADD COLUMN IF NOT EXISTS filing_frequency VARCHAR(10) NOT NULL DEFAULT 'quarterly';

DO $$
BEGIN
    ALTER TABLE tax_config
        ADD CONSTRAINT tax_config_filing_frequency_check
        CHECK (filing_frequency IN ('monthly', 'quarterly'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

COMMIT;
