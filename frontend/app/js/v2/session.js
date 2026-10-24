/**
 * V2 — Session bridge (حقيقي، لا اختلاق فيه)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 *   core/api.js#apiFetch reads two globals that the legacy SPA installs at
 *   login (`window._jwt`, `window._appKey`) and, on a 401, calls a BARE
 *   identifier `KARIM_RTget()` plus `refreshSession` — both declared in
 *   app.js. v2.html does not load app.js, so calling apiFetch unprepared
 *   would throw `ReferenceError: KARIM_RTget is not defined` on exactly the
 *   path that is supposed to heal the session. This bridge supplies those
 *   four names, so V2 reuses the production client rather than forking it.
 *
 * WHERE THE SESSION COMES FROM (لا اختلاق جلسة)
 *   1. `window._jwt` + `window._appKey` if the page already has both.
 *   2. A silent `POST /api/auth/refresh` with `localStorage['karim_rt_v1']`
 *      (default lifetime 30 days — H-4, audit 2026-10-23). /api/auth/* is
 *      exempt from the x-api-key gate (server.js:490), so this needs no key,
 *      and the response carries both the new access token and `app_key`.
 *      The server ROTATES the refresh token, and the app re-reads it from
 *      storage on every refresh (app.js:54), so writing the new value back
 *      keeps both shells consistent instead of racing them.
 *   3. Otherwise: no session. The caller must say so out loud.
 *
 *   Both halves are required on purpose. `localStorage['token']` holds an
 *   access token but nothing holds an app key across page loads — and when
 *   API_KEY is set the gate answers 401 API_KEY_REQUIRED to any /api/* call
 *   without x-api-key (server.js:496-498). Pretending a bare stored token is
 *   a session would produce a screen full of 401s and a wiped credential.
 *
 *   Rotation is opt-in (`rotate: true`) because it consumes and replaces a
 *   shared credential. Opening the preview page must never mutate the live
 *   app's session state as a side effect.
 *
 * NOTHING HERE DECIDES PERMISSION. It reports the role the server returned;
 * screens compare it and the backend remains authoritative.
 */

const RT_KEY = 'karim_rt_v1';

const apiBase = () => `${window.location.origin}/api`;

/** @returns {string} the persisted refresh token, '' when absent */
export function readRefreshToken() {
    try {return String(localStorage.getItem(RT_KEY) || '');} catch (_) {return '';}
}

/**
 * Read the JWT claims WITHOUT verifying them.
 *
 * This is a display aid only — it decides which buttons a screen shows.
 * The server re-checks the signature and the role on every request
 * (jwtAuth + requireRole), so a hand-edited token here buys nothing.
 *
 * @param {string} token
 * @returns {{role?: string, name?: string, id?: number}|null}
 */
export function jwtClaims(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {return null;}
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (_) {return null;}
}

function publish(accessToken, appKey) {
    if (accessToken) {window._jwt = accessToken;}
    if (appKey) {window._appKey = appKey;}
    scheduleKeepAlive();
}

/* ── التجديد الصامت الاستباقي (البند ١٠) ────────────────────────────────
   رمز الوصول صار قصيرًا (15 دقيقة)، فالاعتماد على 401 وحدها يعني طلبًا
   فاشلًا كل ربع ساعة. هذا المؤقّت يجدّد قبل الانتهاء بهامش دقيقتين.
   القيود:
   · لا يعمل في تبويب مخفي (المتصفحات تخنق المؤقّتات) — وعند العودة
     يُعاد الجدولة أو يُجدَّد فورًا إن اقترب الانتهاء.
   · فشلُ التجديد لا يطرد أحدًا هنا؛ مسار 401 في apiFetch يقرر.
   · لا شيء يُلمس وقت الاستيراد (vm بلا DOM/مؤقّتات).
*/
const KEEPALIVE_LEAD_MS = 120_000;
const KEEPALIVE_MIN_DELAY_MS = 15_000;
let keepAliveTimer = null;
let keepAliveWired = false;
/* جيل الجلسة: الخروج يرفعه فيُسقط أي تجديد كان في الطريق. بدونه يعيد ردٌّ
   متأخر كتابة `_jwt` بعد أن ضغط المستخدم «خروج» — أي إحياءً صامتًا لجلسة
   أنهىها بنفسه. */
let keepAliveEpoch = 0;

function accessExpiresAtMs(token) {
    const claims = jwtClaims(token || window._jwt);
    return claims && claims.exp ? Number(claims.exp) * 1000 : 0;
}

function scheduleKeepAlive() {
    if (typeof setTimeout !== 'function') {return;}
    if (keepAliveTimer) {clearTimeout(keepAliveTimer); keepAliveTimer = null;}
    if (typeof document !== 'undefined' && document.hidden) {return;}
    const exp = accessExpiresAtMs();
    if (!exp) {return;}
    const delay = Math.max(KEEPALIVE_MIN_DELAY_MS, exp - Date.now() - KEEPALIVE_LEAD_MS);
    keepAliveTimer = setTimeout(() => {
        keepAliveTimer = null;
        if (typeof document !== 'undefined' && document.hidden) {return;}
        void silentRefresh();
    }, delay);
}

/** يوقف التجديد الاستباقي ويُبطل أي طلب جارٍ — يُندى عند الخروج. */
export function stopKeepAlive() {
    keepAliveEpoch += 1;
    if (keepAliveTimer) {clearTimeout(keepAliveTimer); keepAliveTimer = null;}
}

function wireKeepAlive() {
    if (keepAliveWired) {return;}
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {return;}
    keepAliveWired = true;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {return;}
        const exp = accessExpiresAtMs();
        if (exp && exp - Date.now() <= KEEPALIVE_LEAD_MS) {void silentRefresh();}
        else {scheduleKeepAlive();}
    });
}

function memorySession() {
    if (!window._jwt || !window._appKey) {return null;}
    const claims = jwtClaims(window._jwt) || {};
    return {source: 'memory', role: claims.role || null, user: claims};
}

/**
 * Installs the globals apiFetch expects. Safe to call more than once, and
 * safe to call without a session: the getters just return ''.
 *
 * `toast` and `doLogout` are here for the same reason as the refresh
 * helpers: apiFetch:46-47 calls them BARE on a hard 401. They are declared
 * in app.js, which v2.html does not load, so without them the error path
 * itself throws a ReferenceError and hides the real failure.
 *
 * `doLogout` in V2 revokes the session server-side (H-4, audit
 * 2026-10-23): POST /api/auth/logout deletes all of the user's refresh
 * tokens, then the local RT is cleared because the server already killed
 * it — leaving it in storage would only cause a doomed silent refresh.
 * Both shells share `karim_rt_v1`, so a V2 logout ends the session for the
 * production SPA too: one user, one session, one logout. That is the
 * intended security behavior, not a side effect.
 */
export function installApiFetchBridge() {
    // مؤقّت التجديد الاستباقي + إعادة الجدولة عند العودة إلى التبويب.
    wireKeepAlive();
    if (typeof window.KARIM_RTget !== 'function') {
        window.KARIM_RTget = readRefreshToken;
    }
    if (typeof window.KARIM_RTset !== 'function') {
        window.KARIM_RTset = (rt) => { try {if (rt) {localStorage.setItem(RT_KEY, rt);} } catch (_) { /* متجاهَل عمدًا */ } };
    }
    if (typeof window.KARIM_RTclear !== 'function') {
        window.KARIM_RTclear = () => { try {localStorage.removeItem(RT_KEY);} catch (_) { /* متجاهَل عمدًا */ } };
    }
    if (typeof window.refreshSession !== 'function') {
        window.refreshSession = async () => (await silentRefresh()) !== null;
    }
    if (typeof window.toast !== 'function') {
        window.toast = (message) => console.info('[V2]', message);
    }
    if (typeof window.doLogout !== 'function') {
        window.doLogout = () => {
            stopKeepAlive();
            const oldJwt = window._jwt;
            window._jwt = null;
            window._appKey = null;
            if (oldJwt) {
                // H-4: الخروج الواعي يُبطل جلسة التجديد على الخادم (كل أجهزة المستخدم).
                fetch(`${apiBase()}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${oldJwt}` },
                }).catch(() => {});
            }
            try { window.KARIM_RTclear && window.KARIM_RTclear(); } catch (_) { /* متجاهَل عمدًا */ }
        };
    }
}

/**
 * Silent rotation refresh. Returns {accessToken, appKey, user} or null.
 * Never throws — a dead/unreachable auth path is a normal outcome here.
 *
 * SINGLE-FLIGHT (item #10): with a 15-minute access token, several requests
 * can hit 401 in the same tick. Every caller used to POST the SAME refresh
 * token; the server rotates on first use, so the losers presented an already
 * rotated token — which is exactly what the reuse detector revokes a session
 * for. Sharing one in-flight promise means one rotation, and every caller
 * gets the same fresh pair.
 */
let refreshInflight = null;

export function silentRefresh() {
    if (refreshInflight) {return refreshInflight;}
    refreshInflight = performRefresh().finally(() => {refreshInflight = null;});
    return refreshInflight;
}

async function performRefresh() {
    const rt = readRefreshToken();
    if (!rt) {return null;}
    const epoch = keepAliveEpoch;
    let res;
    try {
        res = await fetch(`${apiBase()}/auth/refresh`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'application/json'},
            body: JSON.stringify({refresh_token: rt}),
        });
    } catch (_) {return null;}
    if (!res.ok) {return null;}
    let data;
    try {data = await res.json();} catch (_) {return null;}
    if (!data || !data.access_token) {return null;}
    // خرج المستخدم أثناء الطلب: لا رمز جديد في الذاكرة ولا مُدوَّر في التخزين.
    if (epoch !== keepAliveEpoch) {return null;}
    if (data.refresh_token) {
        try {localStorage.setItem(RT_KEY, data.refresh_token);} catch (_) { /* متجاهَل عمدًا */ }
    }
    publish(data.access_token, data.app_key);
    return {
        accessToken: data.access_token,
        appKey: data.app_key || '',
        user: data.user || null,
        role: (data.user && data.user.role) || null,
        source: 'refresh',
    };
}

/**
 * @param {{rotate?: boolean}} [opts] rotate=true permits the silent refresh
 *   (one shared credential is consumed and replaced).
 * @returns {Promise<{source:string, role:string|null, user:any}|null>}
 */
export async function ensureSession(opts = {}) {
    installApiFetchBridge();

    const live = memorySession();
    if (live) {return live;}
    if (!opts.rotate) {return null;}
    return await silentRefresh();
}

/**
 * Who may write. Mirrors backend/branch-routes.js (requireRole('admin')) —
 * a UI convenience only; the server stays the authority.
 */
export function canWrite(role, writeRoles = ['admin']) {
    return writeRoles.includes(String(role || ''));
}
