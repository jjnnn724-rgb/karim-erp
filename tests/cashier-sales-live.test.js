/**
 * cashier-sales-live.test.js — عقد «الفاتورة تظهر لحظيًا» في مبيعات الكاشير
 * ═════════════════════════════════════════════════════════════════════════
 * الشكوى: فاتورةٌ كُتبت للتوّ لا تظهر في ‎#/cashier-sales‎. القياس أظهر أن
 * المرآة مكتملة (تطابقٌ تام مع CC_BILLS3 يومًا بيوم) وأن التأخير كله في
 * المسار: السحب على دورة المؤقّت (دقيقة)، والعامل المولود لا مقابس له فلا
 * بثّ، والقراءة تُخدَم من كاشٍ عمره 30 ثانية، والشاشة لا تسمع شيئًا ولا
 * تسأل إلا حين يريفّشها الإنسان. العقود هنا قراءةُ مصدرٍ خالصة عدا عقد
 * الكاش السلوكي (api-cache لا قاعدة له):
 *   • الطلب الصريح بلايف يسحب المرآة ويُمرّر مقبسَ الطلب للبثّ.
 *   • الحارس يمنع accumulation: سحبٌ واحد كل 15 ثانية كحدٍّ أدنى.
 *   • السند غير الموجود ينتظر سحبًا واحدًا ثم يُعاد البحث — قبل 404.
 *   • ?live=1 لا يُخدَم من الكاش ولا يُخزَّن فيه (سلوكًا، لا نصًّا).
 *   • server.js يحقن req.io للمسار، والشاشة تسمع وتُنْبِض وتُنظّف.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'backend', 'cashier-sales-routes.js');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const MIRROR = path.join(ROOT, 'backend', 'yarasoft', 'mirror.js');
const SCREEN = path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'cashier-sales.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('الزناد اللايف — backend/cashier-sales-routes.js', () => {
    const src = read(ROUTES);

    test('؟live=1 يسحب المرآة بيومٍ واحد وبمقبس الطلب (لا io:null)', () => {
        expect(src).toMatch(/function maybeLiveRefresh\(req\)/);
        expect(src).toMatch(/String\(req\.query\.live \|\| ''\) !== '1'/);
        expect(src).toMatch(/refreshMirrorOrders\(\{ days: 1, io: io \|\| null \}\)/);
    });

    test('القراءتان اللتان تُفتح بهما الشاشة تُزندان', () => {
        for (const route of ['/summary', '/orders']) {
            const at = src.indexOf(`router.get('${route}'`);
            expect(at).toBeGreaterThan(-1);
            const head = src.slice(at, at + 400);
            expect(head).toContain('maybeLiveRefresh(req)');
        }
    });

    test('الحارس: لا أكثر من سحبٍ واحد في المرة ولا أقرب من 15 ثانية', () => {
        expect(src).toMatch(/const LIVE_MIN_GAP_MS = 15_000;/);
        const start = src.slice(src.indexOf('function startLiveRefresh'), src.indexOf('function maybeLiveRefresh'));
        expect(start).toMatch(/if \(_liveBusy \|\| Date\.now\(\) - _liveLast < LIVE_MIN_GAP_MS\) \{return null;\}/);
        // liberation على كل مخرج: نجاحٍ وإباءٍ وخطأ — وإلا بقي القفل إلى الأبد
        expect((start.match(/_liveBusy = false;/g) || []).length).toBe(2);
    });

    test('العُزلة: جلسة أوراكل تُغلق بعد كل دفعة لافيّة — لا خيوط في السيرفر', () => {
        const start = src.slice(src.indexOf('function startLiveRefresh'), src.indexOf('function maybeLiveRefresh'));
        expect(start).toMatch(/require\('\.\/yarasoft\/oracle-link'\)/);
        expect(start).toMatch(/const release = async \(\) => \{ try \{await closeKeptConn\(\);\}/);
        // على المخرجين: لا مسارٍ يترك الجلسة معلّقة في عملية السيرفر
        expect((start.match(/await release\(\);/g) || []).length).toBe(2);
    });

    test('السند الغائب يُعطى فرصة سحبٍ واحدة قبل 404 — شاشةً وورقةً', () => {
        expect(src).toMatch(/async function findAfterLive\(req, find, docNo\)/);
        expect((src.match(/await findAfterLive\(req, loadSlip, docNo\)/g) || []).length).toBe(2);
        expect(src).not.toMatch(/const slip = await loadSlip\(docNo\);/);
    });

    test('المدى الذي لا يشمل اليوم لا يستدعي سحبًا من يارسوفت', () => {
        const fn = src.slice(src.indexOf('function maybeLiveRefresh'), src.indexOf('async function findAfterLive'));
        expect(fn).toMatch(/if \(!\(from <= localDay\(\) && localDay\(\) <= to\)\) \{return;\}/);
    });
});

describe('المقبس والبثّ — التوصيل الخارجي', () => {
    test('server.js يحقن req.io لمسار مبيعات الكاشير', () => {
        const src = read(SERVER);
        expect(src).toMatch(/app\.use\('\/api\/cashier-sales', \(req, res, next\) => \{ req\.io = io; next\(\); \}, cashierSalesRouter\)/);
    });

    test('المرآة تُصدَّر مرةً واحدة (سطر تكرارٍ كان يمحو نفسه)', () => {
        const src = read(MIRROR);
        expect((src.match(/^module\.exports = /gm) || []).length).toBe(1);
        expect(src).toMatch(/io\.emit\('yarasoft:new-orders'/);
        expect(src).toMatch(/io\.emit\('yarasoft:mirror'/);
    });
});

describe('الشاشة V2 — تسمع وتنْبض وتنظّف', () => {
    const src = read(SCREEN);

    test('تطلب live في القراءتين حين يشمل المدى اليوم والتبويب مرئيّ', () => {
        expect(src).toMatch(/function liveWanted\(\)/);
        expect(src).toMatch(/if \(document\.hidden\) \{return false;\}/);
        expect(src).toMatch(/live: liveWanted\(\) \? '1' : ''/);
        expect((src.match(/live: liveWanted\(\) \? '1' : ''/g) || []).length).toBe(2);
    });

    test('تشترك في بثّ المرآة والأوردر الجديد وبيعِ الكاشير', () => {
        expect(src).toMatch(/import \{ ensureRealtimeSocket \} from '\.\.\/realtime\.js\?v=\d+\.\d+\.\d+'/);
        for (const ev of ['yarasoft:mirror', 'yarasoft:new-orders', 'sale:completed']) {
            expect(src).toMatch(new RegExp(`socket\\.on\\('${ev}', onLivePush\\)`));
            expect(src).toMatch(new RegExp(`liveSocket\\.off\\('${ev}', onLivePush\\)`));
        }
    });

    test('نبضةٌ دورية للتبويب المرئي — حبل نجاةٍ حين تسقط المقابس', () => {
        expect(src).toMatch(/const LIVE_TICK_MS = 20_000;/);
        expect(src).toMatch(/liveTimer = setInterval\(\(\) => \{ if \(liveWanted\(\)\) \{loadAll\(\);\} \}, LIVE_TICK_MS\)/);
        expect(src).toMatch(/document\.addEventListener\('visibilitychange', onVisibility\)/);
    });

    test('التفكيك يُبطل المؤقّتات والمستمعين — لا تسريب عند مغادرة الشاشة', () => {
        const destroy = src.slice(src.indexOf('destroy() {'), src.indexOf('refresh: () =>'));
        expect(destroy).toMatch(/clearInterval\(liveTimer\)/);
        expect(destroy).toMatch(/clearTimeout\(livePush\)/);
        expect(destroy).toMatch(/document\.removeEventListener\('visibilitychange', onVisibility\)/);
        expect(destroy).toMatch(/liveSocket = null;/);
    });
});

describe('كاش GET — الطلب الصريح بلايف لا يُخدَع بالتقادم', () => {
    /* سلوكيٌّ لا نصّي: api-cache.js بلا اتصالٍ قاعدة، فيُقاس الوسيط نفسه. */
    const { apiCacheMiddleware, invalidateAll } = require(path.join(ROOT, 'backend', 'api-cache'));

    const mkRes = () => {
        const res = {
            statusCode: 200,
            headers: {},
            set(k, v) {res.headers[k] = v;},
            json(data) {res.body = data; return res;},
        };
        return res;
    };
    const mkReq = (auth, query) => ({
        method: 'GET', path: '/api/cashier-sales/orders', originalUrl: '/api/cashier-sales/orders',
        headers: { authorization: `Bearer ${auth}` }, query,
    });

    test('بدون live: الثانية من الكاش، ومع live: لا خدمةٌ من الكاش ولا تخزين', () => {
        invalidateAll();
        const token = `live-contract-${Date.now()}`;

        const first = mkRes();
        apiCacheMiddleware(mkReq(token, {}), first, () => { first.passed = true; });
        expect(first.passed).toBe(true);
        first.json({ ok: true, rows: [] });
        expect(first.headers['X-Cache']).toBe('MISS');

        const second = mkRes();
        apiCacheMiddleware(mkReq(token, {}), second, () => { second.passed = true; });
        expect(second.passed).toBeUndefined();
        expect(second.headers['X-Cache']).toBe('HIT');
        expect(second.body).toEqual({ ok: true, rows: [] });

        // الطلب الصريح بلايف: لا HIT ولا إدراجٌ في الكاش (المسار التالي يجيبه)
        const live = mkRes();
        apiCacheMiddleware(mkReq(token, { live: '1' }), live, () => { live.passed = true; });
        expect(live.passed).toBe(true);
        expect(live.headers['X-Cache']).toBeUndefined();

        // ومحسوبٌ بنفس المزيج: ما خزّنه الكاشُ السابق ما زال سليمًا
        const third = mkRes();
        apiCacheMiddleware(mkReq(token, {}), third, () => { third.passed = true; });
        expect(third.headers['X-Cache']).toBe('HIT');
        invalidateAll();
    });
});
