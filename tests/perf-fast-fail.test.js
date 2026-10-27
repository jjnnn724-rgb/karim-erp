/**
 * سلاسة الاستجابة (2026-10-13) — ثلاثة أعطال مقاسة من لوج الإنتاج:
 *   1) Oracle ميت → كل طلب 15 ثانية (cashiers-today p50 = 15008ms).
 *   2) النقر المتكرر على اعتماد الصرف → 88 طلب لنفس الإذن → قفل صف 20.6 ثانية.
 *   3) موجة 429 عند الإقلاع (1606 رفضًا) + ذيل loadData متسلسل.
 * الاختبارات سلوكية على الدوال النقية، وتعاقدية على مصدر الواجهة/الخادم.
 */
const { warehouseSource } = require('./helpers/warehouse-source');
const fs = require('fs');
const path = require('path');

const { oracleConnect, oracleBreakerStatus, noteOracleSuccess, noteOracleFailure, guardOracle, isOracleDownError } = require('../backend/yarasoft/oracle-link');
const { beginDispatchOp, endDispatchOp } = require('../backend/warehouse-routes');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const YARA_REPORTS = read('backend/yarasoft/yara-reports.js');
const STORAGE = read('frontend/app/js/core/storage.js');
const KITCHEN = read('frontend/app/js/features/kitchen.js');

describe('كسر دائرة Oracle: الفشل السريع بدل تعليق الطلبات', () => {
    const DOWN = 'NJS-501: connection to host 192.168.1.188 port 1521 terminated unexpectedly';
    beforeEach(() => { noteOracleSuccess(); });

    test('ثلاثة إخفاقات انقطاع متتالية تفتح الدائرة، والرابع يُرفض فورًا بـ ORACLE_UNREACHABLE', async () => {
        const fail = () => oracleConnect(() => { throw new Error(DOWN); });
        for (let i = 0; i < 3; i++) {
            await expect(fail()).rejects.toThrow(/NJS-501/);
        }
        const st = oracleBreakerStatus();
        expect(st.open).toBe(true);
        expect(st.failures).toBe(3);
        const t0 = Date.now();
        await expect(fail()).rejects.toMatchObject({ code: 'ORACLE_UNREACHABLE', oracleCircuitOpen: true });
        // الرفض من الدائرة يجب أن يكون لحظيًا (لا 15 ثانية ولا عدّة إضافية)
        expect(Date.now() - t0).toBeLessThan(50);
        expect(oracleBreakerStatus().failures).toBe(3);
    });

    test('ازدحام المجمع (NJS-040) ليس انقطاعًا: لا يفتح الدائرة أبدًا', async () => {
        const busy = () => oracleConnect(() => { throw new Error('NJS-040: connection request timeout. Request exceeded "queueTimeout" of 5000'); });
        for (let i = 0; i < 6; i++) {
            await expect(busy()).rejects.toThrow(/NJS-040/);
        }
        expect(oracleBreakerStatus().open).toBe(false);
        expect(oracleBreakerStatus().failures).toBe(0);
        expect(isOracleDownError(new Error('NJS-040 queueTimeout'))).toBe(false);
        expect(isOracleDownError(new Error('ORA-12541: TNS:no listener'))).toBe(true);
        expect(isOracleDownError(new Error(DOWN))).toBe(true);
        expect(isOracleDownError(new Error('ORA-00942: table or view does not exist'))).toBe(false);
    });

    test('النجاح يُغلق الدائرة من جديد، والفشل الفردي المعزول لا يفتحها', async () => {
        await expect(oracleConnect(() => { throw new Error('ORA-12541: TNS:no listener'); })).rejects.toThrow(/ORA-12541/);
        expect(oracleBreakerStatus().open).toBe(false);
        expect(await oracleConnect(async () => 'CONN')).toBe('CONN');
        expect(oracleBreakerStatus().failures).toBe(0);
    });

    test('بعد فترة الاستعادة تُفتح محاولة نصف-مفتوحة، وفشلها يعيد الإغلاق', () => {
        const realNow = Date.now;
        let base = realNow.call(Date);
        Date.now = () => base;
        try {
            for (let i = 0; i < 3; i++) { guardOracle(); try { throw new Error(DOWN); } catch (e) { noteOracleFailure(e); } }
            expect(oracleBreakerStatus().open).toBe(true);
            base = realNow.call(Date) + (oracleBreakerStatus().cooldownMs + 1000);
            expect(() => guardOracle()).not.toThrow();          // نصف مفتوحة: مسموح
            base = realNow.call(Date) + (oracleBreakerStatus().cooldownMs + 2000);
            expect(() => guardOracle()).not.toThrow();
            try { throw new Error(DOWN); } catch (e) { noteOracleFailure(e); }
            expect(() => guardOracle()).toThrow(/ORACLE_UNREACHABLE/); // فشل واحد بعد الحد يعيد الفتح
        } finally {
            Date.now = realNow;
            noteOracleSuccess();
        }
    });
});

describe('بوابة الاعتماد: رفض المكرر فورًا بدل الاصطفاف خلف قفل الصف', () => {
    test('نفس الإذن ونفس العملية لا تُنفَّذ مرتين بالتوازي، وأنواع العمليات لا تتعارض', () => {
        expect(beginDispatchOp('777', 'approve')).toBe(true);
        expect(beginDispatchOp('777', 'approve')).toBe(false);
        expect(beginDispatchOp('777', 'chef-approve')).toBe(true);
        endDispatchOp('777', 'approve');
        expect(beginDispatchOp('777', 'approve')).toBe(true);
        endDispatchOp('777', 'approve');
        endDispatchOp('777', 'chef-approve');
    });

    test('المسار يعتمد البوابة ويضبط lock_timeout ويرد 409 رمزًا واضحًا', () => {
        const ROUTES = warehouseSource();
        const approve = ROUTES.slice(ROUTES.indexOf("'/dispatches/:id/approve'"), ROUTES.indexOf("'/dispatches/:id/chef-approve'"));
        expect(approve).toContain('beginDispatchOp(req.params.id');
        expect(approve).toContain('endDispatchOp(req.params.id');
        expect(approve).toContain("SET LOCAL lock_timeout = '8000'");
        expect(approve).toContain('DISPATCH_APPROVE_IN_PROGRESS');
        expect(approve).toContain("'55P03'");
        expect(approve).toContain('if (client) {client.release();}');
    });

    test('الواجهة لا تُرسل اعتمادًا مكررًا أثناء تنفيذ السابق', () => {
        expect(KITCHEN).toContain('let _approvingDispatch = false;');
        expect(KITCHEN).toMatch(/async function confirmApprove\(id\)\{[\s\S]{0,400}_approvingDispatch/);
        expect(KITCHEN).toContain("DISPATCH_APPROVE_IN_PROGRESS");
        expect(KITCHEN).toMatch(/finally\{ _approvingDispatch=false; hideLoad\(\); \}/);
    });
});

describe('سلاسة الإقلاع: لا موجة 429 ولا ذيل متسلسل', () => {
    test('ميزانية القراءة تتسع لدفعة الكيانات عند بدء التشغيل', () => {
        const { DEFAULT_CONFIGS } = require('../backend/rate-limiter');
        expect(DEFAULT_CONFIGS.general.maxRequests).toBeGreaterThanOrEqual(600);
    });

    test('ذيل loadData يعمل بالتوازي مع دفعة الكيانات لا بعده', () => {
        expect(STORAGE).toContain('const entitiesBatch = Promise.allSettled(nonAttendance.map(e => apiList(e)));');
        expect(STORAGE).toContain('const tailBatch = Promise.allSettled([');
        expect(STORAGE).toContain('/attendance/range?from=${attFrom}&to=${attTo}&limit=30000');
        expect(STORAGE).toContain("apiFetch('/pos/recipes/catalog')");
        expect(STORAGE).toContain("apiFetch('/kitchen/overview')");
        expect(STORAGE).toContain('refreshProcurementData()');
        expect(STORAGE).toContain('const tail = await tailBatch;');
        // لم يبقَ أي انتظار متسلسل على حدة بعد الدفعة
        expect(STORAGE).not.toMatch(/try \{ STATE\.kitchenOps = await apiFetch\('\/kitchen\/overview'\); \} catch \(e\) \{ console\.warn\('Could not load kitchen overview:', e\.message\); \}\n {4}await refreshProcurementData\(\);/);
    });

    test('مسارات يارا تستخدم البوابة ومهلة أقصر مع مجمع أوسع', () => {
        expect(YARA_REPORTS).toContain('queueTimeout: 5000');
        expect(YARA_REPORTS).not.toContain('queueTimeout: 15000');
        expect(YARA_REPORTS).toMatch(/poolMin: 0, poolMax: 8/);
        expect(YARA_REPORTS).toContain('const CT_CACHE_MS = 60 * 1000;');
        const connCalls = [...YARA_REPORTS.matchAll(/await oracleConnect\(/g)].length;
        expect(connCalls).toBeGreaterThanOrEqual(2);
        expect(YARA_REPORTS).not.toMatch(/conn = await \(await _ciPoolGet\(oracledb, cfg\)\)\.getConnection\(\)/);
    });

    test('cashiers-today يخدم آخر لقطة ناجحة عند الانقطاع بدل وجه فارغ', () => {
        const today = YARA_REPORTS.slice(YARA_REPORTS.indexOf("'/cashiers-today'"));
        const body = today.slice(0, today.indexOf('function riyadhDayStr'));
        expect(body).toContain('stale: true');
        expect(body).toContain('staleAgeMs');
        expect(body).toContain('res.status(503)');
    });
});
