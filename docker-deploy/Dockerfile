FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ─── مستخدم غير مميّز (SECURITY) ───────────────────────────────────
# الحاوية كـroot = أي ثغرة في التطبيق ثغرة كاملة على المضيف.
# (نسخة docker-deploy قديمة — صُدّرت قبل إصلاح النسخة الرئيسية.)
RUN groupadd --system --gid 1001 karim \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /usr/sbin/nologin karim

COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force
COPY --chown=karim:karim backend/ ./backend/
COPY --chown=karim:karim frontend/ ./frontend/
COPY --chown=karim:karim database/ ./database/
COPY --chown=karim:karim scripts/ ./scripts/
COPY --chown=karim:karim common/ ./common/
COPY --chown=karim:karim docker-entrypoint.sh ./
RUN mkdir -p /app/logs /app/uploads /app/data /app/database/data \
    && chown -R karim:karim /app/logs /app/uploads /app/data /app/database/data \
    && chmod +x docker-entrypoint.sh

# SECURITY: لا تشغيل كـroot.
USER karim

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]
