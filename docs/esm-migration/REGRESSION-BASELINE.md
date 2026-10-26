# REGRESSION BASELINE — pre-ESM-migration reference

**Captured:** 2026-09-27 · **Environment:** https://localhost:5000 (HTTPS, mkcert CA trusted),
logged in as `admin` (مدير النظام), session via JWT.

## Screenshots
| File | State |
|---|---|
| `baseline/01-dashboard.png` | لوحة التحكم — KPI cards, sidebar, notifications, ارتباط (14 departments) |
| `baseline/02-warehouse.png` | صفحة المخزن — cards + filters + table render |
| `after-extraction-001-pwa.png` | نفس صفحة المخزن بعد الاستخراج 001 (مطابقة بصريًا) |

## State snapshot at baseline (window.STATE)
`page: dashboard · lang: ar · theme: light · departments: 14 · hasJwt: true · realtime ready`

## Critical flows (manual QA checklist per extraction)
1. **Login screen** renders; `doLogin` works (admin/Admin@2026); forgot-password modal opens.
2. **Boot:** health check → session refresh → enterApp → buildNav → renderPage (no console errors).
3. **Navigation:** sidebar buttons route (dashboard, warehouse, employees spot-checks).
4. **PWA:** install button hidden until `beforeinstallprompt`; offline bar toggles on online/offline.
5. **Realtime:** socket connects; device/status indicators live.
6. **Reports/print:** generate a report; print window opens with auto-print.
7. **Network:** no new/changed API calls vs `audits/api-inventory.json` (DevTools diff).

## Current verification tooling
- Browser automation smoke (IAB): boot completion, `window.*` contract presence, nav click, screenshots.
- `node --check` on every touched file; ESLint optional per extraction.
- `audits/analyze.js` regenerates inventories to detect drift.
