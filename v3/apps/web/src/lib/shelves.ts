import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { writeAck } from './write';

/**
 * الرفوف — قراءة فقط من `GET /api/shelves` و`GET /api/inventory` بنفس عقد
 * القديم (`shelves-repo.js`): مشي صفحات `?page&limit=1000&sort=id&order=desc`
 * ثم `{data, pagination}`.
 *
 * `icon` المخزَّن **لا يدخل العقد أصلًا**: القديم كان يخزّن فيه وسوم HTML،
 * وعرضه باب XSS. القيمة تبقى في القاعدة ولا تُقرأ هنا.
 *
 * القيمة (كمية × متوسط التكلفة) لا تُعرض بلا عملة المطعم؛ الشاشة تجلب
 * العملة من `settings/main_settings` كما تفعل بقية شاشات v3 المالية.
 */

const shelfSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform((value) => String(value)),
        name: z.string().nullable().optional(),
        code: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        capacity: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

export type Shelf = z.infer<typeof shelfSchema>;

const shelfPageSchema = z.union([
    z.array(shelfSchema),
    z
        .object({
            data: z.array(shelfSchema),
            pagination: z
                .object({
                    totalPages: z.number().optional(),
                })
                .passthrough()
                .optional(),
        })
        .passthrough(),
]);

const inventoryLiteSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        avgCost: z.union([z.string(), z.number()]).nullable().optional(),
        shelfId: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

export type InventoryLite = z.infer<typeof inventoryLiteSchema>;

const inventoryPageSchema = z
    .object({
        data: z.array(inventoryLiteSchema),
        pagination: z
            .object({
                totalPages: z.number().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const PAGE_SIZE = 1000;
const MAX_PAGES = 8;

export async function fetchShelves(signal?: AbortSignal): Promise<Shelf[]> {
    const rows: Shelf[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            shelfPageSchema,
            `/api/shelves?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        const totalPages = Array.isArray(body) ? 0 : (body.pagination?.totalPages ?? 0);
        if (batch.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

/** الأصناف تُقرأ لتُعدّ فقط — لا كتابة من هذه الشاشة. */
export async function fetchShelfInventory(signal?: AbortSignal): Promise<InventoryLite[]> {
    const rows: InventoryLite[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            inventoryPageSchema,
            `/api/inventory?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body.data);
        const totalPages = body.pagination?.totalPages ?? 0;
        if (body.data.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

const INT_FORMAT = new Intl.NumberFormat('en-US');
const QTY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function formatInt(value: number): string {
    return INT_FORMAT.format(Math.round(Number(value) || 0));
}

export function formatQty(value: number): string {
    return QTY_FORMAT.format(Number.isFinite(value) ? value : 0);
}

export interface ShelfItemStats {
    count: number;
    qty: number;
    value: number;
    rows: InventoryLite[];
}

/** تجميع أصناف رفٍ واحد بلا مساس بسجلها — نفس `shelfItems` في القديم. */
export function shelfItems(shelfId: unknown, items: readonly InventoryLite[]): ShelfItemStats {
    const rows = items.filter((item) => String(item.shelfId ?? '') === String(shelfId ?? ''));
    return {
        count: rows.length,
        qty: rows.reduce((sum, item) => sum + num(item.qty), 0),
        value: rows.reduce((sum, item) => sum + num(item.qty) * num(item.avgCost), 0),
        rows,
    };
}

export interface ShelfStats {
    shelves: number;
    assignedItems: number;
    emptyShelves: number;
    occupancy: number;
}

export function shelfStats(shelves: readonly Shelf[], items: readonly InventoryLite[]): ShelfStats {
    const assignedItems = items.filter((item) => item.shelfId !== null && item.shelfId !== undefined && String(item.shelfId) !== '').length;
    const emptyShelves = shelves.filter((shelf) => !items.some((item) => String(item.shelfId ?? '') === shelf.id)).length;
    return {
        shelves: shelves.length,
        assignedItems,
        emptyShelves,
        occupancy: items.length > 0 ? (assignedItems / items.length) * 100 : 0,
    };
}

/** بحث القديم حرفي (اسم/كود/موقع، تجاهل حالة الأحرف) — بلا تطبيع عربي. */
export function filterShelves(shelves: readonly Shelf[], query: string): Shelf[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...shelves];
    }
    return shelves.filter((shelf) =>
        [shelf.name, shelf.code, shelf.location].some((value) =>
            String(value ?? '')
                .toLowerCase()
                .includes(needle),
        ),
    );
}

export function shelfCapacity(shelf: Shelf): number | null {
    if (shelf.capacity === null || shelf.capacity === undefined || shelf.capacity === '') {
        return null;
    }
    return num(shelf.capacity);
}

/* ───────────────────────────────────────────────────────────────────────────
 * الكتابة — تكافؤ إضافة/تعديل/حذف الرفوف مع V2 (`data/shelves-repo.js`)
 *
 *   GET    /api/shelves?page&limit&sort&order  → {data[], pagination} (قراءة أعلاه)
 *   POST   /api/shelves                        → CRUD عام، أدوار الكتابة
 *          OPEN_ENTITY_WRITE_ROLES.shelves = admin|manager|warehouse
 *          writable = name, code, location, capacity, icon · required = name
 *   PUT    /api/shelves/:id                    → تحديث جزئي
 *   DELETE /api/shelves/:id                    → حذف عام؛ `inventory.shelfId`
 *          هو ON DELETE SET NULL فتُزال التعيينات ولا تُحذف الأصناف
 *
 * رسائل التحقق والتأكيد والنجاح منقولة حرفيًّا من الشاشة القديمة
 * (`v2/screens/shelves.js` + `data/shelves-repo.js`) — لا صياغة جديدة.
 * ─────────────────────────────────────────────────────────────────────────── */

/** أدوار الكتابة حرفيًّا من `schema-registry.js` (OPEN_ENTITY_WRITE_ROLES.shelves). */
export const SHELF_WRITE_ROLES = ['admin', 'manager', 'warehouse'] as const;

export interface ShelfForm {
    name: string;
    code: string;
    location: string;
    capacity: string;
}

export type ShelfField = 'name' | 'code' | 'location' | 'capacity';

export interface ShelfFormError {
    field: ShelfField;
    message: string;
}

export const SHELF_TEXT = {
    nameRequired: 'حقول مطلوبة ناقصة: name',
    nameTooLong: 'الحقل "name" أطول من المسموح (الحد الأقصى 255 حرفًا)',
    codeRequired: 'الكود مطلوب — معرّف الرف كما في الشاشة القديمة',
    codeTooLong: 'الحقل "code" أطول من المسموح (الحد الأقصى 50 حرفًا)',
    locationTooLong: 'الحقل "location" أطول من المسموح (الحد الأقصى 255 حرفًا)',
    capacityInvalid: 'الحقل "capacity" يجب أن يكون رقمًا',
    duplicateCode: 'الكود موجود بالفعل',
    saveFailed: 'تعذّر حفظ الرف',
    deleteFailed: 'تعذّر حذف الرف',
    save: 'حفظ',
    cancel: 'إلغاء',
    addTitle: 'إضافة رف',
    editTitle: 'تعديل الرف',
} as const;

/** نموذج فارغ بقيمة السعة الافتراضية نفسها (50 في V2). */
export function emptyShelfForm(): ShelfForm {
    return { name: '', code: '', location: '', capacity: '50' };
}

export function shelfToForm(shelf: Shelf): ShelfForm {
    return {
        name: String(shelf.name ?? ''),
        code: String(shelf.code ?? ''),
        location: String(shelf.location ?? ''),
        capacity: shelfCapacity(shelf) === null ? '50' : String(shelfCapacity(shelf)),
    };
}

/** نفس قواعد V2 ورسائلها: الاسم والكود مطلوبان، والحدود من الخادم. */
export function validateShelfForm(form: Partial<ShelfForm>): ShelfFormError[] {
    const errors: ShelfFormError[] = [];
    const name = String(form.name ?? '').trim();
    const code = String(form.code ?? '').trim();
    const location = String(form.location ?? '').trim();
    if (!name) {
        errors.push({ field: 'name', message: SHELF_TEXT.nameRequired });
    } else if (name.length > 255) {
        errors.push({ field: 'name', message: SHELF_TEXT.nameTooLong });
    }
    if (!code) {
        errors.push({ field: 'code', message: SHELF_TEXT.codeRequired });
    } else if (code.length > 50) {
        errors.push({ field: 'code', message: SHELF_TEXT.codeTooLong });
    }
    if (location.length > 255) {
        errors.push({ field: 'location', message: SHELF_TEXT.locationTooLong });
    }
    const capacityRaw = form.capacity;
    if (capacityRaw !== '' && capacityRaw !== null && capacityRaw !== undefined) {
        const capacity = Number(capacityRaw);
        if (!Number.isFinite(capacity) || capacity < 0) {
            errors.push({ field: 'capacity', message: SHELF_TEXT.capacityInvalid });
        }
    }
    return errors;
}

/** حارس تكرار الكود في الشاشة (الخادم لا يمنعه) — نفس `duplicate` في V2. */
export function shelfCodeExists(shelves: readonly Shelf[], code: string, ignoreId?: string): boolean {
    const needle = String(code ?? '')
        .trim()
        .toUpperCase();
    if (!needle) {
        return false;
    }
    return shelves.some(
        (shelf) =>
            String(shelf.code ?? '')
                .trim()
                .toUpperCase() === needle && String(shelf.id) !== String(ignoreId ?? ''),
    );
}

/** Body = قائمة السماح في الخادم فقط؛ `id` محميّ ولا يُرسل (كما في V2). */
export function normalizeShelfForm(form: Partial<ShelfForm>): {
    name: string;
    code: string;
    location: string | null;
    capacity: number;
    icon: string;
} {
    const capacityRaw = form.capacity;
    const capacity = capacityRaw === '' || capacityRaw === null || capacityRaw === undefined ? 50 : Number(capacityRaw);
    return {
        name: String(form.name ?? '').trim(),
        code: String(form.code ?? '')
            .trim()
            .toUpperCase(),
        location: String(form.location ?? '').trim() || null,
        capacity: Number.isFinite(capacity) ? capacity : 50,
        // يُخزَّن كما يخزّنه القديم؛ V2 لا يعرض هذا الوسم أبدًا.
        icon: '<i class=ji data-i=archive></i>',
    };
}

export async function createShelf(form: Partial<ShelfForm>): Promise<void> {
    await writeAck('/api/shelves', 'POST', normalizeShelfForm(form));
}

/** `code` معرّف ثابت — التحديث لا يحمله أبدًا (تكافؤ V2). */
export async function updateShelf(id: string, form: Partial<ShelfForm>): Promise<void> {
    const payload = normalizeShelfForm(form);
    await writeAck(`/api/shelves/${encodeURIComponent(id)}`, 'PUT', {
        name: payload.name,
        location: payload.location,
        capacity: payload.capacity,
    });
}

export async function deleteShelf(id: string): Promise<void> {
    await writeAck(`/api/shelves/${encodeURIComponent(id)}`, 'DELETE');
}

export function addShelfSuccess(name: string): string {
    return `تمت إضافة الرف «${String(name ?? '').trim()}»`;
}

export function updateShelfSuccess(name: string): string {
    return `تم تحديث الرف «${String(name ?? '').trim()}»`;
}

export function deleteShelfSuccess(name: string): string {
    return `تم حذف الرف «${String(name ?? '').trim()}»`;
}

/** نصّ تأكيد الحذف حرفيًّا من V2 — يذكر العدد وأن الأصناف لا تُحذف. */
export function deleteShelfConfirm(name: string, itemCount: number): string {
    return `حذف الرف «${String(name ?? '').trim()}»؟ ستُزال تعيينات أصنافه (${formatInt(itemCount)} صنفًا) ولن تُحذف الأصناف نفسها.`;
}
