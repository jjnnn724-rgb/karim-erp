# KARIM ERP 4.9.2 — EXISTING ACCOUNTING AUDIT
## Phase Zero Deliverable: Architectural & Accounting Inventory
**Date:** 2026-11-03 22:45:00 (Asia/Riyadh)  
**Branch:** `stabilization/pos-unification`  
**Classification:** STRICT PRODUCTION AUDIT (READ-ONLY)

---

### 1. Executive Summary
This audit inspects the living accounting implementation in Karim ERP 4.9.2.
* **General Ledger Rows:** 34,020 journal entries, 68,237 lines in `journal_lines`.
* **Trial Balance Balance:** Exactly balanced at 7,141,402.60 SAR (Dr = Cr, Diff = 0.00).
* **Architecture Paradigm:** Dual-track architecture (Direct operational tables `revenues`/`expenses` alongside double-entry General Ledger `journal_entries`/`journal_lines`).
* **Integrity Engine:** `postJournal` in `backend/accounting-routes.js` with database invariant constraints (`095_journal_db_invariants.sql`).

---

### 2. Existing Accounting Capabilities Matrix

| Area | Status | Evidence File | Audit Classification |
|---|---|---|---|
| Chart of Accounts (COA) | Fully Operational (4 Levels, 108 accounts) | `database/migrations/131_professional_chart_of_accounts.sql` | [VERIFIED] |
| Double-entry Journal Engine | Operational (`postJournal`) | `backend/accounting-routes.js:62-171` | [VERIFIED] |
| Balanced Constraints | DB CHECK (`ck_journal_lines_balance`) | `database/migrations/095_journal_db_invariants.sql` | [VERIFIED] |
| Idempotency Protection | UNIQUE `(source_type, source_id)` | `database/migrations/042_accounting_core.sql:31` | [VERIFIED] |
| Period Locking | Active (`assertPeriodOpen`) | `backend/accounting-periods.js:12-45` | [VERIFIED] |
| Trial Balance | Live (`/api/accounting/trial-balance`) | `backend/accounting-routes.js:523-545` | [VERIFIED] |
| Cash Flow (Direct Method) | Live (`/api/accounting/cash-flow`) | `backend/accounting-periods.js:229-265` | [VERIFIED] |
| Cost Centers | Active (`MAIN` + Department Codes) | `database/migrations/081_accounting_growth.sql` | [VERIFIED] |
| Fixed Assets Ledger | Schema present, manual posting | `database/migrations/081_accounting_growth.sql` | [PARTIALLY VERIFIED] |
| Bank Reconciliation | Statement matching | `database/migrations/081_accounting_growth.sql` | [PARTIALLY VERIFIED] |
| Supplier Subledger | AP tracking via `purchaseInvoices` | `backend/warehouse-routes.js:1767` | [PARTIALLY VERIFIED] |
| Customer Subledger | Direct GL posting to 1300 (no subledger) | `backend/accounting-routes.js` | [VERIFIED MISSING] |
| Centralized Posting Matrix | Distributed across 6 service files | `backend/cashier-module`, `backend/production-routes.js` | [PARTIALLY VERIFIED] |
| Factory Department Transfers | Direct menu-price settlement | `backend/dept-transfer-routes.js:460-520` | [VERIFIED] |

---

### 3. Core Engine Review: `postJournal` Invariants
The core posting method `postJournal(pool, entry)` satisfies strict banking-grade rules:
1. **Period Open Gate:** Rejects if date falls into a closed fiscal period (`PERIOD_LOCKED`).
2. **Line Integrity:** Strips invalid empty lines, guarantees each line is either debit or credit, never both.
3. **Mathematical Balance:** Guarantees `|Σ Debit - Σ Credit| <= 0.001`.
4. **Account Validation:** Verifies all referenced accounts exist, are active, and have `is_postable = true`.
5. **Cost Center Validation:** Validates foreign keys on `cost_centers.code`.
6. **Concurrency Safety:** Applies sequence collision retry loops (up to 3 attempts) and source idempotency replays.
