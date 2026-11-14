import { apiFetch } from '../../core/api.js?v=4.9.330';

/** بوابات الامتثال — مسارات إضافية تحت /api/integration. */

export function fetchComplianceHealth() {
    return apiFetch('/integration/health?live=1');
}

export function fetchComplianceProviders() {
    return apiFetch('/integration/providers');
}

export function setComplianceProviderEnabled(code, enabled) {
    return apiFetch(`/integration/providers/${encodeURIComponent(code)}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
    });
}

export function saveComplianceCredential(provider, key, value) {
    return apiFetch(`/integration/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
    });
}

export function fetchComplianceOutbox(status) {
    const q = status ? `&status=${encodeURIComponent(status)}` : '';
    return apiFetch(`/integration/outbox?live=1${q}`);
}

export function retryComplianceRow(id) {
    return apiFetch(`/integration/outbox/${Number(id)}/retry`, { method: 'POST' });
}

export function reviewComplianceRow(id, decision, reason) {
    return apiFetch(`/integration/outbox/${Number(id)}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
    });
}

export function fetchComplianceEvents(limit = 20) {
    return apiFetch(`/integration/events?live=1&limit=${Number(limit) || 20}`);
}

/** مدد / WPS — جاهزية وكشف مراجعة فقط، بلا إرسال خارجي. */

export function fetchWpsRequirements(month) {
    return apiFetch(`/integration/wps/requirements?live=1&month=${encodeURIComponent(month)}`);
}

export function fetchWpsReadiness(month) {
    return apiFetch(`/integration/wps/readiness?live=1&month=${encodeURIComponent(month)}`);
}

export function saveEmployeeBank(id, patch) {
    return apiFetch(`/integration/wps/employees/${Number(id)}/bank`, {
        method: 'PUT',
        body: JSON.stringify(patch),
    });
}

export function generateWpsSheet(month) {
    return apiFetch('/integration/wps/export', {
        method: 'POST',
        body: JSON.stringify({ month }),
    });
}

export function fetchGosiRates() {
    return apiFetch('/integration/gosi/rates?live=1');
}

export function fetchGosiPreview(month, rateSet) {
    const q = `month=${encodeURIComponent(month)}&rate_set=${encodeURIComponent(rateSet)}`;
    return apiFetch(`/integration/gosi/preview?live=1&${q}`);
}

export function fetchQiwaReadiness() {
    return apiFetch('/integration/qiwa/readiness?live=1');
}
