/**
 * V2 — Navigation model adapter
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   A READ-ONLY adapter. It translates the app's existing navigation
 *   authority into a tree the V2 shell can render. It decides nothing and
 *   invents nothing.
 *
 * THE FOUR AUTHORITIES IT READS (never redefines any of them)
 *   • window.ROLES            core/config.js — role → menu keys (BRIDGE-007)
 *   • window.ALL_PERMISSIONS  features/permissions.js — key → label + icon
 *   • window.NAV_GROUPS       features/auth-navigation.js — grouping order
 *   • window.STATE            core/state.js — session, grants, hidden pages
 *
 * WHY NO `import`
 *   main.js:126 bridges every feature module's exports onto window via
 *   `Object.assign(window, await import(path))`, so NAV_GROUPS is already a
 *   runtime global in the real app. Importing auth-navigation.js here would
 *   drag a 470-line legacy module (and its global dependencies) into V2 —
 *   exactly the coupling V2 exists to avoid. Reading window keeps both
 *   worlds independent: remove V2 and nothing about legacy navigation
 *   changes; remove legacy and this adapter degrades to a documented
 *   fallback instead of throwing.
 *
 * PERMISSION RULE — MIRRORED, NOT OWNED
 *   Effective menus = (role menus ∪ grants) − denied, with `admin` exempt
 *   from denials. This is copied verbatim from userMenus()
 *   (auth-navigation.js:286-294) because that function is not exported.
 *   If legacy changes the rule, change it here too — the comment below is
 *   the pointer. The backend is still the authority; this only shapes a menu.
 */

/** Mirrors auth-navigation.js NAV_GROUPS — used only when the real bridge
 *  is absent (standalone preview page). Same ids, same order, same keys. */
const NAV_GROUPS_FALLBACK = [
    { id: 'main',    title: 'nav.grp.main',    keys: ['dashboard'] },
    { id: 'finance', title: 'nav.grp.finance', keys: ['cfo', 'cash-register', 'cashier-sales', 'revenues', 'expenses', 'cost-analysis', 'pnl', 'monthly-comparison'] },
    { id: 'ops',     title: 'nav.grp.ops',     keys: ['departments', 'warehouse', 'wh-invoices', 'wh-moves', 'wh-returns', 'wh-prs', 'veg-requests', 'shelves', 'weight', 'kitchen', 'dispatch', 'recipes', 'procurement'] },
    { id: 'hr',      title: 'nav.grp.hr',      keys: ['hr-dashboard', 'employees', 'leaves', 'attendance', 'zkteco', 'payroll', 'hr-departments', 'employee-portal', 'roster', 'dept-employees'] },
    { id: 'sys',     title: 'nav.grp.sys',     keys: ['reports', 'settings', 'users', 'branches', 'permissions', 'yarasoft', 'oracle-data', 'whatsapp', 'query', 'professional', 'sales-analyzer', 'received-analyzer', 'wh-vs-pos'] },
];

/** Group titles resolved through the existing i18n table when available.
 *  Mirrors I18N.ar — core/i18n.js:12 (the same keys buildNav passes to t()). */
const GROUP_TITLE_FALLBACK = {
    'nav.grp.main':    'الرئيسية',
    'nav.grp.finance': 'المالية',
    'nav.grp.ops':     'التشغيل والمخزون',
    'nav.grp.hr':      'الموارد البشرية',
    'nav.grp.sys':     'النظام والتكامل',
    'nav.main':        'الرئيسية',
};

const win = () => (typeof window !== 'undefined' ? window : undefined);

/* ── Readers ─────────────────────────────────────────────────────────── */

export function readNavGroups() {
    const groups = win()?.NAV_GROUPS;
    return Array.isArray(groups) && groups.length ? groups : NAV_GROUPS_FALLBACK;
}

export function readRoles() {
    return win()?.ROLES || {};
}

/**
 * Label source. `ALL_PERMISSIONS.menus[key]` is an HTML fragment produced by
 * i18n.js applyI18nMaps():
 *     `<i class=ji data-i=ICON></i> LABEL`
 * The regex is the same one auth-navigation.js:340 uses, so an icon/label
 * split can never disagree between the two shells.
 */
function parseMenuEntry(html) {
    const text = typeof html === 'string' ? html : '';
    const m = text.match(/^<i class=ji data-i=([a-z0-9-]+)><\/i>\s*(.*)$/i);
    if (m) {return { icon: m[1], label: m[2] };}
    return { icon: null, label: text || '' };
}

export function readMenuLabels() {
    const w = win();

    // Preferred: a host that mounted it explicitly.
    if (w?.ALL_PERMISSIONS && typeof w.ALL_PERMISSIONS.menus === 'object') {
        return w.ALL_PERMISSIONS.menus;
    }

    /* Fallback: app.js:187 declares `const ALL_PERMISSIONS = {…}` at the top
       level of a CLASSIC script. Top-level const/let in a classic script go
       into the global *declarative* record — they are reachable as a bare
       identifier but are deliberately NOT properties of `window`. So
       `window.ALL_PERMISSIONS` is undefined even in the fully booted app.
       `typeof` is the only safe probe: it returns 'undefined' for an
       undeclared binding instead of throwing ReferenceError. */
    if (typeof ALL_PERMISSIONS !== 'undefined'
        && ALL_PERMISSIONS
        && typeof ALL_PERMISSIONS.menus === 'object') {
        return ALL_PERMISSIONS.menus;
    }

    return {};
}

/** Current session's role key, or null when logged out. */
export function currentRole() {
    return win()?.STATE?.currentUser?.role || null;
}

/**
 * Effective menu keys for the session.
 *
 * MIRROR of userMenus() — auth-navigation.js:286-294.
 *   base = role.menus
 *   extra = STATE.permissions.menus          (grants)
 *   denied = STATE.permissions.deniedMenus   (revocations)
 *   admin is exempt from denials
 *   result = unique(base + extra) minus denied
 *
 * @returns {string[]}
 */
export function allowedMenus() {
    const state = win()?.STATE;
    const role = currentRole();
    const roleDef = readRoles()[role];
    const base = Array.isArray(roleDef?.menus) ? roleDef.menus.slice() : [];
    const extra = Array.isArray(state?.permissions?.menus) ? state.permissions.menus : [];
    const denied = new Set(Array.isArray(state?.permissions?.deniedMenus) ? state.permissions.deniedMenus : []);
    if (role === 'admin') {denied.clear();}
    return [...new Set([...base, ...extra])].filter((m) => !denied.has(m));
}

/**
 * Pages the admin hid from the sidebar (settings.hidden_nav_pages).
 * MIRROR of buildNav() — auth-navigation.js:324-326, including its guard:
 * dashboard and settings can never be hidden, so the system cannot lock a
 * user out of itself.
 *
 * @returns {Set<string>}
 */
export function hiddenMenus() {
    const raw = win()?.STATE?.settings?.hidden_nav_pages;
    const set = new Set(String(raw || '').split(',').map((s) => s.trim()).filter(Boolean));
    set.delete('dashboard');
    set.delete('settings');
    return set;
}

/* ── Tree construction ───────────────────────────────────────────────── */

/**
 * Build the grouped navigation tree for the current session.
 *
 * Mirrors buildNav()'s traversal order (auth-navigation.js:348-364):
 *   1. walk NAV_GROUPS in order, emitting only allowed + visible + known keys
 *   2. then append any allowed key a group did not cover (the "safety net"),
 *      so a menu added by a role but missing from NAV_GROUPS can never
 *      silently disappear.
 *
 * @param {{ labels?: Record<string,string>, allowed?: string[], groups?: Array }} [opts]
 * @returns {{ id: string, title: string, items: Array }[]}
 */
export function buildNavTree(opts = {}) {
    const labels = opts.labels || readMenuLabels();
    const allowed = opts.allowed || allowedMenus();
    const groups = opts.groups || readNavGroups();
    const hidden = hiddenMenus();
    const allowedSet = new Set(allowed);

    const toItem = (key) => {
        const entry = labels[key];
        // buildNav drops keys with no label registered in ALL_PERMISSIONS
        // (auth-navigation.js:351) — same rule, so the two shells agree.
        if (entry === undefined || entry === null) {return null;}
        const { icon, label } = parseMenuEntry(entry);
        return { key, label, icon, hasLabel: true };
    };

    const tree = [];
    const emitted = new Set();

    for (const group of groups) {
        const items = [];
        for (const key of (Array.isArray(group.keys) ? group.keys : [])) {
            if (hidden.has(key) || !allowedSet.has(key)) {continue;}
            const item = toItem(key);
            if (!item) {continue;}
            items.push(item);
            emitted.add(key);
        }
        if (items.length) {tree.push({ id: group.id, title: resolveGroupTitle(group.title), items });}
    }

    // Safety net: allowed keys no group claimed.
    const orphanKeys = allowed.filter((k) => !emitted.has(k) && !hidden.has(k));
    const orphanItems = orphanKeys.map(toItem).filter(Boolean);
    if (orphanItems.length) {
        tree.push({ id: 'unassigned', title: resolveGroupTitle('nav.main'), items: orphanItems });
    }

    return tree;
}

function resolveGroupTitle(key) {
    if (!key) {return '';}
    const t = win()?.t;
    if (typeof t === 'function') {
        try {
            const translated = t(key);
            if (translated && translated !== key) {return translated;}
        } catch { /* i18n not ready → fall through */ }
    }
    return GROUP_TITLE_FALLBACK[key] || key;
}

/**
 * Flat list of every reachable key — used for "is this page permitted"
 * checks and for Ctrl+K search scoping.
 */
export function navKeys() {
    return buildNavTree().flatMap((g) => g.items.map((i) => i.key));
}
