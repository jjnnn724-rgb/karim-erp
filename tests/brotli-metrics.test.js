/**
 * brotli-metrics.test.js — عقد قياس وسيط Brotli للأصول الساكنة
 * ────────────────────────────────────────────────────────────────────────
 * لماذا: قبل الإنتاج نحتاج أرقامًا نثق فيها — نسبة إصابة الكاش، زمن الضغط
 * (أمامي/خلفي)، حجم الكاش، ومدة التسخين. هذا الملف يثبّت:
 *   1) العدّادات تزيد من المسار الحقيقي (وسيط brotli-static على HTTP حقيقي)
 *   2) أسباب التجاوز محصورة في قائمة بيضاء (لا انفجار بطاقة أبعاد)
 *   3) شكل snapshot/prometheus ثابت، والمعطّل يُعيد null/نصًا فارغًا
 *   4) القياس اختياري تمامًا — بغياب الكائن لا يتغير أي سلوك
 *   5) /metrics ما زال محميًا بـ JWT + admin/auditor (عقد مصدري)
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createBrotliMetrics, brotliSnapshot, brotliPrometheus, setActiveMetrics,
    COMPRESSION_BUCKETS, BYPASS_WHITELIST,
} = require('../backend/middleware/brotli-metrics');
const { closeHttpServer } = require('./helpers/http-server');
const { createBrotliStatic } = require('../backend/middleware/brotli-static');

const BODY = Buffer.from('/* v2 module */\n' + 'export const x = 1;\n'.repeat(120), 'utf8'); // > 1KB
const BIG = Buffer.from('/* big */\n' + 'export const y = 2;\n'.repeat(4000), 'utf8');        // > 32KB

function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brm-root-'));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'brm-cache-'));
    fs.writeFileSync(path.join(root, 'mod.js'), BODY);
    fs.writeFileSync(path.join(root, 'big.js'), BIG);
    fs.writeFileSync(path.join(root, 'tiny.js'), '// tiny\n');
    fs.writeFileSync(path.join(root, 'pixel.png'), Buffer.alloc(4096, 7));
    fs.writeFileSync(path.join(root, '.secret.js'), BODY);
    return { root, cache };
}

function serve(fixture, metrics) {
    const middleware = createBrotliStatic({
        rootDir: fixture.root,
        cacheDir: fixture.cache,
        metrics,
    });
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

    return { srv, middleware, get: (p, headers) => request('GET', p, headers) };
}

function cleanup(fixture) {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(fixture.cache, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** انتظار شرط بلا تعليق — يعيد true إن تحقق قبل المهلة */
async function waitFor(fn, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) { return true; }
        await sleep(50);
    }
    return false;
}

// ─── وحدة القياس ─────────────────────────────────────────────────────────────
describe('brotli-metrics — العدّادات واللقطة', () => {
    test('المعطّل يُعيد null ونصًا فارغًا ولا يسجّل شيئًا', () => {
        const m = createBrotliMetrics({ enabled: false });
        m.hit(); m.compressed(5, 'foreground'); m.bypass('method'); m.error('foreground');
        expect(m.snapshot()).toBeNull();
        expect(m.prometheus()).toBe('');
    });

    test('نسبة الإصابة = hit / (hit + compressed + deferred)', () => {
        const m = createBrotliMetrics({});
        m.hit(); m.hit(); m.hit();
        m.compressed(12, 'foreground');
        m.bypass('method');
        const s = m.snapshot();
        expect(s.requests.hit).toBe(3);
        expect(s.requests.compressed).toBe(1);
        expect(s.requests.bypass).toBe(1);
        // total يشمل التجاوز، والنسبة تُحسب على المؤهّل فقط
        expect(s.requests.eligible).toBe(4);
        expect(s.requests.total).toBe(5);
        expect(s.requests.hitRatio).toBe(0.75);
    });

    test('أسباب التجاوز محدودة بقائمة بيضاء — أي سبب غريب يصير other', () => {
        const m = createBrotliMetrics({});
        for (const reason of BYPASS_WHITELIST) { m.bypass(reason); }
        m.bypass('something-unexpected');
        const s = m.snapshot();
        for (const reason of BYPASS_WHITELIST) { expect(s.bypassReasons[reason]).toBe(1); }
        expect(s.bypassReasons.other).toBe(1);
        expect(Object.keys(s.bypassReasons).length).toBe(BYPASS_WHITELIST.size + 1);
    });

    test('زمن الضغط يُفصل أماميًا/خلفيًا مع ملخص مئينات', () => {
        const m = createBrotliMetrics({});
        m.compressed(3, 'foreground');
        m.compressed(30, 'foreground');
        m.compressed(700, 'background');
        const s = m.snapshot();
        expect(s.compression.foreground.count).toBe(2);
        expect(s.compression.foreground.sumMs).toBe(33);
        expect(s.compression.foreground.maxMs).toBe(30);
        expect(s.compression.background.count).toBe(1);
        expect(s.compression.background.maxMs).toBe(700);
        expect(s.requests.deferred).toBe(1);
        expect(s.requests.compressed).toBe(2);
    });

    test('الفشل يُعدّ في طوره', () => {
        const m = createBrotliMetrics({});
        m.error('foreground');
        m.error('background');
        m.error('foreground');
        expect(m.snapshot().errors).toEqual({ foreground: 2, background: 1 });
    });

    test('دورة حياة التسخين: تشغيل → عدّ → انتهاء بالمدة', () => {
        const m = createBrotliMetrics({});
        expect(m.snapshot().warmup.running).toBe(false);
        m.warmupStart(42);
        m.warmupCounted();
        m.warmupCounted();
        const mid = m.snapshot().warmup;
        expect(mid.running).toBe(true);
        expect(mid.files).toBe(42);
        expect(mid.compressed).toBe(2);
        m.warmupEnd(2913.7);
        const done = m.snapshot().warmup;
        expect(done.running).toBe(false);
        expect(done.lastMs).toBe(2914);
        expect(typeof done.lastEndedAt).toBe('string');
    });

    test('حجم الكاش يُقاس عند السحب فقط، وبـ TTL لا مع كل لقطة', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brm-scan-'));
        fs.writeFileSync(path.join(dir, 'a.br.js'), Buffer.alloc(1000, 1));
        fs.writeFileSync(path.join(dir, 'b.br.css'), Buffer.alloc(500, 2));
        const m = createBrotliMetrics({ cacheDir: dir, maxBytes: 100 * 1024 * 1024 });
        const s = m.snapshot();
        expect(s.cache.files).toBe(2);
        expect(s.cache.bytes).toBe(1500);
        expect(s.cache.maxBytes).toBe(100 * 1024 * 1024);
        expect(typeof s.cache.scannedAt).toBe('string');
        // لقطة ثانية داخل نافذة TTL: لا مسح جديد للقرص (نفس وقت المسح)
        expect(m.snapshot().cache.scannedAt).toBe(s.cache.scannedAt);
        expect(m.snapshot().cache.bytes).toBe(1500);

        // مجلد غائب يُصفّر العدّاد ولا يرمي
        const empty = createBrotliMetrics({ cacheDir: path.join(dir, 'does-not-exist') });
        expect(empty.snapshot().cache).toEqual({ files: 0, bytes: 0, maxBytes: null, usageRatio: null, scannedAt: expect.any(String) });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('لقطة Prometheus تحمل كل المقاييس المعلنة بقيم صحيحة', () => {
        const m = createBrotliMetrics({ cacheDir: os.tmpdir() });
        m.hit();
        m.compressed(40, 'foreground');
        m.bypass('not_found');
        m.warmupStart(3);
        const text = m.prometheus();
        expect(text).toContain('static_brotli_requests_total{result="hit"} 1');
        expect(text).toContain('static_brotli_requests_total{result="compressed"} 1');
        expect(text).toContain('static_brotli_requests_total{result="bypass"} 1');
        expect(text).toContain('static_brotli_bypass_total{reason="not_found"} 1');
        expect(text).toContain('static_brotli_cache_hit_ratio 0.5');
        expect(text).toContain('static_brotli_compression_ms_count{phase="foreground"} 1');
        expect(text).toContain('static_brotli_compression_ms_sum{phase="foreground"} 40');
        expect(text).toContain('static_brotli_warmup_running 1');
        expect(text).toContain('static_brotli_warmup_files 3');
        // حدود الهيستوجرام تُعلن بالتسلسل التراكمي، و +Inf = العدد الكلي
        const last = COMPRESSION_BUCKETS[COMPRESSION_BUCKETS.length - 1];
        expect(text).toContain(`static_brotli_compression_ms_bucket{phase="foreground",le="${last}"} 1`);
        expect(text).toContain('static_brotli_compression_ms_bucket{phase="foreground",le="+Inf"} 1');
    });

    test('النسخة النشطة تُسجَّل تلقائيًا للسحب الخارجي', () => {
        setActiveMetrics(null);
        expect(brotliSnapshot()).toBeNull();
        expect(brotliPrometheus()).toBe('');
        const m = createBrotliMetrics({});
        m.hit();
        expect(brotliSnapshot().requests.hit).toBe(1);
        expect(brotliPrometheus()).toContain('static_brotli_requests_total{result="hit"} 1');
        setActiveMetrics(null);
    });
});

// ─── تكامل مع الوسيط على HTTP حقيقي ─────────────────────────────────────────
describe('brotli-metrics — مربوطة بوسيط brotli-static', () => {
    let fx, s, m;
    beforeEach(() => {
        m = createBrotliMetrics({});
        fx = makeFixture();
        s = serve(fx, m);
    });
    afterEach(async () => { await closeHttpServer(s.srv); cleanup(fx); setActiveMetrics(null); });

    test('أول طلب يُضغط أماميًا، والثاني إصابة كاش', async () => {
        const first = await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        expect(first.headers['content-encoding']).toBe('br');
        let snap = m.snapshot();
        expect(snap.requests.compressed).toBe(1);
        expect(snap.requests.hit).toBe(0);
        expect(snap.compression.foreground.count).toBe(1);
        expect(snap.compression.foreground.maxMs).toBeGreaterThan(0);

        await s.get('/app/mod.js', { 'Accept-Encoding': 'br' });
        snap = m.snapshot();
        expect(snap.requests.hit).toBe(1);
        expect(snap.requests.hitRatio).toBe(0.5);
        // الضغط حدث مرة واحدة فقط — لا إعادة ضغط عند الإصابة
        expect(snap.requests.compressed).toBe(1);
    });

    test('الملف الكبير يُؤجَّل للخلفية ولا يُجمّد الطلب', async () => {
        const r = await s.get('/app/big.js', { 'Accept-Encoding': 'br' });
        // الطلب الحالي مرّ بلا ضغط (لا Content-Encoding) لأنه فوق عتبة الانتظار
        expect(r.headers['content-encoding']).toBeUndefined();
        expect(await waitFor(() => m.snapshot().requests.deferred === 1)).toBe(true);
        expect(m.snapshot().compression.background.count).toBe(1);
        expect(m.snapshot().compression.foreground.count).toBe(0);
        // وبعد اكتمال الضغط خلفيًا: الطلب التالي يُخدم مضغوطًا من الكاش
        const again = await s.get('/app/big.js', { 'Accept-Encoding': 'br' });
        expect(again.headers['content-encoding']).toBe('br');
        expect(m.snapshot().requests.hit).toBe(1);
    });

    test('كل تجاوز يُسجَّل بسببه الصحيح من القائمة البيضاء', async () => {
        await s.get('/app/pixel.png', { 'Accept-Encoding': 'br' });   // not_compressible
        await s.get('/app/tiny.js', { 'Accept-Encoding': 'br' });     // too_small
        await s.get('/app/nope.js', { 'Accept-Encoding': 'br' });     // not_found
        await s.get('/app/.secret.js', { 'Accept-Encoding': 'br' });  // unsafe_path
        await s.get('/app/mod.js');                                   // no_accept_br
        await s.get('/app/../mod.js', { 'Accept-Encoding': 'br' });   // unsafe_path

        const reasons = m.snapshot().bypassReasons;
        expect(reasons.not_compressible).toBe(1);
        expect(reasons.too_small).toBe(1);
        expect(reasons.not_found).toBe(1);
        expect(reasons.no_accept_br).toBe(1);
        expect(reasons.unsafe_path).toBe(2);
        // لا مسار ضغط ولا إصابة في كل ما سبق
        expect(m.snapshot().requests.eligible).toBe(0);
    });

    test('POST يُسجَّل كتجاوز method', async () => {
        await new Promise((resolve) => {
            const r = http.request({ hostname: '127.0.0.1', port: s.srv.address().port, path: '/app/mod.js', method: 'POST', headers: { 'Accept-Encoding': 'br' } }, (res) => {
                res.resume(); res.on('end', resolve);
            });
            r.end();
        });
        expect(m.snapshot().bypassReasons.method).toBe(1);
    });

    test('التسخين الخلفي يُعلن بدايته وعدده وينتهي بمدة', async () => {
        s.middleware.warmup();
        expect(await waitFor(() => m.snapshot().warmup.lastMs !== null, 15000)).toBe(true);
        const w = m.snapshot().warmup;
        expect(w.running).toBe(false);
        expect(w.files).toBe(3);        // mod.js + big.js + tiny.js (tiny يُتخطى بالحجم)
        expect(w.compressed).toBe(2);   // mod.js + big.js
        expect(w.lastMs).toBeGreaterThan(0);
    }, 20000);

    test('بغياب كائن القياس لا يتغير السلوك (الوسيط يعمل كأن شيئًا لم يُضف)', async () => {
        const bare = serve(fx, null);
        try {
            const r = await bare.get('/app/mod.js', { 'Accept-Encoding': 'br' });
            expect(r.status).toBe(200);
            expect(r.headers['content-encoding']).toBe('br');
            expect(m.snapshot().requests.eligible).toBe(0); // القياس المُحقون لم يُلمس
        } finally {
            await closeHttpServer(bare.srv);
        }
    });
});

// ─── عقد الحماية والدمج ──────────────────────────────────────────────────────
describe('brotli-metrics — الدمج في لوحتي المراقبة', () => {
    test('لقطة /api/metrics تحمل مفتاح brotli (بلا كسر الحقول القديمة)', () => {
        const core = require('../backend/metrics');
        const snap = core.snapshot(null);
        expect(snap).toHaveProperty('brotli');
        expect(snap).toHaveProperty('requests');
        expect(snap).toHaveProperty('memory');
        expect(snap).toHaveProperty('eventLoopLagUs');
        expect(snap.dbPool).toBeNull();
    });

    test('نص /metrics يحمل مقاييس brotli عند تفعيل الوسيط، والقديمة سليمة', () => {
        const m = createBrotliMetrics({});
        m.hit();
        const { prometheusFormat } = require('../backend/cashier-module/metrics');
        const text = prometheusFormat();
        expect(text).toContain('static_brotli_requests_total{result="hit"} 1');
        expect(text).toContain('pos_complete_sale_total');
    });

    test('/metrics يشترط JWT + دور admin/auditor (أو مفتاح سحب)', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'cashier-module', 'metrics.js'), 'utf8');
        expect(src).toMatch(/app\.get\('\/metrics'/);
        expect(src).toMatch(/jwtAuth\(req, res/);
        expect(src).toMatch(/requireRole\('admin', 'auditor'\)/);
        expect(src).toMatch(/METRICS_API_KEY/);
    });
});
