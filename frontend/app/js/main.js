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

import { pwaInstall, pwaUpdateOfflineBar } from './core/pwa.js';
import { I18N, t, readLangLocal, persistLangLocal, ROLE_NAMES, MENU_STRINGS, applyI18nMaps, applyLangAttrs, applyLoginI18n } from './core/i18n.js';

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
