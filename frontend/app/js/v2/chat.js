/**
 * V2 — Staff chat (الشات الداخلي) · mirrors legacy app.js:332-466
 * ═══════════════════════════════════════════════════════════════════════
 * Same shape as the legacy FAB: employee picker (private 1-1, never a
 * public room), pair-only history, send, unread badge, and the admin-only
 * toast. The legacy file is not imported and not modified — this module
 * reads the same three server doors through data/chat-repo.js and uses
 * socket.io (realtime.js) for the `chat:new` push.
 *
 * WRITE FLAG: `?v2chat=1` | localStorage `karim_v2_chat=1`; absent = OFF.
 * Sending stores a row in `internal_chat` (server-owned, 7-day prune), so
 * the whole widget stays behind the flag. It is hidden whenever the V2
 * session is not live; it never fabricates a local session.
 */

import { fetchChatUsers, fetchChatHistory, sendChatMessage, CHAT_MAX_BODY } from './data/chat-repo.js?v=4.9.152';
import { ensureRealtimeSocket, closeRealtimeSocket } from './realtime.js?v=4.9.152';
import { chatWriteEnabled } from './write-flags.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function currentLang() {
    try {return localStorage.getItem('karim_lang') || 'ar';}
    catch {return 'ar';}
}

function fDT(value) {
    if (!value) {return '';}
    try {
        return new Date(value).toLocaleString(
            currentLang() === 'en' ? 'en-US' : 'ar-EG',
            {dateStyle: 'short', timeStyle: 'short'},
        );
    } catch {return String(value);}
}

/**
 * @param {{
 *   isLive:()=>boolean, getUserId:()=>number|string|null,
 *   onToast?:(m:string)=>void
 * }} ctx
 * @returns {{refresh:()=>void, destroy:()=>void}}
 */
export function mountChat(ctx = {}) {
    if (!chatWriteEnabled()) {
        return {refresh() { /* flag OFF */ }, destroy() { /* flag OFF */ }};
    }

    const isLive = typeof ctx.isLive === 'function' ? ctx.isLive : () => false;
    const getUserId = typeof ctx.getUserId === 'function' ? ctx.getUserId : () => null;
    const toast = typeof ctx.onToast === 'function' ? ctx.onToast : (m) => console.info('[V2 chat]', m);

    const st = {
        open: false,
        peer: null,
        users: null,
        messages: [],
        unread: 0,
        busy: false,
        socket: null,
    };

    const host = document.createElement('div');
    host.className = 'erp-v2 erp-chat-host';
    host.innerHTML = `
<button type="button" class="erp-chat-fab" data-v2-chat-fab aria-label="شات الطاقم" aria-expanded="false">
  <i class="ji" data-i="message" aria-hidden="true"></i>
  <span class="erp-chat-fab__badge" data-v2-chat-badge hidden>0</span>
</button>
<div class="erp-chat-panel" data-v2-chat-panel role="dialog" aria-label="شات الطاقم" hidden>
  <div class="erp-chat-head">
    <strong class="erp-chat-title" data-v2-chat-title><i class="ji" data-i="message" aria-hidden="true"></i> شات الطاقم</strong>
    <span class="erp-chat-head__actions">
      <button type="button" class="erp-btn erp-btn--sm" data-v2-chat-back hidden>الموظفون</button>
      <button type="button" class="erp-btn erp-btn--sm" data-v2-chat-close>إغلاق</button>
    </span>
  </div>
  <div class="erp-chat-box" data-v2-chat-box aria-live="polite"></div>
  <div class="erp-chat-input" data-v2-chat-input hidden>
    <input class="erp-input" type="text" maxlength="${CHAT_MAX_BODY}" placeholder="اكتب رسالتك..."
           aria-label="نص الرسالة" data-v2-chat-text>
    <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-chat-send aria-label="إرسال">
      <i class="ji" data-i="send" aria-hidden="true"></i>
    </button>
  </div>
</div>`;
    document.body.appendChild(host);

    const fab = host.querySelector('[data-v2-chat-fab]');
    const panel = host.querySelector('[data-v2-chat-panel]');
    const box = host.querySelector('[data-v2-chat-box]');
    const inputRow = host.querySelector('[data-v2-chat-input]');
    const textInput = host.querySelector('[data-v2-chat-text]');
    const title = host.querySelector('[data-v2-chat-title]');
    const backBtn = host.querySelector('[data-v2-chat-back]');

    function paintBadge() {
        const badge = host.querySelector('[data-v2-chat-badge]');
        if (!badge) {return;}
        badge.hidden = st.unread <= 0;
        badge.textContent = st.unread > 99 ? '99+' : String(st.unread);
        fab.setAttribute('aria-label', st.unread > 0 ? `شات الطاقم (${st.unread} جديد)` : 'شات الطاقم');
    }

    function renderMessages() {
        const me = getUserId();
        box.innerHTML = st.messages.map((m) => {
            const mine = String(m.from_user_id) === String(me);
            return `<div class="erp-chat-msg${mine ? ' erp-chat-msg--mine' : ''}">`
                + `<div class="erp-chat-msg__meta">${esc(m.from_name || '—')} · ${esc(fDT(m.created_at))}</div>`
                + `<div class="erp-chat-msg__body">${esc(m.body || '')}</div></div>`;
        }).join('') || '<p class="erp-chat-empty">لا رسائل بعد — ابدأ التحية</p>';
        box.scrollTop = box.scrollHeight;
    }

    function renderUsers() {
        title.innerHTML = '<i class="ji" data-i="message" aria-hidden="true"></i> اختر موظفًا';
        backBtn.hidden = true;
        inputRow.hidden = true;
        const list = st.users;
        if (!list) {
            box.innerHTML = '<p class="erp-chat-empty">جارٍ التحميل…</p>';
            return;
        }
        box.innerHTML = list.length ? list.map((u) => `
<button type="button" class="erp-chat-user" data-v2-chat-peer="${esc(String(u.id))}">
  <span class="erp-chat-user__dot" data-online="${u.online ? '1' : '0'}" aria-hidden="true"></span>
  <span class="erp-chat-user__body">
    <span class="erp-chat-user__name">${esc(u.name || u.username || '—')}
      ${u.online ? '<span class="erp-badge" data-tone="success">متصل</span>' : '<span class="erp-text-sm erp-text-muted">غير متصل</span>'}</span>
    <span class="erp-chat-user__meta">${esc(u.role || '')} · ${esc(u.username || '')}</span>
  </span>
</button>`).join('') : '<p class="erp-chat-empty">لا موظفين آخرين</p>';
    }

    async function loadUsers() {
        st.users = null;
        renderUsers();
        try {
            st.users = await fetchChatUsers();
        } catch (e) {
            st.users = [];
            box.innerHTML = `<p class="erp-chat-empty">تعذر تحميل موظفي الشات — ${esc((e && e.message) || 'تحقق من الاتصال')}</p>`;
            return;
        }
        renderUsers();
    }

    async function pickPeer(id) {
        st.peer = String(id);
        st.messages = [];
        const user = (st.users || []).find((u) => String(u.id) === String(id));
        title.innerHTML = `<span>${esc(user ? (user.name || user.username) : `موظف ${id}`)}</span>`
            + (user && user.online ? ' <span class="erp-badge" data-tone="success">متصل</span>' : '');
        backBtn.hidden = false;
        inputRow.hidden = false;
        box.innerHTML = '<p class="erp-chat-empty">جارٍ التحميل…</p>';
        try {
            st.messages = await fetchChatHistory(id);
        } catch (e) {
            st.messages = [];
            toast((e && e.message) || 'تعذر تحميل السجل');
        }
        renderMessages();
        setTimeout(() => {try {textInput.focus();} catch (_) { /* detached */ }}, 60);
    }

    function backToUsers() {
        st.peer = null;
        st.messages = [];
        loadUsers();
    }

    let audioCtx = null;
    function primeAudio() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {return;}
            if (!audioCtx) {audioCtx = new Ctx();}
            if (audioCtx.state === 'suspended') {audioCtx.resume().catch(() => {});}
        } catch (_) { /* audio is optional */ }
    }

    function playChime() {
        if (!audioCtx) {return;}
        try {
            const notes = [
                {freq: 880, gain: 0.12, dur: 0.35},
                {freq: 1108.73, gain: 0.06, dur: 0.45},
                {freq: 1318.51, gain: 0.04, dur: 0.5},
            ];
            const now = audioCtx.currentTime;
            notes.forEach((n) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = n.freq;
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(n.gain, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + n.dur);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + n.dur);
            });
        } catch (_) { /* audio is optional */ }
    }

    function onNew(message) {
        if (!message || !message.id) {return;}
        const me = String(getUserId() || '');
        const involves = String(message.from_user_id) === me || String(message.to_user_id) === me;
        if (!involves) {return;}
        const peer = st.peer;
        const forThisPeer = st.open && peer
            && (String(message.from_user_id) === String(peer) || String(message.to_user_id) === String(peer));
        if (forThisPeer) {
            if (st.messages.some((x) => String(x.id) === String(message.id))) {return;}
            st.messages.push(message);
            if (st.messages.length > 100) {st.messages = st.messages.slice(-100);}
            renderMessages();
            return;
        }
        st.unread += 1;
        paintBadge();
        if (String((window.STATE && window.STATE.currentUser && window.STATE.currentUser.role) || '') === 'admin') {
            toast(`${message.from_name || 'موظف'}: ${String(message.body || '').slice(0, 80)}`);
        }
        playChime();
    }

    async function hookSocket() {
        if (st.socket) {return;}
        const socket = await ensureRealtimeSocket();
        if (!socket) {return;}
        st.socket = socket;
        socket.on('chat:new', onNew);
    }

    async function openPanel() {
        if (!isLive()) {return;}
        st.open = true;
        st.unread = 0;
        paintBadge();
        panel.hidden = false;
        fab.setAttribute('aria-expanded', 'true');
        primeAudio();
        void hookSocket();
        if (st.peer) {await pickPeer(st.peer);}
        else {await loadUsers();}
    }

    function closePanel() {
        st.open = false;
        panel.hidden = true;
        fab.setAttribute('aria-expanded', 'false');
    }

    async function send() {
        if (!st.peer || st.busy) {return;}
        const body = String(textInput.value || '').trim();
        if (!body) {return;}
        st.busy = true;
        textInput.value = '';
        try {
            const message = await sendChatMessage(body, st.peer);
            if (message) {onNew(message);}
            renderMessages();
        } catch (e) {
            textInput.value = body;
            toast((e && e.message) || 'تعذر الإرسال');
        } finally {
            st.busy = false;
            try {textInput.focus();} catch (_) { /* detached */ }
        }
    }

    host.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-chat-fab]')) {
            if (st.open) {closePanel();} else {void openPanel();}
            return;
        }
        if (event.target.closest('[data-v2-chat-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-chat-back]')) {backToUsers(); return;}
        if (event.target.closest('[data-v2-chat-send]')) {void send(); return;}
        const peerBtn = event.target.closest('[data-v2-chat-peer]');
        if (peerBtn) {void pickPeer(peerBtn.dataset.v2ChatPeer); return;}
    });

    textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send();
        }
    });

    function refresh() {
        if (!isLive()) {
            closePanel();
            st.peer = null;
            st.users = null;
            st.messages = [];
            st.unread = 0;
            paintBadge();
            fab.hidden = true;
            if (st.socket) {
                try {st.socket.off('chat:new', onNew);} catch (_) { /* detached */ }
                st.socket = null;
                closeRealtimeSocket();
            }
            return;
        }
        fab.hidden = false;
        void hookSocket();
    }

    refresh();

    return {
        refresh,
        destroy() {
            if (st.socket) {
                try {st.socket.off('chat:new', onNew);} catch (_) { /* detached */ }
                closeRealtimeSocket();
            }
            try {audioCtx && audioCtx.close();} catch (_) { /* already closed */ }
            host.remove();
        },
    };
}
