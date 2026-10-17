/**
 * V2 — Realtime bridge (socket.io) for chat/notification push
 * ═══════════════════════════════════════════════════════════════════════
 * v2.html does not load legacy realtime.js, so `window._rtSocket` never
 * exists there. This module is the smallest equivalent: reuse the legacy
 * socket when the page has one, otherwise load the same `/socket.io/
 * socket.io.js` the server serves and authenticate with the SAME handshake
 * contract (auth.token — backend/realtime/guard.js:23), then register on
 * every connect so `user:<id>` rooms survive reconnects.
 *
 * It opens NOTHING without a live JWT: the caller (chat) only reaches here
 * after the V2 session is ready. Failures are swallowed — polling/history
 * still work, push is an accelerator, never a requirement.
 */

const SOCKET_SCRIPT = '/socket.io/socket.io.js';

let socket = null;
let pending = null;
let owned = false;

function loadSocketIo() {
    if (typeof window.io === 'function') {return Promise.resolve(window.io);}
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-v2-socketio]');
        if (existing) {
            if (typeof window.io === 'function') {resolve(window.io); return;}
            existing.addEventListener('load', () => resolve(window.io));
            existing.addEventListener('error', () => reject(new Error('SOCKET_IO_LOAD_FAILED')));
            return;
        }
        const script = document.createElement('script');
        script.src = SOCKET_SCRIPT;
        script.async = true;
        script.dataset.v2Socketio = '1';
        script.onload = () => (typeof window.io === 'function'
            ? resolve(window.io)
            : reject(new Error('SOCKET_IO_UNAVAILABLE')));
        script.onerror = () => reject(new Error('SOCKET_IO_LOAD_FAILED'));
        document.head.appendChild(script);
    });
}

/**
 * @returns {Promise<any|null>} a connected-or-connecting socket, or null
 *   when there is no session / the client script cannot load.
 */
export async function ensureRealtimeSocket() {
    if (window._rtSocket) {return window._rtSocket;}
    if (socket) {return socket;}
    if (!window._jwt) {return null;}
    if (!pending) {
        pending = (async () => {
            try {
                const io = await loadSocketIo();
                const s = io({
                    auth: { token: window._jwt },
                    transports: ['websocket', 'polling'],
                    reconnectionAttempts: Infinity,
                    reconnectionDelay: 1500,
                    reconnectionDelayMax: 30000,
                    timeout: 10000,
                });
                const register = () => {try {s.emit('register_user');} catch (_) { /* not connected yet */ }};
                s.on('connect', register);
                socket = s;
                owned = true;
                window._rtSocket = s;
                return s;
            } catch (_) {
                return null;
            } finally {
                pending = null;
            }
        })();
    }
    return pending;
}

/** Close only a socket this module opened; a legacy socket belongs to its page. */
export function closeRealtimeSocket() {
    if (!owned || !socket) {return;}
    try {socket.close();} catch (_) { /* already closed */ }
    if (window._rtSocket === socket) {
        try {delete window._rtSocket;} catch (_) {window._rtSocket = null;}
    }
    socket = null;
    owned = false;
}
