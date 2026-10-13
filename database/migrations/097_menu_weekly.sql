-- 097_menu_weekly.sql — منيو البوفيه الأسبوعي (7 أيام)
CREATE TABLE IF NOT EXISTS menu_weekly (
    day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
    title character varying(120) NOT NULL DEFAULT '',
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    note character varying(240) NOT NULL DEFAULT '',
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
