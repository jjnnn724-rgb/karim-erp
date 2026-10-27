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

const ROUTES = warehouseSource();
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
const KITCHEN = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'kitchen.js'), 'utf8');

const between = (src, startMark, endMark) => {
    const s = src.indexOf(startMark);
    expect(s).toBeGreaterThan(-1);
    const e = src.indexOf(endMark, s + 1);
    expect(e).toBeGreaterThan(s);
    return src.slice(s, e);
};

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

    test('الاعتماد المخزني — فحص رصيد لكل صنف قبل الخصم + منع اعتماد مكرر/إذن مستلم', () => {
        const block = between(ROUTES, "router.post('/dispatches/:id/approve'", "router.post('/dispatches/:id/chef-approve'");
        expect(block).toContain('canWarehouseApprove(dispatch)');
        expect(block).toContain('DISPATCH_ALREADY_RECEIVED');
        expect(block).toContain('DISPATCH_ALREADY_APPROVED');
        expect(block).toContain('INSUFFICIENT_STOCK');
        expect(block).toContain('effectiveQty > totalAvailable');
    });

    test('تعديل الإذن — التعديل يمر بالبوابة نفسها (لا توسيع الكميات فوق الرصيد بعد القبول)', () => {
        const block = between(ROUTES, "router.put('/dispatches/:id/edit'", "router.post('/dispatches/:id/reject'");
        expect(block).toContain('dispatchStockGate');
        expect(block).toContain('INSUFFICIENT_STOCK');
    });

    test('الاستلام — لا استلام مزدوج ولا تجاوز للكمية المعتمدة', () => {
        const block = between(ROUTES, "router.post('/dispatches/:id/receive'", "router.post('/returns'");
        expect(block).toContain('DISPATCH_NOT_RECEIVABLE');
        expect(block).toContain('DISPATCH_RECEIPT_ALREADY_RECORDED');
        expect(block).toContain('receivedQty > n(allowed.qty)');
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
