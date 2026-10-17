import { fetchYarasoftStatus, fetchYarasoftLog } from '../data/portal-repo.js?v=4.9.152';
import { formatInt } from '../data/reports-repo.js?v=4.9.152';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pretty = (o) => { try { return JSON.stringify(o, null, 2); } catch (_) { return String(o); } };

function template() {
    return '<section class="erp-card erp-v2-yarasoft"><div class="erp-card__head"><h3 class="erp-card__title">Yarasoft <span class="erp-eyebrow" dir="ltr" lang="en">Oracle Import</span></h3>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button></div>'
        + '<div class="erp-card__body erp-stack"><p class="erp-text-sm erp-text-muted" data-v2-note>قراءة only — status + import log. External: Oracle connection + importer. mutations deferred.</p>'
        + '<div data-v2-status></div><div data-v2-log></div></div></section>';
}

export function mountYarasoftScreen(host, _ctx = {}) {
    let loading = false;
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const statusEl = q('[data-v2-status]'); const logEl = q('[data-v2-log]');

    async function reload() {
        if (loading) { return; }
        loading = true;
        statusEl.textContent = 'جارٍ التحميل…';
        try {
            const [st, log] = await Promise.all([fetchYarasoftStatus(), fetchYarasoftLog(60).catch(() => [])]);
            if (!el.isConnected) { return; }
            statusEl.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word">' + esc(pretty(st)) + '</pre>';
            const rows = Array.isArray(log) ? log : [];
            logEl.innerHTML = '<h4 class="erp-card__title">آخر ' + formatInt(rows.length) + ' سجل استيراد</h4>'
                + '<table class="erp-table"><thead><tr><th>ملف</th><th>حالة</th><th>مرحلة</th><th>أصناف</th><th>قيمة</th><th>خطأ</th></tr></thead><tbody>'
                + rows.map(r => '<tr><td>' + esc(r.source_file || r.id) + '</td><td>' + esc(r.status || '') + '</td><td>' + esc(r.stage || '') + '</td><td>' + formatInt(r.items_count) + '</td><td>' + esc(r.total_amount) + '</td><td>' + esc(r.error_message || '') + '</td></tr>').join('')
                + '</tbody></table>';
        } catch (e) {
            if (!el.isConnected) { return; }
            statusEl.textContent = 'تعذّر التحميل: ' + ((e && e.message) || 'خطأ');
        } finally { loading = false; }
    }
    el.addEventListener('click', (ev) => { if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); } });
    reload();
    return { el, reload, destroy() { el.remove(); } };
}