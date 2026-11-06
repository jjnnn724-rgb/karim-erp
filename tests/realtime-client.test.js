/**
 * realtime-client.test.js — TASK 6: durable subscribe + resume + ACK (shadow).
 * Loads the real frontend/app/js/realtime.js in a vm sandbox with stubbed
 * window/document/io/fetch. No network, no DOM.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRealtime({ seq = 0, jwt = 'jwt-test', appKey = 'key-test' } = {}) {
    const store = { karim_rt_seq: String(seq) };
    const calls = { fetch: [], ioOpts: null, handlers: {} };
    const els = [];
    const mkEl = () => ({
        innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} },
        className: '', appendChild() {}, addEventListener() {}, style: {},
        querySelector() { return null; },
    });
    const socketStub = {
        connected: false, id: 'sock-1', auth: {},
        on(ev, fn) { calls.handlers[ev] = fn; },
        off() {},
        emit: jest.fn(),
    };
    const sandbox = {
        console,
        // NOTE: take the *current* globals so jest fake timers (enabled below
        // before load) govern the sandbox too — otherwise intervals hang jest.
        setTimeout: (...a) => setTimeout(...a),
        clearTimeout: (...a) => clearTimeout(...a),
        setInterval: (...a) => setInterval(...a),
        clearInterval: (...a) => clearInterval(...a),
        crypto: { getRandomValues: (a) => a },
        navigator: { userAgent: 'Windows PC' },
        AudioContext: undefined,
        io: (origin, opts) => { calls.ioOpts = { origin, opts }; return socketStub; },
        fetch: jest.fn(async (url, options = {}) => {
            calls.fetch.push({ url, options });
            if (String(url).includes('/api/rt/events')) {
                return { ok: true, json: async () => ({ events: [{ sequence: 41, eventType: 'SALE_POSTED' }], deliveredUpTo: 41, currentSequence: 41 }) };
            }
            if (String(url).includes('/api/rt/ack')) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            if (String(url).includes('/api/health')) {
                return { ok: true, json: async () => ({ checks: { database: { status: 'ok' } } }) };
            }
            return { ok: true, json: async () => ({}) };
        }),
    };
    sandbox.window = {
        console,
        location: { origin: 'https://x:5000' },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        },
        _jwt: jwt,
        _appKey: appKey,
        STATE: { currentUser: { id: 5, role: 'admin' } },
        addEventListener() {},
    };
    sandbox.globalThis = sandbox;
    sandbox.document = {
        readyState: 'complete',
        hidden: false,
        visibilityState: 'visible',
        createElement: () => { const e = mkEl(); els.push(e); return e; },
        querySelector: () => null,
        getElementById: () => null,
        addEventListener() {},
        body: { appendChild() {} },
    };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'realtime.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'realtime.js' });
    return { sandbox, calls, store, socketStub };
}

describe('TASK 6 client — durable channel', () => {
    beforeEach(() => {jest.useFakeTimers();});
    afterEach(() => {jest.useRealTimers();jest.clearAllTimers();});
    test('handshake carries JWT + backoff opts', () => {
        const { calls } = loadRealtime();
        expect(calls.ioOpts.opts.auth).toEqual({ token: 'jwt-test' });
        expect(calls.ioOpts.opts.reconnectionAttempts).toBe(Infinity);
        expect(calls.ioOpts.opts.reconnectionDelayMax).toBe(30000);
    });

    test('connect → resume since stored seq → advances + ACKs installation', async () => {
        const { calls, store, socketStub } = loadRealtime({ seq: 40 });
        socketStub.connected = true;
        await calls.handlers.connect();
        await jest.advanceTimersByTimeAsync(0); // flush async resume chain
        await jest.advanceTimersByTimeAsync(0);
        // resume fetched
        const ev = calls.fetch.find((c) => String(c.url).includes('/api/rt/events?since=40'));
        expect(ev).toBeTruthy();
        expect(ev.options.headers['Authorization']).toBe('Bearer jwt-test');
        expect(store.karim_rt_seq).toBe('41');
        // debounced ACK (5s)
        await jest.advanceTimersByTimeAsync(6000);
        const ack = calls.fetch.find((c) => String(c.url).includes('/api/rt/ack'));
        expect(ack).toBeTruthy();
        expect(JSON.parse(ack.options.body)).toMatchObject({ lastSequence: 41 });
        expect(JSON.parse(ack.options.body).installationId).toMatch(/^web-/);
    });

    test('domain_event advances sequence (shadow, no crash)', async () => {
        const { calls, store, socketStub } = loadRealtime({ seq: 41 });
        socketStub.connected = true;
        await calls.handlers.connect();
        calls.handlers.domain_event({ sequence: 42, eventType: 'SALE_POSTED' });
        expect(store.karim_rt_seq).toBe('42');
        calls.handlers.domain_event({ sequence: 41, eventType: 'SALE_POSTED' }); // stale ignored
        expect(store.karim_rt_seq).toBe('42');
        await jest.advanceTimersByTimeAsync(6000);
        const ack = calls.fetch.find((c) => String(c.url).includes('/api/rt/ack'));
        expect(JSON.parse(ack.options.body).lastSequence).toBe(42);
    });

    test('reconnect refreshes handshake JWT', () => {
        const { calls, socketStub, sandbox } = loadRealtime();
        sandbox.window._jwt = 'jwt-rotated';
        calls.handlers.reconnect_attempt(3);
        expect(socketStub.auth).toEqual({ token: 'jwt-rotated' });
    });
});

describe('إلغاء إشعارات «جهاز دخل/جهاز خرج» (قرار المالك 2026-10-31)', () => {
    const ROOT = path.join(__dirname, '..');
    const SERVER = path.join(ROOT, 'backend', 'server.js');
    const LEGACY_RT = path.join(ROOT, 'frontend', 'app', 'js', 'realtime.js');
    const read = (p) => fs.readFileSync(p, 'utf8');
    /* ملاحظة: لا strip هنا — التعليقات التوضيحية المضافة لا تحوي أي نمط
       مُفحوص، وstrip الساذج يبتلع كودًا حقيقيًا في server.js (يوجد «/*»
       داخل سترينج فيفوق عدد الغواقِ الفواتح). */

    test('السيرفر لا يبثّ device_connected ولا device_disconnected بعد اليوم', () => {
        const src = read(SERVER);
        expect(src).not.toMatch(/emitScoped\(\s*'device_connected'/);
        expect(src).not.toMatch(/emitScoped\(\s*'device_disconnected'/);
        // قائمة الأجهزة الحيّة ما زالت تصل عند الاتصال — البديل المشروع
        expect(src).toMatch(/socket\.emit\('clients_list'/);
    });

    test('الشاشة القديمة لا تستمع لهذين الحدثين ولا تصوّت انضمام/مغادرة', () => {
        const src = read(LEGACY_RT);
        expect(src).not.toMatch(/socket\.on\(\s*'device_connected'/);
        expect(src).not.toMatch(/socket\.on\(\s*'device_disconnected'/);
        expect(src).not.toMatch(/`انضم: /);
        expect(src).not.toMatch(/`غادر: /);
    });

    test('المناداة الصوتية بالاسم حاضرة في الشاشة القديمة (بكتم لكل جهاز)', () => {
        const src = read(LEGACY_RT);
        expect(src).toMatch(/function speakNameCall/);
        expect(src).toMatch(/karim_legacy_voice/);
        // صوت عربي فقط — غيابه يعني صمتًا لا بلكنة لاتينية
        expect(src).toMatch(/\^ar\\b\/i/);
        // النغمة أولًا ثم المناداة مؤجلة 400ms
        expect(src).toMatch(/setTimeout\(\(\) => \{speakNameCall\(data\);\}, 400\)/);
    });
});
