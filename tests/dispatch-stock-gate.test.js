// ────────────────────────────────────────────────────────────────────────────
// dispatch-stock-gate.test.js — طلب المالك 2026-10-05
// «لا يقبل أي إذن صرف ليس له رصيد في المخزن نهائيًا»
// بوابة الرصيد dispatchStockGate تُفرض في كل نقاط قبول إذن الصرف:
// الإنشاء (POST /api/dispatches) + اعتماد الشيف + التعديل — والاعتماد المخزني كان مفحوصًا سلفًا.
// ────────────────────────────────────────────────────────────────────────────
const { dispatchStockGate } = require('../backend/warehouse-routes');
const fs = require('fs');
const path = require('path');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');

test('نقطة /main-availability موجودة — تغذي شاشة طلب الصرف برصيد المخزن الرئيسي', () => {
    expect(ROUTES).toContain("'/main-availability'");
    expect(ROUTES).toContain("WHERE l.code='MAIN-WAREHOUSE' AND l.active=true");
});

/**
 * قاعدة بيانات وهمية: صفوف inventory + صفوف أرصدة المواقع inventory_location_balances.
 * تطابق استعلامي البوابة: البحث بالاسم (غير حساس لحالة الحروف) ورصيد المخزن الرئيسي
 * (location_id=1) فقط — طلب المالك 2026-10-06: المتاح للصرف = الرئيسي، لا كل المواقع.
 */
function stubDb(inventoryRows, balanceRows = []) {
    return {
        async query(sql, params) {
            if (/FROM inventory WHERE/i.test(sql)) {
                const wanted = String(params[0] || '').toLowerCase();
                const row = inventoryRows.find((r) => String(r.name).toLowerCase() === wanted);
                return { rows: row ? [row] : [] };
            }
            if (/inventory_location_balances/i.test(sql)) {
                const total = balanceRows
                    .filter((b) => b.inventory_id === params[0] && (b.location_id === undefined || Number(b.location_id) === 1))
                    .reduce((sum, b) => sum + Math.max(0, (b.on_hand || 0) - (b.reserved || 0)), 0);
                return { rows: [{ main_available: total }] };
            }
            return { rows: [] };
        },
    };
}

describe('dispatchStockGate — لا يُقبل إذن صرف بلا رصيد كافٍ في المخزن', () => {
    const INV = [
        { id: 1, name: 'طماطم', catch_weight_enabled: null },
        { id: 2, name: 'لحم استيك', catch_weight_enabled: true },
        { id: 3, name: 'أرز', catch_weight_enabled: null },
    ];

    test('رصيد كافٍ → يُقبل', async () => {
        const db = stubDb(INV, [{ inventory_id: 1, on_hand: 10 }]);
        const gate = await dispatchStockGate(db, [{ itemName: 'طماطم', qty: 10 }]);
        expect(gate.ok).toBe(true);
        expect(gate.shortages).toEqual([]);
    });

    test('الكمية أكبر من الرصيد → رفض INSUFFICIENT_STOCK مع المتاح والمطلوب', async () => {
        const db = stubDb(INV, [{ inventory_id: 1, on_hand: 4 }]);
        const gate = await dispatchStockGate(db, [{ itemName: 'طماطم', qty: 5 }]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages).toHaveLength(1);
        expect(gate.shortages[0].code).toBe('INSUFFICIENT_STOCK');
        expect(gate.shortages[0].available).toBe(4);
        expect(gate.shortages[0].requested).toBe(5);
        expect(gate.shortages[0].message).toContain('طماطم');
    });

    test('صنف غير موجود في المخزن → رفض INVENTORY_ITEM_NOT_FOUND', async () => {
        const db = stubDb(INV, []);
        const gate = await dispatchStockGate(db, [{ itemName: 'صنف وهمي', qty: 1 }]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages[0].code).toBe('INVENTORY_ITEM_NOT_FOUND');
    });

    test('رصيد مخازن الأقسام لا يُحتسب — المتاح للصرف = المخزن الرئيسي فقط (طلب المالك 2026-10-06)', async () => {
        const db = stubDb(INV, [
            { inventory_id: 3, location_id: 2, on_hand: 2 },
            { inventory_id: 3, location_id: 1089, on_hand: 3 },
        ]);
        const gate = await dispatchStockGate(db, [{ itemName: 'أرز', qty: 1 }]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages[0].available).toBe(0);

        const withMain = stubDb(INV, [
            { inventory_id: 3, location_id: 1, on_hand: 5 },
            { inventory_id: 3, location_id: 2, on_hand: 9 },
        ]);
        const okGate = await dispatchStockGate(withMain, [{ itemName: 'أرز', qty: 5 }]);
        expect(okGate.ok).toBe(true);      // 5 بالرئيسي تكفي 5
        const shortGate = await dispatchStockGate(withMain, [{ itemName: 'أرز', qty: 6 }]);
        expect(shortGate.ok).toBe(false);  // مخزن القسم لا يعوّض الرئيسي
        expect(shortGate.shortages[0].available).toBe(5);
    });

    test('المحجوز (reserved) يُستبعد من المتاح', async () => {
        const db = stubDb(INV, [
            { inventory_id: 3, location_id: 1, on_hand: 10, reserved: 6 },
        ]);
        const gate = await dispatchStockGate(db, [{ itemName: 'أرز', qty: 5 }]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages[0].available).toBe(4);
    });

    test('رصيد سالب في الرئيسي يُحسب صفرًا، والموجب في نفس الموقع يُجمع معه', async () => {
        const db = stubDb(INV, [
            { inventory_id: 3, location_id: 1, on_hand: -2 },
            { inventory_id: 3, location_id: 1, on_hand: 7 },
        ]);
        const gate = await dispatchStockGate(db, [{ itemName: 'أرز', qty: 7 }]);
        expect(gate.ok).toBe(true);
    });

    test('أصناف الوزن المتغير: بلا رصيد → رفض، وبأي رصيد موجب → يُقبل (الوزن يُحدد على الميزان)', async () => {
        const emptyDb = stubDb(INV, [{ inventory_id: 2, on_hand: 0 }]);
        const blocked = await dispatchStockGate(emptyDb, [{ itemName: 'لحم استيك', qty: 3, packagingQty: 3 }]);
        expect(blocked.ok).toBe(false);
        expect(blocked.shortages[0].code).toBe('INSUFFICIENT_STOCK');

        const stockedDb = stubDb(INV, [{ inventory_id: 2, on_hand: 0.5 }]);
        const allowed = await dispatchStockGate(stockedDb, [{ itemName: 'لحم استيك', qty: 50, packagingQty: 50 }]);
        expect(allowed.ok).toBe(true);
    });

    test('تكرار نفس الصنف في أكثر من سطر يُجمع قبل المقارنة', async () => {
        const db = stubDb(INV, [{ inventory_id: 1, on_hand: 9 }]);
        const gate = await dispatchStockGate(db, [
            { itemName: 'طماطم', qty: 5 },
            { itemName: 'طماطم', qty: 5 },
        ]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages[0].requested).toBe(10);
    });

    test('عدة أصناف: الناقص وحده يظهر في المفاتٍ والسليم يمر', async () => {
        const db = stubDb(INV, [
            { inventory_id: 1, on_hand: 20 },
            { inventory_id: 3, on_hand: 1 },
        ]);
        const gate = await dispatchStockGate(db, [
            { itemName: 'طماطم', qty: 15 },
            { itemName: 'أرز', qty: 9 },
        ]);
        expect(gate.ok).toBe(false);
        expect(gate.shortages).toHaveLength(1);
        expect(gate.shortages[0].itemName).toBe('أرز');
    });

    test('مطابقة الاسم غير حساسة لحالة الحروف والمسافات', async () => {
        const db = stubDb(INV, [{ inventory_id: 1, on_hand: 3 }]);
        const gate = await dispatchStockGate(db, [{ itemName: '  طماطم ', qty: 3 }]);
        expect(gate.ok).toBe(true);
    });

    test('قائمة فارغة أو شكل نصي JSON — تُقبل الحالتان بلا أعطال', async () => {
        const db = stubDb(INV, []);
        expect((await dispatchStockGate(db, [])).ok).toBe(true);
        expect((await dispatchStockGate(db, null)).ok).toBe(true);
        const asJson = await dispatchStockGate(db, JSON.stringify([{ itemName: 'طماطم', qty: 1 }]));
        expect(asJson.ok).toBe(false); // بلا أرصدة → نقص
        expect(asJson.shortages[0].itemName).toBe('طماطم');
    });
});
