# KARIM ERP V3 Release Report

**Date:** 2026-11-12

**Scope:** POS product imagery and cashier kiosk, reporting/accounting, Arabic RTL printing, Saudi compliance readiness, and final release verification.

## Final closure verification — 2026-11-12

- **Compliance automation:** Added a Riyadh-time daily worker for residency/contract reminders, manually configured ZATCA due dates, and a posted-ledger integrity check. It uses a PostgreSQL advisory lock, deduplicates alerts, checks every posted entry (including entries with fewer than two lines), and reports up to 100 detailed anomalies while counting all anomalies.
- **Activation boundary:** The worker starts only after migration 148 has created its tables. Migration 148 has not been applied to production; therefore this worker is **not active on the live domain**.
- **SIF limitation:** Automatic SIF generation is not implemented. The repository confirms that the bank-specific SIF template is missing; the existing CSV is only a human-review WPS file. Do not upload it as SIF. An official bank template and validation are required first.
- **ZATCA limitation:** Reminder dates are manual entries with an official reference; there is no management UI and no statutory date is inferred automatically.
- **Checks:** V3 typecheck and production build passed; V3 tests passed (955 tests in 145 files); public desktop/mobile E2E passed (6/6); V3 bundle budget passed (718.6 KiB total JS gzip, 55.9/60 KiB total CSS gzip). Targeted compliance/VAT Jest tests passed (8/8) without connecting to a database. Root TypeScript/strict TypeScript and targeted ESLint passed.
- **Remaining lint gate:** The repository-wide ESLint gate still fails on 17 existing errors and 14 existing warnings outside this change set (including `attendance.js`, the legacy V3 preview/announcement scripts, and utility/test files). Generated V3 bundles are now excluded from ESLint. These unrelated source issues were not silently baselined or changed.
- **V3 formatting gate:** Full Biome check reports 745 errors, 175 warnings, and 6 informational findings across 594 workspace files. Focused Biome checks pass on the 20 changed V3 files; existing repository-wide formatting debt was not bulk-rewritten.
- **Live read-only checks:** `https://karimeg.online/api/health` returned HTTP 200 and reported healthy database/realtime components, app version `4.9.2`, and `commit: null`. A hostile `Origin` received no `Access-Control-Allow-Origin` header. The live V3 response reports asset version `4.9.312`; the candidate source tree is at `4.9.297`, so this candidate must not replace production until the version/source divergence is reconciled.
- **Live CSP issue:** A fresh `/v3/employees` load showed Cloudflare injecting an inline challenge-platform bootstrap that the strict `script-src 'self'` policy blocks. This is an edge/dashboard injection, not an inline script in the V3 source. The V3 page still rendered, but the live CSP issue remains unresolved and must be cleared before production sign-off.
- **Deployment:** No production database was accessed, no migration was applied, and no deployment was performed. The workflow's release-preparation job is manual by design and only runs on pushes to `main`; pushing the release branch alone will not deploy or create that verified release bundle. Use an approved release window, create a source ZIP from the verified commit (not the Electron `.exe`), calculate SHA-256, then run `scripts/update-production.ps1` as Administrator. That script requires valid `pg_dump`/`pg_restore`, takes a backup, and deliberately leaves services stopped for manual recovery if a migration or later step fails.
- **Current disposition:** **NOT READY for production deployment** because of the version/source divergence, unresolved live CSP injection, unapplied migration, and red repository lint gate. No production readiness claim is made.

## Delivered

- POS product imagery is bound to the image URL on the corresponding product record. Missing or
  broken images render a branded placeholder; no random-image fallback is used.
- Cashier-role sessions receive a full-screen, touch-friendly kiosk shell and are directed to
  `/pos-entry`. Admin/accountant and other non-cashier roles retain the existing shell.
- The reports screen now includes role-filtered links to existing sales, finance, inventory, and HR
  reporting surfaces.
- The P&L screen retains its operational multi-source report and adds a clearly distinguished
  official P&L sourced from posted general-ledger entries.
- Trial balance and official financial statements report unbalanced posted-entry counts.
  Balance-sheet totals now join only posted journal lines; entries with fewer than two lines count
  as unbalanced.
- Print documents include company identity, report title, date, configured branch name, current
  user, timestamp, Arabic RTL layout, and browser page counters. Existing print hiding and repeated
  table headers remain enabled.

## Verification evidence

| Check                        | Result                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| V3 unit suite                | Latest: 955 tests in 145 files (passed)                                                                          |
| V3 TypeScript check          | Passed                                                                                                           |
| V3 production build          | Passed                                                                                                           |
| Bundle budget                | Latest: entry JS 204.1 KiB; total JS 718.5 KiB; total CSS 55.9/60 KiB; max chunk 204.1 KiB (gzip)              |
| Targeted ESLint              | Passed for modified backend JavaScript and the added backend test                                                |
| Prettier                     | Passed for changed V3 TypeScript/CSS files and the added backend test                                            |
| Financial-engine mock checks | Passed: posted-only joins and integrity result behavior                                                          |

## Warnings and limits

- Vite still warns that a minified JavaScript chunk exceeds 500 kB raw. The gzip entry, total-JS,
  CSS, and maximum-chunk budgets all pass. A dependency comment-annotation warning is also emitted
  during bundling.
- A Jest regression test for the financial statement engine was added but not executed through the
  repository Jest command: its global setup requires an explicitly provisioned disposable database
  named `karim_erp_test`. No database was created or accessed to bypass that guard.
- No production database, deployment, or authenticated production workflow was run for this change
  set. Read-only health/CORS/CSP checks and public E2E were performed as described above.
- The reporting hub is a permission-filtered directory of existing report surfaces, not a new
  arbitrary report builder. Coverage and data availability remain dependent on the underlying report
  endpoints and role permissions.
- This report does not certify the full ERP, inherited commits, or unrelated worktree changes for
  production migration.

## Prior published baseline

The earlier POS/report/print baseline commit `91f119c259738d6ee188fdd0fbbae99f9f99fea9` was pushed
normally (no force) to `origin/release/v3-masterpiece`; the branch also contains the Cloudflare
dashboard change-record commit `15ebe7ac`. This historical push did not deploy production and is
not the final candidate described above.
