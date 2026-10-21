/**
 * V2 — EnterpriseDataTable (MVP)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE: PRESENTATION ONLY.
 *   This component renders rows someone else produced. It never derives a
 *   business total, never recalculates tax or rounding, never mutates a
 *   record, never triggers an action on its own, and never decides
 *   permission. Authoritative numbers stay with the backend/domain services.
 *
 * DELIBERATELY NOT BUILT (see the project directive §08)
 *   Virtualisation, column resizing, column reordering, grouping, inline
 *   editing, tree data — none is justified by a measured need yet, and each
 *   is expensive to retrofit. This is a table, not a grid engine.
 *
 * PAGINATION CONTRACT — the one thing easy to get wrong
 *   mode:'client'  → the host hands over ALL rows; this component slices them
 *                    and owns page/pageSize internally.
 *   mode:'server'  → the host hands over ONLY the current page; this
 *                    component never slices, and `totalRecords` is the count
 *                    the server reported (which may differ from rows.length
 *                    when filters are applied).
 *   The two are mutually exclusive: passing totalRecords in client mode is a
 *   configuration error and is ignored with a console warning, because
 *   "paging a paged list" is exactly how double-pagination bugs happen.
 *
 * TYPING
 *   No TypeScript exists in this frontend (verified: the only .ts in the repo
 *   is capacitor.config.ts) and there is no bundler to add it without a build
 *   pipeline. Types are therefore expressed as JSDoc typedefs + runtime
 *   shape-checks at the boundary, rather than by silently rewriting the
 *   project or disabling checks.
 */

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * @typedef {Object} Column
 * @property {string} key            Unique identifier (also the default sort field).
 * @property {string} header         Header text (already translated).
 * @property {(row:any)=>any} [value]     Extracts the comparable value. Defaults to row[key].
 * @property {(row:any, index:number)=>string} [render] Custom cell HTML. Falls back to String(value).
 * @property {boolean} [sortable]    Default false.
 * @property {boolean} [filterable]  Default false — shows a per-column filter.
 * @property {boolean} [hidden]      Default false — initial visibility.
 * @property {'start'|'center'|'end'} [align]  Logical alignment (RTL-aware).
 * @property {'text'|'number'} [type] Sorts numerically when 'number'.
 * @property {string} [className]
 * @property {number} [width]        CSS width (e.g. '160px').
 */

/**
 * @typedef {Object} DataTableOptions
 * @property {Column[]} columns
 * @property {any[]}    [rows]
 * @property {'client'|'server'} [mode]         Default 'client'.
 * @property {number}   [totalRecords]          Server mode only.
 * @property {number}   [pageSize]              Default 25.
 * @property {boolean}  [selectable]            Adds a checkbox column.
 * @property {(row:any, index:number)=>string} [rowKey]  Defaults to row.id ?? index.
 * @property {(row:any)=>void} [onRowActivate]  Enter / double-click.
 * @property {(rows:any[])=>void} [onSelectionChange]
 * @property {(state:{sort?:{key:string,dir:'asc'|'desc'}, query?:string,
 *             columnFilters?:Record<string,string>,
 *             page?:number, pageSize?:number})=>void} [onStateChange]
 *             Server mode: fired whenever the host must refetch.
 * @property {string} [emptyMessage]
 * @property {string} [emptyHint]
 * @property {boolean} [stickyHeader]  Default true.
 * @property {boolean} [search]        Default true — the table's own "بحث…"
 *             box. A host that owns a smarter search (employees.js filters
 *             the roster before rows are handed over, in both table and cards
 *             views) passes false so the screen never shows two boxes with
 *             two different rules.
 */

/** @returns {HTMLDivElement} */
export function createDataTable(options = {}) {
    const opts = {
        mode: 'client',
        pageSize: 25,
        selectable: false,
        stickyHeader: true,
        search: true,
        ...options,
    };

    const columns = Array.isArray(opts.columns) ? opts.columns : [];
    if (!columns.length) {
        console.warn('[DataTable] no columns provided — the table will render an empty state.');
    }
    if (columns.some((c) => !c || typeof c.key !== 'string')) {
        throw new Error('[DataTable] every column needs a string `key`.');
    }

    /* ── State ───────────────────────────────────────────────────────── */
    const state = {
        rows: Array.isArray(opts.rows) ? opts.rows.slice() : [],
        query: '',
        columnFilters: Object.create(null),
        sort: null,                       // { key, dir:'asc'|'desc' } | null
        page: 1,
        pageSize: Math.max(1, opts.pageSize | 0),
        visible: new Set(columns.filter((c) => !c.hidden).map((c) => c.key)),
        selected: new Set(),
        loading: false,
        error: null,
        totalRecords: typeof opts.totalRecords === 'number' ? opts.totalRecords : null,
    };

    if (opts.mode === 'client' && typeof opts.totalRecords === 'number') {
        // Guard against silently paging an already-paged list.
        console.warn('[DataTable] totalRecords was passed in client mode and is ignored — '
            + 'client mode owns pagination over rows[]. Use mode:"server" if the list is server-paged.');
        state.totalRecords = null;
    }

    /* ── DOM ─────────────────────────────────────────────────────────── */
    const root = document.createElement('div');
    root.className = 'erp-table';
    root.innerHTML = `
      <div class="erp-table__bar erp-no-print">
        ${opts.search === false ? '' : `<label class="erp-table__search">
          <i class="ji" data-i="search" aria-hidden="true"></i>
          <span class="erp-sr-only">بحث داخل الجدول</span>
          <input type="search" class="erp-input erp-grow" data-erp-search
                 placeholder="بحث…" autocomplete="off">
        </label>`}
        <div class="erp-table__bar-actions">
          <button type="button" class="erp-btn erp-btn--sm" data-erp-cols-toggle
                  aria-expanded="false" aria-controls="erp-cols-menu">
            <i class="ji" data-i="columns" aria-hidden="true"></i><span>الأعمدة</span>
          </button>
          <div class="erp-cols-menu" id="erp-cols-menu" data-erp-cols-menu hidden></div>
          <span class="erp-table__count" data-erp-count aria-live="polite"></span>
        </div>
      </div>
      <div class="erp-table__scroll" tabindex="0" data-erp-scroll></div>
      <div class="erp-table__pager erp-no-print" data-erp-pager hidden></div>`;

    const el = {
        search:   root.querySelector('[data-erp-search]'),
        colsBtn:  root.querySelector('[data-erp-cols-toggle]'),
        colsMenu: root.querySelector('[data-erp-cols-menu]'),
        count:    root.querySelector('[data-erp-count]'),
        scroll:   root.querySelector('[data-erp-scroll]'),
        pager:    root.querySelector('[data-erp-pager]'),
    };

    /* ── Helpers ─────────────────────────────────────────────────────── */
    const columnByKey = (key) => columns.find((c) => c.key === key);

    const rawValue = (row, col) => {
        if (typeof col.value === 'function') {return col.value(row);}
        return row?.[col.key];
    };

    /** Display string for a cell — used by search, filter and default render. */
    const displayValue = (row, col) => {
        const v = rawValue(row, col);
        if (v === null || v === undefined) {return '';}
        if (typeof v === 'number') {return String(v);}
        return String(v);
    };

    const keyOf = (row, index) => {
        if (typeof opts.rowKey === 'function') {return String(opts.rowKey(row, index));}
        if (row && typeof row === 'object' && 'id' in row) {return String(row.id);}
        return String(index);
    };

    const visibleColumns = () => columns.filter((c) => state.visible.has(c.key));

    /* ── Query pipeline ────────────────────────────────────────────────
       Order matters: filter → search → sort → page. Sorting before paging
       (never after) is what keeps page 2 from repeating page 1's rows. */

    function filteredRows() {
        let rows = state.rows;

        const activeFilters = Object.entries(state.columnFilters).filter(([, v]) => v !== '');
        if (activeFilters.length) {
            rows = rows.filter((row) => activeFilters.every(([key, needle]) => {
                const col = columnByKey(key);
                return col ? displayValue(row, col).includes(needle) : true;
            }));
        }

        const q = state.query.trim().toLowerCase();
        if (q) {
            const cols = visibleColumns();
            rows = rows.filter((row) => cols.some((col) => displayValue(row, col).toLowerCase().includes(q)));
        }

        if (state.sort) {
            const col = columnByKey(state.sort.key);
            if (col) {
                const dir = state.sort.dir === 'asc' ? 1 : -1;
                const numeric = col.type === 'number';
                rows = rows.slice().sort((a, b) => {
                    const av = rawValue(a, col);
                    const bv = rawValue(b, col);
                    if (numeric) {
                        const an = Number(av); const bn = Number(bv);
                        // NaN must sort last rather than poison the comparator.
                        if (Number.isNaN(an) && Number.isNaN(bn)) {return 0;}
                        if (Number.isNaN(an)) {return 1;}
                        if (Number.isNaN(bn)) {return -1;}
                        return (an - bn) * dir;
                    }
                    return String(av ?? '').localeCompare(String(bv ?? ''), 'ar') * dir;
                });
            }
        }

        return rows;
    }

    function pageSlice(rows) {
        if (opts.mode === 'server') {return rows;} // server already sliced
        const start = (state.page - 1) * state.pageSize;
        return rows.slice(start, start + state.pageSize);
    }

    function pageCount(total) {
        if (opts.mode === 'server') {
            return Math.max(1, Math.ceil((state.totalRecords ?? state.rows.length) / state.pageSize));
        }
        return Math.max(1, Math.ceil(total / state.pageSize));
    }

    /* ── Selection ───────────────────────────────────────────────────── */
    function emitSelection() {
        if (!opts.selectable || typeof opts.onSelectionChange !== 'function') {return;}
        opts.onSelectionChange(state.rows.filter((_, i) => state.selected.has(keyOf(state.rows[i], i))));
    }

    function emitServerState() {
        if (opts.mode !== 'server' || typeof opts.onStateChange !== 'function') {return;}
        opts.onStateChange({
            sort: state.sort ? { ...state.sort } : undefined,
            query: state.query,
            columnFilters: { ...state.columnFilters },
            page: state.page,
            pageSize: state.pageSize,
        });
    }

    /* ── Render ──────────────────────────────────────────────────────── */
    function render() {
        renderColumnMenu();

        // ── Non-table states win outright ──────────────────────────────
        if (state.error) {
            el.scroll.innerHTML = `
              <div class="erp-state" role="alert">
                <span class="erp-state__icon" aria-hidden="true">⚠️</span>
                <span class="erp-state__title">تعذّر تحميل البيانات</span>
                <span>${esc(state.error)}</span>
                <button type="button" class="erp-btn erp-btn--sm" data-erp-retry>
                  <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة المحاولة</span>
                </button>
              </div>`;
            el.scroll.querySelector('[data-erp-retry]')?.addEventListener('click', () => {
                state.error = null;
                if (opts.mode === 'server') {emitServerState();}
                render();
            });
            el.count.textContent = '';
            el.pager.hidden = true;
            return;
        }

        if (state.loading) {
            el.scroll.innerHTML = `
              <div class="erp-state" role="status" aria-live="polite">
                <span class="erp-state__icon" aria-hidden="true">⏳</span>
                <span class="erp-state__title">جارٍ التحميل…</span>
              </div>`;
            el.count.textContent = '';
            el.pager.hidden = true;
            return;
        }

        const all = filteredRows();
        const rows = pageSlice(all);
        const cols = visibleColumns();

        // Result count: in server mode report what the server owns.
        if (opts.mode === 'server') {
            const total = state.totalRecords;
            el.count.textContent = total === null
                ? `${state.rows.length} صفوف معروضة`
                : `${total} إجمالي · ${state.rows.length} معروضة`;
        } else {
            const total = all.length;
            el.count.textContent = (state.query || Object.values(state.columnFilters).some(Boolean))
                ? `${rows.length} من ${total} صف`
                : `${total} صف`;
        }

        if (!rows.length) {
            el.scroll.innerHTML = `
              <div class="erp-state">
                <span class="erp-state__icon" aria-hidden="true">🗒️</span>
                <span class="erp-state__title">${esc(opts.emptyMessage || 'لا توجد بيانات')}</span>
                <span>${esc(state.query || Object.values(state.columnFilters).some(Boolean)
                    ? (opts.emptyHint || 'جرّب تعديل البحث أو الفلاتر.')
                    : (opts.emptyHint || 'لم تُسجَّل أي سجلات بعد.'))}</span>
              </div>`;
            el.pager.hidden = true;
            return;
        }

        /* ── Table ───────────────────────────────────────────────────── */
        const allOnPage = rows.map((r, i) => keyOf(r, i));
        const allSelected = opts.selectable && allOnPage.length > 0
            && allOnPage.every((k) => state.selected.has(k));

        const head = cols.map((col) => {
            const sortable = !!col.sortable;
            const active = state.sort?.key === col.key;
            const dir = active ? state.sort.dir : null;
            const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
            const align = col.align || 'start';
            return `<th scope="col" class="erp-th" data-col="${esc(col.key)}"
                       style="${col.width ? `width:${esc(col.width)};` : ''}text-align:${align};"
                       ${sortable ? `aria-sort="${ariaSort}"` : ''}>
                ${sortable
                    ? `<button type="button" class="erp-th__btn" data-sort="${esc(col.key)}"
                               aria-label="ترتيب حسب ${esc(col.header)}${active ? (dir === 'asc' ? ' — تصاعدي' : ' — تنازلي') : ''}">
                         <span>${esc(col.header)}</span>
                         <i class="ji" data-i="${active ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'}"
                            aria-hidden="true"></i>
                       </button>`
                    : esc(col.header)}
              </th>`;
        }).join('');

        const filterRow = cols.some((c) => c.filterable)
            ? `<tr class="erp-tr-filter">${opts.selectable ? '<td class="erp-td erp-td--sel"></td>' : ''}
                 ${cols.map((col) => `<td class="erp-td">
                    ${col.filterable
                        ? `<input type="search" class="erp-input erp-input--sm" data-cfilter="${esc(col.key)}"
                                  value="${esc(state.columnFilters[col.key] || '')}"
                                  placeholder="تصفية ${esc(col.header)}…" aria-label="تصفية عمود ${esc(col.header)}">`
                        : ''}
                  </td>`).join('')}</tr>`
            : '';

        const body = rows.map((row, i) => {
            const k = allOnPage[i];
            const checked = state.selected.has(k);
            const cells = cols.map((col) => {
                const align = col.align || 'start';
                const html = typeof col.render === 'function'
                    ? col.render(row, i)
                    : esc(displayValue(row, col));
                return `<td class="erp-td ${col.className || ''}" style="text-align:${align};">${html}</td>`;
            }).join('');
            const sel = opts.selectable
                ? `<td class="erp-td erp-td--sel">
                     <input type="checkbox" data-row-sel="${esc(k)}" ${checked ? 'checked' : ''}
                            aria-label="تحديد الصف ${i + 1}">
                   </td>`
                : '';
            return `<tr class="erp-tr" data-row="${esc(k)}" tabindex="0"
                        ${opts.onRowActivate ? 'aria-roledescription="صف قابل للفتح"' : ''}>${sel}${cells}</tr>`;
        }).join('');

        el.scroll.innerHTML = `
          <table class="erp-table__grid" role="grid">
            <caption class="erp-sr-only">${esc(opts.caption || 'جدول بيانات')}</caption>
            <thead>
              <tr>
                ${opts.selectable ? `<th scope="col" class="erp-th erp-th--sel">
                    <input type="checkbox" data-sel-all ${allSelected ? 'checked' : ''}
                           aria-label="تحديد كل صفوف الصفحة">
                  </th>` : ''}
                ${head}
              </tr>
              ${filterRow}
            </thead>
            <tbody>${body}</tbody>
          </table>`;

        wireTable();
        renderPager(all.length);
    }

    function wireTable() {
        // Sorting
        el.scroll.querySelectorAll('[data-sort]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.sort;
                if (state.sort?.key === key) {
                    state.sort = state.sort.dir === 'asc'
                        ? { key, dir: 'desc' }
                        : null; // third press clears the sort entirely
                } else {
                    state.sort = { key, dir: 'asc' };
                }
                state.page = 1;
                emitServerState();
                render();
                // Keep focus on the header the user just used.
                el.scroll.querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus();
            });
        });

        // Per-column filters
        el.scroll.querySelectorAll('[data-cfilter]').forEach((input) => {
            input.addEventListener('input', () => {
                const key = input.dataset.cfilter;
                state.columnFilters[key] = input.value;
                state.page = 1;
                emitServerState();
                const pos = input.selectionStart;
                render();
                const again = el.scroll.querySelector(`[data-cfilter="${CSS.escape(key)}"]`);
                again?.focus();
                if (again && pos !== null) {again.setSelectionRange(pos, pos);}
            });
        });

        // Row selection
        el.scroll.querySelectorAll('[data-row-sel]').forEach((box) => {
            box.addEventListener('change', () => {
                const k = box.dataset.rowSel;
                if (box.checked) {state.selected.add(k);} else {state.selected.delete(k);}
                emitSelection();
                render();
            });
        });

        const selAll = el.scroll.querySelector('[data-sel-all]');
        if (selAll) {
            selAll.addEventListener('change', () => {
                const rows = pageSlice(filteredRows());
                rows.forEach((row, i) => {
                    const k = keyOf(row, i);
                    if (selAll.checked) {state.selected.add(k);} else {state.selected.delete(k);}
                });
                emitSelection();
                render();
            });
        }

        // Row activation + keyboard
        el.scroll.querySelectorAll('[data-row]').forEach((tr) => {
            if (opts.onRowActivate) {
                tr.addEventListener('dblclick', () => activateRow(tr));
                tr.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {e.preventDefault(); activateRow(tr);}
                });
            }
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {e.preventDefault(); tr.nextElementSibling?.focus();}
                if (e.key === 'ArrowUp')   {e.preventDefault(); tr.previousElementSibling?.focus();}
                if (e.key === ' ' && opts.selectable) {
                    e.preventDefault();
                    const box = tr.querySelector('[data-row-sel]');
                    if (box) {box.checked = !box.checked; box.dispatchEvent(new Event('change'));}
                }
            });
        });
    }

    function activateRow(tr) {
        if (typeof opts.onRowActivate !== 'function') {return;}
        const k = tr.dataset.row;
        const row = state.rows.find((r, i) => keyOf(r, i) === k);
        if (row) {opts.onRowActivate(row);}
    }

    /* ── Column visibility ───────────────────────────────────────────── */
    function renderColumnMenu() {
        if (!el.colsMenu) {return;}
        el.colsMenu.innerHTML = columns.map((col) => `
          <label class="erp-cols-menu__item">
            <input type="checkbox" data-colvis="${esc(col.key)}" ${state.visible.has(col.key) ? 'checked' : ''}>
            <span>${esc(col.header)}</span>
          </label>`).join('');
        el.colsMenu.querySelectorAll('[data-colvis]').forEach((box) => {
            box.addEventListener('change', () => {
                const key = box.dataset.colvis;
                if (box.checked) {state.visible.add(key);} else {state.visible.delete(key);}
                // Never allow zero columns — that is an unrecoverable blank table.
                if (state.visible.size === 0) {
                    state.visible.add(key);
                    box.checked = true;
                    console.warn('[DataTable] refusing to hide the last visible column.');
                    return;
                }
                render();
            });
        });
    }

    /* ── Pager ───────────────────────────────────────────────────────── */
    function renderPager(total) {
        const pages = pageCount(total);
        if (pages <= 1) {el.pager.hidden = true; el.pager.innerHTML = ''; return;}
        el.pager.hidden = false;

        // Keep the requested page inside range (server totals can shrink).
        if (state.page > pages) {state.page = pages;}

        const from = opts.mode === 'server' ? (state.page - 1) * state.pageSize + 1 : (state.page - 1) * state.pageSize + 1;
        const to = opts.mode === 'server'
            ? Math.min(state.totalRecords ?? (state.page * state.pageSize), state.page * state.pageSize)
            : Math.min(state.page * state.pageSize, total);

        el.pager.innerHTML = `
          <span class="erp-pager__info">${from}–${to} من ${opts.mode === 'server' ? (state.totalRecords ?? to) : total}</span>
          <div class="erp-pager__btns">
            <button type="button" class="erp-btn erp-btn--sm" data-page="first" ${state.page === 1 ? 'disabled' : ''}
                    aria-label="الصفحة الأولى"><i class="ji" data-i="chevrons-right" aria-hidden="true"></i></button>
            <button type="button" class="erp-btn erp-btn--sm" data-page="prev" ${state.page === 1 ? 'disabled' : ''}
                    aria-label="الصفحة السابقة"><i class="ji" data-i="chevron-right" aria-hidden="true"></i></button>
            <span class="erp-pager__page">${state.page} / ${pages}</span>
            <button type="button" class="erp-btn erp-btn--sm" data-page="next" ${state.page >= pages ? 'disabled' : ''}
                    aria-label="الصفحة التالية"><i class="ji" data-i="chevron-left" aria-hidden="true"></i></button>
            <button type="button" class="erp-btn erp-btn--sm" data-page="last" ${state.page >= pages ? 'disabled' : ''}
                    aria-label="الصفحة الأخيرة"><i class="ji" data-i="chevrons-left" aria-hidden="true"></i></button>
          </div>
          <label class="erp-pager__size">
            <span class="erp-sr-only">صفوف في الصفحة</span>
            <select class="erp-select" data-page-size>
              ${[10, 25, 50, 100].map((n) => `<option value="${n}" ${state.pageSize === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>`;

        el.pager.querySelectorAll('[data-page]').forEach((b) => {
            b.addEventListener('click', () => {
                const target = b.dataset.page;
                if (target === 'first') {state.page = 1;}
                if (target === 'prev')  {state.page = Math.max(1, state.page - 1);}
                if (target === 'next')  {state.page = Math.min(pages, state.page + 1);}
                if (target === 'last')  {state.page = pages;}
                emitServerState();
                render();
                el.scroll.scrollTop = 0;
            });
        });

        el.pager.querySelector('[data-page-size]')?.addEventListener('change', (e) => {
            state.pageSize = Number(e.target.value) || state.pageSize;
            state.page = 1;
            emitServerState();
            render();
        });
    }

    /* ── Global search + column menu wiring ──────────────────────────── */
    let searchTimer = null;
    if (el.search) {
        el.search.addEventListener('input', () => {
            // Debounced: a per-keystroke filter on a large client list is jank.
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.query = el.search.value;
                state.page = 1;
                emitServerState();
                render();
            }, 160);
        });
    }

    el.colsBtn.addEventListener('click', () => {
        const open = el.colsMenu.hidden;
        el.colsMenu.hidden = !open;
        el.colsBtn.setAttribute('aria-expanded', String(open));
    });

    // Click-away closes the column menu.
    const onDocClick = (e) => {
        if (el.colsMenu.hidden) {return;}
        if (root.contains(e.target)) {return;}
        el.colsMenu.hidden = true;
        el.colsBtn.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', onDocClick);

    /* ── Public API ──────────────────────────────────────────────────── */
    const api = {
        el: root,

        /** Replace the dataset (client) or the current page (server). */
        setRows(rows) {
            state.rows = Array.isArray(rows) ? rows.slice() : [];
            state.loading = false;
            state.error = null;
            state.selected.clear();
            render();
        },

        /** Server mode: record the authoritative total the server reported. */
        setTotalRecords(total) {
            state.totalRecords = typeof total === 'number' ? total : null;
            render();
        },

        setLoading(on) { state.loading = !!on; render(); },
        setError(message) { state.error = message || null; state.loading = false; render(); },

        setSort(key, dir) {
            state.sort = key ? { key, dir: dir === 'desc' ? 'desc' : 'asc' } : null;
            state.page = 1;
            render();
        },
        setQuery(q) {
            if (el.search) {el.search.value = q || '';}
            state.query = q || '';
            state.page = 1;
            render();
        },
        setPage(p) { state.page = Math.max(1, p | 0); render(); },

        getSelection() {
            return state.rows.filter((_, i) => state.selected.has(keyOf(state.rows[i], i)));
        },
        clearSelection() { state.selected.clear(); render(); },

        /** Current presentation state (for tests / syncing a URL). */
        getState() {
            return {
                query: state.query,
                sort: state.sort ? { ...state.sort } : null,
                page: state.page,
                pageSize: state.pageSize,
                visible: [...state.visible],
                rowCount: state.rows.length,
            };
        },

        destroy() {
            clearTimeout(searchTimer);
            document.removeEventListener('click', onDocClick);
            root.remove();
        },
    };

    render();
    return api;
}
