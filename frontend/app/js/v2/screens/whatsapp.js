import { fetchWhatsappStatus, fetchWhatsappMessages } from '../data/portal-repo.js?v=4.9.131';
import { formatInt } from '../data/reports-repo.js?v=4.9.131';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pretty = (o) => { try { return JSON.stringify(o, null, 2); } catch (_) { return String(o); } };

function template() {
    return '<section class="erp-card erp-v2-whatsapp"><div class="erp-card__head"><h3 class="erp-card__title">WhatsApp <span class="erp-eyebrow" dir="ltr" lang="en">Status + Inbox</span></h3><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button></div><div class="erp-card__body erp-stack"><p class="erp-text-sm erp-text-muted" data-v2-note>قراءة only - status + messages. Send and mutation flows deferred.</p><div data-v2-status></div><div data-v2-inbox></div></div></section>';
}

export function mountWhatsappScreen(host, _ctx = {}) {
    let loading = false;
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const statusEl = q('[data-v2-status]'); const inboxEl = q('[data-v2-inbox]');

    async function reload() {
        if (loading) { return; }
        loading = true; statusEl.textContent = 'جارٍ التحميل…';
        try {
            const st = await fetchWhatsappStatus();
            const msgsRaw = await fetchWhatsappMessages(50).catch(() => []);
            if (!el.isConnected) { return; }
            statusEl.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word">' + esc(pretty(st)) + '</pre>';
            const rows = Array.isArray(msgsRaw) ? msgsRaw : [];
            const body = rows.map(r => '<tr><td>' + esc(r.remote_jid || r.from || '-') + '</td><td>' + esc(String(r.preview || r.text || '').slice(0, 80)) + '</td><td>' + esc(r.status || '') + '</td><td>' + esc(r.created_at || r.sent_at || '') + '</td></tr>').join('');
            inboxEl.innerHTML = '<h4 class="erp-card__title">آخر ' + formatInt(rows.length) + ' رسالة</h4><table class="erp-table"><thead><tr><th>من</th><th>نص</th><th>الحالة</th><th>وقت</th></tr></thead><tbody>' + body + '</tbody></table>';
        } catch (e) {
            if (!el.isConnected) { return; }
            statusEl.textContent = 'تعذّر التحميل: ' + ((e && e.message) || 'خطأ');
        } finally { loading = false; }
    }
    el.addEventListener('click', (ev) => { if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); } });
    reload();
    return { el, reload, destroy() { el.remove(); } };
}