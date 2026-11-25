import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
    accountSignatureName,
    cancelPR,
    cancelVisible,
    chefActionsVisible,
    chefApprovePR,
    chefRejectPR,
    collectPRItems,
    createPR,
    deletePR,
    deleteVisible,
    filterPRDeptOptions,
    gmActionsVisible,
    gmApprovePR,
    gmRejectPR,
    isChefCreator,
    normalizeSignatureData,
    normalizeSignerName,
    PR_CANCEL_ROLES,
    PR_CANCEL_UI_ROLES,
    PR_CHEF_CREATE_ROLES,
    PR_CHEF_ROLES,
    PR_CREATE_ROLES,
    PR_GM_ROLES,
    PR_INVALIDATE,
    PR_WRITE_TEXT,
    prCanCreate,
    prCreateError,
    prCreatePayload,
    prCreateSuccess,
    prDecisionFailure,
    prDecisionSubmitLabel,
    prDecisionSuccess,
    prDecisionTitle,
    prNotesPayload,
    prReasonError,
    prRejectPayload,
} from './purchase-requests-write';

/**
 * طبقة كتابة طلبات الشراء — نفس عقد V2 حرفيًّا:
 *  • الأدوار قوائم الخادم نفسها (لا admin ضمنيًّا).
 *  • بوابات الأزرار شروط `pr-repo.js:226-247`.
 *  • التحقق والحمولات ورسائل التأكيد/النجاح/الخطأ منقولة من `wh-prs.js`.
 *  • المسارات السبعة كما يعرّفها الخادم في `pr-routes.js`.
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

const NAME = 'أمين مخزن';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('طلبات الشراء — الأدوار (قوائم الخادم حرفيًّا)', () => {
    it('كل قائمة هي قائمة الخادم نفسها', () => {
        expect([...PR_CREATE_ROLES]).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef']);
        expect([...PR_CANCEL_ROLES]).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head']);
        expect([...PR_CHEF_ROLES]).toEqual(['admin', 'manager', 'kitchen', 'sous_chef']);
        expect([...PR_GM_ROLES]).toEqual(['admin', 'manager']);
        expect([...PR_CHEF_CREATE_ROLES]).toEqual(['kitchen', 'sous_chef']);
        // مجموعة زر الإلغاء في الواجهة — خمسة بلا dept_head (pr-repo.js:73).
        expect([...PR_CANCEL_UI_ROLES]).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef']);
    });

    it('بوابات الأزرار تطابق شروط V2', () => {
        expect(prCanCreate('warehouse')).toBe(true);
        expect(prCanCreate('accountant')).toBe(false);
        expect(prCanCreate(null)).toBe(false);

        expect(isChefCreator('kitchen')).toBe(true);
        expect(isChefCreator('sous_chef')).toBe(true);
        expect(isChefCreator('admin')).toBe(false);

        expect(chefActionsVisible('kitchen', 'pending')).toBe(true);
        expect(chefActionsVisible('admin', 'pending')).toBe(true);
        expect(chefActionsVisible('warehouse', 'pending')).toBe(false);
        expect(chefActionsVisible('kitchen', 'chef_approved')).toBe(false);

        expect(gmActionsVisible('admin', 'chef_approved')).toBe(true);
        expect(gmActionsVisible('manager', 'chef_approved')).toBe(true);
        expect(gmActionsVisible('kitchen', 'chef_approved')).toBe(false);
        expect(gmActionsVisible('admin', 'pending')).toBe(false);

        // إلغاء: معلّق لصانعي الطلب · موقّع شيف لمجموعة الواجهة.
        expect(cancelVisible('warehouse', 'pending')).toBe(true);
        expect(cancelVisible('dept_head', 'pending')).toBe(false);
        expect(cancelVisible('warehouse', 'chef_approved')).toBe(true);
        expect(cancelVisible('accountant', 'chef_approved')).toBe(false);
        expect(cancelVisible('admin', 'approved')).toBe(false);

        // حذف نهائي: الإدارة فقط، والحالات الثلاث المحمية تنفى.
        expect(deleteVisible('admin', 'pending')).toBe(true);
        expect(deleteVisible('manager', 'rejected')).toBe(true);
        expect(deleteVisible('admin', 'approved')).toBe(false);
        expect(deleteVisible('admin', 'partially_fulfilled')).toBe(false);
        expect(deleteVisible('admin', 'fulfilled')).toBe(false);
        expect(deleteVisible('warehouse', 'pending')).toBe(false);
    });
});

describe('طلبات الشراء — تجميع الأصناف والتحقق (pr-repo.js:262-309)', () => {
    it('النواقص ثم اليدوية، والصفوف غير الصالحة تُسقط', () => {
        const items = collectPRItems(
            [
                { itemId: '11', itemName: 'طماطم', unit: 'كجم', qty: '6' },
                { itemId: '12', itemName: 'بصل', unit: '', qty: '0' },
                { itemId: '13', itemName: 'جزر', unit: 'كجم', qty: 'abc' },
            ],
            [
                { name: ' خضار ', unit: '', qty: '3' },
                { name: '  ', unit: 'كجم', qty: '2' },
            ],
        );
        expect(items).toEqual([
            { itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 },
            { itemId: null, itemName: 'خضار', unit: 'وحدة', requestedQty: 3 },
        ]);
    });

    it('تحقق الإنشاء وسبب الرفض بنصوص V2 نفسها', () => {
        expect(prCreateError([])).toBe('اختر صنفًا واحدًا على الأقل بكمية موجبة');
        expect(PR_WRITE_TEXT.itemsRequired).toBe('اختر صنفًا واحدًا على الأقل بكمية موجبة');
        expect(prCreateError([{ itemId: 1, itemName: 'طماطم', unit: 'كجم', requestedQty: 2 }])).toBe('');

        expect(prReasonError('')).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
        expect(prReasonError('لا')).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
        expect(prReasonError('  كمية مبالغ فيها  ')).toBe('');
        expect(PR_WRITE_TEXT.reasonRequired).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
    });

    it('حمولة الإنشاء — الحقول نفسها وتوقيع الشيف وحده', () => {
        expect(
            prCreatePayload({
                items: [{ itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 }],
                notes: '  أولوية  ',
                deptCode: 'K',
                signatureData: SIGNATURE,
                signerName: ` ${NAME} `,
            }),
        ).toEqual({
            items: [{ itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 }],
            notes: 'أولوية',
            deptCode: 'K',
            signatureData: SIGNATURE,
            // اسم الموقّع يمرّ كما ورد؛ تطبيعه مسؤولية الشاشة/الخادم (V2 كذلك).
            signerName: ' أمين مخزن ',
        });
        expect(prCreatePayload()).toEqual({
            items: [],
            notes: '',
            deptCode: '',
            signatureData: null,
            signerName: null,
        });
    });

    it('حمولا القرار: ملاحظات للاعتماد وسبب للرفض', () => {
        expect(prNotesPayload('  ', SIGNATURE, NAME)).toEqual({
            notes: '',
            signatureData: SIGNATURE,
            signerName: NAME,
        });
        expect(prNotesPayload('  تمّ  ', null, null)).toEqual({
            notes: 'تمّ',
            signatureData: null,
            signerName: null,
        });
        expect(prRejectPayload(' كمية مبالغ فيها ', SIGNATURE, NAME)).toEqual({
            reason: 'كمية مبالغ فيها',
            signatureData: SIGNATURE,
            signerName: NAME,
        });
    });

    it('فلتر أقسام «القسم الطالب» — شرط القديم :504', () => {
        expect(
            filterPRDeptOptions([
                { code: 'K', name: 'المطبخ', parentCode: '' },
                { code: 'kitchen', name: 'مطبخ', parentCode: '' },
                { code: 'external_sales', name: 'بيع خارجي', parentCode: '' },
                { code: 'ys_1', name: 'مرآة', parentCode: '' },
                { code: 'S1', name: 'قسم فرعي', parentCode: 'kitchen' },
                { code: 'S2', name: 'قسم', parentCode: 'K' },
            ]),
        ).toEqual([
            // 'K' ليس 'kitchen' حرفيًّا فيبقى؛ 'S1' يسقط لأن parentCode=kitchen.
            { code: 'K', name: 'المطبخ', parentCode: '' },
            { code: 'S2', name: 'قسم', parentCode: 'K' },
        ]);
    });
});

describe('طلبات الشراء — الاسم والتوقيع (مرآة الخادم)', () => {
    it('تطبيع اسم الموقّع واسم صاحب الحساب', () => {
        expect(normalizeSignerName('  أمين   مخزن ')).toBe('أمين مخزن');
        expect(normalizeSignerName(null)).toBe('');
        expect(accountSignatureName({ name: ' أمين مخزن ', username: 'wh' })).toBe('أمين مخزن');
        expect(accountSignatureName({ name: '', username: 'wh' })).toBe('wh');
        expect(accountSignatureName(null)).toBe('');
    });

    it('التوقيع المقبول هو PNG/JPEG base64 فقط وبحد الخادم', () => {
        expect(normalizeSignatureData(SIGNATURE)).toBe(SIGNATURE);
        expect(normalizeSignatureData('data:image/png;base64,')).toBeNull();
        expect(normalizeSignatureData('data:text/plain;base64,QQ==')).toBeNull();
        expect(normalizeSignatureData(null)).toBeNull();
        expect(normalizeSignatureData(`${SIGNATURE.slice(0, -1)}${'A'.repeat(250001)}`)).toBeNull();
    });
});

describe('طلبات الشراء — نصوص V2 الحرفية', () => {
    it('التأكيدات ورسائل النجاح/الخطأ من wh-prs.js', () => {
        expect(PR_WRITE_TEXT.cancelConfirm).toBe('إلغاء طلب الشراء المعلّق؟');
        expect(PR_WRITE_TEXT.cancelSuccess).toBe('أُلغي طلب الشراء');
        expect(PR_WRITE_TEXT.cancelFailed).toBe('تعذر إلغاء الطلب');
        expect(PR_WRITE_TEXT.deleteConfirm).toBe('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.');
        expect(PR_WRITE_TEXT.deleteSuccess).toBe('حُذف الطلب نهائيًا');
        expect(PR_WRITE_TEXT.deleteFailed).toBe('تعذر حذف الطلب');
        expect(PR_WRITE_TEXT.createFailed).toBe('تعذر إنشاء طلب الشراء');
        expect(PR_WRITE_TEXT.signatureFailed).toBe('تعذر قراءة التوقيع');
    });

    it('عناوين القرارات وأزرارها ورسائلها', () => {
        expect(prDecisionTitle('chef-approve')).toBe('توقيع الشيف');
        expect(prDecisionTitle('chef-reject')).toBe('رفض الشيف');
        expect(prDecisionTitle('gm-approve')).toBe('اعتماد المدير العام');
        expect(prDecisionTitle('gm-reject')).toBe('رفض المدير العام');

        expect(prDecisionSubmitLabel('chef-approve')).toBe('توقيع وإحالة للمدير العام');
        expect(prDecisionSubmitLabel('gm-approve')).toBe('اعتماد نهائي');
        expect(prDecisionSubmitLabel('chef-reject')).toBe('تأكيد الرفض');
        expect(prDecisionSubmitLabel('gm-reject')).toBe('تأكيد الرفض');

        expect(prDecisionSuccess('chef-approve')).toBe('وقّع الشيف — الطلب الآن بانتظار المدير العام');
        expect(prDecisionSuccess('chef-reject')).toBe('رفض الشيف الطلب');
        expect(prDecisionSuccess('gm-approve')).toBe('اعتمد المدير العام الطلب نهائيًا');
        expect(prDecisionSuccess('gm-reject')).toBe('رفض المدير العام الطلب');

        expect(prDecisionFailure('chef-approve')).toBe('تعذر توقيع الشيف');
        expect(prDecisionFailure('chef-reject')).toBe('تعذر رفض الطلب');
        expect(prDecisionFailure('gm-approve')).toBe('تعذر اعتماد المدير العام');
        expect(prDecisionFailure('gm-reject')).toBe('تعذر رفض الطلب');
    });

    it('نجاح الإنشاء: طلب الشيف نهائي يذهب للمخزن مباشرة', () => {
        expect(prCreateSuccess('PR-1', false)).toBe('أُنشئ طلب الشراء PR-1 — بانتظار توقيع الشيف');
        expect(prCreateSuccess('PR-1', true)).toBe('أُنشئ طلب الشراء PR-1 موقّعًا منك — نهائي ولدى المخزن مباشرة');
    });
});

describe('طلبات الشراء — بوابات النداء السبعة (المسارات والحمولات)', () => {
    it('الإنشاء: POST /api/warehouse/purchase-requests ويعيد رقم الطلب', async () => {
        const calls = stubFetch(() => json({ id: 9, request_number: 'PR-9' }, 201));
        const created = await createPR(
            prCreatePayload({
                items: [{ itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 }],
                notes: 'أولوية',
                deptCode: 'K',
            }),
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({
            items: [{ itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 }],
            notes: 'أولوية',
            deptCode: 'K',
            signatureData: null,
            signerName: null,
        });
        expect(created).toEqual({ requestNumber: 'PR-9' });
    });

    it('توقيع الشيف: POST /:id/chef-approve', async () => {
        const calls = stubFetch(() => json({ id: 9, status: 'chef_approved' }));
        await chefApprovePR(9, prNotesPayload('تم', SIGNATURE, NAME));
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9/chef-approve');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ notes: 'تم', signatureData: SIGNATURE, signerName: NAME });
    });

    it('رفض الشيف: POST /:id/chef-reject', async () => {
        const calls = stubFetch(() => json({ id: 9, status: 'rejected' }));
        await chefRejectPR(9, prRejectPayload('كمية مبالغ فيها', SIGNATURE, NAME));
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9/chef-reject');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({
            reason: 'كمية مبالغ فيها',
            signatureData: SIGNATURE,
            signerName: NAME,
        });
    });

    it('اعتماد المدير العام: POST /:id/gm-approve', async () => {
        const calls = stubFetch(() => json({ id: 9, status: 'approved' }));
        await gmApprovePR(9, prNotesPayload('', SIGNATURE, NAME));
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9/gm-approve');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ notes: '', signatureData: SIGNATURE, signerName: NAME });
    });

    it('رفض المدير العام: POST /:id/gm-reject', async () => {
        const calls = stubFetch(() => json({ id: 9, status: 'rejected' }));
        await gmRejectPR(9, prRejectPayload('سبب واضح', SIGNATURE, NAME));
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9/gm-reject');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({ reason: 'سبب واضح', signatureData: SIGNATURE, signerName: NAME });
    });

    it('الإلغاء: POST /:id/cancel بجسم فارغ كما يرسل القديم', async () => {
        const calls = stubFetch(() => json({ id: 9, status: 'cancelled' }));
        await cancelPR('9');
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9/cancel');
        expect(calls[0]?.init.method).toBe('POST');
        expect(bodyOf(calls[0])).toEqual({});
    });

    it('الحذف النهائي: DELETE /:id', async () => {
        const calls = stubFetch(() => json({ ok: true, id: 9 }));
        await deletePR(9);
        expect(calls[0]?.url).toBe('/api/warehouse/purchase-requests/9');
        expect(calls[0]?.init.method).toBe('DELETE');
        expect(calls[0]?.init.body).toBeUndefined();
    });

    it('مفاتيح الإبطال هي سجل الطلبات نفسه', () => {
        expect(PR_INVALIDATE).toEqual([['purchase-requests']]);
    });

    it('خطأ الخادم يمرّ كـApiError برسالته العربية', async () => {
        stubFetch(() => json({ error: 'PR_CHEF_APPROVAL_REQUIRED', message: 'طلب الشراء بانتظار توقيع الشيف أولًا' }, 409));
        const failure = await gmApprovePR(9, prNotesPayload('', SIGNATURE, NAME)).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({
            status: 409,
            code: 'PR_CHEF_APPROVAL_REQUIRED',
            message: 'طلب الشراء بانتظار توقيع الشيف أولًا',
        });
    });
});
