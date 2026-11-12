import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    approveDispatch,
    approveDraftError,
    approveErrorText,
    approveItemsPayload,
    approveSuccessText,
    canCreateDispatch,
    chefActionsVisible,
    chefApproveDispatch,
    chefRejectDispatch,
    createDispatch,
    createDispatchPayload,
    createErrorText,
    createItemsError,
    createRequestError,
    createSuccessText,
    decisionSignatureError,
    deleteConfirmText,
    deleteDispatch,
    deleteSuccessText,
    deleteVisible,
    dispatchGate,
    dispatchItemLines,
    editDispatch,
    editDispatchPayload,
    editItemsError,
    editSuccessText,
    editVisible,
    isFinalDelete,
    receiveDispatch,
    receiveDraftError,
    receivedItemsPayload,
    receiveVisible,
    rejectDispatch,
    reopenDispatch,
    reopenVisible,
    rowDeptMatches,
    warehouseActionsVisible,
} from '../lib/dispatches-write';

/**
 * كتابة أذون الصرف — الأدوار والتحقق والحمولات والمسارات والرسائل، منقولة
 * حرفيًّا من V2 (`dispatch-repo.js`/`dispatch.js`) ومطابقة لتعريفات الخادم.
 * `fetch` مُستبدل: نتحقق من المسار والطريقة والجسم كما يصل إلى الخادم.
 */

interface Call {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    headers: Record<string, string>;
}

function stubFetch(responseBody: unknown = { ok: true }, status = 200): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            const rawBody = init?.body;
            calls.push({
                url: String(url),
                method: init?.method ?? 'GET',
                body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : null,
                headers: (init?.headers ?? {}) as Record<string, string>,
            });
            return new Response(JSON.stringify(responseBody), {
                status,
                headers: { 'Content-Type': 'application/json' },
            });
        }),
    );
    return calls;
}

const signature = 'data:image/png;base64,AAAA';
const signerName = 'أمين مخزن';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أذون الصرف — بوابات الأدوار (مرآة V2)', () => {
    it('الإنشاء للأدوار الستة نفسها ولا لغيرها', () => {
        for (const role of ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head']) {
            expect(canCreateDispatch(role)).toBe(true);
        }
        for (const role of ['accountant', 'hr', 'cashier', '', null, undefined]) {
            expect(canCreateDispatch(role)).toBe(false);
        }
    });

    it('أزرار الشيف للمعلّق المحوَّل للشيف بقائمة أدوارها حصرًا', () => {
        const row = dispatchGate({ id: 1, status: 'pending', needsChefApproval: true });
        expect(chefActionsVisible('kitchen', row)).toBe(true);
        expect(chefActionsVisible('sous_chef', row)).toBe(true);
        expect(chefActionsVisible('admin', row)).toBe(true);
        expect(chefActionsVisible('manager', row)).toBe(true);
        expect(chefActionsVisible('warehouse', row)).toBe(false);
        expect(chefActionsVisible('dept_head', row)).toBe(false);
        expect(chefActionsVisible('kitchen', { ...row, needsChefApproval: false })).toBe(false);
        expect(chefActionsVisible('kitchen', { ...row, status: 'chef_approved' })).toBe(false);
    });

    it('أزرار المخازن لمرحلة المخزن وحدها (pending بلا شيف أو chef_approved)', () => {
        const pending = dispatchGate({ id: 2, status: 'pending', needsChefApproval: false });
        const chefApproved = dispatchGate({ id: 3, status: 'chef_approved', needsChefApproval: true });
        expect(warehouseActionsVisible('warehouse', pending)).toBe(true);
        expect(warehouseActionsVisible('warehouse', chefApproved)).toBe(true);
        expect(warehouseActionsVisible('kitchen', pending)).toBe(false);
        expect(warehouseActionsVisible('warehouse', { ...pending, status: 'approved' })).toBe(false);
        expect(warehouseActionsVisible('warehouse', dispatchGate({ id: 4, status: 'pending', needsChefApproval: true }))).toBe(false);
    });

    it('الحذف: أي حالة للأدمن، والمعلّق وحده لمدير/مخزن', () => {
        const pending = dispatchGate({ id: 1, status: 'pending' });
        const approved = dispatchGate({ id: 2, status: 'approved' });
        expect(deleteVisible('admin', approved)).toBe(true);
        expect(isFinalDelete('admin', 'approved')).toBe(true);
        expect(deleteVisible('manager', pending)).toBe(true);
        expect(deleteVisible('warehouse', pending)).toBe(true);
        expect(deleteVisible('manager', approved)).toBe(false);
        expect(deleteVisible('kitchen', pending)).toBe(false);
        expect(isFinalDelete('manager', 'approved')).toBe(false);
    });

    it('التعديل: pending/chef_approved وبقائمة الأدوار أو رئيس قسم قسمه/منشئه', () => {
        const pending = dispatchGate({ id: 1, status: 'pending', deptCode: 'K01', creatorUserId: '7' });
        expect(editVisible('kitchen', pending, { id: '7' })).toBe(true);
        expect(editVisible('manager', { ...pending, status: 'chef_approved' }, { id: '7' })).toBe(true);
        // V2 يترك باب المنشئ مفتوحًا لأي دور (dispatch-repo.js:244)، فالمخزن
        // يعدّل إذنه هو وحده لا إذن غيره:
        expect(editVisible('warehouse', pending, { id: '7' })).toBe(true);
        expect(editVisible('warehouse', pending, { id: '9' })).toBe(false);
        expect(editVisible('dept_head', pending, { id: '9', deptCode: 'k01' })).toBe(true);
        expect(editVisible('dept_head', pending, { id: '7' })).toBe(true);
        expect(editVisible('dept_head', pending, { id: '9', deptCode: 'K02' })).toBe(false);
        expect(editVisible('kitchen', { ...pending, status: 'approved' }, { id: '7' })).toBe(false);
        expect(rowDeptMatches({ deptCode: 'K01, K02' }, pending)).toBe(true);
        expect(rowDeptMatches({ deptCode: 'K03' }, pending)).toBe(false);
    });

    it('إرجاع الإذن المعتمد للتعديل للمدير/الأدمن قبل أي استلام فقط', () => {
        const approved = dispatchGate({ id: 12, status: 'approved' });
        expect(reopenVisible('admin', approved)).toBe(true);
        expect(reopenVisible('manager', approved)).toBe(true);
        expect(reopenVisible('warehouse', approved)).toBe(false);
        expect(reopenVisible('manager', { ...approved, hasReceipt: true })).toBe(false);
        expect(reopenVisible('manager', { ...approved, status: 'partially_received' })).toBe(false);
        expect(reopenVisible('manager', { ...approved, status: 'pending' })).toBe(false);
        expect(
            reopenVisible(
                'manager',
                dispatchGate({
                    id: 13,
                    status: 'approved',
                    receivedItems: [{ itemName: 'أرز', receivedQty: 1 }],
                }),
            ),
        ).toBe(false);
    });

    it('الاستلام: approved وبقائمة canReceive أو رئيس قسم قسمه', () => {
        const approved = dispatchGate({ id: 4, status: 'approved', deptCode: 'K01' });
        expect(receiveVisible('kitchen', approved, { id: '7' })).toBe(true);
        expect(receiveVisible('admin', approved, { id: '7' })).toBe(true);
        expect(receiveVisible('warehouse', approved, { id: '7' })).toBe(false);
        expect(receiveVisible('dept_head', approved, { id: '9', deptCode: 'K01' })).toBe(true);
        expect(receiveVisible('dept_head', approved, { id: '9', deptCode: 'K02' })).toBe(false);
        expect(receiveVisible('kitchen', { ...approved, status: 'pending' }, { id: '7' })).toBe(false);
    });

    it('صف البوابة يطبّع الغائب بلا تخمين', () => {
        expect(dispatchGate({})).toEqual({
            id: '',
            status: '',
            needsChefApproval: false,
            deptCode: '',
            creatorUserId: '',
            hasReceipt: false,
        });
        expect(dispatchGate({ id: 101, status: 'pending', needsChefApproval: true, creatorUserId: 7 })).toMatchObject({
            id: '101',
            needsChefApproval: true,
            creatorUserId: '7',
        });
    });
});

it('إرجاع الإذن POST …/reopen بسبب إلزامي', async () => {
    const calls = stubFetch({ ok: true });
    await reopenDispatch(104, 'تصحيح الكمية');
    expect(calls[0]?.url).toBe('/api/warehouse/dispatches/104/reopen');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ reason: 'تصحيح الكمية' });
    await expect(reopenDispatch(104, '  ')).rejects.toThrow('أدخل سبب إرجاع الإذن للمخازن');
    expect(calls).toHaveLength(1);
});

describe('أذون الصرف — تحقق النماذج بنصوص V2', () => {
    it('الإنشاء: القسم مطلوب إلا لرئيس القسم، وصنف واحد على الأقل', () => {
        expect(createRequestError('warehouse', '', [])).toBe('حدد القسم الطالب');
        expect(createRequestError('warehouse', 'K01', [])).toBe('أضف صنفًا واحدًا على الأقل');
        expect(createRequestError('dept_head', '', [{ name: 'دجاج', qty: '1', mainQty: 10 }])).toBe('');
    });

    it('الإنشاء: بوابة الرصيد بنصوص V2 (صفر رصيد، وفوق الرصيد)', () => {
        expect(createItemsError([{ name: 'دجاج', qty: '1', mainQty: 0 }])).toBe('لا يوجد أي رصيد من "دجاج" في المخزن — لا يُقبل في طلب صرف');
        expect(createItemsError([{ name: 'دجاج', qty: '7', mainQty: 5 }])).toBe('الرصيد غير كافٍ من "دجاج": المتاح 5 فقط ولا يمكن طلب 7');
        expect(createItemsError([{ name: 'دجاج', qty: '5', mainQty: 5 }])).toBe('');
        expect(createItemsError([{ name: 'دجاج', qty: '0', mainQty: 5 }])).toBe('أضف صنفًا واحدًا على الأقل');
    });

    it('التعديل: لا بوابة رصيد، وصنف صالح واحد يكفي', () => {
        expect(editItemsError([{ name: 'الدجاج', qty: '3' }])).toBe('');
        expect(editItemsError([{ name: '', qty: '3' }])).toBe('اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة');
        expect(editItemsError([{ name: 'الدجاج', qty: '0' }])).toBe('اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة');
    });

    it('اعتماد المخازن: كميات موجبة، ووزن متغير بوزن وكراتين', () => {
        expect(approveDraftError([{ name: 'أرز', unit: 'كجم', requestedQty: 2, approvedQty: '2', catchWeight: false }])).toBe('');
        expect(approveDraftError([{ name: 'أرز', unit: 'كجم', requestedQty: 2, approvedQty: '0', catchWeight: false }])).toBe(
            'تحقق من البيانات',
        );
        expect(approveDraftError([{ name: 'أرز', unit: 'كجم', requestedQty: 2, approvedQty: '-1', catchWeight: false }])).toBe(
            'تحقق من الكميات المعتمدة',
        );
        expect(approveDraftError([{ name: 'دجاج', unit: 'كرتون', requestedQty: 3, approvedQty: '3', catchWeight: false, max: 2 }])).toBe(
            'الكمية المعتمدة من "دجاج" أكبر من المتوفر',
        );
        expect(
            approveDraftError([
                {
                    name: 'دجاج',
                    unit: 'كرتون',
                    requestedQty: 3,
                    catchWeight: true,
                    actualWeight: '',
                    packagingQty: '3',
                },
            ]),
        ).toBe('أدخل الوزن الفعلي بالكيلو للصنف "دجاج"');
        expect(
            approveDraftError([
                {
                    name: 'دجاج',
                    unit: 'كرتون',
                    requestedQty: 3,
                    catchWeight: true,
                    actualWeight: '30',
                    packagingQty: '',
                },
            ]),
        ).toBe('أدخل عدد الكراتين المصروفة للصنف "دجاج"');
    });

    it('الاستلام: لا يتجاوز المعتمد ولا كراتين الاستلام', () => {
        expect(receiveDraftError([{ name: 'زيت', approvedQty: 2, receivedQty: '2', catchWeight: false }])).toBe('');
        expect(receiveDraftError([{ name: 'زيت', approvedQty: 2, receivedQty: '3', catchWeight: false }])).toBe(
            'تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة',
        );
        expect(
            receiveDraftError([
                {
                    name: 'دجاج',
                    approvedQty: 30,
                    receivedQty: '30',
                    catchWeight: true,
                    approvedPackagingQty: 3,
                    receivedPackagingQty: '4',
                },
            ]),
        ).toBe('تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة');
    });

    it('التوقيع: الاسم ثم الحبر بنصوص V2', () => {
        expect(decisionSignatureError(null, '')).toBe('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
        expect(decisionSignatureError(null, signerName)).toBe('تعذر رسم التوقيع — راجع خانة التوقيع');
        expect(decisionSignatureError(signature, signerName)).toBe('');
    });
});

describe('أذون الصرف — حمولات V2 حرفيًّا', () => {
    it('حمولة الإنشاء تشمل status=pending والتاريخ والملاحظات', () => {
        const payload = createDispatchPayload({
            role: 'warehouse',
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            items: [{ name: 'الدجاج', qty: '5', unit: 'كجم' }],
            notes: ' طلب الوردية ',
            date: '2026-11-09',
        });
        expect(payload).toEqual({
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            items: [{ itemName: 'الدجاج', qty: 5, unit: 'كجم' }],
            notes: 'طلب الوردية',
            status: 'pending',
            date: '2026-11-09',
        });
    });

    it('رئيس القسم: deptCode يُحذف ليحسمه الخادم من الحساب', () => {
        const payload = createDispatchPayload({
            role: 'dept_head',
            deptCode: 'K01',
            items: [{ name: 'أرز', qty: 2, unit: 'كجم' }],
            date: '2026-11-09',
        });
        expect(payload.deptCode).toBeUndefined();
        expect(payload.items).toHaveLength(1);
    });

    it('حمولة التعديل: items + deptCode اختياري + reason', () => {
        expect(
            editDispatchPayload({
                role: 'kitchen',
                deptCode: 'K02',
                items: [{ name: 'أرز', qty: '2', unit: 'كجم' }],
                reason: ' تعديل كميات بعد الجرد ',
            }),
        ).toEqual({
            items: [{ itemName: 'أرز', qty: 2, unit: 'كجم' }],
            deptCode: 'K02',
            reason: 'تعديل كميات بعد الجرد',
        });
    });

    it('اعتماد المخازن: كمية عادية أو وزن فعلي + كراتين للوزن المتغير', () => {
        expect(approveItemsPayload([{ name: 'أرز', unit: 'كجم', requestedQty: 3, approvedQty: '2', catchWeight: false }])).toEqual([
            {
                name: 'أرز',
                itemName: 'أرز',
                unit: 'كجم',
                requestedQty: 3,
                approvedQty: 2,
                actualWeight: null,
                packagingQty: null,
                packagingUom: null,
                catchWeightUom: 'kg',
            },
        ]);
        expect(
            approveItemsPayload([
                {
                    name: 'دجاج',
                    unit: 'كرتون',
                    requestedQty: 3,
                    catchWeight: true,
                    actualWeight: '29.5',
                    packagingQty: '3',
                    packagingUom: 'كرتون',
                },
            ]),
        ).toEqual([
            {
                name: 'دجاج',
                itemName: 'دجاج',
                unit: 'kg',
                requestedQty: 29.5,
                approvedQty: 29.5,
                actualWeight: 29.5,
                packagingQty: 3,
                packagingUom: 'كرتون',
                catchWeightUom: 'kg',
            },
        ]);
    });

    it('الاستلام: receivedQty والكراتين للوزن المتغير فقط', () => {
        expect(
            receivedItemsPayload([
                { name: 'زيت', approvedQty: 2, receivedQty: '2', catchWeight: false },
                {
                    name: 'دجاج',
                    approvedQty: 30,
                    receivedQty: '28',
                    catchWeight: true,
                    approvedPackagingQty: 3,
                    receivedPackagingQty: '3',
                },
            ]),
        ).toEqual([
            { itemName: 'زيت', receivedQty: 2, notes: '' },
            { itemName: 'دجاج', receivedQty: 28, receivedPackagingQty: 3, notes: '' },
        ]);
    });

    it('أسطر الإذن تقرأ المطلوب أو المعتمد كما يفعل V2', () => {
        const raw = [
            { itemName: 'الدجاج', qty: '5', unit: 'كجم' },
            { name: 'أرز', qty: '2', approvedQty: '1.5', unit: 'كجم' },
            { itemName: 'دجاج', qty: 3, packagingQty: 3, packagingUom: 'كرتون', catchWeightEnabled: true },
        ];
        const requested = dispatchItemLines(raw);
        expect(requested[0]).toMatchObject({ name: 'الدجاج', qty: 5, catchWeight: false });
        expect(requested[1]).toMatchObject({ name: 'أرز', qty: 2 });
        expect(requested[2]).toMatchObject({ name: 'دجاج', catchWeight: true, packagingQty: 3 });
        expect(dispatchItemLines(raw, { approved: true })[1]).toMatchObject({ name: 'أرز', qty: 1.5 });
    });
});

describe('أذون الصرف — رسائل النجاح/التأكيد/الخطأ', () => {
    it('نصوص النجاح كما في V2', () => {
        expect(createSuccessText('dept_head')).toBe('تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي');
        expect(createSuccessText('warehouse')).toBe('تم إرسال طلب الصرف');
        expect(editSuccessText(false)).toBe('تم تعديل الإذن بنجاح');
        expect(editSuccessText(true)).toBe('تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة');
        expect(deleteSuccessText('admin', 'approved')).toBe('حُذف إذن الصرف نهائيًا (موثّق باسم مدير النظام)');
        expect(deleteSuccessText('manager', 'pending')).toBe('حُذف طلب الصرف المعلق');
        expect(approveSuccessText(50)).toBe('تمت الموافقة وحُسبت مصاريف القسم بقيمة 50.00');
    });

    it('تأكيد الحذف: نص الأدمن النهائي ونص المعلّق', () => {
        const finalText = deleteConfirmText('admin', 'approved', 'معتمد — بانتظار استلام المطبخ');
        expect(finalText).toContain('حذف نهائي لإذن صرف (معتمد — بانتظار استلام المطبخ)؟');
        expect(finalText).toContain('سيُحذف نهائيًا ويُوثّق باسمك في سجل مدير النظام');
        expect(deleteConfirmText('warehouse', 'pending')).toBe(
            'حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف إلا بواسطة مدير النظام — حذف نهائي موثّق)',
        );
    });

    it('خطأ الإنشاء المكرر يُترجم إلى نص V2', () => {
        expect(createErrorText({ code: 'DUPLICATE_DISPATCH', message: 'مكرر' })).toBe('الطلب مسجل بالفعل — لم يتكرر');
        expect(createErrorText(new Error(''))).toBe('تعذر إرسال طلب الصرف — راجع أرصدة المخزن');
        expect(createErrorText(new Error('الرصيد غير كافٍ'))).toBe('الرصيد غير كافٍ');
    });

    it('خطأ الاعتماد المتزامن له نص V2', () => {
        expect(approveErrorText({ code: 'DISPATCH_APPROVE_IN_PROGRESS' })).toBe('الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا');
        expect(approveErrorText(new Error('فشل الخادم'))).toBe('فشل الخادم');
        expect(approveErrorText(new Error(''))).toBe('تعذر اعتماد طلب الصرف');
    });
});

describe('أذون الصرف — بوابات HTTP الثماني', () => {
    it('1) الإنشاء POST /api/dispatches بنفس الحمولة', async () => {
        const calls = stubFetch({ ok: true });
        await createDispatch({
            deptCode: 'K01',
            items: [{ itemName: 'دجاج', qty: 5, unit: 'كجم' }],
            notes: '',
            status: 'pending',
            date: '2026-11-09',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('/api/dispatches');
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.body).toMatchObject({
            deptCode: 'K01',
            items: [{ itemName: 'دجاج', qty: 5, unit: 'كجم' }],
            status: 'pending',
        });
    });

    it('2) التعديل PUT /api/warehouse/dispatches/:id/edit ويقرأ chefApprovalReset', async () => {
        const calls = stubFetch({ ok: true, chefApprovalReset: true, deptChanged: false });
        const result = await editDispatch(101, {
            items: [{ itemName: 'أرز', qty: 2, unit: 'كجم' }],
            reason: 'تعديل',
        });
        expect(result).toEqual({ chefApprovalReset: true });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/101/edit');
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.body).toEqual({ items: [{ itemName: 'أرز', qty: 2, unit: 'كجم' }], reason: 'تعديل' });
    });

    it('3) الحذف DELETE /api/dispatches/:id', async () => {
        const calls = stubFetch({ ok: true });
        await deleteDispatch('101');
        expect(calls[0]?.url).toBe('/api/dispatches/101');
        expect(calls[0]?.method).toBe('DELETE');
        expect(calls[0]?.body).toBeNull();
    });

    it('4) اعتماد الشيف POST …/chef-approve مع التوقيع واسم الموقّع', async () => {
        const calls = stubFetch({ dispatch: { id: 101 } });
        await chefApproveDispatch(101, { notes: 'موافق', signatureData: signature, signerName });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/101/chef-approve');
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.body).toEqual({ notes: 'موافق', signatureData: signature, signerName });
    });

    it('5) رفض الشيف POST …/chef-reject مع سبب إلزامي في الحمولة', async () => {
        const calls = stubFetch({ dispatch: { id: 101 } });
        await chefRejectDispatch(101, { reason: 'كمية كبيرة', signatureData: signature, signerName });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/101/chef-reject');
        expect(calls[0]?.body).toEqual({ reason: 'كمية كبيرة', signatureData: signature, signerName });
    });

    it('6) اعتماد المخازن POST …/approve ويرد totalValue', async () => {
        const calls = stubFetch({ dispatch: { id: 102 }, totalValue: '50.5' });
        const result = await approveDispatch(102, {
            approvedItems: approveItemsPayload([{ name: 'أرز', unit: 'كجم', requestedQty: 3, approvedQty: '2', catchWeight: false }]),
            approveNotes: 'اعتماد',
            signatureData: signature,
            signerName,
        });
        expect(result).toEqual({ totalValue: 50.5 });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/102/approve');
        expect(calls[0]?.method).toBe('POST');
        const body = calls[0]?.body ?? {};
        expect(body.approveNotes).toBe('اعتماد');
        expect(body.signatureData).toBe(signature);
        expect(body.signerName).toBe(signerName);
        expect((body.approvedItems as Record<string, unknown>[])[0]).toMatchObject({
            itemName: 'أرز',
            approvedQty: 2,
        });
    });

    it('7) رفض المخازن POST …/reject', async () => {
        const calls = stubFetch({ dispatch: { id: 102 } });
        await rejectDispatch(102, { reason: 'غير مطابق', signatureData: signature, signerName });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/102/reject');
        expect(calls[0]?.body).toEqual({ reason: 'غير مطابق', signatureData: signature, signerName });
    });

    it('8) الاستلام POST …/receive بحمولة items وملاحظات', async () => {
        const calls = stubFetch({ dispatch: { id: 103 }, receivedItems: [] });
        await receiveDispatch(103, {
            items: receivedItemsPayload([{ name: 'زيت', approvedQty: 2, receivedQty: '2', catchWeight: false }]),
            notes: 'استلمت',
            signatureData: signature,
            signerName,
        });
        expect(calls[0]?.url).toBe('/api/warehouse/dispatches/103/receive');
        expect(calls[0]?.body).toEqual({
            items: [{ itemName: 'زيت', receivedQty: 2, notes: '' }],
            notes: 'استلمت',
            signatureData: signature,
            signerName,
        });
    });

    it('خطأ الخادم يصعد برسالته العربية (لا نص مخترع)', async () => {
        stubFetch({ error: 'SIGNATURE_REQUIRED', message: 'التوقيع الإلكتروني مطلوب قبل اعتماد أو استلام أو رفض المستند' }, 422);
        await expect(chefApproveDispatch(101, { notes: '', signatureData: '', signerName: '' })).rejects.toThrow(
            'التوقيع الإلكتروني مطلوب قبل اعتماد أو استلام أو رفض المستند',
        );
    });
});
