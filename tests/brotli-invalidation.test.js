/**
 * brotli-invalidation.test.js — عقد إبطال كاش Brotli (المرحلة 3)
 * ────────────────────────────────────────────────────────────────────────
 * لماذا: بعد أن صار الكاش دائمًا وقابلًا للتنظيف، تبقى مشكلة «النسخة الصدئة»:
 * ملف تغيّر على القرص ونسخته القديمة ما زالت في الكاش. هذا الملف يثبّت:
 *   1) invalidate(ملف): يحذف نسخته وحدها، ويعيد الضغط br في الطلب التالي
 *   2) حماية الجذر: أي مسار خارج rootDir أو غير متتبَّع = صفر حذف بلا رمي
 *   3) invalidateAll(): يفرغ المجلد ولا يمسّ الأصول الأصلية، والخدمة تستمر br
 *   4) watch(): في الإنتاج لا يُنشأ مراقب إطلاقًا؛ في التطوير يلتقط التغيّر
 *   5) stopWatch() و getActiveBrotliStatic() عقود واضحة
 *   6) صفر تغيير في سلوك HTTP: كل الحالات تعيد 200 + Content-Encoding: br
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const {
    createBrotliStatic, getActiveBrotliStatic,
} = require('../backend/middleware/brotli-static');
const { closeHttpServer } = require('./helpers/http-server');

const ORIGINAL_ENV = process.env.NODE_ENV;

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }
const list = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (_) { return []; } };

/** محتوى قابل للضغط بوضوح (تكرار) وحجمه فوق حد 1KB الأدنى */
function payload(marker) { return Buffer.from(`/* ${marker} */\n` + 'const a = 1;\n'.repeat(200)); }

function writeAsset(root, rel, marker) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, payload(marker));
    return full;
}

function get(port, p, headers) {
    return new Promise((resolve, reject) => {
        const r = http.request({ hostname: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        r.on('error', reject);
        r.end();
    });
}

async function waitFor(check, budgetMs) {
    const deadline = Date.now() + (budgetMs || 8000);
    for (;;) {
        if (await check()) { return true; }
        if (Date.now() > deadline) { return false; }
        await new Promise((r) => setTimeout(r, 100));
    }
}

/** منصة اختبار: وسيط حقيقي فوق شجرة مؤقتة + خادم على منفذ عشوائي */
function stage(root, cacheDir) {
    const mw = createBrotliStatic({ rootDir: root, cacheDir });
    const app = express();
    app.use('/app', mw);
    app.use('/app', express.static(root, { fallthrough: false }));
    const srv = app.listen(0);
    return { mw, srv, port: srv.address().port };
}

let root, cache;
beforeEach(() => {
    root = tmpDir('br-inv-root-');
    cache = tmpDir('br-inv-cache-');
});
afterEach(() => {
    if (ORIGINAL_ENV === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = ORIGINAL_ENV; }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
});

describe('brotli-invalidation — invalidate() لملف واحد', () => {
    test('يحذف نسخة الملف وحده، والأصل يبقى، والطلب التالي يخدم br', async () => {
        process.env.NODE_ENV = 'production';
        const a = writeAsset(root, 'js/v2/a.js', 'A');
        writeAsset(root, 'js/v2/b.js', 'B');
        const { mw, srv, port } = stage(root, cache);
        try {
            await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            await get(port, '/app/js/v2/b.js', { 'Accept-Encoding': 'br' });
            await waitFor(() => list(cache).length === 2);
            expect(list(cache).length).toBe(2);

            const r = mw.invalidate(a);
            expect(r.scope).toBe('file');
            expect(r.removed).toBe(1);
            expect(r.bytes).toBeGreaterThan(0);
            expect(list(cache).length).toBe(1);            // نسخة b باقية
            expect(fs.existsSync(a)).toBe(true);           // الأصل لم يُمسّ

            const again = await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            expect(again.status).toBe(200);
            expect(again.headers['content-encoding']).toBe('br');
            await waitFor(() => list(cache).length === 2); // أُعيد الضغط
            expect(list(cache).length).toBe(2);
        } finally { await closeHttpServer(srv); }
    });

    test('ملف لم تُضغط نسخته في هذه العملية = صفر حذف بلا رمي', async () => {
        process.env.NODE_ENV = 'production';
        const untouched = writeAsset(root, 'js/v2/never.js', 'N');
        const { mw, srv } = stage(root, cache);
        try {
            const r = mw.invalidate(untouched);
            expect(r.removed).toBe(0);
            expect(r.bytes).toBe(0);
        } finally { await closeHttpServer(srv); }
    });

    test('يبطل ملفًا موجودًا على القرص حتى عند غياب خريطة الذاكرة بعد إعادة التشغيل', async () => {
        process.env.NODE_ENV = 'production';
        const asset = writeAsset(root, 'js/v2/persisted.js', 'PERSISTED');
        const first = stage(root, cache);
        try {
            const response = await get(first.port, '/app/js/v2/persisted.js', { 'Accept-Encoding': 'br' });
            expect(response.status).toBe(200);
            expect(list(cache)).toHaveLength(1);
        } finally { await closeHttpServer(first.srv); }

        const restarted = createBrotliStatic({ rootDir: root, cacheDir: cache });
        const result = restarted.invalidate(asset);
        expect(result.scope).toBe('file');
        expect(result.removed).toBe(1);
        expect(result.bytes).toBeGreaterThan(0);
        expect(list(cache)).toEqual([]);
        expect(fs.existsSync(asset)).toBe(true);
    });

    test('حماية الجذر: مسار خارج rootDir ومسار فارغ = صفر حذف', async () => {
        process.env.NODE_ENV = 'production';
        const { mw, srv } = stage(root, cache);
        try {
            const outside = path.join(os.tmpdir(), 'br-inv-outside.js');
            fs.writeFileSync(outside, payload('OUT'));
            try {
                expect(mw.invalidate(outside).removed).toBe(0);
                expect(mw.invalidate('').removed).toBe(0);
                expect(mw.invalidate(null).removed).toBe(0);
            } finally { fs.rmSync(outside, { force: true }); }
        } finally { await closeHttpServer(srv); }
    });
});

describe('brotli-invalidation — invalidateAll()', () => {
    test('يفرغ الكاش ولا يمسّ الأصول، والفروع تُعاد br بعدها', async () => {
        process.env.NODE_ENV = 'production';
        const a = writeAsset(root, 'js/v2/a.js', 'A');
        const b = writeAsset(root, 'css/style.css', 'S');
        const { mw, srv, port } = stage(root, cache);
        try {
            await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            await get(port, '/app/css/style.css', { 'Accept-Encoding': 'br' });
            await waitFor(() => list(cache).length === 2);

            const r = mw.invalidateAll();
            expect(r.scope).toBe('all');
            expect(r.removed).toBe(2);
            expect(r.bytes).toBeGreaterThan(0);
            expect(list(cache)).toEqual([]);
            expect(fs.existsSync(a) && fs.existsSync(b)).toBe(true);

            const ra = await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            const rb = await get(port, '/app/css/style.css', { 'Accept-Encoding': 'br' });
            expect(ra.headers['content-encoding']).toBe('br');
            expect(rb.headers['content-encoding']).toBe('br');
        } finally { await closeHttpServer(srv); }
    });

    test('مجلد كاش غائب = صفر حذف بلا رمي', async () => {
        process.env.NODE_ENV = 'production';
        const { mw, srv } = stage(root, path.join(cache, 'does-not-exist'));
        try {
            expect(mw.invalidateAll()).toEqual({ scope: 'all', removed: 0, bytes: 0 });
        } finally { await closeHttpServer(srv); }
    });
});

describe('brotli-invalidation — watch()', () => {
    test('في الإنتاج لا يُنشأ مراقب إطلاقًا', async () => {
        process.env.NODE_ENV = 'production';
        const { mw, srv } = stage(root, cache);
        try {
            expect(mw.watch()).toBe(false);
            expect(mw.stopWatch()).toBe(false);
        } finally { await closeHttpServer(srv); }
    });

    test('في بيئة الاختبارات (test) لا يُنشأ مراقب عرضًا — إلا بطلب صريح', async () => {
        process.env.NODE_ENV = 'test';
        const { mw, srv } = stage(root, cache);
        try {
            expect(mw.watch()).toBe(false);
            expect(mw.watch({ enabled: true })).toBe(true);   // طلب صريح يتجاوز الافتراضي
            expect(mw.stopWatch()).toBe(true);
        } finally { await closeHttpServer(srv); }
    });

    // هذا الاختبار هو أيضًا حرس انحدار لانهيار Windows/libuv: الشجرة المؤقتة تقع
    // تحت os.tmpdir() الذي قد يكون بصيغة 8.3 (ADMINI~1). لو مُرّر المسار القصير
    // إلى fs.watch لسقطت العملية بتأكيد قاتل بدل أن يفشل الاختبار بهدوء.
    test('في التطوير يلتقط تغيّر الملف فيُبطل نسخته، والخدمة تبقى br', async () => {
        process.env.NODE_ENV = 'development';
        writeAsset(root, 'js/v2/a.js', 'A');
        const { mw, srv, port } = stage(root, cache);
        try {
            expect(mw.watch()).toBe(true);
            await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            await waitFor(() => list(cache).length === 1);
            expect(list(cache).length).toBe(1);

            fs.writeFileSync(path.join(root, 'js/v2/a.js'), payload('A-CHANGED'));
            const invalidated = await waitFor(() => list(cache).length === 0);
            expect(invalidated).toBe(true);

            const r = await get(port, '/app/js/v2/a.js', { 'Accept-Encoding': 'br' });
            expect(r.status).toBe(200);
            expect(r.headers['content-encoding']).toBe('br');
            expect(mw.stopWatch()).toBe(true);
            expect(mw.stopWatch()).toBe(false);
        } finally { await closeHttpServer(srv); }
    });

    test('watch مرتين لا يُنشئ مراقبين — النداء الثاني يكتفي بالأول', async () => {
        process.env.NODE_ENV = 'development';
        writeAsset(root, 'js/v2/a.js', 'A');
        const { mw, srv } = stage(root, cache);
        try {
            expect(mw.watch()).toBe(true);
            expect(mw.watch()).toBe(true);
            expect(mw.stopWatch()).toBe(true);
        } finally { await closeHttpServer(srv); }
    });
});

describe('brotli-invalidation — النسخة النشطة', () => {
    test('getActiveBrotliStatic() يعيد آخر وسيط بُني، والـendpoint يعتمد عليه', async () => {
        process.env.NODE_ENV = 'production';
        const { mw, srv } = stage(root, cache);
        try {
            expect(getActiveBrotliStatic()).toBe(mw);
            expect(typeof getActiveBrotliStatic().invalidateAll).toBe('function');
            expect(typeof getActiveBrotliStatic().policyVersion).toBe('string');
        } finally { await closeHttpServer(srv); }
    });
});
