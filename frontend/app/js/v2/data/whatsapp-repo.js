import { apiFetch } from '../../core/api.js?v=4.9.131';

const WRITE_ROLES = Object.freeze(['admin', 'manager']);

const json = (value) => JSON.stringify(value);

export function fetchWhatsappStatus() {
    return apiFetch('/whatsapp/status');
}

export function fetchWhatsappQr() {
    return apiFetch('/whatsapp/qr');
}

export function refreshWhatsappQr() {
    return apiFetch('/whatsapp/qr/refresh', { method: 'POST' });
}

export function startWhatsapp() {
    return apiFetch('/whatsapp/start', { method: 'POST' });
}

export function stopWhatsapp() {
    return apiFetch('/whatsapp/stop', { method: 'POST' });
}

export function logoutWhatsapp() {
    return apiFetch('/whatsapp/logout', {
        method: 'POST',
        body: json({ confirm: 'LOGOUT' }),
    });
}

export function requestWhatsappPairing(phone) {
    return apiFetch('/whatsapp/pairing', {
        method: 'POST',
        body: json({ phone: String(phone || '').trim() }),
    });
}

export async function fetchWhatsappMessages(limit = 50) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
    return apiFetch(`/whatsapp/messages?limit=${safeLimit}`);
}

export function fetchWhatsappOutbox() {
    return apiFetch('/whatsapp/outbox');
}

export function sendWhatsappMessage(to, body) {
    return apiFetch('/whatsapp/send', {
        method: 'POST',
        body: json({ to: String(to || '').trim(), body: String(body || '').trim() }),
    });
}

export function fetchWhatsappTemplates() {
    return apiFetch('/whatsapp/templates');
}

export function saveWhatsappTemplate(template) {
    return apiFetch('/whatsapp/templates', {
        method: 'POST',
        body: json(template),
    });
}

export function sendWhatsappTemplate({ to, name, lang = 'ar', vars = [] }) {
    return apiFetch('/whatsapp/templates/send', {
        method: 'POST',
        body: json({
            to: String(to || '').trim(),
            name: String(name || '').trim(),
            lang: lang === 'en' ? 'en' : 'ar',
            vars: Array.isArray(vars) ? vars.map((value) => String(value).slice(0, 200)) : [],
        }),
    });
}

export function fetchWhatsappCampaigns() {
    return apiFetch('/whatsapp/campaigns');
}

export function fetchWhatsappRules() {
    return apiFetch('/whatsapp/rules');
}

export function saveWhatsappRule(rule) {
    return apiFetch('/whatsapp/rules', { method: 'POST', body: json(rule) });
}

export function deleteWhatsappRule(id) {
    return apiFetch(`/whatsapp/rules/${encodeURIComponent(String(id || '').trim())}`, { method: 'DELETE' });
}

export function fetchWhatsappManagers() {
    return apiFetch('/whatsapp/managers');
}

export function addWhatsappManager(number) {
    return apiFetch('/whatsapp/managers', {
        method: 'POST',
        body: json({ number: String(number || '').trim() }),
    });
}

export function deleteWhatsappManager(number) {
    return apiFetch(`/whatsapp/managers/${encodeURIComponent(String(number || '').trim())}`, { method: 'DELETE' });
}

export function fetchWhatsappLogs() {
    return apiFetch('/whatsapp/logs');
}

export function fetchWhatsappAutomation() {
    return apiFetch('/whatsapp/automation');
}

export function saveWhatsappAutomation(settings) {
    return apiFetch('/whatsapp/automation', { method: 'POST', body: json(settings) });
}

export function testWhatsappAutomation() {
    return apiFetch('/whatsapp/automation/test', { method: 'POST' });
}

export function updateWhatsappChatMeta(jid, meta) {
    return apiFetch(`/whatsapp/chats/${encodeURIComponent(String(jid || '').trim())}/meta`, {
        method: 'POST',
        body: json(meta),
    });
}

export function createWhatsappCampaign(campaign) {
    return apiFetch('/whatsapp/campaigns', {
        method: 'POST',
        body: json(campaign),
    });
}

export function actOnWhatsappCampaign(id, action) {
    const campaignId = encodeURIComponent(String(id || '').trim());
    if (!campaignId || !['approve', 'pause', 'cancel'].includes(action)) {
        throw new Error('إجراء الحملة غير صالح');
    }
    return apiFetch(`/whatsapp/campaigns/${campaignId}/${action}`, { method: 'POST' });
}

export function fetchWhatsappQueryCategories() {
    return apiFetch('/whatsapp/query/categories');
}

export function askWhatsappQuery(question) {
    const text = String(question || '').trim();
    if (!text) { throw new Error('اكتب السؤال أولاً'); }
    return apiFetch('/whatsapp/query', { method: 'POST', body: json({ question: text }) });
}

export function canManageWhatsapp(role) {
    return WRITE_ROLES.includes(role);
}
