/**
 * V2 — Hash routing
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   A pure resolver between `#/key` and a screen key. No DOM, no fetch, no
 *   globals: the caller hands it the route universe (built from nav-model)
 *   and the explicit revocations, and it answers with a key plus a reason.
 *   That is what makes it unit-testable in the vm harness with no browser.
 *
 * WHY IT EXISTS
 *   V2 keeps zero state in the URL. A refresh, a Back press or a pasted
 *   link always lands on the dashboard, whatever screen was open. This adds
 *   `#/key` for every screen behind `?v2routing=1` (default OFF).
 *
 * ONE DECISION THAT MATTERS — REVOCATIONS GATE, ROLE MENUS DO NOT
 *   The obvious rule is "refuse any key the session is not permitted". It
 *   would break the system, and the numbers say why:
 *
 *     • legacy has no client-side navigation gate at all. `navigate(key)`
 *       (app.js) renders whatever it is handed; permissions live in the
 *       SERVER and in which menu rows get drawn.
 *     • `ROLES.admin.menus` does not contain 7 keys the admin genuinely
 *       reaches by in-app links — dept-employees, received-analyzer,
 *       wh-vs-pos, pos, cashier-monitor, procurement-invoices,
 *       procurement-payments. A menu is not a whitelist; some pages are
 *       sub-screens, deliberately absent from every menu.
 *
 *   So gating on `allowedMenus()` would bounce the owner out of their own
 *   sub-screens — exactly the "كسر 1%" this project forbids. What IS safe to
 *   honour is `permissions.deniedMenus`: an explicit withdrawal the admin
 *   typed on the permissions screen. That is what this module refuses, and
 *   nothing else. Every other key is rendered; the server stays the
 *   authority for what its data calls then return.
 *
 * FALLBACK IS ALWAYS THE DASHBOARD
 *   Empty hash, malformed hash, unknown key, revoked key → dashboard with a
 *   `reason` for the console. A bad URL never renders a blank main region
 *   and never looks like a crash.
 */

/** The screen every fallback lands on. Also the only key that can never be
 *  hidden from the nav (nav-model.js:145) — so it is always routable. */
export const DASH_KEY = 'dashboard';

/** Routes that exist in the dispatcher but in no menu: the V2 sign-in and
 *  the sub-screens opened from inside other screens. Listed here because
 *  tests/v2-routing.test.js proves each one has a real route in preview.js. */
export const SUB_ROUTES = [
    'login',
    'sessions',
    'pos',
    'cashier-monitor',
    'menu-board',
    'yara-daily-locks',
    'procurement-invoices',
    'procurement-payments',
    'goods-scan',
    'warehouse-gov',
];

/** Shape of a real nav key — lowercase letters, digits, hyphens. Anything
 *  else typed into a hash is treated as absent, never passed to renderScreen. */
const KEY_SHAPE = /^[a-z][a-z0-9-]{0,39}$/;

const FLAG_TRUE = new Set(['1', 'true', 'on']);

/** `#/employees`, `employees`, `#/employees?x=1`, `` → key or ''. */
export function keyFromHash(raw) {
    const text = String(raw == null ? '' : raw).trim().replace(/^#/, '').replace(/^\/+/, '');
    const key = text.split(/[?&]/)[0].trim();
    return KEY_SHAPE.test(key) ? key : '';
}

export function hashFor(key) {
    const k = String(key == null ? '' : key);
    return `#/${KEY_SHAPE.test(k) ? k : DASH_KEY}`;
}

/** Every routable key: the menu universe + the dashboard + the sub-routes.
 *  @param {Array} groups — nav-model readNavGroups(), never read here. */
export function knownKeys(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const keys = [];
    for (const group of list) {
        if (Array.isArray(group && group.keys)) {keys.push(...group.keys);}
    }
    return new Set([DASH_KEY, ...SUB_ROUTES, ...keys]);
}

/**
 * @returns {{ key: string, reason: 'empty'|'unknown'|'not-permitted'|null }}
 * `denied` is the revocation set; pass null to say "don't gate yet".
 */
export function resolveRouteKey(rawHash, opts = {}) {
    const known = opts.known instanceof Set ? opts.known : knownKeys(opts.groups);
    const denied = opts.denied == null ? new Set()
        : (opts.denied instanceof Set ? opts.denied : new Set(opts.denied));
    const key = keyFromHash(rawHash);
    if (!key) {return { key: DASH_KEY, reason: 'empty' };}
    if (!known.has(key)) {return { key: DASH_KEY, reason: 'unknown' };}
    if (key !== DASH_KEY && denied.has(key)) {return { key: DASH_KEY, reason: 'not-permitted' };}
    return { key, reason: null };
}

/** Default OFF. Query wins over storage, so `?v2routing=0` is an escape
 *  hatch from a flag left ON in localStorage. */
export function routingEnabled(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2routing=([^&]*)/);
    if (match) {return FLAG_TRUE.has(decodeURIComponent(match[1]).toLowerCase());}
    if (stored == null || stored === '') {return false;}
    return FLAG_TRUE.has(String(stored).toLowerCase());
}
