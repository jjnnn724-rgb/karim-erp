/**
 * ai-assistant-routes.test.js — بوابة المساعد: session + أدمن + سقف طلبات
 * ══════════════════════════════════════════════════════════════════════
 * المساعد يقرأ المشروع ويقرأ حالة النظام الحيّة ⇒ لا بدّ من قفل صارم:
 *   (أ) بلا JWT → 401
 *   (ب) بدور غير admin → 403
 *   (ج) سؤال فارغ → 400
 *   (د) الأدمن → 200 وردّ (قواعديًّا حين لا مفتاح — فالنتيجة حتمية)
 *   (هـ) سقف الطلبات: 12 لكل مستخدم كل 5 دقائق ثم 429
 *   (و) لا تُقرأ ملفات خارج المسموح (‎.env‎ والأسرار مرفوضة)
 * لا يفتح اتصالاً بقاعدة حقيقية: shared-pool مُموهَم.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars!!';
/* لا نموذج في الاختبار: لا شبكة ولا حصة. الوضع القواعدي هو السلوك
   المتوقع هنا (وهو أيضًا ما يحدث للمالك حين لا مفتاح). */
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';

jest.mock('../backend/whatsapp-engine/ai/gemini', () => ({
    enabled: () => false,
    model: () => 'test-model',
    generate: async () => { throw new Error('GEMINI_DISABLED'); },
    generateWithRetry: async () => { throw new Error('GEMINI_DISABLED'); },
    systemGuard: () => 'test guard',
}));

jest.mock('../backend/shared-pool', () => {
    const client = { query: async () => ({ rows: [{ ok: 1, n: 0 }] }), release: () => {} };
    return {
        pool: {
            query: async () => ({ rows: [{ ok: 1, n: 0 }] }),
            connect: async () => client,
            on: () => {},
            end: async () => {},
        },
    };
});

const http = require('http');
const express = require('express');
const { sign } = require('jsonwebtoken');
const { router, assistantLimiter, MAX_PER_WINDOW } = require('../backend/ai-assistant/routes');
const assistant = require('../backend/ai-assistant/assistant');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ai-assistant', router);
    return app;
}

function request(server, method, path, body, token) {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        const opts = {
            host: '127.0.0.1', port: addr.port, path, method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
        if (body) {req.write(JSON.stringify(body));}
        req.end();
    });
}

const tokenFor = (role) => sign({ id: 7, username: 'admin1', role }, process.env.JWT_ACCESS_SECRET, { expiresIn: '10m' });

describe('بوابة المساعد — session + admin + سقف', () => {
    let server;
    let adminToken;
    let cashierToken;

    beforeAll(async () => {
        const app = makeApp();
        server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        adminToken = tokenFor('admin');
        cashierToken = tokenFor('cashier');
    });

    afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

    test('بلا جلسة → 401', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: 'مرحبا' });
        expect(r.status).toBe(401);
    });

    test('دور غير أدمن → 403', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: 'مرحبا' }, cashierToken);
        expect(r.status).toBe(403);
    });

    test('سؤال فارغ → 400', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: '   ' }, adminToken);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('EMPTY_QUESTION');
    });

    test('سؤال أطول من السقف → 400', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: 'س'.repeat(900) }, adminToken);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('QUESTION_TOO_LONG');
    });

    test('الأدمن → 200 وردّ قواعدي (بلا مفتاح: النتيجة حتمية بلا نموذج)', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: 'أين باب المخزون؟', mode: 'knowledge' }, adminToken);
        expect(r.status).toBe(200);
        expect(typeof r.body.text).toBe('string');
        expect(r.body.text.length).toBeGreaterThan(20);
        expect(r.body.fallback).toBe(true);   // لا مفتاح في بيئة الاختبار
        expect(r.body.mode).toBe('knowledge');
    });

    test('وضع التشخيص يقرأ حيًّا (القراءات في الرد)', async () => {
        const r = await request(server, 'POST', '/api/ai-assistant/ask', { question: 'هل القاعدة بخير؟', mode: 'diagnose' }, adminToken);
        expect(r.status).toBe(200);
        expect(r.body.text).toMatch(/قاعدة البيانات/);
    });

    test('حالة المساعد: مجاني ومتاح', async () => {
        const r = await request(server, 'GET', '/api/ai-assistant/status', null, adminToken);
        expect(r.status).toBe(200);
        expect(r.body.free).toBe(true);
        expect(r.body.enabled).toBe(false);   // لا مفتاح في بيئة الاختبار ⇒ وضع قواعدي
        expect(r.body.modes).toEqual(['knowledge', 'diagnose', 'code']);
    });

    test('سقف الطلبات: الطلب الثالث عشر → 429', () => {
        const res = { statusCode: 200, set() {}, status(c) { this.statusCode = c; return this; }, json() { return this; } };
        const req = { user: { id: 99 }, ip: '1.2.3.4' };
        let blockedAt = -1;
        for (let i = 0; i <= MAX_PER_WINDOW; i++) {
            let called = false;
            assistantLimiter(req, res, () => { called = true; });
            if (!called) { blockedAt = i; break; }
        }
        expect(blockedAt).toBe(MAX_PER_WINDOW);   // الطلب رقم 13 هو المرفوض
    });
});

describe('المساعد — ما لا يُقرأ وما لا يُرسل', () => {
    test('ملفات الإعدادات والأسرار مرفوضة', () => {
        expect(assistant.isReadable('.env')).toBe(false);
        expect(assistant.isReadable('database/backups/karim_erp-latest.dump')).toBe(false);
        expect(assistant.isReadable('frontend/app/js/v2/../secrets.js')).toBe(false);
        expect(assistant.isReadable('backend/../.env.production')).toBe(false);
    });

    test('ملفات المشروع مقروءة', () => {
        expect(assistant.isReadable('frontend/app/js/v2/screens/kitchen.js')).toBe(true);
        expect(assistant.isReadable('backend/ai-assistant/assistant.js')).toBe(true);
        expect(assistant.isReadable('tests/v2-kitchen.test.js')).toBe(true);
    });

    test('السياق لا يحمل كلمة مرور ولا سطر قاعدة', async () => {
        const ctx = assistant.codeSnippets(['backend/ai-assistant/assistant.js', '.env']);
        expect(ctx).not.toMatch(/DB_PASSWORD\s*=/);
        expect(ctx).not.toMatch(/JWT_/);
    });

    test('وضع الكود يرفض ما هو خارج المسموح ويقول ذلك', () => {
        const ctx = assistant.codeSnippets(['.env', 'C:/Windows/System32/config/SAM']);
        expect(ctx).toMatch(/مرفوض/);
    });
});
