# KARIM ERP 4.9.2 — CURRENT COA EXPORT
## Verified Chart of Accounts Baseline (108 Accounts)
**Date:** 2026-11-03 22:45:00 (Asia/Riyadh)  
**Database:** `karim_erp`  
**Classification:** IFRS / Restaurant Standard (Level 1 to 4)

---

### Structure Summary
* **Level 1 (Main Classes):** `1` الأصول (Assets), `2` الالتزامات (Liabilities), `3` حقوق الملكية (Equity), `4` الإيرادات (Revenues), `5` تكلفة النشاط (COGS), `6` المصروفات التشغيلية (Expenses). `is_postable = false`.
* **Level 2 (Groups):** `11`, `12`, `21`, `22`, `31`, `32`, `41`, `42`, `51`, `52`, `61`, `62`, `63`, `64`. `is_postable = false`.
* **Level 3 (Sub-Groups / Control Accounts):** `111`, `112`, `113`, `114`, `115`, `211`, `212`, `213`, `214`. `is_postable = false`.
* **Level 4 (Operational Accounts):** All posting accounts including legacy accounts (`1000`, `1010`, `1150`, `1200`, `1300`, `1400`, `1510`, `1520`, `2000`, `2100`, `2200`, `2300`, `3000`, `3100`, `4000`, `4100`, `5000`, `5100`, `6000`..`6900`) and modern operational additions. `is_postable = true`.

---

### Key Historical Balances (Zero Variance Guarantee)
* `1000` (النقدية بالصندوق): Debit 5,668,533.88 | Credit 24,648.85
* `1010` (البنك — الحساب الجاري): Debit 0.00 | Credit 8.22
* `1150` (ضريبة القيمة المضافة مستردة): Debit 97,830.27 | Credit 0.00
* `1200` (مخزون المواد): Debit 700,611.90 | Credit 639,499.00
* `2000` (ذمم دائنة موردون): Debit 11,357.07 | Credit 797,742.91
* `3000` (رأس المال): Debit 0.00 | Credit 570.00
* `3100` (الأرباح المحتجزة): Debit 0.00 | Credit 2,252,293.42
* `4000` (إيرادات المبيعات): Debit 0.00 | Credit 3,416,240.46
* `5000` (تكلفة البضاعة المباعة — أغذية): Debit 649,769.48 | Credit 10,399.74
* `6900` (مصاريف تشغيلية أخرى): Debit 13,300.00 | Credit 0.00
**Total Trial Balance:** 7,141,402.60 SAR (Balanced: 100%)
