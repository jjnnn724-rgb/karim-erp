# CONTRACT.md — Unified Multi-Device Real-Time (TASK 2)
Follows DISCOVERY_ARTIFACT.md. Principle: REUSE > EXTEND > CREATE. Zero regression.

## 1. What WILL change (path | nature | reason | blast radius)

| # | Path | Nature | Reason | Blast radius |
|---|---|---|---|---|
| C1 | `frontend/app/js/realtime.js` | EXTEND: subscribe `domain_event`; on connect/reconnect → `GET /rt/events?since=lastSeq` → apply → `POST /rt/ack`; backoff+jitter reconnect; resume caps | Closes gaps G1–G3,G9 (write-only channel, no resume) | Single file; old handlers kept during coexistence |
| C2 | `frontend/app/js/pos.js` | EXTEND: remove 2nd socket, reuse `window._rtSocket` | Gap G10 (dual sockets, stale chat hook) | POS tab only; guarded by existence check |
| C3 | `backend/server.js` (socket section only) | EXTEND: `io.use()` JWT-optional attach + `RT_REQUIRE_AUTH` flag (default false); per-event socket rate limits; stop emitting sensitive payloads to unauthenticated sockets | Gap G4 (R1) without breaking pre-login connect | Socket layer only; REST untouched; flag rollback instant |
| C4 | `backend/realtime/outbox.js` | EXTEND: flip `tryInsertDomainEvent` fail-open → fail-closed behind `RT_FAIL_CLOSED=true` (default false until verified) | Law 6/10, gap G11 | New inserts only; old rows unaffected |
| C5 | Producers (per module, each behind `RT_EVT_<MODULE>=true`): `kitchen-production-routes` `warehouse-routes` `hr-routes`+`zkteco/engine` `procurement-routes` `finance/cashier expenses` `pos-orders-history(void)` | EXTEND: `tryInsertDomainEvent` inside existing txn (same pattern as complete-sale.js:947) | TASK 9 catalog; coexistence with legacy emits (C5 dual-publish, removed per-module after verification) | Additive rows in txn; guarded try/catch per call |
| C6 | `backend/middleware/health.js` | EXTEND: `/ready` also fails when outbox publisher stale (>10s) or WS not accepting; expose `outboxLagSeconds` | TASK 8 | Additive checks; /live untouched |
| C7 | `backend/realtime/publisher.js` | EXTEND: dead-letter visibility (counter + last error in stats; no deletes) | Gap G12 observability | Stats object only |
| C8 | `backend/server.js` | ADD: `GET /api/rt/version` → `{compatible,minClientVersion,apiContractVersion}` (EXE handshake) | TASK 10 compat | New path only |
| C9 | `frontend/app/js/realtime.js` | ADD: offline action queue (flag-gated, chat/void-safe ops only) + connection badge states | Resilience | New code paths, default off |
| C10 | `backend/server.js` apiCache | FIX (after verification): vary cache key by role (or bypass for role-filtered lists) | R2 HIGH — verify bleed first with test | Cache key fn only |
| C11 | `electron/main.js` | EXTEND: `sandbox:true` on both windows (regression-tested) | Ops gap G8 | Window opts only |

NOT included (explicitly deferred): code signing purchase (LAW 11 — documented, needs cert),
Prometheus exposition, Zod rewiring, envelope unification, PM2-on-Windows, backup encryption.

## 2. What WILL NOT change (frozen)

All REST method+path+envelope; every DB table/column (042/067/068 intact); JWT/RBAC/API_KEY flows;
Electron packaging targets; backup/restore scripts behavior; ZATCA/payroll/tax math; existing
legacy emits (kept until per-module flag proves replacement, then removed one module at a time);
`register_user` flow (kept as fallback when no handshake JWT).

## 3. New DB objects

NONE. 067 already provides `event_outbox` (with `rt_event_seq`, pending/claim indexes),
`client_event_ack` (installation_id PK), `idempotency_keys`. TASK 3 = verify applied live;
if absent, apply 067 via standard runner (idempotent, IF NOT EXISTS). No new migration file
unless verification finds a gap (then 069 minimal + down script).

## 4. New API endpoints

| Method \| Path | Auth | Purpose |
|---|---|---|
| GET /api/rt/version | none (version probe) | EXE compat handshake |
(No other endpoints — /rt/events|ack|health, /health, /metrics all reused.)

## 5. WebSocket contract (existing transport, hardened)

- Transport: socket.io on same HTTPS origin; engine ping 10s/30s + app `ping_check` 5s.
- Auth: handshake `auth.token` (JWT, optional during coexistence) → `io.use()` verifies via
  existing `verifyAccessToken`, attaches `socket.data.user`; else anonymous with restricted
  subscription set. `register_user` retained as fallback (re-reads role/dept from DB).
- Envelope (reused publisher shape): `{eventId,sequence,eventType,eventVersion,occurredAt,
  aggregateType,aggregateId,branchId,target,payload}` on `domain_event`.
- Rooms (existing): `user:<id>` `role:<role>` `dept:<code>` (+ legacy `erp:all` only for
  explicitly public events). Server-computed `routing_metadata.rooms`; `authorizeEventForUser`
  enforced on live AND recovery.
- Heartbeat/backoff: reconnect exponential 1.5s→30s + jitter, infinite while tab open
  (replaces 10/20 caps); resume `since=lastSeq` (cap 200, else RESYNC_REQUIRED → full loadData).
- Rate limits (new, socket-level): register_user 10/min, broadcast_notification removed for
  anonymous, ping_check 30/min per socket.

## 6. Event catalog (ONLY real existing operations → outbox types)

| Outbox type | Source op (existing emit it replaces) | Rooms (deterministic fn) |
|---|---|---|
| SALE_POSTED | complete-sale (exists) | dept:<id> + permission sale.view |
| KITCHEN_ORDER_CREATED/STARTED/COMPLETED/CANCELLED | kitchen batches/exceptions | role:kitchen + dept:<code> |
| DISPATCH_* (created/approved/received/returned) | warehouse dispatches/returns | role:warehouse + dept:<code> |
| PURCHASE_CREATED/VOIDED, PAYMENT_CREATED/VOIDED | warehouse invoices + procurement payments | role:warehouse/accountant + supplier scope |
| INVENTORY_RECEIPT/ISSUE/ADJUSTMENT | receipts, transfers, audits, stocktaking | role:warehouse |
| EMPLOYEE_CLOCK_IN/CLOCK_OUT | zkteco/engine + attendance-engine | role:hr + user:<id> |
| EXPENSE_CREATED | finance/cashier expenses | permission revenue.view set |
| POS_ORDER_VOIDED | pos-orders-history void | permission sale.view |
| USER_PERMISSION_CHANGED | users/roles edit | user:<id> (force re-register) |
Payload rule: ids + totals + names only; never salaries, tokens, PII beyond display name.

## 7. New env vars (all optional, safe defaults)

`RT_REQUIRE_AUTH=false` · `RT_FAIL_CLOSED=false` · `RT_EVT_KITCHEN/INVENTORY/HR/PURCHASING/PAYMENTS/EXPENSES=false`
(defaults off → zero behavior change until flags flipped one by one)
`RT_RECONNECT_MAX_MS=30000` · `RT_OFFLINE_QUEUE=false`. Existing `RT_OUTBOX_*`, `RT_MAX_GAP_*` reused.

## 8. Performance SLA

20/100/500 concurrent sockets; 50/500/2000 events/min bursts; p95 delivery <500ms on LAN;
outbox claim cycle 500ms, lag <2s sustained, <10s warn, <60s critical; recovery page ≤200 rows;
client apply <100ms/event (id-indexed merge, no full render per event).

## 9. Rollback strategy per change

Every change flag-gated → rollback = env flip, no restart of DB. C3/C4/C5: flags default off.
C1/C2/C9: frontend `?v=` bump reverts by redeploying prior static bundle (server keeps old file
until overwritten — keep backup copy). C6/C7/C8: additive, removable in one commit.
No destructive migration (none planned). Numeric triggers: p95>1s for 5min / outbox lag>60s /
error rate>1% on /rt/* → auto-rollback to flags-off + legacy path (which stays functional).

## 10. Migration from polling (coexistence)

Phase A (this contract): legacy emits + polling stay; new channel runs shadow (subscribe+log, no UI
dependence) behind flags. Phase B: per-module flag on → client prefers domain_event, legacy kept
as fallback for 1 release. Phase C: remove legacy per-module emit + reduce polls (cashiers 30s→off
when socket live; DB-health 15s stays as independent probe). POS dual socket removed in Phase A
(single shared socket). No big-bang cutover anywhere.
