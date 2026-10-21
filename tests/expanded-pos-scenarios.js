#!/usr/bin/env node
const http = require('http');
const https = require('https');
const { Client } = require('pg');
const crypto = require('crypto');

const BASE_HOST = process.env.TEST_HOST || '127.0.0.1';
const BASE_PORT = Number(process.env.TEST_PORT || process.env.PORT || 5000);
// TEST_PROTOCOL=https لاستهداف نسخة HTTPS معزولة (شهادة ذاتية التوقيع تُقبل دائمًا هنا)
const TEST_PROTOCOL = String(process.env.TEST_PROTOCOL || 'http');
const TEST_AGENT = TEST_PROTOCOL === 'https'
  ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
  : undefined;
const TEST_DB_NAME = String(process.env.KARIM_TEST_DB_NAME || '');
const SCENARIO_ID = crypto.randomUUID();
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
// مفتاح التطبيق يُسلَّم مع الاستجابة من /api/auth/login ويُلزم في كل نداء بيانات
let APP_KEY = '';

function request(method, path, body, token, extra = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = (TEST_PROTOCOL === 'https' ? https : http).request({
      host: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      ...(TEST_AGENT ? { agent: TEST_AGENT } : {}),
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(APP_KEY ? { 'x-api-key': APP_KEY } : {}),
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
      await db.query('DELETE FROM revenues WHERE pos_order_id = ANY($1::uuid[]) OR notes LIKE ANY($2::text[])', [orderIds, orderPatterns]);
      await db.query('DELETE FROM pos_invoice_payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await db.query('DELETE FROM pos_order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
      const journalEntries = await db.query(
        `SELECT id FROM journal_entries WHERE source_type = 'pos_sale' AND source_id = ANY($1::text[])`,
        [orderIds]
      );
      const journalEntryIds = journalEntries.rows.map((row) => row.id);
      if (journalEntryIds.length) {
        await db.query('DELETE FROM journal_lines WHERE entry_id = ANY($1::bigint[])', [journalEntryIds]);
        await db.query('DELETE FROM journal_entries WHERE id = ANY($1::bigint[])', [journalEntryIds]);
      }
      await db.query(
        'DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[]) OR payload::text LIKE ANY($2::text[])',
        [orderIds, orderPatterns]
      );
      await db.query(
        'DELETE FROM pos_idempotency_keys WHERE order_id = ANY($1::uuid[]) OR key LIKE $2',
        [orderIds, `test-${SCENARIO_ID}-%`]
      );
      const stateResult = await db.query('SELECT state_data FROM app_state WHERE id = 1 FOR UPDATE');
      const state = stateResult.rows[0]?.state_data || {};
      if (Array.isArray(state.revenues)) {
        state.revenues = state.revenues.filter((item) => !orderIds.some((id) => String(item?.notes || '').includes(`order=${id}`)));
        await db.query('UPDATE app_state SET state_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [JSON.stringify(state)]);
      }
      await db.query('DELETE FROM pos_orders WHERE id = ANY($1::uuid[])', [orderIds]);
    } else {
      await db.query('DELETE FROM pos_idempotency_keys WHERE key LIKE $1', [`test-${SCENARIO_ID}-%`]);
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
    APP_KEY = login.json?.app_key || login.json?.appKey || '';
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

    const cash = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'cash', amount: 115 }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-cash-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع نقدي مباشر', cash.status === 201 && cash.json?.order_id, `HTTP ${cash.status}`);

    const card = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'card', amount: 115, reference: 'TEST-CARD' }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-card-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالبطاقة', card.status === 201 && card.json?.order_id, `HTTP ${card.status}`);

    const wallet = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'wallet', amount: 115, reference: 'TEST-WALLET' }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-wallet-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالمحفظة', wallet.status === 201 && wallet.json?.order_id, `HTTP ${wallet.status}`);

    const bank = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'bank_transfer', amount: 115, reference: 'TEST-BANK' }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-bank-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع بالتحويل البنكي', bank.status === 201 && bank.json?.order_id, `HTTP ${bank.status}`);

    const split = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, payments: [{ method: 'cash', amount: 50 }, { method: 'card', amount: 65, reference: 'TEST-SPLIT' }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-split-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع متعدد طرق الدفع', split.status === 201 && split.json?.order_id, `HTTP ${split.status}`);

    const discounted = await request('POST', '/api/sales/complete', salePayload({ departmentId, productId: created.productId, sessionId: created.sessionId, discount: 10, payments: [{ method: 'cash', amount: 103.5 }] }), token, { 'Idempotency-Key': `test-${SCENARIO_ID}-discount-${crypto.randomUUID()}`, 'X-Shift-Session-Id': String(created.sessionId) });
    check('بيع مع خصم', discounted.status === 201 && Number(discounted.json?.discount_total) === 10, `HTTP ${discounted.status}`);

    const successfulOrders = [cash, card, wallet, bank, split, discounted].map((response) => response.json?.order_id).filter(Boolean);
    const reconciliation = await db.query(`
      WITH payment_totals AS (
        SELECT order_id, COUNT(*)::int AS payment_count, SUM(amount) AS paid_total
          FROM pos_invoice_payments
         WHERE order_id = ANY($1::uuid[])
         GROUP BY order_id
      ), journal_totals AS (
        SELECT je.source_id, COUNT(DISTINCT je.id)::int AS entry_count,
               COALESCE(SUM(jl.debit), 0) AS debits,
               COALESCE(SUM(jl.credit), 0) AS credits
          FROM journal_entries je
          LEFT JOIN journal_lines jl ON jl.entry_id = je.id
         WHERE je.source_type = 'pos_sale' AND je.source_id = ANY($1::text[])
         GROUP BY je.source_id
      )
      SELECT p.id, p.total_amount, r.amount AS revenue_amount,
             (r.id IS NOT NULL)::int AS revenue_count,
             COALESCE(pt.payment_count, 0) AS payment_count,
             COALESCE(pt.paid_total, 0) AS paid_total,
             COALESCE(jt.entry_count, 0) AS journal_count,
             COALESCE(jt.debits, 0) AS debits,
             COALESCE(jt.credits, 0) AS credits,
             (SELECT COUNT(*)::int
                FROM app_state s
                CROSS JOIN LATERAL jsonb_array_elements(
                  CASE WHEN jsonb_typeof(s.state_data->'revenues') = 'array'
                       THEN s.state_data->'revenues' ELSE '[]'::jsonb END
                ) AS items(value)
               WHERE s.id = 1 AND items.value #>> '{pos,order_id}' = p.id::text) AS mirror_count
        FROM pos_orders p
        LEFT JOIN revenues r ON r.pos_order_id = p.id
        LEFT JOIN payment_totals pt ON pt.order_id = p.id
        LEFT JOIN journal_totals jt ON jt.source_id = p.id::text
       WHERE p.id = ANY($1::uuid[])
    `, [successfulOrders]);
    const reconciled = reconciliation.rows.length === 6 && reconciliation.rows.every((row) => (
      Number(row.revenue_count) === 1
      && Math.abs(Number(row.total_amount) - Number(row.revenue_amount)) < 0.01
      && Math.abs(Number(row.total_amount) - Number(row.paid_total)) < 0.01
      && Number(row.payment_count) >= 1
      && Number(row.journal_count) === 1
      && Number(row.debits) > 0
      && Math.abs(Number(row.debits) - Number(row.credits)) < 0.01
      && Number(row.mirror_count) === 1
    ));
    check('مصالحة الإيراد والتحصيل والقيد والمرآة', reconciled, `orders=${reconciliation.rows.length}`);

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
