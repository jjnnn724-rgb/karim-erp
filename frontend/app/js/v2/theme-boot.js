/**
 * V2 — Theme boot (no-flash)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS IS A SEPARATE, NON-DEFERRED, NON-MODULE FILE
 *
 * 1. NOT INLINE. The app serves — measured on LAN and on the public tunnel:
 *      Content-Security-Policy: … script-src 'self'; script-src-attr 'none' …
 *    script-src carries neither 'unsafe-inline' nor a nonce, so any inline
 *    <script> is blocked outright. index.html
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

    /* ── MOOD BOOT («المزاج») ────────────────────────────────────────────
       Opt-in only: ?mood=workshop|museum|copper on the URL lights that room
       for this page load. Nothing is stored, so a demo link can never leave
       a real shift stuck in the wrong palette — closing the tab ends it.
       ?mood=off is an explicit reset for links that were bookmarked.

       Absent the parameter we set no attribute at all, and css/v2/erp-moods.css
       then declares nothing for the active tree: the identity palette renders
       byte-for-byte as before. That inertness is proven in tests/v2-moods.test.js
       and was measured in the browser (identical PNG, identical token values). */
    try {
        const MOODS = ['workshop', 'museum', 'copper'];
        const mood = new URLSearchParams(location.search).get('mood');
        if (mood === 'off') {
            document.documentElement.removeAttribute('data-mood');
        } else if (mood && MOODS.includes(mood)) {
            document.documentElement.setAttribute('data-mood', mood);
        }
    } catch {
        /* No URLSearchParams / opaque location → stay on the identity palette. */
    }
})();
