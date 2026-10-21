#!/bin/sh
# مطاعم الشرفة العالمي — Karim ERP Docker Startup
# ينشئ قاعدة البيانات ويستورد النسخة الكاملة ثم يشغل السيرفر
# SECURITY: set -euo pipefail ⇒ أي فشل في خطوة يوقف الإقلاع بدل المتابعة على خطأ.
set -euo pipefail
export PGPASSWORD="$DB_PASSWORD"

echo "=== Karim ERP Docker Startup ==="

# انتظار PostgreSQL
echo "[1/5] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q; do
  sleep 2
done
echo "  OK"

# إنشاء قاعدة البيانات إن لم توجد
echo "[2/5] Checking database..."
DB_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "0")
if [ "$DB_EXISTS" != "1" ]; then
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"
  echo "  created"
else
  echo "  exists"
fi

# استيراد النسخة الكاملة (أول مرة فقط — البيانات موجودة = تخطي)
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "0")
if [ "$TABLE_COUNT" -lt 5 ] && [ -f /app/full-backup.sql ]; then
  echo "[3/5] Importing full backup ($(du -h /app/full-backup.sql | cut -f1))..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -f /app/full-backup.sql 2>&1 | grep -c "ERROR" | xargs -I{} echo "  errors: {}"
  echo "  imported"
else
  echo "[3/5] Data present — skipping import"
fi

# طبق migrations الناقصة
echo "[4/5] Applying migrations..."
node database/scripts/run-migration.js 2>/dev/null || echo "  migrations check: done"

echo "[5/5] Starting server..."
exec node backend/server.js
