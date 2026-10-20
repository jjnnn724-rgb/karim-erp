/**
 * buffet-menu-security.test.js — تأمين POST /api/buffet-menu
 * ─────────────────────────────────────────────────────────
 * اختباري أمان للمسار بعد الإصلاح:
 * (أ) طلب بدون JWT → 401
 * (ب) طلب بـ JWT ولكن حقول غير صالحة → 400
 * لا يستورد server.js الإنتاجي ولا يفتح اتصالاً بقاعدة حية.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars!!';

const http = require('http');
const express = require('express');
const { sign } = require('jsonwebtoken');
const { register } = require('../backend/menu-legacy-routes');

function makeApp() {
    const app = express();
    app.use(express.json());
    const io = { emit: () => {} };
    register(app, { io });
    return app;
}

function startServer(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

function request(server, method, path, body, token) {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        const opts = {
            host: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

describe('POST /api/buffet-menu security', () => {
    let server;
    let validToken;

    beforeAll(async () => {
        // توكن صالح لدور cashier (مثل ما يُصدر عند تسجيل الدخول الحقيقي)
        validToken = sign({ id: 1, username: 'cashier1', role: 'cashier' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
        server = await startServer(makeApp());
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    test('(أ) طلب بدون JWT → 401', async () => {
        const res = await request(server, 'POST', '/api/buffet-menu', {
            restaurant: { nameAr: 'مطعم اختبار', nameEn: 'Test Restaurant' },
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
    });

    test('(ب) طلب بـ JWT مع حقول غير صالحة → 400', async () => {
        const res = await request(server, 'POST', '/api/buffet-menu', {
            restaurant: { nameAr: 12345 }, // يجب أن يكون نصاً، وليس رقمًا
        }, validToken);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(Array.isArray(res.body.fields)).toBe(true);
        expect(res.body.fields).toContain('restaurant.nameAr');
    });

    test('(ب2) طلب بـ JWT مع payload صحيح → 200', async () => {
        const res = await request(server, 'POST', '/api/buffet-menu', {
            restaurant: { nameAr: 'مطعم اختبار', nameEn: 'Test Restaurant', buffetPrice: 149 },
            categories: [
                {
                    nameAr: 'أصناف أولى',
                    nameEn: 'Starters',
                    items: [
                        { nameAr: 'شوربة عدس', nameEn: 'Lentil Soup', meal: ['lunch', 'dinner'] },
                    ],
                },
            ],
        }, validToken);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});
