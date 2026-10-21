'use strict';
/**
 * brotli-static.js — تقديم الأصول الساكنة مضغوطة بـ Brotli من أصل الخادم
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا هنا وليس في Nginx؟
 *   نشر aaPanel يجعل Nginx مجرد reverse proxy (`location / → 127.0.0.1:5000`)
 *   فهو لا يقرأ الملفات من القرص، لذلك لا قيمة لـ gzip_static/brotli_static
 *   فيه. الضغط إذن مسؤولية Node — وهذا الملف يفعلها.
 *
 * المكسب المقاس على `frontend/app` (192 ملفًا نصيًا ≥1KB · 7.526 MB خام):
 *   gzip -9 → 2.075 MB · brotli q11 للكل → 1.652 MB · بسياسة q11/q6 الحالية → 1.717 MB
 *   وعلى رسم V2 وحده: 0.520 MB → 0.435 MB (**−16.3%**).
 *
 * عتبة الانتظار (`AWAIT_BYTES` = 32KB) — لماذا 32 ولا 64؟ قياسٌ مُعاد على
 * الشجرة نفسها بالأداة `scripts/br-measure.js` (199 ملفًا · 7.64 MB خام →
 * 1.746 MB مضغوطًا · وفّر 77.1%):
 *
 *   العتبة  ملفات تنتظر  حجمها    زمن أول طلب إجمالًا  متوسط  أقصى
 *   32KB    143          1.61 MB  2567 ms             18 ms   45 ms
 *   48KB    165          2.47 MB  3848 ms             23 ms   67 ms
 *   64KB    175          3.00 MB  4680 ms             27 ms   92 ms
 *   128KB   192          4.40 MB  6866 ms             36 ms  173 ms
 *
 * الاختيار 32KB: أقصى انتظار 45 ms (غير محسوس على أول ضغطة)، ورفعُ العتبة إلى
 * 64KB يضاعف الأقصى إلى 92 ms مقابل 1.4 MB فقط من الكتلة — أما الملفات الثقيلة
 * التي تُكلِّف فعلًا (vendor/html5-qrcode 370KB بضغط 647 ms · chart.umd 201KB
 * بـ360 ms) فتبقى خلفية عند كل العتبات. أي أن 32KB تشتري تغطية بلا زمن يُذكر،
 * ورفعها يشتري زمنًا بلا تغطية.
 *
 * القياس (اختياري): يُحقَن كائن `metrics` (انظر brotli-metrics.js) — بغيابه لا
 * يتغير أي سلوك، وبوجوده تُنشر عدّادات الإصابة وزمن الضغط وحجم الكاش إلى /metrics.
 *
 * كيف يعمل (بلا إعادة كتابة أي منطق HTTP):
 *   نضغط الملف إلى مجلد كاش **بنفس امتداده** ثم نعيد توجيه الطلب داخليًا إلى
 *   نسخة الكاش ونسلّم الأمر إلى `express.static` نفسه. فيبقى ETag و
 *   Last-Modified و 304 و Content-Type (والـcharset) كما هي بالحرف، ويُضاف
 *   Content-Encoding: br و Vary: Accept-Encoding فقط.
 *
 * السلامة (كل خطوة فاشلة تعني next() بلا أي أثر — لا مسار فشل جديد):
 *   • GET/HEAD فقط، وللعملاء الذين يعلنون `br` في Accept-Encoding فقط.
 *   • استثناء مسارات النقطة والخروج عن الجذر (traversal) قبل أي قراءة.
 *   • كتابة النسخة المضغوطة إلى ملف مؤقت ثم rename (ذرّية) — لا يُقدَّم ملف ناقص.
 *   • ضغط q11 للملفات < 512KB (المسار الساخن: js/v2 ووحداته) و q6 للأكبر.
 *   • التسخين خلفي بعد الإقلاع، فلا ينتظر أي مستخدم أول ضغطة.
 *
 * الإبطال (Invalidation) — ثلاث طبقات بلا أي تغيير في سلوك HTTP:
 *   • POLICY_VERSION: تغييره يُغيّر مفاتيح كل النسخ دفعة واحدة (الطبقة العامة).
 *   • fs.watch في التطوير فقط: عند تغيّر ملف يُحذف مقابله القديم فورًا.
 *   • invalidate/invalidateAll: تُنادى من الـendpoint الإداري (admin-only).
 *   الإبطال حذفٌ فقط — أول طلب تالٍ يعيد الضغط ويسلّم brotli كالمعتاد.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');

const COMPRESSIBLE = new Set([
    '.js', '.mjs', '.css', '.html', '.htm', '.json',
    '.svg', '.txt', '.map', '.xml', '.webmanifest',
]);

const MIN_BYTES = 1024;             // أصغر من ذلك: ضغط بلا مكسب
const MAX_BYTES = 4 * 1024 * 1024;  // أكبر من ذلك: بروتلي بلا قيمة تُذكر
const AWAIT_BYTES = 32 * 1024;      // حتى هذا الحجم ننتظر الضغط — مُبرَّر بالقياس أعلى الملف (scripts/br-measure.js)
const QUALITY_BOUNDARY = 512 * 1024;
const QUALITY_SMALL = 11;
const QUALITY_LARGE = 6;

const WARMUP_DELAY_MS = 3000;       // بعد الإقلاع: لا ننافس أول الطلبات
const WARMUP_YIELD_MS = 25;         // فسحة تنفّس بين ملف وآخر

/* إصدار سياسة الضغط — جزء من مفتاح الكاش:
   أي تغيير في q11→q6 أو أي وسيط brotli أو منطق الضغط يستوجب رفعه،
   فتُبطَل كل النسخ القديمة تلقائيًا بلا أي عملية تنظيف يدوية. */
const POLICY_VERSION = String(process.env.BROTLI_POLICY_VERSION || 'v1');

/* نسخة نشطة واحدة: الوسيط يُنشئها، والـendpoint الإداري يبطّل من خلالها
   (نفس فلسفة brotli-metrics: لا يمسك المسار مرجعًا داخليًا للوسيط). */
let active = null;
function getActiveBrotliStatic() { return active; }
function setActiveBrotliStatic(instance) { active = instance || null; }

/**
 * مجلد الكاش:
 *   production → ./var/brotli-cache  (مسار دائم لا يمسحه systemd-tmpfiles)
 *   غير ذلك   → os.tmpdir()          (لأن /tmp قد يكون tmpfs ويُمسح)
 *   BROTLI_CACHE_DIR يتقدّم على الاثنين دائمًا.
 */
function defaultCacheDir() {
    const override = String(process.env.BROTLI_CACHE_DIR || '').trim();
    if (override) { return override; }
    if (process.env.NODE_ENV === 'production') { return path.join(process.cwd(), 'var', 'brotli-cache'); }
    return path.join(os.tmpdir(), 'karim-erp-brotli');
}

function acceptsBrotli(header) {
    let brotliQuality = null;
    let wildcardQuality = null;
    for (const entry of String(header || '').split(',')) {
        const [rawCoding, ...parameters] = entry.trim().split(';');
        const coding = rawCoding.trim().toLowerCase();
        if (coding !== 'br' && coding !== '*') { continue; }

        let quality = 1;
        let qualitySeen = false;
        for (const parameter of parameters) {
            const match = /^\s*q\s*=\s*(.*?)\s*$/i.exec(parameter);
            if (!match || qualitySeen || !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1])) {
                quality = 0;
                break;
            }
            qualitySeen = true;
            quality = Number(match[1]);
        }

        if (coding === 'br') {
            brotliQuality = brotliQuality === null ? quality : Math.min(brotliQuality, quality);
        } else {
            wildcardQuality = wildcardQuality === null ? quality : Math.min(wildcardQuality, quality);
        }
    }
    return (brotliQuality === null ? wildcardQuality : brotliQuality) > 0;
}

/**
 * @param {{rootDir:string, cacheDir?:string, setCacheHeaders?:Function, metrics?:object}} options
 *   rootDir        مجلد الأصول الأصلي (نفس جذر express.static)
 *   cacheDir       مجلد نسخ Brotli
 *   setCacheHeaders دالة ترويسات الكاش القائمة (تُنادى بمسار الملف الأصلي)
 *   metrics        كائن قياس اختياري (brotli-metrics.js) — بغيابه لا سلوك جديد
 * @returns {Function & {warmup: Function}}
 */
function createBrotliStatic(options) {
    const rootDir = path.resolve(options.rootDir);
    const cacheDir = path.resolve(options.cacheDir || defaultCacheDir());
    const setCacheHeaders = typeof options.setCacheHeaders === 'function' ? options.setCacheHeaders : null;
    const metrics = options.metrics || null;

    const inflight = new Map();
    /* الأصل ← اسم نسخته المضغوطة في هذه العملية. ضرورية للإبطال: مفتاح الكاش
       تجزئة (sha1) لا يمكن عكسها إلى مسار الملف، فهذه الخريطة هي الطريق الوحيد
       لحذف نسخة ملفٍ بعينه دون مسح الكاش كله. */
    const artifactsBySource = new Map();
    let watcher = null;

    /* القياس لا يُسقط الخادم أبدًا: كل نداء محاط بحرس (نفس فلسفة metrics.js) */
    const note = (fn) => {
        if (!metrics) { return; }
        try { fn(metrics); } catch (_) { /* القياس لا يكسر الطلب */ }
    };

    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) { /* نتدهور بهدوء إلى gzip */ }

    /* نسخة الكاش تُقدَّم عبر express.static: ETag/304/Content-Type مجانًا.
       fallthrough:true مهم — لو غاب ملف الكاش لحظة الطلب نرجع للملف الأصلي. */
    const mirror = express.static(cacheDir, {
        index: false,
        fallthrough: true,
        dotfiles: 'deny',
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
            const source = res.req && res.req.__brotliSource;
            if (setCacheHeaders && source) { setCacheHeaders(res, source); }
            res.setHeader('Content-Encoding', 'br');
            res.setHeader('Vary', 'Accept-Encoding');
        },
    });

    function artifactFor(absPath, stat) {
        const quality = stat.size < QUALITY_BOUNDARY ? QUALITY_SMALL : QUALITY_LARGE;
        const key = crypto.createHash('sha1')
            .update(`${POLICY_VERSION}|${absPath}|${stat.size}|${stat.mtimeMs}|${quality}`)
            .digest('hex');
        return { name: key + path.extname(absPath).toLowerCase(), quality };
    }

    function compress(absPath, artifact, phase) {
        const target = path.join(cacheDir, artifact.name);
        const pending = inflight.get(target);
        if (pending) { return pending; }

        const startedAt = process.hrtime.bigint();
        const job = new Promise((resolve, reject) => {
            fs.readFile(absPath, (readErr, buf) => {
                if (readErr) { reject(readErr); return; }
                const params = {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: artifact.quality,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
                };
                zlib.brotliCompress(buf, { params }, (zipErr, out) => {
                    if (zipErr) { reject(zipErr); return; }
                    const tmp = `${target}.${process.pid}.tmp`;
                    fs.writeFile(tmp, out, (writeErr) => {
                        if (writeErr) { reject(writeErr); return; }
                        fs.rename(tmp, target, (renameErr) => {
                            if (renameErr) {
                                fs.unlink(tmp, () => {});
                                reject(renameErr);
                                return;
                            }
                            resolve(target);
                        });
                    });
                });
            });
        });

        /* القياس مرة واحدة لكل ضغطة فعلية — طلبات تتشارك inflight لا تُحتسب مرتين */
        const tracked = job.then(
            (done) => {
                artifactsBySource.set(absPath, artifact.name);
                const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
                note((m) => m.compressed(ms, phase));
                return done;
            },
            (err) => { note((m) => m.error(phase)); throw err; }
        ).finally(() => { inflight.delete(target); });
        inflight.set(target, tracked);
        return tracked;
    }

    function middleware(req, res, next) {
        // كل تجاوز يُسجَّل بسبب من قائمة بيضاء — بلا استدعاء القياس لا يتغير السلوك
        const skip = (reason) => { note((m) => m.bypass(reason)); return next(); };

        if (req.method !== 'GET' && req.method !== 'HEAD') { return skip('method'); }
        if (!acceptsBrotli(req.headers['accept-encoding'])) { return skip('no_accept_br'); }

        let relPath;
        try { relPath = decodeURIComponent(String(req.path || '')); } catch (_) { return skip('unsafe_path'); }
        if (!relPath || relPath.indexOf('\0') !== -1) { return skip('unsafe_path'); }
        // مسارات النقطة (ومنها ..) ممنوعة — نفس سلوك express.static الافتراضي
        if (/(^|\/)\./.test(relPath)) { return skip('unsafe_path'); }

        const ext = path.extname(relPath).toLowerCase();
        if (!COMPRESSIBLE.has(ext)) { return skip('not_compressible'); }

        const absPath = path.resolve(rootDir, `.${relPath}`);
        if (absPath !== rootDir && !absPath.startsWith(rootDir + path.sep)) { return skip('unsafe_path'); }

        let stat;
        try { stat = fs.statSync(absPath); } catch (_) { return skip('not_found'); }
        if (!stat.isFile()) { return skip('not_a_file'); }
        if (stat.size < MIN_BYTES) { return skip('too_small'); }
        if (stat.size > MAX_BYTES) { return skip('too_large'); }

        const artifact = artifactFor(absPath, stat);
        const contentPath = path.join(cacheDir, artifact.name);

        function deliver() {
            const savedUrl = req.url;
            req.__brotliSource = absPath;
            req.url = `/${artifact.name}`;   // مجلد الكاش مسطّح
            mirror(req, res, (err) => {
                req.url = savedUrl;          // استرجاع قبل التسليم للمسار الأصلي
                if (err) { return next(err); }
                next();
            });
        }

        let ready = false;
        try { ready = fs.statSync(contentPath).isFile(); } catch (_) { /* يبقى false */ }

        if (ready) {
            artifactsBySource.set(absPath, artifact.name);
            note((m) => m.hit());
            return deliver();
        }

        // الحجم يحدّد الطور: صغير → الطلب ينتظر (أمامي)، كبير → نؤجّله خلفيًا
        const phase = stat.size > AWAIT_BYTES ? 'background' : 'foreground';
        const job = compress(absPath, artifact, phase);
        if (phase === 'background') {
            // ملف كبير: لا نُجمّد الطلب من أجله — هذه المرة بلا ضغط، والقادمات brotli
            job.catch(() => {});
            return next();
        }
        return job.then(deliver, () => next());
    }

    /** تسخين خلفي: يضغط الشجرة كلها بترتيب، بين ملف وآخر فسحة، دون حجب أي طلب */
    middleware.warmup = function warmup() {
        const timer = setTimeout(() => {
            const queue = [];
            (function walk(dir) {
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
                for (const entry of entries) {
                    if (entry.name.startsWith('.')) { continue; }
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) { walk(full); continue; }
                    if (!COMPRESSIBLE.has(path.extname(entry.name).toLowerCase())) { continue; }
                    queue.push(full);
                }
            })(rootDir);

            let index = 0;
            note((m) => m.warmupStart(queue.length));
            const startedAt = Date.now();
            (function step() {
                if (index >= queue.length) {
                    note((m) => m.warmupEnd(Date.now() - startedAt));
                    return;
                }
                const file = queue[index++];
                let stat;
                try { stat = fs.statSync(file); } catch (_) { return setTimeout(step, WARMUP_YIELD_MS); }
                if (!stat.isFile() || stat.size < MIN_BYTES || stat.size > MAX_BYTES) {
                    return setTimeout(step, WARMUP_YIELD_MS);
                }
                const artifact = artifactFor(file, stat);
                const target = path.join(cacheDir, artifact.name);
                let exists = false;
                try { exists = fs.statSync(target).isFile(); } catch (_) { /* يبقى false */ }
                if (exists) {
                    artifactsBySource.set(file, artifact.name);
                    return setTimeout(step, 0);
                }
                compress(file, artifact, 'background')
                    .then(() => { note((m) => m.warmupCounted()); })
                    .catch(() => {})
                    .then(() => setTimeout(step, WARMUP_YIELD_MS));
            })();
        }, WARMUP_DELAY_MS);
        if (timer && typeof timer.unref === 'function') { timer.unref(); }
    };

    /**
     * يحذف نسخة أصل واحد (إن كانت في هذه العملية). لا يرمي أبدًا.
     * @param {string} sourcePath مسار الملف الأصلي (داخل rootDir)
     * @returns {{scope:string, source:string|null, removed:number, bytes:number}}
     */
    middleware.invalidate = function invalidate(sourcePath) {
        const out = { scope: 'file', source: null, removed: 0, bytes: 0 };
        let abs;
        try { abs = path.resolve(String(sourcePath || '')); } catch (_) { return out; }
        if (!abs || (abs !== rootDir && !abs.startsWith(rootDir + path.sep))) { return out; }
        out.source = abs;

        const names = new Set();
        const knownName = artifactsBySource.get(abs);
        if (knownName) { names.add(knownName); }
        try {
            const stat = fs.statSync(abs);
            if (stat.isFile() && stat.size >= MIN_BYTES && stat.size <= MAX_BYTES
                && COMPRESSIBLE.has(path.extname(abs).toLowerCase())) {
                names.add(artifactFor(abs, stat).name);
            }
        } catch (_) { /* الأصل لم يعد موجودًا؛ يبقى الإبطال من الخريطة فقط */ }

        for (const name of names) {
            const target = path.join(cacheDir, name);
            try {
                const stat = fs.statSync(target);
                if (!stat.isFile()) { continue; }
                fs.unlinkSync(target);
                out.removed++;
                out.bytes += stat.size;
            } catch (_) { /* الملف حُذف سابقًا أو تعذر الوصول إليه */ }
        }
        artifactsBySource.delete(abs);
        return out;
    };

    /**
     * يحذف كل نسخ الكاش (مجلد مسطّح). لا يمسّ الأصول الأصلية إطلاقًا.
     * @returns {{scope:string, removed:number, bytes:number}}
     */
    middleware.invalidateAll = function invalidateAll() {
        const out = { scope: 'all', removed: 0, bytes: 0 };
        let entries;
        try { entries = fs.readdirSync(cacheDir, { withFileTypes: true }); } catch (_) { return out; }
        for (const entry of entries) {
            if (!entry.isFile()) { continue; }
            const full = path.join(cacheDir, entry.name);
            let size = 0;
            try { size = fs.statSync(full).size; } catch (_) { /* اختفى بين السطور */ }
            try { fs.unlinkSync(full); out.removed++; out.bytes += size; } catch (_) { /* يُتجاهل */ }
        }
        artifactsBySource.clear();
        return out;
    };

    /**
     * مراقبة الشجرة في التطوير فقط: كل ملف يتغيّر تُحذف نسخته القديمة فورًا.
     * في الإنتاج لا يُنشأ مراقب إطلاقًا (الإبطال هناك عبر POLICY_VERSION أو الـendpoint).
     *
     * ⚠️ Windows: تمرير مسار يحوي اسمًا قصيرًا بصيغة 8.3 (مثل ADMINI~1) إلى
     * fs.watch يُفعّل تأكيدًا داخليًا في libuv (src/win/fs-event.c) يُسقط العملية
     * فورًا — وهو انهيار لا يمكن التقاطه بـtry/catch. لذلك نوسّع المسار إلى
     * الصيغة الطويلة بـrealpathSync.native، وإن بقيت أسماء 8.3 نرفض المراقبة.
     * @param {{enabled?:boolean}} [options]
     * @returns {boolean} هل المراقب نشط؟
     */
    middleware.watch = function watchTree(options) {
        const opts = options || {};
        /* للتطوير فقط بالمعنى الحرفي: يُستثنى production وtest (بيئة Jest)
           حتى لا يُنشأ مراقب عرضًا داخل الاختبارات أو الإنتاج. */
        const env = String(process.env.NODE_ENV || '').toLowerCase();
        const enabled = typeof opts.enabled === 'boolean' ? opts.enabled : (env !== 'production' && env !== 'test');
        if (!enabled || watcher) { return Boolean(watcher); }

        let watchRoot = rootDir;
        if (process.platform === 'win32') {
            try { watchRoot = fs.realpathSync.native(rootDir); } catch (_) { return false; }
            if (/~\d/.test(watchRoot)) { return false; }
        }

        try {
            watcher = fs.watch(watchRoot, { recursive: true }, (eventType, filename) => {
                if (!filename) { return; }
                const rel = String(filename);
                if (/(^|[\\/])\./.test(rel)) { return; }                        // مسارات النقطة (ومنها ..)
                if (!COMPRESSIBLE.has(path.extname(rel).toLowerCase())) { return; }
                const abs = path.resolve(rootDir, rel);
                if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) { return; }
                middleware.invalidate(abs);
            });
            if (typeof watcher.unref === 'function') { watcher.unref(); }       // لا يمنع إغلاق العملية
            watcher.on('error', () => { /* فشل المراقبة لا يُسقط الخادم */ });
        } catch (_) { watcher = null; }
        return Boolean(watcher);
    };

    middleware.stopWatch = function stopWatch() {
        if (!watcher) { return false; }
        try { watcher.close(); } catch (_) { /* يُتجاهل */ }
        watcher = null;
        return true;
    };

    middleware.cacheDir = cacheDir;
    middleware.rootDir = rootDir;
    middleware.policyVersion = POLICY_VERSION;
    active = middleware;
    return middleware;
}

module.exports = {
    createBrotliStatic,
    COMPRESSIBLE,
    POLICY_VERSION,
    acceptsBrotli,
    defaultCacheDir,
    getActiveBrotliStatic,
    setActiveBrotliStatic,
};
