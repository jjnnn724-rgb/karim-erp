/**
 * V2 — Status adapter: persisted value → presentation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 *   Status handling in the legacy UI is ~35 inline ternaries scattered across
 *   18 files (e.g. `status==='approved'?'bdg-green':status==='rejected'?
 *   'bdg-red':'bdg-orange'`), each free to drift from the others. This module
 *   is the single place that decides what a stored value looks like.
 *
 * HARD RULES
 *   1. KEYS ARE THE REAL PERSISTED STRINGS. Every entry below was verified
 *      either by `SELECT DISTINCT status FROM <table>` against the live
 *      database or by the legacy code that renders it — sources are noted
 *      per group. Nothing is renamed, re-cased or re-spelled: the database
 *      still holds exactly what it held before.
 *   2. CASE IS SIGNIFICANT. `pos_orders.status` really stores 'issued' while
 *      `invoice_import_log.status` really stores 'COMPLETED'. Both are kept
 *      verbatim.
 *   3. AN UNRECOGNISED VALUE IS NEVER INVENTED OR HIDDEN. It renders as the
 *      raw string in a neutral, dashed badge flagged `known:false`, so a new
 *      database value is visible to a human immediately instead of silently
 *      wearing someone else's label.
 *   4. COLOUR IS NEVER THE ONLY CUE. A badge always carries a text label and
 *      a glyph; `tone` is presentation only.
 *
 * NEVER mirror a status value from the client. This module only *reads*
 * status; deciding one is the backend's job.
 */

/**
 * @typedef {Object} StatusPresentation
 * @property {string} label  Arabic label for display
 * @property {'success'|'warning'|'danger'|'info'|'neutral'|'brand'} tone
 * @property {string} icon   legacy icon name (i.ji[data-i] → icons.js)
 * @property {boolean} known whether the value was recognised
 * @property {string} raw    the untouched stored value
 */

/** @type {Record<string, {label:string, tone:string, icon:string}>} */
const STATUS_MAP = {
    /* ── employees.status ────────────────────────────────────────────────
       DB: SELECT DISTINCT status FROM employees → 'active'
       Rendered by features/employees.js:85 (active | else → inactive) */
    'employees:active':              { label: 'نشط',           tone: 'success', icon: 'circle-check' },
    'employees:inactive':            { label: 'غير نشط',      tone: 'neutral', icon: 'circle-x' },
    'employees:suspended':           { label: 'موقوف',         tone: 'warning', icon: 'pause' },

    /* ── attendance_devices.status ──────────────────────────────────────
       DB: SELECT DISTINCT status FROM attendance_devices → 'online' */
    'device:online':                 { label: 'متصل',          tone: 'success', icon: 'wifi' },
    'device:offline':                { label: 'غير متصل',     tone: 'danger',  icon: 'wifi' },
    'device:error':                  { label: 'خطأ',           tone: 'danger',  icon: 'alert-triangle' },

    /* ── dispatches.status ──────────────────────────────────────────────
       DB: → 'pending|chef_approved|approved|partially_received|received|rejected'
       Labels verbatim from features/kitchen.js:141 (statusLabel) for the
       five legacy keys, and from the print sheet pStatusAr (kitchen.js
       print flow) for 'chef_approved' — the stage between pending and
       approved that the register itself never labelled. Icons must exist
       in js/icons.js: unknown names silently fall back to circle-help. */
    'dispatch:pending':              { label: 'بانتظار اعتماد المخزن', tone: 'warning', icon: 'hourglass' },
    'dispatch:chef_approved':        { label: 'معتمد من الشيف — بانتظار المخازن', tone: 'info', icon: 'chef-hat' },
    'dispatch:approved':             { label: 'معتمد — بانتظار استلام المطبخ', tone: 'success', icon: 'inbox' },
    'dispatch:partially_received':   { label: 'مستلم جزئيًا',  tone: 'warning', icon: 'archive' },
    'dispatch:received':             { label: 'مستلم ومغلق',   tone: 'success', icon: 'package' },
    'dispatch:rejected':             { label: 'مرفوض من الإدارة', tone: 'danger', icon: 'circle-x' },

    /* ── purchase_requests.status ───────────────────────────────────────
       DB: → 'chef_approved|pending'; 'approved|fulfilled|cancelled'
       from features/kitchen.js (prStatusLabel). */
    'purchase_request:pending':      { label: 'بانتظار الشيف',  tone: 'warning', icon: 'hourglass' },
    'purchase_request:chef_approved':{ label: 'موقّع من الشيف',  tone: 'info',    icon: 'pencil' },
    'purchase_request:approved':     { label: 'معتمد نهائيًا',   tone: 'success', icon: 'circle-check' },
    'purchase_request:fulfilled':    { label: 'مستلم ومغلق',     tone: 'success', icon: 'check' },
'purchase_request:partially_fulfilled': { label: 'مستلم جزئياً', tone: 'info', icon: 'package' },
    'purchase_request:rejected':     { label: 'مرفوض',            tone: 'danger',  icon: 'circle-x' },
    'purchase_request:cancelled':    { label: 'ملغى',            tone: 'danger',  icon: 'circle-x' },

    /* ── journal_entries.status ─────────────────────────────────────────
       DB: → 'posted|void'; 'draft' from features/cfo.js:60 */
    'journal_entry:draft':           { label: 'مسودة',         tone: 'neutral', icon: 'file-text' },
    'journal_entry:posted':          { label: 'مرحّلة',         tone: 'success', icon: 'check' },
    'journal_entry:void':            { label: 'ملغاة',          tone: 'danger',  icon: 'circle-x' },

    /* ── leaveRequests.status ───────────────────────────────────────────
       DB: → 'rejected'; 'approved|pending' from features/employees.js:421.
       'returned' is written by the workflow itself
       (leave-workflow-routes.js:219) — its word is the legacy page's own
       fallback label (features/hr.js:573 prints it when no workflow row). */
    'leave:pending':                 { label: 'معلق',           tone: 'warning', icon: 'hourglass' },
    'leave:approved':                { label: 'معتمد',          tone: 'success', icon: 'circle-check' },
    'leave:rejected':                { label: 'مرفوض',          tone: 'danger',  icon: 'circle-x' },
    'leave:returned':                { label: 'عاد للموظف للتعديل', tone: 'info', icon: 'corner-up-left' },

    /* ── leave_approval_workflows.status ────────────────────────────────
       DB: → 'completed'; 'in_progress|returned|rejected' written by the
       chain (leave-workflow-routes.js:211-221). Labels and colour order are
       features/hr.js:573-574 verbatim (bdg-orange/purple/green/red). */
    'leave_workflow:in_progress':    { label: 'قيد الاعتماد',   tone: 'warning', icon: 'hourglass' },
    'leave_workflow:returned':       { label: 'عاد للموظف للتعديل', tone: 'info', icon: 'corner-up-left' },
    'leave_workflow:completed':      { label: 'معتمد نهائيًا',  tone: 'success', icon: 'circle-check' },
    'leave_workflow:rejected':       { label: 'مرفوض',          tone: 'danger',  icon: 'circle-x' },

    /* ── pos_shift_sessions.status ──────────────────────────────────────
       DB: → 'closed|open' */
    'shift_session:open':            { label: 'وردية مفتوحة',   tone: 'info',    icon: 'unlock' },
    'shift_session:closed':          { label: 'وردية مغلقة',    tone: 'neutral', icon: 'lock' },

    /* ── fiscal_years.status ────────────────────────────────────────────
       DB: → 'open'; 'closed' from features/warehouse.js:997 */
    'fiscal_year:open':              { label: 'مفتوحة',         tone: 'info',    icon: 'unlock' },
    'fiscal_year:closed':            { label: 'مغلقة',          tone: 'neutral', icon: 'lock' },

    /* ── pos_orders.status ──────────────────────────────────────────────
       DB enum pos_invoice_status — database/migrations/003_cashier_module.sql:71
       ('draft','issued','reported','failed','cancelled')
       Labels for issued/cancelled rendered by features/pos-orders.js:302 and pos.js:851 */
    'pos_order:draft':               { label: 'مسودة',         tone: 'neutral', icon: 'file-text' },
    'pos_order:issued':              { label: 'صادرة',          tone: 'success', icon: 'circle-check' },
    'pos_order:reported':            { label: 'مُبلَّغة',       tone: 'info',    icon: 'shield-check' },
    'pos_order:failed':              { label: 'إبلاغها فشل',    tone: 'warning', icon: 'alert-triangle' },
    'pos_order:cancelled':           { label: 'ملغاة',          tone: 'danger',  icon: 'circle-x' },

    /* ── kitchen_audits.status ──────────────────────────────────────────
       Labels from features/kitchen.js:97 */
    'kitchen_audit:draft':           { label: 'مسودة',          tone: 'neutral', icon: 'file-text' },
    'kitchen_audit:submitted':       { label: 'بانتظار الاعتماد', tone: 'warning', icon: 'hourglass' },
    'kitchen_audit:approved':        { label: 'معتمد',          tone: 'success', icon: 'circle-check' },

    /* ── kitchen_production_batches.status ──────────────────────────────
       Labels from features/kitchen.js:168 */
    'production_batch:open':         { label: 'مفتوح',          tone: 'info',    icon: 'cooking-pot' },
    'production_batch:closed':       { label: 'مغلق — موزع',    tone: 'neutral', icon: 'check' },
    'production_batch:cancelled':    { label: 'ملغى',           tone: 'danger',  icon: 'circle-x' },

    /* ── invoice_import_log.status ──────────────────────────────────────
       DB: → 'COMPLETED|DUPLICATE|PROCESSING'  (UPPERCASE — kept verbatim) */
    'import_log:PROCESSING':         { label: 'قيد المعالجة',   tone: 'info',    icon: 'refresh' },
    'import_log:COMPLETED':          { label: 'مكتمل',          tone: 'success', icon: 'circle-check' },
    'import_log:DUPLICATE':          { label: 'مكرر',           tone: 'warning', icon: 'copy' },

    /* ── wa_inbox.status / wa_outbox.status ─────────────────────────────
       DB: wa_inbox → 'failed|processed|replied'; wa_outbox → 'sent' */
    'wa_inbox:processed':            { label: 'معالج',          tone: 'success', icon: 'circle-check' },
    'wa_inbox:replied':              { label: 'تم الرد',        tone: 'success', icon: 'corner-up-left' },
    'wa_inbox:failed':               { label: 'فشل',            tone: 'danger',  icon: 'alert-triangle' },
    'wa_outbox:sent':                { label: 'مُرسل',          tone: 'success', icon: 'send' },

    /* ── purchase invoice paymentStatus ─────────────────────────────────
       Labels from features/warehouse.js:2315 */
    'payment:paid':                  { label: 'مدفوعة',         tone: 'success', icon: 'circle-check' },
    'payment:partial':               { label: 'مسددة جزئيًا',   tone: 'warning', icon: 'coins' },
    'payment:unpaid':                { label: 'غير مسددة',      tone: 'warning', icon: 'clock' },

    /* ── smart-card audit checks (uppercase) ────────────────────────────
       Labels from features/smart-card.js:531-535 */
    'check:PASS':                    { label: 'سليم',           tone: 'success', icon: 'circle-check' },
    'check:WARN':                    { label: 'تنبيه',          tone: 'warning', icon: 'alert-triangle' },
    'check:FAIL':                    { label: 'فشل',            tone: 'danger',  icon: 'circle-x' },

    /* ── misc single-value statuses verified against the DB ───────────── */
    'inventory_audit:cancelled':     { label: 'ملغى',           tone: 'danger',  icon: 'circle-x' },
    /* ── veg_requests.status (CHECK veg-requests-routes.js:57) ──────────
       W1-4: the other three words from the legacy badge
       features/veg-requests.js:28-32. */
    'veg_request:pending':           { label: 'بانتظار المعالجة', tone: 'warning', icon: 'hourglass' },
    'veg_request:received':          { label: 'تم الاستلام',    tone: 'success', icon: 'check' },
    'veg_request:priced':            { label: 'تم التسعير',     tone: 'info',    icon: 'coins' },
    'veg_request:cancelled':         { label: 'ملغي',           tone: 'neutral', icon: 'circle-x' },
    'day_close:approved':            { label: 'معتمد',          tone: 'success', icon: 'circle-check' },

    /* ── branches (migration 102) ───────────────────────────────────────
       There is no `status` column: `is_active` is a BOOLEAN. The repository
       maps it to these two values (v2/data/branches-repo.js#branchToRow),
       which are the same two states features/branches.js renders. A stopped
       branch is neutral, not dangerous — its historical rows stay intact. */
    'branches:active':               { label: 'مفعّل',          tone: 'success', icon: 'circle-check' },
    'branches:inactive':             { label: 'موقوف',          tone: 'neutral', icon: 'circle-x' },
};

/**
 * Resolve a stored status value to its presentation.
 * Unknown values are surfaced verbatim rather than guessed at.
 *
 * @param {string} domain  logical entity name, e.g. 'dispatch'
 * @param {string|null|undefined} value  the persisted value, unmodified
 * @returns {StatusPresentation}
 */
export function resolveStatus(domain, value) {
    const raw = (value === null || value === undefined) ? '' : String(value);

    if (raw === '') {
        return { label: 'غير محدد', tone: 'neutral', icon: 'circle-help', known: true, raw: '' };
    }

    const hit = STATUS_MAP[`${domain}:${raw}`];
    if (hit) {
        return { ...hit, known: true, raw };
    }

    /* Unknown: render the raw stored string. `known:false` is what makes the
       dashed styling appear — a human spots a brand-new enum value at a
       glance instead of seeing it mislabelled. */
    return { label: raw, tone: 'neutral', icon: 'circle-help', known: false, raw };
}

/** Escape text for safe interpolation into HTML. */
function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Render a status badge as HTML.
 * Always emits a label (text cue) and a glyph (shape cue) so colour is never
 * the sole carrier of meaning.
 *
 * @param {string} domain
 * @param {string|null|undefined} value
 * @param {{title?:string}} [opts] optional tooltip, e.g. extra context
 * @returns {string} HTML
 */
export function statusBadge(domain, value, opts = {}) {
    const s = resolveStatus(domain, value);
    const label = esc(s.label);
    const title = opts.title ? ` title="${esc(opts.title)}"` : '';
    const aria = s.label ? ` aria-label="${esc(s.label)}"` : '';
    return `<span class="erp-badge" data-tone="${esc(s.tone)}" data-unknown="${s.known ? 'false' : 'true'}"`
        + ` data-raw="${esc(s.raw)}"${title}${aria}>`
        + `<i class="ji" data-i="${esc(s.icon)}" aria-hidden="true"></i>`
        + `<span class="erp-badge-label">${label}</span></span>`;
}

/**
 * Hydrate declarative status placeholders.
 *
 * Usage in markup:  <span data-erp-status="dispatch:pending"></span>
 * (Kept as a placeholder element rather than a custom element so V2 needs no
 *  registry and nothing breaks if this script loads after the markup.)
 *
 * @param {ParentNode} [root]
 * @returns {number} how many nodes were filled
 */
export function hydrateStatusNodes(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') {return 0;}
    const nodes = root.querySelectorAll('[data-erp-status]:not([data-erp-done])');
    let filled = 0;
    nodes.forEach((node) => {
        const spec = String(node.getAttribute('data-erp-status') || '');
        const sep = spec.indexOf(':');
        if (sep < 1) {return;} // malformed → leave untouched, visible for debugging
        const domain = spec.slice(0, sep);
        const value = spec.slice(sep + 1);
        node.innerHTML = statusBadge(domain, value, { title: node.getAttribute('data-erp-title') || '' });
        node.setAttribute('data-erp-done', '1');
        filled += 1;
    });
    return filled;
}

/** Introspection for tests / diagnostics: every recognised domain:value. */
export function listKnownStatuses() {
    return Object.keys(STATUS_MAP).sort();
}
