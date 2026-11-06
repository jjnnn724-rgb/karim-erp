# KARIM ERP 4.9.2 — RISK REGISTER
## Accounting & Financial Architecture Risk Register
**Date:** 2026-11-03 22:45:00 (Asia/Riyadh)

---

| Risk ID | Category | Description | Severity | Likelihood | Mitigation Strategy | Status |
|---|---|---|---|---|---|---|
| **RSK-01** | Data Integrity | Operational tables (`revenues`/`expenses`) diverge from GL | CRITICAL | HIGH | Build unified Financial Reporting Views sourced directly from `journal_lines` | In Progress |
| **RSK-02** | Operational | Duplicate posting on retry under unstable network | HIGH | LOW | Enforce unique `(source_type, source_id)` and Idempotency Keys across all endpoints | Mitigated in DB |
| **RSK-03** | Compliance | Posting transactions into closed financial periods | HIGH | LOW | Centralize `assertPeriodOpen` gate at `postJournal` entrance | Active |
| **RSK-04** | Precision | Loss of cents/halalas from floating-point arithmetic | HIGH | LOW | Use strict `NUMERIC(14,2)` and integer cents internally | Enforced |
| **RSK-05** | Revenue Leakage | Delivery platform commissions unrecorded or mixed with revenue | HIGH | HIGH | Introduce Posting Matrix rule for Delivery Aggregators (`4103`, `1131`, `6302`) | Pending Phase 1 |
| **RSK-06** | Auditability | Manual journal entries edited without audit trail | HIGH | LOW | Posted journals are immutable; corrections require void or reversal journal | Enforced in Code |
| **RSK-07** | Costing | Disconnect between recipe BOM consumption and GL COGS | MEDIUM | MEDIUM | Standardize `postInventoryLedgerEntry` call for recipe production completion | Pending Phase 1 |
| **RSK-08** | Governance | Single user creates and approves sensitive journals | MEDIUM | MEDIUM | Segregation of Duties (SoD) matrix with approval thresholds | Pending Phase 2 |
