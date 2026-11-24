/**
 * V2 — Screen moods («المزاج على مستوى الشاشة»)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   The last, smallest piece of the moods layer. css/v2/erp-moods.css can
 *   re-light the whole system from one attribute; this module decides WHICH
 *   attribute a screen wears, so a report is read in the museum room while
 *   the dashboard stays in the identity room — without anyone typing a URL.
 *
 * WHY A MAP AND NOT A PER-SCREEN STYLESHEET
 *   A mood is a palette, and the palette is already a single contract
 *   (css/v2/erp-moods.css). Screens therefore need no CSS at all: they need
 *   one key → one name. Anything more would be a second design system.
 *
 * THE FOUR RULES THAT KEEP THIS SAFE
 *   1. The URL wins. `?mood=copper` (or `?mood=off`) is an explicit
 *      instruction from a human; a mapping table must never overrule it.
 *      `?mood=off` also disables the per-screen mapping — otherwise "off"
 *      would mean "off except the eleven screens I did not tell you about".
 *   2. Unmapped screens get the attribute REMOVED, not "default". Absence is
 *      the identity palette, which is the only state that is pixel-identical
 *      to the pre-moods tree.
 *   3. Nothing is stored. A mood is a property of where you are standing, not
 *      of who is signed in: no localStorage, no sessionStorage, no cookie.
 *      Closing the tab ends it, and a shared link can never trap a shift.
 *   4. Dark theme is respected by CSS, not here. workshop/museum are gated
 *      behind `html:not([data-theme="dark"])`, so in a dark session this
 *      module's attribute is simply inert and the identity palette holds.
 *
 * WHY THE MOOD LANDS ON <html>
 *   That is where theme-boot.js already writes `?mood=`, so a URL mood and a
 *   screen mood are one mechanism, not two. It is also the only element that
 *   reaches the surfaces the identity declares outside the shell tree — the
 *   FAB, the offline bar, the command-palette backdrop, the preview banner and
 *   `body` itself (erp-identity.css:90-95). Put the attribute on `#erp-main`
 *   instead and every one of those stays emerald inside a bronze room.
 *
 * ROLLBACK
 *   Remove the import + the one call in preview.js. Every screen returns to
 *   the identity palette; nothing else in the tree moves.
 */

/** The three rooms the palette layer can light. Kept in sync with
 *  css/v2/erp-moods.css and the MOODS list in js/v2/theme-boot.js. */
export const MOODS = ['workshop', 'museum', 'copper'];

/**
 * Which screens are read in which room.
 *
 * Only the READING surfaces are mapped, deliberately:
 *   • reports / analysis — numbers are read, compared and printed, so they
 *     get «المتحف»: ivory paper, bronze ink, hairline rules, 2px radii. It is
 *     the same information in a quieter room.
 *   • operations (dashboard, cashier, warehouse, HR, kitchen, dispatch,
 *     settings, users) stay on «بورسلين ونحاس». Someone working a shift needs
 *     the palette they have learned, not a change of scene.
 *   • totem / menu board are NOT here: `menu-board` hosts the legacy menu
 *     pages in an iframe (js/v2/screens/menu-board.js), and a mood declared
 *     in this document cannot cross a document boundary. Lighting the frame
 *     around a light page would be a seam, not a room. Copper for the totem
 *     needs a `--mb-*`/`--kb-*` → `--erp-*` bridge inside those pages, which
 *     is a separate change with its own verification.
 *
 * Every key below must be a real route key (tests/v2-moods.test.js proves it
 * against nav-model + routing.js), so a typo cannot silently do nothing.
 */
export const SCREEN_MOODS = Object.freeze({
    reports: 'museum',
    pnl: 'museum',
    'monthly-comparison': 'museum',
    'cost-analysis': 'museum',
    cfo: 'museum',
    'sales-analyzer': 'museum',
    'received-analyzer': 'museum',
    'sales-inquiry': 'museum',
    'wh-vs-pos': 'museum',
    'oracle-data': 'museum',
    query: 'museum',
});

/** `?mood=` in one place. Returns:
 *    'workshop' | 'museum' | 'copper' — an explicit room,
 *    'off'                            — an explicit reset (screen map off too),
 *    null                             — nothing said, or an unknown value. */
export function explicitMood(search) {
    let raw;
    try {
        raw = new URLSearchParams(String(search == null ? '' : search)).get('mood');
    } catch {
        return null;
    }
    if (raw === 'off') {return 'off';}
    return MOODS.includes(raw) ? raw : null;
}

/** The mood a screen wears, or null for "the identity palette". */
export function moodForScreen(key, search) {
    if (explicitMood(search)) {return null;}
    const k = String(key == null ? '' : key);
    return Object.prototype.hasOwnProperty.call(SCREEN_MOODS, k) ? SCREEN_MOODS[k] : null;
}

/**
 * Put the screen's mood on `el` (the document element), or take it off.
 * Pure DOM, no globals, so the test harness can drive it with a stub element.
 *
 * When the URL carries `?mood=`, this function touches nothing: the attribute
 * belongs to theme-boot.js for the whole page load, and a navigation must not
 * quietly cancel an instruction a human typed.
 *
 * @returns {string|null} the mood this call put in force, or null when none is.
 */
export function applyScreenMood(el, key, search) {
    if (!el
        || typeof el.getAttribute !== 'function'
        || typeof el.setAttribute !== 'function'
        || typeof el.removeAttribute !== 'function') {
        return null;
    }
    if (explicitMood(search)) {return null;} // the URL owns the attribute
    const mood = moodForScreen(key, search);
    if (mood) {
        if (el.getAttribute('data-mood') !== mood) {el.setAttribute('data-mood', mood);}
    } else if (el.getAttribute('data-mood') != null) {
        el.removeAttribute('data-mood');
    }
    return mood;
}
