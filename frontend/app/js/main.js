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

import { pwaInstall, pwaUpdateOfflineBar } from './core/pwa.js?v=4.7.131';
import { I18N, t, readLangLocal, persistLangLocal, ROLE_NAMES, MENU_STRINGS, applyI18nMaps, applyLangAttrs, applyLoginI18n } from './core/i18n.js?v=4.7.131';
import { uid, esc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT } from './core/utils.js?v=4.7.131';
import { toast, showLoad, hideLoad } from './ui/toast.js?v=4.7.131';
import { STATE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS } from './core/state.js?v=4.7.131';
import { API_BASE, apiFetch, SERVER_CODE_AR, serverErrorInfo } from './core/api.js?v=4.7.131';
import { CONFIG, ROLES } from './core/config.js?v=4.7.131';

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

// BRIDGE-008/009/010: feature modules — extracted from app.js (2026-09-27)
const smartCard = await import('./features/smart-card.js?v=4.7.131');
Object.assign(window, smartCard);   // BRIDGE-008

const bulkImport = await import('./features/bulk-import.js?v=4.7.131');
Object.assign(window, bulkImport);  // BRIDGE-009

const zkteco = await import('./features/zkteco.js?v=4.7.131');
Object.assign(window, zkteco);      // BRIDGE-010

const kitchen = await import('./features/kitchen.js?v=4.7.134');
Object.assign(window, kitchen);     // BRIDGE-013

const finance = await import('./features/finance.js?v=4.7.135');
Object.assign(window, finance);     // BRIDGE-014

const hr = await import('./features/hr.js?v=4.7.136');
Object.assign(window, hr);          // BRIDGE-015

const yarasoft = await import('./features/yarasoft.js?v=4.7.137');
Object.assign(window, yarasoft);    // BRIDGE-016

const whatsapp = await import('./features/whatsapp.js?v=4.7.138');
Object.assign(window, whatsapp);    // BRIDGE-017

const departments = await import('./features/departments.js?v=4.7.139');
Object.assign(window, departments); // BRIDGE-018

const reports = await import('./features/reports.js?v=4.7.139');
Object.assign(window, reports);     // BRIDGE-019

const settingsUsers = await import('./features/settings-users.js?v=4.7.140');
Object.assign(window, settingsUsers); // BRIDGE-020

const cfo = await import('./features/cfo.js?v=4.7.140');
Object.assign(window, cfo);           // BRIDGE-021

const employees = await import('./features/employees.js?v=4.7.133');
Object.assign(window, employees);   // BRIDGE-011

const warehouse = await import('./features/warehouse.js?v=4.7.133');
Object.assign(window, warehouse);   // BRIDGE-012

