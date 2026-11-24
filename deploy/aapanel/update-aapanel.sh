#!/usr/bin/env bash
# تحديث aaPanel — بوابة نشر آمنة:
#   1) نسخة احتياطية مؤكدة قبل أي ترحيل  2) ترحيلات عبر العدّاد الرسمي (يستبعد _down.sql)
#   3) إعادة تشغيل  4) فحص صحة حقيقي  5) عند الفشل: إيقاف الخدمة + تعليمات تراجع صريحة
# لا يُعاد إنشاء القاعدة تلقائيًا: استرجاع قاعدة إنتاج قرار بشري موثّق.
set -Eeuo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
RUNTIME_USER_FILE="$APP_DIR/.aapanel-runtime-user"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail 'شغّل السكربت بصلاحية root أو sudo.'
[ -f "$ENV_FILE" ] || fail "ملف .env غير موجود: $ENV_FILE"
[ -f "$APP_DIR/package.json" ] || fail "مسار التطبيق غير صحيح: $APP_DIR"
command -v psql >/dev/null || fail 'psql غير موجود.'
command -v npm >/dev/null || fail 'npm غير موجود.'
command -v curl >/dev/null || fail 'curl غير موجود (مطلوب لفحص الصحة).'

set -a
. "$ENV_FILE"
set +a
: "${DB_HOST:?DB_HOST مطلوب}" "${DB_PORT:?DB_PORT مطلوب}" "${DB_USER:?DB_USER مطلوب}" "${DB_PASSWORD:?DB_PASSWORD مطلوب}" "${DB_NAME:?DB_NAME مطلوب}"

cd "$APP_DIR"

# ── 1) نسخة احتياطية إلزامية قبل أي كتابة ───────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$APP_DIR/database/backups/pre-aapanel-update-$STAMP.sql"
mkdir -p "$(dirname "$BACKUP_FILE")"
printf '◷ نسخة احتياطية قبل التحديث: %s\n' "$BACKUP_FILE"
npm run backup -- "$BACKUP_FILE" >/dev/null
[ -s "$BACKUP_FILE" ] || fail 'النسخة الاحتياطية فارغة — أوقف النشر.'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256" || fail 'تعذّر حساب بصمة النسخة.'

# ── 2) التبعيات والترحيلات ──────────────────────────────────────────────────
npm ci --omit=dev --ignore-scripts
# العدّاد الرسمي يستبعد *_down.sql ويقفل الترحيلات (database/scripts/run-migration.js:42-44).
npm run migrate
node scripts/migrate-plaintext-passwords.js >/dev/null

# ── 3) الصلاحيات ────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR/logs" "$APP_DIR/database/media" "$APP_DIR/database/backups"
if [ -z "${APP_USER:-}" ] && [ -f "$RUNTIME_USER_FILE" ]; then APP_USER="$(tr -d '[:space:]' < "$RUNTIME_USER_FILE")"; fi
APP_USER="${APP_USER:-www}"
if ! id "$APP_USER" >/dev/null 2>&1 || [ "$APP_USER" = "root" ]; then
  fail 'مستخدم تشغيل مقيد غير موجود. شغّل التثبيت الأولي أو حدّد APP_USER.'
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

# ── 4) إعادة التشغيل ────────────────────────────────────────────────────────
npm install -g pm2 >/dev/null 2>&1 || true
if systemctl list-unit-files karim-erp.service >/dev/null 2>&1 && systemctl is-enabled karim-erp.service >/dev/null 2>&1; then
  systemctl restart karim-erp.service
else
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$APP_USER" pm2 restart karim-erp --update-env || sudo -u "$APP_USER" pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
    sudo -u "$APP_USER" pm2 save
  else
    runuser -u "$APP_USER" -- pm2 restart karim-erp --update-env || runuser -u "$APP_USER" -- pm2 start deploy/aapanel/ecosystem.config.cjs --update-env
    runuser -u "$APP_USER" -- pm2 save
  fi
fi

# ── 5) فحص صحة حقيقي قبل إعلان النجاح ──────────────────────────────────────
healthy=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then healthy=1; break; fi
  sleep "$HEALTH_INTERVAL"
done
if [ "$healthy" -ne 1 ]; then
  printf '✗ فحص الصحة فشل على %s — الخدمة أُوقفت لتجنّب تقديم نسخة معطوبة.\n' "$HEALTH_URL" >&2
  systemctl stop karim-erp.service >/dev/null 2>&1 || true
  printf 'التراجع اليدوي (بعد مراجعة المالك):\n' >&2
  printf '  1) استعادة الكود: git checkout <الإصدار_السابق>\n' >&2
  printf '  2) استعادة القاعدة: psql -h %s -p %s -U %s -d %s -v ON_ERROR_STOP=1 -f %s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_NAME" "$BACKUP_FILE" >&2
  printf '  3) إعادة التشغيل ثم إعادة فحص /api/health\n' >&2
  exit 1
fi

printf '✓ تحديث aaPanel اكتمل — الصحة OK على %s\n' "$HEALTH_URL"
printf '  النسخة الاحتياطية: %s (بصمتها في %s.sha256)\n' "$BACKUP_FILE" "$BACKUP_FILE"
