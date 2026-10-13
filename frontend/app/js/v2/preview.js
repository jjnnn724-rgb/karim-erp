/**
 * V2 — Preview host (reversible route)
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
 *
 * WHAT IS SAMPLE (stated on the page itself)
 *   The session and the table rows are fixtures for design review. No API is
 *   called, no record is read, and nothing here implies a live integration.
 */

import { ROLES } from '../core/config.js';
import { MENU_STRINGS, t } from '../core/i18n.js';
import { initTheme, currentTheme } from './theme.js';
import { statusBadge, hydrateStatusNodes } from './status.js';
import { mountAppLayout } from './layout/app-layout.js';
import { createDataTable } from './data-display/data-table.js';

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

/* ── 2. Sample session (explicitly labelled on the page) ────────────── */
window.STATE = {
    currentUser: { role: 'admin', name: 'مدير النظام' },
    permissions: { menus: [], deniedMenus: [] },
    settings: { hidden_nav_pages: '' },
    theme: currentTheme(),
};

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

const shell = mountAppLayout(root, {
    appName: 'مطاعم الشرفه العالمي',
    appSubtitle: 'نظام إدارة المطاعم المتكامل · معاينة V2',
    page: navStatus.current,
    breadcrumbs: { trail: [{ label: 'الرئيسية', key: 'dashboard' }, { label: 'لوحة التحكم' }] },
    toolbar: [
        { label: 'تحديث', icon: 'refresh', onClick: () => reloadTable() },
        { label: 'تصدير', icon: 'download', onClick: () => console.info('[V2 preview] export is a boundary, not implemented') },
    ],
    onNavigate(key) {
        navStatus.current = key;
        shell.setPage(key);
        shell.setBreadcrumbs({ trail: [
            { label: 'الرئيسية', key: 'dashboard' },
            { label: menuLabel(key) },
        ] });
        renderScreen(key);
    },
});

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
function renderScreen(key) {
    const isDashboard = !key || key === 'dashboard';

    if (isDashboard) {
        shell.main.innerHTML = `
          <section class="erp-card">
            <div class="erp-card__head">
              <h3 class="erp-card__title">طبقة الحالة — Status Adapter</h3>
              <span class="erp-text-muted erp-grow" style="text-align:end">
                كل قيمة هنا محفوظة فعليًا في قاعدة البيانات أو معروضة في الكود القديم
              </span>
            </div>
            <div class="erp-card__body">
              <div class="erp-row-wrap" data-erp-status-demo>
                ${STATUS_SAMPLES.map(([domain, value]) => statusBadge(domain, value)).join('')}
              </div>
              <p class="erp-text-muted" style="margin-block-start:var(--erp-space-4)">
                الشارة المنقطة الحدية هي قيمة <strong>غير معروفة</strong> — تظهر كما هي بدل أن
                تُصنَّف بخطأ تحت اسم حالة أخرى.
              </p>
            </div>
          </section>

          <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
            <div class="erp-card__head">
              <h3 class="erp-card__title">EnterpriseDataTable — مرحلة ٣</h3>
              <span class="erp-text-muted" style="text-align:end">بيانات نموذجية · فرز وبحث وتصفية وترقيم من اختيارك</span>
            </div>
            <div class="erp-card__body">
              <div data-erp-table-host></div>
            </div>
          </section>`;
        const host = shell.main.querySelector('[data-erp-table-host]');
        if (!table) {buildTable();}
        host.appendChild(table.el);
        reloadTable();
        hydrateStatusNodes(shell.main);
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

renderScreen('dashboard');
hydrateStatusNodes(document);

console.info('[V2 preview] ready — reversible route, sample data, no live integration.');
