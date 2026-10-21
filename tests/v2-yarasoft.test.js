const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const REPO = path.join(APP, 'js', 'v2', 'data', 'yarasoft-repo.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'yarasoft.js');
const ROUTES = path.join(ROOT, 'backend', 'yarasoft', 'routes.js');

function loadEsm(file, injections = {}, collect = []) {
    const source = fs.readFileSync(file, 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^import\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^export\s+/gm, '');
    const tail = collect.length
        ? `\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : '';
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Map, Set, Intl, URLSearchParams, TextEncoder, encodeURIComponent, clearTimeout,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(`${source}${tail}`, context, { filename: file });
    return context;
}

describe('Yarasoft V2 — repository contract', () => {
    test('uses current backend doors and bounds product lookup to inventory search', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (url, options = {}) => {
            calls.push({ url, method: options.method || 'GET', body: options.body });
            return {};
        });
        const inventoryCalls = [];
        const repo = loadEsm(REPO, {
            apiFetch,
            fetchInventory: async (options) => {
                inventoryCalls.push(options);
                return { rows: [], total: 0, truncated: false };
            },
        }, [
            'fetchYarasoftStatus', 'fetchYarasoftLog', 'runYarasoftNow',
            'reprocessYarasoftInvoice', 'fetchYarasoftInvoiceDetail',
            'fetchYarasoftReview', 'resolveYarasoftReview', 'searchYarasoftProducts',
            'fetchYarasoftOracleStatus', 'testYarasoftOracle', 'pollYarasoftOracleNow',
            'previewYarasoftOracleItems', 'importYarasoftOracleItems',
            'fetchYarasoftOracleReconcile', 'fetchYarasoftOracleCatchUpStatus',
            'startYarasoftOracleCatchUp', 'previewYarasoftInvoiceText',
            'fetchYarasoftMirrorCashiers', 'fetchYarasoftMirrorOrders',
            'fetchYarasoftMirrorOrder', 'fetchYarasoftMirrorClose', 'refreshYarasoftMirror',
            'fetchYarasoftMappings', 'saveYarasoftMapping', 'deactivateYarasoftMapping',
            'fetchYarasoftSectionInvoices', 'fetchYarasoftSectionInvoiceDetail',
            'reclassifyYarasoftRevenue', 'renameYarasoftSection', 'createYarasoftManualSection',
            'fetchYarasoftSectionMap', 'fetchYarasoftUnmappedSections',
            'approveYarasoftSection', 'canWriteYarasoft',
        ]);

        await repo.fetchYarasoftStatus();
        await repo.fetchYarasoftLog(999);
        await repo.runYarasoftNow();
        await repo.reprocessYarasoftInvoice(18);
        await repo.fetchYarasoftInvoiceDetail(18);
        await repo.fetchYarasoftReview(true);
        await repo.resolveYarasoftReview(31, 42);
        await repo.fetchYarasoftOracleStatus();
        await repo.testYarasoftOracle();
        await repo.pollYarasoftOracleNow();
        await repo.previewYarasoftOracleItems();
        await repo.importYarasoftOracleItems();
        await repo.fetchYarasoftOracleReconcile(120);
        await repo.fetchYarasoftOracleCatchUpStatus();
        await repo.startYarasoftOracleCatchUp(14);
        await repo.previewYarasoftInvoiceText('invoice;line');
        expect(() => repo.previewYarasoftInvoiceText('  ')).toThrow('ألصق محتوى ملف فاتورة للمعاينة أولاً.');
        expect(() => repo.previewYarasoftInvoiceText('x'.repeat(2 * 1024 * 1024))).toThrow('حجم محتوى المعاينة يتجاوز الحد الأقصى للخادم (2 ميغابايت).');
        await repo.fetchYarasoftMirrorCashiers('2026-10-17');
        await repo.fetchYarasoftMirrorOrders({ date: '2026-10-17', cashier: '4', limit: 1000, offset: -1 });
        await repo.fetchYarasoftMirrorOrder('100/1');
        await repo.fetchYarasoftMirrorClose({ date: '2026-10-17', cashier: '4' });
        await repo.refreshYarasoftMirror();
        await repo.searchYarasoftProducts('  منتج  ');
        await repo.fetchYarasoftMappings();
        await repo.saveYarasoftMapping({ externalCode: 'YS-1', internalProductId: 42 });
        await repo.deactivateYarasoftMapping(11);
        await repo.fetchYarasoftSectionMap();
        await repo.fetchYarasoftSectionInvoices(7, { page: 3, limit: 200, dateFrom: '2026-10-01', query: 'فاتورة' });
        await repo.fetchYarasoftSectionInvoiceDetail('ora:CC:100');
        await repo.reclassifyYarasoftRevenue([1, 1, -4, '2'], 8);
        await repo.renameYarasoftSection(7, { displayAr: 'مبيعات', displayEn: 'Sales' });
        await repo.createYarasoftManualSection({ displayAr: 'منفذ يدوي' });
        await repo.fetchYarasoftUnmappedSections();
        await repo.approveYarasoftSection(9, { displayAr: 'قسم جديد' });

        expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
            'GET /yarasoft/status',
            'GET /yarasoft/log?limit=500',
            'POST /yarasoft/run-now',
            'POST /yarasoft/reprocess/18',
            'GET /yarasoft/log/18/detail',
            'GET /yarasoft/review?open=1',
            'POST /yarasoft/review/31/resolve',
            'GET /yarasoft/oracle/status',
            'POST /yarasoft/oracle/test',
            'POST /yarasoft/oracle/poll-now',
            'GET /yarasoft/oracle/import-items/preview',
            'POST /yarasoft/oracle/import-items',
            'GET /yarasoft/oracle/reconcile?days=90',
            'GET /yarasoft/oracle/catch-up/status',
            'POST /yarasoft/oracle/catch-up',
            'POST /yarasoft/dry-run-preview',
            'GET /yarasoft/mirror/cashiers?date=2026-10-17',
            'GET /yarasoft/mirror/orders?date=2026-10-17&cashier=4&limit=200&offset=0',
            'GET /yarasoft/mirror/orders/100%2F1',
            'GET /yarasoft/mirror/close?cashier=4&date=2026-10-17',
            'POST /yarasoft/mirror/refresh',
            'GET /yarasoft/mappings',
            'POST /yarasoft/mappings',
            'DELETE /yarasoft/mappings/11',
            'GET /yarasoft/sections/map',
            'GET /yarasoft/sections/invoices?map_id=7&page=3&limit=100&date_from=2026-10-01&q=%D9%81%D8%A7%D8%AA%D9%88%D8%B1%D8%A9',
            'GET /yarasoft/sections/invoice-detail?ref=ora%3ACC%3A100',
            'POST /yarasoft/sections/reclassify',
            'POST /yarasoft/sections/map/7/rename',
            'POST /yarasoft/sections/manual',
            'GET /yarasoft/sections/unmapped',
            'POST /yarasoft/sections/unmapped/9/approve',
        ]);
        const bodyFor = (url, method = 'POST') => JSON.parse(calls.find((call) => call.url === url && call.method === method).body);
        expect(bodyFor('/yarasoft/review/31/resolve')).toEqual({ internalProductId: 42 });
        expect(bodyFor('/yarasoft/oracle/catch-up')).toEqual({ days: 14 });
        expect(bodyFor('/yarasoft/dry-run-preview')).toEqual({ text: 'invoice;line' });
        expect(bodyFor('/yarasoft/mirror/refresh')).toEqual({});
        expect(bodyFor('/yarasoft/mappings')).toEqual({ externalCode: 'YS-1', externalBarcode: '', internalProductId: 42 });
        expect(bodyFor('/yarasoft/sections/reclassify')).toEqual({ revenue_ids: [1, 2], to_map_id: 8 });
        expect(bodyFor('/yarasoft/sections/unmapped/9/approve')).toEqual({ displayAr: 'قسم جديد', displayEn: '' });
        expect(inventoryCalls).toEqual([{ q: 'منتج', maxPages: 2 }]);
        expect(repo.canWriteYarasoft('admin')).toBe(true);
        expect(repo.canWriteYarasoft('manager')).toBe(true);
        expect(repo.canWriteYarasoft('auditor')).toBe(false);
    });

    test('screen exposes review and pending sections without granting writes to readers', () => {
        const screen = loadEsm(SCREEN, {}, ['template']);
        const readerMarkup = screen.template(false);
        const writerMarkup = screen.template(true);
        expect(readerMarkup).toContain('data-ys-tab="review"');
        expect(readerMarkup).toContain('data-ys-tab="sections"');
        expect(readerMarkup).toContain('data-ys-tab="oracle"');
        expect(readerMarkup).toContain('data-ys-tab="tools"');
        expect(readerMarkup).toContain('data-ys-tab="mirror"');
        expect(readerMarkup).not.toContain('data-ys-run');
        expect(writerMarkup).toContain('data-ys-run');
        expect(fs.readFileSync(ROUTES, 'utf8')).toContain("router.post('/review/:id/resolve'");
        expect(fs.readFileSync(ROUTES, 'utf8')).toContain("router.post('/sections/unmapped/:id/approve'");
    });
});
