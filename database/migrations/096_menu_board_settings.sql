-- 096_menu_board_settings.sql — جدول إعدادات شاشة المنيو + اختيار التصنيفات المعروضة
CREATE TABLE IF NOT EXISTS menu_board_settings (
    id integer PRIMARY KEY,
    title character varying(80) NOT NULL DEFAULT 'مطاعم الشرفه العالمي',
    subtitle character varying(160) NOT NULL DEFAULT '',
    breakfast_hours character varying(40) NOT NULL DEFAULT '05:00 - 11:30',
    lunch_hours character varying(40) NOT NULL DEFAULT '12:00 - 16:30',
    dinner_hours character varying(40) NOT NULL DEFAULT '17:00 - 24:00',
    footer_text character varying(240) NOT NULL DEFAULT '',
    board_categories jsonb,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE menu_board_settings ADD COLUMN IF NOT EXISTS board_categories jsonb;
INSERT INTO menu_board_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
