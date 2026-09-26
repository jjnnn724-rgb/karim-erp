#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
RUNTIME_USER_FILE="$APP_DIR/.aapanel-runtime-user"

[ "$(id -u)" -eq 0 ] || { echo 'شغّل السكربت بصلاحية root أو sudo.' >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ملف .env غير موجود: $ENV_FILE" >&2; exit 1; }
[ -f "$APP_DIR/package.json" ] || { echo "مسار التطبيق غير صحيح: $APP_DIR" >&2; exit 1; }

set -a
. "$ENV_FILE"
set +a
: "${DB_HOST:?DB_HOST مطلوب}" "${DB_PORT:?DB_PORT مطلوب}" "${DB_USER:?DB_USER مطلوب}" "${DB_PASSWORD:?DB_PASSWORD مطلوب}" "${DB_NAME:?DB_NAME مطلوب}"
command -v psql >/dev/null || { echo 'psql غير موجود.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm غير موجود.' >&2; exit 1; }

cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts
for migration in "$APP_DIR"/database/migrations/*.sql; do
  [ "$(basename "$migration")" = '006_demo_seed.sql' ] && continue
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" KARIM_BOOTSTRAP_CREDENTIAL_DIR="$APP_DIR/.aapanel-bootstrap" node scripts/migrate-plaintext-passwords.js >/dev/null
mkdir -p "$APP_DIR/logs" "$APP_DIR/database/media" "$APP_DIR/database/backups"
if [ -z "${APP_USER:-}" ] && [ -f "$RUNTIME_USER_FILE" ]; then APP_USER="$(tr -d '[:space:]' < "$RUNTIME_USER_FILE")"; fi
APP_USER="${APP_USER:-www}"
if ! id "$APP_USER" >/dev/null 2>&1 || [ "$APP_USER" = "root" ]; then
  echo 'مستخدم تشغيل مقيد غير موجود. شغّل التثبيت الأولي أو حدّد APP_USER لمستخدم نظام غير root.' >&2
  exit 1
fi
APP_GROUP="$(id -gn "$APP_USER")"
chown -R "root:$APP_GROUP" "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 750 {} +
find "$APP_DIR" -type f -exec chmod 640 {} +
for runtime_dir in "$APP_DIR/database/media" "$APP_DIR/database/backups" "$APP_DIR/logs"; do
  chown -R "$APP_USER:$APP_GROUP" "$runtime_dir"
  find "$runtime_dir" -type d -exec chmod 750 {} +
  find "$runtime_dir" -type f -exec chmod 640 {} +
done
if [ -d "$APP_DIR/.aapanel-bootstrap" ]; then
  chown -R root:root "$APP_DIR/.aapanel-bootstrap"
  find "$APP_DIR/.aapanel-bootstrap" -type d -exec chmod 700 {} +
  find "$APP_DIR/.aapanel-bootstrap" -type f -exec chmod 600 {} +
fi
chown root:"$APP_GROUP" "$ENV_FILE"
chmod 640 "$ENV_FILE"
npm install -g pm2 >/dev/null 2>&1 || true
if systemctl list-unit-files karim-erp.service >/dev/null 2>&1 && systemctl is-enabled karim-erp.service >/dev/null 2>&1; then
  systemctl restart karim-erp.service
else
  if [ "$APP_USER" = "root" ]; then
    pm2 restart karim-erp --update-env || pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
    pm2 save
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$APP_USER" pm2 restart karim-erp --update-env || sudo -u "$APP_USER" pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
    sudo -u "$APP_USER" pm2 save
  else
    runuser -u "$APP_USER" -- pm2 restart karim-erp --update-env || runuser -u "$APP_USER" -- pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
    runuser -u "$APP_USER" -- pm2 save
  fi
fi
printf 'تحديث aaPanel اكتمل؛ راجع pm2 status و/api/health.\n'
