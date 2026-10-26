/**
 * V2 — Theme boot (no-flash)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS IS A SEPARATE, NON-DEFERRED, NON-MODULE FILE
 *
 * 1. NOT INLINE. The app serves
 *      Content-Security-Policy: script-src 'self' 'nonce-<per response>' …
 *    Because a nonce is present, 'unsafe-inline' in the same list is ignored
 *    by the browser, so any inline <script> is silently blocked. index.html
 *    therefore contains zero inline scripts — that is this codebase's
 *    convention and this file follows it. (Verified: v2.html originally had
 *    the theme boot inline and the console reported "Executing inline script
 *    violates … Content Security Policy" for it.)
 *
 * 2. NOT DEFERRED, NOT A MODULE. Both of those run *after* HTML parsing,
 *    which is after the browser may already have painted the wrong theme.
 *    A classic blocking <script src> in <head> executes while the document
 *    is still being parsed, so <html data-theme> is correct before the first
 *    paint. That is the whole point of this file.
 *
 * 3. NO IMPORTS. It must not wait on the module graph; it is ~20 lines and
 *    must resolve on its own.
 *
 * It only *reads* the preference and sets the attribute. theme.js owns every
 * subsequent write. If this file fails for any reason the page still ends up
 * on the right theme — theme.js applies it on module load, just one frame
 * later (and 'light' is the deterministic default, never a black flash).
 *
 * Keeps its key in sync with theme.js PREF_KEY ('erp.v2.theme.pref').
 */
(function () {
    const PREF_KEY = 'erp.v2.theme.pref';
    let theme = 'light'; // deterministic default if anything below throws

    try {
        const pref = localStorage.getItem(PREF_KEY);
        /* 2026-10-25: default is LIGHT unless the user explicitly stored a
           pref. The old system-dark boot made dark-OS machines open the emerald
           shell and read it as the product («اللون غامق مش احترافي»). */
        if (pref === 'light' || pref === 'dark') {
            theme = pref;
        }
    } catch {
        /* Storage blocked (private mode) → keep 'light'. */
    }

    document.documentElement.setAttribute('data-theme', theme);
})();
