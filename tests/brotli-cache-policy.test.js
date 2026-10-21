/**
 * brotli-cache-policy.test.js — عقد سياسة تنظيف كاش Brotli
 * ────────────────────────────────────────────────────────────────────────
 * لماذا: مفتاح نسخة الكاش يحمل mtime الأصلي، فأي إعادة بناء تترك نسخة قديمة
 * → نمو بلا حد عبر النشر المتكرر. هذا الملف يثبّت:
 *   1) الطبقات الثلاث بترتيبها: أجزاء ناقصة (*.tmp) ← العمر ← الحجم
 *   2) stats(): قراءة فقط، تصف الحالة بلا حذف
 *   3) clear(): مسح كامل بسبب manual
 *   4) resolveCacheLimits(): رقم فاسد في البيئة لا يعطّل الحماية (يقع على الافتراضي)
 *   5) عدّادات الإخلاء تصل إلى لقطة القياس و Prometheus
 *   6) POLICY_VERSION جزء فعلي من مفتاح الكاش (تغيّره يُبطل النسخ)
 *   7) كل شيء محاط بحرس: لا يرمي على مجلد غائب أو ملفات تختفي
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const {
    createCachePolicy, resolveCacheLimits, EVICT_REASONS,
    DEFAULT_MAX_MB, DEFAULT_MAX_AGE_DAYS,
} = require('../backend/middleware/brotli-cache-policy');
const { closeHttpServer } = require('./helpers/http-server');
const { createBrotliMetrics } = require('../backend/middleware/brotli-metrics');
const { POLICY_VERSION, defaultCacheDir, createBrotliStatic } = require('../backend/middleware/brotli-static');

const DAY = 24 * 60 * 60 * 1000;

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }

/** ملف بحجم معروف و mtime مضبوط (بالأيام نسبةً للآن) */
function writeFile(dir, name, bytes, ageDays) {
    const full = path.join(dir, name);
    fs.writeFileSync(full, Buffer.alloc(bytes, 3));
    if (typeof ageDays === 'number') {
        const t = (Date.now() - ageDays * DAY) / 1000;
        fs.utimesSync(full, t, t);
    }
    return full;
}

const list = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (_) { return []; } };

/** طلب GET حقيقي — ينتظر اكتمال الجسم */
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

// ─── resolveCacheLimits: تحقّق صارم ──────────────────────────────────────────
describe('brotli-cache-policy — resolveCacheLimits', () => {
    test('الافتراضيات: 100MB · 7 أيام · 6 ساعات', () => {
        const l = resolveCacheLimits({});
        expect(l.maxBytes).toBe(DEFAULT_MAX_MB * 1024 * 1024);
        expect(l.maxAgeDays).toBe(DEFAULT_MAX_AGE_DAYS);
        expect(l.sweepMs).toBe(6 * 60 * 60 * 1000);
    });

    test('قيم صحيحة تُقرأ كما هي', () => {
        const l = resolveCacheLimits({ BROTLI_CACHE_MAX_MB: '250', BROTLI_CACHE_MAX_AGE_DAYS: '3', BROTLI_CACHE_SWEEP_MS: '3600000' });
        expect(l.maxBytes).toBe(250 * 1024 * 1024);
        expect(l.maxAgeDays).toBe(3);
        expect(l.sweepMs).toBe(3600000);
    });

    test('قيمة فاسدة/سلبية/صفر لا تعطّل الحماية — تقع على الافتراضي', () => {
        const bad = resolveCacheLimits({ BROTLI_CACHE_MAX_MB: 'abc', BROTLI_CACHE_MAX_AGE_DAYS: '-5', BROTLI_CACHE_SWEEP_MS: '0' });
        expect(bad.maxBytes).toBe(DEFAULT_MAX_MB * 1024 * 1024);
        expect(bad.maxAgeDays).toBe(DEFAULT_MAX_AGE_DAYS);
        expect(bad.sweepMs).toBe(6 * 60 * 60 * 1000);
    });
});

// ─── الطبقات الثلاث ──────────────────────────────────────────────────────────
describe('brotli-cache-policy — الطبقات الثلاث بترتيبها', () => {
    let dir, policy;
    beforeEach(() => {
        dir = tmpDir('brp-');
        policy = createCachePolicy({ cacheDir: dir, maxBytes: 100 * 1024 * 1024, maxAgeDays: 7 });
    });
    afterEach(() => { policy.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

    test('الطبقة 1: أجزاء *.tmp تُمسح دائمًا (بقايا انهيار)', () => {
        writeFile(dir, 'keep.br.js', 600, 0);
        writeFile(dir, 'half.AAAA.tmp', 300, 0);
        writeFile(dir, 'half.BBBB.tmp', 200, 0);
        const r = policy.enforce();
        expect(r.byReason.tmp).toEqual({ files: 2, bytes: 500 });
        expect(list(dir)).toEqual(['keep.br.js']);
    });

    test('الطبقة 2: النسخ الأقدم من maxAgeDays تُحذف', () => {
        writeFile(dir, 'fresh.br.js', 600, 1);
        writeFile(dir, 'old.br.js', 500, 9);      // أقدم من 7 أيام
        const r = policy.enforce();
        expect(r.byReason.age).toEqual({ files: 1, bytes: 500 });
        expect(list(dir)).toEqual(['fresh.br.js']);
    });

    test('الطبقة 3: تجاوز الحجم يحذف الأقدم mtime حتى النزول تحت الحد', () => {
        const small = createCachePolicy({ cacheDir: dir, maxBytes: 1000, maxAgeDays: 7 });
        writeFile(dir, 'newest.br.js', 400, 1);
        writeFile(dir, 'middle.br.js', 400, 2);
        writeFile(dir, 'oldest.br.js', 400, 3);   // 1200 > 1000 → الأقدم يُحذف
        const r = small.enforce();
        expect(r.byReason.size).toEqual({ files: 1, bytes: 400 });
        expect(r.kept.bytes).toBe(800);
        expect(list(dir)).toEqual(['middle.br.js', 'newest.br.js']);
    });

    test('الطبقات مرتبة: tmp أولًا ثم العمر، والحجم على الباقي فقط', () => {
        const small = createCachePolicy({ cacheDir: dir, maxBytes: 1000, maxAgeDays: 7 });
        writeFile(dir, 'scrap.tmp', 5000, 0);       // tmp → تُحذف ولا تُحتسب في الحجم
        writeFile(dir, 'expired.br.js', 5000, 30);  // عمر → تُحذف
        writeFile(dir, 'a.br.js', 400, 1);
        writeFile(dir, 'b.br.js', 400, 2);
        const r = small.enforce();
        expect(r.byReason.tmp.files).toBe(1);
        expect(r.byReason.age.files).toBe(1);
        expect(r.byReason.size).toBeUndefined();    // الباقي 800 ≤ 1000 فلا حذف بالحجم
        expect(list(dir)).toEqual(['a.br.js', 'b.br.js']);
    });

    test('لا يرمي أبدًا على مجلد غائب، والنتيجة صفر', () => {
        const missing = createCachePolicy({ cacheDir: path.join(dir, 'nope'), maxBytes: 1024, maxAgeDays: 7 });
        const r = missing.enforce();
        expect(r.scanned).toBe(0);
        expect(r.removedFiles).toBe(0);
        expect(r.kept).toEqual({ files: 0, bytes: 0 });
    });
});

// ─── stats / clear ───────────────────────────────────────────────────────────
describe('brotli-cache-policy — stats و clear', () => {
    let dir, policy;
    beforeEach(() => {
        dir = tmpDir('brp2-');
        policy = createCachePolicy({ cacheDir: dir, maxBytes: 10 * 1024 * 1024, maxAgeDays: 7 });
    });
    afterEach(() => { policy.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

    test('stats قراءة فقط: تصف الحجم والعمر والأجزاء الناقصة بلا حذف', () => {
        writeFile(dir, 'a.br.js', 1000, 0);
        writeFile(dir, 'old.br.js', 500, 9);
        writeFile(dir, 'half.tmp', 250, 0);
        const s = policy.stats();
        expect(s.files).toBe(3);
        expect(s.bytes).toBe(1750);
        expect(s.maxBytes).toBe(10 * 1024 * 1024);
        expect(s.tmp).toEqual({ files: 1, bytes: 250 });
        expect(s.expired).toEqual({ files: 1, bytes: 500 });
        expect(typeof s.oldestAt).toBe('string');
        expect(s.usageRatio).toBeGreaterThan(0);
        expect(list(dir).length).toBe(3);   // لم يُحذف شيء
    });

    test('clear يمسح كل شيء بسبب manual', () => {
        writeFile(dir, 'a.br.js', 1000, 0);
        writeFile(dir, 'b.br.css', 800, 0);
        writeFile(dir, 'half.tmp', 100, 0);
        const r = policy.clear();
        expect(r.byReason.manual).toEqual({ files: 3, bytes: 1900 });
        expect(list(dir)).toEqual([]);
    });

    test('start/stop لا يُبقيان العملية حيّة (مؤقّت unref) ولا يرميان', () => {
        expect(() => { policy.start(); policy.start(); policy.stop(); policy.stop(); }).not.toThrow();
    });
});

// ─── عدّادات الإخلاء تصل للقياس ──────────────────────────────────────────────
describe('brotli-cache-policy — عدّادات الإخلاء في القياس', () => {
    test('كل سبب إخلاء يُحتسب في اللقطة و Prometheus', () => {
        const dir = tmpDir('brp3-');
        const m = createBrotliMetrics({ cacheDir: dir, maxBytes: 1000 });
        const policy = createCachePolicy({ cacheDir: dir, metrics: m, maxBytes: 1000, maxAgeDays: 7 });
        try {
            writeFile(dir, 'x.tmp', 100, 0);
            writeFile(dir, 'old.br.js', 500, 40);
            writeFile(dir, 'a.br.js', 400, 1);
            writeFile(dir, 'b.br.js', 400, 2);   // الباقي 800 ≤ 1000
            policy.enforce();
            const s = m.snapshot();
            expect(s.evictions.byReason.tmp).toEqual({ files: 1, bytes: 100 });
            expect(s.evictions.byReason.age).toEqual({ files: 1, bytes: 500 });
            expect(s.evictions.files).toBe(2);
            expect(s.evictions.bytes).toBe(600);
            const text = m.prometheus();
            expect(text).toContain('static_brotli_cache_evicted_files_total{reason="tmp"} 1');
            expect(text).toContain('static_brotli_cache_evicted_bytes_total{reason="age"} 500');
        } finally {
            policy.stop();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('سبب غريب يصير other ولا ينفجر بطاقة الأبعاد', () => {
        const m = createBrotliMetrics({});
        m.evicted('something-weird', 3, 300);
        m.evicted('tmp', 1, 10);
        const s = m.snapshot();
        expect(s.evictions.byReason.other).toEqual({ files: 3, bytes: 300 });
        expect(s.evictions.byReason.tmp).toEqual({ files: 1, bytes: 10 });
    });

    test('EVICT_REASONS ثابت معروف', () => {
        expect([...EVICT_REASONS].sort()).toEqual(['age', 'manual', 'size', 'tmp']);
    });
});

// ─── POLICY_VERSION + مجلد الكاش الافتراضي ───────────────────────────────────
describe('brotli-static — إصدار السياسة ومجلد الكاش', () => {
    test('POLICY_VERSION يقرأ من البيئة والافتراضي v1', () => {
        expect(POLICY_VERSION).toBe(String(process.env.BROTLI_POLICY_VERSION || 'v1'));
    });

    test('اسم نسخة الكاش مشتق من مفتاح يحمل POLICY_VERSION', async () => {
        const root = tmpDir('brv-root-');
        const cache = tmpDir('brv-cache-');
        const body = Buffer.from('/* v2 */\n' + 'export const x = 1;\n'.repeat(120), 'utf8');
        const full = path.join(root, 'mod.js');
        fs.writeFileSync(full, body);
        const mw = createBrotliStatic({ rootDir: root, cacheDir: cache });
        const app = express();
        app.use('/app', mw);
        app.use('/app', (req, res) => res.status(599).send('FALLTHROUGH'));
        const srv = app.listen(0);
        try {
            const st = fs.statSync(full);
            const quality = st.size < 512 * 1024 ? 11 : 6;
            const expected = crypto.createHash('sha1')
                .update(`${POLICY_VERSION}|${full}|${st.size}|${st.mtimeMs}|${quality}`)
                .digest('hex') + '.js';
            await get(srv.address().port, '/app/mod.js', { 'Accept-Encoding': 'br' });
            expect(fs.existsSync(path.join(cache, expected))).toBe(true);
        } finally {
            await closeHttpServer(srv);
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    test('defaultCacheDir: BROTLI_CACHE_DIR يتقدّم، و production → ./var/brotli-cache', () => {
        const savedDir = process.env.BROTLI_CACHE_DIR;
        const savedEnv = process.env.NODE_ENV;
        try {
            process.env.BROTLI_CACHE_DIR = path.join(os.tmpdir(), 'br-override');
            expect(defaultCacheDir()).toBe(path.join(os.tmpdir(), 'br-override'));

            delete process.env.BROTLI_CACHE_DIR;
            process.env.NODE_ENV = 'production';
            expect(defaultCacheDir()).toBe(path.join(process.cwd(), 'var', 'brotli-cache'));

            process.env.NODE_ENV = 'development';
            expect(defaultCacheDir().startsWith(os.tmpdir())).toBe(true);
        } finally {
            if (savedDir === undefined) { delete process.env.BROTLI_CACHE_DIR; } else { process.env.BROTLI_CACHE_DIR = savedDir; }
            if (savedEnv === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = savedEnv; }
        }
    });
});
