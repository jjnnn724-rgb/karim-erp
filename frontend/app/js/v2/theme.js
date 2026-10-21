/**
 * V2 — Theme controller (light / dark / system)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS OWNS
 *   • A *client-side* preference: "light" | "dark" | "system".
 *   • Applying the resolved value to <html data-theme>, which is the
 *     attribute design-tokens.css already keys every palette override on.
 *
 * WHAT THIS DOES NOT OWN (deliberately)
 *   • The palette — design-tokens.css / erp-tokens.css own that.
 *   • Persistence on the server. There is no new field and no new endpoint:
 *     the "system" option is a browser preference only, stored in
 *     localStorage. (Legacy already persists STATE.theme for admin/manager
 *     via saveData(); we never call it — we only keep STATE.theme in sync so
 *     the legacy toggle and the V2 control can never disagree.)
 *
 * NO FLASH
 *   applyTheme() must run before first paint. v2.html does this with a tiny
 *   inline script in <head>; if that script is missing this module still
 *   applies the right theme on import, just one frame later.
 */

const PREF_KEY = 'erp.v2.theme.pref';
const VALID_PREFS = new Set(['light', 'dark', 'system']);
const VALID_THEMES = new Set(['light', 'dark']);

/** @returns {'light'|'dark'|'system'} */
export function getPref() {
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (VALID_PREFS.has(raw)) {return raw;}
    } catch { /* private mode / storage blocked → fall through to system */ }
    return 'system';
}

/**
 * Resolve a preference to an actually applicable theme.
 * @param {'light'|'dark'|'system'} pref
 * @returns {'light'|'dark'}
 */
export function resolveTheme(pref = getPref()) {
    if (VALID_THEMES.has(pref)) {return pref;}
    try {
        return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch {
        return 'light'; // no matchMedia → deterministic, never a black flash
    }
}

/**
 * Apply a resolved theme to the document.
 * Keeps window.STATE.theme in sync *in memory only* so the legacy
 * `toggleTheme()` (auth-navigation.js:397) starts from a consistent value
 * if the user reaches it after using the V2 control.
 *
 * @param {'light'|'dark'} theme
 */
export function applyTheme(theme) {
    const safe = VALID_THEMES.has(theme) ? theme : 'light';
    const root = document.documentElement;
    if (root.getAttribute('data-theme') !== safe) {
        root.setAttribute('data-theme', safe);
    }
    // In-memory sync only — never a persistence call from V2.
    const state = (typeof window !== 'undefined') ? window.STATE : null;
    if (state && typeof state === 'object') {state.theme = safe;}
}

/** Resolve + apply in one step. Safe to call repeatedly. */
export function syncTheme() {
    const resolved = resolveTheme();
    applyTheme(resolved);
    return resolved;
}

/**
 * Persist a preference and apply it immediately.
 * @param {'light'|'dark'|'system'} pref
 */
export function setPref(pref) {
    const safe = VALID_PREFS.has(pref) ? pref : 'system';
    try {
        localStorage.setItem(PREF_KEY, safe);
    } catch { /* storage blocked — theme still applies for this session */ }
    return syncTheme();
}

/** The resolved theme for the current preference (test/telemetry helper). */
export function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || resolveTheme();
}

/* ── React to OS-level changes while "system" is selected ────────────────
   Without this, a user who switches their OS theme at sunset keeps a stale
   page until reload. Only fires when the preference is actually "system",
   so an explicit light/dark choice is never overridden. */
let mediaQuery = null;
let watching = false;

export function watchSystemTheme() {
    if (watching) {return () => {};}
    mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mediaQuery) {return () => {};}

    const onChange = () => {
        if (getPref() === 'system') {syncTheme();}
    };

    // addEventListener is the modern API; addListener is the legacy fallback
    // that still ships in older Safari/WebView builds.
    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', onChange);
        watching = true;
        return () => mediaQuery.removeEventListener('change', onChange);
    }
    if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(onChange);
        watching = true;
        return () => mediaQuery.removeListener(onChange);
    }
    return () => {};
}

/* ── Theme control ───────────────────────────────────────────────────────
   Three explicit options, not a two-way toggle, because "system" is a real
   choice the user must be able to see and return to.
   aria-checked carries the current selection (WCAG 4.1.2); radios must not
   also carry aria-pressed. */

const THEME_OPTIONS = [
    { pref: 'light', label: 'فاتح',     icon: 'sun' },
    { pref: 'dark',  label: 'داكن',     icon: 'moon' },
    { pref: 'system', label: 'النظام',  icon: 'monitor' },
];

/**
 * Render the segmented theme control into `container` and wire it up.
 * @param {HTMLElement} container
 * @returns {{ destroy: () => void }} disposer
 */
export function mountThemeControl(container) {
    if (!container) {return { destroy() {} };}
    container.classList.add('erp-theme-control');
    container.setAttribute('role', 'radiogroup');
    container.setAttribute('aria-label', 'مظهر الواجهة');

    const buttons = THEME_OPTIONS.map((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'erp-theme-option';
        btn.dataset.pref = opt.pref;
        btn.setAttribute('role', 'radio');
        btn.innerHTML = `<i class="ji" data-i="${opt.icon}" aria-hidden="true"></i><span>${opt.label}</span>`;
        btn.addEventListener('click', () => {
            setPref(opt.pref);
            reflect();
        });
        container.appendChild(btn);
        return btn;
    });

    function reflect() {
        const active = getPref();
        buttons.forEach((btn) => {
            const on = btn.dataset.pref === active;
            btn.setAttribute('aria-checked', String(on));
            btn.classList.toggle('is-active', on);
        });
    }

    reflect();

    // First run starts before the OS watcher; register it once here.
    const unwatch = watchSystemTheme();

    return {
        destroy() {
            unwatch?.();
            buttons.forEach((b) => b.remove());
            container.removeAttribute('role');
            container.removeAttribute('aria-label');
        },
    };
}

/* ── Bootstrap ───────────────────────────────────────────────────────── */
export function initTheme() {
    syncTheme();
    return watchSystemTheme();
}
