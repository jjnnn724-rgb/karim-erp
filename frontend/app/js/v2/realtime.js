/**
 * V2 — Socket.IO push with durable event recovery when sockets are unavailable.
 * The server remains authoritative; recovered events are dispatched to screens
 * and acknowledged only after they have been synchronously handed to listeners.
 */

const SOCKET_SCRIPT = '/socket.io/socket.io.js';
const RECOVERY_MS = 15_000;
const RT_API_CONTRACT = 1;
const RT_SEQ_KEY = 'karim_v2_rt_seq';
const RT_INSTALL_KEY = 'karim_v2_rt_install';

let socket = null;
let attachedSocket = null;
let pending = null;
let owned = false;
let recoveryTimer = null;
let ackTimer = null;
let recovering = false;
let lastRecoveryError = '';
let lastSequence = 0;
let acknowledgedSequence = 0;
let installationId = '';

try {
    lastSequence = Number(window.localStorage.getItem(RT_SEQ_KEY) || 0) || 0;
    installationId = window.localStorage.getItem(RT_INSTALL_KEY) || '';
    if (!installationId) {
        const random = window.crypto?.getRandomValues
            ? Array.from(window.crypto.getRandomValues(new Uint32Array(4))).join('-')
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        installationId = `v2-${Date.now().toString(36)}-${random}`.slice(0, 128);
        window.localStorage.setItem(RT_INSTALL_KEY, installationId);
    }
} catch (error) {
    installationId = `v2-memory-${Date.now().toString(36)}`;
    console.warn('[V2 realtime] local storage unavailable; recovery state is temporary:', error);
}

function persistSequence() {
    try {window.localStorage.setItem(RT_SEQ_KEY, String(lastSequence));}
    catch (error) {console.warn('[V2 realtime] could not persist recovery sequence:', error);}
}

function rtHeaders() {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (window._appKey) {headers['x-api-key'] = window._appKey;}
    return headers;
}

function dispatchDomainEvent(event) {
    window.dispatchEvent(new CustomEvent('v2:domain-event', { detail: event }));
}

function scheduleAck() {
    if (ackTimer) {return;}
    ackTimer = setTimeout(async () => {
        ackTimer = null;
        if (!window._jwt || !installationId) {return;}
        const sentSequence = lastSequence;
        try {
            const response = await fetch(`${window.location.origin}/api/rt/ack`, {
                method: 'POST',
                headers: rtHeaders(),
                body: JSON.stringify({ installationId, lastSequence: sentSequence }),
            });
            if (!response.ok) {throw new Error(`ACK_FAILED_${response.status}`);}
            acknowledgedSequence = Math.max(acknowledgedSequence, sentSequence);
            if (lastSequence > acknowledgedSequence) {scheduleAck();}
        } catch (error) {
            console.warn('[V2 realtime] event acknowledgement failed:', error);
        }
    }, 1000);
}

function acceptDomainEvent(event) {
    if (!event || typeof event !== 'object') {return;}
    const sequence = Number(event.sequence);
    if (!Number.isFinite(sequence) || sequence <= lastSequence) {return;}
    dispatchDomainEvent(event);
    lastSequence = sequence;
    persistSequence();
    scheduleAck();
}

async function resumeEvents() {
    if (recovering || !window._jwt) {return;}
    recovering = true;
    try {
        const response = await fetch(
            `${window.location.origin}/api/rt/events?since=${lastSequence}&limit=200`,
            { headers: rtHeaders(), cache: 'no-store' },
        );
        if (!response.ok) {throw new Error(`EVENT_RECOVERY_FAILED_${response.status}`);}
        const result = await response.json();
        if (!result || !Array.isArray(result.events)) {
            throw new Error('EVENT_RECOVERY_INVALID_RESPONSE');
        }

        if (result.resyncRequired === true) {
            window.dispatchEvent(new CustomEvent('v2:realtime-resync', {
                detail: { currentSequence: Number(result.currentSequence) || 0 },
            }));
            if (Number.isFinite(Number(result.currentSequence))) {
                lastSequence = Math.max(lastSequence, Number(result.currentSequence));
                persistSequence();
                scheduleAck();
            }
        } else {
            result.events.forEach(acceptDomainEvent);
            const deliveredUpTo = Number(result.deliveredUpTo);
            if (Number.isFinite(deliveredUpTo) && deliveredUpTo > lastSequence) {
                lastSequence = deliveredUpTo;
                persistSequence();
                scheduleAck();
            }
        }
        if (lastRecoveryError) {
            console.info('[V2 realtime] durable event recovery resumed');
            lastRecoveryError = '';
        }
        if (lastSequence > acknowledgedSequence) {scheduleAck();}
    } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (message !== lastRecoveryError) {
            console.warn('[V2 realtime] durable event recovery failed:', error);
            lastRecoveryError = message;
        }
    } finally {
        recovering = false;
    }
}

function startRecoveryPolling() {
    if (recoveryTimer || !window._jwt) {return;}
    void checkServerContract();
    void resumeEvents();
    recoveryTimer = setInterval(() => {
        if (document.hidden || !window._jwt) {return;}
        void resumeEvents();
    }, RECOVERY_MS);
}

function stopRecoveryPolling() {
    if (recoveryTimer) {clearInterval(recoveryTimer); recoveryTimer = null;}
}

function checkServerContract() {
    return fetch(`${window.location.origin}/api/rt/version?clientContract=${RT_API_CONTRACT}`, {
        cache: 'no-store',
    }).then(async (response) => {
        if (!response.ok) {throw new Error(`RT_VERSION_FAILED_${response.status}`);}
        const version = await response.json();
        if (version && version.compatible === false) {
            window.dispatchEvent(new CustomEvent('v2:realtime-version', { detail: version }));
        }
    }).catch((error) => {
        console.warn('[V2 realtime] server contract check failed:', error);
    });
}

function onSocketConnect() {
    stopRecoveryPolling();
    const s = socket;
    try {s.emit('register_user');}
    catch (error) {console.warn('[V2 realtime] user registration failed:', error);}
    void resumeEvents();
    void checkServerContract();
}

function onSocketUnavailable() {
    startRecoveryPolling();
}

function attachSocket(nextSocket) {
    if (attachedSocket === nextSocket) {return;}
    if (attachedSocket) {
        attachedSocket.off('connect', onSocketConnect);
        attachedSocket.off('disconnect', onSocketUnavailable);
        attachedSocket.off('connect_error', onSocketUnavailable);
        attachedSocket.off('domain_event', acceptDomainEvent);
    }
    attachedSocket = nextSocket;
    nextSocket.on('connect', onSocketConnect);
    nextSocket.on('disconnect', onSocketUnavailable);
    nextSocket.on('connect_error', onSocketUnavailable);
    nextSocket.on('domain_event', acceptDomainEvent);
    if (nextSocket.connected) {onSocketConnect();}
    else {onSocketUnavailable();}
}

function loadSocketIo() {
    if (typeof window.io === 'function') {return Promise.resolve(window.io);}
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-v2-socketio]');
        if (existing) {
            if (typeof window.io === 'function') {resolve(window.io); return;}
            if (existing.dataset.v2SocketioError === '1') {
                reject(new Error('SOCKET_IO_LOAD_FAILED'));
                return;
            }
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
        script.onerror = () => {
            script.dataset.v2SocketioError = '1';
            reject(new Error('SOCKET_IO_LOAD_FAILED'));
        };
        document.head.appendChild(script);
    });
}

/** @returns {Promise<any|null>} a connected-or-connecting socket, or null without a session. */
export async function ensureRealtimeSocket() {
    if (!window._jwt) {return null;}
    if (window._rtSocket) {
        attachSocket(window._rtSocket);
        return window._rtSocket;
    }
    if (socket) {
        attachSocket(socket);
        return socket;
    }
    if (!pending) {
        pending = (async () => {
            try {
                const io = await loadSocketIo();
                const nextSocket = io({
                    auth: { token: window._jwt },
                    transports: ['websocket', 'polling'],
                    reconnectionAttempts: Infinity,
                    reconnectionDelay: 1500,
                    reconnectionDelayMax: 30000,
                    timeout: 10000,
                });
                socket = nextSocket;
                owned = true;
                window._rtSocket = nextSocket;
                attachSocket(nextSocket);
                return nextSocket;
            } catch (error) {
                console.warn('[V2 realtime] socket unavailable; using durable polling:', error);
                startRecoveryPolling();
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
    stopRecoveryPolling();
    if (ackTimer) {clearTimeout(ackTimer); ackTimer = null;}
    if (attachedSocket) {
        attachedSocket.off('connect', onSocketConnect);
        attachedSocket.off('disconnect', onSocketUnavailable);
        attachedSocket.off('connect_error', onSocketUnavailable);
        attachedSocket.off('domain_event', acceptDomainEvent);
        attachedSocket = null;
    }
    if (!owned || !socket) {return;}
    try {socket.close();}
    catch (error) {console.warn('[V2 realtime] socket close failed:', error);}
    if (window._rtSocket === socket) {
        try {delete window._rtSocket;}
        catch (error) {
            console.warn('[V2 realtime] could not clear the shared socket reference:', error);
            window._rtSocket = null;
        }
    }
    socket = null;
    owned = false;
}
