/**
 * PosSettingsPanel — «ترس الضبط» لإدارة الأصناف والأسعار من داخل شاشة الكاشير.
 * ════════════════════════════════════════════════════════════════════════════
 * القاعدة الحديدية: هذا الترس لا يُعرض ولا يعمل إلا للأدوار الأعلى من الكاشير.
 *   • إدارة الأصناف (إضافة/تعديل/أرشفة): admin أو manager — يطابق requireRole
 *     في الـbackend (shift-routes: POST/PUT/DELETE /api/pos/products).
 *   • تغيير الأسعار: admin أو accountant — يطابق POST /api/pos/products/:id/price.
 *   • الكاشير (cashier): صفر أدوات — الزر نفسه لا يُعرض من الأساس.
 * كل تغيير سعر يُسجّل في audit log تلقائيًا من الـbackend (PRODUCT_PRICE_CHANGE).
 * الواجهة لا تتجاوز أي صلاحية؛ الـباك-إند هو الحارس الأساسي.
 */
import { useMemo, useRef, useState } from 'react';
import './PosSettingsPanel.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    archivePosProduct,
    createPosProduct,
    fetchAllPosProducts,
    fetchPosDepartments,
    fetchPosProducts,
    removePosProductImage,
    updatePosProduct,
    updatePosProductPrice,
    uploadPosProductImage,
    type PosProduct,
    type PosProductPayload,
} from '../../lib/pos';
import { Button, Input } from '../../ui';
import { useToast } from '../../ui/Toast';
import { moneyText, roleIn } from './pos-ui';

export const POS_ITEMS_MANAGER_ROLES = ['admin', 'manager'] as const;
export const POS_PRICE_MANAGER_ROLES = ['admin', 'accountant'] as const;
/** رفع/حذف صور الأصناف — نفس الأدوار التي يسمح بها الـbackend على /products/:id/image. */
export const POS_IMAGE_ROLES = ['admin', 'manager', 'accountant'] as const;
export function canManagePosItems(role: string | null | undefined): boolean {
    return roleIn(role, POS_ITEMS_MANAGER_ROLES);
}
export function canEditPosPrices(role: string | null | undefined): boolean {
    return roleIn(role, POS_PRICE_MANAGER_ROLES);
}
export function canManagePosImages(role: string | null | undefined): boolean {
    return roleIn(role, POS_IMAGE_ROLES);
}
export function canOpenPosSettings(role: string | null | undefined): boolean {
    return canManagePosItems(role) || canEditPosPrices(role) || canManagePosImages(role);
}

export interface PosSettingsPanelProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly departmentId: string | null | undefined;
    readonly role: string | null | undefined;
    /** يُستدعى بعد أي تغيير — الأب يعيد مزامنة الكاشير (الشبكة/السلة تبقى كما هي). */
    readonly onChanged: () => void;
}

type Tab = 'items' | 'prices' | 'images';
type ImageFilter = 'all' | 'none' | 'shared';
type FormMode = 'closed' | 'new' | 'edit';

interface ItemFormState {
    name_ar: string;
    name_en: string;
    barcode: string;
    price: string;
    cost_price: string;
    vat_rate: string;
    category: string;
    unit: string;
    department_id: string;
    is_active: boolean;
}

const EMPTY_FORM: ItemFormState = {
    name_ar: '', name_en: '', barcode: '', price: '', cost_price: '', vat_rate: '15',
    category: '', unit: 'قطعة', department_id: '', is_active: true,
};

function formFromProduct(p: PosProduct): ItemFormState {
    return {
        name_ar: p.name_ar ?? '',
        name_en: (p.name_en ?? '') ?? '',
        barcode: (p.barcode ?? '') ?? '',
        price: String(p.price),
        cost_price: p.cost_price == null ? '' : String(p.cost_price),
        vat_rate: String(p.vat_rate ?? 15),
        category: (p.category ?? '') ?? '',
        unit: (p.unit ?? '') || 'قطعة',
        department_id: p.department_id == null ? '' : String(p.department_id),
        is_active: p.is_active !== false,
    };
}

function payloadFromForm(form: ItemFormState): PosProductPayload {
    return {
        name_ar: form.name_ar.trim(),
        name_en: form.name_en.trim(),
        barcode: form.barcode.trim(),
        price: Number(form.price),
        cost_price: form.cost_price.trim() === '' ? null : Number(form.cost_price),
        vat_rate: Number(form.vat_rate),
        category: form.category.trim(),
        unit: form.unit.trim() || 'قطعة',
        department_id: form.department_id ? Number(form.department_id) : null,
        is_active: form.is_active,
    };
}

export function PosSettingsPanel({ open, onClose, departmentId, role, onChanged }: PosSettingsPanelProps): React.ReactElement | null {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const canItems = canManagePosItems(role);
    const canPrices = canEditPosPrices(role);
    const canImages = canManagePosImages(role);
    const [tab, setTab] = useState<Tab>('items');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [formMode, setFormMode] = useState<FormMode>('closed');
    const [formProductId, setFormProductId] = useState<string | null>(null);
    const [form, setForm] = useState<ItemFormState>(EMPTY_FORM);
    const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState('');
    // ── قسم صور المنيو ──
    const [imageFilter, setImageFilter] = useState<ImageFilter>('all');
    const [imageSearch, setImageSearch] = useState('');
    const [imageTarget, setImageTarget] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // نفس مفتاح الكاش — نفس البيانات اللي بيراها الكاشير في الشبكة.
    const deptKey = departmentId ? String(departmentId) : '';
    const productsQuery = useQuery({
        queryKey: ['pos-products', deptKey],
        queryFn: ({ signal }) => fetchPosProducts(deptKey, signal),
        enabled: open,
        staleTime: 30 * 1000,
    });
    const departmentsQuery = useQuery({
        queryKey: ['pos-departments'],
        queryFn: ({ signal }) => fetchPosDepartments(signal),
        enabled: open,
        staleTime: 5 * 60 * 1000,
    });
    // كل أصناف المنيو (كل الأقسام) — قسم الصور يشتغل على الكتالوج كامل
    const allProductsQuery = useQuery({
        queryKey: ['pos-products', 'all'],
        queryFn: ({ signal }) => fetchAllPosProducts(false, signal),
        enabled: open && canManagePosImages(role),
        staleTime: 60 * 1000,
    });

    const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) { return products; }
        return products.filter((p) =>
            p.name_ar?.toLowerCase().includes(q)
            || p.name_en?.toLowerCase().includes(q)
            || p.barcode?.toLowerCase().includes(q)
            || p.category?.toLowerCase().includes(q));
    }, [products, search]);

    const categories = useMemo(
        () => [...new Set(products.map((p) => p.category).filter(Boolean))] as string[],
        [products],
    );

    /**
     * ذكاء الصور: صورة واحدة مستخدمة في أكثر من صنف = خطأ مؤكد
     * («عصير فراولة» بصورة برتقال مثلًا). نحسبها من الكتالوج مباشرةً.
     */
    const imageUsage = useMemo(() => {
        const counts = new Map<string, number>();
        for (const p of allProductsQuery.data ?? []) {
            const url = String(p.image_url ?? '').trim();
            if (url) { counts.set(url, (counts.get(url) ?? 0) + 1); }
        }
        return counts;
    }, [allProductsQuery.data]);

    const imageRows = useMemo(() => {
        const q = imageSearch.trim().toLowerCase();
        return (allProductsQuery.data ?? []).filter((p) => {
            const url = String(p.image_url ?? '').trim();
            if (imageFilter === 'none' && url) { return false; }
            if (imageFilter === 'shared' && (!url || (imageUsage.get(url) ?? 0) < 2)) { return false; }
            if (!q) { return true; }
            return p.name_ar?.toLowerCase().includes(q)
                || p.name_en?.toLowerCase().includes(q)
                || p.category?.toLowerCase().includes(q);
        });
    }, [allProductsQuery.data, imageFilter, imageSearch, imageUsage]);

    // قفل: لا ترس، لا تنفيذ — حتى لو استُدعي المكوّن بالخطأ.
    if (!open) { return null; }
    if (!canItems && !canPrices && !canImages) {
        return (
            <div className="pos-settings" role="dialog" aria-modal="true" aria-label="غير مصرّح">
                <div className="pos-settings__panel pos-settings__panel--denied">
                    <h2>صلاحيات غير كافية</h2>
                    <p>ترس الضبط للأدوار الأعلى من الكاشير (مدير / مدير قسم / محاسب). أي تغيير بالأسعار يُسجّل باسمك في سجل التدقيق.</p>
                    <Button variant="ghost" size="sm" onClick={onClose}>إغلاق</Button>
                </div>
            </div>
        );
    }

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ['pos-products'] });
        onChanged();
    };

    const openNewForm = () => {
        setForm({ ...EMPTY_FORM, department_id: deptKey });
        setFormMode('new');
        setFormProductId(null);
        setFormError('');
    };
    const openEditForm = (p: PosProduct) => {
        setForm(formFromProduct(p));
        setFormProductId(p.id);
        setFormMode('edit');
        setFormError('');
    };
    const closeForm = () => {
        setFormMode('closed');
        setFormProductId(null);
        setFormError('');
    };

    const submitForm = async () => {
        const name = form.name_ar.trim();
        const price = Number(form.price);
        if (!name) { setFormError('اسم الصنف مطلوب'); return; }
        if (!Number.isFinite(price) || price < 0) { setFormError('السعر غير صالح'); return; }
        setBusy(true);
        try {
            const payload = payloadFromForm(form);
            if (formMode === 'new') {
                await createPosProduct(payload);
                toast({ title: 'تمت الإضافة', description: `أُضيف «${name}» إلى الكاشير`, variant: 'success' });
            } else if (formMode === 'edit' && formProductId) {
                await updatePosProduct(formProductId, payload);
                toast({ title: 'تم التحديث', description: `حُدّث «${name}»`, variant: 'success' });
            }
            closeForm();
            refresh();
        } catch (err) {
            setFormError(err instanceof Error ? err.message : 'تعذر الحفظ');
        } finally {
            setBusy(false);
        }
    };

    const archive = async (p: PosProduct) => {
        if (!window.confirm(`أرشفة «${p.name_ar}»؟ الصنف يختفي من الكاشير ولن يُحذف من التاريخ.`)) { return; }
        setBusy(true);
        try {
            await archivePosProduct(p.id);
            toast({ title: 'تمت الأرشفة', description: `لم يعد «${p.name_ar}» يظهر في الكاشير`, variant: 'success' });
            refresh();
        } catch (err) {
            toast({ title: 'تعذرت الأرشفة', description: err instanceof Error ? err.message : '', variant: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const savePrice = async (p: PosProduct) => {
        const draft = priceDrafts[p.id];
        if (draft === undefined) { return; }
        const next = Number(draft);
        if (!Number.isFinite(next) || next < 0) {
            toast({ title: 'سعر غير صالح', variant: 'error' });
            return;
        }
        if (next === p.price) {
            setPriceDrafts((prev) => { const copy = { ...prev }; delete copy[p.id]; return copy; });
            return;
        }
        setBusy(true);
        try {
            await updatePosProductPrice(p.id, next);
            setPriceDrafts((prev) => { const copy = { ...prev }; delete copy[p.id]; return copy; });
            toast({ title: 'تم تغيير السعر', description: `«${p.name_ar}»: ${moneyText(p.price)} → ${moneyText(next)} — سُجل في audit log`, variant: 'success' });
            refresh();
        } catch (err) {
            toast({ title: 'تعذر تغيير السعر', description: err instanceof Error ? err.message : '', variant: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const pickImageFile = (productId: string) => {
        setImageTarget(productId);
        fileInputRef.current?.click();
    };

    const uploadImageFor = async (productId: string, file: File) => {
        setBusy(true);
        try {
            await uploadPosProductImage(productId, file);
            toast({ title: 'تم رفع الصورة', description: 'حُدِّثت صورة الصنف في الكاشير', variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-products'] });
            await queryClient.invalidateQueries({ queryKey: ['pos-products', 'all'] });
            onChanged();
        } catch (err) {
            toast({ title: 'تعذّر رفع الصورة', description: err instanceof Error ? err.message : '', variant: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const deleteImageFor = async (productId: string, name: string) => {
        if (!window.confirm(`حذف صورة «${name}»؟ الصنف هيبقى بالأيقونة البديلة.`)) { return; }
        setBusy(true);
        try {
            await removePosProductImage(productId);
            toast({ title: 'حُذفت الصورة', description: name, variant: 'success' });
            await queryClient.invalidateQueries({ queryKey: ['pos-products'] });
            await queryClient.invalidateQueries({ queryKey: ['pos-products', 'all'] });
            onChanged();
        } catch (err) {
            toast({ title: 'تعذّر حذف الصورة', description: err instanceof Error ? err.message : '', variant: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const showTab = (candidate: Tab) => (candidate === 'items' ? canItems : candidate === 'prices' ? canPrices : canImages);
    const effectiveTab = showTab(tab) ? tab : (canItems ? 'items' : canPrices ? 'prices' : 'images');

    return (
        <div className="pos-settings" role="dialog" aria-modal="true" aria-label="ترس الضبط — إدارة الأصناف والأسعار">
            <button type="button" className="pos-settings__scrim" aria-label="إغلاق" onClick={onClose} />
            <div className="pos-settings__panel">
                <header className="pos-settings__bar">
                    <div className="pos-settings__title">
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3.1" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        <div>
                            <h2>ترس الضبط</h2>
                            <p>إدارة الأصناف والأسعار — صلاحيات إدارية أعلى من الكاشير</p>
                        </div>
                    </div>
                    <button type="button" className="pos-settings__close" onClick={onClose} aria-label="إغلاق اللوحة">×</button>
                </header>

                <p className="pos-settings__notice" role="note">
                    كل تغيير سعر أو صنف يُسجَّل في <b>audit log</b> باسمك ودورك ووقت التنفيذ. صلاحية السعر محصورة بـ admin/accountant، وإدارة الأصناف بـ admin/manager.
                </p>

                <div className="pos-settings__tabs" role="tablist">
                    {canItems ? (
                        <button type="button" role="tab" aria-selected={effectiveTab === 'items'} className={`pos-settings__tab${effectiveTab === 'items' ? ' is-active' : ''}`} onClick={() => setTab('items')}>الأصناف</button>
                    ) : null}
                    {canPrices ? (
                        <button type="button" role="tab" aria-selected={effectiveTab === 'prices'} className={`pos-settings__tab${effectiveTab === 'prices' ? ' is-active' : ''}`} onClick={() => setTab('prices')}>الأسعار</button>
                    ) : null}
                    {canImages ? (
                        <button type="button" role="tab" aria-selected={effectiveTab === 'images'} className={`pos-settings__tab${effectiveTab === 'images' ? ' is-active' : ''}`} onClick={() => setTab('images')}>صور المنيو</button>
                    ) : null}
                </div>

                <div className="pos-settings__body">
                    <div className="pos-settings__toolbar">
                        <Input
                            type="search"
                            placeholder="ابحث عن صنف أو باركود أو فئة…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="بحث في الأصناف"
                        />
                        {effectiveTab === 'items' && canItems ? (
                            <Button variant="primary" size="sm" onClick={openNewForm} disabled={busy}>+ إضافة صنف</Button>
                        ) : null}
                    </div>

                    {productsQuery.isPending ? <p className="pos-settings__state">جاري تحميل الأصناف…</p> : null}
                    {productsQuery.error ? <p className="pos-settings__state pos-settings__state--error">تعذر تحميل الأصناف</p> : null}

                    {/* ── صور المنيو ── */}
                    {effectiveTab === 'images' && canImages ? (
                        <div className="pos-settings__images">
                            <div className="pos-settings__toolbar">
                                <Input
                                    type="search"
                                    placeholder="ابحث باسم الصنف أو الفئة…"
                                    value={imageSearch}
                                    onChange={(e) => setImageSearch(e.target.value)}
                                    aria-label="بحث في صور الأصناف"
                                />
                                <div className="pos-settings__filters" role="group" aria-label="تصفية الصور">
                                    <button type="button" className={`pos-settings__chip${imageFilter === 'all' ? ' is-active' : ''}`} onClick={() => setImageFilter('all')}>الكل</button>
                                    <button type="button" className={`pos-settings__chip${imageFilter === 'none' ? ' is-active' : ''}`} onClick={() => setImageFilter('none')}>بدون صورة</button>
                                    <button type="button" className={`pos-settings__chip${imageFilter === 'shared' ? ' is-active' : ''}`} onClick={() => setImageFilter('shared')}>صورة مشتركة (راجعها)</button>
                                </div>
                            </div>
                            <p className="pos-settings__hint">
                                «صورة مشتركة» = نفس الصورة مستخدمة في أكثر من صنف — سببMost شيوعًا لصورة غلط على صنف.
                                ارفع صورة كل صنف من هنا لتظهر صح في الكاشير.
                            </p>
                            {allProductsQuery.isPending ? <p className="pos-settings__state">جاري تحميل الأصناف…</p> : null}
                            <ul className="pos-settings__images-grid">
                                {imageRows.map((p) => {
                                    const url = String(p.image_url ?? '').trim();
                                    const shared = url ? (imageUsage.get(url) ?? 0) : 0;
                                    return (
                                        <li key={p.id} className="pos-settings__image-card">
                                            <span className="pos-settings__image-thumb">
                                                {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <em>بلا صورة</em>}
                                            </span>
                                            <span className="pos-settings__image-copy">
                                                <strong>{p.name_ar}</strong>
                                                <small>{p.category || '—'}</small>
                                                {shared > 1 ? (
                                                    <em className="pos-settings__image-warn">مستخدمة في {shared} أصناف</em>
                                                ) : null}
                                            </span>
                                            <span className="pos-settings__image-actions">
                                                <button type="button" className="pos-settings__action" onClick={() => pickImageFile(p.id)} disabled={busy}>
                                                    {url ? 'تغيير' : 'رفع صورة'}
                                                </button>
                                                {url ? (
                                                    <button type="button" className="pos-settings__action pos-settings__action--danger" onClick={() => { void deleteImageFor(p.id, p.name_ar ?? String(p.id)); }} disabled={busy}>حذف</button>
                                                ) : null}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="sr-only"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    const target = imageTarget;
                                    event.target.value = '';
                                    if (file && target) { void uploadImageFor(target, file); }
                                }}
                            />
                        </div>
                    ) : null}

                    {/* ── نموذج صنف (جديد/تعديل) ── */}
                    {formMode !== 'closed' && effectiveTab === 'items' && canItems ? (
                        <form className="pos-settings__form" onSubmit={(e) => { e.preventDefault(); void submitForm(); }}>
                            <div className="pos-settings__grid">
                                <label>الاسم بالعربية *<Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} autoFocus /></label>
                                <label>الاسم بالإنجليزية<Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} dir="ltr" /></label>
                                <label>الباركود<Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} dir="ltr" inputMode="numeric" /></label>
                                <label>السعر (شامل الضريبة حسب إعدادات الطلب) *<Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" dir="ltr" /></label>
                                <label>سعر التكلفة<Input value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} inputMode="decimal" dir="ltr" /></label>
                                <label>الضريبة
                                    <select className="erp-control" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}>
                                        <option value="15">15% (قياسي)</option>
                                        <option value="0">0% (معفى/صفري)</option>
                                    </select>
                                </label>
                                <label>الفئة<Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} list="pos-settings-categories" />
                                    <datalist id="pos-settings-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                                </label>
                                <label>الوحدة<Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
                                <label>القسم
                                    <select className="erp-control" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                                        <option value="">— كل الأقسام —</option>
                                        {(departmentsQuery.data ?? []).filter((d) => d.is_active !== false).map((d) => (
                                            <option key={d.id} value={d.id}>{d.name_ar}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="pos-settings__check"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> صنف نشط يظهر في الكاشير</label>
                            </div>
                            {formError ? <p className="pos-settings__form-error" role="alert">{formError}</p> : null}
                            <div className="pos-settings__form-actions">
                                <Button type="submit" variant="primary" size="sm" disabled={busy}>{formMode === 'new' ? 'إضافة الصنف' : 'حفظ التعديلات'}</Button>
                                <Button type="button" variant="ghost" size="sm" onClick={closeForm} disabled={busy}>إلغاء</Button>
                            </div>
                        </form>
                    ) : null}

                    {/* ── قائمة الأصناف / الأسعار ── */}
                    {formMode === 'closed' ? (
                        <ul className="pos-settings__list">
                            {filtered.length === 0 ? <li className="pos-settings__empty">لا توجد أصناف مطابقة</li> : null}
                            {filtered.map((p) => (
                                <li key={p.id} className={`pos-settings__row${p.is_active === false ? ' is-archived' : ''}`}>
                                    <div className="pos-settings__row-main">
                                        <strong>{p.name_ar}</strong>
                                        <span className="pos-settings__row-meta">
                                            {p.category ? <em>{p.category}</em> : null}
                                            {p.barcode ? <em dir="ltr">{p.barcode}</em> : null}
                                            {p.is_active === false ? <em className="pos-settings__flag-off">مؤرشف</em> : null}
                                        </span>
                                    </div>
                                    {effectiveTab === 'items' ? (
                                        <span className="pos-settings__row-actions">
                                            <span className="pos-settings__price">{moneyText(p.price)}</span>
                                            <button type="button" className="pos-settings__action" onClick={() => openEditForm(p)} disabled={busy}>تعديل</button>
                                            <button type="button" className="pos-settings__action pos-settings__action--danger" onClick={() => { void archive(p); }} disabled={busy || p.is_active === false}>أرشفة</button>
                                        </span>
                                    ) : (
                                        <span className="pos-settings__row-actions">
                                            {canPrices ? (
                                                <>
                                                    <label className="pos-settings__price-edit">
                                                        <span className="sr-only">السعر الحالي لـ{p.name_ar}</span>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            step="0.01"
                                                            dir="ltr"
                                                            value={priceDrafts[p.id] ?? String(p.price)}
                                                            onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                                            aria-label={`سعر ${p.name_ar}`}
                                                        />
                                                    </label>
                                                    <button type="button" className="pos-settings__action" onClick={() => { void savePrice(p); }} disabled={busy || priceDrafts[p.id] === undefined || Number(priceDrafts[p.id]) === p.price}>حفظ</button>
                                                </>
                                            ) : (
                                                <span className="pos-settings__price">{moneyText(p.price)}</span>
                                            )}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
