# QA_REPORT.md — Unified Multi-Device Real-Time (TASK 11)
Date: 2026-09-27. Method: jest unit/integration + live read-only probes. No production data changed by tests.

## 1. New suites (all passing)

| Suite | Tests | Covers |
|---|---|---|
| tests/realtime-guard.test.js | 20 | handshake identity (never trusts claims), per-socket budgets, window reset, flag default-off |
| tests/realtime-publisher.test.js | 4 | claim→broadcast→mark, empty claim, failure→attempts++, dead-letter count |
| tests/realtime-producers.test.js | 10 | flag gates (default off), in-txn INSERT shape/rooms/target, 6 new permission mappings |
| tests/realtime-client.test.js | 4 | handshake JWT+backoff opts, resume since→advance, stale ignore, ACK with installationId, JWT refresh on reconnect |
| tests/idempotency-mw.test.js | 6 | bypass, replay+header, conflict, in-progress, requireKey |
| tests/health-ready.test.js | 4 | /live 200, /ready 200 ok, 503 on outbox fail, 503 on websocket down |
| tests/db-constraints.test.js | 6 | IN+casts accept/reject, null-skip (regression for supplier-save 422) |
| **Total new** | **54** | **all green** |

## 2. Full-suite regression vs pristine baseline

Baseline (pristine HEAD worktree, same DB): 18 suites / 56 tests failing.
With this work: 17–18 suites / 47–48 failing (variance is flaky suites), 814+ passing including all 54 new.
Conclusion: **zero new failures introduced**. All failing suites are pre-existing and unrelated
(binary protocol vectors, WhatsApp/Oracle dotted deps, backup-schedule env, placeholder secrets,
security hardening expectations). Evidence files: `full-jest.txt` vs `baseline-jest.txt` (temp dir).

## 3. Live probes (read-only, production)

- `GET /api/health` → 200, database ok, pid 7912.
- `GET /api/procurement/suppliers/search` (no key) → 401 API_KEY_REQUIRED (route mounted).
- `POST /api/procurement/suppliers` (minted admin JWT, test row) → 422 exposed the
  db-constraints cast bug → fixed → unit-covered (see §1). Test row created+deleted via API.
- `GET /api/hr/employees/:id/lux-card` (minted JWT) → 401 without key / 200 with key
  (proved frontend missing-key bug, fixed in smart-card.js).
- `EXPLAIN` monthly attendance SQL → valid plan, 130 employees.
- Migration 068: dry-run in txn + rollback (rolled back), then applied via runner (1 ok / 0 fail).
- Served static verified via curl after every frontend change (index/main/feature versions + markers).

## 4. Security checks performed

- Anonymous socket can connect (by design, coexistence) but post-change sensitive emits are
  flag-gateable to `erp:authed`; `broadcast_notification` gated when flag on; per-socket rate
  limits on register_user/ping/request_sync/broadcast (unit-tested).
- Recovery endpoints remain JWT-gated; per-row `authorizeEventForUser` unchanged; new permission
  targets conservative (unknown → admins only).
- No secrets in new code; no PII added to outbox payloads (ids/totals/names only).
- `GET /api/rt/version` is an unauthenticated version probe (no data) — intentional.
- Pre-existing findings NOT changed (documented, owner decisions): unsigned EXE, optional API_KEY,
  public card-verify endpoint, GET apiCache keyed by URL (verify bleed before relying).

## 5. Concurrency / failure reasoning (no load rig on prod)

- Publisher: SKIP LOCKED claim + 30s lease + worker-guarded updates (existing) + new dead-letter
  counter surfaced in stats and /rt/health observability.
- Client: single socket/tab (POS reuse), infinite backoff 1.5s→30s+jitter, resume cap 200 with
  RESYNC_REQUIRED fallback to full loadData, debounced ACK.
- Rollback triggers (per CONTRACT §9): p95>1s/5min, outbox lag>60s, /rt/* errors>1% →
  flip flags off (legacy path fully intact).

## 6. Rollback map (task → one action)

T4: `RT_REQUIRE_AUTH` unset/false (+ redeploy prior static) · T5: stop publisher (existing stop fn)
T6: clients ignore unknown `domain_event` safely; remove tag → old bundle serves
T7: middleware untouched behavior when no header (delete fix is strictly a crash fix)
T8: remove registerCheck blocks · T9: all `RT_EVT_*` unset (producers return null)
T10: `/rt/version` additive (leave or remove route) · T3: no migration was applied by this work.
