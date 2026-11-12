# ADR-008: Keep direct Mudad/WPS submission blocked

**Status:** Accepted
**Scope:** Mudad/WPS, GOSI, and Qiwa surfaces in V3

## Context

The application has no verified government API contract, production credentials, or
documented acceptance flow for Mudad, GOSI, or Qiwa. Reaching a public portal does
not establish that an API is available or that an exported file is accepted.

On 2026-11-12, the ZATCA guidelines portal was reachable, but the VAT-specific
guidance needed for a return calculation was not confirmed from that page. The
HRSD wage-protection URL returned an unavailable page, Qiwa could not be fetched,
and the Mudad public landing page did not expose API documentation. These checks
are not legal verification.

## Decision

- Keep Mudad provider status `BLOCKED`; do not make outbound government requests
  or describe a locally generated document as accepted.
- Label the WPS CSV as a human-review sheet, not a bank SIF or government upload.
- Keep GOSI rate sets unverified, require explicit selection, and do not post their
  estimates to payroll or the general ledger.
- Describe Qiwa checks as local data readiness only. A locally current contract is
  not evidence of Qiwa registration or legal compliance.
- Mask employee identity numbers and IBANs in readiness responses and screens.
  Raw identifiers may appear only in an explicitly authorized WPS review export,
  which requires posted payroll and a persisted audit event.
- Commit employee bank-data changes and their audit event atomically; reject the
  write if audit persistence is unavailable.
- Treat migrations 145 and 147 as additive setup for an isolated test database
  first. No production migration or government submission is authorized by this
  ADR.

## Consequences

The workspace supports internal preparation and review, not regulatory filing.
Official requirements and any file/API format must be verified with current
government documentation and the business's compliance adviser before enabling
submission or claiming compliance.

## Sources checked

- [ZATCA Guidelines and Manuals](https://zatca.gov.sa/en/HelpCenter/guidelines/Pages/default.aspx)
- [HRSD Wage Protection Program](https://www.hrsd.gov.sa/en/services/wage-protection-program) — unavailable during this review
- [Mudad Business](https://mudad.com.sa) — landing page only; no API evidence verified
- [Qiwa](https://www.qiwa.sa/en) — unavailable during this review
