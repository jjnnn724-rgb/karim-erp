/**
 * metrics.js — Prometheus-compatible metrics for /api/sales/complete.
 * Tracks p50/p95/p99 latency + counters.
 */

const { brotliPrometheus } = require('../middleware/brotli-metrics');

const WINDOW_MS = 5 * 60 * 1000;
const buckets = [10, 25, 50, 100, 200, 500, 1000, 2500];

const samples = [];
const counters = {
    total: 0, success: 0, client_error: 0, server_error: 0,
    idempotent_replay: 0, insufficient_stock: 0, concurrency_conflict: 0,
};

function recordSale({ durationMs, status, kind = 'success' }) {
    counters.total += 1;
    if (status >= 200 && status < 300) {counters.success += 1;}
    else if (status >= 400 && status < 500) {counters.client_error += 1;}
    else if (status >= 500) {counters.server_error += 1;}
    if (kind === 'replay') {counters.idempotent_replay += 1;}
    if (kind === 'insufficient_stock') {counters.insufficient_stock += 1;}
    if (kind === 'concurrency_conflict') {counters.concurrency_conflict += 1;}

    samples.push({ ts: Date.now(), durationMs, status });
    const cutoff = Date.now() - WINDOW_MS;
    while (samples.length > 0 && samples[0].ts < cutoff) {samples.shift();}
}

function percentile(arr, p) {
    if (arr.length === 0) {return 0;}
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function histogram(arr) {
    const counts = buckets.map(() => 0);
    for (const v of arr) {
        for (let i = 0; i < buckets.length; i++) {
            if (v <= buckets[i]) { counts[i] += 1; break; }
        }
    }
    return buckets.map((le, i) => ({ le, count: counts[i] }));
}

function prometheusFormat() {
    const now = Date.now();
    const recent = samples.filter(s => s.ts > now - WINDOW_MS).map(s => s.durationMs);
    const p50 = percentile(recent, 50);
    const p95 = percentile(recent, 95);
    const p99 = percentile(recent, 99);
    const hist = histogram(recent);

    let out = '';
    out += '# HELP pos_complete_sale_total Total completed sale requests\n';
    out += '# TYPE pos_complete_sale_total counter\n';
    out += `pos_complete_sale_total ${counters.total}\n`;
    out += `pos_complete_sale_total{result="success"} ${counters.success}\n`;
    out += `pos_complete_sale_total{result="client_error"} ${counters.client_error}\n`;
    out += `pos_complete_sale_total{result="server_error"} ${counters.server_error}\n`;
    out += `pos_complete_sale_total{result="idempotent_replay"} ${counters.idempotent_replay}\n`;
    out += `pos_complete_sale_total{result="insufficient_stock"} ${counters.insufficient_stock}\n`;
    out += `pos_complete_sale_total{result="concurrency_conflict"} ${counters.concurrency_conflict}\n\n`;

    out += '# HELP pos_complete_sale_duration_ms Latency percentiles (5min rolling)\n';
    out += '# TYPE pos_complete_sale_duration_ms summary\n';
    out += `pos_complete_sale_duration_ms{quantile="0.5"} ${p50}\n`;
    out += `pos_complete_sale_duration_ms{quantile="0.95"} ${p95}\n`;
    out += `pos_complete_sale_duration_ms{quantile="0.99"} ${p99}\n\n`;

    out += '# HELP pos_complete_sale_duration_bucket Histogram buckets\n';
    out += '# TYPE pos_complete_sale_duration_bucket histogram\n';
    let cumulative = 0;
    for (const b of hist) { cumulative += b.count; out += `pos_complete_sale_duration_bucket{le="${b.le}"} ${cumulative}\n`; }
    out += `pos_complete_sale_duration_bucket{le="+Inf"} ${recent.length}\n`;
    out += `pos_complete_sale_duration_count ${recent.length}\n`;
    out += `pos_complete_sale_duration_sum ${recent.reduce((s, v) => s + v, 0)}\n`;

    // Brotli للأصول الساكنة — نص فارغ إن لم يكن الوسيط مُركّبًا
    out += brotliPrometheus();
    return out;
}

function registerMetricsRoute(app) {
    // ⚠️ SECURITY: /metrics exposes business KPIs — require JWT + admin/auditor role.
    // For Prometheus scraping, operators can set METRICS_API_KEY env var and
    // send it as x-api-key header instead of a JWT (for scrape exporters).
    const { jwtAuth, requireRole } = require('./jwt-middleware');
    const METRICS_API_KEY = process.env.METRICS_API_KEY;

    app.get('/metrics', (req, res, next) => {
        // Allow API key auth for Prometheus scrapers
        if (METRICS_API_KEY && req.headers['x-api-key'] === METRICS_API_KEY) {
            return next();
        }
        // Otherwise require JWT + admin/auditor role
        jwtAuth(req, res, (err) => {
            if (err) {return;}
            requireRole('admin', 'auditor')(req, res, next);
        });
    }, (req, res) => {
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(prometheusFormat());
    });
}

module.exports = { recordSale, prometheusFormat, registerMetricsRoute };
