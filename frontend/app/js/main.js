/**
 * main.js — ESM entry point for extracted Karim ERP modules.
 *
 * Loading contract (index.html): this module tag is placed BEFORE the classic
 * `defer` scripts (app.js, scanner.js, realtime.js). Deferred scripts and module
 * scripts execute in document order, so every window bridge below exists before
 * app.js evaluates — preserving classic-script global semantics exactly.
 *
 * CACHE-BUSTING DISCIPLINE (hard rule, learned 2026-09-27): EVERY import specifier
 * below AND the index.html tags must share the same ?v= version, bumped on every
 * extraction commit. Express static sends no Cache-Control, so Chromium's memory
 * cache serves unversioned URLs stale within a session — a stale module graph dies
 * silently at the login screen.
 *
 * Feature modules are imported DYNAMICALLY after the spine bridges: several of them
 * execute statements at module-evaluation time that read window.STATE / window.ROLES
 * (in app.js those ran after those globals existed). Top-level await keeps deferred
 * script ordering: app.js (next defer) waits until this module fully resolves.
 *
 * Bridge policy: every `window.*` assignment here is a temporary compatibility
 * bridge tracked in docs/esm-migration/DEPRECATION_LOG.md.
 */

import { pwaInstall, pwaUpdateOfflineBar } from './core/pwa.js?v=4.9.1';
import { I18N, t, readLangLocal, persistLangLocal, ROLE_NAMES, MENU_STRINGS, applyI18nMaps, applyLangAttrs, applyLoginI18n } from './core/i18n.js?v=4.9.1';
import { uid, esc, safeImgSrc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT } from './core/utils.js?v=4.9.1';
import { toast, showLoad, hideLoad } from './ui/toast.js?v=4.9.1';
import { STATE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS } from './core/state.js?v=4.9.1';
import { API_BASE, apiFetch, SERVER_CODE_AR, serverErrorInfo } from './core/api.js?v=4.9.1';
import { CONFIG, ROLES } from './core/config.js?v=4.9.1';
import { initDatabase, loadData, saveData, uiPreferencesPayload } from './core/storage.js?v=4.9.1';
import * as authNav from './features/auth-navigation.js?v=4.9.1';
import * as pageRouter from './features/page-router.js?v=4.9.1';

// BRIDGE-001: PWA — extracted from app.js (2026-09-27)
window.pwaInstall = pwaInstall;
window.pwaUpdateOfflineBar = pwaUpdateOfflineBar;

// BRIDGE-002: I18N core — extracted from app.js (2026-09-27)
// app.js consumes these via bare identifiers (classic-script global lookup → window).
window.I18N = I18N;
window.t = t;
window.readLangLocal = readLangLocal;
window.persistLangLocal = persistLangLocal;
window.ROLE_NAMES = ROLE_NAMES;
window.MENU_STRINGS = MENU_STRINGS;
window.applyI18nMaps = applyI18nMaps;
window.applyLangAttrs = applyLangAttrs;
window.applyLoginI18n = applyLoginI18n;

// BRIDGE-003: utils + Hijri — extracted from app.js (2026-09-27)
window.uid = uid;
window.esc = esc;
window.today = today;
window.nowTime = nowTime;
window.fN = fN;
window.fC = fC;
window.fD = fD;
window.fHijri = fHijri;
window.HIJRI_MONTHS = HIJRI_MONTHS;
window.gregToHijriParts = gregToHijriParts;
window.hijriToGregorian = hijriToGregorian;
window.hijriDateField = hijriDateField;
window.toggleDateMode = toggleDateMode;
window.syncGregToHijri = syncGregToHijri;
window.syncHijriToGreg = syncHijriToGreg;
window.fDT = fDT;

// BRIDGE-004: toast + loading overlay — extracted from app.js (2026-09-27)
window.toast = toast;
window.showLoad = showLoad;
window.hideLoad = hideLoad;

// BRIDGE-005: central STATE + entity registry — extracted from app.js (2026-09-27)
// window.STATE is the frozen realtime.js contract (entity_changed sync, 17 refs).
window.STATE = STATE;
window.PERSISTED_ENTITIES = PERSISTED_ENTITIES;
window.ROLE_ENTITY_EXCLUSIONS = ROLE_ENTITY_EXCLUSIONS;

// BRIDGE-006: unified API client — extracted from app.js (2026-09-27)
// realtime.js reads window.API_BASE as an optional fallback (same value it computes itself).
window.API_BASE = API_BASE;
window.apiFetch = apiFetch;
window.SERVER_CODE_AR = SERVER_CODE_AR;
window.serverErrorInfo = serverErrorInfo;

// BRIDGE-007: config — extracted from app.js (2026-09-27)
window.CONFIG = CONFIG;
window.ROLES = ROLES;

// BRIDGE-025: storage — extracted from app.js (2026-09-27)
window.initDatabase = initDatabase;
window.loadData = loadData;
window.saveData = saveData;
window.uiPreferencesPayload = uiPreferencesPayload;

// READINESS GATE (2026-09-30): سكربتات defer الكلاسيكية (app.js) كانت تعمل
// قبل اكتمال الجسر الديناميكي فتسقط بـ ReferenceError. هذا الوعد يُحل في نهاية
// الملف — app.js ينتظره (مع مهلة أمان) قبل أي تهيئة.
let __karimReadyResolve = null;
window.__karimBridgesReady = false;
window.__karimReady = new Promise((res) => { __karimReadyResolve = res; });

// BRIDGE-008/009/010: feature modules — extracted from app.js (2026-09-27)
// FAIL-ISOLATION (2026-09-30): وحدة واحدة فاشلة كانت تقتل الجسر كله → زر الدخول
// ميت + صفحات فارغة بلا أي رسالة. كل وحدة الآن معزولة: تفشل وحدها ويُسجَّل
// اسمها في الكونسول، وبقية النظام (الدخول + الصفحات) يعمل.
async function safeBridge(path, tag) {
  try { Object.assign(window, await import(path)); }
  catch (e) { console.error('[BRIDGE-FAIL]', tag, path, e); }
}
await safeBridge('./features/smart-card.js?v=4.9.1', 'BRIDGE-008');

await safeBridge('./features/bulk-import.js?v=4.9.1', 'BRIDGE-009');

await safeBridge('./features/zkteco.js?v=4.9.1', 'BRIDGE-010');

await safeBridge('./features/kitchen.js?v=4.9.1', 'BRIDGE-013');

await safeBridge('./features/finance.js?v=4.9.1', 'BRIDGE-014');

await safeBridge('./features/hr.js?v=4.9.1', 'BRIDGE-015');

await safeBridge('./features/yarasoft.js?v=4.9.1', 'BRIDGE-016');

await safeBridge('./features/whatsapp.js?v=4.9.1', 'BRIDGE-017');

await safeBridge('./features/departments.js?v=4.9.1', 'BRIDGE-018');

await safeBridge('./features/reports.js?v=4.9.1', 'BRIDGE-019');

await safeBridge('./features/settings-users.js?v=4.9.1', 'BRIDGE-020');

await safeBridge('./features/permissions.js?v=4.9.1', 'BRIDGE-PERM');

await safeBridge('./features/cfo.js?v=4.9.1', 'BRIDGE-021');

await safeBridge('./features/dashboard.js?v=4.9.1', 'BRIDGE-022');

await safeBridge('./features/employee-portal.js?v=4.9.1', 'BRIDGE-023');

await safeBridge('./ui/enhancement.js?v=4.9.1', 'BRIDGE-024');

await safeBridge('./features/auth-navigation.js?v=4.9.1', 'BRIDGE-026');

await safeBridge('./features/roster.js?v=4.9.1', 'BRIDGE-ROSTER');

await safeBridge('./features/page-router.js?v=4.9.1', 'BRIDGE-027');

// BRIDGE-029: mobile shell — تجربة الجوال + البصمة الذاتية (SPEC-employee-pwa-attendance-geofence-v1)
const mobileShell = await import('./features/mobile-shell.js?v=4.9.1');
Object.assign(window, mobileShell);

const deptEmployees = await import('./features/dept-employees.js?v=4.9.1');
Object.assign(window, deptEmployees);   // BRIDGE-030: إدارة موظفي القسم لرئيس القسم

const employees = await import('./features/employees.js?v=4.9.1');
Object.assign(window, employees);   // BRIDGE-011

const warehouse = await import('./features/warehouse.js?v=4.9.1');
Object.assign(window, warehouse);   // BRIDGE-012


// BRIDGE-028: login-critical exposure + button binding (moved verbatim from app.js IIFE).
// Runs AFTER all dynamic imports settle — bare names resolve to window (bridged above).
// MUST stay before DOMContentLoaded fires (module TLA delays DOMC — contract preserved).
(function exposeLoginCriticalGlobals(){
  const w = window;
  // Auth & login
  w.completeRequiredPasswordChange = typeof w.completeRequiredPasswordChange !== 'undefined' ? w.completeRequiredPasswordChange : null;
  w.enterApp = typeof w.enterApp !== 'undefined' ? w.enterApp : null;
  // Forgot password flow
  w.submitForgotPassword = typeof w.submitForgotPassword !== 'undefined' ? w.submitForgotPassword : null;
  w.fpFail = typeof w.fpFail !== 'undefined' ? w.fpFail : null;
  w.issueResetCode = typeof w.issueResetCode !== 'undefined' ? w.issueResetCode : null;
  w.copyResetCode = typeof w.copyResetCode !== 'undefined' ? w.copyResetCode : null;
  // Session refresh & tokens
  // UI toggles used before/after login
  w.toggleSidebar = typeof w.toggleSidebar !== 'undefined' ? w.toggleSidebar : null;
  w.toggleFabMenu = typeof w.toggleFabMenu !== 'undefined' ? w.toggleFabMenu : null;
  // PWA — extracted to js/core/pwa.js (bridged by js/main.js — BRIDGE-001)
  // Navigation (used by FAB menu even before login)
  w.go = typeof w.go !== 'undefined' ? w.go : function(){};
  // Modals & toasts
  w.closeModal = typeof w.closeModal !== 'undefined' ? w.closeModal : function(){};
  // toast → js/ui/toast.js (BRIDGE-004 — main.js يعرّفها على window قبل app.js)
  w.showModal = typeof w.showModal !== 'undefined' ? w.showModal : function(){};
  // showLoad → js/ui/toast.js (BRIDGE-004)
  // hideLoad → js/ui/toast.js (BRIDGE-004)
  // Health/init
  // I18n login screen
  // Date helpers
  w.toggleDateMode = typeof w.toggleDateMode !== 'undefined' ? w.toggleDateMode : function(){};
  w.syncGregToHijri = typeof w.syncGregToHijri !== 'undefined' ? w.syncGregToHijri : function(){};
  w.syncHijriToGreg = typeof w.syncHijriToGreg !== 'undefined' ? w.syncHijriToGreg : function(){};
  // Command palette (keyboard shortcut Ctrl+K)
  w.openCommandPalette = typeof w.openCommandPalette !== 'undefined' ? w.openCommandPalette : function(){};
  w.closeCommandPalette = typeof w.closeCommandPalette !== 'undefined' ? w.closeCommandPalette : function(){};
  w.handleCommandKey = typeof w.handleCommandKey !== 'undefined' ? w.handleCommandKey : function(){};
  // FAB actions visible even before login
  w.showDispatchRequestModal = typeof w.showDispatchRequestModal !== 'undefined' ? w.showDispatchRequestModal : function(){};
  w.showAddRevenueModal = typeof w.showAddRevenueModal !== 'undefined' ? w.showAddRevenueModal : function(){};
  w.showAddExpenseModal = typeof w.showAddExpenseModal !== 'undefined' ? w.showAddExpenseModal : function(){};
  // Notifications
  w.openNotification = typeof w.openNotification !== 'undefined' ? w.openNotification : function(){};
  w.navigateNotification = typeof w.navigateNotification !== 'undefined' ? w.navigateNotification : function(){};
  w.refreshNotifications = typeof w.refreshNotifications !== 'undefined' ? w.refreshNotifications : function(){};

  const loginButton = document.getElementById('loginBtn');
  if (loginButton && !loginButton.dataset.loginBound) {
    // Lazy lookup at CLICK time (not bridge time): even if auth module bridged
    // late, the button always finds doLogin. Never binds undefined.
    loginButton.addEventListener('click', (...a) => window.doLogin?.(...a));
    loginButton.dataset.loginBound = 'true';
  }
  const passwordInput = document.getElementById('lp');
  if (passwordInput && !passwordInput.dataset.loginBound) {
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { window.doLogin?.(); }
    });
    passwordInput.dataset.loginBound = 'true';
  }
})();

// All bridges settled (each isolated by safeBridge) — release classic scripts.
window.__karimBridgesReady = true;
if (typeof __karimReadyResolve === 'function') { __karimReadyResolve(); }
try { document.dispatchEvent(new Event('karim:bridges-ready')); } catch (_) {}
