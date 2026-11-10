import { z } from 'zod';
import { statusOf } from './dispatches';
import { formatQty } from './inventory-register';
import { isWriteRole, writeAck, writeErrorMessage, writeJson } from './write';

/**
 * كتابة أذون الصرف — البوابات الثماني منقولة حرفيًّا من V2
 * (`frontend/app/js/v2/data/dispatch-repo.js` سطور 159-400 وسطور W1، و
 * `frontend/app/js/v2/screens/dispatch.js` 625-1293) ومطابقة للخادم:
 *
 *  1) إنشاء طلب        POST   /api/dispatches                          (server.js:1892-2009)
 *  2) تعديل قبل الاعتماد PUT    /api/warehouse/dispatches/:id/edit     (dispatch-routes.js:400)
 *  3) حذف              DELETE /api/dispatches/:id                      (server.js:2743-2860)
 *  4) اعتماد الشيف     POST   /api/warehouse/dispatches/:id/chef-approve (dispatch-routes.js:295)
 *  5) رفض الشيف        POST   /api/warehouse/dispatches/:id/chef-reject  (dispatch-routes.js:353)
 *  6) اعتماد المخازن   POST   /api/warehouse/dispatches/:id/approve      (dispatch-routes.js:80)
 *  7) رفض المخازن      POST   /api/warehouse/dispatches/:id/reject       (dispatch-routes.js:507)
 *  8) استلام القسم     POST   /api/warehouse/dispatches/:id/receive      (dispatch-routes.js:548)
 *
 * الأدوار هنا قوائم V2 الصريحة (مرآة `dispatch-repo.js:159-174`) — لا
 * `admin` ضمنيًّا: زرٌّ لا يظهر لدورٍ لن يقبله الخادم، والخادم يبقى الحاكم.
 *
 * كل قرار (4-8) يوقع إلكترونيًّا: الخادم يرفض بلا `signatureData` بصيغة
 * `data:image/(png|jpeg);base64,…` وبلا `signerName` مطابق لاسم الحساب
 * (`requireSignature` في warehouse-routes.js:374-391). النصوص منقولة حرفيًّا.
 */

/* ── أدوار V2 حرفيًّا (dispatch-repo.js:159-174) ─────────────────────────── */

/** من ينشئ إذن صرف — مرآة createRoles (server.js:1891). */
export const CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;
/** من يعتمد/يرفض نيابة عن الشيف العمومي — CHEF_APPROVAL_ROLES (warehouse-routes.js:23). */
export const CHEF_DECIDE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'] as const;
/** من يعتمد/يرفض نيابة عن المخازن — APPROVAL_ROLES (warehouse-routes.js:20). */
export const WAREHOUSE_DECIDE_ROLES = ['admin', 'manager', 'warehouse'] as const;
/**
 * من يستلم في واجهة القرار — مرآة canReceive في V2 (kitchen.js:293).
 * الخادم أوسع قليلًا (`RECEIVE_ROLES` يضم warehouse)، وواجهة V2 مرآة القديم
 * عمدًا؛ القرار النهائي للخادم دائمًا.
 */
export const RECEIVE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'] as const;
/** من يعدّل قبل اعتماد المخازن — مرآة canEditDispatch (kitchen.js:343-353). */
export const EDIT_ROLES = ['kitchen', 'sous_chef', 'admin', 'manager'] as const;

/* ── صف البوابة: ما تحتاجه شروط V2 من صف الإذن ──────────────────────────── */

export interface DispatchGateRow {
    id: string;
    status: string;
    needsChefApproval: boolean;
    deptCode: string;
    creatorUserId: string;
}

export interface GateUser {
    id?: string | number | null;
    /** `dept_code` قد يأتي قائمة مفصولة بفواصل (server.js:1276). */
    deptCode?: string | null;
}

/** صف V3 خام (Dispatch) → صف بوابات مُطبَّع — بلا تخمين، الغائب ''/false. */
export function dispatchGate(source: {
    id?: unknown;
    status?: unknown;
    needsChefApproval?: unknown;
    deptCode?: unknown;
    creatorUserId?: unknown;
}): DispatchGateRow {
    return {
        id: source.id === null || source.id === undefined ? '' : String(source.id),
        status: source.status === null || source.status === undefined ? '' : String(source.status),
        needsChefApproval: Boolean(source.needsChefApproval),
        deptCode: source.deptCode === null || source.deptCode === undefined ? '' : String(source.deptCode),
        creatorUserId:
            source.creatorUserId === null || source.creatorUserId === undefined
                ? ''
                : String(source.creatorUserId),
    };
}

/** أكواد أقسام صاحب الحساب — dept_code يقبل قائمة مفصولة بفواصل. */
export function deptCodesOf(user: GateUser | null | undefined): string[] {
    return String(user?.deptCode ?? '')
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean);
}

/** هل الإذن يخص قسم صاحب الحساب؟ — مرآة deptsMatch في V2. */
export function rowDeptMatches(user: GateUser | null | undefined, row: DispatchGateRow): boolean {
    const codes = deptCodesOf(user);
    return codes.length > 0 && codes.includes(row.deptCode.trim().toLowerCase());
}

/* ── بوابات ظهور الأزرار — حرفيًّا من dispatch-repo.js:210-250 ───────────── */

export function canCreateDispatch(role: string | null | undefined): boolean {
    return isWriteRole(role, CREATE_ROLES);
}

/** أزرار الشيف: pending && needsChefApproval (kitchen.js:294). */
export function chefActionsVisible(role: string | null | undefined, row: DispatchGateRow): boolean {
    return row.status === 'pending' && row.needsChefApproval && isWriteRole(role, CHEF_DECIDE_ROLES);
}

/** أزرار المخازن: (pending && !needsChefApproval) || chef_approved (kitchen.js:294). */
export function warehouseActionsVisible(role: string | null | undefined, row: DispatchGateRow): boolean {
    const warehouseStep = (row.status === 'pending' && !row.needsChefApproval) || row.status === 'chef_approved';
    return warehouseStep && isWriteRole(role, WAREHOUSE_DECIDE_ROLES);
}

/** الحذف: معلّق للمخازن والمدير، وأي حالة للأدمن — نهائي موثّق (kitchen.js:294). */
export function deleteVisible(role: string | null | undefined, row: DispatchGateRow): boolean {
    if (role === 'admin') {
        return true;
    }
    return row.status === 'pending' && isWriteRole(role, WAREHOUSE_DECIDE_ROLES);
}

/** الاستلام: approved && (canReceive أو رئيس القسم المخوّل صاحب الإذن). */
export function receiveVisible(
    role: string | null | undefined,
    row: DispatchGateRow,
    user: GateUser | null | undefined,
): boolean {
    if (row.status !== 'approved') {
        return false;
    }
    if (isWriteRole(role, RECEIVE_ROLES)) {
        return true;
    }
    return role === 'dept_head' && rowDeptMatches(user, row);
}

/** التعديل: pending|chef_approved وقبل اعتماد المخازن (kitchen.js:343-353). */
export function editVisible(
    role: string | null | undefined,
    row: DispatchGateRow,
    user: GateUser | null | undefined,
): boolean {
    if (row.status !== 'pending' && row.status !== 'chef_approved') {
        return false;
    }
    if (isWriteRole(role, EDIT_ROLES)) {
        return true;
    }
    if (role === 'dept_head' && rowDeptMatches(user, row)) {
        return true;
    }
    return row.creatorUserId !== '' && row.creatorUserId === String(user?.id ?? '');
}

/** هل لهذا الصف زرّ واحد على الأقل بهذا الدور؟ (عمود الإجراءات يُخفى كليًّا بلا أزرار). */
export function anyActionVisible(
    role: string | null | undefined,
    row: DispatchGateRow,
    user: GateUser | null | undefined,
): boolean {
    return (
        editVisible(role, row, user) ||
        chefActionsVisible(role, row) ||
        warehouseActionsVisible(role, row) ||
        receiveVisible(role, row, user) ||
        deleteVisible(role, row)
    );
}

/* ── نصوص V2 حرفيًّا ────────────────────────────────────────────────────── */

export const DISPATCH_TEXT = {
    /* نموذج الإنشاء — dispatch.js:708,713,719-721,725-728 */
    chooseDept: 'حدد القسم الطالب',
    addOneItem: 'أضف صنفًا واحدًا على الأقل',
    createSent: 'تم إرسال طلب الصرف',
    createSentChef: 'تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي',
    createDuplicate: 'الطلب مسجل بالفعل — لم يتكرر',
    createFailed: 'تعذر إرسال طلب الصرف — راجع أرصدة المخزن',
    /* نموذج التعديل — dispatch.js:741,750-755 */
    editNoItems: 'اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة',
    editSuccess: 'تم تعديل الإذن بنجاح',
    editChefReset: 'تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة',
    editFailed: 'فشل تعديل الإذن',
    /* اعتماد/رفض الشيف — dispatch.js:1104,1109,1119,1127,1132 */
    chefApproved: 'تم اعتماد الطلب وإحالته للمخازن',
    chefApproveFailed: 'تعذر اعتماد الطلب',
    chefRejected: 'تم رفض الطلب وسيظهر لرئيس القسم',
    chefRejectFailed: 'تعذر رفض الطلب',
    reasonRequired: 'أدخل سبب الرفض',
    /* اعتماد المخازن — dispatch.js:1151-1153,1169-1170,1184,1193,1199-1201 */
    approveSuccessPrefix: 'تمت الموافقة وحُسبت مصاريف القسم بقيمة',
    approveFailed: 'تعذر اعتماد طلب الصرف',
    approveInProgress: 'الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا',
    approvedQtyInvalid: 'تحقق من الكميات المعتمدة',
    approvedEmpty: 'تحقق من البيانات',
    /* رفض المخازن — dispatch.js:1212,1220,1225 */
    rejected: 'تم رفض الطلب',
    rejectFailed: 'تعذر رفض طلب الصرف',
    /* الاستلام — dispatch.js:1242,1252,1263,1272,1277 */
    received: 'تم تسجيل استلام المطبخ بالتوقيع',
    receiveFailed: 'تعذر تسجيل استلام المطبخ',
    receiveQtyInvalid: 'تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة',
    /* الحذف — dispatch.js:1076-1086 */
    deletePendingConfirm:
        'حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف إلا بواسطة مدير النظام — حذف نهائي موثّق)',
    deletePendingSuccess: 'حُذف طلب الصرف المعلق',
    deleteFinalSuccess: 'حُذف إذن الصرف نهائيًا (موثّق باسم مدير النظام)',
    deleteFailed: 'تعذر حذف الإذن',
    /* التواقيع — dispatch.js:84-91,1005,1119 */
    signerMissing: 'اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع',
    signNoInk: 'تعذر رسم التوقيع — راجع خانة التوقيع',
    signatureMismatch: 'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر',
    signatureFailed: 'تعذر قراءة التوقيع',
    busy: 'جارٍ تنفيذ عملية — انتظر النتيجة',
} as const;

/* ── تحقق النماذج وحمولات V2 ────────────────────────────────────────────── */

export interface DraftItem {
    name?: unknown;
    qty?: unknown;
    unit?: string;
    mainQty?: unknown;
}

export interface DispatchRequestItem {
    itemName: string;
    qty: number;
    unit: string;
}

function itemNameOf(item: DraftItem): string {
    return String(item.name ?? '').trim();
}

function itemQtyOf(item: DraftItem): number {
    const qty = Number(item.qty);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/**
 * تحقق أصناف الإنشاء — نصوص V2 وترتيبها (dispatch.js:597-615,711-713).
 * طلب صنف بلا رصيد أو فوق الرصيد يُرفض قبل الإرسال (بوابة dispatchStockGate أيضاً).
 */
export function createItemsError(items: readonly DraftItem[]): string {
    if (items.length === 0) {
        return DISPATCH_TEXT.addOneItem;
    }
    for (const item of items) {
        const name = itemNameOf(item);
        const qty = itemQtyOf(item);
        if (!name || qty <= 0) {
            return DISPATCH_TEXT.addOneItem;
        }
        const mainQty = Number(item.mainQty) || 0;
        if (!(mainQty > 0)) {
            return `لا يوجد أي رصيد من "${name}" في المخزن — لا يُقبل في طلب صرف`;
        }
        if (qty > mainQty + 1e-6) {
            return `الرصيد غير كافٍ من "${name}": المتاح ${formatQty(mainQty)} فقط ولا يمكن طلب ${formatQty(qty)}`;
        }
    }
    return '';
}

/** تحقق نموذج الإنشاء كاملًا: القسم (عدا رئيس القسم) ثم الأصناف. */
export function createRequestError(
    role: string | null | undefined,
    deptCode: string | null | undefined,
    items: readonly DraftItem[],
): string {
    if (role !== 'dept_head' && !String(deptCode ?? '').trim()) {
        return DISPATCH_TEXT.chooseDept;
    }
    return createItemsError(items);
}

/** تحقق أصناف التعديل — بلا بوابة رصيد كما في القديم (بوابة الاعتماد هي الحاكمة). */
export function editItemsError(items: readonly DraftItem[]): string {
    const valid = items.filter((item) => itemNameOf(item) !== '' && itemQtyOf(item) > 0);
    return valid.length > 0 ? '' : DISPATCH_TEXT.editNoItems;
}

export interface CreateDispatchPayload {
    deptCode?: string;
    deptName?: string;
    items: DispatchRequestItem[];
    notes: string;
    status: 'pending';
    date: string;
}

/**
 * حمولة الإنشاء — نفس شكل V2 (dispatch.js:717):
 * `{deptCode, deptName, items, notes, status:'pending', date}`.
 * رئيس القسم: V3 لا يحمل `dept_code` في الجلسة، فتُحذف `deptCode` ويحسمها
 * الخادم من الحساب (`resolveDeptHeadDispatch` في warehouse-routes.js:152).
 */
export function createDispatchPayload(input: {
    role: string | null | undefined;
    deptCode?: string | null;
    deptName?: string | null;
    items: readonly DraftItem[];
    notes?: string | null;
    date: string;
}): CreateDispatchPayload {
    const deptCode = input.role === 'dept_head' ? '' : String(input.deptCode ?? '').trim();
    const deptName = String(input.deptName ?? '').trim();
    const items = input.items
        .map((item) => ({
            itemName: itemNameOf(item),
            qty: itemQtyOf(item),
            unit: String(item.unit ?? '').trim(),
        }))
        .filter((item) => item.itemName !== '' && item.qty > 0);
    return {
        ...(deptCode ? { deptCode } : {}),
        ...(deptName ? { deptName } : {}),
        items,
        notes: String(input.notes ?? '').trim(),
        status: 'pending',
        date: input.date,
    };
}

export interface EditDispatchPayload {
    items: DispatchRequestItem[];
    deptCode?: string;
    reason: string;
}

/** حمولة التعديل — نفس V2: `{items, deptCode?, reason}` (dispatch.js:748). */
export function editDispatchPayload(input: {
    role: string | null | undefined;
    deptCode?: string | null;
    items: readonly DraftItem[];
    reason?: string | null;
}): EditDispatchPayload {
    const items = input.items
        .map((item) => ({
            itemName: itemNameOf(item),
            qty: itemQtyOf(item),
            unit: String(item.unit ?? '').trim(),
        }))
        .filter((item) => item.itemName !== '' && item.qty > 0);
    const deptCode = input.role === 'dept_head' ? '' : String(input.deptCode ?? '').trim();
    return {
        items,
        ...(deptCode ? { deptCode } : {}),
        reason: String(input.reason ?? '').trim(),
    };
}

/* ── أصناف الإذن الخام → أسطر القرار ────────────────────────────────────── */

export interface DispatchItemLine {
    name: string;
    unit: string;
    qty: number;
    catchWeight: boolean;
    packagingQty: number;
    packagingUom: string;
}

function recordOf(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * items/approvedItems jsonb → أسطر موحّدة. `approved=true` يقرأ الكمية
 * المعتمدة أولًا (approvedQty ?? qty) كما يفعل الاستلام في V2، وإلا المطلوبة.
 */
export function dispatchItemLines(
    items: unknown,
    options: { approved?: boolean } = {},
): DispatchItemLine[] {
    if (!Array.isArray(items)) {
        return [];
    }
    const approved = options.approved === true;
    const lines: DispatchItemLine[] = [];
    for (const raw of items) {
        const item = recordOf(raw);
        const name = String(item.itemName ?? item.name ?? '').trim();
        if (!name) {
            continue;
        }
        const qtyRaw = approved ? (item.approvedQty ?? item.qty) : item.qty;
        const qty = Number(qtyRaw);
        const packagingQty = Number(item.packagingQty);
        const catchWeight = Boolean(
            item.catchWeightEnabled ||
                item.actualWeight ||
                item.packagingQty ||
                item.estWeightKg ||
                (item.packagingUom && Number(item.packagingQty) > 0),
        );
        lines.push({
            name,
            unit: String(item.unit ?? '').trim(),
            qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
            catchWeight,
            packagingQty: Number.isFinite(packagingQty) && packagingQty > 0 ? packagingQty : 0,
            packagingUom: String(item.packagingUom ?? 'كرتون').trim() || 'كرتون',
        });
    }
    return lines;
}

/** مصدر الكميات المعتمدة للاستلام: approvedItems إن وُجدت وإلا items (V2:920). */
export function receiveSourceItems(dispatch: { approvedItems?: unknown; items?: unknown }): unknown {
    const approved = dispatch.approvedItems;
    return Array.isArray(approved) && approved.length > 0 ? approved : dispatch.items;
}

/* ── حمولات القرار ──────────────────────────────────────────────────────── */

export interface SignedDecision {
    signatureData: string;
    signerName: string;
}

export interface ApproveDraft {
    name: string;
    unit: string;
    requestedQty: number;
    approvedQty?: unknown;
    catchWeight: boolean;
    packagingQty?: unknown;
    actualWeight?: unknown;
    packagingUom?: string;
    max?: unknown;
}

export interface ApproveItemPayload {
    name: string;
    itemName: string;
    unit: string;
    requestedQty: number;
    approvedQty: number;
    actualWeight: number | null;
    packagingQty: number | null;
    packagingUom: string | null;
    catchWeightUom: string;
}

function draftQty(value: unknown): number {
    const qty = Number(value);
    return Number.isFinite(qty) && qty >= 0 ? qty : Number.NaN;
}

/**
 * تحقق كميات الاعتماد — نصوص V2 حرفيًّا (dispatch.js:1151-1170,1184):
 * الوزن المتغير يحتاج وزنًا فعليًّا وعدد كراتين، والكمية لا تتجاوز المتاح.
 */
export function approveDraftError(rows: readonly ApproveDraft[]): string {
    let any = false;
    for (const row of rows) {
        if (row.catchWeight) {
            const weight = Number(row.actualWeight) || 0;
            const boxes = Number(row.packagingQty) || 0;
            if (!(weight > 0)) {
                return `أدخل الوزن الفعلي بالكيلو للصنف "${row.name}"`;
            }
            if (!(boxes > 0)) {
                return `أدخل عدد الكراتين المصروفة للصنف "${row.name}"`;
            }
            const onHand = Number(row.max);
            if (Number.isFinite(onHand) && weight > onHand) {
                return `الوزن الفعلي من "${row.name}" أكبر من المتوفر (${formatQty(onHand)} كجم)`;
            }
            any = true;
            continue;
        }
        const qty = draftQty(row.approvedQty);
        if (Number.isNaN(qty)) {
            return DISPATCH_TEXT.approvedQtyInvalid;
        }
        const onHand = Number(row.max);
        if (Number.isFinite(onHand) && qty > onHand) {
            return `الكمية المعتمدة من "${row.name}" أكبر من المتوفر`;
        }
        if (qty > 0) {
            any = true;
        }
    }
    return any ? '' : DISPATCH_TEXT.approvedEmpty;
}

/**
 * حمولة اعتماد المخازن (dispatch.js:1155-1181): الوزن المتغير يُرسل
 * actualWeight/packagingQty وإلا approvedQty؛ والخادم يحسب التكلفة من رصيده.
 */
export function approveItemsPayload(rows: readonly ApproveDraft[]): ApproveItemPayload[] {
    const payload: ApproveItemPayload[] = [];
    for (const row of rows) {
        if (row.catchWeight) {
            const weight = Number(row.actualWeight) || 0;
            const boxes = Number(row.packagingQty) || 0;
            payload.push({
                name: row.name,
                itemName: row.name,
                unit: 'kg',
                requestedQty: weight,
                approvedQty: weight,
                actualWeight: weight,
                packagingQty: boxes,
                packagingUom: row.packagingUom ?? 'كرتون',
                catchWeightUom: 'kg',
            });
            continue;
        }
        const qty = draftQty(row.approvedQty);
        if (Number.isNaN(qty) || qty <= 0) {
            continue;
        }
        payload.push({
            name: row.name,
            itemName: row.name,
            unit: row.unit,
            requestedQty: row.requestedQty,
            approvedQty: qty,
            actualWeight: null,
            packagingQty: null,
            packagingUom: null,
            catchWeightUom: 'kg',
        });
    }
    return payload;
}

export interface ReceiveDraft {
    name: string;
    approvedQty: number;
    receivedQty?: unknown;
    catchWeight: boolean;
    approvedPackagingQty?: unknown;
    receivedPackagingQty?: unknown;
}

export interface ReceivedItemPayload {
    itemName: string;
    receivedQty: number;
    receivedPackagingQty?: number;
    notes: string;
}

/** تحقق كميات الاستلام — نص V2 نفسه (dispatch.js:1242,1252). */
export function receiveDraftError(rows: readonly ReceiveDraft[]): string {
    for (const row of rows) {
        const received = Number(row.receivedQty);
        if (!Number.isFinite(received) || received < 0 || received > row.approvedQty) {
            return DISPATCH_TEXT.receiveQtyInvalid;
        }
        if (row.catchWeight) {
            const approvedBoxes = Number(row.approvedPackagingQty) || 0;
            const raw = row.receivedPackagingQty;
            const boxes = raw === '' || raw === null || raw === undefined ? approvedBoxes : Number(raw);
            if (!Number.isFinite(boxes) || boxes < 0 || boxes > approvedBoxes) {
                return DISPATCH_TEXT.receiveQtyInvalid;
            }
        }
    }
    return '';
}

/** حمولة الاستلام (dispatch.js:1256-1261). */
export function receivedItemsPayload(rows: readonly ReceiveDraft[]): ReceivedItemPayload[] {
    return rows.map((row) => {
        const received = Number(row.receivedQty) || 0;
        if (!row.catchWeight) {
            return { itemName: row.name, receivedQty: received, notes: '' };
        }
        const approvedBoxes = Number(row.approvedPackagingQty) || 0;
        const raw = row.receivedPackagingQty;
        const boxes = raw === '' || raw === null || raw === undefined ? approvedBoxes : Number(raw) || 0;
        return { itemName: row.name, receivedQty: received, receivedPackagingQty: boxes, notes: '' };
    });
}

/** توقيع القرار: اسم الموقّع ثم وجود الحبر — نفس ترتيب V2 (dispatch.js:361-365,1004). */
export function decisionSignatureError(
    signatureData: string | null | undefined,
    signerName: string | null | undefined,
): string {
    if (!String(signerName ?? '').trim()) {
        return DISPATCH_TEXT.signerMissing;
    }
    if (!String(signatureData ?? '').trim()) {
        return DISPATCH_TEXT.signNoInk;
    }
    return '';
}

/* ── رسائل النجاح/التأكيد/الخطأ ─────────────────────────────────────────── */

/** نص نجاح الإنشاء بحسب الدور (dispatch.js:719-721). */
export function createSuccessText(role: string | null | undefined): string {
    return role === 'dept_head' ? DISPATCH_TEXT.createSentChef : DISPATCH_TEXT.createSent;
}

/** نص نجاح التعديل بحسب `chefApprovalReset` من الخادم (dispatch.js:750-752). */
export function editSuccessText(chefApprovalReset: boolean): string {
    return chefApprovalReset ? DISPATCH_TEXT.editChefReset : DISPATCH_TEXT.editSuccess;
}

/** هل هذا حذف نهائي موثّق؟ (أدمن وحالة غير معلّقة — dispatch.js:1074). */
export function isFinalDelete(role: string | null | undefined, status: string): boolean {
    return role === 'admin' && status !== 'pending';
}

/** تأكيد الحذف بنصّي V2 (dispatch.js:1076-1077). */
export function deleteConfirmText(
    role: string | null | undefined,
    status: string,
    statusLabel?: string,
): string {
    if (isFinalDelete(role, status)) {
        const label = statusLabel ?? statusOf(status).label;
        return `⚠️ حذف نهائي لإذن صرف (${label})؟\nهذا مستند مالي موقّع — سيُحذف نهائيًا ويُوثّق باسمك في سجل مدير النظام.\nهل أنت متأكد؟`;
    }
    return DISPATCH_TEXT.deletePendingConfirm;
}

/** نص نجاح الحذف (dispatch.js:1083). */
export function deleteSuccessText(role: string | null | undefined, status: string): string {
    return isFinalDelete(role, status) ? DISPATCH_TEXT.deleteFinalSuccess : DISPATCH_TEXT.deletePendingSuccess;
}

/** نص نجاح اعتماد المخازن مع القيمة (dispatch.js:1193). */
export function approveSuccessText(totalValue: number): string {
    const amount = Number.isFinite(Number(totalValue)) ? String(Math.round(Number(totalValue) * 100) / 100) : '0';
    // نفس `moneyPlain` في القديم: المبلغ بلا رمز عملة إن لم تكن محددة.
    const formatted = amount.includes('.') ? amount : `${amount}.00`;
    return `${DISPATCH_TEXT.approveSuccessPrefix} ${formatted}`;
}

function codeOf(error: unknown): string {
    return error !== null && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : '';
}

/** خطأ الإنشاء: التكرار 409 DUPLICATE_DISPATCH له نص V2 الخاص (dispatch.js:725-728). */
export function createErrorText(error: unknown): string {
    const message = writeErrorMessage(error, '');
    if (codeOf(error) === 'DUPLICATE_DISPATCH' || /مكرر|مشابه|DUPLICATE/.test(message)) {
        return DISPATCH_TEXT.createDuplicate;
    }
    return message || DISPATCH_TEXT.createFailed;
}

/** خطأ الاعتماد: DISPATCH_APPROVE_IN_PROGRESS له نص V2 (dispatch.js:1198-1201). */
export function approveErrorText(error: unknown): string {
    if (codeOf(error) === 'DISPATCH_APPROVE_IN_PROGRESS') {
        return DISPATCH_TEXT.approveInProgress;
    }
    return writeErrorMessage(error, DISPATCH_TEXT.approveFailed);
}

/* ── بوابات HTTP الثماني — المسارات كما هي عند الخادم ───────────────────── */

const encoded = (id: string | number): string => encodeURIComponent(String(id));

/** 1) إنشاء طلب صرف — POST /api/dispatches (server.js:1892). */
export async function createDispatch(payload: CreateDispatchPayload): Promise<void> {
    await writeAck('/api/dispatches', 'POST', payload);
}

const editResponseSchema = z
    .object({
        chefApprovalReset: z.union([z.boolean(), z.string(), z.number()]).nullish(),
        deptChanged: z.union([z.boolean(), z.string(), z.number()]).nullish(),
    })
    .passthrough();

export interface EditDispatchResult {
    chefApprovalReset: boolean;
}

/** 2) تعديل قبل اعتماد المخازن — PUT /api/warehouse/dispatches/:id/edit (dispatch-routes.js:400). */
export async function editDispatch(
    id: string | number,
    payload: EditDispatchPayload,
): Promise<EditDispatchResult> {
    const body = await writeJson(
        editResponseSchema,
        `/api/warehouse/dispatches/${encoded(id)}/edit`,
        'PUT',
        payload,
    );
    return { chefApprovalReset: Boolean(body.chefApprovalReset) };
}

/** 3) حذف — DELETE /api/dispatches/:id (server.js:2747؛ النهائي للأدمن موثّق). */
export async function deleteDispatch(id: string | number): Promise<void> {
    await writeAck(`/api/dispatches/${encoded(id)}`, 'DELETE');
}

export interface ChefApproveBody extends SignedDecision {
    notes: string;
}

export interface ChefRejectBody extends SignedDecision {
    reason: string;
}

/** 4) اعتماد الشيف — POST /api/warehouse/dispatches/:id/chef-approve (dispatch-routes.js:295). */
export async function chefApproveDispatch(id: string | number, body: ChefApproveBody): Promise<void> {
    await writeAck(`/api/warehouse/dispatches/${encoded(id)}/chef-approve`, 'POST', {
        notes: String(body.notes ?? ''),
        signatureData: String(body.signatureData ?? ''),
        signerName: String(body.signerName ?? ''),
    });
}

/** 5) رفض الشيف — POST /api/warehouse/dispatches/:id/chef-reject (dispatch-routes.js:353). */
export async function chefRejectDispatch(id: string | number, body: ChefRejectBody): Promise<void> {
    await writeAck(`/api/warehouse/dispatches/${encoded(id)}/chef-reject`, 'POST', {
        reason: String(body.reason ?? ''),
        signatureData: String(body.signatureData ?? ''),
        signerName: String(body.signerName ?? ''),
    });
}

export interface ApproveBody extends SignedDecision {
    approvedItems: ApproveItemPayload[];
    approveNotes: string;
}

const approveResponseSchema = z
    .object({
        totalValue: z.union([z.number(), z.string()]).nullish(),
    })
    .passthrough();

export interface ApproveDispatchResult {
    totalValue: number;
}

/** 6) اعتماد المخازن — POST /api/warehouse/dispatches/:id/approve (dispatch-routes.js:80). */
export async function approveDispatch(id: string | number, body: ApproveBody): Promise<ApproveDispatchResult> {
    const response = await writeJson(
        approveResponseSchema,
        `/api/warehouse/dispatches/${encoded(id)}/approve`,
        'POST',
        {
            approvedItems: body.approvedItems,
            approveNotes: String(body.approveNotes ?? ''),
            signatureData: String(body.signatureData ?? ''),
            signerName: String(body.signerName ?? ''),
        },
    );
    return { totalValue: Number(response.totalValue) || 0 };
}

export interface RejectBody extends SignedDecision {
    reason: string;
}

/** 7) رفض المخازن — POST /api/warehouse/dispatches/:id/reject (dispatch-routes.js:507). */
export async function rejectDispatch(id: string | number, body: RejectBody): Promise<void> {
    await writeAck(`/api/warehouse/dispatches/${encoded(id)}/reject`, 'POST', {
        reason: String(body.reason ?? ''),
        signatureData: String(body.signatureData ?? ''),
        signerName: String(body.signerName ?? ''),
    });
}

export interface ReceiveBody extends SignedDecision {
    items: ReceivedItemPayload[];
    notes: string;
}

/** 8) استلام القسم — POST /api/warehouse/dispatches/:id/receive (dispatch-routes.js:548). */
export async function receiveDispatch(id: string | number, body: ReceiveBody): Promise<void> {
    await writeAck(`/api/warehouse/dispatches/${encoded(id)}/receive`, 'POST', {
        items: body.items,
        notes: String(body.notes ?? ''),
        signatureData: String(body.signatureData ?? ''),
        signerName: String(body.signerName ?? ''),
    });
}
