# KARIM ERP 4.9.2 — GAP ANALYSIS
## Current vs Target Enterprise Architecture
**Date:** 2026-11-03 22:45:00 (Asia/Riyadh)

---

### Gap 1: Decentralized Posting Logic
* **Current State:** Posting code is spread across multiple route files (`complete-sale.js`, `warehouse-routes.js`, `day-close-routes.js`, `procurement-routes.js`, `dept-transfer-routes.js`).
* **Target State:** Centralized `PostingMatrixEngine` service that maps any business event to an atomic, validated, idempotent journal entry.
* **Risk:** High (Inconsistent posting behavior between edge modules).

### Gap 2: Delivery Platform Accounting (Aggregators)
* **Current State:** Delivery sales (Jahez, HungerStation, ToYou) are treated like credit card payments straight into 1010/4000.
* **Target State:** Gross revenue recognized in `4103`, commission recognized in `6302`, receivable held in `1131` (AR Delivery Platforms) until bank settlement is matched.
* **Risk:** High (Hidden commission tracking, inaccurate channel profitability).

### Gap 3: Missing AR Subledger
* **Current State:** No dedicated customer accounts table linked to General Ledger 1300. Corporate catering or credit events are recorded via memo strings.
* **Target State:** Dedicated `customers` and `customer_subledger` table with automated reconciliation against GL 1300.
* **Risk:** Medium.

### Gap 4: Automated Period Depreciation
* **Current State:** Table `fixed_assets` exists with straight-line metadata, but depreciation requires manual invocation.
* **Target State:** Scheduled month-end batch execution that generates `Dr 6401 / Cr 1220` with audit logging.
* **Risk:** Low.

### Gap 5: Financial Reporting Source of Truth
* **Current State:** Executive dashboard and P&L read from operational raw tables (`revenues`, `expenses`), while balance sheet reads from `journal_lines`.
* **Target State:** General Ledger (`journal_entries` + `journal_lines`) serves as the single source of truth for all statutory and operational financial reports.
* **Risk:** Critical (Discrepancy between operational reports and GL Trial Balance).
