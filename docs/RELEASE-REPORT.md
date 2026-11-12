# KARIM ERP V3 Release Report

**Date:** 2026-11-12

**Scope:** POS product imagery and cashier kiosk, reporting/accounting, and Arabic RTL print engine.

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
| V3 unit suite                | Passed: 932 tests in 140 files                                                                                   |
| V3 TypeScript check          | Passed                                                                                                           |
| V3 production build          | Passed                                                                                                           |
| Bundle budget                | Passed: entry JS 203.8 KiB gzip; total JS 702.8 KiB gzip; total CSS 51.1 KiB gzip; 100 JS files and 27 CSS files |
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
- No production database, live API, deployment, or browser E2E run was performed for this change
  set.
- The reporting hub is a permission-filtered directory of existing report surfaces, not a new
  arbitrary report builder. Coverage and data availability remain dependent on the underlying report
  endpoints and role permissions.
- This report does not certify the full ERP, inherited commits, or unrelated worktree changes for
  production migration.

## Release status

Commit `91f119c259738d6ee188fdd0fbbae99f9f99fea9` was pushed normally (no force) to
`origin/release/v3-masterpiece`. `git ls-remote` verified that the remote branch points to that same
SHA. The branch includes the Cloudflare dashboard change-record commit `15ebe7ac`. No production
deployment was performed.
