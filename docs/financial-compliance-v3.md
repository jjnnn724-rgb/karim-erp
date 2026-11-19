# Financial compliance on v3

The compliance dashboard is a React screen in the existing v3 application; it is
not a separate HTML application. Its API uses the repository's `/api/v3`
namespace and existing PostgreSQL pool, API-key middleware, JWT authentication,
role checks, and global error handler.

## Files

- `backend/v3/compliance-routes.js` — authenticated dashboard, VAT status, GOSI
  preview, and bank-match routes.
- `backend/services/gosi-service.js` — adds a month-scoped payroll calculation
  read using the existing payroll and employee tables.
- `backend/server.js` — mounts the compliance router at `/api/v3`.
- `backend/v3/static-routes.js` — serves the built SPA from `frontend/v3` at
  `/v3/`, injects the deployed screen allow-list, and provides history fallback.
- `v3/apps/web/src/screens/FinancialCompliance.tsx` — React UI with four
  in-page modules and live API reads.
- `v3/apps/web/src/lib/financial-compliance.ts` — validated v3 API contracts.
- `v3/apps/web/src/routes/routes.tsx`, `src/lib/screens.ts`,
  `src/lib/role-menus.ts`, `src/lib/navigation.ts`, and `src/components/Shell.tsx`
  — route, screen gate, role access, title, and sidebar registration.
- `frontend/v3/screens.json` — deployed v3 screen allow-list.

## API

- `GET /api/v3/dashboard` — posted current-month sales/VAT KPIs and Iqama,
  invoice-posting, and VAT-validation alerts.
- `GET /api/v3/vat/status` — validates the draft/reviewed VAT return covering
  today. Optional `tax_period_id`, or an explicit `from` and `to`, selects a
  period. A hard block is returned as HTTP 422 with `blockingInvoices`.
- `GET /api/v3/payroll/gosi` — calculates current Riyadh-month payroll rows.
  Calculations remain previews unless an effective, sourced, verified GOSI
  rate-set is present.
- `POST /api/v3/bank/match` — body
  `{"transactions":[{"id":"<persisted bank_statements id>"}]}`. It accepts
  already-imported statement IDs; it does not ingest bank files.

## Deploy

1. Apply the approved financial compliance migration
   `database/migrations/151_financial_compliance_schema.sql` and confirm its
   prerequisites, including `147_employee_wps_bank.sql`, are applied. The
   migration is not run by the UI build.
2. Deploy the changed backend files and restart the existing Express service
   through the normal production service manager. No new environment variables
   are introduced: the code uses the existing `.env` database, JWT, and
   optional `API_KEY` configuration.
3. Build the React app from the v3 workspace:

   ```powershell
   Set-Location C:\path\to\karim-erp\v3
   pnpm --filter @karim/web build
   node scripts\sync-build.mjs --dry-run
   node scripts\sync-build.mjs
   ```

   The build sync copies the compiled app into `frontend/v3`, the directory
   served by the production v3 static host. Review the dry-run output and
   existing worktree changes before syncing; the script updates the deployed
   `index.html` and hashed assets.
4. Ensure the deployment contains the updated
   `frontend/v3/screens.json` entry `financial-compliance`, then visit
   `/v3/financial-compliance` on the existing domain. The app sidebar shows
   "مركز الامتثال المالي" for admin, manager, accountant, and HR roles. HR sees
   the GOSI module; manager does not see the bank-write module.
5. Verify the four API paths above with an authenticated v3 session and the
   existing `x-api-key` header when `API_KEY` is configured. Verify a draft
   invoice yields HTTP 422 and visible invoice details; verify GOSI remains a
   preview when no verified rate set is configured.

Bank matching and VAT/GOSI data depend on the existing source records and the
migration state. No live database write or production deployment is performed
by the build.
