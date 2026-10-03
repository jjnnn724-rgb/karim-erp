// تنظيف نهائي: حذف أقسام اختبار الضغط المتبقية + إثبات ترويسة حدود الإنتاج
'use strict';
const https = require('https');
const BASE = 'https://127.0.0.1:5000';
const API_KEY = '110c4ed2acfb2f7ed50b7ec6b58b7df7261396888839936d';

function req(method, path, { token, body } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = https.request(BASE + path, {
            method, rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json', 'x-api-key': API_KEY,
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => resolve({ s: x.statusCode, b, headers: x.headers })); });
        r.on('error', e => resolve({ s: 0, b: e.message, headers: {} }));
        if (data) { r.write(data); }
        r.end();
    });
}
const rowsOf = (b) => { try { const j = JSON.parse(b); return Array.isArray(j) ? j : (j.data || j.rows || []); } catch (_) { return []; } };

(async () => {
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'karim@20177' } });
    const token = (() => { try { return JSON.parse(login.b).access_token; } catch (_) { return null; } })();
    if (!token) { console.error('LOGIN_FAIL'); process.exit(1); }

    // 1) حذف أقسام الاختبار المتبقية
    const dept = await req('GET', '/api/hrDepartments', { token });
    const leftovers = rowsOf(dept.b).filter(d => /^HRD-(ST|MX)/.test(String(d.code || '')));
    for (const d of leftovers) {
        const del = await req('DELETE', '/api/hrDepartments/' + d.id, { token });
        console.log('DELETE', d.code, del.s);
    }
    const after = rowsOf((await req('GET', '/api/hrDepartments', { token })).b);
    const remaining = after.filter(d => /^HRD-(ST|MX)/.test(String(d.code || '')));
    console.log(remaining.length === 0 ? 'CLEANUP_OK — لا بقايا' : 'STILL_LEFT: ' + remaining.map(d => d.code).join(','));

    // 2) ترويسة الحد مع عنوان فريد (يتجاوز الكاش)
    const probe = await req('GET', '/api/employees?_rlprobe=' + Date.now(), { token });
    console.log('X-RateLimit-Limit (MISS) =', probe.headers['x-ratelimit-limit'], '| X-Cache =', probe.headers['x-cache']);
    process.exit(remaining.length === 0 && probe.headers['x-ratelimit-limit'] === '100' ? 0 : 1);
})();
