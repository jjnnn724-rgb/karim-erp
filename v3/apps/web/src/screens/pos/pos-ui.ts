/**
 * أدوات شاشة الكاشير — أدوار وأرقام وطباعة ورمز QR.
 *
 * المصدر الحرفي: `frontend/app/js/v2/screens/pos-entry.js` (قوائم الأدوار،
 * تنسيق المال، نافذة الطباعة، تحميل مولّد QR). كل ما هنا عرضٌ أو تحميل مورد،
 * ولا قرار مالي: الأرقام والضريبة من `pos-pricing` والخادم.
 */

import type { BuffetTier, PosProduct } from '../../lib/pos';

export const POS_ROLES = ['admin', 'manager', 'accountant', 'cashier'] as const;
/**
 * صلاحيات الكاشير — الكاشير يبيع ويعلّق ويسترجع فقط؛ المحاسب والمدير والمسؤول
 * يملكون الكاشير كاملًا (بيع، سجل الفواتير، إلغاء، تقفيل اليوم Z).
 */
export const SELL_ROLES = ['admin', 'manager', 'accountant', 'cashier'] as const;
export const HISTORY_ROLES = ['admin', 'manager', 'accountant'] as const;
export const VOID_ROLES = ['admin', 'manager', 'accountant'] as const;
export const CATALOG_IMAGE_ROLES = ['admin', 'manager'] as const;
export const DAY_CLOSE_ROLES = ['admin', 'manager', 'accountant'] as const;
export const BUFFET_ADMIN_ROLES = ['admin', 'manager', 'accountant'] as const;

export const PAYMENT_FIELDS = [
    { key: 'cash', label: 'نقدي' },
    { key: 'card', label: 'بطاقة' },
    { key: 'wallet', label: 'محفظة' },
    { key: 'bank_transfer', label: 'تحويل بنكي' },
] as const;

export type PaymentKey = (typeof PAYMENT_FIELDS)[number]['key'];

export function roleIn(role: string | null | undefined, allowed: readonly string[]): boolean {
    return allowed.includes(String(role ?? '').trim());
}

/** مبلغ للعرض: أرقام لاتينية وفاصلتان عشريتان — بلا وحدة عملة إن لم تُرسل. */
export function moneyText(value: number | string | null | undefined): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '0.00';
    }
    return parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** كمية: حتى ثلاث خانات كما يخزّنها `numeric(14,3)` بلا أصفار زائدة. */
export function qtyText(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return (Math.round(value * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function safeProductImageUrl(value: string | null | undefined, productId?: string | null): string {
    const url = String(value ?? '').trim();
    if (url.startsWith('/uploads/menu/')) {
        const id = String(productId ?? '').trim();
        if (!/^[0-9]+$/.test(id)) {
            return '';
        }
        // اسم الرفع يخص هذا الصنف فقط: product-<id>-<ts>-<hash>.<ext> — لا صورة صنف آخر أبدًا.
        const fileName = url.slice('/uploads/menu/'.length).split(/[?#]/)[0] ?? '';
        return new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(fileName) ? url : '';
    }
    return url.startsWith('/v3/img/') || /^https:\/\//i.test(url) ? url : '';
}

/** حالة الفاتورة → تسمية عربية (نفس خريطة القديم). */
export function orderStatusLabel(status: string | null | undefined): string {
    return (
        ({ issued: 'صادرة', reported: 'مبلّغ عنها', cancelled: 'ملغاة' } as Record<string, string>)[String(status ?? '')] ??
        (String(status ?? '') || 'غير محددة')
    );
}

export function paymentMethodLabel(method: string | null | undefined): string {
    return (
        ({ cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', bank_transfer: 'تحويل بنكي' } as Record<string, string>)[String(method ?? '')] ??
        (String(method ?? '') || '—')
    );
}

export function orderStatusTone(status: string | null | undefined): 'danger' | 'success' {
    return status === 'cancelled' ? 'danger' : 'success';
}

/** مفتاح منع تكرار الفاتورة — جلسة الوردية + عشوائي، كما في V2. */
export function newIdempotencyKey(sessionId: string): string {
    const random = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    return `v3-pos-${sessionId}-${random}`;
}

/* ─── كتالوج موحّد: أصناف الوصفات وفئات البوفيه في شكل عرض واحد ─────────── */

export interface CatalogItem {
    id: string;
    name: string;
    price: number;
    vatRate: number;
    unit: string;
    barcode: string;
    stock: number | null;
    imageUrl: string;
    /** الصورة المخزنة قد تكون مخفية؛ يبقى حذفها متاحًا للمخوّلين. */
    hasImage: boolean;
    category: string;
    tier: string;
    isBuffet: boolean;
    isCore: boolean;
    /** رمز Yara للصنف — به تُربط كميات البيع الحقيقية بالبطاقة. */
    yaraCode?: string;
}

export function catalogFromProducts(products: readonly PosProduct[]): CatalogItem[] {
    const active = products.filter((product) => Number.isInteger(Number(product.id)) && Number(product.id) > 0 && product.is_active !== false);
    const imageUses = new Map<string, number>();
    for (const product of active) {
        const url = String(product.image_url ?? '').trim();
        if (url) imageUses.set(url, (imageUses.get(url) ?? 0) + 1);
    }
    return active.map((product) => {
        const rawCode = product.metadata?.yara_code;
        const imageUrl = String(product.image_url ?? '').trim();
        return {
            id: String(product.id),
            name: String(product.name_ar || product.name_en || 'صنف'),
            price: Number.isFinite(product.price) ? product.price : 0,
            vatRate: Number.isFinite(product.vat_rate) ? product.vat_rate : 15,
            unit: String(product.unit ?? ''),
            barcode: String(product.barcode ?? ''),
            stock: product.stock_quantity,
            imageUrl: (imageUses.get(imageUrl) ?? 0) > 1 ? '' : safeProductImageUrl(imageUrl, String(product.id)),
            hasImage: Boolean(imageUrl),
            category: String(product.category ?? '').trim(),
            tier: '',
            isBuffet: false,
            isCore: false,
            yaraCode: typeof rawCode === 'string' ? rawCode.trim() : '',
        };
    });
}

/** فئات البوفيه تُباع «أفرادًا» — نفس تحويل `buffetTierProducts` في V2. */
export function catalogFromTiers(tiers: readonly BuffetTier[]): CatalogItem[] {
    return tiers
        .filter((tier) => tier.is_active !== false && Number.isInteger(Number(tier.id)) && Number(tier.id) > 0)
        .map((tier) => ({
            id: String(tier.id),
            name: String(tier.name_ar ?? '').trim() || 'فئة بوفيه',
            price: Number.isFinite(tier.price) ? tier.price : 0,
            vatRate: Number.isFinite(tier.vat_rate) ? tier.vat_rate : 15,
            unit: String(tier.unit ?? '').trim() || 'فرد',
            barcode: '',
            stock: null,
            imageUrl: '',
            hasImage: false,
            category: 'بوفيه',
            tier: String(tier.tier ?? ''),
            isBuffet: true,
            isCore: tier.is_core === true,
        }));
}

/** مفتاح السعر في واجهة البوفيه: الأساسيات بمفتاح ثابت، والمخصصة بمعرّفها. */
export function buffetPriceKey(tier: BuffetTier): string {
    return tier.is_core === true ? String(tier.tier ?? '') : `custom_${String(tier.id)}`;
}

/* ─── الترتيب الذكي للكتالوج: المفضلة ثم الأكثر مبيعًا ثم أبجديًا ──────────
   المبيعات تأتي من مرآة الكاشيريات مجمّعة برمز Yara (yara_code) لا بالاسم،
   فلا يتأثر الترتيب باختلاف الاسم بين الكاشير والنظام. */

export type SalesIndex = Readonly<Record<string, number>>;

export function soldQty(item: CatalogItem, sales?: SalesIndex): number {
    if (!item.yaraCode || !sales) return 0;
    const qty = sales[item.yaraCode];
    return typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/** صلة البحث: باركود مطابق ← باركود بادئة ← اسم بادئة ← كلمة بادئة ← احتواء. */
export function searchScore(item: CatalogItem, needle: string): number {
    const q = needle.trim().toLocaleLowerCase();
    if (!q) return 0;
    const name = item.name.toLocaleLowerCase();
    const barcode = item.barcode.toLocaleLowerCase();
    if (barcode && barcode === q) return 0;
    if (barcode && barcode.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.split(/\s+/).some((word) => word.startsWith(q))) return 3;
    return 4;
}

export interface CatalogOrderOptions {
    favorites: readonly string[];
    sales?: SalesIndex;
    query?: string;
}

/** المفضلة أولًا، ثم الأكثر مبيعًا، ثم الأبجدية العربية — وفي البحث تسبق الصلة. */
export function orderCatalog(items: readonly CatalogItem[], options: CatalogOrderOptions): CatalogItem[] {
    const pinned = new Set(options.favorites);
    const needle = (options.query ?? '').trim().toLocaleLowerCase();
    return [...items].sort((a, b) => {
        if (needle) {
            const relevance = searchScore(a, needle) - searchScore(b, needle);
            if (relevance) return relevance;
        }
        const pin = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
        if (pin) return pin;
        const sold = soldQty(b, options.sales) - soldQty(a, options.sales);
        if (sold) return sold;
        return a.name.localeCompare(b.name, 'ar');
    });
}

export interface CatalogGroup {
    key: string;
    items: CatalogItem[];
    sold: number;
}

/** تجميع بعناوين الفئات مرتّبة بالمبيعات: الأكثر بيعًا أولًا، و«أخرى» أخيرًا. */
export function groupCatalog(items: readonly CatalogItem[], options: CatalogOrderOptions): CatalogGroup[] {
    const buckets = new Map<string, CatalogItem[]>();
    for (const item of orderCatalog(items, options)) {
        const key = item.category || 'أخرى';
        const bucket = buckets.get(key);
        if (bucket) bucket.push(item);
        else buckets.set(key, [item]);
    }
    return [...buckets.entries()]
        .map(([key, groupItems]) => ({
            key,
            items: groupItems,
            sold: groupItems.reduce((sum, item) => sum + soldQty(item, options.sales), 0),
        }))
        .sort((a, b) => {
            if (a.key === 'أخرى') return 1;
            if (b.key === 'أخرى') return -1;
            return b.sold - a.sold || a.key.localeCompare(b.key, 'ar');
        });
}

/** أعلى الأصناف مبيعًا (بلا مفضلة — لها شريطها) لشريط «الأكثر مبيعًا». */
export function bestSellers(items: readonly CatalogItem[], options: CatalogOrderOptions & { limit?: number }): CatalogItem[] {
    if (!options.sales) return [];
    const pinned = new Set(options.favorites);
    const limit = options.limit ?? 8;
    return items
        .filter((item) => !pinned.has(item.id) && soldQty(item, options.sales) > 0)
        .sort((a, b) => soldQty(b, options.sales) - soldQty(a, options.sales) || a.name.localeCompare(b.name, 'ar'))
        .slice(0, limit);
}

/* ─── الطباعة: نافذة خارجية كما يفعل القديم ─────────────────────────────── */

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** يفتح نافذة، يكتب HTML موثوقًا من الخادم أو مبنيًا هنا، ويطبعها. */
export function openPrintWindow(title: string, html: string): boolean {
    const win = window.open('', '_blank');
    if (!win) {
        return false;
    }
    win.opener = null;
    win.document.open();
    win.document.write(
        `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
            '<style>body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;padding:16px;color:#111}' +
            'table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #c9c9c9;padding:6px 8px;text-align:right}' +
            'th{background:#f2f2f2}caption{text-align:right;font-weight:600;margin-bottom:8px}</style>' +
            '</head><body>',
    );
    win.document.write(html);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    win.print();
    return true;
}

/** صفحة HTML كاملة أرسلها الخادم (تذاكر المطبخ) — تُعرض كما هي بلا تغليف. */
export function openServerHtmlWindow(html: string, title = ''): boolean {
    const win = window.open('', '_blank', 'noopener');
    if (!win) {
        return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (title) {
        win.document.title = title;
    }
    win.focus();
    return true;
}

/* ─── رمز QR الضريبي: نفس ملف V2 المخزَّن والمخبَّأ ──────────────────────── */

interface QrGlobal {
    toDataURL?: (text: string, options?: { width?: number; margin?: number; errorCorrectionLevel?: string }) => Promise<string>;
}

let qrPromise: Promise<boolean> | null = null;

function loadQrVendor(): Promise<boolean> {
    if (typeof window === 'undefined') {
        return Promise.resolve(false);
    }
    const existing = (window as unknown as { QRCode?: QrGlobal }).QRCode;
    if (existing && typeof existing.toDataURL === 'function') {
        return Promise.resolve(true);
    }
    if (qrPromise) {
        return qrPromise;
    }
    qrPromise = new Promise<boolean>((resolve) => {
        const tag = document.createElement('script');
        // الملف نفسه الذي يحمّله القديم بنفس ?v — استفادة من الكاش لا عنوان جديد.
        tag.src = '/app/js/vendor/qrcode.min.js?v=4.9.308';
        tag.async = true;
        tag.onload = () => resolve(typeof (window as unknown as { QRCode?: QrGlobal }).QRCode !== 'undefined');
        tag.onerror = () => {
            qrPromise = null;
            resolve(false);
        };
        document.head.appendChild(tag);
    });
    return qrPromise;
}

/** صورة QR كـdata URL، أو `null` حين يتعذّر المولّد — الشاشة تخبر المستخدم. */
export async function qrDataUrl(payload: string): Promise<string | null> {
    if (!payload) {
        return null;
    }
    const ok = await loadQrVendor();
    const qr = (window as unknown as { QRCode?: QrGlobal }).QRCode;
    if (!ok || !qr || typeof qr.toDataURL !== 'function') {
        return null;
    }
    try {
        return await qr.toDataURL(payload, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
    } catch {
        return null;
    }
}

/* ─── المفضلة: ذوق الكاشير لكل قسم، محليًا لا في قاعدة البيانات ─────────── */

export const POS_FAVORITES_LIMIT = 12;

function posFavoritesKey(departmentId: string): string {
    return `v3-pos-favorites:${String(departmentId).trim()}`;
}

export function readPosFavorites(departmentId: string): string[] {
    if (typeof window === 'undefined' || !departmentId) {
        return [];
    }
    try {
        const raw = window.localStorage.getItem(posFavoritesKey(departmentId));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed
                  .map((id) => String(id))
                  .filter((id) => id.trim().length > 0)
                  .slice(0, POS_FAVORITES_LIMIT)
            : [];
    } catch {
        return [];
    }
}

/** الكتابة قد تفشل في التصفح الخاص — المفضلة رفاهية لا تُفشل البيع. */
export function writePosFavorites(departmentId: string, ids: readonly string[]): void {
    if (typeof window === 'undefined' || !departmentId) {
        return;
    }
    try {
        window.localStorage.setItem(posFavoritesKey(departmentId), JSON.stringify([...ids].slice(0, POS_FAVORITES_LIMIT)));
    } catch {
        // تخزين محلي محظور: تبقى المفضلة في الذاكرة للجلسة الحالية.
    }
}

/* ─── جدول سجل الفواتير للطباعة ────────────────────────────────────────── */

export interface PrintableOrderRow {
    invoice_counter: number | null;
    department_name: string | null;
    created_at: string | null;
    cashier_name: string | null;
    item_count: number;
    total_amount: number;
    status: string | null;
}

export function ordersPrintHtml(rows: readonly PrintableOrderRow[]): string {
    const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.total_amount) ? row.total_amount : 0), 0);
    const body = rows
        .map(
            (row) =>
                `<tr><td>#${escapeHtml(row.invoice_counter ?? '—')}</td><td>${escapeHtml(row.department_name ?? '—')}</td>` +
                `<td dir="ltr">${escapeHtml(row.created_at ?? '—')}</td><td>${escapeHtml(row.cashier_name ?? '—')}</td>` +
                `<td dir="ltr">${escapeHtml(row.item_count)}</td><td dir="ltr">${moneyText(row.total_amount)}</td>` +
                `<td>${escapeHtml(orderStatusLabel(row.status))}</td></tr>`,
        )
        .join('');
    return (
        '<table><caption>سجل فواتير الكاشير — ' +
        `${escapeHtml(rows.length)} فاتورة · الإجمالي ${moneyText(total)}</caption>` +
        '<thead><tr><th>الفاتورة</th><th>القسم</th><th>التاريخ</th><th>الكاشير</th><th>الأصناف</th><th>الإجمالي</th><th>الحالة</th></tr></thead>' +
        `<tbody>${body}</tbody></table>`
    );
}
