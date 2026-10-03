/**
 * pos-orders.js — Professional Order History & Reprint Module
 * ────────────────────────────────────────────────────────────
 * Features:
 *   • Searchable paginated order list with date/department/status filters
 *   • Today's dashboard statistics
 *   • Full invoice detail modal with line items + payments
 *   • Browser-print receipt (HTML styled — thermal 80mm format)
 *   • Reprint to thermal printer (queues via ESC/POS worker)
 *   • Void invoice (admin/manager only)
 *
 * Requires: pos.js `api()` function + JWT token via `accessToken`.
 * Assumes: global `_rtSocket` for real-time events.
 */
(function() {
'use strict';

const POS_ORDERS = {
    currentPage: 1,
    filters: { date_from: '', date_to: '', department_id: '', status: '', search: '' },
    departments: [],

    // ── INIT ──────────────────────────────────────────
    async init() {
        await this.loadDepartments();
        this.attachEvents();
    },

    async loadDepartments() {
        try {
            const res = await api('/api/pos/departments');
            this.departments = Array.isArray(res) ? res : (res.data || []);
        } catch(e) { console.warn('loadDepartments:', e.message); }
    },

    attachEvents() {
        // Permanent buttons live in pos.html — bind them ONCE. renderFilterBar
        // re-called attachEvents on every show(), stacking duplicate listeners
        // (N print windows per click after N opens).
        if (!this._permanentEventsBound) {
            this._permanentEventsBound = true;
            const closeBtn = document.getElementById('close-orders-screen');
            if (closeBtn) {closeBtn.addEventListener('click', () => this.hide());}
            const printAllBtn = document.getElementById('print-all-orders-btn');
            if (printAllBtn) {printAllBtn.addEventListener('click', () => this.printAllOrders());}
            const printItemsBtn = document.getElementById('print-item-sales-btn');
            if (printItemsBtn) {printItemsBtn.addEventListener('click', () => this.printItemSales());}
        }
        this.bindFilterBarEvents();
    },

    bindFilterBarEvents() {
        // Filter-bar controls are destroyed/re-created with innerHTML — always rebind
        const applyBtn = document.getElementById('orders-apply-filters');
        if (applyBtn) {applyBtn.addEventListener('click', () => this.applyFilters());}

        const resetBtn = document.getElementById('orders-reset-filters');
        if (resetBtn) {resetBtn.addEventListener('click', () => this.resetFilters());}
    },

    // ── SHOW / HIDE ───────────────────────────────────
    async show() {
        document.getElementById('orders-screen').classList.remove('hidden');
        document.getElementById('pos-screen').classList.add('hidden');
        this.currentPage = 1;
        await this.loadDepartments();
        this.renderFilterBar();
        await this.loadStats();
        await this.loadOrders();
        await this.loadItemSummary();
    },

    hide() {
        document.getElementById('orders-screen').classList.add('hidden');
        document.getElementById('pos-screen').classList.remove('hidden');
    },

    // ── RENDER FILTER BAR ─────────────────────────────
    renderFilterBar() {
        const deptOpts = this.departments.map(d => 
            `<option value="${d.id}">${d.name_ar}</option>`
        ).join('');
        
        const bar = document.getElementById('orders-filter-bar');
        if (!bar) {return;}
        
        bar.innerHTML = `
            <div class="orders-filter-row">
                <div class="orders-filter-item">
                    <label>من تاريخ</label>
                    <input type="date" id="orders-date-from" value="${this.filters.date_from}">
                </div>
                <div class="orders-filter-item">
                    <label>إلى تاريخ</label>
                    <input type="date" id="orders-date-to" value="${this.filters.date_to}">
                </div>
                <div class="orders-filter-item">
                    <label>القسم</label>
                    <select id="orders-dept-filter">
                        <option value="">كل الأقسام</option>
                        ${deptOpts}
                    </select>
                </div>
                <div class="orders-filter-item">
                    <label>الحالة</label>
                    <select id="orders-status-filter">
                        <option value="">الكل</option>
                        <option value="issued">صادرة</option>
                        <option value="cancelled">ملغاة</option>
                    </select>
                </div>
                <div class="orders-filter-item">
                    <label>بحث</label>
                    <input type="text" id="orders-search" placeholder="رقم الفاتورة أو اسم القسم..." value="${this.filters.search}">
                </div>
            </div>
            <div class="orders-filter-actions">
                <button class="btn btn-gold btn-sm" id="orders-apply-filters"><i class=ji data-i=search></i> بحث</button>
                <button class="btn btn-sm" id="orders-reset-filters"><i class=ji data-i=refresh></i> إعادة</button>
            </div>
        `;
        
        // Re-attach events since we re-rendered
        this.attachEvents();
    },

    // ── APPLY FILTERS ─────────────────────────────────
    async applyFilters() {
        this.filters.date_from = document.getElementById('orders-date-from')?.value || '';
        this.filters.date_to = document.getElementById('orders-date-to')?.value || '';
        this.filters.department_id = document.getElementById('orders-dept-filter')?.value || '';
        this.filters.status = document.getElementById('orders-status-filter')?.value || '';
        this.filters.search = document.getElementById('orders-search')?.value || '';
        this.currentPage = 1;
        await this.loadOrders();
        await this.loadItemSummary();
    },

    async resetFilters() {
        this.filters = { date_from: '', date_to: '', department_id: '', status: '', search: '' };
        this.renderFilterBar();
        this.currentPage = 1;
        await this.loadOrders();
        await this.loadItemSummary();
    },

    // ── LOAD TODAY STATS ──────────────────────────────
    async loadStats() {
        try {
            const stats = await api('/api/pos/orders/stats/today');
            const s = stats && stats.summary;
            const el = document.getElementById('orders-stats');
            if (!el) {return;}
            if (!s) {
                el.innerHTML = '<div class="order-stat-card pos-empty-cell">لا توجد إحصاءات متاحة الآن</div>';
                return;
            }
            
            el.innerHTML = `
                <div class="order-stat-card">
                    <div class="order-stat-icon"><i class=ji data-i=banknote></i></div>
                    <div class="order-stat-val">${Number(s.total_revenue).toFixed(2)}</div>
                    <div class="order-stat-lbl">إجمالي المبيعات (${CURRENCY})</div>
                </div>
                <div class="order-stat-card">
                    <div class="order-stat-icon"><i class=ji data-i=clipboard-list></i></div>
                    <div class="order-stat-val">${s.orders_count}</div>
                    <div class="order-stat-lbl">عدد الفواتير</div>
                </div>
                <div class="order-stat-card">
                    <div class="order-stat-icon"><i class=ji data-i=chart></i></div>
                    <div class="order-stat-val">${Number(s.avg_order_value).toFixed(2)}</div>
                    <div class="order-stat-lbl">متوسط قيمة الفاتورة</div>
                </div>
                <div class="order-stat-card">
                    <div class="order-stat-icon"><i class=ji data-i=receipt></i></div>
                    <div class="order-stat-val">${s.issued_count}</div>
                    <div class="order-stat-lbl">فواتير صادرة</div>
                </div>
            `;
            
            // Payment breakdown
            const pbEl = document.getElementById('orders-payment-breakdown');
            if (pbEl && stats.payment_breakdown) {
                pbEl.innerHTML = stats.payment_breakdown.map(p => `
                    <div class="payment-chip ${p.method}">
                        ${p.method === 'cash' ? '<i class=ji data-i=banknote></i> نقدي' : p.method === 'card' ? '<i class=ji data-i=credit-card></i> بطاقة' : '<i class=ji data-i=smartphone></i> ' + p.method}: 
                        ${Number(p.total).toFixed(2)} ${CURRENCY} (${p.count})
                    </div>
                `).join('');
            }
            
            // Recent orders mini-list
            const recentEl = document.getElementById('orders-recent');
            if (recentEl && stats.recent_orders) {
                recentEl.innerHTML = stats.recent_orders.map(o => `
                    <div class="recent-order-item" onclick="POS_ORDERS.viewInvoice('${o.id}')">
                        <span class="invoice-num">#${o.invoice_counter}</span>
                        <span class="invoice-dept">${this.escape(o.department_name || '—')}</span>
                        <span class="invoice-amount">${Number(o.total_amount).toFixed(2)}</span>
                        <span class="invoice-time">${this.fmtTime(o.created_at)}</span>
                        <span class="invoice-status ${o.status}">${o.status === 'issued' ? '<i class=ji data-i=circle-check></i>' : '<i class=ji data-i=circle-x></i>'}</span>
                    </div>
                `).join('') || '<div class="text-muted">لا توجد فواتير اليوم</div>';
            }
        } catch(e) {
            console.error('loadStats:', e.message);
        }
    },

    // ── ITEM SALES SUMMARY ───────────────────────────
    async loadItemSummary() {
        const params = new URLSearchParams();
        if (this.filters.date_from) {params.set('date_from', this.filters.date_from);}
        if (this.filters.date_to) {params.set('date_to', this.filters.date_to);}
        if (this.filters.department_id) {params.set('department_id', this.filters.department_id);}
        try {
            const result = await api(`/api/pos/orders/item-summary?${params.toString()}`);
            const rows = result.data || [], summary = result.summary || {};
            const stats = document.getElementById('item-sales-stats');
            if (stats) {stats.innerHTML = `<div class="order-stat-card"><div class="order-stat-icon"><i class=ji data-i=package></i></div><div class="order-stat-val">${this.num(summary.quantity_sold)}</div><div class="order-stat-lbl">إجمالي الكميات المباعة</div></div><div class="order-stat-card"><div class="order-stat-icon"><i class=ji data-i=receipt></i></div><div class="order-stat-val">${this.num(summary.invoice_count)}</div><div class="order-stat-lbl">الفواتير الصادرة</div></div><div class="order-stat-card"><div class="order-stat-icon"><i class=ji data-i=banknote></i></div><div class="order-stat-val">${this.money(summary.net_sales)}</div><div class="order-stat-lbl">صافي المبيعات (${CURRENCY})</div></div><div class="order-stat-card"><div class="order-stat-icon"><i class=ji data-i=cooking-pot></i></div><div class="order-stat-val">${rows.filter(r => Number(r.produced_qty) > 0).length}</div><div class="order-stat-lbl">أصناف لها إنتاج مطبخ</div></div>`;}
            const body = document.getElementById('item-sales-table-body');
            if (!body) {return;}
            body.innerHTML = rows.length ? rows.map(r => {
                const sold = Number(r.quantity_sold || 0), produced = Number(r.produced_qty || 0), planned = Number(r.planned_qty || 0), reference = planned || produced;
                const diff = reference ? sold - reference : null;
                const compare = diff === null ? '<span class="text-muted">لا يوجد إنتاج/مستهدف</span>' : `<span class="${diff > 0 ? 'c-red' : diff < 0 ? 'c-green' : 'c-teal'} fw-bold">${diff > 0 ? 'تجاوز ' : diff < 0 ? 'متبقي ' : 'مطابق '}${this.num(Math.abs(diff))}</span><small class="item-compare-meta">المباع ${this.num(sold)} / ${planned ? 'المخطط' : 'المنتج'} ${this.num(reference)}</small>`;
                return `<tr><td class="fw-bold">${this.escape(r.product_name || '—')}<small class="item-barcode">${this.escape(r.product_barcode || '')}</small></td><td>${this.escape(r.departments || '—')}</td><td>${this.num(r.invoice_count)}</td><td class="c-teal fw-bold">${this.num(sold)}</td><td class="c-gold fw-bold">${this.money(r.net_sales)}</td><td class="c-orange">${this.money(r.tax_total)}</td><td>${compare}</td></tr>`;
            }).join('') : '<tr><td colspan="7" class="pos-empty-cell">لا توجد مبيعات أصناف ضمن الفترة المحددة</td></tr>';
            this.lastItemRows = rows;
        } catch (e) { console.error('loadItemSummary:', e.message); }
    },

    num(v) { return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 }); },
    money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    // التقويم الميلادي موحّد مع بقية النظام، بأرقام لاتينية مطابقة للأرقام الجدولية
    fmtDate(v) { return new Date(v).toLocaleDateString('ar-EG-u-nu-latn', { day: '2-digit', month: 'short', year: 'numeric' }); },
    fmtTime(v) { return new Date(v).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }); },
    fmtDateTime(v) { return new Date(v).toLocaleString('ar-EG-u-nu-latn', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    escape(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

    async printAllOrders() {
        const params = new URLSearchParams(this.filters);
        try {
            const result = await api(`/api/pos/orders/export?${params.toString()}`), orders = result.data || [];
            const rows = orders.map(o => `<tr><td>#${o.invoice_counter}</td><td>${this.escape(o.department_name || '—')}</td><td>${this.fmtDateTime(o.created_at)}</td><td>${this.escape(o.cashier_name || '—')}</td><td>${o.status === 'issued' ? 'صادرة' : 'ملغاة'}</td><td>${Number(o.total_amount || 0).toFixed(2)}</td><td>${(o.items || []).map(i => `${this.escape(i.product_name)} × ${this.num(i.quantity)}`).join('، ')}</td></tr>`).join('');
            this.printHtml(`<h1>تقرير كل فواتير الكاشير</h1><p>مطاعم الشرفه العالمي — عدد الفواتير: ${orders.length}</p><table><thead><tr><th>الفاتورة</th><th>القسم</th><th>التاريخ</th><th>الكاشير</th><th>الحالة</th><th>الإجمالي</th><th>الأصناف</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد فواتير</td></tr>'}</tbody></table>`);
        } catch (e) { window.toast?.('فشل تجهيز طباعة الفواتير', 'error'); }
    },

    printItemSales() {
        const table = document.querySelector('#item-sales-report table');
        if (table) {this.printHtml(`<h1>تقرير مبيعات الأصناف</h1><p>مطاعم الشرفه العالمي — المبيعات الفعلية من الفواتير الصادرة</p>${table.outerHTML}`);}
    },

    printHtml(content) {
        const w = (window.openInAppReport ? window.openInAppReport('فاتورة POS') : window.open('', '_blank'));
        if (!w) {return;}
        w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>مطاعم الشرفه العالمي</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#222}h1{text-align:center;color:#9b762c}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #bbb;padding:8px;text-align:right}th{background:#f4ead2}.item-barcode,.item-compare-meta{display:block;font-size:11px;color:#777;margin-top:3px}@media print{button{display:none}}</style></head><body>${content}<script>window.onload=()=>window.print()<\\/script></body></html>`);
        w.document.close();
    },

    // ── LOAD ORDERS ───────────────────────────────────
    async loadOrders() {
        const params = new URLSearchParams({
            page: this.currentPage,
            limit: 20,
        });
        if (this.filters.date_from) {params.set('date_from', this.filters.date_from);}
        if (this.filters.date_to) {params.set('date_to', this.filters.date_to);}
        if (this.filters.department_id) {params.set('department_id', this.filters.department_id);}
        if (this.filters.status) {params.set('status', this.filters.status);}
        if (this.filters.search) {params.set('search', this.filters.search);}
        
        try {
            const result = await api(`/api/pos/orders?${params.toString()}`);
            const orders = result.data || [];
            const pag = result.pagination || {};
            
            this.renderOrderTable(orders, pag);
            this.renderPagination(pag);
        } catch(e) {
            console.error('loadOrders:', e.message);
            document.getElementById('orders-table-body').innerHTML = 
                '<tr><td colspan="7" class="text-center text-muted"><i class=ji data-i=circle-x></i> فشل تحميل البيانات</td></tr>';
        }
    },

    // ── RENDER TABLE ──────────────────────────────────
    renderOrderTable(orders, pag) {
        const tbody = document.getElementById('orders-table-body');
        if (!tbody) {return;}
        
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="pos-empty-cell">لا توجد فواتير</td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(o => {
            const date = this.fmtDate(o.created_at);
            const time = this.fmtTime(o.created_at);
            const statusClass = o.status === 'issued' ? 'status-issued' : 'status-voided';
            const statusLabel = o.status === 'issued' ? '<i class=ji data-i=circle-check></i> صادرة' : '<i class=ji data-i=circle-x></i> ملغاة';
            const payments = Array.isArray(o.payments) ? o.payments : [];
            const payMethods = [...new Set(payments.map(p => p.method))].join(', ');
            
            return `
            <tr class="order-row ${o.status}" onclick="POS_ORDERS.viewInvoice('${o.id}')">
                <td class="fw-bold c-gold">#${o.invoice_counter}</td>
                <td>${this.escape(o.department_name || '—')}</td>
                <td>${date} ${time}</td>
                <td class="c-gold fw-bold">${Number(o.total_amount).toFixed(2)}</td>
                <td>${payMethods || '—'}</td>
                <td><span class="order-status-badge ${statusClass}">${statusLabel}</span></td>
                <td>
                    <button class="btn btn-xs" onclick="event.stopPropagation();POS_ORDERS.viewInvoice('${o.id}')" title="عرض"><i class=ji data-i=eye></i></button>
                    <button class="btn btn-xs btn-blue" onclick="event.stopPropagation();POS_ORDERS.printReceipt('${o.id}')" title="طباعة"><i class=ji data-i=printer></i></button>
                    ${o.status === 'issued' ? `<button class="btn btn-xs btn-red" onclick="event.stopPropagation();POS_ORDERS.voidInvoice('${o.id}')" title="إلغاء"><i class=ji data-i=x></i></button>` : ''}
                </td>
            </tr>`;
        }).join('');
        
        document.getElementById('orders-total-count').textContent = `(${pag.total || orders.length})`;
    },

    renderPagination(pag) {
        const el = document.getElementById('orders-pagination');
        if (!el || pag.totalPages <= 1) {
            if (el) {el.innerHTML = '';}
            return;
        }
        
        let html = '';
        html += `<button class="btn btn-sm" ${pag.page <= 1 ? 'disabled' : ''} onclick="POS_ORDERS.goPage(${pag.page - 1})"><i class=ji data-i=arrow-left></i> السابق</button>`;
        html += `<span class="page-info">صفحة ${pag.page} من ${pag.totalPages}</span>`;
        html += `<button class="btn btn-sm" ${pag.page >= pag.totalPages ? 'disabled' : ''} onclick="POS_ORDERS.goPage(${pag.page + 1})">التالي <i class=ji data-i=arrow-right></i></button>`;
        el.innerHTML = html;
    },

    async goPage(n) {
        this.currentPage = n;
        await this.loadOrders();
        document.getElementById('orders-table').scrollIntoView({behavior:'smooth'});
    },

    // ── REALTIME: sale on any terminal → refresh if orders screen open ──
    onRealtimeSale() {
        const screen = document.getElementById('orders-screen');
        if (!screen || screen.classList.contains('hidden')) {return;}
        clearTimeout(this._rtTimer);
        this._rtTimer = setTimeout(async () => {
            try { await this.loadOrders(); await this.loadStats(); } catch (e) { /* silent */ }
        }, 700);
    },

    // ── VIEW INVOICE DETAIL ────────────────────────────
    async viewInvoice(id) {
        try {
            const order = await api(`/api/pos/orders/${id}`);
            this.showInvoiceModal(order);
        } catch(e) {
            window.toast?.('فشل تحميل تفاصيل الفاتورة', 'error');
        }
    },

    showInvoiceModal(order) {
        const date = this.fmtDateTime(order.created_at);
        const statusClass = order.status === 'issued' ? 'status-issued' : 'status-voided';
        const statusLabel = order.status === 'issued' ? '<i class=ji data-i=circle-check></i> صادرة' : '<i class=ji data-i=circle-x></i> ملغاة';
        const items = order.items || [];
        const payments = order.payments || [];
        
        const modal = document.getElementById('invoice-detail-modal');
        if (!modal) {return;}
        
        modal.querySelector('.invoice-header-info').innerHTML = `
            <h2>فاتورة #${order.invoice_counter}</h2>
            <div class="invoice-meta">
                <span class="order-status-badge ${statusClass}">${statusLabel}</span>
                <span><i class=ji data-i=calendar></i> ${date}</span>
                <span><i class=ji data-i=user></i> ${this.escape(order.cashier_name || '—')}</span>
                <span><i class=ji data-i=building></i> ${this.escape(order.department_name || '—')}</span>
                ${order.void_reason ? `<span class="void-reason">سبب الإلغاء: ${this.escape(order.void_reason)}</span>` : ''}
            </div>
        `;
        
        modal.querySelector('.invoice-items-body').innerHTML = items.map((it, i) => `
            <tr>
                <td>${i + 1}</td>
                <td class="fw-bold">${this.escape(it.product_name)}</td>
                <td>${Number(it.quantity)}</td>
                <td>${Number(it.unit_price).toFixed(2)}</td>
                ${Number(it.discount) > 0 ? `<td class="c-red">-${Number(it.discount).toFixed(2)}</td>` : '<td>—</td>'}
                <td class="c-gold fw-bold">${Number(it.line_total).toFixed(2)}</td>
            </tr>
        `).join('');
        
        // Totals
        modal.querySelector('.invoice-totals').innerHTML = `
            <div class="invoice-total-row"><span>المجموع الفرعي</span><span>${Number(order.subtotal).toFixed(2)}</span></div>
            ${Number(order.discount_total) > 0 ? `<div class="invoice-total-row"><span>الخصم</span><span class="c-red">-${Number(order.discount_total).toFixed(2)}</span></div>` : ''}
            <div class="invoice-total-row"><span>الضريبة (15%)</span><span>${Number(order.tax_total).toFixed(2)}</span></div>
            <div class="invoice-total-row total"><span>الإجمالي</span><span>${Number(order.total_amount).toFixed(2)} ${CURRENCY}</span></div>
        `;
        
        // Payments
        modal.querySelector('.invoice-payments-body').innerHTML = payments.map(p => `
            <tr>
                <td>${p.method === 'cash' ? '<i class=ji data-i=banknote></i> نقدي' : p.method === 'card' ? '<i class=ji data-i=credit-card></i> بطاقة' : p.method}</td>
                <td class="c-gold">${Number(p.amount).toFixed(2)}</td>
                ${p.reference ? `<td>${this.escape(p.reference)}</td>` : '<td>—</td>'}
            </tr>
        `).join('');
        
        // Actions
        modal.querySelector('.invoice-actions').innerHTML = `
            <button class="btn btn-blue" onclick="POS_ORDERS.printReceipt('${order.id}')"><i class=ji data-i=printer></i> طباعة الإيصال</button>
            <button class="btn btn-gold" onclick="POS_ORDERS.reprintThermal('${order.id}')"><i class=ji data-i=printer></i> طباعة حرارية</button>
            ${order.status === 'issued' ? `<button class="btn btn-red" onclick="POS_ORDERS.voidInvoice('${order.id}')"><i class=ji data-i=x></i> إلغاء الفاتورة</button>` : ''}
            <button class="btn btn-sm" onclick="POS_ORDERS.closeInvoiceModal()"><i class=ji data-i=x></i> إغلاق</button>
        `;
        
        modal.classList.remove('hidden');
    },

    closeInvoiceModal() {
        document.getElementById('invoice-detail-modal').classList.add('hidden');
    },

    // ── PRINT RECEIPT (Browser HTML) ────────────────────
    async printReceipt(id) {
        try {
            // The receipt endpoint requires a Bearer header — a top-level
            // window.open() navigation cannot attach it and always rendered the
            // 401 JSON. Fetch via api() (JSON { html }), then paint it in a blank window.
            const resp = await api(`/api/pos/orders/${id}/receipt-html`);
            const html = typeof resp === 'string' ? resp : (resp?.html || '');
            if (!html) { window.toast?.('لم يتم استلام محتوى الإيصال', 'error'); return; }
            const w = (window.openInAppReport ? window.openInAppReport('فاتورة POS') : window.open('', '_blank'));
            if (!w) { window.toast?.('اسمح بالنوافذ المنبثقة لطباعة الإيصال', 'warning'); return; }
            w.document.open();
            w.document.write(html);
            w.document.close();
            setTimeout(() => { try { w.print(); } catch(_){} }, 500);
            window.toast?.('جارٍ فتح الإيصال للطباعة', 'info');
        } catch(e) {
            window.toast?.('فشل الطباعة', 'error');
        }
    },

    // ── REPRINT ON THERMAL PRINTER ──────────────────────
    async reprintThermal(id) {
        try {
            await api(`/api/pos/orders/${id}/reprint`, { method: 'POST' });
            window.toast?.('تم إرسال أمر الطباعة إلى الطابعة الحرارية', 'success');
        } catch(e) {
            window.toast?.('فشل إرسال أمر الطباعة', 'error');
        }
    },

    // ── VOID INVOICE ────────────────────────────────────
    async voidInvoice(id) {
        const reason = prompt('سبب الإلغاء:');
        if (!reason) {return;}
        if (!confirm(`هل أنت متأكد من إلغاء الفاتورة؟\nالسبب: ${reason}`)) {return;}
        
        try {
            await api(`/api/pos/orders/${id}/void`, { 
                method: 'POST', 
                body: JSON.stringify({ reason }) 
            });
            window.toast?.('تم إلغاء الفاتورة', 'success');
            this.closeInvoiceModal();
            await this.loadOrders();
            await this.loadStats();
        } catch(e) {
            window.toast?.(e.response?.message || 'فشل إلغاء الفاتورة', 'error');
        }
    }
};

// ── Expose globally ──────────────────────────────────
window.POS_ORDERS = POS_ORDERS;

// ── Auto-init when POS is ready ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
    POS_ORDERS.init();
});

})();
