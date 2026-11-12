import { z } from 'zod';
import { formatInt, formatQty } from './inventory-register';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة المخزون — الأبواب الأربعة (+ الدمج) منقولة حرفيًّا من
 * `frontend/app/js/v2/data/inventory-repo.js` (سطور W1-6) و
 * `frontend/app/js/v2/screens/warehouse.js` (القوالب والتأكيدات).
 *
 * كل شيء هنا منسوخ من الخادم، لا مُخترَع:
 *
 *  1) وارد سريع     POST   /api/warehouse/inventory/:id/receipt
 *     (backend/warehouse/returns-routes.js:287 — admin|manager|warehouse،
 *      qty>0، price>=0، وحدة الصنف، صلاحية اختيارية)
 *  2) تعديل مباشر   PUT    /api/warehouse/inventory/:id/direct
 *     (backend/warehouse/inventory-routes.js:745 — admin فقط، يرد `delta`)
 *  3) حذف عادي      DELETE /api/inventory/:id
 *     (backend/server.js:2868 + حارس الأرصدة :2917 — 409 INVENTORY_HAS_MOVEMENTS)
 *     حذف نهائي    DELETE /api/warehouse/inventory/:id/force
 *     (backend/warehouse/inventory-routes.js:688 — admin|warehouse)
 *  4) دمج المكرر    POST   /api/warehouse/inventory/merge
 *     (backend/warehouse/purchase-void-routes.js:11 — admin، يرد mergedCount/movedQty)
 *
 * الأدوار حرفيًّا من قوائم V2 (`inventory-repo.js:356-363`): لا `admin`
 * ضمنيًّا في أي قائمة، فزرٌّ لا يظهر لدورٍ لن يقبله الخادم.
 *
 * نصوص التحقق والنجاح والخطأ/التأكيد منقولة حرفيًّا من V2 — لا صياغة جديدة.
 * النماذج تعرض خطأ التحقق في مكانه (نمط `fail(form)` في V2) بدل توستٍ يضيع،
 * بينما نجاح العملية توست كما كان `notify` في القديم.
 */

/* ── أدوار الخادم حرفيًّا ───────────────────────────────────────────────── */

/** استلام/حذف عادي — `INV_WRITE_ROLES` في V2 (warehouse-routes.js:1584). */
export const INV_WRITE_ROLES = ['admin', 'manager', 'warehouse'] as const;
/** الحذف النهائي — أدمن ومخزن فقط، لا مدير (`inventory-routes.js:688`). */
export const INV_FORCE_ROLES = ['admin', 'warehouse'] as const;
/** التعديل المباشر — أدمن فقط (`inventory-routes.js:745`). */
export const INV_DIRECT_ROLES = ['admin'] as const;
/** دمج المكرر — أدمن فقط (`purchase-void-routes.js:11`). */
export const INV_MERGE_ROLES = ['admin'] as const;

/** بوابات الظهور بنفس قوائم الخادم — نفس أسماء V2. */
export function invWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INV_WRITE_ROLES);
}

export function invForceVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INV_FORCE_ROLES);
}

export function invDirectVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INV_DIRECT_ROLES);
}

export function invMergeVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INV_MERGE_ROLES);
}

/* ── نصوص V2 حرفيًّا ────────────────────────────────────────────────────── */

/** نفس رسائل `notify`/`panelMsg`/`confirmFn` في الشاشة القديمة. */
export const INVENTORY_TEXT = {
    /** warehouse.js:1300 — «أدخل كمية صحيحة» */
    quantityInvalid: 'أدخل كمية صحيحة',
    /** warehouse.js:1304 — الفراغ/السالب مرفوض معلنًا (لا تعبئة بآخر تكلفة) */
    priceInvalid: 'أدخل سعر الشراء — هنا لا يُملأ تلقائيًا بآخر تكلفة (السجل لا يحملها)، والفراغ يُرفض معلنًا',
    /** warehouse.js:1321 */
    receiptFailed: 'فشل تحديث المخزون في قاعدة البيانات',
    /** warehouse.js:1347 */
    directFailed: 'فشل التعديل المباشر',
    /** warehouse.js:1445 */
    mergeFailed: 'فشل الدمج',
    /** warehouse.js:1473 — بديل خطأ FK الخام */
    deleteFailed: 'فشل الحذف من قاعدة البيانات',
    /** warehouse.js:1472 — يُعرض عند رفض الحارس أو FK */
    deleteBlocked: 'لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر',
    /** warehouse.js:1461 */
    deleteSuccess: 'تم الحذف',
    /** warehouse.js:1468 */
    forceDeleteSuccess: 'تم الحذف النهائي مع الحركات',
    /** warehouse.js:1432 */
    mergePickKeep: 'اختر النسخة التي تبقى',
    /** warehouse.js:1220 */
    mergeNoDuplicates: 'ممتاز — لا توجد أصناف مكررة بالاسم نفسه حاليًا 👌',
    /** warehouse.js:1239-1241 */
    mergeIntro:
        'اختر النسخة التي تبقى في كل مجموعة ثم اضغط دمج — يتم نقل الرصيد والسجل التاريخي للمُبقي وحذف المكرر نهائيًا. لا تراجع بعد الدمج.',
    /** warehouse.js:1234 */
    mergeAction: 'دمج في الصنف المحدد',
    cancel: 'إلغاء',
} as const;

/* ── سياسة الصلاحية (مرآة backend/expiry-policy.js وV2) ──────────────────── */

/**
 * تحقق تقويمي لنفس الصيغة الوحيدة المقبولة YYYY-MM-DD.
 * مأخوذة من طبع `frontend/app/js/v2/data/expiry-policy.js:14-30` حرفيًّا:
 * الغياب مقبول، والصيغة الفاسدة تُرفض ولا يخترع تاريخًا.
 */
export function normalizeExpiryDate(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim().slice(0, 10));
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || month < 1 || month > 12) {
        return null;
    }
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

/* ── الباب 1: وارد سريع ─────────────────────────────────────────────────── */

export interface ReceiptPayload {
    qty: number;
    price: number;
    unit: string;
    expiryDate: string | null;
}

/**
 * حمولة الوارد — منسوخة من `receiptPayload` في V2:
 * `qty = Number(qtyRaw)||0`، والسعر `Number(priceRaw)||avgCost||0`.
 * سجل V3 لا يحمل `avgCost` (سقط في قائمة سماح السجل)، فالسعر الفارغ يصير 0
 * والشاشة ترفضه معلنًا قبل الإرسال — نفس قرار V2.
 */
export function receiptPayload(
    item: { unit?: string | null; avgCost?: string | number | null } = {},
    qtyRaw?: unknown,
    priceRaw?: unknown,
    expiryRaw?: unknown,
): ReceiptPayload {
    const qty = Number(qtyRaw) || 0;
    const parsedPrice = Number(priceRaw);
    const price = parsedPrice || Number(item.avgCost) || 0;
    return { qty, price, unit: String(item.unit || ''), expiryDate: normalizeExpiryDate(expiryRaw) };
}

/**
 * تحقق الوارد قبل الإرسال — نفس ترتيب ونصوص `submitReceipt` في V2
 * (كمية ← سعر ← صلاحية). يعيد '' حين يكون النموذج صالحًا.
 */
export function receiptError(itemName: string, qtyRaw: unknown, priceRaw: unknown, expiryRaw: unknown): string {
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) {
        return INVENTORY_TEXT.quantityInvalid;
    }
    const priceText = String(priceRaw ?? '').trim();
    const price = Number(priceText);
    if (priceText === '' || !Number.isFinite(price) || price < 0) {
        return INVENTORY_TEXT.priceInvalid;
    }
    const expiryText = String(expiryRaw ?? '').trim();
    if (expiryText && !normalizeExpiryDate(expiryText)) {
        return `تاريخ الصلاحية غير صحيح للصنف ${String(itemName || '')} — الصيغة المطلوبة YYYY-MM-DD`;
    }
    return '';
}

/** POST /warehouse/inventory/:id/receipt — نفس اسم وبوابة V2. */
export async function receiveInventoryItem(id: string | number, payload: ReceiptPayload): Promise<void> {
    await writeAck(`/api/warehouse/inventory/${encodeURIComponent(String(id))}/receipt`, 'POST', {
        qty: Number(payload?.qty) || 0,
        price: Number(payload?.price) || 0,
        unit: String(payload?.unit || ''),
        expiryDate: payload?.expiryDate || null,
    });
}

/* ── الباب 4: التعديل المباشر (أدمن فقط) ───────────────────────────────── */

/** نفس تحقق `directEditError` في V2 حرفيًّا. */
export function directEditError(qtyRaw: unknown, costRaw: unknown, reasonRaw: unknown): string {
    const qty = Number.parseFloat(String(qtyRaw));
    const cost = Number.parseFloat(String(costRaw));
    if (!Number.isFinite(qty) || qty < 0) {
        return 'اكتب كمية صحيحة ≥ صفر';
    }
    if (!Number.isFinite(cost) || cost < 0) {
        return 'اكتب تكلفة صحيحة ≥ صفر';
    }
    if (!String(reasonRaw ?? '').trim()) {
        return 'اكتب سبب التعديل — يُوثَّق في الدفتر';
    }
    return '';
}

export interface DirectEditPayload {
    qty: number;
    avgCost: number;
    reason: string;
}

/** نفس حمولة V2: {qty, avgCost, reason} — والخادم يقيد الفرق count_correction. */
export function directEditPayload(qtyRaw: unknown, costRaw: unknown, reasonRaw: unknown): DirectEditPayload {
    return {
        qty: Number.parseFloat(String(qtyRaw)),
        avgCost: Number.parseFloat(String(costRaw)),
        reason: String(reasonRaw ?? '').trim(),
    };
}

const directEditResultSchema = z.object({ delta: z.union([z.number(), z.string()]).nullish() }).passthrough();

export interface DirectEditResult {
    delta: number;
}

/** PUT /warehouse/inventory/:id/direct — يرد `delta` الذي يظهر في نص النجاح. */
export async function directEditInventoryItem(id: string | number, payload: DirectEditPayload): Promise<DirectEditResult> {
    const response = await writeJson(directEditResultSchema, `/api/warehouse/inventory/${encodeURIComponent(String(id))}/direct`, 'PUT', {
        qty: Number(payload?.qty),
        avgCost: Number(payload?.avgCost),
        reason: String(payload?.reason || '').trim(),
    });
    return { delta: Number(response.delta) || 0 };
}

/* ── الباب 3: حذف عادي + حذف نهائي ─────────────────────────────────────── */

/** DELETE /inventory/:id — الحارس العام يرد 409 INVENTORY_HAS_MOVEMENTS. */
export async function deleteInventoryItem(id: string | number): Promise<void> {
    await writeAck(`/api/inventory/${encodeURIComponent(String(id))}`, 'DELETE');
}

/** DELETE /warehouse/inventory/:id/force — مع كل الحركات والسجلات. */
export async function forceDeleteInventoryItem(id: string | number): Promise<void> {
    await writeAck(`/api/warehouse/inventory/${encodeURIComponent(String(id))}/force`, 'DELETE');
}

interface ErrorShape {
    code?: unknown;
    message?: unknown;
}

/** نفس فحص V2: الرمز أو نص الرسالة الذي يحمل «حركات مخزون». */
export function hasMovementsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const candidate = error as ErrorShape;
    return candidate.code === 'INVENTORY_HAS_MOVEMENTS' || /حركات مخزون/.test(String(candidate.message ?? ''));
}

/** بديل FK الخام في V2 (`/foreign key|23503/`) — يُعرض نص الحارس نفسه. */
export function isForeignKeyError(message: unknown): boolean {
    return /foreign key|23503/i.test(String(message ?? ''));
}

/* ── الباب 5: دمج المكرر (أدمن فقط) ────────────────────────────────────── */

export interface DuplicateCandidate {
    id: string | number;
    name: string;
    qty: number;
    unit?: string;
    minQty?: number | null;
}

export interface DuplicateGroup {
    key: string;
    items: DuplicateCandidate[];
    keepIdx: number;
}

/** مفتاح الكشف منسوخ حرفيًّا من V2 (warehouse.js:2199-2200). */
export function mergeItemKey(name: unknown): string {
    return String(name || '')
        .toLowerCase()
        .replace(/[\s\u00a0\t]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

/** مجموعات المكرر ونفس اقتراح V2: الأكبر رصيدًا يبقى. */
export function duplicateGroups(rows: readonly DuplicateCandidate[]): DuplicateGroup[] {
    const byKey = new Map<string, DuplicateCandidate[]>();
    for (const item of rows) {
        const key = mergeItemKey(item && item.name);
        if (!key) {
            continue;
        }
        const bucket = byKey.get(key);
        if (bucket) {
            bucket.push(item);
        } else {
            byKey.set(key, [item]);
        }
    }
    return [...byKey.values()]
        .filter((items) => items.length > 1)
        .map((items) => ({
            key: mergeItemKey(items[0]?.name),
            items,
            keepIdx: items.reduce((best, item, index) => (Number(item?.qty) > Number(items[best]?.qty) ? index : best), 0),
        }));
}

const mergeResultSchema = z
    .object({
        mergedCount: z.union([z.number(), z.string()]).nullish(),
        movedQty: z.union([z.number(), z.string()]).nullish(),
    })
    .passthrough();

export interface MergeResult {
    mergedCount: number;
    movedQty: number;
}

/** POST /warehouse/inventory/merge — يرد mergedCount/movedQty لنص النجاح. */
export async function mergeInventoryItems(keepId: string | number, dupIds: readonly (string | number)[]): Promise<MergeResult> {
    const response = await writeJson(mergeResultSchema, '/api/warehouse/inventory/merge', 'POST', {
        keepId: Number(keepId),
        dupIds: (Array.isArray(dupIds) ? dupIds : []).map(Number),
    });
    return { mergedCount: Number(response.mergedCount) || 0, movedQty: Number(response.movedQty) || 0 };
}

/* ── نصوص التأكيد والنجاح — حرفيًّا من V2 ──────────────────────────────── */

/** warehouse.js:1457 */
export function deleteConfirm(name: string): string {
    return `حذف الصنف "${String(name ?? '')}"؟`;
}

/** warehouse.js:1465 */
export function forceDeleteConfirm(name: string): string {
    return `"${String(name ?? '')}" له حركات مخزون.\nهل تريد الحذف النهائي مع كل حركاته وسجلاته؟ (لا يمكن التراجع)`;
}

/** warehouse.js:1338 — سطران فارغان قبل «سيُقيَّد...» كما في القديم. */
export function directEditConfirm(name: string, currentQty: number, newQty: unknown, newCost: unknown): string {
    const qty = Number.parseFloat(String(newQty));
    const cost = Number.parseFloat(String(newCost));
    return (
        `تعديل مباشر لـ "${String(name ?? '')}":\n` +
        `الكمية ${formatQty(currentQty)} → ${formatQty(qty)}\n` +
        `التكلفة الجديدة ${cost} (القديمة غير معروضة عمدًا — السجل لا يحملها)\n\n` +
        'سيُقيَّد الفرق في دفتر المخزون باسمك.'
    );
}

/** warehouse.js:1436 */
export function mergeConfirm(dupCount: number, names: string): string {
    return `تأكيد الدمج: سيُنقل رصيد ${dupCount} صنفًا مكررًا («${names}») إلى النسخة المبقية ويُحذف نهائيًا مع إعادة توجيه السجل التاريخي. متابعة؟`;
}

/** warehouse.js:1318 */
export function receiptSuccess(qty: number, unit: string, name: string): string {
    return `تم إضافة ${formatQty(qty)}${unit ? ` ${unit}` : ''} إلى ${String(name ?? '')}`;
}

/** warehouse.js:1344 */
export function directEditSuccess(delta: number, unit: string): string {
    return `تم التعديل المباشر — الفرق ${formatQty(Math.abs(Number(delta) || 0))}${unit ? ` ${unit}` : ''} قُيِّد في الدفتر`;
}

/** warehouse.js:1441 */
export function mergeSuccess(mergedCount: number, movedQty: number): string {
    return `تم الدمج: ${mergedCount} مكرر حُذف ونُقل رصيده (${formatQty(movedQty)})`;
}

/** warehouse.js:1213-1215 — نطاق فحص المكرر على النافذة المحمَّلة. */
export function mergeScopeNote(loaded: number, registerTotal: number, truncated: boolean): string {
    return truncated
        ? `الفحص على ${formatInt(loaded)} صنفًا محمّلًا من ${formatInt(registerTotal)} في السجل — مجموعات قد تكون خارج نافذة الجلب.`
        : `الفحص على السجل المحمّل (${formatInt(loaded)} صنفًا).`;
}
