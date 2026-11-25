import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
    deleteConfirm,
    deleteInventoryItem,
    directEditConfirm,
    directEditError,
    directEditInventoryItem,
    directEditPayload,
    directEditSuccess,
    duplicateGroups,
    forceDeleteConfirm,
    forceDeleteInventoryItem,
    hasMovementsError,
    INV_DIRECT_ROLES,
    INV_FORCE_ROLES,
    INV_MERGE_ROLES,
    INV_WRITE_ROLES,
    INVENTORY_TEXT,
    invDirectVisible,
    invForceVisible,
    invMergeVisible,
    invWriteVisible,
    isForeignKeyError,
    mergeConfirm,
    mergeInventoryItems,
    mergeItemKey,
    mergeScopeNote,
    mergeSuccess,
    normalizeExpiryDate,
    receiptError,
    receiptPayload,
    receiptSuccess,
    receiveInventoryItem,
} from './inventory-write';

/**
 * طبقة كتابة المخزون — نفس عقد V2 حرفيًّا:
 *  • الأدوار قوائم الخادم نفسها (لا admin ضمنيًّا).
 *  • الحمولات والتحقق ونصوص النجاح/الخطأ/التأكيد منقولة من
 *    `v2/data/inventory-repo.js` و`v2/screens/warehouse.js`.
 *  • المسارات الخمسة نفسها، والخطأ يمرّ على `ApiError` برسالة الخادم.
 */

type FetchCall = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response): FetchCall[] {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const request = init ?? {};
            calls.push({ url: String(input), init: request });
            return handler(String(input), request);
        }),
    );
    return calls;
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
    const raw = call?.init.body;
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('المخزون — الأدوار (قوائم V2 حرفيًّا)', () => {
    it('كل قائمة هي قائمة الخادم نفسها', () => {
        expect([...INV_WRITE_ROLES]).toEqual(['admin', 'manager', 'warehouse']);
        expect([...INV_FORCE_ROLES]).toEqual(['admin', 'warehouse']);
        expect([...INV_DIRECT_ROLES]).toEqual(['admin']);
        expect([...INV_MERGE_ROLES]).toEqual(['admin']);
    });

    it('بوابات الظهور تطابق قوائم الخادم (لا admin ضمنيًّا)', () => {
        expect(invWriteVisible('admin')).toBe(true);
        expect(invWriteVisible('manager')).toBe(true);
        expect(invWriteVisible('warehouse')).toBe(true);
        expect(invWriteVisible('accountant')).toBe(false);
        expect(invWriteVisible(null)).toBe(false);

        expect(invForceVisible('admin')).toBe(true);
        expect(invForceVisible('warehouse')).toBe(true);
        expect(invForceVisible('manager')).toBe(false);

        expect(invDirectVisible('admin')).toBe(true);
        expect(invDirectVisible('warehouse')).toBe(false);
        expect(invDirectVisible('manager')).toBe(false);

        expect(invMergeVisible('admin')).toBe(true);
        expect(invMergeVisible('manager')).toBe(false);
    });
});

describe('المخزون — تحقق الوارد وحمولته', () => {
    it('الكمية والسعر والوحدة والصلاحية كما في V2', () => {
        expect(receiptPayload({}, '3', '7.25')).toEqual({ qty: 3, price: 7.25, unit: '', expiryDate: null });
        expect(receiptPayload({ unit: 'كجم' }, '2', 0)).toEqual({ qty: 2, price: 0, unit: 'كجم', expiryDate: null });
        expect(receiptPayload({}, 'abc', '5')).toEqual({ qty: 0, price: 5, unit: '', expiryDate: null });
        // السجل لا يحمل avgCost ⇒ لا تعبئة تلقائية، والفراغ صفر.
        expect(receiptPayload({}, '1', '').price).toBe(0);
        expect(receiptPayload({}, '1', '2', '2026-11-30').expiryDate).toBe('2026-11-30');
        expect(receiptPayload({}, '1', '2', '30/11/2026').expiryDate).toBeNull();
    });

    it('نفس ترتيب ونصوص رفض submitReceipt في V2', () => {
        expect(receiptError('أرز', '0', '3', '')).toBe('أدخل كمية صحيحة');
        expect(receiptError('أرز', '-2', '3', '')).toBe('أدخل كمية صحيحة');
        expect(receiptError('أرز', '2', '', '')).toBe(INVENTORY_TEXT.priceInvalid);
        expect(receiptError('أرز', '2', '-1', '')).toBe(INVENTORY_TEXT.priceInvalid);
        expect(receiptError('أرز', '2', 'abc', '')).toBe(INVENTORY_TEXT.priceInvalid);
        expect(receiptError('أرز', '2', '1', '30/11/2026')).toBe('تاريخ الصلاحية غير صحيح للصنف أرز — الصيغة المطلوبة YYYY-MM-DD');
        expect(receiptError('أرز', '2', '1', '2026-11-30')).toBe('');
        expect(receiptError('أرز', '2', '1', '')).toBe('');
    });

    it('الصلاحية: صيغة YYYY-MM-DD صحيحة تقويميًا فقط، والغياب null', () => {
        expect(normalizeExpiryDate('2026-11-30')).toBe('2026-11-30');
        expect(normalizeExpiryDate('2026-02-30')).toBeNull();
        expect(normalizeExpiryDate('30/11/2026')).toBeNull();
        expect(normalizeExpiryDate('')).toBeNull();
        expect(normalizeExpiryDate(null)).toBeNull();
        expect(normalizeExpiryDate(undefined)).toBeNull();
    });
});

describe('المخزون — التعديل المباشر (أدمن)', () => {
    it('التحقق يرفض قبل الإرسال بنصوص V2', () => {
        expect(directEditError('4', '2', 'تسوية')).toBe('');
        expect(directEditError('-1', '2', 'تسوية')).toBe('اكتب كمية صحيحة ≥ صفر');
        expect(directEditError('4', 'abc', 'تسوية')).toBe('اكتب تكلفة صحيحة ≥ صفر');
        expect(directEditError('4', '2', '   ')).toBe('اكتب سبب التعديل — يُوثَّق في الدفتر');
    });

    it('الحمولة {qty, avgCost, reason} بتطبيع السبب', () => {
        expect(directEditPayload('4', '2.5', ' تسوية جرد ')).toEqual({
            qty: 4,
            avgCost: 2.5,
            reason: 'تسوية جرد',
        });
    });
});

describe('المخزون — الحذف وحارس الحركات', () => {
    it('حارس الحركات يقرأ الرمز أو نصّ الرسالة فقط (مثل V2)', () => {
        expect(hasMovementsError({ code: 'INVENTORY_HAS_MOVEMENTS', message: 'أي شيء' })).toBe(true);
        expect(hasMovementsError(new Error('الصنف مرتبط بحركات مخزون'))).toBe(true);
        expect(hasMovementsError({ code: 'X', message: 'خطأ آخر' })).toBe(false);
        expect(hasMovementsError(null)).toBe(false);
    });

    it('بديل FK الخام كما في V2', () => {
        expect(isForeignKeyError('insert violates foreign key constraint')).toBe(true);
        expect(isForeignKeyError('23503')).toBe(true);
        expect(isForeignKeyError('خطأ آخر')).toBe(false);
    });
});

describe('المخزون — كشف ودمج المكرر', () => {
    it('مفتاح الدمج يوحّد الهمزات والتاء المربوطة والمسافات (V2 حرفيًّا)', () => {
        expect(mergeItemKey(' زيت  زيتون ')).toBe(mergeItemKey('زيت زيتون'));
        expect(mergeItemKey('قهوة')).toBe('قهوه');
        expect(mergeItemKey('إبريق')).toBe('ابريق');
    });

    it('المجموعات والأكبر رصيدًا يبقى افتراضيًّا', () => {
        const groups = duplicateGroups([
            { id: 1, name: 'زيت', qty: 3 },
            { id: 2, name: ' زيت ', qty: 7 },
            { id: 3, name: 'سكر', qty: 1 },
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.items.map((item) => item.id)).toEqual([1, 2]);
        expect(groups[0]?.keepIdx).toBe(1);
        expect(
            duplicateGroups([
                { id: 1, name: '', qty: 0 },
                { id: 2, name: '  ', qty: 0 },
            ]),
        ).toEqual([]);
    });
});

describe('المخزون — نصوص V2 الحرفية', () => {
    it('تأكيد الحذف والحذف النهائي', () => {
        expect(deleteConfirm('أرز')).toBe('حذف الصنف "أرز"؟');
        expect(forceDeleteConfirm('أرز')).toBe('"أرز" له حركات مخزون.\nهل تريد الحذف النهائي مع كل حركاته وسجلاته؟ (لا يمكن التراجع)');
        expect(INVENTORY_TEXT.deleteSuccess).toBe('تم الحذف');
        expect(INVENTORY_TEXT.forceDeleteSuccess).toBe('تم الحذف النهائي مع الحركات');
        expect(INVENTORY_TEXT.deleteBlocked).toBe(
            'لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر',
        );
    });

    it('تأكيد التعديل المباشر كما كتبه V2', () => {
        expect(directEditConfirm('أرز', 5, '4', '2.5')).toBe(
            'تعديل مباشر لـ "أرز":\nالكمية 5 → 4\nالتكلفة الجديدة 2.5 (القديمة غير معروضة عمدًا — السجل لا يحملها)\n\nسيُقيَّد الفرق في دفتر المخزون باسمك.',
        );
    });

    it('تأكيد الدمج ورسالة «لا مكرر»', () => {
        expect(mergeConfirm(2, 'زيت، زيت ')).toBe(
            'تأكيد الدمج: سيُنقل رصيد 2 صنفًا مكررًا («زيت، زيت ») إلى النسخة المبقية ويُحذف نهائيًا مع إعادة توجيه السجل التاريخي. متابعة؟',
        );
        expect(INVENTORY_TEXT.mergeNoDuplicates).toBe('ممتاز — لا توجد أصناف مكررة بالاسم نفسه حاليًا 👌');
        expect(INVENTORY_TEXT.mergePickKeep).toBe('اختر النسخة التي تبقى');
    });

    it('رسائل النجاح بنفس صياغة V2', () => {
        expect(receiptSuccess(3, 'كجم', 'باذنجان')).toBe('تم إضافة 3 كجم إلى باذنجان');
        expect(receiptSuccess(2.5, '', 'أرز')).toBe('تم إضافة 2.5 إلى أرز');
        expect(directEditSuccess(-4, 'كجم')).toBe('تم التعديل المباشر — الفرق 4 كجم قُيِّد في الدفتر');
        expect(mergeSuccess(2, 5.5)).toBe('تم الدمج: 2 مكرر حُذف ونُقل رصيده (5.5)');
        expect(mergeScopeNote(5, 5, false)).toBe('الفحص على السجل المحمّل (5 صنفًا).');
        expect(mergeScopeNote(2000, 2500, true)).toContain('من 2,500 في السجل');
    });
});

describe('المخزون — بوابات النداء (المسارات والحمولات)', () => {
    it('وارد سريع: POST /api/warehouse/inventory/:id/receipt', async () => {
        const calls = stubFetch(() => json({ inventory: {}, transaction: {} }, 201));
        await receiveInventoryItem('7', { qty: 3, price: 7.25, unit: 'كجم', expiryDate: '2026-11-30' });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('/api/warehouse/inventory/7/receipt');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ qty: 3, price: 7.25, unit: 'كجم', expiryDate: '2026-11-30' });
    });

    it('تعديل مباشر: PUT .../direct ويعيد delta', async () => {
        const calls = stubFetch(() => json({ ok: true, item: {}, delta: -2.5 }));
        const result = await directEditInventoryItem(7, { qty: 4, avgCost: 2.5, reason: 'تسوية جرد' });
        expect(calls[0]?.url).toBe('/api/warehouse/inventory/7/direct');
        expect(calls[0]?.init.method).toBe('PUT');
        expect(bodyOf(calls[0])).toEqual({ qty: 4, avgCost: 2.5, reason: 'تسوية جرد' });
        expect(result.delta).toBe(-2.5);
    });

    it('حذف عادي: DELETE /api/inventory/:id', async () => {
        const calls = stubFetch(() => json({ message: 'Deleted successfully' }));
        await deleteInventoryItem(7);
        expect(calls[0]?.url).toBe('/api/inventory/7');
        expect(calls[0]?.init.method).toBe('DELETE');
        expect(calls[0]?.init.body).toBeUndefined();
    });

    it('حذف نهائي: DELETE /api/warehouse/inventory/:id/force', async () => {
        const calls = stubFetch(() => json({ ok: true, item: { id: 7 }, removed: {} }));
        await forceDeleteInventoryItem(7);
        expect(calls[0]?.url).toBe('/api/warehouse/inventory/7/force');
        expect(calls[0]?.init.method).toBe('DELETE');
    });

    it('دمج: POST /api/warehouse/inventory/merge ويعيد mergedCount/movedQty', async () => {
        const calls = stubFetch(() => json({ ok: true, mergedCount: 2, movedQty: 5.5 }));
        const result = await mergeInventoryItems(1, [2, 3]);
        expect(calls[0]?.url).toBe('/api/warehouse/inventory/merge');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ keepId: 1, dupIds: [2, 3] });
        expect(result).toEqual({ mergedCount: 2, movedQty: 5.5 });
    });

    it('خطأ الخادم يمرّ كـApiError برسالته العربية (حارس الحركات)', async () => {
        stubFetch(() =>
            json(
                {
                    error: 'INVENTORY_HAS_MOVEMENTS',
                    message: 'لا يمكن حذف صنف له حركات مخزون أو أرصدة',
                },
                409,
            ),
        );
        const failure = await deleteInventoryItem(7).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({
            status: 409,
            code: 'INVENTORY_HAS_MOVEMENTS',
            message: 'لا يمكن حذف صنف له حركات مخزون أو أرصدة',
        });
        expect(hasMovementsError(failure)).toBe(true);
    });
});
