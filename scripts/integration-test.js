// scripts/integration-test.js
// اختبار تكاملي شامل مع PostgreSQL حقيقي
// يتطلب: تشغيل الـ backend على port 5000 + قاعدة بيانات karim_erp جاهزة
const http = require('http');

const PINK = '\x1b[35m', GREEN = '\x1b[32m', RED = '\x1b[31m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m', RESET = '\x1b[0m', BOLD = '\x1b[1m';

let pass = 0, fail = 0;
const failures = [];
let adminToken = null;
const cashierToken = null;

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

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ${GREEN}✓${RESET} ${name}${detail ? `  ${CYAN}${detail}${RESET}` : ''}`); }
    else { fail++; failures.push(name); console.log(`  ${RED}✗${RESET} ${name}${detail ? `  ${RED}${detail}${RESET}` : ''}`); }
}

async function main() {
    console.log(`\n${BOLD}${PINK}═══════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${PINK}  Karim ERP — اختبار تكاملي مع PostgreSQL حقيقي${RESET}`);
    console.log(`${BOLD}${PINK}═══════════════════════════════════════════════════════${RESET}\n`);

    // ═══════════════════════════════════════════════════════
    // Phase 1: Health & Database connectivity
    // ═══════════════════════════════════════════════════════
    console.log(`${BOLD}${YELLOW}[Phase 1] فحص الصحة وقاعدة البيانات${RESET}`);
    let r = await req('GET', '/api/health');
    check('GET /api/health يرجع 200 (DB صحي)', r.status === 200, `(HTTP ${r.status})`);
    check('database status = healthy', r.json?.checks?.database?.status === 'healthy', r.json?.checks?.database?.status || '');
    check('activeConnections > 0', (r.json?.checks?.database?.activeConnections || 0) > 0, `${r.json?.checks?.database?.activeConnections} connections`);

    // ═══════════════════════════════════════════════════════
    // Phase 2: Authentication (login → JWT)
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 2] المصادقة (Login → JWT)${RESET}`);

    const adminPassword = process.env.KARIM_TEST_PASSWORD;
    if (!adminPassword) {throw new Error('KARIM_TEST_PASSWORD is required for integration tests.');}
    // admin login
    r = await req('POST', '/api/auth/login', { username: 'admin', password: adminPassword });
    check('admin login ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    check('login يرجع access_token', !!r.json?.access_token, r.json?.error || '');
    check('login يرجع user.id', !!r.json?.user?.id, '');
    check('login يرجع user.role = admin', r.json?.user?.role === 'admin', r.json?.user?.role || '');
    adminToken = r.json?.access_token;
    console.log(`      ${CYAN}admin token: ${adminToken?.substring(0, 30)}...${RESET}`);

    // wrong password
    r = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
    check('wrong password يرجع 401', r.status === 401, `(HTTP ${r.status})`);

    // nonexistent user
    r = await req('POST', '/api/auth/login', { username: 'ghost', password: 'not-a-real-test-password' });
    check('nonexistent user يرجع 401 أو 429 عند تفعيل الحماية', r.status === 401 || r.status === 429, `(HTTP ${r.status})`);

    // missing fields
    r = await req('POST', '/api/auth/login', { username: 'admin' });
    check('missing password يرجع 400 أو 429 عند تفعيل الحماية', r.status === 400 || r.status === 429, `(HTTP ${r.status})`);

    // ═══════════════════════════════════════════════════════
    // Phase 3: State endpoint (JWT-protected — تحديث أمني)
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 3] State endpoint (مع JWT)${RESET}`);

    // Ensure DB state is empty at start (use admin JWT)
    await req('DELETE', '/api/state', null, { Authorization: `Bearer ${adminToken}` });

    // Initial state: should be 404 (empty)
    r = await req('GET', '/api/state', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/state على DB فارغ يرجع 404', r.status === 404, `(HTTP ${r.status})`);

    // Save state (admin role required)
    const testState = {
        lang: 'ar',
        theme: 'dark',
        // These legacy/business fields must be ignored by the server.
        users: [{ id: 1, username: 'must-not-persist' }],
        departments: [{ id: 1, code: 'must-not-persist' }],
    };
    r = await req('POST', '/api/state', testState, { Authorization: `Bearer ${adminToken}` });
    check('POST /api/state ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    check('state save يرجع status success', r.json?.status === 'success', r.json?.status || '');

    // Read it back
    r = await req('GET', '/api/state', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/state بعد الحفظ يرجع 200', r.status === 200, `(HTTP ${r.status})`);
    check('state يحفظ اللغة فقط', r.json?.lang === 'ar', r.json?.lang || '');
    check('state يحفظ المظهر فقط', r.json?.theme === 'dark', r.json?.theme || '');
    check('state لا يعيد users التشغيلية', !Object.prototype.hasOwnProperty.call(r.json || {}, 'users'), '');
    check('state لا يعيد departments التشغيلية', !Object.prototype.hasOwnProperty.call(r.json || {}, 'departments'), '');

    // ═══════════════════════════════════════════════════════
    // Phase 4: Entity CRUD (with JWT)
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 4] Entity CRUD مع JWT${RESET}`);

    // GET /api/users with admin token
    r = await req('GET', '/api/users', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/users مع JWT ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    check('users يرجع data array', Array.isArray(r.json?.data), '');
    const usersTotal = Number(r.json?.pagination?.total || 0);
    check('users count ديناميكي بدون seed', Array.isArray(r.json?.data) && r.json.data.length <= usersTotal, `got ${r.json?.data?.length}`);
    check('users يحتوي pagination metadata', !!r.json?.pagination, '');
    check('pagination.total يعكس قاعدة البيانات الحالية', usersTotal >= 1, `${usersTotal}`);

    // Pagination headers
    r = await req('GET', '/api/users?page=1&limit=2', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/users?limit=2 يرجع حتى سجلين', r.json?.data?.length === Math.min(2, usersTotal), `got ${r.json?.data?.length}`);
    check('X-Total-Count header موجود', Number(r.headers['x-total-count']) === usersTotal, r.headers['x-total-count']);

    // GET single user by id
    r = await req('GET', '/api/users/1', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/users/1 يرجع السجل', r.status === 200, `(HTTP ${r.status})`);
    // NOTE: pg returns BIGINT as string; accept either "1" or 1
    check('user.id = 1', Number(r.json?.id) === 1, `${r.json?.id}`);
    check('user.username = admin', r.json?.username === 'admin', r.json?.username || '');

    // GET nonexistent id
    r = await req('GET', '/api/users/9999', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/users/9999 يرجع 404', r.status === 404, `(HTTP ${r.status})`);

    // POST create new user (admin only)
    r = await req('POST', '/api/users', {
        username: 'testuser_e2e',
        password: 'testpass123',
        role: 'employee',
        name: 'مستخدم اختبار',
        active: true
    }, { Authorization: `Bearer ${adminToken}` });
    check('POST /api/users ينشئ مستخدم (201)', r.status === 201, `(HTTP ${r.status}) ${r.json?.error || r.json?.message || ''}`);
    const newUserId = r.json?.id;
    check('المستخدم الجديد له id', !!newUserId, `${newUserId}`);

    // PUT update user
    if (newUserId) {
        r = await req('PUT', `/api/users/${newUserId}`, { name: 'مستخدم محدّث' }, { Authorization: `Bearer ${adminToken}` });
        check('PUT /api/users/:id يحدّث الاسم (200)', r.status === 200, `(HTTP ${r.status})`);
        check('الاسم ت حدّث', r.json?.name === 'مستخدم محدّث', r.json?.name || '');
    }

    // DELETE user
    if (newUserId) {
        r = await req('DELETE', `/api/users/${newUserId}`, null, { Authorization: `Bearer ${adminToken}` });
        check('DELETE /api/users/:id يحذف (200)', r.status === 200, `(HTTP ${r.status})`);
        // Verify deletion
        r = await req('GET', `/api/users/${newUserId}`, null, { Authorization: `Bearer ${adminToken}` });
        check('المستخدم المحذوف يرجع 404', r.status === 404, `(HTTP ${r.status})`);
    }

    // Schema whitelist protection: try to inject id
    r = await req('POST', '/api/users', {
        username: 'hacker',
        password: 'Invalid-Test-Password-000',
        role: 'admin',
        name: 'Hacker',
        active: true,
        id: 99999  // should be filtered out by schema whitelist
    }, { Authorization: `Bearer ${adminToken}` });
    check('Schema whitelist يمنع حقن id', r.status === 400, `(HTTP ${r.status})`);

    // ═══════════════════════════════════════════════════════
    // Phase 5: POS Module
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 5] POS Module${RESET}`);

    // List departments
    r = await req('GET', '/api/pos/departments', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/departments ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    check('pos departments تحتوي قسمًا نشطًا', Array.isArray(r.json) && r.json.length > 0, `${r.json?.length || 0} depts`);
    // pg returns BIGINT as string — parseInt for use as request body
    const deptId = parseInt(r.json?.[0]?.id, 10);

    // List products — may be empty when the catalog has not been configured yet.
    // Production mode intentionally does not insert demo catalog rows, so the
    // contract here is a successful array response rather than a fixed seed item.
    r = await req('GET', `/api/pos/products?department_id=${deptId}`, null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/products ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    check('products يرجع array', Array.isArray(r.json), `${r.json?.length || 0} products`);

        // Open shift — a running shift may already exist in a production database.
    r = await req('POST', '/api/pos/shifts/open', {
        department_id: deptId,
        opening_balance: 100.50
    }, { Authorization: `Bearer ${adminToken}` });
    const openedForTest = r.status === 201;
    check('فتح وردية جديدة أو استئناف وردية قائمة', r.status === 201 || r.status === 409, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    let sessionId = r.json?.session_id || null;

    // Try to open another shift for same cashier (should fail safely).
    r = await req('POST', '/api/pos/shifts/open', {
        department_id: deptId,
        opening_balance: 0
    }, { Authorization: `Bearer ${adminToken}` });
    check('فتح وردية مكررة يرجع 409', r.status === 409, `(HTTP ${r.status})`);

    // Get active shift and recover its session id when one was already open.
    r = await req('GET', '/api/pos/shifts/active', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/shifts/active ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    sessionId = sessionId || r.json?.id;

    // Get shift summary; only close a shift opened by this test.
    if (sessionId) {
        r = await req('GET', `/api/pos/shifts/${sessionId}/summary`, null, { Authorization: `Bearer ${adminToken}` });
        check('GET /api/pos/shifts/:id/summary ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
        check('summary يحتوي cash_in', r.json?.cash_in !== undefined, `${r.json?.cash_in}`);
        check('summary يحتوي invoice_count', r.json?.invoice_count !== undefined, `${r.json?.invoice_count}`);
        if (openedForTest) {
            r = await req('POST', `/api/pos/shifts/${sessionId}/close`, {
                actual_cash: 100.50,
                notes: 'إغلاق اختباري'
            }, { Authorization: `Bearer ${adminToken}` });
            check('POST /api/pos/shifts/:id/close ناجح (200)', r.status === 200, `(HTTP ${r.status}) ${r.json?.error || ''}`);
            check('closed shift يحتوي cash_variance', r.json?.cash_variance !== undefined, `${r.json?.cash_variance}`);
        }
    }

    // Dashboard
    r = await req('GET', '/api/pos/dashboard', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/dashboard ناجح (200)', r.status === 200, `(HTTP ${r.status})`);

    // ═══════════════════════════════════════════════════════
    // Phase 6: Delete state (cleanup)
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 6] تنظيف الحالة${RESET}`);
    r = await req('DELETE', '/api/state', null, { Authorization: `Bearer ${adminToken}` });
    check('DELETE /api/state ناجح (200)', r.status === 200, `(HTTP ${r.status})`);
    r = await req('GET', '/api/state', null, { Authorization: `Bearer ${adminToken}` });
    check('بعد الحذف، GET /api/state يرجع 404', r.status === 404, `(HTTP ${r.status})`);

    // ═══════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════
    console.log(`\n${BOLD}${PINK}═══════════════════════════════════════════════════════${RESET}`);
    const total = pass + fail;
    const pct = total > 0 ? Math.round(pass / total * 100) : 0;
    if (fail === 0) {
        console.log(`  ${GREEN}${BOLD}✅ جميع الفحوص التكاملية نجحت: ${pass}/${total} (100%)${RESET}`);
    } else {
        console.log(`  ${RED}${BOLD}✗ فشل ${fail} من ${total} (${pct}% نجاح)${RESET}`);
        console.log(`  ${RED}الفشل في:${RESET}`);
        for (const f of failures) {console.log(`    • ${f}`);}
    }
    console.log(`${BOLD}${PINK}═══════════════════════════════════════════════════════${RESET}\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
