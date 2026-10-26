# PHASE 1A — STRUCTURAL ANALYSIS (Karim ERP Frontend → Native ESM)

**Date:** 2026-09-27
**Status:** ANALYSIS ONLY — no code was modified. The running server (port 5000) was not touched.
**Source of truth analyzed:** `frontend/app/js/app.js` (12,352 lines, ~1.0 MB) + `index.html` (248 lines) + sibling scripts + `sw.js`.

> ملاحظة: التوجيه يفترض ملفًا واحدًا 5,500 سطر. الواقع: `app.js` = 12,352 سطرًا، ويوجد
> 6 سكربتات شقيقة محمّلة بالفعل + service worker + نسخة Capacitor للأندرويد. التحليل مبني على الواقع الفعلي.

---

## 1. HIGH-LEVEL DIRECTORY TREE (proposed — follows actual dependencies)

```
frontend/app/js/
├── app.js                        # Bootstrap ONLY (entry, <300 lines target): boot orchestration + bridges mount
├── core/
│   ├── config.js                 # CONFIG, API_BASE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS, version constants
│   ├── state.js                  # STATE singleton (24 entity arrays) + window.STATE bridge
│   ├── api.js                    # apiFetch (auth headers, 30s timeout, 429 retry) — SINGLE shared instance
│   ├── i18n.js                   # I18N dictionary (~650 lines), applyI18n, lang direction, localStorage 'karim_lang'
│   ├── utils.js                  # uid, esc, fN, date/money formatters, helpers
│   └── icons.js                  # existing icons.js (already isolated — merge as-is)
├── ui/
│   ├── modal.js                  # showModal/closeModal + modal infra (used by every feature)
│   ├── toast.js                  # toast() — consumed by realtime.js via window.toast
│   ├── tables.js                 # table/pagination/sorting renderers (deduced from page sections)
│   └── charts.js                 # Chart.js wiring (dashboard, HR, CFO charts)
├── features/
│   ├── auth/                     # doLogin, refreshSession, completeRequiredPasswordChange, forgot-password, enterApp/logout
│   ├── navigation/               # go(), buildNav(), renderPage() dispatcher, sidebar/theme/lang/FAB toggles
│   ├── dashboard/                # admin dashboard + charts (dashboardChartDays)
│   ├── employee-portal/          # renderEmployeePortal
│   ├── smart-card/               # generateFingerprintSync, renderSmartCard
│   ├── bulk-import/              # BULK_IMPORT_ROWS + wizard UI
│   ├── employees/                # renderEmployeesPage + employee CRUD
│   ├── departments/              # renderDepartments + DEPARTMENT_ICON_OPTIONS
│   ├── hr/                       # hr-dashboard, attendance, leaves, hr-departments, payroll, contracts, evaluations
│   ├── warehouse/                # renderWarehouse, shelves, weight readings, purchase requests
│   ├── kitchen/                  # kitchen & dispatch, recipes (+ syncRecipeToCashier)
│   ├── finance/                  # revenues, expenses, cost analysis, P&L, CFO (journal/trial-balance)
│   ├── reports/                  # renderReports (+ print/monthly-report HTML generators)
│   ├── settings/                 # renderSettings, users management
│   ├── notifications/            # notifications state + refreshNotifications + showNotifications
│   ├── integrations/oracle/      # ORADATA browser page (own state namespace)
│   ├── integrations/yarasoft/    # YSSTATE import page (own state namespace)
│   ├── integrations/zkteco/      # ZKSTATE biometric page (own state namespace)
│   └── integrations/whatsapp/    # WASTATE engine page (own state namespace)
├── pwa/                          # PWA install prompt + offline bar (currently lines 11702–11729)
└── bridges/
    └── window-exports.js         # THE compatibility bridge: all window.* bindings, generated & tracked
```

**Principles applied:** the 4 integrations already have private state namespaces (`ORADATA`,
`YSSTATE`, `ZKSTATE`, `WASTATE`) → clean module boundaries. Cohesion over size: the 35 existing
section banners in app.js map 1:1 onto feature modules.

---

## 2. HIGH-LEVEL DEPENDENCY MAP

```
                    ┌──────────────────────────────────────────────┐
                    │ index.html (19 inline handlers → 12 fns)     │
                    └──────────────┬───────────────────────────────┘
   defer order: socket.io → icons → qrcode → db-constraints-client
                          → app.js → scanner.js → realtime.js
                                   │
        ┌──────────────────────────┼──────────────────────────────┐
        ▼                          ▼                              ▼
   core/config.js ←── core/state.js (window.STATE) ←── realtime.js (17 refs)
        │                          │                          ▲
        ▼                          ▼                     (also: window.toast ×11,
   core/api.js (apiFetch ×215     ALL features                      window._rtRegisterUser ×4,
   + 18 raw fetch)                  │  │                           window._jwt ×2)
        ▲                           │  │
        └──────────── ui/modal, ui/toast ←──── every feature module
                                    │
             bridges/window-exports.js ←── 376 fn names used in generated
                                    │       onclick="..." template strings
             features/auth (window._jwt, window._appKey) ── 12 index.html handlers
```

- **Everything** depends on: config, state, api, ui/modal, ui/toast, navigation (go/renderPage).
- **Leaf candidates** (nothing depends on them): oracle, whatsapp, zkteco, yarasoft, smart-card,
  bulk-import, pwa.
- **Cycles:** none confirmed at file level (single file today). *Potential* cycles after split:
  `navigation ↔ features/*` (renderPage dispatches to render*Page; pages call `go()`),
  `auth ↔ navigation` (enterApp → buildNav). Resolution strategy: dispatch via a shared
  router registry module, or late-bound imports — decided in Phase 1B with exact call sites.
- **Cross-script contracts (must not privatize):** `window.STATE`, `window.toast`,
  `window._rtRegisterUser`, `window._jwt`, `window._appKey` (consumed by realtime.js/scanner.js),
  12 functions in index.html handlers, 376 functions in app.js-generated onclick strings.

---

## 3. RISK SUMMARY — TOP 10

| # | Risk | Why |
|---|------|-----|
| 1 | **376 inline `onclick="fn()"` in generated template strings** | The dominant contract. Every moved function must remain on `window` (bridge) — one missed export = a dead button somewhere. |
| 2 | **261 unique `window.*` assignments** | Deliberate export blocks exist per section. Converting any to private module vars without consumer audit breaks siblings (realtime.js), index.html, and generated HTML. |
| 3 | **Boot-order fragility** | `exposeLoginCriticalGlobals` IIFE exists precisely because login fns MUST exist before `DOMContentLoaded` (a past bug). Most window.* exports happen INSIDE the async boot callback — after `initDatabase()`/`refreshSession()` resolve. ESM hoisting/evaluation will silently change this timing. |
| 4 | **Cache-staleness across split files** | Today one cached asset (`?v=4.7.117`) + sw.js `cache-first` (`CACHE_VERSION '4.7.12'`). A split with stale caches = mixed OLD+NEW module versions on LAN clients — the most subtle breakage class. Every release must atomically bump sw version + entry `?v=`. |
| 5 | **HTTP/1.1 6-connection limit** | Express serves HTTP/1.1 (no h2). Native ESM with 40+ module files → waterfall loading on first visit. Mitigation: modest module count (~25–35), single entry + static imports (no dynamic waterfall), or optional h2 upgrade. |
| 6 | **Two deployment targets** | Android Capacitor ships its own copy under `android/app/src/main/assets/public/` — must be synced on every migration release or the Android app diverges. |
| 7 | **STATE singleton with cross-script sync** | realtime.js writes `window.STATE` entity arrays on `entity_changed`. Splitting state consumers without the bridge invites stale-UI bugs. |
| 8 | **Single apiFetch auth semantics** | `window._jwt`/`window._appKey` + 429-retry + 30s abort are behavior-critical; duplicated API helpers would fork auth state. Exactly one api.js module. |
| 9 | **Print/report flows** | Several generators build complete HTML documents with inline `<script>window.onload=...print()</script>` inside template strings — easy to damage while moving; needs its own QA cases. |
| 10 | **800 top-level functions, implicit cross-section calls** | No module boundaries today: pages call each other's helpers freely. Each extraction needs a call-graph audit (Phase 1B) or runtime breakage appears only on specific pages. |

Bonus finding: version drift — `CONFIG.VERSION '4.6.20'` (app.js) vs backend `4.7.0` vs
`?v=4.7.117` vs sw `4.7.12`. Not a migration blocker, but cache-busting consistency is a
prerequisite for safe splits.

---

## 4. INITIALIZATION ORDER SNAPSHOT (current runtime truth)

1. **HTML parse:** vendor scripts `async` — `chart.umd`, `xlsx.full`, `html5-qrcode` (order not guaranteed).
2. **`defer` chain (strict document order):**
   `/socket.io/socket.io.js` → `icons.js` → `vendor/qrcode.min.js` → `db-constraints-client.js`
   → `app.js?v=4.7.117` → `scanner.js` → `realtime.js?v=4.7.117`.
3. **app.js top-level evaluation (in source order):**
   `CONFIG`/`API_BASE` consts → `STATE` declaration + `window.STATE` bridge →
   `PERSISTED_ENTITIES`/`ROLE_ENTITY_EXCLUSIONS` → `I18N` → `apiFetch` → utils →
   800 hoisted function declarations → section state objects (`ZKSTATE`, `YSSTATE`, `ORADATA`,
   `WASTATE`, `CFO_STATE`, `BULK_IMPORT_ROWS`, …) → **`exposeLoginCriticalGlobals` IIFE**
   (pre-boot exposure of login-screen functions) → `window.addEventListener('DOMContentLoaded', boot)`.
4. **DOMContentLoaded (async boot, line 11813):** `await initDatabase()` (health) →
   `refreshSession()` → session? `enterApp()` → `buildNav()` → `renderPage()` →
   `refreshNotifications()` : login screen. **Inside this callback:** the large
   `window.<fn> = <fn>` export blocks (kitchen, leaves, …).
5. **After app.js:** `scanner.js` init → `realtime.js`: socket.io connect, `window.STATE`
   entity sync, toast integration.
6. **Second `DOMContentLoaded` (line 12314):** Enhancement Pack v10.
7. **`window load` (inline in index.html):** service worker registration (`/app/sw.js`).

---

## 5. EXTRACTION ORDER PROPOSAL (LOW → CRITICAL, one atomic commit per extraction)

| Phase | Group | Items | Risk |
|-------|-------|-------|------|
| **P3.0** | Prerequisites | `git init` (project is NOT a git repo yet) → commit pristine baseline → tag `pre-esm-migration` → branch `refactor/esm-migration`; manual regression checklist (login, POS, attendance, warehouse, reports-print); DevTools network baseline | — |
| **P3.1** | Leaves | `core/utils.js`, `core/i18n.js`, icons merge, `pwa/` block | LOW |
| **P3.2** | Core spine | `core/config.js` → `core/state.js` (+window.STATE bridge) → `core/api.js` (single apiFetch) | LOW-MED |
| **P3.3** | Isolated pages (own state namespaces, zero inbound deps) | oracle → whatsapp → zkteco → yarasoft → smart-card → bulk-import | MEDIUM |
| **P3.4** | Shared UI | `ui/modal`, `ui/toast`, notifications, dashboard, employee-portal | MEDIUM-HIGH |
| **P3.5** | Domain pages | employees, departments, warehouse(+shelves/weight), kitchen(+recipes), finance(revenues/cost/P&L/CFO), HR suite, reports(+print), settings+users | HIGH |
| **P3.6** | Critical spine | `features/auth` (session/JWT), `features/navigation` (go/buildNav/renderPage), `bridges/window-exports.js` consolidation, boot orchestration into slim `app.js` | CRITICAL |
| **P3.7** | Finalization | bridge audit vs DEPRECATION_LOG, app.js <300 lines, FINAL_AUDIT.md | — |

**Verification gate after every extraction** (per directive §5 Phase 4): `node --check` on the
modified file, ESLint, browser smoke via automated GUI (login → nav → one page action per
migrated module), DevTools network diff, sw.js + `?v=` version bump when the served file set
changes.

**Deployment impact preview (full doc due in Phase 1B/2 per RULE #15):** HTTPS OK (trusted
mkcert CA installed), MIME `application/javascript` served by Express static = OK, CORS N/A
(same-origin), no h2 (mitigation above), sw.js version bump mandatory, Capacitor copy sync.

---

## STOP — PHASE 1A COMPLETE

Awaiting explicit approval (APPROVED / PROCEED / START PHASE 3 / BEGIN MIGRATION) before
Phase 1B detailed audits. No code has been changed; the production server is untouched.
