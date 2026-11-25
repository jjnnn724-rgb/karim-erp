import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    approveSectionError,
    approveYarasoftSection,
    canWriteYarasoft,
    deactivateYarasoftMapping,
    externalRefText,
    fetchYarasoftMirrorOrders,
    fetchYarasoftOracleReconcile,
    fetchYarasoftSectionInvoices,
    intText,
    invoicePayloadItems,
    mappingFormError,
    moneyText,
    oracleDaysError,
    previewTextError,
    previewYarasoftInvoiceText,
    productSearchError,
    quarantineRows,
    reclassifyError,
    reclassifyYarasoftRevenue,
    reprocessYarasoftInvoice,
    resolveYarasoftReview,
    saveYarasoftMapping,
    sourceFileName,
    startYarasoftOracleCatchUp,
    yarasoftStatusBadge,
} from './yarasoft-write';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(body: unknown = { ok: true }) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(body));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) {
        throw new Error('لم يُستدعَ fetch');
    }
    return { url: String(call[0]), init: call[1] ?? {} };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أدوار يارسوفت', () => {
    it('admin و manager فقط يكتبان — كما في V2 والخادم', () => {
        expect(canWriteYarasoft('admin')).toBe(true);
        expect(canWriteYarasoft('manager')).toBe(true);
        expect(canWriteYarasoft('auditor')).toBe(false);
        expect(canWriteYarasoft('cashier')).toBe(false);
        expect(canWriteYarasoft(null)).toBe(false);
        expect(canWriteYarasoft(undefined)).toBe(false);
    });
});

describe('شارة حالة الاستيراد', () => {
    it('تطابق جدول V2 حرفيًّا', () => {
        expect(yarasoftStatusBadge('COMPLETED')).toEqual({ label: 'مكتملة', tone: 'success' });
        expect(yarasoftStatusBadge('duplicate')).toEqual({ label: 'مكررة', tone: 'info' });
        expect(yarasoftStatusBadge('FAILED')).toEqual({ label: 'فاشلة', tone: 'danger' });
        expect(yarasoftStatusBadge('REQUIRES_REVIEW')).toEqual({ label: 'تحتاج مراجعة', tone: 'warning' });
        expect(yarasoftStatusBadge('NEEDS_MAPPING')).toEqual({ label: 'بانتظار اعتماد القسم', tone: 'warning' });
        expect(yarasoftStatusBadge('DRY_RUN')).toEqual({ label: 'معاينة فقط', tone: 'neutral' });
    });

    it('حالة غير معروفة تُعرض كما هي، والفارغة «غير معروف»', () => {
        expect(yarasoftStatusBadge('CUSTOM')).toEqual({ label: 'CUSTOM', tone: 'neutral' });
        expect(yarasoftStatusBadge(null)).toEqual({ label: 'غير معروف', tone: 'neutral' });
    });
});

describe('عرض الأرقام والنصوص', () => {
    it('moneyText بمنزلتين لاتينية ومهما كان شكل المدخل', () => {
        expect(moneyText('1234.5')).toBe('1,234.50');
        expect(moneyText(10)).toBe('10.00');
        expect(moneyText(null)).toBe('0.00');
        expect(moneyText('غير رقم')).toBe('0.00');
    });

    it('intText بعدد صحيح وفواصل آلاف', () => {
        expect(intText(1234.9)).toBe('1,234');
        expect(intText('42')).toBe('42');
        expect(intText('x')).toBe('0');
    });

    it('sourceFileName يستخرج اسم الملف من مسار ويندوز أو يونكس', () => {
        expect(sourceFileName('C:\\Yara\\Invoices\\a.xml')).toBe('a.xml');
        expect(sourceFileName('/var/yara/b.json')).toBe('b.json');
        expect(sourceFileName(null)).toBe('—');
    });

    it('externalRefText يحذف بادئة ora: ويسقط للبديل', () => {
        expect(externalRefText('ora:123', 5)).toBe('123');
        expect(externalRefText('555', 5)).toBe('555');
        expect(externalRefText(null, 5)).toBe('5');
    });
});

describe('تحقق النماذج', () => {
    it('productSearchError يطلب حرفين على الأقل', () => {
        expect(productSearchError('a')).toBe('اكتب حرفين على الأقل للبحث عن المنتج.');
        expect(productSearchError('  ')).toBe('اكتب حرفين على الأقل للبحث عن المنتج.');
        expect(productSearchError('ab')).toBe('');
    });

    it('approveSectionError يطلب اسم العرض ما لم يكن هناك دمج', () => {
        expect(approveSectionError({ displayAr: ' ' })).toBe('اسم العرض مطلوب.');
        expect(approveSectionError({ displayAr: '', mergeMapId: '3' })).toBe('');
        expect(approveSectionError({ displayAr: 'حلويات' })).toBe('');
    });

    it('mappingFormError يطلب الكود أو الباركود ثم المنتج', () => {
        expect(mappingFormError({ externalCode: '', externalBarcode: '', internalProductId: '' })).toBe(
            'أدخل كود الكاشير أو باركوداً واحداً على الأقل.',
        );
        expect(mappingFormError({ externalCode: 'X1', externalBarcode: '', internalProductId: 0 })).toBe('ابحث واختر المنتج الداخلي أولاً.');
        expect(mappingFormError({ externalCode: 'X1', externalBarcode: '', internalProductId: 12 })).toBe('');
        expect(mappingFormError({ externalCode: '', externalBarcode: '628', internalProductId: '12' })).toBe('');
    });

    it('reclassifyError يشترط تحديد فواتير وقسمًا مستهدفًا', () => {
        expect(reclassifyError([], '1')).toBe('حدد فاتورة واحدة على الأقل واختر القسم المستهدف.');
        expect(reclassifyError([1], '')).toBe('حدد فاتورة واحدة على الأقل واختر القسم المستهدف.');
        expect(reclassifyError([1], '2')).toBe('');
    });

    it('oracleDaysError يقبل 1–90 صحيحًا فقط', () => {
        expect(oracleDaysError(0)).toBe('حدد فترة من يوم إلى 90 يوماً.');
        expect(oracleDaysError(91)).toBe('حدد فترة من يوم إلى 90 يوماً.');
        expect(oracleDaysError('14.5')).toBe('حدد فترة من يوم إلى 90 يوماً.');
        expect(oracleDaysError(1)).toBe('');
        expect(oracleDaysError('90')).toBe('');
    });

    it('previewTextError يرفض النص الفارغ قبل أي نداء', () => {
        expect(previewTextError('')).toBe('ألصق محتوى ملف فاتورة للمعاينة أولاً.');
        expect(previewTextError('   ')).toBe('ألصق محتوى ملف فاتورة للمعاينة أولاً.');
        expect(previewTextError('<invoice/>')).toBe('');
        expect(() => previewYarasoftInvoiceText('  ')).toThrow('ألصق محتوى ملف فاتورة للمعاينة أولاً.');
    });
});

describe('عقود الكتابة — المسار والجسم', () => {
    it('إعادة معالجة فاتورة', async () => {
        const fetchMock = stubFetch({ ok: true });
        await reprocessYarasoftInvoice(7);
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/reprocess/7');
        expect(init.method).toBe('POST');
    });

    it('حل مراجعة صنف يرسل internalProductId رقمًا', async () => {
        const fetchMock = stubFetch({ ok: true, message: 'تم' });
        await resolveYarasoftReview(3, 42);
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/review/3/resolve');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ internalProductId: 42 });
    });

    it('اعتماد قسم مع دمج يرسل mergeMapId رقمًا', async () => {
        const fetchMock = stubFetch({ ok: true });
        await approveYarasoftSection(5, { displayAr: ' حلويات ', displayEn: 'Sweets', mergeMapId: '9' });
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/sections/unmapped/5/approve');
        expect(JSON.parse(String(init.body))).toEqual({ displayAr: 'حلويات', displayEn: 'Sweets', mergeMapId: 9 });
    });

    it('إعادة التصنيف تنقّي المعرفات وتزيل التكرار', async () => {
        const fetchMock = stubFetch({ ok: true });
        await reclassifyYarasoftRevenue([2, 1, 1, -5, 3.5], 7);
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/sections/reclassify');
        expect(JSON.parse(String(init.body))).toEqual({ revenue_ids: [2, 1], to_map_id: 7 });
    });

    it('حفظ ربط المنتج يقصّ المسافات', async () => {
        const fetchMock = stubFetch({ ok: true });
        await saveYarasoftMapping({ externalCode: ' A1 ', externalBarcode: ' 628 ', internalProductId: 15 });
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/mappings');
        expect(JSON.parse(String(init.body))).toEqual({ externalCode: 'A1', externalBarcode: '628', internalProductId: 15 });
    });

    it('تعطيل الربط DELETE على المعرّف', async () => {
        const fetchMock = stubFetch({ ok: true });
        await deactivateYarasoftMapping(11);
        const { url, init } = lastRequest(fetchMock);
        expect(url).toBe('/api/yarasoft/mappings/11');
        expect(init.method).toBe('DELETE');
    });

    it('اللحاق يحصر الأيام بين 1 و90', async () => {
        const fetchMock = stubFetch({ ok: true });
        await startYarasoftOracleCatchUp(500);
        expect(JSON.parse(String(lastRequest(fetchMock).init.body))).toEqual({ days: 90 });
        await startYarasoftOracleCatchUp(0);
        expect(JSON.parse(String(lastRequest(fetchMock).init.body))).toEqual({ days: 14 });
    });
});

describe('عقود القراءة — الاستعلامات', () => {
    it('المقارنة تحصر days بين 1 و90', async () => {
        const fetchMock = stubFetch({ ok: true });
        await fetchYarasoftOracleReconcile(0);
        expect(lastRequest(fetchMock).url).toBe('/api/yarasoft/oracle/reconcile?days=14');
        await fetchYarasoftOracleReconcile(900);
        expect(lastRequest(fetchMock).url).toBe('/api/yarasoft/oracle/reconcile?days=90');
    });

    it('فواتير القسم تحدّ الصفحة والحد الأقصى وتقصّ البحث', async () => {
        const fetchMock = stubFetch({ ok: true, rows: [] });
        await fetchYarasoftSectionInvoices(3, { page: 0, limit: 1000, query: '  123456  ' });
        const { url } = lastRequest(fetchMock);
        expect(url.startsWith('/api/yarasoft/sections/invoices?')).toBe(true);
        expect(url).toContain('map_id=3');
        expect(url).toContain('page=1');
        expect(url).toContain('limit=100');
        expect(url).toContain('q=123456');
    });

    it('مرآة الأوردرات تحدّ الحد الأقصى وتدفع الإزاحة إلى صفر', async () => {
        const fetchMock = stubFetch({ ok: true, orders: [] });
        await fetchYarasoftMirrorOrders({ date: '2026-11-07', cashier: '4', limit: 500, offset: -3 });
        const { url } = lastRequest(fetchMock);
        expect(url.startsWith('/api/yarasoft/mirror/orders?')).toBe(true);
        expect(url).toContain('date=2026-11-07');
        expect(url).toContain('cashier=4');
        expect(url).toContain('limit=200');
        expect(url).toContain('offset=0');
    });
});

describe('تطبيع استجابات الخادم', () => {
    it('بنود الفاتورة تُقرأ من payload.items وتُسقط الأشكال غير الصالحة', () => {
        expect(invoicePayloadItems(null)).toEqual([]);
        expect(invoicePayloadItems({ payload: 'x' })).toEqual([]);

        const items = invoicePayloadItems({
            payload: {
                items: [{ name: 'كيك', externalCode: 'C1', quantity: '2', total: '40.00' }, { name: 'شاي' }, 'غير بند'],
            },
        });
        expect(items).toHaveLength(2);
        expect(items[0]?.name).toBe('كيك');
        expect(items[1]?.name).toBe('شاي');
    });

    it('quarantineRows تقبل مصفوفة أو {rows}', () => {
        expect(quarantineRows([{ ref_code: 'A' }])).toHaveLength(1);
        expect(quarantineRows({ rows: [{ ref_code: 'A' }, { ref_code: 'B' }] })).toHaveLength(2);
        expect(quarantineRows({ rows: undefined })).toEqual([]);
        expect(quarantineRows({ unexpected: true })).toEqual([]);
    });
});
