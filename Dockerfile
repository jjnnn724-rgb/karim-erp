# ════════════════════════════════════════════════════════════════
# Karim ERP v4.7.0 — Dockerfile
# مطاعم الشرفه العالمي — نظام إدارة المطاعم المتكامل
# ════════════════════════════════════════════════════════════════
FROM node:20-slim

# ─── تثبيت psql و pg_isready لطبق migrations ─────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        postgresql-client \
        && \
    rm -rf /var/lib/apt/lists/*

# ─── مجلد العمل ──────────────────────────────────────────────────
WORKDIR /app

# ─── نسخ package files وتثبيت التبعيات ───────────────────────────
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ─── نسخ كود المشروع ─────────────────────────────────────────────
# FIX 2026-10-03 (Enterprise R2): أُزيل `COPY .env ./` — كان يخبز الأسرار
# الحقيقية داخل الصورة (أي من يملك الصورة يملك JWT/DB/WhatsApp). البيئة
# تُمرر عبر docker-compose environment أو env_file وقت التشغيل فقط.
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY database/ ./database/
COPY scripts/ ./scripts/
COPY docker-entrypoint.sh ./

# ─── صلاحيات entrypoint ──────────────────────────────────────────
RUN chmod +x docker-entrypoint.sh

# ─── المنفذ ──────────────────────────────────────────────────────
EXPOSE 5000

# ─── Healthcheck ─────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# ─── Entrypoint ──────────────────────────────────────────────────
ENTRYPOINT ["./docker-entrypoint.sh"]
