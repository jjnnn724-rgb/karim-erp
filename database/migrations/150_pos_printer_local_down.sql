-- 150_pos_printer_local_down.sql — إرجاع قيد connection_type إلى ما قبل windows_local
-- الصفوف من نوع windows_local لا يعرفها القيد القديم؛ تُحوَّل إلى windows_share
-- مع بقاء الاسم في address (يُراجع يدويًا قبل تشغيل عامل الطباعة على النسخة القديمة).

UPDATE pos_printers
   SET connection_type = 'windows_share'
 WHERE connection_type = 'windows_local';

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
        CHECK (connection_type IN ('usb', 'network', 'serial', 'windows_share'));
END $$;

COMMENT ON COLUMN pos_printers.connection_type IS NULL;
