import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { formatMoney, parseArabicDecimal } from '../lib/format';
import { fetchMyPermissions } from '../lib/my-menus';
import { printSmart } from '../lib/print-viewer';
import { presetRange } from '../lib/reporting';
import { vegAnalysisPrintHtml } from '../lib/veg-analysis-print';
import { vegRequestPrintHtml } from '../lib/veg-print';
import {
    fetchVegConsumption,
    fetchVegRequests,
    priorityLabel,
    searchVegRequests,
    VEG_FILTER_LABELS,
    VEG_STATUS_FILTERS,
    type VegRequestRow,
    type VegStatusFilter,
    vegRequestToRow,
    vegStatusCounts,
} from '../lib/veg-requests';
import {
    cancelVegRequest,
    createVegRequest,
    deleteVegRequest,
    editVegItems,
    fetchVegCatalog,
    fetchVegContacts,
    markVegPrinted,
    notifyVegRequest,
    priceVegRequest,
    receiveVegRequest,
    saveVegContacts,
    VEG_TEXT,
    type VegCatalog,
    type VegContacts,
    type VegItemInput,
    vegCancelConfirm,
    vegCreateVisible,
    vegDeleteConfirm,
    vegPriceVisible,
    vegReceiveVisible,
} from '../lib/veg-requests-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { AnswerStrip, ScreenHero } from '../ui';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { StatCard } from '../ui/StatCard';
import { useToast } from '../ui/Toast';

/**
 * طلبات شراء الخضار — CRUD كامل مثل V2:
 *  • إنشاء طلب (POST /api/veg-requests — sous_chef|admin|owner)
 *  • استلام (POST /api/veg-requests/:id/receive — sous_chef|admin|owner)
 *  • تسعير (POST /api/veg-requests/:id/price — warehouse|admin|owner|manager)
 *  • تعديل الكميات (PUT /api/veg-requests/:id/items — sous_chef|admin|owner)
 *  • إلغاء (POST /api/veg-requests/:id/cancel — admin/owner لأي حالة، وبقية الأدوار للمعلق فقط)
 *  • حذف نهائي (DELETE /api/veg-requests/:id — admin/owner فقط؛ يرفض لو الطلبية له فاتورة مورد أو قيد محاسبي)
 *  • طباعة الطلب (ورقة A4 من صفّه + POST /api/veg-requests/:id/printed) وطباعة الشاشة (PrintActions)
 *
 * القراءة من `/api/veg-requests`، والكتابة محجوزة للأدوار أعلاه والخادم يحسم.
 */

const PAGE_SIZE = 25;

type SortKey = 'number' | 'itemsCount' | 'priority' | 'total' | 'by' | 'created' | 'status';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
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

/** شارة الحالة — pill بالدرجات المعتمدة في النظام (soft/text/border من @theme). */
function statusTone(status: string): string {
    const base = 'inline-flex items-center whitespace-nowrap rounded-full border px-sm py-xxs text-caption font-bold';
    if (status === 'received') {
        return `${base} border-success bg-success-soft text-success-text`;
    }
    if (status === 'priced') {
        return `${base} border-info bg-info-soft text-info-text`;
    }
    if (status === 'pending') {
        return `${base} border-warning bg-warning-soft text-warning-text`;
    }
    if (status === 'cancelled') {
        return `${base} border-danger bg-danger-soft text-danger-text`;
    }
    return `${base} border-hairline bg-surface-sunken text-muted`;
}

function compare(a: VegRequestRow, b: VegRequestRow, key: SortKey): number {
    if (key === 'number') {
        return a.number.localeCompare(b.number, 'en');
    }
    if (key === 'itemsCount') {
        return a.itemsCount - b.itemsCount;
    }
    if (key === 'priority') {
        return Number(a.urgent) - Number(b.urgent);
    }
    if (key === 'total') {
        return Number(a.total ?? -1) - Number(b.total ?? -1);
    }
    if (key === 'created') {
        return a.created.localeCompare(b.created);
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    return a.by.localeCompare(b.by, 'ar');
}

/* ── نموذج إنشاء طلب ─────────────────────────────────────────────────────── */

interface CreateDialogProps {
    open: boolean;
    catalog: VegCatalog | null;
    catalogLoading: boolean;
    pending: boolean;
    onClose: () => void;
    onSubmit: (items: VegItemInput[], priority: 'normal' | 'urgent', notes: string) => Promise<void>;
}

const CREATE_FORM_ID = 'erp-veg-create-form';

function CreateDialog({ open, catalog, catalogLoading, pending, onClose, onSubmit }: CreateDialogProps) {
    const [lines, setLines] = useState<VegItemInput[]>([]);
    const [manualRows, setManualRows] = useState<Array<{ id: number; name: string; qty: string; unit: string; note: string }>>([]);
    const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
    const [notes, setNotes] = useState('');
    const [selected, setSelected] = useState('');
    const [category, setCategory] = useState('');
    const [qty, setQty] = useState('1');
    const [unit, setUnit] = useState('كجم');
    const [error, setError] = useState('');

    const MANUAL_UNITS = ['كجم', 'جرام', 'طن', 'كرتونة', 'ربطة', 'حبة', 'صندوق', 'كيس', 'شيكارة', 'لتر', 'جالون', 'وحدة'];

    const categoryNames = useMemo(() => (catalog ? Object.keys(catalog.categories) : []), [catalog]);
    const activeCategory = category && categoryNames.includes(category) ? category : (categoryNames[0] ?? '');
    const itemsForCategory = useMemo(() => catalog?.categories[activeCategory] ?? [], [catalog, activeCategory]);

    useEffect(() => {
        if (open) {
            setLines([]);
            setManualRows([]);
            setPriority('normal');
            setNotes('');
            setSelected('');
            setCategory('');
            setQty('1');
            setUnit('كجم');
            setError('');
        }
    }, [open]);

    // عند وصول الكتالوج: كل فئة تُعرض كما هي في الورقة الرسمية، مع الوحدة الافتراضية للصنف الملتقى
    useEffect(() => {
        if (!catalog) return;
        const keys = Object.keys(catalog.categories);
        if (keys.length && !keys.includes(category)) {
            setCategory(keys[0] ?? '');
        }
    }, [catalog]);

    function addLine() {
        setError('');
        const q = parseArabicDecimal(qty);
        if (!selected) {
            setError('اختر الصنف من الكتالوج');
            return;
        }
        if (!Number.isFinite(q) || q < 0) {
            setError('أدخل كمية صحيحة (صفر يعني بلا كمية)');
            return;
        }
        if (lines.some((line) => line.name === selected)) {
            setError('الصنف موجود بالفعل في الطلب');
            return;
        }
        setLines((previous) => [...previous, { name: selected, qty: q, unit: unit.trim() || 'كجم' }]);
        setSelected('');
        setQty('1');
    }

    function collectManualItems(): { ok: true; items: VegItemInput[] } | { ok: false; error: string } {
        const filled: VegItemInput[] = [];
        for (const row of manualRows) {
            const name = row.name.trim();
            const qtyNum = parseArabicDecimal(row.qty, 0);
            const note = row.note.trim();
            if (!name && !row.qty.trim() && !row.unit.trim() && !note) {
                continue;
            }
            if (!name) {
                return { ok: false, error: 'صنف يدوي ناقص الاسم' };
            }
            if (!Number.isFinite(qtyNum) || qtyNum < 0 || qtyNum > 99999) {
                return { ok: false, error: `كمية الصنف اليدوي «${name}» غير صحيحة` };
            }
            if ([...lines, ...filled].some((l) => l.name === name)) {
                return { ok: false, error: `الصنف «${name}» مكرر` };
            }
            filled.push({ name, qty: Math.round(qtyNum * 1000) / 1000, unit: row.unit || 'وحدة', note: note || null });
        }
        return { ok: true, items: filled };
    }

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const manual = collectManualItems();
        if (!manual.ok) {
            setError(manual.error);
            return;
        }
        const payload = [...lines, ...manual.items];
        if (!payload.length) {
            setError(VEG_TEXT.itemsRequired);
            return;
        }
        try {
            await onSubmit(payload, priority, notes);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="طلب خضار جديد"
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_FORM_ID} size="sm" loading={pending}>
                        إرسال الطلب
                    </Button>
                </>
            }
        >
            <form id={CREATE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-[1fr_1.3fr_96px_96px]">
                    <Select
                        label="القسم"
                        name="category"
                        value={activeCategory}
                        onValueChange={(value) => {
                            setCategory(String(value ?? ''));
                            setSelected('');
                        }}
                        options={categoryNames.map((label) => ({ label, value: label }))}
                    />
                    <Select
                        label="الصنف من الكتالوج"
                        name="item"
                        value={selected}
                        onValueChange={(value) => {
                            const next = String(value ?? '');
                            setSelected(next);
                            const found = itemsForCategory.find((candidate) => candidate.name === next);
                            if (found) {
                                setUnit(found.unit);
                            }
                        }}
                        options={itemsForCategory.map((item) => ({ label: `${item.name} — ${item.unit}`, value: item.name }))}
                    />
                    <Input
                        label="الكمية"
                        name="qty"
                        type="number"
                        min={0}
                        step={0.001}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                    />
                    <Input label="الوحدة" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="كجم" />
                </div>
                <div>
                    <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                        إضافة الصنف
                    </Button>
                </div>

                {/* ── أصناف يدوية خارج الكتالوج (زي v2) ── */}
                <div className="rounded-md border border-dashed border-hairline p-sm">
                    <div className="mb-xs flex flex-wrap items-center justify-between gap-sm">
                        <span className="text-label-md text-muted">أصناف من خارج الكتالوج</span>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                                setManualRows((prev) => [
                                    ...prev,
                                    { id: Date.now() + prev.length, name: '', qty: '1', unit: 'كجم', note: '' },
                                ])
                            }
                        >
                            + أضف صنف يدوي
                        </Button>
                    </div>
                    {manualRows.length ? (
                        <ul className="flex flex-col gap-xxs">
                            {manualRows.map((row) => (
                                <li key={row.id} className="grid grid-cols-1 items-end gap-xs sm:grid-cols-[1fr_90px_90px_1fr_auto]">
                                    <Input
                                        label="الصنف"
                                        name={`manual-name-${row.id}`}
                                        value={row.name}
                                        onChange={(e) =>
                                            setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))
                                        }
                                        placeholder="اكتب اسم الصنف…"
                                    />
                                    <Input
                                        label="الكمية"
                                        name={`manual-qty-${row.id}`}
                                        type="number"
                                        min={0}
                                        step={0.001}
                                        value={row.qty}
                                        onChange={(e) =>
                                            setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, qty: e.target.value } : r)))
                                        }
                                    />
                                    <Select
                                        label="الوحدة"
                                        name={`manual-unit-${row.id}`}
                                        value={row.unit}
                                        onValueChange={(value) =>
                                            setManualRows((prev) =>
                                                prev.map((r) => (r.id === row.id ? { ...r, unit: String(value ?? 'وحدة') } : r)),
                                            )
                                        }
                                        options={MANUAL_UNITS.map((u) => ({ label: u, value: u }))}
                                    />
                                    <Input
                                        label="ملاحظة (اختياري)"
                                        name={`manual-note-${row.id}`}
                                        value={row.note}
                                        onChange={(e) =>
                                            setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, note: e.target.value } : r)))
                                        }
                                        placeholder="زي: حظ كبير / عريض"
                                    />
                                    <button
                                        type="button"
                                        className="pb-xxs text-danger-text"
                                        onClick={() => setManualRows((prev) => prev.filter((r) => r.id !== row.id))}
                                    >
                                        إزالة
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>

                {catalogLoading ? <p className="text-body-sm text-muted">جارٍ تحميل الكتالوج…</p> : null}

                {lines.length ? (
                    <ul className="flex flex-col gap-xxs">
                        {lines.map((line) => (
                            <li
                                key={line.name}
                                className="flex items-center justify-between gap-sm rounded-md bg-surface-sunken px-sm py-xxs text-body-sm"
                            >
                                <span className="text-ink">{line.name}</span>
                                <span className="erp-numeric text-muted" dir="ltr">
                                    {line.qty} {line.unit}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setLines((previous) => previous.filter((entry) => entry.name !== line.name))}
                                    className="text-danger-text"
                                >
                                    إزالة
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-body-sm text-muted">لم تُضف أصناف بعد — اختر من الكتالوج أعلاه أو أضف صنفًا يدويًا (زي v2).</p>
                )}

                <Select
                    label="الأولوية"
                    name="priority"
                    value={priority}
                    onValueChange={(value) => setPriority(value === 'urgent' ? 'urgent' : 'normal')}
                    options={[
                        { label: 'عادي', value: 'normal' },
                        { label: 'عاجل', value: 'urgent' },
                    ]}
                />
                <Input
                    label="ملاحظات (اختياري)"
                    name="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ملاحظات الطلب…"
                />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج استلام الطلب ──────────────────────────────────────────────── */

interface ReceiveDialogProps {
    open: boolean;
    row: VegRequestRow | null;
    items: ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>;
    pending: boolean;
    receiverName?: string | undefined;
    onClose: () => void;
    onSubmit: (payload: { quantities: Array<{ name: string; receivedQty: number }>; rejections: string[] }) => Promise<void>;
}

const RECEIVE_FORM_ID = 'erp-veg-receive-form';

function ReceiveDialog({ open, row, items, pending, receiverName, onClose, onSubmit }: ReceiveDialogProps) {
    const [received, setReceived] = useState<Record<string, string>>({});
    const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
    const [confirmStage, setConfirmStage] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            const next: Record<string, string> = {};
            for (const item of items) {
                next[item.name] = '';
            }
            setReceived(next);
            setRejected(new Set());
            setConfirmStage(false);
            setError('');
        }
    }, [open, items]);

    const stats = useMemo(() => {
        let asked = 0,
            got = 0,
            spoiled = 0,
            rejectedCount = 0,
            over = 0;
        for (const item of items) {
            const q = Number(item.qty) || 0;
            const g = parseArabicDecimal(received[item.name]);
            asked += q;
            if (Number.isFinite(g) && g >= 0) {
                got += g;
            }
            spoiled += Math.max(0, q - (Number.isFinite(g) && g >= 0 ? g : 0));
            if (Number.isFinite(g) && g > q) {
                over += g - q;
            }
            if (rejected.has(item.name)) {
                rejectedCount += 1;
            }
        }
        return {
            asked: Math.round(asked * 1000) / 1000,
            got: Math.round(got * 1000) / 1000,
            spoiled: Math.round(spoiled * 1000) / 1000,
            rejectedCount,
            over: Math.round(over * 1000) / 1000,
        };
    }, [items, received, rejected]);

    function tabularNumber(v: string | undefined): number {
        // الخانة الفاضية = صفر (بلا كمية) — مقبولة في الاستلام.
        return parseArabicDecimal(v, 0);
    }

    async function doSubmit(): Promise<void> {
        setError('');
        const quantities: Array<{ name: string; receivedQty: number }> = [];
        for (const item of items) {
            if (rejected.has(item.name)) {
                continue;
            }
            if (!String(received[item.name] ?? '').trim()) {
                setError(`أدخل الكمية المستلمة للصنف «${item.name}» — اكتب صفرًا إذا لم تستلم منه`);
                return;
            }
            const g = tabularNumber(received[item.name]);
            if (!Number.isFinite(g) || g < 0 || g > 1000000) {
                setError(`كمية الاستلام للصنف «${item.name}» غير صحيحة`);
                return;
            }
            quantities.push({ name: item.name, receivedQty: Math.round(g * 1000) / 1000 });
        }
        try {
            await onSubmit({ quantities, rejections: [...rejected] });
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, 'تعذر تأكيد الاستلام — حاول مرة أخرى'));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={row ? `استلام الطلب — ${row.number}` : 'استلام الطلب'}
            size="lg"
            footer={
                confirmStage ? (
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmStage(false)}>
                            رجوع للتعديل
                        </Button>
                        <Button type="button" size="sm" variant="danger" loading={pending} onClick={() => void doSubmit()}>
                            تأكيد الاستلام النهائي
                        </Button>
                    </>
                ) : (
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                            {VEG_TEXT.cancel}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                if (!items.length) {
                                    setError('لا توجد أصناف في الطلب');
                                    return;
                                }
                                for (const item of items) {
                                    if (rejected.has(item.name)) {
                                        continue;
                                    }
                                    if (!String(received[item.name] ?? '').trim()) {
                                        setError(`أدخل الكمية المستلمة للصنف «${item.name}» — اكتب صفرًا إذا لم تستلم منه`);
                                        return;
                                    }
                                    const g = tabularNumber(received[item.name]);
                                    if (!Number.isFinite(g) || g < 0 || g > 1000000) {
                                        setError(`كمية الاستلام للصنف «${item.name}» غير صحيحة`);
                                        return;
                                    }
                                }
                                setConfirmStage(true);
                            }}
                        >
                            استكمال ←
                        </Button>
                    </>
                )
            }
        >
            <form id={RECEIVE_FORM_ID} onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-sm">
                {!confirmStage ? (
                    <>
                        <div className="rounded-md border border-hairline bg-surface-sunken p-sm">
                            <p className="text-label-md font-bold text-ink">السو شيف — تسجيل ما وصل بالفعل</p>
                            <p className="text-body-xs leading-relaxed text-muted">
                                اكتب الكمية المستلمة فعليًا لكل صنف — زيادة عن المطلوب مقبولة بالكامل وستُحمَّل على الاستلام والتسعير — والصنف
                                المرفوض يستبعد بالكامل.
                            </p>
                        </div>

                        <div className="overflow-hidden rounded-md border border-hairline">
                            <table className="w-full border-collapse text-body-sm">
                                <thead>
                                    <tr className="bg-surface-sunken text-caption font-bold text-muted">
                                        <th scope="col" className="px-sm py-xs text-start">
                                            #
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الصنف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end">
                                            المطلوب
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end">
                                            المستلم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end">
                                            التالف / زيادة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center">
                                            مرفوض
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, idx) => {
                                        const asked = Number(item.qty) || 0;
                                        const got = parseArabicDecimal(received[item.name]);
                                        const gotSafe = Number.isFinite(got) && got >= 0 ? got : 0;
                                        const spoiled = Math.max(0, Math.round((asked - gotSafe) * 1000) / 1000);
                                        const over = gotSafe > asked ? Math.round((gotSafe - asked) * 1000) / 1000 : 0;
                                        const isRejected = rejected.has(item.name);
                                        return (
                                            <tr
                                                key={item.name}
                                                className={`border-t border-hairline ${isRejected ? 'bg-red-50/40 opacity-70' : ''}`}
                                            >
                                                <td className="px-sm py-xs text-caption text-faint">{idx + 1}</td>
                                                <td className="px-sm py-xs font-semibold text-ink">{item.name}</td>
                                                <td className="erp-numeric px-sm py-xs text-end text-ink" dir="ltr">
                                                    {asked.toLocaleString('en-US', { maximumFractionDigits: 3 })} {item.unit ?? ''}
                                                </td>
                                                <td className="px-sm py-xs">
                                                    <Input
                                                        aria-label={`المستلم من ${item.name}`}
                                                        name={`received-${item.name}`}
                                                        type="number"
                                                        min={0}
                                                        step={0.001}
                                                        inputMode="decimal"
                                                        aria-required={!isRejected}
                                                        placeholder="اكتب الكمية المستلمة"
                                                        className="text-end tabular-nums"
                                                        value={received[item.name] ?? ''}
                                                        onChange={(e) =>
                                                            setReceived((previous) => ({ ...previous, [item.name]: e.target.value }))
                                                        }
                                                        disabled={isRejected}
                                                        dir="ltr"
                                                    />
                                                </td>
                                                <td className="erp-numeric px-sm py-xs text-end font-bold" dir="ltr">
                                                    {spoiled > 0 ? (
                                                        <span className="text-danger-text">
                                                            -{spoiled.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                                        </span>
                                                    ) : over > 0 ? (
                                                        <span className="text-success-text">
                                                            +{over.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                                        </span>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                                <td className="px-sm py-xs text-center">
                                                    <label className="inline-flex cursor-pointer items-center gap-xxs text-caption text-danger-text">
                                                        <input
                                                            type="checkbox"
                                                            checked={isRejected}
                                                            onChange={(e) => {
                                                                const checked = e.target.checked;
                                                                setRejected((prev) => {
                                                                    const next = new Set(prev);
                                                                    if (checked) {
                                                                        next.add(item.name);
                                                                    } else {
                                                                        next.delete(item.name);
                                                                    }
                                                                    return next;
                                                                });
                                                            }}
                                                        />
                                                        مرفوض
                                                    </label>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-hairline-strong bg-surface-sunken">
                                        <td colSpan={2} className="px-sm py-xs text-body-sm font-bold text-ink">
                                            الإجمالي
                                        </td>
                                        <td className="erp-numeric px-sm py-xs text-end text-body-sm text-ink" dir="ltr">
                                            {stats.asked.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                        </td>
                                        <td className="erp-numeric px-sm py-xs text-end font-extrabold text-success-text" dir="ltr">
                                            {stats.got.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                        </td>
                                        <td className="erp-numeric px-sm py-xs text-end font-bold text-ink" dir="ltr">
                                            {stats.spoiled > 0 ? (
                                                `-${stats.spoiled.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
                                            ) : stats.over > 0 ? (
                                                <span className="text-success-text">
                                                    +{stats.over.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                                </span>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        {error ? (
                            <p role="alert" className="text-body-sm text-danger-text">
                                {error}
                            </p>
                        ) : null}
                        <p className="text-body-xs text-faint">
                            الاستلام بواسطة: {receiverName ?? '…'} — التالف يُوثَّق ولا يُسعَّر ولا يُحمّل على المطبخ.
                        </p>
                    </>
                ) : (
                    <div className="flex flex-col gap-sm">
                        <p className="text-label-md font-bold text-ink">تأكيد الاستلام النهائي — راجع قبل ما يتسجل</p>
                        <div className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm text-ink">
                            <p className="mb-xs font-semibold">ملخص ما سيتم تسجيله:</p>
                            <ul className="list-disc ps-5 leading-relaxed text-muted">
                                <li>
                                    أصناف سيتم استلامها: <b className="text-ink">{items.length - stats.rejectedCount} صنف</b>
                                </li>
                                <li>
                                    الكمية المستلمة الكلية:{' '}
                                    <b className="text-ink" dir="ltr">
                                        {stats.got.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                    </b>
                                </li>
                                <li>
                                    التالف والموثق:{' '}
                                    <b className="text-ink" dir="ltr">
                                        {stats.spoiled.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                    </b>
                                </li>
                                <li>
                                    زيادة عن المطلوب (مقبولة بالكامل):{' '}
                                    <b className="text-ink" dir="ltr">
                                        {stats.over > 0 ? `+${stats.over.toLocaleString('en-US', { maximumFractionDigits: 3 })}` : '—'}
                                    </b>
                                </li>
                                <li>
                                    أصناف مرفوضة كاملة: <b className="text-ink">{stats.rejectedCount}</b>
                                </li>
                            </ul>
                            <p className="mt-xs text-body-xs text-faint">
                                مرفوض = ممنوع تمامًا من التسعير والترحيل — يُعتبر غير موجود نهائيًا.
                            </p>
                        </div>
                        {error ? (
                            <p role="alert" className="text-body-sm text-danger-text">
                                {error}
                            </p>
                        ) : null}
                    </div>
                )}
            </form>
        </Dialog>
    );
}

/* ── نموذج تعديل كميات ──────────────────────────────────────────────────── */

interface EditItemsDialogProps {
    open: boolean;
    row: VegRequestRow | null;
    items: ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>;
    pending: boolean;
    onClose: () => void;
    onSubmit: (items: VegItemInput[]) => Promise<void>;
}

const EDIT_FORM_ID = 'erp-veg-edit-form';

function EditItemsDialog({ open, row, items, pending, onClose, onSubmit }: EditItemsDialogProps) {
    const [qtys, setQtys] = useState<Record<string, string>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            const next: Record<string, string> = {};
            for (const item of items) {
                next[item.name] = String(item.qty);
            }
            setQtys(next);
            setError('');
        }
    }, [open, items]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const payload: VegItemInput[] = [];
        for (const item of items) {
            const q = parseArabicDecimal(qtys[item.name], 0);
            if (!Number.isFinite(q) || q < 0) {
                setError(`كمية غير صالحة للصنف ${item.name}`);
                return;
            }
            payload.push({ name: item.name, qty: q, unit: item.unit });
        }
        try {
            await onSubmit(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.editFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={row ? `تعديل كميات ${row.number}` : 'تعديل كميات'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={EDIT_FORM_ID} size="sm" loading={pending}>
                        حفظ الكميات
                    </Button>
                </>
            }
        >
            <form id={EDIT_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink-secondary">
                    إضافة أصناف جديدة مرفوضة — احتاج طلبًا جديدًا. الكميات تُوثَّق في سجل الطلب.
                </p>
                <ul className="flex flex-col gap-sm">
                    {items.map((item) => (
                        <li key={item.name} className="grid grid-cols-[1fr_120px] items-end gap-sm">
                            <span className="text-ink">{item.name}</span>
                            <Input
                                label="الكمية"
                                name={`qty-${item.name}`}
                                type="number"
                                min={0}
                                step={0.001}
                                value={qtys[item.name] ?? ''}
                                onChange={(e) => setQtys((previous) => ({ ...previous, [item.name]: e.target.value }))}
                            />
                        </li>
                    ))}
                </ul>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

interface PriceDialogProps {
    open: boolean;
    row: VegRequestRow | null;
    items: ReadonlyArray<{ name: string; qty: number; unit?: string | undefined; rejected?: boolean | undefined }>;
    pending: boolean;
    approverName?: string | undefined;
    onClose: () => void;
    onSubmit: (prices: { name: string; unitPrice: number; qty?: number | undefined }[]) => Promise<void>;
}

const PRICE_FORM_ID = 'erp-veg-price-form';

function PriceDialog({ open, row, items, pending, onClose, onSubmit }: PriceDialogProps) {
    const [prices, setPrices] = useState<Record<string, string>>({});
    // أمين المخزن يعدّل الوزن المستلم أثناء التسعير — القيمة تبدأ من وزن الاستلام.
    const [weights, setWeights] = useState<Record<string, string>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            const next: Record<string, string> = {};
            const nextWeights: Record<string, string> = {};
            for (const item of items) {
                next[item.name] = '';
                nextWeights[item.name] = String(item.qty);
            }
            setPrices(next);
            setWeights(nextWeights);
            setError('');
        }
    }, [open, items]);

    const weightOf = (item: { name: string; qty: number }): number => {
        const raw = String(weights[item.name] ?? '').trim();
        const parsed = raw ? parseArabicDecimal(raw) : 0;
        // الصفر أو الخانة الفاضية = بلا كمية، ويُقبل كما هو.
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100000 ? Math.round(parsed * 1000) / 1000 : Number.NaN;
    };

    const moneyFmt = (value: number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const math = useMemo(() => {
        let total = 0;
        const lines = items.map((item) => {
            if (item.rejected) {
                return { item, raw: '', price: null, valid: true, lineTotal: null };
            }
            const raw = String(prices[item.name] ?? '').trim();
            const price = raw === '' ? null : Number(raw);
            const qty = weightOf(item);
            const valid =
                price !== null &&
                Number.isFinite(price) &&
                price >= 0 &&
                price <= 1000000 &&
                Number.isFinite(qty) &&
                qty >= 0 &&
                qty <= 100000;
            const lineTotal = valid ? Math.round((price ?? 0) * qty * 100) / 100 : null;
            if (lineTotal !== null) {
                total += lineTotal;
            }
            return { item, raw, price, valid, lineTotal, qty };
        });
        const unpriced = lines.reduce((count, l) => count + (l.item.rejected || l.valid ? 0 : 1), 0);
        return { total: Math.round(total * 100) / 100, unpriced, lines };
    }, [items, prices, weights]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!items.length) {
            setError('لا توجد أصناف في الطلب');
            return;
        }
        const payload: { name: string; unitPrice: number; qty?: number | undefined }[] = [];
        for (const item of items) {
            if (item.rejected) {
                continue;
            }
            const raw = String(prices[item.name] ?? '').trim();
            const price = Number(raw.replace(',', '.'));
            if (raw === '' || !Number.isFinite(price) || price < 0 || price > 1000000) {
                setError(`أدخل سعرًا صحيحًا للصنف «${item.name}»`);
                return;
            }
            const qty = weightOf(item);
            if (qty < 0 || qty > 100000) {
                setError(`أدخل وزنًا صحيحًا للصنف «${item.name}»`);
                return;
            }
            payload.push({ name: item.name, unitPrice: Math.round(price * 100) / 100, qty });
        }
        try {
            await onSubmit(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.priceFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={row ? `التسعير والاعتماد — ${row.number}` : 'التسعير والاعتماد'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={PRICE_FORM_ID} size="md" loading={pending} disabled={!items.length || math.unpriced > 0}>
                        ✓ اعتمد وترحّل للمطبخ
                    </Button>
                </>
            }
        >
            <form id={PRICE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-hairline bg-surface-sunken p-sm">
                    <div className="min-w-0">
                        <p className="text-label-md font-bold text-ink">وزارة الحسابات ← الاعتماد السعري</p>
                        <p className="text-body-xs leading-relaxed text-muted">
                            سعر الوحدة لكل صنف مُستلم فقط. بضغطة واحدة يُقفل التسعير، ويُحمَّل الإجمالي كمصروف على قسم المطبخ تلقائيًا (category:
                            خضار، adjustment veg_request).
                        </p>
                    </div>
                    <div className="text-end">
                        <p className="text-caption text-muted">الإجمالي الحالي</p>
                        <p className="erp-numeric text-heading-lg font-extrabold text-success-text" dir="ltr">
                            {moneyFmt(math.total)} ر.س
                        </p>
                    </div>
                </div>

                <div className="overflow-hidden rounded-md border border-hairline">
                    <table className="w-full border-collapse text-body-sm">
                        <thead>
                            <tr className="bg-surface-sunken text-caption font-bold text-muted">
                                <th scope="col" className="px-sm py-xs text-start">
                                    #
                                </th>
                                <th scope="col" className="px-sm py-xs text-start">
                                    الصنف
                                </th>
                                <th scope="col" className="px-sm py-xs text-center">
                                    الوحدة
                                </th>
                                <th scope="col" className="px-sm py-xs text-end">
                                    الوزن المستلم (قابل للتعديل)
                                </th>
                                <th scope="col" className="px-sm py-xs text-end">
                                    سعر الوحدة (ر.س)
                                </th>
                                <th scope="col" className="px-sm py-xs text-end">
                                    الإجمالي (ر.س)
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => {
                                const isRejected = item.rejected === true;
                                const line =
                                    !isRejected && math
                                        ? (() => {
                                              const raw = String(prices[item.name] ?? '').trim();
                                              const price = raw === '' ? null : Number(raw);
                                              const qty = weightOf(item);
                                              const valid =
                                                  price !== null &&
                                                  Number.isFinite(price) &&
                                                  price >= 0 &&
                                                  price <= 1000000 &&
                                                  Number.isFinite(qty) &&
                                                  qty >= 0 &&
                                                  qty <= 100000;
                                              const lineTotal = valid ? Math.round((price ?? 0) * qty * 100) / 100 : null;
                                              return { raw, lineTotal };
                                          })()
                                        : { raw: '', lineTotal: null };
                                return (
                                    <tr key={item.name} className={`border-t border-hairline${isRejected ? ' bg-red-50/40' : ''}`}>
                                        <td className="px-sm py-xs text-caption text-faint">{idx + 1}</td>
                                        <td className={`px-sm py-xs font-semibold ${isRejected ? 'text-muted line-through' : 'text-ink'}`}>
                                            {item.name}
                                        </td>
                                        <td className="px-sm py-xs text-center text-muted">{item.unit ?? 'كجم'}</td>
                                        <td className="px-sm py-xs">
                                            <Input
                                                type="number"
                                                inputMode="decimal"
                                                min={0}
                                                max={100000}
                                                step={0.001}
                                                aria-label={`وزن ${item.name} المستلم`}
                                                disabled={isRejected}
                                                value={weights[item.name] ?? String(item.qty)}
                                                onChange={(event) => {
                                                    setWeights((current) => ({ ...current, [item.name]: event.target.value }));
                                                }}
                                                className="erp-numeric text-end"
                                                dir="ltr"
                                            />
                                        </td>
                                        <td className="px-sm py-xs">
                                            {isRejected ? (
                                                <span className="inline-flex rounded-full bg-red-100 px-sm py-xxs text-caption font-bold text-danger-text">
                                                    مرفوض — لا يُسعّر
                                                </span>
                                            ) : (
                                                <Input
                                                    aria-label={`سعر ${item.name}`}
                                                    name={`price-${item.name}`}
                                                    type="number"
                                                    min={0}
                                                    step={0.01}
                                                    inputMode="decimal"
                                                    className="text-end tabular-nums"
                                                    value={prices[item.name] ?? ''}
                                                    onChange={(e) =>
                                                        setPrices((previous) => ({ ...previous, [item.name]: e.target.value }))
                                                    }
                                                    dir="ltr"
                                                />
                                            )}
                                        </td>
                                        <td className="erp-numeric px-sm py-xs text-end font-bold text-ink" dir="ltr">
                                            {isRejected ? (
                                                <span className="text-muted">—</span>
                                            ) : line.lineTotal !== null ? (
                                                moneyFmt(line.lineTotal)
                                            ) : (
                                                <span className="text-muted">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-hairline-strong bg-surface-sunken">
                                <td colSpan={4} className="px-sm py-xs text-body-sm font-bold text-ink">
                                    الإجمالي النهائي
                                </td>
                                <td
                                    colSpan={2}
                                    className="erp-numeric px-sm py-xs text-end text-heading-md font-extrabold text-success-text"
                                    dir="ltr"
                                >
                                    {moneyFmt(math.total)} ر.س
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-sm">
                    <p className="text-body-sm text-muted">
                        {math.unpriced > 0
                            ? `متبقي ${math.unpriced} صنف بلا سعر — أكمل كل الأسعار للتسديد`
                            : '✓ كل الأصناف مسعرة — اضغط «اعتمد واترحّل للمطبخ»'}
                    </p>
                    <p className="text-body-xs text-faint">يحفظ مع الطلب رقم: {row?.number ?? ''}</p>
                </div>
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد ────────────────────────────────────────────────────── */

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    pending: boolean;
    onConfirm: () => Promise<void>;
    onClose: () => void;
}

function ConfirmDialog({ open, title, message, pending, onConfirm, onClose }: ConfirmDialogProps) {
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
                    {VEG_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={() => void onConfirm()}>
                    تأكيد
                </Button>
            </div>
        </Dialog>
    );
}

/* ── نافذة أرقام واتساب (مورد / مخزن) ───────────────────────────────── */

const CONTACTS_FORM_ID = 'erp-veg-contacts-form';

function VegContactsDialog({
    open,
    pending,
    current,
    onClose,
    onSave,
}: {
    open: boolean;
    pending: boolean;
    current: VegContacts | null;
    onClose: () => void;
    onSave: (value: VegContacts) => Promise<void>;
}) {
    const [supplier, setSupplier] = useState('');
    const [warehouse, setWarehouse] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setSupplier(current?.supplier_jid ?? '');
            setWarehouse(current?.warehouse_jid ?? '');
            setError('');
        }
    }, [open, current]);

    const valid = (digits: string) => {
        const clean = digits.replace(/\D/g, '');
        return clean === '' || (clean.length >= 7 && clean.length <= 13);
    };

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const supplierDigits = supplier.replace(/\D/g, '');
        const warehouseDigits = warehouse.replace(/\D/g, '');
        if (!valid(supplierDigits) || !valid(warehouseDigits)) {
            setError('رقم غير صالح — استخدم صيغة دولية بدون + أو 00 (مثال: 9665XXXXXXXX)');
            return;
        }
        if (!supplierDigits && !warehouseDigits) {
            setError('أدخل رقم المورد أو المخزن على الأقل');
            return;
        }
        try {
            await onSave({ supplier_jid: supplierDigits, warehouse_jid: warehouseDigits });
            onClose();
        } catch {
            setError('تعذر الحفظ — حاول مرة أخرى');
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title="أرقام واتساب — المورد والمخزن"
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CONTACTS_FORM_ID} size="sm" loading={pending}>
                        حفظ
                    </Button>
                </>
            }
        >
            <form id={CONTACTS_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <Input
                    label="واتساب المورد"
                    name="supplier_jid"
                    dir="ltr"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="مثال: 9665XXXXXXXX"
                />
                <Input
                    label="واتساب المخزن"
                    name="warehouse_jid"
                    dir="ltr"
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                    placeholder="مثال: 9665XXXXXXXX"
                />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function VegRequests() {
    const auth = useAuthState();
    const { toast } = useToast();
    const meQuery = useQuery({
        queryKey: ['permissions', 'me'],
        queryFn: ({ signal }) => fetchMyPermissions(signal),
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    const vegGrants = useMemo(() => new Set<string>(meQuery.data?.grants ?? []), [meQuery.data]);
    const canCreate = vegCreateVisible(auth.user?.role, auth.user?.dept_code, vegGrants);
    const canReceive = vegReceiveVisible(auth.user?.role, auth.user?.dept_code, vegGrants);
    const canPrice = vegPriceVisible(auth.user?.role);
    const isContactsAdmin = auth.user?.role === 'admin' || auth.user?.role === 'owner';
    const isAdmin = auth.user?.role === 'admin';

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<VegStatusFilter>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [printingId, setPrintingId] = useState<string | null>(null);

    const [createOpen, setCreateOpen] = useState(false);
    // تحليل الخضار (2026-11-21): المستلم/المستهلك/الرصيد لكل صنف في فترة
    const [analysisOpen, setAnalysisOpen] = useState(false);
    const [contactsOpen, setContactsOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editRow, setEditRow] = useState<VegRequestRow | null>(null);
    const [editItems, setEditItems] = useState<ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>>([]);
    const [priceOpen, setPriceOpen] = useState(false);
    const [priceRow, setPriceRow] = useState<VegRequestRow | null>(null);
    const [priceItems, setPriceItems] = useState<
        ReadonlyArray<{ name: string; qty: number; unit?: string | undefined; rejected?: boolean | undefined }>
    >([]);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<VegRequestRow | null>(null);
    const [actionKind, setActionKind] = useState<'cancel' | 'delete'>('cancel');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [receiveOpen, setReceiveOpen] = useState(false);
    const [receiveRow, setReceiveRow] = useState<VegRequestRow | null>(null);
    const [receiveItems, setReceiveItems] = useState<ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>>([]);

    const vegQuery = useQuery({
        queryKey: ['veg-requests', status],
        queryFn: ({ signal }) => fetchVegRequests(status, signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['settings-currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });
    const catalogQuery = useQuery({
        queryKey: ['veg-catalog'],
        queryFn: ({ signal }) => fetchVegCatalog(signal),
        staleTime: 5 * 60 * 1000,
    });
    const contactsQuery = useQuery({
        queryKey: ['veg-contacts'],
        queryFn: () => fetchVegContacts(),
        staleTime: 5 * 60 * 1000,
        enabled: isContactsAdmin,
        retry: 0,
    });
    const currency = String(currencyQuery.data ?? '');

    const allRows = useMemo(() => (vegQuery.data?.requests ?? []).map(vegRequestToRow), [vegQuery.data]);
    const counts = useMemo(() => vegStatusCounts(allRows), [allRows]);

    const search = useMemo(() => searchVegRequests(allRows, query), [allRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = Boolean(query || status !== 'all');

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function resetFilters() {
        setQuery('');
        setStatus('all');
        setSort(null);
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createMutation = useWriteMutation<{ items: VegItemInput[]; priority: 'normal' | 'urgent'; notes: string }, void>({
        mutationFn: (input) => createVegRequest(input).then(() => undefined),
        successTitle: () => VEG_TEXT.createSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const receiveMutation = useWriteMutation<
        { id: string | number; payload: { quantities: Array<{ name: string; receivedQty: number }>; rejections: string[] } },
        void
    >({
        mutationFn: ({ id, payload }) => receiveVegRequest(id, payload).then(() => undefined),
        successTitle: () => '✓ تم استلام الطلب',
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setReceiveOpen(false);
            setReceiveRow(null);
        },
    });

    const priceMutation = useWriteMutation<{ id: string; prices: { name: string; unitPrice: number; qty?: number | undefined }[] }, void>({
        mutationFn: ({ id, prices }) => priceVegRequest(id, prices).then(() => undefined),
        successTitle: () => VEG_TEXT.priceSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const editMutation = useWriteMutation<VegItemInput[], void>({
        mutationFn: (items) => editVegItems(editRow?.id ?? '', { items }).then(() => undefined),
        successTitle: () => VEG_TEXT.editSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setEditOpen(false);
            setEditRow(null);
        },
    });

    const cancelMutation = useWriteMutation<string, void>({
        mutationFn: (id) => cancelVegRequest(id).then(() => undefined),
        successTitle: () => VEG_TEXT.cancelSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const deleteMutation = useWriteMutation<string, void>({
        mutationFn: (id) => deleteVegRequest(id).then(() => undefined),
        successTitle: () => VEG_TEXT.deleteSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const notifyMutation = useWriteMutation<{ id: string; target: 'supplier' | 'warehouse' }, void>({
        mutationFn: ({ id, target }) => notifyVegRequest(id, target).then(() => undefined),
        successTitle: ({ target }) => (target === 'supplier' ? '📤 اتبعتت للمورد على واتساب' : '🏬 اتبعتت للمخزن على واتساب'),
        errorTitle: 'تعذر الإرسال على واتساب',
        invalidate: [],
    });

    const contactsMutation = useWriteMutation<VegContacts, void>({
        mutationFn: (value) => saveVegContacts(value).then(() => undefined),
        successTitle: () => '✓ اتحفظ أرقام الواتساب',
        errorTitle: 'تعذر حفظ الأرقام',
        invalidate: [['veg-contacts']],
        onSuccess: () => setContactsOpen(false),
    });

    async function openEdit(row: VegRequestRow) {
        // items details come from the list row; full items fetched on demand would need another endpoint.
        // The list already carries items via request payload — read from data cache.
        const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
        const items = Array.isArray(raw?.items)
            ? (raw.items as Array<{ name?: string; qty?: number; quantity?: number; unit?: string }>)
            : [];
        setEditRow(row);
        setEditItems(
            items.map((item) => ({
                name: String(item.name ?? ''),
                qty: Number(item.qty ?? item.quantity ?? 0),
                unit: item.unit ? String(item.unit) : undefined,
            })),
        );
        setEditOpen(true);
    }

    function openReceive(row: VegRequestRow) {
        const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
        const items = Array.isArray(raw?.items)
            ? (raw.items as Array<{ name?: string; qty?: number; quantity?: number; unit?: string; rejected?: boolean }>)
            : [];
        setReceiveRow(row);
        setReceiveItems(
            items.map((item) => ({
                name: String(item.name ?? ''),
                qty: Number(item.qty ?? item.quantity ?? 0),
                unit: item.unit ? String(item.unit) : undefined,
            })),
        );
        setReceiveOpen(true);
    }

    function openAction(row: VegRequestRow, kind: 'price' | 'cancel' | 'delete') {
        if (kind === 'price') {
            const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
            const items = Array.isArray(raw?.items)
                ? (raw.items as Array<{ name?: string; qty?: number; quantity?: number; unit?: string; rejected?: boolean }>)
                : [];
            setPriceRow(row);
            setPriceItems(
                items.map((item) => ({
                    name: String(item.name ?? ''),
                    qty: Number(item.qty ?? item.quantity ?? 0),
                    unit: item.unit ? String(item.unit) : undefined,
                    rejected: item.rejected === true,
                })),
            );
            setPriceOpen(true);
            return;
        }
        if (kind === 'delete') {
            setActionKind('delete');
            setActionTitle('حذف الطلب');
            setActionMessage(vegDeleteConfirm(row.number));
        } else {
            setActionKind('cancel');
            setActionTitle('إلغاء الطلب');
            setActionMessage(vegCancelConfirm(row.number));
        }
        setActionRow(row);
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        try {
            if (actionKind === 'delete') {
                await deleteMutation.mutateAsync(actionRow.id);
            } else {
                await cancelMutation.mutateAsync(actionRow.id);
            }
        } catch (error) {
            const fallback = actionKind === 'delete' ? 'تعذر حذف الطلب' : 'تعذر إلغاء الطلب';
            const message = error instanceof Error ? error.message : fallback;
            toast({ variant: 'error', title: fallback, description: message });
        }
    }

    function printRequest(row: VegRequestRow) {
        if (printingId) return;
        const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
        if (!raw) {
            toast({
                variant: 'error',
                title: 'تعذّرت طباعة الطلب',
                description: 'أعد تحميل السجل ثم حاول مرة أخرى.',
            });
            return;
        }
        setPrintingId(row.id);
        try {
            printSmart(
                vegRequestPrintHtml(raw, {
                    byName: String(auth.user?.name ?? auth.user?.username ?? ''),
                    currency,
                }),
            );
            void markVegPrinted(row.id).catch(() => undefined);
        } finally {
            setPrintingId(null);
        }
    }

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <ScreenHero
                title="طلبات شراء الخضار"
                english="VEGETABLE REQUESTS"
                description="طلبات المطبخ ← المخازن — إنشاء، استلام، تسعير."
                answer={
                    <AnswerStrip
                        items={[
                            {
                                label: 'بانتظار الاستلام',
                                english: 'Pending',
                                value: counts.pending,
                                format: formatInt,
                                hint: 'طلبات لم تُستلم بعد',
                                tone: 'warning',
                            },
                            { label: 'مستلمة', english: 'Received', value: counts.received, format: formatInt, hint: 'استلمها المخزن' },
                            { label: 'مُسعّرة', english: 'Priced', value: counts.priced, format: formatInt, hint: 'سعّرها المخزن' },
                            {
                                label: 'عاجلة',
                                english: 'Urgent',
                                value: counts.urgent,
                                format: formatInt,
                                hint: 'طلبات بعلامة الاستعجال',
                                tone: counts.urgent > 0 ? 'danger' : 'neutral',
                            },
                        ]}
                        columns={4}
                    />
                }
                actions={
                    <>
                        {canCreate ? (
                            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                                طلب جديد
                            </Button>
                        ) : null}
                        {isContactsAdmin ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => setContactsOpen(true)}
                                title="أرقام واتساب المورد والمخزن"
                            >
                                📞 أرقام واتساب
                            </Button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                setAnalysisOpen((open) => !open);
                            }}
                            aria-expanded={analysisOpen}
                            className={`rounded-md px-md py-xs text-button-md ${
                                analysisOpen
                                    ? 'bg-primary text-ink-inverse'
                                    : 'border border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            تحليل الخضار
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void vegQuery.refetch();
                            }}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                        >
                            تحديث
                        </button>
                    </>
                }
            />

            {analysisOpen ? <VegAnalysisPanel currency={currency} /> : null}

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-veg-q">
                        بحث
                        <input
                            id="erp-veg-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="رقم الطلب، المنشئ، الحالة، ملاحظات"
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <fieldset className="m-0 flex flex-wrap items-end gap-xxs border-0 p-0">
                        <legend className="sr-only">ترشيح حالة الطلب</legend>
                        {VEG_STATUS_FILTERS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={status === value}
                                onClick={() => {
                                    setStatus(value);
                                    setPage(1);
                                }}
                                className={
                                    status === value
                                        ? 'rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xxs text-body-sm text-ink'
                                        : 'rounded-md border border-transparent px-sm py-xxs text-body-sm text-muted hover:bg-surface-hover'
                                }
                            >
                                {VEG_FILTER_LABELS[value]}
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
                </div>
            </Card>

            <Card>
                {vegQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل طلبات الخضار" />
                        <TableSkeleton rows={4} columns={7} />
                    </div>
                ) : null}

                {vegQuery.isError ? (
                    <StateError
                        message={vegQuery.error instanceof Error ? vegQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void vegQuery.refetch();
                        }}
                    />
                ) : null}

                {vegQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا طلبات تطابق المرشّحات' : 'لا طلبات مسجّلة'}
                        hint={filtered ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.' : 'أنشئ أول طلب.'}
                    />
                ) : null}

                {vegQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <TableScroll label="سجل طلبات شراء الخضار">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="رقم الطلب" sortKey="number" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الأصناف" sortKey="itemsCount" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الأولوية" sortKey="priority" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الإجمالي" sortKey="total" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="أنشأها" sortKey="by" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="التاريخ" sortKey="created" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                            إجراءات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.number}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {formatInt(row.itemsCount)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {row.urgent ? (
                                                    <span className="text-danger-text">{priorityLabel(row)}</span>
                                                ) : (
                                                    <span className="text-muted">{priorityLabel(row)}</span>
                                                )}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {row.total === null ? (
                                                    <span className="text-muted">—</span>
                                                ) : (
                                                    <>
                                                        {formatMoney(row.total)}
                                                        {currency ? <span className="text-caption text-faint"> {currency}</span> : null}
                                                    </>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.by}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.created || '—'}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <span className={`text-body-sm ${statusTone(row.status)}`}>{row.statusLabel}</span>
                                            </td>
                                            <td className="px-sm py-xxs" data-erp-print-hide>
                                                <div className="flex flex-wrap items-center gap-xs">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="secondary"
                                                        title="طباعة ورقة الطلب"
                                                        onClick={() => printRequest(row)}
                                                    >
                                                        طباعة
                                                    </Button>
                                                    {isAdmin ? (
                                                        <>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="تعديل الطلبية كاملة (الأدمن)"
                                                                onClick={() => void openEdit(row)}
                                                            >
                                                                ✎ تعديل
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="إلغاء الطلبية (الأدمن) — الطلبية تبقى في السجل"
                                                                onClick={() => openAction(row, 'cancel')}
                                                            >
                                                                ✕ إلغاء
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف الطلبية نهائيًا (الأدمن) — تُمحى من السجل مع المصروف التلقائي المرتبط بها؛ يرفض لو لها فاتورة مورد أو قيد محاسبي"
                                                                onClick={() => openAction(row, 'delete')}
                                                            >
                                                                🗑 حذف
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                    {row.status !== 'cancelled' ? (
                                                        <>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="إرسال الطلبية للمورد على واتساب"
                                                                onClick={() => notifyMutation.mutate({ id: row.id, target: 'supplier' })}
                                                            >
                                                                📤 للمورد
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="إرسال الطلبية للمخزن على واتساب"
                                                                onClick={() => notifyMutation.mutate({ id: row.id, target: 'warehouse' })}
                                                            >
                                                                🏬 للمخزن
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                    {row.status === 'pending' && (
                                                        <>
                                                            {!isAdmin && canCreate ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="تعديل الكميات"
                                                                    onClick={() => void openEdit(row)}
                                                                >
                                                                    تعديل
                                                                </Button>
                                                            ) : null}
                                                            {canReceive ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="استلام الطلب"
                                                                    onClick={() => openReceive(row)}
                                                                >
                                                                    استلام
                                                                </Button>
                                                            ) : null}
                                                            {!isAdmin ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="إلغاء الطلب"
                                                                    onClick={() => openAction(row, 'cancel')}
                                                                >
                                                                    إلغاء
                                                                </Button>
                                                            ) : null}
                                                        </>
                                                    )}
                                                    {row.status === 'received' && canPrice ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="تسعير الطلب"
                                                            onClick={() => openAction(row, 'price')}
                                                        >
                                                            تسعير
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="text-body-sm text-muted">
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
            <CreateDialog
                open={createOpen}
                catalog={catalogQuery.data ?? null}
                catalogLoading={catalogQuery.isPending}
                pending={createMutation.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={async (items, priority, notes) => {
                    await createMutation.mutateAsync({ items, priority, notes });
                }}
            />
            <EditItemsDialog
                open={editOpen}
                row={editRow}
                items={editItems}
                pending={editMutation.isPending}
                onClose={() => {
                    setEditOpen(false);
                    setEditRow(null);
                }}
                onSubmit={async (items) => {
                    await editMutation.mutateAsync(items);
                }}
            />
            <PriceDialog
                open={priceOpen}
                row={priceRow}
                items={priceItems}
                pending={priceMutation.isPending}
                approverName={String(auth.user?.name ?? auth.user?.username ?? '')}
                onClose={() => {
                    setPriceOpen(false);
                    setPriceRow(null);
                }}
                onSubmit={async (prices) => {
                    if (!priceRow) return;
                    await priceMutation.mutateAsync({ id: priceRow.id, prices });
                }}
            />
            <ReceiveDialog
                open={receiveOpen}
                row={receiveRow}
                items={receiveItems}
                pending={receiveMutation.isPending}
                receiverName={String(auth.user?.name ?? auth.user?.username ?? '')}
                onClose={() => {
                    setReceiveOpen(false);
                    setReceiveRow(null);
                }}
                onSubmit={async (payload) => {
                    if (!receiveRow) return;
                    await receiveMutation.mutateAsync({ id: receiveRow.id, payload });
                }}
            />
            <ConfirmDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                pending={priceMutation.isPending || cancelMutation.isPending || deleteMutation.isPending}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
            />
            <VegContactsDialog
                open={contactsOpen}
                pending={contactsMutation.isPending}
                current={contactsQuery.data ?? null}
                onClose={() => setContactsOpen(false)}
                onSave={async (value) => {
                    await contactsMutation.mutateAsync(value);
                }}
            />
        </div>
    );
}

/* ─── تحليل الخضار — المستلم/المستهلك/الرصيد لكل صنف (2026-11-21) ───────── */

const ANALYSIS_PRESETS: ReadonlyArray<{ preset: 'today' | 'week' | 'month' | 'year'; label: string }> = [
    { preset: 'today', label: 'اليوم' },
    { preset: 'week', label: 'آخر ٧ أيام' },
    { preset: 'month', label: 'هذا الشهر' },
    { preset: 'year', label: 'هذا العام' },
];

function VegAnalysisPanel({ currency = '' }: { currency?: string }) {
    const auth = useAuthState();
    const [draft, setDraft] = useState(() => ({ from: presetRange('month').from, to: presetRange('month').to }));
    const [range, setRange] = useState(draft);
    const [q, setQ] = useState('');

    const analysisQuery = useQuery({
        queryKey: ['veg', 'consumption', range.from, range.to, q],
        queryFn: ({ signal }) => fetchVegConsumption(range.from, range.to, q, signal),
    });

    const data = analysisQuery.data;
    const rows = data?.rows ?? [];
    const totals = data?.totals;

    function applyPreset(preset: (typeof ANALYSIS_PRESETS)[number]['preset']) {
        const next = presetRange(preset);
        setDraft(next);
        setRange(next);
    }

    return (
        <Card className="flex flex-col gap-sm">
            <div className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    تحليل الخضار — استهلاك الأصناف{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        Veg Consumption
                    </span>
                </h2>
                <div className="flex flex-wrap items-center gap-xs">
                    <span className="text-body-sm text-muted" role="status" dir="ltr">
                        {`${range.from} → ${range.to}`}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!data || analysisQuery.isPending}
                        title="طباعة تقرير تحليل الخضار بالشعار والتفاصيل"
                        onClick={() => {
                            if (!data) {
                                return;
                            }
                            printSmart(
                                vegAnalysisPrintHtml(data, {
                                    byName: String(auth.user?.name ?? auth.user?.username ?? ''),
                                    currency,
                                }),
                            );
                        }}
                    >
                        🖨 طباعة التقرير
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-sm p-sm" data-erp-print-hide>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    من
                    <input
                        type="date"
                        value={draft.from}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, from: event.target.value }));
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    />
                </label>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    إلى
                    <input
                        type="date"
                        value={draft.to}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, to: event.target.value }));
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    />
                </label>
                <button
                    type="button"
                    onClick={() => {
                        setRange(draft);
                    }}
                    className="rounded-md bg-primary px-md py-xs text-button-md text-ink-inverse hover:bg-primary-strong"
                >
                    عرض
                </button>
                <div className="flex flex-wrap gap-xxs" role="group" aria-label="فترات جاهزة">
                    {ANALYSIS_PRESETS.map((preset) => (
                        <button
                            key={preset.preset}
                            type="button"
                            onClick={() => {
                                applyPreset(preset.preset);
                            }}
                            className={`rounded-md border px-sm py-xxs text-button-md ${
                                draft.from === presetRange(preset.preset).from && draft.to === presetRange(preset.preset).to
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-hairline-strong bg-surface text-muted hover:bg-surface-hover hover:text-ink'
                            }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    بحث عن صنف
                    <input
                        type="search"
                        value={q}
                        onChange={(event) => {
                            setQ(event.target.value);
                        }}
                        placeholder="مثال: طماطم"
                        className="h-9 w-56 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    />
                </label>
            </div>

            {analysisQuery.isPending ? <StateLoading label="جارٍ تحليل الخضار…" /> : null}
            {analysisQuery.isError ? (
                <StateError
                    message={analysisQuery.error instanceof Error ? analysisQuery.error.message : 'خطأ غير معروف'}
                    onRetry={() => {
                        void analysisQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm px-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات تحليل الخضار">
                        <StatCard
                            label="المستلم في الفترة"
                            english="Received"
                            value={`${totals ? Math.round(totals.receivedQty * 1000) / 1000 : 0} ${'كجم'}`}
                            hint={`بقيمة ${totals?.receivedValue ?? 0}`}
                        />
                        <StatCard
                            label="المستهلك في الفترة"
                            english="Consumed"
                            value={String(totals ? Math.round(totals.consumedQty * 1000) / 1000 : 0)}
                            hint="صرف مخزني + بيع + توليد + هالك"
                            tone="warning"
                        />
                        <StatCard
                            label="أصناف في التحليل"
                            english="Items"
                            value={String(totals?.items ?? 0)}
                            hint="أصناف الخضار المتتبعة"
                        />
                        <StatCard
                            label="الفترة"
                            english="Range"
                            value={`${data.from.slice(5)} ← ${data.to.slice(5)}`}
                            hint="حدّث الفترة من الأعلى"
                        />
                    </ul>

                    {rows.length === 0 ? (
                        <StateEmpty title="لا حركة خضار في الفترة" hint="غيّر الفترة أو امسح البحث." />
                    ) : (
                        <TableScroll label="جدول تحليل الخضار">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الصنف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الوحدة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المستلم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            قيمة المستلم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المستهلك
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            قيمة المستهلك
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الرصيد الحالي
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            متوسط التكلفة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            طلبات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr
                                            key={`${row.name}-${String(row.inventoryId ?? 'x')}`}
                                            className="border-b border-hairline hover:bg-surface-hover"
                                        >
                                            <td className="px-sm py-xxs text-ink">{row.name}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.unit || 'كجم'}</td>
                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                {Math.round(row.receivedQty * 1000) / 1000}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                {String(row.receivedValue)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs font-medium" dir="ltr">
                                                {Math.round(row.consumedQty * 1000) / 1000}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                {String(row.consumedValue)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                {Math.round(row.onHand * 1000) / 1000}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                {String(row.avgCost)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                {row.requests}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                    <p className="px-sm pb-xs text-caption text-faint">
                        المستلم من سجل الطلبيات المسلمة/المعتمدة في الفترة؛ المستهلك من دفتر حركات المخزون (صرف، بيع، توليد، هالك)؛ الرصيد
                        ومتوسط التكلفة لحظة العرض.
                    </p>
                </>
            ) : null}
        </Card>
    );
}
