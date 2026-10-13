# PENDING — Items Not Completed

## Blocked by Environment
| ID | Issue | Reason |
|---|---|---|
| GIT-1 | Git branch + commits | Git binary not installed on host (searched C:\Program Files, LOCALAPPDATA — not found). All fixes applied to working tree directly. |
| GIT-2 | PR creation | Requires git + GitHub CLI |

## Requires Business Decision
| ID | Issue | Question |
|---|---|---|
| BIZ-1 | C2 — password vault key from JWT secret | Need dedicated VAULT_KEY env var. Should I generate one and add to .env, or is the current design intentional? |
| BIZ-2 | C8 — /uploads without auth | Should uploaded media (signatures, photos) require auth? This would break direct URL access from browsers. |
| BIZ-3 | C17 — Date.now()*1000 PK collisions | Should I migrate to DB sequences (requires schema migration + backup) or keep hand-rolled IDs with better collision handling? |
| BIZ-4 | M20 — Timezone adoption | riyadh-date.js is correct but bypassed in 8+ files. Full adoption requires coordinated changes across attendance, inventory, veg-requests, shifts, accounting. |

## Requires DB Migration (with backup)
| ID | Issue | Migration Needed |
|---|---|---|
| DB-1 | C17 | Replace hand-rolled BIGINT PKs with sequences/IDENTITY |
| DB-2 | C4 | Create sanitized test fixture dump (schema-only or anonymized) |
| DB-3 | M22 | Pool re-initialization after restore |

## Deferred (Medium Priority)
| ID | Issue | Reason |
|---|---|---|
| M3 | Logger rotation | Needs pino transport config change — lower priority |
| M4 | Graceful shutdown logger | Needs options restructuring |
| M7 | shifts-engine recomputeDerived | Full-table UPDATE — needs careful filtering |
| M10 | WhatsApp require.cache purge | Needs module caching strategy |
| M21 | Notification global read flag | Schema change (per-user read tracking) |
