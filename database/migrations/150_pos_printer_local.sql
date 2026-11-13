-- 150_pos_printer_local.sql — طابعة حرارية محلية على ويندوز (USB / طابور الطباعة)
-- ────────────────────────────────────────────────────────────────────────────
-- 003_cashier_module.sql قيّد connection_type على usb/network/serial/windows_share،
-- و036 أضاف kind. الطابعات الحرارية تُوصَل غالبًا USB على جهاز الكاشير نفسه
-- وتظهر في ويندوز كطابور طباعة؛ لا يمكن إرسال ESC/POS خام إلى طابور محلي عبر
-- lpr أو UNC. العمود الجديد windows_local يحمل اسم الطابور كما يظهر في ويندوز
-- (address = اسم الطابعة) ويُرسَل إليه العامل عبر winspool RAW.

DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'pos_printers'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%connection_type%'
    LOOP
        EXECUTE format('ALTER TABLE pos_printers DROP CONSTRAINT %I;', con.conname);
    END LOOP;

    ALTER TABLE pos_printers
        ADD CONSTRAINT pos_printers_connection_type_check
        CHECK (connection_type IN ('usb', 'network', 'serial', 'windows_share', 'windows_local'));
END $$;

COMMENT ON COLUMN pos_printers.connection_type IS
    'network (TCP 9100) | windows_share (server/share) | windows_local (اسم طابور ويندوز، طباعة RAW عبر winspool) | usb/serial (غير مدعومة في الإرسال)';
