'use strict';
/**
 * brotli-metrics.js — قياسات وسيط Brotli للأصول الساكنة
 * ────────────────────────────────────────────────────────────────────────────
 * الغرض: قياس مكسب الكاش وتكلفته قبل الإنتاج — نسبة إصابة الكاش، زمن الضغط
 *        (أمامي/خلفي)، حجم الكاش على القرص، ومدة التسخين.
 *
 * لماذا ملف منفصل؟ وسيط brotli-static يجب أن يبقى منطق HTTP صافيًا؛ القياس
 * يُحقَن فيه ككائن اختياري — وبغيابه لا يحدث أي تغيير في السلوك.
 *
 * قواعد التصميم (نفس فلسفة backend/metrics.js):
 *   • المسار الساخن يفعل فقط: عدّاد++ ودفعة في خاتم ثابت → بلا I/O وبلا await وبلا رمي.
 *   • كل دالة دفاعية: القياس لا يُسقط الخادم مهما حدث.
 *   • حجم الكاش يُقاس عند السحب (scrape) لا عند كل طلب، بـ TTL 30 ثانية → بلا إرهاق للقرص.
 *   • أسباب التجاوز محصورة في قائمة بيضاء → لا انفجار في بطاقة الأبعاد.
 */
const fs = require('fs');
const path = require('path');

const COMPRESSION_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const SAMPLES_MAX = 2000;
const DISK_SCAN_TTL_MS = 30000;

const BYPASS_WHITELIST = new Set([
    'method', 'no_accept_br', 'unsafe_path', 'not_compressible',
    'too_small', 'too_large', 'not_found', 'not_a_file', 'stale_artifact',
]);

const EVICT_WHITELIST = new Set(['tmp', 'age', 'size', 'manual']);

function emptyPhase() {
    return { count: 0, sumMs: 0, maxMs: 0, buckets: COMPRESSION_BUCKETS.map(() => 0), samples: new Array(SAMPLES_MAX), head: 0, len: 0 };
}

/** خاتم ثابت الحجم: لا نمو ذاكرة مهما طال التشغيل */
function pushSample(phase, ms) {
    phase.samples[phase.head] = ms;
    phase.head = (phase.head + 1) % SAMPLES_MAX;
    if (phase.len < SAMPLES_MAX) { phase.len++; }
}

function sampleAt(phase, i) {
    return phase.samples[(phase.head - phase.len + i + SAMPLES_MAX * 2) % SAMPLES_MAX];
}

function pick(sorted, p) {
    if (!sorted.length) { return 0; }
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function phaseSummary(phase) {
    const sorted = [];
    for (let i = 0; i < phase.len; i++) { sorted.push(sampleAt(phase, i)); }
    sorted.sort((a, b) => a - b);
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
        count: phase.count,
        sumMs: r1(phase.sumMs),
        avgMs: phase.count ? r1(phase.sumMs / phase.count) : 0,
        maxMs: r1(phase.maxMs),
        p50: r1(pick(sorted, 50)),
        p95: r1(pick(sorted, 95)),
        p99: r1(pick(sorted, 99)),
    };
}

/** قياس مجلد الكاش (مسطّح) — عند السحب فقط، وبـ TTL */
function scanCache(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
        if (!entry.isFile()) { continue; }
        try {
            const st = fs.statSync(path.join(dir, entry.name));
            files++;
            bytes += st.size;
        } catch (_) { /* ملف أُخلي بين السطور — يُتجاهل */ }
    }
    return { files, bytes };
}

/* نسخة نشطة واحدة: الوسيط يُنشئها، ولوحات المراقبة تسحبها */
let active = null;

/**
 * @param {{enabled?:boolean, cacheDir?:string, maxBytes?:number}} [options]
 */
function createBrotliMetrics(options) {
    const opts = options || {};
    const enabled = opts.enabled !== false && process.env.BROTLI_METRICS !== 'off';

    const state = {
        enabled,
        cacheDir: opts.cacheDir ? path.resolve(opts.cacheDir) : null,
        maxBytes: Number.isFinite(opts.maxBytes) ? opts.maxBytes : null,
        requests: { hit: 0, compressed: 0, deferred: 0, bypass: 0 },
        errors: { foreground: 0, background: 0 },
        bypass: Object.create(null),
        evictions: { files: 0, bytes: 0, byReason: Object.create(null) },
        compression: { foreground: emptyPhase(), background: emptyPhase() },
        warmup: { running: false, files: 0, compressed: 0, lastMs: null, lastEndedAt: null },
        disk: { files: 0, bytes: 0, scannedAt: 0 },
    };

    const api = {
        enabled,

        /** طلب خُدم من نسخة الكاش */
        hit() {
            if (!enabled) { return; }
            state.requests.hit++;
        },

        /** ضُغط الآن وخُدم مضغوطًا (phase: foreground = انتظر الطلب، background = خلفيًا) */
        compressed(ms, phase) {
            if (!enabled) { return; }
            const p = state.compression[phase] || state.compression.foreground;
            state.requests[phase === 'background' ? 'deferred' : 'compressed']++;
            p.count++;
            p.sumMs += ms;
            if (ms > p.maxMs) { p.maxMs = ms; }
            pushSample(p, ms);
            for (let i = 0; i < COMPRESSION_BUCKETS.length; i++) {
                if (ms <= COMPRESSION_BUCKETS[i]) { p.buckets[i]++; return; }
            }
        },

        /** مرّ الطلب للأسفل بدون لمس (reason من القائمة البيضاء) */
        bypass(reason) {
            if (!enabled) { return; }
            const key = BYPASS_WHITELIST.has(reason) ? reason : 'other';
            state.requests.bypass++;
            state.bypass[key] = (state.bypass[key] || 0) + 1;
        },

        /** فشل ضغط */
        error(phase) {
            if (!enabled) { return; }
            state.errors[phase === 'background' ? 'background' : 'foreground']++;
        },

        /** إخلاء من سياسة الكاش (reason من القائمة البيضاء) */
        evicted(reason, files, bytes) {
            if (!enabled) { return; }
            const key = EVICT_WHITELIST.has(reason) ? reason : 'other';
            const n = Number.isFinite(files) ? files : 0;
            const b = Number.isFinite(bytes) ? bytes : 0;
            state.evictions.files += n;
            state.evictions.bytes += b;
            const bucket = state.evictions.byReason[key] || (state.evictions.byReason[key] = { files: 0, bytes: 0 });
            bucket.files += n;
            bucket.bytes += b;
        },

        warmupStart(files) {
            if (!enabled) { return; }
            state.warmup.running = true;
            state.warmup.files = files;
            state.warmup.compressed = 0;
        },

        warmupCounted() {
            if (!enabled) { return; }
            state.warmup.compressed++;
        },

        warmupEnd(ms) {
            if (!enabled) { return; }
            state.warmup.running = false;
            state.warmup.lastMs = Math.round(ms);
            state.warmup.lastEndedAt = new Date().toISOString();
        },

        setCacheDir(dir) {
            state.cacheDir = dir ? path.resolve(dir) : null;
        },

        snapshot() {
            if (!enabled) { return null; }
            const req = state.requests;
            const eligible = req.hit + req.compressed + req.deferred;
            const now = Date.now();
            if (state.cacheDir && now - state.disk.scannedAt > DISK_SCAN_TTL_MS) {
                const scanned = scanCache(state.cacheDir);
                state.disk = scanned
                    ? { files: scanned.files, bytes: scanned.bytes, scannedAt: now }
                    : { files: 0, bytes: 0, scannedAt: now };
            }
            return {
                enabled: true,
                cacheDir: state.cacheDir,
                requests: {
                    total: eligible + req.bypass,
                    eligible,
                    hit: req.hit,
                    compressed: req.compressed,
                    deferred: req.deferred,
                    bypass: req.bypass,
                    hitRatio: eligible ? Math.round((req.hit / eligible) * 10000) / 10000 : 0,
                },
                bypassReasons: Object.assign({}, state.bypass),
                compression: {
                    foreground: phaseSummary(state.compression.foreground),
                    background: phaseSummary(state.compression.background),
                },
                errors: Object.assign({}, state.errors),
                evictions: {
                    files: state.evictions.files,
                    bytes: state.evictions.bytes,
                    byReason: Object.assign({}, state.evictions.byReason),
                },
                cache: {
                    files: state.disk.files,
                    bytes: state.disk.bytes,
                    maxBytes: state.maxBytes,
                    usageRatio: state.maxBytes ? Math.round((state.disk.bytes / state.maxBytes) * 10000) / 10000 : null,
                    scannedAt: state.disk.scannedAt ? new Date(state.disk.scannedAt).toISOString() : null,
                },
                warmup: Object.assign({}, state.warmup),
            };
        },

        /** عرض بصيغة Prometheus 0.0.4 (نصي، بلا تبعيات) */
        prometheus() {
            if (!enabled) { return ''; }
            const snap = api.snapshot();
            let out = '';
            out += '# HELP static_brotli_requests_total Static asset requests handled by the brotli middleware\n';
            out += '# TYPE static_brotli_requests_total counter\n';
            for (const key of ['hit', 'compressed', 'deferred', 'bypass']) {
                out += `static_brotli_requests_total{result="${key}"} ${snap.requests[key]}\n`;
            }
            out += '# HELP static_brotli_cache_hit_ratio Served-from-cache share of brotli-eligible requests\n';
            out += '# TYPE static_brotli_cache_hit_ratio gauge\n';
            out += `static_brotli_cache_hit_ratio ${snap.requests.hitRatio}\n`;
            out += '# HELP static_brotli_bypass_total Requests left untouched by the brotli middleware\n';
            out += '# TYPE static_brotli_bypass_total counter\n';
            for (const reason of Object.keys(snap.bypassReasons)) {
                out += `static_brotli_bypass_total{reason="${reason}"} ${snap.bypassReasons[reason]}\n`;
            }
            out += '# HELP static_brotli_compression_ms Brotli compression duration by phase\n';
            out += '# TYPE static_brotli_compression_ms histogram\n';
            for (const phase of ['foreground', 'background']) {
                const p = state.compression[phase];
                let cumulative = 0;
                for (let i = 0; i < COMPRESSION_BUCKETS.length; i++) {
                    cumulative += p.buckets[i];
                    out += `static_brotli_compression_ms_bucket{phase="${phase}",le="${COMPRESSION_BUCKETS[i]}"} ${cumulative}\n`;
                }
                out += `static_brotli_compression_ms_bucket{phase="${phase}",le="+Inf"} ${p.count}\n`;
                out += `static_brotli_compression_ms_count{phase="${phase}"} ${p.count}\n`;
                out += `static_brotli_compression_ms_sum{phase="${phase}"} ${Math.round(p.sumMs * 10) / 10}\n`;
            }
            out += '# HELP static_brotli_errors_total Failed compressions\n';
            out += '# TYPE static_brotli_errors_total counter\n';
            out += `static_brotli_errors_total{phase="foreground"} ${snap.errors.foreground}\n`;
            out += `static_brotli_errors_total{phase="background"} ${snap.errors.background}\n`;
            out += '# HELP static_brotli_cache_bytes Brotli cache size on disk (flat cache dir)\n';
            out += '# TYPE static_brotli_cache_bytes gauge\n';
            out += `static_brotli_cache_bytes ${snap.cache.bytes}\n`;
            out += `static_brotli_cache_files ${snap.cache.files}\n`;
            if (snap.cache.maxBytes !== null) {
                out += `static_brotli_cache_max_bytes ${snap.cache.maxBytes}\n`;
                out += '# HELP static_brotli_cache_usage_ratio Share of the cache budget in use\n';
                out += '# TYPE static_brotli_cache_usage_ratio gauge\n';
                out += `static_brotli_cache_usage_ratio ${snap.cache.usageRatio}\n`;
            }
            out += '# HELP static_brotli_cache_evicted_files_total Cache artifacts removed by the cleanup policy\n';
            out += '# TYPE static_brotli_cache_evicted_files_total counter\n';
            for (const reason of Object.keys(snap.evictions.byReason)) {
                out += `static_brotli_cache_evicted_files_total{reason="${reason}"} ${snap.evictions.byReason[reason].files}\n`;
                out += `static_brotli_cache_evicted_bytes_total{reason="${reason}"} ${snap.evictions.byReason[reason].bytes}\n`;
            }
            out += '# HELP static_brotli_warmup_running 1 while the background warmup is walking the tree\n';
            out += '# TYPE static_brotli_warmup_running gauge\n';
            out += `static_brotli_warmup_running ${snap.warmup.running ? 1 : 0}\n`;
            out += `static_brotli_warmup_files ${snap.warmup.files}\n`;
            out += `static_brotli_warmup_compressed ${snap.warmup.compressed}\n`;
            out += `static_brotli_warmup_duration_ms ${snap.warmup.lastMs === null ? 0 : snap.warmup.lastMs}\n`;
            return out;
        },
    };

    if (enabled) { active = api; }
    return api;
}

/* ─── واجهات السحب: الوسيط يُنشئ النسخة النشطة، وهذه تُقرأ من لوحات المراقبة ─── */

function getActiveMetrics() { return active; }

/** لقطة للوحة /api/metrics (JSON) — null إن لم يكن الوسيط مُركّبًا */
function brotliSnapshot() {
    return active ? active.snapshot() : null;
}

/** عرض Prometheus — نص فارغ إن لم يكن الوسيط مُركّبًا */
function brotliPrometheus() {
    return active ? active.prometheus() : '';
}

function setActiveMetrics(instance) { active = instance; }

module.exports = {
    createBrotliMetrics,
    getActiveMetrics,
    setActiveMetrics,
    brotliSnapshot,
    brotliPrometheus,
    COMPRESSION_BUCKETS,
    BYPASS_WHITELIST,
    EVICT_WHITELIST,
};
