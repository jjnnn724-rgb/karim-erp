import {
    approveYarasoftSection,
    canWriteYarasoft,
    createYarasoftManualSection,
    deactivateYarasoftMapping,
    fetchYarasoftInvoiceDetail,
    fetchYarasoftLog,
    fetchYarasoftMirrorCashiers,
    fetchYarasoftMirrorClose,
    fetchYarasoftMirrorOrder,
    fetchYarasoftMirrorOrders,
    fetchYarasoftMappings,
    fetchYarasoftOracleCatchUpStatus,
    fetchYarasoftOracleReconcile,
    fetchYarasoftOracleStatus,
    fetchYarasoftCatalogStatus,
    fetchYarasoftQuarantine,
    organizeYarasoftCategories,
    syncYarasoftBalances,
    fetchYarasoftReview,
    fetchYarasoftSectionInvoiceDetail,
    fetchYarasoftSectionInvoices,
    fetchYarasoftSectionMap,
    fetchYarasoftStatus,
    fetchYarasoftUnmappedSections,
    reclassifyYarasoftRevenue,
    reprocessYarasoftInvoice,
    renameYarasoftSection,
    refreshYarasoftMirror,
    resolveYarasoftReview,
    runYarasoftNow,
    importYarasoftOracleItems,
    pollYarasoftOracleNow,
    previewYarasoftOracleItems,
    previewYarasoftInvoiceText,
    saveYarasoftMapping,
    searchYarasoftProducts,
    startYarasoftOracleCatchUp,
    testYarasoftOracle,
} from '../data/yarasoft-repo.js?v=4.9.156';
import { fetchCurrency, formatInt, formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.156';

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const arr = (value) => Array.isArray(value) ? value : [];

function statusBadge(status) {
    const styles = {
        COMPLETED: ['مكتملة', 'success'],
        DUPLICATE: ['مكررة', 'info'],
        FAILED: ['فاشلة', 'danger'],
        REQUIRES_REVIEW: ['تحتاج مراجعة', 'warning'],
        NEEDS_MAPPING: ['بانتظار اعتماد القسم', 'warning'],
        DRY_RUN: ['معاينة فقط', 'neutral'],
        PROCESSING: ['قيد المعالجة', 'info'],
        DETECTED: ['مكتشفة', 'neutral'],
    };
    const [label, tone] = styles[status] || [String(status || 'غير معروف'), 'neutral'];
    return `<span class="erp-badge" data-tone="${tone}">${esc(label)}</span>`;
}

function stateMessage(title, message, tone = '') {
    const role = tone === 'danger' ? 'alert' : 'status';
    return `<div class="erp-state"${tone ? ` data-tone="${tone}"` : ''} role="${role}"><span class="erp-state__title">${esc(title)}</span><span>${esc(message)}</span></div>`;
}

function table(headers, body, empty, count) {
    const th = headers.map((item) => `<th scope="col">${esc(item)}</th>`).join('');
    return `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${count}" class="erp-td erp-text-muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}

function template(canWrite) {
    return `<section class="erp-v2-yarasoft erp-stack" aria-label="إدارة تكامل قاعدة الكاشير">
      <header class="erp-dash-head"><div><h2 class="erp-dash-title">تكامل قاعدة الكاشير</h2><p class="erp-dash-sub">حالة الاستيراد، مراجعة الأصناف والأقسام المعلقة.</p></div>
        <div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-ys-reload>تحديث</button>${canWrite ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-run>تشغيل دورة الاستيراد</button>' : ''}</div>
      </header>
      <p class="erp-text-sm erp-text-muted" data-ys-notice role="status" aria-live="polite"></p>
      <nav class="erp-wa-tabs" role="tablist" aria-label="أقسام تكامل قاعدة الكاشير">
        <button type="button" role="tab" aria-selected="true" data-ys-tab="status">الحالة والسجل</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="review">مراجعة الأصناف</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="sections">الأقسام المعلقة</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="mappings">ربط المنتجات</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="oracle">ربط قاعدة الكاشير</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="quality">جودة بيانات قاعدة الكاشير</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="tools">معاينة الصيغة</button>
        <button type="button" role="tab" aria-selected="false" data-ys-tab="mirror">مرآة الكاشيرية</button>
      </nav>
      <div data-ys-panel role="tabpanel"></div>
    </section>`;
}

export function mountYarasoftScreen(host, ctx = {}) {
    const role = ctx.role || '';
    const canWrite = canWriteYarasoft(role);
    const notify = typeof ctx.notify === 'function' ? ctx.notify : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn : (message) => typeof window !== 'undefined' && window.confirm(message);
    host.insertAdjacentHTML('beforeend', template(canWrite));
    const el = host.lastElementChild;
    const panel = el.querySelector('[data-ys-panel]');
    const notice = el.querySelector('[data-ys-notice]');
    let tab = 'status';
    let busy = false;
    let destroyed = false;
    let systemCurrency = '';
    const money = (value) => {
        const result = formatMoney(value, systemCurrency);
        return `${result.amount}${result.hasUnit ? ` ${result.unit}` : ' (عملة النظام غير متاحة)'}`;
    };
    let logRows = [];
    let reviewRows = [];
    let sectionMap = [];
    let unmapped = [];
    let mappings = [];
    let selectedMapId = null;
    let sectionInvoices = null;
    let sectionInvoiceDetail = null;
    let oracleStatus = null;
    let oracleCatchUp = null;
    let oracleReconcile = null;
    let oracleItemPreview = null;
    let invoicePreview = null;
    let mirrorDate = '';
    let mirrorCashier = '';
    let mirrorOffset = 0;
    let mirrorCashiers = [];
    let mirrorOrders = [];
    let mirrorOrderTotal = 0;
    let mirrorDetail = null;
    let mirrorClose = null;
    let catalogStatus = null;
    let quarantineRows = [];

    const say = (text) => {
        if (destroyed) {return;}
        notice.textContent = text;
        notify(text);
    };

    const setBusy = (value) => {
        busy = value;
        el.querySelectorAll('button').forEach((button) => {button.disabled = value;});
    };

    async function action(operation, successText, reload = true) {
        if (busy || destroyed) {return;}
        setBusy(true);
        try {
            const result = await operation();
            say(successText(result));
            if (reload && !destroyed) {await loadTab();}
            return result;
        } catch (error) {
            say(error && error.message ? error.message : 'تعذر تنفيذ العملية');
            return null;
        } finally {
            if (!destroyed) {setBusy(false);}
        }
    }

    async function loadStatus() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب حالة المحرك وسجل الاستيراد…');
        try {
            const [nextStatus, nextLog] = await Promise.all([fetchYarasoftStatus(), fetchYarasoftLog()]);
            if (destroyed || tab !== 'status') {return;}
            const status = nextStatus || {};
            logRows = arr(nextLog);
            const engine = status.engine || {};
            const counts = status.logCounts || {};
            const cards = [
                ['حالة المحرك', engine.enabled ? (engine.running ? 'يعمل' : 'متوقف') : 'معطّل'],
                ['الفواتير المكتملة', counts.completed],
                ['تحتاج مراجعة', status.openReviewItems ?? counts.review],
                ['أقسام بانتظار الربط', status.openSections ?? counts.needs_mapping],
                ['الفواتير الفاشلة', counts.failed],
                ['مكررات', counts.duplicates],
            ].map(([label, value]) => `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div><div class="erp-kpi__value"><span class="erp-num">${esc(formatInt(Number(value) || 0))}</span></div></li>`).join('');
            const rows = logRows.map((entry) => `<tr>
              <td class="erp-td">${esc(String(entry.source_file || '').split(/[\\/]/).pop() || '—')}</td>
              <td class="erp-td">${esc(entry.external_invoice_number || '—')}</td>
              <td class="erp-td">${statusBadge(entry.status)}</td>
              <td class="erp-td">${formatInt(Number(entry.items_count) || 0)}</td>
              <td class="erp-td">${esc(entry.total_amount == null ? '—' : money(Number(entry.total_amount) || 0))}</td>
              <td class="erp-td">${esc(entry.error_message || '—')}</td>
              <td class="erp-td">${canWrite && ['FAILED', 'REQUIRES_REVIEW'].includes(entry.status) ? `<button type="button" class="erp-btn erp-btn--sm" data-ys-reprocess="${esc(entry.id)}">إعادة المعالجة</button>` : ''}<button type="button" class="erp-btn erp-btn--sm" data-ys-detail="${esc(entry.id)}">التفاصيل</button></td>
            </tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              <ul class="erp-kpis">${cards}</ul>
              ${engine.lastError ? `<p class="erp-state" data-tone="danger" role="alert">${esc(engine.lastError)}</p>` : ''}
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">سجل الاستيراد</h3><span class="erp-grow"></span><span class="erp-text-sm erp-text-muted">آخر ${formatInt(logRows.length)} سجل</span></div><div class="erp-card__body">${table(['الملف', 'رقم الفاتورة', 'الحالة', 'الأصناف', 'الإجمالي', 'الخطأ', 'إجراءات'], rows, 'لا توجد سجلات استيراد بعد.', 7)}</div></section>
            </div>`;
        } catch (error) {
            if (!destroyed && tab === 'status') {panel.innerHTML = stateMessage('تعذّر جلب حالة قاعدة الكاشير', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    async function loadReview() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب أصناف المراجعة غير المحسومة…');
        try {
            reviewRows = arr(await fetchYarasoftReview(true));
            if (destroyed || tab !== 'review') {return;}
            const rows = reviewRows.map((item) => `<tr data-ys-review-row="${esc(item.id)}">
              <td class="erp-td">${esc(item.external_invoice_number || '—')}</td><td class="erp-td">${esc(item.external_item_code || '—')}</td>
              <td class="erp-td">${esc(item.external_barcode || '—')}</td><td class="erp-td">${esc(item.item_name || '—')}</td>
              <td class="erp-td">${formatQty(Number(item.quantity) || 0)}</td><td class="erp-td">${esc(item.reason || '—')}</td>
              ${canWrite ? `<td class="erp-td"><div class="erp-stack erp-ys-product-picker"><label class="erp-field"><span class="erp-label">بحث عن منتج</span><input class="erp-input" data-ys-product-search="${esc(item.id)}" autocomplete="off"></label><button type="button" class="erp-btn erp-btn--sm" data-ys-product-find="${esc(item.id)}">بحث</button><select class="erp-input" data-ys-product="${esc(item.id)}" aria-label="المنتج الداخلي"><option value="">ابحث واختر منتجاً</option></select><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-resolve="${esc(item.id)}">ربط الصنف</button></div></td>` : ''}</tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              <p class="erp-text-sm erp-text-muted">لا تُطابق الأصناف تلقائياً بمنتج مختلف. اختر المنتج الداخلي الصحيح؛ بعد اكتمال ربط عناصر الفاتورة يعيد الخادم محاولة استيرادها.</p>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">أصناف المراجعة (${formatInt(reviewRows.length)})</h3><button type="button" class="erp-btn erp-btn--sm" data-ys-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الفاتورة', 'الكود الخارجي', 'الباركود', 'الصنف', 'الكمية', 'سبب المراجعة', ...(canWrite ? ['ربط المنتج'] : [])], rows, 'لا توجد أصناف معلقة للمراجعة.', canWrite ? 7 : 6)}</div></section>
            </div>`;
        } catch (error) {
            if (!destroyed && tab === 'review') {panel.innerHTML = stateMessage('تعذّر جلب أصناف المراجعة', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    async function loadSections() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب خريطة الأقسام والأسماء غير المعتمدة…');
        try {
            const [map, waiting] = await Promise.all([fetchYarasoftSectionMap(), fetchYarasoftUnmappedSections()]);
            if (destroyed || tab !== 'sections') {return;}
            sectionMap = arr(map);
            unmapped = arr(waiting);
            const waitingRows = unmapped.map((item) => `<tr data-ys-section-row="${esc(item.id)}">
              <td class="erp-td">${esc(item.src_table)}</td><td class="erp-td">${esc(item.src_name)}</td>
              <td class="erp-td">${formatInt(Number(item.invoices_count) || 0)}</td>
              <td class="erp-td">${esc(money(Number(item.total_amount) || 0))}</td>
              <td class="erp-td">${esc(item.last_seen || '—')}</td>
              <td class="erp-td">${canWrite && item.src_table !== 'BILLS4' ? `<div class="erp-stack"><label class="erp-field"><span class="erp-label">اسم العرض</span><input class="erp-input" data-ys-section-name="${esc(item.id)}" value="${esc(item.src_name)}" maxlength="255"></label><label class="erp-field"><span class="erp-label">دمج اختياري في قسم موجود</span><select class="erp-input" data-ys-merge-section="${esc(item.id)}"><option value="">إنشاء قسم مستقل</option>${sectionMap.filter((target) => target.active).map((target) => `<option value="${esc(target.id)}">${esc(target.display_ar)} (${esc(target.src_table)})</option>`).join('')}</select></label><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-approve-section="${esc(item.id)}">اعتماد وربط</button></div>` : (item.src_table === 'BILLS4' ? 'مصدر موحّد: لا يعتمد كقسم منفصل' : '—')}</td></tr>`).join('');
            const mappedRows = sectionMap.map((item) => `<tr><td class="erp-td">${esc(item.src_table)}</td><td class="erp-td">${esc(item.src_name)}</td>
              <td class="erp-td">${esc(item.display_ar || '—')}</td><td class="erp-td"><code>${esc(item.dept_code || '—')}</code></td>
              <td class="erp-td">${formatInt(Number(item.posted_count) || 0)}</td><td class="erp-td">${esc(money(Number(item.posted_total) || 0))}</td>
              <td class="erp-td">${esc(money(Number(item.posted_expenses) || 0))}</td>
              <td class="erp-td">${esc(money((Number(item.posted_total) || 0) - (Number(item.posted_expenses) || 0)))}</td>
              <td class="erp-td"><span class="erp-badge" data-tone="${item.active ? 'success' : 'neutral'}">${item.active ? 'نشط' : 'معطل'}</span></td>
              <td class="erp-td"><div class="erp-wa-actions"><button type="button" class="erp-btn erp-btn--sm" data-ys-section-invoices="${esc(item.id)}">الفواتير</button>${canWrite && item.active ? `<button type="button" class="erp-btn erp-btn--sm" data-ys-rename-toggle="${esc(item.id)}">تسمية</button><div class="erp-stack" data-ys-rename-form="${esc(item.id)}" hidden><input class="erp-input" data-ys-rename-ar value="${esc(item.display_ar)}" maxlength="255" aria-label="الاسم العربي الجديد"><input class="erp-input" data-ys-rename-en value="${esc(item.display_en || '')}" maxlength="255" aria-label="الاسم الإنجليزي"><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-rename-save="${esc(item.id)}">حفظ الاسم</button></div>` : ''}</div></td></tr>`).join('');
            const selected = sectionMap.find((item) => String(item.id) === String(selectedMapId));
            const drill = selected && sectionInvoices ? sectionInvoicesMarkup(selected) : '';
            panel.innerHTML = `<div class="erp-stack">
              <p class="erp-text-sm erp-text-muted">دخل القسم يأتي من مبيعات الكاشير CC أو البيع الخارجي BILLS4. أقسام BILLS4 موحّدة ولا تُعتمد منفصلة. نقل الفواتير يسجل التغيير في النظام وبصلاحية المدير أو مدير النظام.</p>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">أقسام بانتظار الاعتماد (${formatInt(unmapped.length)})</h3><span class="erp-grow"></span>${canWrite ? '<button type="button" class="erp-btn erp-btn--sm" data-ys-manual-toggle>إضافة قسم يدوي</button>' : ''}<button type="button" class="erp-btn erp-btn--sm" data-ys-refresh-tab>تحديث</button></div><div class="erp-card__body">
                ${canWrite ? '<div class="erp-wa-form"><label class="erp-field"><span class="erp-label">اسم القسم اليدوي</span><input class="erp-input" data-ys-manual-name maxlength="255"></label><label class="erp-field"><span class="erp-label">الاسم الإنجليزي (اختياري)</span><input class="erp-input" data-ys-manual-en maxlength="255"></label><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-manual-create>إنشاء قسم</button></div>' : ''}
                ${table(['مصدر البيانات', 'اسم القسم الوارد', 'الفواتير', 'الإجمالي', 'آخر ظهور', 'الاعتماد أو الدمج'], waitingRows, 'لا توجد أقسام معلقة.', 6)}</div></section>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">خريطة الأقسام المعتمدة (${formatInt(sectionMap.length)})</h3></div><div class="erp-card__body">${table(['المصدر', 'الاسم الوارد', 'اسم العرض', 'قسم النظام', 'الفواتير', 'الإيرادات', 'المصروفات', 'الصافي', 'الحالة', 'إجراءات'], mappedRows, 'لا توجد روابط أقسام.', 10)}</div></section>
              ${drill}
            </div>`;
        } catch (error) {
            if (!destroyed && tab === 'sections') {panel.innerHTML = stateMessage('تعذّر جلب الأقسام', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    async function loadTab() {
        if (destroyed) {return;}
        if (tab === 'status') {await loadStatus(); return;}
        if (tab === 'review') {await loadReview(); return;}
        if (tab === 'sections') {await loadSections(); return;}
        if (tab === 'mappings') {await loadMappings(); return;}
        if (tab === 'tools') {renderTools(); return;}
        if (tab === 'quality') {await loadQuality(); return;}
        if (tab === 'mirror') {await loadMirror(); return;}
        await loadOracle();
    }

    function sectionInvoicesMarkup(section) {
        const data = sectionInvoices;
        const rows = arr(data.rows).map((invoice) => `<tr>
          ${canWrite ? `<td class="erp-td"><input type="checkbox" data-ys-invoice-check value="${esc(invoice.id)}" aria-label="تحديد الفاتورة ${esc(invoice.external_ref || invoice.id)}"></td>` : ''}
          <td class="erp-td"><button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-ys-invoice-detail="${esc(invoice.external_ref || '')}"><code dir="ltr">${esc(String(invoice.external_ref || '').replace(/^ora:/, '') || invoice.id)}</code></button></td>
          <td class="erp-td">${esc(invoice.date || '—')}</td><td class="erp-td">${esc(money(Number(invoice.amount) || 0))}</td>
          <td class="erp-td">${esc(invoice.notes || '—')}</td><td class="erp-td">${invoice.import_status ? statusBadge(invoice.import_status) : '—'}</td>
        </tr>`).join('');
        const targets = sectionMap.filter((target) => target.active && String(target.id) !== String(section.id))
            .map((target) => `<option value="${esc(target.id)}">${esc(target.display_ar)} (${esc(target.src_table)})</option>`).join('');
        const detail = sectionInvoiceDetail ? `<section class="erp-card"><div class="erp-card__head"><h4 class="erp-card__title">تفاصيل ${esc(sectionInvoiceDetail.ref)}</h4><span class="erp-grow"></span><span class="erp-badge" data-tone="${sectionInvoiceDetail.live ? 'success' : 'neutral'}">${sectionInvoiceDetail.live ? 'مباشر من قاعدة الكاشير' : 'من السجل المحلي'}</span><button type="button" class="erp-btn erp-btn--sm" data-ys-close-detail>إغلاق</button></div><div class="erp-card__body">${sectionInvoiceDetail.header ? `<p class="erp-text-sm">الكاشير: ${esc(sectionInvoiceDetail.header.CSHR || '—')} · الوردية: ${esc(sectionInvoiceDetail.header.SHFT_NO || '—')} · التاريخ: ${esc(sectionInvoiceDetail.local?.date || sectionInvoiceDetail.header.DOC_DATE || '—')}</p>` : ''}${table(['الكود', 'الصنف', 'الكمية', 'الوحدة', 'السعر', 'الإجمالي', 'الضريبة'], arr(sectionInvoiceDetail.lines).map((line) => `<tr><td class="erp-td">${esc(line.code || '—')}</td><td class="erp-td">${esc(line.name || '—')}</td><td class="erp-td">${formatQty(Number(line.qty) || 0)}</td><td class="erp-td">${esc(line.unit || '—')}</td><td class="erp-td">${esc(money(Number(line.price) || 0))}</td><td class="erp-td">${esc(money(Number(line.total) || 0))}</td><td class="erp-td">${esc(money(Number(line.vat) || 0))}</td></tr>`).join(''), 'لا توجد أصناف محفوظة لهذه الفاتورة.', 7)}</div></section>` : '';
        const pages = Math.max(1, Number(data.pages) || 1);
        return `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">فواتير ${esc(section.display_ar)} (${formatInt(Number(data.total) || 0)})</h3><span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm" data-ys-close-invoices>إغلاق الفواتير</button></div>
          <div class="erp-card__body erp-stack"><div class="erp-wa-form">
            <label class="erp-field"><span class="erp-label">من تاريخ</span><input type="date" class="erp-input" data-ys-invoice-from value="${esc(data.dateFrom || '')}"></label>
            <label class="erp-field"><span class="erp-label">إلى تاريخ</span><input type="date" class="erp-input" data-ys-invoice-to value="${esc(data.dateTo || '')}"></label>
            <label class="erp-field"><span class="erp-label">بحث في رقم الفاتورة أو الملاحظات</span><input class="erp-input" data-ys-invoice-query value="${esc(data.query || '')}" maxlength="60"></label>
            <button type="button" class="erp-btn erp-btn--sm" data-ys-invoice-filter>تطبيق الفلاتر</button>
          </div>
          ${table([...(canWrite ? ['تحديد'] : []), 'المرجع', 'التاريخ', 'المبلغ', 'ملاحظات', 'حالة الاستيراد'], rows, 'لا توجد فواتير مطابقة.', canWrite ? 6 : 5)}
          <div class="erp-wa-actions"><button type="button" class="erp-btn erp-btn--sm" data-ys-page="${Math.max(1, Number(data.page) - 1)}" ${Number(data.page) <= 1 ? 'disabled' : ''}>السابق</button><span class="erp-text-sm erp-text-muted">صفحة ${formatInt(Number(data.page) || 1)} من ${formatInt(pages)}</span><button type="button" class="erp-btn erp-btn--sm" data-ys-page="${Math.min(pages, Number(data.page) + 1)}" ${Number(data.page) >= pages ? 'disabled' : ''}>التالي</button>
          ${canWrite ? `<label class="erp-field"><span class="erp-label">إعادة تصنيف المحدد</span><select class="erp-input" data-ys-reclass-target><option value="">اختر القسم المستهدف</option>${targets}</select></label><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-reclassify>نقل الفواتير المحددة</button>` : ''}</div></div></section>${detail}`;
    }

    async function loadSectionInvoices(mapId, filters = {}) {
        selectedMapId = Number(mapId);
        sectionInvoiceDetail = null;
        sectionInvoices = null;
        renderSectionLoading();
        const query = {
            page: filters.page || 1, limit: 20,
            dateFrom: filters.dateFrom || '', dateTo: filters.dateTo || '', query: filters.query || '',
        };
        try {
            const data = await fetchYarasoftSectionInvoices(selectedMapId, query);
            if (destroyed || tab !== 'sections' || selectedMapId !== Number(mapId)) {return;}
            sectionInvoices = { ...data, ...query };
            await loadSections();
        } catch (error) {
            if (!destroyed && tab === 'sections') {panel.innerHTML = stateMessage('تعذّر جلب فواتير القسم', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    function renderSectionLoading() {
        panel.insertAdjacentHTML('beforeend', stateMessage('جارٍ تحميل الفواتير', 'يتم جلب بيانات القسم…'));
    }

    async function loadMappings() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب روابط منتجات الكاشير…');
        try {
            mappings = arr(await fetchYarasoftMappings());
            if (destroyed || tab !== 'mappings') {return;}
            const rows = mappings.map((mapping) => `<tr data-ys-mapping-row="${esc(mapping.id)}">
              <td class="erp-td">${esc(mapping.external_code || '—')}</td><td class="erp-td">${esc(mapping.external_barcode || '—')}</td>
              <td class="erp-td">${esc(mapping.product_name || '—')}${mapping.product_barcode ? `<div class="erp-text-sm erp-text-muted">${esc(mapping.product_barcode)}</div>` : ''}</td>
              <td class="erp-td">${mapping.active ? statusBadge('COMPLETED') : statusBadge('DETECTED')}</td>
              <td class="erp-td">${canWrite && mapping.active ? `<button type="button" class="erp-btn erp-btn--danger erp-btn--sm" data-ys-deactivate-mapping="${esc(mapping.id)}">تعطيل الربط</button>` : '—'}</td>
            </tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              <p class="erp-text-sm erp-text-muted">ترتيب المطابقة التلقائي لدى الخادم يبدأ بالباركود ثم الكود الخارجي ثم الروابط الصريحة. التعطيل لا يحذف سجل الربط.</p>
              ${canWrite ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إضافة ربط صريح</h3></div><div class="erp-card__body"><div class="erp-wa-form">
                <label class="erp-field"><span class="erp-label">كود الكاشير</span><input class="erp-input" data-ys-map-code maxlength="120"></label>
                <label class="erp-field"><span class="erp-label">باركود الكاشير</span><input class="erp-input" data-ys-map-barcode maxlength="120"></label>
                <label class="erp-field"><span class="erp-label">بحث عن منتج المخزون</span><input class="erp-input" data-ys-map-search autocomplete="off"></label>
                <button type="button" class="erp-btn erp-btn--sm" data-ys-map-find>بحث</button>
                <label class="erp-field"><span class="erp-label">المنتج الداخلي</span><select class="erp-input" data-ys-map-product><option value="">ابحث واختر منتجاً</option></select></label>
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-map-save>حفظ الربط</button>
              </div></div></section>` : ''}
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">روابط المنتجات (${formatInt(mappings.length)})</h3><button type="button" class="erp-btn erp-btn--sm" data-ys-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['كود الكاشير', 'باركود الكاشير', 'منتج المخزون', 'الحالة', 'إجراء'], rows, 'لا توجد روابط صريحة؛ تظل المطابقة الآلية فعالة.', 5)}</div></section>
            </div>`;
        } catch (error) {
            if (!destroyed && tab === 'mappings') {panel.innerHTML = stateMessage('تعذّر جلب روابط المنتجات', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    async function loadOracle() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم فحص حالة ربط قاعدة الكاشير ومهمة المزامنة…');
        try {
            const [nextStatus, nextJob] = await Promise.all([
                fetchYarasoftOracleStatus(),
                fetchYarasoftOracleCatchUpStatus(),
            ]);
            if (destroyed || tab !== 'oracle') {return;}
            oracleStatus = nextStatus?.oracle || {};
            oracleCatchUp = nextJob?.job || {};
            const connection = oracleStatus;
            const job = oracleCatchUp;
            const flag = (value) => value ? 'مضبوط' : 'غير مضبوط';
            const reconcileRows = arr(oracleReconcile?.rows).map((row) => `<tr>
              <td class="erp-td">${esc(row.day)}</td><td class="erp-td">${formatInt(Number(row.ora_cc) || 0)}</td>
              <td class="erp-td">${formatInt(Number(row.ora_b4) || 0)}</td><td class="erp-td">${formatInt(Number(row.local_count) || 0)}</td>
              <td class="erp-td">${row.status === 'ok' ? '<span class="erp-badge" data-tone="success">متطابق ضمن هامش الخادم</span>' : '<span class="erp-badge" data-tone="warning">فرق للمراجعة</span>'}</td>
            </tr>`).join('');
            const preview = oracleItemPreview ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">معاينة استيراد دليل الأصناف</h3><span class="erp-grow"></span>${statusBadge(oracleItemPreview.ok === false ? 'FAILED' : 'COMPLETED')}</div><div class="erp-card__body">
              ${oracleItemPreview.ok === false ? stateMessage('تعذرت المعاينة', oracleItemPreview.error || 'تعذر قراءة قائمة الأصناف.', 'danger') : `<p>الإجمالي: ${formatInt(Number(oracleItemPreview.total) || 0)} · أصناف جديدة: ${formatInt(Number(oracleItemPreview.fresh) || 0)} · موجودة/متخطاة: ${formatInt(Number(oracleItemPreview.skipped) || 0)} · مجموعات مستبعدة: ${formatInt(Number(oracleItemPreview.groups) || 0)}</p>${canWrite && Number(oracleItemPreview.fresh) > 0 ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-oracle-import>استيراد الأصناف الجديدة فقط</button>' : ''}`}</div></section>` : '';
            panel.innerHTML = `<div class="erp-stack">
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">اتصال قاعدة الكاشير</h3><span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm" data-ys-refresh-tab>تحديث الحالة</button></div><div class="erp-card__body">
                <ul class="erp-kpis">
                  <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">المزامنة مفعلة</span></div><div class="erp-kpi__value">${connection.enabled ? 'نعم' : 'لا'}</div></li>
                  <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">برنامج التشغيل</span></div><div class="erp-kpi__value">${connection.driver === null ? 'لم يُفحص' : connection.driver ? 'متاح' : 'غير متاح'}</div></li>
                  <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">حالة العامل</span></div><div class="erp-kpi__value">${connection.running ? 'يعمل' : 'متوقف'}</div></li>
                  <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">عناصر بالانتظار</span></div><div class="erp-kpi__value">${formatInt(Number(connection.stagedTotal) || 0)}</div></li>
                </ul>
                <p class="erp-text-sm">الخادم: <bdi dir="ltr">${esc(connection.host || '—')}:${esc(connection.port || '—')}/${esc(connection.service || '—')}</bdi> · اسم المستخدم ${flag(connection.hasUser)} · بيانات الاعتماد ${flag(connection.hasPassword)} · SQL ${flag(connection.hasSql)} · آخر نجاح: ${esc(connection.lastOk || 'لا يوجد')}</p>
                ${connection.lastError ? stateMessage('آخر خطأ اتصال', connection.lastError, 'danger') : ''}
                <div class="erp-wa-actions">${canWrite ? '<button type="button" class="erp-btn erp-btn--sm" data-ys-oracle-test>فحص الاتصال</button><button type="button" class="erp-btn erp-btn--sm" data-ys-oracle-poll>سحب الآن</button><button type="button" class="erp-btn erp-btn--sm" data-ys-oracle-preview>معاينة استيراد الأصناف</button>' : ''}</div>
              </div></section>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">مقارنة المزامنة</h3><span class="erp-grow"></span><label class="erp-field"><span class="erp-label">الفترة بالأيام</span><input type="number" class="erp-input" data-ys-oracle-days value="14" min="1" max="90"></label><button type="button" class="erp-btn erp-btn--sm" data-ys-oracle-reconcile>مقارنة الآن</button>${canWrite ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-oracle-catchup>بدء اللحاق بالفجوات</button>' : ''}</div>
                <div class="erp-card__body erp-stack">${oracleReconcile ? `<p>${oracleReconcile.overall === 'ok' ? '<span class="erp-badge" data-tone="success">المقارنة ضمن هامش التفاوت المعتمد بالخادم</span>' : '<span class="erp-badge" data-tone="warning">توجد فجوات حسب نتيجة الخادم</span>'} · قاعدة الكاشير: ${formatInt(Number(oracleReconcile.totalOra) || 0)} · محلي: ${formatInt(Number(oracleReconcile.totalLocal) || 0)} · ${formatInt(Number(oracleReconcile.days) || 0)} يوم</p>${table(['اليوم', 'فواتير CC', 'فواتير BILLS4', 'محلي', 'النتيجة'], reconcileRows, 'لا توجد بيانات مقارنة.', 5)}` : stateMessage('المقارنة لم تُشغّل', 'شغّل المقارنة لطلب النتيجة المباشرة من الخادم.')}
                  <p class="erp-text-sm erp-text-muted">حالة مهمة اللحاق: ${job.running ? 'قيد التنفيذ' : job.finishedAt ? `انتهت ${esc(job.finishedAt)}` : 'لا توجد مهمة'} · أُرسلت ${formatInt(Number(job.posted) || 0)} · مكررات ${formatInt(Number(job.dups) || 0)}${job.error ? ` · ${esc(job.error)}` : ''}</p></div>
              </section>${preview}</div>`;
        } catch (error) {
            if (!destroyed && tab === 'oracle') {panel.innerHTML = stateMessage('تعذّر جلب حالة قاعدة الكاشير', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    function quarantineRowHtml(row) {
        return `<tr>
          <td class="erp-td"><span class="erp-badge" data-tone="warning">${esc(row.kind || '—')}</span></td>
          <td class="erp-td"><code dir="ltr">${esc(row.ref_code || '—')}</code></td>
          <td class="erp-td">${row.qty == null ? '—' : formatQty(Number(row.qty) || 0)}</td>
          <td class="erp-td">${row.value_amount == null ? '—' : money(Number(row.value_amount) || 0)}</td>
          <td class="erp-td">${row.unit_cost == null ? '—' : money(Number(row.unit_cost) || 0)}</td>
          <td class="erp-td">${esc(row.reason || '—')}</td>
        </tr>`;
    }

    function paintQuarantine(query = '') {
        const body = panel.querySelector('[data-ys-quarantine-body]');
        if (!body) {return;}
        const needle = String(query || '').trim().toLowerCase();
        const rows = quarantineRows.filter((row) => !needle || [row.kind, row.ref_code, row.reason]
            .some((value) => String(value || '').toLowerCase().includes(needle)));
        body.innerHTML = rows.map(quarantineRowHtml).join('')
            || `<tr><td colspan="6" class="erp-td erp-text-muted">${needle ? 'لا نتائج مطابقة للبحث.' : 'لا توجد بنود في الحجر — البيانات متسقة.'}</td></tr>`;
        const counter = panel.querySelector('[data-ys-quarantine-count]');
        if (counter) {counter.textContent = formatInt(rows.length);}
    }

    function handleInput(event) {
        const input = event.target?.closest?.('[data-ys-quality-search]');
        if (input) {paintQuarantine(input.value);}
    }

    async function loadQuality() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم فحص دليل الأصناف وقائمة بنود الحجر…');
        try {
            const [catalog, quarantine] = await Promise.all([
                fetchYarasoftCatalogStatus(),
                fetchYarasoftQuarantine().catch(() => []),
            ]);
            if (destroyed || tab !== 'quality') {return;}
            catalogStatus = catalog && typeof catalog === 'object' ? catalog : {};
            quarantineRows = arr(Array.isArray(quarantine) ? quarantine : quarantine?.rows);
            const catalogData = catalogStatus;
            const purchases = catalogData.purchases || {};
            const quarantinedValue = quarantineRows.reduce((sum, row) => sum + (Number(row.value_amount) || 0), 0);
            panel.innerHTML = `<div class="erp-stack">
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">جودة بيانات قاعدة الكاشير</h3><span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm" data-ys-refresh-tab>تحديث</button></div>
                <div class="erp-card__body erp-stack">
                  <p class="erp-text-sm erp-text-muted">مؤشرات قراءة فقط من دليل الأصناف في قاعدة الكاشير. البنود التي يتعذر ترحيلها تُحجز هنا بدل إسقاطها بصمت؛ راجعها ثم أعد معالجة الفواتير من تبويب الحالة.</p>
                  <ul class="erp-kpis">
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">أصناف بكمية</span></div><div class="erp-kpi__value">${formatInt(Number(catalogData.withQty) || 0)}</div></li>
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">أصناف بكمية صفر</span></div><div class="erp-kpi__value">${formatInt(Number(catalogData.zeroQty) || 0)}</div></li>
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">فواتير شراء</span></div><div class="erp-kpi__value">${formatInt(Number(purchases.n) || 0)}</div></li>
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">قيمة المشتريات</span></div><div class="erp-kpi__value">${money(Number(purchases.t) || 0)}</div></li>
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">عملاء / أصول</span></div><div class="erp-kpi__value">${formatInt(Number(catalogData.customers) || 0)} / ${formatInt(Number(catalogData.assets) || 0)}</div></li>
                    <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">بنود الحجر (قيمة)</span></div><div class="erp-kpi__value">${formatInt(quarantineRows.length)} · ${money(quarantinedValue)}</div></li>
                  </ul>
                  ${canWrite ? `<div class="erp-wa-actions">
                    <button type="button" class="erp-btn erp-btn--sm" data-ys-quality-organize>تنظيم الأقسام من دليل الكاشير</button>
                    <button type="button" class="erp-btn erp-btn--sm" data-ys-quality-sync>مزامنة الأرصدة (دون تجاوز)</button>
                    <button type="button" class="erp-btn erp-btn--sm" data-ys-quality-sync-force>مزامنة إجبارية</button>
                  </div>` : stateMessage('التنفيذ مقصور على الإدارة', 'يلزم دور admin أو manager لتنظيم الأقسام أو مزامنة الأرصدة.')}
                </div></section>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">بنود الحجر (<span data-ys-quarantine-count>${formatInt(quarantineRows.length)}</span>)</h3><span class="erp-grow"></span>
                <label class="erp-field"><span class="erp-label">بحث</span><input type="search" class="erp-input" data-ys-quality-search placeholder="نوع، مرجع، سبب…" autocomplete="off"></label></div>
                <div class="erp-card__body">${table(['النوع', 'المرجع', 'الكمية', 'القيمة', 'تكلفة الوحدة', 'السبب'], quarantineRows.map(quarantineRowHtml).join(''), 'لا توجد بنود في الحجر — البيانات متسقة.', 6)}</div>
              </section></div>`;
            const body = panel.querySelector('.erp-table__grid tbody');
            if (body) {body.setAttribute('data-ys-quarantine-body', '');}
        } catch (error) {
            if (!destroyed && tab === 'quality') {panel.innerHTML = stateMessage('تعذّر جلب جودة بيانات قاعدة الكاشير', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    function renderTools() {
        const result = invoicePreview;
        const invoice = result?.parsed?.invoices?.[0] || {};
        const matching = invoice.matching || {};
        const resolved = arr(matching.resolved);
        const unresolved = arr(matching.unmapped);
        const unresolvedRows = unresolved.map((item) => `<tr><td class="erp-td">${esc(item.name || item.code || '—')}</td><td class="erp-td">${esc(item.code || '—')}</td><td class="erp-td">${esc(item.barcode || '—')}</td><td class="erp-td">${esc(item.reason || '—')}</td></tr>`).join('');
        const resolvedRows = resolved.map((item) => `<tr><td class="erp-td">${esc(item.item || '—')}</td><td class="erp-td">${esc(item.product || '—')}</td><td class="erp-td"><code>${esc(item.productId || '—')}</code></td><td class="erp-td">${esc(item.via || '—')}</td></tr>`).join('');
        const preview = result ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">نتيجة المعاينة — ${esc(result.parsed?.kind || 'صيغة غير معروفة')}</h3></div><div class="erp-card__body erp-stack">
          ${result.parsed?.invoices?.length ? `<p>الفاتورة: ${esc(invoice.invoiceNumber || 'لم يُكتشف الرقم')} · التاريخ: ${esc(invoice.date || '—')} · طريقة الدفع: ${esc(invoice.paymentMethod || '—')} · عدد الأصناف: ${formatInt(arr(invoice.items).length)}</p>
          <ul class="erp-kpis"><li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">مطابق</span></div><div class="erp-kpi__value">${formatInt(resolved.length)}</div></li><li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">بحاجة ربط</span></div><div class="erp-kpi__value">${formatInt(unresolved.length)}</div></li></ul>
          ${table(['الصنف الخارجي', 'المنتج الداخلي', 'معرّف المنتج', 'طريقة المطابقة'], resolvedRows, 'لم تُطابق أصناف.', 4)}
          ${table(['الصنف', 'الكود', 'الباركود', 'سبب عدم المطابقة'], unresolvedRows, 'جميع الأصناف لها تطابق.', 4)}` : stateMessage('لم يُكتشف أي فاتورة', 'تحقق من محتوى الملف وملف تعريف التنسيق.')}
          ${result.suggestedProfile ? `<details><summary>ملف تعريف مقترح (للمراجعة فقط)</summary><pre dir="ltr">${esc(JSON.stringify(result.suggestedProfile, null, 2))}</pre></details>` : ''}
        </div></section>` : '';
        panel.innerHTML = `<div class="erp-stack"><div class="erp-card"><div class="erp-card__body erp-stack">
          <p>أداة تحليل ومطابقة قراءة فقط. المحتوى يُرسل إلى خادم النظام لتحليله ومقارنته بالمخزون؛ لا تُرحّل فواتير ولا تُعدّل بيانات المخزون.</p>
          ${canWrite ? `<label class="erp-field"><span class="erp-label">محتوى ملف الفاتورة (حد الخادم 2 ميغابايت)</span><textarea class="erp-input erp-ys-preview-text" data-ys-preview-text rows="10" dir="ltr" spellcheck="false" placeholder="InvoiceNo;Date;ItemCode;Qty;Price...">${esc(result?.source || '')}</textarea></label><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-ys-preview-run>حلّل وطابق دون ترحيل</button>` : stateMessage('الأداة مقصورة على الإدارة', 'يلزم دور admin أو manager لتشغيل المعاينة.')}
        </div></div>${preview}</div>`;
    }

    async function loadMirror() {
        panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب ملخص المرآة وقائمة الأوردرات…');
        try {
            const [cashierData, orderData] = await Promise.all([
                fetchYarasoftMirrorCashiers(mirrorDate),
                fetchYarasoftMirrorOrders({ date: mirrorDate, cashier: mirrorCashier, limit: 50, offset: mirrorOffset }),
            ]);
            if (destroyed || tab !== 'mirror') {return;}
            mirrorDate = cashierData.date || orderData.date || mirrorDate;
            mirrorCashiers = arr(cashierData.cashiers);
            mirrorOrders = arr(orderData.orders);
            mirrorOrderTotal = Number(orderData.total) || 0;
            const cards = mirrorCashiers.map((cashier) => `<button type="button" class="erp-kpi erp-ys-mirror-card" data-ys-mirror-cashier="${esc(cashier.cashier_no)}" aria-pressed="${String(mirrorCashier === cashier.cashier_no)}">
              <span class="erp-kpi__label">كاشير ${esc(cashier.cashier_no)}</span><span class="erp-kpi__value">${esc(money(Number(cashier.revenue) || 0))}</span>
              <span class="erp-text-sm">${formatInt(Number(cashier.invoices) || 0)} فاتورة · آخر حركة ${esc(cashier.last_time || '—')}</span></button>`).join('');
            const rows = mirrorOrders.map((order) => `<tr>
              <td class="erp-td"><button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-ys-mirror-detail="${esc(order.doc_no)}"><code dir="ltr">${esc(order.doc_no)}</code></button></td>
              <td class="erp-td">${esc(order.doc_time || '—')}</td><td class="erp-td">${esc(order.cashier_no || '—')}</td>
              <td class="erp-td">${esc(money(Number(order.total) || 0))}</td><td class="erp-td">${esc(money(Number(order.payed) || 0))}</td>
              <td class="erp-td">${formatInt(Number(order.lines_count) || 0)}</td><td class="erp-td">${esc(order.table_name || order.zone_name || '—')}</td></tr>`).join('');
            const detail = mirrorDetail ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">الأوردر ${esc(mirrorDetail.doc_no)}</h3><span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-close-detail>إغلاق</button></div><div class="erp-card__body">
              <p>الكاشير ${esc(mirrorDetail.cashier_no || '—')} · التاريخ ${esc(mirrorDetail.doc_date || '—')} ${esc(mirrorDetail.doc_time || '')} · الإجمالي ${esc(money(Number(mirrorDetail.total) || 0))} · الصافي ${esc(money(Number(mirrorDetail.net) || 0))}</p>
              ${table(['كود الصنف', 'الصنف', 'الكمية', 'السعر', 'الإجمالي'], arr(mirrorDetail.lines).map((line) => `<tr><td class="erp-td">${esc(line.code || '—')}</td><td class="erp-td">${esc(line.name || '—')}</td><td class="erp-td">${formatQty(Number(line.qty) || 0)}</td><td class="erp-td">${esc(money(Number(line.price) || 0))}</td><td class="erp-td">${esc(money(Number(line.total) || 0))}</td></tr>`).join(''), 'لا توجد تفاصيل أصناف محفوظة.', 5)}</div></section>` : '';
            const close = mirrorClose ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">تقفيل كاشير ${esc(mirrorClose.cashier_no)} · ${esc(mirrorClose.date)}</h3><span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-close-summary>إخفاء التقفيل</button></div><div class="erp-card__body erp-stack">
              <ul class="erp-kpis">${[['الإجمالي', mirrorClose.gross], ['الخصم', mirrorClose.discount], ['الضريبة', mirrorClose.vat], ['الصافي', mirrorClose.net], ['المدفوع', mirrorClose.payed], ['المتبقي', mirrorClose.open]].map(([label, value]) => `<li class="erp-kpi"><span class="erp-kpi__label">${esc(label)}</span><span class="erp-kpi__value">${esc(money(Number(value) || 0))}</span></li>`).join('')}</ul>
              <p>نقدي ${esc(money(Number(mirrorClose.pay_split?.cash) || 0))} · شبكة ${esc(money(Number(mirrorClose.pay_split?.network) || 0))} · آجل ${esc(money(Number(mirrorClose.pay_split?.credit) || 0))} · جوال ${esc(money(Number(mirrorClose.pay_split?.mobile) || 0))} · متوسط الفاتورة ${esc(money(Number(mirrorClose.avg) || 0))}</p>
              ${table(['الساعة', 'الفواتير', 'الإيراد'], Object.entries(mirrorClose.by_hour || {}).map(([hour, item]) => `<tr><td class="erp-td">${esc(hour)}</td><td class="erp-td">${formatInt(Number(item.invoices) || 0)}</td><td class="erp-td">${esc(money(Number(item.revenue) || 0))}</td></tr>`).join(''), 'لا توجد حركات بالساعة.', 3)}
              ${table(['الصنف', 'الكمية', 'الإجمالي'], arr(mirrorClose.top_items).map((item) => `<tr><td class="erp-td">${esc(item.name || '—')}</td><td class="erp-td">${formatQty(Number(item.qty) || 0)}</td><td class="erp-td">${esc(money(Number(item.total) || 0))}</td></tr>`).join(''), 'لا توجد أصناف مسجلة.', 3)}
            </div></section>` : '';
            const previous = mirrorOffset > 0 ? `<button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-offset="${Math.max(0, mirrorOffset - 50)}">السابق</button>` : '';
            const next = mirrorOffset + mirrorOrders.length < mirrorOrderTotal ? `<button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-offset="${mirrorOffset + 50}">التالي</button>` : '';
            panel.innerHTML = `<div class="erp-stack">
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">ملخص المرآة الحية</h3><span class="erp-grow"></span><label class="erp-field"><span class="erp-label">التاريخ</span><input type="date" class="erp-input" data-ys-mirror-date value="${esc(mirrorDate)}"></label><button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-date-load>عرض اليوم</button>${canWrite ? '<button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-refresh>تحديث من المصدر</button>' : ''}</div><div class="erp-card__body erp-stack">
                <div class="erp-wa-actions"><button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-cashier="">كل الكاشيرات</button>${mirrorCashiers.map((cashier) => `<button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-cashier="${esc(cashier.cashier_no)}">كاشير ${esc(cashier.cashier_no)}</button>`).join('')}</div>
                <div class="erp-ys-mirror-grid">${cards}</div>
              </div></section>
              <section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">الأوردرات ${mirrorCashier ? `— كاشير ${esc(mirrorCashier)}` : ''}</h3><span class="erp-grow"></span>${mirrorCashier ? `<button type="button" class="erp-btn erp-btn--sm" data-ys-mirror-close-load>تقفيل الكاشير المحدد</button>` : ''}<span class="erp-text-sm erp-text-muted">${formatInt(mirrorOrderTotal)} أوردر</span></div><div class="erp-card__body">${table(['رقم الأوردر', 'الوقت', 'الكاشير', 'الإجمالي', 'المدفوع', 'الأصناف', 'الموقع'], rows, 'لا توجد أوردرات في المرآة لهذا اليوم أو الكاشير.', 7)}<div class="erp-wa-actions">${previous}<span class="erp-text-sm erp-text-muted">عرض ${formatInt(mirrorOffset + (mirrorOrders.length ? 1 : 0))}–${formatInt(mirrorOffset + mirrorOrders.length)} من ${formatInt(mirrorOrderTotal)}</span>${next}</div></div></section>
              ${detail}${close}
            </div>`;
        } catch (error) {
            if (!destroyed && tab === 'mirror') {panel.innerHTML = stateMessage('تعذّر تحميل مرآة الكاشيرية', error?.message || 'خطأ غير معروف', 'danger');}
        }
    }

    async function findProducts(button) {
        if (!canWrite || busy) {return;}
        const id = button.dataset.ysProductFind;
        const row = panel.querySelector(`[data-ys-review-row="${id}"]`);
        const query = row?.querySelector(`[data-ys-product-search="${id}"]`)?.value.trim();
        if (!query || query.length < 2) {say('اكتب حرفين على الأقل للبحث عن المنتج.'); return;}
        button.disabled = true;
        try {
            const result = await searchYarasoftProducts(query);
            if (destroyed || !row?.isConnected) {return;}
            const select = row.querySelector(`[data-ys-product="${id}"]`);
            const products = arr(result.rows);
            select.innerHTML = '<option value="">اختر المنتج الصحيح</option>' + products.map((product) => `<option value="${esc(product.id)}">${esc(product.name)}${product.barcode ? ` — ${esc(product.barcode)}` : ''}</option>`).join('');
            if (result.truncated) {say('نتائج البحث كثيرة؛ أضف تفاصيل أكثر للاسم لتضييق القائمة.');}
            if (!products.length) {say('لم يعثر البحث على منتجات مطابقة.');}
        } catch (error) {
            if (!destroyed) {say(error?.message || 'تعذّر البحث عن المنتجات.');}
        } finally {
            if (button.isConnected && !destroyed) {button.disabled = false;}
        }
    }

    async function findMappingProducts(button) {
        const query = panel.querySelector('[data-ys-map-search]')?.value.trim();
        if (!query || query.length < 2) {say('اكتب حرفين على الأقل للبحث عن المنتج.'); return;}
        button.disabled = true;
        try {
            const result = await searchYarasoftProducts(query);
            if (destroyed || tab !== 'mappings') {return;}
            const select = panel.querySelector('[data-ys-map-product]');
            select.innerHTML = '<option value="">اختر المنتج الداخلي</option>' + arr(result.rows)
                .map((product) => `<option value="${esc(product.id)}">${esc(product.name)}${product.barcode ? ` — ${esc(product.barcode)}` : ''}</option>`).join('');
            if (result.truncated) {say('نتائج البحث كثيرة؛ أضف تفاصيل أكثر للاسم لتضييق القائمة.');}
            else if (!arr(result.rows).length) {say('لم يعثر البحث على منتجات مطابقة.');}
        } catch (error) {
            if (!destroyed) {say(error?.message || 'تعذّر البحث عن المنتجات.');}
        } finally {
            if (button.isConnected && !destroyed) {button.disabled = false;}
        }
    }

    async function showSectionInvoiceDetail(ref, button) {
        if (!ref) {say('مرجع الفاتورة غير متاح.'); return;}
        button.disabled = true;
        try {
            const result = await fetchYarasoftSectionInvoiceDetail(ref);
            if (destroyed || tab !== 'sections') {return;}
            sectionInvoiceDetail = { ...result, ref };
            await loadSections();
        } catch (error) {
            if (!destroyed) {say(error?.message || 'تعذّر جلب تفاصيل الفاتورة.');}
        } finally {
            if (button.isConnected && !destroyed) {button.disabled = false;}
        }
    }

    async function handleClick(event) {
        const button = event.target.closest('button');
        if (!button || !el.contains(button) || destroyed) {return;}
        if (button.dataset.ysTab) {
            tab = button.dataset.ysTab;
            el.querySelectorAll('[data-ys-tab]').forEach((item) => item.setAttribute('aria-selected', String(item === button)));
            await loadTab();
            return;
        }
        if (button.hasAttribute('data-ys-reload') || button.hasAttribute('data-ys-refresh-tab')) {await loadTab(); return;}
        if (button.hasAttribute('data-ys-quality-organize')) {
            if (!canWrite) {return;}
            if (!confirmFn('تنظيم أقسام الأصناف من دليل الكاشير؟ قد تُعاد تسمية أقسام موجودة وفق الدليل.')) {return;}
            await action(organizeYarasoftCategories, (result) => (result && result.ok
                ? `تم التنظيم: ${formatInt(Number(result.categorized) || 0)} صنف في ${formatInt(Number(result.groups) || 0)} مجموعة (سليم ${formatInt(Number(result.alreadyOk) || 0)} · غير مربوط ${formatInt(Number(result.unmapped) || 0)}).`
                : (result?.error || 'تعذر تنظيم الأقسام.')));
            return;
        }
        if (button.hasAttribute('data-ys-quality-sync') || button.hasAttribute('data-ys-quality-sync-force')) {
            if (!canWrite) {return;}
            const force = button.hasAttribute('data-ys-quality-sync-force');
            if (!confirmFn(force
                ? 'مزامنة إجبارية تتجاوز حماية الأصناف المعدّلة محليًا. متابعة؟'
                : 'مزامنة أرصدة الأصناف غير المعدّلة محليًا من قاعدة الكاشير؟')) {return;}
            await action(() => syncYarasoftBalances(force), (result) => (result && result.ok
                ? `تمت المزامنة: ${formatInt(Number(result.applied) || 0)} مطبّق · ${formatInt(Number(result.quarantined) || 0)} محجوز · ${formatInt(Number(result.unmapped) || 0)} غير مربوط.`
                : (result?.error || 'تعذرت مزامنة الأرصدة.')));
            return;
        }
        if (button.hasAttribute('data-ys-run')) {
            await action(runYarasoftNow, () => 'تم تشغيل دورة الفحص؛ راجع سجل الاستيراد.');
            return;
        }
        if (button.dataset.ysReprocess) {
            if (!canWrite) {return;}
            await action(() => reprocessYarasoftInvoice(button.dataset.ysReprocess), (result) => result.message || 'أُعيد فتح الفاتورة للمعالجة.');
            return;
        }
        if (button.dataset.ysDetail) {
            button.disabled = true;
            try {
                const detail = await fetchYarasoftInvoiceDetail(button.dataset.ysDetail);
                if (destroyed || !button.isConnected) {return;}
                const row = button.closest('tr');
                let details = row.querySelector('[data-ys-invoice-detail]');
                if (!details) {
                    details = document.createElement('tr');
                    details.dataset.ysInvoiceDetail = '';
                    row.after(details);
                }
                const items = arr(detail.payload?.items);
                const detailRows = items.map((item) => `<tr><td class="erp-td">${esc(item.name || item.externalCode || '—')}</td><td class="erp-td">${esc(item.externalCode || '—')}</td><td class="erp-td">${formatQty(Number(item.quantity) || 0)}</td><td class="erp-td">${esc(money(Number(item.total) || 0))}</td></tr>`).join('');
                details.innerHTML = `<td class="erp-td" colspan="7"><div class="erp-stack"><strong>${esc(detail.external_invoice_number || 'تفاصيل الفاتورة')}</strong>${table(['الصنف', 'الكود', 'الكمية', 'الإجمالي'], detailRows, 'لا توجد تفاصيل أصناف محفوظة.', 4)}</div></td>`;
            } catch (error) {
                say(error?.message || 'تعذّر تحميل تفاصيل الفاتورة.');
            } finally {
                if (button.isConnected && !destroyed) {button.disabled = false;}
            }
            return;
        }
        if (button.dataset.ysProductFind) {await findProducts(button); return;}
        if (button.dataset.ysResolve) {
            if (!canWrite) {return;}
            const row = panel.querySelector(`[data-ys-review-row="${button.dataset.ysResolve}"]`);
            const productId = Number(row?.querySelector(`[data-ys-product="${button.dataset.ysResolve}"]`)?.value);
            if (!productId) {say('ابحث واختر المنتج الداخلي قبل الربط.'); return;}
            const item = reviewRows.find((entry) => String(entry.id) === button.dataset.ysResolve);
            if (!confirmFn(`ربط "${item?.item_name || 'الصنف'}" بالمنتج المحدد؟ عند اكتمال ربط الفاتورة سيعيد الخادم محاولة استيرادها.`)) {return;}
            await action(() => resolveYarasoftReview(button.dataset.ysResolve, productId), (result) => result.message || 'تم حفظ ربط الصنف وإعادة تقييم الفاتورة.');
            return;
        }
        if (button.dataset.ysApproveSection) {
            if (!canWrite) {return;}
            const row = panel.querySelector(`[data-ys-section-row="${button.dataset.ysApproveSection}"]`);
            const displayAr = row?.querySelector(`[data-ys-section-name="${button.dataset.ysApproveSection}"]`)?.value.trim();
            const mergeMapId = row?.querySelector(`[data-ys-merge-section="${button.dataset.ysApproveSection}"]`)?.value;
            const section = unmapped.find((entry) => String(entry.id) === button.dataset.ysApproveSection);
            if (!mergeMapId && !displayAr) {say('اسم العرض مطلوب.'); return;}
            const target = sectionMap.find((item) => String(item.id) === String(mergeMapId));
            const targetText = target ? ` ودمجه في "${target.display_ar}"` : '';
            if (!confirmFn(`اعتماد "${section?.src_name}"${targetText}؟ سيعيد الخادم معالجة الفواتير المعلقة لهذا القسم.`)) {return;}
            await action(() => approveYarasoftSection(button.dataset.ysApproveSection, { displayAr, mergeMapId }), (result) => `تم اعتماد القسم. أُعيدت معالجة ${formatInt(Number(result.reopenedInvoices) || 0)} فاتورة.`);
            return;
        }
        if (button.dataset.ysSectionInvoices) {
            await loadSectionInvoices(button.dataset.ysSectionInvoices);
            return;
        }
        if (button.hasAttribute('data-ys-close-invoices')) {
            selectedMapId = null;
            sectionInvoices = null;
            sectionInvoiceDetail = null;
            await loadSections();
            return;
        }
        if (button.hasAttribute('data-ys-invoice-filter')) {
            await loadSectionInvoices(selectedMapId, {
                dateFrom: panel.querySelector('[data-ys-invoice-from]')?.value || '',
                dateTo: panel.querySelector('[data-ys-invoice-to]')?.value || '',
                query: panel.querySelector('[data-ys-invoice-query]')?.value || '',
            });
            return;
        }
        if (button.dataset.ysPage) {
            await loadSectionInvoices(selectedMapId, {
                page: Number(button.dataset.ysPage),
                dateFrom: sectionInvoices.dateFrom,
                dateTo: sectionInvoices.dateTo,
                query: sectionInvoices.query,
            });
            return;
        }
        if (button.dataset.ysInvoiceDetail) {
            await showSectionInvoiceDetail(button.dataset.ysInvoiceDetail, button);
            return;
        }
        if (button.hasAttribute('data-ys-close-detail')) {
            sectionInvoiceDetail = null;
            await loadSections();
            return;
        }
        if (button.hasAttribute('data-ys-reclassify')) {
            if (!canWrite) {return;}
            const ids = [...panel.querySelectorAll('[data-ys-invoice-check]:checked')]
                .map((input) => Number(input.value)).filter((id) => Number.isInteger(id) && id > 0);
            const toMapId = Number(panel.querySelector('[data-ys-reclass-target]')?.value);
            const target = sectionMap.find((item) => Number(item.id) === toMapId);
            if (!ids.length || !target) {say('حدد فاتورة واحدة على الأقل واختر القسم المستهدف.'); return;}
            if (!confirmFn(`نقل ${formatInt(ids.length)} فاتورة إلى "${target.display_ar}"؟ سيغيّر ذلك تصنيف الإيراد المسجل.`)) {return;}
            const result = await action(() => reclassifyYarasoftRevenue(ids, toMapId), (response) => `نُقلت ${formatInt(Number(response.moved) || 0)} فاتورة إلى ${response.to_name || target.display_ar}.`, false);
            if (result && !destroyed) {
                await loadSectionInvoices(selectedMapId, {
                    page: 1,
                    dateFrom: sectionInvoices.dateFrom,
                    dateTo: sectionInvoices.dateTo,
                    query: sectionInvoices.query,
                });
            }
            return;
        }
        if (button.hasAttribute('data-ys-manual-toggle')) {
            panel.querySelector('[data-ys-manual-name]')?.focus();
            return;
        }
        if (button.hasAttribute('data-ys-manual-create')) {
            if (!canWrite) {return;}
            const displayAr = panel.querySelector('[data-ys-manual-name]')?.value.trim();
            const displayEn = panel.querySelector('[data-ys-manual-en]')?.value.trim();
            if (!displayAr) {say('أدخل اسم القسم اليدوي.'); return;}
            if (!confirmFn(`إنشاء قسم إيرادات يدوي باسم "${displayAr}"؟`)) {return;}
            await action(() => createYarasoftManualSection({ displayAr, displayEn }), (result) => `أُنشئ القسم "${result.displayAr}".`);
            return;
        }
        if (button.dataset.ysRenameToggle) {
            const editor = panel.querySelector(`[data-ys-rename-form="${button.dataset.ysRenameToggle}"]`);
            if (editor) {editor.hidden = !editor.hidden;}
            return;
        }
        if (button.dataset.ysRenameSave) {
            if (!canWrite) {return;}
            const section = sectionMap.find((item) => String(item.id) === button.dataset.ysRenameSave);
            const editor = panel.querySelector(`[data-ys-rename-form="${button.dataset.ysRenameSave}"]`);
            const cleaned = editor?.querySelector('[data-ys-rename-ar]')?.value.trim();
            if (!cleaned) {say('اسم العرض مطلوب.'); return;}
            const displayEn = editor?.querySelector('[data-ys-rename-en]')?.value.trim() || '';
            if (!confirmFn(`تحديث اسم القسم "${section?.display_ar}" إلى "${cleaned}"؟ سيحدّث الخادم اسم القسم والإيرادات المرتبطة به.`)) {return;}
            await action(() => renameYarasoftSection(button.dataset.ysRenameSave, { displayAr: cleaned, displayEn }), () => 'تم تحديث اسم القسم والإيرادات المرتبطة به.');
            return;
        }
        if (button.hasAttribute('data-ys-map-find')) {
            if (canWrite) {await findMappingProducts(button);}
            return;
        }
        if (button.hasAttribute('data-ys-map-save')) {
            if (!canWrite) {return;}
            const externalCode = panel.querySelector('[data-ys-map-code]')?.value.trim();
            const externalBarcode = panel.querySelector('[data-ys-map-barcode]')?.value.trim();
            const internalProductId = Number(panel.querySelector('[data-ys-map-product]')?.value);
            if (!externalCode && !externalBarcode) {say('أدخل كود الكاشير أو باركوداً واحداً على الأقل.'); return;}
            if (!internalProductId) {say('ابحث واختر المنتج الداخلي أولاً.'); return;}
            if (!confirmFn(`ربط الكود "${externalCode || '—'}" والباركود "${externalBarcode || '—'}" بالمنتج المحدد؟ سيؤثر الربط على المطابقة الحالية واللاحقة.`)) {return;}
            await action(() => saveYarasoftMapping({ externalCode, externalBarcode, internalProductId }), () => 'تم حفظ الربط الصريح.');
            return;
        }
        if (button.dataset.ysDeactivateMapping) {
            if (!canWrite) {return;}
            const mapping = mappings.find((item) => String(item.id) === button.dataset.ysDeactivateMapping);
            if (!confirmFn(`تعطيل ربط "${mapping?.external_code || mapping?.external_barcode || 'المنتج'}"؟ لن يُحذف سجل الربط.`)) {return;}
            await action(() => deactivateYarasoftMapping(button.dataset.ysDeactivateMapping), () => 'تم تعطيل الربط.');
            return;
        }
        if (button.hasAttribute('data-ys-oracle-test')) {
            if (!canWrite) {return;}
            await action(async () => {
                const result = await testYarasoftOracle();
                if (result?.ok === false) {throw new Error(result.message || result.error || 'فشل فحص اتصال قاعدة الكاشير.');}
                return result;
            }, (result) => `نجح فحص الاتصال${result.ms ? ` خلال ${formatInt(result.ms)} مللي ثانية` : ''}.`);
            return;
        }
        if (button.hasAttribute('data-ys-oracle-poll')) {
            if (!canWrite || !confirmFn('بدء سحب فوري من قاعدة الكاشير؟ قد يستغرق ذلك وقتاً بحسب حجم البيانات والاتصال.')) {return;}
            await action(async () => {
                const result = await pollYarasoftOracleNow();
                if (result?.ok === false) {throw new Error(result.message || result.error || 'فشل السحب الفوري.');}
                return result;
            }, (result) => `اكتمل السحب الفوري؛ تم تسجيل ${formatInt(Number(result.rows) || 0)} صف.`);
            return;
        }
        if (button.hasAttribute('data-ys-oracle-preview')) {
            if (!canWrite) {return;}
            await action(async () => {
                const result = await previewYarasoftOracleItems();
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذرت معاينة أصناف قاعدة الكاشير.');}
                oracleItemPreview = result;
                return result;
            }, (result) => `اكتملت المعاينة: ${formatInt(Number(result.fresh) || 0)} صنف جديد، بلا كتابة للمخزون.`);
            return;
        }
        if (button.hasAttribute('data-ys-oracle-import')) {
            if (!canWrite || !oracleItemPreview || Number(oracleItemPreview.fresh) <= 0) {return;}
            const count = Number(oracleItemPreview.fresh);
            if (!confirmFn(`استيراد ${formatInt(count)} صنف جديد فقط إلى المخزون؟ تُنشأ الأصناف بكمية صفر، والموجود يُتخطى.`)) {return;}
            await action(async () => {
                const result = await importYarasoftOracleItems();
                if (result?.ok === false) {throw new Error(result.error || 'تعذر استيراد الأصناف.');}
                oracleItemPreview = null;
                return result;
            }, (result) => `تم استيراد ${formatInt(Number(result.imported) || 0)} صنف وتخطي ${formatInt(Number(result.skipped) || 0)}.`);
            return;
        }
        if (button.hasAttribute('data-ys-oracle-reconcile')) {
            const days = Number(panel.querySelector('[data-ys-oracle-days]')?.value);
            if (!Number.isInteger(days) || days < 1 || days > 90) {say('حدد فترة من يوم إلى 90 يوماً.'); return;}
            await action(async () => {
                const result = await fetchYarasoftOracleReconcile(days);
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذرت مقارنة المزامنة.');}
                oracleReconcile = result;
                return result;
            }, (result) => `اكتملت المقارنة لآخر ${formatInt(Number(result.days) || days)} يوم.`);
            return;
        }
        if (button.hasAttribute('data-ys-oracle-catchup')) {
            if (!canWrite) {return;}
            const days = Number(panel.querySelector('[data-ys-oracle-days]')?.value);
            if (!Number.isInteger(days) || days < 1 || days > 90) {say('حدد فترة من يوم إلى 90 يوماً.'); return;}
            if (!confirmFn(`بدء مهمة لحاق بفجوات المزامنة حتى ${formatInt(days)} يوماً؟ تعمل المهمة في الخلفية، وقد تتصل بقاعدة الكاشير لفترة طويلة.`)) {return;}
            await action(async () => {
                const result = await startYarasoftOracleCatchUp(days);
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذر بدء مهمة اللحاق.');}
                return result;
            }, (result) => result.alreadyRunning ? 'توجد مهمة لحاق تعمل بالفعل.' : 'بدأت مهمة اللحاق في الخلفية.');
            return;
        }
        if (button.hasAttribute('data-ys-preview-run')) {
            if (!canWrite) {return;}
            const source = panel.querySelector('[data-ys-preview-text]')?.value || '';
            await action(async () => {
                const result = await previewYarasoftInvoiceText(source);
                if (result?.ok === false) {throw new Error(result.message || result.error || 'فشل تحليل محتوى الفاتورة.');}
                invoicePreview = { ...result, source };
                return result;
            }, (result) => `اكتمل التحليل: ${formatInt(arr(result.parsed?.invoices).length)} فاتورة دون أي كتابة.`);
            return;
        }
        if (button.hasAttribute('data-ys-mirror-date-load')) {
            mirrorDate = panel.querySelector('[data-ys-mirror-date]')?.value || '';
            mirrorOffset = 0;
            mirrorClose = null;
            mirrorDetail = null;
            await loadMirror();
            return;
        }
        if (button.hasAttribute('data-ys-mirror-cashier')) {
            mirrorCashier = button.dataset.ysMirrorCashier || '';
            mirrorOffset = 0;
            mirrorClose = null;
            mirrorDetail = null;
            await loadMirror();
            return;
        }
        if (button.hasAttribute('data-ys-mirror-offset')) {
            mirrorOffset = Number(button.dataset.ysMirrorOffset) || 0;
            mirrorDetail = null;
            await loadMirror();
            return;
        }
        if (button.dataset.ysMirrorDetail) {
            button.disabled = true;
            try {
                const result = await fetchYarasoftMirrorOrder(button.dataset.ysMirrorDetail);
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذر جلب تفاصيل الأوردر.');}
                mirrorDetail = result.order || null;
                if (!destroyed) {await loadMirror();}
            } catch (error) {
                if (!destroyed) {say(error?.message || 'تعذر جلب تفاصيل الأوردر.');}
            } finally {
                if (button.isConnected && !destroyed) {button.disabled = false;}
            }
            return;
        }
        if (button.hasAttribute('data-ys-mirror-close-detail')) {
            mirrorDetail = null;
            await loadMirror();
            return;
        }
        if (button.hasAttribute('data-ys-mirror-close-load')) {
            if (!mirrorCashier) {say('اختر كاشيراً أولاً.'); return;}
            button.disabled = true;
            try {
                const result = await fetchYarasoftMirrorClose({ date: mirrorDate, cashier: mirrorCashier });
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذر جلب تقرير التقفيل.');}
                mirrorClose = result;
                await loadMirror();
            } catch (error) {
                if (!destroyed) {say(error?.message || 'تعذر جلب تقرير التقفيل.');}
            } finally {
                if (button.isConnected && !destroyed) {button.disabled = false;}
            }
            return;
        }
        if (button.hasAttribute('data-ys-mirror-close-summary')) {
            mirrorClose = null;
            await loadMirror();
            return;
        }
        if (button.hasAttribute('data-ys-mirror-refresh')) {
            if (!canWrite || !confirmFn('تحديث المرآة من بيانات الكاشير الآن؟ سيجلب الخادم حركات اليومين الأخيرين.')) {return;}
            await action(async () => {
                const result = await refreshYarasoftMirror();
                if (result?.ok === false) {throw new Error(result.message || result.error || 'تعذر تحديث المرآة.');}
                return result;
            }, (result) => `اكتمل تحديث المرآة${result.rows != null ? `: ${formatInt(Number(result.rows) || 0)} صف` : ''}.`);
        }
    }

    el.addEventListener('click', handleClick);
    el.addEventListener('input', handleInput);
    panel.innerHTML = stateMessage('جارٍ التحميل', 'يتم جلب إعدادات العملة قبل عرض القيم المالية…');
    void fetchCurrency().then((currency) => {
        if (destroyed) {return;}
        systemCurrency = String(currency || '').trim();
        if (!systemCurrency) {say('عملة النظام غير مهيأة؛ ستُعلّم القيم المالية بوضوح.');}
        return loadTab();
    }).catch((error) => {
        if (destroyed) {return;}
        say(`تعذر جلب عملة النظام: ${error?.message || 'خطأ غير معروف'}`);
        return loadTab();
    });

    return {
        el,
        reload: loadTab,
        destroy() {
            destroyed = true;
            el.removeEventListener('click', handleClick);
            el.removeEventListener('input', handleInput);
            el.remove();
        },
    };
}
