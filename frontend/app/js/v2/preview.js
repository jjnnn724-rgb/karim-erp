/**
 * V2 — Preview host
 * ═══════════════════════════════════════════════════════════════════════
 *
 * THIS FILE EXISTS ONLY FOR v2.html.
 * It wires the V2 shell and table to enough real configuration to evaluate
 * the design, and it is never referenced by index.html, pos.html or any
 * production entry point. Deleting it (with v2.html and the css/v2 + js/v2
 * folders) removes V2 entirely — that is the rollback.
 *
 * WHAT IS REAL HERE
 *   • ROLES            — imported from core/config.js (the actual role map).
 *   • Menu labels/icons— imported from core/i18n.js MENU_STRINGS (real AR/EN).
 *   • NAV_GROUPS       — imported from features/auth-navigation.js if that
 *                        module loads standalone; otherwise nav-model's
 *                        documented mirror is used.
 *   • Status values    — every badge below uses a value that exists in the
 *                        production database or in legacy rendering code.
 *   • LIVE DATA        — only with `?live=1` AND a session this browser
 *                        already owns. The branches screen then reads
 *                        /api/branches for real (see screens/branches.js).
 *                        Without that flag nothing in this page issues a
 *                        request, so the default preview cannot touch the
 *                        owner's live session or database.
 *
 * WHAT IS SAMPLE (stated on the page itself)
 *   The session and the table rows are fixtures for design review. Outside
 *   live mode no API is called, no record is read, and nothing here implies
 *   a live integration.
 */

import { ROLES } from '../core/config.js?v=4.9.187';
import { MENU_STRINGS, t } from '../core/i18n.js?v=4.9.187';
import { initTheme, currentTheme } from './theme.js?v=4.9.187';
import { statusBadge, hydrateStatusNodes } from './status.js?v=4.9.187';
import { mountAppLayout } from './layout/app-layout.js?v=4.9.187';
import { mountShellExtras } from './layout/shell-extras.js?v=4.9.187';
import { mountAiAssistant } from './ai-assistant.js?v=4.9.187';
import { mountChat } from './chat.js?v=4.9.187';
import { mountMobileShell } from './mobile-shell.js?v=4.9.187';
import { createDataTable } from './data-display/data-table.js?v=4.9.187';
import { ensureSession } from './session.js?v=4.9.187';
import { fetchMyPermissions } from './data/shell-repo.js?v=4.9.187';
import { fetchMainSettingsFull } from './data/settings-repo.js?v=4.9.187';
import { installV2PrintBranding, setV2PrintLogo } from './print-branding.js?v=4.9.187';
import { fetchDbConstraints, invalidateDbConstraints, validateDbField, validateDbForm } from './data/db-constraints-repo.js?v=4.9.187';
import { readNavGroups, allowedMenus } from './layout/nav-model.js?v=4.9.187';
import { DASH_KEY, keyFromHash, hashFor, knownKeys, resolveRouteKey, routingEnabled } from './routing.js?v=4.9.187';
import { installToast, notifyTo, toastEnabled } from './toast.js?v=4.9.187';
import { installOverlay, overlayEnabled } from './overlay.js?v=4.9.187';
import { mountBranchesScreen } from './screens/branches.js?v=4.9.187';
import { renderDashboard, mountCommandPalette } from './screens/dashboard.js?v=4.9.187';
import { mountAttendanceScreen } from './screens/attendance.js?v=4.9.187';
import { mountEmployeesScreen } from './screens/employees.js?v=4.9.187';
import { mountLoginScreen } from './screens/login.js?v=4.9.187';
import { mountBriefingScreen } from './screens/briefing.js?v=4.9.187';
import { mountCfoScreen } from './screens/cfo.js?v=4.9.187';
import { mountWarehouseScreen } from './screens/warehouse.js?v=4.9.187';
import { mountWarehouseGovScreen } from './screens/warehouse-gov.js?v=4.9.187';
import { mountReportsScreen } from './screens/reports.js?v=4.9.187';
import { mountProcurementScreen } from './screens/procurement.js?v=4.9.187';
import { mountInvoicesScreen } from './screens/invoices.js?v=4.9.187';
import { mountPaymentsScreen } from './screens/payments.js?v=4.9.187';
import { mountWhInvoicesScreen } from './screens/wh-invoices.js?v=4.9.187';
import { mountKitchenScreen } from './screens/kitchen.js?v=4.9.187';
import { mountLeavesScreen } from './screens/leaves.js?v=4.9.187';
import { mountDispatchScreen } from './screens/dispatch.js?v=4.9.187';
import { mountVegScreen } from './screens/veg-requests.js?v=4.9.187';
import { mountRosterScreen } from './screens/roster.js?v=4.9.187';
import { mountEmployeePortalScreen } from './screens/employee-portal.js?v=4.9.187';
import { mountSettingsScreen } from './screens/settings.js?v=4.9.187';
import { mountUsersScreen } from './screens/users.js?v=4.9.187';
import { mountYarasoftScreen } from './screens/yarasoft.js?v=4.9.187';
import { mountWhatsappScreen } from './screens/whatsapp.js?v=4.9.187';
import { mountPermissionsScreen } from './screens/permissions.js?v=4.9.187';
import { mountCashierMonitorScreen } from './screens/cashier-monitor.js?v=4.9.187';
import { mountOracleDataScreen } from './screens/oracle-data.js?v=4.9.187';
import { mountDailyLocksScreen } from './screens/daily-locks.js?v=4.9.187';
import { mountMenuBoardScreen } from './screens/menu-board.js?v=4.9.187';
import { mountPosEntryScreen } from './screens/pos-entry.js?v=4.9.187';
import { mountDepartmentsScreen } from './screens/departments.js?v=4.9.187';
import { mountHrDepartmentsScreen } from './screens/hr-departments.js?v=4.9.187';
import { mountPayrollScreen } from './screens/payroll.js?v=4.9.187';
import { mountWhMovesScreen } from './screens/wh-moves.js?v=4.9.187';
import { mountWhReturnsScreen } from './screens/wh-returns.js?v=4.9.187';
import { mountWhPrsScreen } from './screens/wh-prs.js?v=4.9.187';
import { mountGoodsScanScreen } from './screens/goods-scan.js?v=4.9.187';
import { mountRecipesScreen } from './screens/recipes.js?v=4.9.187';
import { mountRevenuesScreen } from './screens/revenues.js?v=4.9.187';
import { mountExpensesScreen } from './screens/expenses.js?v=4.9.187';
import { mountCostAnalysisScreen } from './screens/cost-analysis.js?v=4.9.187';
import { mountPnlScreen } from './screens/pnl.js?v=4.9.187';
import { mountHrDashboardScreen } from './screens/hr-dashboard.js?v=4.9.187';
import { mountZktecoScreen } from './screens/zkteco.js?v=4.9.187';
import { mountDeptEmployeesScreen } from './screens/dept-employees.js?v=4.9.187';
import { mountSalesAnalyzerScreen } from './screens/sales-analyzer.js?v=4.9.187';
import { mountReceivedAnalyzerScreen } from './screens/received-analyzer.js?v=4.9.187';
import { mountWhVsPosScreen } from './screens/wh-vs-pos.js?v=4.9.187';
import { mountQueryScreen } from './screens/inventory-inquiry.js?v=4.9.187';
import { mountProfessionalScreen } from './screens/inventory-inquiry-pro.js?v=4.9.187';
import { mountShelvesScreen } from './screens/shelves.js?v=4.9.187';
import { mountWeightScreen } from './screens/weight.js?v=4.9.187';
import { mountAccountantDashboardScreen } from './screens/accountant-dashboard.js?v=4.9.187';
import { mountWarehouseDashboardScreen } from './screens/warehouse-dashboard.js?v=4.9.187';
import { mountDeptHeadDashboardScreen } from './screens/dept-head-dashboard.js?v=4.9.187';
import { dashboardKind } from './role-dashboard.js?v=4.9.187';

// Enable the embedded cashier while retaining the standalone POS fallback.
const V2_FEATURE_FLAGS = Object.freeze({ embeddedPos: true, salesEnabled: true });

/* ── 1. Publish the real configuration the adapters read ────────────── */

// nav-model reads window.ROLES in the production app (BRIDGE-007 does the
// same via main.js). Reproducing that here keeps ONE reader, not two.
window.ROLES = ROLES;

// i18n.js applyI18nMaps() builds ALL_PERMISSIONS.menus as:
//     `<i class=ji data-i=${m.icon}></i> ${m.ar}`
// (i18n.js:284). This mirrors that construction for the preview so menu
// labels and icons are the genuine ones rather than invented placeholders.
// In production ALL_PERMISSIONS comes from app.js:187 instead.
if (!window.ALL_PERMISSIONS) {
    const menus = {};
    for (const [key, m] of Object.entries(MENU_STRINGS || {})) {
        menus[key] = `<i class=ji data-i=${m.icon}></i> ${m.ar}`;
    }
    window.ALL_PERMISSIONS = { menus };
}

/* ── 1b. Label resolution — real i18n, never a guess ────────────────────
   core/i18n.js carries TWO vocabularies and the legacy shell uses each for
   a different job:

     • MENU_STRINGS[key].ar → the short nav/menu label   (i18n.js:265…)
     • t('pg.' + key)       → the full page title         (i18n.js:13…)

   Breadcrumbs and screen titles must never show a raw key such as
   `employees`. If neither lookup knows the key, the key is returned
   VERBATIM — displayed exactly as persisted, never invented. That is the
   same contract the status badge enforces for unknown status values, so an
   untranslated page announces itself instead of quietly lying. */
const menuLabel = (key) => (MENU_STRINGS[key] && MENU_STRINGS[key].ar) || key;

function pageTitle(key) {
    const translated = t(`pg.${key}`);
    // t() falls back to the key it was handed, so an unresolved title is
    // detectable by comparing against what we asked for.
    return translated === `pg.${key}` ? menuLabel(key) : translated;
}

/* ── 2. Session ─────────────────────────────────────────────────────────
   Two modes, and the difference is stated on the page:

     default  — `window.STATE` is a fixture whose only job is to let the
                shell render a full menu for design review. Nothing reads
                the network.
     ?live=1  — the fixture is removed (`role: null` until the server
                answers) and the page tries the browser's own session. A
                role is never assumed here; if it cannot be resolved, every
                screen says so. */
const LIVE = new URLSearchParams(window.location.search).get('live') === '1';
const SHOWCASE_MODE = !LIVE && new URLSearchParams(window.location.search).get('showcase') === '1';

window.STATE = {
    currentUser: LIVE ? { role: null, name: '' } : { role: 'admin', name: 'مدير النظام' },
    permissions: { menus: [], deniedMenus: [] },
    settings: { hidden_nav_pages: '' },
    theme: currentTheme(),
};

/* ── 2b. Hash routing — `#/key` (flag OFF by default) ─────────────────
   Read routing.js first: the gate is the explicit REVOCATIONS
   (permissions.deniedMenus), never the role menu, because a menu is not a
   whitelist and seven real screens appear in none of them.
   `?v2routing=1` turns it on; `karim_v2_routing` in localStorage keeps it on
   across reloads for staging, and `?v2routing=0` overrides that. With the
   flag off nothing below runs and the page behaves exactly as before. */
let storedRoutingFlag = '';
try {storedRoutingFlag = localStorage.getItem('karim_v2_routing');} catch { /* private mode */ }
const ROUTING = routingEnabled(window.location.search, storedRoutingFlag);
const GOODS_SCAN_DEEP_LINK = keyFromHash(window.location.hash) === 'goods-scan';
const ROUTE_KNOWN = knownKeys(readNavGroups());

/** Live until GET /permissions/me lands — see §4b. */
let routeSettled = !LIVE;

function currentDenied() {
    const state = window.STATE;
    if (state && state.currentUser && state.currentUser.role === 'admin') {return new Set();}
    const list = (state && state.permissions && state.permissions.deniedMenus) || [];
    return new Set(Array.isArray(list) ? list : []);
}

/* ── 2c. Toast — `window.toast` for real (flag OFF by default) ────────
   THE ORDER IS THE FEATURE. session.js:106-107 installs a silent
   `console.info` fallback ONLY when `typeof window.toast !== 'function'`,
   and it runs inside ensureSession() (§5, line ~291) and again from
   screens/login.js. So this call must precede both: install late and the
   stub wins, the page still shows nothing, and the work looks done.
   With `?v2toast` off, installToast() touches no global at all — the
   silence is exactly the pre-P0-3b behaviour, which is the rollback. */
let storedToastFlag = '';
try {storedToastFlag = localStorage.getItem('karim_v2_toast');} catch { /* private mode */ }
const TOAST = toastEnabled(window.location.search, storedToastFlag);
installToast(window, { enabled: TOAST });

/* ── 2d. غطاء التحميل — عدّاد على `window.fetch` (العلم OFF افتراضيًا) ──
   يُغلّف fetch مرة واحدة عند الـboot قبل أن يركّب أي شاشة، فتقع كل طلبات
   الشاشات داخل العدّاد. مع `?v2overlay` مطفأ لا يلمس `window.fetch` أصلًا
   ولا يُنشئ عقدة — وهو مستوى التراجع الأول (إطفاء فوري بلا git). القرار ٢
   في عقد V2: عتبة 400ms، استثناء /notifications و/health، عدّاد متوازن. */
let storedOverlayFlag = '';
try {storedOverlayFlag = localStorage.getItem('karim_v2_overlay');} catch { /* private mode */ }
const OVERLAY = overlayEnabled(window.location.search, storedOverlayFlag);
installOverlay(window, { enabled: OVERLAY });

/* ── 3. Boot theme ──────────────────────────────────────────────────── */
initTheme();

/* ── 4. Mount the shell ───────────────────────────────────────────────
   NOTE — no dynamic import of auth-navigation.js here, deliberately:

   (a) TIMING. A top-level `await` makes this module finish AFTER
       DOMContentLoaded. icons.js runs hydrate(document) inside its
       DOMContentLoaded listener, so it would find an empty document and
       fall back to its MutationObserver — whose callback is scheduled with
       requestAnimationFrame, which does not fire on a backgrounded tab.
       The result: icons left as raw <i>. Rendering synchronously (no
       top-level await) means icons.js hydrates a fully-built document.

   (b) COUPLING. nav-model.js already carries a mirror of NAV_GROUPS that
       was verified field-for-field against auth-navigation.js:279-285.
       Importing a 470-line legacy module just to read five static objects
       is exactly the coupling V2 exists to avoid. In the real app
       main.js:126 bridges the genuine window.NAV_GROUPS anyway, and
       nav-model reads it first — the mirror is only the standalone fallback. */
const root = document.getElementById('erp-v2-root');

const navStatus = { current: 'dashboard' };

/* One place where a screen becomes visible: state, sidebar highlight,
   breadcrumbs, render — then the URL, and only when routing is on. */
function applyKey(key) {
    navStatus.current = key;
    shell.setPage(key);
    try { mobileShell?.setPage(key); } catch { /* mobile shell is additive */ }
    shell.setBreadcrumbs({ trail: [
        { label: 'الرئيسية', key: 'dashboard' },
        { label: menuLabel(key) },
    ] });
    renderScreen(key);
    if (ROUTING) {syncHash(key);}
}

const shell = mountAppLayout(root, {
    appName: 'مطاعم الشرفه العالمي',
    appSubtitle: 'نظام إدارة المطاعم المتكامل · واجهة V2',
    page: navStatus.current,
    breadcrumbs: { trail: [{ label: 'الرئيسية', key: 'dashboard' }, { label: 'لوحة التحكم' }] },
    toolbar: [
        {
            label: 'تحديث',
            icon: 'refresh',
            onClick: () => {
                // Whichever live screen is mounted owns its own refresh; the
                // sample table is the fallback for every other screen.
                const live = briefingScreen || hrDashboardScreen || employeePortalScreen
                    || accountantScreen || warehouseDashScreen || deptHeadDashScreen
                    || branchesScreen || attendanceScreen || employeesScreen || warehouseScreen
                    || reportsScreen || goodsScanScreen || shelvesScreen || weightScreen;
                if (live) {live.reload();} else {reloadTable();}
            },
        },
        // The door in index.html opens V2 in a new tab; this is the way back
        // out of that tab. Relative on purpose — it must resolve under the
        // /app static mount, a LAN origin, and the Electron shell alike.
        { label: 'الواجهة الكلاسيكية', icon: 'monitor', onClick: () => { window.location.assign('index.html'); } },
    ],
    onNavigate(key) {
        applyKey(key);
    },
});

/* `location.hash` (not replaceState) so Back/Forward walk the screens the
   user actually visited. Idempotent: writing the hash that is already there
   would otherwise re-enter through the hashchange listener. */
function syncHash(key) {
    const target = hashFor(key);
    if (window.location.hash !== target) {window.location.hash = target;}
}

function applyRouteFromHash() {
    if (!ROUTING && !GOODS_SCAN_DEEP_LINK) {return;}
    const res = resolveRouteKey(window.location.hash, {
        known: ROUTE_KNOWN,
        denied: routeSettled ? currentDenied() : null,
    });
    // A deep link is not destroyed by an unfinished permissions round-trip:
    // hold it, paint the dashboard, and resolve again the moment §4b lands.
    if (!routeSettled && res.key !== DASH_KEY) {return;}
    if (res.key === navStatus.current && window.location.hash === hashFor(res.key)) {return;}
    if (res.reason) {console.info('[V2 routing] fallback:', res.reason);}
    applyKey(res.key);
}

if (ROUTING || GOODS_SCAN_DEEP_LINK) {window.addEventListener('hashchange', applyRouteFromHash);}

/* ── 4b. Real nav permissions — GET /permissions/me ───────────────────
   nav-model.allowedMenus() is a faithful mirror of legacy userMenus()
   (auth-navigation.js:286-294), but a mirror of an empty room: V2 never
   fetched the grants, so `permissions.menus` stayed [] and
   `permissions.deniedMenus` stayed [] too. The consequences were not
   cosmetic — a revocation (deniedMenus) is subtracted from the ROLE's own
   menus, so an un-fetched door meant V2 showed a manager a menu the admin
   had explicitly withdrawn, while legacy hid it. Two shells, two different
   answers to the same question, and the wrong one looked fine.
   fetchMyPermissions() never throws; on failure we keep role menus with no
   grants and no revocations applied, which is legacy's own fallback
   (auth-navigation.js:200). Only ever called with a live session — the
   fixture mode below still makes zero requests. */
async function applyMyPermissions() {
    if (!isLive()) {return;}
    window.STATE.permissions = await fetchMyPermissions();
    shell.refreshNav();
    // The held deep link (if any) can be judged for real only now.
    routeSettled = true;
    applyRouteFromHash();
}

/* ── 5. Live mode: resolve the browser's own session, then repaint ──────
   No top-level await (see §4) — this promise settles later and re-renders
   whatever screen is on screen at that moment. `rotate: true` is the ONLY
   place V2 is allowed to spend a shared credential, and only because
   ?live=1 was asked for explicitly. Without that flag the page makes no
   request at all. */
const sessionState = { status: LIVE ? 'pending' : 'off', info: null };

/* الوضع يُقرأ من عنوان التبويب وحده: شريط الوضع فوق الصفحة أُزيل
   (طلب المالك)، فما زال يبقى الفرق معلنًا بلا أن يزيح أول الصفحة. */
function updateModeTitle() {
    let mode;
    if (!LIVE || sessionState.status === 'none') {
        mode = 'معاينة';
    } else if (sessionState.status === 'pending') {
        mode = 'التحقق من الجلسة';
    } else {
        mode = 'جلسة حية';
    }
    document.title = `KARIM ERP — V2 (${mode})`;
}

updateModeTitle();

let sessionPromise = LIVE
    ? ensureSession({ rotate: true }).then((s) => {
        sessionState.status = s ? 'ready' : 'none';
        sessionState.info = s;
        updateModeTitle();
        if (s) {
            // The real role replaces the fixture; the backend stays the
            // authority for every request either way.
            window.STATE.currentUser = { role: s.role || null, name: (s.user && s.user.name) || '' };
            // Fire, never await: the first paint must not block on the grants
            // round-trip, and applyMyPermissions() repaints the nav itself
            // when it lands. (`void`, because a line-initial await trips the
            // no-top-level-await guard in tests/v2-branches.test.js.)
            void applyMyPermissions();
            try {shellExtras.refresh();} catch { /* extras are additive */ }
            if (aiAssistant) { try {aiAssistant.refresh();} catch { /* assistant is additive */ } }
            try {chat.refresh();} catch { /* chat is additive */ }
            /* The profile slot painted "دخول" before this session resolved;
               an existing session must show its sign-out door instead. */
            refreshProfileSlot();
        }
        renderScreen(navStatus.current);
        return s;
    })
    : Promise.resolve(null);

/* ── 5b. Command palette — REAL search over the live nav tree ─────────
   Mounted once into the shell's `search` boundary slot (mountBoundary
   replaces the inert placeholder, keeping its data-erp-boundary name).
   The overlay lives on <body> so screen swaps never strand it. */
mountCommandPalette(shell);

/* ── 5b3. مساعد V2 (الأدمن): معرفة المشروع + تشخيص حيّ + قراءة كود.
   Lives in the control center (مركز التحكم) beside «النظام الحالي».
   يُعلَن قبل الإسناد: الاستدعاء تحت أدناه يقع في نطاق زمني ميت (TDZ)
   لو سبق الإعلانُه —/ReferenceError كان يميت الشاشة كلها. */
let aiAssistant = null;
aiAssistant = mountAiAssistant(shell, {
    getRole: () => (sessionState.info && sessionState.info.role)
        || (window.STATE && window.STATE.currentUser && window.STATE.currentUser.role) || null,
    getScreen: () => navStatus.current,
    onToast: (m) => { try {toast(m);} catch { console.info('[V2]', m); } },
});

/* ── 5b2. Shell extras (W5): bell, lamps, language, quick actions, FAB,
   password change, offline bar — all additive, all server-gated. */
const shellExtras = mountShellExtras(shell, {
    getRole: () => (sessionState.info && sessionState.info.role)
        || (window.STATE && window.STATE.currentUser && window.STATE.currentUser.role) || null,
    getUserName: () => {
        const u = (sessionState.info && sessionState.info.user) || {};
        return String(u.name || u.username || '');
    },
    isLive: () => isLive(),
    onToast: (m) => { try {toast(m);} catch { console.info('[V2]', m); } },
});

/* ── 5b3. Staff chat — legacy app.js:332-466 behind ?v2chat (OFF).
   A global FAB like the old one: employee picker, private history, send,
   unread badge, admin toast and the `chat:new` push through socket.io.
   Hidden until a live session exists; with the flag absent it mounts
   nothing at all (chat.js returns inert). */
const chat = mountChat({
    isLive: () => isLive(),
    getUserId: () => {
        const u = (sessionState.info && sessionState.info.user) || null;
        if (u && u.id !== undefined && u.id !== null) {return u.id;}
        const live = window.STATE && window.STATE.currentUser;
        return live && live.id !== undefined ? live.id : null;
    },
    onToast: (m) => { try {toast(m);} catch { console.info('[V2 chat]', m); } },
});

/* ── 5b4. Mobile bottom navigation bar (FR-M1..M6) ──────────────────
   Active on screens <= 900px for field and backoffice roles.
   Navigates via shell.navigate(), toggles drawer with '__more'. */
const mobileShell = mountMobileShell({
    getRole: () => (sessionState.info && sessionState.info.role)
        || (window.STATE && window.STATE.currentUser && window.STATE.currentUser.role) || null,
    getMenus: () => (typeof allowedMenus === 'function' ? allowedMenus() : []),
    getPage: () => navStatus.current || 'dashboard',
    onNavigate: (page) => {
        if (ROUTING) {applyKey(page);} else {renderScreen(page);}
    },
    onToggleDrawer: () => {
        const openBtn = document.querySelector('[data-erp-open-drawer]');
        openBtn?.click();
    },
});

/* ── 5c. Auth — Gate C: the V2 sign-in (real /api/auth/login) ─────────
   The profile boundary slot (inert until now) becomes the sign-in/out
   door; the login screen is an internal route. A signed-in session flips
   isLive() so every screen reads its live door with zero edits to the
   screens themselves — and ?live=1 keeps working exactly as before. */
function isLive() {
    return LIVE || (typeof sessionState !== 'undefined' && sessionState.status === 'ready');
}

async function hydrateV2PrintLogo() {
    if (!isLive()) {return;}
    try {
        const settings = await fetchMainSettingsFull();
        const current = Array.isArray(settings) ? settings[0] : settings;
        setV2PrintLogo(current && current.logoB64);
    } catch (error) {
        console.warn('[V2] print logo settings could not be loaded:', error);
        toast('تعذّر تحميل شعار الطباعة من الإعدادات');
    }
}

installV2PrintBranding();

function currentDbConstraintRole() {
    return (sessionState.info && sessionState.info.role)
        || (window.STATE && window.STATE.currentUser && window.STATE.currentUser.role)
        || null;
}

function requireLiveDbConstraintRole() {
    if (!isLive()) {throw new Error('تحقق قيود قاعدة البيانات يتطلب جلسة حية');}
    return currentDbConstraintRole();
}

window.DBConstraintsV2 = Object.freeze({
    fetch: () => fetchDbConstraints(requireLiveDbConstraintRole()),
    invalidate: invalidateDbConstraints,
    validateField: (tableName, columnName, value) => validateDbField(
        tableName, columnName, value, requireLiveDbConstraintRole(),
    ),
    validateForm: (tableName, formData) => validateDbForm(
        tableName, formData, requireLiveDbConstraintRole(),
    ),
});

let loginReturnKey = 'dashboard';

function navigateLogin(returnKey) {
    loginReturnKey = returnKey && returnKey !== 'login' ? returnKey : 'dashboard';
    shell.navigate('login');
}

function onSessionReady(info) {
    sessionState.status = 'ready';
    sessionState.info = info || null;
    sessionPromise = Promise.resolve(sessionState.info);
    void hydrateV2PrintLogo();
    // Mirror the ?live=1 boot (same shape STATE carries in production).
    if (window.STATE && typeof window.STATE === 'object') {
        const user = (info && info.user) || {};
        window.STATE.currentUser = { role: (info && info.role) || null, name: user.name || '' };
    }
    shell.refreshNav();
    void applyMyPermissions();
    refreshProfileSlot();
    try {shellExtras.refresh();} catch { /* extras are additive */ }
            if (aiAssistant) { try {aiAssistant.refresh();} catch { /* assistant is additive */ } }
    try {chat.refresh();} catch { /* chat is additive */ }
    try {mobileShell.update();} catch { /* mobile shell is additive */ }
    const back = loginReturnKey && loginReturnKey !== 'login' ? loginReturnKey : 'dashboard';
    loginReturnKey = 'dashboard';
    // applyKey() also records the screen in navStatus; renderScreen() alone
    // left navStatus pointing at `login` and the next hash resolution
    // would have re-rendered the sign-in over the page just signed into.
    if (ROUTING) {applyKey(back);} else {renderScreen(back);}
}

function doV2Logout() {
    // Memory session only. The stored refresh token is SHARED with the
    // production app on this origin — clearing it here would log the user
    // out of index.html too, so it is deliberately left alone.
    try { window._jwt = null; } catch { /* private mode */ }
    try { window._appKey = null; } catch { /* private mode */ }
    if (window.STATE && typeof window.STATE === 'object') {
        window.STATE.currentUser = null;
        // The previous user's grants are not this user's menus.
        window.STATE.permissions = { menus: [], deniedMenus: [] };
    }
    sessionState.status = 'off';
    sessionState.info = null;
    sessionPromise = Promise.resolve(null);
    shell.refreshNav();
    refreshProfileSlot();
    try {shellExtras.refresh();} catch { /* extras are additive */ }
            if (aiAssistant) { try {aiAssistant.refresh();} catch { /* assistant is additive */ } }
    try {chat.refresh();} catch { /* chat is additive */ }
    try {mobileShell.update();} catch { /* mobile shell is additive */ }
    shell.navigate('dashboard');
}

function refreshProfileSlot() {
    const logged = sessionState.status === 'ready';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'erp-btn erp-btn--sm';
    if (logged) {
        btn.innerHTML = `<i class="ji" data-i="user" aria-hidden="true"></i><span>خروج</span>`;
        btn.setAttribute('aria-label', 'تسجيل الخروج من المعاينة (تبقى جلسة النظام الحالي)');
    } else {
        btn.innerHTML = `<i class="ji" data-i="lock" aria-hidden="true"></i><span>دخول</span>`;
        btn.setAttribute('aria-label', 'تسجيل الدخول');
    }
    btn.addEventListener('click', () => {
        if (sessionState.status === 'ready') {doV2Logout();}
        else {navigateLogin(navStatus.current);}
    });
    shell.mountBoundary('profile', btn);
}

function renderLoginScreen() {
    shell.setBreadcrumbs({ trail: [
        { label: 'الرئيسية', key: 'dashboard' },
        { label: 'تسجيل الدخول' },
    ] });
    shell.main.innerHTML = `
      ${liveModeStrip()}
      <div style="margin-block-start:var(--erp-space-4)" data-v2-login-host></div>`;
    mountLoginScreen(shell.main.querySelector('[data-v2-login-host]'), {
        onSuccess: onSessionReady,
    });
}

refreshProfileSlot();

/* ── 6. Status adapter showcase (real persisted values) ────────────── */
const STATUS_SAMPLES = [
    ['employees', 'active'],        ['device', 'online'],
    ['dispatch', 'pending'],        ['dispatch', 'chef_approved'],
    ['dispatch', 'received'],       ['dispatch', 'rejected'],
    ['purchase_request', 'pending'],['purchase_request', 'approved'],
    ['leave', 'approved'],          ['leave', 'rejected'],
    ['journal_entry', 'posted'],    ['journal_entry', 'draft'],
    ['shift_session', 'open'],      ['pos_order', 'issued'],
    ['import_log', 'COMPLETED'],    ['import_log', 'PROCESSING'],
    ['payment', 'partial'],         ['check', 'WARN'],
    ['dispatch', 'brand_new_value'],// unknown → raw + dashed, never guessed
];

/* ── 7. Sample table rows (fixtures — flagged in the UI) ───────────── */
const SAMPLE_ROWS = [
    { id: 1041, employee: 'أحمد محمود',   dept: 'المطبخ',      date: '2026-10-13', in: '08:57', out: '17:04', minutes: 487, status: 'active' },
    { id: 1042, employee: 'سارة عبد الله', dept: 'الكاشير',     date: '2026-10-13', in: '09:01', out: '17:12', minutes: 491, status: 'active' },
    { id: 1043, employee: 'خالد سعيد',    dept: 'المخزن',      date: '2026-10-13', in: '09:14', out: '16:48', minutes: 454, status: 'active' },
    { id: 1044, employee: 'منى حسن',      dept: 'الخدمة',      date: '2026-10-13', in: '10:02', out: '18:30', minutes: 508, status: 'active' },
    { id: 1045, employee: 'يوسف علي',     dept: 'المطبخ',      date: '2026-10-12', in: '08:55', out: '17:00', minutes: 485, status: 'active' },
    { id: 1046, employee: 'هدى ناصر',     dept: 'الإدارة',     date: '2026-10-12', in: '08:30', out: '16:45', minutes: 495, status: 'inactive' },
    { id: 1047, employee: 'عمر فاروق',    dept: 'الكاشير',     date: '2026-10-12', in: '09:05', out: '17:20', minutes: 495, status: 'active' },
    { id: 1048, employee: 'نورا إبراهيم', dept: 'الخدمة',      date: '2026-10-11', in: '11:00', out: '19:35', minutes: 515, status: 'active' },
    { id: 1049, employee: 'مصطفى رأفت',   dept: 'المخزن',      date: '2026-10-11', in: '08:48', out: '15:12', minutes: 384, status: 'inactive' },
    { id: 1050, employee: 'ريم شريف',     dept: 'الإدارة',     date: '2026-10-11', in: '08:12', out: '16:59', minutes: 527, status: 'active' },
    { id: 1051, employee: 'طارق منير',    dept: 'المطبخ',      date: '2026-10-10', in: '09:00', out: '17:05', minutes: 485, status: 'active' },
    { id: 1052, employee: 'سلمى عادل',    dept: 'الكاشير',     date: '2026-10-10', in: '09:22', out: '17:44', minutes: 502, status: 'active' },
    { id: 1053, employee: 'كريم أنور',    dept: 'الخدمة',      date: '2026-10-10', in: '12:00', out: '20:15', minutes: 495, status: 'active' },
    { id: 1054, employee: 'دعاء صلاح',    dept: 'الإدارة',     date: '2026-10-09', in: '08:40', out: '16:30', minutes: 470, status: 'active' },
    { id: 1055, employee: 'أيمن بكر',     dept: 'المخزن',      date: '2026-10-09', in: '08:59', out: '17:02', minutes: 483, status: 'inactive' },
];

/** @type {ReturnType<typeof createDataTable>|null} */
let table = null;

function buildTable() {
    table = createDataTable({
        caption: 'سجل الحضور — بيانات نموذجية',
        mode: 'client',
        pageSize: 8,
        selectable: true,
        stickyHeader: true,
        emptyMessage: 'لا توجد سجلات مطابقة',
        emptyHint: 'جرّب مسح البحث أو تغيير الفلاتر.',
        rowKey: (row) => row.id,
        onRowActivate: (row) => {
            console.info('[V2 preview] row activated (boundary — no detail view wired):', row.id);
            shell.setBreadcrumbs({ trail: [
                { label: 'الرئيسية', key: 'dashboard' },
                { label: 'الحضور', key: 'attendance' },
                { label: `سجل #${row.id}` },
            ] });
        },
        onSelectionChange: (rows) => {
            console.info('[V2 preview] selection:', rows.length);
        },
        columns: [
            {
                key: 'id', header: 'الرقم', type: 'number', sortable: true,
                width: '90px', align: 'end', className: 'erp-mono',
            },
            { key: 'employee', header: 'الموظف', sortable: true, filterable: true },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '130px' },
            { key: 'date', header: 'التاريخ', sortable: true, filterable: true, width: '120px', align: 'center' },
            { key: 'in', header: 'الدخول', width: '96px', align: 'center', className: 'erp-tnum' },
            { key: 'out', header: 'الخروج', width: '96px', align: 'center', className: 'erp-tnum' },
            {
                key: 'minutes', header: 'الدقائق', type: 'number', sortable: true,
                width: '100px', align: 'end', className: 'erp-tnum',
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                render: (row) => statusBadge('employees', row.status),
                value: (row) => row.status,
            },
        ],
    });
    return table;
}

function reloadTable() {
    if (!table) {return;}
    table.setLoading(true);
    // Simulated latency for the loading state only — no network, no API.
    setTimeout(() => {
        table.setRows(SAMPLE_ROWS);
        table.setLoading(false);
    }, 350);
}

/* ── 8. Screens ─────────────────────────────────────────────────────── */

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The live screens V2 has mounted — one instance each, destroyed on nav. */
let branchesScreen = null;
let attendanceScreen = null;
let employeesScreen = null;
let briefingScreen = null;
let cfoScreen = null;
let warehouseScreen = null;
let warehouseGovScreen = null;
let reportsScreen = null;
let procurementScreen = null;
let invoicesScreen = null;
let paymentsScreen = null;
let whInvoicesScreen = null;
let kitchenScreen = null;
let leavesScreen = null;
let dispatchScreen = null;
let vegScreen = null;
let whMovesScreen = null;
let goodsScanScreen = null;
let whReturnsScreen = null;
let whPrsScreen = null;
let departmentsScreen = null;
let hrDepartmentsScreen = null;
let payrollScreen = null;
let revenuesScreen = null;
let expensesScreen = null;
let costAnalysisScreen = null;
let pnlScreen = null;
let hrDashboardScreen = null;
let zktecoScreen = null;
let deptEmpScreen = null;
let salesAnalyzerScreen = null;
let receivedAnalyzerScreen = null;
let whVsPosScreen = null;
let queryScreen = null;
let professionalScreen = null;
let recipesScreen = null;
let rosterScreen = null;
let employeePortalScreen = null;
let settingsScreen = null;
let usersScreen = null;
let yarasoftScreen = null;
let whatsappScreen = null;
let permissionsScreen = null;
let cashierMonitorScreen = null;
let oracleDataScreen = null;
let dailyLocksScreen = null;
let menuBoardScreen = null;
let posEntryScreen = null;
let shelvesScreen = null;
let weightScreen = null;
let accountantScreen = null;
let warehouseDashScreen = null;
let deptHeadDashScreen = null;

function teardownBranchesScreen() {
    if (branchesScreen) {
        branchesScreen.destroy();
        branchesScreen = null;
    }
}

function teardownAttendanceScreen() {
    if (attendanceScreen) {
        attendanceScreen.destroy();
        attendanceScreen = null;
    }
}

function teardownEmployeesScreen() {
    if (employeesScreen) {
        employeesScreen.destroy();
        employeesScreen = null;
    }
}

function teardownBriefingScreen() {
    if (briefingScreen) {
        briefingScreen.destroy();
        briefingScreen = null;
    }
}

function teardownCfoScreen() {
    if (cfoScreen) {
        cfoScreen.destroy();
        cfoScreen = null;
    }
}

function teardownWarehouseScreen() {
    if (warehouseScreen) {
        warehouseScreen.destroy();
        warehouseScreen = null;
    }
}

function teardownWarehouseGovScreen() {
    if (warehouseGovScreen) {
        warehouseGovScreen.destroy();
        warehouseGovScreen = null;
    }
}

function teardownReportsScreen() {
    if (reportsScreen) {
        reportsScreen.destroy();
        reportsScreen = null;
    }
}

function teardownProcurementScreen() {
    if (procurementScreen) {
        procurementScreen.destroy();
        procurementScreen = null;
    }
}

function teardownInvoicesScreen() {
    if (invoicesScreen) {
        invoicesScreen.destroy();
        invoicesScreen = null;
    }
}

function teardownPaymentsScreen() {
    if (paymentsScreen) {
        paymentsScreen.destroy();
        paymentsScreen = null;
    }
}

function teardownWhInvoicesScreen() {
    if (whInvoicesScreen) {
        whInvoicesScreen.destroy();
        whInvoicesScreen = null;
    }
}

function teardownKitchenScreen() {
    if (kitchenScreen) {
        kitchenScreen.destroy();
        kitchenScreen = null;
    }
}

function teardownLeavesScreen() {
    if (leavesScreen) {
        leavesScreen.destroy();
        leavesScreen = null;
    }
}

function teardownDispatchScreen() {
    if (dispatchScreen) {
        dispatchScreen.destroy();
        dispatchScreen = null;
    }
}

function teardownVegScreen() {
    if (vegScreen) {
        vegScreen.destroy();
        vegScreen = null;
    }
}

function teardownWhMovesScreen() {
    if (whMovesScreen) { whMovesScreen.destroy(); whMovesScreen = null; }
}

function teardownGoodsScanScreen() {
    if (goodsScanScreen) { goodsScanScreen.destroy(); goodsScanScreen = null; }
}

function teardownWhReturnsScreen() {
    if (whReturnsScreen) { whReturnsScreen.destroy(); whReturnsScreen = null; }
}

function teardownWhPrsScreen() {
    if (whPrsScreen) { whPrsScreen.destroy(); whPrsScreen = null; }
}

function teardownRecipesScreen() {
 if (recipesScreen) { recipesScreen.destroy(); recipesScreen = null; }
}

function teardownRosterScreen() { if (rosterScreen) { rosterScreen.destroy(); rosterScreen = null; } }
function teardownEmployeePortalScreen() { if (employeePortalScreen) { employeePortalScreen.destroy(); employeePortalScreen = null; } }
function teardownSettingsScreen() { if (settingsScreen) { settingsScreen.destroy(); settingsScreen = null; } }
function teardownUsersScreen() { if (usersScreen) { usersScreen.destroy(); usersScreen = null; } }
function teardownYarasoftScreen() { if (yarasoftScreen) { yarasoftScreen.destroy(); yarasoftScreen = null; } }
function teardownWhatsappScreen() { if (whatsappScreen) { whatsappScreen.destroy(); whatsappScreen = null; } }
function teardownPermissionsScreen() { if (permissionsScreen) { permissionsScreen.destroy(); permissionsScreen = null; } }
function teardownCashierMonitorScreen() { if (cashierMonitorScreen) { cashierMonitorScreen.destroy(); cashierMonitorScreen = null; } }
function teardownOracleDataScreen() { if (oracleDataScreen) { oracleDataScreen.destroy(); oracleDataScreen = null; } }
function teardownDailyLocksScreen() { if (dailyLocksScreen) { dailyLocksScreen.destroy(); dailyLocksScreen = null; } }
function teardownMenuBoardScreen() { if (menuBoardScreen) { menuBoardScreen.destroy(); menuBoardScreen = null; } }
function teardownPosEntryScreen() { if (posEntryScreen) { posEntryScreen.destroy(); posEntryScreen = null; } }
function teardownShelvesScreen() { if (shelvesScreen) { shelvesScreen.destroy(); shelvesScreen = null; } }
function teardownWeightScreen() { if (weightScreen) { weightScreen.destroy(); weightScreen = null; } }

function teardownAccountantScreen() { if (accountantScreen) { accountantScreen.destroy(); accountantScreen = null; } }

function teardownWarehouseDashScreen() { if (warehouseDashScreen) { warehouseDashScreen.destroy(); warehouseDashScreen = null; } }

function teardownDeptHeadDashScreen() { if (deptHeadDashScreen) { deptHeadDashScreen.destroy(); deptHeadDashScreen = null; } }

function teardownDepartmentsScreen() {
    if (departmentsScreen) { departmentsScreen.destroy(); departmentsScreen = null; }
}

function teardownHrDepartmentsScreen() {
    if (hrDepartmentsScreen) { hrDepartmentsScreen.destroy(); hrDepartmentsScreen = null; }
}

function teardownPayrollScreen() {
    if (payrollScreen) { payrollScreen.destroy(); payrollScreen = null; }
}

function teardownRevenuesScreen() {
    if (revenuesScreen) {
        revenuesScreen.destroy();
        revenuesScreen = null;
    }
}

function teardownExpensesScreen() {
    if (expensesScreen) {
        expensesScreen.destroy();
        expensesScreen = null;
    }
}

function teardownCostAnalysisScreen() {
    if (costAnalysisScreen) {
        costAnalysisScreen.destroy();
        costAnalysisScreen = null;
    }
}

function teardownPnlScreen() {
    if (pnlScreen) {
        pnlScreen.destroy();
        pnlScreen = null;
    }
}

function teardownHrDashboardScreen() {
    if (hrDashboardScreen) {
        hrDashboardScreen.destroy();
        hrDashboardScreen = null;
    }
}

function teardownZktecoScreen() {
    if (zktecoScreen) {
        zktecoScreen.destroy();
        zktecoScreen = null;
    }
}

function teardownDeptEmployeesScreen() {
    if (deptEmpScreen) {
        deptEmpScreen.destroy();
        deptEmpScreen = null;
    }
}

function teardownSalesAnalyzerScreen() {
    if (salesAnalyzerScreen) { salesAnalyzerScreen.destroy(); salesAnalyzerScreen = null; }
}

function teardownReceivedAnalyzerScreen() {
    if (receivedAnalyzerScreen) { receivedAnalyzerScreen.destroy(); receivedAnalyzerScreen = null; }
}

function teardownWhVsPosScreen() {
    if (whVsPosScreen) { whVsPosScreen.destroy(); whVsPosScreen = null; }
}

function teardownQueryScreen() {
    if (queryScreen) { queryScreen.destroy(); queryScreen = null; }
}

function teardownProfessionalScreen() {
    if (professionalScreen) { professionalScreen.destroy(); professionalScreen = null; }
}

/**
 * Says out loud which mode the page is in. A preview that quietly switches
 * between sample and real data is worse than one that states both.
 *
 * Built from the primitives the shell already ships (erp-card + erp-stack +
 * erp-text-sm) — no new CSS class, so the strip cannot drift from the
 * stylesheet it is supposed to match.
 */
function strip(body, role) {
    return `
      <section class="erp-card"${role ? ` role="${role}"` : ''}>
        <div class="erp-card__body erp-stack">
          ${body}
        </div>
      </section>`;
}

function liveModeStrip() {
    // Three states, stated out loud: logged-out preview (no requests at
    // all), ?live=1 resolving/failed, and a real session — whether it came
    // from ?live=1 rotation or from the Gate C sign-in form below.
    if (!LIVE && sessionState.status !== 'ready') {
        return strip(`
          <h3 class="erp-card__title">وضع المعاينة — بيانات نموذجية</h3>
          <p class="erp-text-sm erp-text-muted">
            لا يُطلب أي شيء من الشبكة في هذا الوضع. لقراءة بيانات حقيقية بالجلسة
            المسجّلة في هذا المتصفح: <a href="v2.html?live=1">الوضع الحيّ</a>
            — الوضع يبدّل مصدر البيانات فقط، ولا يُنشئ جلسة ولا يغيّر كلمة مرور.
          </p>`);
    }
    if (sessionState.status === 'pending') {
        return strip(`
          <h3 class="erp-card__title">جارٍ التحقق من الجلسة…</h3>
          <p class="erp-text-sm erp-text-muted">جارٍ التحقق من الجلسة المسجّلة في هذا المتصفح…</p>`,
        'status');
    }
    if (sessionState.status === 'none') {
        return strip(`
          <h3 class="erp-card__title">لا توجد جلسة في هذا المتصفح</h3>
          <p class="erp-text-sm erp-text-muted">
            الوضع الحيّ لا يُنشئ جلسة — لا توجد وسيلة آمنة لتسجيل الدخول من هنا.
            سجّل الدخول في النظام الحالي ثم أعد فتح
            <a href="v2.html?live=1">الوضع الحيّ</a>.
          </p>
          <a class="erp-btn erp-btn--sm" href="index.html">الذهاب لتسجيل الدخول</a>`,
        'alert');
    }
    const info = sessionState.info || {};
    return strip(`
      <h3 class="erp-card__title">وضع البيانات الحية</h3>
      <p class="erp-text-sm erp-text-muted">
        جلسة حقيقية بصلاحية
        <strong>${esc((ROLES[info.role] && ROLES[info.role].name) || 'مستخدم')}</strong> —
        القيم المعروضة تُقرأ من واجهات النظام نفسها، والصلاحية للخادم وحده.
      </p>`,
    'status');
}

/** Live read of /api/branches — or an honest statement of why there is none. */
function renderBranchesScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          ${branchShowcaseSection()}`;
        const host = shell.main.querySelector('[data-v2-sample-host]');
        if (!table) {buildTable();}
        host.appendChild(table.el);
        reloadTable();
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'branches') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState();
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-branches-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        branchesScreen = mountBranchesScreen(shell.main.querySelector('[data-v2-branches-host]'), {
            role: session.role,
            notify: notifyTo(note),
        });
    });
}

/** Live read of /api/attendance/range — or an honest statement of why there is none.
 *  Screen 01 in js/v2/MIGRATION.md. W2-3: the screen carries the write cycle
 *  (buttons hide by role, the server re-checks every write); the host hands
 *  it the session identity and the confirm function. The non-live branch
 *  shows no fixtures — the dashboard below already carries the labelled
 *  attendance sample. */
function renderAttendanceScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">شاشة الحضور — أول شاشة تُنقل في V2</span>
                <span>في وضع المعاينة ترى نموذج سجل الحضور في لوحة التحكم. البيانات الحية
                تتطلب <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'attendance') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + `
              <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
                <div class="erp-card__body">
                  <div class="erp-state">
                    <span class="erp-state__title">لا جلسة — لا بيانات عرض</span>
                    <span>هذه الشاشة لا تعرض صفوفًا نموذجية تحت اسم «الحضور» في الوضع الحيّ.</span>
                  </div>
                </div>
              </section>`;
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-attendance-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        const u = session.user || {};
        attendanceScreen = mountAttendanceScreen(shell.main.querySelector('[data-v2-attendance-host]'), {
            role: session.role,
            userId: u.id != null ? u.id : (u.sub != null ? Number(u.sub) : null),
            userName: String(u.name || u.username || ''),
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/** Live read of /api/employees — screen 02 in js/v2/MIGRATION.md.
 *  Same honesty rule as attendance: no fixtures under the screen's name. */
function renderEmployeesScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">شاشة الموظفون — ثاني شاشة تُنقل في V2</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'employees') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + `
              <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
                <div class="erp-card__body">
                  <div class="erp-state">
                    <span class="erp-state__title">لا جلسة — لا بيانات عرض</span>
                    <span>هذه الشاشة لا تعرض صفوفًا نموذجية تحت اسم «الموظفون» في الوضع الحيّ.</span>
                  </div>
                </div>
              </section>`;
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-employees-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        employeesScreen = mountEmployeesScreen(shell.main.querySelector('[data-v2-employees-host]'), {
            role: session.role,
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/**
 * Live read of /api/warehouse/inventory/search — screen 03 in js/v2/MIGRATION.md.
 * Keyed to `warehouse` because that is the nav key the role menus already use
 * for the warehouse page (layout/nav-model.js:39). Its filters are the
 * server's own (q/category/stock), which is why the non-live branch shows an
 * empty statement instead of fixture rows: a fake register would pretend that
 * the server answered, and it did not.
 */
function renderWarehouseScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">شاشة المخزون — ثالث شاشة تُنقل في V2</span>
                <span>فلاترها (الحالة والفئة والبحث المتسامح) تُسأل الخادم نفسه، فلا
                نموذج يُعرض بدلها. البيانات الحية تتطلب
                <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'warehouse') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('المخزون');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-warehouse-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        // W1-6: الشاشة صارت تحمل كتابات المخزون الستة — تأكيدات الحذف النهائي
        // والوارد تمر بـ confirmFn من المضيف (CSP يمنع window.confirm داخل V2).
        // W1-6c: واستوديو الجرد يقفل توقيعه باسم الحساب (والخادم يعيد الفحص)
        // — نفس قاعدة شاشة المطبخ: عدة أشكال للجلسة، والتطبيع هنا مرة واحدة.
        const u = session.user || {};
        warehouseScreen = mountWarehouseScreen(shell.main.querySelector('[data-v2-warehouse-host]'), {
            role: session.role,
            userName: String(u.name || u.username || ''),
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
            navigate: (key) => shell.navigate(key),
        });
    });
}

/**
 * P2-4 — حوكمة المخزن: ثلاث قراءات مستقلة (سنوات مالية، رصيد افتتاحي،
 * فحص نظام). كل بطاقة تحمل دور الخادم نفسه؛ لا نموذجية في الوضع الحيّ.
 * المفتاح `warehouse-gov` مسار فرعي يُفتح من شاشة المخزون، لا من قائمة دور.
 */
function renderWarehouseGovScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">حوكمة المخزن — سنوات مالية ورصيد افتتاحي وفحص نظام</span>
                <span>القراءة الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح؛ لا سنوات ولا أرقام نموذجية تحت هذا الاسم.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'warehouse-gov') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('حوكمة المخزن');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-warehouse-gov-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        warehouseGovScreen = mountWarehouseGovScreen(shell.main.querySelector('[data-v2-warehouse-gov-host]'), {
            role: session.role,
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/**
 * Live read of /api/pos/reports/sales — screen 04 in js/v2/MIGRATION.md.
 * Keyed to `reports` because that is the nav key the role menus already carry
 * (layout/nav-model.js:41; roles admin|manager|accountant in core/config.js).
 * Period and grouping are answered in SQL by the server, so the non-live
 * branch states what the screen will read instead of showing invented totals.
 */
function renderReportsScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">شاشة التقارير — رابع شاشة تُنقل في V2</span>
                <span>الفترة والتجميع يُحسبان في SQL على الخادم، فلا رقم نموذجي يُعرض
                بدلها. الأرقام الحية تتطلب
                <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن تقرير من الفترة نفسها.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'reports') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('التقارير');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-reports-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        reportsScreen = mountReportsScreen(shell.main.querySelector('[data-v2-reports-host]'), {
            role: session.role,
            notify: notifyTo(note),
        });
    });
}

/**
 * Live executive dashboard on /api/manager/briefing + /api/pos/orders/stats/today.
 * Keyed to `cfo` because that is the role menu the backend already treats as
 * the executive view — V2 does not invent a nav key to fit its own demo.
 * The briefing endpoint is requireRole('admin','manager'); any other role
 * gets its 403 shown as text, not a silently empty grid.
 *
 * محفوظة بقصد ولا تُحذف: عقد المضيف في tests/v2-briefing.test.js:397 يثبّت
 * الاسم نصًّا (`renderBriefingScreen()`)، والمضيف الحيّ للوحة اليوم يستدعي
 * mountBriefingScreen عبر الكتلة أسفل الراوتر. حذفها يكسر العقد بلا مكسب.
 */
// eslint-disable-next-line no-unused-vars -- محفوظة لعقد v2-briefing.test.js:397
function renderBriefingScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">موجز المدير — شاشة بأرقام حية</span>
                <span>لوحة التحكم هنا تعرض نموذجًا للقياس؛ الأرقام الحقيقية تُقرأ من
                <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'cfo') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('الموجز');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-briefing-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        briefingScreen = mountBriefingScreen(shell.main.querySelector('[data-v2-briefing-host]'), {
            role: session.role,
            notify: notifyTo(note),
        });
    });
}

/** Live read of /api/procurement/* — screen 05 in js/v2/MIGRATION.md.
 *  Keyed to `procurement` (role menus, core/config.js). Scope v1 is the
 *  suppliers directory + summary; invoices/payments are screens 06/07. */
function renderProcurementScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">شاشة الموردون — خامس شاشة تُنقل في V2</span>
                <span>الدليل والملخص يُقرآن من الخادم، فلا نموذج يُعرض بدلها. البيانات
                الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'procurement') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('الموردون');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-procurement-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        procurementScreen = mountProcurementScreen(shell.main.querySelector('[data-v2-procurement-host]'), {
            role: session.role,
            notify: notifyTo(note),
            navigate: (k) => shell.navigate(k),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/** Live reads for the procurement hub tabs (06/07) — same honesty rule:
 *  no fixtures under the screens' names, in either mode. */
function renderInvoicesScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">فواتير الموردين — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'procurement-invoices') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('فواتير الموردين');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-invoices-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        invoicesScreen = mountInvoicesScreen(shell.main.querySelector('[data-v2-invoices-host]'), {
            role: session.role,
            notify: notifyTo(note),
            navigate: (k) => shell.navigate(k),
        });
    });
}

function renderPaymentsScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">مدفوعات الموردين — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'procurement-payments') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('مدفوعات الموردين');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-payments-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        paymentsScreen = mountPaymentsScreen(shell.main.querySelector('[data-v2-payments-host]'), {
            role: session.role,
            notify: notifyTo(note),
            navigate: (k) => shell.navigate(k),
        });
    });
}

/** Live read of /api/purchaseInvoices through the warehouse month lens —
 *  screen 08 in js/v2/MIGRATION.md. Same honesty rule: no fixtures. */
function renderWhInvoicesScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">فواتير الشراء — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'wh-invoices') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('فواتير الشراء');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-whinvoices-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        whInvoicesScreen = mountWhInvoicesScreen(shell.main.querySelector('[data-v2-whinvoices-host]'), {
            role: session.role,
            notify: notifyTo(note),
            navigate: (k) => shell.navigate(k),
        });
    });
}

/** Live read of /api/kitchen/overview — screen 09 in js/v2/MIGRATION.md.
 *  First operational door the sous_chef role may read. Same honesty rule. */
function renderKitchenScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">المطبخ — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'kitchen') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('المطبخ');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-kitchen-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        // W1-2: الدورة الكاملة صارت كتابةً — اسم الحساب يقفل التواقيع ويرسمها
        // (والخادم يعيد الفحص), والاعتماد يسأل قبل ترحيل فروقات الجرد.
        // User may be JWT claims ({sub,name}) or the refresh shape
        // ({id,name,username}) — normalise once, here (same fix as dispatch).
        const u = session.user || {};
        kitchenScreen = mountKitchenScreen(shell.main.querySelector('[data-v2-kitchen-host]'), {
            role: session.role,
            userName: String(u.name || u.username || ''),
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/** Live read of /api/leaveRequests — screen 10 in js/v2/MIGRATION.md.
 *  Same honesty rule: no fixtures under the screen's name, in either mode. */
function renderLeavesScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">طلبات الإجازات — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'leaves') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('الإجازات');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-leaves-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        leavesScreen = mountLeavesScreen(shell.main.querySelector('[data-v2-leaves-host]'), {
            role: session.role,
            notify: notifyTo(note),
        });
    });
}

/** Live read of /api/zkteco/* — screen 11 in js/v2/MIGRATION.md.
 *  Completes the attendance triangle (records + leaves + devices).
 *  Same honesty rule: no fixtures under the screen's name, in either mode. */
function renderZktecoScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">أجهزة البصمة — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'zkteco') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('أجهزة البصمة');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-zkteco-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        zktecoScreen = mountZktecoScreen(shell.main.querySelector('[data-v2-zkteco-host]'), {
            role: session.role,
            notify: notifyTo(note),
        });
    });
}

/** Live HR overview — screen 12 in js/v2/MIGRATION.md. Composes proven
 *  doors only (employees + today attendance + leaves + departments +
 *  currency); each may fail independently and is named when it does.
 *  Same honesty rule: no fixtures under the screen's name, in either mode. */
function renderHrDashboardScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">لوحة الموارد البشرية — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'hr-dashboard') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('لوحة الموارد');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-hrdash-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        hrDashboardScreen = mountHrDashboardScreen(shell.main.querySelector('[data-v2-hrdash-host]'), {
            role: session.role,
            notify: notifyTo(note),
            navigate: (k) => shell.navigate(k),
        });
    });
}

/** Live read of /api/dispatches — screen 13 in js/v2/MIGRATION.md.
 *  Same honesty rule: no fixtures under the screen's name, in either mode. */
function renderDispatchScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">أذون الصرف — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'dispatch') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('أذون الصرف');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-dispatch-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        // W1-1: الهوية كاملة للشاشة — اسم الحساب يقفل التواقيع (يسجّلها الخادم
        // باسمه)، والقسم يحكم نطاق dept_head، والمعرّف يُرسل مع الإنشاء.
        // User may be JWT claims ({sub,name,dept_code}) or the refresh shape
        // ({id,name,role,username,dept_code}) — normalise both once, here.
        const u = session.user || {};
        dispatchScreen = mountDispatchScreen(shell.main.querySelector('[data-v2-dispatch-host]'), {
            role: session.role,
            userId: u.id != null ? u.id : (u.sub != null ? Number(u.sub) : null),
            userName: String(u.name || u.username || ''),
            deptCode: String(u.dept_code || ''),
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/** Live read of /api/veg-requests — screen 14 in js/v2/MIGRATION.md.
 *  Same honesty rule: no fixtures under the screen's name, in either mode. */
function renderVegScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">طلبات شراء الخضار — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== 'veg-requests') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('طلبات الخضار');
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-veg-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        // W1-4: الهوية كاملة للشاشة — اسم الحساب يطبع على ورقة الطلب،
        // والمعرّف يحكم بوابتي التعديل والإلغاء (صاحب الطلب)، وconfirmFn
        // لتأكيد رفض كل الأصناف. User may be JWT claims ({sub,name,dept_code})
        // or the refresh shape ({id,name,role,username,dept_code}).
        const u = session.user || {};
        vegScreen = mountVegScreen(shell.main.querySelector('[data-v2-veg-host]'), {
            role: session.role,
            userId: u.id != null ? u.id : (u.sub != null ? Number(u.sub) : null),
            userName: String(u.name || u.username || ''),
            notify: notifyTo(note),
            confirmFn: (message) => window.confirm(message),
        });
    });
}

/**
 * Shared live-gate painter for the read-only finance registers (screens
 * 15-18). Same contract as every render*Screen above: preview mode never
 * touches the network, live mode needs a signed-in session, and the
 * screen instance is handed back through `assign` so each teardown can
 * reach its own module-level variable.
 */
function renderLiveRegisterScreen({ key, title, mount, assign }) {
    if (!isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state">
                <span class="erp-state__title">${esc(title)} — تُقرأ من الخادم</span>
                <span>البيانات الحية تتطلب <a href="v2.html?live=1">الوضع الحيّ</a>
                بجلسة مسجلة في هذا المتصفح.</span>
                <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
              </div>
            </div>
          </section>`;
        shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
        return;
    }

    shell.main.innerHTML = `
      ${liveModeStrip()}
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state" role="status" aria-live="polite">
            <span class="erp-state__title">جارٍ تجهيز الشاشة…</span>
            <span>لا تُعرض بيانات نموذجية في الوضع الحيّ — لا بديل عن السجل الحقيقي.</span>
          </div>
        </div>
      </section>`;

    sessionPromise.then((session) => {
        if (navStatus.current !== key) {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState(title);
            return;
        }
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
            <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
            <div data-v2-register-host></div>
          </div>`;
        const note = shell.main.querySelector('[data-v2-note]');
        const host = shell.main.querySelector('[data-v2-register-host]');
        /* Screens that carry their own status line own the message; the shell
           line exists only for screens that do not. Binding through a proxy
           means ctx.notify() lands in whichever line survives, and removing
           the shell line after mount prevents a second visible copy and a
           second live-region announcement of the same sentence. */
        const noteTarget = {
            get textContent() { return (host.querySelector('[data-v2-note]') || note).textContent; },
            set textContent(value) { (host.querySelector('[data-v2-note]') || note).textContent = value; },
        };
        const u = session.user || {};
        assign(mount(host, {
            role: session.role,
            userId: u.id != null ? u.id : null,
            userName: String(u.name || u.username || ''),
            deptCode: String(u.dept_code || ''),
            featureFlags: V2_FEATURE_FLAGS,
            confirmFn: (message) => window.confirm(message),
            notify: notifyTo(noteTarget),
            navigate: (key) => shell.navigate(key),
        }));
        if (host.querySelector('[data-v2-note]')) {note.remove();}
    });
}

function renderCfoScreen() { renderLiveRegisterScreen({ key: 'cfo', title: 'المدير المالي', mount: mountCfoScreen, assign: (s) => { cfoScreen = s; } }); }

function renderRevenuesScreen() {
    renderLiveRegisterScreen({
        key: 'revenues', title: 'الإيرادات', mount: mountRevenuesScreen,
        assign: (s) => { revenuesScreen = s; },
    });
}

function renderExpensesScreen() {
    renderLiveRegisterScreen({
        key: 'expenses', title: 'المصروفات', mount: mountExpensesScreen,
        assign: (s) => { expensesScreen = s; },
    });
}

function renderCostAnalysisScreen() {
    renderLiveRegisterScreen({
        key: 'cost-analysis', title: 'تحليل التكاليف', mount: mountCostAnalysisScreen,
        assign: (s) => { costAnalysisScreen = s; },
    });
}

function renderPnlScreen() {
    renderLiveRegisterScreen({
        key: 'pnl', title: 'قائمة الدخل', mount: mountPnlScreen,
        assign: (s) => { pnlScreen = s; },
    });
}

function renderWhMovesScreen() {
    renderLiveRegisterScreen({ key: 'wh-moves', title: 'حركات المخزون', mount: mountWhMovesScreen, assign: (s) => { whMovesScreen = s; } });
}

/* البند ٩: مسح الباركود — مسارٌ فرعي (#goods-scan) لا بطاقة في القائمة،
   والشاشة نفسها تقرأ ?v2scan وتطفئ كل شيء بدونه (screens/goods-scan.js). */
function renderGoodsScanScreen() {
    renderLiveRegisterScreen({ key: 'goods-scan', title: 'مسح الباركود', mount: mountGoodsScanScreen, assign: (s) => { goodsScanScreen = s; } });
}

function renderWhReturnsScreen() {
    renderLiveRegisterScreen({ key: 'wh-returns', title: 'مرتجعات المطبخ', mount: mountWhReturnsScreen, assign: (s) => { whReturnsScreen = s; } });
}

function renderWhPrsScreen() {
    renderLiveRegisterScreen({ key: 'wh-prs', title: 'طلبات شراء النواقص', mount: mountWhPrsScreen, assign: (s) => { whPrsScreen = s; } });
}

function renderRecipesScreen() {
    renderLiveRegisterScreen({ key: 'recipes', title: 'الوصفات', mount: mountRecipesScreen, assign: (s) => { recipesScreen = s; } });
}

function renderDepartmentsScreen() {
    renderLiveRegisterScreen({ key: 'departments', title: 'الأقسام', mount: mountDepartmentsScreen, assign: (s) => { departmentsScreen = s; } });
}

function renderHrDepartmentsScreen() {
    renderLiveRegisterScreen({ key: 'hr-departments', title: 'أقسام HR', mount: mountHrDepartmentsScreen, assign: (s) => { hrDepartmentsScreen = s; } });
}

function renderPayrollScreen() {
    renderLiveRegisterScreen({ key: 'payroll', title: 'مسيرات الرواتب', mount: mountPayrollScreen, assign: (s) => { payrollScreen = s; } });
}

function renderRosterScreen() { renderLiveRegisterScreen({ key: 'roster', title: 'الدوام', mount: mountRosterScreen, assign: (s) => { rosterScreen = s; } }); }

function renderEmployeePortalScreen() { renderLiveRegisterScreen({ key: 'employee-portal', title: 'البصمات (ذاتي)', mount: mountEmployeePortalScreen, assign: (s) => { employeePortalScreen = s; } }); }

function renderSettingsScreen() { renderLiveRegisterScreen({ key: 'settings', title: 'الإعدادات', mount: mountSettingsScreen, assign: (s) => { settingsScreen = s; } }); }

function renderUsersScreen() { renderLiveRegisterScreen({ key: 'users', title: 'المستخدمون', mount: mountUsersScreen, assign: (s) => { usersScreen = s; } }); }

function renderYarasoftScreen() { renderLiveRegisterScreen({ key: 'yarasoft', title: 'Yarasoft', mount: mountYarasoftScreen, assign: (s) => { yarasoftScreen = s; } }); }

function renderWhatsappScreen() { renderLiveRegisterScreen({ key: 'whatsapp', title: 'WhatsApp', mount: mountWhatsappScreen, assign: (s) => { whatsappScreen = s; } }); }

function renderPermissionsScreen() { renderLiveRegisterScreen({ key: 'permissions', title: 'الصلاحيات', mount: mountPermissionsScreen, assign: (s) => { permissionsScreen = s; } }); }

function renderCashierMonitorScreen() { renderLiveRegisterScreen({ key: 'cashier-monitor', title: 'متابعة الكاشير', mount: mountCashierMonitorScreen, assign: (s) => { cashierMonitorScreen = s; } }); }

function renderOracleDataScreen() { renderLiveRegisterScreen({ key: 'oracle-data', title: 'بيانات Oracle', mount: mountOracleDataScreen, assign: (s) => { oracleDataScreen = s; } }); }

function renderDailyLocksScreen() { renderLiveRegisterScreen({ key: 'yara-daily-locks', title: 'التقفيل اليومي', mount: mountDailyLocksScreen, assign: (s) => { dailyLocksScreen = s; } }); }

function renderPosEntryScreen() { renderLiveRegisterScreen({ key: 'pos', title: 'الكاشير', mount: mountPosEntryScreen, assign: (s) => { posEntryScreen = s; } }); }

function renderMenuBoardScreen() {
    if (!isLive()) {
        shell.main.innerHTML = `${liveModeStrip()}<section class="erp-card" style="margin-block-start:var(--erp-space-4)"><div class="erp-card__body"><div class="erp-state"><span class="erp-state__title">شاشات المنيو — تُعرض من الخادم</span><span>العرض الحي يتطلب <a href="v2.html?live=1">الوضع الحيّ</a> بجلسة مسجلة في هذا المتصفح.</span></div></div></section>`;
        return;
    }
    sessionPromise.then((session) => {
        if (navStatus.current !== 'menu-board') {return;}
        if (!session) {
            shell.main.innerHTML = liveModeStrip() + noSessionState('شاشات المنيو');
            return;
        }
        shell.main.innerHTML = `${liveModeStrip()}<div class="erp-stack" style="margin-block-start:var(--erp-space-4)"><div data-v2-register-host></div></div>`;
        menuBoardScreen = mountMenuBoardScreen(shell.main.querySelector('[data-v2-register-host]'), {
            notify: (_message) => {},
        });
    });
}

function renderDeptEmployeesScreen() { renderLiveRegisterScreen({ key: 'dept-employees', title: 'موظفو القسم', mount: mountDeptEmployeesScreen, assign: (s) => { deptEmpScreen = s; } }); }

function renderSalesAnalyzerScreen() { renderLiveRegisterScreen({ key: 'sales-analyzer', title: 'تحليل المبيعات', mount: mountSalesAnalyzerScreen, assign: (s) => { salesAnalyzerScreen = s; } }); }

function renderReceivedAnalyzerScreen() { renderLiveRegisterScreen({ key: 'received-analyzer', title: 'المستلم من المخزن', mount: mountReceivedAnalyzerScreen, assign: (s) => { receivedAnalyzerScreen = s; } }); }

function renderWhVsPosScreen() { renderLiveRegisterScreen({ key: 'wh-vs-pos', title: 'المخزن مع الكاشيرية', mount: mountWhVsPosScreen, assign: (s) => { whVsPosScreen = s; } }); }

function renderQueryScreen() { renderLiveRegisterScreen({ key: 'query', title: 'محرك الاستعلامات', mount: mountQueryScreen, assign: (s) => { queryScreen = s; } }); }

function renderProfessionalScreen() { renderLiveRegisterScreen({ key: 'professional', title: 'البطاقة الفاخرة', mount: mountProfessionalScreen, assign: (s) => { professionalScreen = s; } }); }

function renderShelvesScreen() { renderLiveRegisterScreen({ key: 'shelves', title: 'الرفوف', mount: mountShelvesScreen, assign: (s) => { shelvesScreen = s; } }); }

function renderWeightScreen() { renderLiveRegisterScreen({ key: 'weight', title: 'الميزان', mount: mountWeightScreen, assign: (s) => { weightScreen = s; } }); }

function noSessionState(entity = 'الفروع') {
    return `
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-state">
            <span class="erp-state__title">لا جلسة — لا بيانات عرض</span>
            <span>هذه الشاشة لا تعرض صفوفًا نموذجية تحت اسم «${entity}» في الوضع الحيّ.</span>
          </div>
        </div>
      </section>`;
}

/** The same table component, fed with fixtures, used to judge the design. */
function branchShowcaseSection() {
    return `
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__head">
          <h3 class="erp-card__title">EnterpriseDataTable — نموذج الفروع</h3>
          <span class="erp-text-muted" style="text-align:end">بيانات نموذجية · نفس المكوّن الذي تقرأ به الشاشة الحية</span>
        </div>
        <div class="erp-card__body"><div data-v2-sample-host></div></div>
      </section>`;
}

function renderScreen(key) {
    teardownBranchesScreen();
    teardownAttendanceScreen();
    teardownEmployeesScreen();
    teardownBriefingScreen();
    teardownCfoScreen();
    teardownWarehouseScreen();
    teardownWarehouseGovScreen();
    teardownReportsScreen();
    teardownProcurementScreen();
    teardownInvoicesScreen();
    teardownPaymentsScreen();
    teardownWhInvoicesScreen();
    teardownKitchenScreen();
    teardownLeavesScreen();
    teardownDispatchScreen();
    teardownVegScreen();
    teardownWhMovesScreen();
    teardownGoodsScanScreen();
    teardownWhReturnsScreen();
    teardownWhPrsScreen();
    teardownRecipesScreen();
    teardownRosterScreen();
    teardownEmployeePortalScreen();
    teardownSettingsScreen();
    teardownUsersScreen();
    teardownYarasoftScreen();
    teardownWhatsappScreen();
    teardownPermissionsScreen();
    teardownCashierMonitorScreen();
    teardownOracleDataScreen();
    teardownDailyLocksScreen();
    teardownMenuBoardScreen();
    teardownPosEntryScreen();
    teardownDepartmentsScreen();
    teardownHrDepartmentsScreen();
    teardownPayrollScreen();
    teardownRevenuesScreen();
    teardownExpensesScreen();
    teardownCostAnalysisScreen();
    teardownPnlScreen();
    teardownHrDashboardScreen();
    teardownZktecoScreen();
    teardownDeptEmployeesScreen();
    teardownSalesAnalyzerScreen();
    teardownReceivedAnalyzerScreen();
    teardownWhVsPosScreen();
    teardownQueryScreen();
    teardownProfessionalScreen();
    teardownShelvesScreen();
    teardownWeightScreen();
    teardownAccountantScreen();
    teardownWarehouseDashScreen();
    teardownDeptHeadDashScreen();

    if (key === 'branches') {
        renderBranchesScreen();
        return;
    }

    if (key === 'login') {
        renderLoginScreen();
        return;
    }

    if (key === 'cfo') {
        renderCfoScreen();
        return;
    }

    if (key === 'attendance') {
        renderAttendanceScreen();
        return;
    }

    if (key === 'employees') {
        renderEmployeesScreen();
        return;
    }

    if (key === 'warehouse') {
        renderWarehouseScreen();
        return;
    }

    if (key === 'warehouse-gov') {
        renderWarehouseGovScreen();
        return;
    }

    if (key === 'reports') {
        renderReportsScreen();
        return;
    }

    if (key === 'procurement') {
        renderProcurementScreen();
        return;
    }

    if (key === 'procurement-invoices') {
        renderInvoicesScreen();
        return;
    }

    if (key === 'procurement-payments') {
        renderPaymentsScreen();
        return;
    }

    if (key === 'wh-invoices') {
        renderWhInvoicesScreen();
        return;
    }

    if (key === 'kitchen') {
        renderKitchenScreen();
        return;
    }

    if (key === 'leaves') {
        renderLeavesScreen();
        return;
    }

    if (key === 'dispatch') {
        renderDispatchScreen();
        return;
    }

    if (key === 'veg-requests') {
        renderVegScreen();
        return;
    }

    if (key === 'wh-moves') {
        renderWhMovesScreen();
        return;
    }

    /* البند ٩: #goods-scan — لا يفتح إلا إذا قرأت الشاشة نفسها ?v2scan=1،
       وبدونه تعرض بطاقة الإطفاء ولا تلمس الشبكة (screens/goods-scan.js). */
    if (key === 'goods-scan') {
        renderGoodsScanScreen();
        return;
    }

    if (key === 'wh-returns') {
        renderWhReturnsScreen();
        return;
    }

    if (key === 'wh-prs') {
        renderWhPrsScreen();
        return;
    }

    if (key === 'recipes') {
        renderRecipesScreen();
        return;
    }

    if (key === 'roster') {
        renderRosterScreen();
        return;
    }

    if (key === 'employee-portal') {
        renderEmployeePortalScreen();
        return;
    }

    if (key === 'settings') {
        renderSettingsScreen();
        return;
    }

    if (key === 'users') {
        renderUsersScreen();
        return;
    }

    if (key === 'yarasoft') {
        renderYarasoftScreen();
        return;
    }

    if (key === 'whatsapp') {
        renderWhatsappScreen();
        return;
    }

    if (key === 'permissions') {
        renderPermissionsScreen();
        return;
    }

    if (key === 'cashier-monitor') {
        renderCashierMonitorScreen();
        return;
    }

    if (key === 'oracle-data') {
        renderOracleDataScreen();
        return;
    }

    if (key === 'yara-daily-locks') {
        renderDailyLocksScreen();
        return;
    }

    if (key === 'menu-board') {
        renderMenuBoardScreen();
        return;
    }

    if (key === 'pos') {
        renderPosEntryScreen();
        return;
    }

    if (key === 'departments') {
        renderDepartmentsScreen();
        return;
    }

    if (key === 'hr-departments') {
        renderHrDepartmentsScreen();
        return;
    }

    if (key === 'payroll') {
        renderPayrollScreen();
        return;
    }

    if (key === 'revenues') {
        renderRevenuesScreen();
        return;
    }

    if (key === 'expenses') {
        renderExpensesScreen();
        return;
    }

    if (key === 'cost-analysis') {
        renderCostAnalysisScreen();
        return;
    }

    if (key === 'pnl') {
        renderPnlScreen();
        return;
    }

    if (key === 'hr-dashboard') {
        renderHrDashboardScreen();
        return;
    }

    if (key === 'zkteco') {
        renderZktecoScreen();
        return;
    }

    if (key === 'dept-employees') {
        renderDeptEmployeesScreen();
        return;
    }

    if (key === 'sales-analyzer') {
        renderSalesAnalyzerScreen();
        return;
    }

    if (key === 'received-analyzer') {
        renderReceivedAnalyzerScreen();
        return;
    }

    if (key === 'wh-vs-pos') {
        renderWhVsPosScreen();
        return;
    }

    if (key === 'query') {
        renderQueryScreen();
        return;
    }

    if (key === 'professional') {
        renderProfessionalScreen();
        return;
    }

    if (key === 'shelves') {
        renderShelvesScreen();
        return;
    }

    if (key === 'weight') {
        renderWeightScreen();
        return;
    }

    const isDashboard = !key || key === 'dashboard';

    // Gate D: a signed-in dashboard reads the live executive view (the same
    // tested component the `cfo` route mounts) instead of fixtures. Logged-out
    // visitors keep the labelled preview below, unchanged.
    if (isDashboard && isLive()) {
        shell.main.innerHTML = `
          ${liveModeStrip()}
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__body">
              <div class="erp-state" role="status" aria-live="polite">
                <span class="erp-state__title">جارٍ قراءة أرقام اليوم…</span>
                <span>اللوحة الحية لا تعرض نموذجًا — لا بديل عن السجل الحقيقي.</span>
              </div>
            </div>
          </section>`;
        sessionPromise.then((session) => {
            if (navStatus.current !== 'dashboard') {return;}
            if (!session) {
                shell.main.innerHTML = liveModeStrip() + noSessionState('اللوحة');
                return;
            }
            shell.main.innerHTML = `
              ${liveModeStrip()}
              <div class="erp-stack" style="margin-block-start:var(--erp-space-4)">
                <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>
                <div data-v2-dashboard-host></div>
              </div>`;
            const note = shell.main.querySelector('[data-v2-note]');
            const host = shell.main.querySelector('[data-v2-dashboard-host]');
            const u = session.user || {};
            const ctx = {
                role: session.role,
                userId: u.id != null ? u.id : null,
                userName: String(u.name || u.username || ''),
                deptCode: String(u.dept_code || ''),
                notify: notifyTo(note),
                navigate: (key) => shell.navigate(key),
            };
            // P2-7: each role reads the dashboard it owns (legacy mapping,
            // features/dashboard.js:127-133). admin/manager — and any role
            // without a migrated dashboard — keep the executive briefing.
            switch (dashboardKind(session.role)) {
                case 'hr':
                    hrDashboardScreen = mountHrDashboardScreen(host, ctx);
                    break;
                case 'employee':
                    employeePortalScreen = mountEmployeePortalScreen(host, ctx);
                    break;
                case 'accountant':
                    accountantScreen = mountAccountantDashboardScreen(host, ctx);
                    break;
                case 'warehouse':
                    warehouseDashScreen = mountWarehouseDashboardScreen(host, ctx);
                    break;
                case 'dept-head':
                    deptHeadDashScreen = mountDeptHeadDashboardScreen(host, ctx);
                    break;
                default:
                    briefingScreen = mountBriefingScreen(host, ctx);
            }
        });
        return;
    }

    if (isDashboard) {
        const showcase = SHOWCASE_MODE ? `
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__head">
              <h3 class="erp-card__title">معرض مكونات V2</h3>
              <span class="erp-text-muted">أمثلة توضيحية فقط</span>
            </div>
            <div class="erp-card__body">
              <div class="erp-row-wrap" data-erp-status-demo>
                ${STATUS_SAMPLES.map(([domain, value]) => statusBadge(domain, value)).join('')}
              </div>
            </div>
          </section>
          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__head">
              <h3 class="erp-card__title">استعراض الجدول</h3>
              <span class="erp-text-muted">بيانات تجريبية · فرز وبحث وتصفية</span>
            </div>
            <div class="erp-card__body"><div data-erp-table-host></div></div>
          </section>` : '';
        shell.main.innerHTML = `
          <div data-erp-dash></div>
          ${showcase}`;
        const host = shell.main.querySelector('[data-erp-table-host]');
        renderDashboard(shell.main.querySelector('[data-erp-dash]'), { statusBadge });
        if (SHOWCASE_MODE) {
            if (!table) {buildTable();}
            host.appendChild(table.el);
            reloadTable();
            hydrateStatusNodes(shell.main);
        }
        return;
    }

    shell.main.innerHTML = `
      <section class="erp-card">
        <div class="erp-card__body">
          <div class="erp-state">
            <span class="erp-state__icon" aria-hidden="true">🚧</span>
            <span class="erp-state__title">${pageTitle(key)}</span>
            <span>هذه معاينة هيكل الشاشة فقط — لم يتم نقل أي شاشة تشغيلية بعد.</span>
            <button type="button" class="erp-btn erp-btn--sm" data-go-dash>العودة للوحة المعاينة</button>
          </div>
        </div>
      </section>`;
    shell.main.querySelector('[data-go-dash]')?.addEventListener('click', () => shell.navigate('dashboard'));
}

window.addEventListener('v2:realtime-resync', () => {
    if (!isLive()) {return;}
    try {toast('فجوة كبيرة في سجل المزامنة — جارٍ تحديث الشاشة الحالية');}
    catch (error) {console.warn('[V2] resync notification failed:', error);}
    renderScreen(navStatus.current);
});

if (LIVE) {void hydrateV2PrintLogo();}
if (ROUTING || GOODS_SCAN_DEEP_LINK) {applyRouteFromHash();} else {renderScreen('dashboard');}
hydrateStatusNodes(document);

console.info('[V2 preview] ready — reversible route, sample data, no live integration.');