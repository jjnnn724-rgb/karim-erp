#!/usr/bin/env node
'use strict';
/**
 * br-measure.js -- measure the Brotli serve threshold (READ-ONLY)
 * ---------------------------------------------------------------------------
 * Why: middleware/brotli-static.js decides per request whether to WAIT for the
 * compression (files <= AWAIT_BYTES, "foreground") or to serve the original
 * once and compress in the background ("background"). That single number is a
 * trade: too high and the first visitor pays a synchronous q11; too low and
 * every mid-sized asset misses one hit.
 *
 * What it does: walks the same tree the middleware serves (frontend/app),
 * compresses every compressible file with the SAME quality policy the
 * middleware uses (q11 below QUALITY_BOUNDARY, q6 above), and prints:
 *   * the aggregate gain (raw -> br, per cent);
 *   * for each candidate threshold (32 / 48 / 64 / 128 KB) how many files and
 *     how many bytes would be awaited in the request path, and the wall time
 *     that first hit would cost.
 * Nothing is written anywhere: no cache dir is touched, no source is modified.
 *
 * Usage:
 *   node scripts/br-measure.js               # table for 32/48/64/128 KB
 *   node scripts/br-measure.js --json        # machine-readable
 *   node scripts/br-measure.js --top 15      # slowest files too
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { COMPRESSIBLE } = require('../backend/middleware/brotli-static');

const APP_DIR = path.resolve(__dirname, '..', 'frontend', 'app');

/* Mirrors the middleware constants -- read, never re-guessed. If they drift,
   this tool would lie; so they are re-declared here with the reference. */
const MIN_BYTES = 1024;                 // brotli-static.js:48
const MAX_BYTES = 4 * 1024 * 1024;      // brotli-static.js:49
const AWAIT_BYTES = 32 * 1024;          // brotli-static.js:50  (the shipped value)
const QUALITY_BOUNDARY = 512 * 1024;    // brotli-static.js:51
const QUALITY_SMALL = 11;               // brotli-static.js:52
const QUALITY_LARGE = 6;                // brotli-static.js:53
const CANDIDATES = [32 * 1024, 48 * 1024, 64 * 1024, 128 * 1024];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const topIdx = args.indexOf('--top');
const topN = topIdx >= 0 ? Math.max(0, parseInt(args[topIdx + 1], 10) || 10) : 0;

function walk(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, out); continue; }
        if (!COMPRESSIBLE.has(path.extname(entry.name).toLowerCase())) { continue; }
        out.push(full);
    }
}

function compressOnce(buf, quality) {
    const params = {
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    };
    return new Promise((resolve, reject) => {
        const t0 = process.hrtime.bigint();
        zlib.brotliCompress(buf, { params }, (err, out) => {
            if (err) { reject(err); return; }
            const ms = Number(process.hrtime.bigint() - t0) / 1e6;
            resolve({ out, ms });
        });
    });
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const mb = (bytes) => Math.round((bytes / 1048576) * 1000) / 1000;
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

(async function main() {
    const files = [];
    walk(APP_DIR, files);

    const rows = [];
    for (const file of files) {
        let stat;
        try { stat = fs.statSync(file); } catch (_) { continue; }
        if (!stat.isFile()) { continue; }
        if (stat.size < MIN_BYTES || stat.size > MAX_BYTES) { continue; }
        let buf;
        try { buf = fs.readFileSync(file); } catch (_) { continue; }
        const quality = stat.size < QUALITY_BOUNDARY ? QUALITY_SMALL : QUALITY_LARGE;
        let r;
        try { r = await compressOnce(buf, quality); } catch (_) { continue; }
        rows.push({
            file: path.relative(APP_DIR, file).replace(/\\/g, '/'),
            raw: buf.length,
            br: r.out.length,
            ms: Math.round(r.ms * 100) / 100,
            quality,
        });
    }

    const rawTotal = rows.reduce((n, r) => n + r.raw, 0);
    const brTotal = rows.reduce((n, r) => n + r.br, 0);

    const perThreshold = CANDIDATES.map((threshold) => {
        const fg = rows.filter((r) => r.raw <= threshold);
        const bg = rows.filter((r) => r.raw > threshold);
        const fgMs = fg.reduce((n, r) => n + r.ms, 0);
        return {
            thresholdKb: Math.round(threshold / 1024),
            foreground: {
                files: fg.length,
                bytes: fg.reduce((n, r) => n + r.raw, 0),
                brBytes: fg.reduce((n, r) => n + r.br, 0),
                totalMs: Math.round(fgMs * 100) / 100,
                avgMs: fg.length ? Math.round((fgMs / fg.length) * 100) / 100 : 0,
                maxMs: fg.length ? Math.max(...fg.map((r) => r.ms)) : 0,
            },
            background: {
                files: bg.length,
                bytes: bg.reduce((n, r) => n + r.raw, 0),
            },
        };
    });

    const result = {
        appDir: APP_DIR,
        shippedAwaitKb: Math.round(AWAIT_BYTES / 1024),
        files: rows.length,
        rawBytes: rawTotal,
        brBytes: brTotal,
        savedBytes: rawTotal - brTotal,
        savedPct: pct(rawTotal - brTotal, rawTotal),
        thresholds: perThreshold,
    };

    if (asJson) {
        console.log(JSON.stringify(Object.assign({}, result, {
            slowest: rows.slice().sort((a, b) => b.ms - a.ms).slice(0, topN || 10),
        }), null, 2));
        return;
    }

    console.log('Brotli serve-threshold measurement (read-only)');
    console.log(`tree          : ${path.relative(path.resolve(__dirname, '..'), APP_DIR).replace(/\\/g, '/')}`);
    console.log(`files         : ${result.files}  (>=1KB, <=4MB, compressible)`);
    console.log(`raw           : ${mb(rawTotal)} MB`);
    console.log(`brotli        : ${mb(brTotal)} MB`);
    console.log(`saved         : ${mb(rawTotal - brTotal)} MB (${result.savedPct}%)`);
    console.log(`shipped AWAIT : ${result.shippedAwaitKb} KB (brotli-static.js:50)`);
    console.log('');
    console.log('thrKB  fg.files  fg.bytes    fg.totalMs  fg.avgMs  fg.maxMs  bg.files  bg.bytes');
    for (const t of perThreshold) {
        console.log([
            String(t.thresholdKb).padStart(5),
            String(t.foreground.files).padStart(9),
            String(`${mb(t.foreground.bytes)}MB`).padStart(10),
            String(t.foreground.totalMs).padStart(11),
            String(t.foreground.avgMs).padStart(9),
            String(t.foreground.maxMs).padStart(9),
            String(t.background.files).padStart(9),
            String(`${mb(t.background.bytes)}MB`).padStart(9),
        ].join('  '));
    }
    console.log('');
    console.log(`fg = files whose FIRST hit waits for the compression (<= threshold)`);
    console.log(`bg = files served raw once and compressed in the background (> threshold)`);
    console.log(`smallest compressible file: ${kb(Math.min(...rows.map((r) => r.raw)))} KB`);

    if (topN) {
        console.log('');
        console.log('slowest files:');
        for (const r of rows.slice().sort((a, b) => b.ms - a.ms).slice(0, topN)) {
            console.log(`  ${String(r.ms).padStart(9)} ms  q${r.quality}  ${kb(r.raw).toString().padStart(8)} KB -> ${kb(r.br).toString().padStart(8)} KB  ${r.file}`);
        }
    }
})().catch((err) => {
    console.error(`failed: ${err.message}`);
    process.exit(1);
});
