# KARIM ERP 4.9.2 — BUSINESS DISCOVERY RESPONSES
## Phase 1 Deliverable: Verified Business Profile & Policies
**Date:** 2026-11-03 22:50:00 (Asia/Riyadh)  
**Status:** ESTABLISHED FROM DOCUMENTATION & OWNER DIRECTIVES

---

### 1. Entity & Jurisdiction Profile
* **Jurisdiction:** Kingdom of Saudi Arabia (KSA).
* **Official Timezone:** `Asia/Riyadh` (Arabia Standard Time - UTC+3) [Decision D14].
* **Functional Currency:** Saudi Riyal (SAR). Decimal precision: 2 (`NUMERIC(14,2)`).
* **Operating Profile:** Chain of restaurant branches, central kitchens, central manufacturing/production departments (Juice/Production G), and external sales outlets.
* **Tax Profile:** Value Added Tax (VAT 15%) — Standard Rate. Output VAT on sales (`2100`/`2120`), Input VAT on purchases (`1150`).

### 2. Operational & Cost Policies
* **Inventory Valuation Policy:** Weighted Average Cost (`avgCost`) recalculated continuously upon every purchase receipt in `inventory_ledger` [Verified in `docs/erp/02_deep_dive_report.md`].
* **Central Factory Pricing Policy:** Evaluated at external sales outlet menu price (Revenue recognized to factory cost center `4000/4050`, cost burden to outlet cost center `5000/5400`, prime cost retained by factory) [Decision 2026-11-03, Migration 130].
* **General Ledger Invariance Policy:** All postings must be strictly balanced (`Σ Dr = Σ Cr`), atomic, idempotent via unique source constraints, with closed period enforcement.
* **Reporting Architecture Goal:** Unify P&L, Trial Balance, and Executive Dashboard to read exclusively from General Ledger (`journal_lines`), eliminating dual-truth discrepancies.
