import { z } from 'zod';
import { formatInt, formatMoney } from './format';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة فواتير الشراء — الأبواب الستة المنقولة حرفيًّا من V2:
 *
 *  1) إنشاء       POST `/warehouse/purchase-invoices`
 *     `data/purchase-invoices-write-repo.js:148-153` + ` invoice-editor.js:665-667`
 *     الأدوار: `INVOICE_CREATE_ROLES` = admin|manager|warehouse
 *     (الخادم: `backend/warehouse-routes.js` requireRole نفس القائمة).
 *  2) تعديل       PUT  `/warehouse/purchase-invoices/:id`
 *     `data/purchase-invoices-write-repo.js:155-164` — معرّف موجب، وإلا
 *     `'معرف الفاتورة غير صحيح'` (حرفيًّا).
 *  3) إلغاء void  POST `/warehouse/purchase-invoices/:id/void`
 *     `data/purchase-invoices-write-repo.js:166-179` + `screens/invoices.js:224-252`
 *     — أدمن فقط، ويعيد `invoiceNumber/reversedItems/deletedPayments`
 *     (`backend/warehouse/purchase-void-routes.js:264`).
 *  4) حذف الكل    POST `/warehouse/purchase-invoices/clear-all`
 *     `data/purchase-invoices-write-repo.js:181-186` + `screens/invoices.js:286-311`
 *     — أدمن فقط، وجسم الطلب يحمل العبارة الحرفية `CLEAR_ALL_CONFIRM`
 *     (`backend/warehouse/purchase-void-routes.js:407`)، ويعيد
 *     `deletedInvoices/reversedLedgerRows` (`:454`).
 *  5) تسديد كامل  POST `/procurement/invoices/:id/pay` جسم `{method:'cash'}`
 *     `data/procurement-repo.js:305-309` + `screens/wh-invoices.js:293-311`.
 *  6) دفعة جزئية  POST `/procurement/payments`
 *     `data/procurement-repo.js:316-328` + `screens/invoices.js:329-386`.
 *     الأدوار: `PAYMENT_WRITE_ROLES` = admin|manager|accountant
 *     (`backend/procurement-routes.js:27`).
 *
 * الحقول والتحقق والرسائل منقولة حرفيًّا من:
 *  • `data/purchase-invoices-write-repo.js` (حمولة `purchaseInvoicePayload`،
 *    `invoiceFormFromRow`، `invoiceItemsFromRow`، رسائل المعرّف المرفوض).
 *  • `invoice-editor.js` (ترتيب تحقق `save()` ونصوصه، العنوان، زر الحفظ،
 *    `PAID_ITEMS_ONLY_NOTICE`، البحث عن التكرار، وبصمة رقم الفاتورة البديل).
 *  • `data/expiry-policy.js` (سياسة تاريخ الصلاحية: الغياب مقبول، والصيغة
 *    الفاسدة فقط مرفوضة بنص V2 نفسه).
 *
 * لا `force` ولا إعادة محاولة ولا حساب من العميل: الخادم هو الحاكم في
 * الأدوار والأرصدة وعبارة التأكيد (كما تذكر رؤوس ملفات V2).
 */

/* ── الأدوار — قوائم V2/الخادم حرفيًّا ─────────────────────────────────── */

/** إنشاء/تعديل — `INVOICE_CREATE_ROLES` (purchase-invoices-write-repo.js:39). */
export const INVOICE_CREATE_ROLES = ['admin', 'manager', 'warehouse'] as const;
/** الإلغاء والحذف الجماعي — `INVOICE_VOID_ROLES` (purchase-invoices-write-repo.js:167). */
export const INVOICE_VOID_ROLES = ['admin'] as const;
/** التسديد الكامل والجزئي — `PAYMENT_WRITE_ROLES` (procurement-repo.js:111). */
export const PAYMENT_WRITE_ROLES = ['admin', 'manager', 'accountant'] as const;

export function invoiceCreateVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INVOICE_CREATE_ROLES);
}

export function invoiceVoidVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, INVOICE_VOID_ROLES);
}

export function invoicePaymentVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, PAYMENT_WRITE_ROLES);
}

/* ── ثوابت النموذج — نفس قوائم V2 ───────────────────────────────────────── */

/** فئات الضريبة الأربع (purchase-invoices-write-repo.js:41 + invoice-editor.js:40-45). */
export const TAX_CATEGORIES = ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_LABELS: Record<TaxCategory, string> = {
    STANDARD: 'خاضع 15%',
    ZERO_RATED: 'صفري 0%',
    EXEMPT: 'معفى',
    OUT_OF_SCOPE: 'خارج النطاق',
};

/** اقتراحات وحدة الصنف — نفس قائمة `invoice-editor.js:39`. */
export const UNIT_OPTIONS = ['وحدة', 'كجم', 'كيلوجرام', 'جرام', 'شوال', 'كيس', 'علبة', 'كرتون', 'عبوة', 'لتر'] as const;

/** نصوص طريقة دفع الفاتورة — `invoice-editor.js:218-224` حرفيًّا. */
export const INVOICE_PAYMENT_METHOD_OPTIONS = [
    { value: 'cash', label: 'نقدي (مسدد)' },
    { value: 'bank', label: 'تحويل بنكي (مسدد)' },
    { value: 'credit', label: 'آجل (غير مسدد)' },
    { value: 'card', label: 'بطاقة' },
    { value: 'cheque', label: 'شيك' },
] as const;

/** نصوص طريقة الدفع في نموذج الدفعة الجزئية — `screens/invoices.js:340-342`. */
export const PARTIAL_PAYMENT_METHOD_OPTIONS = [
    { value: 'cash', label: 'نقدي' },
    { value: 'bank', label: 'تحويل بنكي' },
    { value: 'card', label: 'بطاقة' },
    { value: 'cheque', label: 'شيك' },
] as const;

/** خيارات الخصم — `invoice-editor.js:202-206`. */
export const DISCOUNT_TYPE_OPTIONS = [
    { value: 'none', label: 'بدون خصم' },
    { value: 'percent', label: 'نسبة مئوية %' },
    { value: 'amount', label: 'مبلغ ثابت' },
] as const;

/** إشعار الفاتورة المدفوعة — قرار المالك 2026-10-31 (purchase-invoices-write-repo.js:44). */
export const PAID_ITEMS_ONLY_NOTICE = 'فاتورة مدفوعة — يمكن تعديل الأصناف فقط؛ الترويسة والدفعات ثابتة';

/** العبارة التي يشترطها الخادم في جسم `clear-all` (purchase-invoices-write-repo.js:168). */
export const CLEAR_ALL_CONFIRM = 'حذف كل الفواتير';

/* ── أدوات التحويل ──────────────────────────────────────────────────────── */

const num = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value).trim());

const r2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** مبلغ مالي معروض — العرض نصّي على المليم مثل `formatMoney` في V3. */
export function moneyWithUnit(value: string | number, currency = ''): string {
    const text = formatMoney(typeof value === 'number' ? value.toFixed(2) : String(value));
    return currency ? `${text} ${currency}` : text;
}

/** رقم فاتورة بديل حين يُترك الحقل فارغًا — نفس بصمة V2 (invoice-editor.js:664). */
export function invoiceNumberFallback(now = Date.now()): string {
    return `INV-${now.toString(36).toUpperCase()}`;
}

/* ── سياسة تاريخ الصلاحية (مرآة data/expiry-policy.js) ─────────────────── */

const EXPIRY_KEYS = ['expiryDate', 'expiry_date', 'bestBefore', 'best_before'] as const;

/** `YYYY-MM-DD` صحيحة تقويميًا أو `null` — حرفيًّا من expiry-policy.js:14-30. */
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

/** قراءة حقل الصلاحية من أي تسمية — نفس `readExpiryField` (expiry-policy.js:32-40). */
export function readExpiryField(source: unknown): unknown {
    if (!source || typeof source !== 'object') {
        return null;
    }
    const record = source as Record<string, unknown>;
    for (const key of EXPIRY_KEYS) {
        const value = record[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }
    return null;
}

export type ExpiryCheck = { ok: true } | { ok: false; message: string };

/** فحص أسطر الفاتورة — نفس `checkExpiryOnLines` (expiry-policy.js:46-62). */
export function checkExpiryOnLines(lines: readonly unknown[]): ExpiryCheck {
    const invalid: string[] = [];
    for (const line of lines) {
        const raw = readExpiryField(line);
        if (normalizeExpiryDate(raw)) {
            continue;
        }
        if (raw !== null) {
            const record = line && typeof line === 'object' ? (line as Record<string, unknown>) : {};
            invalid.push(String(record.itemName ?? record.name ?? ''));
        }
    }
    if (invalid.length > 0) {
        return {
            ok: false,
            message: `تاريخ الصلاحية غير صحيح للصنف ${invalid.slice(0, 5).join('، ')} — الصيغة المطلوبة YYYY-MM-DD`,
        };
    }
    return { ok: true };
}

/* ── النماذج ────────────────────────────────────────────────────────────── */

export interface InvoiceItemInput {
    itemId?: string | number | null;
    itemName?: string;
    qty?: string | number;
    price?: string | number;
    unit?: string | null;
    weight?: string | number | null;
    taxCategory?: string;
    packagingQty?: string | number | null;
    packagingUom?: string | null;
    expiryDate?: string | null;
}

export interface InvoiceForm {
    invoiceNumber?: string;
    date?: string;
    supplierId?: string | number | null;
    supplierName?: string;
    supplierPhone?: string;
    paymentMethod?: string;
    notes?: string;
    discountType?: string;
    discountValue?: string | number;
    paidAmount?: string | number;
    /** V2 يرسل `paidAmount` فقط بعد لمس المشغّل للحقل (invoice-editor.js:779-783). */
    paidTouched?: boolean;
    items?: InvoiceItemInput[];
}

/** نموذج فارغ — نفس بدايات `invoice-editor.js:107-111`. */
export function emptyInvoiceForm(date: string): InvoiceForm {
    return {
        invoiceNumber: '',
        date,
        supplierId: '',
        supplierName: '',
        supplierPhone: '',
        paymentMethod: 'cash',
        notes: '',
        discountType: 'none',
        discountValue: 0,
        paidAmount: 0,
        paidTouched: false,
        items: [],
    };
}

/** بند فارغ — نفس `newItem()` في invoice-editor.js:70-76. */
export function emptyInvoiceItem(): InvoiceItemInput {
    return {
        itemId: null,
        itemName: '',
        qty: 1,
        price: 0,
        unit: 'وحدة',
        weight: '',
        taxCategory: 'STANDARD',
        packagingQty: null,
        packagingUom: null,
        expiryDate: '',
    };
}

/** صفّ فاتورة → بنود قابلة للتحرير — نفس `invoiceItemsFromRow` حرفيًّا. */
export function invoiceItemsFromRow(invoice: Record<string, unknown>): InvoiceItemInput[] {
    let items = invoice.items;
    if (typeof items === 'string') {
        try {
            items = JSON.parse(items) as unknown;
        } catch {
            items = [];
        }
    }
    return (Array.isArray(items) ? items : []).map((raw) => {
        const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        return {
            itemId: (item.itemId ?? item.item_id ?? null) as string | number | null,
            itemName: String(item.itemName ?? item.name ?? ''),
            qty: num(item.qty),
            price: num(item.price),
            unit: String(item.unit ?? 'وحدة') || 'وحدة',
            weight: (item.weight ?? '') as string | number,
            taxCategory: String(item.taxCategory ?? item.tax_category ?? 'STANDARD'),
            packagingQty: (item.packagingQty ?? item.packaging_qty ?? null) as string | number | null,
            packagingUom: (item.packagingUom ?? item.packaging_uom ?? null) as string | null,
            expiryDate: normalizeExpiryDate(item.expiryDate ?? item.expiry_date) ?? '',
        };
    });
}

/** صفّ فاتورة → نموذج الترويسة — نفس `invoiceFormFromRow` حرفيًّا. */
export function invoiceFormFromRow(invoice: Record<string, unknown>): InvoiceForm {
    return {
        invoiceNumber: invoice.invoiceNumber ? String(invoice.invoiceNumber) : '',
        date: invoice.date ? String(invoice.date).slice(0, 10) : '',
        supplierId: (invoice.supplierId ?? '') as string | number,
        supplierName: invoice.supplierName ? String(invoice.supplierName) : '',
        supplierPhone: invoice.supplierPhone ? String(invoice.supplierPhone) : '',
        paymentMethod: invoice.paymentMethod ? String(invoice.paymentMethod) : 'cash',
        notes: invoice.notes ? String(invoice.notes) : '',
        discountType: String(invoice.discountType ?? invoice.discount_type ?? 'none'),
        discountValue: num(invoice.discountValue ?? invoice.discount_value),
        paidAmount: num(invoice.paidAmount),
        items: invoiceItemsFromRow(invoice),
    };
}

/* ── حمولة POST/PUT ─────────────────────────────────────────────────────── */

export interface PurchaseInvoicePayloadItem {
    itemId: string | number | null;
    itemName: string;
    qty: number;
    price: number;
    unit: string;
    weight: number;
    taxCategory: string;
    expiryDate: string | null;
    packagingQty?: number;
    packagingUom?: string | null;
}

export interface PurchaseInvoicePayload {
    invoiceNumber: string;
    date: string;
    supplierName: string;
    supplierPhone: string;
    supplierId: string | number | null;
    paymentMethod: string;
    notes: string;
    discountType: string;
    discountValue: number;
    items: PurchaseInvoicePayloadItem[];
    paidAmount?: number;
}

/**
 * نموذج → جسم POST/PUT — نفس `purchaseInvoicePayload` حرفيًّا:
 * البنود تُرشَّح (اسم + كمية > 0 + سعر ≥ 0)، والفئة غير المعروفة تصير
 * STANDARD، والصلاحية تُطبَّع، والحقول الاختيارية تُحذف بدل إرسالها فارغة.
 */
export function purchaseInvoicePayload(form: InvoiceForm = {}): PurchaseInvoicePayload {
    const items = (Array.isArray(form.items) ? form.items : [])
        .filter((item) => str(item?.itemName) && Number(item.qty) > 0 && Number(item.price) >= 0)
        .map((item) => {
            const tax = str(item.taxCategory).toUpperCase();
            const line: PurchaseInvoicePayloadItem = {
                itemId: item.itemId === undefined ? null : item.itemId,
                itemName: str(item.itemName),
                qty: num(item.qty),
                price: num(item.price),
                unit: str(item.unit) || 'وحدة',
                weight: item.weight === '' || item.weight === undefined || item.weight === null ? 0 : num(item.weight),
                taxCategory: (TAX_CATEGORIES as readonly string[]).includes(tax) ? tax : 'STANDARD',
                expiryDate: normalizeExpiryDate(readExpiryField(item)),
            };
            if (item.packagingQty !== undefined && item.packagingQty !== null && item.packagingQty !== '') {
                line.packagingQty = num(item.packagingQty);
                line.packagingUom = item.packagingUom ? String(item.packagingUom) : null;
            }
            return line;
        });
    const payload: PurchaseInvoicePayload = {
        invoiceNumber: str(form.invoiceNumber),
        date: str(form.date),
        supplierName: str(form.supplierName),
        supplierPhone: str(form.supplierPhone),
        supplierId: form.supplierId === undefined || form.supplierId === null || form.supplierId === '' ? null : form.supplierId,
        paymentMethod: str(form.paymentMethod) || 'cash',
        notes: str(form.notes),
        discountType: str(form.discountType) || 'none',
        discountValue: num(form.discountValue),
        items,
    };
    if (form.paidTouched && form.paidAmount !== '' && form.paidAmount !== undefined && form.paidAmount !== null) {
        payload.paidAmount = num(form.paidAmount);
    }
    return payload;
}

/* ── تحقق الحفظ — بنفس ترتيب ونصوص invoice-editor.js:630-659 ────────────── */

export function invoiceSaveError(form: InvoiceForm = {}): string {
    const rows = Array.isArray(form.items) ? form.items : [];
    const valid = rows.filter((item) => str(item?.itemName) && num(item.qty) > 0 && num(item.price) >= 0);
    if (valid.length === 0) {
        return 'أضف صنفًا واحدًا على الأقل';
    }
    const invalidLine = rows.some((item) => {
        if (!str(item?.itemName)) {
            return false;
        }
        const qty = Number(item.qty);
        const price = Number(item.price);
        return !Number.isFinite(qty) || !Number.isFinite(price) || qty < 0 || price < 0;
    });
    if (invalidLine) {
        return 'تحقق من إدخال كمية وسعر صحيحين لكل صنف';
    }
    const paidRaw = form.paidAmount;
    if (form.paidTouched && paidRaw !== '' && paidRaw !== undefined && paidRaw !== null) {
        const paid = Number(paidRaw);
        if (!Number.isFinite(paid) || paid < 0) {
            return 'أدخل مبلغ سداد صحيحًا أو اتركه فارغًا';
        }
    }
    const discountType = str(form.discountType) || 'none';
    const discountValue = num(form.discountValue);
    if (!Number.isFinite(discountValue) || discountValue < 0 || (discountType === 'percent' && discountValue > 100)) {
        return 'قيمة الخصم غير صحيحة';
    }
    const expiry = checkExpiryOnLines(valid);
    if (!expiry.ok) {
        return expiry.message;
    }
    return '';
}

/* ── تقدير الإجمالي للعرض — مرآة pcmtGrandEstimate (invoice-editor.js:368-390) ── */

export interface InvoiceEstimate {
    subtotal: number;
    discount: number;
    net: number;
    vat: number;
    grand: number;
    registered: boolean;
    selected: boolean;
}

/**
 * الإجمالي المتوقع (العميل يعرضه فقط؛ الخادم يعيد الحساب عند الحفظ).
 * ضريبة 15% على أسطر STANDARD فقط حين يكون المورد مسجلًا — نفس قرار V2.
 */
export function invoiceEstimate(form: InvoiceForm = {}, supplierRegistered = false): InvoiceEstimate {
    const rows = Array.isArray(form.items) ? form.items : [];
    const selected = form.supplierId !== undefined && form.supplierId !== null && form.supplierId !== '';
    const grossLines = rows.map((item) => r2(num(item.qty) * num(item.price)));
    const subtotal = r2(grossLines.reduce((sum, value) => sum + value, 0));
    const type = str(form.discountType) || 'none';
    const value = num(form.discountValue);
    let discount = 0;
    if (type === 'percent') {
        discount = r2((subtotal * Math.min(Math.max(value, 0), 100)) / 100);
    } else if (type === 'amount') {
        discount = Math.min(subtotal, r2(Math.max(value, 0)));
    }
    let allocated = 0;
    let net = 0;
    let vat = 0;
    grossLines.forEach((gross, index) => {
        const lineDiscount =
            index === grossLines.length - 1 ? r2(discount - allocated) : subtotal > 0 ? r2((discount * gross) / subtotal) : 0;
        allocated = r2(allocated + lineDiscount);
        const lineNet = r2(gross - lineDiscount);
        net = r2(net + lineNet);
        const category = str(rows[index]?.taxCategory || 'STANDARD').toUpperCase();
        const rate = supplierRegistered && category === 'STANDARD' ? 15 : 0;
        vat = r2(vat + r2((lineNet * rate) / 100));
    });
    return { subtotal, discount, net, vat, grand: r2(net + vat), registered: supplierRegistered, selected };
}

/* ── نصوص V2 الحرفية ────────────────────────────────────────────────────── */

export const INVOICE_TEXT = {
    /** عنوان النافذة في الوضعين — invoice-editor.js:137 */
    dialogTitle: 'فاتورة مشتريات جديدة',
    /** زر فتح المحرر — wh-invoices.js:119 */
    createAction: 'فاتورة شراء جديدة',
    saveNew: 'حفظ الفاتورة',
    saveEdit: 'حفظ التعديلات',
    cancel: 'إلغاء',
    close: 'إغلاق',
    addItem: 'إضافة صنف',
    itemsEmpty: 'أضف صنفاً بالنقر على زر "إضافة صنف"',
    saving: 'جارٍ حفظ الفاتورة... انتظر',
    duplicateInvoice: 'الفاتورة مسجلة بالفعل — لم تتكرر',
    saveFailedPrefix: 'تعذر الحفظ: ',
    saveFailed: 'تعذر حفظ فاتورة الشراء',
    edit: 'تعديل',
    payFull: 'تسديد الكل',
    payPartial: 'جزئي',
    voidAction: 'حذف',
    payFailedPrefix: 'فشل التسديد: ',
    partialFailed: 'فشل تسجيل الدفعة',
    savePartial: 'حفظ الدفعة',
    partialTitle: 'دفعة جزئية',
    remainingLabel: 'المتبقي',
    amountLabel: 'المبلغ',
    methodLabel: 'طريقة الدفع',
    dateLabel: 'التاريخ',
    notesLabel: 'ملاحظات',
    voidPaymentGuide: ' — افتح «المشتريات › المدفوعات» واعكس الدفعة يدويًا ثم أعد الإلغاء',
    voidFailedFallback: 'تعذر حذف الفاتورة',
    clearAllFailedFallback: 'تعذر حذف الفواتير',
    clearAllUnchecked: 'فعّل مربع التأكيد أولًا.',
    clearAllDescription:
        'حذف كل فواتير الشراء نهائي ولا يمكن التراجع: تُعكس كمياتها من المخزون، وتُحذف حركات المخزون المرتبطة بها، وتُبطَّل قيودها المحاسبية. خذ نسخة احتياطية أولًا.',
    clearAllCheck: 'أفهم أن هذه العملية نهائية وتعكس كميات المخزون',
    clearAllAction: 'حذف كل الفواتير نهائيًا',
    clearAllTitle: 'منطقة الخطر',
    clearAllBadge: 'إلغاء نهائي',
} as const;

/** تأكيد التسديد الكامل — wh-invoices.js:298 / invoices.js:206 حرفيًّا. */
export function payFullConfirm(number: string, amount: string): string {
    return `تسديد كامل للفاتورة ${number} — ${amount} نقدًا؟`;
}

/** نجاح التسديد الكامل — wh-invoices.js:303 / invoices.js:211. */
export function payFullSuccess(number: string, amount: string): string {
    return `تم تسديد الفاتورة ${number} (${amount})`;
}

/** تأكيد الدفعة الجزئية — invoices.js:367. */
export function payPartialConfirm(shown: string, number: string): string {
    return `تسجيل دفعة ${shown} على الفاتورة ${number}؟`;
}

/** نجاح الدفعة الجزئية مع رصيد المورد إن أعاده الخادم — invoices.js:374-377. */
export function payPartialSuccess(shown: string, number: string, supplierDue?: string | null): string {
    const due = supplierDue ? ` — رصيد المورد الآن ${supplierDue}` : '';
    return `تم تسجيل دفعة ${shown} على الفاتورة ${number}${due}`;
}

/**
 * تأكيد الإلغاء — invoices.js:228-232 حرفيًّا، بما فيه سطر المسدد الشرطي
 * عند وجود مبلغ مسدد.
 */
export function voidConfirm(number: string, total: string, paidAmount = ''): string {
    const paid = paidAmount ? `\nعليها مبلغ مسدد ${paidAmount} — إن كانت دفعة تلقائية ستُعكس مع الإلغاء.` : '';
    return `حذف فاتورة الشراء ${number} (${total})؟\nسيُعكس أثرها على المخزون تلقائيًا.${paid}`;
}

/** نجاح الإلغاء — invoices.js:237-240: العدد المعكوس والدفعات التلقائية إن وُجدت. */
export function voidSuccess(invoiceNumber: string, reversedItems: number, deletedPayments = 0): string {
    const auto = deletedPayments > 0 ? ` وعُكست ${formatInt(deletedPayments)} دفعة تلقائية مرتبطة` : '';
    return `حُذفت الفاتورة ${invoiceNumber} وعُكس مخزون ${formatInt(reversedItems)} صنفًا${auto}`;
}

/** تأكيد الحذف الجماعي — invoices.js:295. */
export function clearAllConfirm(count: number): string {
    return `حذف كل فواتير الشراء (${formatInt(count)}) نهائيًا؟\nستُعكس كمياتها من المخزون ولا يمكن التراجع.`;
}

/** نجاح الحذف الجماعي — invoices.js:301. */
export function clearAllSuccess(deletedInvoices: number, reversedLedgerRows: number): string {
    return `تم حذف ${formatInt(deletedInvoices)} فاتورة وعكس ${formatInt(reversedLedgerRows)} قيد مخزون`;
}

/** حارس تكرار الفاتورة — purchase-invoices-write-repo.js:143-146 حرفيًّا. */
export function isDuplicateInvoiceError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const candidate = error as { code?: unknown; message?: unknown };
    return candidate.code === 'DUPLICATE_INVOICE' || /مكرر|مشابهة|DUPLICATE/.test(String(candidate.message ?? ''));
}

/** رفض الإلغاء بسبب دفعات يدوية — نفس فحص invoices.js:245-246. */
export function isVoidPaymentError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    return /يدوية|دفعات موردين/.test(String((error as { message?: unknown }).message ?? ''));
}

/* ── تحقق الدفعة الجزئية — invoices.js:351-366 ─────────────────────────── */

export function partialPaymentError(amountRaw: unknown, remaining: string | number): string {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'أدخل مبلغًا أكبر من صفر';
    }
    const rem = typeof remaining === 'number' ? remaining : Number(remaining);
    if (Number.isFinite(rem) && amount > rem + 0.005) {
        return `المبلغ يتجاوز المتبقي (${formatMoney(rem.toFixed(2))})`;
    }
    return '';
}

/* ── بوابات HTTP الست ───────────────────────────────────────────────────── */

/** معرّف موجب أو نفس رسالة V2 حرفيًّا (purchase-invoices-write-repo.js:157-158). */
export function invoiceIdOf(id: string | number): number {
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        throw new Error('معرف الفاتورة غير صحيح');
    }
    return invoiceId;
}

/** POST /api/warehouse/purchase-invoices. */
export async function createPurchaseInvoice(form: InvoiceForm): Promise<void> {
    await writeAck('/api/warehouse/purchase-invoices', 'POST', purchaseInvoicePayload(form));
}

/** PUT /api/warehouse/purchase-invoices/:id. */
export async function updatePurchaseInvoice(id: string | number, form: InvoiceForm): Promise<void> {
    const invoiceId = invoiceIdOf(id);
    await writeAck(`/api/warehouse/purchase-invoices/${String(invoiceId)}`, 'PUT', purchaseInvoicePayload(form));
}

const voidResultSchema = z
    .object({
        invoiceNumber: z.union([z.string(), z.number()]).nullish(),
        reversedItems: z.union([z.number(), z.string()]).nullish(),
        deletedPayments: z.union([z.number(), z.string()]).nullish(),
    })
    .passthrough();

export interface VoidInvoiceResult {
    invoiceNumber: string;
    reversedItems: number;
    deletedPayments: number;
}

/** POST /api/warehouse/purchase-invoices/:id/void — أدمن فقط. */
export async function voidPurchaseInvoice(id: string | number): Promise<VoidInvoiceResult> {
    const invoiceId = invoiceIdOf(id);
    const body = await writeJson(voidResultSchema, `/api/warehouse/purchase-invoices/${String(invoiceId)}/void`, 'POST', {});
    return {
        invoiceNumber: body.invoiceNumber === null || body.invoiceNumber === undefined ? '' : String(body.invoiceNumber),
        reversedItems: num(body.reversedItems),
        deletedPayments: num(body.deletedPayments),
    };
}

const clearAllResultSchema = z
    .object({
        deletedInvoices: z.union([z.number(), z.string()]).nullish(),
        reversedLedgerRows: z.union([z.number(), z.string()]).nullish(),
    })
    .passthrough();

export interface ClearAllResult {
    deletedInvoices: number;
    reversedLedgerRows: number;
}

/** POST /api/warehouse/purchase-invoices/clear-all — أدمن فقط بالعبارة الحرفية. */
export async function clearAllPurchaseInvoices(): Promise<ClearAllResult> {
    const body = await writeJson(clearAllResultSchema, '/api/warehouse/purchase-invoices/clear-all', 'POST', {
        confirm: CLEAR_ALL_CONFIRM,
    });
    return {
        deletedInvoices: num(body.deletedInvoices),
        reversedLedgerRows: num(body.reversedLedgerRows),
    };
}

/** POST /api/procurement/invoices/:id/pay — تسديد كامل بالرصيد المتبقي. */
export async function payInvoiceFull(id: string | number, options: { method?: string } = {}): Promise<void> {
    const invoiceId = invoiceIdOf(id);
    await writeAck(`/api/procurement/invoices/${String(invoiceId)}/pay`, 'POST', {
        method: str(options.method) || 'cash',
    });
}

export interface PartialPaymentInput {
    supplierId: string | number;
    amount: string | number;
    method?: string;
    date?: string;
    notes?: string;
}

export interface PartialPaymentPayload {
    supplierId: number;
    amount: number;
    method: string;
    date: string;
    invoiceId: number;
    notes?: string;
}

/** جسم POST /procurement/payments — نفس ترتيب/شكل payInvoicePartial في V2. */
export function partialPaymentPayload(invoiceId: string | number, input: PartialPaymentInput): PartialPaymentPayload {
    const payload: PartialPaymentPayload = {
        supplierId: Number(input.supplierId),
        amount: Number(input.amount),
        method: str(input.method) || 'cash',
        date: str(input.date),
        invoiceId: Number(invoiceId),
    };
    const notes = str(input.notes);
    if (notes) {
        payload.notes = notes;
    }
    return payload;
}

const partialPaymentResultSchema = z.object({ supplierDueTotal: z.union([z.number(), z.string()]).nullish() }).passthrough();

/**
 * POST /api/procurement/payments — دفعة جزئية مربوطة بالفاتورة.
 * يعيد رصيد المورد إن أعاده الخادم (نصّ نجاح V2 يذيعه).
 */
export async function payInvoicePartial(invoiceId: string | number, input: PartialPaymentInput): Promise<number | null> {
    const body = await writeJson(partialPaymentResultSchema, '/api/procurement/payments', 'POST', partialPaymentPayload(invoiceId, input));
    return body.supplierDueTotal === null || body.supplierDueTotal === undefined ? null : Number(body.supplierDueTotal);
}
