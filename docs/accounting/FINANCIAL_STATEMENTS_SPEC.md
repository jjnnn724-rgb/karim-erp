# KARIM ERP 4.9.2 — FINANCIAL STATEMENTS SPECIFICATION
## Statutory Financial Statements Engine (Single Source of Truth)
**Date:** 2026-11-03 23:25:00 (Asia/Riyadh)  
**Implementation:** `backend/financial-statements-engine.js`  
**API Endpoints:**
* `GET /api/accounting/balance-sheet?as_of=YYYY-MM-DD`
* `GET /api/accounting/income-statement?from=YYYY-MM-DD&to=YYYY-MM-DD`
* `GET /api/accounting/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD`

---

### 1. Statement of Financial Position / Balance Sheet (قائمة المركز المالي)
* **Equation:** $\text{Total Assets} = \text{Total Liabilities} + \text{Total Equity} + \text{Current Period Net Income}$
* **Verification Status on Production Data:**
  * **Total Assets:** 5,806,551.28 SAR
  * **Total Liabilities + Equity:** 5,806,551.28 SAR
  * **Variance:** 0.00 SAR
  * **Integrity Status:** `MATCHED` (Balanced 100%)

---

### 2. Comprehensive Income Statement (قائمة الدخل الشامل)
* **Revenue Recognition:** Realized revenues strictly aggregated from Level 4 posting accounts (`4000`, `4010`, `4020`, `4030`, `4050`).
* **Cost of Goods Sold (COGS):** Direct materials and kitchen dispatches aggregated from Level 4 posting accounts (`5000`, `5100`, `5120`, `5300`, `5400`).
* **Gross Profit:** $\text{Gross Profit} = \text{Revenues} - \text{COGS}$.
* **Operating Expenses:** Operational and administrative expenses aggregated from Level 4 accounts (`6000` through `6900`).
* **Net Profit:** $\text{Net Profit} = \text{Gross Profit} - \text{Operating Expenses}$.

---

### 3. Traceability Guarantee
Every line item in the financial statements links directly back to posted general ledger vouchers (`journal_lines`), with zero estimation or discrepancy from raw operational tables.
