#!/bin/sh
# ════════════════════════════════════════════════════════════════
# Karim ERP — Docker Entrypoint (آمن)
# ينشئ قاعدة البيانات (إن لم توجد) ويطبق migrations ثم يشغل السيرفر
# ════════════════════════════════════════════════════════════════
set -euo pipefail

# متطلبات إلزامية — يفشل فورًا إن غابت، لا افتراضيات آمنة.
: "${DB_HOST:?DB_HOST مطلوب}"
: "${DB_PORT:?DB_PORT مطلوب}"
: "${DB_USER:?DB_USER مطلوب}"
: "${DB_PASSWORD:?DB_PASSWORD مطلوب — لا توجد كلمة مرور افتراضية}"
: "${DB_NAME:?DB_NAME مطلوب}"

export PGPASSWORD="$DB_PASSWORD"

echo "═══════════════════════════════════════════════════════════════"
echo "  مطاعم الشرفه العالمي — Karim ERP Docker Startup (آمن)"
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

# ─── تطبيق migrations (فشل فوري — لا استكمال على قاعدة جزئية) ───
echo "[3/4] Applying migrations..."
node database/scripts/run-migration.js
echo "  ✓ Migrations done"

# ─── إنشاء كلمة مرور admin فقط إذا قُدِّمت صراحة عبر المتغير البيئي ──
echo "[3.5] فحص حساب admin..."
if [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo "  تعيين كلمة مرور admin من المتغير البيئي ADMIN_PASSWORD..."
    node -e "
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: parseInt(process.env.DB_PORT) });
const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
pool.query(\"UPDATE users SET password=\\$1 WHERE username='admin' AND (password IS NULL OR password='')\", [hash])
    .then(() => { console.log('  ✓ Admin password set'); pool.end(); })
    .catch(e => { console.error('  Admin password error:', e.message); pool.end(); process.exit(1); });
" || { echo "  ✗ فشل تعيين كلمة مرور admin"; exit 1; }
else
    echo "  ⚠ ADMIN_PASSWORD غير مضبوط — لا توجد كلمة مرور افتراضية. الحساب يبقى كما هو."
fi

# ─── تشغيل السيرفر ──────────────────────────────────────────────
echo "[4/4] Starting Karim ERP Server on port ${PORT:-5000}..."
echo "═══════════════════════════════════════════════════════════════"
exec node backend/server.js
