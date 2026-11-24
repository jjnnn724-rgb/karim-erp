const { warehouseSource } = require('./helpers/warehouse-source');
// ────────────────────────────────────────────────────────────────────────────
// dispatch-chain-guard.test.js — طلب المالك 2026-10-05
// «مش عايز الموضوع دا يتكر نهايا مطلقًا — إذن الصرف لا يتم إرساله من القسم
//  وأي منتج ناقص أقل من الكمية المطلوبة»
//
// بوابة الرصيد dispatchStockGate نفسها مختبرة في dispatch-stock-gate.test.js —
// هذا الملف يقفل «أسلاك التوصيل»: أن كل نقطة قبول في سلسلة إذن الصرف تستدعي
// البوابة فعلًا في الكود الحي، وأن تسوية الاستلام القديمة محرسة ضد التكرار
// (سبب تضخيم الأرصدة ثم خسارتها عند العكس). أي تعديل مستقبلي يزيل حارسًا
// يُسقط هذا الاختبار فورًا.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// لا اتصال بقاعدة ولا Redis: حراس المسارات أدناه يعملون على عميل وهمي،
// واختبارات idempotency تستعمل مخزن الذاكرة الحقيقي في الوسيط.
jest.mock('../backend/shared-pool', () => {
    const unavailable = async () => { throw new Error('DB disabled in dispatch guard tests'); };
    return { pool: { query: jest.fn(unavailable) }, withTransaction: jest.fn(unavailable) };
});

const { __scope: WAREHOUSE_SCOPE } = require('../backend/warehouse-routes');
const { idempotency } = require('../backend/middleware/idempotency');

const ROUTES = warehouseSource();
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
const DISPATCH_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse', 'dispatch-routes.js'), 'utf8');
const KITCHEN = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'kitchen.js'), 'utf8');
const SIGNATURE = `data:image/png;base64,${'A'.repeat(64)}`;

const between = (src, startMark, endMark) => {
    const s = src.indexOf(startMark);
    expect(s).toBeGreaterThan(-1);
    const e = src.indexOf(endMark, s + 1);
    expect(e).toBeGreaterThan(s);
    return src.slice(s, e);
};

function dispatchHarness({ dispatch, onQuery = () => undefined, accountingPost } = {}) {
    const routes = new Map();
    const router = {};
    for (const method of ['use', 'get', 'post', 'put', 'delete']) {
        router[method] = (route, ...handlers) => {
            if (method !== 'use') { routes.set(`${method.toUpperCase()} ${route}`, handlers); }
        };
    }
    const client = {
        query: jest.fn(async (sql, params = []) => {
            const supplied = await onQuery(sql, params);
            if (supplied !== undefined) { return supplied; }
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SET LOCAL')) {
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT \* FROM dispatches WHERE id/.test(sql)) { return { rows: [dispatch] }; }
            throw new Error(`Unexpected SQL in dispatch harness: ${sql.slice(0, 160)}`);
        }),
        release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) };
    const postInventoryLedgerEntry = jest.fn(async (input) => ({
        ledger: { id: 1, ...input }, replay: false, balanceAfter: 0,
    }));
    const postDispatchToLedger = accountingPost || jest.fn(async () => ({ entry: { id: 1 } }));
    const appendDispatchEvent = jest.fn(async () => ({ id: 1 }));
    const scope = {
        ...WAREHOUSE_SCOPE,
        router,
        pool,
        postInventoryLedgerEntry,
        appendDispatchEvent,
        emitDomainEvent: jest.fn(async () => {}),
        ensureDispatchCreatorSchema: jest.fn(async () => {}),
        notifyChainEvent: jest.fn(),
        latestExpiryFor: jest.fn(async () => null),
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    };
    const module = { exports: {} };
    vm.runInNewContext(DISPATCH_SOURCE, {
        require(name) {
            if (name === '../warehouse-routes') { return { __scope: scope }; }
            if (name === '../accounting-routes') { return { postDispatchToLedger }; }
            if (name === '../journal-void') { return require('../backend/journal-void'); }
            return require(name);
        },
        module,
        exports: module.exports,
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Map,
        Set,
        JSON,
        Object,
        Error,
        Promise,
    }, { filename: 'backend/warehouse/dispatch-routes.js' });
    return { routes, client, pool, postInventoryLedgerEntry, postDispatchToLedger, appendDispatchEvent };
}

async function invokeDispatch(action, options) {
    const harness = dispatchHarness(options);
    const user = options.user || { id: 2, name: 'أمين المخزن', username: 'warehouse', role: 'warehouse' };
    const req = {
        params: { id: String(options.dispatch.id) },
        body: { signatureData: SIGNATURE, signerName: user.name || user.username, ...(options.body || {}) },
        user,
        headers: { 'x-idempotency-key': `dispatch-guard-${action}-${options.dispatch.id}` },
        io: null,
    };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    const method = action === 'edit' ? 'PUT' : 'POST';
    const handlers = harness.routes.get(`${method} /dispatches/:id/${action}`);
    expect(handlers).toBeDefined();
    await handlers[handlers.length - 1](req, res);
    return {
        ...harness,
        req,
        res,
        sql: harness.client.query.mock.calls.map(([statement]) => statement),
    };
}

async function runIdempotencyRequest(key, body, handler) {
    const previousRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const req = { method: 'POST', originalUrl: '/api/dispatches/41/approve', headers: {}, body };
    if (key) { req.headers['x-idempotency-key'] = key; }
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; finish(); return this; },
        end() { this.body = null; finish(); return this; },
    };
    const next = jest.fn(async (error) => {
        if (error) {
            res.statusCode = error.statusCode || 500;
            res.error = error;
            finish();
            return;
        }
        await handler(req, res);
    });
    try {
        await idempotency({ requireKey: true })(req, res, next);
        if (res.statusCode >= 200 && res.statusCode < 300) { await completed; }
        return { req, res, next };
    } finally {
        if (previousRedis === undefined) { delete process.env.REDIS_URL; }
        else { process.env.REDIS_URL = previousRedis; }
    }
}

describe('سلسلة إذن الصرف: بوابة الرصيد مركّبة في كل نقطة قبول', () => {
    test('الإنشاء POST /api/dispatches — الخادم يرفض طلبًا فوق الرصيد قبل ولودته أصلًا', () => {
        const block = between(SERVER, "if (entity === 'dispatches') {", 'const keys = Object.keys(filtered)');
        expect(block).toContain('dispatchStockGate(pool, gateItems)');
        expect(block).toContain("error: 'INSUFFICIENT_STOCK'");
        expect(block).toContain('لا يمكن قبول إذن الصرف');
        // حقول دورة العمل لا تُفرض من CRUD العام (لا يمكن ولادة إذن معتمد/مستلم بالغش)
        expect(block).toContain('WORKFLOW_FIELDS_FORBIDDEN');
    });

    test('اعتماد الشيف العمومي — بوابة الرصيد قبل قلب الحالة إلى chef_approved', () => {
        const block = between(ROUTES, "router.post('/dispatches/:id/chef-approve'", "router.post('/dispatches/:id/chef-reject'");
        const gateAt = block.indexOf('dispatchStockGate(client, dispatch.items)');
        const updateAt = block.indexOf("status='chef_approved'");
        expect(gateAt).toBeGreaterThan(-1);
        expect(updateAt).toBeGreaterThan(gateAt); // البوابة قبل التحديث — لا اعتماد ثم اكتشاف نقص
        expect(block).toContain('INSUFFICIENT_STOCK');
    });

    test('الاعتماد المخزني — السقف هو الطلب الأصلي، والحارس قبل أي أثر مالي', () => {
        const block = between(ROUTES, "router.post('/dispatches/:id/approve'", "router.post('/dispatches/:id/chef-approve'");
        const guardAt = block.indexOf('canWarehouseApprove(dispatch, req.user)');
        const revisionAt = block.indexOf('dispatchRevision(client, dispatch.id)');
        const ledgerAt = block.indexOf('postInventoryLedgerEntry(');
        expect(guardAt).toBeGreaterThan(-1);
        expect(revisionAt).toBeGreaterThan(guardAt);
        expect(ledgerAt).toBeGreaterThan(guardAt);
        expect(block).toContain('APPROVAL_ITEM_NOT_REQUESTED');
        expect(block).toContain('effectiveQty > n(requestedLine.qty)');
        expect(block).toContain('packagingQty > n(requestedLine.qty)');
        expect(block).toContain('normalizeRequestedItems(dispatch.items)');
        expect(block).toContain('DISPATCH_ALREADY_RECEIVED');
        expect(block).toContain('DISPATCH_ALREADY_APPROVED');
        expect(block).toContain('INSUFFICIENT_STOCK');
        expect(block).toContain('effectiveQty > totalAvailable');
        expect(block).toContain('INSERT INTO expenses');
        expect(block).toContain('postDispatchToLedger(dispatch.id');
        expect(block.indexOf('postDispatchToLedger(dispatch.id')).toBeLessThan(block.indexOf("client.query('COMMIT')"));
    });

    test('تعديل الإذن — التعديل يمر بالبوابة نفسها (لا توسيع الكميات فوق الرصيد بعد القبول)', () => {
        const block = between(ROUTES, "router.put('/dispatches/:id/edit'", "router.post('/dispatches/:id/reject'");
        expect(block).toContain('dispatchStockGate');
        expect(block).toContain('INSUFFICIENT_STOCK');
    });

    test('الاستلام — فرق النداء الواحد ضد المعتمد والمستلم سابقًا، وسقف تعبئة مستقل', () => {
        const block = between(ROUTES, "router.post('/dispatches/:id/receive'", "router.post('/returns'");
        expect(block).toContain('DISPATCH_NOT_RECEIVABLE');
        expect(block).toContain('DISPATCH_RECEIPT_ALREADY_RECORDED');
        expect(block).toContain('receivedQty > n(allowed.qty)');
        expect(block).toContain('alreadyReceivedQty + receivedDeltaQty');
        expect(block).toContain('receivedPackagingQty > allowedPkg + 1e-6');
        expect(block).toContain('receivedDeltaQty <= 0');
        expect(block).toContain('${base}:${receiptOperationKey}:in');
        expect(block).toContain('receivedQty: round(receivedQty)');
        expect(block).toContain('approvedPackagingQty: allowedPkg, receivedPackagingQty');
        expect(block).not.toContain('INSERT INTO expenses');
    });

    test('التعديل العام PUT /api/dispatches/:id مرفوض كليًا — ما فيش باب جانبي للحالة أو الأصناف', () => {
        expect(SERVER).toContain("entity === 'dispatches') {return res.status(405).json({ error: 'DISPATCH_WORKFLOW_REQUIRED'");
        expect(SERVER).toContain('WORKFLOW_FIELDS_FORBIDDEN');
    });

    test('طلب الصرف: صنف صفر الرصيد لا يظهر نهائيًا — وبلا أرصدة مؤكدة لا تُعرض أصناف أصلًا', () => {
        // لا رجوع للإجمالي الكلي حين يفشل جلب أرصدة الرئيسي (كان يعرض أصنافًا غير متاحة)
        expect(KITCHEN).toContain('if(dispatchMainAvail){ return dispatchMainAvail.get(Number(item.id)) ?? 0; }');
        expect(KITCHEN).toContain('return 0;');
        expect(KITCHEN).not.toContain('return Number(item.qty)||0;');
        // الأصناف الصفر: لا قائمة ولا عدّاد مخفيين
        expect(KITCHEN).not.toContain('hiddenOut');
        expect(KITCHEN).toContain('الأصناف صفر الرصيد لا تُعرض في طلب الصرف');
        // فشل جلب الأرصدة → شاشة خطأ + إعادة محاولة، لا منتقي أصناف
        expect(KITCHEN).toContain('تعذر جلب أرصدة المخزن الرئيسي');
        expect(KITCHEN).toContain('إعادة المحاولة');
    });
});

describe('دورة الحياة المالية: لا حذف، وعكس الأثر داخل معاملة واحدة', () => {
    test('كل تغيير حالة مالي مخصص ويلزمه X-Idempotency-Key', () => {
        const actions = ['cancel', 'reopen', 'void', 'approve', 'receive', 'edit', 'reject', 'chef-approve', 'chef-reject'];
        for (const action of actions) {
            const method = action === 'edit' ? 'put' : 'post';
            const start = DISPATCH_SOURCE.indexOf(`router.${method}('/dispatches/:id/${action}'`);
            expect(start).toBeGreaterThan(-1);
            const registration = DISPATCH_SOURCE.slice(start, DISPATCH_SOURCE.indexOf('\n', start));
            expect(registration).toContain('jwtAuth');
            expect(registration).toContain('idempotency({ requireKey: true })');
        }
        for (const action of ['reopen', 'void', 'approve', 'receive']) {
            const start = DISPATCH_SOURCE.indexOf(`router.post('/dispatches/:id/${action}'`);
            const block = DISPATCH_SOURCE.slice(start, DISPATCH_SOURCE.indexOf('const client =', start));
            expect(block).toContain('requireSignature(req, res)');
        }
    });

    test('الإلغاء قبل الصرف فقط، والرفض يسبق تحديث الحالة أو حفظ الحدث', () => {
        const block = between(DISPATCH_SOURCE, "router.post('/dispatches/:id/cancel'", "router.post('/dispatches/:id/reopen'");
        expect(block).toContain("['pending', 'chef_approved', 'rejected'].includes(dispatch.status)");
        expect(block).toContain('DISPATCH_NOT_CANCELLABLE');
        const denyAt = block.indexOf("['pending', 'chef_approved', 'rejected'].includes(dispatch.status)");
        const updateAt = block.indexOf("UPDATE dispatches SET status='cancelled'");
        const eventAt = block.indexOf("appendDispatchEvent(client, dispatch.id, 'cancelled'");
        const commitAt = block.indexOf("client.query('COMMIT')");
        expect(denyAt).toBeLessThan(updateAt);
        expect(updateAt).toBeLessThan(eventAt);
        expect(eventAt).toBeLessThan(commitAt);
    });

    test('إعادة الفتح للمعتمد غير المستلم فقط: أي حركة استلام حقيقية تمنعها قبل العكس', () => {
        const block = between(DISPATCH_SOURCE, "router.post('/dispatches/:id/reopen'", "router.post('/dispatches/:id/void'");
        const statusAt = block.indexOf("dispatch.status !== 'approved'");
        const receiptAt = block.indexOf("reference_type='dispatch_receipt'");
        const reverseAt = block.indexOf("reverseDispatchStock(client, dispatch, req, 'reopen')");
        const financialAt = block.indexOf('voidDispatchExpenses(client, dispatch, req');
        const commitAt = block.indexOf("client.query('COMMIT')");
        expect(block).toContain('DISPATCH_NOT_REOPENABLE');
        expect(block).toContain('DISPATCH_RECEIPT_ALREADY_RECORDED');
        expect(statusAt).toBeLessThan(receiptAt);
        expect(receiptAt).toBeLessThan(reverseAt);
        expect(reverseAt).toBeLessThan(financialAt);
        expect(financialAt).toBeLessThan(commitAt);
        expect(block).toContain("UPDATE dispatches SET status='pending'");
        expect(block).toContain("appendDispatchEvent(client, dispatch.id, 'reopened'");
        expect(block).toContain('req, signature, { reason, movements, ...financial }');
    });

    test('الإبطال بعد الصرف: يمنع مرتجعًا نشطًا، ويعكس الصرف والاستلام، ويصفر المصروف قبل COMMIT', () => {
        const block = between(DISPATCH_SOURCE, "router.post('/dispatches/:id/void'", "router.post('/dispatches/:id/approve'");
        const activeAt = block.indexOf('FROM "kitchenReturns" WHERE "dispatchId"=$1 AND "voidedAt" IS NULL');
        const reverseAt = block.indexOf("reverseDispatchStock(client, dispatch, req, 'void')");
        const financialAt = block.indexOf('voidDispatchExpenses(client, dispatch, req');
        const updateAt = block.indexOf("UPDATE dispatches SET status='voided'");
        const commitAt = block.indexOf("client.query('COMMIT')");
        expect(block).toContain("['approved', 'partially_received', 'received'].includes(dispatch.status)");
        expect(block).toContain('DISPATCH_NOT_VOIDABLE');
        expect(block).toContain('DISPATCH_ACTIVE_RETURN');
        expect(activeAt).toBeGreaterThan(-1);
        expect(activeAt).toBeLessThan(reverseAt);
        expect(reverseAt).toBeLessThan(financialAt);
        expect(financialAt).toBeLessThan(updateAt);
        expect(updateAt).toBeLessThan(commitAt);

        const reverse = between(DISPATCH_SOURCE, 'async function reverseDispatchStock', 'async function voidDispatchExpenses');
        expect(reverse).toContain("const includeReceipts = action === 'void'");
        expect(reverse).toContain("reference_type='dispatch_receipt'");
        expect(reverse).toContain("COALESCE(metadata->>'approval_revision','0') = $3::text");
        const expenses = between(DISPATCH_SOURCE, 'async function voidDispatchExpenses', "router.post('/dispatches/:id/cancel'");
        expect(expenses).toContain('FOR UPDATE');
        expect(expenses).toContain('UPDATE expenses SET amount=0');
        expect(expenses).not.toMatch(/DELETE FROM\s+(?:expenses|dispatches|inventory_ledger)/i);
    });

    test('الرقم تسلسلي لعدد مرات إعادة الفتح، وحركات العكس تقتصر على المراجعة الحالية', () => {
        const revision = between(DISPATCH_SOURCE, 'async function dispatchRevision', 'async function reverseDispatchStock');
        expect(revision).toContain("COUNT(*)::int AS revision");
        expect(revision).toContain("event_type='reopened'");
        const reverse = between(DISPATCH_SOURCE, 'async function reverseDispatchStock', 'async function voidDispatchExpenses');
        expect(reverse).toContain('dispatchRevision(client, dispatch.id)');
        expect(reverse).toContain('dispatch-${action}:${dispatch.id}:r${revision}');
        expect(reverse).toContain('approval_revision: revision');
    });
});

describe('idempotency الفعلي لمسارات الكتابة', () => {
    test('المفتاح إلزامي، والنجاح يعاد كما هو، وتغيير الجسم يرفض conflict', async () => {
        const missing = await runIdempotencyRequest('', { reason: 'x' }, jest.fn());
        expect(missing.res.error).toMatchObject({ statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });

        const key = `dispatch-lifecycle-${crypto.randomUUID()}`;
        const handler = jest.fn(async (req, res) => res.status(201).json({ dispatchId: 41, revision: 0 }));
        const first = await runIdempotencyRequest(key, { approvedItems: [{ qty: 2 }] }, handler);
        expect(first.res.body).toEqual({ dispatchId: 41, revision: 0 });
        expect(handler).toHaveBeenCalledTimes(1);

        const replay = await runIdempotencyRequest(key, { approvedItems: [{ qty: 2 }] }, handler);
        expect(replay.res.body).toEqual(first.res.body);
        expect(replay.res.headers['X-Idempotency-Replay']).toBe('true');
        expect(handler).toHaveBeenCalledTimes(1);

        const conflict = await runIdempotencyRequest(key, { approvedItems: [{ qty: 3 }] }, handler);
        expect(conflict.res.error).toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('حراس دورة العمل السلوكيون — الرفض قبل أي أثر', () => {
    test('منشئ الإذن لا يعتمد ولا يرفض ولا يستلم قراره، حتى مع هوية رقمية صحيحة', () => {
        const dispatch = { id: 41, status: 'approved', needsChefApproval: false, creatorUserId: 2, deptCode: 'kitchen' };
        const creator = { id: 2, role: 'warehouse', dept_code: 'kitchen' };
        expect(WAREHOUSE_SCOPE.canWarehouseApprove(dispatch, creator)).toEqual({ ok: false, code: 'DISPATCH_SELF_DECISION_FORBIDDEN' });
        expect(WAREHOUSE_SCOPE.canChefDecide(dispatch, creator)).toEqual({ ok: false, code: 'DISPATCH_SELF_DECISION_FORBIDDEN' });
        expect(WAREHOUSE_SCOPE.canReceiveDispatch(creator, dispatch)).toEqual({ ok: false, code: 'DISPATCH_SELF_DECISION_FORBIDDEN' });
        expect(WAREHOUSE_SCOPE.isDispatchCreator({ id: 2.5 }, { creatorUserId: 2.5 })).toBe(false);
        expect(WAREHOUSE_SCOPE.isDispatchCreator({ id: null }, { creatorUserId: null })).toBe(false);
    });

    test('إلغاء المعتمد يرفض قبل فحص المراجعة أو المخزون', async () => {
        const run = await invokeDispatch('cancel', {
            dispatch: { id: 41, status: 'approved', creatorUserId: 1, items: [] },
            body: { reason: 'محاولة إلغاء بعد الصرف' },
        });
        expect(run.res.statusCode).toBe(409);
        expect(run.res.body.error).toBe('DISPATCH_NOT_CANCELLABLE');
        expect(run.sql).toContain('ROLLBACK');
        expect(run.sql.some(sql => /UPDATE|INSERT/.test(sql))).toBe(false);
    });

    test('إعادة فتح إذن معتمد له receipt ledger ترفض قبل عكس المخزون أو القيود', async () => {
        const run = await invokeDispatch('reopen', {
            dispatch: { id: 41, status: 'approved', creatorUserId: 1, receivedItems: [], kitchenReceivedAt: null, items: [] },
            body: { reason: 'مراجعة' },
            onQuery(sql) {
                if (sql.includes("reference_type='dispatch_receipt'")) { return { rows: [{ id: 900 }] }; }
                return undefined;
            },
        });
        expect(run.res.statusCode).toBe(409);
        expect(run.res.body.error).toBe('DISPATCH_RECEIPT_ALREADY_RECORDED');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
        expect(run.postDispatchToLedger).not.toHaveBeenCalled();
        expect(run.sql.some(sql => /INSERT|UPDATE|SUM\(quantity_delta\)/.test(sql))).toBe(false);
    });

    test('إبطال إذن بمرتجع نشط يرفض قبل العكس والتصفير', async () => {
        const run = await invokeDispatch('void', {
            dispatch: { id: 41, status: 'received', creatorUserId: 1, items: [], approvedItems: [] },
            body: { reason: 'إبطال' },
            onQuery(sql) {
                if (sql.includes('FROM "kitchenReturns"')) { return { rows: [{ id: 77 }] }; }
                return undefined;
            },
        });
        expect(run.res.statusCode).toBe(409);
        expect(run.res.body.error).toBe('DISPATCH_ACTIVE_RETURN');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
        expect(run.sql.some(sql => /INSERT|UPDATE|SUM\(quantity_delta\)/.test(sql))).toBe(false);
    });

    test('الاعتماد الذاتي يرفض 403 قبل المراجعة والمخزون والمصروف والقيود', async () => {
        const run = await invokeDispatch('approve', {
            user: { id: 1, name: 'منشئ الإذن', username: 'creator', role: 'warehouse' },
            dispatch: { id: 41, status: 'pending', creatorUserId: 1, deptCode: 'kitchen', items: [{ itemName: 'Flour', qty: 5 }] },
            body: { approvedItems: [{ itemName: 'Flour', qty: 5 }] },
        });
        expect(run.res.statusCode).toBe(403);
        expect(run.res.body.error).toBe('DISPATCH_SELF_DECISION_FORBIDDEN');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
        expect(run.postDispatchToLedger).not.toHaveBeenCalled();
        expect(run.sql.some(sql => /COUNT\(\*\)|FROM inventory|INSERT INTO/.test(sql))).toBe(false);
    });

    test.each([
        ['الكمية العادية', false, { qty: 6 }],
        ['كراتين الوزن المتغير', true, { actualWeight: 8, packagingQty: 4 }],
    ])('سقف الطلب الأصلي: %s تمنع الاعتماد قبل أي خصم أو مصروف', async (_label, catchWeight, approval) => {
        const run = await invokeDispatch('approve', {
            dispatch: { id: 41, status: 'pending', creatorUserId: 1, deptCode: 'kitchen', items: [{ itemName: 'Flour', qty: 3 }] },
            body: { approvedItems: [{ itemName: 'Flour', ...approval }] },
            onQuery(sql) {
                if (sql.includes('COUNT(*)::int AS revision')) { return { rows: [{ revision: 0 }] }; }
                if (sql.includes('FROM inventory_locations')) { return { rows: [{ id: 10, code: 'MAIN-WAREHOUSE', name_ar: 'الرئيسي' }] }; }
                if (sql.includes('FROM inventory WHERE LOWER(name)')) {
                    return { rows: [{ id: 5, name: 'Flour', qty: 100, avgCost: 2, catch_weight_enabled: catchWeight }] };
                }
                return undefined;
            },
        });
        expect(run.res.statusCode).toBe(422);
        expect(run.res.body.error).toBe('APPROVAL_QTY_EXCEEDED');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
        expect(run.postDispatchToLedger).not.toHaveBeenCalled();
        expect(run.sql.some(sql => /INSERT INTO "inventoryTx"|INSERT INTO expenses/.test(sql))).toBe(false);
    });

    test('فشل قيد اليومية يعيد ROLLBACK بعد الدفتر والمصروف — لا COMMIT جزئي', async () => {
        const accountingPost = jest.fn(async () => { throw new Error('journal failed'); });
        const run = await invokeDispatch('approve', {
            dispatch: { id: 41, status: 'pending', creatorUserId: 1, deptCode: 'kitchen', date: '2026-11-24', items: [{ itemName: 'Flour', qty: 5 }] },
            body: { approvedItems: [{ itemName: 'Flour', qty: 5 }] },
            accountingPost,
            onQuery(sql) {
                if (sql.includes('COUNT(*)::int AS revision')) { return { rows: [{ revision: 2 }] }; }
                if (sql.includes('FROM inventory_locations')) { return { rows: [{ id: 10, code: 'MAIN-WAREHOUSE', name_ar: 'الرئيسي' }] }; }
                if (sql.includes('FROM inventory WHERE LOWER(name)')) { return { rows: [{ id: 5, name: 'Flour', qty: 100, avgCost: 2 }] }; }
                if (sql.includes('FROM inventory_location_balances')) { return { rows: [{ main_available: 100 }] }; }
                if (sql.includes('INSERT INTO "inventoryTx"')) { return { rows: [{ id: 'tx-1' }] }; }
                if (sql.includes('INSERT INTO expenses')) { return { rows: [{ id: 55, amount: 10 }] }; }
                if (sql.includes('SELECT qty FROM inventory')) { return { rows: [{ qty: 100 }] }; }
                if (sql.includes('UPDATE dispatches SET status=')) { return { rows: [{ id: 41, status: 'approved' }] }; }
                return undefined;
            },
        });
        expect(run.res.statusCode).toBe(500);
        expect(run.postInventoryLedgerEntry).toHaveBeenCalledTimes(1);
        expect(run.sql.some(sql => sql.includes('INSERT INTO expenses'))).toBe(true);
        expect(accountingPost).toHaveBeenCalledWith(41, expect.objectContaining({ totalValue: 10, revision: 2, db: run.client }));
        expect(run.sql).toContain('ROLLBACK');
        expect(run.sql).not.toContain('COMMIT');
        expect(run.postInventoryLedgerEntry).toHaveBeenCalledWith(run.client, expect.objectContaining({
            idempotencyKey: 'dispatch:41:approve:r2:5:10',
            metadata: expect.objectContaining({ approval_revision: 2 }),
        }));
    });

    test('الاستلام التراكمي فوق الكمية المعتمدة يرفض 422 قبل الدفتر', async () => {
        const run = await invokeDispatch('receive', {
            dispatch: {
                id: 41, status: 'partially_received', creatorUserId: 1, deptCode: 'kitchen', date: '2026-11-24',
                approvedItems: [{ itemName: 'Flour', itemId: 5, qty: 10, unit: 'kg', avgCost: 2 }],
                receivedItems: [{ itemName: 'Flour', receivedQty: 7 }],
            },
            body: { items: [{ itemName: 'Flour', receivedQty: 4 }] },
        });
        expect(run.res.statusCode).toBe(422);
        expect(run.res.body.error).toBe('INVALID_RECEIPT_QTY');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
        expect(run.sql.some(sql => sql.includes('INSERT INTO'))).toBe(false);
    });

    test('سقف التعبئة التراكمي مستقل عن الوزن ويمنع الاستلام قبل الدفتر', async () => {
        const run = await invokeDispatch('receive', {
            dispatch: {
                id: 41, status: 'partially_received', creatorUserId: 1, deptCode: 'kitchen', date: '2026-11-24',
                approvedItems: [{ itemName: 'Flour', itemId: 5, qty: 10, packagingQty: 3, unit: 'kg' }],
                receivedItems: [{ itemName: 'Flour', receivedQty: 2, receivedPackagingQty: 1 }],
            },
            body: { items: [{ itemName: 'Flour', receivedQty: 1, receivedPackagingQty: 3 }] },
        });
        expect(run.res.statusCode).toBe(422);
        expect(run.res.body.error).toBe('INVALID_RECEIPT_PACKAGING_QTY');
        expect(run.postInventoryLedgerEntry).not.toHaveBeenCalled();
    });

    test('الاستلام يكتب فرق النداء فقط ويخزن التراكمي؛ اكتمال الوزن وحده لا يكفي لإنهاء التعبئة', async () => {
        const approvedItems = [{ itemName: 'Flour', itemId: 5, qty: 10, packagingQty: 3, packagingUom: 'كرتون', unit: 'kg' }];
        const run = await invokeDispatch('receive', {
            dispatch: {
                id: 41, status: 'partially_received', creatorUserId: 1, deptCode: 'kitchen', date: '2026-11-24',
                approvedItems, receivedItems: [{ itemName: 'Flour', receivedQty: 7, receivedPackagingQty: 1 }],
            },
            body: { items: [{ itemName: 'Flour', receivedQty: 3, receivedPackagingQty: 1 }] },
            onQuery(sql, params = []) {
                if (sql.includes('COUNT(*)::int AS revision')) { return { rows: [{ revision: 0 }] }; }
                if (sql.includes('FROM inventory_locations')) { return { rows: [{ id: 20, code: 'KITCHEN-MAIN', name_ar: 'مخزن المطبخ' }] }; }
                if (sql.includes('FROM inventory WHERE id=')) { return { rows: [{ id: 5, name: 'Flour', unit: 'kg', avgCost: 2 }] }; }
                if (sql.includes('INSERT INTO "inventoryTx"')) { return { rows: [], rowCount: 1 }; }
                if (sql.includes('UPDATE dispatches SET status=')) {
                    return { rows: [{ id: 41, status: params[0], receivedItems: JSON.parse(params[1]) }] };
                }
                return undefined;
            },
        });
        expect(run.res.statusCode).toBe(200);
        expect(run.postInventoryLedgerEntry).toHaveBeenCalledTimes(1);
        expect(run.postInventoryLedgerEntry).toHaveBeenCalledWith(run.client, expect.objectContaining({
            quantityDelta: 3,
            catchWeightQty: 1,
            idempotencyKey: 'dispatch:41:receipt:r0:5:dispatch-guard-receive-41:in',
        }));
        expect(run.res.body.receivedItems[0]).toMatchObject({
            receivedQty: 10,
            receivedDeltaQty: 3,
            receivedPackagingQty: 2,
            receivedPackagingDeltaQty: 1,
        });
        expect(run.res.body.dispatch.status).toBe('partially_received');
        expect(run.postDispatchToLedger).not.toHaveBeenCalled();
        expect(run.sql.some(sql => sql.includes('INSERT INTO expenses'))).toBe(false);
        const receiptTx = run.client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO "inventoryTx"'));
        expect(receiptTx[1][3]).toBe(3);
    });
});

describe('تسوية الاستلام القديمة (ensureLegacyKitchenReceiptLedger) — مصدر تضخيم الأرصدة السابق محروس', () => {
    const BACKFILL = between(ROUTES, 'async function ensureLegacyKitchenReceiptLedger', 'router.use(async (req, res, next)');

    test('حارس التكرار: التسوية تتخطى أي إذن له استلام حي مسجل في الدفتر', () => {
        expect(BACKFILL).toContain("reference_type='dispatch_receipt'");
        expect(BACKFILL).toContain("COALESCE(metadata->>'legacy_backfill','false') <> 'true'");
        expect(BACKFILL).toContain('if (liveReceipt) {continue;}');
    });

    test('مفتاح idempotency لكل (إذن×صنف) — إعادة التشغيل لا تضاعف القيود', () => {
        expect(BACKFILL).toContain('idempotencyKey:`${base}:in`');
        expect(BACKFILL).toContain('dispatch:${dispatch.id}:legacy-receipt:${item.id}');
    });

    test('التسوية تعمل عند إقلاع الخادم (تحت المراقبة بلا إسقاط الإقلاع)', () => {
        expect(SERVER).toContain('ensureLegacyKitchenReceiptLedger().catch');
    });
});

describe('واجهة القسم: الرفض يظهر للموظف فورًا — لا فشل صامت', () => {
    test('submitDispatchRequest يمنع السطر الأكبر من المتاح قبل الإرسال', () => {
        const block = between(KITCHEN, 'async function submitDispatchRequest', "await persistCreate('dispatches'");
        expect(block).toContain('baseQty>max+1e-6');
        expect(block).toContain("لا يُقبل في طلب صرف");
        expect(block).toContain('الرصيد غير كافٍ من');
    });

    test('رفض الخادم (رصيد ناقص) يُعرض برسالة — بلا try/catch كان يمر صامتًا', () => {
        const block = between(KITCHEN, "await persistCreate('dispatches'", "toast(isDeptHead()?'تم إرسال طلب الصرف");
        // تطوّر الـ catch (2026-10-12): حارس التكرار يسبق الرسالة — النية كما هي:
        // رسالة الرفض تصل للموظف عبر toast وعادةً return، لا فشل صامت.
        expect(block).toContain('}catch(e){');
        expect(block).toContain("String(e.message||'')");
        expect(block).toContain('toast(m||');
        expect(block).toContain('return;');
    });
});

// ─── تعارض القرار يحمل الحقيقة (طلب المالك 2026-10-29) ──────────────────────
// الشكوى: «لما بعمل موافقة لإذن الصرف لازم أعمل تحديث للصفحة… ولما أدوس مرة
// تانية يقولي الطلب تم الموافقة عليه». قرارُ سبق حفظه ليس فشلًا يُترك للقارئ
// يتخبط فيه: كل حارس حالة يردّ 409 بالرمز وبالشارة الحالية نفسها، فتلتقطها
// الشاشة وتُرسم. أي حارس يُجرَّد من حِملته يعود المصاب.
describe('حراس الحالة في سلسلة الصرف: 409 يحمل الرمز والحالة الحالية', () => {
    test('كل رفض «الحالة لا تسمح» يوصل status وdispatchId في جسم الردّ', () => {
        const payload = /fail\(res, 409, [^;]*\{ status: dispatch\.status, dispatchId: dispatch\.id \}\)/g;
        const hits = ROUTES.match(payload);
        // ستة حراس: اعتماد المخازن، اعتماد الشيف، رفض الشيف، رفض المخازن،
        // واستلام (غير قابل للاستلام + استلام مسجَّل سلفًا)
        expect(hits).not.toBeNull();
        expect(hits).toHaveLength(6);
    });

    test('عقد الرمز بين الخادم والشاشة: كل رموز التعارض تُصدر فعلًا من المسارات', () => {
        // الشاشة تعرف هذه الرموز حرفيًا (DECIDED_CODES في v2/screens/dispatch.js)؛
        // لو اختفى رمز من الخادم فلا معنى لفرعه في الشاشة، ولو ظهر رمز تعارض جديد
        // بلا إضافة هنا تبقى الشاشة عمياء عنه.
        const DECIDED_CODES = ['DISPATCH_ALREADY_APPROVED', 'DISPATCH_ALREADY_RECEIVED', 'DISPATCH_REJECTED',
            'DISPATCH_INVALID_STATUS', 'DISPATCH_NOT_PENDING', 'CHEF_APPROVAL_NOT_REQUIRED',
            'CHEF_APPROVAL_REQUIRED', 'DISPATCH_NOT_RECEIVABLE', 'DISPATCH_RECEIPT_ALREADY_RECORDED'];
        const screen = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'screens', 'dispatch.js'), 'utf8');
        const setBlock = between(screen, 'const DECIDED_CODES = new Set([', ']);');
        for (const code of DECIDED_CODES) {
            expect([code, ROUTES.includes(code)]).toEqual([code, true]);
            expect(setBlock).toContain(`'${code}'`);
        }
    });

    test('رسائل التعارض تقول «لا حاجة لإعادة الضغط» — لا تصف حالة غامضة', () => {
        expect(ROUTES).toContain('فلا حاجة لإعادة الضغط');
        expect(ROUTES).toContain('القرار مسجَّل فعلًا');
        // الصيغة القديمة الغامضة التي قرأها المالك، لا تعود
        expect(ROUTES).not.toContain('لا يمكن اعتماد طلب خرج من حالة الانتظار');
    });
});
