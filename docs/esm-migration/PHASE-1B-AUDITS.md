# PHASE 1B — DETAILED AUDITS (Karim ERP Frontend → Native ESM)

**Date:** 2026-09-27
**Method:** static analyzer (`audits/analyze.js`, read-only) over `app.js` (12,353 lines), `index.html`,
7 sibling scripts, `sw.js`. Raw machine inventories are committed as appendices in `audits/*.json`
(regenerable at any time — the analyzer modifies nothing).
**Corrections vs Phase 1A quick greps:** raw `fetch()` calls = **1** (the "18" included `apiFetch(`
substring matches); unique `window.*` assignments = **259**.

---

## 1. GLOBAL DEPENDENCY AUDIT

The global surface decomposes into exactly four contract classes:

| Class | Count | Mechanism today | Migration treatment |
|---|---|---|---|
| A. Explicit `window.*` assignments in app.js | **259** names | `window.x = x` export blocks (several per line, inside boot callback + top-level IIFE) | Mechanically movable into generated `bridges/window-exports.js` |
| B. Top-level `function` declarations consumed from inline `onclick="..."` in generated HTML | **415** names | Classic-script auto-globalization (function declarations become window properties) | **The core trap.** In ESM nothing is auto-global → each must be exported + bridged. Inventory exists → bridge can be GENERATED and TESTED |
| C. Externally consumed by sibling scripts (realtime.js) | **5** names | bare `window.X` reads | Frozen contract; bridge mandatory: `STATE`(17), `renderPage`(10), `zkPortalPunchHandler`(4), `_jwt`(2), `refreshProcurementData`(2) |
| D. index.html inline handlers | **12** fns | bare names (`go(`, `toggleLang(`, `doLogout(`, `pwaInstall(`, `showNotifications(`, `toggleTheme(`, `toggleSidebar(`, `showAddRevenueModal(`, `showAddExpenseModal(`, `showDispatchRequestModal(`, `showForgotPasswordModal(`, `toggleFabMenu(`) | All are top-level declarations → covered by class-B bridge |

**Golden verification result:** of 417 inline-consumed names in app.js templates — 415 top-level
declarations + 1 explicit window assignment (`updateApproveTotal`, line 8095) + 1 false positive
(an inline `if(...)` statement in an onclick, not a function). **Zero uncovered names.**
The same check for index.html: 12/12 covered. ➜ A generated, assertion-tested bridge is
feasible with **no blind spots**.

**Cross-check artifact:** `audits/inline-handlers.json` (full name→call-count map),
`audits/window-globals.json` (name → assignment lines/sections + external consumers).

**Dead-code findings (do not migrate, do not delete yet):** `pos.js` (15 listeners, 109 KB),
`bilingual.js`, `pos-orders.js` are **loaded by nothing** (not in index.html, not injected) but are
pre-cached by `sw.js` lines 28–30. Decision needed in Phase 2: exclude from migration + remove
from sw precache, or confirm an external consumer. They are NOT part of the runtime contract.

**Function distribution by section** (module weight, from `functions-by-section.json`):
WAREHOUSE 117 · KITCHEN & DISPATCH 116 · YARASOFT 55 · I18N 49 · WHATSAPP 45 · SETTINGS 36 ·
AUTH & NAVIGATION 32 · ZKTECO 31 · ATTENDANCE 24 · BULK IMPORT 23 · RECIPES 23 ·
SMART CARD RENDER 22 · … (full table in raw JSON). Top-level `const/let` state objects: 1,630
declarations inventoried in `top-level-vars.json`.

---

## 2. DOM DEPENDENCY AUDIT

- **451 unique IDs** referenced via `getElementById` in app.js (full map with usage counts:
  `audits/dom-ids.json.referencedInJs`); `querySelector/querySelectorAll` selectors inventoried in
  the same file. Most IDs live inside dynamically generated template strings — the generated DOM
  **is** the DOM contract.
- index.html declares its own static ids (list in raw JSON); overlap with JS-referenced ids is the
  static shell (login screen, sidebar, FAB, notification area, modals root).
- **Inline handler contract:** 417 names in app.js templates + 12 in index.html (class B/D above).
  Also present: inline `oninput`/`onchange`/`onsubmit`/`onkeydown` — same bridge coverage applies
  (analyzer scanned all `on*=` attributes).
- Print/report generators emit complete documents with inline `<script>window.onload=…print()</script>`
  (e.g. lines 1515, 1612) — their inner globals live in the popup document, unaffected by app
  modules, but the generator functions themselves must keep working.
- **Preservation rule (unchanged from directive):** every id/class/selector/`data-*` string is
  copied verbatim; Phase 3 verification includes a DOM-diff smoke per migrated module.

---

## 3. API DEPENDENCY AUDIT

- **212 `apiFetch()` calls → 188 unique endpoints** (`audits/api-inventory.json`: every call with
  file line, section, path, method).
  Method distribution: **GET 103 · POST 90 · PUT 11 · DELETE 8**.
  Busiest: `/procurement/suppliers` (4), `/attendance/range` (3), `/warehouse/inventory/audits` (3),
  `/yara-reports/cashier-items` (3), plus ZKTeco/Yarasoft/WhatsApp status pairs.
- **1 raw `fetch()`** — recipe product image upload (`app.js:8411`, `${API_BASE}/pos/products/…/image`).
- **Auth/headers/behavior concentrated in ONE place — `apiFetch` (app.js:32):**
  `Authorization: Bearer window._jwt` · `x-api-key: window._appKey` · `Content-Type: application/json`
  · 30 s `AbortController` timeout · **429 handling with `Retry-After`** (boot fan-out protection) ·
  `PERSISTED_ENTITIES` (24 entities) boot fan-out with `ROLE_ENTITY_EXCLUSIONS` (dept_head skips
  `users`,`payroll`) to avoid 403 noise.
- **Migration rule:** exactly one `core/api.js` module; every feature imports the same instance.
  No endpoint string may be edited while moving — the inventory JSON is the diff baseline.

---

## 4. STORAGE DEPENDENCY AUDIT

Runtime storage surface is **small and fully enumerable**:

| Key | API | Written/read by | Notes |
|---|---|---|---|
| `karim_lang` | localStorage get+set | app.js (i18n) | language persistence |
| `token` | localStorage get | db-constraints-client.js | read-only consumer — verify intended |
| `erp_lang` | localStorage get+set | bilingual.js | **dead file** (not loaded) — excluded |

- No `document.cookie`, no `indexedDB` in application code.
- Service worker Cache API namespaces (`sw.js`): `karim-erp-4.7.12`, `karim-static-*`,
  `karim-api-*` (network-first, 5 min TTL), `karim-images-*`, `karim-fonts-*` — deployment
  mechanics, not app state, but **version-bump choreography is mandatory on every migration
  release** (Phase 1A risk #4).

---

## 5. EVENT DEPENDENCY AUDIT

- **50 registered listeners** across 9 files (`audits/events.json`): app.js 16 · realtime.js 5 ·
  db-constraints-client.js 3 · icons.js 2 · scanner.js 1 · index.html 1 · *(pos.js 15, bilingual.js 1,
  pos-orders.js 6 — all in dead files)*.
- Heaviest: `click` 21 · `DOMContentLoaded` 8 · `keydown` 6 · `beforeinstallprompt` 2 ·
  `online`/`offline`/`visibilitychange` 2 each · `beforeunload` 1.
- **8 DOMContentLoaded handlers = per-script self-init convention.** Every script initializes
  itself; nothing cross-calls init. This is ESM-friendly and must be preserved 1:1.
- **Socket.io events (realtime.js), 18 types:** `connect`, `disconnect`, `reconnect_attempt`,
  `reconnect_failed`, `pong_check`, `clients_list`, `device_connected`, `device_disconnected`,
  `state_updated`, `sale:completed`, `yarasoft:imported`, `yarasoft:needs-mapping`,
  `yarasoft:oracle-sync`, `biometric:punch`, `biometric:synced`, `biometric:unmapped`,
  `entity_changed`, `incoming_notification`/`notification`.
- **Zero custom DOM events** (`dispatchEvent`/`CustomEvent` unused) — cross-module communication
  is direct function calls + globals, which the bridge and router modules must replicate.

---

## 6. DETAILED INITIALIZATION ORDER (exact, line-referenced)

1. **Vendor (async, unordered):** `chart.umd` (index:42), `xlsx.full` (43), `html5-qrcode` (44).
2. **`defer` chain (strict order, index:45,232–237):** `socket.io` → `icons.js` → `qrcode.min` →
   `db-constraints-client.js` → **`app.js?v=4.7.117`** → `scanner.js` → `realtime.js?v=4.7.117`.
3. **app.js top-level evaluation:** consts `CONFIG`(4), `API_BASE`(7), `STATE`(234)+`window.STATE`(251),
   `PERSISTED_ENTITIES`(18) → `I18N`(259) → `apiFetch`(32) → utils → 800 hoisted declarations →
   section state objects → **`exposeLoginCriticalGlobals` IIFE (11735)** — exists because a past bug
   required login functions before boot; the comment at 11731 documents the contract →
   `DOMContentLoaded` registration (11813).
4. **Boot (async, 11813):** `await initDatabase()` (916: `/api/health`) → `refreshSession()` →
   session ? `enterApp()` → `buildNav()` → `renderPage()` → `refreshNotifications()` : login screen.
   **Inside this callback:** the bulk of the 259 `window.*` export blocks → these bindings do NOT
   exist until boot completes; only the IIFE-exposed login set exists earlier.
5. **After app.js (same defer pass):** `scanner.js` self-init (its own DOMContentLoaded) →
   `realtime.js`: socket connect + the 5-contract consumption (STATE/toast/renderPage/_jwt/…).
6. **Enhancement Pack v10** second DOMContentLoaded (12314).
7. **`window load`** (inline index:238): service-worker registration.

**Timing invariants to preserve:** (a) login globals before any boot failure path; (b) realtime.js
starts only after app.js evaluated; (c) export blocks reachable only after health check — any
module touching `window.STATE` must tolerate pre-boot absence exactly as today.

---

## 7. CIRCULAR DEPENDENCY ANALYSIS

No file-level cycles exist today (single file). Post-split **potential** cycles:

| Cycle | Evidence | Resolution strategy |
|---|---|---|
| navigation ↔ features | `renderPage()` dispatches to ~20 `render*Page()`; pages call `go()` | **Router registry:** `features/navigation` owns `renderPage`; features register `{page: renderFn}` in a registry module; `go()` imports only the registry — no cycle |
| auth ↔ navigation | `enterApp()` → `buildNav()`; logout → login screen | auth emits through a tiny `session-events` module OR calls navigation via registry (late binding) |
| features ↔ ui/modal | every feature calls `showModal`; modal buttons call feature callbacks | callbacks are passed as values (no import needed) — keep `ui/modal` a pure leaf |
| realtime ↔ app | realtime consumes STATE/toast/renderPage | one-way leaf consumption via bridge — **no import from app into realtime**; keep as is |

ESM live-bindings note: cycles that do remain are resolved by function declarations (hoisted,
callable before module body completes) — each accepted cycle gets a documented justification in
MIGRATION_CHANGE_LOG.md.

---

## 8. COMPATIBILITY CONTRACT (must remain byte-for-byte observable)

1. All 259 explicit `window.*` bindings exist (names AND timing class).
2. All 415 auto-global inline-consumed functions are on `window` before first render that emits them.
3. realtime.js contract: `STATE`, `toast`, `renderPage`, `zkPortalPunchHandler`, `_jwt` unchanged.
4. index.html: not modified except (if unavoidable) module-loading attributes; 12 handlers work.
5. `apiFetch` semantics: headers, 30 s abort, 429-retry, error propagation — identical.
6. All 188 endpoints: same URLs/methods/payloads/order — verified by network diff.
7. Boot sequence §6, including pre-boot login-globals guarantee and post-health export timing.
8. Storage keys `karim_lang` semantics; sw.js caches untouched except coordinated version bumps.
9. All socket.io subscriptions and handlers behavior.
10. Generated HTML: ids/classes/attributes/structure byte-identical (DOM diff).
11. Print windows behavior (`window.onload→print`) unchanged.
12. `PERSISTED_ENTITIES` boot fan-out incl. role exclusions and 403-suppression behavior.
13. Zero new console errors/warnings on login + every page.
14. Version/caching choreography: entry `?v=` + `CACHE_VERSION` bump per release, Capacitor copy sync.

---

## 9. FULL RISK CLASSIFICATION (per extraction unit)

| Module (target) | Risk | Justification |
|---|---|---|
| core/utils | **LOW** | pure helpers; no state |
| core/i18n | **LOW** | 49 fns, one storage key, self-contained dictionary |
| icons (merge) | **LOW** | already isolated file |
| pwa | **LOW** | 2 listeners, no inbound deps |
| core/config | **LOW-MED** | leaf, but everything imports it — extract early, freeze API |
| core/state | **MED** | window.STATE contract with realtime; fan-out lists live here |
| core/api | **MED** | auth+timeout+429 semantics; must remain single instance |
| ui/modal + toast | **MED** | inbound from every module; toast is a realtime contract |
| integrations/oracle | **MED** | own namespace ORADATA, zero inbound; page-size moderate |
| integrations/whatsapp | **MED** | WASTATE, 45 fns, socket event handlers touch STATE |
| integrations/zkteco | **MED-HIGH** | ZKSTATE + `zkPortalPunchHandler` is consumed by realtime (4×) |
| integrations/yarasoft | **MED-HIGH** | 55 fns + 3 socket event couplings |
| smart-card | **MED** | 2 sections, print/QR flows |
| bulk-import | **MED** | 23 fns, own BULK_IMPORT_ROWS, wizard modals |
| dashboard / employee-portal / notifications | **MED-HIGH** | charts wiring + STATE fan-out |
| employees / departments | **HIGH** | heavy STATE cross-calls; linkedEmployeeForUser consumed by USERS section |
| warehouse+shelves+weight | **HIGH** | 117+ fns, procurement endpoints, updateApproveTotal pattern |
| kitchen+recipes | **HIGH** | 116+ fns, the one raw fetch (image upload), production modals |
| finance (revenues/cost/P&L/CFO) | **HIGH** | cross-links to reports; print flows |
| HR suite (attendance/leaves/payroll/hr-departments/hr-dashboard) | **HIGH** | 24+ fns each, biometric socket integration |
| reports (+print generators) | **HIGH** | full-document templates with inline scripts |
| settings+users | **HIGH** | linkedEmployeeForUser coupling, admin actions |
| **features/auth** | **CRITICAL** | `_jwt`/`_appKey` state, pre-boot IIFE, session lifecycle, forgot-password flow |
| **features/navigation** | **CRITICAL** | renderPage dispatch table = the app's spine; consumed by realtime (10×) |
| **bridges/window-exports** | **CRITICAL** | single point guaranteeing classes A+B+D; must be generated + assertion-tested |
| **boot orchestration (app.js)** | **CRITICAL** | order invariants §6; a mistake here breaks login for everyone |

---

## STOP — PHASE 1B COMPLETE

Awaiting explicit Phase-3 token (`APPROVED` / `PROCEED` / `START PHASE 3` / `BEGIN MIGRATION`).
No code changed; production server untouched. Analyzer is read-only and re-runnable.
