/**
 * V2 — Density controller (cozy / dense)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS OWNS
 *   • A *client-side* presentation preference: "cozy" | "dense".
 *   • Applying it as the class `is-dense` on the V2 shell root, which
 *     css/v2/erp-density.css keys every override on.
 *
 * WHY IT EXISTS
 *   SAP Fiori ships cozy/compact; NetSuite ships density presets; Dynamics
 *   ships "compact density". One ERP serves a manager on a 27" screen and a
 *   storekeeper on a 14" one — same role, different information need.
 *   Density is the standard answer; scrollbars are not.
 *
 * WHAT THIS DOES NOT OWN (deliberately)
 *   • No server persistence, no new field, no new endpoint — same contract
 *     as js/v2/theme.js. localStorage only; storage blocked → session-only.
 *   • Type sizes — erp-density.css never shrinks text, only chrome.
 *
 * SHAPE PARITY
 *   mountDensityControl mirrors mountThemeControl (radiogroup, aria-checked,
 *   reflect(), disposer) so the header hosts two controls that behave
 *   identically. No-flash: applied at shell mount time, before first paint
 *   of any screen content.
 */

const PREF_KEY = 'erp.v2.density.pref';
const VALID_PREFS = new Set(['cozy', 'dense']);

/** @returns {'cozy'|'dense'} */
export function getDensityPref() {
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (VALID_PREFS.has(raw)) {return raw;}
    } catch { /* private mode / storage blocked → cozy default */ }
    return 'cozy';
}

/**
 * Apply a density preference to a shell root element.
 * @param {'cozy'|'dense'} pref
 * @param {HTMLElement} rootEl the `.erp-v2` shell root
 */
export function applyDensity(pref, rootEl) {
    if (!rootEl) {return pref;}
    const safe = VALID_PREFS.has(pref) ? pref : 'cozy';
    rootEl.classList.toggle('is-dense', safe === 'dense');
    return safe;
}

/**
 * Persist a preference and apply it immediately.
 * @param {'cozy'|'dense'} pref
 * @param {HTMLElement} rootEl the `.erp-v2` shell root
 */
export function setDensityPref(pref, rootEl) {
    const safe = VALID_PREFS.has(pref) ? pref : 'cozy';
    try {
        localStorage.setItem(PREF_KEY, safe);
    } catch { /* storage blocked — density still applies for this session */ }
    return applyDensity(safe, rootEl);
}

/**
 * Render the segmented density control into `container` and wire it up.
 * Mirrors mountThemeControl exactly (same aria contract, same disposer).
 * @param {HTMLElement} container
 * @param {HTMLElement} rootEl the `.erp-v2` shell root
 * @returns {{ destroy: () => void }} disposer
 */
export function mountDensityControl(container, rootEl) {
    if (!container) {return { destroy() {} };}
    container.classList.add('erp-density-control');
    container.setAttribute('role', 'radiogroup');
    container.setAttribute('aria-label', 'كثافة العرض');

    // Apply current preference before any button renders — the shell never
    // paints cozy for a frame and then jumps to dense.
    applyDensity(getDensityPref(), rootEl);

    const OPTIONS = [
        { pref: 'cozy',  label: 'مريح' },
        { pref: 'dense', label: 'مضغوط' },
    ];

    const buttons = OPTIONS.map((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'erp-density-option';
        btn.dataset.pref = opt.pref;
        btn.setAttribute('role', 'radio');
        btn.innerHTML = `<span>${opt.label}</span>`;
        btn.addEventListener('click', () => {
            setDensityPref(opt.pref, rootEl);
            reflect();
        });
        container.appendChild(btn);
        return btn;
    });

    function reflect() {
        const active = getDensityPref();
        buttons.forEach((btn) => {
            const on = btn.dataset.pref === active;
            btn.setAttribute('aria-checked', String(on));
            btn.classList.toggle('is-active', on);
        });
    }

    reflect();

    return {
        destroy() {
            buttons.forEach((b) => b.remove());
            container.removeAttribute('role');
            container.removeAttribute('aria-label');
        },
    };
}
