/**
 * dept-transfer-factory.test.js — المصنع: تسوية بسعر القائمة + الفرق الشهري
 * ═══════════════════════════════════════════════════════════════════════
 * قرار المالك 2026-11-03: قسم مُصنِّع (is_factory) يسلّم إنتاجه لمنافذ البيع
 * الخارجية، والتحويل يُقيَّم بنفس أسعار البيع التي يبيع بها المنفذ — تُقرأ
 * تلقائيًا من القائمة (pos_products.price) بلا قوائم أسعار يدوية. الإيراد
 * يُسجَّل للمصنع (4000 دائن بمركزه) ويُحمَّل المنفذ (5000 مدين بمركزه)،
 * والتكلفة تبقى على المصنع: لا قيود تكلفة تحويل إطلاقًا.
 *
 * العقود المثبَّتة هنا (سلوكًا لا نصًّا):
 *   1) تنفيذ تحويل المصنع يقيّمه بسعر القائمة لحظة التنفيذ: factory_total_value
 *     = كمية × سعر القائمة، وتُحفظ اللقطة في metadata.factory_pricing.
 *   2) التسوية المالية: إيراد +القيمة على قسم المصنع في revenues، وتحميل
 *     +نفس القيمة على المنفذ في expenses بنوع factory_settlement —
 *     وبلا أي مصروف inventory_transfer (التكلفة لا تُنقل).
 *   3) صنف بلا ربط قائمة يُرفض صراحة FACTORY_PRICE_MISSING، واسم متطابق
 *     بسعرين مختلفين يُرفض FACTORY_PRICE_AMBIGUOUS — لا صفر صامت ولا تخمين.
 *   4) روابط المصنع (GET/PUT factory-links) هي مصدر التسعير: ربطٌ واحد لكل
 *     صنف، وفك القديم عند الربط الجديد.
 *   5) فرق الشهر: قيمة التحويل مقابل مبيعات المنفذ الفعلية (ys_mirror_orders
 *     بكود Yara وبكاشيرات المنفذ فقط)، والقفل يُقيّد فرق كل منفذ تعديلًا
 *     واحدًا idempotent لكل (مصنع، منفذ، شهر).

 * البيانات: karim_erp_test المعزولة (بوابة global-setup). كل الصفوف بمعرّفات
 * 99xxxx وبواسم ZZF وتُحذف في afterAll بترتيب المفاتيح الأجنبية.
 */
'use strict';

const express = require('express');

const mockUser = { id: 990021, role: 'admin', name: 'مدير مصنع ZZ', dept_code: '' };

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = mockUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/transfer-notifier', () => ({
    notifyTransferEvent: jest.fn(async () => {}),
}));

/* قيد المحاسبة يُراقَب (spy فوق التنفيذ الحقيقي) — مراكز التكلفة تُنشأ فعلًا،
 * وأسطر القيد تُفحص على الـspy بدل انتظار الكتبة المؤجلة. */
jest.mock('../backend/accounting-routes', () => {
    const actual = jest.requireActual('../backend/accounting-routes');
    return {
        ...actual,
        postJournal: jest.fn(async () => ({ entry: { entry_no: 990001 }, replay: false })),
    };
});

const { pool } = require('../backend/shared-pool');
const { postJournal } = require('../backend/accounting-routes');
const { router } = require('../backend/dept-transfer-routes');

const FACTZZ = 'FACTZZ';
const EXTERNAL = 'external_sales';
const DEPT_ID = 990501;
const USER_IDS = [990021];

const ORANGE = 990601;   // مربوط: عصير برتقال ZZ @ 13.04
const COCKTAIL = 990602; // مربوط: كوكتيل ZZ @ 15
const APPLE = 990603;    // غير مربوط — يُرفض حتى يُربط
const LEMON = 990604;    // اسمان متطابقان بسعرين — غموض يُرفض

// pos_products.id مولد تلقائيًا — تُلتقط المعرّفات بعد الإدراج في beforeAll
const PROD = {};

const DISPATCH_ID = 990701;
const VOUCHER_AT = '2026-11-02T10:00:00+03:00';

let server;
let baseUrl;
let mainLocId;
let month;
let preExisting = { stores: [], costCenters: [] };

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
const jput = async (pathname, body) => {
    const res = await fetch(baseUrl + pathname, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wipe() {
    await pool.query('DELETE FROM revenues WHERE "deptId" = $1', [FACTZZ]);
    await pool.query('DELETE FROM expenses WHERE "deptId" = ANY($1::text[]) AND "adjustmentType" = \'factory_settlement\'', [[FACTZZ, EXTERNAL]]);
    await pool.query('DELETE FROM inventory_ledger WHERE inventory_id = ANY($1::bigint[]) AND (reference_type = \'inventory_transfer\' OR reference_type = \'dispatch_receipt\')',
        [[ORANGE, COCKTAIL, APPLE, LEMON]]);
    await pool.query('DELETE FROM inventory_transfer_items WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE notes LIKE \'ZZF%\')');
    await pool.query('DELETE FROM inventory_transfer_events WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE notes LIKE \'ZZF%\')');
    await pool.query('DELETE FROM inventory_transfers WHERE notes LIKE \'ZZF%\'');
    await pool.query('DELETE FROM ys_mirror_orders WHERE doc_no LIKE \'ZZFAC%\'');
    await pool.query('DELETE FROM dept_cashier_links WHERE dept_code = $1 AND cashier_no = $2', [EXTERNAL, '99']);
    // منتجات القائمة بلا معرّف صريح (id مولد) — الوسم بالاسم والـyara_code
    await pool.query("DELETE FROM pos_products WHERE name_ar LIKE '% ZZ' OR metadata->>'yara_code' = ANY($1::text[])", [['ZZORANGE', 'ZZCOCKTAIL', 'ZZLEMON']]);
    await pool.query('DELETE FROM inventory_location_balances WHERE inventory_id = ANY($1::bigint[])', [[ORANGE, COCKTAIL, APPLE, LEMON]]);
    await pool.query('DELETE FROM dispatches WHERE id = $1::bigint', [DISPATCH_ID]);
    await pool.query('DELETE FROM inventory_locations WHERE dept_code = $1', [FACTZZ]);
    for (const code of ['STORE-EXTERNAL']) {
        if (!preExisting.stores.includes(code)) {
            await pool.query('DELETE FROM inventory_locations WHERE code = $1', [code]);
        }
    }
    for (const code of ['FACTZZ', 'EXTERNAL_SALES']) {
        if (!preExisting.costCenters.includes(code)) {
            await pool.query('DELETE FROM cost_centers WHERE code = $1', [code]);
        }
    }
    await pool.query('DELETE FROM inventory WHERE id = ANY($1::bigint[])', [[ORANGE, COCKTAIL, APPLE, LEMON]]);
    await pool.query('DELETE FROM departments WHERE code = $1', [FACTZZ]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [USER_IDS]);
}

beforeAll(async () => {
    await wipe();
    preExisting = {
        stores: (await sql('SELECT code FROM inventory_locations WHERE code = ANY($1::text[])', [['STORE-EXTERNAL']])).map((r) => r.code),
        costCenters: (await sql('SELECT code FROM cost_centers WHERE code = ANY($1::text[])', [['FACTZZ', 'EXTERNAL_SALES']])).map((r) => r.code),
    };
    month = (await sql("SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS m"))[0].m;

    await pool.query('INSERT INTO departments (id, code, name, is_factory) VALUES ($1,$2,$3,true)', [DEPT_ID, FACTZZ, 'مصنع عصير ZZ']);
    await pool.query('INSERT INTO users (id, username, password, role, name) VALUES ($1,$2,$3,$4,$5)',
        [990021, 'zz-factory-admin', 'zz-no-credential', 'admin', 'مدير مصنع ZZ']);

    const loc = await sql('SELECT id FROM inventory_locations WHERE code = \'KITCHEN-MAIN\' AND active = true');
    expect(loc.length).toBe(1);
    mainLocId = Number(loc[0].id);

    await pool.query('INSERT INTO inventory (id, name, unit, qty, "avgCost") VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15),($16,$17,$18,$19,$20)',
        [ORANGE, 'عصير برتقال ZZ', 'عبوة', 30, 6,
            COCKTAIL, 'كوكتيل فواكه ZZ', 'عبوة', 20, 8,
            APPLE, 'عصير تفاح ZZ', 'عبوة', 15, 4,
            LEMON, 'عصير ليمون ZZ', 'عبوة', 10, 5]);
    await pool.query('INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)',
        [ORANGE, mainLocId, 30, COCKTAIL, mainLocId, 20, APPLE, mainLocId, 15, LEMON, mainLocId, 10]);

    // إذن صرف معتمد للمصنع — أساس التحويل (assertMonthSourced)
    await pool.query('INSERT INTO dispatches (id, "deptCode", "deptName", date, status, "approvedItems", "warehouseApprovedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
        [DISPATCH_ID, FACTZZ, 'مصنع عصير ZZ', '2026-11-02', 'approved',
            JSON.stringify([
                { itemId: ORANGE, itemName: 'عصير برتقال ZZ', approvedQty: 30, avgCost: 6, approvedValue: 180 },
                { itemId: COCKTAIL, itemName: 'كوكتيل فواكه ZZ', approvedQty: 20, avgCost: 8, approvedValue: 160 },
                { itemId: APPLE, itemName: 'عصير تفاح ZZ', approvedQty: 15, avgCost: 4, approvedValue: 60 },
                { itemId: LEMON, itemName: 'عصير ليمون ZZ', approvedQty: 10, avgCost: 5, approvedValue: 50 },
            ]), VOUCHER_AT]);

    // منتجات القائمة: ربط صريح للبرتقال والكوكتيل، واسم متطابق بسعرين للّيمون
    const seedProducts = [
        { key: 'orange', name_ar: 'عصير برتقال طازج ZZ', price: 13.04, legacy_inventory_id: ORANGE, yara: 'ZZORANGE' },
        { key: 'cocktail', name_ar: 'كوكتيل فواكه ZZ', price: 15, legacy_inventory_id: COCKTAIL, yara: 'ZZCOCKTAIL' },
        { key: 'lemonA', name_ar: 'عصير ليمون ZZ', price: 7, legacy_inventory_id: null, yara: 'ZZLEMON' },
        { key: 'lemonB', name_ar: 'عصير ليمون ZZ', price: 8, legacy_inventory_id: null, yara: 'ZZLEMON' },
    ];
    for (const p of seedProducts) {
        const r = await pool.query(
            'INSERT INTO pos_products (name_ar, price, legacy_inventory_id, metadata, is_active) VALUES ($1,$2,$3,$4::jsonb,true) RETURNING id',
            [p.name_ar, p.price, p.legacy_inventory_id, JSON.stringify({ yara_code: p.yara })]);
        PROD[p.key] = Number(r.rows[0].id);
    }

    // مبيعات المنفذ الفعلية (المرآة): 12 عبوة برتقال بكاشير البيع الخارجي
    await pool.query('INSERT INTO dept_cashier_links (id, dept_code, cashier_no, is_primary) VALUES ($1,$2,$3,false)', [990901, EXTERNAL, '99']);
    await pool.query('INSERT INTO ys_mirror_orders (doc_no, cashier_no, doc_date, lines) VALUES ($1,$2,$3::date,$4::jsonb)',
        ['ZZFAC001', '99', month + '-05', JSON.stringify([
            { code: 'ZZORANGE', name: 'عصير برتقال طازج', qty: 12, price: 13.04, total: 156.48 },
        ])]);

    const app = express();
    app.use(express.json());
    app.use('/api/warehouse', (req, res, next) => { req.io = null; next(); }, router);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    postJournal.mockClear();
});

afterAll(async () => {
    if (server) { await new Promise((resolve) => server.close(resolve)); }
    await wipe();
    await pool.end();
});

const transfersOf = (notes) => sql('SELECT * FROM inventory_transfers WHERE notes = $1', [notes]);
const revenuesOf = (deptId) => sql('SELECT * FROM revenues WHERE "deptId" = $1 ORDER BY id', [deptId]);
const expensesOf = (deptId) => sql('SELECT * FROM expenses WHERE "deptId" = $1 ORDER BY id', [deptId]);

describe('المصنع: تسوية بسعر القائمة', () => {
    test('تنفيذ التحويل يقيّمه بسعر القائمة ويحفظ اللقطة', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: ORANGE, qty: 10 }],
            notes: 'ZZF orange',
        });
        expect(res.status).toBe(201);
        expect(res.body.factory_total_value).toBeCloseTo(130.4, 2);
        const row = res.body.factory_pricing.find((p) => Number(p.inventory_id) === ORANGE);
        expect(row).toBeTruthy();
        expect(row.menu_product_id).toBe(PROD.orange);
        expect(Number(row.price)).toBeCloseTo(13.04, 2);
        expect(row.yara_code).toBe('ZZORANGE');

        const stored = (await transfersOf('ZZF orange'))[0];
        expect(stored.metadata.factory).toBe(true);
        expect(stored.metadata.pricing_basis).toBe('menu_price');
        expect(Number(stored.metadata.factory_total_value)).toBeCloseTo(130.4, 2);
    });

    test('التسوية المالية: إيراد للمصنع + تحميل على المنفذ، وبلا قيود تكلفة', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: ORANGE, qty: 5 }],
            notes: 'ZZF money',
        });
        expect(res.status).toBe(201);
        const t = (await transfersOf('ZZF money'))[0];

        const revs = await revenuesOf(FACTZZ);
        const hit = revs.find((r) => String(r.source) === ('مصنع — ' + t.transfer_number));
        expect(hit).toBeTruthy();
        expect(Number(hit.amount)).toBeCloseTo(65.2, 2);
        // تاريخ الإيراد بيوم الرياض (نفس riyadhDayOf في الخادم) — العمود نصي YYYY-MM-DD
        const dayText = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(t.created_at));
        expect(String(hit.date).slice(0, 10)).toBe(dayText);

        const exps = await expensesOf(EXTERNAL);
        const exp = exps.find((e) => Math.abs(Number(e.amount) - 65.2) < 0.001 && e.adjustmentType === 'factory_settlement');
        expect(exp).toBeTruthy();
        // التكلفة تبقى على المصنع — لا مصروف تحويل تكلفة لهذا التحويل إطلاقًا
        const costLegs = await sql('SELECT COUNT(*)::int AS n FROM expenses WHERE notes LIKE $1 AND "adjustmentType" = \'inventory_transfer\'', ['%transfer:' + t.id + ':%']);
        expect(costLegs[0].n).toBe(0);
    });

    test('قيد المحاسبة: 4000 دائن بمركز المصنع و5000 مدين بمركز المنفذ', async () => {
        postJournal.mockClear();
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: COCKTAIL, qty: 4 }],
            notes: 'ZZF journal',
        });
        expect(res.status).toBe(201);
        const t = (await transfersOf('ZZF journal'))[0];
        // القيد يُرسل fire-and-forget — ننتظر نداء هذا التحويل نفسه لا أول نداء في الرتل
        let payload = null;
        for (let i = 0; i < 40 && !payload; i++) {
            const call = postJournal.mock.calls.find(
                ([, p]) => p.source_type === 'factory_settlement' && String(p.source_id) === String(t.id));
            if (call) { payload = call[1]; break; }
            await sleep(50);
        }
        expect(payload).toBeTruthy();
        expect(payload.source_id).toBe(String(t.id));
        const credit = payload.lines.find((l) => l.account_code === '4000');
        const debit = payload.lines.find((l) => l.account_code === '5000');
        expect(credit.cost_center_code).toBe('FACTZZ');
        expect(Number(credit.credit)).toBeCloseTo(60, 2);
        expect(debit.cost_center_code).toBe('EXTERNAL_SALES');
        expect(Number(debit.debit)).toBeCloseTo(60, 2);
    });

    test('صنف بلا ربط قائمة يُرفض صراحة ولا يُكتب شيء', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: APPLE, qty: 3 }],
            notes: 'ZZF unlinked',
        });
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('FACTORY_PRICE_MISSING');
        expect((await transfersOf('ZZF unlinked')).length).toBe(0);
    });

    test('اسم متطابق بسعرين مختلفين يُرفض FACTORY_PRICE_AMBIGUOUS', async () => {
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: LEMON, qty: 2 }],
            notes: 'ZZF ambiguous',
        });
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('FACTORY_PRICE_AMBIGUOUS');
        expect((await transfersOf('ZZF ambiguous')).length).toBe(0);
    });

    test('الربط يفتح التحويل: PUT يربط ثم ينجح التنفيذ بسعر المنتج', async () => {
        const put = await jput('/api/warehouse/dept-transfers/factory-links', { inventory_id: APPLE, product_id: PROD.orange });
        expect(put.status).toBe(200);
        expect(put.body.ok).toBe(true);
        // الربط يُحوَّل من البرتقال إلى التفاح (ربط واحد لكل صنف/منتج)
        const links = (await sql('SELECT legacy_inventory_id, price FROM pos_products WHERE id = ANY($1::bigint[]) ORDER BY id', [[PROD.orange, PROD.cocktail]]));
        expect(Number(links[0].legacy_inventory_id)).toBe(APPLE);
        const res = await jpost('/api/warehouse/dept-transfers/external', {
            sourceDeptCode: FACTZZ, destDeptCode: EXTERNAL,
            items: [{ inventory_id: APPLE, qty: 3 }],
            notes: 'ZZF linked',
        });
        expect(res.status).toBe(201);
        expect(res.body.factory_total_value).toBeCloseTo(39.12, 2);
    });

    test('روابط المصنع: GET يعيد الأصناف والأسعار ووضع المصنع', async () => {
        const links = await jget('/api/warehouse/dept-transfers/factory-links?dept=' + FACTZZ);
        expect(links.factory).toBe(true);
        expect(Array.isArray(links.menu_products)).toBe(true);
        const orange = links.items.find((i) => Number(i.inventory_id) === APPLE);
        expect(orange).toBeTruthy();
        expect(orange.menu_product_id).toBe(PROD.orange);
        expect(Number(orange.price)).toBeCloseTo(13.04, 2);
    });
});

describe('فرق المصنع الشهري', () => {
    test('التقرير يقابل قيمة التحويل بمبيعات المنفذ الفعلية بكود Yara', async () => {
        const rep = await jget('/api/warehouse/dept-transfers/factory-variance?month=' + month);
        const f = (rep.factories || []).find((x) => String(x.dept_code) === FACTZZ);
        expect(f).toBeTruthy();
        const orange = f.rows.find((r) => Number(r.inventory_id) === ORANGE);
        expect(orange).toBeTruthy();
        expect(orange.matchable).toBe(true);
        expect(Number(orange.transferred_value)).toBeCloseTo(195.6, 2); // 10 + 5 عبوة × 13.04
        expect(Number(orange.sold_qty)).toBeCloseTo(12, 3);
        expect(Number(orange.sold_value)).toBeCloseTo(156.48, 2);
        const part = orange.by_dest[EXTERNAL];
        expect(part).toBeTruthy();
        expect(Number(part.diff)).toBeCloseTo(-39.12, 2);
    });

    test('القفل يقيّد فرق كل منفذ تعديلًا واحدًا idempotent', async () => {
        const rep = await jget(`/api/warehouse/dept-transfers/factory-variance?month=${month}`);
        const f = (rep.factories || []).find((x) => String(x.dept_code) === FACTZZ);
        expect(f).toBeTruthy();
        // دلتا المنفذ = مجموع فروق منتجاته القابلة للمطابقة (نفس حساب الخادم)
        let expectedDelta = 0;
        for (const r of f.rows) {
            if (!r.matchable) {continue;}
            for (const part of Object.values(r.by_dest || {})) { expectedDelta += Number(part.diff) || 0; }
        }
        expectedDelta = Number(expectedDelta.toFixed(2));
        expect(Math.abs(expectedDelta)).toBeGreaterThanOrEqual(0.01);

        const close1 = await jpost(`/api/warehouse/dept-transfers/factory-variance/${month}/close`, { deptCode: FACTZZ });
        expect(close1.status).toBe(200);
        expect(close1.body.ok).toBe(true);
        expect(Number(close1.body.closable_diff_value)).toBeCloseTo(expectedDelta, 2);
        const closed = (close1.body.closed || []).find((r) => r.dest === EXTERNAL);
        expect(closed).toBeTruthy();
        expect(Number(closed.delta)).toBeCloseTo(expectedDelta, 2);

        const revs1 = await sql("SELECT COUNT(*)::int AS n FROM revenues WHERE \"deptId\" = $1 AND source LIKE 'تسوية فرق مصنع%'", [FACTZZ]);
        expect(revs1[0].n).toBe(1);

        const close2 = await jpost(`/api/warehouse/dept-transfers/factory-variance/${month}/close`, { deptCode: FACTZZ });
        expect(close2.status).toBe(200);
        const revs2 = await sql("SELECT COUNT(*)::int AS n FROM revenues WHERE \"deptId\" = $1 AND source LIKE 'تسوية فرق مصنع%'", [FACTZZ]);
        expect(revs2[0].n).toBe(1);

        await sleep(200);
        const calls = postJournal.mock.calls.filter(([, payload]) => payload.source_type === 'factory_variance_close');
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(calls[0][1].source_id).toBe(FACTZZ + ':' + EXTERNAL + ':' + month);
    });
});
