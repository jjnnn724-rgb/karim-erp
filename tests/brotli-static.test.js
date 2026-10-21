/**
 * brotli-static.test.js — عقد وسيط Brotli للأصول الساكنة
 * ────────────────────────────────────────────────────────────────────────
 * لماذا: نشر aaPanel يجعل Nginx مجرد reverse proxy لا يقرأ القرص، فالضغط
 * مسؤولية Node. هذا الملف يثبّت سلوك الوسيط على HTTP حقيقي:
 *   1) العميل الذي يعلن br يحصل على Content-Encoding: br + Vary، والمحتوى يفكّ للأصل بالبايت
 *   2) ETag/304 يعملان على نسخة الكاش، وترويسات الكاش تُحسب من مسار الملف الأصلي
 *   3) الحالات التي يجب ألا يلمسها الوسيط تمرّ لأسفل بلا أي أثر:
 *      عميل بلا br · POST · امتداد غير قابل للضغط · ملف مجهري · مسار نقطة · traversal · ملف غائب
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createBrotliStatic } = require('../backend/middleware/brotli-static');
const { closeHttpServer } = require('./helpers/http-server');

const BODY = Buffer.from('/* v2 module */\n' + 'export const x = 1;\n'.repeat(120), 'utf8'); // > 1KB

function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br-root-'));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'br-cache-'));
    fs.writeFileSync(path.join(root, 'mod.js'), BODY);
    fs.writeFileSync(path.join(root, 'tiny.js'), '// tiny\n');              // أصغر من MIN_BYTES
    fs.writeFileSync(path.join(root, 'pixel.png'), Buffer.alloc(4096, 7));  // امتداد غير قابل للضغط
    fs.writeFileSync(path.join(root, '.secret.js'), BODY);                  // مسار نقطة
    return { root, cache };
}

function serve(fixture) {
    const seen = [];
    const options = {
        rootDir: fixture.root,
        cacheDir: fixture.cache,
        setCacheHeaders: (res, filePath) => { seen.push(filePath); },
    };
    const middleware = createBrotliStatic(options);
    const app = express();
    app.use('/app', middleware);
    app.use('/app', (req, res) => res.status(599).send('FALLTHROUGH'));
    const srv = app.listen(0);
    const port = srv.address().port;

    const request = (method, p, headers) => new Promise((resolve, reject) => {
        const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        r.on('error', reject);
        r.end();
    });

    return { srv, seen, middleware, get: (p, headers) => request('GET', p, headers) };
}

function cleanup(fixture) {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(fixture.cache, { recursive: true, force: true });
}

describe('brotli-static — تقديم مضغوط صحيح', () => {
    let fx, s;
    beforeEach(() => { fx = makeFixture(); s = serve(fx); });
    afterEach(async () => { await closeHttpServer(s.srv); cleanup(fx); });

    test('العميل الذي يدعم br يحصل على نسخة مضغوطة تفكّ للأصل بالبايت', async () => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(r.status).toBe(200);
        expect(r.headers['content-encoding']).toBe('br');
        expect(r.headers.vary).toMatch(/accept-encoding/i);
        expect(r.headers['content-type']).toMatch(/javascript/);
        expect(zlib.brotliDecompressSync(r.body).equals(BODY)).toBe(true);
        expect(r.body.length).toBeLessThan(BODY.length);
    });

    test('تتولد نسخة كاش واحدة على الأقل، والطلب التالي يبقى صحيحًا', async () => {
        await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(fs.readdirSync(fx.cache).length).toBeGreaterThan(0);
        const again = await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(zlib.brotliDecompressSync(again.body).equals(BODY)).toBe(true);
    });

    test('ETag يعمل و 304 بلا جسم', async () => {
        const first = await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(first.headers.etag).toBeTruthy();
        const revalidated = await s.get('/app/mod.js', { 'Accept-Encoding': 'br', 'If-None-Match': first.headers.etag });
        expect(revalidated.status).toBe(304);
        expect(revalidated.body.length).toBe(0);
    });

    test('ترويسات الكاش تُحسب من مسار الملف الأصلي لا من مسار الكاش', async () => {
        await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(s.seen).toContain(path.join(fx.root, 'mod.js'));
        expect(s.seen.some((p) => p.startsWith(fx.cache))).toBe(false);
    });

    test('HEAD يُخدم بـ br و بلا جسم', async () => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        const head = await new Promise((resolve, reject) => {
            const rq = http.request({ hostname: '127.0.0.1', port: s.srv.address().port, path: '/app/mod.js', method: 'HEAD', headers: { 'Accept-Encoding': 'br' } }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            });
            rq.on('error', reject);
            rq.end();
        });
        expect(r.status).toBe(200);
        expect(head.status).toBe(200);
        expect(head.headers['content-encoding']).toBe('br');
        expect(head.body.length).toBe(0);
    });
});

describe('brotli-static — الحالات التي يجب ألا يلمسها الوسيط', () => {
    let fx, s;
    beforeEach(() => { fx = makeFixture(); s = serve(fx); });
    afterEach(async () => { await closeHttpServer(s.srv); cleanup(fx); });

    test('عميل لا يدعم br (gzip) يمرّ للأسفل بلا محاولة ضغط', async () => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': 'gzip' });
        expect(r.status).toBe(599);
        expect(r.headers['content-encoding']).toBeUndefined();
        expect(fs.readdirSync(fx.cache).length).toBe(0);
    });

    test.each([
        ['br;q=0, gzip', 'رفض br صراحةً'],
        ['gzip, br;q=0.000', 'رفض br بجودة صفرية'],
        ['gzip, *;q=0.5, br;q=0', 'تفضيل br الصريح يتقدم على wildcard'],
        ['br;q=1.1', 'قيمة جودة غير صالحة'],
        ['br;level=5', 'معامل ترميز غير مدعوم'],
    ])('عميل %s يمرّ للأسفل دون Brotli (%s)', async (acceptEncoding) => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': acceptEncoding });
        expect(r.status).toBe(599);
        expect(r.headers['content-encoding']).toBeUndefined();
        expect(fs.readdirSync(fx.cache).length).toBe(0);
    });

    test.each([
        ['br;q=0.5, gzip', true],
        ['gzip, *;q=0.5', true],
        ['gzip, *;q=0, br;q=1', true],
    ])('عميل %s يحصل على Brotli عندما تكون جودته موجبة', async (acceptEncoding) => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': acceptEncoding });
        expect(r.status).toBe(200);
        expect(r.headers['content-encoding']).toBe('br');
    });

    test('POST يمرّ للأسفل', async () => {
        const r = await s.get('/app/mod.js', { 'Accept-Encoding': 'br', 'x-method-probe': '1' });
        expect(r.status).toBe(200);
        const post = await new Promise((resolve, reject) => {
            const rq = http.request({ hostname: '127.0.0.1', port: s.srv.address().port, path: '/app/mod.js', method: 'POST', headers: { 'Accept-Encoding': 'br' } }, (res) => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
            });
            rq.on('error', reject);
            rq.end();
        });
        expect(post.status).toBe(599);
        expect(post.headers['content-encoding']).toBeUndefined();
    });

    test('امتداد غير قابل للضغط (png) يمرّ للأسفل', async () => {
        const r = await s.get('/app/pixel.png', { 'Accept-Encoding': 'br' });
        expect(r.status).toBe(599);
        expect(fs.readdirSync(fx.cache).length).toBe(0);
    });

    test('ملف أصغر من الحد الأدنى (1KB) يمرّ للأسفل', async () => {
        const r = await s.get('/app/tiny.js', { 'Accept-Encoding': 'br' });
        expect(r.status).toBe(599);
        expect(fs.readdirSync(fx.cache).length).toBe(0);
    });

    test('مسار نقطة (dotfile) مرفوض', async () => {
        const r = await s.get('/app/.secret.js', { 'Accept-Encoding': 'br' });
        expect(r.status).toBe(599);
    });

    test('traversal لا يقرأ خارج الجذر ولا يُخزَّن', async () => {
        const outside = path.join(path.dirname(fx.root), 'br-outside.json');
        fs.writeFileSync(outside, '{"name":"karim-erp"}');
        try {
            const r = await s.get('/app/..%2f..%2fbr-outside.json', { 'Accept-Encoding': 'br' });
            expect(r.status).toBe(599);
            expect(r.body.toString()).not.toContain('karim-erp');
            expect(fs.readdirSync(fx.cache).length).toBe(0);
        } finally { fs.rmSync(outside, { force: true }); }
    });

    test('ملف غائب يمرّ للأسفل بلا إنشاء كاش', async () => {
        const r = await s.get('/app/does-not-exist.js', { 'Accept-Encoding': 'br' });
        expect(r.status).toBe(599);
        expect(fs.readdirSync(fx.cache).length).toBe(0);
    });
});
