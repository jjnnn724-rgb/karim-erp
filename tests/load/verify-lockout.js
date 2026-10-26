// اختبار حي: قفل الحساب بعد 5 فشلات (R18)
'use strict';
const https = require('https');
function login(username, pw) {
    return new Promise(res => {
        const d = JSON.stringify({ username, password: pw });
        const r = https.request('https://127.0.0.1:5000/api/auth/login', {
            method: 'POST', rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
        }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ s: x.statusCode, b })); });
        r.on('error', e => res({ s: 0, b: e.message }));
        r.write(d); r.end();
    });
}
(async () => {
    const user = 'sanitylock_tmp';
    const codes = [];
    for (let i = 1; i <= 5; i++) {
        const r = await login(user, 'WrongPass' + i);
        codes.push(r.s);
    }
    const sixth = await login(user, 'Whatever1');
    console.log('fails:', codes.join(','), '| 6th:', sixth.s, sixth.b.slice(0, 90));
    const locked = sixth.s === 423 && /ACCOUNT_LOCKED/.test(sixth.b);
    console.log(locked ? 'LOCKOUT_VERIFIED' : 'LOCKOUT_NOT_TRIGGERED');
    process.exit(locked ? 0 : 1);
})();
