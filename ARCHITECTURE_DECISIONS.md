# KARIM ERP — ARCHITECTURE DECISIONS (Phase 2 · V6.0 Master Prompt)
Date: 2026-09-30 · Basis: DISCOVERY_REPORT.md · Files modified: NONE (this phase)
Owner delegated judgment with constraint "does not break the server". Assumptions below are marked and reversible.

## Decisions per capability (exactly one each)

| # | Capability | Decision | Evidence | Change | Impact / Rollback |
|---|---|---|---|---|---|
| 1 | Schedule resolver | **REUSE** fixed-shift (`employees.shift_start/shift_karim`) | attendance-engine.js:299-333, 040/045 | None. No dynamic rebuild (owner deleted schedules twice; scope discipline) | None. Reversible anytime |
| 2 | Overrides / rosters / ranges | **BLOCKED** (absent by owner decision) | 086 deleted tables; shifts-engine bulk apply stays as-is (not extended) | None | — |
| 3 | Attendance calculator | **REUSE** (no unification this phase) | engine:228 vs shift-day.js:181 identical formula | None — unifying risks reports; documented only | None |
| 4 | Snapshots / versioning | **BLOCKED** (no schedule entity to version) | — | None | — |
| 5 | Raw-event immutability | **REUSE** (verified) | dedup_key unique 078:43; logs unique 038:48; ON CONFLICT DO NOTHING | None | None |
| 6 | ZKTeco dedup/mapping/worker | **REUSE** | client/engine/schema verified Phase 1 | None (explicit naked-conflict target = optional later) | None |
| 7 | Payroll locks | **CREATE** guard (fail-open if controls down) | Gap verified: generate has no period check (hr-routes.js:512) | Block writes to closed periods (423 PERIOD_LOCKED) on: generate, deductions/apply, generic payroll CRUD | Only fires on closed periods; revert = delete guard |
| 8 | Leave/holiday conflicts | **REUSE** (no holiday calendar — owner never defined one) | leave-workflow-routes.js | None | None |
| 9 | Approval workflow | **REUSE** (FOR UPDATE + 409 verified) | leave-workflow-routes.js:154-173 | None | None |
| 10 | Concurrency | **REUSE** + document (payroll double-insert risk stays, out of safe scope) | 048:56 vs payroll no-UNIQUE | None | None |
| 11 | Audit | **REUSE** | §3 of Discovery | None | None |
| 12 | Outbox / realtime | **REUSE** (no rescope of biometric emits — would break listeners) | publisher.js:46-84 | None | None |
| 13 | APIs | Preserve all (no renames, no shape changes) | §11 of Discovery | None | None |
| 14 | Frontend bindings | Preserve all | main.js bridge verified | None | None |
| 15 | Security scope | **REUSE** (no branch model — not invented) | No branch_id anywhere | None | None |
| 16 | TZ reads | **REFACTOR SAFELY**: 4 Cairo reads → Riyadh | zkteco/routes.js:106,360,552,558 vs :488 | Read-only queries only | Revert = 4 lines |
| 17 | Grace policy | **REFACTOR SAFELY**: `recomputeDerived` default 10 → 0 | Owner: grace always 0 (shift-day.js:156) | Default param only | Revert = 1 line |

## Owner-judgment assumptions (BLOCKING answers decided, reversible)
1. TZ of record = **Riyadh** (code 95% Riyadh; Cairo only in 4 read queries). 2. Closed payroll writes = **blocked** (consistent with 079 locks). 3. Schedules = **fixed only**. 4. Fleet = **TCP pull only** (no ADMS evidence; ADMS claims BLOCKED). 5. Grace = **permanent 0**.

## Rejected designs
Duplicate resolver/calculator (chosen REUSE, no second engine) · mutable raw events (untouched) · global cache flush (none exists) · event-before-commit (already correct) · branch scoping (not invented) · dynamic schedule rebuild (scope; owner deleted twice).

## Migrations / breaking risk
MIGRATIONS_REQUIRED: NO · BREAKING_CHANGE_RISK: NO (guards fire only on closed periods; TZ fix aligns reads to canonical; defaults only) · Files/phase: ≤6.
