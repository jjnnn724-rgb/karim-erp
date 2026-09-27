# DISCOVERY_ARTIFACT.md — KARIM ERP Multi-Device Real-Time (TASK 1, read-only)
Date: 2026-09-27. No file modified during discovery. All refs `path:line`.

## 1. Architecture diagram (ASCII, as-built)

```
                    ┌──────────── PostgreSQL (sole authority, pg.Pool max 60) ────────────┐
                    │ app_state · users · employees · inventory(+ledger/balances)          │
                    │ pos_* · revenues/expenses · dispatches · purchaseInvoices · payroll  │
                    │ journal_entries/lines · chart_of_accounts · zatca_settings           │
                    │ event_outbox · client_event_ack · idempotency_keys (067)             │
                    └─────────────────────────────────────────────────────────────────────┘
                                              ▲   SQL only (clients never touch DB)
                                              │
                    ┌──────────── Node.js Express (backend/server.js, 1977 lines) ────────┐
                    │ REST /api/* (JWT + requireRole + crudLimiter + apiCache 10s)        │
                    │ + autoDbValidation + idempotency middleware (POST/PUT/PATCH/DELETE)  │
                    │ + Socket.io (ping 10s/30s, CORS unified, NO handshake JWT)          │
                    │ + outbox publisher (500ms SKIP LOCKED) + /api/rt/* recovery          │
                    │ + /live /startup /ready /health + /metrics (admin)                  │
                    └─────────────────────────────────────────────────────────────────────┘
                        ▲ HTTPS (mkcert LAN, :5000)        ▲ (same origin)
        ┌───────────────┴────────────┐        ┌────────────┴─────────────┐
        │ Browser SPA (vanilla ESM,  │        │ Electron EXE (universal, │
        │ realtime.js + pos.js = TWO │        │ role from login; thin or │
        │ sockets/tab, 5s ping, 15s  │        │ local-PG mode; NSIS+port.)│
        │ DB-health poll, full       │        │ Auto-update GitHub,      │
        │ loadData() on events)      │        │ UNSIGNED                 │
        └────────────────────────────┘        └──────────────────────────┘
```

## 2. Dependency graph (runtime)

`electron/main.js → (service|client) → backend/server.js → shared-pool(pool) → PostgreSQL`
`server.js → middleware/{correlation,security,hpp,idempotency,health,circuit} → routers/* → pool`
`server.js → realtime/publisher (io+pool) + realtime/recovery-routes`
`scripts/serve.js → verify-env + lan-cert + db-resolver + run-migration → backend/server.js (foreground, 50× restart)`
WinSW service alt path · PM2 only on aaPanel/Linux · Docker (bakes .env — gap).

## 3. API map (condensed; full table in discovery notes)

Mounts: `/api/hr`(hr+leave) `/api/warehouse`(4 routers) `/api/rt`(recovery) `/api/kitchen`
`/api/procurement` `/api/finance` `/api/accounting` `/api/notifications` `/api/zkteco`
`/api/yarasoft` `/api/oracle-data` `/api/yara-reports` `/api/system` `/api/whatsapp`
Cashier: `/api/auth/*` `/api/pos/*` `/api/orders/*` `/api/sales/complete` `/api/zatca/*`
Generic CRUD `GET/POST /api/:entity` (25 entities, paginated + X-Total-*).
Envelopes mixed: raw row | `{data,pagination}` | `{ok}` | `{error,message}`.
Idempotency-Key: global middleware on /api writes; `POST /sales/complete` requires key.
`x-api-key` enforced if set (except /health, /auth/*). Rate limits: general 100/min, auth 20/15min, crud 200/min.

## 4. DB schema map

Core (001): app_state, users, employees, inventory, dispatches, revenues, expenses,
purchaseInvoices, suppliers(+068 tax), payroll. Cashier (003): pos_*, shifts, zatca_settings(self-healing DDL).
Ledger (042): chart_of_accounts + journal_entries/lines (uq source). Infra (067):
`event_outbox(id,event_id UUID,sequence←rt_event_seq,payload JSONB,routing_metadata,target rooms,published_at,claim,attempts)`,
`client_event_ack(installation_id PK,user_id,last_sequence)`,
`idempotency_keys(key,user_id,endpoint,hash,response,status,expires)`.
Migrations 001–068 via run-migration.js + `.migrations_applied` lock (data dir). Dupes: 051×2, 060/061 theme.

## 5. Auth flow

Login `{username,password}` → bcrypt compare → access JWT HS256 24h `{sub,role,name,dept_code,sid}`
+ rotating refresh (SHA256 stored, 365d default) + `app_key`. `jwtAuth` (+120s active-cache, prod)
→ `requireRole(...)` → handler. First-login `must_change_password` gate (12+letter+digit, no reuse).
Self-recovery codes (6-digit, 10min, 5 tries). QR HMAC verify endpoint public by design.

## 6. RBAC matrix (summary)

Roles: admin, manager, cashier, auditor, warehouse, kitchen, hr, employee, accountant, dept_head.
Enforcement: `jwtAuth → requireRole → limiter`. Notables: payment-delete admin-only;
journal write admin/accountant; HR write admin/hr/manager; self-service (attendance, my-punches,
dept-panel, chat, rt/*) any-authenticated; manager cannot assign roles; salary masked by role;
sensitive reads (users/payroll/revenues/...) restricted; protected deletes (405) on ledger-ish entities.

## 7. Real-time current state

Socket.io, NO handshake JWT. Identity via post-connect `register_user{userId}` re-read from DB →
rooms `user:<id> role:<role> dept:<dept>`. Outbox: 1 producer (`SALE_POSTED`, fail-open), publisher
500ms claim/broadcast `domain_event` to `routing_metadata.rooms`. Recovery `GET /rt/events?since`
+ `POST /rt/ack` + `/rt/health` exist, JWT-gated — **never called by any client**.
Legacy emits all GLOBAL: `entity_changed`, `sale:completed` (dual dept+global), `state_updated`,
`attendance:updated`, `biometric:*`, `yarasoft:*`, `whatsapp:*`, chat→user rooms (targeted ✓),
notifications→user rooms (✓). Frontend: 2 sockets/POS tab, 5s ping, 15s DB poll, 30s cashiers poll,
fixed 1.5s reconnect (10/20 caps), full `loadData()` on events, no sequence/ACK/resume.

## 8. Frontend map

Vanilla ESM (`main.js` bridge → window), pages: dashboard/cfo/revenues/expenses/pnl/departments/
warehouse/procurement/kitchen/dispatch/recipes/reports/settings/users/HR suite/attendance/zkteco/
yarasoft/oracle/whatsapp/portal/payroll + POS. State: global `STATE` + `loadData()` full refresh;
`entity_changed` merges by id. No framework, no WS lib beyond socket.io client, no offline queue.

## 9. Risk register

R1 Unauthenticated sockets receive global broadcasts (sales totals, attendance, devices). HIGH.
R2 GET apiCache 10s keyed by URL only — cross-role bleed possible. HIGH (verify first).
R3 Unsigned EXE + unverified auto-update = tamper chain. HIGH (needs cert purchase — code can't fix).
R4 Fail-open outbox masks missing events; single producer; MAX 20 attempts then abandoned. MED.
R5 Dual POS sockets double counts/traffic; stale chat hook. LOW-MED.
R6 No restore drill/monitoring/PM2-Windows/sandbox:true/PII redaction narrow/.env in image. OPS-MED.
R7 Envelope inconsistency (4 shapes) — client must keep tolerating. LOW.
R8 Migration lock in data dir; prefix dupes. LOW.

## 10. Open questions (need owner)

Q1 Downtime window for restarts? (Backend changes need `Karim-RESTART.bat`; static files don't.)
Q2 Code-signing cert (OV/EV) budget/timeline? (Blocks LAW 11 fully.)
Q3 Fail-closed outbox flip approved after verification? (Recommended: yes.)
Q4 Enforce socket handshake JWT (kicks anonymous viewers) or keep coexistence? (Recommend: enforce with grace.)
Q5 Monitoring target (none/Grafana/other) + alert channel for lag/backup/503?
Q6 POS second socket removal approved? (Recommend: yes, single socket/tab.)
