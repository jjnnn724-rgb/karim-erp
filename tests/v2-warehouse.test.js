/**
 * v2-warehouse.test.js — عقد شاشة 03 «المخزون» في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-employees.test.js: browser ESM files under
 * jest with testEnvironment:'node', so the repository runs inside a vm with its
 * one dependency (apiFetch) stubbed, and the screen is asserted as a source
 * contract.
 *
 * What is pinned here is the part nobody can eyeball in a browser:
 *   • the state rule is copied from the server's SQL, not from the legacy
 *     screen — `low` is qty<=minQty (inclusive), and a missing minQty is COALESCE
 *     to zero (warehouse-routes.js:1748-1750). If this file and the server
 *     disagreed, the segmented control would return rows the badge calls `ok`.
 *   • the allowlist — every row arrives with `avgCost`; the register on this
 *     screen is quantitative, so a money figure must never reach the DOM
 *     without a currency code this host does not have
 *   • one walk is bounded: limit=200 (the server's own clamp), at most
 *     MAX_PAGES calls, and `truncated` is true the moment the ceiling bites
 *   • the two search boxes have different jobs: the header one asks the server
 *     (Arabic letter-family fallback lives server-side), the table one refines
 *     what loaded — so the table runs in client mode, and a fuzzy answer is
 *     admitted in words
 *   • no inline handlers (CSP nonce), payload strings escaped, unresolved shelf
 *     ids shown as the numbers they are, and one click cannot stack two walks
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { evalV2Module } = require('./v2-esm-harness');

/** سياسة الصلاحية الحقيقية (وحدة ESM نقية) — محقونة في كل سياق بدل مرآة يدوية. */
const EXPIRY = evalV2Module('data/expiry-policy.js');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'inventory-repo.js');
const SCREEN = path.join(V2, 'screens', 'warehouse.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const MIGRATION = path.join(V2, 'MIGRATION.md');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    // `export const X` becomes a lexical binding that never lands on the vm's
    // global object, so the harness publishes the named bindings itself.
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        Set, Map, Intl, URLSearchParams,
        normalizeExpiryDate: EXPIRY.normalizeExpiryDate,
        readExpiryField: EXPIRY.readExpiryField,
        checkExpiryOnLines: EXPIRY.checkExpiryOnLines,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const EXPORTS = ['STOCK_FILTERS', 'fetchInventory', 'fetchShelves', 'shelfMap', 'formatInt',
    'formatQty', 'stockState', 'inventoryToRow', 'rowFields', 'stockPill', 'countBy',
    'categoryCounts', 'stateCounts', 'shortageRows', 'buildInventoryKpis'];

/** W1-6: the six write doors and the audit studio, on top of the read exports. */
const AUDIT_EXPORTS = [...EXPORTS,
    'INV_WRITE_ROLES', 'INV_FORCE_ROLES', 'INV_DIRECT_ROLES', 'INV_MERGE_ROLES',
    'AUDIT_WRITE_ROLES', 'AUDIT_READ_ROLES', 'BULK_CHUNK',
    'invWriteVisible', 'invForceVisible', 'invDirectVisible', 'invMergeVisible',
    'auditWriteVisible', 'auditReadVisible',
    'receiptPayload', 'receiveInventoryItem', 'bulkReceiptRows', 'bulkReceiveInventory',
    'deleteInventoryItem', 'forceDeleteInventoryItem', 'hasMovementsError',
    'directEditError', 'directEditPayload', 'directEditInventoryItem',
    'mergeItemKey', 'duplicateGroups', 'mergeInventoryItems',
    'AUDIT_PERIOD_TYPES', 'scopeFilterOf', 'auditPeriodError', 'startAuditPayload',
    'fetchAuditLocations', 'fetchAuditPreview', 'fetchAudits', 'fetchAuditDetail',
    'startAuditSession', 'saveAuditCount', 'clearAuditCount',
    'submitAuditSession', 'approveAuditSession', 'cancelAuditSession',
    'AUDIT_STATUSES', 'auditState', 'auditToRow', 'auditItemToRow',
    'auditSummaryOf', 'scopePreviewText'];

/** The money rule of reports-repo.js:179-186, copied so the preview text is
 *  asserted against the same two-decimal arithmetic the screen sees. */
function moneyStub(v, currency) {
    const n = Number(v);
    const amount = (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const unit = String(currency ?? '').trim();
    return { amount, unit, hasUnit: !!unit };
}

/** A W1-6 repository instance: both imports stubbed, every call recorded. */
function auditRepo(plan = {}) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(opts ? { path: p, method: opts.method, body: opts.body } : { path: p });
        if (plan[p] !== undefined) {return plan[p];}
        return plan.default !== undefined ? plan.default : {};
    });
    return { calls, repo: loadEsm(REPO, { apiFetch, formatMoney: moneyStub }, AUDIT_EXPORTS) };
}

/**
 * A server-shaped stub: it answers one envelope per page, so the walk's stop
 * rules are what is under test, not the fake.
 * @param {{total:number,pages?:number,rows?:number}} plan
 */
function inventoryStub(plan) {
    const calls = [];
    const apiFetch = jest.fn(async (p) => {
        const page = calls.length + 1;
        calls.push(p);
        const size = plan.rows ?? 200;
        return {
            data: Array.from({ length: size }, (_, i) => ({
                id: (page - 1) * 200 + i + 1, name: `صنف ${i}`, qty: 1, minQty: 1,
            })),
            pagination: { page, limit: 200, total: plan.total, pages: plan.pages ?? Math.ceil(plan.total / 200) },
            categories: ['أغذية'],
            fuzzy: false,
        };
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }, EXPORTS) };
}

function shelfJoin(repo) {
    return repo.shelfMap([
        { id: 7, code: 'A-01', name: 'رف المطبخ' },
        { id: 8, code: 'B-02', name: 'رف المشروبات' },
    ]);
}

/** Rows that cover every branch the repository has to take. */
function register(repo) {
    const byId = shelfJoin(repo);
    return [
        { id: 1, name: 'أرز', category: 'أغذية', unit: 'كجم', qty: 3, mainQty: 2, minQty: 5, barcode: '6201', shelfId: 7 },
        { id: 2, name: 'سكر', category: 'أغذية', unit: 'كجم', qty: 4, mainQty: 4, minQty: 4, shelfId: 8 },
        { id: 3, name: '', category: '', unit: '', qty: 0, mainQty: 0, minQty: null, shelfId: 99 },
        { id: 4, name: 'زيت', category: 'بقالة', unit: 'ل', qty: -2, mainQty: 0, minQty: 10, shelfId: null },
        { id: 5, name: 'ثوم', category: 'أغذية', unit: 'كجم', qty: 8, mainQty: 12, minQty: 0, shelfId: 7 },
        { id: 6, name: 'لبن', category: 'ألبان', unit: 'ل', qty: 20, mainQty: 20, minQty: null, weight: 20.5, shelfId: 8 },
    ].map((r) => repo.inventoryToRow(r, byId));
}

describe('V2 inventory repository — the server rule, the allowlist, the bounds', () => {
    test('the stock enum sent to the server is the server enum, verbatim', () => {
        const { repo } = inventoryStub({ total: 0 });
        expect(repo.STOCK_FILTERS).toEqual(['all', 'low', 'out', 'ok']);
    });

    test('a state is the server SQL: low is inclusive and a null minimum is zero', () => {
        const { repo } = inventoryStub({ total: 0 });
        expect(repo.stockState(0, 5).key).toBe('out');
        expect(repo.stockState(-2, 10).key).toBe('out');       // negative balances as stored
        expect(repo.stockState(5, 5).key).toBe('low');         // qty<=minQty, NOT legacy's strict <
        expect(repo.stockState(4, 5).key).toBe('low');
        expect(repo.stockState(6, 5).key).toBe('ok');
        expect(repo.stockState(20, null).key).toBe('ok');      // COALESCE(minQty,0)
        expect(repo.stockState(20, null).untracked).toBe(true);
        expect(repo.stockState(20, 5).untracked).toBe(false);
        expect(repo.stockState(0, 0).key).toBe('out');         // zero is never "untracked ok"
        expect(repo.stockState(5, 5).raw).toMatch('≤');
    });

    test('every state carries the tone/icon/label the badge renders', () => {
        const { repo } = inventoryStub({ total: 0 });
        for (const s of [repo.stockState(0, 1), repo.stockState(1, 1), repo.stockState(9, 1)]) {
            expect(s.label && s.tone && s.icon && s.raw).toBeTruthy();
        }
        expect(repo.stockState(0, 1).tone).toBe('danger');
        expect(repo.stockState(1, 1).tone).toBe('warning');
        expect(repo.stockState(9, 1).tone).toBe('success');
    });

    test('a raw API row leaves with the declared allowlist — and never with a cost', () => {
        const { repo } = inventoryStub({ total: 0 });
        const raw = {
            id: 9, name: 'قهوة', category: 'مشروبات', unit: 'كجم', qty: 2, mainQty: 1,
            minQty: 3, weight: 2, barcode: '620', shelfId: 7,
            avgCost: 9000, cost: 9000, totalValue: 9000, value: 9000, price: 9000, unit_cost: 9000,
        };
        const row = repo.inventoryToRow(raw, shelfJoin(repo));
        expect(Object.keys(row).sort()).toEqual([...repo.rowFields].sort());
        expect(repo.rowFields).not.toContain('avgCost');
        expect(JSON.stringify(row)).not.toMatch('9000');
        expect(JSON.stringify(row)).not.toMatch(/avgCost|totalValue|unit_cost/i);
    });

    test('main balance and department balance are read the legacy screen reads them', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        expect(rows[0].mainQty).toBe(2);
        expect(rows[0].deptQty).toBe(1);            // 3 − 2
        expect(rows[0].mainFromJoin).toBe(true);
        // No MAIN-WAREHOUSE line: the total is what is known, and the screen says so.
        expect(rows[1].mainFromJoin).toBe(true);
        const noMain = repo.inventoryToRow({ id: 1, name: 'ملح', qty: 4 }, shelfJoin(repo));
        expect(noMain.mainFromJoin).toBe(false);
        expect(noMain.mainQty).toBe(4);
        expect(noMain.deptQty).toBe(0);
        // A main balance above the total is kept as a flag, and dept never goes negative.
        expect(rows[4].mainOverTotal).toBe(true);
        expect(rows[4].deptQty).toBe(0);
        expect(rows[4].mainQty).toBe(12);
        expect(rows[4].qty).toBe(8);
    });

    test('a shelf is a join: an unknown id stays the id, an empty one stays empty', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        expect(rows[0].shelf).toBe('A-01');
        expect(rows[0].shelfName).toBe('رف المطبخ');
        expect(rows[0].shelfResolved).toBe(true);
        expect(rows[2].shelfId).toBe('99');
        expect(rows[2].shelf).toBe('99');
        expect(rows[2].shelfResolved).toBe(false);
        expect(rows[3].shelfId).toBe('');
        expect(rows[3].shelf).toBe('');
        expect(rows[3].shelfResolved).toBe(false);
        // An empty register cannot resolve anything, and must not crash on it.
        const bare = repo.inventoryToRow({ id: 1, name: 'شاي', shelfId: 7 }, repo.shelfMap([]));
        expect(bare.shelfResolved).toBe(false);
        expect(bare.shelf).toBe('7');
    });

    test('a missing name is the record number, never a guess', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        expect(rows[2].name).toBe('#3');
        expect(rows[2].nameResolved).toBe(false);
        expect(rows[0].nameResolved).toBe(true);
        expect(repo.inventoryToRow({}, shelfJoin(repo)).name).toBe('#؟');
    });

    test('nulls and numbers: an absent weight is null, a stored one keeps its decimals', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        expect(rows[0].weight).toBeNull();
        expect(rows[5].weight).toBe(20.5);
        expect(rows[5].minQty).toBeNull();
        expect(repo.formatQty(20.5)).toBe('20.5');
        expect(repo.formatQty(2.5)).toBe('2.5');
        expect(repo.formatQty(1234.5678)).toBe('1,234.568');   // a kg line is not an integer
        expect(repo.formatQty(null)).toBe('0');
        expect(repo.formatInt(1234)).toBe('1,234');
        expect(repo.formatInt('7.6')).toBe('8');
    });

    test('one walk is bounded by the server clamp and stops at the ceiling it names', async () => {
        const { calls, repo } = inventoryStub({ total: 2500 });
        const res = await repo.fetchInventory({});
        expect(calls).toHaveLength(10);                     // MAX_PAGES, hard stop
        expect(res.rows).toHaveLength(2000);
        expect(res.total).toBe(2500);
        expect(res.truncated).toBe(true);                   // the screen must say so
        expect(res.categories).toEqual(['أغذية']);
    });

    test('the walk stops when the server says it counted the last page', async () => {
        const { calls, repo } = inventoryStub({ total: 400, pages: 2, rows: 200 });
        const res = await repo.fetchInventory({});
        expect(calls).toHaveLength(2);
        expect(res.rows).toHaveLength(400);
        expect(res.truncated).toBe(false);
    });

    test('a short page or an empty page is the end of the walk', async () => {
        const short = inventoryStub({ total: 450, rows: 50 });
        const a = await short.repo.fetchInventory({});
        expect(short.calls).toHaveLength(1);
        expect(a.rows).toHaveLength(50);
        expect(a.truncated).toBe(true);                     // 450 in the register, 50 loaded
        const empty = inventoryStub({ total: 0, rows: 0 });
        const b = await empty.repo.fetchInventory({});
        expect(empty.calls).toHaveLength(1);
        expect(b.rows).toHaveLength(0);
        expect(b.truncated).toBe(false);                    // nothing was cut off
        expect(b.total).toBe(0);
    });

    test('the query the walk sends is the server query, capped and defaulted', async () => {
        const { calls, repo } = inventoryStub({ total: 0 });
        await repo.fetchInventory({ q: 'ب'.repeat(140), category: 'أغذية', stock: 'low' });
        const first = new URLSearchParams(calls[0].split('?')[1]);
        expect(first.get('limit')).toBe('200');             // the server's clamp (:1734)
        expect(first.get('page')).toBe('1');
        expect(first.get('stock')).toBe('low');
        expect(first.get('category')).toBe('أغذية');
        expect(first.get('q')).toHaveLength(100);           // the server's cap (:1724)
        const defaults = inventoryStub({ total: 0 });
        await defaults.repo.fetchInventory({});
        const d = new URLSearchParams(defaults.calls[0].split('?')[1]);
        expect(d.get('stock')).toBe('all');
        expect(d.get('category')).toBe('all');
        expect(d.get('q')).toBe('');
    });

    test('an unknown stock filter is refused before it costs a 422', async () => {
        const { calls, repo } = inventoryStub({ total: 0 });
        await expect(repo.fetchInventory({ stock: 'maybe' })).rejects.toThrow('القيم المتاحة');
        expect(calls).toHaveLength(0);
    });

    test('a fuzzy answer is carried up, not silently flattened', async () => {
        const calls = [];
        const apiFetch = jest.fn(async () => {
            calls.push(1);
            return { data: [{ id: 1, name: 'باذنجان', qty: 1 }], pagination: { total: 1, pages: 1 }, categories: [], fuzzy: true };
        });
        const repo = loadEsm(REPO, { apiFetch }, EXPORTS);
        const res = await repo.fetchInventory({ q: 'بازنجان' });
        expect(res.fuzzy).toBe(true);
        expect(calls).toHaveLength(1);
    });

    test('the reads are bounded walks and the writes are exactly the six named doors', async () => {
        const shelves = [];
        const apiFetch = jest.fn(async (p) => {
            shelves.push(p);
            return { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { totalPages: 4 } };
        });
        const repo = loadEsm(REPO, { apiFetch }, EXPORTS);
        const rows = await repo.fetchShelves();
        expect(rows).toHaveLength(3000);                    // three pages, hard stop
        expect(shelves.every((p) => p.startsWith('/shelves?'))).toBe(true);
        expect(shelves.every((p) => p.includes('limit=1000') && p.includes('sort=id'))).toBe(true);
        expect(shelves).toHaveLength(3);
        const { calls, repo: r2 } = inventoryStub({ total: 0 });
        await r2.fetchInventory({});
        expect(calls.every((p) => p.startsWith('/warehouse/inventory/search?'))).toBe(true);
        // W1-6 بأمر المالك: الكتابة فُتحت — لكن حصرًا من الأبواب المعلنة.
        // كل نداء write في المستودع يجب أن يطابق (ميثود + شكل مسار) من القائمة،
        // والقائمة نفسها تُقارن كمجموعة كاملة — لا باب زائد ولا ناقص.
        // 26c أضاف الباب السابع: إنشاء صنف الكتالوج من الـCRUD العام.
        const src = fs.readFileSync(REPO, 'utf8');
        const writeCalls = [...src.matchAll(/apiFetch\((['`])([^'`]+)['`]\s*,\s*\{\s*method:\s*'([A-Z]+)'/g)]
            .map((m) => `${m[3]} ${m[2].replace(/\$\{[^}]+\}/g, '{}')}`);
        expect(new Set(writeCalls)).toEqual(new Set([
            'POST /warehouse/inventory/{}/receipt',                       // وارد سريع (:1584)
            'POST /warehouse/inventory/bulk-receipt',                     // استيراد دفعي (:1637)
            'POST /inventory',                                            // كتالوج الأصناف (features/warehouse.js:2384)
            'DELETE /inventory/{}',                                       // حذف عادي (server.js:2286)
            'DELETE /warehouse/inventory/{}/force',                       // حذف نهائي (:2423)
            'PUT /warehouse/inventory/{}/direct',                         // تعديل مباشر (:2480)
            'POST /warehouse/inventory/merge',                            // دمج المكرر (:2545)
            'POST /warehouse/inventory/audits',                           // بدء جلسة جرد (:121)
            'PUT /warehouse/inventory/audits/{}/counts/{}',               // حفظ عدّ (:290)
            'DELETE /warehouse/inventory/audits/{}/counts/{}',            // مسح عدّ (:378)
            'POST /warehouse/inventory/audits/{}/submit',                 // إرسال (:199)
            'POST /warehouse/inventory/audits/{}/approve',                // اعتماد (:221)
            'POST /warehouse/inventory/audits/{}/cancel',                 // إلغاء (:413)
        ]));
    });

    test('counts keep the stored spelling, including the empty category', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        const cats = repo.categoryCounts(rows);
        expect(cats.find((c) => c.value === 'أغذية').count).toBe(3);
        expect(cats.map((c) => c.count).reduce((s, n) => s + n, 0)).toBe(6);
        expect(cats.some((c) => c.value === '')).toBe(true);
        // Two spellings of one category are two rows, because the register says so.
        const two = repo.categoryCounts([
            repo.inventoryToRow({ id: 1, name: 'أ', category: 'قهوه' }),
            repo.inventoryToRow({ id: 2, name: 'ب', category: 'قهوة' }),
        ]);
        expect(two).toHaveLength(2);
    });

    test('state counts always have all four keys, so a zero reads as a zero', () => {
        const { repo } = inventoryStub({ total: 0 });
        expect(Object.keys(repo.stateCounts([])).sort()).toEqual(['low', 'ok', 'out', 'untracked']);
        const c = repo.stateCounts(register(repo));
        expect(c).toEqual({ low: 2, out: 2, ok: 2, untracked: 2 });
        expect(JSON.stringify(c)).not.toMatch('null');
    });

    test('the shortage list holds every low and out row and nothing else', () => {
        const { repo } = inventoryStub({ total: 0 });
        const names = repo.shortageRows(register(repo)).map((g) => g.name).sort();
        expect(names).toEqual(['#3', 'أرز', 'زيت', 'سكر']);   // 'لبن' and 'ثوم' are ok
    });

    test('shortage gaps are arithmetic and respect the limit', () => {
        const { repo } = inventoryStub({ total: 0 });
        const rows = register(repo);
        const gaps = repo.shortageRows(rows);
        expect(gaps[0].name).toBe('زيت');                     // biggest gap first
        expect(gaps[0].short).toBe(12);                       // min 10 − the stored −2
        expect(gaps[0].stateKey).toBe('out');
        const rice = gaps.find((g) => g.name === 'أرز');
        expect(rice.short).toBe(2);                           // min 5 − qty 3
        // 'سكر' sits exactly at its minimum: low, with nothing missing.
        expect(gaps.find((g) => g.name === 'سكر').short).toBe(0);
        expect(gaps.map((g) => g.short)).toEqual([...gaps.map((g) => g.short)].sort((a, b) => b - a));
        expect(repo.shortageRows(rows, 1)).toHaveLength(1);
        expect(repo.shortageRows([])).toEqual([]);
    });

    test('a share needs a real base: an empty result is a stated dash, not 0% of nothing', () => {
        const { repo } = inventoryStub({ total: 0 });
        const none = repo.stockPill(0, 0, 'نفد');
        expect(none.text).toBe('—');
        expect(none.on).toBe(false);
        expect(none.aria).toMatch('لا أصناف');
        const some = repo.stockPill(3, 8, 'نفد');
        expect(some.text).toBe('37.5%');
        expect(some.aria).toMatch('3 من 8 صنفًا');
    });

    test('chips are arithmetic over the rows: one per state plus the case states hide', () => {
        const { repo } = inventoryStub({ total: 0 });
        const chips = repo.buildInventoryKpis(register(repo), { scope: 'السجل كله', registerTotal: 6 });
        const ids = chips.map((c) => c.id);
        expect(ids).toEqual(['total', 'state:low', 'state:out', 'state:ok', 'untracked', 'no-shelf']);
        expect(chips.find((c) => c.id === 'total').value).toBe('6');
        expect(chips.find((c) => c.id === 'total').pill.text).toBe('6');
        expect(chips.find((c) => c.id === 'state:low').value).toBe('2');
        expect(chips.find((c) => c.id === 'state:low').hint).toMatch('warehouse-routes.js:1749');
        expect(chips.find((c) => c.id === 'untracked').value).toBe('2');
        expect(chips.find((c) => c.id === 'no-shelf').value).toBe('1');      // the null shelfId row
        expect(chips.find((c) => c.id === 'no-shelf').hint).toMatch('لم يُحلّ');  // id 99 is unresolved
        expect(chips.every((c) => c.label && c.en && c.icon && c.tone)).toBe(true);
        expect(chips.every((c) => c.pill.text && c.hint && c.pill.aria)).toBe(true);
        expect(JSON.stringify(chips)).not.toMatch('NaN');
    });

    test('the ceiling changes the wording of the total chip instead of hiding itself', () => {
        const { repo } = inventoryStub({ total: 0 });
        const chips = repo.buildInventoryKpis(register(repo), { registerTotal: 2500, truncated: true });
        const total = chips.find((c) => c.id === 'total');
        expect(total.hint).toMatch('سقف الجلب');
        expect(total.hint).toMatch('2,500');
        expect(total.pill.on).toBe(true);                   // 6 loaded ≠ 2,500 registered
    });

    test('an empty register yields zeros and stated dashes, never NaN', () => {
        const { repo } = inventoryStub({ total: 0 });
        const chips = repo.buildInventoryKpis([]);
        expect(chips.find((c) => c.id === 'total').value).toBe('0');
        // The total chip counts the register it was told about; the shares have
        // no base, so they are dashes and say so.
        expect(chips.find((c) => c.id === 'total').pill.text).toBe('0');
        expect(chips.find((c) => c.id === 'total').pill.on).toBe(false);
        expect(chips.find((c) => c.id === 'total').pill.aria).toMatch('لا أصناف');
        expect(chips.filter((c) => c.id !== 'total').every((c) => c.pill.text === '—')).toBe(true);
        // A vacuous zero is not a clean bill of health.
        expect(chips.find((c) => c.id === 'untracked').hint).toMatch('النتيجة فارغة');
        expect(chips.find((c) => c.id === 'no-shelf').hint).toMatch('النتيجة فارغة');
        expect(JSON.stringify(chips)).not.toMatch('NaN');
        expect(repo.categoryCounts([])).toEqual([]);
        expect(repo.shortageRows([])).toEqual([]);
        expect(repo.shelfMap([null, undefined, {}, { id: 0 }]).size).toBe(1);
    });
});

describe('V2 warehouse screen + layer (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener\('click'/);
        expect(screen()).toMatch(/addEventListener\('change'/);
        expect(screen()).toMatch(/addEventListener\('input'/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/inventory-repo\.js\?v=/);
    });

    test('only allowlisted columns reach the table, and no money column', () => {
        // W1-6b declared change: the register gained ONE non-data column —
        // «إجراءات» (وارد/تعديل/حذف), runtime-gated by invWriteVisible/
        // invDirectVisible. It carries buttons only; no value flows through it.
        const keys = [...screen().matchAll(/\bkey: '([a-zA-Z]+)'/g)].map((m) => m[1]);
        expect(new Set(keys)).toEqual(new Set(['name', 'category', 'unit', 'mainQty', 'deptQty',
            'qty', 'minQty', 'weight', 'shelf', 'stateKey', 'actions']));
        expect(screen()).not.toMatch(/\.avgCost|\.totalValue|\.unit_cost/);
    });

    test('the state column sorts by severity, not by the Arabic string', () => {
        const s = screen();
        expect(s).toMatch(/const SEVERITY = \{ out: 0, low: 1, ok: 2 \}/);
        expect(s).toMatch(/value: \(row\) => SEVERITY\[row\.stateKey\]/);
    });

    test('every payload string reaching the DOM is escaped', () => {
        const s = screen();
        expect(s).toMatch(/esc\(row\.name\)/);
        expect(s).toMatch(/esc\(row\.shelf \|\| row\.shelfName/);
        expect(s).toMatch(/esc\(row\.category\)/);
        expect(s).toMatch(/esc\(row\.unit\)/);
        expect(s).toMatch(/esc\(row\.barcode\)/);
        expect(s).toMatch(/esc\(state\.label\)/);
        expect(s).toMatch(/esc\(state\.raw\)/);
        expect(s).toMatch(/esc\(k\.hint\)/);
        expect(s).toMatch(/esc\(k\.pill\.aria\)/);
        expect(s).toMatch(/title="\$\{esc\(opts\.title\)\}"/);
        expect(s).toMatch(/title="\$\{esc\(title\)\}"/);
        expect(s).toMatch(/option value="\$\{esc\(c\)\}"/);
    });

    test('the table is client mode over a server-filtered walk — both search boxes are declared', () => {
        const s = screen();
        expect(s).toMatch(/mode: 'client'/);
        expect(s).toMatch(/مربع «بحث» فوق الجدول يسأل الخادم/);
        expect(s).toMatch(/مربع البحث داخل الجدول يضيق/);
        expect(s).toMatch(/data-v2-q/);
    });

    test('the tolerance of the server search is admitted when the server used it', () => {
        const s = screen();
        expect(s).toMatch(/fuzzy && f\.q/);
        expect(s).toMatch(/البحث تسامحي/);
    });

    test('the state labels come from the repository rule, not from a second status table', () => {
        const s = screen();
        // status.js has no inventory domain — inventing one here would be a guess.
        expect(s).not.toMatch(/status\.js|resolveStatus/);
        expect(s).toMatch(/STOCK_FILTERS\.map/);
        expect(s).toMatch(/data-v2-stock="\$\{esc\(kind\)\}"/);
        expect(s).toMatch(/stateBadge\(row\.state\)/);
    });

    test('the filter that costs a request is the segmented control, and it reloads', () => {
        const s = screen();
        expect(s).toMatch(/data-v2-stockseg\] \[data-v2-stock\]\.is-active/);
        expect(s).toMatch(/q\('\[data-v2-stockseg\]'\)\.innerHTML = segBlock\(seg\.getAttribute\('data-v2-stock'\)\)/);
        expect(s.match(/reload\(\)/g).length).toBeGreaterThanOrEqual(5);
        // The segment is the only part of the head that repaints.
        expect(s).toMatch(/function segBlock\(activeStock\)/);
        expect(screen().match(/segBlock\(/g).length).toBeGreaterThanOrEqual(3);
    });

    test('category options are the DISTINCT list the server sends, never a spelling invented here', () => {
        const s = screen();
        expect(s).toMatch(/categoryOptions\(inv\.value\.categories\)/);
        expect(s).toMatch(/const keep = sel\.value/);
        expect(s).not.toMatch(/<option value="أغذية"/);
        expect(s).not.toMatch(/<option value="low"/);
    });

    // Live probe: the rebuild assigned innerHTML and then only *checked* keep,
    // so the select snapped back to «كل الفئات» while the walk had really asked
    // for a category — the next reload dropped the filter silently.
    test('a rebuilt category list carries the chosen value into the markup, not after it', () => {
        const s = screen();
        expect(s).toMatch(/<option value="all"\$\{keep === 'all' \? ' selected' : ''\}>/);
        expect(s).toMatch(/\$\{c === keep \? ' selected' : ''\}/);
        expect(s).not.toMatch(/sel\.value = 'all';/);
    });

    test('a filtered or truncated scope renames itself instead of posing as the register', () => {
        const s = screen();
        expect(s).toMatch(/سقف الجلب/);
        expect(s).toMatch(/من \$\{formatInt\(registerTotal\)\} صنفًا/);
        expect(s).toMatch(/محسوبة على/);
        expect(s).toMatch(/data-v2-filter-note/);
        expect(s).toMatch(/clearBtn\.hidden = !on/);
    });

    test('an unresolved shelf, a missing name and a clamped balance are shown as what they are', () => {
        const s = screen();
        expect(s).toMatch(/بلا رف مسجّل/);
        expect(s).toMatch(/لم يُحلّ إلى اسم/);
        expect(s).toMatch(/لا اسم مخزّن/);
        expect(s).toMatch(/رصيد الرئيسي أكبر من الإجمالي/);
        expect(s).toMatch(/لا حد أدنى مسجّل/);
        expect(s).toMatch(/data-v2-shelf-note/);
        expect(s).toMatch(/تعرض أرقامها|تُعرض أرقامها/);
    });

    test('the weight column does not invent a unit', () => {
        const s = screen();
        expect(s).toMatch(/السجل لا يحمل وحدته/);
        expect(s).toMatch(/qtyCell\(row\.weight, '', \{ title:/);
    });

    test('printing states its own limits and the button is the only print call', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        expect(s).toMatch(/data-v2-print-note/);
        expect(s).toMatch(/المطبوعة تعرض الصفحة الحالية/);
    });

    test('one click cannot stack two walks, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{queued = true; return;\}/);
        expect(s.split('el.isConnected').length - 1).toBeGreaterThanOrEqual(3);
        expect(s).toMatch(/destroy\(\) \{\s*if \(searchTimer\) \{clearTimeout/);
        // W1-6b declared change: a detach must also invalidate an open panel —
        // panelSeq bumps between the queued reset and the table teardown.
        expect(s).toMatch(/queued = false;\s*panelSeq \+= 1;[\s\S]{0,90}table\.destroy\(\);/);
        expect(s).toMatch(/table\.setLoading\(false\)/);
    });

    test('a rejected read is explained by the host, and empty is empty in both directions', () => {
        const s = screen();
        expect(s).toMatch(/Promise\.allSettled/);
        expect(s).toMatch(/if \(inv\.status === 'rejected'\) \{throw inv\.reason;\}/);
        expect(s).toMatch(/e\.message === 'UNAUTHORIZED'/);
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toMatch(/shelfNote\.hidden = false/);
        expect(s).toMatch(/لا أصناف في السجل/);
        expect(s).toMatch(/لا صنف يطابق الفلاتر/);
    });

    test('cost is excluded from the register out loud, not quietly', () => {
        // W1-6b declared change: the old sentence («ليسا في هذه الشاشة») became
        // false the moment the receipt and direct-edit forms landed. The claim
        // is now narrower and true: the REGISTER shows no cost, and the only
        // cost values on screen are the ones a user types into a write form.
        expect(screen()).toMatch(/تكلفة الأصناف وقيمتها ليستا معروضتين في السجل/);
        expect(screen()).toMatch(/التكلفة تدخل فقط بما يكتبه المستخدم في نماذج الكتابة/);
    });

    test('no sample figures on the live screen', () => {
        expect(screen()).not.toMatch('بيانات نموذجية');
    });

    test('the shared layer is untouched: no new component and no new colour', () => {
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(css()).not.toMatch(/rgba?\(/);
        expect(css()).toMatch(/03 المخزون/);
    });

    test('the warehouse head compacts on a phone like the other two screens', () => {
        const block = css().match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/\.erp-v2-warehouse \.erp-seg__label/);
        expect(block[0]).toMatch(/\.erp-v2-warehouse \.erp-filterbar/);
        expect(block[0]).toMatch(/\.erp-v2-warehouse \.erp-dash-controls \.erp-btn/);
        expect((block[0].match(/\.erp-v2-warehouse/g) || []).length).toBeGreaterThanOrEqual(7);
        expect(block[0]).toMatch(/\.erp-v2-employees/);
        expect(block[0]).toMatch(/\.erp-v2-attendance/);
    });

    test('the page loads the layer, versioned (Cloudflare caches CSS for 4h)', () => {
        const page = fs.readFileSync(V2_HTML, 'utf8');
        expect(page).toMatch(/css\/v2\/erp-hr\.css\?v=[0-9]+(\.[0-9]+)*/);
    });

    test('the host mounts, notifies and tears the screen down on navigation', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect(p).toMatch(/mountWarehouseScreen\(/);
        expect(p).toMatch(/warehouseScreen\.destroy\(\)/);
        expect(p).toMatch(/key === 'warehouse'/);
        expect(p).toMatch(/teardownWarehouseScreen\(\)/);
        expect(p).toMatch(/navStatus\.current !== 'warehouse'/);
        expect(p).toMatch(/noSessionState\('المخزون'\)/);
        // Non-live does not fake a register: its filters are the server's.
        expect(p).toMatch(/فلاترها \(الحالة والفئة والبحث المتسامح\) تُسأل الخادم/);
    });
});

describe('V2 inventory write layer — six doors + audit studio (W1-6)', () => {
    test('each door carries its server role list exactly, and the studio reads more than it writes', () => {
        const { repo } = auditRepo();
        expect(repo.INV_WRITE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(repo.INV_FORCE_ROLES).toEqual(['admin', 'warehouse']);        // لا مدير (:2423)
        expect(repo.INV_DIRECT_ROLES).toEqual(['admin']);
        expect(repo.INV_MERGE_ROLES).toEqual(['admin']);
        expect(repo.AUDIT_WRITE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(repo.AUDIT_READ_ROLES).toEqual(['admin', 'manager', 'warehouse', 'accountant']);
        expect(repo.auditReadVisible('accountant')).toBe(true);
        expect(repo.auditWriteVisible('accountant')).toBe(false);            // يقرأ ولا يعدّ ولا يعتمد
        expect(repo.invWriteVisible('accountant')).toBe(false);
        expect(repo.invForceVisible('manager')).toBe(false);                 // النهائي ليس للمدير
        expect(repo.invDirectVisible('warehouse')).toBe(false);
        expect(repo.invMergeVisible('manager')).toBe(false);
        expect(repo.BULK_CHUNK).toBe(20);                                    // ما تحمله مهلة apiFetch
    });

    test('a quick receipt sends what the user typed — the register row carries no cost to fall back on', () => {
        const { repo } = auditRepo();
        expect(repo.receiptPayload({}, '3', '7.25')).toEqual({ qty: 3, price: 7.25, unit: '', expiryDate: null });
        expect(repo.receiptPayload({ unit: 'كجم' }, '2', 0)).toEqual({ qty: 2, price: 0, unit: 'كجم', expiryDate: null });
        expect(repo.receiptPayload({}, 'abc', '5')).toEqual({ qty: 0, price: 5, unit: '', expiryDate: null });  // الخادم يعيد فحص qty>0 (:1602)
        const row = repo.inventoryToRow({ id: 1, name: 'أرز', qty: 1, unit: 'كجم', avgCost: 9.5 });
        expect(row.avgCost).toBeUndefined();                                 // سقط في قائمة السماح
        expect(repo.receiptPayload(row, '1', '').price).toBe(0);             // فلا تعبئة تلقائية بآخر تكلفة
        // سياسة المالك 2026-10-19: الصلاحية تُرسل كما كُتبت، والتالف يصير null لا تاريخًا مخترعًا.
        expect(repo.receiptPayload({}, '1', '2', '2026-11-30').expiryDate).toBe('2026-11-30');
        expect(repo.receiptPayload({}, '1', '2', '30/11/2026').expiryDate).toBeNull();
    });

    test('bulk rows take the legacy defaults and drop what the server would refuse', () => {
        const { repo } = auditRepo();
        expect(repo.bulkReceiptRows([
            { name: ' بطاطس ', qty: '5', price: '3' },
            { name: 'بصل', category: 'خضار', unit: 'كجم', qty: '2', price: '1.5', minQty: '9', expiryDate: '2026-12-01' },
            { name: '', qty: 4, price: 2 },                                   // بلا اسم — يسقط
            { name: 'جزر', qty: 0, price: 1 },                                // كمية صفر — تسقط
            { name: 'كوسة', qty: 2, price: -1 },                              // سعر سالب — يسقط
        ])).toEqual([
            { name: 'بطاطس', category: 'عام', unit: 'قطعة', qty: 5, price: 3, minQty: 5, expiryDate: null },
            { name: 'بصل', category: 'خضار', unit: 'كجم', qty: 2, price: 1.5, minQty: 9, expiryDate: '2026-12-01' },
        ]);
    });

    test('سياسة الصلاحية: حِمل الوارد الجماعي والاستيراد لا يُخترع فيه تاريخ', () => {
        const { repo } = auditRepo();
        const rows = repo.bulkReceiptRows([{ name: 'لبن', qty: '4', price: '10', expiryDate: '2027-01-05' }]);
        expect(EXPIRY.checkExpiryOnLines(rows).ok).toBe(true);
        expect(EXPIRY.checkExpiryOnLines(repo.bulkReceiptRows([{ name: 'لبن', qty: '4', price: '10' }])).code)
            .toBe('EXPIRY_DATE_REQUIRED');
        // الاستيراد من ورقة: العمود السابع أولًا، وتاريخ الورقة للصفوف الناقصة فقط.
        const sheet = repo.inventoryImportRowsFromSheet([['اسم الصنف', 'الفئة', 'الوحدة', 'الكمية', 'سعر الشراء', 'الحد الأدنى', 'تاريخ الصلاحية'],
            ['دجاج', 'لحوم', 'كجم', 10, 25, 5, '2026-11-30'], ['أرز', 'حبوب', 'كيس', 20, 4, 5, '']]);
        const payload = repo.inventoryImportPayload(sheet);
        expect(payload.map((r) => r.expiryDate)).toEqual(['2026-11-30', null]);
        expect(repo.applySheetExpiry(payload, '2026-12-31').map((r) => r.expiryDate)).toEqual(['2026-11-30', '2026-12-31']);
        expect(repo.applySheetExpiry(payload, '').map((r) => r.expiryDate)).toEqual(['2026-11-30', null]);
        // XLSX.read بلا cellDates يعيد التاريخ رقمًا تسلسليًا — كان يُقرأ «ليس تاريخًا».
        // والتسلسل تاريخٌ تقويمي: اليوم نفسه في أي منطقة زمنية (46000 = 2025-12-09).
        const serial = repo.inventoryImportRowsFromSheet([['بصل', 'خضار', 'كجم', 5, 8, 2, 46000]]);
        expect(serial[0].expiryDate).toBe('2025-12-09');
        expect(repo.inventoryImportPayload(serial)[0].expiryDate).toBe('2025-12-09');
        expect(repo.sheetExpiryCell(46000)).toBe('2025-12-09');
        expect(repo.sheetExpiryCell('خالي')).toBeNull();
        expect(repo.sheetExpiryCell('')).toBeNull();
        expect(repo.sheetExpiryCell(5)).toBeNull();                      // ليس نطاق تسلسلي معقول
        expect(repo.sheetExpiryCell('2026-11-30')).toBe('2026-11-30');
    });

    test('the movements guard reads the code or the legacy sentence, nothing else', () => {
        const { repo } = auditRepo();
        expect(repo.hasMovementsError({ code: 'INVENTORY_HAS_MOVEMENTS', message: 'أي شيء' })).toBe(true);
        expect(repo.hasMovementsError(new Error('الصنف مرتبط بحركات مخزون'))).toBe(true);
        expect(repo.hasMovementsError({ code: 'X', message: 'خطأ آخر' })).toBe(false);
        expect(repo.hasMovementsError(null)).toBe(false);
    });

    test('a direct edit refuses before sending, and its payload documents itself', () => {
        const { repo } = auditRepo();
        expect(repo.directEditError('4', '2', 'تسوية')).toBe('');
        expect(repo.directEditError('-1', '2', 'تسوية')).toMatch('كمية صحيحة');
        expect(repo.directEditError('4', 'abc', 'تسوية')).toMatch('تكلفة صحيحة');
        expect(repo.directEditError('4', '2', '   ')).toMatch('سبب التعديل');
        expect(repo.directEditPayload('4', '2.5', ' تسوية جرد '))
            .toEqual({ qty: 4, avgCost: 2.5, reason: 'تسوية جرد' });
    });

    test('the duplicate key normalizes letters and spaces, and the biggest balance survives by default', () => {
        const { repo } = auditRepo();
        expect(repo.mergeItemKey(' زيت  زيتون ')).toBe(repo.mergeItemKey('زيت زيتون'));
        expect(repo.mergeItemKey('قهوة')).toBe('قهوه');
        expect(repo.mergeItemKey('إبريق')).toBe('ابريق');
        const groups = repo.duplicateGroups([
            { id: 1, name: 'زيت', qty: 3 },
            { id: 2, name: ' زيت ', qty: 7 },
            { id: 3, name: 'سكر', qty: 1 },
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map((i) => i.id)).toEqual([1, 2]);
        expect(groups[0].keepIdx).toBe(1);                                   // المقترح: الأكبر رصيدًا
        expect(repo.duplicateGroups([{ id: 1, name: '' }, { id: 2, name: '  ' }])).toEqual([]);
    });

    test('the four audit states wear the legacy words; an unknown state falls back but keeps its raw', () => {
        const { repo } = auditRepo();
        expect(repo.AUDIT_STATUSES).toEqual(['draft', 'submitted', 'approved', 'cancelled']);
        expect(repo.auditState('submitted')).toMatchObject({ key: 'submitted', tone: 'info', label: 'بانتظار الاعتماد' });
        expect(repo.auditState('approved').tone).toBe('success');
        expect(repo.auditState('cancelled').tone).toBe('danger');
        expect(repo.auditState('draft').label).toMatch('قيد العد');
        const unknown = repo.auditState('weird');
        expect(unknown.key).toBe('draft');                                   // تسمية العرض لا تنكسر
        expect(unknown.raw).toBe('weird');                                   // والحقيقة المخزنة تبقى
        expect(repo.auditState(null).raw).toBe('—');
        for (const k of repo.AUDIT_STATUSES) {
            const s = repo.auditState(k);
            expect(s.label && s.icon && s.tone).toBeTruthy();
        }
    });

    test('the scope filter is the server mirror: whitelist, 120-char cut, empty means absent', () => {
        const { repo } = auditRepo();
        expect(repo.AUDIT_PERIOD_TYPES).toEqual(['daily', 'weekly', 'monthly', 'custom', 'annual']);
        expect(repo.scopeFilterOf('category', 'أغذية', '')).toEqual({ mode: 'category', category: 'أغذية', search: null });
        expect(repo.scopeFilterOf('weird', '', 'x')).toEqual({ mode: 'all', category: null, search: 'x' });
        expect(repo.scopeFilterOf('search', 'ب'.repeat(130), null).category).toHaveLength(120);
        expect(repo.scopeFilterOf(undefined, undefined, undefined)).toEqual({ mode: 'all', category: null, search: null });
    });

    test('the period rule is the server rule: both dates required, end never before start', () => {
        const { repo } = auditRepo();
        expect(repo.auditPeriodError('2026-10-01', '2026-10-15')).toBe('');
        expect(repo.auditPeriodError('', '2026-10-15')).toMatch('بداية ونهاية');
        expect(repo.auditPeriodError('2026-10-15', '2026-10-01')).toMatch('لا يمكن أن تسبق');
    });

    test('the start payload slices dates to the day, keeps the raw fields, and invents nothing', () => {
        const { repo } = auditRepo();
        expect(repo.startAuditPayload({
            countedAt: '2026-10-14T13:00:00', periodType: 'monthly', locationId: '3',
            scopeMode: 'category', scopeCategory: 'أغذية', notes: ' جرد أكتوبر ',
        })).toEqual({
            countedAt: '2026-10-14', periodType: 'monthly',
            periodStart: '2026-10-14', periodEnd: '2026-10-14',
            notes: 'جرد أكتوبر', locationId: 3,
            scopeFilter: { mode: 'category', category: 'أغذية', search: null },
        });
        const bare = repo.startAuditPayload({});
        expect(bare.countedAt).toBeNull();                                   // لا 'null' نصًّا
        expect(bare.periodType).toBe('custom');                              // نوع غير معلن ← custom
        expect(bare.locationId).toBe(0);
        expect(bare.scopeFilter.mode).toBe('all');
    });

    test('the preview read is the server query — only the active scope fields travel', async () => {
        const { calls, repo } = auditRepo({ default: { items_count: 3 } });
        await repo.fetchAuditPreview(7, 'category', 'أغذية', '');
        expect(calls[0].path.startsWith('/warehouse/inventory/locations/7/preview?')).toBe(true);
        const q = new URLSearchParams(calls[0].path.split('?')[1]);
        expect(q.get('mode')).toBe('category');
        expect(q.get('category')).toBe('أغذية');
        expect(q.get('search')).toBeNull();                                  // غائب لا فارغًا
    });

    test('the studio reads are array-guarded: a non-array answer is an empty list, never a crash', async () => {
        const { calls, repo } = auditRepo({ default: {} });
        expect(await repo.fetchAuditLocations()).toEqual([]);
        expect(await repo.fetchAudits()).toEqual([]);
        expect(calls[0].path).toBe('/warehouse/inventory/locations');
        expect(calls[1].path).toBe('/warehouse/inventory/audits');
    });

    test('the studio writes reach the six named doors with the signature and the trimmed reason', async () => {
        const { calls, repo } = auditRepo({ default: {} });
        await repo.startAuditSession({ locationId: 3 });
        await repo.saveAuditCount(4, 9, '2.5', null);
        await repo.clearAuditCount(4, 9);
        await repo.submitAuditSession(4, 'data:sign', 'سامي');
        await repo.approveAuditSession(4, 'data:sign', 'سامي');
        await repo.cancelAuditSession(4, '  تعفن بعض الأصناف  ');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /warehouse/inventory/audits',
            'PUT /warehouse/inventory/audits/4/counts/9',
            'DELETE /warehouse/inventory/audits/4/counts/9',
            'POST /warehouse/inventory/audits/4/submit',
            'POST /warehouse/inventory/audits/4/approve',
            'POST /warehouse/inventory/audits/4/cancel',
        ]);
        expect(JSON.parse(calls[1].body)).toEqual({ countedQty: 2.5, notes: '' });
        expect(JSON.parse(calls[3].body)).toEqual({ signatureData: 'data:sign', signerName: 'سامي' });
        expect(JSON.parse(calls[5].body)).toEqual({ reason: 'تعفن بعض الأصناف' });
    });

    test('an audit row leaves with the declared allowlist — the studio has no cost column to drop', () => {
        const { repo } = auditRepo();
        const row = repo.auditToRow({
            id: 5, audit_number: 91, status: 'submitted', warehouse_scope: 'MAIN-WAREHOUSE',
            location_id: '3', counted_at: '2026-10-14T09:00:00', created_by: 'مدير',
            total_items: '40', item_count: '40', counted_items: '12', total_variance_value: '-310.5',
            secret: 'x',
        });
        expect(Object.keys(row).sort()).toEqual(['countedAt', 'countedItems', 'createdBy', 'id',
            'itemCount', 'locationId', 'number', 'scope', 'status', 'totalItems', 'varianceValue']);
        expect(row.countedAt).toBe('2026-10-14');
        expect(row.number).toBe('91');
        expect(row.varianceValue).toBe(-310.5);
        expect(repo.auditToRow({ status: 'weird' }).status).toBe('draft');   // حالة مجهولة لا تُعرض مجهولة
        expect(repo.auditToRow({}).locationId).toBe(0);
    });

    test('an audit item is counted by either server flag, and a missing name is the record number', () => {
        const { repo } = auditRepo();
        expect(repo.auditItemToRow({
            id: 1, item_id: 9, item_name: 'أرز', unit: 'كجم',
            system_qty: '10', counted_qty: '7', variance_qty: '-3', variance_value: '-30',
            notes: 'مكسور', counted_at: '2026-10-14T10:00:00', is_stale: true,
        })).toEqual({
            id: 1, itemId: 9, name: 'أرز', unit: 'كجم', systemQty: 10, countedQty: 7,
            varianceQty: -3, varianceValue: -30, notes: 'مكسور', isCounted: true, isStale: true,
        });
        const flagOnly = repo.auditItemToRow({ item_id: 4, is_counted: true });
        expect(flagOnly.isCounted).toBe(true);                               // مصدرا العدّ كما يرسلهما الخادم
        expect(flagOnly.name).toBe('#4');
        const nameless = repo.auditItemToRow({});
        expect(nameless.name).toBe('#؟');
        expect(nameless.isCounted).toBe(false);
        expect(nameless.isStale).toBe(false);
    });

    test('the variance summary counts the counted only — stale is flagged, never summed', () => {
        const { repo } = auditRepo();
        expect(repo.auditSummaryOf([
            { isCounted: true, varianceQty: -10, varianceValue: -33.333, isStale: true },
            { isCounted: true, varianceQty: 4, varianceValue: 10.005, isStale: false },
            { isCounted: true, varianceQty: -2, varianceValue: -5, isStale: false },
            { isCounted: true, varianceQty: 0, varianceValue: 0, isStale: false },
            { isCounted: false, varianceQty: 99, varianceValue: 99, isStale: false },  // غير معدود — لا يُحسب
        ])).toEqual({
            itemsWithVariance: 3, shortageItems: 2, surplusItems: 1,
            projectedVarianceValue: -28.33,                                  // قرش واحد بعد الجمع
            staleItems: 1,
        });
        expect(repo.auditSummaryOf([])).toEqual({
            itemsWithVariance: 0, shortageItems: 0, surplusItems: 0, projectedVarianceValue: 0, staleItems: 0,
        });
        expect(JSON.stringify(repo.auditSummaryOf([{ isCounted: true, varianceQty: 1, varianceValue: 'x' }])))
            .not.toMatch('NaN');
    });

    test('the scope preview speaks the settings currency, and silence means the server did not answer', () => {
        const { repo } = auditRepo();
        expect(repo.scopePreviewText({ items_count: '318', on_hand_qty: '1250.5', on_hand_value: '48200.5' }, 'ر.س'))
            .toBe('سيُدرج 318 صنف من مخزن الجرد المختار — رصيده المتوقع: 1,250.5 وحدة بقيمة 48,200.50 ر.س');
        expect(repo.scopePreviewText({ items_count: 4, on_hand_qty: 0, on_hand_value: 0 }, ''))
            .toBe('سيُدرج 4 صنف من مخزن الجرد المختار — رصيده المتوقع: 0 وحدة بقيمة 0.00');
        expect(repo.scopePreviewText(null, 'ر.س')).toBe('');
        expect(repo.scopePreviewText({ items_count: 'x' }, 'ر.س')).toBe('');
    });
});

describe('V2 warehouse write surfaces + audit studio (source contract, W1-6)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const ops = () => fs.readFileSync(OPS_CSS, 'utf8');

    test('every write entrance is behind its server role list — a role the server would refuse gets no button', () => {
        const s = screen();
        expect(s).toMatch(/can\.audit \? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="audit">/);
        expect(s).toMatch(/can\.write \? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="bulk">/);
        expect(s).toMatch(/can\.merge \? `<button type="button" class="erp-btn erp-btn--sm" data-v2-new="merge">/);
        expect(s).toMatch(/canWrite \|\| canDirect\) \{/);
        expect(s).toMatch(/canWrite \? `\s*<button type="button" class="erp-btn erp-btn--sm" data-v2-act="receipt"/);
        expect(s).toMatch(/canDirect \? `\s*<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-act="direct"/);
        expect(s).toMatch(/canWrite \? `\s*<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete"/);
        expect(s).toMatch(/const canForce = invForceVisible\(role\);/);
        expect(s).toMatch(/if \(kind === 'audit'\) \{\s*if \(!canAuditRead\)/);
    });

    test('a quick receipt declares the deviation: no cost shown, the price is the user’s, and empty is refused', () => {
        const s = screen();
        expect(s).toMatch(/في القديم كان السعر يُملأ تلقائيًا بآخر تكلفة مسجّلة؛/);
        expect(s).toMatch(/هذه الشاشة لا تعرض التكلفة عمدًا، فاكتب السعر صراحةً/);
        expect(s).toMatch(/priceRaw === '' \|\| !Number\.isFinite\(price\) \|\| price < 0/);
        expect(s).toMatch(/والفراغ يُرفض معلنًا/);
        expect(s).toMatch(/notify\('أدخل كمية صحيحة'\)/);
    });

    test('the bulk import runs in BULK_CHUNK batches, and a partial failure keeps the panel and names the retry', () => {
        const s = screen();
        expect(s).toMatch(/i \+= BULK_CHUNK/);
        expect(s).toMatch(/لا توجد صفوف صالحة للاستيراد/);
        expect(s).toMatch(/جارٍ استيراد \$\{items\.length\} صنف في \$\{chunks\.length\} دفعة — لا تغلق اللوحة/);
        expect(s).toMatch(/اكتمل جزئيًا:/);
        expect(s).toMatch(/صحّح الصفوف \(غالبًا تعارض وحدة مع صنف موجود\) وأعد الإرسال/);
    });

    test('direct edit names its admin gate, and merge makes a human pick the survivor before confirming', () => {
        const s = screen();
        expect(s).toMatch(/تعديل مباشر \(أدمن\)/);
        expect(s).toMatch(/يُقيَّد الفرق في الدفتر/);
        expect(s).toMatch(/اختر النسخة التي تبقى/);
        expect(s).toMatch(/تأكيد الدمج: سيُنقل رصيد \$\{dupIds\.length\} صنفًا مكررًا/);
        expect(s).toMatch(/إعادة توجيه السجل التاريخي\. متابعة؟/);
    });

    test('a movements guard is explained, and the force delete asks again through the host confirmation', () => {
        const s = screen();
        expect(s).toMatch(/if \(hasMovementsError\(e\)\) \{/);
        expect(s).toMatch(/احتفظ به للحفاظ على سلامة الدفاتر/);
        expect(s).toMatch(/هل تريد الحذف النهائي مع كل حركاته وسجلاته؟ \(لا يمكن التراجع\)/);
        expect(s).toMatch(/تم الحذف النهائي مع الحركات/);
        expect(s).toMatch(/await confirmFn\(`حذف الصنف "\$\{row\.name\}"؟`\)/);
    });

    test('one signature pad locked to the session name, disposed on close and on teardown', () => {
        const s = screen();
        expect(s).toMatch(/const SIG_ID = 'v2wh-audit-sig'/);
        expect(s).toMatch(/const signerName = normalizeSignerName\(ctx\.userName \|\| ''\);/);
        expect(s).toMatch(/signaturePadMarkup\(SIG_ID, 'توقيع مسؤول الجرد \/ المعتمد', signerName\)/);
        expect(s).toMatch(/initSignaturePad\(panelEl, SIG_ID, signerName\)/);
        expect(s).toMatch(/readSignaturePad\(panelEl, SIG_ID, signerName\)/);
        expect((s.match(/disposeSignaturePads\(SIG_ID\)/g) || []).length).toBe(2);  // closePanel + destroy
        expect(s).toMatch(/SIGNER_NAME_MISSING: 'اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا'/);
        expect(s).toMatch(/SIGNER_MISMATCH: 'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر'/);
    });

    test('the count is saved by its own row button — the 900ms autosave is declared dead, and cancel is a field', () => {
        const s = screen();
        expect((s.match(/setTimeout\(/g) || []).length).toBe(2);             // بحث + معاينة فقط
        expect((s.match(/\}, 350\);/g) || []).length).toBe(2);
        expect(s).toMatch(/يُحفظ كل عدّ بضغط زر الحفظ في صفه — لا حفظ تلقائي/);
        expect(s).toMatch(/data-v2-asave="\$\{esc\(key\)\}"/);
        expect(s).toMatch(/data-v2-aclear="\$\{esc\(key\)\}"/);
        expect(s).toMatch(/مُسح العد — الصنف عاد إلى «غير معدود»/);
        expect(s).toMatch(/const val = draft !== undefined \? draft : \(row\.isCounted \? String\(row\.countedQty\) : ''\);/);
        expect(s).not.toMatch(/window\.prompt\(\)/);                         // التعليق يقول «not prompt()» نصًّا — الكود لا يستدعيه
        expect(s).toMatch(/data-v2-cancel-reason/);
        expect(s).toMatch(/سبب الإلغاء مطلوب \(3 أحرف على الأقل\)/);
    });

    test('approval speaks the arithmetic it will apply, and a draft is submitted on the way', () => {
        const s = screen();
        expect(s).toMatch(/سيتم تطبيق الفروقات على أرصدة المخزون:/);
        expect(s).toMatch(/— صافي قيمة الفروقات: \$\{moneyText\(summary\.projectedVarianceValue\)\}/);
        expect(s).toMatch(/تُسجَّل حركات تصحيح موثّقة ولا يمكن التراجع\. متابعة؟/);
        expect(s).toMatch(/if \(status === 'draft'\) \{await submitAuditSession\(audit\.id, sig, signerName\);\}/);
        expect(s).toMatch(/اعتُمد الجرد وطُبّقت \$\{formatInt\(\(result\.transactions \|\| \[\]\)\.length\)\} حركة تصحيح/);
        expect(s).toMatch(/أُرسلت الجلسة للاعتماد — العد مقفل الآن/);
    });

    test('a stale balance is a banner that says approval will be refused until a fresh session', () => {
        const s = screen();
        expect(s).toMatch(/function auditStaleBanner\(\)/);
        expect(s).toMatch(/تنبيه انحراف الرصيد:/);
        expect(s).toMatch(/انحراف رصيد \$\{formatInt\(s\.staleItems\)\}/);
        expect(s).toMatch(/سيمنع النظام الاعتماد حتى تبدأ جلسة جديدة تلتقط الأرصدة الحالية/);
    });

    test('variance money speaks the settings currency, and a missing unit is declared, not guessed', () => {
        const s = screen();
        expect(s).toMatch(/import \{ formatMoney, fetchCurrency \} from '\.\.\/data\/reports-repo\.js\?v=/);
        expect(s).toMatch(/fetchCurrency\(\)\.catch\(\(\) => ''\)/);
        expect(s).toMatch(/const m = formatMoney\(v, studio \? studio\.currency : ''\);/);
        expect(s).toMatch(/لا وحدة عملة مضبوطة في الإعدادات — القيم المالية تُعرض بلا رمز/);
    });

    test('a failed preview is a stated failure — the server decides the scope at start', () => {
        const s = screen();
        expect(s).toMatch(/scopePreviewText\(p, studio\.currency\)/);
        expect(s).toMatch(/تعذرت المعاينة الحية — سيحدد النطاق على الخادم عند بدء الجلسة/);
    });

    test('the sessions list re-reads, keeps the last read on failure, and never invents a row', () => {
        const s = screen();
        expect(s).toMatch(/const audits = await fetchAudits\(\);/);
        expect(s).toMatch(/studio\.audits = audits;/);
        expect(s).toMatch(/fetchAudits\(\)\.catch\(\(\) => studio\.audits\)/);
        expect(s).toMatch(/const row = auditToRow\(a\);/);
        expect(s).toMatch(/لديك جلسات جرد مفتوحة:/);
        expect(s).toMatch(/لا توجد جلسات جرد بعد — ابدأ الأولى من تبويب «جلسة جديدة»/);
    });

    test('every studio mutation keeps the busy guard, and every await re-checks the live panel', () => {
        const s = screen();
        expect((s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g) || []).length)
            .toBeGreaterThanOrEqual(10);
        expect((s.match(/panelAlive\(seq\)/g) || []).length).toBeGreaterThanOrEqual(15);
        expect(s).toMatch(/if \(previewTimer\) \{clearTimeout\(previewTimer\); previewTimer = null;\}/);
        expect(s).toMatch(/disposeSignaturePads\(SIG_ID\);\s*el\.remove\(\);/);
    });

    test('the studio says each refusal in the server’s terms, reader and writer apart', () => {
        const s = screen();
        expect(s).toMatch(/استوديو الجرد متاح للمخزن والمدير والإدارة والمحاسبة/);
        expect(s).toMatch(/بدء الجلسات للمخزن والمدير والإدارة فقط/);
        expect(s).toMatch(/العدّ للمخزن والمدير والإدارة فقط/);
    });

    test('the host hands the studio its signer name and keeps the confirmation rule of the wave', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect((p.match(/userName: String\(u\.name \|\| u\.username \|\| ''\)/g) || []).length)
            .toBeGreaterThanOrEqual(2);
        expect(p).toMatch(/warehouseScreen = mountWarehouseScreen\(shell\.main\.querySelector\('\[data-v2-warehouse-host\]'\), \{[\s\S]{0,300}userName: String\(u\.name \|\| u\.username \|\| ''\)/);
    });

    test('the studio panel stays hidden until opened, and neither panel nor actions reach the printed sheet', () => {
        const o = ops();
        expect(o).toMatch(/\.erp-v2-warehouse \[data-v2-panel\]\[hidden\] \{ display: none; \}/);
        const prints = [...o.matchAll(/@media print \{/g)];
        const lastPrint = o.slice(prints[prints.length - 1].index);
        expect(lastPrint).toMatch(/\.erp-v2-warehouse \[data-v2-panel\] \{ display: none; \}/);
        expect(lastPrint).toMatch(/\.erp-v2-warehouse \[data-col="actions"\] \{ display: none; \}/);
    });

    test('the W1-6 phone rules extend the last 640 block — one column per card, finger-sized buttons', () => {
        const o = ops();
        const blocks = [...o.matchAll(/@media \(max-width: 640px\) \{/g)];
        expect(blocks).toHaveLength(2);                                      // عقد erp-ops كما يثبته v2-returns
        const last = o.slice(blocks[blocks.length - 1].index);
        expect(last).toMatch(/\.erp-v2-warehouse \.erp-wh-panel__head \.erp-btn,/);
        expect(last).toMatch(/min-block-size: var\(--erp-space-8\);/);
        expect(last).toMatch(/div\.erp-wh-loc-grid,\n {2}\.erp-v2-warehouse div\.erp-wh-scope-grid \{ grid-template-columns: 1fr; \}/);
    });

    test('the W1-6 layer uses only the shared tokens — the returns contract reads the same file for the rest', () => {
        const o = ops();
        const section = o.slice(o.indexOf('شاشة 03 — المخزون (كتابات المخزون الستة'))
            .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(section).not.toMatch(/rgba?\(/);
        expect(section).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(section).toMatch(/\.erp-wh-panel \{/);
        expect(section).toMatch(/\.erp-wh-audit-table/);
        expect(section).toMatch(/\[data-dir="neg"\] \{ color: var\(--erp-danger-text\); \}/);
        expect(section).toMatch(/\[data-dir="pos"\] \{ color: var\(--erp-success-text\); \}/);
    });

    test('the migration note records the wave: the six writes, the studio cycle, and the money boundary', () => {
        const m = fs.readFileSync(MIGRATION, 'utf8');
        expect(m).toMatch(/\| 03 \| المخزون \| `warehouse` \| 1 \(قراءة\) \+ كتابات المخزون الستة \(W1-6\)/);
        expect(m).toMatch(/لا حفظ تلقائي — انحراف معلن عن autosave القديم/);
        expect(m).toMatch(/إرسال واعتماد بتوقيع مقفل باسم الحساب/);
        expect(m).toMatch(/والاستوديو فتحه فعلًا في W1-6/);
    });
});
