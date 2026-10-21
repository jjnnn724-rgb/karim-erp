/**
 * v2-pos-buffet.test.js — عقد البوفيه وتذاكر المطبخ والإقفال اليومي في POS V2
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت هنا:
 *   • المستودعان يُحمَّلان في vm ببوابة apiFetch مزيفة — لا شبكة.
 *   • هوية قسم البوفيه: كود الخادم (erp_open_buffet / open_buffet) أو الاسم،
 *     وفئات البوفيه تُعرض كأصناف قابلة للبيع (الخادم يبيع «أفرادًا» لا أصنافًا).
 *   • كل باب كتابة يطابق مسار الخادم وفروض التحقق، والفشل لا يُرسل طلبًا.
 *   • تذاكر المطبخ صفحة HTML خام: fetch مصادَق داخل المستودع فقط، مع رفض
 *     المعرّف غير الصالح و401، وصفحة فارغة.
 *   • تصدير الفواتير: نطاق التاريخ والحالة والمعرّفات، ثم صفحة طباعة داخلية.
 *   • الشاشة: لا معالجات سطرية، بوابة isConnected، مؤقت حي يُوقَف عند destroy.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'pos-entry.js');
const POS_REPO = path.join(V2, 'data', 'pos-v2-repo.js');
const BUFFET_REPO = path.join(V2, 'data', 'pos-buffet-repo.js');
const POS_CSS = path.join(APP, 'css', 'v2', 'erp-pos-v2.css');
const V2_HTML = path.join(APP, 'v2.html');
const CASHIER_HTML = path.join(APP, 'cashier', 'index.html');
const CASHIER_MAIN = path.join(APP, 'cashier', 'main.js');

const read = (file) => fs.readFileSync(file, 'utf8');
const REV = (read(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadRepo(file, injections, collect) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, encodeURIComponent, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(`${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`, context, { filename: file });
    return context;
}

describe('مستودع البوفيه — الهوية والفئات', () => {
    const calls = [];
    const ctx = loadRepo(BUFFET_REPO, {
        apiFetch: async (url, opts) => {
            calls.push({ url, opts });
            return { tiers: [] };
        },
    }, ['BUFFET_ADMIN_ROLES', 'isBuffetDepartment', 'buffetTierProducts']);

    test('يُعرَف قسم البوفيه بالكود أو الاسم كما يفعل الخادم', () => {
        expect(ctx.isBuffetDepartment({ code: 'erp_open_buffet' })).toBe(true);
        expect(ctx.isBuffetDepartment({ dept_code: 'open_buffet' })).toBe(true);
        expect(ctx.isBuffetDepartment({ name_ar: 'البوفيه المفتوح' })).toBe(true);
        expect(ctx.isBuffetDepartment({ name_en: 'Open Buffet' })).toBe(true);
        expect(ctx.isBuffetDepartment({ code: 'restaurant', name_ar: 'المطبخ' })).toBe(false);
        expect(ctx.isBuffetDepartment(null)).toBe(false);
    });

    test('الفئات النشطة فقط تُعرض كأصناف بيع بأسعار وأفراد', () => {
        const products = ctx.buffetTierProducts([
            { id: 11, name_ar: 'كبير', price: '25', vat_rate: 15, tier: 'adult', is_core: true },
            { id: 12, name_ar: 'صغير', price: 12.5, tier: 'child' },
            { id: 13, name_ar: 'معطّلة', price: 5, is_active: false },
            { id: 0, name_ar: 'بلا معرّف', price: 1 },
            { id: 14, name_ar: '   ', price: 1 },
        ]);
        expect(products).toHaveLength(2);
        expect(products[0]).toMatchObject({
            id: 11, name_ar: 'كبير', price: 25, vat_rate: 15,
            unit: 'فرد', category: 'بوفيه', is_buffet: true, is_core: true, tier: 'adult',
        });
        expect(products[1]).toMatchObject({ id: 12, price: 12.5, is_core: false });
        expect(ctx.buffetTierProducts(null)).toEqual([]);
    });

    test('أدوار إدارة البوفيه مرآة الخادم', () => {
        expect(ctx.BUFFET_ADMIN_ROLES).toEqual(['admin', 'manager', 'accountant']);
    });
});

describe('مستودع البوفيه — الأبواب', () => {
    const makeCtx = (responder) => {
        const calls = [];
        const ctx = loadRepo(BUFFET_REPO, {
            apiFetch: async (url, opts) => {
                calls.push({ url, opts });
                return responder(url, opts);
            },
        }, [
            'fetchBuffetConfig', 'saveBuffetPrices', 'addBuffetTier', 'renameBuffetTier',
            'setBuffetTierActive', 'disableBuffetTier', 'fetchBuffetLive',
            'fetchBuffetInvoices', 'fetchBuffetReport',
        ]);
        return { ctx, calls };
    };

    test('القراءة من مسار الإعداد وتتحقق من شكل tiers', async () => {
        const { ctx, calls } = makeCtx(() => ({ tiers: [] }));
        await ctx.fetchBuffetConfig();
        expect(calls[0]).toEqual({ url: '/pos/buffet/config', opts: undefined });

        const bad = makeCtx(() => ({ tiers: null }));
        await expect(bad.ctx.fetchBuffetConfig()).rejects.toThrow('صيغة إعدادات البوفيه غير صالحة');
    });

    test('حفظ الأسعار PUT ويُرسل الأفراد؛ القيم غير الصالحة لا تُرسل', async () => {
        const { ctx, calls } = makeCtx(() => ({ tiers: [] }));
        await ctx.saveBuffetPrices({ adult: 30, custom_5: 10 });
        expect(calls[0].url).toBe('/pos/buffet/config/prices');
        expect(calls[0].opts.method).toBe('PUT');
        expect(JSON.parse(calls[0].opts.body)).toEqual({ prices: { adult: 30, custom_5: 10 } });

        await expect(ctx.saveBuffetPrices({})).rejects.toThrow('لا توجد أسعار لحفظها');
        await expect(ctx.saveBuffetPrices({ adult: -1 })).rejects.toThrow('يجب أن يكون رقمًا موجبًا');
        await expect(ctx.saveBuffetPrices(null)).rejects.toThrow('أسعار البوفيه غير صالحة');
        expect(calls).toHaveLength(1);
    });

    test('إضافة فئة تُرسل الاسم والسعر والضريبة بعد التحقق', async () => {
        const { ctx, calls } = makeCtx(() => ({ tiers: [] }));
        await ctx.addBuffetTier({ nameAr: '  عائلي  ', price: '40', vatRate: 15 });
        expect(calls[0].url).toBe('/pos/buffet/config/tiers');
        expect(calls[0].opts.method).toBe('POST');
        expect(JSON.parse(calls[0].opts.body)).toEqual({ name_ar: 'عائلي', price: 40, vat_rate: 15 });

        await expect(ctx.addBuffetTier({ nameAr: '', price: 1 })).rejects.toThrow('اسم الفئة مطلوب');
        await expect(ctx.addBuffetTier({ nameAr: 'فئة', price: -2 })).rejects.toThrow('السعر يجب');
        await expect(ctx.addBuffetTier({ nameAr: 'فئة', price: 1, vatRate: 101 })).rejects.toThrow('نسبة الضريبة');
        expect(calls).toHaveLength(1);
    });

    test('إعادة التسمية والتفعيل والتعطيل على معرّف صالح فقط', async () => {
        const { ctx, calls } = makeCtx(() => ({ tiers: [] }));
        await ctx.renameBuffetTier(7, 'اسم جديد');
        expect(calls[0].url).toBe('/pos/buffet/config/tiers/7');
        expect(JSON.parse(calls[0].opts.body)).toEqual({ name_ar: 'اسم جديد' });

        await ctx.setBuffetTierActive(7, true);
        expect(calls[1].opts.method).toBe('PUT');
        expect(JSON.parse(calls[1].opts.body)).toEqual({ is_active: true });

        await ctx.disableBuffetTier(7);
        expect(calls[2]).toEqual({ url: '/pos/buffet/config/tiers/7', opts: { method: 'DELETE' } });

        await expect(ctx.renameBuffetTier('x', 'اسم')).rejects.toThrow('معرّف فئة البوفيه غير صالح');
        await expect(ctx.setBuffetTierActive(0, false)).rejects.toThrow('معرّف فئة البوفيه غير صالح');
        expect(calls).toHaveLength(3);
    });

    test('العداد الحي يبني الاستعلام ويتحقق من daily', async () => {
        const { ctx, calls } = makeCtx(() => ({ daily: { covers_total: 1 } }));
        await ctx.fetchBuffetLive({ date: '2026-10-21', sessionId: 9 });
        expect(calls[0].url).toBe('/pos/buffet/live?date=2026-10-21&session_id=9');
        await expect(ctx.fetchBuffetLive({ date: '21/10/2026' })).rejects.toThrow('تاريخ البوفيه غير صالح');

        const bad = makeCtx(() => ({ daily: null }));
        await expect(bad.ctx.fetchBuffetLive({})).rejects.toThrow('صيغة العداد الحي');
    });

    test('الفواتير والتقرير يطابقان مسارات الخادم', async () => {
        const { ctx, calls } = makeCtx(() => ({ data: [], totals: {}, tiers: [] }));
        await ctx.fetchBuffetInvoices({ date: '2026-10-21', limit: 200 });
        expect(calls[0].url).toBe('/pos/buffet/invoices?date=2026-10-21&limit=200');
        await expect(ctx.fetchBuffetInvoices({ status: 'void' })).rejects.toThrow('حالة فاتورة البوفيه غير صالحة');
        await expect(ctx.fetchBuffetInvoices({ limit: 500 })).rejects.toThrow('حد فواتير البوفيه غير صالح');

        await ctx.fetchBuffetReport('2026-10-21');
        expect(calls[1].url).toBe('/pos/buffet/report?date=2026-10-21');
        await expect(ctx.fetchBuffetReport('2026-1-1')).rejects.toThrow('تاريخ تقرير البوفيه غير صالح');
    });
});

describe('مستودع POS — الجهاز وتذاكر المطبخ والتصدير', () => {
    const makeCtx = ({ text = '<html>kot</html>', ok = true, status = 200, errorMessage = null } = {}) => {
        const apiCalls = [];
        const fetchCalls = [];
        let badBody = false;
        const ctx = loadRepo(POS_REPO, {
            API_BASE: 'https://erp.test/api',
            navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' },
            window: { _jwt: 'jwt-1', _appKey: 'app-key-1' },
            fetch: async (url, opts) => {
                fetchCalls.push({ url, opts });
                return {
                    ok,
                    status,
                    text: async () => text,
                    json: async () => {
                        badBody = true;
                        if (!errorMessage) {throw new Error('non-JSON body');}
                        return { message: errorMessage };
                    },
                };
            },
            apiFetch: async (url, opts) => {
                apiCalls.push({ url, opts });
                return { data: [] };
            },
        }, ['posDeviceName', 'fetchPosKotPage', 'exportPosOrders', 'completePosSale']);
        return { ctx, apiCalls, fetchCalls, badBody: () => badBody };
    };

    test('اسم الجهاز يتبع النظام والقسم كما في الكاشير القديم', () => {
        const { ctx } = makeCtx();
        expect(ctx.posDeviceName(4)).toBe('POS (Android dept-4)');
        expect(ctx.posDeviceName('')).toBe('POS (Android)');
        expect(ctx.posDeviceName(-2)).toBe('POS (Android)');
    });

    test('صفحة تذاكر المطبخ fetch مصادَق داخل المستودع فقط', async () => {
        const { ctx, fetchCalls, apiCalls } = makeCtx();
        const html = await ctx.fetchPosKotPage('123e4567-e89b-12d3-a456-426614174000');
        expect(html).toBe('<html>kot</html>');
        expect(fetchCalls[0].url).toBe('https://erp.test/api/pos/kot/orders/123e4567-e89b-12d3-a456-426614174000/html');
        expect(fetchCalls[0].opts.headers).toEqual({ Authorization: 'Bearer jwt-1', 'x-api-key': 'app-key-1' });
        expect(apiCalls).toHaveLength(0);
        await expect(ctx.fetchPosKotPage('not-a-uuid')).rejects.toThrow('معرّف الفاتورة غير صالح');
        await expect(ctx.fetchPosKotPage('')).rejects.toThrow('معرّف الفاتورة غير صالح');
    });

    test('401 وفشل الخادم يُترجمان لرسالة مفهومة دون استدعاء json', async () => {
        const expired = makeCtx({ ok: false, status: 401 });
        await expect(expired.ctx.fetchPosKotPage('123e4567-e89b-12d3-a456-426614174000'))
            .rejects.toThrow('انتهت الجلسة');
        expect(expired.badBody()).toBe(false);

        const broken = makeCtx({ ok: false, status: 500 });
        await expect(broken.ctx.fetchPosKotPage('123e4567-e89b-12d3-a456-426614174000'))
            .rejects.toThrow('تعذّر تحميل تذاكر المطبخ (500)');
    });

    test('صفحة تذاكر فارغة تُرفض', async () => {
        const { ctx } = makeCtx({ text: '   ' });
        await expect(ctx.fetchPosKotPage('123e4567-e89b-12d3-a456-426614174000'))
            .rejects.toThrow('صفحة تذاكر المطبخ فارغة');
    });

    test('تصدير الفواتير يبني الاستعلام ويتحقق من نطاق التاريخ', async () => {
        const { ctx, apiCalls } = makeCtx();
        await ctx.exportPosOrders({ dateFrom: '2026-10-01', dateTo: '2026-10-21', status: 'issued', search: '  قهوة  ' });
        expect(apiCalls[0].url).toBe('/pos/orders/export?date_from=2026-10-01&date_to=2026-10-21&status=issued&search=%D9%82%D9%87%D9%88%D8%A9');
        await expect(ctx.exportPosOrders({ dateFrom: '2026-10-21', dateTo: '2026-10-01' }))
            .rejects.toThrow('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
        await expect(ctx.exportPosOrders({ status: 'void' })).rejects.toThrow('حالة الفاتورة غير صالحة');
        expect(apiCalls).toHaveLength(1);
    });

    test('completePosSale يحمل رأس الجهاز مع مفتاح التكرار والوردية', async () => {
        const { ctx, apiCalls } = makeCtx();
        await ctx.completePosSale({
            departmentId: 3,
            sessionId: 8,
            items: [{ product_id: 1, quantity: 1 }],
            payments: [{ method: 'cash', amount: 10 }],
            idempotencyKey: 'sale-key-1',
        });
        expect(apiCalls[0].url).toBe('/sales/complete');
        expect(apiCalls[0].opts.headers).toEqual({
            'x-device-name': 'POS (Android dept-3)',
            'Idempotency-Key': 'sale-key-1',
            'X-Shift-Session-Id': '8',
        });
    });
});

describe('شاشة POS — البوفيه والتذاكر والإقفال', () => {
    const screen = read(SCREEN);
    const styles = read(POS_CSS);

    test('تستورد أبواب البوفيه والإقفال والتذاكر من المستودعات', () => {
        expect(screen).toContain("from '../data/pos-buffet-repo.js?v=");
        expect(screen).toContain('BUFFET_ADMIN_ROLES');
        expect(screen).toContain("const DAY_CLOSE_ROLES = ['admin', 'manager'];");
        expect(screen).toContain('fetchPosKotPage');
        expect(screen).toContain('exportPosOrders');
        expect(screen).toContain('openInAppReport');
    });

    test('وضع البوفيه يبيع أفرادًا ويعرض العداد الحي كل دقيقة', () => {
        expect(screen).toContain('function buffetMode()');
        expect(screen).toContain('isBuffetDepartment(activeShift)');
        expect(screen).toContain('data-buffet-live');
        expect(screen).toContain('buffetPersonCard');
        expect(screen).toContain("' فرد'");
        expect(screen).toContain('}, 60000);');
        expect(screen).toContain('stopBuffetLiveTimer()');
        expect(screen).toContain('isBuffet ? \'بحث الفئات\'');
        expect(screen).not.toMatch(/data-buffet-live[^>]*onclick/);
    });

    test('أسعار البوفيه والتقرير لوحات إدارة بصلاحيات الخادم', () => {
        expect(screen).toContain('data-buffet-prices');
        expect(screen).toContain('data-buffet-report');
        expect(screen).toContain('canManageBuffet');
        expect(screen).toContain('data-buffet-save-prices');
        expect(screen).toContain('data-buffet-add-tier');
        expect(screen).toContain('data-buffet-tier-toggle');
        expect(screen).toContain('buffetPrintDocument');
        expect(screen).toContain('printBuffetReport');
        expect(styles).toContain('.erp-pos-v2-live');
        expect(styles).toContain('.erp-pos-v2-people');
        expect(styles).toContain('.erp-pos-v2-price-row');
    });

    test('تذاكر المطبخ تُفتح من الإيصال ومن السجل عبر مستودع POS', () => {
        expect(screen).toContain('data-pos-kot="${esc(receipt.order_id)}"');
        expect(screen).toContain('data-pos-kot="${esc(order.id)}"');
        expect(screen).toContain('async function openKotTickets(orderId, counter)');
        expect(screen).toContain('win.document.write(html)');
        expect(screen).not.toMatch(/fetch\s*\(/);
    });

    test('سجل الفواتير يُطبع من تصدير الخادم لا من صفوف الصفحة', () => {
        expect(screen).toContain('data-pos-history-print');
        expect(screen).toContain('async function printOrderHistory()');
        expect(screen).toContain('ordersPrintDocument(result)');
        expect(screen).toContain('exportPosOrders({');
    });

    test('الإقفال اليومي يرفض الورديات المفتوحة ويطلب تأكيدًا', () => {
        expect(screen).toContain('data-pos-day-close');
        expect(screen).toContain('async function runDayClose()');
        expect(screen).toContain('status.existing_z');
        expect(screen).toContain('(status.open || []).length');
        expect(screen).toContain('ctx.confirmFn || window.confirm');
        expect(screen).toContain('execDayClose(status.today)');
    });

    test('لا معالجات سطرية، والمؤقت والاتصال الحي يُنظَّفان عند destroy', () => {
        expect(screen).not.toMatch(/\son(click|change|input|submit)=/);
        expect(screen).toContain('destroy() {');
        expect(screen).toContain('stopBuffetLiveTimer();');
        expect(screen).toContain('catalogSocket');
    });

    test('نفس مراجعة العائلة في v2.html وتطبيق الكاشير المستقل', () => {
        expect(REV).toMatch(/^\d+\.\d+\.\d+$/);
        expect(read(V2_HTML)).toContain(`css/v2/erp-pos-v2.css?v=${REV}`);
        expect(read(CASHIER_HTML)).toContain(`css/v2/erp-pos-v2.css?v=${REV}`);
        expect(read(CASHIER_MAIN)).toContain(`pos-entry.js?v=${REV}`);
    });
});
