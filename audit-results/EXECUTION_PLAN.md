# EXECUTION_PLAN — Karim ERP Audit

## Priority Order

### Phase 1: CRITICAL (fix first — system-breaking bugs)
1. **C1** — `attendance-engine.js:667` — `autoLock` out of scope → every punch lost
2. **C2** — `password-vault.js` — vault key from JWT secret (design, needs env var)

### Phase 2: HIGH SECURITY (data exposure / auth bypass)
3. **C3** — `server.js` — read-gate mismatch: 5 payroll entities ungated
4. **C5** — `whatsapp.js:347` — stored XSS (JWT exfiltration)
5. **C6** — `server.js` — API cache bypasses auth
6. **C14** — `startup.js` — predictable JWT secret in non-production
7. **C21** — `media-storage.js` — path traversal on write

### Phase 3: HIGH BUGS (data integrity / correctness)
8. **C10** — `server.js` — `fs` scope → sw.js broken
9. **C13** — `jwt-middleware.js` — refresh rotation race
10. **C16** — `attendance-engine.js` — 23505 handling on punch insert
11. **C20** — `accounting-growth.js` — AP aging bucket wrong
12. **C23** — `hr-routes.js` — `next(e)` undefined → 4 handler crashes
13. **C18** — `veg-requests-routes.js` — double charge race
14. **C19** — `veg-requests-routes.js` — double charge on price

### Phase 4: HIGH PERFORMANCE / STABILITY
15. **C7** — `server.js` — 50MB JSON parser pre-auth
16. **C26** — `hr-routes.js` — spawnSync blocks event loop
17. **C17** — `attendance-engine.js` — PK collision handling

### Phase 5: MEDIUM FIXES (batch)
18. **M1-M22** — grouped by file

### Phase 6: LOW FIXES (if time permits)
19. **L1-L8**

---

## Fix Strategy

- Each fix = separate commit with clear message
- No API contract breaks
- No data deletion
- Test after every 5 fixes
- DB schema changes require backup first

## STOP CONDITIONS
- Migration needed → PENDING
- Business logic unclear → PENDING
- Data deletion required → PENDING (forbidden)
- Test fails twice → rollback + PENDING
