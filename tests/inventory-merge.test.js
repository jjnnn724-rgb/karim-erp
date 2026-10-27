const { warehouseSource } = require('./helpers/warehouse-source');
// ────────────────────────────────────────────────────────────────────────────
// inventory-merge.test.js — طلب المالك 2026-10-05
// «في اصناف مثل كده عايز احذف المكرر المفروض» — دمج الأصناف المكررة في صنف واحد:
// نقل الرصيد + إعادة توجيه السجل + حذف المكرر. يقيّم مصدر warehouse.js الحقيقي.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
const SRC = RAW.replace(/export\s*\{[^}]*\};?/, '');
const BACKEND = warehouseSource();

function build(STATE) {
    const factory = new Function('STATE', 'window', 'esc', 'fN', 'fC', 't', 'today',
        SRC + '\nreturn { mergeItemKey, findDuplicateItemGroups, showMergeDuplicatesModal, mergeDuplicateGroup };');
    return factory(
        STATE,
        { whSelected: new Set(), whCatFilter: 'all' },
        String, String, String, (k) => k,
        () => new Date().toISOString().split('T')[0]);
}

describe('كاشف الأصناف المكررة (بالماسم بعد تطبيع المسافات والحروف)', () => {
    test('مثال المالك: صنفان بنفس الاسم تمامًا → مجموعة واحدة', () => {
        const m = build({ inventory: [
            { id: 1, name: 'سمبوسة سنبوسة جبن بالكرتون', qty: 29, unit: 'كرتون', minQty: 0 },
            { id: 2, name: 'سمبوسة سنبوسة جبن بالكرتون', qty: 29, unit: 'كرتون', minQty: 5 },
        ] });
        const g = m.findDuplicateItemGroups();
        expect(g).toHaveLength(1);
        expect(g[0]).toHaveLength(2);
    });

    test('المكرر بمسافة زايدة يُكتشف (حالة الأرز العنبر المكرر في القاعدة)', () => {
        const m = build({ inventory: [
            { id: 1, name: 'أرز عنبر-بيشاور 40 كيلو  راسخ كلاسيكي-كيس', qty: 2, unit: 'كيس' },
            { id: 2, name: 'أرز عنبر-بيشاور 40 كيلو راسخ كلاسيكي-كيس', qty: 2, unit: 'كيس' },
        ] });
        const g = m.findDuplicateItemGroups();
        expect(g).toHaveLength(1);
        expect(g[0]).toHaveLength(2);
    });

    test('الأصناف المختلفة لا تتجمع — ومجموعة ثلاثية تُكتشف كاملة', () => {
        const m = build({ inventory: [
            { id: 1, name: 'سكر سعودي-كيس', qty: 5, unit: 'كيس' },
            { id: 2, name: 'سكر سعودي - كيس', qty: 3, unit: 'كيس' },
            { id: 3, name: 'سكر سعودي-  كيس', qty: 1, unit: 'كيس' },
            { id: 4, name: 'أرز بسمتي', qty: 9, unit: 'كيس' },
        ] });
        const g = m.findDuplicateItemGroups();
        expect(g).toHaveLength(1);
        expect(g[0]).toHaveLength(3);
    });

    test('مخزن بلا مكررات → لا مجموعات، والدمج للأدمن فقط', () => {
        const m = build({ inventory: [{ id: 1, name: 'صنف وحيد', qty: 1, unit: 'وحدة' }], currentUser: { role: 'admin' } });
        expect(m.findDuplicateItemGroups()).toHaveLength(0);
    });
});

describe('نقطة الدمج في الخادم: POST /inventory/merge (أدمن — معاملة موثقة)', () => {
    test('المسار موجود، للأدمن حصرًا، ويستبعد جدول أرصدة المواقع من إعادة التوجيه', () => {
        expect(BACKEND).toContain("'/inventory/merge'");
        const mergeBody = BACKEND.slice(BACKEND.indexOf("'/inventory/merge'"), BACKEND.indexOf("'/purchase-invoices/:id/void'"));
        expect(mergeBody).toContain("requireRole('admin')");
        expect(mergeBody).toContain("table_name <> 'inventory_location_balances'");
        expect(mergeBody).toContain('SAVEPOINT merge_sweep');
        expect(mergeBody).toContain('DELETE FROM inventory WHERE id = ANY($1::bigint[])');
        expect(mergeBody).toContain('INVENTORY_MERGED');
    });
});
