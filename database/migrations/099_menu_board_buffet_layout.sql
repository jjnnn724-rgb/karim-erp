ALTER TABLE menu_board_settings
    ADD COLUMN IF NOT EXISTS buffet_layout JSONB NOT NULL DEFAULT
        '{"enabled":false,"mains":[],"soups":[],"desserts":[],"salads":[],"carving_by_day":[]}'::jsonb;
