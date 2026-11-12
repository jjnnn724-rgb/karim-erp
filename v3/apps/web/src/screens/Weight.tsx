import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import './Weight.premium.css';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { formatInt, formatQty } from '../lib/inventory-register';
import {
    fetchWeightReadings,
    localToday,
    readingsSummary,
    readingToRow,
    searchWeightReadings,
    WEIGHT_UNIT_LABELS,
    WEIGHT_UNITS,
    type WeightReadingRow,
} from '../lib/weight';
import {
    createWeightReading,
    deleteWeightReading,
    updateWeightReading,
    WEIGHT_TEXT,
    type WeightCreateInput,
    weightWriteVisible,
} from '../lib/weight-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * الميزان — سجل قراءات الوزن، قراءة فقط من `/api/weightReadings`.
 *
 * نفس مؤشرات الشاشة القديمة (`frontend/app/js/v2/screens/weight.js:44-55`):
 * «قراءات اليوم» و«إجمالي القراءات» و«إجمالي الوزن» بالكيلوجرام بعد تحويل
 * الجرام والرطل و«آخر قراءة»؛ والجدول يعرض التاريخ والوقت والوزن بوحدته
 * وبالكيلوجرام والصنف والملاحظات ومن سجّلها.
 *
 * القديم يعرض آخر 30 قراءة؛ هنا السجل كامل مع تصفّح 30 في الصفحة، فالصفحة
 * الأولى تطابق ما يعرضه القديم. تسجيل القراءة وإضافتها لوزن الصنف في V2 —
 * لا كتابة في v3.
 */

const PAGE_SIZE = 30;

type SortKey = 'date' | 'time' | 'weight' | 'kg' | 'item';

type UnitFilter = 'all' | (typeof WEIGHT_UNITS)[number];

const UNIT_FILTERS: readonly UnitFilter[] = ['all', ...WEIGHT_UNITS];

const UNIT_LABELS: Record<UnitFilter, string> = {
    all: 'الكل',
    ...WEIGHT_UNIT_LABELS,
};

function Kpi({ label, english, value, suffix, hint }: { label: string; english: string; value: string; suffix?: string; hint: string }) {
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
                {suffix ? <span className="text-body-sm text-muted"> {suffix}</span> : null}
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

function compare(a: WeightReadingRow, b: WeightReadingRow, key: SortKey): number {
    if (key === 'date') {
        return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`, 'en');
    }
    if (key === 'time') {
        return a.time.localeCompare(b.time, 'en') || a.date.localeCompare(b.date, 'en');
    }
    if (key === 'weight') {
        return a.weight - b.weight;
    }
    if (key === 'kg') {
        return (a.kg ?? -1) - (b.kg ?? -1);
    }
    return a.itemName.localeCompare(b.itemName, 'ar');
}

export function Weight() {
    const auth = useAuthState();
    const canWrite = weightWriteVisible(auth.user?.role);
    const [query, setQuery] = useState('');
    const [unit, setUnit] = useState<UnitFilter>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<WeightReadingRow | null>(null);
    const [pageError, setPageError] = useState('');

    const readingsQuery = useQuery({
        queryKey: ['weight-readings'],
        queryFn: ({ signal }) => fetchWeightReadings(signal),
    });

    const createMutation = useWriteMutation<WeightCreateInput, void>({
        mutationFn: (input) => createWeightReading(input).then(() => undefined),
        successTitle: () => WEIGHT_TEXT.createSuccess,
        invalidate: [['weight-readings']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const updateMutation = useWriteMutation<{ id: string; input: WeightCreateInput }, void>({
        mutationFn: ({ id, input }) => updateWeightReading(id, input).then(() => undefined),
        successTitle: () => WEIGHT_TEXT.updateSuccess,
        invalidate: [['weight-readings']],
        silentError: true,
        onSuccess: () => setEditing(null),
    });

    const deleteMutation = useWriteMutation<string, void>({
        mutationFn: (id) => deleteWeightReading(id),
        successTitle: () => WEIGHT_TEXT.deleteSuccess,
        invalidate: [['weight-readings']],
        silentError: true,
        onError: (cause) => setPageError(writeErrorMessage(cause, WEIGHT_TEXT.deleteFailed)),
        onSuccess: () => setPageError(''),
    });

    const allRows = useMemo(() => (readingsQuery.data ?? []).map(readingToRow), [readingsQuery.data]);
    const summary = useMemo(() => readingsSummary(readingsQuery.data ?? [], localToday()), [readingsQuery.data]);

    const filteredRows = useMemo(() => {
        if (unit === 'all') {
            return allRows;
        }
        return allRows.filter((row) => row.unit === unit);
    }, [allRows, unit]);

    const search = useMemo(() => searchWeightReadings(filteredRows, query), [filteredRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) {
            return rows;
        }
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = Boolean(query || unit !== 'all');

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function resetFilters() {
        setQuery('');
        setUnit('all');
        setSort(null);
        setPage(1);
    }

    const last = summary.last;
    const lastText = last ? `${last.date || '—'}${last.time ? ` · ${last.time}` : ''}` : '—';

    return (
        <div className="erp-premium-screen erp-premium-screen--weight flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الميزان{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Scale
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        سجل قراءات الوزن بوحداتها وبالكيلوجرام — تسجيل وتعديل وحذف. المجاميع تُحوَّل للكيلوجرام أولًا، والقراءة بوحدة غير معروفة
                        تُستبعد وتُعدّ ولا تُخمَّن.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            تسجيل قراءة جديدة
                        </Button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void readingsQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    <PrintActions title="الميزان" />
                </div>
            </header>
            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="قراءات اليوم" english="Today" value={formatInt(summary.todayCount)} hint="بتاريخ اليوم المحلي" />
                <Kpi label="إجمالي القراءات" english="Readings" value={formatInt(summary.count)} hint="كل ما وصل من الخادم" />
                <Kpi
                    label="إجمالي الوزن"
                    english="Total"
                    value={formatQty(summary.totalKg)}
                    suffix="كجم"
                    hint={
                        summary.unconverted
                            ? `بعد تحويل الجرام والرطل · ${formatInt(summary.unconverted)} قراءة بوحدة غير معروفة لم تُحوَّل`
                            : 'بعد تحويل الجرام والرطل — لا جمع وحدات مختلفة كما هي'
                    }
                />
                <Kpi label="آخر قراءة" english="Latest" value={lastText} hint="آخر ما وصل بترتيب الخادم" />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-weight-q">
                        بحث
                        <input
                            id="erp-weight-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="الصنف، الملاحظات، من سجّل، التاريخ"
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <fieldset className="m-0 flex flex-wrap items-end gap-xxs border-0 p-0">
                        <legend className="sr-only">ترشيح وحدة الوزن</legend>
                        {UNIT_FILTERS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={unit === value}
                                onClick={() => {
                                    setUnit(value);
                                    setPage(1);
                                }}
                                className={
                                    unit === value
                                        ? 'rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xxs text-body-sm text-ink'
                                        : 'rounded-md border border-transparent px-sm py-xxs text-body-sm text-muted hover:bg-surface-hover'
                                }
                            >
                                {UNIT_LABELS[value]}
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
                    <span className="text-body-sm text-muted" role="status" aria-live="polite">
                        {filtered
                            ? `${formatInt(sorted.length)} قراءة مطابقة من ${formatInt(allRows.length)}`
                            : `${formatInt(allRows.length)} قراءة محمّلة`}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.</p>
                ) : null}
            </Card>

            <Card>
                {readingsQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل قراءات الميزان" />
                        <TableSkeleton rows={4} columns={6} />
                    </div>
                ) : null}

                {readingsQuery.isError ? (
                    <StateError
                        message={readingsQuery.error instanceof Error ? readingsQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void readingsQuery.refetch();
                        }}
                    />
                ) : null}

                {readingsQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا قراءات تطابق المرشّحات' : 'لا قراءات مسجّلة'}
                        hint={filtered ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.' : 'لم تُسجَّل قراءات بعد.'}
                    />
                ) : null}

                {readingsQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <TableScroll label="سجل قراءات الميزان">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="التاريخ" sortKey="date" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الوقت" sortKey="time" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الوزن" sortKey="weight" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="بالكيلوجرام" sortKey="kg" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الصنف" sortKey="item" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            ملاحظات
                                        </th>
                                        {canWrite ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.date || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.time || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {formatQty(row.weight)} <span className="text-caption text-faint">{row.unitAr}</span>
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.kg === null ? <span className="text-muted">—</span> : formatQty(row.kg)}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.itemName || '—'}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.notes || '—'}
                                                {row.recordedBy ? (
                                                    <span className="text-caption text-faint"> · {row.recordedBy}</span>
                                                ) : null}
                                            </td>
                                            {canWrite ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="تعديل القراءة"
                                                            onClick={() => setEditing(row)}
                                                        >
                                                            تعديل
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="danger"
                                                            title="حذف القراءة"
                                                            disabled={deleteMutation.isPending}
                                                            onClick={() => {
                                                                if (window.confirm(`حذف القراءة «${row.id}»؟`)) {
                                                                    void deleteMutation.mutateAsync(row.id);
                                                                }
                                                            }}
                                                        >
                                                            حذف
                                                        </Button>
                                                    </div>
                                                </td>
                                            ) : null}
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

            {/* حوارات الكتابة */}
            <WeightFormDialog
                open={createOpen}
                editing={null}
                pending={createMutation.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={async (input) => {
                    await createMutation.mutateAsync(input);
                }}
            />
            <WeightFormDialog
                open={editing !== null}
                editing={editing}
                pending={updateMutation.isPending}
                onClose={() => setEditing(null)}
                onSubmit={async (input) => {
                    await updateMutation.mutateAsync({ id: editing!.id, input });
                }}
            />
        </div>
    );
}

/* ── حوار تسجيل/تعديل قراءة ───────────────────────────────────────────── */

interface WeightFormDialogProps {
    open: boolean;
    editing: WeightReadingRow | null;
    pending: boolean;
    onClose: () => void;
    onSubmit: (input: WeightCreateInput) => Promise<void>;
}

const WEIGHT_FORM_ID = 'erp-weight-form';

function WeightFormDialog({ open, editing, pending, onClose, onSubmit }: WeightFormDialogProps) {
    const [weight, setWeight] = useState('');
    const [unit, setUnit] = useState<string>('kg');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [itemName, setItemName] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setWeight(editing ? String(editing.weight) : '');
            setUnit(editing?.unit ?? 'kg');
            setDate(editing?.date || localToday());
            setTime(editing?.time || '');
            setItemName(editing?.itemName || '');
            setNotes(editing?.notes || '');
            setError('');
        }
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const w = Number(weight);
        if (!weight.trim() || !Number.isFinite(w) || w <= 0) {
            setError(WEIGHT_TEXT.weightInvalid);
            return;
        }
        if (!unit) {
            setError(WEIGHT_TEXT.unitRequired);
            return;
        }
        if (!date) {
            setError(WEIGHT_TEXT.weightRequired);
            return;
        }
        try {
            await onSubmit({ weight: w, unit, date, time: time || null, itemName: itemName || null, notes: notes || null });
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, WEIGHT_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل قراءة' : 'تسجيل قراءة جديدة'}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {WEIGHT_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={WEIGHT_FORM_ID} size="sm" loading={pending}>
                        حفظ
                    </Button>
                </>
            }
        >
            <form id={WEIGHT_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="الوزن"
                        name="weight"
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        dir="ltr"
                        required
                    />
                    <Select
                        label="الوحدة"
                        name="unit"
                        value={unit}
                        onValueChange={(v) => setUnit(String(v ?? 'kg'))}
                        options={WEIGHT_UNITS.map((u) => ({ label: WEIGHT_UNIT_LABELS[u], value: u }))}
                        required
                    />
                    <Input
                        label="التاريخ"
                        name="date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        dir="ltr"
                        required
                    />
                    <Input
                        label="الوقت (اختياري)"
                        name="time"
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        dir="ltr"
                    />
                </div>
                <Input label="اسم الصنف" name="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                <Input label="ملاحظات" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}
