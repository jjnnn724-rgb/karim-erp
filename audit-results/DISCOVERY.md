# DISCOVERY — Karim ERP Full-Stack Audit

**Date:** 2026-10-11
**Auditor:** opencode (autonomous)
**Scope:** Full backend + frontend + infra (read-only static analysis)

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >=18 (v20.19.0 on host) |
| Framework | Express 4.21 |
| Realtime | Socket.io 4.8 |
| Database | PostgreSQL 18 (`pg` 8.12) — primary |
| DB (legacy) | Oracle (`oracledb` 7) — Yarasoft mirror, currently disabled |
| Queue | BullMQ 5.13 (Redis, optional — SKIP_BULLMQ=true) |
| Auth | JWT (access + refresh, bcryptjs) |
| Validation | schema-registry (custom whitelist) + zod (dead code) |
| Frontend | Vanilla JS SPA (ES modules), RTL Arabic |
| Build | Electron 28 + Capacitor (Android) |
| TLS | Express built-in (self-signed) + Cloudflare Tunnel |
| Deploy | Windows service (WinSW) + Docker (optional) |
| Tests | Jest 29 |
| Lint | ESLint 10 + Prettier |

## Project Structure

```
karim-erp/
├── backend/           # Express server + all business logic
│   ├── server.js      # 2709 lines — app bootstrap + generic CRUD
│   ├── middleware/    # security, health, idempotency, circuit, correlation
│   ├── errors/        # error-handler, app-error
│   ├── cashier-module/# POS + JWT middleware
│   ├── zkteco/        # biometric device sync
│   ├── yarasoft/      # POS invoice import
│   ├── whatsapp-engine/ # Baileys WhatsApp
│   ├── realtime/      # Socket.io guards
│   ├── attendance-push/ # Hikvision push queue
│   ├── audit-engine/  # health/security checks
│   └── services/      # EMPTY (unused scaffold)
├── frontend/app/      # SPA (vanilla JS, no framework)
│   └── js/
│       ├── core/      # config, storage, state
│       ├── features/  # 30+ feature modules
│       └── vendor/    # 3rd party
├── database/
│   ├── migrations/    # 86 SQL migration files
│   └── scripts/       # backup, restore, setup
├── scripts/           # operational scripts
├── tests/             # Jest tests
└── tools/             # employee card generator, etc.
```

## Architecture Notes

- **Generic CRUD**: server.js auto-registers GET/POST/PUT/DELETE for ~40 entities with column whitelisting (schema-registry)
- **Attendance engine**: central punch processor called from portal, ZKTeco, Hikvision push
- **Inventory ledger**: single writer with idempotency keys
- **Dispatch workflow**: multi-role approval chain (kitchen → chef → warehouse → receive)
- **HR roster**: weekly department scheduling with approval workflow

## Key Security Controls (verified working)

1. `filterBody()` column whitelist on every generic POST/PUT
2. Bearer-only auth (no cookies → CSRF low risk)
3. `authLimiter` on login/refresh/change-password
4. Placeholder-secret rejection
5. Crash journaling + process shields
6. `.env` not in git index
7. `RT_REQUIRE_AUTH=true` active
8. Employee salary masked for non-admin/manager/hr
9. Dispatch signature blobs stripped from list responses

## Key Weaknesses Found

1. **Attendance engine CRITICAL bug** — `autoLock` out of scope
2. **Timezone chaos** — `riyadh-date.js` exists but 8+ files bypass it
3. **Missing transactions** — multi-step writes without BEGIN/COMMIT
4. **Read-gate mismatch** — 5 payroll entities ungated on GET
5. **Test DB restores production** — PII leak into test database
6. **Stored XSS** — WhatsApp query result unescaped
7. **API cache ordering** — cache HIT bypasses auth/rate-limits
8. **JWT secret derivation** — predictable in non-production
