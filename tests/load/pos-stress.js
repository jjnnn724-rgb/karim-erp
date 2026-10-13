#!/usr/bin/env node
/**
 * tests/load/pos-stress.js — اختبار ضغط عالي مركز على الكاشير (POS)
 * ─────────────────────────────────────────────────────────────────────────────
 * يُشغَّل ضد نسخة معزولة (قاعدة اختبار) — ليس ضد الإنتاج أبدًا:
 *   set TEST_PORT=5001& set TEST_PROTOCOL=https& set KARIM_TEST_DB_NAME=karim_erp_test& set KARIM_TEST_PASSWORD=...& node tests/load/pos-stress.js
 *
 * السيناريوهات:
 *   1) reads        — قراءة متزامنة كثيفة على نقاط الكاشير
 *   2) sales        — مبيعات حقيقية متزامنة (complete-sale) بمعرفات idempotency فريدة
 *   3) idem-storm   — نفس مفتاح Idempotency يُطلق N مرة متزامنة: أمر واحد فقط يُنشأ
 *   4) history      — تصفح سجل الطلبات الثقيل تحت حمل
 *   5) login-storm  — عاصفة دخول (قياس محدد المعدل)
 *
 * المخرجات: ملخص RPS/p50/p90/p95/p99 + توزيع الحالات + أخطاء، ويُكتب JSON اختياريًا (--out).
 */
'use strict';

const https = require('https');
const fs = require('fs');
const { Client } = require('pg');

const HOST = process.env.TEST_HOST || '127.0.0.1';
const PORT = Number(process.env.TEST_PORT || 5001);
const PROTOCOL = String(process.env.TEST_PROTOCOL || 'https');
const BASE = `${PROTOCOL}://${HOST}:${PORT}`;
const DB_NAME = String(process.env.KARIM_TEST_DB_NAME || '');
const ADMIN_PASS = process.env.KARIM_TEST_PASSWORD || '';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const SALES_CONC = Number(arg('sales-conc', 20));
const SALES_SECS = Number(arg('sales-secs', 45));
const READS_CONC = Number(arg('reads-conc', 40));
const READS_SECS = Number(arg('reads-secs', 30));
const IDEM_BURST = Number(arg('idem-burst', 50));
const LOGIN_SECS = Number(arg('login-secs', 12));
const OUT = arg('out', null);

if (!DB_NAME || DB_NAME === 'karim_erp') {
    console.error('REFUSING: KARIM_TEST_DB_NAME must name a disposable test database (not karim_erp).');
    process.exit(1);
}

const agent = new https.Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false });
function request(method, p, { token, body, headers } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const started = process.hrtime.bigint();
        const req = https.request(BASE + p, {
            method,
            agent,
            rejectUnauthorized: false,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
                ...(APP_KEY ? { 'x-api-key': APP_KEY } : {}),
                ...(headers || {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                const ms = Number(process.hrtime.bigint() - started) / 1e6;
                resolve({ ms, status: res.statusCode, text: raw, bytes: Buffer.byteLength(raw) });
            });
        });
        req.on('timeout', () => { req.destroy(new Error('CLIENT_TIMEOUT')); });
        req.on('error', (e) => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            resolve({ ms, status: 0, error: e.message, text: '', bytes: 0 });
        });
        if (data) {req.write(data);}
        req.end();
    });
}

let TOKEN = null; let APP_KEY = null;
let DEPT_ID = null; let SESSION_ID = null; const PRINTER_ID = 'stress-pos-1';

function newStats() { return { requests: 0, byStatus: {}, byEndpoint: {}, errors: {}, latencies: [], bytes: 0 }; }
function record(stats, ep, r) {
    stats.requests++;
    stats.bytes += r.bytes || 0;
    const sk = r.status === 0 ? 'network_error' : String(r.status);
    stats.byStatus[sk] = (stats.byStatus[sk] || 0) + 1;
    if (r.status === 0) { stats.errors[r.error || 'unknown'] = (stats.errors[r.error || 'unknown'] || 0) + 1; }
    const e = stats.byEndpoint[ep] || (stats.byEndpoint[ep] = { requests: 0, latencies: [], byStatus: {} });
    e.requests++; e.latencies.push(r.ms);
    e.byStatus[sk] = (e.byStatus[sk] || 0) + 1;
    stats.latencies.push(r.ms);
}
function pct(sorted, p) {
    if (!sorted.length) { return 0; }
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[i] * 10) / 10;
}
function summarize(stats, durationMs, label) {
    const lat = stats.latencies.slice().sort((a, b) => a - b);
    const secs = durationMs / 1000;
    return {
        label, requests: stats.requests,
        rps: Math.round((stats.requests / secs) * 10) / 10,
        duration_s: Math.round(secs * 10) / 10,
        p50: pct(lat, 50), p90: pct(lat, 90), p95: pct(lat, 95), p99: pct(lat, 99), max: pct(lat, 100),
        byStatus: stats.byStatus,
        errors: stats.errors,
        byEndpoint: Object.fromEntries(Object.entries(stats.byEndpoint).map(([k, v]) => {
            const l = v.latencies.sort((a, b) => a - b);
            return [k, { requests: v.requests, rps: Math.round((v.requests / secs) * 10) / 10, p50: pct(l, 50), p95: pct(l, 95), p99: pct(l, 99), byStatus: v.byStatus }];
        })),
    };
}

async function login() {
    const r = await request('POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASS } });
    if (r.status !== 200) { throw new Error('login failed: HTTP ' + r.status + ' ' + r.text.slice(0, 120)); }
    const j = JSON.parse(r.text);
    TOKEN = j.access_token; APP_KEY = j.app_key || j.appKey || null;
    return j;
}

async function main() {
    console.log(`POS STRESS → ${BASE} (db=${DB_NAME})`);
    console.log(`params: sales-conc=${SALES_CONC} sales-secs=${SALES_SECS} reads-conc=${READS_CONC} idem-burst=${IDEM_BURST}`);
    await login();

    // ── تجهيز: قسم + منتجات ضغط + وردية مفتوحة ──
    const deps = JSON.parse((await request('GET', '/api/pos/departments')).text);
    const depArr = Array.isArray(deps) ? deps : (deps.items || deps.data || []);
    const dep = depArr.find(d => d.code === 'malaysian') || depArr[0];
    DEPT_ID = Number(dep.id);
    console.log(`department: ${dep.name_ar || dep.name || dep.id} (#${DEPT_ID})`);

    const db = new Client({
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
        database: DB_NAME, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '',
    });
    await db.connect();

    const stamp = 'STRESS-' + Date.now();
    const PRODUCT_COUNT = Math.max(SALES_CONC, 10);
    const productIds = [];
    for (let i = 0; i < PRODUCT_COUNT; i++) {
        const r = await db.query(
            `INSERT INTO pos_products (name_ar, barcode, price, stock_quantity, unit, category, is_active)
             VALUES ($1, $2, 100, 1000000, 'وحدة', 'ضغط', true) RETURNING id`,
            [stamp + ' صنف ' + i, stamp + '-' + i]);
        productIds.push(Number(r.rows[0].id));
    }
    console.log(`products created: ${productIds.length}`);

    const open = await request('POST', '/api/pos/shifts/open', { body: { department_id: DEPT_ID, opening_balance: 1000, new_session: true } });
    if (open.status !== 201 && open.status !== 200) { throw new Error('shift open failed: ' + open.status + ' ' + open.text.slice(0, 150)); }
    SESSION_ID = Number(JSON.parse(open.text).session_id);
    console.log(`shift session: #${SESSION_ID}`);

    const results = {};

    // ═══ 1) قراءات متزامنة ═══
    {
        const eps = [
            '/api/pos/departments',
            '/api/pos/products?limit=50&department_id=' + DEPT_ID,
            '/api/pos/shifts/active',
            '/api/pos/orders?limit=20',
            '/api/pos/orders/stats/today',
            '/api/pos/dashboard',
        ];
        const stats = newStats();
        const t0 = Date.now();
        const workers = Array.from({ length: READS_CONC }, async () => {
            while (Date.now() - t0 < READS_SECS * 1000) {
                const ep = eps[Math.floor(Math.random() * eps.length)];
                record(stats, ep, await request('GET', ep));
            }
        });
        await Promise.all(workers);
        results.reads = summarize(stats, Date.now() - t0, `reads c${READS_CONC}`);
        console.log('\n[1/5] READS:', JSON.stringify({ rps: results.reads.rps, p50: results.reads.p50, p95: results.reads.p95, p99: results.reads.p99, byStatus: results.reads.byStatus }));
    }

    // ═══ 2) مبيعات متزامنة حقيقية ═══
    {
        const stats = newStats();
        let seq = 0;
        const t0 = Date.now();
        const workers = Array.from({ length: SALES_CONC }, async () => {
            while (Date.now() - t0 < SALES_SECS * 1000) {
                const pid = productIds[seq % productIds.length]; seq++;
                const key = `stress-${stamp}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                const r = await request('POST', '/api/sales/complete', {
                    body: {
                        department_id: DEPT_ID,
                        items: [{ product_id: pid, quantity: 1, unit_price: 100, discount: 0 }],
                        payments: [{ method: 'cash', amount: 115 }],
                        printer_id: PRINTER_ID,
                        session_id: SESSION_ID,
                    },
                    headers: { 'Idempotency-Key': key, 'X-Shift-Session-Id': String(SESSION_ID) },
                });
                record(stats, 'POST /api/sales/complete', r);
                if (r.status !== 201 && !global.__printedOnce) {
                    global.__printedOnce = true;
                    console.log('  sample non-201:', r.status, r.text.slice(0, 220));
                }
            }
        });
        await Promise.all(workers);
        results.sales = summarize(stats, Date.now() - t0, `sales c${SALES_CONC}`);
        console.log('\n[2/5] SALES:', JSON.stringify({ rps: results.sales.rps, p50: results.sales.p50, p95: results.sales.p95, p99: results.sales.p99, byStatus: results.sales.byStatus, errors: results.sales.errors }));
    }

    // ═══ 3) عاصفة Idempotency: نفس المفتاح × N متزامن ═══
    {
        const key = `stress-idem-${stamp}`;
        const payload = {
            department_id: DEPT_ID,
            items: [{ product_id: productIds[0], quantity: 1, unit_price: 100, discount: 0 }],
            payments: [{ method: 'cash', amount: 115 }],
            printer_id: PRINTER_ID,
            session_id: SESSION_ID,
        };
        const t0 = Date.now();
        const rs = await Promise.all(Array.from({ length: IDEM_BURST }, () =>
            request('POST', '/api/sales/complete', { body: payload, headers: { 'Idempotency-Key': key, 'X-Shift-Session-Id': String(SESSION_ID) } })));
        const byStatus = {}; rs.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
        const orderIds = new Set(rs.map(r => { try { return JSON.parse(r.text).order_id; } catch (_) { return null; } }).filter(Boolean));
        const dbCount = await db.query(`SELECT count(*)::int AS c FROM pos_idempotency_keys WHERE key = $1`, [key]);
        results.idemStorm = { burst: IDEM_BURST, byStatus, distinctOrderIds: orderIds.size, idempotencyRows: dbCount.rows[0].c, ms: Date.now() - t0 };
        console.log('\n[3/5] IDEM-STORM:', JSON.stringify(results.idemStorm));
    }

    // ═══ 4) سجل الطلبات الثقيل تحت حمل ═══
    {
        const stats = newStats();
        const t0 = Date.now();
        const eps = [
            (p) => '/api/pos/orders?limit=50&page=' + p,
            (p) => '/api/pos/orders/item-summary?page=' + p,
            () => '/api/pos/orders/stats/today',
        ];
        const workers = Array.from({ length: Math.max(8, Math.round(SALES_CONC / 2)) }, async () => {
            let page = 1;
            while (Date.now() - t0 < 20000) {
                const ep = eps[page % eps.length](page % 10 + 1);
                record(stats, ep, await request('GET', ep));
                page++;
            }
        });
        await Promise.all(workers);
        results.history = summarize(stats, Date.now() - t0, 'history paged');
        console.log('\n[4/5] HISTORY:', JSON.stringify({ rps: results.history.rps, p50: results.history.p50, p95: results.history.p95, p99: results.history.p99, byStatus: results.history.byStatus }));
    }

    // ═══ 5) عاصفة دخول (محدد المعدل) ═══
    {
        const stats = newStats();
        const t0 = Date.now();
        const workers = Array.from({ length: 16 }, async () => {
            while (Date.now() - t0 < LOGIN_SECS * 1000) {
                record(stats, 'POST /api/auth/login', await request('POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASS } }));
            }
        });
        await Promise.all(workers);
        results.loginStorm = summarize(stats, Date.now() - t0, 'login storm c16');
        console.log('\n[5/5] LOGIN-STORM:', JSON.stringify({ rps: results.loginStorm.rps, byStatus: results.loginStorm.byStatus }));
    }

    // ── إغلاق الوردية تحت الحالة النهائية + التحقق المحاسبي ──
    const close = await request('POST', `/api/pos/shifts/${SESSION_ID}/close`, { body: { actual_cash: 1000, notes: 'إغلاق بعد اختبار الضغط' } });
    console.log('\nshift close: HTTP', close.status, close.text.slice(0, 160));

    // ── تحقق كامل: عدد الأوامر المنشأة فعليًا = المقبول 201 ──
    const salesOk = results.sales.byStatus['201'] || 0;
    const dbOrders = await db.query(`SELECT count(*)::int AS c FROM pos_orders WHERE session_id = $1`, [SESSION_ID]);
    const dbPayments = await db.query(`SELECT count(*)::int AS c FROM pos_invoice_payments p JOIN pos_orders o ON o.id = p.order_id WHERE o.session_id = $1`, [SESSION_ID]);
    console.log(`\nINTEGRITY: 201-responses=${salesOk} | pos_orders(session)=${dbOrders.rows[0].c} | payments=${dbPayments.rows[0].c}`);

    // ── تنظيف بيانات الضغط (قاعدة الاختبار قابلة للرمي لكن نظافتها يسمح بإعادة التشغيل) ──
    const orderIdsRes = await db.query(`SELECT id::text FROM pos_orders WHERE session_id = $1`, [SESSION_ID]);
    const orderIds = orderIdsRes.rows.map(r => r.id);
    if (orderIds.length) {
        await db.query(`DELETE FROM pos_invoice_payments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await db.query(`DELETE FROM pos_order_items WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await db.query(`DELETE FROM pos_idempotency_keys WHERE order_id = ANY($1::uuid[]) OR key LIKE 'stress-%'`, [orderIds]);
        await db.query(`DELETE FROM pos_pending_prints WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await db.query(`DELETE FROM pos_zatca_invoice_queue WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await db.query(`DELETE FROM pos_stock_movements WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await db.query(`DELETE FROM revenues WHERE notes LIKE ANY($1::text[])`, [orderIds.map(id => `%order=${id}%`)]);
        await db.query(`DELETE FROM pos_orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    }
    await db.query(`DELETE FROM pos_shift_sessions WHERE id = $1`, [SESSION_ID]);
    await db.query(`DELETE FROM pos_products WHERE barcode LIKE $1`, [stamp + '-%']);
    await db.end();

    const report = { target: BASE, db: DB_NAME, at: new Date().toISOString(), params: { SALES_CONC, SALES_SECS, READS_CONC, READS_SECS, IDEM_BURST }, results };
    if (OUT) { fs.writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log('\nreport →', OUT); }
    console.log('\nDONE');
}

main().catch((e) => { console.error('STRESS FAILED:', e.message); process.exit(1); });
