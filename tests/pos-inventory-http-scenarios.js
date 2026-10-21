#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Client } = require('pg');

const BASE_DATABASE = 'karim_erp_test';
const DB_HOST = String(process.env.DB_HOST || '').toLowerCase();
const DB_PORT = Number(process.env.DB_PORT || 0);
const DB_USER = process.env.DB_USER || '';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const SCENARIO_ID = crypto.randomBytes(6).toString('hex');
const CLONE_DATABASE = `karim_erp_test_recipe_${SCENARIO_ID}`;

function assertSafeTarget() {
    if (process.env.NODE_ENV === 'production'
        || process.env.KARIM_TEST_DB_ISOLATED !== '1'
        || process.env.DB_NAME !== BASE_DATABASE
        || process.env.KARIM_TEST_DB_NAME !== BASE_DATABASE
        || !['127.0.0.1', 'localhost', '::1'].includes(DB_HOST)
        || !Number.isInteger(DB_PORT) || DB_PORT <= 0
        || !DB_USER) {
        throw new Error('Requires an explicitly isolated loopback karim_erp_test database.');
    }
}

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function check(name, condition, detail = '') {
    if (!condition) {
        throw new Error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}

function request(port, path, body, token, idempotencyKey) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                Authorization: `Bearer ${token}`,
                'Idempotency-Key': idempotencyKey,
                'X-Shift-Session-Id': String(body.session_id),
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                let json;
                try { json = JSON.parse(raw); } catch (error) { return reject(error); }
                resolve({ status: res.statusCode, json });
            });
        });
        req.on('error', reject);
        req.end(data);
    });
}

async function main() {
    assertSafeTarget();

    const admin = new Client({
        host: DB_HOST,
        port: DB_PORT,
        database: 'postgres',
        user: DB_USER,
        password: DB_PASSWORD,
    });
    await admin.connect();

    let cloneCreated = false;
    let fixtureClient;
    let server;
    let pool;
    try {
        const activeConnections = await admin.query(
            `SELECT COUNT(*)::int AS count
               FROM pg_stat_activity
              WHERE datname = $1 AND pid <> pg_backend_pid();`,
            [BASE_DATABASE]
        );
        if (activeConnections.rows[0].count !== 0) {
            throw new Error('Refusing to clone karim_erp_test while other sessions are connected.');
        }
        await admin.query(`CREATE DATABASE ${quoteIdentifier(CLONE_DATABASE)} TEMPLATE ${quoteIdentifier(BASE_DATABASE)};`);
        cloneCreated = true;

        process.env.NODE_ENV = 'test';
        process.env.DB_HOST = DB_HOST;
        process.env.DB_PORT = String(DB_PORT);
        process.env.DB_NAME = CLONE_DATABASE;
        process.env.DB_USER = DB_USER;
        process.env.DB_PASSWORD = DB_PASSWORD;
        process.env.DB_POOL_MAX = '5';
        process.env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
        process.env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
        process.env.SKIP_BULLMQ = '1';
        process.env.LOG_LEVEL = 'fatal';

        const { postInventoryLedgerEntry } = require('../backend/inventory-ledger');
        const { pool: sharedPool } = require('../backend/shared-pool');
        const { register } = require('../backend/cashier-module/complete-sale');
        const { ensureKotSchema } = require('../backend/cashier-module/kot-routes');
        const { signAccessToken } = require('../backend/cashier-module/jwt-middleware');
        pool = sharedPool;
        fixtureClient = new Client({
            host: DB_HOST,
            port: DB_PORT,
            database: CLONE_DATABASE,
            user: DB_USER,
            password: DB_PASSWORD,
        });
        await fixtureClient.connect();

        const ids = await fixtureClient.query(`
            SELECT
              (SELECT COALESCE(MAX(id), 0) + 100000 FROM users) AS user_id,
              (SELECT COALESCE(MAX(id), 0) + 100000 FROM departments) AS erp_department_id,
              (SELECT COALESCE(MAX(id), 0) + 100000 FROM inventory) AS inventory_id,
              (SELECT id FROM inventory_locations WHERE code = 'MAIN-WAREHOUSE') AS main_location_id
        `);
        const userId = Number(ids.rows[0].user_id);
        const erpDepartmentId = Number(ids.rows[0].erp_department_id);
        const inventoryId = Number(ids.rows[0].inventory_id);
        const mainLocationId = Number(ids.rows[0].main_location_id);
        if (!mainLocationId) { throw new Error('The sandbox has no MAIN-WAREHOUSE location.'); }

        const code = `pos-test-${SCENARIO_ID}`;
        const username = `pos-test-${SCENARIO_ID}`;
        const productBarcode = `POS-TEST-${SCENARIO_ID}`;

        await fixtureClient.query('BEGIN');
        await fixtureClient.query(
                `INSERT INTO users (id, username, password, role, name, active)
                 VALUES ($1, $2, $3, 'admin', 'Synthetic POS test admin', true);`,
                [userId, username, `!test-only-${SCENARIO_ID}`]
        );
        await fixtureClient.query(
                `INSERT INTO departments (id, code, name, icon, color)
                 VALUES ($1, $2, 'Synthetic POS test department', 'test', '#000000');`,
                [erpDepartmentId, code]
        );
        const locationResult = await fixtureClient.query(
                `INSERT INTO inventory_locations (code, name_ar, location_type, negative_stock_policy)
                 VALUES ($1, 'مطبخ اختبار مؤقت', 'kitchen', 'deny')
                 RETURNING id;`,
                [`POS-TEST-${SCENARIO_ID}`]
        );
        const kitchenLocationId = Number(locationResult.rows[0].id);
        const departmentResult = await fixtureClient.query(
                `INSERT INTO pos_departments (code, name_ar, legacy_dept_code, location_id)
                 VALUES ($1, 'قسم اختبار مؤقت', $1, $2)
                 RETURNING id;`,
                [code, kitchenLocationId]
        );
        const departmentId = Number(departmentResult.rows[0].id);
        const productResult = await fixtureClient.query(
                `INSERT INTO pos_products (barcode, name_ar, department_id, price, stock_quantity, category, unit, is_active)
                 VALUES ($1, 'منتج وصفة اختبار مؤقت', $2, 10, 0, 'اختبار', 'piece', true)
                 RETURNING id;`,
                [productBarcode, departmentId]
        );
        const productId = Number(productResult.rows[0].id);
        await fixtureClient.query(
                `INSERT INTO inventory (id, name, unit, qty, "avgCost", inventory_uom)
                 VALUES ($1, 'مكون اختبار مؤقت', 'kg', 0, 1, 'kg');`,
                [inventoryId]
        );
        await fixtureClient.query(
                `INSERT INTO pos_product_ingredients (product_id, inventory_id, quantity_per_unit, unit)
                 VALUES ($1, $2, 1.25, 'kg');`,
                [productId, inventoryId]
        );
        await fixtureClient.query(
                `INSERT INTO kitchen_policies (department_id, kitchen_location_id, operation_mode, allow_fallback)
                 VALUES ($1, $2, 'flexible', true);`,
                [departmentId, kitchenLocationId]
        );
        const shiftResult = await fixtureClient.query(
                `INSERT INTO pos_shift_sessions (department_id, cashier_id, opening_balance, status)
                 VALUES ($1, $2, 100, 'open')
                 RETURNING id;`,
                [departmentId, userId]
        );
        const sessionId = Number(shiftResult.rows[0].id);

        await postInventoryLedgerEntry(fixtureClient, {
                transactionType: 'opening_balance',
                inventoryId,
                locationId: kitchenLocationId,
                quantityDelta: 0.5,
                unit: 'kg',
                referenceType: 'test_fixture',
                referenceId: SCENARIO_ID,
                idempotencyKey: `pos-test:${SCENARIO_ID}:kitchen-opening`,
                reason: 'synthetic test fixture',
        });
        await postInventoryLedgerEntry(fixtureClient, {
                transactionType: 'opening_balance',
                inventoryId,
                locationId: mainLocationId,
                quantityDelta: 5,
                unit: 'kg',
                referenceType: 'test_fixture',
                referenceId: SCENARIO_ID,
                idempotencyKey: `pos-test:${SCENARIO_ID}:main-opening`,
                reason: 'synthetic test fixture',
        });
        await fixtureClient.query('COMMIT');
        await ensureKotSchema();

        const app = express();
            app.use(express.json({ limit: '1mb' }));
            register(app);
            server = http.createServer(app);
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const port = server.address().port;
            const token = signAccessToken({
                id: userId,
                role: 'admin',
                name: 'Synthetic POS test admin',
            });
            const saleBody = {
                department_id: departmentId,
                items: [{ product_id: productId, quantity: 2, unit_price: 10, discount: 0 }],
                payments: [{ method: 'cash', amount: 23 }],
                printer_id: 'pos-test',
                session_id: sessionId,
            };

            const saleKey = `pos-test:${SCENARIO_ID}:fallback-sale`;
            const saleResponses = await Promise.all([
                request(port, '/api/sales/complete', saleBody, token, saleKey),
                request(port, '/api/sales/complete', saleBody, token, saleKey),
            ]);
            const sale = saleResponses[0].status === 201 ? saleResponses[0] : saleResponses[1];
            const successfulSales = saleResponses.filter((response) => response.status === 201);
            check(
                'Concurrent retry returns the same successful order',
                successfulSales.length === 2
                    && successfulSales.every((response) => response.json.order_id === sale.json?.order_id)
                    && successfulSales.filter((response) => response.json._idempotent_replay === true).length === 1,
                `HTTP ${saleResponses.map((response) => response.status).join('/')}`
            );

            if (successfulSales.length !== 2 || !sale.json.order_id) {
                throw new Error(`Unexpected sale responses: ${JSON.stringify(saleResponses.map((response) => response.json))}`);
            }

            const printJobs = await fixtureClient.query(
                `SELECT id, printer_id, status, payload, octet_length(payload) AS payload_bytes
                   FROM pos_pending_prints
                  WHERE order_id = $1
                  ORDER BY id;`,
                [sale.json.order_id]
            );
            const receiptJob = printJobs.rows.find((job) => job.printer_id === 'pos-test');
            const kotJob = printJobs.rows.find((job) => job.printer_id === `kot-${departmentId}`);
            check(
                'Receipt and KOT are queued as pending byte payloads only',
                !!receiptJob && !!kotJob
                    && printJobs.rows.length === 2
                    && printJobs.rows.every((job) => job.status === 'pending' && Number(job.payload_bytes) > 0)
                    && sale.json.print_job_id === receiptJob.id
                    && sale.json.kot_enabled === true
                    && sale.json.kot_jobs?.length === 1,
                `queued=${printJobs.rows.length}`
            );
            const kotPayload = kotJob?.payload?.toString('utf8') || '';
            check(
                'Kitchen ticket contains the item but no sale price/total',
                kotPayload.includes('منتج وصفة اختبار مؤقت')
                    && kotPayload.includes('لا تُطبع الأسعار على تذاكر المطبخ')
                    && !kotPayload.includes('23.00')
            );

            const posted = await fixtureClient.query(
                `SELECT l.location_id, l.quantity_delta, l.metadata,
                        kitchen.on_hand AS kitchen_on_hand, main.on_hand AS main_on_hand,
                        i.qty AS projected_qty,
                        (SELECT COUNT(*)::int FROM pos_stock_movements m
                          WHERE m.order_id = $2 AND m.product_id = $3
                            AND m.reason = 'sale_recipe'
                            AND m.quantity_delta = -2.5
                            AND (m.metadata->>'location_id')::bigint = $4) AS movement_count
                   FROM inventory_ledger l
                   JOIN inventory_location_balances kitchen
                     ON kitchen.inventory_id = l.inventory_id AND kitchen.location_id = $5
                   JOIN inventory_location_balances main
                     ON main.inventory_id = l.inventory_id AND main.location_id = $4
                   JOIN inventory i ON i.id = l.inventory_id
                  WHERE l.reference_type = 'pos_order' AND l.reference_id = $2::text
                    AND l.transaction_type = 'sale_consumption'
                    AND l.inventory_id = $1;`,
                [inventoryId, sale.json.order_id, productId, mainLocationId, kitchenLocationId]
            );
        check(
                'One ledger debit is posted to the main warehouse',
                posted.rows.length === 1
                    && Number(posted.rows[0].location_id) === mainLocationId
                    && Number(posted.rows[0].quantity_delta) === -2.5
                    && posted.rows[0].metadata?.fallback === true,
                `rows=${posted.rows.length}`
            );
        check(
                'Kitchen, warehouse, movement, and inventory projection reconcile',
                posted.rows.length === 1
                    && Number(posted.rows[0].kitchen_on_hand) === 0.5
                    && Number(posted.rows[0].main_on_hand) === 2.5
                    && Number(posted.rows[0].projected_qty) === 3
                    && Number(posted.rows[0].movement_count) === 1,
                posted.rows.length ? `kitchen=${posted.rows[0].kitchen_on_hand}, main=${posted.rows[0].main_on_hand}, projected=${posted.rows[0].projected_qty}` : 'no ledger result'
            );

        await fixtureClient.query('UPDATE kitchen_policies SET allow_fallback = false WHERE department_id = $1;', [departmentId]);
        const rejected = await request(port, '/api/sales/complete', saleBody, token, `pos-test:${SCENARIO_ID}:fallback-disabled`);
        check('Insufficient kitchen stock is rejected when fallback is disabled', rejected.status === 409 && rejected.json.error === 'INSUFFICIENT_INGREDIENT_STOCK', `HTTP ${rejected.status}`);

        const afterReject = await fixtureClient.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM pos_orders WHERE session_id = $1) AS order_count,
                    (SELECT COUNT(*)::int FROM inventory_ledger
                      WHERE inventory_id = $2 AND transaction_type = 'sale_consumption'
                        AND reference_type = 'pos_order') AS sale_ledger_count,
                    (SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $2 AND location_id = $3) AS main_on_hand,
                    (SELECT COUNT(*)::int FROM pos_idempotency_keys WHERE key = $4) AS rejected_key_count;`,
                [sessionId, inventoryId, mainLocationId, `pos-test:${SCENARIO_ID}:fallback-disabled`]
        );
        check(
                'Rejected sale leaves orders, ledger, balance, and idempotency unchanged',
                Number(afterReject.rows[0].order_count) === 1
                    && Number(afterReject.rows[0].sale_ledger_count) === 1
                    && Number(afterReject.rows[0].main_on_hand) === 2.5
                    && Number(afterReject.rows[0].rejected_key_count) === 0
        );

        await fixtureClient.query('UPDATE kitchen_policies SET allow_fallback = true WHERE department_id = $1;', [departmentId]);
        const insufficientBody = {
            ...saleBody,
            items: [{ product_id: productId, quantity: 3, unit_price: 10, discount: 0 }],
            payments: [{ method: 'cash', amount: 34.5 }],
        };
        const insufficient = await request(port, '/api/sales/complete', insufficientBody, token, `pos-test:${SCENARIO_ID}:not-enough-in-either-location`);
        check(
            'Insufficient stock is rejected when neither location can cover the full recipe',
            insufficient.status === 409 && insufficient.json.error === 'INSUFFICIENT_INGREDIENT_STOCK',
            `HTTP ${insufficient.status}`
        );

        const afterInsufficient = await fixtureClient.query(
            `SELECT
                    (SELECT COUNT(*)::int FROM pos_orders WHERE session_id = $1) AS order_count,
                    (SELECT COUNT(*)::int FROM inventory_ledger
                      WHERE inventory_id = $2 AND transaction_type = 'sale_consumption'
                        AND reference_type = 'pos_order') AS sale_ledger_count,
                    (SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $2 AND location_id = $3) AS main_on_hand,
                    (SELECT COUNT(*)::int FROM pos_idempotency_keys WHERE key = $4) AS rejected_key_count;`,
            [sessionId, inventoryId, mainLocationId, `pos-test:${SCENARIO_ID}:not-enough-in-either-location`]
        );
        check(
            'Insufficient-location rejection leaves stock and sales unchanged',
            Number(afterInsufficient.rows[0].order_count) === 1
                    && Number(afterInsufficient.rows[0].sale_ledger_count) === 1
                    && Number(afterInsufficient.rows[0].main_on_hand) === 2.5
                    && Number(afterInsufficient.rows[0].rejected_key_count) === 0
        );
    } finally {
        if (server?.listening) {
            await new Promise((resolve) => server.close(resolve));
        }
        if (pool) { await pool.end(); }
        if (fixtureClient) { await fixtureClient.end(); }
        if (cloneCreated) {
            await admin.query(`DROP DATABASE ${quoteIdentifier(CLONE_DATABASE)};`);
        }
        await admin.end();
    }

    console.log('RESULT inventory HTTP sandbox scenario passed; temporary database dropped.');
}

main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
