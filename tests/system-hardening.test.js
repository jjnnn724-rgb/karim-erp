// ────────────────────────────────────────────────────────────────────────────
// system-hardening.test.js — طلب المالك 2026-10-06 «سستم حديد»
// يقفل تحصينات المطابقة والتكرار: كل مسار إنشاء صنف يطابق بالمفتاح المطبع
// ولا يسمح بمكررات، والرصيد الافتتاحي للصنف الجديد يولد مقيدًا في الدفتر.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
const WAREHOUSE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');

describe('مطابقة أسماء الأصناف بالمفتاح المطبع (بلا تكرارات ولا فشل صامت)', () => {
    test('المُطبِّع الموحد normItemName موجود بقواعد المسافات والهمزات والتاء المربوطة', () => {
        expect(ROUTES).toContain('function normItemName(value)');
        expect(ROUTES).toContain("replace(/[أإآ]/g, 'ا')");
        expect(ROUTES).toContain(".replace(/ة/g, 'ه')");
        expect(ROUTES).toContain(".replace(/ى/g, 'ي')");
    });

    test('الاستيراد الدفعي bulk-receipt يطابق بالمفتاح المطبع لا بالاسم الحرفي', () => {
        expect(ROUTES).toContain("const matchKey = normItemName(item.name);");
        expect(ROUTES).toContain("existingByKey.set(matchKey, Number(inv.id))");
        expect(ROUTES).not.toContain("existingByName.get(item.name.toLowerCase())");
    });

    test('إنشاء فواتير الشراء يطابق بالمفتاح المطبع — فاتورة باسم متشابه تحدّث الموجود ولا تكرره', () => {
        expect(ROUTES).toContain("const matchKey = normItemName(item.itemName);");
        expect(ROUTES).not.toContain("existingByName.get(item.itemName.toLowerCase())");
    });

    test('الإنشاء العام POST /api/inventory يرفض الاسم المكرر شكلًا (409 DUPLICATE_ITEM_NAME)', () => {
        expect(SERVER).toContain('DUPLICATE_ITEM_NAME');
        expect(SERVER).toContain('regexp_replace(name,');
        expect(SERVER).toContain('موجود في المخزن بالفعل — لا يُنشأ مكرر');
    });
});

describe('الرصيد الافتتاحي للصنف الجديد يولد مقيدًا في الدفتر', () => {
    test('بذرة الرصيد عبر قيد opening_balance موثق — لا رصيد صامت بلا قيد', () => {
        expect(SERVER).toContain("transactionType: 'opening_balance'");
        expect(SERVER).toContain('inventory-create-opening');
        expect(SERVER).toContain("created_via: 'generic_crud'");
        // الرصيد يبدأ صفرًا ثم يقيد — لا إضافة مزدوجة
        expect(SERVER).toContain('VALUES ($1, $2, 0) ON CONFLICT (inventory_id, location_id) DO NOTHING');
    });

    test('قيد الافتتاحي من الأنواع المسموحة في كاتب الدفتر', () => {
        const ledger = fs.readFileSync(path.join(__dirname, '..', 'backend', 'inventory-ledger.js'), 'utf8');
        expect(ledger).toContain("'opening_balance'");
    });

    test('زر «فحص النظام»: تشخيص شامل للأدمن — أرصدة + دفاتر + إحصائيات', () => {
        expect(ROUTES).toContain("'/system-health'");
        const block = ROUTES.slice(ROUTES.indexOf("'/system-health'"));
        expect(block.slice(0, 300)).toContain("requireRole('admin')");
        expect(block).toContain('مجموع المخازن');
        expect(block).toContain('صافي الدفتر');
        expect(WAREHOUSE).toContain('showSystemHealth');
        expect(WAREHOUSE).toContain('فحص النظام');
        expect(WAREHOUSE).toContain('النظام سليم 100%');
        expect(WAREHOUSE).toContain('صفر الرصيد');
    });
});
