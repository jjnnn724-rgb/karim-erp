const fs = require('fs');
const path = require('path');
const { sanitizeV2State } = require('../backend/menu-board-routes');

function makeState(overrides = {}) {
    return {
        buffet: {
            pricing: { adultPrice: 100, childPrice: 50, currency: 'ر.س' },
            soups: [],
            mainDishes: [{
                id: 'main-1',
                nameAr: 'طبق رئيسي',
                nameEn: 'Main dish',
                descriptionAr: '',
                descriptionEn: '',
                category: 'main',
                mealTypes: ['lunch'],
                daysAvailable: ['sunday'],
                isAvailable: true,
                image: '',
            }],
            carvingSchedule: {},
            salads: { itemsListAr: [], itemsListEn: [] },
            desserts: { itemsListAr: [], itemsListEn: [] },
        },
        schedules: [],
        settings: {
            erpUrl: 'https://internal.example',
            erpSyncEnabled: true,
            esp32IpAddress: '192.168.1.20',
        },
        lastUpdated: 1_800_000_000_000,
        ...overrides,
    };
}

describe('central v2 menu state', () => {
    test('validates and redacts per-device connection details without mutating the input', () => {
        const input = makeState();
        const saved = sanitizeV2State(input);

        expect(saved.settings).toMatchObject({
            erpUrl: '',
            erpSyncEnabled: false,
            esp32IpAddress: '',
        });
        expect(input.settings.erpUrl).toBe('https://internal.example');
        expect(saved.buffet).toEqual(input.buffet);
    });

    test('rejects incomplete state and oversized snapshots', () => {
        expect(() => sanitizeV2State({ buffet: {}, settings: {}, schedules: [], lastUpdated: 1 }))
            .toThrow('INVALID_V2_STATE');
        expect(() => sanitizeV2State(makeState({
            buffet: {
                ...makeState().buffet,
                pricing: { adultPrice: -1, childPrice: 0, currency: 'ر.س' },
            },
        }))).toThrow('INVALID_V2_STATE');
        expect(() => sanitizeV2State(makeState({ extra: 'x'.repeat(1_500_001) })))
            .toThrow('V2_STATE_TOO_LARGE');
    });

    test('rejects malformed menu items before persisting state', () => {
        expect(() => sanitizeV2State(makeState({
            buffet: {
                ...makeState().buffet,
                mainDishes: [{ id: 1, nameAr: 'طبق' }],
            },
        }))).toThrow('INVALID_V2_STATE');
    });

    test('protects writes with ERP roles and optimistic version checks', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'backend', 'menu-board-routes.js'),
            'utf8'
        );
        expect(source).toContain("router.put('/v2-state', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef')");
        expect(source).toContain('SELECT version FROM menu_board_v2_state WHERE id = 1 FOR UPDATE');
        expect(source).toContain("error: 'VERSION_CONFLICT'");
        expect(source).toContain("router.get('/v2-state'");
    });

    test('only allows anonymous API-key bypass for public GET state reads', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'backend', 'server.js'),
            'utf8'
        );
        expect(source).toContain("req.method === 'GET' && req.path === '/menu-board/v2-state'");
    });
});
