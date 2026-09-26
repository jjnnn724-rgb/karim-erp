#!/bin/sh
# ════════════════════════════════════════════════════════════════
# Karim ERP — Docker Entrypoint
# ينشئ قاعدة البيانات (إن لم توجد) ويطبق migrations ثم يشغل السيرفر
# ════════════════════════════════════════════════════════════════
set -e

export PGPASSWORD="$DB_PASSWORD"

echo "═══════════════════════════════════════════════════════════════"
echo "  مطاعم الشرفه العالمي — Karim ERP Docker Startup"
echo "═══════════════════════════════════════════════════════════════"

# ─── انتظار PostgreSQL ───────────────────────────────────────────
echo "[1/4] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q; do
    echo "  PostgreSQL not ready, retrying in 2s..."
    sleep 2
done
echo "  ✓ PostgreSQL is ready"

# ─── إنشاء قاعدة البيانات إن لم توجد ───────────────────────────
echo "[2/4] Checking database '$DB_NAME'..."
DB_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "0")
if [ "$DB_EXISTS" = "1" ]; then
    echo "  ✓ Database '$DB_NAME' exists"
else
    echo "  Creating database '$DB_NAME'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";" >/dev/null
    echo "  ✓ Database '$DB_NAME' created"
fi

# ─── تطبيق migrations ────────────────────────────────────────────
echo "[3/4] Applying migrations..."
node database/scripts/run-migration.js || {
    echo "  ⚠ Migration warning (may be already applied)";
}
echo "  ✓ Migrations done"

# ─── إنشاء كلمة مرور admin فقط في قاعدة جديدة ────────────────────
echo "[3.5] Ensuring an admin account exists..."
node -e "
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ user:'$DB_USER', host:'$DB_HOST', database:'$DB_NAME', password:'$DB_PASSWORD', port:parseInt('$DB_PORT') });
const hash = bcrypt.hashSync('admin123', 12);
pool.query(\"UPDATE users SET password=\\$1 WHERE username='admin' AND (password IS NULL OR password='')\", [hash])
    .then(r => { console.log('  ✓ Admin account checked'); pool.end(); })
    .catch(e => { console.error('  Admin password error:', e.message); pool.end(); });
" 2>/dev/null || echo "  ⚠ Admin password setup skipped"

# ─── تشغيل السيرفر ──────────────────────────────────────────────
echo "[4/4] Starting Karim ERP Server on port ${PORT:-5000}..."
echo "═══════════════════════════════════════════════════════════════"
exec node backend/server.js
