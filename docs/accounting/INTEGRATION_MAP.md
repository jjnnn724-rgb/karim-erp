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

### 7. VAT review workspace (internal draft)
* **API:** `GET /api/accounting/vat-return` reports posted VAT-control-account
  movements, POS invoice and void schedules by stored VAT rate, purchase-invoice
  snapshots matched to posted `purchase_invoice` journals, unlinked legacy
  revenue by source, and opening/closing control-account balances.
* **Reconciliation:** POS void debits are shown as output-tax reversals; monthly
  settlement entries are excluded from period movement. Unlinked revenue is
  shown as an excluded reconciliation source, not silently counted as taxable
  sales. Purchase records without a posted journal are reported separately.
* **Review gate:** nonstandard/zero/missing VAT rates, unclassified ledger
  movements, unposted documents, supplier-tax-profile gaps and source-to-ledger
  differences are explicit blockers. The API deliberately reports
  `can_file: false`; a formatted/valid VAT number does not verify active ZATCA
  registration.
* **Filing limitations:** legal supply categories (including exports, exempt,
  out-of-scope and reverse-charge transactions), deductible-input eligibility,
  the registered filing period, prior-return credits/payments, and ZATCA
  submission/acceptance are not fully represented or verified by this
  application. The displayed ledger net is not a filing amount. Reconcile
  original documents, prior returns and the current ZATCA portal before filing.
* **Quarterly period:** `tax_config.filing_frequency` defaults to `quarterly`;
  the VAT review screen opens on the last completed calendar quarter and flags
  date ranges that do not match complete quarter boundaries. Confirm the
  actual dates shown in the taxpayer's ZATCA account before relying on them.
