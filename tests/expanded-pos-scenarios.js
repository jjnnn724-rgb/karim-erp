#!/usr/bin/env node
const http = require('http');
const { Client } = require('pg');
const crypto = require('crypto');

const BASE_HOST = process.env.TEST_HOST || '127.0.0.1';
const BASE_PORT = Number(process.env.TEST_PORT || process.env.PORT || 5000);
const TEST_DB_NAME = String(process.env.KARIM_TEST_DB_NAME || '');
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: TEST_DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

let pass = 0;
let fail = 0;
const failures = [];
const created = { productId: null, sessionId: null, heldId: null };

function request(method, path, body, token, extra = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch (_) { json = null; }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', (error) => resolve({ status: 0, error }));
    if (data) {req.write(data);}
    req.end();
  });
}

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function salePayload({ departmentId, productId, sessionId, payments, discount = 0, quantity = 1 }) {
  return {
    department_id: departmentId,
    items: [{ product_id: productId, quantity, unit_price: 100, discount }],
    payments,
    printer_id: 'pos-1',
    session_id: sessionId,
  };
}

async function cleanup(db) {
  if (created.heldId) {await db.query('DELETE FROM pos_held_orders WHERE id = $1', [created.heldId]);}
  if (created.sessionId) {
    const orders = await db.query('SELECT id FROM pos_orders WHERE session_id = $1', [created.sessionId]);
    const orderIds = orders.rows.map((row) => row.id);
    if (orderIds.length) {
      const orderPatterns = orderIds.map((id) => `%order=${id}%`);
      await db.query('DELETE FROM revenues WHERE notes LIKE ANY($1::text[])', [orderPatterns]);
      await db.query('DELETE FROM pos_invoice_payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM pos_order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM pos_idempotency_keys WHERE order_id = ANY($1::uuid[]) OR key LIKE \'test-%\'', [orderIds]);
      const stateResult = await db.query('SELECT state_data FROM app_state WHERE id = 1 FOR UPDATE');
      const state = stateResult.rows[0]?.state_data || {};
      if (Array.isArray(state.revenues)) {
        state.revenues = state.revenues.filter((item) => !orderIds.some((id) => String(item?.notes || '').includes(`order=${id}`)));
        await db.query('UPDATE app_state SET state_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [JSON.stringify(state)]);
      }
      await db.query('DELETE FROM pos_orders WHERE id = ANY($1::uuid[])', [orderIds]);
    } else {
      await db.query("DELETE FROM pos_idempotency_keys WHERE key LIKE 'test-%'");
    }
    await db.query('DELETE FROM pos_shift_sessions WHERE id = $1', [created.sessionId]);
  }
  if (created.productId) {await db.query('DELETE FROM pos_products WHERE id = $1', [created.productId]);}
}

async function main() {
  if (!TEST_DB_NAME) {
    throw new Error('KARIM_TEST_DB_NAME is required and must name a dedicated disposable test database.');
  }
  if (TEST_DB_NAME === 'karim_erp' || TEST_DB_NAME === String(process.env.DB_NAME || '')) {
    throw new Error('Refusing to run destructive POS scenarios against the live karim_erp database. Use a dedicated KARIM_TEST_DB_NAME.');
  }
  const db = new Client(DB_CONFIG);
  await db.connect();
  try {
    const adminPassword = process.env.KARIM_TEST_PASSWORD;
    if (!adminPassword) {throw new Error('KARIM_TEST_PASSWORD is required for expanded POS scenarios.');}
    const login = await request('POST', '/api/auth/login', { username: 'admin', password: adminPassword });
    check('تسجيل الدخول', login.status === 200 && !!login.json?.access_token, `HTTP ${login.status}`);
    const token = login.json?.access_token;
    if (!token) {throw new Error('No token');}

    const departments = await request('GET', '/api/pos/departments', undefined, token);
    const department = departments.json?.find((item) => item.code === 'malaysian') || departments.json?.[0];
    check('قراءة الأقسام', departments.status === 200 && !!department?.id, `HTTP ${departments.status}`);
    const departmentId = Number(department.id);

    const product = await db.query(`
      INSERT INTO pos_products (name_ar, barcode, price, stock_quantity, unit, category, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id
    `, ['اختبار بيع مؤقت', `TEST-${Date.now()}`, 100, 100, 'وحدة', 'اختبار']);
    created.productId = Number(product.rows[0].id);

    const open = await request('POST', '/api/pos/shifts/open', { department_id: departmentId, opening_balance: 100, new_session: true }, token);
    check('فتح الوردية', open.status === 201 && !!open.json?.session_id, `HTTP ${open.status}`);
    created.sessionId = Number(open.json?.session_id);
    if (!created.sessionId) {throw new Error('No session');}

    const duplicate = await request('POST', '/api/pos/shifts/open', { department_id: departmentId, opening_balance: 100 }, token);
    check('منع فتح وردية مكررة', duplicate.status === 409, `HTTP ${duplicate.status}`);

    const cash = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'cash', amount: 115 }] }), token, { 'Idempotency-Key': `test-cash-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع نقدي مباشر', cash.status === 201 && cash.json?.order_id, `HTTP ${cash.status}`);

    const card = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'card', amount: 115, reference: 'TEST-CARD' }] }), token, { 'Idempotency-Key': `test-card-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالبطاقة', card.status === 201 && card.json?.order_id, `HTTP ${card.status}`);

    const wallet = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'wallet', amount: 115, reference: 'TEST-WALLET' }] }), token, { 'Idempotency-Key': `test-wallet-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالمحفظة', wallet.status === 201 && wallet.json?.order_id, `HTTP ${wallet.status}`);

    const bank = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'bank_transfer', amount: 115, reference: 'TEST-BANK' }] }), token, { 'Idempotency-Key': `test-bank-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالتحويل البنكي', bank.status === 201 && bank.json?.order_id, `HTTP ${bank.status}`);

    const split = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'cash', amount: 50 }, { method: 'card', amount: 65, reference: 'TEST-SPLIT' }] }), token, { 'Idempotency-Key': `test-split-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع متعدد طرق الدفع', split.status === 201 && split.json?.order_id, `HTTP ${split.status}`);

    const discounted = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, discount: 10, payments: [{ method: 'cash', amount: 103.5 }] }), token, { 'Idempotency-Key': `test-discount-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع مع خصم', discounted.status === 201 && Number(discounted.json?.discount_total) === 10, `HTTP ${discounted.status}`);

    const held = await request('POST', '/api/pos/held-orders', { session_id: created.sessionId, department_id: departmentId, items: [{ product_id: created.productId, quantity: 1, unit_price: 100, discount: 0 }], cart_discount: { type: 'amount', value: 0 } }, token);
    created.heldId = held.json?.id;
    check('تعليق الطلب', held.status === 201 && !!created.heldId, `HTTP ${held.status}`);

    const listed = await request('GET', `/api/pos/held-orders?session_id=${created.sessionId}`, undefined, token);
    check('عرض الطلبات المعلقة', listed.status === 200 && listed.json?.some((item) => item.id === created.heldId), `HTTP ${listed.status}`);

    const recalled = await request('POST', `/api/pos/held-orders/${created.heldId}/recall`, { session_id: created.sessionId }, token);
    check('استئناف الطلب المعلق', recalled.status === 200 && recalled.json?.id === created.heldId, `HTTP ${recalled.status}`);
    created.heldId = null;

    const invalid = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'cash', amount: 1 }] }), token, { 'Idempotency-Key': `test-underpay-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('منع الدفع الناقص', invalid.status >= 400 && invalid.status < 500, `HTTP ${invalid.status}`);

    const summary = await request('GET', `/api/pos/shifts/${created.sessionId}/summary`, undefined, token);
    check('ملخص الوردية بعد المبيعات', summary.status === 200 && Number(summary.json?.invoice_count) >= 6, `HTTP ${summary.status}, invoices=${summary.json?.invoice_count}`);
    const expectedCash = Number(summary.json?.expected_cash || 0);

    const close = await request('POST', `/api/pos/shifts/${created.sessionId}/close`, { actual_cash: 100 + expectedCash, notes: 'اختبار موسع تلقائي' }, token);
    check('إغلاق الوردية', close.status === 200 && close.json?.cash_variance !== undefined, `HTTP ${close.status}`);

    const closedAgain = await request('POST', `/api/pos/shifts/${created.sessionId}/close`, { actual_cash: 0 }, token);
    check('منع إغلاق الوردية مرتين', closedAgain.status === 409 || closedAgain.status === 400, `HTTP ${closedAgain.status}`);

    console.log(`\nRESULT passed=${pass} failed=${fail}`);
    if (fail) {
      console.error(failures.join('\n'));
      process.exitCode = 1;
    }
  } finally {
    await cleanup(db);
    await db.end();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
