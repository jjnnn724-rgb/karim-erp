// scripts/pos-sale-test.js
// اختبار دورة بيع POS كاملة مع ZATCA + طباعة + idempotency
// يتطلب: PostgreSQL + backend على port 5000 + pos_products بها بيانات
const http = require('http');
const crypto = require('crypto');

const PINK = '\x1b[35m', GREEN = '\x1b[32m', RED = '\x1b[31m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m', RESET = '\x1b[0m', BOLD = '\x1b[1m';

let pass = 0, fail = 0;
const failures = [];
let adminToken = null;
let sessionId = null;
let departmentId = null;
let products = [];
let invoiceCounter = null;
let qrPayload = null;
const initialStock = {};

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

function idemKey() {
    return `sale-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function main() {
    console.log(`\n${BOLD}${PINK}═══════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${PINK}  Karim ERP — اختبار دورة بيع POS الكاملة${RESET}`);
    console.log(`${BOLD}${PINK}  (ZATCA + طباعة + Idempotency + Stock Atomic)${RESET}`);
    console.log(`${BOLD}${PINK}═══════════════════════════════════════════════════════════${RESET}\n`);

    // ═════════════════════════════════════════════════════════
    // Phase 1: Setup — login + list products + open shift
    // ═════════════════════════════════════════════════════════
    console.log(`${BOLD}${YELLOW}[Phase 1] الإعداد: login + products + open shift${RESET}`);

    const adminPassword = process.env.KARIM_TEST_PASSWORD;
    if (!adminPassword) {throw new Error('KARIM_TEST_PASSWORD is required for POS sale tests.');}
    let r = await req('POST', '/api/auth/login', { username: 'admin', password: adminPassword });
    check('admin login', r.status === 200, `(HTTP ${r.status})`);
    adminToken = r.json?.access_token;

    r = await req('GET', '/api/pos/departments', null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/departments', r.status === 200, `${r.json?.length || 0} depts`);
    departmentId = parseInt(r.json?.[0]?.id, 10);

    r = await req('GET', `/api/pos/products?department_id=${departmentId}`, null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/products', r.status === 200, `${r.json?.length || 0} products`);
    products = r.json || [];
    check('يوجد منتجات للبيع', products.length >= 2, `${products.length}`);

    // pg returns BIGINT ids as strings — normalize to Number for all downstream use
    products = products.map(p => ({ ...p, id: Number(p.id), price: Number(p.price), stock_quantity: Number(p.stock_quantity) }));

    // Snapshot initial stock for verification later
    for (const p of products) {
        initialStock[p.id] = Number(p.stock_quantity);
    }
    console.log(`      ${CYAN}Initial stock: ${JSON.stringify(initialStock)}${RESET}`);

    r = await req('POST', '/api/pos/shifts/open', {
        department_id: departmentId,
        opening_balance: 200.00
    }, { Authorization: `Bearer ${adminToken}` });
    check('POST /api/pos/shifts/open', r.status === 201, `(HTTP ${r.status})`);
    sessionId = r.json?.session_id;
    console.log(`      ${CYAN}session_id: ${sessionId}${RESET}`);

    // ═════════════════════════════════════════════════════════
    // Phase 2: Successful sale — single product, cash payment
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 2] بيع ناجح: منتج واحد + نقدي${RESET}`);

    const p1 = products[0];
    const qty1 = 2;
    const unitPrice1 = Number(p1.price);
    const lineTotal1 = Number((qty1 * unitPrice1).toFixed(2));
    const vat1 = Number((lineTotal1 * 0.15).toFixed(2));
    const total1 = Number((lineTotal1 + vat1).toFixed(2));

    const saleBody1 = {
        department_id: departmentId,
        items: [{ product_id: p1.id, quantity: qty1, unit_price: unitPrice1, discount: 0 }],
        payments: [{ method: 'cash', amount: total1 }],
        printer_id: 'pos-1'
    };

    r = await req('POST', '/api/sales/complete', saleBody1, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('POST /api/sales/complete (single)', r.status === 201, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    check('response يحتوي order_id (UUID)', !!r.json?.order_id && /^[0-9a-f-]{36}$/i.test(r.json?.order_id), r.json?.order_id || '');
    // invoice_counter may come back as string or number depending on pg column type
    check('response يحتوي invoice_counter', r.json?.invoice_counter !== undefined && r.json?.invoice_counter !== null, `${r.json?.invoice_counter}`);
    check('response يحتوي invoice_uuid', !!r.json?.invoice_uuid, r.json?.invoice_uuid || '');
    check('response يحتوي invoice_hash', !!r.json?.invoice_hash, `${(r.json?.invoice_hash || '').substring(0, 20)}...`);
    check('response يحتوي qr_payload (ZATCA TLV)', !!r.json?.qr_payload, `${(r.json?.qr_payload || '').substring(0, 30)}...`);
    check('response يحتوي digital_signature', !!r.json?.digital_signature, `${(r.json?.digital_signature || '').substring(0, 30)}...`);
    check('total_amount صحيح (subtotal + VAT 15%)', Number(r.json?.total_amount) === total1, `expected ${total1}, got ${r.json?.total_amount}`);
    check('tax_total صحيح (15%)', Number(r.json?.tax_total) === vat1, `expected ${vat1}, got ${r.json?.tax_total}`);
    check('subtotal صحيح', Number(r.json?.subtotal) === lineTotal1, `expected ${lineTotal1}, got ${r.json?.subtotal}`);
    check('paid = total', Number(r.json?.paid) === total1, `${r.json?.paid}`);
    check('change = 0', Number(r.json?.change) === 0, `${r.json?.change}`);
    check('print_job_id موجود (طابور الطباعة)', !!r.json?.print_job_id, `${r.json?.print_job_id}`);
    check('zatca_queued = true', r.json?.zatca_queued === true, `${r.json?.zatca_queued}`);
    check('session_id مرتبط بالوردية', Number(r.json?.session_id) === Number(sessionId), `${r.json?.session_id}`);

    invoiceCounter = r.json?.invoice_counter;
    qrPayload = r.json?.qr_payload;

    // ═════════════════════════════════════════════════════════
    // Phase 3: Idempotency — same key returns cached response
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 3] Idempotency: نفس المفتاح يرجع نفس النتيجة${RESET}`);

    const sameKey = idemKey();
    r = await req('POST', '/api/sales/complete', saleBody1, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': sameKey
    });
    check('أول طلب بنفس المفتاح ينجح (201)', r.status === 201, `(HTTP ${r.status})`);
    const firstOrderId = r.json?.order_id;

    // Wait briefly, then send the same key with same body
    await new Promise(res => setTimeout(res, 200));
    r = await req('POST', '/api/sales/complete', saleBody1, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': sameKey
    });
    // Replay returns the ORIGINAL status (201), not 200. This is correct
    // per idempotency semantics: the cached response is replayed verbatim.
    check('تكرار نفس المفتاح يرجع cached (201)', r.status === 201, `(HTTP ${r.status})`);
    check('cached response يحتوي _idempotent_replay=true', r.json?._idempotent_replay === true, `${r.json?._idempotent_replay}`);
    check('cached order_id = الأصلي', r.json?.order_id === firstOrderId, `${r.json?.order_id?.substring(0, 8)}...`);

    // Same key + DIFFERENT body → 409 conflict
    const modifiedBody = JSON.parse(JSON.stringify(saleBody1));
    modifiedBody.items[0].quantity = 99;
    r = await req('POST', '/api/sales/complete', modifiedBody, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': sameKey
    });
    check('نفس المفتاح + body مختلف يرجع 409 conflict', r.status === 409, `(HTTP ${r.status}) ${r.json?.error || ''}`);

    // Missing Idempotency-Key → 400
    r = await req('POST', '/api/sales/complete', saleBody1, {
        Authorization: `Bearer ${adminToken}`
    });
    check('بدون Idempotency-Key يرجع 400', r.status === 400, `(HTTP ${r.status}) ${r.json?.error || ''}`);

    // ═════════════════════════════════════════════════════════
    // Phase 4: Multi-product + split payment (cash + card + wallet)
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 4] بيع متعدد المنتجات + split payment${RESET}`);

    const p2 = products[1];
    const p3 = products[2] || products[0];

    // Compute totals first so we can pay the right amount
    const expectedSubtotal2 = Number(((3 * Number(p2.price)) + (1 * Number(p3.price)) - 1.00).toFixed(2));
    const expectedVat2 = Number((expectedSubtotal2 * 0.15).toFixed(2));
    const expectedTotal2 = Number((expectedSubtotal2 + expectedVat2).toFixed(2));

    // Split the total across cash/card/wallet in a realistic way:
    //   cash  = ceil(total/2)
    //   card  = floor(total/3)
    //   wallet = total - cash - card
    const cashPart  = Number(Math.ceil(expectedTotal2 / 2).toFixed(2));
    const cardPart  = Number(Math.floor(expectedTotal2 / 3).toFixed(2));
    const walletPart = Number((expectedTotal2 - cashPart - cardPart).toFixed(2));
    const expectedPaid2 = Number((cashPart + cardPart + walletPart).toFixed(2));

    const saleBody2 = {
        department_id: departmentId,
        items: [
            { product_id: p2.id, quantity: 3, unit_price: Number(p2.price), discount: 0 },
            { product_id: p3.id, quantity: 1, unit_price: Number(p3.price), discount: 1.00 }
        ],
        payments: [
            { method: 'cash',   amount: cashPart,                          },
            { method: 'card',   amount: cardPart,   reference: 'VISA-1234' },
            { method: 'wallet', amount: walletPart, reference: 'STC-5678'  }
        ],
        printer_id: 'pos-1'
    };

    r = await req('POST', '/api/sales/complete', saleBody2, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('POST /api/sales/complete (multi + split)', r.status === 201, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    // Tax is computed per-line then summed (per computeTotalsServerSide),
    // so a 1-cent rounding difference vs. computing VAT on the subtotal
    // is normal. Allow ±0.02 tolerance.
    const taxDiff = Math.abs(Number(r.json?.tax_total) - expectedVat2);
    const totalDiff = Math.abs(Number(r.json?.total_amount) - expectedTotal2);
    check('subtotal صحيح للـ multi', Number(r.json?.subtotal) === expectedSubtotal2, `expected ${expectedSubtotal2}, got ${r.json?.subtotal}`);
    check(`tax_total صحيح للـ multi (±0.02)`, taxDiff <= 0.02, `expected ${expectedVat2}, got ${r.json?.tax_total}, diff ${taxDiff.toFixed(2)}`);
    check(`total_amount صحيح للـ multi (±0.02)`, totalDiff <= 0.02, `expected ${expectedTotal2}, got ${r.json?.total_amount}, diff ${totalDiff.toFixed(2)}`);
    check(`paid = ${expectedPaid2} (cash+card+wallet)`, Number(r.json?.paid) === expectedPaid2, `${r.json?.paid}`);
    // change may be 0.01 if total rounded down by 1 cent
    check('change ≤ 0.02 (paid ≈ total)', Number(r.json?.change) <= 0.02, `${r.json?.change}`);
    check('invoice_counter تزايد (>, الأول)', Number(r.json?.invoice_counter) > Number(invoiceCounter), `${r.json?.invoice_counter} > ${invoiceCounter}`);

    // ═════════════════════════════════════════════════════════
    // Phase 5: Failure scenarios — must ROLLBACK
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 5] سيناريوهات الفشل (يجب ROLLBACK)${RESET}`);

    // Insufficient stock
    r = await req('POST', '/api/sales/complete', {
        department_id: departmentId,
        items: [{ product_id: p1.id, quantity: 999999, unit_price: Number(p1.price), discount: 0 }],
        payments: [{ method: 'cash', amount: 999999 }]
    }, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('insufficient stock يرجع 409', r.status === 409, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    check('error = INSUFFICIENT_STOCK', r.json?.error === 'INSUFFICIENT_STOCK', r.json?.error || '');

    // Price override (client price > server price) — must be rejected
    r = await req('POST', '/api/sales/complete', {
        department_id: departmentId,
        items: [{ product_id: p1.id, quantity: 1, unit_price: Number(p1.price) + 1000, discount: 0 }],
        payments: [{ method: 'cash', amount: 9999 }]
    }, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('price override يرجع 422', r.status === 422, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    check('error = PRICE_OVERRIDE_FORBIDDEN', r.json?.error === 'PRICE_OVERRIDE_FORBIDDEN', r.json?.error || '');

    // Underpayment
    r = await req('POST', '/api/sales/complete', {
        department_id: departmentId,
        items: [{ product_id: p1.id, quantity: 1, unit_price: Number(p1.price), discount: 0 }],
        payments: [{ method: 'cash', amount: 0.01 }]
    }, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('underpayment يرجع 422', r.status === 422, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    check('error = UNDERPAYMENT', r.json?.error === 'UNDERPAYMENT', r.json?.error || '');

    // Invalid payment method
    r = await req('POST', '/api/sales/complete', {
        department_id: departmentId,
        items: [{ product_id: p1.id, quantity: 1, unit_price: Number(p1.price), discount: 0 }],
        payments: [{ method: 'crypto', amount: 9999 }]
    }, {
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': idemKey()
    });
    check('invalid payment method يرجع 422', r.status === 422, `(HTTP ${r.status}) ${r.json?.error || ''}`);

    // ═════════════════════════════════════════════════════════
    // Phase 6: Verify stock was decremented atomically
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 6] التحقق من تناقص المخزون ذرّياً${RESET}`);

    r = await req('GET', `/api/pos/products?department_id=${departmentId}`, null, { Authorization: `Bearer ${adminToken}` });
    const finalProducts = (r.json || []).map(p => ({ ...p, id: Number(p.id), stock_quantity: Number(p.stock_quantity) }));
    const finalStock = {};
    for (const p of finalProducts) {finalStock[p.id] = Number(p.stock_quantity);}
    console.log(`      ${CYAN}Final stock:   ${JSON.stringify(finalStock)}${RESET}`);

    // p1: sold qty1=2 in TWO successful sales:
    //   - sale1 in Phase 2 (idemKey A)         → qty=2 decrement
    //   - sale1' in Phase 3 first call (sameKey B, same body) → qty=2 decrement
    //   - sale1'-replay in Phase 3 second call  → NO decrement (cached)
    //   - failed attempts (insufficient stock, price override, underpayment, invalid method) → NO decrement (rolled back)
    // Total decrement for p1 = 2 + 2 = 4
    const p1Expected = initialStock[p1.id] - (qty1 + qty1);
    check(`stock[p1.id=${p1.id}] تناقص بـ ${qty1 + qty1} (sale1 + sale1')`, finalStock[p1.id] === p1Expected, `expected ${p1Expected}, got ${finalStock[p1.id]}`);

    // p2: sold 3 in sale2 (multi)
    const p2Expected = initialStock[p2.id] - 3;
    check(`stock[${p2.id}] تناقص بـ 3 (الـ multi-sale)`, finalStock[p2.id] === p2Expected, `expected ${p2Expected}, got ${finalStock[p2.id]}`);

    // p3: sold 1 in sale2 (multi)
    const p3Expected = initialStock[p3.id] - 1;
    check(`stock[${p3.id}] تناقص بـ 1 (الـ multi-sale)`, finalStock[p3.id] === p3Expected, `expected ${p3Expected}, got ${finalStock[p3.id]}`);

    // ═════════════════════════════════════════════════════════
    // Phase 7: Verify ZATCA QR payload is valid TLV (base64)
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 7] التحقق من ZATCA QR TLV payload${RESET}`);

    if (qrPayload) {
        // qr_payload is BASE64-encoded (per buildZatcaTlvInJs in zatca-tlv.js)
        const buf = Buffer.from(qrPayload, 'base64');
        check('qr_payload غير فارغ (> 50 bytes decoded)', buf.length > 50, `${buf.length} bytes`);

        // ZATCA TLV: tag (1 byte) + length (1 byte) + value
        // Tag 1 = seller name, 2 = VAT number, 3 = timestamp, 4 = total, 5 = VAT total
        let offset = 0;
        const tags = {};
        try {
            while (offset + 2 <= buf.length) {
                const tag = buf[offset];
                const len = buf[offset + 1];
                if (offset + 2 + len > buf.length) {break;}
                const val = buf.slice(offset + 2, offset + 2 + len).toString('utf8');
                tags[tag] = val;
                offset += 2 + len;
            }
            check('TLV يحتوي tag 1 (seller name)', !!tags[1], tags[1]?.substring(0, 30) || '');
            check('TLV يحتوي tag 2 (VAT number)', !!tags[2], tags[2] || '');
            check('TLV يحتوي tag 3 (timestamp)', !!tags[3], tags[3] || '');
            check('TLV يحتوي tag 4 (total)', !!tags[4], tags[4] || '');
            check('TLV يحتوي tag 5 (VAT total)', !!tags[5], tags[5] || '');
            check('TLV يحتوي tag 6 (counter)', !!tags[6], tags[6] || '');
            check('TLV يحتوي tag 7 (uuid)', !!tags[7], tags[7] || '');
        } catch (e) {
            check('TLV parsing ناجح', false, e.message);
        }
    } else {
        check('qr_payload متوفر للتحقق', false, 'missing');
    }

    // ═════════════════════════════════════════════════════════
    // Phase 8: Shift summary + close — verify expected_cash = opening + cash_in
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${YELLOW}[Phase 8] ملخص وإغلاق الوردية — التحقق من expected_cash${RESET}`);

    r = await req('GET', `/api/pos/shifts/${sessionId}/summary`, null, { Authorization: `Bearer ${adminToken}` });
    check('GET /api/pos/shifts/:id/summary', r.status === 200, `(HTTP ${r.status})`);
    check('summary يحتوي cash_in', r.json?.cash_in !== undefined, `${r.json?.cash_in}`);
    check('summary يحتوي card_in', r.json?.card_in !== undefined, `${r.json?.card_in}`);
    check('summary يحتوي wallet_in', r.json?.wallet_in !== undefined, `${r.json?.wallet_in}`);
    check('summary يحتوي invoice_count', r.json?.invoice_count !== undefined, `${r.json?.invoice_count}`);

    // Sales in this shift (each successful sale creates a new order + payment):
    //   - sale1 (Phase 2, single):           cash = total1                  (new order)
    //   - sale1' (Phase 3, first sameKey):   cash = total1                  (new order, different key)
    //   - sale1'-replay (Phase 3, second):   no new payment, no new order   (cached)
    //   - sale2 (Phase 4, multi + split):    cash = cashPart, card = cardPart, wallet = walletPart
    //   - 4 failed attempts:                 no payment (rolled back)
    // Expected totals:
    //   cash_in   = total1 + total1 + cashPart
    //   card_in   = cardPart
    //   wallet_in = walletPart
    //   invoice_count = 3 (sale1 + sale1' + sale2; replay doesn't create a new order)
    const expectedCashIn   = Number((total1 + total1 + cashPart).toFixed(2));
    const expectedCardIn   = cardPart;
    const expectedWalletIn = walletPart;
    const expectedInvoiceCount = 3;

    check(`cash_in = ${expectedCashIn} (sale1 + sale2 cash)`, Number(r.json?.cash_in) === expectedCashIn, `got ${r.json?.cash_in}`);
    check(`card_in = ${expectedCardIn}`, Number(r.json?.card_in) === expectedCardIn, `got ${r.json?.card_in}`);
    check(`wallet_in = ${expectedWalletIn}`, Number(r.json?.wallet_in) === expectedWalletIn, `got ${r.json?.wallet_in}`);
    check(`invoice_count = ${expectedInvoiceCount}`, Number(r.json?.invoice_count) === expectedInvoiceCount, `got ${r.json?.invoice_count}`);

    // Close shift with actual_cash = expected_cash → variance = 0
    const expectedCash = 200 + expectedCashIn;  // opening + cash_in
    r = await req('POST', `/api/pos/shifts/${sessionId}/close`, {
        actual_cash: expectedCash,
        notes: 'إغلاق اختباري - لا عجز'
    }, { Authorization: `Bearer ${adminToken}` });
    check('POST /api/pos/shifts/:id/close', r.status === 200, `(HTTP ${r.status}) ${r.json?.error || ''}`);
    check('status = closed', r.json?.status === 'closed', r.json?.status || '');
    check(`expected_cash = ${expectedCash} (opening + cash_in)`, Number(r.json?.expected_cash) === expectedCash, `got ${r.json?.expected_cash}`);
    check(`cash_variance = 0 (لا عجز)`, Number(r.json?.cash_variance) === 0, `got ${r.json?.cash_variance}`);

    // ═════════════════════════════════════════════════════════
    // Summary
    // ═════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${PINK}═══════════════════════════════════════════════════════════${RESET}`);
    const total = pass + fail;
    const pct = total > 0 ? Math.round(pass / total * 100) : 0;
    if (fail === 0) {
        console.log(`  ${GREEN}${BOLD}✅ جميع فحوص دورة البيع نجحت: ${pass}/${total} (100%)${RESET}`);
    } else {
        console.log(`  ${RED}${BOLD}✗ فشل ${fail} من ${total} (${pct}% نجاح)${RESET}`);
        console.log(`  ${RED}الفشل في:${RESET}`);
        for (const f of failures) {console.log(`    • ${f}`);}
    }
    console.log(`${BOLD}${PINK}═══════════════════════════════════════════════════════════${RESET}\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
