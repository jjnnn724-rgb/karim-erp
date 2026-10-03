// tests/load/metrics-snapshot.js — لقطة سريعة من /api/metrics
'use strict';
const https = require('https');
const BASE = 'https://127.0.0.1:5000';
const API_KEY = '110c4ed2acfb2f7ed50b7ec6b58b7df7261396888839936d';

function post(path, body) {
    return new Promise((res) => {
        const d = JSON.stringify(body);
        const r = https.request(BASE + path, {
            method: 'POST', rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
        }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ s: x.statusCode, b })); });
        r.on('error', e => res({ s: 0, b: e.message }));
        r.write(d); r.end();
    });
}
function get(path, token) {
    return new Promise((res) => {
        https.get(BASE + path, {
            rejectUnauthorized: false,
            headers: { 'x-api-key': API_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ s: x.statusCode, b })); })
            .on('error', e => res({ s: 0, b: e.message }));
    });
}

(async () => {
    const l = await post('/api/auth/login', { username: 'admin', password: 'karim@20177' });
    let token = null;
    try { token = JSON.parse(l.b).access_token; } catch (_) {}
    if (!token) { console.error('LOGIN_FAIL', l.s, l.b.slice(0, 150)); process.exit(1); }
    const m = await get('/api/metrics', token);
    try {
        const j = JSON.parse(m.b);
        console.log('status', m.s);
        console.log('uptimeSec', j.uptimeSec);
        console.log('requests', JSON.stringify(j.requests));
        console.log('memory', JSON.stringify(j.memory));
        console.log('eventLoopUs', JSON.stringify(j.eventLoopLagUs));
        console.log('dbPool', JSON.stringify(j.dbPool));
    } catch (_) { console.error('PARSE_FAIL', m.s, m.b.slice(0, 300)); }
})();
