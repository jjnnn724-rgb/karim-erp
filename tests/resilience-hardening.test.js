/**
 * resilience-hardening.test.js — Task 24: الصمود الحقيقي
 * ────────────────────────────────────────────────────────────────────────────
 * يختبر قرار إعادة التشغيل under supervision (سياسة الحارس المستخرجة)
 * واستعادة صفوف ZATCA العالقة في 'processing' بعد انهيار عامل (مستقلة عن
 * مفتاح التفعيل الرئيسي).
 */
const { shouldRestartChild } = require('../backend/supervisor-policy');
const { reclaimStaleProcessing, STALE_AFTER } = require('../backend/cashier-module/zatca-reclaim');

describe('supervisor-policy — قرار إعادة تشغيل الطفل تحت الإشراف', () => {
    test('الإيقاف المُدير من الحارس نفسه لا يُعاد بعده التشغيل', () => {
        const d = shouldRestartChild({ code: 0, signal: null, stopping: true });
        expect(d.restart).toBe(false);
        expect(d.reason).toMatch(/stop/i);
    });

    test('طلب الإيقاف اليدوي (manualStopRequested) لا يُعاد بعده التشغيل', () => {
        const d = shouldRestartChild({ code: 0, signal: null, manualStopRequested: true });
        expect(d.restart).toBe(false);
    });

    test('الخروج النظيف (code 0) دون قرار إيقاف = انقطاع غير متوقع → يعود الخادم', () => {
        // الثغرة الأصلية: أي SIGTERM خارجي كان يُسقط النظام للأبد لأن الحارس
        // كان يفسر الخروج النظيف كإيقاف مقصود. قصة المطعم: سكربت نشر أو
        // systemctl restart يجب أن يعود الكاشير للعمل وحده.
        const d = shouldRestartChild({ code: 0, signal: null });
        expect(d.restart).toBe(true);
        expect(d.reason).toMatch(/clean exit/i);
    });

    test('الانهيار بإشارة (SIGKILL) يعاد تشغيله بذات السياسة', () => {
        const d = shouldRestartChild({ code: null, signal: 'SIGKILL' });
        expect(d.restart).toBe(true);
        expect(d.reason).toContain('SIGKILL');
    });

    test('الخروج برمز غير صفري (فشل) يعاد تشغيله', () => {
        const d = shouldRestartChild({ code: 1, signal: null });
        expect(d.restart).toBe(true);
        expect(d.reason).toMatch(/exit code/);
    });

    test('مدخلات غائبة كليًا تُعامَل كانهيار (أأمن قرار)', () => {
        const d = shouldRestartChild({});
        expect(d.restart).toBe(true);
    });

    test('الإيقاف المُدير يتفوق على أي رمز خروج حتى غير الصفري', () => {
        const d = shouldRestartChild({ code: 137, signal: 'SIGKILL', stopping: true, manualStopRequested: true });
        expect(d.restart).toBe(false);
    });
});

describe('zatca-reclaim — استعادة الصفوف العالقة في processing بعد انهيار عامل', () => {
    function mockClient(rowCount) {
        const calls = [];
        return {
            calls,
            async query(sql) {
                calls.push(sql);
                return { rowCount };
            },
        };
    }

    test('تستدعي UPDATE بحالة processing وعتبة 15 دقيقة وترجع عدد الصفوف', async () => {
        const c = mockClient(3);
        const n = await reclaimStaleProcessing(c);
        expect(n).toBe(3);
        expect(c.calls).toHaveLength(1);
        expect(c.calls[0]).toContain('pos_zatca_invoice_queue');
        expect(c.calls[0]).toContain("status = 'processing'");
        expect(c.calls[0]).toContain("'failed'");
        expect(c.calls[0]).toContain(STALE_AFTER);
    });

    test('صفر صفوف عالقة → ترجع 0 دون فشل', async () => {
        const c = mockClient(0);
        await expect(reclaimStaleProcessing(c)).resolves.toBe(0);
    });

    test('rowCount الغائب (تعريفات قديمة) يُعامَل كصفر', async () => {
        const c = mockClient(undefined);
        await expect(reclaimStaleProcessing(c)).resolves.toBe(0);
    });

    test('فشل قاعدة البيانات ينتشر للمستدعي (لا ابتلاع أخطاء)', async () => {
        const c = { async query() { throw new Error('ECONNRESET'); } };
        await expect(reclaimStaleProcessing(c)).rejects.toThrow('ECONNRESET');
    });

    test('الاستعادة موثقة بآخر خطأ افتراضي صادق (Reclaimed stale processing job)', async () => {
        const c = mockClient(1);
        await reclaimStaleProcessing(c);
        expect(c.calls[0]).toContain('Reclaimed stale processing job');
        // COALESCE يحفظ أي رسالة خطأ حقيقية سابقة بدل كتمها
        expect(c.calls[0]).toContain('COALESCE');
    });
});
