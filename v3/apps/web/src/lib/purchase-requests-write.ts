import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة طلبات الشراء (النواقص) — العمليات السبع منقولة حرفيًّا من
 * `frontend/app/js/v2/data/pr-repo.js` (W1-3) و`frontend/app/js/v2/screens/wh-prs.js`
 * وبوابات الخادم في `backend/warehouse/pr-routes.js`:
 *
 *   إنشاء طلب                POST   /api/warehouse/purchase-requests
 *     (pr-routes.js:158 — admin|manager|warehouse|kitchen|sous_chef، وتوقيع
 *      الشيف إلزامي لدوري kitchen/sous_chef ويحسمه الخادم)
 *   توقيع الشيف              POST   /api/warehouse/purchase-requests/:id/chef-approve
 *     (pr-routes.js:230 — pending فقط، توقيع إلزامي)
 *   رفض الشيف                POST   /api/warehouse/purchase-requests/:id/chef-reject
 *     (pr-routes.js:263 — سبب ≥ 3 أحرف + توقيع)
 *   اعتماد المدير العام       POST   /api/warehouse/purchase-requests/:id/gm-approve
 *     (pr-routes.js:299 — بعد توقيع الشيف حصرًا، بتوقيع مختلف عنه)
 *   رفض المدير العام          POST   /api/warehouse/purchase-requests/:id/gm-reject
 *     (pr-routes.js:332 — سبب ≥ 3 أحرف + توقيع)
 *   إلغاء معلّق/موقّع شيف     POST   /api/warehouse/purchase-requests/:id/cancel
 *     (pr-routes.js:576 — جسم فارغ كما يرسل القديم :624)
 *   حذف نهائي                DELETE /api/warehouse/purchase-requests/:id
 *     (pr-routes.js:607 — admin|manager، والمعتمد/المستلم محمي)
 *
 * الأدوار قوائم الخادم نفسها (`purchase-void-routes.js:465-474`) بلا `admin`
 * ضمنيًّا — نفس قاعدة V2 (`pr-repo.js:63-73`). وبوابات الظهور شروط الشاشة
 * القديمة (`pr-repo.js:226-247`) التي تطابق الخادم، مع انحراف V2 المعلن:
 * «حذف نهائي» يختفي على الحالات الثلاث المحمية بخادمها
 * (approved/partially_fulfilled/fulfilled — pr-routes.js:614).
 *
 * الرسائل والتأكيدات والتحقق منقولة حرفيًّا من V2 (`screens/wh-prs.js:543-697`
 * و`data/pr-repo.js:300-330`) — لا صياغة جديدة.
 */

/* ── أدوار الخادم حرفيًّا (purchase-void-routes.js:465-474) ─────────────── */

/** إنشاء الطلب — pr-routes.js:158. */
export const PR_CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'] as const;
/** الإلغاء عند الخادم (يشمل dept_head) — pr-repo.js:65. */
export const PR_CANCEL_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;
/** قرار الشيف — pr-routes.js:230/263. */
export const PR_CHEF_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'] as const;
/** قرار المدير العام — pr-routes.js:299/332/607. */
export const PR_GM_ROLES = ['admin', 'manager'] as const;
/** المطبخ ينشئ طلبًا موقّعًا نهائيًّا — pr-routes.js:161. */
export const PR_CHEF_CREATE_ROLES = ['kitchen', 'sous_chef'] as const;
/** مجموعة زر الإلغاء في الواجهة — خمسة بلا dept_head (pr-repo.js:73). */
export const PR_CANCEL_UI_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'] as const;

/* ── بوابات الأزرار — شروط V2 (`pr-repo.js:226-247`) ───────────────────── */

export function prCanCreate(role: string | null | undefined): boolean {
    return isWriteRole(role, PR_CREATE_ROLES);
}

export function isChefCreator(role: string | null | undefined): boolean {
    return isWriteRole(role, PR_CHEF_CREATE_ROLES);
}

/** زرّا الشيف للمعلّق ولمن يملك الدور (pr-repo.js:229). */
export function chefActionsVisible(role: string | null | undefined, status: string | null | undefined): boolean {
    return status === 'pending' && isWriteRole(role, PR_CHEF_ROLES);
}

/** زرّا المدير العام للموقّع من الشيف ولمن يملك الدور (pr-repo.js:232). */
export function gmActionsVisible(role: string | null | undefined, status: string | null | undefined): boolean {
    return status === 'chef_approved' && isWriteRole(role, PR_GM_ROLES);
}

/** الإلغاء: معلّق لصانعي الطلب، وموقّع شيف لمجموعة الواجهة (pr-repo.js:235). */
export function cancelVisible(role: string | null | undefined, status: string | null | undefined): boolean {
    if (status === 'pending') {
        return isWriteRole(role, PR_CREATE_ROLES);
    }
    if (status === 'chef_approved') {
        return isWriteRole(role, PR_CANCEL_UI_ROLES);
    }
    return false;
}

/**
 * الحذف النهائي — الإدارة فقط، والحالات الثلاث المحمية تخفى بدل زر يفشل
 * حتمًا على الخادم (pr-repo.js:245).
 */
export function deleteVisible(role: string | null | undefined, status: string | null | undefined): boolean {
    return (
        isWriteRole(role, PR_GM_ROLES) &&
        !['approved', 'partially_fulfilled', 'fulfilled'].includes(String(status ?? ''))
    );
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

/** رسائل `notify`/`panelMsg`/`confirmFn` نفسها من wh-prs.js وpr-repo.js. */
export const PR_WRITE_TEXT = {
    createButton: 'طلب شراء جديد',
    createTitle: 'طلب شراء نواقص جديد',
    createSubmit: 'إنشاء الطلب',
    createSubmitChef: 'توقيع وإرسال للمخزن',
    chefApproveSubmit: 'توقيع وإحالة للمدير العام',
    gmApproveSubmit: 'اعتماد نهائي',
    rejectSubmit: 'تأكيد الرفض',
    close: 'إغلاق',
    cancelAction: 'إلغاء',
    /** pr-repo.js:302 — كلمة القديمة :528. */
    itemsRequired: 'اختر صنفًا واحدًا على الأقل بكمية موجبة',
    /** pr-repo.js:308 — نفسها في القديم :567,:600 والخادم :3330,:3397. */
    reasonRequired: 'سبب الرفض مطلوب (3 أحرف على الأقل)',
    reasonLabel: 'سبب الرفض',
    reasonPlaceholderChef: 'مثال: الكمية مبالغ فيها / الصنف متوفر ببديل',
    chefNotesLabel: 'ملاحظات الشيف (اختياري)',
    gmNotesLabel: 'ملاحظات المدير العام (اختياري)',
    notesLabel: 'ملاحظات الطلب (اختياري)',
    deptLabel: 'القسم الطالب (تُحسب عليه التكلفة عند التسليم المباشر)',
    /** wh-prs.js:545/:551/:554 */
    cancelConfirm: 'إلغاء طلب الشراء المعلّق؟',
    cancelSuccess: 'أُلغي طلب الشراء',
    cancelFailed: 'تعذر إلغاء الطلب',
    /** wh-prs.js:562/:568/:571 */
    deleteConfirm: 'حذف نهائي لهذا الطلب؟ لا يمكن التراجع.',
    deleteSuccess: 'حُذف الطلب نهائيًا',
    deleteFailed: 'تعذر حذف الطلب',
    /** wh-prs.js:617 — بديل panelMsg عند فشل الإنشاء. */
    createFailed: 'تعذر إنشاء طلب الشراء',
    /** wh-prs.js:512 — بوابة فتح اللوحات الموقّعة. */
    signerMissing: 'اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع',
    /** wh-prs.js:67 — نص SIGNER_NAME_MISSING عند قراءة اللوحة. */
    signerMissingForm: 'اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا',
    /** wh-prs.js:71 — بديل أخطاء قراءة التوقيع. */
    signatureFailed: 'تعذر قراءة التوقيع',
    signatureLockedHint: 'التوقيع مقفل باسم حسابك — لا يمكن توقيع أي اسم آخر.',
    noShortages: 'لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى) — أضف يدويًا بالأسفل',
} as const;

/** عناوين لوحات القرار — wh-prs.js:407/:417/:427/:438. */
export function prDecisionTitle(kind: PRDecisionKind): string {
    if (kind === 'chef-approve') {
        return 'توقيع الشيف';
    }
    if (kind === 'chef-reject') {
        return 'رفض الشيف';
    }
    if (kind === 'gm-approve') {
        return 'اعتماد المدير العام';
    }
    return 'رفض المدير العام';
}

/** أزرار الإرسال في لوحات القرار — wh-prs.js:413/:422/:434/:442. */
export function prDecisionSubmitLabel(kind: PRDecisionKind): string {
    if (kind === 'chef-approve') {
        return PR_WRITE_TEXT.chefApproveSubmit;
    }
    if (kind === 'gm-approve') {
        return PR_WRITE_TEXT.gmApproveSubmit;
    }
    return PR_WRITE_TEXT.rejectSubmit;
}

/** رسائل نجاح القرارات — wh-prs.js:632/:652/:670/:690. */
export function prDecisionSuccess(kind: PRDecisionKind): string {
    if (kind === 'chef-approve') {
        return 'وقّع الشيف — الطلب الآن بانتظار المدير العام';
    }
    if (kind === 'chef-reject') {
        return 'رفض الشيف الطلب';
    }
    if (kind === 'gm-approve') {
        return 'اعتمد المدير العام الطلب نهائيًا';
    }
    return 'رفض المدير العام الطلب';
}

/** بدائل أخطاء القرارات — wh-prs.js:617/:635/:655/:673/:693. */
export function prDecisionFailure(kind: PRDecisionKind): string {
    if (kind === 'chef-approve') {
        return 'تعذر توقيع الشيف';
    }
    if (kind === 'chef-reject' || kind === 'gm-reject') {
        return 'تعذر رفض الطلب';
    }
    return 'تعذر اعتماد المدير العام';
}

/** نجاح الإنشاء — wh-prs.js:612-614 (توقيع الشيف يجعل الطلب نهائيًّا). */
export function prCreateSuccess(requestNumber: string, chefSigned: boolean): string {
    return chefSigned
        ? `أُنشئ طلب الشراء ${requestNumber} موقّعًا منك — نهائي ولدى المخزن مباشرة`
        : `أُنشئ طلب الشراء ${requestNumber} — بانتظار توقيع الشيف`;
}

/** أنواع قرارات الطلب الأربعة. */
export type PRDecisionKind = 'chef-approve' | 'chef-reject' | 'gm-approve' | 'gm-reject';

/* ── تطبيع الاسم والتوقيع — مرآة الخادم (warehouse-routes.js:338-357) ──── */

/** تطبيع اسم الموقّع: تقليم + دمج المسافات — نفس `normalizeSignerName`. */
export function normalizeSignerName(value: unknown): string {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ');
}

/** اسم صاحب الحساب: name ثم username — نفس ترتيب الخادم. */
export function accountSignatureName(
    user: { name?: string | null; username?: string | null } | null | undefined,
): string {
    return normalizeSignerName(user?.name) || normalizeSignerName(user?.username);
}

const SIGNATURE_DATA_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** تحقق التوقيع بنفس قاعدة الخادم: PNG/JPEG base64 وبحد 250000 حرف. */
export function normalizeSignatureData(value: unknown): string | null {
    const signature = String(value ?? '').trim();
    if (!signature || signature.length > 250000 || !SIGNATURE_DATA_PATTERN.test(signature)) {
        return null;
    }
    return signature;
}

/* ── أصناف الطلب: التجمع والتحقق والحمولات (pr-repo.js:262-330) ────────── */

export interface PRItemInput {
    itemId: number | null;
    itemName: string;
    unit: string;
    requestedQty: number;
}

/** صف نقص مختار كما يرد من النموذج (قيم الإدخال خام). */
export interface PRShortageInput {
    itemId?: unknown;
    itemName?: unknown;
    unit?: unknown;
    qty?: unknown;
}

/** صف يدوي كما يرد من النموذج (قيم الإدخال خام). */
export interface PRManualInput {
    name?: unknown;
    unit?: unknown;
    qty?: unknown;
}

/** صف نقص → صنف الخادم (القديم :520). كمية غير صالحة تُسقط الصف. */
function shortageItemEntry(row: PRShortageInput = {}): PRItemInput | null {
    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
        return null;
    }
    return {
        itemId: Number(row.itemId) || null,
        itemName: String(row.itemName ?? ''),
        unit: String(row.unit ?? '').trim() || 'وحدة',
        requestedQty: qty,
    };
}

/** صف يدوي → صنف الخادم (القديم :526). بلا اسم أو كمية موجبة يُسقط الصف. */
function manualItemEntry(row: PRManualInput = {}): PRItemInput | null {
    const name = String(row.name ?? '').trim();
    const qty = Number(row.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) {
        return null;
    }
    return {
        itemId: null,
        itemName: name,
        unit: String(row.unit ?? '').trim() || 'وحدة',
        requestedQty: qty,
    };
}

/** أصناف الإنشاء: النواقص المختارة ثم اليدوية — ترتيب القديم :517-527. */
export function collectPRItems(
    shortageRows: readonly PRShortageInput[] = [],
    manualRows: readonly PRManualInput[] = [],
): PRItemInput[] {
    const items: PRItemInput[] = [];
    for (const row of Array.isArray(shortageRows) ? shortageRows : []) {
        const entry = shortageItemEntry(row);
        if (entry) {
            items.push(entry);
        }
    }
    for (const row of Array.isArray(manualRows) ? manualRows : []) {
        const entry = manualItemEntry(row);
        if (entry) {
            items.push(entry);
        }
    }
    return items;
}

/** تحقق الإنشاء — نص القديم :528 (وللخادم كلمته :171). */
export function prCreateError(items: readonly unknown[] = []): string {
    return items.length > 0 ? '' : PR_WRITE_TEXT.itemsRequired;
}

/** تحقق سبب الرفض — نفس رسالة القديم :567,:600 والخادم :267,:336. */
export function prReasonError(reason: unknown): string {
    return String(reason ?? '').trim().length >= 3 ? '' : PR_WRITE_TEXT.reasonRequired;
}

export interface PRCreatePayload {
    items: PRItemInput[];
    notes: string;
    deptCode: string;
    signatureData: string | null;
    signerName: string | null;
}

/** حمولة الإنشاء — حقول القديمة :537 (توقيع الشيف وحده، وإلا null). */
export function prCreatePayload({
    items = [],
    notes = '',
    deptCode = '',
    signatureData = null,
    signerName = null,
}: {
    items?: readonly PRItemInput[];
    notes?: unknown;
    deptCode?: unknown;
    signatureData?: string | null;
    signerName?: string | null;
} = {}): PRCreatePayload {
    return {
        items: Array.isArray(items) ? [...items] : [],
        notes: String(notes ?? '').trim(),
        deptCode: String(deptCode ?? ''),
        signatureData: signatureData ?? null,
        signerName: signerName ?? null,
    };
}

export interface PRNotesPayload {
    notes: string;
    signatureData: string | null;
    signerName: string | null;
}

/** حمولة قرار بملاحظات — chef-approve :554 وgm-approve :586. */
export function prNotesPayload(
    notes: unknown = '',
    signatureData: string | null = null,
    signerName: string | null = null,
): PRNotesPayload {
    return { notes: String(notes ?? '').trim(), signatureData, signerName };
}

export interface PRRejectPayload {
    reason: string;
    signatureData: string | null;
    signerName: string | null;
}

/** حمولة قرار برفض — chef-reject :571 وgm-reject :604. */
export function prRejectPayload(
    reason: unknown = '',
    signatureData: string | null = null,
    signerName: string | null = null,
): PRRejectPayload {
    return { reason: String(reason ?? '').trim(), signatureData, signerName };
}

/** فلتر أقسام «القسم الطالب» — شرط القديم :504 حرفيًّا. */
export function filterPRDeptOptions(
    rows: readonly { code?: unknown; name?: unknown; parentCode?: unknown }[] = [],
): { code: string; name: string; parentCode: string }[] {
    return rows
        .map((row) => ({
            code: String(row.code ?? ''),
            name: String(row.name ?? row.code ?? ''),
            parentCode: String(row.parentCode ?? ''),
        }))
        .filter(
            (row) =>
                !row.code.startsWith('ys_') &&
                row.code !== 'kitchen' &&
                row.code !== 'external_sales' &&
                row.parentCode !== 'kitchen',
        );
}

/* ── أبواب الكتابة السبعة ──────────────────────────────────────────────── */

/** مفاتيح السجل التي تُبطَل بعد كل كتابة — نفس `reload()` في V2 (:768-780). */
export const PR_INVALIDATE = [['purchase-requests']] as const;

const createdSchema = z.object({ request_number: z.string().nullable().optional() }).passthrough();

export interface PRCreated {
    requestNumber: string;
}

function prUrl(id: string | number, action?: string): string {
    const base = `/api/warehouse/purchase-requests/${encodeURIComponent(String(id))}`;
    return action ? `${base}/${action}` : base;
}

/** إنشاء طلب — POST /api/warehouse/purchase-requests (pr-routes.js:158). */
export async function createPR(payload: PRCreatePayload): Promise<PRCreated> {
    const created = await writeJson(createdSchema, '/api/warehouse/purchase-requests', 'POST', payload);
    return { requestNumber: created.request_number ? String(created.request_number) : '' };
}

/** توقيع الشيف — POST /:id/chef-approve (pr-routes.js:230). */
export async function chefApprovePR(id: string | number, payload: PRNotesPayload): Promise<void> {
    await writeAck(prUrl(id, 'chef-approve'), 'POST', payload);
}

/** رفض الشيف — POST /:id/chef-reject (pr-routes.js:263). */
export async function chefRejectPR(id: string | number, payload: PRRejectPayload): Promise<void> {
    await writeAck(prUrl(id, 'chef-reject'), 'POST', payload);
}

/** اعتماد المدير العام النهائي — POST /:id/gm-approve (pr-routes.js:299). */
export async function gmApprovePR(id: string | number, payload: PRNotesPayload): Promise<void> {
    await writeAck(prUrl(id, 'gm-approve'), 'POST', payload);
}

/** رفض المدير العام — POST /:id/gm-reject (pr-routes.js:332). */
export async function gmRejectPR(id: string | number, payload: PRRejectPayload): Promise<void> {
    await writeAck(prUrl(id, 'gm-reject'), 'POST', payload);
}

/** إلغاء معلّق/موقّع شيف — POST /:id/cancel بجسم فارغ كما يرسل القديم (:624). */
export async function cancelPR(id: string | number): Promise<void> {
    await writeAck(prUrl(id, 'cancel'), 'POST', {});
}

/** حذف نهائي — DELETE /:id (pr-routes.js:607، والمعتمد/المستلم محمي). */
export async function deletePR(id: string | number): Promise<void> {
    await writeAck(prUrl(id), 'DELETE');
}
