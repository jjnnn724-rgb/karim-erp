# KARIM ERP 4.9.2 — INTEGRATION MAP
## Operational Flow to General Ledger Posting
**Date:** 2026-11-03 22:45:00 (Asia/Riyadh)

---

### 1. Point of Sale (POS) Integration
* **File:** `backend/cashier-module/complete-sale.js` & `backend/accounting-routes.js`
* **Trigger:** Customer order paid at terminal.
* **Entries:**
  * Debit: `1000` (Cash) or `1010` (Card/Bank)
  * Credit: `4000` (Sales Revenue)
  * Credit: `2100` (VAT Output 15%)
  * Debit: `5000` (Food COGS)
  * Credit: `1200` (Inventory)
* **Idempotency:** `source_type = 'pos_sale'`, `source_id = orderId`.

### 2. Procurement & Purchasing Integration
* **File:** `backend/warehouse-routes.js:1767`
* **Trigger:** Approved supplier invoice entered into warehouse.
* **Entries:**
  * Debit: `1200` (Inventory / Net Amount)
  * Debit: `1150` (Input VAT 15%)
  * Credit: `2000` (Accounts Payable - Supplier)
* **Idempotency:** `source_type = 'purchase_invoice'`, `source_id = invoiceId`.

### 3. Supplier Payments (Procurement)
* **File:** `backend/procurement-routes.js:771`
* **Trigger:** Payment voucher issued to vendor.
* **Entries:**
  * Debit: `2000` (Accounts Payable - Supplier)
  * Credit: `1000` (Treasury Cash) or `1010` (Bank Transfer)
* **Idempotency:** `source_type = 'supplier_payment'`, `source_id = paymentId`.

### 4. Kitchen & Central Production Transfers (Factory Departments)
* **File:** `backend/dept-transfer-routes.js:460-520`
* **Trigger:** Delivery from factory department (`departments.is_factory = true`) to external sales outlet.
* **Pricing Basis:** Evaluated automatically at outlet menu price.
* **Entries:**
  * Debit: `5000` (Outlet Cost Center - Food Cost Burden)
  * Credit: `4000` (Factory Cost Center - Revenue Recognition)
* **Idempotency:** `source_type = 'factory_transfer'`, `source_id = transferId`.

### 5. Payroll Posting
* **File:** `backend/accounting-routes.js:610-640`
* **Trigger:** Monthly payroll run approved.
* **Entries:**
  * Debit: `6000` (Salaries & Wages Expense)
  * Credit: `2200` (Salaries Payable)
* **Idempotency:** `source_type = 'payroll'`, `source_id = 'YYYY-MM'`.

### 6. Day-Close Variance Posting
* **File:** `backend/cashier-module/day-close-routes.js:250-275`
* **Trigger:** POS cashier shift closing with cash discrepancy.
* **Entries (Shortage):**
  * Debit: `6900` (Cash Shortage / Operating Expense)
  * Credit: `1000` (POS Treasury)
* **Entries (Overage):**
  * Debit: `1000` (POS Treasury)
  * Credit: `6900` (Cash Overage / Other Operating Income)
