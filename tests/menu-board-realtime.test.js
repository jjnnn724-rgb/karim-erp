const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BOARD_JS = path.join(__dirname, '..', 'frontend', 'app', 'js', 'menu-board.js');
const source = fs.readFileSync(BOARD_JS, 'utf8');

function loadBoard({ fetch, io = () => ({ on: () => {} }) }) {
    const context = {
        AbortController,
        console,
        clearTimeout,
        document: {
            documentElement: { classList: { add: () => {} } },
            addEventListener: () => {},
        },
        fetch,
        io,
        localStorage: { getItem: () => null },
        location: { search: '' },
        setInterval,
        setTimeout,
        window: { addEventListener: () => {} },
    };
    vm.createContext(context);
    vm.runInContext(`${source}
        applyBoardData = () => true;
        cacheBoard = () => {};
        setConn = () => {};
        board = {};
        pages = [{}];
        globalThis.boardTest = { refresh, connectRealtime, get refreshing() { return refreshInProgress; } };
    `, context, { filename: BOARD_JS });
    return context.boardTest;
}

describe('menu board realtime refresh', () => {
    test('queues an update received during an in-flight request', async () => {
        let resolveFirst;
        let resolveSecond;
        const first = new Promise((resolve) => { resolveFirst = resolve; });
        const second = new Promise((resolve) => { resolveSecond = resolve; });
        const fetch = jest.fn()
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(second);
        const board = loadBoard({ fetch });

        const initialRefresh = board.refresh();
        board.refresh();
        expect(fetch).toHaveBeenCalledTimes(1);

        resolveFirst({ ok: true, json: async () => ({ version: 'first' }) });
        await initialRefresh;
        expect(fetch).toHaveBeenCalledTimes(2);

        resolveSecond({ ok: true, json: async () => ({ version: 'latest' }) });
        await new Promise((resolve) => setImmediate(resolve));
        expect(board.refreshing).toBe(false);
    });

    test('refreshes after every socket connection, even when cached data exists', async () => {
        const handlers = {};
        const socket = { on: (event, handler) => { handlers[event] = handler; } };
        const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ version: 'fresh' }) }));
        const board = loadBoard({ fetch, io: () => socket });

        board.connectRealtime();
        handlers.connect();
        await new Promise((resolve) => setImmediate(resolve));

        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
