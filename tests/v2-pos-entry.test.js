/**
 * POS V2 contract: native checkout is enabled for authorized roles; the
 * standalone application remains the production fallback.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'pos-entry.js');
const REPO = path.join(V2, 'data', 'pos-v2-repo.js');
const SHIFT_ROUTES = path.join(__dirname, '..', 'backend', 'cashier-module', 'shift-routes.js');
const BARCODE = path.join(V2, 'data', 'pos-barcode.js');
const PRICING = path.join(V2, 'data', 'pos-pricing.js');
const HOST = path.join(V2, 'preview.js');
const LEGACY = path.join(APP, 'js', 'features', 'auth-navigation.js');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadRepo(apiFetch, collect, sourcePath = REPO) {
    const source = read(sourcePath)
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = { apiFetch, URLSearchParams, encodeURIComponent, Number, String, Array, Error };
    vm.createContext(context);
    vm.runInContext(`${source}\n;Object.assign(globalThis, {${collect.join(', ')}});`, context, { filename: sourcePath });
    return context;
}

describe('POS V2 — عقد الواجهة المدمجة', () => {
    test('يحافظ على تطبيق POS المستقل ويفعّل واجهة V2 المدمجة للبيع', () => {
        expect(read(LEGACY)).toContain('/app/pos.html');
        const screen = read(SCREEN);
        expect(screen).toContain('href="/app/pos.html"');
        expect(screen).toContain('target="_blank"');
        expect(screen).toContain('rel="noopener"');
        expect(screen).toContain("['admin', 'manager', 'accountant', 'cashier']");
        expect(read(HOST)).toContain('const V2_FEATURE_FLAGS = Object.freeze({ embeddedPos: true, salesEnabled: true });');
        expect(read(HOST)).toContain('featureFlags: V2_FEATURE_FLAGS');
    });

    test('البيع متاح للأدوار المخولة والقرار المالي النهائي للخادم', () => {
        const screen = read(SCREEN);
        expect(screen).toContain('const salesEnabled = ctx.featureFlags?.salesEnabled === true;');
        expect(screen).toContain("const POS_ROLES = ['admin', 'manager', 'accountant', 'cashier'];");
        expect(screen).toContain("data-pos-complete ${cart.length && t.valid ? '' : 'disabled'}");
    });

    test('المنتجات في V2 قابلة للتصفية بالفئة والبحث بالباركود أو الاسم', () => {
        const screen = read(SCREEN);
        expect(screen).toContain('data-pos-category');
        expect(screen).toContain('selectedCategory');
        expect(screen).toContain('p.barcode');
        expect(screen).toContain('aria-pressed=');
        expect(read(path.join(APP, 'css', 'v2', 'erp-pos-v2.css'))).toContain('.erp-pos-v2-categories');
    });

    test('شبكة أصناف POS مضغوطة ومحدّثة على شاشة V2 نفسها', () => {
        const styles = read(path.join(APP, 'css', 'v2', 'erp-pos-v2.css'));
        expect(styles).toContain('minmax(clamp(6.5rem, 7vw, 7.75rem), 1fr)');
        expect(styles).toContain('aspect-ratio: 1.6 / 1');
        expect(styles).toContain('min-height: 0');
        expect(read(path.join(APP, 'v2.html')))
            .toContain('css/v2/erp-pos-v2.css?v=4.9.183');
    });

    test('بطاقات الأصناف تعرض الصور وتتيح رفعها للإدارة مع استعادة الأزرار بعد المحاولة', () => {
        const screen = read(SCREEN);
        const styles = read(path.join(APP, 'css', 'v2', 'erp-pos-v2.css'));
        expect(screen).toContain("const CATALOG_IMAGE_ROLES = ['admin', 'manager'];");
        expect(screen).toContain("from '../data/recipes-edit-repo.js?v=");
        expect(screen).toContain('uploadProductImage(productId, file)');
        expect(screen).toContain('data-pos-image-input');
        expect(screen).toContain('accept="image/jpeg,image/png,image/webp"');
        expect(screen).toContain('file.size > 5 * 1024 * 1024');
        expect(screen).toContain('if (el.isConnected) {renderCashier();}');
        expect(screen).toContain('safeProductImageUrl(p.image_url)');
        expect(styles).toContain('.erp-pos-v2-product-image img');
        expect(styles).toContain('.erp-pos-v2-image-action');
    });

    test('الكاشير يزامن الوصفات مع أصناف POS ويحدّث الشاشة عند بث تغييرات الوصفات', () => {
        const screen = read(SCREEN);
        const routes = read(SHIFT_ROUTES);
        expect(routes).toContain('async function syncRecipeCatalog(req)');
        expect(routes).toContain("jsonb_build_object('legacy_recipe_id', r.id::text");
        expect(routes).toContain('await syncRecipeCatalog(req);');
        expect(routes).toContain("emitCatalogChanged(req, 'recipe-sync', counts);");
        expect(routes).toContain("AND COALESCE(p.metadata->>'managed_in', '') <> 'pos'");
        expect(screen).toContain("import { ensureRealtimeSocket } from '../realtime.js?v=");
        expect(screen).toContain("['posProducts', 'recipes'].includes(event.entity)");
        expect(screen).toContain('socket.on(\'entity_changed\', onCatalogChanged)');
        expect(screen).toContain('catalogSocket.off(\'entity_changed\', onCatalogChanged)');
    });

    test('واجهة الكاشير تربط الورديات والأصناف والدفع والإيصال', () => {
        const screen = read(SCREEN);
        expect(screen).toContain('fetchActivePosShift');
        expect(screen).toContain('fetchPosProducts');
        expect(screen).toContain('fetchPosHeldOrders');
        expect(screen).toContain('openPosShift');
        expect(screen).toContain('closePosShift');
        expect(screen).toContain('completePosSale');
        expect(screen).toContain('data-pos-hold');
        expect(screen).toContain('data-pos-recall');
        expect(screen).toContain('data-pos-held-delete');
        expect(screen).toContain('data-pos-payment');
        expect(screen).toContain('data-pos-reference');
        expect(read(REPO)).toContain('Idempotency-Key');
        expect(screen).toContain('ZATCA');
        expect(screen).toContain('ensureQrCode');
        expect(screen).toContain('data-pos-print');
    });

    test('المستودع يطابق أبواب POS المعتمدة ويمنع البيع دون مفتاح idempotency', () => {
        const repo = read(REPO);
        expect(repo).toContain("apiFetch('/pos/departments')");
        expect(repo).toContain("apiFetch('/pos/shifts/active')");
        expect(repo).toContain("apiFetch('/pos/shifts/open'");
        expect(repo).toContain("apiFetch(`/pos/held-orders?");
        expect(repo).toContain("apiFetch('/pos/held-orders',");
        expect(repo).toContain('recallPosHeldOrder');
        expect(repo).toContain("method: 'DELETE'");
        expect(repo).toContain("apiFetch('/sales/complete'");
        expect(repo).toContain("'Idempotency-Key': key");
        expect(repo).toContain("'X-Shift-Session-Id': String(shift)");
        expect(repo).toContain("if (!key) {throw new Error");
        expect(repo).toContain('items,');
        expect(repo).toContain('payments,');
    });

    test('سجل الفواتير يقرأ الصفحات والفلاتر من باب الخادم ويتحقق من المدخلات', async () => {
        const apiFetch = jest.fn(async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
        const ctx = loadRepo(apiFetch, ['fetchPosOrders']);
        await ctx.fetchPosOrders({
            page: 2, limit: 20, dateFrom: '2026-10-01', dateTo: '2026-10-18',
            status: 'issued', search: '  123 ',
        });
        expect(apiFetch).toHaveBeenCalledWith('/pos/orders?page=2&limit=20&sort=created_at&order=DESC&date_from=2026-10-01&date_to=2026-10-18&status=issued&search=123');
        await expect(ctx.fetchPosOrders({ dateFrom: '2026-10-19', dateTo: '2026-10-18' }))
            .rejects.toThrow('تاريخ البداية');
        await expect(ctx.fetchPosOrders({ status: 'all' })).rejects.toThrow('حالة الفاتورة');
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    test('تفاصيل الفاتورة تستخدم GET برقم مسار مُرمّز وتعرضها الشاشة قراءة فقط', async () => {
        const apiFetch = jest.fn(async () => ({ id: 7, items: [], payments: [] }));
        const ctx = loadRepo(apiFetch, ['fetchPosOrderDetails']);
        await ctx.fetchPosOrderDetails('123e4567-e89b-42d3-a456-426614174000');
        expect(apiFetch).toHaveBeenCalledWith('/pos/orders/123e4567-e89b-42d3-a456-426614174000');
        await expect(ctx.fetchPosOrderDetails('bad/id')).rejects.toThrow('معرّف الفاتورة');
        expect(apiFetch).toHaveBeenCalledTimes(1);
        const screen = read(SCREEN);
        expect(screen).toContain("const INVOICE_HISTORY_ROLES = ['admin', 'manager', 'accountant']");
        expect(screen).toContain('data-pos-history');
        expect(screen).toContain('data-pos-order-detail');
        expect(screen).toContain('fetchPosOrderDetails');
        expect(screen).toContain('data-pos-history-list');
    });

    test('المبالغ والتواريخ تعرضان من المصدر الحقيقي، مع حالات خطأ ظاهرة', () => {
        const screen = read(SCREEN);
        expect(screen).toContain('fetchCurrency');
        expect(screen).toContain('وحدة العملة غير متاحة');
        expect(screen).toContain('تعذّر تجهيز نقطة البيع');
        expect(screen).toContain('فشل إتمام البيع ولم تُفرّغ السلة');
        expect(screen).toContain('تم البيع بنجاح، لكن تعذّر تحديث قائمة الأصناف');
        expect(screen).toContain('data-pos-error');
    });

    test('قارئ الباركود يطابق الباركود الفريد ويحوّل الأرقام العربية والفارسية', () => {
        const ctx = loadRepo(jest.fn(), ['matchPosBarcode'], BARCODE);
        const products = [{ id: 7, barcode: '0123 ٤٥' }];
        expect(ctx.matchPosBarcode(products, '٠١٢٣ 45')).toEqual({ status: 'matched', product: products[0] });
        expect(ctx.matchPosBarcode(products, '999')).toEqual({ status: 'not-found', product: null });
        expect(ctx.matchPosBarcode([], '   ')).toEqual({ status: 'empty', product: null });
        expect(ctx.matchPosBarcode([...products, { id: 8, barcode: '012345' }], '012345'))
            .toEqual({ status: 'ambiguous', product: null });
    });

    test('يوزع الخصم على البنود ويحسب VAT على الصافي مع رفض النسبة غير الصالحة', () => {
        const ctx = loadRepo(jest.fn(), ['calculatePosTotals', 'buildPosSaleItems'], PRICING);
        const cart = [
            { id: 1, quantity: 2, price: 10, vatRate: 15 },
            { id: 2, quantity: 1, price: 5, vatRate: 0 },
        ];
        const totals = ctx.calculatePosTotals(cart, { type: 'percent', value: '١٠' });
        expect(totals.valid).toBe(true);
        expect(totals.subtotalBeforeDiscount).toBe(25);
        expect(totals.discount).toBe(2.5);
        expect(totals.subtotal).toBe(22.5);
        expect(totals.tax).toBe(2.7);
        expect(totals.total).toBe(25.2);
        expect(ctx.buildPosSaleItems(cart, { type: 'fixed', value: '4' }).map((item) => item.discount))
            .toEqual([3.2, 0.8]);
        expect(ctx.calculatePosTotals(cart, { type: 'percent', value: '101' }).valid).toBe(false);
    });

    test('إعادة الطباعة والإلغاء تستخدمان مسارات الخادم وتتحققان من السبب والمعرّف', async () => {
        const apiFetch = jest.fn(async () => ({ message: 'queued' }));
        const ctx = loadRepo(apiFetch, ['reprintPosOrder', 'voidPosOrder']);
        const id = '123e4567-e89b-42d3-a456-426614174000';
        await ctx.reprintPosOrder(id);
        expect(apiFetch).toHaveBeenCalledWith(`/pos/orders/${id}/reprint`, { method: 'POST' });
        await ctx.voidPosOrder(id, 'خطأ في الطلب');
        expect(apiFetch).toHaveBeenLastCalledWith(`/pos/orders/${id}/void`, {
            method: 'POST', body: JSON.stringify({ reason: 'خطأ في الطلب' }),
        });
        await expect(ctx.voidPosOrder(id, '  ')).rejects.toThrow('سبب الإلغاء');
        await expect(ctx.reprintPosOrder('bad/id')).rejects.toThrow('معرّف الفاتورة');
        expect(apiFetch).toHaveBeenCalledTimes(2);
    });

    test('الطلب المعلق يحفظ الخصم في الخادم ويرفض قيم الخصم غير الصحيحة', async () => {
        const apiFetch = jest.fn(async () => ({ id: 'held-1' }));
        const ctx = loadRepo(apiFetch, ['holdPosOrder']);
        await ctx.holdPosOrder({
            sessionId: 3, departmentId: 2, items: [{ product_id: 7, quantity: 1, unit_price: 10, discount: 0 }],
            cartDiscount: { type: 'percent', value: 15 },
        });
        expect(JSON.parse(apiFetch.mock.calls[0][1].body).cart_discount).toEqual({ type: 'percent', value: 15 });
        await expect(ctx.holdPosOrder({
            sessionId: 3, departmentId: 2, items: [{ product_id: 7 }], cartDiscount: { type: 'percent', value: 120 },
        })).rejects.toThrow('قيمة خصم الطلب');
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    test('إدخال قارئ الباركود بـ Enter يضيف الصنف الفريد ويعيد التركيز للمسح التالي', () => {
        const screen = read(SCREEN);
        expect(screen).toContain("event.key !== 'Enter'");
        expect(screen).toContain("matchPosBarcode(products, event.target.value)");
        expect(screen).toMatch(/search = '';\s+addProduct\(match\.product\);\s+q\('\[data-pos-search\]'\)\?\.focus\(\);/);
    });

    test('لا شبكة مباشرة ولا معالجات HTML سطرية', () => {
        const screen = read(SCREEN).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(screen).not.toMatch(/\bapiFetch\b/);
        expect(screen).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(screen).toMatch(/from '\.\.\/data\/pos-v2-repo\.js\?v=/);
        expect(screen.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('المضيف يربط المفتاح مع التفكيك ويمرر العلم للواجهة', () => {
        const host = read(HOST);
        expect(host).toMatch(/import \{ mountPosEntryScreen \} from '\.\/screens\/pos-entry\.js\?v=/);
        expect(host).toMatch(/key: 'pos', title: 'الكاشير', mount: mountPosEntryScreen/);
        expect(host).toMatch(/if \(key === 'pos'\)/);
        expect(host).toMatch(/function teardownPosEntryScreen\(\)/);
        expect(host).toContain('featureFlags: V2_FEATURE_FLAGS');
    });
});
