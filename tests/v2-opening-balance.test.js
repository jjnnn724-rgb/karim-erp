const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'data', 'opening-balance-repo.js');
const SCREEN = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'screens', 'warehouse.js');
const source = fs.readFileSync(REPO, 'utf8')
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/^export\s+/gm, '');

function loadRepo(apiFetch = jest.fn()) {
    const context = {
        apiFetch,
        importCell(value) {
            return value === null || value === undefined ? '' : String(value).trim();
        },
        importNumber(value, fallback = 0) {
            if (value === null || value === undefined || value === '') {return fallback;}
            const parsed = Number(String(value).replace(/,/g, '').trim());
            return Number.isFinite(parsed) ? parsed : fallback;
        },
        mergeItemKey(value) {
            return String(value || '').toLowerCase().replace(/\s/g, '');
        },
        sheetExpiryCell(value) {
            return typeof value === 'number' ? '2027-06-30' : String(value || '');
        },
        normalizeExpiryDate(value) {
            const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
            return match ? match[1] : null;
        },
    };
    vm.createContext(context);
    vm.runInContext(`${source}; Object.assign(globalThis, {
        OPENING_WRITE_ROLES, OPENING_NET_ROLES, validateOpeningRows,
        parseOpeningSheetRows, openingNetQuantity, openingInvoicePayload,
        fetchOpeningIssuedTotals, createOpeningInvoice,
    });`, context, { filename: REPO });
    return context;
}

describe('V2 opening-balance input and net stock', () => {
    test('validates quantities, duplicate names, and meat-only cartons — expiry is optional', () => {
        const repo = loadRepo();
        const result = repo.validateOpeningRows([
            { name: 'دجاج', qty: '10', unit: 'كجم', price: '25', boxes: '2', category: 'لحوم', expiry: '2027-06-30' },
            { name: 'أرز', qty: '5', price: '3', boxes: '1', category: 'حبوب', expiry: '2027-06-30' },
            { name: 'دجاج', qty: '2', price: '25', category: 'لحوم', expiry: '2027-06-30' },
            { name: 'زيت', qty: '0', price: '8', expiry: '' },
        ]);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ name: 'دجاج', qty: 10, boxes: 2, expiry: '2027-06-30' });
        expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
            expect.stringContaining('اللحوم فقط'),
            expect.stringContaining('مكرر'),
            expect.stringContaining('أكبر من صفر'),
        ]));
    });

    test('parses named columns even with title rows and reports Excel row numbers', () => {
        const repo = loadRepo();
        const result = repo.parseOpeningSheetRows([
            ['رصيد افتتاحي'],
            ['اسم الصنف', 'الوحدة', 'كمية فعلية', 'سعر الشراء', 'الكراتين', 'الفئة', 'تاريخ الصلاحية'],
            ['دجاج', 'كجم', 10, 25, 2, 'لحوم', '2027-06-30'],
            ['أرز', 'كيس', 5, 3, '', 'حبوب', ''],
        ]);

        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toMatchObject({ name: 'دجاج', qty: 10, price: 25, boxes: 2 });
        expect(result.rows[1]).toMatchObject({ name: 'أرز', expiry: '' });
        expect(result.errors).toEqual([]);
    });

    test('calculates net stock and builds a credit invoice without cash payment', () => {
        const repo = loadRepo();
        expect(repo.openingNetQuantity(10, 2.5)).toBe(7.5);
        expect(repo.openingNetQuantity(2, 3)).toBe(-1);

        const payload = repo.openingInvoicePayload([
            { name: 'دجاج', qty: 10, unit: 'كجم', price: 25, category: 'لحوم', expiry: '2027-06-30', boxes: 2 },
        ], { invoiceNumber: 'OPEN-1', date: '2027-01-01' });
        expect(payload).toMatchObject({
            invoiceNumber: 'OPEN-1',
            paymentMethod: 'credit',
            paidAmount: 0,
            items: [{ itemName: 'دجاج', qty: 10, expiryDate: '2027-06-30', packagingQty: 2 }],
        });
    });

    test('wires the opening-balance panel, file preview, role checks, and submit handler', () => {
        const screen = fs.readFileSync(SCREEN, 'utf8');
        expect(screen).toContain("if (kind === 'opening') {");
        expect(screen).toContain('data-v2-opening-add');
        expect(screen).toContain('data-v2-opening-apply');
        expect(screen).toContain('previewOpeningFile(event.target.files && event.target.files[0])');
        expect(screen).toContain("else if (panelKind === 'opening') {submitOpeningBalance();}");
        expect(screen).toContain("OPENING_WRITE_ROLES.includes(role)");
        expect(screen).toContain("if (net < 0)");
    });

    test('uses the documented role gates and exact server endpoints', async () => {
        const apiFetch = jest.fn(async (url) => {
            if (url === '/warehouse/issued-totals') {return { items: [{ itemName: 'دجاج', issued: 4 }] };}
            return { ok: true };
        });
        const repo = loadRepo(apiFetch);

        expect(Array.from(repo.OPENING_WRITE_ROLES)).toEqual(['admin', 'manager', 'warehouse']);
        expect(Array.from(repo.OPENING_NET_ROLES)).toEqual(['admin']);
        expect(await repo.fetchOpeningIssuedTotals()).toEqual([{ name: 'دجاج', issued: 4 }]);
        await repo.createOpeningInvoice([], { invoiceNumber: 'OPEN-1', date: '2027-01-01' });
        expect(apiFetch.mock.calls.map(([url]) => url)).toEqual([
            '/warehouse/issued-totals',
            '/warehouse/purchase-invoices',
        ]);
        expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toMatchObject({
            paymentMethod: 'credit',
            paidAmount: 0,
        });
    });
});
