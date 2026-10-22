import {
    actOnWhatsappCampaign,
    addWhatsappManager,
    askWhatsappQuery,
    canManageWhatsapp,
    createWhatsappCampaign,
    deleteWhatsappManager,
    deleteWhatsappRule,
    fetchWhatsappCampaigns,
    fetchWhatsappAutomation,
    fetchWhatsappLogs,
    fetchWhatsappManagers,
    fetchWhatsappMessages,
    fetchWhatsappOutbox,
    fetchWhatsappQr,
    fetchWhatsappQueryCategories,
    fetchWhatsappRules,
    fetchWhatsappStatus,
    fetchWhatsappTemplates,
    logoutWhatsapp,
    refreshWhatsappQr,
    requestWhatsappPairing,
    saveWhatsappAutomation,
    saveWhatsappRule,
    saveWhatsappTemplate,
    sendWhatsappMessage,
    sendWhatsappTemplate,
    startWhatsapp,
    stopWhatsapp,
    testWhatsappAutomation,
    updateWhatsappChatMeta,
} from '../data/whatsapp-repo.js?v=4.9.194';
import { ensureQrCode } from '../vendor.js?v=4.9.194';
import { formatInt } from '../data/reports-repo.js?v=4.9.194';

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const asRows = (response, key) => {
    if (response && Array.isArray(response[key])) {return response[key];}
    if (response && Array.isArray(response.rows)) {return response.rows;}
    if (Array.isArray(response)) {return response;}
    return [];
};

const WA_STATES = Object.freeze({
    CONNECTED: ['متصل', 'success'],
    QR_REQUIRED: ['بانتظار مسح QR', 'warning'],
    AUTHENTICATING: ['جارٍ التحقق', 'info'],
    RECONNECTING: ['جارٍ إعادة الاتصال', 'warning'],
    DISCONNECTED: ['غير متصل', 'danger'],
    LOGGED_OUT: ['تم تسجيل الخروج', 'danger'],
    FAILED: ['فشل الاتصال', 'danger'],
    STOPPED: ['متوقف', 'neutral'],
    INITIALIZING: ['جارٍ التهيئة', 'info'],
});

function stateBadge(state) {
    const [label, tone] = WA_STATES[state] || [String(state || 'غير معروف'), 'neutral'];
    return `<span class="erp-badge" data-tone="${tone}">${esc(label)}</span>`;
}

function table(headers, rows, empty, columns) {
    const head = headers.map((label) => `<th scope="col">${esc(label)}</th>`).join('');
    return `<div class="erp-table__wrap"><table class="erp-table"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${columns}" class="erp-text-muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}

function pageTemplate(isAdmin) {
    return `<section class="erp-card erp-v2-whatsapp" aria-label="إدارة WhatsApp">
      <div class="erp-card__head">
        <h2 class="erp-card__title">إدارة WhatsApp</h2>
        <button type="button" class="erp-btn erp-btn--sm" data-wa-refresh>تحديث</button>
      </div>
      <div class="erp-card__body erp-stack">
        <p class="erp-text-sm erp-text-muted" data-wa-notice role="status" aria-live="polite"></p>
        <div class="erp-wa-tabs" role="tablist" aria-label="أقسام WhatsApp">
          <button type="button" role="tab" class="erp-btn erp-btn--sm" data-wa-tab="connection" aria-selected="true" aria-controls="wa-panel" tabindex="0">الربط وQR</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="inbox" aria-selected="false" aria-controls="wa-panel">الوارد</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="templates" aria-selected="false" aria-controls="wa-panel">القوالب</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="campaigns" aria-selected="false" aria-controls="wa-panel">الحملات</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="outbox" aria-selected="false" aria-controls="wa-panel">الصادر</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="rules" aria-selected="false" aria-controls="wa-panel">قواعد الرد</button>
          ${isAdmin ? '<button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="managers" aria-selected="false" aria-controls="wa-panel">أرقام الإدارة</button><button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="automation" aria-selected="false" aria-controls="wa-panel">التنبيهات</button>' : ''}
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="logs" aria-selected="false" aria-controls="wa-panel">سجل الأحداث</button>
          <button type="button" role="tab" class="erp-btn erp-btn--sm" tabindex="-1" data-wa-tab="query" aria-selected="false" aria-controls="wa-panel">اسأل النظام</button>
        </div>
        <div id="wa-panel" data-wa-panel role="tabpanel" aria-live="polite"></div>
      </div>
    </section>`;
}

export function consentedCampaignRecipients(raw) {
    return String(raw || '').split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [remoteJid = '', consent = '', rawVars = ''] = line.split('|');
            const approved = ['yes', 'true', '1', 'نعم'].includes(consent.trim().toLowerCase());
            return {
                remote_jid: remoteJid.trim(),
                consent: approved,
                vars: rawVars.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 20),
            };
        })
        .filter((recipient) => recipient.consent && recipient.remote_jid)
        .slice(0, 1000);
}

export function mountWhatsappScreen(host, ctx = {}) {
    const role = ctx.role || (typeof window !== 'undefined' && window.STATE
        && window.STATE.currentUser && window.STATE.currentUser.role) || '';
    const canWrite = canManageWhatsapp(role);
    const isAdmin = role === 'admin';
    const notify = typeof ctx.notify === 'function' ? ctx.notify : () => {};
    const confirmAction = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => typeof window !== 'undefined' && window.confirm(message);

    host.insertAdjacentHTML('beforeend', pageTemplate(isAdmin));
    const el = host.lastElementChild;
    const panel = el.querySelector('[data-wa-panel]');
    const notice = el.querySelector('[data-wa-notice]');
    let activeTab = 'connection';
    let destroyed = false;
    let busy = false;
    let qrLoading = false;
    let pairingCode = '';
    let rules = [];
    let statusTimer = null;
    let qrTimer = null;
    let lastStatus = null;

    const say = (message, tone = 'info') => {
        if (!destroyed && notice) {
            notice.textContent = message;
            notice.dataset.tone = tone;
        }
        notify(message, tone === 'danger' ? 'error' : tone);
    };

    const setBusy = (value) => {
        busy = value;
        el.querySelectorAll('button[data-wa-action], button[data-wa-submit]').forEach((button) => {
            button.disabled = value;
        });
    };

    async function runAction(action, successMessage) {
        if (busy) {return;}
        setBusy(true);
        try {
            await action();
            say(successMessage, 'success');
            await refreshStatus();
            await loadTab();
        } catch (error) {
            say(error && error.message ? error.message : 'تعذر تنفيذ العملية', 'danger');
        } finally {
            if (!destroyed) {setBusy(false);}
        }
    }

    function renderStatus(status, errorMessage = '') {
        const box = el.querySelector('[data-wa-status]');
        if (!box || destroyed) {return;}
        const connection = status && status.connection || {};
        const queue = status && status.queue || {};
        const metrics = status && status.metrics || {};
        const error = errorMessage
            ? `<p class="erp-state erp-state--error" role="alert">${esc(errorMessage)}</p>` : '';
        box.innerHTML = `${error}<div class="erp-wa-status">
          <div class="erp-card"><div class="erp-card__body"><span class="erp-text-sm erp-text-muted">حالة الاتصال</span><div>${stateBadge(connection.state)}</div><p class="erp-text-sm erp-text-muted">${connection.lastError ? esc(String(connection.lastError).slice(0, 180)) : 'لا توجد أخطاء مسجلة'}</p></div></div>
          <div class="erp-card"><div class="erp-card__body"><span class="erp-text-sm erp-text-muted">آخر اتصال ناجح</span><strong>${esc(connection.lastOkAt || '—')}</strong></div></div>
          <div class="erp-card"><div class="erp-card__body"><span class="erp-text-sm erp-text-muted">وارد معلق</span><strong>${formatInt(Number(queue.inbox_pending) || 0)}</strong></div></div>
          <div class="erp-card"><div class="erp-card__body"><span class="erp-text-sm erp-text-muted">صادر مستحق</span><strong>${formatInt(Number(queue.outbox_due) || 0)}</strong></div></div>
          <div class="erp-card"><div class="erp-card__body"><span class="erp-text-sm erp-text-muted">ردود تلقائية</span><strong>${formatInt(Number(metrics.replied) || 0)}</strong></div></div>
        </div>`;
    }

    async function refreshStatus() {
        if (destroyed) {return;}
        try {
            lastStatus = await fetchWhatsappStatus();
            if (destroyed) {return;}
            renderStatus(lastStatus);
            if (activeTab === 'connection' && lastStatus.connection?.state === 'QR_REQUIRED') {
                void loadQr(false);
            }
        } catch (error) {
            if (!destroyed) {
                renderStatus(null, error && error.message ? error.message : 'تعذر جلب حالة WhatsApp');
            }
        }
    }

    async function renderQr(qr, at = '') {
        const qrBox = el.querySelector('[data-wa-qr]');
        if (!qrBox || destroyed) {return;}
        if (!qr) {
            qrBox.innerHTML = '<p class="erp-text-muted">لا يوجد رمز حالي. ابدأ المحرك ثم اطلب رمزاً.</p>';
            return;
        }
        qrBox.innerHTML = '<p class="erp-text-muted" role="status">جارٍ إنشاء صورة QR…</p>';
        const available = await ensureQrCode();
        if (destroyed || !qrBox.isConnected) {return;}
        const qrCode = typeof window !== 'undefined' ? window.QRCode : null;
        if (!available || !qrCode || typeof qrCode.toDataURL !== 'function') {
            qrBox.innerHTML = '<p class="erp-state erp-state--error" role="alert">تعذّر تحميل مولّد QR المحلي؛ لم يُعرض نص الرمز لحماية بيانات الربط.</p>';
            return;
        }
        try {
            const dataUrl = await qrCode.toDataURL(qr, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
            if (destroyed || !qrBox.isConnected) {return;}
            qrBox.innerHTML = `<img class="erp-wa-qr-image" src="${esc(dataUrl)}" alt="رمز ربط WhatsApp مؤقت"><p class="erp-text-sm erp-text-muted">امسح الرمز من واتساب ← الأجهزة المرتبطة. الرمز مؤقت ويتجدد تلقائياً.</p><time class="erp-text-sm erp-text-muted">${esc(at)}</time>`;
        } catch (error) {
            if (destroyed || !qrBox.isConnected) {return;}
            qrBox.innerHTML = `<p class="erp-state erp-state--error" role="alert">تعذّر إنشاء صورة QR: ${esc(error && error.message ? error.message : 'خطأ غير معروف')}</p>`;
        }
    }

    async function loadQr(manual = true) {
        const qrBox = el.querySelector('[data-wa-qr]');
        if (!qrBox || destroyed || qrLoading) {return;}
        qrLoading = true;
        if (manual) {qrBox.innerHTML = '<p class="erp-text-muted" role="status">جارٍ طلب رمز الربط…</p>';}
        try {
            const response = await fetchWhatsappQr();
            if (destroyed || !qrBox.isConnected) {return;}
            if (response && response.connected) {
                qrBox.innerHTML = '<p class="erp-badge" data-tone="success">الجهاز متصل — لا حاجة إلى QR</p>';
                if (qrTimer) {clearInterval(qrTimer); qrTimer = null;}
                return;
            }
            await renderQr(response && response.qr, response && response.at);
        } catch (error) {
            if (destroyed || !qrBox.isConnected) {return;}
            qrBox.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error && error.message ? error.message : 'تعذّر جلب QR')}</p>`;
            if (manual) {say(error && error.message ? error.message : 'تعذّر جلب رمز الربط', 'danger');}
        } finally {
            qrLoading = false;
        }
    }

    function startQrPolling() {
        if (qrTimer) {clearInterval(qrTimer);}
        qrTimer = setInterval(() => {
            if (destroyed || activeTab !== 'connection') {return;}
            if (lastStatus?.connection?.state === 'CONNECTED') {
                clearInterval(qrTimer);
                qrTimer = null;
                return;
            }
            void loadQr(false);
        }, 15000);
    }

    function renderConnection() {
        panel.innerHTML = `<div class="erp-stack">
          <div data-wa-status><p class="erp-text-muted" role="status">جارٍ جلب حالة الاتصال…</p></div>
          <div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إدارة الاتصال</h3></div>
            <div class="erp-card__body erp-stack">
              ${canWrite ? `<div class="erp-wa-actions">
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-action="start">بدء المحرك</button>
                <button type="button" class="erp-btn erp-btn--sm" data-wa-action="stop">إيقاف المحرك</button>
                <button type="button" class="erp-btn erp-btn--sm" data-wa-action="qr">جلب QR</button>
                <button type="button" class="erp-btn erp-btn--sm" data-wa-action="qr-refresh">إنشاء QR جديد</button>
              </div>
              <div class="erp-wa-actions"><label class="erp-field"><span class="erp-label">رقم دولي لرمز الربط</span><input class="erp-input erp-input--ltr" data-wa-phone inputmode="tel" autocomplete="tel" placeholder="9665XXXXXXXX"></label><button type="button" class="erp-btn erp-btn--sm" data-wa-action="pair">طلب رمز الهاتف</button></div>
              <div data-wa-pairing role="status">${pairingCode ? `<p class="erp-badge" data-tone="success">رمز الربط: <b dir="ltr">${esc(pairingCode)}</b></p>` : ''}</div>
              ${isAdmin ? '<button type="button" class="erp-btn erp-btn--danger erp-btn--sm" data-wa-action="logout">مسح جلسة الربط</button>' : ''}` : '<p class="erp-text-sm erp-text-muted">المشاهدة متاحة لهذا الدور؛ إدارة الربط تتطلب صلاحية مدير.</p>'}
              <div class="erp-wa-qr" data-wa-qr aria-live="polite"><p class="erp-text-muted">اطلب QR لبدء الربط.</p></div>
            </div>
          </div>
        </div>`;
        void refreshStatus();
        if (canWrite) {startQrPolling();}
    }

    async function loadInbox() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل الوارد…</p>';
        try {
            const response = await fetchWhatsappMessages(50);
            if (destroyed || activeTab !== 'inbox') {return;}
            const rows = asRows(response, 'rows').map((message) => `<tr>
              <td>${esc(message.created_at || '—')}</td><td><code dir="ltr">${esc(message.remote_jid || '—')}</code></td>
              <td>${esc(message.body || '—')}</td><td>${esc(message.status || '—')}</td>
              <td><label class="erp-field"><span class="erp-sr-only">حالة المحادثة</span><select class="erp-input" data-wa-chat-status="${esc(message.id)}"><option value="open"${message.chat_status === 'open' || !message.chat_status ? ' selected' : ''}>مفتوحة</option><option value="pending"${message.chat_status === 'pending' ? ' selected' : ''}>معلقة</option><option value="resolved"${message.chat_status === 'resolved' ? ' selected' : ''}>محلولة</option><option value="snoozed"${message.chat_status === 'snoozed' ? ' selected' : ''}>مؤجلة</option></select></label></td>
              <td><label class="erp-field"><span class="erp-sr-only">أولوية المحادثة</span><select class="erp-input" data-wa-chat-priority="${esc(message.id)}"><option value="low"${message.chat_priority === 'low' ? ' selected' : ''}>منخفضة</option><option value="normal"${message.chat_priority === 'normal' || !message.chat_priority ? ' selected' : ''}>عادية</option><option value="high"${message.chat_priority === 'high' ? ' selected' : ''}>عالية</option><option value="urgent"${message.chat_priority === 'urgent' ? ' selected' : ''}>عاجلة</option></select></label></td>
              <td>${canWrite ? `<button type="button" class="erp-btn erp-btn--sm" data-wa-chat-save="${esc(message.id)}" data-wa-jid="${esc(message.remote_jid || '')}">حفظ</button>` : '—'}</td></tr>`).join('');
            panel.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">الوارد (${formatInt(Number(response?.total) || asRows(response, 'rows').length)})</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الوقت', 'المحادثة', 'الرسالة', 'المعالجة', 'حالة المحادثة', 'الأولوية', 'إجراء'], rows, 'لا توجد رسائل واردة.', 7)}</div></div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'inbox') {
                panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error && error.message ? error.message : 'تعذّر تحميل الوارد')}</p>`;
            }
        }
    }

    async function loadTemplates() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل القوالب…</p>';
        try {
            const response = await fetchWhatsappTemplates();
            if (destroyed || activeTab !== 'templates') {return;}
            const templates = asRows(response, 'templates');
            const options = templates.map((item) => `<option value="${esc(item.name)}">${esc(item.name)} — ${esc(item.category || 'عام')}</option>`).join('');
            const rows = templates.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.category || '—')}</td><td>${esc(item.ar || '—')}</td><td>${esc(item.en || '—')}</td><td>${formatInt(Number(item.variables) || 0)}</td></tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              ${isAdmin ? `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">حفظ قالب</h3></div><div class="erp-card__body erp-stack">
                <div class="erp-wa-form"><label class="erp-field"><span class="erp-label">الاسم</span><input class="erp-input" data-wa-template-name maxlength="120"></label><label class="erp-field"><span class="erp-label">الفئة</span><input class="erp-input" data-wa-template-category maxlength="80" value="general"></label><label class="erp-field"><span class="erp-label">عدد المتغيرات</span><input class="erp-input" data-wa-template-vars type="number" min="0" max="20" value="0"></label></div>
                <label class="erp-field"><span class="erp-label">النص العربي</span><textarea class="erp-input" data-wa-template-ar rows="3"></textarea></label>
                <label class="erp-field"><span class="erp-label">النص الإنجليزي</span><textarea class="erp-input" data-wa-template-en rows="3"></textarea></label>
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="save-template">حفظ القالب</button>
              </div></div>` : ''}
              ${canWrite ? `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إرسال قالب</h3></div><div class="erp-card__body erp-stack">
                <div class="erp-wa-form"><label class="erp-field"><span class="erp-label">القالب</span><select class="erp-input" data-wa-send-template>${options || '<option value="">لا توجد قوالب</option>'}</select></label><label class="erp-field"><span class="erp-label">المستلم (JID)</span><input class="erp-input erp-input--ltr" data-wa-template-to dir="ltr" placeholder="9665XXXXXXXX@s.whatsapp.net"></label><label class="erp-field"><span class="erp-label">اللغة</span><select class="erp-input" data-wa-template-lang><option value="ar">العربية</option><option value="en">English</option></select></label></div>
                <label class="erp-field"><span class="erp-label">المتغيرات — قيمة في كل سطر</span><textarea class="erp-input" data-wa-template-values rows="3"></textarea></label>
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="send-template" ${templates.length ? '' : 'disabled'}>إرسال إلى الطابور</button>
              </div></div>` : ''}
              <div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">القوالب المتاحة</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الاسم', 'الفئة', 'العربية', 'English', 'المتغيرات'], rows, 'لا توجد قوالب محفوظة.', 5)}</div></div>
            </div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'templates') {
                panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error && error.message ? error.message : 'تعذّر تحميل القوالب')}</p>`;
            }
        }
    }

    async function loadCampaigns() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل الحملات…</p>';
        try {
            const response = await fetchWhatsappCampaigns();
            if (destroyed || activeTab !== 'campaigns') {return;}
            const campaigns = asRows(response, 'campaigns');
            const rows = campaigns.map((campaign) => {
                const actions = isAdmin ? [
                    campaign.status === 'draft' ? `<button type="button" class="erp-btn erp-btn--sm" data-wa-campaign="${esc(campaign.id)}" data-wa-action="approve">اعتماد</button>` : '',
                    ['approved', 'running'].includes(campaign.status) ? `<button type="button" class="erp-btn erp-btn--sm" data-wa-campaign="${esc(campaign.id)}" data-wa-action="pause">إيقاف</button>` : '',
                    !['completed', 'cancelled'].includes(campaign.status) ? `<button type="button" class="erp-btn erp-btn--danger erp-btn--sm" data-wa-campaign="${esc(campaign.id)}" data-wa-action="cancel">إلغاء</button>` : '',
                ].join('') : '';
                return `<tr><td>${esc(campaign.name)}</td><td><code>${esc(campaign.template_name)}</code></td><td>${esc(campaign.status)}</td>
                  <td>${formatInt(Number(campaign.consented) || 0)} / ${formatInt(Number(campaign.recipients) || 0)}</td><td>${formatInt(Number(campaign.sent) || 0)}</td>
                  <td>${esc(campaign.scheduled_at || 'فور الاعتماد')}</td><td>${actions}</td></tr>`;
            }).join('');
            panel.innerHTML = `<div class="erp-stack">
              ${isAdmin ? `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إنشاء حملة مسودة</h3></div><div class="erp-card__body erp-stack">
                <div class="erp-wa-form"><label class="erp-field"><span class="erp-label">اسم الحملة</span><input class="erp-input" data-wa-campaign-name maxlength="160"></label><label class="erp-field"><span class="erp-label">اسم القالب</span><input class="erp-input" data-wa-campaign-template maxlength="120"></label><label class="erp-field"><span class="erp-label">موعد الإرسال (اختياري)</span><input class="erp-input" data-wa-campaign-date type="datetime-local"></label></div>
                <label class="erp-field"><span class="erp-label">المستلمون — رقم|موافقة|المتغيرات (موافقة: yes)، سطر لكل مستلم</span><textarea class="erp-input" data-wa-campaign-recipients rows="5" dir="ltr" placeholder="9665XXXXXXXX@s.whatsapp.net|yes|أحمد,123"></textarea></label>
                <p class="erp-text-sm erp-text-muted">لا تُدرج إلا الأرقام المعلّمة بموافقة صريحة. إنشاء الحملة لا يرسلها؛ الإرسال يتطلب اعتماداً منفصلاً.</p>
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="create-campaign">إنشاء مسودة</button>
              </div></div>` : ''}
              <div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">سجل الحملات</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الحملة', 'القالب', 'الحالة', 'موافقون / مستلمون', 'مرسلة', 'الجدولة', 'إجراءات'], rows, 'لا توجد حملات.', 7)}</div></div>
            </div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'campaigns') {
                panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error && error.message ? error.message : 'تعذّر تحميل الحملات')}</p>`;
            }
        }
    }

    async function loadOutbox() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل الصادر…</p>';
        try {
            const response = await fetchWhatsappOutbox();
            if (destroyed || activeTab !== 'outbox') {return;}
            const rows = asRows(response, 'rows').map((message) => `<tr>
              <td>${esc(message.created_at || '—')}</td><td><code dir="ltr">${esc(message.remote_jid || '—')}</code></td>
              <td>${esc(message.preview || '—')}</td><td>${esc(message.status || '—')} (${formatInt(Number(message.attempts) || 0)})</td>
              <td>${esc(message.last_error || '—')}</td></tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              <div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">صندوق الصادر</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الوقت', 'إلى', 'الرسالة', 'الحالة والمحاولات', 'آخر خطأ'], rows, 'لا توجد رسائل صادرة.', 5)}</div></div>
              ${canWrite ? `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إرسال رسالة</h3></div><div class="erp-card__body erp-stack">
                <label class="erp-field"><span class="erp-label">المستلم (JID)</span><input class="erp-input erp-input--ltr" data-wa-message-to dir="ltr" placeholder="9665XXXXXXXX@s.whatsapp.net"></label>
                <label class="erp-field"><span class="erp-label">نص الرسالة</span><textarea class="erp-input" data-wa-message-body rows="4" maxlength="4000"></textarea></label>
                <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="send-message">إرسال إلى الطابور</button>
              </div></div>` : ''}
            </div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'outbox') {
                panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error && error.message ? error.message : 'تعذّر تحميل الصادر')}</p>`;
            }
        }
    }

    async function loadRules() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل قواعد الرد…</p>';
        try {
            const response = await fetchWhatsappRules();
            if (destroyed || activeTab !== 'rules') {return;}
            rules = asRows(response, 'rows');
            const rows = rules.map((rule) => `<tr><td>${esc(rule.name || '—')}</td><td>${esc(rule.match_type || '—')}</td>
              <td>${esc(rule.pattern || '—')}</td><td>${esc(rule.response || '—')}</td>
              <td>${rule.enabled ? 'مفعّلة' : 'معطّلة'}</td><td>${canWrite
                ? `<button type="button" class="erp-btn erp-btn--sm" data-wa-rule-edit="${esc(rule.id)}">تعديل</button> <button type="button" class="erp-btn erp-btn--danger erp-btn--sm" data-wa-rule-delete="${esc(rule.id)}">تعطيل</button>`
                : '—'}</td></tr>`).join('');
            panel.innerHTML = `<div class="erp-stack">
              ${canWrite ? `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">إضافة أو تعديل قاعدة</h3></div><div class="erp-card__body erp-stack">
                <input type="hidden" data-wa-rule-id>
                <div class="erp-wa-form"><label class="erp-field"><span class="erp-label">الاسم</span><input class="erp-input" data-wa-rule-name maxlength="120"></label>
                <label class="erp-field"><span class="erp-label">نوع المطابقة</span><select class="erp-input" data-wa-rule-type><option value="exact">مطابقة تامة</option><option value="contains">يحتوي</option><option value="command">أمر</option></select></label></div>
                <label class="erp-field"><span class="erp-label">النمط</span><input class="erp-input" data-wa-rule-pattern maxlength="500"></label>
                <label class="erp-field"><span class="erp-label">الرد</span><textarea class="erp-input" data-wa-rule-response rows="3"></textarea></label>
                <label class="erp-field"><span class="erp-label"><input type="checkbox" data-wa-rule-enabled checked> مفعّلة</span></label>
                <div class="erp-wa-actions"><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="save-rule">حفظ القاعدة</button><button type="button" class="erp-btn erp-btn--sm" data-wa-submit="clear-rule">مسح النموذج</button></div>
              </div></div>` : ''}
              <div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">قواعد الرد (${formatInt(rules.length)})</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الاسم', 'المطابقة', 'النمط', 'الرد', 'الحالة', 'إجراءات'], rows, 'لا توجد قواعد رد.', 6)}</div></div>
            </div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'rules') {panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تحميل القواعد')}</p>`;}
        }
    }

    async function loadManagers() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل أرقام الإدارة…</p>';
        try {
            const response = await fetchWhatsappManagers();
            if (destroyed || activeTab !== 'managers') {return;}
            const numbers = Array.isArray(response?.numbers) ? response.numbers : [];
            const rows = numbers.map((number) => `<tr><td><code dir="ltr">${esc(number)}</code></td><td><button type="button" class="erp-btn erp-btn--danger erp-btn--sm" data-wa-manager-delete="${esc(number)}">حذف</button></td></tr>`).join('');
            panel.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">أرقام الإدارة</h3></div><div class="erp-card__body erp-stack">
              <p class="erp-text-sm erp-text-muted">الأرقام المسجلة هنا مخولة باستخدام أوامر الإدارة عبر WhatsApp.</p>
              <div class="erp-wa-actions"><label class="erp-field"><span class="erp-label">رقم دولي (7 إلى 16 رقماً)</span><input class="erp-input erp-input--ltr" data-wa-manager-number dir="ltr" inputmode="numeric" maxlength="16"></label><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="add-manager">إضافة رقم</button></div>
              ${table(['الرقم', 'إجراء'], rows, 'لا توجد أرقام إدارة مسجلة.', 2)}
            </div></div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'managers') {panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تحميل أرقام الإدارة')}</p>`;}
        }
    }

    async function loadAutomation() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل إعدادات التنبيهات…</p>';
        try {
            const response = await fetchWhatsappAutomation();
            if (destroyed || activeTab !== 'automation') {return;}
            const settings = response?.settings || {};
            const checkbox = (key, label) => `<label class="erp-field"><span class="erp-label"><input type="checkbox" data-wa-auto="${key}"${settings[key] !== false ? ' checked' : ''}> ${label}</span></label>`;
            panel.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">التقارير والتنبيهات المجدولة</h3></div><div class="erp-card__body erp-stack">
              <label class="erp-field"><span class="erp-label">وقت التقرير اليومي</span><input class="erp-input" type="time" data-wa-auto-time value="${esc(settings.dailyTime || '23:30')}"></label>
              ${checkbox('dailyReport', 'إرسال التقرير اليومي')}
              ${checkbox('alertDevice', 'تنبيه انقطاع أجهزة البصمة')}
              ${checkbox('alertUnmapped', 'تنبيه الأقسام غير المعتمدة')}
              ${checkbox('alertFailed', 'تنبيه الفواتير الفاشلة')}
              ${checkbox('alertDocs', 'تنبيه الوثائق المنتهية أو القريبة')}
              ${checkbox('alertShifts', 'تنبيه الورديات المفتوحة من أمس')}
              <div class="erp-wa-actions"><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-wa-submit="save-automation">حفظ الإعدادات</button><button type="button" class="erp-btn erp-btn--sm" data-wa-submit="test-automation">إرسال تقرير تجريبي</button></div>
            </div></div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'automation') {panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تحميل التنبيهات')}</p>`;}
        }
    }

    async function loadLogs() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل سجل الأحداث…</p>';
        try {
            const response = await fetchWhatsappLogs();
            if (destroyed || activeTab !== 'logs') {return;}
            const rows = asRows(response, 'rows').map((entry) => `<tr><td>${esc(entry.created_at || '—')}</td><td>${esc(entry.kind || '—')}</td>
              <td><code>${esc(entry.ref || '—')}</code></td><td>${esc(entry.detail || '—')}</td></tr>`).join('');
            panel.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">سجل WhatsApp</h3><button type="button" class="erp-btn erp-btn--sm" data-wa-refresh-tab>تحديث</button></div><div class="erp-card__body">${table(['الوقت', 'الحدث', 'المرجع', 'التفاصيل'], rows, 'لا توجد أحداث مسجلة.', 4)}</div></div>`;
        } catch (error) {
            if (!destroyed && activeTab === 'logs') {panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تحميل السجل')}</p>`;}
        }
    }

    async function loadQuery() {
        panel.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحميل أمثلة الأسئلة…</p>';
        try {
            const response = await fetchWhatsappQueryCategories();
            if (destroyed || activeTab !== 'query') {return;}
            const categories = Array.isArray(response?.categories) ? response.categories : [];
            const chips = categories
                .filter((category) => category && category.label)
                .map((category) => `<button type="button" class="erp-btn erp-btn--sm" data-wa-query-chip="${esc(category.label)}">${esc(category.label)}</button>`)
                .join('');
            panel.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">اسأل النظام</h3></div>
              <div class="erp-card__body erp-stack">
                <p class="erp-text-sm erp-text-muted">اكتب سؤالك في صندوق واحد، مثل: «مبيعات اليوم»، «أصناف تحت الحد»، «حضور الموظفين»، «ملخص مالي».</p>
                <div class="erp-wa-query">
                  <input type="text" class="erp-input" data-wa-query placeholder="اكتب سؤالك… (مثال: مبيعات اليوم)" autocomplete="off" />
                  <button type="button" class="erp-btn erp-btn--primary" data-wa-query-ask>اسأل</button>
                </div>
                ${chips ? `<div class="erp-wa-query-chips" aria-label="أمثلة سريعة">${chips}</div>` : ''}
                <div data-wa-query-result aria-live="polite"></div>
              </div></div>`;
            panel.querySelector('[data-wa-query]')?.focus();
            panel.querySelector('[data-wa-query]')?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {event.preventDefault(); void askQuery();}
            });
        } catch (error) {
            if (!destroyed && activeTab === 'query') {
                panel.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تحميل أمثلة الأسئلة')}</p>`;
            }
        }
    }

    async function askQuery() {
        const input = panel.querySelector('[data-wa-query]');
        const box = panel.querySelector('[data-wa-query-result]');
        const question = String(input?.value || '').trim();
        if (!question) {say('اكتب السؤال أولاً.', 'danger'); return;}
        if (busy || !box) {return;}
        setBusy(true);
        box.innerHTML = '<p class="erp-text-muted" role="status">جارٍ تحليل السؤال…</p>';
        try {
            const response = await askWhatsappQuery(question);
            if (destroyed || activeTab !== 'query') {return;}
            if (response && response.ok && response.result) {
                box.innerHTML = `<div class="erp-wa-answer"><strong>الإجابة</strong><p>${esc(String(response.result)).replace(/\r?\n/g, '<br>')}</p></div>`;
            } else {
                box.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(response?.message || 'تعذّر تنفيذ السؤال')}</p>`;
            }
        } catch (error) {
            if (!destroyed) {
                box.innerHTML = `<p class="erp-state erp-state--error" role="alert">${esc(error?.message || 'تعذّر تنفيذ السؤال')}</p>`;
            }
        } finally {
            if (!destroyed) {setBusy(false);}
        }
    }

    async function loadTab() {
        if (destroyed) {return;}
        if (activeTab === 'connection') {renderConnection(); return;}
        if (qrTimer) {clearInterval(qrTimer); qrTimer = null;}
        if (activeTab === 'inbox') {await loadInbox(); return;}
        if (activeTab === 'templates') {await loadTemplates(); return;}
        if (activeTab === 'campaigns') {await loadCampaigns(); return;}
        if (activeTab === 'outbox') {await loadOutbox(); return;}
        if (activeTab === 'rules') {await loadRules(); return;}
        if (activeTab === 'managers') {await loadManagers(); return;}
        if (activeTab === 'automation') {await loadAutomation(); return;}
        if (activeTab === 'query') {await loadQuery(); return;}
        await loadLogs();
    }

    async function submit(action) {
        if (busy) {return;}
        if (action === 'save-template') {
            const name = panel.querySelector('[data-wa-template-name]')?.value.trim();
            const ar = panel.querySelector('[data-wa-template-ar]')?.value.trim();
            const en = panel.querySelector('[data-wa-template-en]')?.value.trim();
            const variables = Number(panel.querySelector('[data-wa-template-vars]')?.value);
            if (!isAdmin || !name || (!ar && !en) || !Number.isInteger(variables) || variables < 0 || variables > 20) {
                say('أدخل اسم القالب ونصاً واحداً على الأقل، وعدد متغيرات من 0 إلى 20.', 'danger');
                return;
            }
            await runAction(() => saveWhatsappTemplate({
                name, category: panel.querySelector('[data-wa-template-category]')?.value.trim() || 'general',
                ar, en, variables,
            }), 'تم حفظ القالب');
            return;
        }
        if (action === 'send-template') {
            const to = panel.querySelector('[data-wa-template-to]')?.value.trim();
            const name = panel.querySelector('[data-wa-send-template]')?.value;
            const lang = panel.querySelector('[data-wa-template-lang]')?.value;
            const vars = (panel.querySelector('[data-wa-template-values]')?.value || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
            if (!canWrite || !to || !name) {say('اختر قالباً وأدخل المستلم.', 'danger'); return;}
            await runAction(() => sendWhatsappTemplate({ to, name, lang, vars }), 'أُضيف القالب إلى طابور الصادر');
            return;
        }
        if (action === 'create-campaign') {
            const name = panel.querySelector('[data-wa-campaign-name]')?.value.trim();
            const templateName = panel.querySelector('[data-wa-campaign-template]')?.value.trim();
            const rawDate = panel.querySelector('[data-wa-campaign-date]')?.value;
            const recipients = consentedCampaignRecipients(panel.querySelector('[data-wa-campaign-recipients]')?.value);
            if (!isAdmin || !name || !templateName || recipients.length === 0) {
                say('أدخل اسم الحملة والقالب ومستلمًا واحدًا على الأقل بموافقة صريحة.', 'danger');
                return;
            }
            const campaign = { name, template_name: templateName, recipients };
            if (rawDate) {
                const scheduledAt = new Date(rawDate);
                if (Number.isNaN(scheduledAt.getTime())) {say('موعد الجدولة غير صالح.', 'danger'); return;}
                campaign.scheduled_at = scheduledAt.toISOString();
            }
            await runAction(() => createWhatsappCampaign(campaign), 'أُنشئت المسودة؛ لم يُرسل شيء قبل الاعتماد');
            return;
        }
        if (action === 'send-message') {
            const to = panel.querySelector('[data-wa-message-to]')?.value.trim();
            const body = panel.querySelector('[data-wa-message-body]')?.value.trim();
            if (!canWrite || !to || !body) {say('أدخل المستلم ونص الرسالة.', 'danger'); return;}
            await runAction(() => sendWhatsappMessage(to, body), 'أُضيفت الرسالة إلى الطابور');
            return;
        }
        if (action === 'clear-rule') {
            panel.querySelector('[data-wa-rule-id]').value = '';
            panel.querySelector('[data-wa-rule-name]').value = '';
            panel.querySelector('[data-wa-rule-type]').value = 'exact';
            panel.querySelector('[data-wa-rule-pattern]').value = '';
            panel.querySelector('[data-wa-rule-response]').value = '';
            panel.querySelector('[data-wa-rule-enabled]').checked = true;
            return;
        }
        if (action === 'save-rule') {
            const name = panel.querySelector('[data-wa-rule-name]')?.value.trim();
            const match_type = panel.querySelector('[data-wa-rule-type]')?.value;
            const pattern = panel.querySelector('[data-wa-rule-pattern]')?.value.trim();
            if (!canWrite || !name || !pattern || !['exact', 'contains', 'command'].includes(match_type)) {
                say('الاسم والنمط ونوع المطابقة الصحيح مطلوبة.', 'danger');
                return;
            }
            const rule = {
                name,
                match_type,
                pattern,
                response: panel.querySelector('[data-wa-rule-response]')?.value || '',
                enabled: panel.querySelector('[data-wa-rule-enabled]')?.checked === true,
            };
            const id = panel.querySelector('[data-wa-rule-id]')?.value;
            if (id) {rule.id = Number(id);}
            await runAction(() => saveWhatsappRule(rule), 'تم حفظ قاعدة الرد');
            return;
        }
        if (action === 'add-manager') {
            const number = panel.querySelector('[data-wa-manager-number]')?.value.trim();
            if (!isAdmin || !/^\d{7,16}$/.test(number || '')) {
                say('أدخل رقمًا دوليًا صحيحًا من 7 إلى 16 رقمًا دون رموز.', 'danger');
                return;
            }
            await runAction(() => addWhatsappManager(number), 'تمت إضافة رقم الإدارة');
            return;
        }
        if (action === 'save-automation') {
            if (!isAdmin) {return;}
            const settings = { dailyTime: panel.querySelector('[data-wa-auto-time]')?.value || '23:30' };
            for (const checkbox of panel.querySelectorAll('[data-wa-auto]')) {
                settings[checkbox.dataset.waAuto] = checkbox.checked;
            }
            if (!/^\d{2}:\d{2}$/.test(settings.dailyTime)) {
                say('وقت التقرير غير صالح.', 'danger');
                return;
            }
            await runAction(() => saveWhatsappAutomation(settings), 'تم حفظ إعدادات التنبيهات');
            return;
        }
        if (action === 'test-automation') {
            if (!isAdmin || !confirmAction('إرسال التقرير التجريبي الآن إلى أرقام الإدارة المسجلة؟')) {return;}
            await runAction(async () => {
                const result = await testWhatsappAutomation();
                say(`تم وضع التقرير التجريبي في الطابور (${formatInt(Number(result.queued) || 0)} محادثة).`, 'success');
            }, 'انتهى اختبار التقرير');
        }
    }

    async function campaignAction(button) {
        const action = button.dataset.waAction;
        const id = button.dataset.waCampaign;
        if (!isAdmin || !id || !['approve', 'pause', 'cancel'].includes(action)) {return;}
        const prompts = {
            approve: 'اعتماد الحملة؟ سيبدأ إرسال الرسائل للمستلمين ذوي الموافقة فقط.',
            pause: 'إيقاف الحملة مؤقتاً؟',
            cancel: 'إلغاء الحملة نهائياً؟',
        };
        if (!confirmAction(prompts[action])) {return;}
        await runAction(() => actOnWhatsappCampaign(id, action), 'تم تحديث الحملة');
    }

    async function handleClick(event) {
        const button = event.target.closest('button');
        if (!button || !el.contains(button) || destroyed) {return;}
        if (button.dataset.waTab) {
            activeTab = button.dataset.waTab;
            el.querySelectorAll('[data-wa-tab]').forEach((tab) => {
                tab.setAttribute('aria-selected', String(tab === button));
                tab.tabIndex = tab === button ? 0 : -1;
            });
            await loadTab();
            return;
        }
        if (button.hasAttribute('data-wa-refresh') || button.hasAttribute('data-wa-refresh-tab')) {
            if (activeTab === 'connection') {await refreshStatus(); await loadQr(false);}
            else {await loadTab();}
            return;
        }
        if (button.dataset.waSubmit) {await submit(button.dataset.waSubmit); return;}
        if (button.hasAttribute('data-wa-query-ask')) {await askQuery(); return;}
        if (button.dataset.waQueryChip) {
            const input = panel.querySelector('[data-wa-query]');
            if (input) {input.value = `${button.dataset.waQueryChip} `;}
            await askQuery();
            return;
        }
        if (button.dataset.waCampaign) {await campaignAction(button); return;}
        if (button.dataset.waChatSave) {
            if (!canWrite) {return;}
            const messageId = button.dataset.waChatSave;
            const jid = button.dataset.waJid;
            const status = [...panel.querySelectorAll('[data-wa-chat-status]')]
                .find((item) => item.dataset.waChatStatus === messageId)?.value;
            const priority = [...panel.querySelectorAll('[data-wa-chat-priority]')]
                .find((item) => item.dataset.waChatPriority === messageId)?.value;
            if (!jid || !['open', 'pending', 'resolved', 'snoozed'].includes(status)
                || !['low', 'normal', 'high', 'urgent'].includes(priority)) {
                say('بيانات المحادثة غير صالحة.', 'danger');
                return;
            }
            await runAction(() => updateWhatsappChatMeta(jid, { status, priority }), 'تم تحديث حالة المحادثة');
            return;
        }
        if (button.dataset.waRuleEdit) {
            const rule = rules.find((item) => String(item.id) === button.dataset.waRuleEdit);
            if (!rule || !canWrite) {return;}
            panel.querySelector('[data-wa-rule-id]').value = String(rule.id);
            panel.querySelector('[data-wa-rule-name]').value = rule.name || '';
            panel.querySelector('[data-wa-rule-type]').value = rule.match_type || 'exact';
            panel.querySelector('[data-wa-rule-pattern]').value = rule.pattern || '';
            panel.querySelector('[data-wa-rule-response]').value = rule.response || '';
            panel.querySelector('[data-wa-rule-enabled]').checked = rule.enabled !== false;
            panel.querySelector('[data-wa-rule-name]').focus();
            return;
        }
        if (button.dataset.waRuleDelete) {
            if (!canWrite || !confirmAction('تعطيل قاعدة الرد هذه؟')) {return;}
            await runAction(() => deleteWhatsappRule(button.dataset.waRuleDelete), 'تم تعطيل قاعدة الرد');
            return;
        }
        if (button.dataset.waManagerDelete) {
            if (!isAdmin || !confirmAction(`حذف رقم الإدارة ${button.dataset.waManagerDelete}؟`)) {return;}
            await runAction(() => deleteWhatsappManager(button.dataset.waManagerDelete), 'تم حذف الرقم من الإدارة');
            return;
        }
        if (!button.dataset.waAction) {return;}
        if (!canWrite && button.dataset.waAction !== 'refresh') {return;}
        const action = button.dataset.waAction;
        if (action === 'qr') {await loadQr(true); return;}
        if (action === 'qr-refresh') {
            await runAction(async () => {
                await refreshWhatsappQr();
                await new Promise((resolve) => setTimeout(resolve, 1200));
                await loadQr(false);
            }, 'تم طلب رمز جديد');
            return;
        }
        if (action === 'pair') {
            const phone = panel.querySelector('[data-wa-phone]')?.value.trim();
            if (!phone) {say('أدخل رقم الهاتف بالصيغة الدولية دون +.', 'danger'); return;}
            await runAction(async () => {
                const result = await requestWhatsappPairing(phone);
                pairingCode = String(result.code || '');
            }, 'تم إنشاء رمز الربط');
            return;
        }
        if (action === 'logout') {
            if (!isAdmin || !confirmAction('سيتم تسجيل خروج WhatsApp وإبطال الجلسة الحالية. هل تريد المتابعة؟')) {return;}
            await runAction(logoutWhatsapp, 'تم تسجيل الخروج؛ يلزم ربط QR جديد');
            return;
        }
        if (action === 'start') {await runAction(startWhatsapp, 'تم طلب بدء المحرك'); return;}
        if (action === 'stop') {await runAction(stopWhatsapp, 'تم إيقاف المحرك');}
    }

    async function handleTabKeys(event) {
        const tab = event.target.closest('[data-wa-tab]');
        if (!tab) {return;}
        const tabs = [...el.querySelectorAll('[data-wa-tab]')];
        const i = tabs.indexOf(tab);
        let next = -1;
        if (event.key === 'ArrowLeft') {next = i + 1;}
        else if (event.key === 'ArrowRight') {next = i - 1;}
        else if (event.key === 'Home') {next = 0;}
        else if (event.key === 'End') {next = tabs.length - 1;}
        if (next < 0 || next >= tabs.length) {return;}
        event.preventDefault();
        tabs[next].focus();
        await handleClick({ target: tabs[next], preventDefault() {} });
    }

    el.addEventListener('click', handleClick);
    el.addEventListener('keydown', handleTabKeys);
    void loadTab();
    statusTimer = setInterval(() => {
        if (!destroyed && activeTab === 'connection') {void refreshStatus();}
    }, 10000);

    return {
        el,
        reload: loadTab,
        destroy() {
            destroyed = true;
            if (statusTimer) {clearInterval(statusTimer); statusTimer = null;}
            if (qrTimer) {clearInterval(qrTimer); qrTimer = null;}
            el.removeEventListener('click', handleClick);
            el.removeEventListener('keydown', handleTabKeys);
            el.remove();
        },
    };
}
