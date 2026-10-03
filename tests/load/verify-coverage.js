// تحقق حي: نقطة تغطية البصمات + عينة النتائج الفعلية
'use strict';
const https = require('https');
const API_KEY = '110c4ed2acfb2f7ed50b7ec6b58b7df7261396888839936d';
function post(path, body) {
    return new Promise((res) => {
        const d = JSON.stringify(body);
        const r = https.request('https://127.0.0.1:5000' + path, { method: 'POST', rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } },
            x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ s: x.statusCode, b })); });
        r.on('error', e => res({ s: 0, b: e.message }));
        r.write(d); r.end();
    });
}
function get(path, token) {
    return new Promise((res) => {
        https.get('https://127.0.0.1:5000' + path, { rejectUnauthorized: false,
            headers: { 'x-api-key': API_KEY, Authorization: 'Bearer ' + token } },
            x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ s: x.statusCode, b })); })
            .on('error', e => res({ s: 0, b: e.message }));
    });
}
(async () => {
    const l = await post('/api/auth/login', { username: 'admin', password: 'karim@20177' });
    const token = JSON.parse(l.b).access_token;
    const cov = await get('/api/zkteco/coverage?days=7', token);
    if (cov.s !== 200) { console.log('COVERAGE_FAIL', cov.s, cov.b.slice(0, 200)); process.exit(1); }
    const j = JSON.parse(cov.b);
    console.log('SUMMARY:', JSON.stringify(j.summary));
    console.log('--- المشاكل (أول 10) ---');
    for (const p of (j.problems || []).slice(0, 10)) {
        console.log(`• ${p.name} [${p.department || '—'}] جهاز=${p.on_device} وجه=${p.face_enrolled} آخربصمة=${p.last_punch ? String(p.last_punch).slice(0, 10) : 'أبدًا'} | ${p.diagnosis} → ${p.action}`);
    }
    console.log('--- بصمات خام بلا موظف ---');
    for (const u of (j.unmapped_device_users || [])) {
        console.log(`• جهاز #${u.deviceUserId} (${u.device_name || '?'}) — ${u.raw} بصمة خام`);
    }
    // رياض عادل تحديدًا
    const riad = [...(j.problems || []), ...(j.ok || [])].find(p => p.employeeId === 'EMP-039');
    console.log('--- رياض عادل ---');
    console.log(riad ? JSON.stringify(riad) : 'غير موجود!');
})();
