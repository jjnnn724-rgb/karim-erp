/**
 * V2 — Portrait board boot · تشغيل لوحة المنيو V2 (البند ٨)
 * ═══════════════════════════════════════════════════════════════════════════
 * The only file in this feature that touches the network or storage. Own
 * keys (karim_v2_board_*) — the legacy board keeps its own cache entry
 * untouched, so switching between the two pages never cross-writes.
 *
 * Refresh: one in-flight request, redraw only when the payload fingerprint
 * changes (same rule as legacy), plus socket push when the box can afford it.
 * `?tv=lite` = polling only (default keeps realtime ON for this page).
 */

import {
    POLL_MS, FETCH_TIMEOUT_MS, BOARD_CACHE_KEY, LANGUAGE_KEY,
    DEFAULT_FOOTERS, fingerprint, isCacheFresh, isValidPayload, normalizeLanguage, tickerText,
} from './board-data.js?v=4.9.132';
import { mountPortraitBoard } from './portrait.js?v=4.9.132';

const ENDPOINT = '/api/menu-board/public';
const query = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const refs = {
    board: $('board'),
    stage: $('kbStage'),
    dots: $('kbDots'),
    count: $('kbCount'),
    conn: $('kbConn'),
    clockTime: $('kbTime'),
    clockDate: $('kbDate'),
    title: $('kbTitle'),
    subtitle: $('kbSubtitle'),
    periods: $('kbPeriods'),
    ticker: $('kbTicker'),
    langBtn: $('kbLang'),
};

const THEME = /^(?:cream|noir)$/.test(String(query.get('theme') || '')) ? String(query.get('theme')) : 'cream';
const LITE = query.get('tv') === 'lite';
refs.board.dataset.theme = THEME;

let language = normalizeLanguage(readStorage(LANGUAGE_KEY));
let stamp = null;
let boardRef = null;
let inFlight = false;

function readStorage(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode — preference simply won't stick */ }
}

function setConn(ok) {
    refs.conn.textContent = ok ? (language === 'en' ? '● Live' : '● مباشر') : (language === 'en' ? '● Offline' : '● غير متصل');
    refs.conn.className = 'kb-conn ' + (ok ? 'is-live' : 'is-off');
}

function paintTicker(settings) {
    const text = settings ? tickerText(settings) : DEFAULT_FOOTERS[0];
    refs.ticker.textContent = text;
    const clone = refs.ticker.nextElementSibling;
    if (clone) { clone.textContent = text; }
}

async function fetchBoard() {
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        return await res.json();
    } finally {
        clearTimeout(kill);
    }
}

function apply(payload, { cache = false } = {}) {
    const next = fingerprint(payload);
    if (next === stamp) { return false; }
    stamp = next;
    boardRef = payload;
    paintTicker(payload.settings);
    view.setData(payload);
    if (cache) {
        try { writeStorage(BOARD_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: payload })); } catch { /* quota — offline fallback is a nice-to-have */ }
    }
    return true;
}

async function refresh() {
    if (inFlight) { return; }
    inFlight = true;
    try {
        const data = await fetchBoard();
        if (!isValidPayload(data)) { throw new Error('Invalid menu board response'); }
        apply(data, { cache: true });
        setConn(true);
    } catch {
        setConn(false);
        if (!boardRef) { view.showError(); }
    } finally {
        inFlight = false;
    }
}

function restore() {
    const raw = readStorage(BOARD_CACHE_KEY);
    if (!raw) { return; }
    let cached;
    try { cached = JSON.parse(raw); } catch { return; }
    if (!isCacheFresh(cached)) { return; }
    if (apply(cached.data)) { setConn(false); }
}

function startRealtime() {
    if (LITE) { return; }
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.async = true;
    script.onload = () => {
        try {
            const socket = io({ transports: ['websocket', 'polling'] });
            socket.on('connect', () => { setConn(true); if (!boardRef) { refresh(); } });
            socket.on('disconnect', () => setConn(false));
            socket.on('menu_board_changed', () => refresh());
            socket.on('entity_changed', (p) => { if (p && p.entity === 'posProducts') { refresh(); } });
        } catch { /* socket is an accelerator; polling already covers it */ }
    };
    script.onerror = () => { /* same: polling continues */ };
    document.head.appendChild(script);
}

function paintDay() {
    const d = new Date();
    const arDay = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
    const enDay = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const el = $('kbDay'); const elEn = $('kbDayEn');
    if (el) {el.textContent = arDay;}
    if (elEn) {elEn.textContent = enDay;}
}

function scheduleDailyReload() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(4, 0, 0, 0);
    if (next <= now) { next.setDate(next.getDate() + 1); }
    setTimeout(() => location.reload(), next - now);
}

const view = mountPortraitBoard(refs, { language });

function boot() {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
    refs.langBtn.textContent = language === 'en' ? 'العربية' : 'English';
    refs.langBtn.addEventListener('click', () => {
        language = language === 'en' ? 'ar' : 'en';
        writeStorage(LANGUAGE_KEY, language);
        refs.langBtn.textContent = language === 'en' ? 'العربية' : 'English';
        view.setLanguage(language);
        paintTicker(boardRef && boardRef.settings);
        setConn(refs.conn.classList.contains('is-live'));
        document.title = language === 'en' ? 'Al-Shorfa Al-Alami Restaurants — Menu' : 'مطاعم الشرفه العالمي — شاشة العرض';
    });

    restore();
    view.tick();
    paintDay();
    setInterval(() => { view.tick(new Date()); paintDay(); }, 1000);
    refresh();
    setInterval(() => refresh(), POLL_MS);
    startRealtime();
    scheduleDailyReload();

    /* الشاشة تُحدَّث فور العودة إليها بدل انتظار نهاية دورة الفحص */
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); } });
    window.addEventListener('online', () => refresh());
    try { if (navigator.wakeLock) { navigator.wakeLock.request('screen').catch(() => {}); } } catch { /* unsupported */ }
    document.addEventListener('dblclick', () => {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
        else { document.documentElement.requestFullscreen().catch(() => {}); }
    });
}

boot();
