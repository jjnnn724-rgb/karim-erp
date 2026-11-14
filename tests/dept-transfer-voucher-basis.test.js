/**
 * dept-transfer-voucher-basis.test.js — التحويل من أذونات الصرف لا من المخزن
 * ═══════════════════════════════════════════════════════════════════════
 * قرار المالك 2026-11-01: التحويل يسحب من أذونات الصرف التي صرفها القسم
 * فعلًا هذا الشهر، لا من كامل رصيد المخزن المتراكم.
 *
 * العقود المثبَّتة هنا (سلوكًا لا نصًّا):
 *   1) سقف التحويل = كمية الإذن المؤهل ناقص ما حُوِّل منه — السقف أذنُ الصرف
 *     نفسه لا رصيد المخزن (توجيه المالك 2026-11-02: «أنا بتعامل على إذن الصرف
 *     وليس المخزن» و«كل قسم كأنه مخزن صغير»). الكمية المعتمدة التي لم يُسجَّل
 *     استلامها بعد في مخزن القسم تُستلم تلقائيًا عند التنفيذ بوحدة الإذن
 *     وتكلفته، وdispatches.receivedItems يُملى فتُمنع الاستلامات المزدوجة.
 *   2) تكلفة التحويل = تكلفة الإذن نفسها (approvedValue/approvedQty)،
 *     لا متوسط تكلفة الصنف في inventory.
 *   3) خصم من مخزن المرسل وإضافة على مخزن المستلم، مع قيدَي مصروف
 *     متقابلين متساويين في المبلغ — في المسارين الداخلي والمباشر.
 *   4) أي قسم يسلّم لمنافذ البيع الخارجية الثلاثة (بيع خارجي · كافيه ·
 *     كافيه ناصر) بلا اعتماد، والمخازن المفقودة تُنشأ تلقائيًا.
 *   5) صنف بلا إذن صرف مؤهل لا يُحوَّل، ورئيس القسم مُجبر على قسمه،
 *     ولا يعتمد أحدٌ طلبه بنفسه.
 *
 * البيانات: karim_erp_test المعزولة (بوابة global-setup). تُبنى فوق
 * طبقة الإنتاج الحقيقية (أقسام kitchen/butcher/sweets/salads/external_sales
 * ومخزن KITCHEN-MAIN) بأصناف وبنود وأذونات ZZ ذات معرّفات 99xxxx،
 * وتُحذف في afterAll بترتيب المفاتيح الأجنبية.
 */
'use strict';

const express = require('express');

let mockUser = { id: 990011, role: 'admin', name: 'مدير المخزن', dept_code: '' };

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = mockUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/transfer-notifier', () => ({
    notifyTransferEvent: jest.fn(async () => {}),
}));

const { pool } = require('../backend/shared-pool');
const { router } = require('../backend/dept-transfer-routes');

const KITCHEN = 'kitchen';
const BUTCHER = 'butcher';
const SWEETS = 'sweets';
const SALADS = 'salads';
const EXTERNAL = 'external_sales';
const CAF = 'CAF';
const NAS = 'NAS';
const NEW_STORE_CODES = ['STORE-EXTERNAL', 'STORE-EXTERNAL_SALES', 'STORE-CAF', 'STORE-NAS', 'STORE-SALADS', 'STORE-KITCHEN'];

const MEAT = 990201;
const KUNAFA = 990202;
const SALT = 990203;
const DISPATCH_IDS = [990301, 990302, 990303, 990304];
const USER_IDS = [990011, 990012];
// تكلفة الإذن (180) مختلفة عمدًا عن متوسط المخزون (200) — الفصل بينهما هو العقد.
const MEAT_VOUCHER_COST = 180;
const MEAT_AVG_COST = 200;
const VOUCHER_AT = '2026-11-01T10:00:00+03:00';

let server;
let baseUrl;
let mainLocId;

const sql = async (text, params) => (await pool.query(text, params)).rows;
const jget = async (pathname) => (await fetch(baseUrl + pathname)).json();
const jpost = async (pathname, body) => {
    const res = await fetch(baseUrl + pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
};

async function wipe() {
    await pool.query('DELETE FROM inventory_ledger WHERE inventory_id = ANY($1::bigint[]) AND (reference_type = '
        + "'inventory_transfer' OR (reference_type = 'dispatch_receipt' AND reference_id = ANY($2::text[])))",
    [[MEAT, KUNAFA, SALT], DISPATCH_IDS.map((id) => String(id))]);
    // أي دفتر يشير إلى مخازن المتجر الموسومة يُمحى أولًا — وإلا منع ارتباك زملائي السويتات
    await pool.query('DELETE FROM inventory_ledger WHERE location_id IN (SELECT id FROM inventory_locations WHERE code = ANY($1::text[]))', [NEW_STORE_CODES]);
    await pool.query('DELETE FROM expenses WHERE notes LIKE ' + "'transfer:%'");
    await pool.query('DELETE FROM inventory_transfer_items WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE notes LIKE ' + "'ZZV%')");
    await pool.query('DELETE FROM inventory_transfer_events WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE notes LIKE ' + "'ZZV%')");
    await pool.query('DELETE FROM inventory_transfers WHERE notes LIKE ' + "'ZZV%'");
    await pool.query('DELETE FROM inventory_location_balances WHERE inventory_id = ANY($1::bigint[])', [[MEAT, KUNAFA, SALT]]);
    await pool.query('DELETE FROM dispatches WHERE id = ANY($1::bigint[])', [DISPATCH_IDS]);
    await pool.query('DELETE FROM inventory_locations WHERE code = ANY($1::text[])', [NEW_STORE_CODES]);
    await pool.query('DELETE FROM inventory WHERE id = ANY($1::bigint[])', [[MEAT, KUNAFA, SALT]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [USER_IDS]);
    await pool.query('DELETE FROM departments WHERE code = ANY($1::text[])', [[CAF, NAS]]);
}

beforeAll(async () => {
    await wipe();
    const cafRow = (await sql('SELECT id FROM departments WHERE code = $1', [CAF]))[0];
    if (!cafRow) {
        await pool.query('INSERT INTO departments (id, code, name) VALUES ($1,$2,$3),($4,$5,$6)',
            [990401, CAF, 'كافيه', 990402, NAS, 'كافيه ناصر']);
    }
    await pool.query('INSERT INTO users (id, username, password, role, name) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
        [990011, 'zz-voucher-admin', 'zz-no-credential', 'admin', 'مدير المخزن ZZ',
            990012, 'zz-voucher-chef', 'zz-no-credential', 'kitchen', 'شيف ZZ']);
    const loc = await sql('SELECT id FROM inventory_locations WHERE code = ' + "'KITCHEN-MAIN'" + ' AND active = true', []);
    expect(loc.length).toBe(1);
    mainLocId = Number(loc[0].id);
    await pool.query('INSERT INTO inventory (id, name, unit, qty, "avgCost") VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)',
        [MEAT, 'لحم بقري ZZ', 'كجم', 100, MEAT_AVG_COST,
            KUNAFA, 'كنافة ZZ', 'كجم', 50, 90,
            SALT, 'ملح ZZ', 'كجم', 10, 5]);
    await pool.query('INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9)',
        [MEAT, mainLocId, 100, KUNAFA, mainLocId, 50, SALT, mainLocId, 10]);
    // أذونات صرف صادرة فعلًا: الجزار 40 لحم بـ180، الحلواني 20 كنافة، المطبخ 30 كنافة.
    await pool.query('INSERT INTO dispatches (id, "deptCode", "deptName", date, status, "approvedItems", "warehouseApprovedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7),($8,$9,$10,$11,$12,$13::jsonb,$14),($15,$16,$17,$18,$19,$20::jsonb,$21)',
        [990301, BUTCHER, 'قسم الجزار', '2026-11-01', 'approved',
            JSON.stringify([{ itemId: MEAT, itemName: 'لحم بقري ZZ', approvedQty: 40, avgCost: MEAT_VOUCHER_COST, approvedValue: 7200 }]), VOUCHER_AT,
            990302, SWEETS, 'قسم الحلواني', '2026-11-01', 'received',
            JSON.stringify([{ itemId: KUNAFA, itemName: 'كنافة ZZ', approvedQty: 20, avgCost: 90, approvedValue: 1800 }]), VOUCHER_AT,
            990303, KITCHEN, 'المطبخ', '2026-11-01', 'approved',
            JSON.stringify([{ itemId: KUNAFA, itemName: 'كنافة ZZ', approvedQty: 30, avgCost: 90, approvedValue: 2700 }]), VOUCHER_AT]);

    const app = express();
    app.use(express.json());
    app.use('/api/warehouse', (req, res, next) => { req.io = null; next(); }, router);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (server) { await new Promise((resolve) => server.close(resolve)); }
    await wipe();
    await pool.end();
});

const transfersOf = (notes) => sql('SELECT * FROM inventory_transfers WHERE notes = $1', [notes]);
const movesOf = (id) => sql('SELECT location_id, transaction_type, quantity_delta, unit_cost FROM inventory_ledger WHERE reference_id = $1 ORDER BY id', [String(id)]);
const expensesOf = (id) => sql('SELECT "deptId", amount, category, "adjustmentType" FROM expenses WHERE notes LIKE $1 ORDER BY amount', ['%transfer:' + id + ':%']);

describe('أساس التحويل: أذونات الصرف الصادرة فعليًا', () => {
    test('رصيد الشهر أساسه الإذن: الكمية وتكلفة الإذن ورقمه مصدرًا', async () => {
        const body = await jget(`/api/warehouse/dept-transfers/stock?dept=${BUTCHER}&scope=month`);
        expect(body.scope).toBe('month');
        expect(body.source).toBe('issue_vouchers');
        expect(Number(body.location.id)).toBe(mainLocId);
        const meat = body.items.find((i) => Number(i.inventory_id) === MEAT);
        expect(meat).toBeTruthy();
        expect(Number(meat.month_qty)).toBe(40);
        expect(Number(meat.available)).toBe(40);
        expect(Number(meat.avg_cost)).toBe(MEAT_VOUCHER_COST);
        expect(meat.vouchers).toBe(1);
        expect(meat.sources[0].ref).toMatch(/^DS-/);
        expect(Number(meat.sources[0].qty)).toBe(40);
    });

    test('صنف له رصيد بلا إذن صرف مؤهل لا يدخل أساس التحويل', async () => {
        const body = await jget(`/api/warehouse/dept-transfers/stock?dept=${BUTCHER}&scope=month`);
        expect(body.items.some((i) => Number(i.inventory_id) === SALT)).toBe(false);
    });

    test('تحويل صنف بلا إذن يُرفض عند الإنشاء لا عند العرض', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: BUTCHER, destDeptCode: EXTERNAL,
            notes: 'ZZV-none', items: [{ inventory_id: SALT, qty: 1 }],
        });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('NOT_FROM_CURRENT_DISPATCH');
    });
});

describe('سقف أذن الصرف ومنع الصرف المزدوج', () => {
    test('الكمية فوق المتاح من الإذن تُرفض والمتاح يعود في الرد', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: BUTCHER, destDeptCode: EXTERNAL,
            notes: 'ZZV-over', items: [{ inventory_id: MEAT, qty: 45 }],
        });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('INSUFFICIENT_STOCK');
        expect(res.body.available).toBe(40);
        expect(res.body.requested).toBe(45);
        expect(await transfersOf('ZZV-over')).toHaveLength(0);
    });

    test('تحويل 30 من 40 ينفذ فورًا، والمتبقي 10 يمنع 15 بعدها', async () => {
        const ok = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: BUTCHER, destDeptCode: EXTERNAL,
            notes: 'ZZV-part', items: [{ inventory_id: MEAT, qty: 30 }],
        });
        expect(ok.status).toBe(201);
        expect(ok.body.status).toBe('received');
        expect(ok.body.metadata.cost_basis).toBe('issue_voucher');
        expect(Number(ok.body.source_location_id)).toBe(mainLocId);
        // المستودع المخصص يُنشأ برمزّه القانوني حين يغيب في بيئة جديدة —
        // لا برمز مشتق يمنح القسم مخزنين وتتشعب تكلفتهما.
        const destLoc = await sql('SELECT code FROM inventory_locations WHERE id = $1', [ok.body.destination_location_id]);
        expect(destLoc).toHaveLength(1);
        expect(destLoc[0].code).toBe('STORE-EXTERNAL');

        const again = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: BUTCHER, destDeptCode: EXTERNAL,
            notes: 'ZZV-rest', items: [{ inventory_id: MEAT, qty: 15 }],
        });
        expect(again.status).toBe(409);
        expect(again.body.available).toBe(10);

        const body = await jget(`/api/warehouse/dept-transfers/stock?dept=${BUTCHER}&scope=month`);
        const meat = body.items.find((i) => Number(i.inventory_id) === MEAT);
        expect(Number(meat.month_qty)).toBe(40);
        expect(Number(meat.transferred_qty)).toBe(30);
        expect(Number(meat.available)).toBe(10);
    });
});

describe('الحركة المخزنية ونقل التكلفة', () => {
    test('خصم من مخزن المرسل وإضافة على مخزن المستلم بتكلفة الإذن', async () => {
        const t = (await transfersOf('ZZV-part'))[0];
        const moves = await movesOf(t.id);
        expect(moves).toHaveLength(2);
        const out = moves.find((m) => m.transaction_type === 'transfer_out');
        const inb = moves.find((m) => m.transaction_type === 'transfer_in');
        expect(Number(out.location_id)).toBe(mainLocId);
        expect(Number(out.quantity_delta)).toBe(-30);
        expect(Number(inb.location_id)).not.toBe(mainLocId);
        expect(Number(inb.quantity_delta)).toBe(30);
        expect(Number(out.unit_cost)).toBe(MEAT_VOUCHER_COST);
        expect(Number(inb.unit_cost)).toBe(MEAT_VOUCHER_COST);
    });

    test('قيدَا مصروف متقابلان: سالب على المرسل وموجب على المستلم بنفس القيمة', async () => {
        const t = (await transfersOf('ZZV-part'))[0];
        const exps = await expensesOf(t.id);
        expect(exps).toHaveLength(2);
        expect(Number(exps[0].amount)).toBe(-5400);
        expect(exps[0].deptId).toBe(BUTCHER);
        expect(Number(exps[1].amount)).toBe(5400);
        expect(exps[1].deptId).toBe(EXTERNAL);
        expect(exps[0].category).toBe('تحويلات');
        expect(exps[0].adjustmentType).toBe('inventory_transfer');
    });

    test('الرصيد الفعلي يتحرك: مخزن المرسل ينقص والمستلم يزيد', async () => {
        const rows = await sql('SELECT location_id, on_hand FROM inventory_location_balances WHERE inventory_id = $1', [MEAT]);
        const byLoc = new Map(rows.map((r) => [Number(r.location_id), Number(r.on_hand)]));
        expect(byLoc.get(mainLocId)).toBe(70);
        expect([...byLoc.entries()].some(([, v]) => v === 30)).toBe(true);
    });
});

describe('منافذ البيع الخارجية الثلاثة والمسار المؤجَّل', () => {
    test('الحلواني يحوّل إلى كافيه مباشرة ومخزنه يُنشأ تلقائيًا', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: SWEETS, destDeptCode: CAF,
            notes: 'ZZV-caf', items: [{ inventory_id: KUNAFA, qty: 20 }],
        });
        expect(res.status).toBe(201);
        expect(res.body.metadata.destDeptCode).toBe(CAF);
        const stores = await sql('SELECT code FROM inventory_locations WHERE code = ' + "'STORE-CAF'");
        expect(stores).toHaveLength(1);
        const t = (await transfersOf('ZZV-caf'))[0];
        const exps = await expensesOf(t.id);
        expect(Number(exps[0].amount)).toBe(-1800);
        expect(exps[0].deptId).toBe(SWEETS);
        expect(exps[1].deptId).toBe(CAF);
    });

    test('البيع الخارجي على المسار المؤجَّل يُحوَّل لمساره المباشر', async () => {
        const res = await jpost('/api/warehouse/dept-transfers', {
            sourceDeptCode: BUTCHER, destDeptCode: EXTERNAL,
            notes: 'ZZV-wrong-path', items: [{ inventory_id: MEAT, qty: 1 }],
        });
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('EXTERNAL_SALE_USE_DIRECT');
    });

    test('وجهة ليست منفذ بيع خارجي تُرفض على المسار المباشر', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: BUTCHER, destDeptCode: SALADS,
            notes: 'ZZV-bad-dest', items: [{ inventory_id: MEAT, qty: 1 }],
        });
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('INVALID_EXTERNAL_DEST');
    });

    test('المسار الداخلي يبقى طلبًا حتى اعتماد الشيف — ولا يعتمد أحدٌ طلبه', async () => {
        const res = await jpost('/api/warehouse/dept-transfers', {
            sourceDeptCode: KITCHEN, destDeptCode: SALADS,
            notes: 'ZZV-internal', items: [{ inventory_id: KUNAFA, qty: 5 }],
        });
        expect(res.status).toBe(201);
        const t = res.body;
        expect(t.status).toBe('requested');
        expect(await movesOf(t.id)).toHaveLength(0);

        const self = await jpost(`/api/warehouse/dept-transfers/${t.id}/approve`, {});
        expect(self.status).toBe(409);
        expect(self.body.error).toBe('SELF_APPROVAL');

        mockUser = { id: 990012, role: 'kitchen', name: 'شيف ZZ', dept_code: KITCHEN };
        const approved = await jpost(`/api/warehouse/dept-transfers/${t.id}/approve`, {});
        expect(approved.status).toBe(200);
        expect(approved.body.status).toBe('received');
        expect(Number(approved.body.total_value)).toBe(450);
        expect(await movesOf(t.id)).toHaveLength(2);
        mockUser = { id: 990011, role: 'admin', name: 'مدير المخزن', dept_code: '' };
    });
});

describe('ملكية المصدر', () => {
    test('رئيس القسم مُجبر على قسمه — التحويل من قسم غيره يُرفض', async () => {
        mockUser = { id: 990013, role: 'dept_head', name: 'رأس الجزار', dept_code: BUTCHER };
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: SWEETS, destDeptCode: NAS,
            notes: 'ZZV-foreign', items: [{ inventory_id: KUNAFA, qty: 1 }],
        });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('DEPT_MISMATCH');
        mockUser = { id: 990011, role: 'admin', name: 'مدير المخزن', dept_code: '' };
    });

    test('مدير النظام بلا قسم يحدد المرسل صراحة', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            destDeptCode: EXTERNAL, notes: 'ZZV-nosrc', items: [{ inventory_id: MEAT, qty: 1 }],
        });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('SOURCE_DEPT_REQUIRED');
    });
});

describe('لوحة التحويلات (/dept-transfers/summary)', () => {
    /** اللوحة تعدّ كل تحويلات العزل في المدى، لا تحويلات هذا الملف وحده —
     *  لذلك تُقارن الحدود (≥) وتُصان بنية الرد نفسها. */
    test('إجماليات مسمّاة: قيمة محسوبة بالتكلفة الفعلية وأقسام بالاسم', async () => {
        const s = await jget('/api/warehouse/dept-transfers/summary?from=2026-11-01&to=2026-11-30');
        expect(s.mode).toBe('all');
        expect(Number(s.totals.value)).toBeGreaterThan(0);
        expect(Number(s.totals.transfers)).toBeGreaterThanOrEqual(3);
        for (const key of ['bySource', 'byDest', 'topItems', 'daily', 'recent']) {
            expect(Array.isArray(s[key])).toBe(true);
        }
        const sent = s.bySource.find((r) => String(r.dept_code).toLowerCase() === BUTCHER);
        expect(sent).toBeTruthy();
        const expectedName = (await sql('SELECT name FROM departments WHERE LOWER(code) = $1', [BUTCHER]))[0].name;
        expect(sent.dept_name).toBe(expectedName);
        expect(sent.value).toBe(Number(Number(sent.value).toFixed(2)));
        const rec = s.recent.find((r) => String(r.source_dept).toLowerCase() === BUTCHER);
        expect(rec.transfer_number).toMatch(/^TR-/);
        expect(rec.source_name).toBe(expectedName);
        expect(rec.lines).toBeGreaterThan(0);
    });

    test('مجموع الحركة اليومية يساوي الإجمالي والقيمة محسوبة بالتكلفة الفعلية', async () => {
        const s = await jget('/api/warehouse/dept-transfers/summary?from=2026-11-01&to=2026-11-30');
        const sumDaily = s.daily.reduce((acc, r) => acc + Number(r.value), 0);
        expect(sumDaily.toFixed(2)).toBe(Number(s.totals.value).toFixed(2));
        expect(s.topItems.length).toBeGreaterThan(0);
        const meat = s.topItems.find((r) => /لحم بقري ZZ/.test(r.item_name));
        expect(Number(meat.qty)).toBeGreaterThanOrEqual(30);
        // 30 كجم × تكلفة الإذن 180 لا تكلفة المخزون 200
        expect(Number(meat.value) % 180).toBe(0);
    });

    test('نطاق external يستبعد المسار الداخلي', async () => {
        const all = await jget('/api/warehouse/dept-transfers/summary?from=2026-11-01&to=2026-11-30');
        const ext = await jget('/api/warehouse/dept-transfers/summary?from=2026-11-01&to=2026-11-30&mode=external');
        const int = await jget('/api/warehouse/dept-transfers/summary?from=2026-11-01&to=2026-11-30&mode=internal');
        expect(ext.mode).toBe('external');
        expect(Number(ext.totals.transfers) + Number(int.totals.transfers))
            .toBe(Number(all.totals.transfers));
        expect(Number(ext.totals.transfers)).toBeGreaterThanOrEqual(2);
    });

    test('مدى بلا تحويلات يرجع أصفارًا لا خطأ', async () => {
        const s = await jget('/api/warehouse/dept-transfers/summary?from=2019-01-01&to=2019-01-02');
        expect(Number(s.totals.transfers)).toBe(0);
        expect(Number(s.totals.value)).toBe(0);
        expect(s.bySource).toEqual([]);
        expect(s.recent).toEqual([]);
    });
});

describe('كل قسم مخزنٌ صغير: بضاعة الإذن التي لم تُستلم تُستلم عند التحويل', () => {
    // بلاغ المالك الحي (2026-11-02): «خرفان-كيلو — وصل هذا الشهر 66.18 · متاح
    // بالمخزن 0 · مش بيضاف». اعتماد المخزن يخصم من المخزن الرئيسي، والقيد في
    // مخزن القسم مشروط بتوقيع الاستلام؛ فالإذن المعتمد غير المستلَم يترك
    // القسم برصيد صفر والمتاح صفرا. السقف إذنُ الصرف نفسه.
    const IN_TRANSIT_DISPATCH = 990304;
    const VOUCHER_UNIT = 'كرتونة';
    let saladsStoreId;

    beforeAll(async () => {
        // الصنف مُحوَّل سابقًا إلى مخزن السلطات (STORE-SALADS) لكن لم يدخله
        // منه شيء: رصيد القسم منه صفر وبضاعته كلها في إذن صرف معتمد.
        await pool.query(
            'INSERT INTO dispatches (id, "deptCode", "deptName", date, status, "approvedItems", "warehouseApprovedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
            [IN_TRANSIT_DISPATCH, SALADS, 'قسم السلطات', '2026-11-02', 'approved',
                JSON.stringify([{
                    itemId: MEAT, itemName: 'لحم بقري ZZ', unit: VOUCHER_UNIT,
                    approvedQty: 25, avgCost: MEAT_VOUCHER_COST, approvedValue: 25 * MEAT_VOUCHER_COST,
                }]),
                '2026-11-02T10:00:00+03:00']);
        saladsStoreId = Number((await sql(
            'SELECT id FROM inventory_locations WHERE code = $1', ['STORE-SALADS']))[0].id);
    });

    test('المتاح يُقرأ من الإذن: صفر رصيد في مخزن القسم لا يُصفِّر المتاح', async () => {
        const body = await jget(`/api/warehouse/dept-transfers/stock?dept=${SALADS}&scope=month`);
        expect(Number(body.location.id)).toBe(saladsStoreId);
        const meat = body.items.find((i) => Number(i.inventory_id) === MEAT);
        expect(Number(meat.month_qty)).toBe(25);
        expect(Number(meat.on_hand)).toBe(0);
        expect(Number(meat.in_transit)).toBe(25);
        expect(Number(meat.available)).toBe(25);
        expect(meat.voucher_unit).toBe(VOUCHER_UNIT);
        expect(meat.unit).toBe(VOUCHER_UNIT);
        expect(meat.sources[0].in_transit).toBe(25);
    });

    test('التحويل الداخلي يستلم الناقص في مخزن القسم بوحدة الإذن ثم يخصمه', async () => {
        const created = await jpost('/api/warehouse/dept-transfers', {
            sourceDeptCode: SALADS, destDeptCode: KITCHEN,
            notes: 'ZZV-transit', items: [{ inventory_id: MEAT, qty: 25 }],
        });
        expect(created.status).toBe(201);
        expect(created.body.metadata.cost_basis).toBe('issue_voucher');
        // المطبخ قسمٌ ومخزنٌ واحد: التحويل إليه يخصم من KITCHEN-MAIN وإليه
        // يُضاف، ولا يُنشأ STORE-KITCHEN فيتشعب مخزن المطبخ بين موقعين.
        expect(Number(created.body.destination_location_id)).toBe(mainLocId);

        mockUser = { id: 990012, role: 'kitchen', name: 'شيف ZZ', dept_code: KITCHEN };
        const approved = await jpost(`/api/warehouse/dept-transfers/${created.body.id}/approve`, {});
        mockUser = { id: 990011, role: 'admin', name: 'مدير المخزن', dept_code: '' };
        expect(approved.status).toBe(200);
        expect(Number(approved.body.total_value)).toBe(4500);

        // الاستلام التلقائي: قيد dispatch_receipt في مخزن القسم، بوحدة الإذن
        // وتكلفته، ومرجعُه إذن الصرف نفسه.
        const receipts = await sql(
            'SELECT location_id, transaction_type, quantity_delta, unit, unit_cost, idempotency_key FROM inventory_ledger WHERE reference_type = $1 AND reference_id = $2',
            ['dispatch_receipt', String(IN_TRANSIT_DISPATCH)]);
        expect(receipts).toHaveLength(1);
        expect(Number(receipts[0].location_id)).toBe(saladsStoreId);
        expect(receipts[0].transaction_type).toBe('transfer_in');
        expect(Number(receipts[0].quantity_delta)).toBe(25);
        expect(receipts[0].unit).toBe(VOUCHER_UNIT);
        expect(Number(receipts[0].unit_cost)).toBe(MEAT_VOUCHER_COST);
        expect(receipts[0].idempotency_key).toContain(String(created.body.id));

        // بنود التحويل وقيوداه يحملان تصنيف الإذن، لا وحدة الصنف العامة.
        const lines = await sql(
            'SELECT unit, requested_qty, unit_cost FROM inventory_transfer_items WHERE transfer_id = $1', [created.body.id]);
        expect(lines).toHaveLength(1);
        expect(lines[0].unit).toBe(VOUCHER_UNIT);
        expect(Number(lines[0].unit_cost)).toBe(MEAT_VOUCHER_COST);
        const moves = await sql(
            'SELECT transaction_type, unit FROM inventory_ledger WHERE reference_type = $1 AND reference_id = $2 ORDER BY id',
            ['inventory_transfer', String(created.body.id)]);
        expect(moves.map((m) => m.unit)).toEqual([VOUCHER_UNIT, VOUCHER_UNIT]);

        // الرصيد: دخل القسم ثم خرج منه — يبقى صفرا، ويستلمه المطبخ.
        const atSalads = await sql(
            'SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $1 AND location_id = $2',
            [MEAT, saladsStoreId]);
        expect(Number(atSalads[0].on_hand)).toBe(0);
        const atKitchen = await sql(
            'SELECT on_hand FROM inventory_location_balances WHERE inventory_id = $1 AND location_id = $2',
            [MEAT, mainLocId]);
        expect(Number(atKitchen[0].on_hand)).toBe(95);

        // مصروف متقابل على المسارين: سالب على المرسل وموجب على المستلم.
        const exps = await expensesOf(created.body.id);
        expect(exps).toHaveLength(2);
        expect(Number(exps[0].amount)).toBe(-4500);
        expect(exps[0].deptId).toBe(SALADS);
        expect(Number(exps[1].amount)).toBe(4500);
        expect(exps[1].deptId).toBe(KITCHEN);
    });

    test('الإذن لا يُستلم مرتين: الكمية صُرفت واستلامها مسجل في الإذن', async () => {
        const row = (await sql('SELECT status, "receivedItems" FROM dispatches WHERE id = $1', [IN_TRANSIT_DISPATCH]))[0];
        expect(row.status).toBe('received');
        const received = Array.isArray(row.receivedItems) ? row.receivedItems : [];
        expect(received).toHaveLength(1);
        expect(Number(received[0].receivedQty)).toBe(25);
        expect(received[0].unit).toBe(VOUCHER_UNIT);

        const body = await jget(`/api/warehouse/dept-transfers/stock?dept=${SALADS}&scope=month`);
        const meat = body.items.find((i) => Number(i.inventory_id) === MEAT);
        expect(Number(meat.transferred_qty)).toBe(25);
        expect(Number(meat.in_transit)).toBe(0);
        expect(Number(meat.available)).toBe(0);

        const over = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: SALADS, destDeptCode: EXTERNAL,
            notes: 'ZZV-transit-over', items: [{ inventory_id: MEAT, qty: 5 }],
        });
        expect(over.status).toBe(409);
        expect(over.body.error).toBe('INSUFFICIENT_STOCK');
        expect(Number(over.body.available)).toBe(0);
        expect(await transfersOf('ZZV-transit-over')).toHaveLength(0);

        // لا قيد استلام ثانياً لنفس الإذن والصنف.
        const receipts = await sql(
            'SELECT id FROM inventory_ledger WHERE reference_type = $1 AND reference_id = $2',
            ['dispatch_receipt', String(IN_TRANSIT_DISPATCH)]);
        expect(receipts).toHaveLength(1);
    });
});
