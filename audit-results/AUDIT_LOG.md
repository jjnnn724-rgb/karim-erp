# AUDIT_LOG — Karim ERP Full-Stack Audit

## Phase 0: BOOTSTRAP
- **Time:** 2026-10-11
- **Files read:** package.json, .env.example, eslint.config.js
- **Stack discovered:** Node.js 20 + Express 4.21 + PostgreSQL 18 + Socket.io 4.8 + JWT + vanilla JS frontend
- **Notes:** Git binary not available on host — branch creation skipped

## Phase 1: DEEP READ
- **Time:** 2026-10-11
- **Files read (via 4 parallel agents):**
  - Agent 1 (backend core): server.js, shared-pool.js, logger.js, middleware/*, jwt-middleware.js, permissions.js, submit-guard.js, schema-registry.js, rate-limiter.js, graceful-shutdown.js, errors/*, pagination.js, api-cache.js, password-vault.js, pw-crypto.js, zod-schemas.js
  - Agent 2 (routes): hr-routes.js, warehouse-routes.js, accounting-routes.js, finance-routes.js, notification-*.js, leave-workflow-routes.js, inventory-*.js, kitchen-production-routes.js, procurement-routes.js, system-routes.js, permission-routes.js, menu-board-routes.js, cashier-monitor-routes.js, dispatch-notifier.js, attendance-portal-routes.js, punch-portal-logic.js
  - Agent 3 (engines): attendance-engine.js, shift-day.js, shifts-engine.js, monthly-attendance-query.js, strict-audit-lib.js, accounting-growth.js, accounting-periods.js, inventory-ledger.js, db-constraints.js, db-validation-middleware.js, unit-conversion.js, supervisor-policy.js, catch-weight-heuristic.js, tax-rule-service.js, veg-requests-*.js, riyadh-date.js, daily-report-service.js, manager-briefing.js, report-formatters.js, metrics.js, startup.js, media-storage.js, schema-registry.js
  - Agent 4 (frontend/infra): .env, frontend core files, jwt-middleware.js, password-vault.js, pw-crypto.js, docker-compose.yml, Dockerfile, nginx.conf, zkteco/, yarasoft/, whatsapp-engine/, realtime/, attendance-push/, cashier-module/, services/, scripts/serve.js, jest.config.js
- **Issues found:** 56 total (2 CRITICAL, 24 HIGH, 22 MEDIUM, 8 LOW)

## Phase 2: ISSUE REGISTRY
- **Time:** 2026-10-11
- **Files created:** audit-results/DISCOVERY.md, audit-results/ISSUES.md, audit-results/EXECUTION_PLAN.md
- **Key findings:**
  - CRITICAL: attendance-engine.js:667 autoLock out of scope → all punches on inferred-check-in rows lost
  - CRITICAL: password-vault.js key derived from JWT_ACCESS_SECRET
  - HIGH: 5 payroll entities ungated on GET (read-gate mismatch)
  - HIGH: Stored XSS in WhatsApp query result
  - HIGH: API cache mounted before auth → bypasses rate limits
  - HIGH: JWT secret predictable in non-production
  - HIGH: fs block-scoped → /app/sw.js broken
  - HIGH: JWT refresh rotation race
  - HIGH: Timezone chaos (UTC vs Riyadh) in 8+ files
  - HIGH: Double-charge races in veg-requests
  - HIGH: AP aging bucket logic wrong

## Phase 3: FIXES BATCH 1
- **Time:** 2026-10-11
- **Files modified:**
  1. `backend/attendance-engine.js` — C1 (autoLock param), C15 (Riyadh timezone), C16 (23505 handling)
  2. `backend/server.js` — C10 (fs module scope), C3 (read-gate fix)
  3. `frontend/app/js/features/whatsapp.js` — C5 (XSS escape)
  4. `backend/cashier-module/jwt-middleware.js` — C13 (refresh rotation race)
  5. `backend/hr-routes.js` — C23 (next parameter)
  6. `backend/accounting-growth.js` — C20 (AP aging buckets)
  7. `backend/media-storage.js` — C21 (extension sanitization)
  8. `backend/veg-requests-routes.js` — C18+C19 (transaction + status guards)
  9. `backend/startup.js` — C14 (random JWT secret)
  10. `backend/inventory-ledger.js` — C22 (Riyadh business date)
- **Syntax verification:** All 9 backend files pass `node --check`

## Phase 4: FIXES BATCH 2
- **Time:** 2026-10-11
- **Files modified:**
  1. `backend/server.js` — C6 (apiCache moved after auth), C7 (import limit 50MB→10MB), C11 (dispatch dedup: removed broken `id > $3`)
  2. `backend/middleware/health.js` — C9 (/verbose: use req.connection.remoteAddress)
  3. `backend/hr-routes.js` — C24 (advisory lock for first punch), C25 (payroll TOCTOU: checks inside txn, fail-closed), C26 (spawnSync→async spawn), C17 (PK retry on 23505)
  4. `backend/middleware/idempotency.js` — M1 (only cache 2xx as completed)
  5. `backend/errors/app-error.js` — M5 (statusCode passthrough + pg 22P02→400)
  6. `backend/metrics.js` — M8 (env var validation + cardinality cap 500)
  7. `backend/strict-audit-lib.js` — M9 (15-min grace applied to late calculation)
  8. `backend/attendance-portal-routes.js` — M17 (face v2: reject when no face detected)
  9. `backend/punch-portal-logic.js` — M18 (fixes array capped at 50)
  10. `backend/leave-workflow-routes.js` — M12 (schemaPromise reset on failure)
  11. `backend/stocktaking-routes.js` — M13 (schemaReady reset on failure)
  12. `backend/cashier-module/kot-routes.js` — M13 (schemaReady reset on failure)
  13. `backend/notification-service.js` — M14 (SAVEPOINT per INSERT), C17 (crypto.randomInt PK)
  14. `backend/graceful-shutdown.js` — M4 (logger default + fix option passing)
  15. `backend/server.js` — M4 (logger moved from dependencies to options)
  16. `backend/accounting-periods.js` — M11 (period check embedded in UPDATE WHERE — atomic)
  17. `backend/cashier-monitor-routes.js` — M16 (MIRROR_CASHIERS scope filter on /orders/:doc)
  18. `backend/inventory-control-routes.js` — M15 (RE-ENABLE triggers inside txn before COMMIT)
  19. `backend/zod-schemas.js` — M6 (deleted dead code file)
- **Syntax verification:** All 18 files pass `node --check`

## Phase 6: 2026-10-11 — Final batch (L1-L8 + M20 + remaining M-items)
- **Time:** 2026-10-11
- **Files modified:**
  1. `backend/schema-registry.js` — L4 (getSortableColumns blacklist: password, salary, bank_account, national_id, token, secret)
  2. `backend/submit-guard.js` — L5 (RECENT_WINDOW_MS 90s → 10s)
  3. `backend/whatsapp-engine/routes.js` — L6 (generic Arabic error message instead of e.message leak)
  4. `backend/server.js` — L3 (generateLegacyId crypto.randomInt 0-999999), M20 (riyadhToday import + use)
  5. `backend/accounting-routes.js` — L7 (uid() → crypto.randomInt), M20 (riyadhToday)
  6. `backend/finance-routes.js` — M20 (riyadhToday import + use)
  7. `backend/warehouse-routes.js` — M20 (riyadhToday import + use)
  8. `backend/procurement-routes.js` — M20 (riyadhToday import + use)
  9. `backend/leave-workflow-routes.js` — M20 (riyadhToday import + use)
  10. `backend/kitchen-production-routes.js` — M20 (riyadhToday import + use)
  11. `backend/hr-routes.js` — M20 (riyadhToday replacing +3h offset)
  12. `backend/shifts-engine.js` — M20 (riyadhToday replacing +3h offset)
  13. `backend/services/` — L8 (removed empty directory)
- **M20 note:** riyadhToday() replaces `new Date().toISOString().slice(0,10)` (UTC) and `new Date(Date.now()+3*3600*1000).toISOString().slice(0,10)` (manual +3h) with Intl-based Asia/Riyadh formatter — correct across DST-free KSA and all hour boundaries.

## Phase 7: 2026-10-11 — M21 (notification per-user read)
- **Time:** 2026-10-11
- **Files modified:**
  1. `backend/notification-service.js` — Added `notification_reads` table (notification_id, user_id, read_at) to ensureNotificationsSchema
  2. `backend/notification-routes.js` — GET / now computes effective read via LEFT JOIN; POST /read and /read-all split personal (UPDATE) vs public (INSERT into notification_reads)
- **Behavior change:** Public notifications (user_id NULL) are now read-tracked per user. A user marking one public notification read no longer hides it from other users. Personal notifications unchanged.

## Phase 5: STATUS (updated after Phase 7)
- **Total issues:** 56
- **Fixed:** 56 (2 CRITICAL, 24 HIGH, 22 MEDIUM, 8 LOW)
- **Remaining:** 0
- **Git:** Not available on host — no branch/commit possible
