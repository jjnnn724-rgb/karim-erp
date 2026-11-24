/**
 * api-cache-invalidation.test.js — الكاش لا يكذب بعد الكتابة (2026-10-29)
 * ══════════════════════════════════════════════════════════════════════════
 * الحادث (بلاغ المالك): اعتماد إذن الصرف ينجح في الخادم، ثم تُعيد الشاشة
 * تحميل قائمة الأذون فتنزل من كاش GET عمره 30 ثانية بنفس الحالة القديمة،
 * فتُمحى صفة «معتمد» أمام المستخدم. يظن أن الضغط لم يعمل فيضغط ثانية ويجد
 «خرج من حالة الانتظار»، ثم يريفّش بعد نصف دقيقة فتظهر الحقيقة.
 * العقد المثبَّت هنا: كل كتابة 2xx تحت /api تُبطل قراءات غصنها (وغصون
 * مواردها المتأثرة)، والكتابة الفاشلة لا تُبطل شيئًا، و/api/state لا يُخزَّن.
 */
'use strict';

const express = require('express');
const http = require('http');
const {
    apiCacheMiddleware,
    apiCacheInvalidator,
    invalidateAll,
    invalidateForResource,
    resourceSegments,
    onSameBranch,
    size,
} = require('../backend/api-cache');
const { closeHttpServer } = require('./helpers/http-server');

const AUTH = 'Bearer test-session-A';

function makeApp() {
    const counts = { dispatches: 0, inventory: 0, state: 0, writes: 0 };
    const app = express();
    app.use(apiCacheMiddleware);
    app.use(apiCacheInvalidator);
    app.get('/api/dispatches', (_req, res) => {
        counts.dispatches += 1;
        res.json({ data: [{ id: 7, status: 'pending' }], reads: counts.dispatches });
    });
    app.get('/api/warehouse/inventory', (_req, res) => {
        counts.inventory += 1;
        res.json({ data: [{ id: 3, qty: 10 }], reads: counts.inventory });
    });
    app.get('/api/state', (_req, res) => {
        counts.state += 1;
        res.json({ ok: true, reads: counts.state });
    });
    app.post('/api/warehouse/dispatches/:id/approve', (_req, res) => {
        counts.writes += 1;
        res.json({ dispatch: { id: 7, status: 'approved' } });
    });
    app.post('/api/dispatches', (_req, res) => {
        counts.writes += 1;
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'بيانات غير صالحة' });
    });
    app.post('/api/auth/login', (_req, res) => {
        counts.writes += 1;
        res.json({ token: 'x' });
    });
    const srv = app.listen(0);
    const port = srv.address().port;
    const call = (method, path, headers) => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1', port, path, method,
            headers: Object.assign({ Authorization: AUTH }, headers || {}),
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                cache: res.headers['x-cache'] || null,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
            }));
        });
        req.on('error', reject);
        req.end();
    });
    return { app, srv, counts, call, port };
}

describe('api-cache — إبطال موجّه بالموارد بعد الكتابة', () => {
    let h;
    beforeEach(() => { invalidateAll(); h = makeApp(); });
    afterEach(async () => { await closeHttpServer(h.srv); invalidateAll(); });

    test('قراءتان متتاليتان بلا كتابة: الثانية HIT من الكاش', async () => {
        const a = await h.call('GET', '/api/dispatches?page=1&limit=1000&sort=id&order=desc&v2_period=month');
        const b = await h.call('GET', '/api/dispatches?page=1&limit=1000&sort=id&order=desc&v2_period=month');
        expect(a.cache).toBe('MISS');
        expect(b.cache).toBe('HIT');
        expect(h.counts.dispatches).toBe(1);
    });

    test('كتابة اعتماد ناجحة تُبطل قائمة الأذون — الشاشة ترى الحالة الجديدة فورًا', async () => {
        await h.call('GET', '/api/dispatches?page=1&limit=1000');
        await h.call('GET', '/api/dispatches?page=1&limit=1000');
        expect(h.counts.dispatches).toBe(1);
        const w = await h.call('POST', '/api/warehouse/dispatches/7/approve', { 'Content-Type': 'application/json' });
        expect(w.status).toBe(200);
        const after = await h.call('GET', '/api/dispatches?page=1&limit=1000');
        expect(after.cache).toBe('MISS');
        expect(h.counts.dispatches).toBe(2);
    });

    test('اعتماد الصرف يُبطل قراءات المخزون المتأثرة بالخصم (غصن التأثير)', async () => {
        await h.call('GET', '/api/warehouse/inventory?page=1');
        await h.call('GET', '/api/warehouse/inventory?page=1');
        expect(h.counts.inventory).toBe(1);
        await h.call('POST', '/api/warehouse/dispatches/7/approve', { 'Content-Type': 'application/json' });
        const after = await h.call('GET', '/api/warehouse/inventory?page=1');
        expect(after.cache).toBe('MISS');
        expect(h.counts.inventory).toBe(2);
    });

    test('كتابة لا علاقة لها بالغصن لا تكسر كاش الأذون (لا مسح شامل)', async () => {
        await h.call('GET', '/api/dispatches?page=1');
        await h.call('GET', '/api/dispatches?page=1');
        const before = h.counts.dispatches;
        await h.call('POST', '/api/auth/login', { 'Content-Type': 'application/json' });
        const still = await h.call('GET', '/api/dispatches?page=1');
        expect(still.cache).toBe('HIT');
        expect(h.counts.dispatches).toBe(before);
    });

    test('كتابة فاشلة (4xx) لا تُبطل شيئًا — لم تتغير بيانات', async () => {
        await h.call('GET', '/api/dispatches?page=1');
        await h.call('GET', '/api/dispatches?page=1');
        const bad = await h.call('POST', '/api/dispatches', { 'Content-Type': 'application/json' });
        expect(bad.status).toBe(400);
        const after = await h.call('GET', '/api/dispatches?page=1');
        expect(after.cache).toBe('HIT');
        expect(h.counts.dispatches).toBe(1);
    });

    test('كل جلسة ترى كاشها: مفتاح الجلسة لا يتقاطع مع جلسة أخرى', async () => {
        await h.call('GET', '/api/dispatches?page=1');
        const other = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1', port: h.port, path: '/api/dispatches?page=1', method: 'GET',
                headers: { Authorization: 'Bearer test-session-B' },
            }, (res) => {
                res.on('data', () => {});
                res.on('end', () => resolve(res.headers['x-cache']));
            });
            req.on('error', reject);
            req.end();
        });
        expect(other).toBe('MISS');
    });

    test('/api/state لا يُخزَّن ولا يُبطل — خارج الكاش أصلًا', async () => {
        await h.call('GET', '/api/state');
        await h.call('GET', '/api/state');
        expect(h.counts.state).toBe(2);
        expect(size()).toBe(0);
    });
});

describe('api-cache — قواعد المقاطع (تُختبر وحدها لأنها عصب التوجيه)', () => {
    test('المعرّفات والأفعال والكلمات السياقية ليست موارد', () => {
        expect([...resourceSegments('/api/warehouse/dispatches/42/approve')]).toEqual(['warehouse', 'dispatches']);
        expect([...resourceSegments('/api/accounting/journal/9f8e7d6c5b4a3f2e1d0c/review')]).toEqual(['accounting', 'journal']);
        expect([...resourceSegments('/api/dispatches?page=1&limit=1000')]).toEqual(['dispatches']);
    });

    test('التوجيه: subset أو تساوٍ = نفس الغصن', () => {
        expect(onSameBranch(new Set(['warehouse', 'dispatches']), new Set(['dispatches']))).toBe(true);
        expect(onSameBranch(new Set(['dispatches']), new Set(['dispatches']))).toBe(true);
        expect(onSameBranch(new Set(['warehouse', 'dispatches']), new Set(['warehouse', 'dispatches', 'dept-panel']))).toBe(true);
        expect(onSameBranch(new Set(['finance', 'journal']), new Set(['warehouse', 'dispatches']))).toBe(false);
        expect(onSameBranch(new Set(), new Set(['dispatches']))).toBe(false);
    });

    test('invalidateForResource يحذف المدخل المطابق ويعيد عدد المحذوف', () => {
        invalidateAll();
        const removedFromEmpty = invalidateForResource('/api/warehouse/dispatches/7/approve');
        expect(removedFromEmpty).toBe(0);
    });
});
