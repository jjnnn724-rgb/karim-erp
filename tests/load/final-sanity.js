// فحص نهائي سريع بعد استعادة الإنتاج — مؤقت
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
        }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => resolve({ s: x.statusCode, b })); });
        r.on('error', e => resolve({ s: 0, b: e.message }));
        if (data) { r.write(data); }
        r.end();
    });
}

(async () => {
    let fails = 0;
    const check = (name, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : '')); if (!ok) { fails++; } };

    const health = await req('GET', '/api/server/info');
    check('الخادم يستجيب', health.s === 200);

    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'karim@20177' } });
    const token = (() => { try { return JSON.parse(login.b).access_token; } catch (_) { return null; } })();
    check('الدخول يعمل بوضع الإنتاج (حد 20/15د)', login.s === 200 && !!token);

    const emp = await req('GET', '/api/employees', { token });
    const rowsOf = (b) => { try { const j = JSON.parse(b); return Array.isArray(j) ? j : (j.data || j.rows || []); } catch (_) { return []; } };
    check('قراءة الموظفين', emp.s === 200, `(${rowsOf(emp.b).length} موظف)`);

    const dept = await req('GET', '/api/hrDepartments', { token });
    const depts = rowsOf(dept.b);
    const leftovers = depts.filter(d => /^HRD-(ST|MX)/.test(String(d.code || '')));
    check('لا بقايا أقسام اختبار ضغط', leftovers.length === 0, leftovers.length ? leftovers.map(d => d.code).join(',') : `${depts.length} قسم نظيف`);

    // دليل صلاحية حدود الإنتاج: ترويسة X-RateLimit-Limit — بعنوان فريد يتجاوز
    // الكاش (API cache لا يمرر محدد المعدل على HIT عمدًا — api-cache.js:20)
    const limited = await new Promise((resolve) => {
        https.get(BASE + '/api/employees?_sanity=' + Date.now(), {
            rejectUnauthorized: false,
            headers: { 'x-api-key': API_KEY, Authorization: 'Bearer ' + token },
        }, x => { x.resume(); resolve({ limit: x.headers['x-ratelimit-limit'], cache: x.headers['x-cache'] }); });
    });
    check('حدود الإنتاج الافتراضية مفعّلة', limited.limit === '100', 'X-RateLimit-Limit=' + limited.limit + ' X-Cache=' + limited.cache);

    console.log(fails === 0 ? 'FINAL_SANITY_OK' : 'FINAL_SANITY_FAILED');
    process.exit(fails === 0 ? 0 : 1);
})();
