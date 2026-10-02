# KARIM ERP — DISCOVERY REPORT (Phase 1 · V6.0 Master Prompt)
Date: 2026-09-30 · Mode: READ-ONLY · Files modified: NONE
Repo: `C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp`
Runtime here: Node v26.3.0 · engines: `node>=18.0.0` · ORM: raw SQL (`pg`, no ORM) · Frontend: vanilla ESM + window bridge · Tests: `npm test` · Build: `npm run build` (both exist)

## 1. Architecture
Single Express process. Attendance writes converge on `AttendanceEngine.processPunch` (backend/attendance-engine.js:342) except QR scan (own txn, hr-routes.js:391). Async: BullMQ OPTIONAL everywhere (`SKIP_BULLMQ` default true); SQL tables are source of truth + embedded pollers. Outbox transactional (`realtime/outbox.js:36`) + publisher (SKIP LOCKED, `realtime/publisher.js:40`). Emits AFTER COMMIT (verified: complete-sale.js:972-1014, attendance-engine.js:437-441; HR domain events inside txn pre-commit by design, fail-open). Graceful shutdown wired (graceful-shutdown.js:94).

## 2. Attendance
- **Source of truth: FIXED shift per employee** — `employees.shift_start/shift_karim` (040, 045; defaults 09:00/10). Per-day schedule tables were DELETED (086_drop_shift_schedules.sql). `getEmployeeShift` reads fixed columns only (attendance-engine.js:299-333).
- **Calculator (owner rule: complete your 10/12h, zero grace):** `calculateDelayDetail` (engine:228) + duplicate `calculateDelayParts` (shift-day.js:181). `graceMinutes()` always 0 (shift-day.js:156, owner decision). Late=arrival>0; deficit=max(0, required−worked) with overnight +1440 normalization; open day judged on close. Overtime ONLY in payroll when `includeOvertime=true` (hr-routes.js:529, default off).
- **Classifier:** `classifyPunch` (engine:141): 5-min same-direction ignore; open-row close; shift-window zones ±120/±60 IN, ±180/±90 OUT; pattern median from 30 rows; fallback `out` 0.5 for review. Reconcile (hourly/on-demand): orphan-log linking, IN/OUT swap fix, missing-IN/OUT recovery, inferred→real upgrade, all with Arabic audit notes (engine:638-863).
- **Punch paths:** ZKTeco TCP pull → portal/geofence+face → HTTP push (Bearer) → QR scan. All → `processPunch`, except QR (direct toggle).
- **Leave:** `isOnLeave` checks approved `leaveRequests` range (engine:324); stored on `attendance.on_leave` — **no migration creates it** (deploy-order risk).

## 3. Scheduling
- Per-day tables GONE. **Leftover active override:** `shifts-engine.js` (bulk `UPDATE employees SET shift_start/shift_karim` via free text + `/hr/shifts/apply`, hr-routes.js:962) — mutates fixed columns, no per-day rows, no approval.
- `day_off` column (070) is **never read** by engine (0 refs). No holidays table (0 hits). Friday-off only via optional `skipFridays` in deductions.
- No overrides/ranges/versions/snapshots exist. Resolver capability = CREATE (or keep fixed-shift).

## 4. Work-date / TZ — CONFLICT
Canonical `Asia/Riyadh` (+3h manual offsets: engine:26,72; portal:250; push:91; zkteco/engine:32). Overnight carryover behind `ATTENDANCE_SHIFT_DAY_MODE` (prod `.env:38` = on) + `crossesMidnight` guard (shift-day.js:125). **CONFLICT:** `zkteco/routes.js:106,360,552,558` use `Africa/Cairo` for today-counters while same file uses Riyadh at :488 — off-by-day risk. (Prompt context says Cairo; code says Riyadh — needs owner decision.) `cairoNow` var (engine:659) is actually Riyadh — rename.

## 5. Payroll
Tables: `payroll` (no UNIQUE emp+month), `payroll_runs` (PK=month), `salary_advances`, `payroll_adjustments` (kind CHECK), `advance_applications` (UNIQUE advance+month, idempotent). Generator (hr-routes.js:512): salary/30/hours hourly, optional OT, adjustments, advance instalments, always `status=posted`. Ledger post `6000 DR/2200 CR` idempotent (accounting-routes.js:473). **GAP (BLOCKING for any rebuild): `payroll-runs/generate`, generic payroll CRUD, and `deductions/apply` have NO closed-period check** — regenerating a closed month overwrites rows; only ledger replay is protected (423/409). Zod schemas for payroll/leave are stale (snakeCase + statuses never used).

## 6. Leave / Holiday
4-stage workflow (`direct→ops→GM→hr`, leave-workflow-routes.js:6) with `FOR UPDATE` + 409 anti-double-approve, no self-approval (admin exempt). Tables runtime-created (absent from migrations/ — fresh DB gap). No holiday calendar. Unpaid types pay same as paid for attendance purposes. `returned` vs `cancelled` mismatch with Zod.

## 7. Auth
JWT 24h + rotating refresh (SHA-256 stored, 365d), bcrypt-only (non-bcrypt → 401 + migration script), strength ≥8+letter+digit, cost 12, placeholder-secret fatal in prod. Roles (10): admin/manager/cashier/auditor/warehouse/kitchen/hr/employee/accountant/dept_head. **CONFLICT: `auditor` missing from frontend menus** (config.js) — can auth, no UI. Scoping: `dept_code` only; **no branch isolation** (no branch_id anywhere). IDOR guards verified on attendance/leave/portal/zkteco-my-punches. Permissions: role + additive grants, deny-first (permissions.js:149).

## 8. Realtime
socket.io, JWT handshake, rooms user/role/dept, rate-limited, `RT_REQUIRE_AUTH` default off. Contract version endpoint + client warn-only. **ZKTeco emits (`biometric:*`, `attendance:updated`) bypass rooms/auth (bare `io.emit`)** — inconsistent with scoped doctrine.

## 9. ZKTeco — VERIFIED: TCP PULL, not ADMS
pyzk-faithful client (`net.createConnection`, port 4370, CMD 1000/1102/13...; protocol.js cites pyzk Section 24). 5s tick, per-device interval/backoff (30s×2ⁿ cap 10m), identity proof (`NOT_ZK_DEVICE`), `device_sync_state` checkpoint AFTER inserts, 72h reprocess window + unique `(deviceId,deviceUserId,attendanceTime)` + 60s push sliding dedup. Mapping: deviceUserId→employee, clash 409, auto-link, unmapped top-100 visible. HTTP push channel is separate generic ingress (not ZK ADMS). Unknown: fleet models/firmware, device TZ config, Redis liveness, `RT_EVT_HR` flag.

## 10. DB
Raw `pg` pool (60/5). Runner `run-migration.js` (lockfile, demo-skip, tolerates exists). Numbering 001→086 (89 files). Seed admin `__SETUP_PENDING__` (no usable default). `attendance.on_leave`, `leave_approval_*` have no migration files (runtime/implicit DDL — drift risk).

## 11. API
Full inventory verified: `/api/auth/*`, `/api/attendance/range|portal/*`, `/api/v1/attendance/push|status|devices/:id/token`, `/api/zkteco/*` (READ admin/hr/manager/accountant, WRITE admin/hr), `/api/hr/leave-workflow*|attendance/*|shifts/*|payroll-runs/generate|deductions/*`, `/api/payroll*|salary_advances|payroll_adjustments` (generic CRUD), `/api/pos/shifts/*` (**separate cashier-session concept — name collision**), `/api/rt/*`.

## 12. Frontend
Vanilla ESM, `main.js` static core + `safeBridge` per feature + `__karimReady` gate + lazy login binding. Attendance UI: hr.js (dashboard/attendance/leave/payroll/shifts-apply), employee-portal.js, zkteco.js, mobile-shell.js (PWA punch), settings-users.js (punch admin). All via `apiFetch` (JWT+appKey, 30s, 429-retry, 401-refresh).

## 13. Duplication / Conflicts
1. `classifyPunch` (live) vs `attendance-brain.js` (legacy? — confirm dead). 2. `calculateDelayDetail` vs `calculateDelayParts`. 3. Grace 0 vs `recomputeDerived(graceMin=10)` rewriting `late`. 4. Cairo vs Riyadh reads. 5. `pos_shift_sessions` vs HR shifts (name collision). 6. Push naked `ON CONFLICT DO NOTHING` (no target). 7. Stale `schema-registry` shapes (`payroll_runs`) + stale Zod. 8. `openRowCheckIn` dead param. 9. Triple push consumers (worker+embedded+BullMQ) safe only via atomic claim. 10. Concurrent payroll-generate can double-INSERT (no UNIQUE). 11. Salary shown in portal but masked by API for non-elevated.

## 14. Reuse Map (for Phase 2)
Reuse: processPunch pipeline, reconcile, dedup layers, TCP engine, outbox/publisher, leave workflow locking, period-lock infra, portal verdict chain, monthly query shapes. Extend: employees fixed-shift columns, ai-draft pattern logic (deleted module — logic lost, rewrite). Create: schedule resolver + overrides/ranges/versioning/snapshots, holiday calendar, closed-payroll guard. Refactor safely: unify calculators, fix TZ reads, explicit conflict targets. Block: ADMS claims, touching closed payroll, breaking push/portal APIs.

## 15. Risks
Closed-month payroll overwrite (no guard); TZ day-boundary miscounts; grace-rule divergence on recompute; double payroll rows under concurrency; DDL drift (on_leave, leave tables); triple-consumer DB churn; global biometric emits leaking across roles; auditor role UI-less; demo-seed uncertainty.

## 16. UNKNOWN (needs runtime/owner)
Fleet models+firmware; device TZ; Redis liveness; live punch_settings + geo coords; MIGRATION_LOCK/demo-seed state; JWT secrets configured; `RT_EVT_HR`; `ATTENDANCE_DELAY_ENGINE=false` + `AUTO_COMPLETE=false` intentional permanence; Friday/holiday policy; unpaid-leave pay rule; `returned` vs `cancelled`; `month-28` posting; Date.now() PK collisions.

## 17. BLOCKING (need owner answers before Architecture)
1. **TZ of record: Riyadh (code) or Cairo (prompt)?**
2. **Closed payroll: must regenerate/CRUD be blocked for closed `accounting_periods`/fiscal year?**
3. **Source of truth going forward: keep fixed-shift only, or rebuild dynamic schedules (overrides/ranges/versions)?**
4. **ZKTeco fleet protocol: pure TCP pull for all devices? Any ADMS/push device?**
5. **Grace policy: confirm permanent 0 (and fix `recomputeDerived(10)`)?**
