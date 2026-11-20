import './Recipes.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency, fetchDepartments } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { formatInt } from '../lib/inventory-register';
import {
    costRatioText,
    fetchRecipes,
    fetchRecipesCatalog,
    indexCatalog,
    type RecipeRow,
    recipeToRow,
    recipeTotals,
    searchRecipes,
} from '../lib/recipes';
import {
    createRecipe,
    deleteRecipe,
    RECIPE_TEXT,
    type RecipeCreateInput,
    type RecipeUpdateInput,
    recipeDeleteConfirm,
    recipeDeleteVisible,
    recipeWriteVisible,
    recipeBomVisible,
    syncRecipeToCashier,
    fetchProductIngredients,
    fetchBomInventory,
    fetchRecipeUnits,
    saveProductIngredients,
    uploadProductImage,
    removeProductImage,
    ingredientLine,
    newBomLine,
    updateRecipe,
    type BomLineDraft,
} from '../lib/recipes-write';
import { useToast } from '../ui/Toast';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * الوصفات — CRUD كامل على جدول `recipes`:
 *  • إنشاء وصفة (POST /api/recipes — admin|manager)
 *  • تعديل وصفة (PUT /api/recipes/:id — admin|manager)
 *  • حذف وصفة (DELETE /api/recipes/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions)
 *
 * القراءة من `/api/recipes` + كتالوج الكاشير. المكوّنات والصورة والمزامنة
 * مع الكاشير في V2 — هنا السجل والسعر والتكلفة والقسم والربط.
 */

const PAGE_SIZE = 50;

type SortKey = 'name' | 'dept' | 'sellingPrice' | 'totalCost' | 'costRatio' | 'ingredients';

type LinkFilter = 'all' | 'linked' | 'unlinked';

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

function SortableTh({
    label,
    sortKey,
    sort,
    onToggle,
}: {
    label: string;
    sortKey: SortKey;
    sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
    onToggle: (key: SortKey) => void;
}) {
    const ariaSort = sort?.key !== sortKey ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';
    return (
        <th scope="col" aria-sort={ariaSort} className="px-sm py-xs text-start font-medium">
            <button type="button" onClick={() => onToggle(sortKey)}>
                {label}
            </button>
        </th>
    );
}

function compare(a: RecipeRow, b: RecipeRow, key: SortKey): number {
    if (key === 'name') {
        return a.name.localeCompare(b.name, 'ar');
    }
    if (key === 'dept') {
        return a.deptName.localeCompare(b.deptName, 'ar');
    }
    if (key === 'ingredients') {
        return a.ingredients - b.ingredients;
    }
    const left = key === 'sellingPrice' ? a.sellingPrice : key === 'totalCost' ? a.totalCost : a.costRatio;
    const right = key === 'sellingPrice' ? b.sellingPrice : key === 'totalCost' ? b.totalCost : b.costRatio;
    if (key === 'costRatio') {
        return (left as number) - (right as number);
    }
    return Number(left ?? -1) - Number(right ?? -1);
}

function Money({ value, currency }: { value: string | null; currency: string }) {
    if (value === null) {
        return <span className="text-muted">—</span>;
    }
    return (
        <>
            {formatMoney(value)}
            {currency ? <span className="text-caption text-faint"> {currency}</span> : null}
        </>
    );
}

/* ── نموذج إضافة/تعديل وصفة ───────────────────────────────────────────── */

interface RecipeFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: RecipeRow | null;
    departments: { code: string; name: string }[];
    onSave: (payload: RecipeCreateInput | RecipeUpdateInput, isEditing: boolean) => Promise<void>;
}

const RECIPE_FORM_ID = 'erp-recipe-form';

function RecipeFormDialog({ open, onClose, pending, editing, departments, onSave }: RecipeFormDialogProps) {
    const [form, setForm] = useState<{
        name: string;
        sellingPrice: string;
        totalCost: string;
        departmentCode: string;
    }>({
        name: '',
        sellingPrice: '',
        totalCost: '',
        departmentCode: '',
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                name: editing.name,
                sellingPrice: String(editing.sellingPrice ?? ''),
                totalCost: String(editing.totalCost ?? ''),
                departmentCode: editing.deptCode ?? '',
            });
        } else {
            setForm({ name: '', sellingPrice: '', totalCost: '', departmentCode: '' });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        if (!form.name.trim()) {
            setFormError(RECIPE_TEXT.nameRequired);
            return;
        }
        const sellingPrice = Number(form.sellingPrice);
        if (!form.sellingPrice.trim() || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
            setFormError(RECIPE_TEXT.priceInvalid);
            return;
        }
        const totalCost = Number(form.totalCost);
        if (!form.totalCost.trim() || !Number.isFinite(totalCost) || totalCost < 0) {
            setFormError(RECIPE_TEXT.costInvalid);
            return;
        }

        const input: RecipeCreateInput | RecipeUpdateInput = {
            name: form.name.trim(),
            sellingPrice,
            totalCost,
            deptId: form.departmentCode.trim() || null,
        };

        try {
            await onSave(input, Boolean(editing));
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? RECIPE_TEXT.updateFailed : RECIPE_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل وصفة' : 'وصفة جديدة'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {RECIPE_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={RECIPE_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'إضافة الوصفة'}
                    </Button>
                </>
            }
        >
            <form id={RECIPE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="اسم الوصفة"
                        name="name"
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="شرائح الدجاج المشوي"
                        required
                    />
                    <Input
                        label="سعر البيع"
                        name="sellingPrice"
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.sellingPrice}
                        onChange={(e) => setForm((prev) => ({ ...prev, sellingPrice: e.target.value }))}
                        placeholder="0.00"
                        required
                    />
                    <Input
                        label="التكلفة"
                        name="totalCost"
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.totalCost}
                        onChange={(e) => setForm((prev) => ({ ...prev, totalCost: e.target.value }))}
                        placeholder="0.00"
                        required
                    />
                    <Select
                        label="القسم"
                        name="departmentCode"
                        value={form.departmentCode}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, departmentCode: String(value ?? '') }))}
                        options={departments.map((d) => ({ label: d.name, value: d.code }))}
                    />
                </div>
                {formError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {formError}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد الحذف ───────────────────────────────────────────────── */

interface RecipeActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
}

function RecipeActionDialog({ open, title, message, onConfirm, onClose, pending, confirmLabel }: RecipeActionDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={title}
            size="md"
        >
            <p className="text-body-md text-ink">{message}</p>
            <div className="flex justify-end gap-sm" data-erp-print-hide>
                <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                    {RECIPE_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── محرر المكوّنات (BOM) + الصورة ───────────────────────────────────────── */

interface RecipeBomDialogProps {
    open: boolean;
    row: RecipeRow | null;
    locked: boolean; // true حتى اكتمال المزامنة الأولية
    canBom: boolean;
    onClose: () => void;
    onCloseUpdate: () => void; // عند نجاح الحفظ — يغلق ويعيد تحميل القائمة
}

function RecipeBomDialog({ open, row, locked, canBom, onClose, onCloseUpdate }: RecipeBomDialogProps) {
    const { toast } = useToast();

    const [syncState, setSyncState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [syncError, setSyncError] = useState('');
    const [productId, setProductId] = useState<number | null>(null);
    const [imageUrl, setImageUrl] = useState('');
    const [imageUploading, setImageUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<BomLineDraft[]>([]);
    const [inventory, setInventory] = useState<Array<{ id: number; name: string; unit: string | null }>>([]);
    const [units, setUnits] = useState<Array<{ value: string; label: string; family: string }>>([]);
    const [invSearch, setInvSearch] = useState('');
    const [serverMsg, setServerMsg] = useState('');

    const recipeId = row?.id ?? null;
    const recipeName = row?.name ?? '';

    useEffect(() => {
        if (!open) {
            return;
        }
        if (!recipeId) {
            setSyncState('error');
            setSyncError('لا يوجد معرّف للوصفة');
            return;
        }
        let cancelled = false;
        setSyncState('loading');
        setSyncError('');
        setServerMsg('');
        setLines([]);
        setInventory([]);
        setUnits([]);
        setInvSearch('');
        setImageUrl(row?.imageUrl ?? '');
        (async () => {
            try {
                const synced = await syncRecipeToCashier(recipeId);
                if (cancelled || !synced.product) { return; }
                setProductId(Number(synced.product.id));
                setImageUrl(synced.product.image_url ?? '');
                const [ingredients, inv, unitList] = await Promise.all([
                    fetchProductIngredients(synced.product.id),
                    fetchBomInventory(),
                    fetchRecipeUnits(),
                ]);
                if (cancelled) { return; }
                setLines(ingredients.map(ingredientLine));
                setInventory(inv.map((i) => ({ id: i.id, name: i.name, unit: i.unit })));
                setUnits(unitList as unknown as Array<{ value: string; label: string; family: string }>);
                setSyncState('ready');
            } catch (cause) {
                if (cancelled) { return; }
                setSyncState('error');
                setSyncError(writeErrorMessage(cause, 'تعذر تجهيز محرّر المكوّنات'));
            }
        })();
        return () => { cancelled = true; };
        // الشاشة لا تعيد المزامنة عند كل تغيير لـrow — تعتمد على open فقط
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, recipeId]);

    const filteredInventory = useMemo(() => {
        const q = invSearch.trim().toLowerCase();
        if (!q) { return inventory.slice(0, 50); }
        return inventory.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 50);
    }, [inventory, invSearch]);

    async function handleSave(): Promise<void> {
        if (saving || !productId) { return; }
        const bad = lines.some((l) => {
            const q = Number(l.quantity_per_unit);
            return !Number.isFinite(q) || q <= 0;
        });
        if (bad) { setServerMsg('كل كميات المكوّنات يجب أن تكون أكبر من صفر'); return; }
        setSaving(true);
        setServerMsg('');
        try {
            const result = await saveProductIngredients(
                productId,
                lines.map((line) => ({
                    inventory_id: line.inventory_id,
                    quantity_per_unit: Number(line.quantity_per_unit) || 0,
                    unit: line.unit,
                    waste_percent: Number(line.waste_percent) || 0,
                })),
            );
            const msg = result.total_cost != null && !Number.isNaN(result.total_cost as number)
                ? `تم الحفظ — التكلفة الإجمالية ${Number(result.total_cost).toFixed(2)}`
                : 'تم حفظ المكوّنات';
            setServerMsg(msg);
            onCloseUpdate();
        } catch (cause) {
            setServerMsg(writeErrorMessage(cause, 'تعذر حفظ المكوّنات'));
        } finally { setSaving(false); }
    }

    async function handlePickImage(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
        const file = event.target.files?.[0];
        if (!file || !productId) { return; }
        setImageUploading(true);
        setServerMsg('');
        try {
            const uploaded = await uploadProductImage(productId, file);
            setImageUrl(uploaded.image_url ?? '');
            toast({ title: 'تم حفظ صورة الصنف', variant: 'success' });
        } catch (cause) {
            toast({ title: writeErrorMessage(cause, 'تعذر رفع الصورة'), variant: 'error' });
        } finally { setImageUploading(false); event.target.value = ''; }
    }

    async function handleDeleteImage(): Promise<void> {
        if (imageUploading || !productId) { return; }
        if (!window.confirm('حذف صورة الصنف؟')) { return; }
        setImageUploading(true);
        try {
            await removeProductImage(productId);
            setImageUrl('');
            toast({ title: 'تم حذف صورة الصنف', variant: 'success' });
        } catch (cause) {
            toast({ title: writeErrorMessage(cause, 'تعذر حذف الصورة'), variant: 'error' });
        } finally { setImageUploading(false); }
    }

    function addLine(inv: { id: number; name: string; unit: string | null }): void {
        const exists = lines.some((l) => l.inventory_id === inv.id);
        if (exists) { setServerMsg('هذا المكون موجود بالفعل'); return; }
        setLines((prev) => [...prev, newBomLine(inv as Pick<typeof inventory[number], 'id' | 'name' | 'unit'>, units as unknown as Parameters<typeof newBomLine>[1])]);
        setInvSearch('');
    }

    function removeLine(id: number): void {
        setLines((prev) => prev.filter((l) => l.inventory_id !== id));
    }

    function updateField<K extends keyof BomLineDraft>(id: number, key: K, value: BomLineDraft[K]): void {
        setLines((prev) => prev.map((l) => (l.inventory_id === id ? { ...l, [key]: value } : l)));
    }

    const lockedView = locked || syncState !== 'ready';

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => { if (!next) onClose(); }}
            title={`مكوّنات ووصفة — ${recipeName}`}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        إغلاق
                    </Button>
                    <Button type="button" size="sm" loading={saving} disabled={lockedView || !productId} onClick={() => void handleSave()}>
                        حفظ التكلفة
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-md">
                {/* ربط الكاشير والصورة */}
                <div className="flex flex-wrap items-center justify-between gap-md border-b border-hairline pb-md">
                    <div>
                        <p className="text-label-md text-muted">ربط صنف الكاشير</p>
                        <p className="mt-xxs text-body-md font-bold text-ink">
                            {syncState === 'ready' ? (productId ? `مرتبط — POS #${productId}` : 'مرتبط') : syncState === 'error' ? 'تعذر الربط' : 'جارٍ الربط…'}
                        </p>
                        {syncState === 'error' ? (
                            <p className="mt-xxs text-body-sm text-danger-text">{syncError}</p>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-md">
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface-sunken">
                            {imageUrl ? (
                                <img src={imageUrl} alt={recipeName} className="h-full w-full object-contain" />
                            ) : (
                                <span className="text-center text-caption leading-relaxed text-faint">بدون صورة</span>
                            )}
                        </div>
                        {canBom && productId ? (
                            <div className="flex flex-col gap-xs">
                                <label className="erp-upload-btn inline-flex cursor-pointer items-center gap-xs rounded-md border border-hairline-strong px-md py-xs text-button-md text-ink hover:bg-surface-hover">
                                    <input type="file" accept="image/*" className="sr-only" onChange={(event) => void handlePickImage(event)} />
                                    {imageUrl ? 'تغيير الصورة' : 'رفع صورة'}
                                </label>
                                {imageUrl ? (
                                    <button type="button" className="rounded-md border border-danger-text bg-danger-soft px-md py-xxs text-caption text-danger-text" onClick={() => void handleDeleteImage()} disabled={imageUploading}>
                                        حذف الصورة
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* المكونات */}
                <div>
                    <div className="mb-sm flex flex-wrap items-center justify-between gap-sm">
                        <p className="text-label-md font-bold text-ink">المكوّنات ({lines.length})</p>
                        {serverMsg ? <p className="text-caption text-success-text">{serverMsg}</p> : null}
                    </div>
                    {syncState === 'loading' ? (
                        <p className="text-body-sm text-muted">جارٍ مزامنة الصنف وتحميل المكوّنات…</p>
                    ) : syncState === 'error' ? null : (
                        <>
                            <div className="overflow-auto rounded-md border border-hairline">
                                <table className="w-full text-body-sm">
                                    <thead className="bg-surface-sunken text-caption text-muted">
                                        <tr>
                                            <th className="px-sm py-xs text-start">المكوّن</th>
                                            <th className="px-sm py-xs text-end w-24">الكمية</th>
                                            <th className="px-sm py-xs text-start w-28">الوحدة</th>
                                            <th className="px-sm py-xs text-end w-28">التكلفة</th>
                                            <th className="px-sm py-xs text-center w-16"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-sm py-md text-center text-body-sm text-muted">
                                                    لا توجد مكوّنات — أضف من المخزن بالأسفل.
                                                </td>
                                            </tr>
                                        ) : null}
                                        {lines.map((line) => (
                                            <tr key={line.inventory_id} className="border-t border-hairline">
                                                <td className="px-sm py-xxs align-middle">
                                                    <div className="font-semibold text-ink">{line.inventory_name}</div>
                                                    <div className="text-caption text-muted">مخزن: {line.inventory_unit}</div>
                                                </td>
                                                <td className="px-sm py-xxs text-end align-middle">
                                                    <input
                                                        type="number" min={0} step="any" inputMode="decimal"
                                                        className="w-20 rounded border border-hairline-strong bg-surface px-xs py-xxs text-body-sm text-end tabular-nums"
                                                        value={line.quantity_per_unit}
                                                        onChange={(event) => updateField(line.inventory_id, 'quantity_per_unit', event.target.value)}
                                                        aria-label={`كمية ${line.inventory_name}`}
                                                    />
                                                </td>
                                                <td className="px-sm py-xxs align-middle">
                                                    <select
                                                        className="w-full rounded border border-hairline-strong bg-surface px-xs py-xxs text-body-sm"
                                                        value={line.unit}
                                                        onChange={(event) => updateField(line.inventory_id, 'unit', event.target.value)}
                                                        aria-label={`وحدة ${line.inventory_name}`}
                                                    >
                                                        {units.length === 0 ? <option value={line.unit}>{line.unit}</option> : null}
                                                        {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                                                    </select>
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-end align-middle text-ink" dir="ltr">
                                                    {line.extended_cost == null ? '—' : Number(line.extended_cost).toFixed(2)}
                                                </td>
                                                <td className="px-sm py-xxs text-center align-middle">
                                                    <button
                                                        type="button"
                                                        className="rounded border border-hairline-strong p-xs text-body-sm text-muted hover:bg-danger-soft hover:text-danger-text"
                                                        onClick={() => removeLine(line.inventory_id)}
                                                        aria-label={`إزالة ${line.inventory_name}`}
                                                    >
                                                        ✕
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {/* إضافة مكون */}
                            <div className="mt-sm border-t border-hairline pt-sm">
                                <label className="text-label-md text-muted" htmlFor="erp-bom-add">إضافة مكوّن من المخزن</label>
                                <input
                                    id="erp-bom-add"
                                    type="search"
                                    className="mt-xs w-full rounded border border-hairline-strong bg-surface px-sm py-xs text-body-sm"
                                    placeholder="ابحث باسم الصنف…"
                                    value={invSearch}
                                    onChange={(event) => setInvSearch(event.target.value)}
                                />
                                <div className="mt-xs max-h-48 overflow-auto rounded-md border border-hairline" role="listbox" aria-label="أصناف المخزن">
                                    {filteredInventory.length === 0 ? (
                                        <p className="px-sm py-xs text-body-sm text-muted">لا أصناف مطابقة</p>
                                    ) : null}
                                    {filteredInventory.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            role="option"
                                            className="flex w-full items-center justify-between gap-sm border-b border-hairline px-sm py-xs text-start hover:bg-surface-hover"
                                            onClick={() => addLine(item)}
                                        >
                                            <span className="text-body-sm text-ink">{item.name}</span>
                                            <span className="text-caption text-muted">{item.unit ?? ''}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Recipes() {
    const auth = useAuthState();
    const canWrite = recipeWriteVisible(auth.user?.role);
    const canDelete = recipeDeleteVisible(auth.user?.role);
    const canBom = recipeBomVisible(auth.user?.role);
    const { toast } = useToast();

    const [bomOpen, setBomOpen] = useState(false);
    const [bomRow, setBomRow] = useState<RecipeRow | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<RecipeRow | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<RecipeRow | null>(null);
    const [actionMessage, setActionMessage] = useState('');

    const [query, setQuery] = useState('');
    const [dept, setDept] = useState('');
    const [link, setLink] = useState<LinkFilter>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);

    const recipesQuery = useQuery({
        queryKey: ['recipes'],
        queryFn: ({ signal }) => fetchRecipes(signal),
    });
    const catalogQuery = useQuery({
        queryKey: ['recipes-catalog'],
        queryFn: ({ signal }) => fetchRecipesCatalog(signal),
        staleTime: 5 * 60 * 1000,
    });
    const departmentsQuery = useQuery({
        queryKey: ['departments'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        staleTime: 5 * 60 * 1000,
    });
    const currencyQuery = useQuery({
        queryKey: ['settings-currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });
    const currency = String(currencyQuery.data ?? '');

    const deptNames = useMemo(() => {
        const map = new Map<string, string>();
        for (const department of departmentsQuery.data ?? []) {
            map.set(String(department.code), String(department.name));
        }
        return map;
    }, [departmentsQuery.data]);

    const allRows = useMemo(() => {
        const catalog = indexCatalog(catalogQuery.data ?? []);
        return (recipesQuery.data ?? []).map((recipe) => recipeToRow(recipe, catalog, deptNames));
    }, [recipesQuery.data, catalogQuery.data, deptNames]);

    const totals = useMemo(() => recipeTotals(allRows), [allRows]);

    const filteredRows = useMemo(() => {
        return allRows.filter((row) => {
            if (dept && row.deptCode !== dept) {
                return false;
            }
            if (link === 'linked' && !row.productLinked) {
                return false;
            }
            if (link === 'unlinked' && row.productLinked) {
                return false;
            }
            return true;
        });
    }, [allRows, dept, link]);

    const search = useMemo(() => searchRecipes(filteredRows, query), [filteredRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = Boolean(query || dept || link !== 'all');

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function resetFilters() {
        setQuery('');
        setDept('');
        setLink('all');
        setSort(null);
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createRecipeMutation = useWriteMutation<RecipeCreateInput, { id: string | number }>({
        mutationFn: (input) => createRecipe(input).then((r) => ({ id: r.id })),
        successTitle: () => RECIPE_TEXT.createSuccess,
        invalidate: [['recipes']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updateRecipeMutation = useWriteMutation<{ id: string | number; input: RecipeUpdateInput }, { id: string | number }>({
        mutationFn: ({ id, input }) => updateRecipe(id, input).then((r) => ({ id: r.id })),
        successTitle: () => RECIPE_TEXT.updateSuccess,
        invalidate: [['recipes']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const deleteRecipeMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deleteRecipe(id),
        successTitle: () => RECIPE_TEXT.deleteSuccess,
        invalidate: [['recipes']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: RecipeRow) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleDelete(row: RecipeRow) {
        setActionRow(row);
        setActionMessage(recipeDeleteConfirm(row.name));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        await deleteRecipeMutation.mutateAsync(actionRow.id);
    }

    const deptOptions = useMemo(
        () => departmentsQuery.data?.map((d) => ({ code: String(d.code), name: String(d.name) })) ?? [],
        [departmentsQuery.data],
    );

    return (
        <div className="erp-premium-screen erp-premium-screen--recipes flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الوصفات{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Recipes
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        سجل الوصفات وأسعارها وتكاليفها — إضافة وتعديل وحذف.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            إضافة وصفة
                        </Button>
                    ) : null}
                    <PrintActions title="الوصفات" />
                    <button
                        type="button"
                        onClick={() => {
                            void recipesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الوصفات"
                    english="Recipes"
                    value={formatInt(totals.total)}
                    hint={filtered ? `بعد المرشّحات: ${formatInt(sorted.length)}` : 'كل ما وصل من الخادم'}
                />
                <Kpi label="مرتبطة بالكاشير" english="Linked" value={formatInt(totals.linked)} hint="لها صنف POS في كتالوج الكاشير" />
                <Kpi label="بدون ربط" english="Unlinked" value={formatInt(totals.unlinked)} hint="وصفات لم تُزامَن مع الكاشير" />
                <Kpi
                    label="الأقسام"
                    english="Departments"
                    value={formatInt(totals.departmentCodes.length)}
                    hint={totals.ingredients ? `${formatInt(totals.ingredients)} مكوّنًا في الكتالوج` : 'لا مكوّنات في الكتالوج'}
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-recipes-q">
                        بحث
                        <input
                            id="erp-recipes-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="اسم الوصفة أو القسم"
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-72"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-recipes-dept">
                        القسم
                        <select
                            id="erp-recipes-dept"
                            value={dept}
                            onChange={(event) => {
                                setDept(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الأقسام</option>
                            {totals.departmentCodes.map((code) => (
                                <option key={code} value={code}>
                                    {deptNames.get(code) ?? code}
                                </option>
                            ))}
                        </select>
                    </label>
                    <fieldset className="m-0 flex flex-wrap items-end gap-xxs border-0 p-0">
                        <legend className="sr-only">ترشيح ربط POS</legend>
                        {(
                            [
                                ['all', 'الكل'],
                                ['linked', 'مرتبط'],
                                ['unlinked', 'بدون'],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={link === value}
                                onClick={() => {
                                    setLink(value);
                                    setPage(1);
                                }}
                                className={
                                    link === value
                                        ? 'rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xxs text-body-sm text-ink'
                                        : 'rounded-md border border-transparent px-sm py-xxs text-body-sm text-muted hover:bg-surface-hover'
                                }
                            >
                                {label}
                            </button>
                        ))}
                    </fieldset>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" role="status" aria-live="polite">
                        {filtered
                            ? `${formatInt(sorted.length)} وصفة مطابقة من ${formatInt(totals.total)}`
                            : `${formatInt(totals.total)} وصفة${currency ? ` · العرض: ${currency}` : ''}`}
                        {search.exact ? ` · ${formatInt(search.exact)} مطابقة تامة للاسم` : ''}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.</p>
                ) : null}
            </Card>

            <Card>
                {recipesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الوصفات" />
                        <TableSkeleton rows={4} columns={7} />
                    </div>
                ) : null}

                {recipesQuery.isError ? (
                    <StateError
                        message={recipesQuery.error instanceof Error ? recipesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void recipesQuery.refetch();
                        }}
                    />
                ) : null}

                {recipesQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا وصفات تطابق المرشّحات' : 'لا وصفات مسجّلة'}
                        hint={filtered ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.' : 'أضف أول وصفة.'}
                    />
                ) : null}

                {recipesQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <TableScroll label="جدول الوصفات">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="اسم الوصفة" sortKey="name" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="القسم" sortKey="dept" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="سعر البيع" sortKey="sellingPrice" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="التكلفة" sortKey="totalCost" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="نسبة التكلفة" sortKey="costRatio" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="مكوّنات" sortKey="ingredients" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            ربط POS
                                        </th>
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">
                                                <span className="flex items-center gap-xs">
                                                    {row.imageUrl ? (
                                                        <img
                                                            src={row.imageUrl}
                                                            alt=""
                                                            width={28}
                                                            height={28}
                                                            loading="lazy"
                                                            className="rounded-sm"
                                                        />
                                                    ) : null}
                                                    <span>{row.name}</span>
                                                </span>
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.deptName || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                <Money value={row.sellingPrice} currency={currency} />
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                <Money value={row.totalCost} currency={currency} />
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {costRatioText(row.costRatio)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {row.ingredients ? formatInt(row.ingredients) : <span className="text-muted">—</span>}
                                            </td>
                                            <td className="px-sm py-xxs text-center">
                                                <span
                                                    className={
                                                        row.productLinked ? 'text-body-sm text-success-text' : 'text-body-sm text-muted'
                                                    }
                                                >
                                                    {row.productLinked ? 'مرتبط' : 'بدون'}
                                                </span>
                                            </td>
                                            {(canWrite || canDelete || canBom) && (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canBom ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="مكوّنات الوصفة والصورة (BOM)"
                                                                onClick={() => { setBomRow(row); setBomOpen(true); }}
                                                            >
                                                                المكوّنات
                                                            </Button>
                                                        ) : null}
                                                        {canWrite ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="تعديل الوصفة"
                                                                onClick={() => openForm(row)}
                                                            >
                                                                تعديل
                                                            </Button>
                                                        ) : null}
                                                        {canDelete ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف الوصفة"
                                                                onClick={() => handleDelete(row)}
                                                            >
                                                                حذف
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                صفحة {formatInt(safePage)} من {formatInt(pageCount)}
                            </span>
                            <div className="flex gap-xs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage - 1);
                                    }}
                                    disabled={safePage <= 1}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage + 1);
                                    }}
                                    disabled={safePage >= pageCount}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </>
                ) : null}
            </Card>

            {/* Dialogs */}
            <RecipeFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createRecipeMutation.isPending || updateRecipeMutation.isPending}
                editing={editing}
                departments={deptOptions}
                onSave={async (input, isEditing) => {
                    if (isEditing && editing) {
                        await updateRecipeMutation.mutateAsync({ id: editing.id, input: input as RecipeUpdateInput });
                    } else {
                        await createRecipeMutation.mutateAsync(input as RecipeCreateInput);
                    }
                }}
            />
            <RecipeActionDialog
                open={actionOpen}
                title="حذف الوصفة"
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={deleteRecipeMutation.isPending}
                confirmLabel="حذف"
            />
            <RecipeBomDialog
                open={bomOpen}
                row={bomRow}
                locked={false}
                canBom={canBom}
                onClose={() => { setBomOpen(false); setBomRow(null); }}
                onCloseUpdate={() => {
                    void recipesQuery.refetch();
                    void catalogQuery.refetch();
                    setBomOpen(false);
                    setBomRow(null);
                    toast({ title: 'تم تحديث تكلفت الوصفة', variant: 'success' });
                }}
            />
        </div>
    );
}
