/**
 * phase6b-egress-guard.js — حارس شبكة صارم لعملية server.js الكاملة (Phase 6b)
 * ══════════════════════════════════════════════════════════════════════════════
 * يُحمَّل عبر NODE_OPTIONS=--require قبل server.js، ويقوم بأربعة أمور:
 *   1) يمنع أي TCP خارج loopback ويسجّله (net.Socket.prototype.connect).
 *   2) يمنع إرسال UDP لغير loopback (dgram) — يشمل بيكل LAN.
 *   3) يمنع تحليل أسماء DNS غير المحلية (dns.lookup).
 *   4) يمنع تحميل oracledb نهائيًا ويسجّل المحاولة.
 * كذلك يجبر أي listen على 0.0.0.0/:: إلى 127.0.0.1 ويسجّل ذلك، فالسيرفر
 * المطلوب «شبكة مقطوعة» لا يفتح منفذًا على LAN.
 *
 * السجل: ملف JSONL في PHASE6B_EGRESS_LOG + سطر summary عند الخروج.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const dns = require('dns');
const Module = require('module');

const LOG = process.env.PHASE6B_EGRESS_LOG || '';
const SELF_HOST = String(os.hostname() || '').toLowerCase();
const stats = {
    allowedTcp: 0,
    blockedTcp: [],
    blockedUdp: [],
    blockedDns: [],
    oracleRequireAttempts: 0,
    listenForced: [],
};

function record(evt) {
    if (!LOG) {return;}
    try {fs.appendFileSync(LOG, JSON.stringify(evt) + '\n');} catch (_) { /* الحارس لا يُسقط العملية */ }
}

function isLoopback(host) {
    if (!host) {return true;}
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1'
        || h.endsWith('.localhost') || /^127\./.test(h);
}

// ─── 1) TCP ──────────────────────────────────────────────────────────────────
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
    let host = null, port = null, viaPath = false;
    if (typeof args[0] === 'object' && args[0] !== null) {
        host = args[0].host || null; port = args[0].port || null; viaPath = Boolean(args[0].path);
    } else if (typeof args[0] === 'number') {
        port = args[0]; host = typeof args[1] === 'string' ? args[1] : null;
    } else if (typeof args[0] === 'string') {
        viaPath = true;
    }
    if (viaPath || isLoopback(host)) {
        stats.allowedTcp++;
        return origConnect.apply(this, args);
    }
    stats.blockedTcp.push(`${host}:${port}`);
    record({ kind: 'blocked-tcp', host: String(host), port, at: new Date().toISOString() });
    throw Object.assign(new Error(`EGRESS_BLOCKED_TCP: ${host}:${port}`), { code: 'EGRESS_BLOCKED' });
};

// ─── 2) UDP ──────────────────────────────────────────────────────────────────
const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(...args) {
    const addr = args.find((a) => typeof a === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
    if (addr && !isLoopback(addr)) {
        stats.blockedUdp.push(addr);
        record({ kind: 'blocked-udp', host: addr, at: new Date().toISOString() });
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
            return cb(Object.assign(new Error('EGRESS_BLOCKED_UDP'), { code: 'EGRESS_BLOCKED' }));
        }
        return this;
    }
    return origSend.apply(this, args);
};

// ─── 3) DNS ──────────────────────────────────────────────────────────────────
const origLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
    const h = String(hostname || '');
    if (h && !isLoopback(h) && h.toLowerCase() !== SELF_HOST
        && !/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        stats.blockedDns.push(h);
        record({ kind: 'blocked-dns', host: h, at: new Date().toISOString() });
        const cb = rest[rest.length - 1];
        if (typeof cb === 'function') {
            return cb(Object.assign(new Error(`EGRESS_BLOCKED_DNS: ${h}`), { code: 'ENOTFOUND' }));
        }
        return;
    }
    if (h && h.toLowerCase() === SELF_HOST) {
        record({ kind: 'allowed-dns-self', host: h, at: new Date().toISOString() });
    }
    return origLookup.apply(this, arguments);
};

// ─── 4) oracledb ممنوع التحميل ──────────────────────────────────────────────
const origLoad = Module._load;
Module._load = function guardedLoad(request, parent, isMain) {
    if (String(request) === 'oracledb') {
        stats.oracleRequireAttempts++;
        record({ kind: 'blocked-oracledb-require', at: new Date().toISOString() });
        throw Object.assign(new Error('ORACLEDB_DISABLED_PHASE6B'), { code: 'MODULE_BLOCKED' });
    }
    return origLoad.call(this, request, parent, isMain);
};

// ─── 5) Listen مقيّد بـloopback ─────────────────────────────────────────────
// انتبه: PORT قد يصل نصًا من .env (server.js:153 لا يحوّله)، لذا نحوّل الرقم.
const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function guardedListen(...args) {
    const asPort = typeof args[0] === 'number' ? args[0] : Number(args[0]);
    if (typeof args[0] !== 'object' && Number.isInteger(asPort) && asPort >= 0) {
        const hostIdx = typeof args[1] === 'string' ? 1 : -1;
        const host = hostIdx === 1 ? args[1] : null;
        if (host === null || host === '0.0.0.0' || host === '::') {
            const from = host;
            args[0] = asPort;
            if (hostIdx === 1) {args[1] = '127.0.0.1';} else {args.splice(1, 0, '127.0.0.1');}
            stats.listenForced.push({ port: asPort, from, to: '127.0.0.1' });
            record({ kind: 'listen-forced', port: asPort, from, to: '127.0.0.1' });
        }
    } else if (args[0] && typeof args[0] === 'object' && !args[0].path) {
        const from = args[0].host || null;
        if (from === null || from === '0.0.0.0' || from === '::') {
            args[0] = Object.assign({}, args[0], { host: '127.0.0.1' });
            stats.listenForced.push({ port: args[0].port, from, to: '127.0.0.1' });
            record({ kind: 'listen-forced', port: args[0].port, from, to: '127.0.0.1' });
        }
    }
    return origListen.apply(this, args);
};

process.on('exit', () => {
    record({ kind: 'summary', ...stats, at: new Date().toISOString() });
});

record({ kind: 'guard-loaded', pid: process.pid, node: process.version, selfHost: SELF_HOST, argv: process.argv.slice(1, 3), at: new Date().toISOString() });

