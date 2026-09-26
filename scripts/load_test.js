#!/usr/bin/env node
/**
 * load_test.js — Enterprise load & race-hardening proof (Task 24)
 * ────────────────────────────────────────────────────────────────────────────
 * Zero external deps — Node 24 native fetch + the project's pg driver.
 *
 * Phases:
 *   S  Setup        kitchen dept + 2 tracked products (BOM→inventory) + shift
 *   P1 Read storm   products/dashboard/health under concurrency → latency stats
 *   P2 Write storm  55 concurrent sales of 55 units → ZERO oversell, 5 more → 409
 *   P3 Idempotency  12 concurrent sales, SAME key → exactly 1 order
 *   P4 Race-approve 3 concurrent stocktake approvals → exactly 1 wins
 *   P5 Race-shift   3 concurrent shift closes → exactly 1 wins
 *   P6 Soak         40s mixed traffic → no 5xx, bounded memory
 *   P7 Limiters     auth storm (429+Retry-After) + general limiter + metrics RBAC
 *   C  Cleanup      full SQL cleanup + snapshot diff = ZERO residue
 *
 * Exit code 0 only if every check passes.
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const BASE = process.env.LT_BASE || 'https://localhost:5001';
const RUN = 'lt' + Date.now().toString(36);
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.LT_ADMIN_PASS || 'Admin#2026#Karim';
const CONC = parseInt(process.env.LT_CONC || '30', 10);

const db = new Pool({
    user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'karim_erp', password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432, max: 4,
});
const q = (text, params) => db.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];

// ─── Check registry ──────────────────────────────────────────────────────────
const results = [];
function check(phase, name, pass, detail = '') {
    results.push({ phase, name, pass, detail: String(detail).slice(0, 220) });
    console.log(`${pass ? '✅' : '❌'} [${phase}] ${name}${pass ? '' : ' — ' + String(detail).slice(0, 220)}`);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function api(method, path, token, body, headers = {}, timeoutMs = 180000) {
    const t0 = Date.now();
    try {
        const res = await fetch(BASE + path, {
            method,
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(ctx.appKey ? { 'x-api-key': ctx.appKey } : {}),
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
        let json = null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) { try { json = await res.json(); } catch (_) {} }
        return { status: res.status, json, headers: res.headers, ms: Date.now() - t0 };
    } catch (err) {
        return { status: 0, json: null, headers: new Headers(), ms: Date.now() - t0, error: err.message };
    }
}

// ─── Stats helper ─────────────────────────────────────────────────────────────
function stats(latencies) {
    const a = [...latencies].sort((x, y) => x - y);
    const pick = (p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
    return { n: a.length, p50: pick(50), p90: pick(90), p95: pick(95), p99: pick(99), max: a[a.length - 1], mean: Math.round(a.reduce((s, v) => s + v, 0) / a.length) };
}
async function storm(n, concurrency, fn) {
    const latencies = [], statuses = [];
    let cursor = 0;
    async function worker() {
        while (true) {
            const i = cursor++;
            if (i >= n) {return;}
            const r = await fn(i);
            latencies.push(r.ms); statuses.push(r.status);
        }
    }
    const t0 = Date.now();
    await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
    return { latencies, statuses, wallMs: Date.now() - t0, count: (s) => statuses.filter(x => x === s).length };
}

// ─── Context ──────────────────────────────────────────────────────────────────
const ctx = {
    token: null, appKey: null, deptId: null, locId: null, invA: null, invB: null,
    prodA: null, prodB: null, shift1: null, shift2: null,
    orderIds: [], auditId: null, auditNumber: null, tuUser: null, tuId: null,
    snapBefore: null, idemKeys: [], adminName: null, ltLocId: null, ltLocCode: null,
};

async function snapshotDB() {
    const counts = {};
    for (const t of ['pos_orders', 'pos_order_items', 'pos_shift_sessions', 'inventory_ledger',
        '"inventoryTx"', 'inventory_audits', 'inventory_audit_items', 'expenses', 'users',
        'pos_products', 'pos_pending_prints', 'pos_zatca_invoice_queue', 'inventory',
        'kitchen_policies', 'inventory_locations']) {
        counts[t.replace(/"/g, '')] = Number((await one(`SELECT COUNT(*)::int c FROM ${t}`)).c);
    }
    return counts;
}

// ═══════════════════════════════ SETUP ═══════════════════════════════════════
async function setup() {
    const health = await api('GET', '/api/health');
    check('S', 'الخادم حي قبل الفحص', health.status === 200, `HTTP ${health.status}`);

    const login = await api('POST', '/api/auth/login', null, { username: ADMIN_USER, password: ADMIN_PASS });
    ctx.token = login.json?.access_token || login.json?.token;
    ctx.appKey = login.json?.app_key || process.env.API_KEY || null;
    // اسم الموقّع يجب أن يطابق اسم الحساب (getSignature ترفض بدونه — 422)
    ctx.adminName = login.json?.user?.name || ADMIN_USER;
    check('S', 'دخول المدير', login.status === 200 && ctx.token, `HTTP ${login.status}`);
    if (!ctx.token) {throw new Error(`فشل دخول المدير: HTTP ${login.status}`);}

    const depts = await api('GET', '/api/pos/departments', ctx.token);
    const departmentRows = Array.isArray(depts.json) ? depts.json : (depts.json?.departments || depts.json?.rows || []);
    const kitchen = departmentRows.find(d => d.code === 'erp_kitchen') || departmentRows[0];
    if (!kitchen) {throw new Error(`لا يوجد قسم POS صالح: HTTP ${depts.status} ${JSON.stringify(depts.json).slice(0, 180)}`);}
    ctx.deptId = Number(kitchen.id);
    check('S', 'قسم الكاشير موجود', !!ctx.deptId, JSON.stringify(kitchen).slice(0, 80));

    // لقطة ما قبل الاختبار — قبل أي إدخال بيانات فحص (مطابقة التنظيف تُقاس عليها)
    ctx.snapBefore = await snapshotDB();

    const mainLoc = await one(`SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true`);
    ctx.mainLocId = Number(mainLoc.id);
    // ── Test-scoped posting location (P2/P4 need posting ≠ MAIN) ─────────
    // Production dept 10 has NO kitchen policy (posts to MAIN), which would
    // let P2 sales eat the MAIN stockpile P4 must audit. Install a strictly
    // temporary policy → dedicated LT location (zero production footprint),
    // fully reverted in cleanup. Refuse to run if a REAL (non-LT) policy
    // exists — never hijack live routing silently.
    ctx.ltLocCode = `LT-POSTING-${RUN}`;
    const existingPol = await one(
        `SELECT kp.department_id, kp.kitchen_location_id, l.code FROM kitchen_policies kp
          JOIN inventory_locations l ON l.id = kp.kitchen_location_id WHERE kp.department_id = $1`,
        [ctx.deptId]);
    if (existingPol && !(existingPol.code || '').startsWith('LT-POSTING-')) {
        throw new Error(`dept ${ctx.deptId} has a REAL kitchen policy (${existingPol.code}) — refusing to hijack production routing`);
    }
    if (existingPol) {
        await q(`DELETE FROM kitchen_policies WHERE department_id = $1`, [ctx.deptId]);
        await q(`DELETE FROM inventory_locations WHERE code = $1`, [existingPol.code]);
    }
    const ltLoc = await one(
        `INSERT INTO inventory_locations (code, name_ar, location_type, active, negative_stock_policy)
         VALUES ($1, $2, 'pos', true, 'deny') RETURNING id`,
        [ctx.ltLocCode, `موقع فحص الحمل ${RUN}`]);
    ctx.ltLocId = Number(ltLoc.id);
    await q(`INSERT INTO kitchen_policies (department_id, kitchen_location_id, operation_mode, allow_fallback)
             VALUES ($1, $2, 'strict', false)`, [ctx.deptId, ctx.ltLocId]);
    check('S', 'موقع ترحيل مؤقت للفحص مربوط بالسياسة', !!ctx.ltLocId, `lt=${ctx.ltLocCode} id=${ctx.ltLocId}`);
    // موقع الاستهلاك الحقيقي الذي يحسمه complete-sale نفسه:
    // COALESCE(kitchen_policies.kitchen_location_id, pd.location_id, MAIN)
    const postLoc = await one(`SELECT COALESCE(kp.kitchen_location_id, pd.location_id, main.id) loc
          FROM pos_departments pd
          LEFT JOIN inventory_locations main ON main.code = 'MAIN-WAREHOUSE'
          LEFT JOIN kitchen_policies kp ON kp.department_id = pd.id
         WHERE pd.id = $1`, [ctx.deptId]);
    ctx.locId = Number(postLoc?.loc || ctx.mainLocId);
    check('S', 'موقع الترحيل محدد', !!ctx.locId, `posting=${ctx.locId} main=${ctx.mainLocId}`);

    // مكونان تتبعان في المخزن + رصيدهما في موقع الترحيل
    ctx.invA = Number((await one(
        `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
         VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM inventory), $1,'فحص حمل','وحدة',55,2.5,0) RETURNING id`, [`مكون فحص حمل A ${RUN}`])).id);
    ctx.invB = Number((await one(
        `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
         VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM inventory), $1,'فحص حمل','وحدة',10,3.0,0) RETURNING id`, [`مكون فحص حمل B ${RUN}`])).id);
    for (const inv of [ctx.invA, ctx.invB]) {
        await q(`INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand) VALUES ($1,$2,$3) ON CONFLICT (inventory_id, location_id) DO UPDATE SET on_hand = EXCLUDED.on_hand`, [inv, ctx.locId, inv === ctx.invA ? 55 : 10]);
    }
    await q(`UPDATE inventory SET qty=55 WHERE id=$1`, [ctx.invA]);
    await q(`UPDATE inventory SET qty=10 WHERE id=$1`, [ctx.invB]);
    // رصيد المكون A في المخزن الرئيسي أيضًا — جلسة الجرد ستكون عليه صراحة
    await q(`INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand) VALUES ($1,$2,55) ON CONFLICT (inventory_id, location_id) DO UPDATE SET on_hand = 55`, [ctx.invA, ctx.mainLocId]);

    // منتجان مرتبطان بالمكونين (BOM) — البيع يستهلك من المخزن فعليًا
    const pA = await api('POST', '/api/pos/products', ctx.token, {
        name_ar: `وجبة فحص حمل A ${RUN}`, price: 10, vat_rate: 15, cost_price: 2.5,
        unit: 'وجبة', category: 'فحص', department_ids: [ctx.deptId],
    });
    ctx.prodA = Number(pA.json?.id);
    const pB = await api('POST', '/api/pos/products', ctx.token, {
        name_ar: `وجبة فحص حمل B ${RUN}`, price: 12, vat_rate: 15, cost_price: 3.0,
        unit: 'وجبة', category: 'فحص', department_ids: [ctx.deptId],
    });
    ctx.prodB = Number(pB.json?.id);
    check('S', 'منتجا الفحص أُنشئا', !!ctx.prodA && !!ctx.prodB, `A=${ctx.prodA} B=${ctx.prodB}`);
    await q(`INSERT INTO pos_product_ingredients (product_id, inventory_id, quantity_per_unit, unit) VALUES ($1,$2,1,'وحدة'),($3,$4,1,'وحدة')`,
        [ctx.prodA, ctx.invA, ctx.prodB, ctx.invB]);
    const bomCount = Number((await one(`SELECT COUNT(*)::int c FROM pos_product_ingredients WHERE product_id = ANY($1::bigint[])`, [[ctx.prodA, ctx.prodB].filter(Boolean)])).c);
    check('S', 'ربط BOM للمنتجين بالمكونين (الاستهلاك حقيقي من المخزن)', bomCount === 2, `bom=${bomCount}`);

    const shift = await api('POST', '/api/pos/shifts/open', ctx.token, { department_id: ctx.deptId, opening_balance: 0 });
    if (shift.status === 409) {
        const open = await one(`SELECT id FROM pos_shift_sessions WHERE cashier_id=1 AND status='open' ORDER BY id LIMIT 1`);
        if (open) {await api('POST', `/api/pos/shifts/${open.id}/close`, ctx.token, { actual_cash: 0, notes: `إغلاق عالق قبل فحص الحمل ${RUN}` });}
        const retry = await api('POST', '/api/pos/shifts/open', ctx.token, { department_id: ctx.deptId, opening_balance: 0 });
        ctx.shift1 = retry.json?.session_id;
    } else {ctx.shift1 = shift.json?.session_id;}
    check('S', 'وردية الفحص مفتوحة', !!ctx.shift1, `shift=${ctx.shift1}`);

    ctx.snapBefore = ctx.snapBefore || await snapshotDB();
}

// ═══════════════════════ P1 — READ STORM ═════════════════════════════════════
async function p1ReadStorm() {
    console.log('\n─── P1: عاصفة قراءة ───');
    const targets = [
        ['GET', `/api/pos/products?department_id=${ctx.deptId}`],
        ['GET', '/api/pos/dashboard'],
        ['GET', '/api/health'],
    ];
    for (const [method, path] of targets) {
        const r = await storm(240, CONC, () => api(method, path, path === '/api/health' ? null : ctx.token));
        const s = stats(r.latencies);
        const fiveXX = r.statuses.filter(x => x >= 500).length;
        check('P1', `${path} — 240 طلبًا @${CONC} متوازيًا: p95=${s.p95}ms p99=${s.p99}ms صفر 5xx`,
            fiveXX === 0 && s.p95 < 1500, `5xx=${fiveXX} p50=${s.p50} max=${s.max} wall=${r.wallMs}ms`);
    }
}

// ═══════════════════════ P2 — WRITE STORM (anti-oversell) ════════════════════
async function p2WriteStorm() {
    console.log('\n─── P2: عاصفة كتابة 55 بيعًا متزامنًا (منع البيع الزائد) ───');
    const SALE = () => ({
        department_id: ctx.deptId,
        items: [{ product_id: ctx.prodA, quantity: 1, unit_price: 10, discount: 0 }],
        payments: [{ method: 'cash', amount: 11.5 }],
        notes: `فحص حمل ${RUN}`,
    });
    const r = await storm(55, 55, async (i) => {
        const key = `${RUN}-s${i}`;
        ctx.idemKeys.push(key);
        return api('POST', '/api/sales/complete', ctx.token, SALE(),
            { 'Idempotency-Key': key, 'X-Shift-Session-Id': String(ctx.shift1) }, 300000);
    });
    const s = stats(r.latencies);
    const ok = r.count(201), conflict = r.count(409), fiveXX = r.statuses.filter(x => x >= 500).length;
    check('P2', `كل الـ 55 بيعًا نجحت (201) تحت تزامن كامل — p95=${s.p95}ms`, ok === 55 && fiveXX === 0,
        `ok=${ok} 409=${conflict} 5xx=${fiveXX} p50=${s.p50} max=${s.max} wall=${r.wallMs}ms statuses=${JSON.stringify(r.statuses.slice(0, 6))} body=${JSON.stringify((await api('POST', '/api/sales/complete', ctx.token, SALE(), { 'Idempotency-Key': `${RUN}-probe`, 'X-Shift-Session-Id': String(ctx.shift1) })).json).slice(0, 120)}`);
    ctx.idemKeys.push(`${RUN}-probe`);

    const orders = await q(`SELECT id FROM pos_orders WHERE notes = $1`, [`فحص حمل ${RUN}`]);
    ctx.orderIds = orders.rows.map(x => x.id);
    check('P2', '55 فاتورة في القاعدة (بلا فقد ولا تكرار)', ctx.orderIds.length === 55, `count=${ctx.orderIds.length}`);

    const ledgerCount = Number((await one(
        `SELECT COUNT(*)::int c FROM inventory_ledger WHERE reference_type='pos_order' AND reference_id = ANY($1::text[]) AND quantity_delta < 0`,
        [ctx.orderIds])).c);
    check('P2', '55 حركة صرف في دفتر المخزون (واحدة لكل بيع)', ledgerCount === 55, `ledger=${ledgerCount}`);

    const bal = await one(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2`, [ctx.invA, ctx.locId]);
    const invQty = await one(`SELECT qty FROM inventory WHERE id=$1`, [ctx.invA]);
    const balSum = await one(`SELECT COALESCE(SUM(on_hand),0) s FROM inventory_location_balances WHERE inventory_id=$1`, [ctx.invA]);
    check('P2', 'موقع الاستهلاك = 0 بالضبط، والإسقاط العالمي = مجموع المواقع (55 من الرئيسي)',
        Number(bal.on_hand) === 0 && Number(invQty.qty) === Number(balSum.s) && Number(balSum.s) === 55,
        `balance=${bal.on_hand} qty=${invQty.qty} sum=${balSum.s}`);

    // 5 محاولات إضافية → كلها 409 بلا أي استثناء 5xx
    const r2 = await storm(5, 5, async (i) => {
        const key = `${RUN}-over${i}`;
        ctx.idemKeys.push(key);
        return api('POST', '/api/sales/complete', ctx.token, SALE(),
            { 'Idempotency-Key': key, 'X-Shift-Session-Id': String(ctx.shift1) }, 300000);
    });
    check('P2', 'البيع بعد نفاد الرصيد مستحيل (5×409، صفر 5xx)',
        r2.count(409) === 5 && r2.statuses.every(x => x === 409), JSON.stringify(r2.statuses));
}

// ═══════════════════════ P3 — IDEMPOTENCY RACE ═══════════════════════════════
async function p3IdempotencyRace() {
    console.log('\n─── P3: سباق مفتاح الالتقاط (نفس المفتاح 12 مرة) ───');
    const key = `${RUN}-dup`;
    ctx.idemKeys.push(key);
    const body = {
        department_id: ctx.deptId,
        items: [{ product_id: ctx.prodB, quantity: 1, unit_price: 12, discount: 0 }],
        payments: [{ method: 'cash', amount: 13.8 }],
        notes: `فحص تكرار ${RUN}`,
    };
    const r = await storm(12, 12, () => api('POST', '/api/sales/complete', ctx.token, body,
        { 'Idempotency-Key': key, 'X-Shift-Session-Id': String(ctx.shift1) }, 300000));
    const created = r.count(201), replayed = r.statuses.filter((x, i) => x >= 200 && x < 300).length;
    const dupOrders = await q(`SELECT id FROM pos_orders WHERE notes = $1`, [`فحص تكرار ${RUN}`]);
    ctx.orderIds.push(...dupOrders.rows.map(x => x.id));
    const bal = await one(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2`, [ctx.invB, ctx.locId]);
    check('P3', 'فاتورة واحدة فقط رغم 12 طلبًا متزامنًا بنفس المفتاح', dupOrders.rows.length === 1,
        `orders=${dupOrders.rows.length} statuses=${JSON.stringify(r.statuses)}`);
    check('P3', 'الاستهلاك مرة واحدة (الرصيد 9 من 10)', bal && Number(bal.on_hand) === 9, `balance=${bal?.on_hand}`);
    const balBSum = await one(`SELECT COALESCE(SUM(on_hand),0) s FROM inventory_location_balances WHERE inventory_id=$1`, [ctx.invB]);
    check('P3', 'الإسقاط العالمي للمكون B مطابق لمجموع موارده (9)', Number(balBSum.s) === 9, `sum=${balBSum.s}`);
    const replayFlag = (r.statuses.filter(x => x >= 200 && x < 300).length) >= 1;
    check('P3', 'الطلبات المتطابقة أعيدت لها الاستجابة المخبأة (لا انفجار 5xx)',
        replayFlag && r.statuses.every(x => x >= 200 && x < 300), JSON.stringify(r.statuses));
}

// ═══════════════════════ P4 — STOCKTAKE APPROVE RACE ═════════════════════════
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
async function p4StocktakeRace() {
    console.log('\n─── P4: سباق اعتماد الجرد (3 اعتمادات متزامنة) ───');
    const prev = await api('GET', `/api/warehouse/inventory/locations/${ctx.mainLocId}/preview?mode=all`, ctx.token);
    check('P4', 'معاينة المخزن الرئيسي جاهزة للجرد', prev.status === 200, `HTTP ${prev.status} items=${prev.json?.items_count}`);

    // حرس صارم: جلسة الجرد لا تُنشأ إلا إذا كان مكون الفحص (بيانات الاختبار)
    // حاضرًا في لقطة المخزن — ممنوع منعًا باتًا لمس أصناف حقيقية في هذا الفحص.
    const invABalanceAtMain = await one(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2`, [ctx.invA, ctx.mainLocId]);
    if (!invABalanceAtMain || (prev.json?.items_count || 0) < 1) {
        check('P4', 'مكون الفحص في لقطة المخزن الرئيسي', false,
            `invA=${ctx.invA} mainBalance=${JSON.stringify(invABalanceAtMain)} items_count=${prev.json?.items_count}`);
        return;
    }
    check('P4', 'مكون الفحص في لقطة المخزن الرئيسي', true, `invA=${ctx.invA} items_count=${prev.json?.items_count}`);

    const aud = await api('POST', '/api/warehouse/inventory/audits', ctx.token, {
        locationId: ctx.mainLocId, countedAt: new Date().toISOString().slice(0, 10),
        periodType: 'custom', notes: `جرد فحص الحمل ${RUN}`,
    });
    ctx.auditId = aud.json?.audit?.id;
    ctx.auditNumber = aud.json?.audit?.audit_number || null;
    check('P4', 'جلسة جرد أُنشئت', aud.status === 201 && !!ctx.auditId, `HTTP ${aud.status} id=${ctx.auditId}`);

    const det = await api('GET', `/api/warehouse/inventory/audits/${ctx.auditId}`, ctx.token);
    const target = (det.json?.items || []).find(i => Number(i.item_id) === ctx.invA);
    if (!target) {
        // لا تُخاطر بأصناف حقيقية — ألغِ الجلسة فورًا
        await api('POST', `/api/warehouse/inventory/audits/${ctx.auditId}/cancel`, ctx.token, { notes: 'إلغاء — مكون الفحص غائب' });
        check('P4', 'هدف الجرد هو مكون الفحص تحديدًا', false, 'target missing — audit cancelled');
        return;
    }
    check('P4', 'هدف الجرد هو مكون الفحص تحديدًا', Number(target.item_id) === ctx.invA, `item=${target.item_id} invA=${ctx.invA}`);
    const sysQty = Number(target.system_qty);

    const cnt = await api('PUT', `/api/warehouse/inventory/audits/${ctx.auditId}/counts/${target.item_id}`,
        ctx.token, { countedQty: sysQty - 1, notes: 'عجز وحدة للفحص' });
    check('P4', 'تسجيل العدّ (فرق -1)', cnt.status === 200, `HTTP ${cnt.status}`);

    await api('POST', `/api/warehouse/inventory/audits/${ctx.auditId}/submit`, ctx.token, { signatureData: SIG, signerName: ctx.adminName });

    // الاعتماد ×3 متزامنة → واحد فقط يفوز
    const r = await storm(3, 3, () => api('POST', `/api/warehouse/inventory/audits/${ctx.auditId}/approve`,
        ctx.token, { signatureData: SIG, signerName: ctx.adminName }));
    const wins = r.statuses.filter(x => x === 200).length;
    const conflicts = r.statuses.filter(x => x === 409).length;
    check('P4', 'اعتماد واحد فقط نجح والبقية 409 (حرس FOR UPDATE)', wins === 1 && conflicts === 2,
        `statuses=${JSON.stringify(r.statuses)}`);

    const corr = Number((await one(
        `SELECT COUNT(*)::int c FROM inventory_ledger WHERE reference_type='inventory_audit' AND reference_id=$1`,
        [ctx.auditId])).c);
    check('P4', 'تصحيح واحد فقط في الدفتر (لا مضاعفة فرق)', corr === 1, `corrections=${corr}`);
}

// ═══════════════════════ P5 — SHIFT CLOSE RACE ═══════════════════════════════
async function p5ShiftRace() {
    console.log('\n─── P5: سباق إغلاق الوردية (3 إغلاقات متزامنة) ───');
    // أغلق وردية الفحص أولاً — الكاشير الواحد لا يفتح وردية ثانية والاولى مفتوحة
    const c1 = await api('POST', `/api/pos/shifts/${ctx.shift1}/close`, ctx.token, { actual_cash: 0, notes: `إغلاق قبل سباق ${RUN}` });
    check('P5', 'وردية الفحص أُغلقت قبل السباق', c1.status === 200, `HTTP ${c1.status}`);
    const open2 = await api('POST', '/api/pos/shifts/open', ctx.token, { department_id: ctx.deptId, opening_balance: 0 });
    ctx.shift2 = open2.json?.session_id;
    check('P5', 'وردية ثانية فُتحت للسباق', open2.status === 201 && !!ctx.shift2, `HTTP ${open2.status}`);

    const r = await storm(3, 3, () => api('POST', `/api/pos/shifts/${ctx.shift2}/close`, ctx.token,
        { actual_cash: 0, notes: `إغلاق سباق ${RUN}` }));
    const wins = r.statuses.filter(x => x === 200).length;
    const conflicts = r.statuses.filter(x => x === 409).length;
    check('P5', 'إغلاق واحد فقط نجح والبقية رفض نظيف', wins === 1 && conflicts === 2,
        `statuses=${JSON.stringify(r.statuses)}`);
    const row = await one(`SELECT status, closed_at FROM pos_shift_sessions WHERE id=$1`, [ctx.shift2]);
    check('P5', 'الوردية مغلقة بمغلق واحد', row?.status === 'closed' && !!row.closed_at, JSON.stringify(row));
}

// ═══════════════════════ P6 — SOAK ═══════════════════════════════════════════
async function p6Soak() {
    console.log('\n─── P6: نقع 40 ثانية بمعدل مختلط ───');
    const metBefore = await api('GET', '/api/metrics', ctx.token);
    check('P6', '/api/metrics يستجيب للمدير (لقطة كاملة)',
        metBefore.status === 200 && metBefore.json?.requests && metBefore.json?.memory && metBefore.json?.dbPool,
        `HTTP ${metBefore.status}`);
    const rssBefore = metBefore.json?.memory?.rssMB || 0;

    const paths = [
        ['GET', '/api/health', null],
        ['GET', `/api/pos/products?department_id=${ctx.deptId}`, ctx.token],
        ['GET', '/api/pos/dashboard', ctx.token],
    ];
    const deadline = Date.now() + 40_000;
    const latencies = [], statuses = [];
    async function looper() {
        let i = 0;
        while (Date.now() < deadline) {
            const [m, p, t] = paths[i++ % paths.length];
            const r = await api(m, p, t);
            latencies.push(r.ms); statuses.push(r.status);
        }
    }
    const t0 = Date.now();
    await Promise.all([looper(), looper(), looper()]);
    const wall = Date.now() - t0;
    const s = stats(latencies);
    const fiveXX = statuses.filter(x => x >= 500).length;
    const rps = (latencies.length / (wall / 1000)).toFixed(1);
    check('P6', `نقع ${latencies.length} طلبًا في ${Math.round(wall / 1000)}s (${rps} rps): صفر 5xx و p95=${s.p95}ms`,
        fiveXX === 0 && s.p95 < 2000, `5xx=${fiveXX} p99=${s.p99}`);

    const metAfter = await api('GET', '/api/metrics', ctx.token);
    const rssAfter = metAfter.json?.memory?.rssMB || 0;
    const totalReq = metAfter.json?.requests?.total || 0;
    // Delta-only: the counters are cumulative since boot and the box carries
    // background production traffic — only 5xx generated DURING the soak fail us.
    const fivexxBefore = metBefore.json?.requests?.server5xx || 0;
    const fivexxAfter = metAfter.json?.requests?.server5xx || 0;
    check('P6', `الذاكرة محدودة (RSS ${rssBefore}→${rssAfter}MB، فرق ≤ 180MB)`, rssAfter - rssBefore <= 180,
        `delta=${(rssAfter - rssBefore).toFixed(1)}MB`);
    check('P6', `عداد الطلبات في المراقبة يتقدم (${totalReq}) وتأخر حلقة الأحداث مقيس`,
        totalReq > 0 && !!metAfter.json?.eventLoopLagUs, `lag=${(JSON.stringify(metAfter.json?.eventLoopLagUs ?? 'N/A') || '""').slice(0, 80)}`);
    check('P6', 'صفر أخطاء 5xx في عدادات المراقبة', (fivexxAfter - fivexxBefore) === 0,
        `server5xx=${fivexxBefore}→${fivexxAfter}`);
}

// ═══════════════════════ P7 — RATE LIMITERS + RBAC ═══════════════════════════
async function p7Limiters() {
    console.log('\n─── P7: حروق المحددات وصلاحيات المراقبة ───');
    // مستخدم رمي للحدّ من الحرق على admin
    ctx.tuUser = `lt_${RUN}`;
    const hash = bcrypt.hashSync('LT#pass123', 8);
    const tu = await one(`INSERT INTO users (id, username, password, role, name, active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM users), $1,$2,'cashier','مستخدم فحص الحمل',true) RETURNING id`,
        [ctx.tuUser, hash]);
    ctx.tuId = Number(tu.id);

    // (أ) عاصفة دخول: 30 محاولة → ≤20 تنجح والبقية 429 مع Retry-After
    const first = await api('POST', '/api/auth/login', null, { username: ctx.tuUser, password: 'LT#pass123' });
    check('P7', 'المستخدم الرمي يدخل (توكن صالح)', first.status === 200 && !!first.json?.access_token, `HTTP ${first.status}`);
    // خذ التوكن قبل حرق عدّاد الدخول بعاصفة كلمات المرور الخاطئة
    const tuToken = first.json?.access_token;

    const r = await storm(30, 6, () => api('POST', '/api/auth/login', null, { username: ctx.tuUser, password: 'WRONG-pass' }));
    const tooMany = r.count(429);
    check('P7', 'عاصفة الدخول تُخنق (429 بعد العتبة)', tooMany >= 5, `429=${tooMany}/30 statuses=${JSON.stringify(r.statuses.slice(0, 8))}...`);
    const throttled = await api('POST', '/api/auth/login', null, { username: ctx.tuUser, password: 'WRONG-pass' });
    check('P7', '429 يحمل Retry-After ورؤوس الحد', throttled.status === 429 && !!throttled.headers.get('retry-after'),
        `retry-after=${throttled.headers.get('retry-after')}`);

    // (ب) المحدد العام: 130 طلب /api/state سريعة → 429 بعد ~100
    const r2 = await storm(130, 10, () => api('GET', '/api/state', tuToken));
    const gen429 = r2.count(429);
    check('P7', 'المحدد العام يخنق بعد الحد (429)', gen429 >= 1, `429=${gen429}/130 statuses=${JSON.stringify([...new Set(r2.statuses)])}`);

    // (ج) مراقبة الحمل: RBAC — بلا توكن 401، وكاشير 403، والمدير 200
    const noTok = await api('GET', '/api/metrics');
    const cashierView = await api('GET', '/api/metrics', tuToken);
    const adminView = await api('GET', '/api/metrics', ctx.token);
    check('P7', '/api/metrics محمية: 401 بلا توكن، 403 للكاشير، 200 للمدير',
        noTok.status === 401 && cashierView.status === 403 && adminView.status === 200,
        `no=${noTok.status} cashier=${cashierView.status} admin=${adminView.status}`);
}

async function main() {
    const t0 = Date.now();
    console.log(`\n████ فحص الحمل والسباق — Karim ERP @ ${BASE} — RUN=${RUN} ████\n`);
    const phases = [setup, p1ReadStorm, p2WriteStorm, p3IdempotencyRace, p4StocktakeRace, p5ShiftRace, p6Soak, p7Limiters];
    for (let index = 0; index < phases.length; index += 1) {
        const ph = phases[index];
        try { await ph(); } catch (err) {
            check(ph.name, 'المرحلة انهارت باستثناء', false, err.stack || err.message);
            if (index === 0) {
                console.error('SETUP_FAILED: إيقاف اختبار الضغط لأن بقية المراحل تعتمد على الإعداد الناجح.');
                break;
            }
        }
    }
    // ─── Cleanup دائمًا ───
    try { await cleanup(); } catch (err) { check('C', 'التنظيف نفسه رمى استثناء', false, err.message); }
    await report(t0);
}

async function cleanup() {
    console.log('\n─── C: تنظيف كامل ───');
    // إعادة جمع كل آثار المبيعات من القاعدة (يشمل الطلبات المتأخرة التي
    // اكتملت بعد انصراف مهلة العميل — يجب حذفها كاملة بلا بقايا)
    try {
        const orphanOrders = await q(
            `SELECT id FROM pos_orders WHERE notes LIKE $1 OR notes LIKE $2 OR notes LIKE $3`,
            [`%${RUN}%`, `فحص حمل ${RUN}%`, `فحص تكرار ${RUN}%`]);
        const known = new Set(ctx.orderIds);
        for (const r of orphanOrders.rows) {if (!known.has(r.id)) {ctx.orderIds.push(r.id);}}
    } catch (_) {}
    let steps = 0, failures = 0;
    const step = async (name, fn) => {
        steps++;
        try { await fn(); } catch (e) { failures++; console.log(`   ⚠️ تنظيف: ${name}: ${e.message}`); }
    };
    // إغلاق أي وردية مفتوحة من الفحص
    for (const sid of [ctx.shift1, ctx.shift2].filter(Boolean)) {
        await step(`close-${sid}`, async () => {
            const r = await api('POST', `/api/pos/shifts/${sid}/close`, ctx.token, { actual_cash: 0, notes: `إغلاق تنظيف ${RUN}` });
            if (r.status !== 200 && r.status !== 409) {throw new Error(`close HTTP ${r.status}`);}
        });
    }
    await step('ledger-sales', () => ctx.orderIds.length && q(`DELETE FROM inventory_ledger WHERE reference_type='pos_order' AND reference_id = ANY($1::text[])`, [ctx.orderIds]));
    await step('ledger-audit', () => ctx.auditId && q(`DELETE FROM inventory_ledger WHERE (reference_type='inventory_audit' AND reference_id=$1::text) OR idempotency_key = ANY($2::text[])`, [String(ctx.auditId), [`audit:${ctx.auditId}:item:${ctx.invA}`]]));
    await step('prints', () => ctx.orderIds.length && q(`DELETE FROM pos_pending_prints WHERE order_id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('zatca', () => ctx.orderIds.length && q(`DELETE FROM pos_zatca_invoice_queue WHERE order_id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('payments', () => ctx.orderIds.length && q(`DELETE FROM pos_invoice_payments WHERE order_id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('items', () => ctx.orderIds.length && q(`DELETE FROM pos_order_items WHERE order_id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('stock-moves', () => ctx.orderIds.length && q(`DELETE FROM pos_stock_movements WHERE order_id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('orders', () => ctx.orderIds.length && q(`DELETE FROM pos_orders WHERE id = ANY($1::uuid[])`, [ctx.orderIds]));
    await step('idem', () => ctx.idemKeys.length && q(`DELETE FROM pos_idempotency_keys WHERE key = ANY($1::text[])`, [ctx.idemKeys]));
    await step('tx-audit', () => ctx.auditNumber && q(`DELETE FROM "inventoryTx" WHERE notes LIKE $1`, [`%${ctx.auditNumber}%`]));
    await step('expenses-audit', () => ctx.auditNumber && q(`DELETE FROM expenses WHERE notes LIKE $1 OR "desc" LIKE $1`, [`%${ctx.auditNumber}%`]));
    await step('audit-events', () => ctx.auditId && q(`DELETE FROM inventory_audit_workflow_events WHERE audit_id=$1`, [ctx.auditId]));
    await step('audit-items', () => ctx.auditId && q(`DELETE FROM inventory_audit_items WHERE audit_id=$1`, [ctx.auditId]));
    await step('audit-row', () => ctx.auditId && q(`DELETE FROM inventory_audits WHERE id=$1`, [ctx.auditId]));
    await step('balances', () => q(`DELETE FROM inventory_location_balances WHERE inventory_id = ANY($1::bigint[])`, [[ctx.invA, ctx.invB].filter(Boolean)]));
    await step('bom', () => q(`DELETE FROM pos_product_ingredients WHERE product_id = ANY($1::bigint[])`, [[ctx.prodA, ctx.prodB].filter(Boolean)]));
    await step('products', () => q(`DELETE FROM pos_products WHERE id = ANY($1::bigint[])`, [[ctx.prodA, ctx.prodB].filter(Boolean)]));
    await step('inventory', () => q(`DELETE FROM inventory WHERE id = ANY($1::bigint[])`, [[ctx.invA, ctx.invB].filter(Boolean)]));
    await step('shifts', () => q(`DELETE FROM pos_shift_sessions WHERE id = ANY($1::bigint[])`, [[ctx.shift1, ctx.shift2].filter(Boolean)]));
    await step('user', () => ctx.tuId && q(`DELETE FROM users WHERE id=$1`, [ctx.tuId]));
    // Revert the temporary posting policy FIRST (it references the LT location),
    // then the LT location itself (balances/ledger rows already removed above —
    // FK RESTRICT would block otherwise). Verify both are really gone: a leaked
    // policy would silently reroute live kitchen sales after the test.
    await step('lt-policy', async () => {
        if (!ctx.ltLocId) {return;}
        await q(`DELETE FROM kitchen_policies WHERE department_id = $1 AND kitchen_location_id = $2`, [ctx.deptId, ctx.ltLocId]);
        const still = await one(`SELECT COUNT(*)::int c FROM kitchen_policies WHERE department_id = $1`, [ctx.deptId]);
        if (still.c !== 0) {throw new Error('LT policy leak — live routing still hijacked');}
    });
    await step('lt-location', async () => {
        if (!ctx.ltLocId) {return;}
        await q(`DELETE FROM inventory_locations WHERE id = $1`, [ctx.ltLocId]);
        const still = await one(`SELECT COUNT(*)::int c FROM inventory_locations WHERE id = $1`, [ctx.ltLocId]);
        if (still.c !== 0) {throw new Error('LT location leak');}
    });
    check('C', `خطوات التنظيف اكتملت (${steps - failures}/${steps} بلا خطأ)`, failures === 0, `failures=${failures}`);
}

async function report(t0) {
    const passed = results.filter(r => r.pass).length;
    const failed = results.length - passed;
    console.log(`\n${'═'.repeat(64)}`);
    console.log(`═══ نتيجة فحص الحمل: ${passed} ناجح / ${failed} فاشل — في ${Math.round((Date.now() - t0) / 1000)}s ═══`);
    console.log(`${'═'.repeat(64)}`);

    // مقارنة اللقطات (السماح فقط بسجل التدقيق الذي يبقى دليلًا)
    if (ctx.snapBefore) {
        const after = await snapshotDB();
        const allowed = new Set(['pos_audit_logs']);
        const drift = Object.keys(ctx.snapBefore)
            .filter(k => !allowed.has(k) && ctx.snapBefore[k] !== after[k])
            .map(k => `${k}: ${ctx.snapBefore[k]}→${after[k]}`);
        check('C', 'مطابقة اللقطة: صفر بقايا في كل الجداول الحساسة', drift.length === 0, drift.join(', '));
    }
    const fs = require('fs');
    const out = { run: RUN, base: BASE, startedAt: new Date(t0).toISOString(), durationSec: Math.round((Date.now() - t0) / 1000), passed, failed, results };
    fs.writeFileSync(require('path').join(__dirname, 'load_test_result.json'), JSON.stringify(out, null, 1));
    console.log(`📄 التفاصيل: scripts/load_test_result.json\n`);
    await db.end();
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
    console.error('FATAL:', err);
    try { await cleanup(); } catch (_) {}
    process.exit(2);
});
