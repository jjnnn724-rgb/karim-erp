
// ══════════════════════════════════════════════════════
//  Karim ERP — Real-time LAN System v2.0
//  Socket.io + Web Audio API Notification Sounds
// ══════════════════════════════════════════════════════

(function() {
'use strict';

// ── سياسة الإشعارات على الشاشة: مدير النظام (admin) فقط ──
// الأصوات ومزامنة البيانات تعمل للجميع؛ المنبثقات المرئية ودمج الجرس للأدمن فقط.
function rtNotifAdmin(){ try{ return !!(window.STATE && window.STATE.currentUser && window.STATE.currentUser.role === 'admin'); }catch(_){ return false; } }

// ── Audio Engine (Web Audio API — No external files needed) ──
const AudioEngine = {
    ctx: null,
    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) { console.warn('Audio not supported'); }
    },
    // Professional chime sound
    playNotification() {
        if (!this.ctx) {return;}
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
        notes.forEach((freq, i) => {
            setTimeout(() => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.value = 3000;
                osc.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                osc.type = 'sine'; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                gain.gain.setValueAtTime(0, this.ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
                osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.5);
            }, i * 120);
        });
    },
    // Sync sound — soft "pop"
    playSync() {
        if (!this.ctx) {return;}
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(880, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
        osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.2);
    },
    // Connect sound — ascending tone
    playConnect() {
        if (!this.ctx) {return;}
        [440, 550, 660].forEach((freq, i) => {
            setTimeout(() => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
                osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.25);
            }, i * 80);
        });
    },
    // Disconnect sound — descending tone
    playDisconnect() {
        if (!this.ctx) {return;}
        [440, 330, 220].forEach((freq, i) => {
            setTimeout(() => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
                osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.3);
            }, i * 100);
        });
    },
    // Error sound
    playSale() {
        if (!this.ctx) {return;}
        // Two-note "cha-ching" cue, distinct from sync/notification sounds,
        // so a completed cashier sale is unmistakably audible on the revenue
        // screen / any open ERP window.
        [880, 1320].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.type = 'sine'; osc.frequency.value = freq;
            const t0 = this.ctx.currentTime + i * 0.11;
            gain.gain.setValueAtTime(0.001, t0);
            gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
            osc.start(t0); osc.stop(t0 + 0.26);
        });
    },
    playError() {
        if (!this.ctx) {return;}
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth'; osc.frequency.value = 200;
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
        osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.35);
    },
    // Chat message — gentle "pling" with subtle harmonics
    playChat() {
        if (!this.ctx) {return;}
        const now = this.ctx.currentTime;
        // Fundamental + harmonics for a rich "pling" timbre
        const notes = [
            { freq: 880, type: 'sine', gain: 0.15, dur: 0.35 },   // A5
            { freq: 1108.73, type: 'sine', gain: 0.08, dur: 0.45 }, // C#6 (major 3rd)
            { freq: 1318.51, type: 'sine', gain: 0.05, dur: 0.5 },  // E6 (perfect 5th)
            { freq: 1760, type: 'sine', gain: 0.03, dur: 0.6 },     // A6 (octave)
        ];
        notes.forEach((note) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 4000;
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = note.freq;
            gain.gain.setValueAtTime(0, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(note.gain, this.ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + note.dur);
            osc.connect(filter);
            filter.connect(gain);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(note.freq, this.ctx.currentTime);
            osc.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + note.dur);
        });
    },
};

// ── Build UI Elements ──
function buildUI() {
    // Connection badge — mounted as a topbar status item (not a floating pill),
    // falling back to body when no topbar exists.
    const badge = document.createElement('button');
    badge.id = 'rt-badge';
    badge.type = 'button';
    badge.innerHTML = `
        <span class="rt-lamps" aria-hidden="true">
            <span id="rt-dot" title="اتصال الخادم"></span>
            <span class="rt-lamp-sep"></span>
            <span id="db-dot" title="قاعدة البيانات PostgreSQL"></span>
        </span>
        <span id="rt-label">جارٍ الاتصال...</span>
        <i class="ji rt-caret" data-i=chevron-down aria-hidden="true"></i>
    `;
    const topbarRight = document.querySelector('.topbar .topbar-right');
    if (topbarRight) {
        topbarRight.appendChild(badge);
    } else {
        document.body.appendChild(badge);
    }

    // Devices panel
    const panel = document.createElement('div');
    panel.id = 'rt-panel';
    panel.innerHTML = `
        <div id="rt-panel-title"><i class=ji data-i=zap></i> الأجهزة المتصلة</div>
        <div id="rt-devices-list"><div class="rt-empty">جارٍ التحميل…</div></div>
        <div id="rt-latency">Ping: —</div>
    `;
    document.body.appendChild(panel);

    // Sync toast
    const toast = document.createElement('div');
    toast.id = 'rt-sync-toast';
    toast.innerHTML = '<span id="rt-sync-icon"><i class=ji data-i=refresh></i></span><span id="rt-sync-msg">جارٍ التزامن...</span>';
    document.body.appendChild(toast);

    // Badge click → toggle panel
    badge.addEventListener('click', () => {
        const open = panel.classList.toggle('visible');
        badge.classList.toggle('open', open);
    });

    // Click outside → close panel
    document.addEventListener('click', (e) => {
        if (!badge.contains(e.target) && !panel.contains(e.target)) {
            panel.classList.remove('visible');
        }
    });
}

// ── Show sync toast ──
const toastTimer = null;
function showSyncToast(msg, icon = '', duration = 3000) { /* notifications disabled */ return; }

// ── Update badge state ──
function setBadgeState(state, label) {
    const badge = document.getElementById('rt-badge');
    const dot = document.getElementById('rt-dot');
    const lbl = document.getElementById('rt-label');
    if (!badge) {return;}
    badge.classList.remove('connected', 'syncing');
    if (state) {badge.classList.add(state);} // 'connected' | 'syncing' | ''
    dot.className = 'connected' === state ? 'connected' : ('syncing' === state ? 'syncing' : '');
    lbl.textContent = label;
}

// deviceName/ip arrive from ANY LAN client's socket handshake (client-controlled)
// — escape before innerHTML injection (reflected XSS across POS terminals)
function _rtEscHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Update devices list ──
function updateDevicesList(clients) {
    const list = document.getElementById('rt-devices-list');
    if (!list) {return;}
    if (!clients || clients.length === 0) {
        list.innerHTML = '<div class="rt-empty">لا توجد أجهزة متصلة</div>';
        return;
    }
    list.innerHTML = clients.map(c => `
        <div class="rt-device-item">
            <div class="rt-device-icon"><i class=ji data-i=monitor></i></div>
            <div class="rt-device-info">
                <div class="rt-device-name">${_rtEscHtml(c.deviceName)}</div>
                <div class="rt-device-ip">${_rtEscHtml(c.ip)}</div>
            </div>
            <div class="rt-device-dot"></div>
        </div>
    `).join('');
}

// ── Detect device name ──
function getDeviceName() {
    const ua = navigator.userAgent;
    let name = 'Unknown device';
    if (/iPhone/i.test(ua)) {name = 'iPhone';}
    else if (/iPad/i.test(ua)) {name = 'iPad';}
    else if (/Android/i.test(ua)) {name = 'Android';}
    else if (/Windows/i.test(ua)) {name = 'Windows PC';}
    else if (/Mac/i.test(ua)) {name = 'Mac';}
    else if (/Linux/i.test(ua)) {name = 'Linux';}
    const now = new Date();
    return `${name} (${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')})`;
}

// ── Ping tracker ──
let pingInterval = null;
let lastPing = null;
let connectedClientCount = 0;

// ── Initialize Socket.io ──
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
let isSyncing = false;

// ─── Durable channel (TASK 6): sequence-tracked domain_event + resume/ack ───
// Shadow phase: track + acknowledge only (no UI dependence yet); resume fills
// gaps via GET /rt/events?since= on every (re)connect.
const RT_SEQ_KEY = 'karim_rt_seq';
const RT_INSTALL_KEY = 'karim_rt_install';
let rtLastSeq = 0;
let rtInstallId = '';
let rtAckTimer = null;
try {
    rtLastSeq = Number(window.localStorage?.getItem(RT_SEQ_KEY) || 0) || 0;
    rtInstallId = window.localStorage?.getItem(RT_INSTALL_KEY) || '';
    if (!rtInstallId) {
        const rnd = (window.crypto?.getRandomValues?.(new Uint32Array(4)) || [Date.now(), Math.random() * 1e9 | 0]).join('-');
        rtInstallId = `web-${Date.now().toString(36)}-${String(rnd).slice(0, 24)}`;
        window.localStorage?.setItem(RT_INSTALL_KEY, rtInstallId);
    }
} catch (_) { /* storage unavailable (private mode) — memory only */ }
function rtPersistSeq() {
    try {window.localStorage?.setItem(RT_SEQ_KEY, String(rtLastSeq));} catch (_) {}
}
function rtHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (window._jwt) {h['Authorization'] = 'Bearer ' + window._jwt;}
    if (window._appKey) {h['x-api-key'] = window._appKey;}
    return h;
}
async function rtResume() {
    // Missed-event recovery: advance through the durable log, then ACK.
    try {
        const res = await fetch(`${window.location.origin}/api/rt/events?since=${rtLastSeq}&limit=200`, { headers: rtHeaders() });
        if (!res.ok) {return;}
        const data = await res.json();
        const evts = Array.isArray(data?.events) ? data.events : [];
        if (data?.resyncRequired) {
            // Gap too large → full refresh (existing pattern), then jump forward.
            try { if (typeof window.loadData === 'function') {await window.loadData();} } catch (_) {}
            if (Number.isFinite(Number(data?.currentSequence))) {rtLastSeq = Number(data.currentSequence);}
            rtPersistSeq(); rtScheduleAck();
            return;
        }
        for (const e of evts) {
            const sq = Number(e?.sequence);
            if (Number.isFinite(sq) && sq > rtLastSeq) {rtLastSeq = sq;}
        }
        if (Number.isFinite(Number(data?.deliveredUpTo)) && Number(data.deliveredUpTo) > rtLastSeq) {
            rtLastSeq = Number(data.deliveredUpTo);
        }
        rtPersistSeq(); rtScheduleAck();
    } catch (_) { /* offline — next connect retries */ }
}
const RT_API_CONTRACT = 1;
async function rtCheckVersion() {
    // EXE compat handshake (TASK 10): warn-only, never blocking (no lockout risk).
    try {
        const res = await fetch(`${window.location.origin}/api/rt/version?clientContract=${RT_API_CONTRACT}`);
        if (!res.ok) {return;}
        const v = await res.json();
        if (v && v.compatible === false) {
            setBadgeState('syncing', 'نسخة العميل غير متوافقة — حدّث التطبيق');
            try { if (window.toast) {window.toast(`نسخة العميل غير متوافقة (الأدنى ${v.minClientVersion || '؟'}) — حدّث التطبيق`, 'warning');} } catch (_) {}
        }
    } catch (_) {}
}
function rtScheduleAck() {
    if (rtAckTimer) {return;}
    rtAckTimer = setTimeout(async () => {
        rtAckTimer = null;
        try {
            await fetch(`${window.location.origin}/api/rt/ack`, {
                method: 'POST', headers: rtHeaders(),
                body: JSON.stringify({ installationId: rtInstallId, lastSequence: rtLastSeq }),
            });
        } catch (_) {}
    }, 5000);
}
function rtOnDomainEvent(env) {
    // تتبّع التسلسل + ACK (يحدث أولًا دائمًا — لا يعتمد على نوع الحدث).
    const sq = Number(env?.sequence);
    if (Number.isFinite(sq) && sq > rtLastSeq) {
        rtLastSeq = sq;
        rtPersistSeq(); rtScheduleAck();
    }
    // ── Phase B: تطبيق فعلي لأحداث الدومين الدائمة (بيانات فقط) ──
    // SALE_POSTED يشغّل نفس التحديث المشتق من sale:completed — لكن بلا صوت ولا
    // توست: الصوت مصدره البث القديم في مرحلة التعايش حتى لا يُسمع البيع
    // مرتين. نفس مفتاح المؤقّت يمنع التكرار لو الحدثان وصلا معًا.
    try {
        if (env?.eventType === 'SALE_POSTED' && typeof window.loadData === 'function') {
            clearTimeout(window.__posSaleRefreshTimer);
            window.__posSaleRefreshTimer = setTimeout(async () => {
                if (isSyncing) {return;}
                isSyncing = true;
                try {
                    await window.loadData();
                    if (typeof window.renderPage === 'function') {await window.renderPage();}
                } catch (e) {
                    console.warn('[realtime] SALE_POSTED refresh failed:', e);
                } finally {
                    isSyncing = false;
                }
            }, 150);
        }
    } catch (_) { /* لا تعطل قناة التتبع أبدًا */ }
    if (typeof window.console !== 'undefined' && window.console.debug) {
        window.console.debug('[rt] domain_event', env?.eventType, `#${env?.sequence}`);
    }
}

function initSocket() {
    const deviceName = getDeviceName();

    socket = io(window.location.origin, {
        query: { deviceName },
        auth: window._jwt ? { token: window._jwt } : {},
        transports: ['websocket', 'polling'],
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
        timeout: 10000,
    });

    // ── Connected ──
    socket.on('connect', () => {
        reconnectAttempts = 0;
        AudioEngine.playConnect();
        setBadgeState('connected', `متصل · ${deviceName.split(' (')[0]}`);
        console.log('%c<i class=ji data-i=zap></i> Real-time: Connected', 'color:#2ecc71;font-weight:bold');
        try { if (typeof hookChatSocket === 'function') {hookChatSocket();} } catch (_) {}
        // Re-register identity on EVERY (re)connect — rooms are per-connection and
        // die with it; without this, chat/notifications silently stop after any
        // reconnect until a full page reload.
        try { if (typeof window._rtRegisterUser === 'function') {window._rtRegisterUser();} } catch (_) {}
        // Durable resume: catch up the outbox gap, then ACK (shadow, non-blocking).
        try { rtResume(); } catch (_) {}
        // EXE compat probe (warn-only).
        try { rtCheckVersion(); } catch (_) {}
        // Durable subscription (shadow phase — track + ACK only).
        try { socket.off('domain_event', rtOnDomainEvent); } catch (_) {}
        try { socket.on('domain_event', rtOnDomainEvent); } catch (_) {}

        // Start ping
        if (pingInterval) {clearInterval(pingInterval);}
        pingInterval = setInterval(() => {
            lastPing = Date.now();
            socket.emit('ping_check', { t: lastPing });
        }, 5000);
    });

    // ── Pong (latency) ──
    socket.on('pong_check', (data) => {
        if (lastPing) {
            const latency = Date.now() - lastPing;
            const el = document.getElementById('rt-latency');
            if (el) {
                const cls = latency < 30 ? 'rt-latency-ok' : latency < 100 ? 'rt-latency-warn' : 'rt-latency-bad';
                el.innerHTML = `Ping: <span class="${cls}">${latency}ms</span>`;
            }
        }
    });

    // ── Disconnected ──
    socket.on('disconnect', (reason) => {
        if (pingInterval) {clearInterval(pingInterval);}
        AudioEngine.playDisconnect();
        setBadgeState('', 'انقطع الاتصال');
        showSyncToast('انقطع اتصال الشبكة', '<i class=ji data-i=dot-red></i>', 5000);
    });

    // ── Reconnecting ──
    socket.on('reconnect_attempt', (n) => {
        reconnectAttempts = n;
        // Refresh handshake JWT (rotates every 24h; stale token → anonymous fallback).
        try { if (window._jwt) {socket.auth = { token: window._jwt };} } catch (_) {}
        setBadgeState('syncing', `إعادة الاتصال (${n})...`);
    });

    // ── Reconnect failed ──
    socket.on('reconnect_failed', () => {
        setBadgeState('', 'فشل الاتصال');
        AudioEngine.playError();
        showSyncToast('تعذّر الاتصال بالخادم', '<i class=ji data-i=circle-x></i>', 8000);
    });

    // ── Clients list (received on connect) ──
    socket.on('clients_list', (clients) => {
        connectedClientCount = Array.isArray(clients) ? clients.length : 0;
        updateDevicesList(clients);
        setBadgeState('connected', `متصل · ${connectedClientCount} جهاز`);
    });

    // ── Device connected ──
    socket.on('device_connected', (data) => {
        connectedClientCount = data.totalClients || 0;
        updateDevicesList(data.clients || []);
        setBadgeState('connected', `${connectedClientCount} جهاز متصل`);

        // Don't notify about our own connection (first join)
        if (data.totalClients > 1) {
            AudioEngine.playConnect();
            if (rtNotifAdmin() && window.toast) {
                toast(`انضم: ${data.deviceName}`, 'success');
            }
            showSyncToast(`انضم ${data.deviceName} إلى الشبكة`, '<i class=ji data-i=dot-green></i>', 3000);
        }
    });

    // ── Device disconnected ──
    socket.on('device_disconnected', (data) => {
        connectedClientCount = data.totalClients || 0;
        updateDevicesList(data.clients || []);
        setBadgeState('connected', `${connectedClientCount} جهاز متصل`);
        AudioEngine.playDisconnect();
        if (rtNotifAdmin() && window.toast) {
            toast(`غادر: ${data.deviceName}`, 'warning');
        }
        showSyncToast(`غادر ${data.deviceName} الشبكة`, '<i class=ji data-i=dot-red></i>', 3000);
    });

    // ── State updated by another device ──
    socket.on('state_updated', async (data) => {
        if (isSyncing) {return;}
        isSyncing = true;
        try {
            setBadgeState('syncing', 'جارٍ التزامن...');
            AudioEngine.playSync();
            showSyncToast(`تحديث من ${data.updatedBy || 'جهاز آخر'}`, '<i class=ji data-i=refresh></i>', 4000);
            await loadData();
            // Re-render the UI if the main app has loaded
            if (typeof window.renderPage === 'function') {
                try { await window.renderPage(); } catch (e) {}
            }
            setBadgeState('connected', connectedClientCount > 0 ? `${connectedClientCount} جهاز متصل` : 'متصل');
            if (rtNotifAdmin() && window.toast) {
                toast(`تم التزامن مع ${data.updatedBy || 'جهاز آخر'}`, 'success');
            }
        } catch(e) {
            console.error('Sync failed:', e);
            setBadgeState('connected', 'متصل');
        } finally {
            isSyncing = false;
        }
    });

    // ── POS sale completed (heard immediately in Revenues, anywhere) ──
    socket.on('sale:completed', (data) => {
        AudioEngine.playSale();
        const amount = (Number(data.total) || 0).toFixed(2);
        const CUR = (window.STATE && window.STATE.settings && window.STATE.settings.currency) || 'SAR';
        const deptLabel = data.department_name ? ` — ${data.department_name}` : '';
        showSyncToast(`عملية بيع جديدة${deptLabel}: ${amount} ${CUR}`, '<i class=ji data-i=banknote></i>', 5000);
        if (rtNotifAdmin() && window.toast) {
            toast(`عملية بيع جديدة${deptLabel}: ${amount} ${CUR} بواسطة ${data.cashier_name || 'الكاشير'}`, 'success');
        }
        // Refresh department cards and revenue reports from PostgreSQL immediately.
        // state_updated remains the broad fallback for other screens/devices.
        if (typeof window.loadData === 'function') {
            clearTimeout(window.__posSaleRefreshTimer);
            window.__posSaleRefreshTimer = setTimeout(async () => {
                if (isSyncing) {return;}
                isSyncing = true;
                try {
                    await window.loadData();
                    if (typeof window.renderPage === 'function') {await window.renderPage();}
                } catch (e) {
                    console.warn('[realtime] POS sale refresh failed:', e);
                } finally {
                    isSyncing = false;
                }
            }, 150);
        }
    });

    // ── Yarasoft revenue posted (مبيعات الكاشيرات تسمع في أقسامها مباشرة) ──
    socket.on('yarasoft:imported', (data) => {
        try {
            AudioEngine.playSale();
            const label = data && data.source ? ` — ${data.source}` : '';
            showSyncToast(`إيراد يارا سوفت جديد${label}: ${(Number(data.total) || 0).toFixed(2)}`, '<i class=ji data-i=banknote></i>', 5000);
            if (rtNotifAdmin() && window.toast) {toast(`فاتورة ${data.invoiceNumber || ''} سُجّلت في ${data.source || 'قسمها'}`, 'success');}
        } catch (e) {}
        if (typeof window.loadData === 'function') {
            clearTimeout(window.__ysImportRefreshTimer);
            window.__ysImportRefreshTimer = setTimeout(async () => {
                if (isSyncing) {return;}
                isSyncing = true;
                try {
                    await window.loadData();
                    if (typeof window.renderPage === 'function') {await window.renderPage();}
                } catch (e) {
                    console.warn('[realtime] YS import refresh failed:', e);
                } finally {
                    isSyncing = false;
                }
            }, 300);
        }
    });
    socket.on('yarasoft:needs-mapping', (data) => {
        if (rtNotifAdmin() && window.toast) {
            toast(`قسم جديد في يارا سوفت يحتاج اعتماد: ${data.section || ''}`, 'warning');
        }
    });
    socket.on('yarasoft:oracle-sync', (data) => {
        if (!data) {return;}
        if (rtNotifAdmin() && window.toast && ((data.posted || 0) > 0 || (data.needsMapping || 0) > 0)) {
            toast(`مزامنة يارا سوفت: ${data.posted || 0} فاتورة مرحلة${(data.needsMapping || 0) ? ` — ${data.needsMapping} بانتظار قسم` : ''}`, 'info');
        }
        if ((data.posted || 0) > 0 && typeof window.loadData === 'function') {
            clearTimeout(window.__ysImportRefreshTimer);
            window.__ysImportRefreshTimer = setTimeout(async () => {
                try {
                    await window.loadData();
                    if (typeof window.renderPage === 'function') {await window.renderPage();}
                } catch (e) {}
            }, 300);
        }
    });

    // ── Biometric punch (ZKTeco داخل النظام — بصمة حية) ──
    socket.on('biometric:punch', (data) => {
        try {
            AudioEngine.playNotification();
            const who = data && data.employeeName ? data.employeeName : ('رقم ' + (data && data.deviceUserId || '؟'));
            const what = data && data.action === 'check_in' ? 'حضور' : data && data.action === 'check_out' ? 'انصراف' : 'بصمة';
            if (data && data.action) {
                showSyncToast(`${what} جديد — ${who}`, '<i class=ji data-i=user-check></i>', 4500);
            }
        } catch (e) { /* لا تعطل الواجهة */ }
        // منطق العرض المخصص (بوابة الموظف / صفحة البصمة) في app.js
        if (typeof window.zkPortalPunchHandler === 'function') {
            try { window.zkPortalPunchHandler(data || {}); } catch (e) { /* تجاهل */ }
        }
    });
    socket.on('biometric:synced', (data) => {
        if (typeof window.zkPortalPunchHandler === 'function') {
            try { window.zkPortalPunchHandler({ summary: true, ...(data || {}) }); } catch (e) { /* تجاهل */ }
        }
    });
    socket.on('biometric:unmapped', () => {
        // بصمة لرقم غير مرتبط بموظف — تنبيه على الشاشة لمدير النظام فقط
        if (rtNotifAdmin() && window.toast) {
            toast('بصمة جديدة من رقم غير مرتبط بموظف — راجع شاشة ربط الموظفين', 'warning');
        }
    });

    // ── Entity changed (real-time CRUD) ──
    socket.on('entity_changed', (data) => {
        AudioEngine.playNotification();
        const actionText = data.action === 'create' ? 'إضافة' : data.action === 'update' ? 'تحديث' : 'حذف';
        showSyncToast(`${actionText} في ${data.entityName} — ${data.changedBy}`, '<i class=ji data-i=file-text></i>', 3500);

        // Show a toast if available
        if (rtNotifAdmin() && window.toast) {
            toast(`${actionText} في ${data.entityName}`, 'info');
        }

        // ─── Real-time STATE sync ───────────────────────────────────
        // When another device creates/updates/deletes an entity, update
        // the local STATE immediately so the UI stays in sync without a
        // full page reload. This maps the backend entity name to the
        // frontend STATE key (same names: camelCase convention).
        const entity = data.entity;
        const row = data.data;
        // Procurement center: full refresh (computed balances live server-side)
        if (entity === 'procurement' && typeof window.refreshProcurementData === 'function') {
            try { window.refreshProcurementData(); } catch (e) { /* non-critical */ }
            return;
        }
        if (!entity || !window.STATE || !window.STATE[entity]) {return;}
        const arr = window.STATE[entity];
        if (!Array.isArray(arr)) {return;}

        try {
            if (data.action === 'create' && row) {
                // Avoid duplicates — replace if same id exists, otherwise push
                const idx = arr.findIndex(x => x.id === row.id);
                if (idx >= 0) { arr[idx] = row; }
                else { arr.push(row); }
            } else if (data.action === 'update' && row) {
                const idx = arr.findIndex(x => x.id === row.id);
                if (idx >= 0) { Object.assign(arr[idx], row); }
            } else if (data.action === 'delete' && row) {
                const id = row.id;
                const idx = arr.findIndex(x => x.id === id);
                if (idx >= 0) { arr.splice(idx, 1); }
            }

            // Re-render UI if available (debounced: only for visible pages)
            if (typeof window.renderPage === 'function') {
                try { window.renderPage(); } catch (e) { /* non-critical */ }
            }
            if (typeof window.buildNav === 'function') {
                try { window.buildNav(); } catch (e) {}
            }
        } catch (e) {
            console.warn('[realtime] entity_changed sync failed:', e.message);
        }
    });

    // ── Incoming notification from another device ──
    socket.on('incoming_notification', (data) => {
        AudioEngine.playNotification();
        if (!rtNotifAdmin()) {return;}
        const message = window.cleanNotificationText ? window.cleanNotificationText(data?.message, 320) : String(data?.message || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 320);
        if (window.toast) {
            toast(`${data.from}: ${message}`, data.type || 'info');
        }
        showSyncToast(`${data.from}: ${message}`, '<i class=ji data-i=message></i>', 5000);
    });

    // Expose socket globally
    window._rtSocket = socket;
}

// ── Override fetch to send device headers + JWT Authorization ──
const _origFetch = window.fetch;
window.fetch = function(url, options = {}) {
    if (typeof url === 'string' && url.includes('/api/')) {
        options.headers = options.headers || {};
        // <i class=ji data-i=alert-triangle></i> SECURITY: attach JWT bearer token to every /api/* request
        // (skips /api/auth/login which doesn't need auth)
        if (window._jwt && !url.includes('/api/auth/login')) {
            options.headers['Authorization'] = `Bearer ${window._jwt}`;
        }
        if (socket && socket.connected) {
            options.headers['x-socket-id'] = socket.id || '';
        }
        // لاتيني فقط: المتصفح يرفض الترويسات غير Latin-1 (خطأ ISO-8859-1)
        // — أسماء الأجهزة المجهولة قد تحوي عربيًا
        try {
            const dn = getDeviceName();
            options.headers['x-device-name'] = /^[ -~]*$/.test(dn) ? dn : 'Unknown device';
        } catch (_) {}
    }
    return _origFetch.call(window, url, options);
};

// ── Database Health Lamp ──
// Independent of the socket connection: pings /api/health, which itself
// runs `SELECT NOW() ...` against PostgreSQL, so this lamp truly reflects
// whether the database is reachable — not just whether the server process
// is up. Polls every 5s; on tab focus/visibility change it also re-checks.
let dbCheckInFlight = false;
async function checkDbHealth() {
    if (dbCheckInFlight) {return;}
    dbCheckInFlight = true;
    const dot = document.getElementById('db-dot');
    if (dot && !dot.className) {dot.className = 'checking';}
    try {
        const base = window.API_BASE || (window.location.origin + '/api');
        const res = await _origFetch.call(window, base + '/health', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        const dbStatus = data?.checks?.database?.status || data?.components?.find((item) => item.component === 'database')?.status;
        const dbOk = ['ok', 'healthy', 'up', 'connected'].includes(String(dbStatus).toLowerCase());
        if (dot) {
            dot.className = dbOk ? 'healthy' : 'down';
            const latency = data?.checks?.database?.latency || data?.components?.find((item) => item.component === 'database')?.durationMs || '';
            dot.title = dbOk
                ? `قاعدة البيانات متصلة (${latency}ms)`
                : 'قاعدة البيانات غير متصلة — تحقق من خدمة PostgreSQL';
        }
        if (!dbOk) {
            showSyncToast('<i class=ji data-i=alert-triangle></i> قاعدة البيانات غير متصلة', '<i class=ji data-i=dot-red></i>', 4000);
        }
    } catch (e) {
        if (dot) {
            dot.className = 'down';
            dot.title = 'تعذر الوصول إلى الخادم أو قاعدة البيانات';
        }
    } finally {
        dbCheckInFlight = false;
    }
}

// ── Init on DOM ready ──
let realtimeStarted = false;
function startRealtime() {
    if (realtimeStarted) {return;}
    realtimeStarted = true;
    AudioEngine.init();
    buildUI();
    initSocket();

    checkDbHealth();
    setInterval(checkDbHealth, 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {checkDbHealth();}
    });

    // Unlock audio on first interaction
    document.addEventListener('click', () => {
        if (AudioEngine.ctx && AudioEngine.ctx.state === 'suspended') {
            AudioEngine.ctx.resume();
        }
    }, { once: true });

    // Expose broadcast function globally
    window.rtBroadcast = function(message, type = 'info') {
        if (window._rtSocket && window._rtSocket.connected) {
            window._rtSocket.emit('broadcast_notification', { message, type });
        }
    };

    // ── Task 20: تسجيل هوية المستخدم على غرف الإشعارات ──
    // الصلاحيات تُقرأ من قاعدة البيانات في الخادم؛ العميل يرسل هوية فقط.
    window._rtRegisterUser = function() {
        try {
            const userId = Number(window.STATE?.currentUser?.id);
            if (socket && socket.connected && Number.isInteger(userId) && userId > 0) {
                socket.emit('register_user', { userId });
            }
        } catch (e) { /* non-fatal */ }
    };
    window._rtRegisterUser();

    // ── Task 20: إشعار فوري موجّه — جرس + صوت + توست فوري دون تحديث الصفحة ──
    socket.on('notification', (data) => {
        AudioEngine.playNotification();
        if (!rtNotifAdmin()) {return;}
        const payload = data && typeof data === 'object' ? data : {};
        const title = window.cleanNotificationText ? window.cleanNotificationText(payload.title || 'إشعار جديد', 120) : String(payload.title || 'إشعار جديد').replace(/<[^>]*>/g, ' ').trim().slice(0, 120);
        const message = window.cleanNotificationText ? window.cleanNotificationText(payload.message || title, 320) : String(payload.message || title).replace(/<[^>]*>/g, ' ').trim().slice(0, 320);
        if (window.toast) {
            toast(message, payload.type || 'info');
        }
        showSyncToast(title, '<i class=ji data-i=bell></i>', 5000);
        try {
            if (window.STATE && Array.isArray(window.STATE.notifications)) {
                window.STATE.notifications.unshift({
                    id: payload.id || `rt-${Date.now()}`,
                    title,
                    message,
                    type: payload.type || 'info',
                    date: payload.date || new Date().toISOString(),
                    read: false,
                    entity: payload.entity || null,
                    entity_id: payload.entity_id || null,
                    link: payload.link || null,
                });
                if (window.STATE.notifications.length > 50) {window.STATE.notifications = window.STATE.notifications.slice(0, 50);}
                if (typeof window.updateNotificationBadge === 'function') {window.updateNotificationBadge();}
            }
        } catch (e) { console.warn('[realtime] notification merge failed:', e.message); }
    });
}

function init() {
    // Authentication starts realtime after the application shell is visible.
    window._rtStart = startRealtime;
    if (window.STATE?.currentUser) {startRealtime();}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Expose AudioEngine globally for chat sounds etc. (inside IIFE: const is scoped here)
window.AudioEngine = AudioEngine;

})(); // end IIFE
