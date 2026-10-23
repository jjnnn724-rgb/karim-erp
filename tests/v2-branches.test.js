/**
 * v2-branches.test.js — عقد شاشة الفروع في V2 (بيانات حقيقية، بلا متصفح)
 * ═══════════════════════════════════════════════════════════════════════
 * These files are browser ESM while jest here runs with
 * testEnvironment:'node' and no bundler, so the pure modules are loaded the
 * way realtime-client.test.js loads realtime.js: read the source, drop the
 * `import`/`export` keywords, run it in a vm context, stub its one
 * dependency (apiFetch / fetch). The screen is asserted as a source
 * contract — its job is DOM, and the parts that can rot silently are the
 * payload it sends and the handlers it wires.
 *
 * Pinned because each one is a real server rule:
 *   • PATCH never carries `code` (branch-routes.js:48 omits it from the
 *     allowed set — sending it silently does nothing)
 *   • MAIN is not deactivatable (branch-routes.js:77)
 *   • ?all=1 is admin-only and inactive rows are rendered, not dropped
 *   • the status badge only uses values the boolean column maps to
 *   • every module specifier carries the page's ?v — the tunnel caches
 *     static JS for four hours, so a version-less import serves stale bytes
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'branches-repo.js');
const SESSION = path.join(V2, 'session.js');
const SCREEN = path.join(V2, 'screens', 'branches.js');
const PREVIEW = path.join(V2, 'preview.js');
const STATUS = path.join(V2, 'status.js');
const V2_HTML = path.join(APP, 'v2.html');

/** Load a V2 ESM file into a vm context (imports stripped, exports global). */
function loadEsm(file, injections = {}) {
    const src = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        encodeURIComponent, decodeURIComponent, TextDecoder, Uint8Array,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),   // browser global the module reads
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoHarness() {
    const calls = [];
    const apiFetch = jest.fn(async (p, options = {}) => {
        calls.push({ path: p, options });
        if (p === '/branches' || p.startsWith('/branches?')) {
            return { ok: true, data: [{ id: 1, code: 'MAIN', name_ar: 'الرئيسي', currency: 'SAR', timezone: 'Asia/Riyadh', is_active: true }] };
        }
        return { ok: true, data: { id: 7 } };
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }) };
}

describe('V2 branches repository', () => {
    test('normalizePayload applies the server defaults and uppercases the currency', () => {
        const { repo } = repoHarness();
        const p = repo.normalizePayload({ code: ' br-2 ', name_ar: ' فرع ', currency: 'egp', timezone: '  ', phone: '  ' });
        expect(p.code).toBe('br-2');
        expect(p.name_ar).toBe('فرع');
        expect(p.currency).toBe('EGP');
        expect(p.timezone).toBe('Asia/Riyadh');   // blank → the column default
        expect(p.phone).toBeNull();               // blank → NULL, never ''
        expect(p.address).toBeNull();
    });

    test('validateBranch mirrors the server rules (code charset / name / currency)', () => {
        const { repo } = repoHarness();
        expect(repo.validateBranch({}, { editing: false }).map((e) => e.field).sort()).toEqual(['code', 'name_ar']);
        expect(repo.validateBranch({ code: 'فرع 1', name_ar: 'س', currency: 'SARR' }, {})
            .map((e) => e.field).sort()).toEqual(['code', 'currency']);
        expect(repo.validateBranch({ code: 'BR-2', name_ar: 'ث', currency: 'SAR' }, {})).toEqual([]);
        // code is immutable on edit — it is neither demanded nor rejected there.
        expect(repo.validateBranch({ code: '', name_ar: 'ث' }, { editing: true })).toEqual([]);
    });

    test('branchToRow maps the BOOLEAN column to real status values and flags MAIN', () => {
        const { repo } = repoHarness();
        expect(repo.branchToRow({ id: 1, code: 'MAIN', name_ar: 'x', is_active: true }).status).toBe('active');
        expect(repo.branchToRow({ id: 2, code: 'BR-2', name_ar: 'y', is_active: false }).status).toBe('inactive');
        expect(repo.branchToRow({ id: 3, code: 'MAIN', name_ar: 'z', is_active: true }).is_main).toBe(true);
        expect(repo.branchToRow({ id: 4, code: 'BR-9', name_ar: 'w', is_active: true }).is_main).toBe(false);
        // A missing flag must never read as a stopped branch.
        expect(repo.branchToRow({ id: 5, code: 'B', name_ar: 'v' }).status).toBe('active');
    });

    test('fetchBranches: ?all=1 only when asked, rows mapped, bad shape tolerated', async () => {
        const { calls, repo } = repoHarness();
        await repo.fetchBranches();
        await repo.fetchBranches({ showAll: true });
        expect(calls.map((c) => c.path)).toEqual(['/branches', '/branches?all=1']);
        const rows = await repo.fetchBranches();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ code: 'MAIN', status: 'active', is_main: true });

        const silent = loadEsm(REPO, { apiFetch: jest.fn(async () => ({})) });
        expect(await silent.fetchBranches()).toEqual([]);
    });

    test('create sends code; update NEVER sends code', async () => {
        const { calls, repo } = repoHarness();
        const form = { code: 'BR-3', name_ar: 'فرع جديد', currency: 'sar', timezone: 'Asia/Riyadh', name_en: '', phone: '', address: '' };
        await repo.createBranch(form);
        expect(calls[0].options.method).toBe('POST');
        expect(JSON.parse(calls[0].options.body)).toMatchObject({ code: 'BR-3', currency: 'SAR' });

        await repo.updateBranch(9, form);
        expect(calls[1].path).toBe('/branches/9');
        expect(calls[1].options.method).toBe('PATCH');
        const body = JSON.parse(calls[1].options.body);
        expect(Object.prototype.hasOwnProperty.call(body, 'code')).toBe(false);
        expect(body.name_ar).toBe('فرع جديد');
    });

    test('deactivate is a soft DELETE; reactivate is PATCH is_active=true', async () => {
        const { calls, repo } = repoHarness();
        await repo.deactivateBranch(4);
        expect(calls[0].path).toBe('/branches/4');
        expect(calls[0].options.method).toBe('DELETE');

        await repo.reactivateBranch(4);
        expect(calls[1].options.method).toBe('PATCH');
        expect(JSON.parse(calls[1].options.body)).toEqual({ is_active: true });
    });
});

describe('V2 session bridge', () => {
    const signedToken = (payload) => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
    };

    function sessionHarness({ refreshTokens = {}, responses = [] } = {}) {
        const store = { ...refreshTokens };
        const localStorage = {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => {store[k] = String(v);},
            removeItem: (k) => {delete store[k];},
        };
        const window = { location: { origin: 'https://erp.test' } };
        const fetch = jest.fn(async () => {
            const r = responses.shift() || { ok: false };
            return { ok: r.ok !== false, json: async () => r.body || {} };
        });
        const ctx = loadEsm(SESSION, { window, localStorage, fetch });
        return { ctx, window, store, localStorage, fetch };
    }

    test('the globals apiFetch calls on a 401 exist before any request', () => {
        const { ctx, window } = sessionHarness();
        ctx.installApiFetchBridge();
        for (const name of ['KARIM_RTget', 'KARIM_RTset', 'KARIM_RTclear', 'refreshSession', 'toast', 'doLogout']) {
            expect(typeof window[name]).toBe('function');
        }
        // apiFetch:46-47 calls these BARE — missing them turned a 401 into a
        // ReferenceError that hid the real failure.
        expect(window.KARIM_RTget()).toBe('');
        expect(() => window.doLogout()).not.toThrow();
        expect(window._jwt).toBeNull();
    });

    test('no session is reported as no session — never invented', async () => {
        const { ctx, fetch } = sessionHarness();
        expect(await ctx.ensureSession({})).toBeNull();
        expect(await ctx.ensureSession({ rotate: true })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();   // no token stored → no request spent
    });

    test('a bare access token is not a session (the x-api-key gate needs app_key)', async () => {
        const { ctx, window } = sessionHarness();
        window._jwt = signedToken({ role: 'admin' });
        expect(await ctx.ensureSession({})).toBeNull();
        window._appKey = 'key';
        expect(await ctx.ensureSession({})).toMatchObject({ source: 'memory', role: 'admin' });
    });

    test('silent refresh persists the ROTATED token and publishes both credentials', async () => {
        const { ctx, window, store } = sessionHarness({
            refreshTokens: { karim_rt_v1: 'old-rt' },
            responses: [{ ok: true, body: { access_token: 'new-jwt', refresh_token: 'new-rt', app_key: 'new-key', user: { id: 1, role: 'admin', name: 'المدير' } } }],
        });
        const s = await ctx.silentRefresh();
        expect(s).toMatchObject({ role: 'admin', source: 'refresh' });
        expect(store.karim_rt_v1).toBe('new-rt');    // rotation written back, not lost
        expect(window._jwt).toBe('new-jwt');
        expect(window._appKey).toBe('new-key');
    });

    test('a rejected refresh is a plain "no session", not a thrown error', async () => {
        const { ctx, store } = sessionHarness({ refreshTokens: { karim_rt_v1: 'dead-rt' }, responses: [{ ok: false, body: { error: 'REFRESH_TOKEN_INVALID' } }] });
        expect(await ctx.ensureSession({ rotate: true })).toBeNull();
        expect(store.karim_rt_v1).toBe('dead-rt');   // never cleared on a failure V2 caused
    });

    test('canWrite mirrors backend requireRole("admin") for the UI only', () => {
        const { ctx } = sessionHarness();
        expect(ctx.canWrite('admin')).toBe(true);
        expect(ctx.canWrite('manager')).toBe(false);
        expect(ctx.canWrite(null)).toBe(false);
        expect(ctx.canWrite('manager', ['manager', 'admin'])).toBe(true);
    });
});

describe('V2 branches screen + host (source contract)', () => {
    const screen = fs.readFileSync(SCREEN, 'utf8');
    const preview = fs.readFileSync(PREVIEW, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen).not.toMatch(/on(click|change|input|submit|keydown)\s*=\s*["']/);
        expect(preview).not.toMatch(/on(click|change|input|submit)\s*=\s*["']/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen).toMatch(/from '\.\.\/data\/branches-repo\.js/);
    });

    test('انتهاء الجلسة يُقري بـe.message — apiFetch يرمي Error بلا code، وبقية الشاشات كذلك', () => {
        expect(screen).toMatch(/e\.message === 'UNAUTHORIZED'/);
        expect(screen).not.toMatch(/e\.code === 'UNAUTHORIZED'/);
    });

    test('row action markup is escaped, so a branch name cannot inject HTML', () => {
        expect(screen).toMatch(/data-name="\$\{esc\(row\.name_ar\)\}"/);
        expect(screen).toMatch(/data-id="\$\{esc\(row\.id\)\}"/);
    });

    test('stopping a branch asks first, and MAIN is offered disabled', () => {
        expect(screen).toMatch(/confirmFn\(/);
        expect(screen).toMatch(/row\.is_main \? ' disabled/);
    });

    test('repeat clicks cannot start a second operation (the dispatch lesson)', () => {
        expect(screen).toMatch(/if \(loading\) \{return;\}/);
        expect(screen).toMatch(/if \(saving\) \{return;\}/);
    });

    test('live data is opt-in and the host never awaits at module top level', () => {
        expect(preview).toMatch(/get\('live'\) === '1'/);
        // Gate C: `let`, because the sign-in success handler re-points the
        // promise at the fresh session (an event callback, never top-level
        // await — the rule below still holds).
        expect(preview).toMatch(/(const|let) sessionPromise = LIVE/);
        expect(preview).toMatch(/ensureSession\(\{ rotate: true \}\)/);
        // top-level await would defer the module past DOMContentLoaded and
        // leave icons.js hydrating an empty document (see preview.js §4).
        expect(preview).not.toMatch(/^\s*await /m);
    });

    test('a missing session is stated, not papered over with sample rows', () => {
        // 2026-10-23: المالك أزال اللافتات المشروحة؛ الحالة صارت سطرًا واحدًا
        // مختصرًا يحمل نفس المعنى: غياب الجلسة مذكور صراحة لا مغطّى ببيانات نموذجية.
        expect(preview).toMatch(/لا جلسة في هذا المتصفح/);
        expect(preview).toMatch(/if \(!session\) \{/);
    });

    test('the branches key in the real nav model renders the branches screen', () => {
        expect(preview).toMatch(/key === 'branches'/);
        expect(preview).toMatch(/mountBranchesScreen\(/);
        expect(preview).toMatch(/teardownBranchesScreen\(\)/);
    });

    test('the status adapter knows the two branch states and guesses at nothing else', () => {
        const ctx = loadEsm(STATUS, {});
        expect(ctx.resolveStatus('branches', 'active').known).toBe(true);
        expect(ctx.resolveStatus('branches', 'inactive').known).toBe(true);
        expect(ctx.resolveStatus('branches', 'brand_new').known).toBe(false);
        expect(ctx.listKnownStatuses()).toEqual(expect.arrayContaining(['branches:active', 'branches:inactive']));
        expect(ctx.statusBadge('branches', 'inactive')).toMatch(/data-unknown="false"/);
        expect(ctx.statusBadge('branches', 'brand_new')).toMatch(/data-unknown="true"/);
    });

    test('every V2 module specifier carries the page revision (no stale JS)', () => {
        // One source of truth: the revision v2.html loads preview.js with.
        // A specifier without it (or with a different one) is a second,
        // four-hour-cacheable URL for the same module — the tunnel serves
        // static JS with max-age=14400, so a version-less import can be an
        // old file under a new page.
        const html = fs.readFileSync(V2_HTML, 'utf8');
        const ver = (html.match(/js\/v2\/preview\.js\?v=([\d.]+)/) || [])[1];
        expect(ver).toBeTruthy();
        const files = [];
        (function walk(dir) {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {walk(p);} else if (e.name.endsWith('.js')) {files.push(p);}
            }
        })(V2);
        const drifting = [];
        for (const f of files) {
            for (const s of (fs.readFileSync(f, 'utf8').match(/from '[^']*'/g) || []).map((x) => x.slice(6, -1))) {
                if (s.startsWith('.') && !s.endsWith(`.js?v=${ver}`)) {
                    drifting.push(`${path.relative(V2, f)} → ${s}`);
                }
            }
        }
        expect(drifting).toEqual([]);
    });
});
