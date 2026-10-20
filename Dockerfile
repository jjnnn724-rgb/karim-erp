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

// ─── مستخدم غير مميّز (SECURITY) ───────────────────────────────────
// تشغيل الحاوية كـroot يعني أن أي ثغرة في التطبيق = ثغرة كاملة على المضيف.
// مستخدم مخصّص بلا صلاحيات إدارة، والمجلدات القابلة للكتابة ملكه وحده.
RUN groupadd --system --gid 1001 karim \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /usr/sbin/nologin karim

# ─── نسخ package files وتثبيت التبعيات ───────────────────────────
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ─── نسخ كود المشروع ─────────────────────────────────────────────
# FIX 2026-10-03 (Enterprise R2): أُزيل `COPY .env ./` — كان يخبز الأسرار
# الحقيقية داخل الصورة (أي من يملك الصورة يملك JWT/DB/WhatsApp). البيئة
# تُمرر عبر docker-compose environment أو env_file وقت التشغيل فقط.
COPY --chown=karim:karim backend/ ./backend/
COPY --chown=karim:karim frontend/ ./frontend/
COPY --chown=karim:karim database/ ./database/
COPY --chown=karim:karim scripts/ ./scripts/
COPY --chown=karim:karim docker-entrypoint.sh ./

# ─── صلاحيات entrypoint ──────────────────────────────────────────

# ─── المنفذ ──────────────────────────────────────────────────────
# ─── المجلدات القابلة للكتابة (السجلات/المرفقات/بيانات) ─────
RUN mkdir -p /app/logs /app/uploads /app/data /app/database/data \
    && chown -R karim:karim /app/logs /app/uploads /app/data /app/database/data \
    && chmod +x /app/docker-entrypoint.sh

# SECURITY: لا تشغيل كـroot — see the useradd block above.
USER karim

EXPOSE 5000

# ─── Healthcheck ─────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# ─── Entrypoint ──────────────────────────────────────────────────
ENTRYPOINT ["./docker-entrypoint.sh"]
