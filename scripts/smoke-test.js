// scripts/smoke-test.js
// اختبار دخان (smoke test) شامل لكل endpoints الـ backend
// يعمل بدون قاعدة بيانات — يتحقق فقط من استجابات الـ HTTP الصحيحة
const http = require('http');

const PINK = '\x1b[35m', GREEN = '\x1b[32m', RED = '\x1b[31m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m';

let pass = 0, fail = 0;
const failures = [];

function req(method, path, body = null, headers = {}) {
    return new Promise((resolve) => {
        const opts = { method, hostname: 'localhost', port: Number(process.env.PORT || 5000), path, headers: { ...headers } };
        if (body) {
            const data = JSON.stringify(body);
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(data);
        }
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: buf, json, headers: res.headers });
            });
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (body) {r.write(JSON.stringify(body));}
        r.end();
    });
}

function check(name, actual, expected, cond = 'eq') {
    let ok;
    if (cond === 'eq') {ok = actual === expected;}
    else if (cond === 'in') {ok = expected.includes(actual);}
    else if (cond === 'gte') {ok = actual >= expected;}
    if (ok) { pass++; console.log(`  ${GREEN}✓${RESET} ${name}  ${CYAN}(HTTP ${actual})${RESET}`); }
    else { fail++; failures.push(name); console.log(`  ${RED}✗${RESET} ${name}  ${RED}(got ${actual}, expected ${expected})${RESET}`); }
}

async function main() {
    console.log(`\n${BOLD}${PINK}===================================================${RESET}`);
    console.log(`${BOLD}${PINK}  Karim ERP — Smoke Test للـ endpoints الحيّة${RESET}`);
    console.log(`${BOLD}${PINK}===================================================${RESET}\n`);

    // 1. Health check — قد يرجع 200 (صحي) أو 503 (degraded) لو الـ DB مش متاح
    console.log(`${BOLD}[1] Health & System${RESET}`);
    let r = await req('GET', '/api/health');
    check('GET /api/health يعمل', r.status, [200, 503], 'in');
    check('health يحتوي status', r.json?.status ? 1 : 0, 1);
    check('health يحتوي checks.database', r.json?.checks?.database ? 1 : 0, 1);
    check('health يحتوي checks.realtime', r.json?.checks?.realtime ? 1 : 0, 1);
    check('health يحتوي version', r.json?.version ? 1 : 0, 1);

    // 2. Network info
    console.log(`\n${BOLD}[2] Network${RESET}`);
    r = await req('GET', '/api/network-info');
    check('GET /api/network-info', r.status, 200);
    check('network-info يحتوي ips', r.json?.ips ? 1 : 0, 1);

    // 3. Clients (Socket.io)
    console.log(`\n${BOLD}[3] Real-time Clients${RESET}`);
    r = await req('GET', '/api/clients');
    check('GET /api/clients', r.status, 200);
    check('clients يحتوي count', typeof r.json?.count === 'number' ? 1 : 0, 1);

    // 4. State endpoint — الآن يتطلب JWT (تحديث أمني)
    // بدون JWT: يجب أن يرجع 401
    console.log(`\n${BOLD}[4] State (يتطلب JWT الآن — تحديث أمني)${RESET}`);
    r = await req('GET', '/api/state');
    check('GET /api/state يرفض بدون JWT (401)', r.status === 401 ? 1 : 0, 1);
    r = await req('POST', '/api/state', { test: 'data' });
    check('POST /api/state يرفض بدون JWT (401)', r.status === 401 ? 1 : 0, 1);

    // 5. Entity endpoints (تتطلب JWT)
    console.log(`\n${BOLD}[5] Entity CRUD (يتطلب JWT)${RESET}`);
    r = await req('GET', '/api/users');
    check('GET /api/users يرفض بدون JWT (401)', r.status, 401);
    r = await req('GET', '/api/employees');
    check('GET /api/employees يرفض بدون JWT (401)', r.status, 401);
    r = await req('GET', '/api/inventory');
    check('GET /api/inventory يرفض بدون JWT (401)', r.status, 401);

    // 6. Auth login (يتطلب DB)
    console.log(`\n${BOLD}[6] Auth Login${RESET}`);
    r = await req('POST', '/api/auth/login', { username: 'admin', password: process.env.KARIM_TEST_PASSWORD || 'not-a-real-test-password' });
    check('POST /api/auth/login يستجيب (لا 404)', r.status, [200, 401, 500], 'in');
    // The endpoint must exist (i.e., status !== 404). 200/401/500 all mean
    // the route is registered — only 404 means the endpoint is missing.
    check('login لا يرجع 404 (endpoint موجود)', r.status !== 404 ? 1 : 0, 1);

    // 7. POS endpoints (تتطلب JWT)
    console.log(`\n${BOLD}[7] POS Module${RESET}`);
    r = await req('GET', '/api/pos/departments');
    check('GET /api/pos/departments يرفض بدون JWT (401)', r.status, 401);
    r = await req('GET', '/api/pos/products');
    check('GET /api/pos/products يرفض بدون JWT (401)', r.status, 401);
    r = await req('GET', '/api/pos/dashboard');
    check('GET /api/pos/dashboard يرفض بدون JWT (401)', r.status, 401);

    // 8. Metrics (Prometheus) — يتطلب JWT أو METRICS_API_KEY
    console.log(`\n${BOLD}[8] Metrics (يتطلب مصادقة)${RESET}`);
    r = await req('GET', '/metrics');
    check('GET /metrics يرفض بدون JWT (401)', r.status === 401 ? 1 : 0, 1);

    // 9. Static frontend
    console.log(`\n${BOLD}[9] Static Frontend${RESET}`);
    r = await req('GET', '/app/index.html');
    check('GET /app/index.html (200)', r.status, 200);
    r = await req('GET', '/app/pos.html');
    check('GET /app/pos.html (200)', r.status, 200);
    r = await req('GET', '/app/css/styles.css');
    check('GET /app/css/styles.css (200)', r.status, 200);
    r = await req('GET', '/app/js/app.js');
    check('GET /app/js/app.js (200)', r.status, 200);
    r = await req('GET', '/app/js/realtime.js');
    check('GET /app/js/realtime.js (200)', r.status, 200);

    // 10. Root redirect
    console.log(`\n${BOLD}[10] Root Redirect${RESET}`);
    r = await req('GET', '/');
    check('GET / يحوّل لـ /app/index.html (302/301)', r.status, [301, 302], 'in');

    // 11. Unknown route
    console.log(`\n${BOLD}[11] 404 Handling${RESET}`);
    r = await req('GET', '/api/nonexistent');
    check('GET /api/nonexistent (404)', r.status, 404);

    // Summary
    console.log(`\n${BOLD}${PINK}===================================================${RESET}`);
    const total = pass + fail;
    const pct = total > 0 ? Math.round(pass / total * 100) : 0;
    if (fail === 0) {
        console.log(`  ${GREEN}${BOLD}✅ جميع الفحوص نجحت: ${pass}/${total} (100%)${RESET}`);
    } else {
        console.log(`  ${RED}${BOLD}✗ فشل ${fail} من ${total} (${pct}% نجاح)${RESET}`);
        console.log(`  ${RED}الفشل في:${RESET}`);
        for (const f of failures) {console.log(`    • ${f}`);}
    }
    console.log(`${BOLD}${PINK}===================================================${RESET}\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
