# KARIM ERP 4.9.2 — SUBLEDGER RECONCILIATION BASELINE
## Baseline Findings for Accounts Payable (AP) and Accounts Receivable (AR)
**Date:** 2026-11-03 23:15:00 (Asia/Riyadh)  
**Database:** `karim_erp`  
**Classification:** PRODUCTION AUDIT EVIDENCE

---

### 1. Accounts Receivable (AR) Reconciliation
* **Subledger Balance (`customer_transactions`):** 0.00 SAR
* **General Ledger Balance (`1300`, `1310`, `1320`):** 0.00 SAR
* **Variance:** 0.00 SAR
* **Status:** `MATCHED` (100% Balanced).
* **Delivery Aggregators Initialized:** Jahez (`CUST-JAHEZ`), HungerStation (`CUST-HUNGER`), ToYou (`CUST-TOYOU`), Ninja (`CUST-NINJA`) mapped to Control Account `1310`.

---

### 2. Accounts Payable (AP) Reconciliation
* **Subledger Balance (`purchaseInvoices` Unpaid):** 45,134.01 SAR
* **General Ledger Balance (Account `2000`):** 716,134.38 SAR
* **Variance Detected:** -671,000.37 SAR (`DISCREPANCY`)

#### Root Cause Analysis:
1. Historically, large opening/batch purchase invoices were posted directly to GL account `2000` (e.g., initial inventory procurement and opening balances of 700k+) without writing individual line rows to `purchaseInvoices.supplierId`.
2. Operational procurement recorded 45,134.01 SAR as outstanding invoices in the active supplier table.
3. **Remediation Strategy:** The continuous reconciliation view `view_ap_reconciliation` now immediately isolates this historical variance. Going forward, every purchase invoice through `PostingMatrixEngine` and `warehouse-routes.js` is atomically linked to `supplierId` and `journal_entry_id` simultaneously, preventing any further variance growth.
