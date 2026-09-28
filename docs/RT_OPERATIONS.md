# RT_OPERATIONS.md — Real-Time layer runbook (TASK 12, operator guide)

## 1. What runs where

- Publisher: in-process `setInterval(500ms)` started once from `server.js` (single Node process).
  Multi-process: safe via `SKIP LOCKED` + 30s claim lease (duplicate wakeups only).
- No new ports/processes. Static frontend needs no restart; backend changes need `Karim-RESTART.bat`.

## 2. Feature flags (all default OFF = legacy behavior)

| Flag | On means | Rollout order |
|---|---|---|
| `RT_EVT_KITCHEN / DISPATCH / PURCHASE / INVENTORY / HR / EXPENSE / PAYMENT` | write outbox row in business txn | one module/week, watch lag |
| `RT_REQUIRE_AUTH` | sensitive socket emits → `erp:authed` only | after all daily clients refreshed (v169+) |
| `RT_FAIL_CLOSED` | outbox insert failure aborts txn | only after 2 weeks clean dead-letter=0 |

## 3. Monitoring (5-minute setup, no new infra)

- LB probes: `/live` (process), `/startup` (boot), `/ready` (DB+outbox+WS; 503 removes node).
- Daily human check: `GET /api/rt/health` (JWT) → `publisher.deadLettered` must be 0,
  `outboxLagSeconds` < 2. SQL: `SELECT COUNT(*) FROM event_outbox WHERE published_at IS NULL;`
  and `... AND attempts >= 20` (dead letters — investigate, never delete).
- Alerts (manual until monitoring exists): lag>10s warn, >60s critical; backup status file
  `database/backups/daily-backup-status.json` must be `ok` and fresh (<26h).

## 4. Backup & recovery (uses existing system)

- Daily 02:00 Task Scheduler (`DailyBackup.bat`, 30 retention, SHA-256 sidecars).
- Restore drill (monthly, mandatory): `node database/scripts/restore.js <file> --target-db karim_restore_test --yes`
  then `SELECT COUNT(*) FROM event_outbox` + app smoke. Record result in this file's log below.
- DB lost: restore latest verified backup → outbox rows come back with it → publisher resumes
  (claims expire via lease). Clients auto-resume via `/rt/events?since=`.

## 5. Upgrade / rollback

- Server: deploy files → `Karim-RESTART.bat` → check `/ready` 200 → spot-check POS sale + chat.
- Client: static files versioned (`?v=`); rollback = redeploy prior bundle (keep one backup copy).
- Flags rollback: unset env → restart (or `POST /api/system` restart if available).
- Rollback triggers: p95>1s 5min · lag>60s · /rt/* errors>1% · any failed acceptance below.

## 6. Acceptance after every restart (2 minutes)

1. `/api/health` 200 + database ok. 2. `/ready` 200. 3. POS test sale appears on manager screen.
4. Disconnect network 20s → reconnect → badge back to connected, no duplicate sale on refresh.
5. `POST /api/rt/ack` 200 (auth). 6. Backup status file fresh.

## 7. Known limitations (honest)

- No code signing yet (needs OV/EV cert purchase) — auto-update unverified.
- Offline action queue not built (flag reserved) — offline devices read-only until reconnect.
- Fail-open outbox until G2 verification (logged, metered via deadLettered).
- Legacy global emits remain until per-module Phase C removal.
- `sandbox:true` not set on Electron windows (needs EXE smoke test).

## 8. Restore-drill log

| Date | Backup file | Test DB | Result | By |
|---|---|---|---|---|
| _pending first drill_ | | karim_restore_test | | |
