/**
 * main.js — ESM entry point for extracted Karim ERP modules.
 *
 * Loading contract (index.html): this module tag is placed BEFORE the classic
 * `defer` scripts (app.js, scanner.js, realtime.js). Deferred scripts and module
 * scripts execute in document order, so every window bridge below exists before
 * app.js evaluates — preserving classic-script global semantics exactly.
 *
 * Bridge policy: every `window.*` assignment here is a temporary compatibility
 * bridge tracked in docs/esm-migration/DEPRECATION_LOG.md.
 */

self.__mk = ['entry'];
const mk=(s)=>self.__mk.push(s);
import { pwaInstall, pwaUpdateOfflineBar } from './core/pwa.js';
import { I18N, t, readLangLocal, persistLangLocal, ROLE_NAMES, MENU_STRINGS, applyI18nMaps, applyLangAttrs, applyLoginI18n } from './core/i18n.js';
import { uid, esc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT } from './core/utils.js';
import { toast, showLoad, hideLoad } from './ui/toast.js';
import { STATE, PERSISTED_ENTITIES, ROLE_ENTITY_EXCLUSIONS } from './core/state.js';
import { API_BASE, apiFetch, SERVER_CODE_AR, serverErrorInfo } from './core/api.js';
import { CONFIG, ROLES } from './core/config.js';

// BRIDGE-001: PWA — extracted from app.js (2026-09-27)
window.pwaInstall = pwaInstall;
window.pwaUpdateOfflineBar = pwaUpdateOfflineBar;
mk('after:undefined');

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
mk('after:undefined');

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
mk('after:undefined');

// BRIDGE-004: toast + loading overlay — extracted from app.js (2026-09-27)
window.toast = toast;
window.showLoad = showLoad;
window.hideLoad = hideLoad;
mk('after:undefined');

// BRIDGE-005: central STATE + entity registry — extracted from app.js (2026-09-27)
// window.STATE is the frozen realtime.js contract (entity_changed sync, 17 refs).
window.STATE = STATE;
window.PERSISTED_ENTITIES = PERSISTED_ENTITIES;
window.ROLE_ENTITY_EXCLUSIONS = ROLE_ENTITY_EXCLUSIONS;
mk('after:undefined');

// BRIDGE-006: unified API client — extracted from app.js (2026-09-27)
// realtime.js reads window.API_BASE as an optional fallback (same value it computes itself).
window.API_BASE = API_BASE;
window.apiFetch = apiFetch;
window.SERVER_CODE_AR = SERVER_CODE_AR;
window.serverErrorInfo = serverErrorInfo;
mk('after:undefined');

// BRIDGE-007: config — extracted from app.js (2026-09-27)
window.CONFIG = CONFIG;
window.ROLES = ROLES;
mk('after:=');

// BRIDGE-008/009/010: feature modules — extracted from app.js (2026-09-27)
// Feature modules are imported DYNAMICALLY after the spine bridges above are mounted:
// several of them execute statements at module-evaluation time that read window.STATE /
// window.ROLES (in app.js those statements ran after those globals existed). Static
// imports would evaluate them BEFORE the bridges — breaking the graph. Top-level await
// keeps the deferred-script ordering: app.js (next defer) waits until this resolves.
mk('before-dynamic');
const smartCard = await import('./features/smart-card.js');
Object.assign(window, smartCard);   // BRIDGE-008

const bulkImport = await import('./features/bulk-import.js');
Object.assign(window, bulkImport);  // BRIDGE-009

const zkteco = await import('./features/zkteco.js');
Object.assign(window, zkteco);      // BRIDGE-010
mk('done');
