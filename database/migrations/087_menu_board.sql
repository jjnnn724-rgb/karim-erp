-- ============================================================
-- Migration 087: شاشة عرض المنيو (Digital Signage Menu Board)
-- ============================================================
-- شاشة العرض العمودية في المولات تقرأ المنيو مباشرة من منيو الكاشير
-- (pos_products — المطبخ يديرها من شاشة «إدارة المنيو») فلا يوجد كتالوج
-- موازٍ. هذا الجدول فقط لإعدادات العرض: عناوين وفترات الوجبات والتذييل.
-- ============================================================

CREATE TABLE IF NOT EXISTS menu_board_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    title VARCHAR(80) NOT NULL DEFAULT 'مطاعم الشرفه العالمي',
    subtitle VARCHAR(160) NOT NULL DEFAULT 'مطعم و مطابخ الشرفه',
    breakfast_hours VARCHAR(40) NOT NULL DEFAULT '05:00 - 11:30',
    lunch_hours VARCHAR(40) NOT NULL DEFAULT '12:00 - 16:30',
    dinner_hours VARCHAR(40) NOT NULL DEFAULT '17:00 - 24:00',
    footer_text VARCHAR(240) NOT NULL DEFAULT 'الأسعار شاملة الضريبة · نتشرف بخدمتكم على مدار اليوم',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_board_settings IS 'شاشة منيو المول: إعدادات العرض (صف واحد id=1)';

INSERT INTO menu_board_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
