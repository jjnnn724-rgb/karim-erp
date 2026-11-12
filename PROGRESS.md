# Engineering Progress

## 2026-11-12 — V3 inventory inquiry date validation

- **Scope:** Reject impossible calendar dates in inventory inquiry ranges before querying PostgreSQL. Preserve the existing default range, leap-day behavior, reversed-range error, and 93-day limit.
- **Changes:** Added strict calendar-day validation to the shared V3 report-range guard and the inventory inquiry API; added frontend and backend regression tests.
- **Files:** `backend/inventory-inquiry.js`, `v3/apps/web/src/lib/reporting.ts`, `v3/apps/web/src/screens/InventoryInquiry.test.tsx`, `tests/inventory-inquiry-range.test.js`.
- **Verification:** Inventory inquiry UI tests passed (6/6); backend range tests passed (4/4); V3 web typecheck passed; V3 web production build passed. Build emitted dependency annotation warnings. No database writes or production deployment were performed.
- **Git/release:** The selected fixes were stashed and restored on the new `release/v3-masterpiece` branch. Commit `2ba822ef8aac254121c91ffd5aabb4c0bb3c1877` contains only the four files listed above. The branch was pushed to `origin/release/v3-masterpiece`, and `git ls-remote` verified that origin points to the same SHA. No PR was created.
- **History and worktree safety:** The new branch was intentionally created from existing HEAD `2221de01`; that ancestry includes the pre-existing commit with 277 changed files. No existing commit was amended, rewritten, or force-pushed. Numerous unrelated worktree changes were preserved and excluded from the inventory commit.
- **Readiness:** READY WITH LIMITATIONS for the focused date-validation fix. This branch is not evidence that the full ERP passed release gates; broader system verification and review of inherited/unrelated changes remain outstanding.

## V3 system verification — continued

- **V3 checks:** The full V3 web test suite passed (1,226 tests across 171 test files); desktop/mobile E2E passed (6/6); V3 typecheck, production build, bundle budget, and UI-version consistency checks passed. The build had dependency-annotation warnings. Lint completed without errors and reported 114 warnings.
- **Security checks:** The secret scanner now reports 0 findings. Added one narrowly scoped allowlist entry for the synthetic `access-1` token in `AuthGate.test.tsx`; it is test fixture data, not a credential. The static security gate is green. The financial-core TypeScript gate passed with 0 errors in critical modules.
- **Security review limits:** Route-pattern audit output is heuristic and does not fully resolve router-level or handler-level middleware. Its matches are not confirmed vulnerabilities. The static gate still reports route-pattern matches covered by its existing baseline; this verification does not substitute for a complete manual authorization review.
- **Not verified:** Live/staging end-to-end flows and production-database behavior were not run. No production deployment or database writes were performed. The inherited 277-file commit and numerous unrelated worktree changes were not audited as a complete release candidate.
- **Readiness:** The tested V3 checks are green, but the ERP is NOT certified ready for production migration. Keep the existing worktree changes isolated and require isolated staging/live-flow verification plus review of inherited and unrelated changes before promoting V3.

## 2026-11-12 — Cloudflare analytics injection disabled

- **Change:** Disabled Cloudflare Web Analytics / RUM automatic script injection for `karimeg.online` in the Cloudflare dashboard. The existing strict V3 CSP remains unchanged; no analytics origin or inline-script exception was added.
- **Verification:** Cloudflare lists the site as Disabled. The live `/v3/pos-entry` response returns HTTP 200, serves the V3 application bundle, and no longer contains `beacon.min.js` or `data-cf-beacon`. The POS page renders. Cloudflare may still inject a separate challenge bootstrap on challenged requests; it remains blocked by CSP.
- **Scope:** This setting is external to the Git repository. This commit records the dashboard change; it does not claim a code-level CSP modification or a complete production release.

## 2026-11-12 — V3 POS, reporting, and print release work

- **POS/kiosk:** Product cards now use the image URL belonging to that exact product row; unsupported/missing/broken images show a branded Karim POS placeholder. Cashier-role users are routed to a full-screen, touch-friendly POS shell without admin navigation. Other roles keep the existing shell.
- **Reporting/accounting:** Added a role-filtered reports hub linking to existing operational reports. The P&L screen now distinguishes its existing operational view from an official posted-ledger P&L. Trial balance and official statements expose counts of unbalanced posted entries; the balance sheet only sums posted journal lines. Entries with fewer than two lines are treated as invalid.
- **Print:** Added report title, date, and configured branch in the Arabic RTL header; current user and timestamp in the footer; browser page counters; existing navigation/action hiding and repeated table headers remain in force.
- **Verification:** V3 unit suite passed (932 tests across 140 files); V3 TypeScript check passed; production build passed; V3 bundle budget passed (entry JS 203.8 KiB gzip, total JS 702.8 KiB gzip, total CSS 51.1 KiB gzip, 100 JS files/27 CSS files). Targeted ESLint and Prettier checks passed. The build still reports an existing minified chunk >500 kB raw and a dependency annotation warning.
- **Backend verification limit:** Mocked financial-engine checks passed. A Jest regression test was added, but the repository-wide Jest setup requires an explicitly provisioned disposable database (`karim_erp_test`); no database was provisioned or accessed to bypass that safety gate. No production database or live endpoint was tested.
- **Release status:** Source and report changes are staged for a normal fast-forward push to `release/v3-masterpiece`. Remote was checked before publication and pointed to `342c39b844c2f77f264f941b01b4f0d2af38462c`; push verification is pending. No production deployment has been performed. This work is not a certification for the broader ERP or its inherited changes.
