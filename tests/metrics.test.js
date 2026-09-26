/**
 * metrics.test.js — In-process observability collector (enterprise hardening)
 * Covering: route grouping cardinality safety, ring buffer boundedness,
 * counters by status class, latency percentiles, snapshot shape, reset,
 * and that middleware never throws / never breaks the request chain.
 */

const metrics = require('../backend/metrics');

// ─── routeGroup ──────────────────────────────────────────────────────────────
describe('routeGroup — تجميع المسارات بلا انفجار بطاقة الأبعاد', () => {
    test('يُسقط المعرفات الرقمية و UUID والاستعلامات (سقف 4 مقاطع للبطاقة)', () => {
        expect(metrics.routeGroup({ originalUrl: '/api/pos/orders/123/reprint' })).toBe('api.pos.orders.:id');
        expect(metrics.routeGroup({ originalUrl: '/api/pos/orders?limit=5&page=2' })).toBe('api.pos.orders');
        expect(metrics.routeGroup({ originalUrl: '/api/x/9f8d4c1e-2a3b-4c5d-9e8f-1a2b3c4d5e6f/next' })).toBe('api.x.:uuid.next');
        expect(metrics.routeGroup({ url: '/' })).toBe('root');
    });
});

// ─── middleware + counters ───────────────────────────────────────────────────
describe('middleware — يسجل الحالة والزمن ولا يعطل الطلب أبدًا', () => {
    beforeEach(() => metrics.reset());

    function fakeReqRes(url, status) {
        const listeners = {};
        const res = {
            statusCode: status,
            on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
            emit(ev) { (listeners[ev] || []).forEach(fn => fn()); },
        };
        return { req: { originalUrl: url }, res };
    }

    test('يعدّ الطلبات حسب صنف الحالة 2xx/4xx/5xx والمجموع', async () => {
        const mw = metrics.middleware();
        const calls = [];
        const next = () => calls.push('next');
        const a = fakeReqRes('/api/health', 200);
        const b = fakeReqRes('/api/auth/login', 401);
        const c = fakeReqRes('/api/x', 500);
        mw(a.req, a.res, next); a.res.emit('finish');
        mw(b.req, b.res, next); b.res.emit('finish');
        mw(c.req, c.res, next); c.res.emit('finish');
        const snap = metrics.snapshot(null);
        expect(calls).toEqual(['next', 'next', 'next']);
        expect(snap.requests.total).toBe(3);
        expect(snap.requests.ok).toBe(1);
        expect(snap.requests.client4xx).toBe(1);
        expect(snap.requests.server5xx).toBe(1);
        expect(snap.requests.byGroup['api.health'].total).toBe(1);
        expect(snap.requests.byGroup['api.auth.login'].err).toBe(1);
    });

    test('لا يرمي حتى لو انفجر تسجيل النتيجة (حرس never-break)', () => {
        const mw = metrics.middleware();
        const badRes = { statusCode: 200, on() { throw new Error('boom'); } };
        expect(() => mw({ originalUrl: '/x' }, badRes, () => {})).not.toThrow();
    });

    test('الطلبات البطيئة تُعدّ في عدّاد slow (عتبة منخفضة تجريبيًا)', async () => {
        const spy = jest.spyOn(Date, 'now');
        let now = 1_000_000;
        spy.mockImplementation(() => now);
        const mw = metrics.middleware();
        const { req, res } = fakeReqRes('/api/heavy', 200);
        mw(req, res, () => {});
        now += 5000; // محاكاة مرور 5 ثوانٍ قبل finish
        res.emit('finish');
        const snap = metrics.snapshot(null);
        expect(snap.requests.slow).toBe(1);
        expect(snap.requests.latency.last5m.max).toBe(5000);
        spy.mockRestore();
    });
});

// ─── percentiles ─────────────────────────────────────────────────────────────
describe('percentiles — مئينات زمن الاستجابة من النافذة', () => {
    beforeEach(() => metrics.reset());

    test('p50/p90/p95/p99/max على عينة معروفة', () => {
        const t = Date.now();
        for (let i = 1; i <= 100; i++) {metrics.pushRing({ t, d: i, s: 200, g: 'g' });}
        const p = metrics.percentiles(60 * 1000);
        expect(p.count).toBe(100);
        expect(p.p50).toBeGreaterThanOrEqual(50);
        expect(p.p99).toBeGreaterThanOrEqual(99);
        expect(p.max).toBe(100);
    });

    test('النافذة الزمنية تستبعد القياسات الأقدم منها', () => {
        const old = Date.now() - 10 * 60 * 1000;
        metrics.pushRing({ t: old, d: 999, s: 200, g: 'g' });
        metrics.pushRing({ t: Date.now(), d: 10, s: 200, g: 'g' });
        expect(metrics.percentiles(60 * 1000)).toMatchObject({ count: 1, p50: 10 });
        expect(metrics.percentiles(15 * 60 * 1000)).toMatchObject({ count: 2 });
    });

    test('نافذة فارغة → null بلا رمي', () => {
        expect(metrics.percentiles(60 * 1000)).toBeNull();
    });
});

// ─── ring boundedness ────────────────────────────────────────────────────────
describe('الخاتم محدود الذاكرة — لا نمو بلا سقف تحت أي حمل', () => {
    test('يدفع أكثر من سعة الخاتم فلا يتجاوز الحد أبداً', () => {
        metrics.reset();
        const over = metrics.RING_MAX + 500;
        const t = Date.now();
        for (let i = 0; i < over; i++) {metrics.pushRing({ t, d: 1, s: 200, g: 'g' });}
        const p = metrics.percentiles(60 * 1000);
        expect(p.count).toBe(metrics.RING_MAX);
        metrics.reset();
    });
});

// ─── snapshot shape ──────────────────────────────────────────────────────────
describe('snapshot — الشكل الكامل للوحة المراقبة', () => {
    beforeEach(() => metrics.reset());

    test('يحمل الأقسام كلها: requests/memory/cpu/eventLoopLagUs/dbPool', () => {
        const { req, res } = (() => {
            const listeners = {};
            const res = { statusCode: 200, on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); }, emit(e) { (listeners[e] || []).forEach(f => f()); } };
            return { req: { originalUrl: '/api/health' }, res };
        })();
        metrics.middleware()(req, res, () => {});
        res.emit('finish');
        const snap = metrics.snapshot({ totalCount: 3, idleCount: 2, waitingCount: 0 });
        expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
        expect(snap.requests.total).toBe(1);
        expect(snap.requests.latency.last5m).not.toBeNull();
        expect(snap.memory.rssMB).toBeGreaterThan(0);
        expect(snap.cpu).toHaveProperty('userSec');
        expect(snap.dbPool).toEqual({ total: 3, idle: 2, waiting: 0, max: expect.any(Number) });
        // حلقة الأحداث قد تكون null على بيئات قديمة لكن إن وُجدت فحقولها مكتملة
        if (snap.eventLoopLagUs) {
            expect(snap.eventLoopLagUs).toHaveProperty('p99Us');
            expect(snap.eventLoopLagUs).toHaveProperty('meanUs');
        }
    });

    test('pool=null → dbPool=null بلا رمي', () => {
        expect(metrics.snapshot(null).dbPool).toBeNull();
    });
});

// ─── reset ───────────────────────────────────────────────────────────────────
describe('reset — عودة نظيفة لكل العدادات', () => {
    test('بعد reset يكون كل شيء صفرًا', () => {
        metrics.pushRing({ t: Date.now(), d: 5, s: 500, g: 'g' });
        metrics.reset();
        const snap = metrics.snapshot(null);
        expect(snap.requests.total).toBe(0);
        expect(snap.requests.server5xx).toBe(0);
        expect(snap.requests.latency.last5m).toBeNull();
    });
});
