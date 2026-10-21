const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RT = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'realtime.js');
const source = fs.readFileSync(RT, 'utf8').replace(/^export\s+/gm, '');

function loadRealtime(fetch) {
    const events = [];
    const storage = new Map();
    const script = {
        dataset: {},
        addEventListener() {},
        onerror: null,
    };
    const window = {
        _jwt: 'live-token',
        location: { origin: 'https://erp.test' },
        localStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, String(value)),
        },
        dispatchEvent: (event) => events.push(event),
    };
    const document = {
        hidden: false,
        querySelector: () => null,
        createElement: () => script,
        head: { appendChild: (node) => node.onerror() },
    };
    const context = {
        window, document, console, fetch,
        Date, Math, Number, String, Object, Array, Promise, Error, Uint32Array,
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {this.type = type; this.detail = options.detail;}
        },
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 2,
        clearTimeout() {},
    };
    vm.createContext(context);
    vm.runInContext(`${source}; Object.assign(globalThis, { ensureRealtimeSocket, closeRealtimeSocket });`,
        context, { filename: RT });
    return { context, events, storage };
}

describe('V2 durable realtime fallback', () => {
    test('recovers and dispatches authorized events when Socket.IO cannot load', async () => {
        const event = { sequence: 7, eventType: 'INVENTORY_UPDATED', payload: { id: 4 } };
        const fetch = jest.fn(async (url) => {
            if (String(url).includes('/api/rt/events')) {
                return { ok: true, json: async () => ({ events: [event], deliveredUpTo: 7 }) };
            }
            return { ok: true, json: async () => ({ ok: true }) };
        });
        const { context, events, storage } = loadRealtime(fetch);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(context.ensureRealtimeSocket()).resolves.toBeNull();
        for (let i = 0; i < 6; i += 1) {await Promise.resolve();}

        const recoveryCall = fetch.mock.calls.find(([url]) => String(url).includes('/api/rt/events'));
        expect(recoveryCall[0]).toBe('https://erp.test/api/rt/events?since=0&limit=200');
        expect(recoveryCall[1].headers.Authorization).toBe('Bearer live-token');
        expect(events.map((entry) => entry.type)).toContain('v2:domain-event');
        expect(events.find((entry) => entry.type === 'v2:domain-event').detail).toMatchObject(event);
        expect(storage.get('karim_v2_rt_seq')).toBe('7');

        context.closeRealtimeSocket();
        warn.mockRestore();
    });

    test('does not start network recovery without a live token', async () => {
        const fetch = jest.fn();
        const { context } = loadRealtime(fetch);
        context.window._jwt = null;

        await expect(context.ensureRealtimeSocket()).resolves.toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
