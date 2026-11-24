import './InventoryMovements.premium.css';
import { fromCents, toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card } from '../components/TableState';
import { fetchCurrency, firstOfMonth, riyadhToday } from '../lib/finance';
import { formatMoney } from '../lib/format';
import {
    fetchInventoryMovements,
    formatQty,
    MAX_PAGES,
    MOVEMENT_TYPE_LABEL,
    type MovementRow,
    movementToRow,
    sumValuesOfType,
    typeTone,
} from '../lib/inventory';
import { shiftIsoDays } from '../lib/reporting';
import { DataTable, type DataTableColumn, PageHeader } from '../ui';
import { Badge } from '../ui/Badge';
import { ArrowDownIcon, ArrowUpIcon, ListTreeIcon, MinusIcon, XIcon } from '../ui/icons';
import { SearchInput } from '../ui/SearchInput';

/**
 * حركات المخزون — قراءة فقط من `/api/inventoryTx` لشهر الرياض الحالي،
 * بنفس سقف القديم (8 صفحات) المعلَن على الشاشة. التصفية بالتاريخ والبحث
 * عميلان على المحمّل، والنوع من مفردات الشاشة القديمة نفسها.
 *
 * طبقة «السهولة» (2026-11): اختصارات فترة بنقرة واحدة، شرائح مرشّحات نشطة
 * قابلة للإزالة، شارات نوع تحمل نصًّا ولونًا معًا، وبطاقات مؤشرات تحجز
 * ارتفاعها أثناء التحميل. كل المعروض أدناه مشتق من نفس البيانات — لا حساب
 * مالي جديد في الواجهة، ولا تغيير في عقد الجدول أو الترقيم أو التصدير.
 */

const PAGE_SIZE = 50;

type PresetKey = 'today' | 'week' | 'month' | 'all';
type KpiTone = 'neutral' | 'success' | 'danger';

interface DateRange {
    from: string;
    to: string;
}

const DATE_PRESETS: ReadonlyArray<{ key: PresetKey; label: string; range: () => DateRange }> = [
    {
        key: 'today',
        label: 'اليوم',
        range: () => {
            const today = riyadhToday();
            return { from: today, to: today };
        },
    },
    {
        key: 'week',
        label: '7 أيام',
        range: () => {
            const to = riyadhToday();
            return { from: shiftIsoDays(to, -6), to };
        },
    },
    {
        key: 'month',
        label: 'هذا الشهر',
        range: () => ({ from: firstOfMonth(), to: riyadhToday() }),
    },
    { key: 'all', label: 'كل الفترات', range: () => ({ from: '', to: '' }) },
];

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

/** بطاقة مؤشر — الرقم أكبر عنصر، واللون إشارة ثانية لا دلالة وحدها (WCAG 1.4.1). */
function Kpi({
    label,
    english,
    value,
    hint,
    tone = 'neutral',
    icon,
    loading = false,
}: {
    label: string;
    english: string;
    value: string;
    hint: string;
    tone?: KpiTone;
    icon: ReactNode;
    loading?: boolean;
}) {
    return (
        <div className={`erp-mv-kpi erp-mv-kpi--${tone}`} aria-busy={loading}>
            <div className="erp-mv-kpi__top">
                <div className="min-w-0">
                    <p className="text-label-md text-muted">{label}</p>
                    <p className="text-caption text-faint" dir="ltr" lang="en">
                        {english}
                    </p>
                </div>
                <span className="erp-mv-kpi__icon" aria-hidden="true">
                    {icon}
                </span>
            </div>
            {loading ? (
                <span className="erp-mv-kpi__skeleton" role="status" aria-label={`جارٍ تحميل ${label}`} />
            ) : (
                <p className="erp-numeric erp-mv-kpi__value">{value}</p>
            )}
            <p className="erp-mv-kpi__hint">{hint}</p>
        </div>
    );
}

/** شارة مرشّح نشط — إزالة بضغطة واحدة بدل إعادة ضبط كل الفلاتر. */
function FilterChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
    return (
        <li className="erp-mv-chip">
            <span className="text-faint">{label}</span>
            <span className="font-medium text-ink">{value}</span>
            <button type="button" onClick={onRemove} aria-label={`إزالة مرشّح ${label}`}>
                <XIcon className="size-3" />
            </button>
        </li>
    );
}

/**
 * أعمدة الحركات — القيم كما كانت حرفيًا (تواريخ وكميات لاتينية معزولة
 * الاتجاه، والنوع المجهول بشارة «افتتاحي» مع القيمة الخام). التصدير المعلن للصفحة المحمّلة
 * فقط (`exportValue` لكل عمود)؛ لا فرز هنا لأن التقطيع محلي على صفحة من
 * نتائج مرشّحة أكبر — فرز الصفحة وحدها يوحي بترتيب كامل وهو ليس كذلك.
 */
const MOVEMENT_COLUMNS: DataTableColumn<MovementRow>[] = [
    {
        key: 'date',
        header: 'التاريخ',
        align: 'center',
        className: 'erp-numeric text-body-sm text-muted',
        cell: (row) => <span dir="ltr">{row.date}</span>,
        exportValue: (row) => row.date,
    },
    {
        key: 'itemName',
        header: 'الصنف',
        className: 'text-ink',
        cell: (row) => row.itemName,
        exportValue: (row) => row.itemName,
    },
    {
        key: 'type',
        header: 'النوع',
        className: 'text-body-sm',
        cell: (row) => {
            const variant = row.type === 'return' ? 'info' : row.type === 'adjustment' ? 'warning' : typeTone(row.type);
            return (
                <Badge variant={variant} dot unknown={!row.typeKnown}>
                    <span>{row.typeLabel}</span>
                    {!row.typeKnown && row.type ? (
                        <span className="erp-mv-type-raw" dir="ltr">
                            ({row.type})
                        </span>
                    ) : null}
                </Badge>
            );
        },
        exportValue: (row) => (row.typeKnown ? row.typeLabel : `${row.typeLabel} (${row.type})`),
    },
    {
        key: 'qty',
        header: 'الكمية',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => <span dir="ltr">{formatQty(row.qty)}</span>,
        exportValue: (row) => Number(row.qty),
    },
    {
        key: 'cost',
        header: 'السعر',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => formatMoney(row.cost),
        exportValue: (row) => Number(row.cost),
    },
    {
        key: 'totalValue',
        header: 'القيمة',
        align: 'end',
        className: 'erp-numeric text-ink',
        cell: (row) => formatMoney(row.totalValue),
        exportValue: (row) => Number(row.totalValue),
    },
    {
        key: 'ref',
        header: 'المرجع',
        className: 'text-body-sm text-muted',
        cell: (row) => <span dir="ltr">{row.ref || '—'}</span>,
        exportValue: (row) => row.ref,
    },
];

export function InventoryMovements() {
    const [from, setFrom] = useState(firstOfMonth());
    const [to, setTo] = useState(riyadhToday());
    const [search, setSearch] = useState('');
    const [type, setType] = useState('ALL');
    const [page, setPage] = useState(1);

    const movementsQuery = useQuery({
        queryKey: ['inventory', 'movements', 'month'],
        queryFn: ({ signal }) => fetchInventoryMovements(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const currency = currencyQuery.data ?? '';
    const rangeInvalid = Boolean(from && to && from > to);
    const allRows = useMemo(() => (movementsQuery.data ?? []).map(movementToRow), [movementsQuery.data]);

    const rows = useMemo(() => {
        if (rangeInvalid) {
            return [];
        }
        const term = search.trim().toLowerCase();
        return allRows.filter((row) => {
            if (from && row.date < from) {
                return false;
            }
            if (to && row.date > to) {
                return false;
            }
            if (type !== 'ALL' && row.type !== type) {
                return false;
            }
            if (!term) {
                return true;
            }
            return [row.itemName, row.ref, row.id]
                .map((value) => value.toLowerCase())
                .some((value) => value.includes(term));
        });
    }, [allRows, from, to, search, type, rangeInvalid]);

    const incoming = useMemo(() => sumValuesOfType(allRows, 'in'), [allRows]);
    const outgoing = useMemo(() => sumValuesOfType(allRows, 'out'), [allRows]);
    const net = fromCents(toCents(incoming) - toCents(outgoing));

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const capped = (movementsQuery.data?.length ?? 0) >= 1000 * MAX_PAGES;

    const activePreset = DATE_PRESETS.find((preset) => {
        const range = preset.range();
        return range.from === from && range.to === to;
    })?.key;

    const applyPreset = (key: PresetKey) => {
        const preset = DATE_PRESETS.find((entry) => entry.key === key);
        if (!preset) {
            return;
        }
        const range = preset.range();
        setFrom(range.from);
        setTo(range.to);
        setPage(1);
    };

    const resetFilters = () => {
        setFrom('');
        setTo('');
        setSearch('');
        setType('ALL');
        setPage(1);
    };

    const hasChips = Boolean(from || to || search || type !== 'ALL');
    const lastUpdated =
        movementsQuery.dataUpdatedAt > 0
            ? new Date(movementsQuery.dataUpdatedAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
              })
            : '';

    return (
        <div className="flex flex-col gap-md erp-premium-InventoryMovements">
            <PageHeader
                title="حركات المخزون"
                english="Stock Movements"
                description="سجل الوارد والصادر والتسويات لشهر الرياض الحالي — راجع الأثر فورًا بفلاتر جاهزة."
                actions={
                    <>
                        {lastUpdated ? (
                            <span className="erp-mv-updated" title="آخر تحديث للبيانات">
                                <span className="erp-mv-updated__dot" aria-hidden="true" />
                                آخر تحديث <span dir="ltr">{lastUpdated}</span>
                            </span>
                        ) : null}
                        <div className="flex items-center gap-xs">
                            <PrintActions title="حركات المخزون" />
                            <button
                                type="button"
                                onClick={() => {
                                    void movementsQuery.refetch();
                                }}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                            >
                                تحديث
                            </button>
                        </div>
                    </>
                }
            />

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الحركات"
                    english="Movements"
                    value={formatInt(allRows.length)}
                    hint="المحمّل من الشهر"
                    icon={<ListTreeIcon className="size-4" />}
                    loading={movementsQuery.isPending}
                />
                <Kpi
                    label="قيمة الوارد"
                    english="Received"
                    value={`${formatMoney(incoming)} ${currency}`.trim()}
                    hint="مجموع type=in"
                    tone="success"
                    icon={<ArrowUpIcon className="size-4" />}
                    loading={movementsQuery.isPending}
                />
                <Kpi
                    label="قيمة الصادر"
                    english="Issued"
                    value={`${formatMoney(outgoing)} ${currency}`.trim()}
                    hint="مجموع type=out"
                    tone="danger"
                    icon={<ArrowDownIcon className="size-4" />}
                    loading={movementsQuery.isPending}
                />
                <Kpi
                    label="الصافي"
                    english="Net Value"
                    value={`${formatMoney(net)} ${currency}`.trim()}
                    hint="وارد − صادر"
                    icon={<MinusIcon className="size-4" />}
                    loading={movementsQuery.isPending}
                />
            </div>

            <Card className="erp-mv-filters">
                <div className="erp-mv-filters__head">
                    <div>
                        <p className="text-label-md font-medium text-ink">تصفية السجل</p>
                        <p className="text-caption text-muted">اختر فترة جاهزة أو حدّدها يدويًا.</p>
                    </div>
                    <fieldset className="erp-mv-presets">
                        <legend className="sr-only">فترات سريعة</legend>
                        {DATE_PRESETS.map((preset) => (
                            <button
                                key={preset.key}
                                type="button"
                                aria-pressed={activePreset === preset.key}
                                onClick={() => {
                                    applyPreset(preset.key);
                                }}
                                className="erp-mv-preset"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </fieldset>
                </div>

                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-from">
                        من
                        <input
                            id="erp-moves-from"
                            type="date"
                            value={from}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-to">
                        إلى
                        <input
                            id="erp-moves-to"
                            type="date"
                            value={to}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setTo(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <SearchInput
                        id="erp-moves-search"
                        label="بحث"
                        value={search}
                        placeholder="الصنف أو المرجع أو الرقم…"
                        onChange={(value) => {
                            setSearch(value);
                            setPage(1);
                        }}
                        className="min-w-56 flex-1"
                    />
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-moves-type">
                        النوع
                        <select
                            id="erp-moves-type"
                            value={type}
                            onChange={(event) => {
                                setType(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="ALL">كل الأنواع</option>
                            <option value="in">{MOVEMENT_TYPE_LABEL.in}</option>
                            <option value="out">{MOVEMENT_TYPE_LABEL.out}</option>
                            <option value="return">{MOVEMENT_TYPE_LABEL.return}</option>
                            <option value="adjustment">{MOVEMENT_TYPE_LABEL.adjustment}</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        عرض الكل
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} حركة</span>
                </div>

                {hasChips ? (
                    <ul className="erp-mv-chips" aria-label="المرشّحات النشطة">
                        {from || to ? (
                            <FilterChip
                                label="الفترة"
                                value={`${from || 'بداية'} — ${to || 'اليوم'}`}
                                onRemove={() => {
                                    setFrom('');
                                    setTo('');
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {type !== 'ALL' ? (
                            <FilterChip
                                label="النوع"
                                value={MOVEMENT_TYPE_LABEL[type as keyof typeof MOVEMENT_TYPE_LABEL] ?? type}
                                onRemove={() => {
                                    setType('ALL');
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {search.trim() ? (
                            <FilterChip
                                label="البحث"
                                value={search.trim()}
                                onRemove={() => {
                                    setSearch('');
                                    setPage(1);
                                }}
                            />
                        ) : null}
                    </ul>
                ) : null}

                {rangeInvalid ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض.
                    </p>
                ) : null}
            </Card>

            <section className="erp-mv-tablewrap">
                <div className="erp-mv-tablebar">
                    <div className="flex items-center gap-sm">
                        <h2 className="text-heading-md text-ink">سجل الحركات</h2>
                        <Badge variant="neutral">{formatInt(rows.length)}</Badge>
                    </div>
                    <ul className="erp-mv-legend" aria-label="دليل أنواع الحركات">
                        <li>
                            <span className="erp-mv-legend__dot erp-mv-legend__dot--in" aria-hidden="true" />
                            وارد
                        </li>
                        <li>
                            <span className="erp-mv-legend__dot erp-mv-legend__dot--out" aria-hidden="true" />
                            صادر
                        </li>
                        <li>
                            <span className="erp-mv-legend__dot erp-mv-legend__dot--return" aria-hidden="true" />
                            مرتجع
                        </li>
                        <li>
                            <span className="erp-mv-legend__dot erp-mv-legend__dot--adjustment" aria-hidden="true" />
                            تسوية
                        </li>
                    </ul>
                </div>

                <DataTable<MovementRow>
                    caption="جدول حركات المخزون"
                    columns={MOVEMENT_COLUMNS}
                    rows={pageRows}
                    rowKey={(row) => row.id}
                    state={
                        movementsQuery.isPending
                            ? 'loading'
                            : movementsQuery.isError
                              ? 'error'
                              : rows.length === 0
                                ? 'empty'
                                : 'data'
                    }
                    loadingRows={8}
                    emptyTitle="لا حركات"
                    emptyDescription={rangeInvalid ? 'صحّح التاريخين أولًا.' : 'لا حركة في هذه الفترة أو البحث.'}
                    errorMessage={
                        movementsQuery.error instanceof Error ? movementsQuery.error.message : 'خطأ غير معروف'
                    }
                    onRetry={() => {
                        void movementsQuery.refetch();
                    }}
                    manualFiltering
                    manualPagination
                    {...(rows.length > 0
                        ? {
                              pagination: {
                                  page: safePage,
                                  pageSize: PAGE_SIZE,
                                  total: rows.length,
                                  onPageChange: setPage,
                                  labels: {
                                      summary: (from: number, to: number, total: number) =>
                                          `${formatInt(from)}–${formatInt(to)} من ${formatInt(total)} حركة${
                                              capped ? ` · الخادم أعاد أول ${formatInt(1000 * MAX_PAGES)} حركة فقط` : ''
                                          }`,
                                  },
                              },
                          }
                        : {})}
                    exportFilename="حركات-المخزون"
                />
            </section>
        </div>
    );
}
