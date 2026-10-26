#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DB_NAME="${DB_NAME:-karim_erp}"
DB_USER="${DB_USER:-karim_erp}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ENV_FILE="$APP_DIR/.env"
BOOTSTRAP_DIR="$APP_DIR/.aapanel-bootstrap"
RUNTIME_USER_FILE="$APP_DIR/.aapanel-runtime-user"

log() { printf '[karim-aapanel] %s\n' "$*"; }
fail() { printf '[karim-aapanel] ERROR: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "الأمر غير موجود: $1"; }

[ "$(id -u)" -eq 0 ] || fail 'شغّل السكربت بصلاحية root أو sudo.'
[ -f "$APP_DIR/package.json" ] || fail "مسار التطبيق غير صحيح: $APP_DIR"
[ -f "$APP_DIR/.env" ] && fail "ملف .env موجود مسبقًا. لا يستبدله السكربت؛ راجعه ثم أعد التشغيل عند الحاجة."
if [ -z "${APP_USER:-}" ] && [ -f "$RUNTIME_USER_FILE" ]; then APP_USER="$(tr -d '[:space:]' < "$RUNTIME_USER_FILE")"; fi
APP_USER="${APP_USER:-www}"
if ! id "$APP_USER" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin karim-erp
    APP_USER="karim-erp"
  else
    fail 'المستخدم www غير موجود ولا يمكن إنشاء مستخدم خدمة مقيد.'
  fi
fi
[[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail 'DB_NAME يجب أن يحتوي على أحرف وأرقام وشرطة سفلية فقط.'
[[ "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail 'DB_USER يجب أن يحتوي على أحرف وأرقام وشرطة سفلية فقط.'

require_cmd node
require_cmd npm
require_cmd psql
require_cmd createdb
require_cmd createuser
require_cmd openssl

run_postgres() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    runuser -u postgres -- "$@"
  fi
}

run_app() {
  if [ "$APP_USER" = "root" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$APP_USER" "$@"
  else
    runuser -u "$APP_USER" -- "$@"
  fi
}

install -d -m 700 "$BOOTSTRAP_DIR" "$APP_DIR/logs" "$APP_DIR/database/media" "$APP_DIR/database/backups" "$APP_DIR/var/brotli-cache"

DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 48)}"
JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 48)}"
API_KEY="${API_KEY:-$(openssl rand -hex 32)}"

if ! run_postgres psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  fail "PostgreSQL غير متاح على $DB_HOST:$DB_PORT. ثبته وشغله من aaPanel أولًا."
fi

if ! run_postgres psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$(printf "%s" "$DB_USER" | sed "s/'/''/g")'" | grep -q 1; then
  run_postgres createuser -h "$DB_HOST" -p "$DB_PORT" "$DB_USER"
fi
run_postgres psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -v ON_ERROR_STOP=1 -v new_password="$DB_PASSWORD" -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD :'new_password';"

if ! run_postgres psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$(printf "%s" "$DB_NAME" | sed "s/'/''/g")'" | grep -q 1; then
  run_postgres createdb -h "$DB_HOST" -p "$DB_PORT" -O "$DB_USER" "$DB_NAME"
fi
run_postgres psql -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" >/dev/null

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=${PORT:-5000}
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_EXPIRY=24h
API_KEY=$API_KEY
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:5000}
MEDIA_ROOT=./database/media
BACKUP_PATH=./database/backups
LOG_PATH=./logs
DEBUG=false
DEBUG_SQL=false
LOG_LEVEL=info
ZATCA_MODE=${ZATCA_MODE:-sandbox}
# كاش Brotli للأصول الساكنة (Nginx في aaPanel مجرد reverse proxy لا يقرأ القرص)
BROTLI_CACHE_DIR=$APP_DIR/var/brotli-cache
BROTLI_CACHE_MAX_MB=100
BROTLI_CACHE_MAX_AGE_DAYS=7
WARMUP_ENABLED=true
EOF
chmod 600 "$ENV_FILE"

log 'تثبيت اعتماديات الخادم فقط...'
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts

log 'تطبيق الترحيلات الإنتاجية فقط...'
for migration in "$APP_DIR"/database/migrations/*.sql; do
  [ "$(basename "$migration")" = '006_demo_seed.sql' ] && continue
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

log 'تقوية كلمات المرور...'
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" KARIM_BOOTSTRAP_CREDENTIAL_DIR="$BOOTSTRAP_DIR" node scripts/migrate-plaintext-passwords.js >/dev/null
chmod 700 "$BOOTSTRAP_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
# APP_USER is validated and created above; never silently fall back to root.
APP_GROUP="$(id -gn "$APP_USER")"
# Code and dependencies are read-only to the service account; runtime folders are writable.
chown -R "root:$APP_GROUP" "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 750 {} +
find "$APP_DIR" -type f -exec chmod 640 {} +
for runtime_dir in "$APP_DIR/database/media" "$APP_DIR/database/backups" "$APP_DIR/logs" "$APP_DIR/var/brotli-cache"; do
  chown -R "$APP_USER:$APP_GROUP" "$runtime_dir"
  find "$runtime_dir" -type d -exec chmod 750 {} +
  find "$runtime_dir" -type f -exec chmod 640 {} +
done
chown -R root:root "$BOOTSTRAP_DIR"
find "$BOOTSTRAP_DIR" -type d -exec chmod 700 {} +
find "$BOOTSTRAP_DIR" -type f -exec chmod 600 {} +
chown root:"$APP_GROUP" "$ENV_FILE"
chmod 640 "$ENV_FILE"
printf '%s\n' "$APP_USER" > "$RUNTIME_USER_FILE"
chown root:root "$RUNTIME_USER_FILE"
chmod 600 "$RUNTIME_USER_FILE"

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
PM2_RUNTIME="$(command -v pm2-runtime || true)"
if command -v systemctl >/dev/null 2>&1 && [ -n "$PM2_RUNTIME" ]; then
  cat > /etc/systemd/system/karim-erp.service <<UNIT
[Unit]
Description=Karim ERP — مطاعم الشرفه العالمي
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=HOME=$APP_HOME
Environment=NODE_ENV=production
ExecStart=$PM2_RUNTIME $APP_DIR/deploy/aapanel/ecosystem.config.cjs --env production
Restart=always
RestartSec=5
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/logs $APP_DIR/database/media $APP_DIR/database/backups

[Install]
WantedBy=multi-user.target
UNIT
  chmod 644 /etc/systemd/system/karim-erp.service
  systemctl daemon-reload
  systemctl enable --now karim-erp.service
else
  log 'systemd غير متاح؛ تشغيل PM2 للمستخدم المحدد مع ضرورة تفعيل startup من aaPanel.'
  run_app pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
  run_app pm2 save
fi

log 'اكتملت التهيئة. تحقق من ملف بيانات المسؤول داخل .aapanel-bootstrap ثم غيّر كلمة المرور فورًا.'
log 'بعد ضبط نطاق aaPanel، حدّث ALLOWED_ORIGINS في .env ثم نفّذ: pm2 restart karim-erp --update-env'
log 'لا تفتح منفذ PostgreSQL على الإنترنت؛ افتح HTTP/HTTPS فقط عبر Nginx.'
