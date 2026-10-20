'use strict';
/**
 * tests/integration/sale-cycle.js — دورة بيع كاملة على قاعدة الاختبار المعزولة
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 2.1 من خطة الإصلاح: إثبات المسار البيعي على خادم حقيقي + PostgreSQL
 * حقيقي — لا mocks.
 *
 * المشمول: دخول → وردية → سلة → خصم → دفع مجزأ → فاتورة → idempotency →
 *           مخزون → سجل → إلغاء بصلاحية → إقفال وردية → قيد الدفتر.
 *
 * التشغيل:
 *   node tests/integration/sale-cycle.js
 *
 * المتطلبات:
 *   · قاعدة معزولة باسم karim_erp_test على 127.0.0.1 (بياناتها من .env)
 *   · لا يعمل على أي قاعدة أخرى — الحارس أدناه يوقف التنفيذ فورًا.
 *
 * الأمان:
 *   · يكتب على karim_erp_test فقط (حارس إلزامي قبل أول اتصال).
 *   · يعمل على منفذ 5099 ولا يلمس خادم الإنتاج على 5000 إطلاقًا.
 *   · ينشئ مستخدمين اصطناعيين (sb_*) بكلمات مرور تُولَّد وقت التشغيل
 *     ولا تُطبع ولا تُحفظ في المستودع.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false });

const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const TEST_DB = 'karim_erp_test';
const PORT = Number(process.env.SANDBOX_PORT || 5099);
const BASE = `http://127.0.0.1:${PORT}`;
const DEPT_ID = 2;                      // erp_external_sales — له موقع POS
const DEPT_LOCATION = 5;                // POS-erp_external_sales
const MAIN_LOCATION = 1;                // MAIN-WAREHOUSE
const DISCOUNT_CAP_PERCENT = 10;        // سياسة الاختبار
const PRICE_OVERRIDE_CAP_PERCENT = 10;

const results = [];
let db = null;
let serverProc = null;
const state = {};

// ── helpers ───────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
function record(step, status, detail) {
    results.push({ step, status, detail });
    const mark = status === 'PASS' ? '✓' : status === 'SKIP' ? '–' : '✗';
    log(`  ${mark} ${step}${detail ? ` — ${detail}` : ''}`);
}
async function step(name, fn) {
    try {
        const detail = await fn();
        record(name, 'PASS', detail || '');
    } catch (err) {
        record(name, 'FAIL', err && err.message ? err.message : String(err));
        throw err;
    }
}
function assert(cond, message) { if (!cond) {throw new Error(message);} }

// ── 0) حارس العزل ────────────────────────────────────────────────────────
function assertIsolatedSandbox() {
    const host = String(process.env.DB_HOST || '127.0.0.1').toLowerCase();
    const name = process.env.DB_NAME;
    if (name !== TEST_DB) {throw new Error(`حراسة: DB_NAME=${name} — المسموح ${TEST_DB} فقط.`);}
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {throw new Error(`حراسة: DB_HOST=${host} — المسموح loopback فقط.`);}
    if (Number(process.env.PORT || 5000) === 5000) {throw new Error('حراسة: لا تعمل الدورة على منفذ الإنتاج 5000.');}
    assert(!process.env.DB_PASSWORD || String(process.env.DB_PASSWORD).length > 0, 'حراسة: DB_PASSWORD مفقود');
}

// ── 1) الاتصال والـ fixtures ──────────────────────────────────────────────
async function connect() {
    db = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: TEST_DB,
    });
    await db.connect();
}

async function ensureFixtures() {
    const password = crypto.randomBytes(24).toString('base64url');
    const hash = bcrypt.hashSync(password, 10);
    state.password = password;
    const users = [
        { username: 'sb_admin', role: 'admin', name: 'معتمد Sandbox' },
        { username: 'sb_manager', role: 'manager', name: 'مدير Sandbox' },
        { username: 'sb_cashier', role: 'cashier', name: 'كاشير Sandbox' },
    ];
    for (const u of users) {
        const exists = await db.query('SELECT id FROM users WHERE username = $1', [u.username]);
        if (exists.rows.length) {
            await db.query('UPDATE users SET password=$1, role=$2, active=true, must_change_password=false WHERE username=$3',
                [hash, u.role, u.username]);
        } else {
            // عمود id عمود identity — نترك القاعدة تولّده
            await db.query(`INSERT INTO users (username, password, role, name, active, must_change_password)
                VALUES ($1,$2,$3,$4,true,false)`, [u.username, hash, u.role, u.name]);
        }
    }

    // صنف اصطناعي بمخزون وصفة، لاختبار مسار المخزون فعليًا
    const INV_NAME = 'صنف اختباري Sandbox';
    const PROD_NAME = 'صنف اختبار Sandbox';
    let inv = await db.query('SELECT id FROM inventory WHERE name = $1', [INV_NAME]);
    if (!inv.rows.length) {
        const r = await db.query(`INSERT INTO inventory (name, category, unit, qty, "avgCost", "minQty", weight)
            VALUES ($1,'اختبار','كجم',100,10,0,0) RETURNING id`, [INV_NAME]);
        inv = r;
    }
    const invId = inv.rows[0].id;

    for (const loc of [DEPT_LOCATION, MAIN_LOCATION]) {
        const bal = await db.query('SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2', [invId, loc]);
        if (!bal.rows.length) {
            await db.query(`INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand, reserved)
                VALUES ($1,$2,100,0)`, [invId, loc]);
        } else {
            // إعادة تعبئة: الجولات المتكررة تستهلك المخزون، وبلا تعبئة يفشل
            // الاختبار في التشغيل الثاني لا الأول.
            await db.query(`UPDATE inventory_location_balances
                SET on_hand = GREATEST(on_hand, 100), reserved = 0
                WHERE inventory_id=$1 AND location_id=$2`, [invId, loc]);
        }
    }

    let prod = await db.query('SELECT id FROM pos_products WHERE name_ar = $1', [PROD_NAME]);
    if (!prod.rows.length) {
        const r = await db.query(`INSERT INTO pos_products (name_ar, name_en, department_id, price, cost_price, vat_rate, stock_quantity, is_active, unit)
            VALUES ($1,'Sandbox Test Item',$2,50,10,15,100,true,'كجم') RETURNING id`, [PROD_NAME, DEPT_ID]);
        prod = r;
    }
    const prodId = prod.rows[0].id;

    const recipe = await db.query(`SELECT rv.id FROM pos_recipe_versions rv
        JOIN pos_recipe_version_ingredients rvi ON rvi.recipe_version_id = rv.id
        WHERE rv.product_id = $1 AND rvi.inventory_id = $2 LIMIT 1`, [prodId, invId]);
    if (!recipe.rows.length) {
        await db.query(`INSERT INTO pos_recipe_versions (product_id, version_no, status, yield_qty, notes)
            VALUES ($1,1,'active',1,'وصفة اختبارية Sandbox')`, [prodId]);
        const rv = await db.query(`SELECT id FROM pos_recipe_versions WHERE product_id=$1 AND version_no=1`, [prodId]);
        await db.query(`INSERT INTO pos_recipe_version_ingredients (recipe_version_id, inventory_id, quantity_per_yield, unit, waste_percent)
            VALUES ($1,$2,1,'كجم',0)`, [rv.rows[0].id, invId]);
    }
    state.productId = prodId;
    state.inventoryId = invId;

    // قابلية إعادة التشغيل: أي وردية مفتوحة لكاشير الاختبار تُغلق،
    // ويُزال إقفال اليوم إن وُجد (يمنع رفض فتح وردية جديدة).
    const cashierRow = await db.query('SELECT id FROM users WHERE username = $1', ['sb_cashier']);
    if (cashierRow.rows.length) {
        await db.query(`UPDATE pos_shift_sessions SET status='closed', closed_at=NOW()
            WHERE cashier_id=$1 AND status='open'`, [cashierRow.rows[0].id]);
    }
    await db.query(`DELETE FROM pos_day_closes WHERE close_date = CURRENT_DATE`);
}

// ── 2) تشغيل الخادم على منفذ معزول ───────────────────────────────────────
async function startServer() {
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DB_NAME: TEST_DB,
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: process.env.DB_PORT || '5432',
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || '',
        JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
        JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
        API_KEY: crypto.randomBytes(24).toString('base64url'),
        SKIP_BULLMQ: 'true',
        ZATCA_ENABLED: 'false',
        // في الـ sandbox نستخدم HTTP صريح: مفاتيح SSL في .env يخصّ الإنتاج،
        // والسماح لها هنا يجعل الاختبار يتصل بـTLS بشهادة غير موثوقة.
        SSL_KEY: '',
        SSL_CERT: '',
        SALE_DISCOUNT_MAX_PERCENT: String(DISCOUNT_CAP_PERCENT),
        SALE_PRICE_OVERRIDE_MAX_PERCENT: String(PRICE_OVERRIDE_CAP_PERCENT),
        SALE_DISCOUNT_APPROVER_ROLES: 'manager,admin',
        LOG_LEVEL: 'warn',
    };
    const serverLog = [];
    serverProc = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', (d) => { serverLog.push(String(d)); });
    serverProc.stderr.on('data', (d) => { serverLog.push(String(d)); });
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (res.ok) {return;}
        } catch (_) { /* لم يبدأ بعد */ }
        if (serverProc.exitCode !== null) {
            throw new Error(`الخادم توقف (code=${serverProc.exitCode})\n--- مخرجات الخادم ---\n${serverLog.join('').slice(-3000)}`);
        }
    }
    throw new Error(`الخادم لم يستجب على /api/health خلال 45 ثانية\n--- مخرجات الخادم ---\n${serverLog.join('').slice(-3000)}`);
}
function stopServer() {
    if (serverProc && serverProc.exitCode === null) { try { serverProc.kill('SIGTERM'); } catch (_) {} }
}

// ── 3) عميل HTTP ──────────────────────────────────────────────────────────
async function api(method, urlPath, { token, body, idem, shift, appKey, headers: extraHeaders } = {}) {
    const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
    if (token) {headers.Authorization = `Bearer ${token}`;}
    if (idem) {headers['Idempotency-Key'] = idem;}
    if (shift) {headers['X-Shift-Session-Id'] = String(shift);}
    if (appKey) {headers['x-api-key'] = appKey;}
    const res = await fetch(`${BASE}${urlPath}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: json };
}

// ── الدورة ───────────────────────────────────────────────────────────────
async function run() {
    log('\n=== دورة بيع كاملة — قاعدة معزولة ===\n');
    assertIsolatedSandbox();
    log(`العزل: قاعدة=${TEST_DB} منفذ=${PORT} (خادم الإنتاج على 5000 لا يُلمس)`);

    await connect();
    log('✓ اتصال بقاعدة الاختبار');

    await ensureFixtures();
    log('✓ fixtures اصطناعية جاهزة (مستخدمون + صنف بمخزون ووصفة)');

    await startServer();
    log('✓ الخادم يعمل على المنفذ المعزول\n');

    // (أ) الدخول
    const tokens = {};
    await step('دخول الأدوار الثلاثة', async () => {
        for (const [key, user] of Object.entries({ admin: 'sb_admin', manager: 'sb_manager', cashier: 'sb_cashier' })) {
            const res = await api('POST', '/api/auth/login', { body: { username: user, password: state.password } });
            assert(res.status === 200, `دخول ${user} فشل (${res.status}) ${JSON.stringify(res.body).slice(0, 120)}`);
            assert(res.body.access_token, `لا access_token لـ ${user}`);
            tokens[key] = res.body.access_token;
            state.appKey = res.body.app_key || null;
        }
        return 'admin + manager + cashier';
    });

    // (ب) فتح وردية
    await step('فتح وردية (opening_balance=500)', async () => {
        const res = await api('POST', '/api/pos/shifts/open', {
            token: tokens.cashier, appKey: state.appKey,
            body: { department_id: DEPT_ID, opening_balance: 500, force: true },
        });
        assert([200, 201].includes(res.status), `فشل فتح الوردية (${res.status}) ${JSON.stringify(res.body).slice(0, 160)}`);
        state.sessionId = res.body.session_id || res.body.session?.id;
        assert(state.sessionId, 'لا session_id في الرد');
        return `session=${state.sessionId}`;
    });

    // (ج) الأصناف
    await step('قراءة أصناف نقطة البيع', async () => {
        const res = await api('GET', `/api/pos/products?department_id=${DEPT_ID}`, { token: tokens.cashier, appKey: state.appKey });
        assert(res.status === 200, `فشل读取 الأصناف (${res.status})`);
        const rows = Array.isArray(res.body) ? res.body : (res.body.products || []);
        assert(rows.length > 0, 'لا أصناف');
        // نبيع الصنف الاختباري (له وصفة ومخزون) — الأصناف الأخرى بلا وصفة
        // فهي أصناف خدمة بلا حركة مخزون، ولا تُثبت مسار الاستهلاك.
        const fixture = await db.query('SELECT id, name_ar, price, vat_rate FROM pos_products WHERE id=$1', [state.productId]);
        assert(fixture.rows.length, 'الصنف الاختباري مفقود');
        state.product = fixture.rows[0];
        state.listedProducts = rows.length;
        return `${rows.length} صنف معروض — المختار للبيع: ${state.product.name_ar} @ ${state.product.price}`;
    });

    const unitPrice = Number(state.product.price);
    const vatRate = Number(state.product.vat_rate ?? 15);
    // المجاميع على الخادم: lineTotal = (سعر × كمية) − خصم، ثم ضريبة 15% عليها.
    const amounts = (quantity, discountAmount) => {
        const lineTotal = Number((unitPrice * quantity - discountAmount).toFixed(2));
        const vat = Number((lineTotal * vatRate / 100).toFixed(2));
        return { lineTotal, vat, total: Number((lineTotal + vat).toFixed(2)) };
    };
    const qty = 2;
    const gross = Number((unitPrice * qty).toFixed(2));
    const lineDiscount = Number((gross * 0.05).toFixed(2)); // 5% ضمن الحد (10%)

    // (د) فاتورة بخصم ضمن الحد
    let orderId = null;
    await step('فاتورة: سلة + خصم 5% (ضمن الحد) + دفع نقدي', async () => {
        const amt = amounts(qty, lineDiscount);
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.cashier, appKey: state.appKey, shift: state.sessionId,
            idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: qty, unit_price: unitPrice, discount: lineDiscount }],
                payments: [{ method: 'cash', amount: amt.total }],
            },
        });
        assert(res.status === 201, `فشل البيع (${res.status}) ${JSON.stringify(res.body).slice(0, 220)}`);
        orderId = res.body.order_id;
        state.orderId = orderId;
        assert(Number(res.body.subtotal) === amt.lineTotal, `المجموع غير متوقع: ${res.body.subtotal} != ${amt.lineTotal}`);
        assert(Number(res.body.discount_total) === lineDiscount, `الخصم غير متوقع: ${res.body.discount_total}`);
        assert(Number(res.body.tax_total) === amt.vat, `الضريبة غير متوقعة: ${res.body.tax_total} != ${amt.vat}`);
        return `order=${orderId} subtotal=${res.body.subtotal} discount=${res.body.discount_total} vat=${res.body.tax_total} total=${res.body.total_amount}`;
    });

    // (هـ) idempotency
    await step('idempotency: نفس المفتاح ونفس الجسم → نفس الفاتورة بلا تكرار', async () => {
        const key = crypto.randomUUID();
        const amt = amounts(1, 0);
        const body = {
            department_id: DEPT_ID,
            items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: 0 }],
            payments: [{ method: 'cash', amount: amt.total }],
        };
        const first = await api('POST', '/api/sales/complete', { token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: key, body });
        assert(first.status === 201, `الطلب الأول فشل (${first.status}) ${JSON.stringify(first.body).slice(0, 160)}`);
        const second = await api('POST', '/api/sales/complete', { token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: key, body });
        assert(second.status === 201, `إعادة الطلب أعادت ${second.status} بدل 201`);
        assert(second.body.order_id === first.body.order_id, `فاتورة مختلفة: ${second.body.order_id} != ${first.body.order_id}`);
        const counted = await db.query('SELECT count(*)::int AS n FROM pos_orders WHERE id = $1', [first.body.order_id]);
        assert(counted.rows[0].n === 1, 'تكرّرت الفاتورة في القاعدة');
        state.idemOrderId = first.body.order_id;
        return `order=${first.body.order_id} (صف واحد فقط)`;
    });

    // (و) دفع مجزأ
    await step('دفع مجزأ: نقد + بطاقة', async () => {
        const amt = amounts(1, 0);
        const cashPart = Number((amt.total / 2).toFixed(2));
        const cardPart = Number((amt.total - cashPart).toFixed(2));
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: 0 }],
                payments: [{ method: 'cash', amount: cashPart }, { method: 'card', amount: cardPart }],
            },
        });
        assert(res.status === 201, `فشل الدفع المجزأ (${res.status}) ${JSON.stringify(res.body).slice(0, 200)}`);
        const rows = await db.query(`SELECT method, direction, amount FROM pos_invoice_payments WHERE order_id=$1 ORDER BY method`, [res.body.order_id]);
        // العمود direction نوعه CHAR — التخزين يضيف مسافة زائدة ("in ").
        // مقارنة SQL تتجاهلها، لكن مقارنة JS لا تتجاهلها.
        const ins = rows.rows.filter((r) => String(r.direction).trim() === 'in');
        assert(ins.length === 2, `عدد صفوف الدفع ${ins.length} بدل 2 (order=${res.body.order_id} rows=${JSON.stringify(rows.rows)})`);
        state.splitOrderId = res.body.order_id;
        return `order=${res.body.order_id} methods=${ins.map((r) => `${r.method}:${r.amount}`).join('+')}`;
    });

    // (ز) زيادة بالبطاقة — لا خروج نقدي
    await step('زيادة دفع بالبطاقة: لا يُسجَّل خروج نقدي (فحص الدرج)', async () => {
        const amt = amounts(1, 0);
        const over = Number((amt.total + 25).toFixed(2));
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: 0 }],
                payments: [{ method: 'card', amount: over }],
            },
        });
        assert(res.status === 201, `فشل البيع (${res.status}) ${JSON.stringify(res.body).slice(0, 200)}`);
        const outs = await db.query(`SELECT method, amount FROM pos_invoice_payments WHERE order_id=$1 AND direction='out'`, [res.body.order_id]);
        assert(outs.rows.length === 0, `وُجد صف خروج نقدي ${JSON.stringify(outs.rows)} — خطأ في حس�� الدرج`);
        assert(Number(res.body.change) === 0, `change=${res.body.change} بدل 0`);
        assert(Number(res.body.non_cash_overpayment) === 25, `non_cash_overpayment=${res.body.non_cash_overpayment} بدل 25`);
        return `order=${res.body.order_id} change=0 overpayment=25 بلا صف cash/out`;
    });

    // (ح) خصم يتجاوز الحد — رفض
    await step('خصم 50% يتجاوز حد 10% → 403 رفض', async () => {
        const bigDiscount = Number((unitPrice * 0.5).toFixed(2));
        const amt = amounts(1, bigDiscount);
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: bigDiscount }],
                payments: [{ method: 'cash', amount: amt.total }],
            },
        });
        assert(res.status === 403, `توقع 403 لكن ورد ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        assert(res.body.error === 'DISCOUNT_APPROVAL_REQUIRED', `رمز الخطأ ${res.body.error}`);
        return 'DISCOUNT_APPROVAL_REQUIRED';
    });

    // (خ) تجاوز بدور معتمد + سجل تدقيق
    await step('مدير يتجاوز الحد + تسجيل في pos_audit_logs', async () => {
        const bigDiscount = Number((unitPrice * 0.5).toFixed(2));
        const amt = amounts(1, bigDiscount);
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.manager, appKey: state.appKey, shift: state.sessionId, idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: bigDiscount }],
                payments: [{ method: 'cash', amount: amt.total }],
            },
        });
        assert(res.status === 201, `فشل بيع المدير (${res.status}) ${JSON.stringify(res.body).slice(0, 200)}`);
        const audit = await db.query(`SELECT action, actor_role FROM pos_audit_logs WHERE action='PRICE_OVERRIDE' AND row_pk=$1`, [res.body.order_id]);
        assert(audit.rows.length >= 1, 'لا سجل تدقيق PRICE_OVERRIDE');
        state.managerOrderId = res.body.order_id;
        return `order=${res.body.order_id} audit=${audit.rows.length} دور=${audit.rows[0].actor_role}`;
    });

    // (د) المخزون
    await step('المخزون: نقص في دفتر المخزون + حركة pos_stock_movements', async () => {
        const before = await db.query('SELECT COALESCE(SUM(on_hand),0)::numeric AS t FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2', [state.inventoryId, DEPT_LOCATION]);
        const beforeQty = Number(before.rows[0].t);
        const res = await api('POST', '/api/sales/complete', {
            token: tokens.cashier, appKey: state.appKey, shift: state.sessionId, idem: crypto.randomUUID(),
            body: {
                department_id: DEPT_ID,
                items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: 0 }],
                payments: [{ method: 'cash', amount: amounts(1, 0).total }],
            },
        });
        assert(res.status === 201, `فشل بيع المخزون (${res.status}) ${JSON.stringify(res.body).slice(0, 200)}`);
        const after = await db.query('SELECT COALESCE(SUM(on_hand),0)::numeric AS t FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2', [state.inventoryId, DEPT_LOCATION]);
        const afterQty = Number(after.rows[0].t);
        const moves = await db.query('SELECT count(*)::int AS n FROM pos_stock_movements WHERE order_id=$1', [res.body.order_id]);
        assert(afterQty < beforeQty, `الرصيد لم ينقص (${beforeQty} → ${afterQty})`);
        assert(moves.rows[0].n >= 1, 'لا حركة pos_stock_movements');
        return `الرصيد ${beforeQty} → ${afterQty} حركات=${moves.rows[0].n}`;
    });

    // (ذ) سجل الفواتير
    await step('سجل الفواتير يعرض الفاتورة', async () => {
        const res = await api('GET', `/api/pos/orders?limit=20`, { token: tokens.cashier, appKey: state.appKey });
        assert(res.status === 200, `فشل السجل (${res.status})`);
        const rows = Array.isArray(res.body) ? res.body : (res.body.orders || res.body.data || []);
        assert(rows.some((r) => String(r.id) === String(state.orderId)), 'الفاتورة غير موجودة في السجل');
        return `${rows.length} فاتورة معروضة`;
    });

    // (ر) إلغاء بصلاحية
    await step('إلغاء: كاشير → 403، مدير → 200 + عكس المخزون', async () => {
        const before = await db.query('SELECT COALESCE(SUM(on_hand),0)::numeric AS t FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2', [state.inventoryId, DEPT_LOCATION]);
        const denied = await api('POST', `/api/pos/orders/${state.orderId}/void`, { token: tokens.cashier, appKey: state.appKey, body: { reason: 'اختبار صلاحية' } });
        assert(denied.status === 403, `توقع 403 للكاشير لكن ورد ${denied.status}`);
        const allowed = await api('POST', `/api/pos/orders/${state.orderId}/void`, { token: tokens.manager, appKey: state.appKey, body: { reason: 'اختبار إلغاء manager' } });
        assert(allowed.status === 200, `فشل إلغاء المدير (${allowed.status}) ${JSON.stringify(allowed.body).slice(0, 160)}`);
        const after = await db.query('SELECT COALESCE(SUM(on_hand),0)::numeric AS t FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2', [state.inventoryId, DEPT_LOCATION]);
        assert(Number(after.rows[0].t) > Number(before.rows[0].t), 'المخزون لم يُعكس بعد الإلغاء');
        return `كاشير=403 مدير=200 رصيد ${before.rows[0].t} → ${after.rows[0].t}`;
    });

    // (ش) قيد الدفتر المالي بتاريخ الرياض
    await step('قيد الدفتر المالي مسجَّل بتاريخ الرياض', async () => {
        const row = await db.query(`SELECT date FROM journal_entries WHERE source_type='pos_sale' AND source_id=$1`, [state.splitOrderId]);
        if (!row.rows.length) { throw new Error('لا قيد pos_sale للفاتورة'); }
        // عمود date نوعه DATE — pg يرجّعه كـDate عند منتصف الليل المحلي،
        // فنقرأ تاريخه بالparts المحلية (لا toISOString — ينزلق يومًا).
        const asDay = (v) => (v instanceof Date
            ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
            : String(v).slice(0, 10));
        const expected = await db.query(`SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') AS d FROM pos_orders WHERE id=$1`, [state.splitOrderId]);
        assert(asDay(row.rows[0].date) === expected.rows[0].d, `تاريخ القيد ${asDay(row.rows[0].date)} != يوم الرياض ${expected.rows[0].d}`);
        return `date=${asDay(row.rows[0].date)} (يوم الرياض مطابق)`;
    });

    // (ض) قياس القناة على خادم حقيقي — قبل إقفال الوردية (البيع يحتاج وردية مفتوحة)
    await step('قياس قناة POS: Referer يحدّد القناة في ملف القياس', async () => {
        const saleWith = async (referer) => {
            const amt = amounts(1, 0);
            return api('POST', '/api/sales/complete', {
                token: tokens.cashier, appKey: state.appKey, shift: state.sessionId,
                idem: crypto.randomUUID(),
                headers: { Referer: referer },
                body: {
                    department_id: DEPT_ID,
                    items: [{ product_id: Number(state.product.id), quantity: 1, unit_price: unitPrice, discount: 0 }],
                    payments: [{ method: 'cash', amount: amt.total }],
                },
            });
        };
        const r1 = await saleWith(`http://127.0.0.1:${PORT}/app/pos.html`);
        assert(r1.status === 201, `بيع pos فشل (${r1.status}) ${JSON.stringify(r1.body).slice(0, 120)}`);
        const r2 = await saleWith(`http://127.0.0.1:${PORT}/app/cashier/`);
        assert(r2.status === 201, `بيع cashier فشل (${r2.status})`);
        const r3 = await saleWith(`http://127.0.0.1:${PORT}/app/v2.html?live=1`);
        assert(r3.status === 201, `بيع v2 فشل (${r3.status})`);

        // ننتظر دورة الكتابة (5 ثوانٍ) ثم نقرأ الملف
        const logDir = path.join(ROOT, 'logs');
        let file = null;
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const day = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date());
            const candidate = path.join(logDir, `pos-channel-usage-${day}.json`);
            if (fs.existsSync(candidate)) {
                const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (data.channels.pos.sales >= 1 && data.channels.cashier.sales >= 1 && data.channels['v2-embedded'].sales >= 1) {
                    file = { path: candidate, data };
                    break;
                }
            }
        }
        assert(file, 'ملف القياس لم يُنتج القنوات الثلاث');
        const c = file.data.channels;
        assert(c.pos.sales >= 1, `pos.sales=${c.pos.sales}`);
        assert(c.cashier.sales >= 1, `cashier.sales=${c.cashier.sales}`);
        assert(c['v2-embedded'].sales >= 1, `v2-embedded.sales=${c['v2-embedded'].sales}`);
        return `pos=${c.pos.sales} cashier=${c.cashier.sales} v2-embedded=${c['v2-embedded'].sales} (${path.basename(file.path)})`;
    });

    // (ض) إقفال الوردية وحساب النقد المتوقع
    await step('إقفال الوردية: النقد المتوقع = افتتاح + نقد داخل − نقد خارج', async () => {
        const res = await api('POST', `/api/pos/shifts/${state.sessionId}/close`, {
            token: tokens.cashier, appKey: state.appKey, body: { actual_cash: 500 },
        });
        assert(res.status === 200, `فشل الإقفال (${res.status}) ${JSON.stringify(res.body).slice(0, 200)}`);
        const sums = await db.query(`SELECT
                COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)
              - COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) AS net
            FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id=$1`, [state.sessionId]);
        const expected = Number((500 + Number(sums.rows[0].net)).toFixed(2));
        const sess = await db.query('SELECT expected_cash, actual_cash, cash_variance FROM pos_shift_sessions WHERE id=$1', [state.sessionId]);
        assert(Number(sess.rows[0].expected_cash) === expected, `النقد المتوقع ${sess.rows[0].expected_cash} != ${expected}`);
        return `expected_cash=${sess.rows[0].expected_cash} actual=${sess.rows[0].actual_cash} variance=${sess.rows[0].cash_variance}`;
    });

    // (ط) ممنوع على غير الدور
    await step('حماية: orders-routes محجوب عن غير admin', async () => {
        const res = await api('POST', '/api/orders', {
            token: tokens.cashier, appKey: state.appKey,
            body: { items: [{ product_name: 'اختبار', quantity: 1, unit_price: 10 }] },
        });
        assert(res.status === 403, `توقع 403 لكن ورد ${res.status}`);
        return '403 كما هو مطلوب';
    });

    // (ق) استمرارية إعدادات الواجهة + سياسة توحيد المسار
    await step('إعدادات الواجهة تُحفظ فعليًا (لا تُسقَط بصمت)', async () => {
        const payload = {
            name: 'مطاعم الشرفه العالمي',
            currency: 'SAR',
            workStartHour: 9,
            opening_balance_visible: false,
            pos_legacy_mode: 'banner',
            pos_official_path: '/app/cashier/',
        };
        const save = await api('PUT', '/api/settings/main_settings', {
            token: tokens.admin, appKey: state.appKey, body: payload,
        });
        assert([200, 201].includes(save.status), `فشل حفظ الإعدادات (${save.status}) ${JSON.stringify(save.body).slice(0, 160)}`);
        // نقرأ من القاعدة مباشرة — لا من ردّ الحفظ (الرد قد لا يعكس ما حُفظ)
        const row = await db.query(`SELECT opening_balance_visible, pos_legacy_mode, pos_official_path
            FROM settings WHERE id='main_settings'`);
        const r = row.rows[0] || {};
        assert(r.opening_balance_visible === false, `opening_balance_visible=${r.opening_balance_visible} (لم يُحفظ)`);
        assert(r.pos_legacy_mode === 'banner', `pos_legacy_mode=${r.pos_legacy_mode} (لم يُحفظ)`);
        assert(r.pos_official_path === '/app/cashier/', `pos_official_path=${r.pos_official_path} (لم يُحفظ)`);
        // السياسة العامة (بلا مصادقة) تعكس ما حُفظ
        const policy = await api('GET', '/api/pos/path-policy');
        assert(policy.status === 200, `.policy ${policy.status}`);
        assert(policy.body.policy.mode === 'banner', `mode=${policy.body.policy.mode}`);
        assert(policy.body.policy.path === '/app/cashier/', `path=${policy.body.policy.path}`);
        // إعادة الوضع الافتراضي (off) حتى لا تتأثر بقية الجولات
        await api('PUT', '/api/settings/main_settings', {
            token: tokens.admin, appKey: state.appKey,
            body: { ...payload, opening_balance_visible: true, pos_legacy_mode: 'off', pos_official_path: '' },
        });
        const back = await db.query(`SELECT pos_legacy_mode FROM settings WHERE id='main_settings'`);
        assert(back.rows[0].pos_legacy_mode === 'off', `لم يُرجَع الوضع إلى off`);
        return 'حُفظت الحقول الثلاثة وظهرت في السياسة العامة (banner)';
    });

    return results;
}

// ── التنفيذ ───────────────────────────────────────────────────────────────
(async () => {
    let failed = 0;
    try {
        await run();
    } catch (err) {
        failed = 1;
        log(`\n✗ توقفت الدورة: ${err && err.message ? err.message : err}`);
    } finally {
        stopServer();
        if (db) { try { await db.end(); } catch (_) {} }
    }
    const passed = results.filter((r) => r.status === 'PASS').length;
    const skipped = results.filter((r) => r.status === 'SKIP').length;
    const bad = results.filter((r) => r.status === 'FAIL').length;
    log('\n=== ملخص دورة البيع ===');
    for (const r of results) {
        log(`  ${r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '–' : '✗'} ${r.step}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    log(`\nنجح ${passed} · فشل ${bad} · متجاوز ${skipped}`);
    process.exit(failed || bad ? 1 : 0);
})();
