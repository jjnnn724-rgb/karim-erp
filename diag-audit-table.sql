SET client_encoding = 'UTF8';
\echo === هل جدول التوثيق موجود؟ ===
SELECT COUNT(*)::int AS exists_cnt FROM information_schema.tables WHERE table_name = 'admin_delete_audit';
\echo === أعمدته إن وجد ===
SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_delete_audit' ORDER BY ordinal_position;
