/**
 * common/lan-discovery.js — اكتشاف الخادم على الشبكة المحلية (UDP)
 * ────────────────────────────────────────────────────────────────────────────
 * وحدة نقية بلا Electron ولا backend — يستخدمها الطرفان:
 *   • السيرفر: startLanBeacon() يبث إعلانه كل بضع ثوانٍ ويرد فورًا على أي probe
 *   • العميل: discoverServers() يستمع للإعلانات ويرسل probes — فيجد الخادم
 *     بلا أي ملف إعدادات يدوي (zero-config plug-and-play).
 *
 * الحزمة: MAGIC + '|' + JSON — يُرفض أي شيء آخر (لا تفسير لحزم غريبة).
 * المنفذ الافتراضي 50505/UDP (KARIM_LAN_PORT).
 */
'use strict';

const dgram = require('dgram');
const os = require('os');

const MAGIC = 'KRM1';
const DEFAULT_PORT = Number(process.env.KARIM_LAN_PORT || 50505);
const BEACON_INTERVAL_MS = Math.max(1000, Number(process.env.KARIM_LAN_BEACON_INTERVAL_MS || 3000));

/** هل الحمولة إعلان karim-erp صالح؟ */
function validBeaconInfo(info) {
    return Boolean(info && info.svc === 'karim-erp' && Number(info.port) > 0
        && (info.scheme === 'https' || info.scheme === 'http'));
}

/** ترميز الإعلان إلى حزمة UDP (يرجع Buffer أو null لو الحمولة غير صالحة) */
function encodeBeacon(info) {
    if (!validBeaconInfo(info)) {return null;}
    return Buffer.from(`${MAGIC}|${JSON.stringify({
        svc: info.svc,
        name: String(info.name || os.hostname()).slice(0, 60),
        version: String(info.version || '').slice(0, 20),
        scheme: info.scheme,
        port: Number(info.port),
        ts: Date.now(),
    })}`);
}

/** فك حزمة UDP — يرجع الإعلان أو null (حزمة غريبة/تالفة) */
function parseBeacon(buffer) {
    try {
        const s = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
        if (!s.startsWith(MAGIC + '|')) {return null;}
        const info = JSON.parse(s.slice(MAGIC.length + 1));
        return validBeaconInfo(info) ? info : null;
    } catch (_) { return null; }
}

/** كل عناوين البث الموجهة لشبكات الجهاز المحلية (x.y.z.255 لكل /24) */
function broadcastAddresses() {
    const out = ['255.255.255.255'];
    const seen = new Set(out);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const iface of list || []) {
            if (iface.family !== 'IPv4' || iface.internal) {continue;}
            const parts = String(iface.address).split('.');
            if (parts.length !== 4) {continue;}
            const directed = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
            if (!seen.has(directed)) {seen.add(directed); out.push(directed);}
        }
    }
    return out;
}

/**
 * جهة السيرفر: إعلان وجود الخادم على الشبكة + الرد الفوري على أي probe.
 * يرجع دالة إيقاف. لا يرمي أبدًا — فشل UDP لا يمس الخادم إطلاقًا.
 */
function startLanBeacon({ info, logger = console, bindAddress } = {}) {
    let stopped = false;
    let socket = null;
    let timer = null;
    const packet = encodeBeacon(info);
    if (!packet) {
        (logger.warn || logger.log).call(logger, '[lan-beacon] حمولة إعلان غير صالحة — الإعلان معطل');
        return () => {};
    }
    try {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', (e) => {
            if (!stopped) {(logger.warn || logger.log).call(logger, '[lan-beacon] udp error:', e.message);}
        });
        // حد معدّل لكل مصدر: رد واحد كحد أقصى في الثانية (حماية من أي عاصفة)
        const lastReplyAt = new Map();
        // نرد على PROBE فقط. الإعلانات (beacons) لا تُجاب — الرد على أي beacon وصل
        // (صدى إعلاننا الخاص عبر البث، أو إعلان نسخة أخرى) كان يخلق عاصفة ping-pong
        // لا نهائية: كل طرف "يرد" على ردّ الطرف الآخر بحرق نواة CPU كاملة.
        socket.on('message', (msg, rinfo) => {
            const text = msg.toString('utf8');
            if (text !== 'KRM_PROBE') {return;}
            if (stopped || !socket) {return;}
            const key = `${rinfo.address}:${rinfo.port}`;
            const now = Date.now();
            if (now - (lastReplyAt.get(key) || 0) < 1000) {return;}
            if (lastReplyAt.size > 4096) {lastReplyAt.clear();}
            lastReplyAt.set(key, now);
            try { socket.send(packet, rinfo.port, rinfo.address); } catch (_) {}
        });
        socket.bind({ port: DEFAULT_PORT, address: bindAddress || '0.0.0.0', exclusive: false }, () => {
            try { socket.setBroadcast(true); } catch (_) {}
        });
        const sendAll = () => {
            if (stopped || !socket) {return;}
            for (const addr of broadcastAddresses()) {
                try { socket.send(packet, DEFAULT_PORT, addr); } catch (_) {}
            }
        };
        timer = setInterval(sendAll, BEACON_INTERVAL_MS);
        if (timer.unref) {timer.unref();}
        setTimeout(sendAll, 400).unref?.();
        (logger.info || logger.log).call(logger,
            `[lan-beacon] نشط — منفذ ${DEFAULT_PORT} كل ${BEACON_INTERVAL_MS}ms — ${info.name || ''} v${info.version || ''}`);
    } catch (e) {
        (logger.warn || logger.log).call(logger, '[lan-beacon] تعذر بدء الإعلان:', e.message);
    }
    return function stopLanBeacon() {
        stopped = true;
        if (timer) {clearInterval(timer); timer = null;}
        try { socket && socket.close(); } catch (_) {}
        socket = null;
    };
}

/**
 * جهة العميل: استماع + probes لمدة listenMs — يرجع قائمة خوادم فريدة مرتبة.
 * verify(info) اختيارية: تصفية إضافية (مثلاً فحص HTTP) — الافتراضي قبول الكل.
 * targets اختيارية: عناوين الـ probes (افتراضي broadcast الشبكات المحلية؛
 * تُمرَّر في الاختبارات كي يعمل الاكتشاف على loopback).
 * bindPort اختياري: منفذ الاستماع المحلي (0 = عشوائي — للاختبارات؛ الافتراضي
 * DEFAULT_PORT لسماع إعلانات الـ broadcast).
 */
function discoverServers({ listenMs = 3000, logger: _logger = console, bindAddress, verify, targets, bindPort } = {}) {
    return new Promise((resolve) => {
        const found = new Map();
        let socket = null;
        let done = false;
        const finish = () => {
            if (done) {return;}
            done = true;
            try { socket && socket.close(); } catch (_) {}
            const list = [...found.values()]
                .filter(x => !verify || verify(x))
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            resolve(list);
        };
        try {
            socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            socket.on('error', () => finish());
            socket.on('message', (msg, rinfo) => {
                const info = parseBeacon(msg);
                if (!info) {return;}
                info.address = rinfo && rinfo.address;
                info.url = `${info.scheme}://${info.address || rinfo.address}:${info.port}`;
                found.set(info.url, info);
            });
            socket.bind({ port: Number.isInteger(bindPort) ? bindPort : DEFAULT_PORT, address: bindAddress || '0.0.0.0', exclusive: false }, () => {
                try { socket.setBroadcast(true); } catch (_) {}
                // probes فورية دورية — السيرفر يرد unicast فيصل الجواب خلال <100ms
                const probe = Buffer.from('KRM_PROBE');
                const destinations = Array.isArray(targets) && targets.length ? targets : broadcastAddresses();
                const probeTimer = setInterval(() => {
                    for (const addr of destinations) {
                        try { socket.send(probe, DEFAULT_PORT, addr); } catch (_) {}
                    }
                }, 800);
                if (probeTimer.unref) {probeTimer.unref();}
                setTimeout(() => { clearInterval(probeTimer); finish(); }, listenMs);
            });
        } catch (_) { finish(); }
    });
}

module.exports = {
    MAGIC, DEFAULT_PORT, BEACON_INTERVAL_MS,
    validBeaconInfo, encodeBeacon, parseBeacon, broadcastAddresses,
    startLanBeacon, discoverServers,
};
