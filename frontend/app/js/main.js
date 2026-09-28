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

import { pwaInstall, pwaUpdateOfflineBar } from './core/pwa.js?v=4.7.132';
import { I18N, t, readLangLocal, persistLangLocal, ROLE_NAMES, MENU_STRINGS, applyI18nMaps, applyLangAttrs, applyLoginI18n } from './core/i18n.js?v=4.7.132';
import { uid, esc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT } from './core/utils.js?v=4.7.132';
import { toast, showLoad, hideLoad } from './ui/toast.js?v=4.7.132';
import { STATE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS } from './core/state.js?v=4.7.132';
import { API_BASE, apiFetch, SERVER_CODE_AR, serverErrorInfo } from './core/api.js?v=4.7.132';
import { CONFIG, ROLES } from './core/config.js?v=4.7.132';
import { initDatabase, loadData, saveData, uiPreferencesPayload } from './core/storage.js?v=4.7.142';
import * as authNav from './features/auth-navigation.js?v=4.7.178';
import * as pageRouter from './features/page-router.js?v=4.7.142';

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

// BRIDGE-008/009/010: feature modules — extracted from app.js (2026-09-27)
const smartCard = await import('./features/smart-card.js?v=4.7.178');
Object.assign(window, smartCard);   // BRIDGE-008

const bulkImport = await import('./features/bulk-import.js?v=4.7.132');
Object.assign(window, bulkImport);  // BRIDGE-009

const zkteco = await import('./features/zkteco.js?v=4.7.170');
Object.assign(window, zkteco);      // BRIDGE-010

const kitchen = await import('./features/kitchen.js?v=4.7.173');
Object.assign(window, kitchen);     // BRIDGE-013

const finance = await import('./features/finance.js?v=4.7.170');
Object.assign(window, finance);     // BRIDGE-014

const hr = await import('./features/hr.js?v=4.7.170');
Object.assign(window, hr);          // BRIDGE-015

const yarasoft = await import('./features/yarasoft.js?v=4.7.176');
Object.assign(window, yarasoft);    // BRIDGE-016

const whatsapp = await import('./features/whatsapp.js?v=4.7.170');
Object.assign(window, whatsapp);    // BRIDGE-017

const departments = await import('./features/departments.js?v=4.7.170');
Object.assign(window, departments); // BRIDGE-018

const reports = await import('./features/reports.js?v=4.7.139');
Object.assign(window, reports);     // BRIDGE-019

const settingsUsers = await import('./features/settings-users.js?v=4.7.170');
Object.assign(window, settingsUsers); // BRIDGE-020

const permissions = await import('./features/permissions.js?v=4.7.178');
Object.assign(window, permissions); // BRIDGE-PERM

const cfo = await import('./features/cfo.js?v=4.7.140');
Object.assign(window, cfo);           // BRIDGE-021

const dashboard = await import('./features/dashboard.js?v=4.7.170');
Object.assign(window, dashboard);     // BRIDGE-022

const employeePortal = await import('./features/employee-portal.js?v=4.7.141');
Object.assign(window, employeePortal); // BRIDGE-023

const authNavNS = await import('./features/auth-navigation.js?v=4.7.178');
Object.assign(window, authNavNS);     // BRIDGE-026

const pageRouterNS = await import('./features/page-router.js?v=4.7.142');
Object.assign(window, pageRouterNS);  // BRIDGE-027

// BRIDGE-029: mobile shell — تجربة الجوال + البصمة الذاتية (SPEC-employee-pwa-attendance-geofence-v1)
const mobileShell = await import('./features/mobile-shell.js?v=4.7.183');
Object.assign(window, mobileShell);

const employees = await import('./features/employees.js?v=4.7.175');
Object.assign(window, employees);   // BRIDGE-011

const warehouse = await import('./features/warehouse.js?v=4.7.174');
Object.assign(window, warehouse);   // BRIDGE-012


// BRIDGE-028: login-critical exposure + button binding (moved verbatim from app.js IIFE).
// Runs AFTER all dynamic imports settle — bare names resolve to window (bridged above).
// MUST stay before DOMContentLoaded fires (module TLA delays DOMC — contract preserved).
(function exposeLoginCriticalGlobals(){
// ============================================
(function exposeLoginCriticalGlobals(){
  const w = window;
  // Auth & login
  w.doLogin = doLogin;
  w.doLogout = doLogout;
  w.completeRequiredPasswordChange = typeof completeRequiredPasswordChange !== 'undefined' ? completeRequiredPasswordChange : null;
  w.enterApp = typeof enterApp !== 'undefined' ? enterApp : null;
  // Forgot password flow
  w.showForgotPasswordModal = showForgotPasswordModal;
  w.submitForgotPassword = typeof submitForgotPassword !== 'undefined' ? submitForgotPassword : null;
  w.fpFail = typeof fpFail !== 'undefined' ? fpFail : null;
  w.issueResetCode = typeof issueResetCode !== 'undefined' ? issueResetCode : null;
  w.copyResetCode = typeof copyResetCode !== 'undefined' ? copyResetCode : null;
  // Session refresh & tokens
  w.KARIM_RTget = KARIM_RTget;
  w.KARIM_RTset = KARIM_RTset;
  w.KARIM_RTclear = KARIM_RTclear;
  w.refreshSession = refreshSession;
  // UI toggles used before/after login
  w.toggleLang = toggleLang;
  w.toggleTheme = toggleTheme;
  w.toggleSidebar = typeof toggleSidebar !== 'undefined' ? toggleSidebar : null;
  w.toggleFabMenu = typeof toggleFabMenu !== 'undefined' ? toggleFabMenu : null;
  // PWA — extracted to js/core/pwa.js (bridged by js/main.js — BRIDGE-001)
  // Navigation (used by FAB menu even before login)
  w.go = typeof go !== 'undefined' ? go : function(){};
  // Modals & toasts
  w.closeModal = typeof closeModal !== 'undefined' ? closeModal : function(){};
  // toast → js/ui/toast.js (BRIDGE-004 — main.js يعرّفها على window قبل app.js)
  w.showModal = typeof showModal !== 'undefined' ? showModal : function(){};
  // showLoad → js/ui/toast.js (BRIDGE-004)
  // hideLoad → js/ui/toast.js (BRIDGE-004)
  // Health/init
  w.initDatabase = initDatabase;
  // I18n login screen
  w.applyLoginI18n = applyLoginI18n;
  w.applyLangAttrs = applyLangAttrs;
  // Date helpers
  w.toggleDateMode = typeof toggleDateMode !== 'undefined' ? toggleDateMode : function(){};
  w.syncGregToHijri = typeof syncGregToHijri !== 'undefined' ? syncGregToHijri : function(){};
  w.syncHijriToGreg = typeof syncHijriToGreg !== 'undefined' ? syncHijriToGreg : function(){};
  // Command palette (keyboard shortcut Ctrl+K)
  w.openCommandPalette = typeof openCommandPalette !== 'undefined' ? openCommandPalette : function(){};
  w.closeCommandPalette = typeof closeCommandPalette !== 'undefined' ? closeCommandPalette : function(){};
  w.handleCommandKey = typeof handleCommandKey !== 'undefined' ? handleCommandKey : function(){};
  // FAB actions visible even before login
  w.showDispatchRequestModal = typeof showDispatchRequestModal !== 'undefined' ? showDispatchRequestModal : function(){};
  w.showAddRevenueModal = typeof showAddRevenueModal !== 'undefined' ? showAddRevenueModal : function(){};
  w.showAddExpenseModal = typeof showAddExpenseModal !== 'undefined' ? showAddExpenseModal : function(){};
  // Notifications
  w.showNotifications = showNotifications;
  w.markAllNotificationsRead = markAllNotificationsRead;
  w.clearAllNotifications = clearAllNotifications;
  w.markNotificationRead = markNotificationRead;
  w.openNotification = typeof openNotification !== 'undefined' ? openNotification : function(){};
  w.navigateNotification = typeof navigateNotification !== 'undefined' ? navigateNotification : function(){};
  w.refreshNotifications = typeof refreshNotifications !== 'undefined' ? refreshNotifications : function(){};
  w.updateNotificationBadge = updateNotificationBadge;

  const loginButton = document.getElementById('loginBtn');
  if (loginButton && !loginButton.dataset.loginBound) {
    loginButton.addEventListener('click', doLogin);
    loginButton.dataset.loginBound = 'true';
  }
  const passwordInput = document.getElementById('lp');
  if (passwordInput && !passwordInput.dataset.loginBound) {
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { doLogin(); }
    });
    passwordInput.dataset.loginBound = 'true';
  }
})();
})();
