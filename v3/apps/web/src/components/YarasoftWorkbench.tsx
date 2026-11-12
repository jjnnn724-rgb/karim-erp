import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import { formatInt } from '../lib/format';
import { openBlankTab, printHtmlDocument } from '../lib/print-document';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import {
    approveSectionError,
    approveYarasoftSection,
    canWriteYarasoft,
    createYarasoftManualSection,
    deactivateYarasoftMapping,
    externalRefText,
    fetchYarasoftCatalogStatus,
    fetchYarasoftInvoiceDetail,
    fetchYarasoftLog,
    fetchYarasoftMappings,
    fetchYarasoftMirrorCashiers,
    fetchYarasoftMirrorClose,
    fetchYarasoftMirrorOrder,
    fetchYarasoftMirrorOrders,
    fetchYarasoftOracleCatchUpStatus,
    fetchYarasoftOracleReconcile,
    fetchYarasoftOracleStatus,
    fetchYarasoftQuarantine,
    fetchYarasoftReview,
    fetchYarasoftSectionInvoiceDetail,
    fetchYarasoftSectionInvoices,
    fetchYarasoftSectionMap,
    fetchYarasoftStatus,
    fetchYarasoftUnmappedSections,
    importYarasoftOracleItems,
    intText,
    invoicePayloadItems,
    mappingFormError,
    moneyText,
    oracleDaysError,
    organizeYarasoftCategories,
    pollYarasoftOracleNow,
    previewTextError,
    previewYarasoftInvoiceText,
    previewYarasoftOracleItems,
    productSearchError,
    quarantineRows,
    reclassifyError,
    reclassifyYarasoftRevenue,
    refreshYarasoftMirror,
    renameYarasoftSection,
    reprocessYarasoftInvoice,
    resolveYarasoftReview,
    runYarasoftNow,
    type SectionInvoiceQuery,
    saveYarasoftMapping,
    searchYarasoftProducts,
    sourceFileName,
    startYarasoftOracleCatchUp,
    syncYarasoftBalances,
    testYarasoftOracle,
    type YarasoftMirrorClose,
    type YarasoftMirrorOrderDetail,
    type YarasoftMirrorOrderRow,
    type YarasoftProduct,
    type YarasoftQuarantineRow,
    type YarasoftReviewItem,
    type YarasoftSectionInvoiceDetail,
    type YarasoftSectionInvoices,
    type YarasoftSectionMapRow,
    type YarasoftUnmappedSection,
    YS_TEXT,
    yarasoftStatusBadge,
} from '../lib/yarasoft-write';
import { Badge, Button, Checkbox, Dialog, Input, Select, Textarea } from '../ui';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';
import { StateEmpty, StateError, StateLoading, TableScroll } from './TableState';

/**
 * تكامل قاعدة الكاشير (Yarasoft) — كل تبويبات V2 الثمانية
 * (`frontend/app/js/v2/screens/yarasoft.js`) في V3:
 * الحالة والسجل، مراجعة الأصناف، الأقسام المعلقة، ربط المنتجات،
 * ربط قاعدة الكاشير (Oracle)، جودة البيانات، معاينة الصيغة، ومرآة الكاشيرية.
 *
 * كل نداء لعقد الخادم نفسه (`yarasoft-write.ts`)، والأدوار تُحجب محليًّا مثل
 * V2 — والخادم يبقى الفاصل: `admin|manager` يكتبان.
 */

const YS_KEYS = {
    status: ['yarasoft', 'status'],
    log: ['yarasoft', 'log'],
    review: ['yarasoft', 'review'],
    mappings: ['yarasoft', 'mappings'],
    sectionMap: ['yarasoft', 'section-map'],
    unmapped: ['yarasoft', 'unmapped'],
    sectionInvoices: ['yarasoft', 'section-invoices'],
    oracleStatus: ['yarasoft', 'oracle-status'],
    catchUp: ['yarasoft', 'oracle-catch-up'],
    catalog: ['yarasoft', 'catalog'],
    quarantine: ['yarasoft', 'quarantine'],
    mirror: ['yarasoft', 'mirror'],
} as const;

type TabKey = 'status' | 'review' | 'sections' | 'mappings' | 'oracle' | 'quality' | 'tools' | 'mirror';

const TABS: readonly { key: TabKey; label: string }[] = [
    { key: 'status', label: 'الحالة والسجل' },
    { key: 'review', label: 'مراجعة الأصناف' },
    { key: 'sections', label: 'الأقسام المعلقة' },
    { key: 'mappings', label: 'ربط المنتجات' },
    { key: 'oracle', label: 'ربط قاعدة الكاشير' },
    { key: 'quality', label: 'جودة البيانات' },
    { key: 'tools', label: 'معاينة الصيغة' },
    { key: 'mirror', label: 'مرآة الكاشيرية' },
];

function useRole() {
    const auth = useAuthState();
    return { role: auth.user?.role ?? '', canWrite: canWriteYarasoft(auth.user?.role) };
}

/* ─── عناصر عرض مشتركة ─────────────────────────────────────────────────── */

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface-sunken p-sm">
            <p className="text-label-md text-muted">{label}</p>
            <p className="erp-numeric mt-xxs text-heading-md text-ink">{value}</p>
            {hint ? <p className="mt-xxs text-caption text-muted">{hint}</p> : null}
        </div>
    );
}

function Notice({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'warning' }) {
    return (
        <p
            role="alert"
            className={`rounded-md border px-sm py-xs text-body-sm ${
                tone === 'danger'
                    ? 'border-danger/30 bg-danger-soft text-danger-text'
                    : 'border-warning/30 bg-warning-soft text-warning-text'
            }`}
        >
            {children}
        </p>
    );
}

function escapePrintHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function quarantineReportHtml(rows: YarasoftQuarantineRow[]): string {
    const body = rows
        .map(
            (row) =>
                `<tr><td>${escapePrintHtml(row.kind || '—')}</td><td dir="ltr">${escapePrintHtml(row.ref_code || '—')}</td>` +
                `<td dir="ltr">${escapePrintHtml(row.qty ?? '—')}</td><td dir="ltr">${escapePrintHtml(moneyText(row.value_amount))}</td>` +
                `<td dir="ltr">${escapePrintHtml(moneyText(row.unit_cost))}</td><td>${escapePrintHtml(row.reason || '—')}</td></tr>`,
        )
        .join('');
    const stamp = escapePrintHtml(new Date().toLocaleString('ar-SA'));

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>الحجر الصحي لقيم مخازن الكاشير</title><style>
body{font-family:Tahoma,Arial,sans-serif;color:#182230;margin:24px}
h1{font-size:20px;margin:0 0 8px}p{color:#475467;margin:0 0 16px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #98a2b3;padding:7px;text-align:right;vertical-align:top}
th{background:#f2f4f7}td[dir=ltr]{text-align:left}
@media print{body{margin:12mm}thead{display:table-header-group}}
</style></head><body><h1>الحجر الصحي — قيم مخازن الكاشير</h1>
<p>عدد البنود: ${escapePrintHtml(formatInt(rows.length))} · تاريخ الطباعة: ${stamp}</p>
<table><thead><tr><th>النوع</th><th>الكود</th><th>الكمية</th><th>القيمة</th><th>سعر الوحدة</th><th>السبب</th></tr></thead>
<tbody>${body || '<tr><td colspan="6">لا توجد بنود معزولة.</td></tr>'}</tbody></table></body></html>`;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-xs border-b border-hairline px-sm py-xs">
                <h3 className="text-heading-sm text-ink">{title}</h3>
                {action}
            </header>
            <div className="flex flex-col gap-sm p-sm">{children}</div>
        </section>
    );
}

function DataGrid({
    label,
    headers,
    rows,
    empty,
    children,
}: {
    label: string;
    headers: readonly string[];
    rows: number;
    empty: string;
    children: ReactNode;
}) {
    return (
        <TableScroll label={label}>
            <table className="w-full border-collapse text-body-md">
                <thead>
                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                        {headers.map((header) => (
                            <th key={header} scope="col" className="px-sm py-xs text-start font-medium">
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows === 0 ? (
                        <tr>
                            <td colSpan={headers.length} className="px-sm py-xs text-muted">
                                {empty}
                            </td>
                        </tr>
                    ) : (
                        children
                    )}
                </tbody>
            </table>
        </TableScroll>
    );
}

function Row({ children }: { children: ReactNode }) {
    return <tr className="border-b border-hairline">{children}</tr>;
}

function Cell({ children, ltr = false, numeric = false }: { children: ReactNode; ltr?: boolean; numeric?: boolean }) {
    return (
        <td className={numeric ? 'erp-numeric px-sm py-xxs text-end text-ink' : 'px-sm py-xxs text-ink'} dir={ltr ? 'ltr' : undefined}>
            {children}
        </td>
    );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
    const info = yarasoftStatusBadge(status);
    return <Badge variant={info.tone === 'warning' ? 'warning' : info.tone}>{info.label}</Badge>;
}

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return <StateError message={message} onRetry={onRetry} />;
}

/* ─── الحالة والسجل ─────────────────────────────────────────────────────── */

function StatusPanel() {
    const { canWrite } = useRole();
    const [detailId, setDetailId] = useState<string | null>(null);

    const statusQuery = useQuery({
        queryKey: YS_KEYS.status,
        queryFn: ({ signal }) => fetchYarasoftStatus(signal),
    });
    const logQuery = useQuery({
        queryKey: YS_KEYS.log,
        queryFn: ({ signal }) => fetchYarasoftLog(150, signal),
    });
    const detailQuery = useQuery({
        queryKey: ['yarasoft', 'log-detail', detailId],
        queryFn: () => fetchYarasoftInvoiceDetail(detailId ?? ''),
        enabled: detailId !== null,
        retry: false,
    });

    const run = useWriteMutation<null, unknown>({
        mutationFn: () => runYarasoftNow(),
        successTitle: 'تم تشغيل دورة الفحص؛ راجع سجل الاستيراد.',
        invalidate: [YS_KEYS.status, YS_KEYS.log],
    });
    const reprocess = useWriteMutation<string, Awaited<ReturnType<typeof reprocessYarasoftInvoice>>>({
        mutationFn: (id) => reprocessYarasoftInvoice(id),
        invalidate: [YS_KEYS.status, YS_KEYS.log],
        successTitle: (id) => `أُعيد فتح الفاتورة ${id} للمعالجة.`,
    });

    const status = statusQuery.data;
    const engine = status?.engine;
    const counts = status?.logCounts;
    const rows = logQuery.data ?? [];
    const items = invoicePayloadItems(detailQuery.data);

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-xs">
                <p className="text-body-sm text-muted">
                    حالة المحرك وسجل الاستيراد. إعادة المعالجة تفتح الفواتير الفاشلة أو التي تحتاج مراجعة فقط.
                </p>
                <div className="flex flex-wrap gap-xs">
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            void Promise.all([statusQuery.refetch(), logQuery.refetch()]);
                        }}
                    >
                        تحديث
                    </Button>
                    {canWrite ? (
                        <Button size="sm" onClick={() => run.mutate(null)} loading={run.isPending}>
                            تشغيل دورة الاستيراد
                        </Button>
                    ) : null}
                </div>
            </div>

            {statusQuery.isPending ? <StateLoading label="جارٍ جلب حالة المحرك…" /> : null}
            {statusQuery.isError ? (
                <QueryError
                    message={writeErrorMessage(statusQuery.error)}
                    onRetry={() => {
                        void statusQuery.refetch();
                    }}
                />
            ) : null}

            {status ? (
                <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    <Metric label="حالة المحرك" value={engine?.enabled ? (engine.running ? 'يعمل' : 'متوقف') : 'معطّل'} />
                    <Metric label="الفواتير المكتملة" value={intText(counts?.completed)} />
                    <Metric label="تحتاج مراجعة" value={intText(status.openReviewItems ?? counts?.review)} />
                    <Metric label="أقسام بانتظار الربط" value={intText(status.openSections ?? counts?.needs_mapping)} />
                    <Metric label="الفواتير الفاشلة" value={intText(counts?.failed)} />
                    <Metric label="مكررات" value={intText(counts?.duplicates)} />
                </div>
            ) : null}

            {engine?.lastError ? <Notice>{engine.lastError}</Notice> : null}

            <Section title="سجل الاستيراد">
                {logQuery.isPending ? <StateLoading label="جارٍ جلب سجل الاستيراد…" /> : null}
                {logQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(logQuery.error)}
                        onRetry={() => {
                            void logQuery.refetch();
                        }}
                    />
                ) : null}
                {logQuery.data ? (
                    <DataGrid
                        label="سجل الاستيراد"
                        headers={['الملف', 'رقم الفاتورة', 'الحالة', 'الأصناف', 'الإجمالي', 'الخطأ', 'إجراءات']}
                        rows={rows.length}
                        empty="لا توجد سجلات استيراد بعد."
                    >
                        {rows.map((entry) => (
                            <Row key={String(entry.id)}>
                                <Cell>{sourceFileName(entry.source_file)}</Cell>
                                <Cell ltr>{entry.external_invoice_number || '—'}</Cell>
                                <Cell>
                                    <StatusBadge status={entry.status} />
                                </Cell>
                                <Cell numeric>{formatInt(Number(entry.items_count) || 0)}</Cell>
                                <Cell numeric>{entry.total_amount == null ? '—' : moneyText(entry.total_amount)}</Cell>
                                <Cell>{entry.error_message || '—'}</Cell>
                                <Cell>
                                    <div className="flex flex-wrap gap-xs">
                                        {canWrite && ['FAILED', 'REQUIRES_REVIEW'].includes(String(entry.status ?? '')) ? (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => reprocess.mutate(String(entry.id))}
                                                loading={reprocess.isPending && reprocess.variables === String(entry.id)}
                                            >
                                                إعادة المعالجة
                                            </Button>
                                        ) : null}
                                        <Button size="sm" variant="ghost" onClick={() => setDetailId(String(entry.id))}>
                                            التفاصيل
                                        </Button>
                                    </div>
                                </Cell>
                            </Row>
                        ))}
                    </DataGrid>
                ) : null}
                <p className="text-caption text-muted">آخر {formatInt(rows.length)} سجل</p>
            </Section>

            <Dialog
                open={detailId !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setDetailId(null);
                    }
                }}
                title={detailQuery.data?.external_invoice_number || 'تفاصيل الفاتورة'}
                {...(detailQuery.data?.status ? { description: yarasoftStatusBadge(detailQuery.data.status).label } : {})}
                size="lg"
            >
                {detailQuery.isPending ? <StateLoading label="جارٍ جلب تفاصيل الفاتورة…" /> : null}
                {detailQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(detailQuery.error)}
                        onRetry={() => {
                            void detailQuery.refetch();
                        }}
                    />
                ) : null}
                {detailQuery.data ? (
                    <DataGrid
                        label="تفاصيل أصناف الفاتورة"
                        headers={['الصنف', 'الكود', 'الكمية', 'الإجمالي']}
                        rows={items.length}
                        empty="لا توجد تفاصيل أصناف محفوظة."
                    >
                        {items.map((item, index) => (
                            <Row key={`${String(item.externalCode ?? item.name ?? '')}-${String(index)}`}>
                                <Cell>{item.name || item.externalCode || '—'}</Cell>
                                <Cell ltr>{item.externalCode || '—'}</Cell>
                                <Cell numeric>{moneyText(item.quantity)}</Cell>
                                <Cell numeric>{moneyText(item.total)}</Cell>
                            </Row>
                        ))}
                    </DataGrid>
                ) : null}
            </Dialog>
        </>
    );
}

/* ─── مراجعة الأصناف ────────────────────────────────────────────────────── */

function ReviewRow({ item, onResolved }: { item: YarasoftReviewItem; onResolved: (message: string) => void }) {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<YarasoftProduct[]>([]);
    const [picked, setPicked] = useState('');
    const [error, setError] = useState('');
    const [searching, setSearching] = useState(false);

    const resolve = useWriteMutation<number, Awaited<ReturnType<typeof resolveYarasoftReview>>>({
        mutationFn: (productId) => resolveYarasoftReview(item.id, productId),
        invalidate: [YS_KEYS.review],
        successTitle: YS_TEXT.reviewResolved,
        onSuccess: (data) => onResolved(data.message || YS_TEXT.reviewResolved),
    });

    async function search() {
        const problem = productSearchError(query);
        if (problem) {
            setError(problem);
            return;
        }
        setError('');
        setSearching(true);
        try {
            const result = await searchYarasoftProducts(query);
            setOptions(result.rows);
            if (!result.rows.length) {
                setError('لم يعثر البحث على منتجات مطابقة.');
            } else if (result.truncated) {
                setError('نتائج البحث كثيرة؛ أضف تفاصيل أكثر للاسم لتضييق القائمة.');
            }
        } catch (cause) {
            setError(writeErrorMessage(cause, 'تعذّر البحث عن المنتجات.'));
        } finally {
            setSearching(false);
        }
    }

    async function submit() {
        if (!Number(picked)) {
            setError('ابحث واختر المنتج الداخلي قبل الربط.');
            return;
        }
        const ok = await confirm(
            `ربط "${item.item_name || 'الصنف'}" بالمنتج المحدد؟ عند اكتمال ربط الفاتورة سيعيد الخادم محاولة استيرادها.`,
            { confirmLabel: 'ربط الصنف' },
        );
        if (!ok) {
            return;
        }
        resolve.mutate(Number(picked));
    }

    const productOptions = options.map((product) => ({
        value: String(product.id),
        label: product.barcode ? `${product.name} — ${product.barcode}` : product.name,
    }));

    return (
        <Row>
            <Cell ltr>{item.external_invoice_number || '—'}</Cell>
            <Cell ltr>{item.external_item_code || '—'}</Cell>
            <Cell ltr>{item.external_barcode || '—'}</Cell>
            <Cell>{item.item_name || '—'}</Cell>
            <Cell numeric>{moneyText(item.quantity)}</Cell>
            <Cell>{item.reason || '—'}</Cell>
            {canWrite ? (
                <Cell>
                    <div className="flex flex-col gap-xs sm:flex-row sm:items-end">
                        <Input
                            label="بحث عن منتج"
                            size="sm"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            containerClassName="min-w-40"
                        />
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                void search();
                            }}
                            loading={searching}
                        >
                            بحث
                        </Button>
                        <Select
                            label="المنتج الداخلي"
                            size="sm"
                            options={productOptions}
                            value={picked}
                            onValueChange={setPicked}
                            placeholder="ابحث واختر منتجاً"
                            containerClassName="min-w-48"
                        />
                        <Button
                            size="sm"
                            onClick={() => {
                                void submit();
                            }}
                            loading={resolve.isPending}
                        >
                            ربط الصنف
                        </Button>
                    </div>
                    {error ? <p className="mt-xs text-caption text-danger-text">{error}</p> : null}
                </Cell>
            ) : null}
        </Row>
    );
}

function ReviewPanel() {
    const { canWrite } = useRole();
    const reviewQuery = useQuery({
        queryKey: YS_KEYS.review,
        queryFn: ({ signal }) => fetchYarasoftReview(true, signal),
    });
    const rows = reviewQuery.data ?? [];

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-xs">
                <p className="text-body-sm text-muted">
                    لا تُطابق الأصناف تلقائياً بمنتج مختلف. اختر المنتج الداخلي الصحيح؛ بعد اكتمال ربط عناصر الفاتورة يعيد الخادم محاولة
                    استيرادها.
                </p>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        void reviewQuery.refetch();
                    }}
                >
                    تحديث
                </Button>
            </div>
            {reviewQuery.isPending ? <StateLoading label="جارٍ جلب أصناف المراجعة…" /> : null}
            {reviewQuery.isError ? (
                <QueryError
                    message={writeErrorMessage(reviewQuery.error)}
                    onRetry={() => {
                        void reviewQuery.refetch();
                    }}
                />
            ) : null}
            {reviewQuery.data ? (
                <Section title={`أصناف المراجعة (${formatInt(rows.length)})`}>
                    <DataGrid
                        label="أصناف المراجعة"
                        headers={[
                            'الفاتورة',
                            'الكود الخارجي',
                            'الباركود',
                            'الصنف',
                            'الكمية',
                            'سبب المراجعة',
                            ...(canWrite ? ['ربط المنتج'] : []),
                        ]}
                        rows={rows.length}
                        empty="لا توجد أصناف معلقة للمراجعة."
                    >
                        {rows.map((item) => (
                            <ReviewRow key={String(item.id)} item={item} onResolved={() => undefined} />
                        ))}
                    </DataGrid>
                </Section>
            ) : null}
        </>
    );
}

/* ─── الأقسام المعلقة ───────────────────────────────────────────────────── */

function UnmappedRow({ item, map }: { item: YarasoftUnmappedSection; map: readonly YarasoftSectionMapRow[] }) {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [name, setName] = useState(String(item.src_name ?? ''));
    const [merge, setMerge] = useState('');
    const [error, setError] = useState('');

    const approve = useWriteMutation<null, Awaited<ReturnType<typeof approveYarasoftSection>>>({
        mutationFn: () =>
            approveYarasoftSection(item.id, {
                displayAr: name,
                ...(merge ? { mergeMapId: merge } : {}),
            }),
        invalidate: [YS_KEYS.sectionMap, YS_KEYS.unmapped, YS_KEYS.sectionInvoices],
        successTitle: YS_TEXT.sectionApproved,
    });

    const readOnly = item.src_table === 'BILLS4' || !canWrite;
    const mergeOptions = map
        .filter((target) => target.active)
        .map((target) => ({
            value: String(target.id),
            label: `${target.display_ar ?? ''} (${target.src_table ?? ''})`,
        }));

    async function submit() {
        const problem = approveSectionError({ displayAr: name, mergeMapId: merge });
        if (problem) {
            setError(problem);
            return;
        }
        setError('');
        const target = map.find((entry) => String(entry.id) === merge);
        const targetText = target ? ` ودمجه في "${target.display_ar}"` : '';
        const ok = await confirm(`اعتماد "${item.src_name}"${targetText}؟ سيعيد الخادم معالجة الفواتير المعلقة لهذا القسم.`, {
            confirmLabel: 'اعتماد القسم',
        });
        if (!ok) {
            return;
        }
        approve.mutate(null);
    }

    return (
        <Row>
            <Cell>{item.src_table || '—'}</Cell>
            <Cell>{item.src_name || '—'}</Cell>
            <Cell numeric>{formatInt(Number(item.invoices_count) || 0)}</Cell>
            <Cell numeric>{moneyText(item.total_amount)}</Cell>
            <Cell ltr>{item.last_seen || '—'}</Cell>
            <Cell>
                {readOnly ? (
                    item.src_table === 'BILLS4' ? (
                        'مصدر موحّد: لا يعتمد كقسم منفصل'
                    ) : (
                        '—'
                    )
                ) : (
                    <div className="flex flex-col gap-xs">
                        <Input label="اسم العرض" size="sm" value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
                        <Select
                            label="دمج اختياري في قسم موجود"
                            size="sm"
                            options={mergeOptions}
                            value={merge}
                            onValueChange={setMerge}
                            placeholder="إنشاء قسم مستقل"
                        />
                        <Button
                            size="sm"
                            onClick={() => {
                                void submit();
                            }}
                            loading={approve.isPending}
                        >
                            اعتماد وربط
                        </Button>
                        {error ? <p className="text-caption text-danger-text">{error}</p> : null}
                    </div>
                )}
            </Cell>
        </Row>
    );
}

function RenameDialog({ row, onClose }: { row: YarasoftSectionMapRow | null; onClose: () => void }) {
    const [nameAr, setNameAr] = useState(String(row?.display_ar ?? ''));
    const [nameEn, setNameEn] = useState(String(row?.display_en ?? ''));
    const [error, setError] = useState('');
    const confirm = useConfirm();
    const rename = useWriteMutation<null, Awaited<ReturnType<typeof renameYarasoftSection>>>({
        mutationFn: () => renameYarasoftSection(row?.id ?? '', { displayAr: nameAr, displayEn: nameEn }),
        invalidate: [YS_KEYS.sectionMap, YS_KEYS.sectionInvoices],
        successTitle: 'تم تحديث اسم القسم والإيرادات المرتبطة به.',
        onSuccess: () => onClose(),
    });

    async function submit() {
        const cleaned = nameAr.trim();
        if (!cleaned) {
            setError('اسم العرض مطلوب.');
            return;
        }
        setError('');
        const ok = await confirm(
            `تحديث اسم القسم "${row?.display_ar ?? ''}" إلى "${cleaned}"؟ سيحدّث الخادم اسم القسم والإيرادات المرتبطة به.`,
            {
                confirmLabel: 'حفظ الاسم',
            },
        );
        if (!ok) {
            return;
        }
        rename.mutate(null);
    }

    return (
        <Dialog
            open={row !== null}
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
            title="تسمية قسم الإيراد"
            size="sm"
            footer={
                <div className="flex justify-end gap-xs">
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        إلغاء
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            void submit();
                        }}
                        loading={rename.isPending}
                    >
                        حفظ الاسم
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-sm">
                <Input label="الاسم العربي" value={nameAr} maxLength={255} onChange={(event) => setNameAr(event.target.value)} />
                <Input label="الاسم الإنجليزي" value={nameEn} maxLength={255} onChange={(event) => setNameEn(event.target.value)} />
                {error ? <p className="text-caption text-danger-text">{error}</p> : null}
            </div>
        </Dialog>
    );
}

function SectionInvoicesDrill({
    section,
    map,
    onClose,
}: {
    section: YarasoftSectionMapRow;
    map: readonly YarasoftSectionMapRow[];
    onClose: () => void;
}) {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [fromDraft, setFromDraft] = useState('');
    const [toDraft, setToDraft] = useState('');
    const [queryDraft, setQueryDraft] = useState('');
    const [applied, setApplied] = useState<SectionInvoiceQuery>({ page: 1, dateFrom: '', dateTo: '', query: '' });
    const [checked, setChecked] = useState<number[]>([]);
    const [target, setTarget] = useState('');
    const [detailRef, setDetailRef] = useState<string | null>(null);

    const invoicesQuery = useQuery({
        queryKey: ['yarasoft', 'section-invoices', String(section.id), applied.page, applied.dateFrom, applied.dateTo, applied.query],
        queryFn: ({ signal }) => fetchYarasoftSectionInvoices(Number(section.id), applied, signal),
        retry: false,
    });
    const detailQuery = useQuery({
        queryKey: ['yarasoft', 'section-invoice-detail', detailRef],
        queryFn: ({ signal }) => fetchYarasoftSectionInvoiceDetail(detailRef ?? '', signal),
        enabled: detailRef !== null,
        retry: false,
    });
    const reclassify = useWriteMutation<null, Awaited<ReturnType<typeof reclassifyYarasoftRevenue>>>({
        mutationFn: () => reclassifyYarasoftRevenue(checked, Number(target)),
        invalidate: [YS_KEYS.sectionMap, YS_KEYS.sectionInvoices],
        successTitle: YS_TEXT.reclassified,
        onSuccess: () => {
            setChecked([]);
            setApplied((current) => ({ ...current, page: 1 }));
        },
    });

    const data: YarasoftSectionInvoices | undefined = invoicesQuery.data;
    const rows = data?.rows ?? [];
    const pages = Math.max(1, Number(data?.pages) || 1);
    const currentPage = Number(data?.page) || 1;
    const targetOptions = map
        .filter((entry) => entry.active && String(entry.id) !== String(section.id))
        .map((entry) => ({ value: String(entry.id), label: `${entry.display_ar ?? ''} (${entry.src_table ?? ''})` }));

    function toggle(id: number, on: boolean) {
        setChecked((current) => (on ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
    }

    async function move() {
        const problem = reclassifyError(checked, target);
        if (problem) {
            return;
        }
        const selected = map.find((entry) => String(entry.id) === target);
        const ok = await confirm(
            `نقل ${formatInt(checked.length)} فاتورة إلى "${selected?.display_ar ?? ''}"؟ سيغيّر ذلك تصنيف الإيراد المسجل.`,
            {
                confirmLabel: 'نقل الفواتير',
            },
        );
        if (!ok) {
            return;
        }
        reclassify.mutate(null);
    }

    return (
        <>
            <Section
                title={`فواتير ${section.display_ar ?? ''} (${formatInt(Number(data?.total) || 0)})`}
                action={
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        إغلاق الفواتير
                    </Button>
                }
            >
                <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                    <Input
                        label="من تاريخ"
                        type="date"
                        size="sm"
                        value={fromDraft}
                        onChange={(event) => setFromDraft(event.target.value)}
                    />
                    <Input label="إلى تاريخ" type="date" size="sm" value={toDraft} onChange={(event) => setToDraft(event.target.value)} />
                    <Input
                        label="بحث في رقم الفاتورة أو الملاحظات"
                        size="sm"
                        value={queryDraft}
                        maxLength={60}
                        onChange={(event) => setQueryDraft(event.target.value)}
                    />
                    <div className="flex items-end">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setApplied({ page: 1, dateFrom: fromDraft, dateTo: toDraft, query: queryDraft });
                            }}
                        >
                            تطبيق الفلاتر
                        </Button>
                    </div>
                </div>

                {invoicesQuery.isPending ? <StateLoading label="جارٍ جلب فواتير القسم…" /> : null}
                {invoicesQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(invoicesQuery.error)}
                        onRetry={() => {
                            void invoicesQuery.refetch();
                        }}
                    />
                ) : null}
                {data ? (
                    <>
                        <DataGrid
                            label="فواتير القسم"
                            headers={[...(canWrite ? ['تحديد'] : []), 'المرجع', 'التاريخ', 'المبلغ', 'ملاحظات', 'حالة الاستيراد']}
                            rows={rows.length}
                            empty="لا توجد فواتير مطابقة."
                        >
                            {rows.map((invoice) => (
                                <Row key={String(invoice.id)}>
                                    {canWrite ? (
                                        <Cell>
                                            <Checkbox
                                                label={`تحديد الفاتورة ${externalRefText(invoice.external_ref, invoice.id)}`}
                                                checked={checked.includes(Number(invoice.id))}
                                                onCheckedChange={(state) => toggle(Number(invoice.id), state === true)}
                                            />
                                        </Cell>
                                    ) : null}
                                    <Cell>
                                        <button
                                            type="button"
                                            className="text-primary underline-offset-2 hover:underline"
                                            onClick={() => setDetailRef(String(invoice.external_ref || ''))}
                                        >
                                            <code dir="ltr">{externalRefText(invoice.external_ref, invoice.id)}</code>
                                        </button>
                                    </Cell>
                                    <Cell ltr>{invoice.date || '—'}</Cell>
                                    <Cell numeric>{moneyText(invoice.amount)}</Cell>
                                    <Cell>{invoice.notes || '—'}</Cell>
                                    <Cell>{invoice.import_status ? <StatusBadge status={invoice.import_status} /> : '—'}</Cell>
                                </Row>
                            ))}
                        </DataGrid>
                        <div className="flex flex-wrap items-center gap-xs">
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={currentPage <= 1}
                                onClick={() => {
                                    setApplied((current) => ({ ...current, page: Math.max(1, currentPage - 1) }));
                                }}
                            >
                                السابق
                            </Button>
                            <span className="text-body-sm text-muted">
                                صفحة {formatInt(currentPage)} من {formatInt(pages)}
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={currentPage >= pages}
                                onClick={() => {
                                    setApplied((current) => ({ ...current, page: Math.min(pages, currentPage + 1) }));
                                }}
                            >
                                التالي
                            </Button>
                        </div>
                        {canWrite ? (
                            <div className="flex flex-wrap items-end gap-xs">
                                <Select
                                    label="إعادة تصنيف المحدد"
                                    size="sm"
                                    options={targetOptions}
                                    value={target}
                                    onValueChange={setTarget}
                                    placeholder="اختر القسم المستهدف"
                                    containerClassName="min-w-52"
                                />
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        void move();
                                    }}
                                    loading={reclassify.isPending}
                                    disabled={checked.length === 0}
                                >
                                    نقل الفواتير المحددة
                                </Button>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </Section>

            <Dialog
                open={detailRef !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setDetailRef(null);
                    }
                }}
                title={`تفاصيل ${detailRef ?? ''}`}
                size="lg"
                {...(detailQuery.data?.live !== undefined
                    ? { description: detailQuery.data.live ? 'مباشر من قاعدة الكاشير' : 'من السجل المحلي' }
                    : {})}
            >
                {detailQuery.isPending ? <StateLoading label="جارٍ جلب تفاصيل الفاتورة…" /> : null}
                {detailQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(detailQuery.error)}
                        onRetry={() => {
                            void detailQuery.refetch();
                        }}
                    />
                ) : null}
                {detailQuery.data ? <SectionInvoiceDetail detail={detailQuery.data} /> : null}
            </Dialog>
        </>
    );
}

function SectionInvoiceDetail({ detail }: { detail: YarasoftSectionInvoiceDetail }) {
    const lines = detail.lines ?? [];
    return (
        <div className="flex flex-col gap-sm">
            {detail.header ? (
                <p className="text-body-sm text-ink">
                    الكاشير: {detail.header.CSHR || '—'} · الوردية: {detail.header.SHFT_NO || '—'} · التاريخ:{' '}
                    {detail.local?.date || detail.header.DOC_DATE || '—'}
                </p>
            ) : null}
            <DataGrid
                label="أصناف الفاتورة"
                headers={['الكود', 'الصنف', 'الكمية', 'الوحدة', 'السعر', 'الإجمالي', 'الضريبة']}
                rows={lines.length}
                empty="لا توجد أصناف محفوظة لهذه الفاتورة."
            >
                {lines.map((line, index) => (
                    <Row key={`${String(line.code ?? '')}-${String(index)}`}>
                        <Cell ltr>{line.code || '—'}</Cell>
                        <Cell>{line.name || '—'}</Cell>
                        <Cell numeric>{moneyText(line.qty)}</Cell>
                        <Cell>{line.unit || '—'}</Cell>
                        <Cell numeric>{moneyText(line.price)}</Cell>
                        <Cell numeric>{moneyText(line.total)}</Cell>
                        <Cell numeric>{moneyText(line.vat)}</Cell>
                    </Row>
                ))}
            </DataGrid>
        </div>
    );
}

function SectionsPanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [selected, setSelected] = useState<YarasoftSectionMapRow | null>(null);
    const [renameRow, setRenameRow] = useState<YarasoftSectionMapRow | null>(null);
    const [manualName, setManualName] = useState('');
    const [manualEn, setManualEn] = useState('');
    const [manualError, setManualError] = useState('');

    const mapQuery = useQuery({
        queryKey: YS_KEYS.sectionMap,
        queryFn: ({ signal }) => fetchYarasoftSectionMap(signal),
    });
    const unmappedQuery = useQuery({
        queryKey: YS_KEYS.unmapped,
        queryFn: ({ signal }) => fetchYarasoftUnmappedSections(signal),
    });
    const createManual = useWriteMutation<null, Awaited<ReturnType<typeof createYarasoftManualSection>>>({
        mutationFn: () => createYarasoftManualSection({ displayAr: manualName, displayEn: manualEn }),
        invalidate: [YS_KEYS.sectionMap, YS_KEYS.unmapped],
        successTitle: YS_TEXT.sectionCreated,
        onSuccess: () => {
            setManualName('');
            setManualEn('');
        },
    });

    const map = useMemo(() => mapQuery.data ?? [], [mapQuery.data]);
    const unmapped = unmappedQuery.data ?? [];

    async function create() {
        if (!manualName.trim()) {
            setManualError('أدخل اسم القسم اليدوي.');
            return;
        }
        setManualError('');
        const ok = await confirm(`إنشاء قسم إيرادات يدوي باسم "${manualName.trim()}"؟`, { confirmLabel: 'إنشاء قسم' });
        if (!ok) {
            return;
        }
        createManual.mutate(null);
    }

    return (
        <>
            <p className="text-body-sm text-muted">
                دخل القسم يأتي من مبيعات الكاشير CC أو البيع الخارجي BILLS4. أقسام BILLS4 موحّدة ولا تُعتمد منفصلة. نقل الفواتير يسجل التغيير
                في النظام وبصلاحية المدير أو مدير النظام.
            </p>
            {canWrite ? (
                <Section title="إضافة قسم يدوي">
                    <div className="grid items-end gap-sm sm:grid-cols-3">
                        <Input
                            label="اسم القسم اليدوي"
                            value={manualName}
                            maxLength={255}
                            onChange={(event) => setManualName(event.target.value)}
                        />
                        <Input
                            label="الاسم الإنجليزي (اختياري)"
                            value={manualEn}
                            maxLength={255}
                            onChange={(event) => setManualEn(event.target.value)}
                        />
                        <Button
                            size="sm"
                            onClick={() => {
                                void create();
                            }}
                            loading={createManual.isPending}
                        >
                            إنشاء قسم
                        </Button>
                    </div>
                    {manualError ? <p className="text-caption text-danger-text">{manualError}</p> : null}
                </Section>
            ) : null}

            <Section
                title={`أقسام بانتظار الاعتماد (${formatInt(unmapped.length)})`}
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            void Promise.all([mapQuery.refetch(), unmappedQuery.refetch()]);
                        }}
                    >
                        تحديث
                    </Button>
                }
            >
                {unmappedQuery.isPending || mapQuery.isPending ? <StateLoading label="جارٍ جلب الأقسام…" /> : null}
                {unmappedQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(unmappedQuery.error)}
                        onRetry={() => {
                            void unmappedQuery.refetch();
                        }}
                    />
                ) : null}
                {mapQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(mapQuery.error)}
                        onRetry={() => {
                            void mapQuery.refetch();
                        }}
                    />
                ) : null}
                {mapQuery.data && unmappedQuery.data ? (
                    <DataGrid
                        label="أقسام بانتظار الاعتماد"
                        headers={['مصدر البيانات', 'اسم القسم الوارد', 'الفواتير', 'الإجمالي', 'آخر ظهور', 'الاعتماد أو الدمج']}
                        rows={unmapped.length}
                        empty="لا توجد أقسام معلقة."
                    >
                        {unmapped.map((item) => (
                            <UnmappedRow key={String(item.id)} item={item} map={map} />
                        ))}
                    </DataGrid>
                ) : null}
            </Section>

            <Section title={`خريطة الأقسام المعتمدة (${formatInt(map.length)})`}>
                {mapQuery.isPending ? <StateLoading label="جارٍ جلب خريطة الأقسام…" /> : null}
                {mapQuery.data ? (
                    <DataGrid
                        label="خريطة الأقسام المعتمدة"
                        headers={[
                            'المصدر',
                            'الاسم الوارد',
                            'اسم العرض',
                            'قسم النظام',
                            'الفواتير',
                            'الإيرادات',
                            'المصروفات',
                            'الصافي',
                            'الحالة',
                            'إجراءات',
                        ]}
                        rows={map.length}
                        empty="لا توجد روابط أقسام."
                    >
                        {map.map((item) => {
                            const net = (Number(item.posted_total) || 0) - (Number(item.posted_expenses) || 0);
                            return (
                                <Row key={String(item.id)}>
                                    <Cell>{item.src_table || '—'}</Cell>
                                    <Cell>{item.src_name || '—'}</Cell>
                                    <Cell>{item.display_ar || '—'}</Cell>
                                    <Cell ltr>
                                        <code>{item.dept_code || '—'}</code>
                                    </Cell>
                                    <Cell numeric>{formatInt(Number(item.posted_count) || 0)}</Cell>
                                    <Cell numeric>{moneyText(item.posted_total)}</Cell>
                                    <Cell numeric>{moneyText(item.posted_expenses)}</Cell>
                                    <Cell numeric>{moneyText(net)}</Cell>
                                    <Cell>
                                        <Badge variant={item.active ? 'success' : 'neutral'}>{item.active ? 'نشط' : 'معطل'}</Badge>
                                    </Cell>
                                    <Cell>
                                        <div className="flex flex-wrap gap-xs">
                                            <Button size="sm" variant="secondary" onClick={() => setSelected(item)}>
                                                الفواتير
                                            </Button>
                                            {canWrite && item.active ? (
                                                <Button size="sm" variant="ghost" onClick={() => setRenameRow(item)}>
                                                    تسمية
                                                </Button>
                                            ) : null}
                                        </div>
                                    </Cell>
                                </Row>
                            );
                        })}
                    </DataGrid>
                ) : null}
            </Section>

            {selected ? <SectionInvoicesDrill section={selected} map={map} onClose={() => setSelected(null)} /> : null}

            {renameRow ? <RenameDialog row={renameRow} onClose={() => setRenameRow(null)} /> : null}
        </>
    );
}

/* ─── ربط المنتجات ──────────────────────────────────────────────────────── */

function MappingsPanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [code, setCode] = useState('');
    const [barcode, setBarcode] = useState('');
    const [searchText, setSearchText] = useState('');
    const [options, setOptions] = useState<YarasoftProduct[]>([]);
    const [picked, setPicked] = useState('');
    const [formError, setFormError] = useState('');
    const [searching, setSearching] = useState(false);

    const mappingsQuery = useQuery({
        queryKey: YS_KEYS.mappings,
        queryFn: ({ signal }) => fetchYarasoftMappings(signal),
    });
    const save = useWriteMutation<null, unknown>({
        mutationFn: () => saveYarasoftMapping({ externalCode: code, externalBarcode: barcode, internalProductId: Number(picked) }),
        invalidate: [YS_KEYS.mappings],
        successTitle: 'تم حفظ الربط الصريح.',
        onSuccess: () => {
            setCode('');
            setBarcode('');
            setSearchText('');
            setOptions([]);
            setPicked('');
        },
    });
    const deactivate = useWriteMutation<string, unknown>({
        mutationFn: (id) => deactivateYarasoftMapping(id),
        invalidate: [YS_KEYS.mappings],
        successTitle: 'تم تعطيل الربط.',
    });

    const rows = mappingsQuery.data ?? [];
    const productOptions = options.map((product) => ({
        value: String(product.id),
        label: product.barcode ? `${product.name} — ${product.barcode}` : product.name,
    }));

    async function search() {
        const problem = productSearchError(searchText);
        if (problem) {
            setFormError(problem);
            return;
        }
        setFormError('');
        setSearching(true);
        try {
            const result = await searchYarasoftProducts(searchText);
            setOptions(result.rows);
            if (result.truncated) {
                setFormError('نتائج البحث كثيرة؛ أضف تفاصيل أكثر للاسم لتضييق القائمة.');
            } else if (!result.rows.length) {
                setFormError('لم يعثر البحث على منتجات مطابقة.');
            }
        } catch (cause) {
            setFormError(writeErrorMessage(cause, 'تعذّر البحث عن المنتجات.'));
        } finally {
            setSearching(false);
        }
    }

    async function submit() {
        const problem = mappingFormError({ externalCode: code, externalBarcode: barcode, internalProductId: picked });
        if (problem) {
            setFormError(problem);
            return;
        }
        setFormError('');
        const ok = await confirm(
            `ربط الكود "${code || '—'}" والباركود "${barcode || '—'}" بالمنتج المحدد؟ سيؤثر الربط على المطابقة الحالية واللاحقة.`,
            { confirmLabel: 'حفظ الربط' },
        );
        if (!ok) {
            return;
        }
        save.mutate(null);
    }

    async function remove(mappingId: string, label: string) {
        const ok = await confirm(`تعطيل ربط "${label}"؟ لن يُحذف سجل الربط.`, { confirmLabel: 'تعطيل الربط' });
        if (ok) {
            deactivate.mutate(mappingId);
        }
    }

    return (
        <>
            <p className="text-body-sm text-muted">
                ترتيب المطابقة التلقائي لدى الخادم يبدأ بالباركود ثم الكود الخارجي ثم الروابط الصريحة. التعطيل لا يحذف سجل الربط.
            </p>

            {canWrite ? (
                <Section title="إضافة ربط صريح">
                    <div className="grid items-end gap-sm sm:grid-cols-2 xl:grid-cols-3">
                        <Input label="كود الكاشير" value={code} maxLength={120} onChange={(event) => setCode(event.target.value)} />
                        <Input
                            label="باركود الكاشير"
                            value={barcode}
                            maxLength={120}
                            onChange={(event) => setBarcode(event.target.value)}
                        />
                        <div className="flex items-end gap-xs">
                            <Input
                                label="بحث عن منتج المخزون"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                containerClassName="flex-1"
                            />
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                    void search();
                                }}
                                loading={searching}
                            >
                                بحث
                            </Button>
                        </div>
                        <Select
                            label="المنتج الداخلي"
                            options={productOptions}
                            value={picked}
                            onValueChange={setPicked}
                            placeholder="ابحث واختر منتجاً"
                        />
                        <div className="flex items-end">
                            <Button
                                size="sm"
                                onClick={() => {
                                    void submit();
                                }}
                                loading={save.isPending}
                            >
                                حفظ الربط
                            </Button>
                        </div>
                    </div>
                    {formError ? <p className="text-caption text-danger-text">{formError}</p> : null}
                </Section>
            ) : null}

            <Section
                title={`روابط المنتجات (${formatInt(rows.length)})`}
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            void mappingsQuery.refetch();
                        }}
                    >
                        تحديث
                    </Button>
                }
            >
                {mappingsQuery.isPending ? <StateLoading label="جارٍ جلب روابط المنتجات…" /> : null}
                {mappingsQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(mappingsQuery.error)}
                        onRetry={() => {
                            void mappingsQuery.refetch();
                        }}
                    />
                ) : null}
                {mappingsQuery.data ? (
                    <DataGrid
                        label="روابط المنتجات"
                        headers={['كود الكاشير', 'باركود الكاشير', 'منتج المخزون', 'الحالة', 'إجراء']}
                        rows={rows.length}
                        empty="لا توجد روابط صريحة؛ تظل المطابقة الآلية فعالة."
                    >
                        {rows.map((mapping) => (
                            <Row key={String(mapping.id)}>
                                <Cell ltr>{mapping.external_code || '—'}</Cell>
                                <Cell ltr>{mapping.external_barcode || '—'}</Cell>
                                <Cell>
                                    {mapping.product_name || '—'}
                                    {mapping.product_barcode ? (
                                        <div className="text-caption text-muted" dir="ltr">
                                            {mapping.product_barcode}
                                        </div>
                                    ) : null}
                                </Cell>
                                <Cell>
                                    <StatusBadge status={mapping.active ? 'COMPLETED' : 'DETECTED'} />
                                </Cell>
                                <Cell>
                                    {canWrite && mapping.active ? (
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            onClick={() =>
                                                void remove(
                                                    String(mapping.id),
                                                    mapping.external_code || mapping.external_barcode || 'المنتج',
                                                )
                                            }
                                            loading={deactivate.isPending && deactivate.variables === String(mapping.id)}
                                        >
                                            تعطيل الربط
                                        </Button>
                                    ) : (
                                        '—'
                                    )}
                                </Cell>
                            </Row>
                        ))}
                    </DataGrid>
                ) : null}
            </Section>
        </>
    );
}

/* ─── ربط قاعدة الكاشير (Oracle) ─────────────────────────────────────────── */

function OraclePanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [days, setDays] = useState('14');
    const [formError, setFormError] = useState('');

    const statusQuery = useQuery({
        queryKey: YS_KEYS.oracleStatus,
        queryFn: ({ signal }) => fetchYarasoftOracleStatus(signal),
    });
    const catchUpQuery = useQuery({
        queryKey: YS_KEYS.catchUp,
        queryFn: ({ signal }) => fetchYarasoftOracleCatchUpStatus(signal),
        refetchInterval: 15_000,
    });

    const test = useWriteMutation<null, Awaited<ReturnType<typeof testYarasoftOracle>>>({
        mutationFn: async () => {
            const result = await testYarasoftOracle();
            if (result.ok === false) {
                throw new Error(result.message || result.error || 'فشل فحص اتصال قاعدة الكاشير.');
            }
            return result;
        },
        successTitle: YS_TEXT.oracleTested,
        invalidate: [YS_KEYS.oracleStatus],
    });
    const poll = useWriteMutation<null, Awaited<ReturnType<typeof pollYarasoftOracleNow>>>({
        mutationFn: async () => {
            const result = await pollYarasoftOracleNow();
            if (result.ok === false) {
                throw new Error(result.message || result.error || 'فشل السحب الفوري.');
            }
            return result;
        },
        successTitle: YS_TEXT.oraclePolled,
        invalidate: [YS_KEYS.oracleStatus],
    });
    const preview = useWriteMutation<null, Awaited<ReturnType<typeof previewYarasoftOracleItems>>>({
        mutationFn: async () => {
            const result = await previewYarasoftOracleItems();
            if (result.ok === false) {
                throw new Error(result.message || result.error || 'تعذرت معاينة أصناف قاعدة الكاشير.');
            }
            return result;
        },
        successTitle: YS_TEXT.itemsPreviewed,
    });
    const importItems = useWriteMutation<null, Awaited<ReturnType<typeof importYarasoftOracleItems>>>({
        mutationFn: async () => {
            const result = await importYarasoftOracleItems();
            if (result.ok === false) {
                throw new Error(result.error || 'تعذر استيراد الأصناف.');
            }
            return result;
        },
        successTitle: YS_TEXT.itemsImported,
        onSuccess: () => preview.reset(),
    });
    const reconcile = useWriteMutation<number, Awaited<ReturnType<typeof fetchYarasoftOracleReconcile>>>({
        mutationFn: (value) => fetchYarasoftOracleReconcile(value),
        successTitle: YS_TEXT.reconciled,
    });
    const catchUp = useWriteMutation<number, Awaited<ReturnType<typeof startYarasoftOracleCatchUp>>>({
        mutationFn: (value) => startYarasoftOracleCatchUp(value),
        successTitle: YS_TEXT.catchUpStarted,
        invalidate: [YS_KEYS.catchUp],
    });

    const connection = statusQuery.data?.oracle;
    const job = catchUpQuery.data?.job;
    const previewData = preview.data;
    const reconcileData = reconcile.data;
    const flag = (value: boolean | undefined) => (value ? 'مضبوط' : 'غير مضبوط');

    function validDays(): number | null {
        const problem = oracleDaysError(days);
        if (problem) {
            setFormError(problem);
            return null;
        }
        setFormError('');
        return Number(days);
    }

    async function requestPoll() {
        const ok = await confirm('بدء سحب فوري من قاعدة الكاشير؟ قد يستغرق ذلك وقتاً بحسب حجم البيانات والاتصال.', {
            confirmLabel: 'سحب الآن',
        });
        if (ok) {
            poll.mutate(null);
        }
    }

    async function requestImport() {
        const count = Number(previewData?.fresh) || 0;
        if (count <= 0) {
            return;
        }
        const ok = await confirm(`استيراد ${formatInt(count)} صنف جديد فقط إلى المخزون؟ تُنشأ الأصناف بكمية صفر، والموجود يُتخطى.`, {
            confirmLabel: 'استيراد الأصناف',
        });
        if (ok) {
            importItems.mutate(null);
        }
    }

    async function requestCatchUp() {
        const value = validDays();
        if (value === null) {
            return;
        }
        const ok = await confirm(
            `بدء مهمة لحاق بفجوات المزامنة حتى ${formatInt(value)} يوماً؟ تعمل المهمة في الخلفية، وقد تتصل بقاعدة الكاشير لفترة طويلة.`,
            {
                confirmLabel: 'بدء اللحاق',
            },
        );
        if (ok) {
            catchUp.mutate(value);
        }
    }

    return (
        <>
            <Section
                title="اتصال قاعدة الكاشير"
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            void statusQuery.refetch();
                        }}
                    >
                        تحديث الحالة
                    </Button>
                }
            >
                {statusQuery.isPending ? <StateLoading label="جارٍ فحص حالة الربط…" /> : null}
                {statusQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(statusQuery.error)}
                        onRetry={() => {
                            void statusQuery.refetch();
                        }}
                    />
                ) : null}
                {connection ? (
                    <>
                        <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                            <Metric label="المزامنة مفعلة" value={connection.enabled ? 'نعم' : 'لا'} />
                            <Metric
                                label="برنامج التشغيل"
                                value={connection.driver === null ? 'لم يُفحص' : connection.driver ? 'متاح' : 'غير متاح'}
                            />
                            <Metric label="حالة العامل" value={connection.running ? 'يعمل' : 'متوقف'} />
                            <Metric label="عناصر بالانتظار" value={formatInt(Number(connection.stagedTotal) || 0)} />
                        </div>
                        <p className="text-body-sm text-ink">
                            الخادم:{' '}
                            <bdi dir="ltr">
                                {connection.host || '—'}:{String(connection.port ?? '—')}/{connection.service || '—'}
                            </bdi>{' '}
                            · اسم المستخدم {flag(connection.hasUser)} · بيانات الاعتماد {flag(connection.hasPassword)} · SQL{' '}
                            {flag(connection.hasSql)} · آخر نجاح: {connection.lastOk || 'لا يوجد'}
                        </p>
                        {connection.lastError ? <Notice>آخر خطأ اتصال: {connection.lastError}</Notice> : null}
                    </>
                ) : null}
                {canWrite ? (
                    <div className="flex flex-wrap gap-xs">
                        <Button size="sm" variant="secondary" onClick={() => test.mutate(null)} loading={test.isPending}>
                            فحص الاتصال
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                void requestPoll();
                            }}
                            loading={poll.isPending}
                        >
                            سحب الآن
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => preview.mutate(null)} loading={preview.isPending}>
                            معاينة استيراد الأصناف
                        </Button>
                    </div>
                ) : null}
            </Section>

            {previewData ? (
                <Section
                    title="معاينة استيراد دليل الأصناف"
                    action={<StatusBadge status={previewData.ok === false ? 'FAILED' : 'COMPLETED'} />}
                >
                    {previewData.ok === false ? (
                        <Notice>تعذرت المعاينة: {previewData.error || previewData.message || 'تعذر قراءة قائمة الأصناف.'}</Notice>
                    ) : (
                        <>
                            <p className="text-body-sm text-ink">
                                الإجمالي: {formatInt(Number(previewData.total) || 0)} · أصناف جديدة:{' '}
                                {formatInt(Number(previewData.fresh) || 0)} · موجودة/متخطاة: {formatInt(Number(previewData.skipped) || 0)} ·
                                مجموعات مستبعدة: {formatInt(Number(previewData.groups) || 0)}
                            </p>
                            {canWrite && Number(previewData.fresh) > 0 ? (
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        void requestImport();
                                    }}
                                    loading={importItems.isPending}
                                >
                                    استيراد الأصناف الجديدة فقط
                                </Button>
                            ) : null}
                        </>
                    )}
                </Section>
            ) : null}

            <Section title="مقارنة المزامنة">
                <div className="flex flex-wrap items-end gap-xs">
                    <Input
                        label="الفترة بالأيام"
                        type="number"
                        size="sm"
                        min={1}
                        max={90}
                        value={days}
                        onChange={(event) => setDays(event.target.value)}
                        containerClassName="w-32"
                    />
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            const value = validDays();
                            if (value !== null) {
                                reconcile.mutate(value);
                            }
                        }}
                        loading={reconcile.isPending}
                    >
                        مقارنة الآن
                    </Button>
                    {canWrite ? (
                        <Button
                            size="sm"
                            onClick={() => {
                                void requestCatchUp();
                            }}
                            loading={catchUp.isPending}
                        >
                            بدء اللحاق بالفجوات
                        </Button>
                    ) : null}
                </div>
                {formError ? <p className="text-caption text-danger-text">{formError}</p> : null}
                {reconcileData ? (
                    <>
                        <p className="text-body-sm text-ink">
                            <Badge variant={reconcileData.overall === 'ok' ? 'success' : 'warning'}>
                                {reconcileData.overall === 'ok'
                                    ? 'المقارنة ضمن هامش التفاوت المعتمد بالخادم'
                                    : 'توجد فجوات حسب نتيجة الخادم'}
                            </Badge>{' '}
                            · قاعدة الكاشير: {formatInt(Number(reconcileData.totalOra) || 0)} · محلي:{' '}
                            {formatInt(Number(reconcileData.totalLocal) || 0)} · {formatInt(Number(reconcileData.days) || 0)} يوم
                        </p>
                        <DataGrid
                            label="مقارنة المزامنة"
                            headers={['اليوم', 'فواتير CC', 'فواتير BILLS4', 'محلي', 'النتيجة']}
                            rows={reconcileData.rows?.length ?? 0}
                            empty="لا توجد بيانات مقارنة."
                        >
                            {(reconcileData.rows ?? []).map((row) => (
                                <Row key={String(row.day)}>
                                    <Cell ltr>{row.day || '—'}</Cell>
                                    <Cell numeric>{formatInt(Number(row.ora_cc) || 0)}</Cell>
                                    <Cell numeric>{formatInt(Number(row.ora_b4) || 0)}</Cell>
                                    <Cell numeric>{formatInt(Number(row.local_count) || 0)}</Cell>
                                    <Cell>
                                        <Badge variant={row.status === 'ok' ? 'success' : 'warning'}>
                                            {row.status === 'ok' ? 'متطابق ضمن هامش الخادم' : 'فرق للمراجعة'}
                                        </Badge>
                                    </Cell>
                                </Row>
                            ))}
                        </DataGrid>
                    </>
                ) : (
                    <p className="text-body-sm text-muted">المقارنة لم تُشغّل — شغّلها لطلب النتيجة المباشرة من الخادم.</p>
                )}
                <p className="text-body-sm text-muted">
                    حالة مهمة اللحاق: {job?.running ? 'قيد التنفيذ' : job?.finishedAt ? `انتهت ${job.finishedAt}` : 'لا توجد مهمة'} · أُرسلت{' '}
                    {formatInt(Number(job?.posted) || 0)} · مكررات {formatInt(Number(job?.dups) || 0)}
                    {job?.error ? ` · ${job.error}` : ''}
                </p>
            </Section>
        </>
    );
}

/* ─── جودة البيانات ─────────────────────────────────────────────────────── */

function QualityPanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const { toast } = useToast();
    const [needle, setNeedle] = useState('');

    const catalogQuery = useQuery({
        queryKey: YS_KEYS.catalog,
        queryFn: ({ signal }) => fetchYarasoftCatalogStatus(signal),
    });
    const quarantineQuery = useQuery({
        queryKey: YS_KEYS.quarantine,
        queryFn: ({ signal }) => fetchYarasoftQuarantine(signal),
    });
    const organize = useWriteMutation<null, Awaited<ReturnType<typeof organizeYarasoftCategories>>>({
        mutationFn: () => organizeYarasoftCategories(),
        invalidate: [YS_KEYS.catalog, YS_KEYS.quarantine],
        onSuccess: (data) => {
            toast({
                title: data.ok
                    ? `تم التنظيم: ${formatInt(Number(data.categorized) || 0)} صنف في ${formatInt(Number(data.groups) || 0)} مجموعة (سليم ${formatInt(Number(data.alreadyOk) || 0)} · غير مربوط ${formatInt(Number(data.unmapped) || 0)}).`
                    : data.error || 'تعذر تنظيم الأقسام.',
                variant: data.ok ? 'success' : 'error',
            });
        },
    });
    const sync = useWriteMutation<boolean, Awaited<ReturnType<typeof syncYarasoftBalances>>>({
        mutationFn: (force) => syncYarasoftBalances(force),
        invalidate: [YS_KEYS.catalog, YS_KEYS.quarantine],
        onSuccess: (data) => {
            toast({
                title: data.ok
                    ? `تمت المزامنة: ${formatInt(Number(data.applied) || 0)} مطبّق · ${formatInt(Number(data.quarantined) || 0)} محجوز · ${formatInt(Number(data.unmapped) || 0)} غير مربوط.`
                    : data.error || 'تعذرت مزامنة الأرصدة.',
                variant: data.ok ? 'success' : 'error',
            });
        },
    });

    const catalog = catalogQuery.data;
    const purchases = catalog?.purchases;
    const quarantine = quarantineRows(quarantineQuery.data);
    const quarantinedValue = quarantine.reduce((sum, row) => sum + (Number(row.value_amount) || 0), 0);
    const filtered = useMemo(() => {
        const term = needle.trim().toLowerCase();
        if (!term) {
            return quarantine;
        }
        return quarantine.filter((row) =>
            [row.kind, row.ref_code, row.reason].some((value) =>
                String(value ?? '')
                    .toLowerCase()
                    .includes(term),
            ),
        );
    }, [quarantine, needle]);

    async function requestOrganize() {
        const ok = await confirm('تنظيم أقسام الأصناف من دليل الكاشير؟ قد تُعاد تسمية أقسام موجودة وفق الدليل.', {
            confirmLabel: 'تنظيم الأقسام',
        });
        if (ok) {
            organize.mutate(null);
        }
    }

    async function requestSync(force: boolean) {
        const ok = await confirm(
            force
                ? 'مزامنة إجبارية تتجاوز حماية الأصناف المعدّلة محليًا. متابعة؟'
                : 'مزامنة أرصدة الأصناف غير المعدّلة محليًا من قاعدة الكاشير؟',
            { confirmLabel: 'مزامنة الأرصدة' },
        );
        if (ok) {
            sync.mutate(force);
        }
    }

    function printQuarantine() {
        const printWindow = openBlankTab('الحجر الصحي لقيم مخازن الكاشير');
        if (!printWindow) {
            toast({ title: 'تعذّر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.', variant: 'error' });
            return;
        }
        printHtmlDocument(printWindow, quarantineReportHtml(quarantine));
    }

    return (
        <>
            <Section
                title="جودة بيانات قاعدة الكاشير"
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            void Promise.all([catalogQuery.refetch(), quarantineQuery.refetch()]);
                        }}
                    >
                        تحديث
                    </Button>
                }
            >
                <p className="text-body-sm text-muted">
                    مؤشرات قراءة فقط من دليل الأصناف في قاعدة الكاشير. البنود التي يتعذر ترحيلها تُحجز هنا بدل إسقاطها بصمت؛ راجعها ثم أعد
                    معالجة الفواتير من تبويب الحالة.
                </p>
                {catalogQuery.isPending || quarantineQuery.isPending ? <StateLoading label="جارٍ فحص جودة البيانات…" /> : null}
                {catalogQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(catalogQuery.error)}
                        onRetry={() => {
                            void catalogQuery.refetch();
                        }}
                    />
                ) : null}
                {catalogQuery.data ? (
                    <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-3">
                        <Metric label="أصناف بكمية" value={formatInt(Number(catalog?.withQty) || 0)} />
                        <Metric label="أصناف بكمية صفر" value={formatInt(Number(catalog?.zeroQty) || 0)} />
                        <Metric label="فواتير شراء" value={formatInt(Number(purchases?.n) || 0)} />
                        <Metric label="قيمة المشتريات" value={moneyText(purchases?.t)} />
                        <Metric
                            label="عملاء / أصول"
                            value={`${formatInt(Number(catalog?.customers) || 0)} / ${formatInt(Number(catalog?.assets) || 0)}`}
                        />
                        <Metric label="بنود الحجر (قيمة)" value={`${formatInt(quarantine.length)} · ${moneyText(quarantinedValue)}`} />
                    </div>
                ) : null}
                {canWrite ? (
                    <div className="flex flex-wrap gap-xs">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                void requestOrganize();
                            }}
                            loading={organize.isPending}
                        >
                            تنظيم الأقسام من دليل الكاشير
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                void requestSync(false);
                            }}
                            loading={sync.isPending && sync.variables === false}
                        >
                            مزامنة الأرصدة (دون تجاوز)
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                                void requestSync(true);
                            }}
                            loading={sync.isPending && sync.variables === true}
                        >
                            مزامنة إجبارية
                        </Button>
                    </div>
                ) : (
                    <p className="text-body-sm text-muted">التنفيذ مقصور على الإدارة: يلزم دور admin أو manager.</p>
                )}
            </Section>

            <Section
                title={`بنود الحجر (${formatInt(filtered.length)})`}
                action={
                    <div className="flex flex-wrap items-end gap-xs">
                        <Input
                            label="بحث"
                            type="search"
                            size="sm"
                            placeholder="نوع، مرجع، سبب…"
                            value={needle}
                            onChange={(event) => setNeedle(event.target.value)}
                            containerClassName="w-56"
                        />
                        <Button size="sm" variant="secondary" disabled={quarantineQuery.isPending} onClick={printQuarantine}>
                            طباعة بنود الحجر
                        </Button>
                    </div>
                }
            >
                {quarantineQuery.isPending ? <StateLoading label="جارٍ جلب بنود الحجر…" /> : null}
                {quarantineQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(quarantineQuery.error)}
                        onRetry={() => {
                            void quarantineQuery.refetch();
                        }}
                    />
                ) : null}
                {quarantineQuery.data ? (
                    <DataGrid
                        label="بنود الحجر"
                        headers={['النوع', 'المرجع', 'الكمية', 'القيمة', 'تكلفة الوحدة', 'السبب']}
                        rows={filtered.length}
                        empty={needle.trim() ? 'لا نتائج مطابقة للبحث.' : 'لا توجد بنود في الحجر — البيانات متسقة.'}
                    >
                        {filtered.map((row, index) => (
                            <Row key={`${String(row.ref_code ?? '')}-${String(index)}`}>
                                <Cell>
                                    <Badge variant="warning">{row.kind || '—'}</Badge>
                                </Cell>
                                <Cell ltr>
                                    <code>{row.ref_code || '—'}</code>
                                </Cell>
                                <Cell numeric>{row.qty == null ? '—' : moneyText(row.qty)}</Cell>
                                <Cell numeric>{row.value_amount == null ? '—' : moneyText(row.value_amount)}</Cell>
                                <Cell numeric>{row.unit_cost == null ? '—' : moneyText(row.unit_cost)}</Cell>
                                <Cell>{row.reason || '—'}</Cell>
                            </Row>
                        ))}
                    </DataGrid>
                ) : null}
            </Section>
        </>
    );
}

/* ─── معاينة الصيغة ─────────────────────────────────────────────────────── */

function ToolsPanel() {
    const { canWrite } = useRole();
    const [text, setText] = useState('');
    const [error, setError] = useState('');

    const preview = useWriteMutation<null, Awaited<ReturnType<typeof previewYarasoftInvoiceText>>>({
        mutationFn: async () => {
            const result = await previewYarasoftInvoiceText(text);
            if (result.ok === false) {
                throw new Error(result.message || result.error || 'فشل تحليل محتوى الفاتورة.');
            }
            return result;
        },
        successTitle: YS_TEXT.previewed,
        onError: (cause) => setError(writeErrorMessage(cause)),
        onSuccess: () => setError(''),
    });

    const result = preview.data;
    const invoice = result?.parsed?.invoices?.[0];
    const matching = invoice?.matching;
    const resolved = matching?.resolved ?? [];
    const unmapped = matching?.unmapped ?? [];

    function run() {
        const problem = previewTextError(text);
        if (problem) {
            setError(problem);
            return;
        }
        setError('');
        preview.mutate(null);
    }

    return (
        <>
            <Section title="معاينة الصيغة">
                <p className="text-body-sm text-ink">
                    أداة تحليل ومطابقة قراءة فقط. المحتوى يُرسل إلى خادم النظام لتحليله ومقارنته بالمخزون؛ لا تُرحّل فواتير ولا تُعدّل بيانات
                    المخزون.
                </p>
                {canWrite ? (
                    <>
                        <Textarea
                            label="محتوى ملف الفاتورة (حد الخادم 2 ميغابايت)"
                            rows={10}
                            dir="ltr"
                            spellCheck={false}
                            placeholder="InvoiceNo;Date;ItemCode;Qty;Price..."
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            containerClassName="font-mono"
                        />
                        {error ? <p className="text-caption text-danger-text">{error}</p> : null}
                        <div>
                            <Button size="sm" onClick={run} loading={preview.isPending}>
                                حلّل وطابق دون ترحيل
                            </Button>
                        </div>
                    </>
                ) : (
                    <p className="text-body-sm text-muted">الأداة مقصورة على الإدارة: يلزم دور admin أو manager.</p>
                )}
            </Section>

            {result ? (
                <Section title={`نتيجة المعاينة — ${result.parsed?.kind || 'صيغة غير معروفة'}`}>
                    {invoice ? (
                        <>
                            <p className="text-body-sm text-ink">
                                الفاتورة: {invoice.invoiceNumber || 'لم يُكتشف الرقم'} · التاريخ: {invoice.date || '—'} · طريقة الدفع:{' '}
                                {invoice.paymentMethod || '—'} · عدد الأصناف: {formatInt(invoice.items?.length ?? 0)}
                            </p>
                            <div className="grid gap-sm sm:grid-cols-2">
                                <Metric label="مطابق" value={formatInt(resolved.length)} />
                                <Metric label="بحاجة ربط" value={formatInt(unmapped.length)} />
                            </div>
                            <DataGrid
                                label="الأصناف المطابقة"
                                headers={['الصنف الخارجي', 'المنتج الداخلي', 'معرّف المنتج', 'طريقة المطابقة']}
                                rows={resolved.length}
                                empty="لم تُطابق أصناف."
                            >
                                {resolved.map((item, index) => (
                                    <Row key={`resolved-${String(index)}`}>
                                        <Cell>{item.item || '—'}</Cell>
                                        <Cell>{item.product || '—'}</Cell>
                                        <Cell ltr>
                                            <code>{item.productId == null ? '—' : String(item.productId)}</code>
                                        </Cell>
                                        <Cell>{item.via || '—'}</Cell>
                                    </Row>
                                ))}
                            </DataGrid>
                            <DataGrid
                                label="أصناف بحاجة ربط"
                                headers={['الصنف', 'الكود', 'الباركود', 'سبب عدم المطابقة']}
                                rows={unmapped.length}
                                empty="جميع الأصناف لها تطابق."
                            >
                                {unmapped.map((item, index) => (
                                    <Row key={`unmapped-${String(index)}`}>
                                        <Cell>{item.name || item.code || '—'}</Cell>
                                        <Cell ltr>{item.code || '—'}</Cell>
                                        <Cell ltr>{item.barcode || '—'}</Cell>
                                        <Cell>{item.reason || '—'}</Cell>
                                    </Row>
                                ))}
                            </DataGrid>
                        </>
                    ) : (
                        <StateEmpty title="لم يُكتشف أي فاتورة" hint="تحقق من محتوى الملف وملف تعريف التنسيق." />
                    )}
                    {result.suggestedProfile ? (
                        <details>
                            <summary className="cursor-pointer text-body-sm text-ink">ملف تعريف مقترح (للمراجعة فقط)</summary>
                            <pre dir="ltr" className="mt-xs max-h-64 overflow-auto rounded-md bg-surface-sunken p-sm text-caption">
                                {JSON.stringify(result.suggestedProfile, null, 2)}
                            </pre>
                        </details>
                    ) : null}
                </Section>
            ) : null}
        </>
    );
}

/* ─── مرآة الكاشيرية ────────────────────────────────────────────────────── */

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function MirrorPanel() {
    const { canWrite } = useRole();
    const confirm = useConfirm();
    const [date, setDate] = useState(() => todayIso());
    const [cashier, setCashier] = useState('');
    const [offset, setOffset] = useState(0);
    const [detailDoc, setDetailDoc] = useState<string | null>(null);
    const [closeKey, setCloseKey] = useState<{ date: string; cashier: string } | null>(null);

    const cashiersQuery = useQuery({
        queryKey: ['yarasoft', 'mirror', 'cashiers', date],
        queryFn: ({ signal }) => fetchYarasoftMirrorCashiers(date, signal),
    });
    const ordersQuery = useQuery({
        queryKey: ['yarasoft', 'mirror', 'orders', date, cashier, offset],
        queryFn: ({ signal }) => fetchYarasoftMirrorOrders({ date, cashier, limit: 50, offset }, signal),
    });
    const detailQuery = useQuery({
        queryKey: ['yarasoft', 'mirror', 'order', detailDoc],
        queryFn: () => fetchYarasoftMirrorOrder(detailDoc ?? ''),
        enabled: detailDoc !== null,
        retry: false,
    });
    const closeQuery = useQuery({
        queryKey: ['yarasoft', 'mirror', 'close', closeKey?.date ?? '', closeKey?.cashier ?? ''],
        queryFn: () => fetchYarasoftMirrorClose(closeKey ?? { cashier: '' }),
        enabled: closeKey !== null,
        retry: false,
    });
    const refresh = useWriteMutation<null, Awaited<ReturnType<typeof refreshYarasoftMirror>>>({
        mutationFn: () => refreshYarasoftMirror(),
        invalidate: [YS_KEYS.mirror],
        successTitle: YS_TEXT.mirrorRefreshed,
    });

    const cashiers = cashiersQuery.data?.cashiers ?? [];
    const orders: YarasoftMirrorOrderRow[] = ordersQuery.data?.orders ?? [];
    const total = Number(ordersQuery.data?.total) || 0;
    const detail: YarasoftMirrorOrderDetail | null | undefined = detailQuery.data?.order;
    const close: YarasoftMirrorClose | undefined = closeQuery.data;

    async function requestRefresh() {
        const ok = await confirm('تحديث المرآة من بيانات الكاشير الآن؟ سيجلب الخادم حركات اليومين الأخيرين.', {
            confirmLabel: 'تحديث المرآة',
        });
        if (ok) {
            refresh.mutate(null);
        }
    }

    function shiftDay(next: string) {
        setDate(next);
        setOffset(0);
        setDetailDoc(null);
        setCloseKey(null);
    }

    function pickCashier(next: string) {
        setCashier(next);
        setOffset(0);
        setDetailDoc(null);
        setCloseKey(null);
    }

    return (
        <>
            <Section
                title="ملخص المرآة الحية"
                action={
                    <div className="flex flex-wrap items-end gap-xs">
                        <Input
                            label="التاريخ"
                            type="date"
                            size="sm"
                            value={date}
                            onChange={(event) => shiftDay(event.target.value)}
                            containerClassName="w-40"
                        />
                        {canWrite ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                    void requestRefresh();
                                }}
                                loading={refresh.isPending}
                            >
                                تحديث من المصدر
                            </Button>
                        ) : null}
                    </div>
                }
            >
                <div className="flex flex-wrap gap-xs">
                    <Button size="sm" variant={cashier === '' ? 'primary' : 'secondary'} onClick={() => pickCashier('')}>
                        كل الكاشيرات
                    </Button>
                    {cashiers.map((entry) => (
                        <Button
                            key={String(entry.cashier_no)}
                            size="sm"
                            variant={cashier === String(entry.cashier_no) ? 'primary' : 'secondary'}
                            onClick={() => pickCashier(String(entry.cashier_no))}
                        >
                            كاشير {String(entry.cashier_no)}
                        </Button>
                    ))}
                </div>
                {cashiersQuery.isPending ? <StateLoading label="جارٍ جلب ملخص المرآة…" /> : null}
                {cashiersQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(cashiersQuery.error)}
                        onRetry={() => {
                            void cashiersQuery.refetch();
                        }}
                    />
                ) : null}
                <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    {cashiers.map((entry) => (
                        <div key={String(entry.cashier_no)} className="rounded-lg border border-hairline bg-surface-sunken p-sm">
                            <p className="text-label-md text-muted">كاشير {String(entry.cashier_no)}</p>
                            <p className="erp-numeric mt-xxs text-heading-md text-ink">{moneyText(entry.revenue)}</p>
                            <p className="mt-xxs text-caption text-muted">
                                {formatInt(Number(entry.invoices) || 0)} فاتورة · آخر حركة {entry.last_time || '—'}
                            </p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section
                title={`الأوردرات${cashier ? ` — كاشير ${cashier}` : ''}`}
                action={
                    <div className="flex flex-wrap gap-xs">
                        {cashier ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setCloseKey({ date, cashier })}
                                loading={closeQuery.isFetching && closeKey !== null}
                            >
                                تقفيل الكاشير المحدد
                            </Button>
                        ) : null}
                        <span className="self-center text-body-sm text-muted">{formatInt(total)} أوردر</span>
                    </div>
                }
            >
                {ordersQuery.isPending ? <StateLoading label="جارٍ جلب أوردرات المرآة…" /> : null}
                {ordersQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(ordersQuery.error)}
                        onRetry={() => {
                            void ordersQuery.refetch();
                        }}
                    />
                ) : null}
                {ordersQuery.data ? (
                    <>
                        <DataGrid
                            label="أوردرات المرآة"
                            headers={['رقم الأوردر', 'الوقت', 'الكاشير', 'الإجمالي', 'المدفوع', 'الأصناف', 'الموقع']}
                            rows={orders.length}
                            empty="لا توجد أوردرات في المرآة لهذا اليوم أو الكاشير."
                        >
                            {orders.map((order) => (
                                <Row key={String(order.doc_no)}>
                                    <Cell>
                                        <button
                                            type="button"
                                            className="text-primary underline-offset-2 hover:underline"
                                            onClick={() => setDetailDoc(String(order.doc_no))}
                                        >
                                            <code dir="ltr">{String(order.doc_no)}</code>
                                        </button>
                                    </Cell>
                                    <Cell ltr>{order.doc_time || '—'}</Cell>
                                    <Cell>{order.cashier_no == null ? '—' : String(order.cashier_no)}</Cell>
                                    <Cell numeric>{moneyText(order.total)}</Cell>
                                    <Cell numeric>{moneyText(order.payed)}</Cell>
                                    <Cell numeric>{formatInt(Number(order.lines_count) || 0)}</Cell>
                                    <Cell>{order.table_name || order.zone_name || '—'}</Cell>
                                </Row>
                            ))}
                        </DataGrid>
                        <div className="flex flex-wrap items-center gap-xs">
                            {offset > 0 ? (
                                <Button size="sm" variant="secondary" onClick={() => setOffset(Math.max(0, offset - 50))}>
                                    السابق
                                </Button>
                            ) : null}
                            <span className="text-body-sm text-muted">
                                عرض {formatInt(offset + (orders.length ? 1 : 0))}–{formatInt(offset + orders.length)} من {formatInt(total)}
                            </span>
                            {offset + orders.length < total ? (
                                <Button size="sm" variant="secondary" onClick={() => setOffset(offset + 50)}>
                                    التالي
                                </Button>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </Section>

            {closeKey ? (
                <Section
                    title={`تقفيل كاشير ${closeKey.cashier} · ${closeKey.date}`}
                    action={
                        <Button size="sm" variant="secondary" onClick={() => setCloseKey(null)}>
                            إخفاء التقفيل
                        </Button>
                    }
                >
                    {closeQuery.isPending ? <StateLoading label="جارٍ جلب تقرير التقفيل…" /> : null}
                    {closeQuery.isError ? (
                        <QueryError
                            message={writeErrorMessage(closeQuery.error)}
                            onRetry={() => {
                                void closeQuery.refetch();
                            }}
                        />
                    ) : null}
                    {close ? (
                        <>
                            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-3">
                                <Metric label="الإجمالي" value={moneyText(close.gross)} />
                                <Metric label="الخصم" value={moneyText(close.discount)} />
                                <Metric label="الضريبة" value={moneyText(close.vat)} />
                                <Metric label="الصافي" value={moneyText(close.net)} />
                                <Metric label="المدفوع" value={moneyText(close.payed)} />
                                <Metric label="المتبقي" value={moneyText(close.open)} />
                            </div>
                            <p className="text-body-sm text-ink">
                                نقدي {moneyText(close.pay_split?.cash)} · شبكة {moneyText(close.pay_split?.network)} · آجل{' '}
                                {moneyText(close.pay_split?.credit)} · جوال {moneyText(close.pay_split?.mobile)} · متوسط الفاتورة{' '}
                                {moneyText(close.avg)}
                            </p>
                            <DataGrid
                                label="الحركة بالساعة"
                                headers={['الساعة', 'الفواتير', 'الإيراد']}
                                rows={Object.keys(close.by_hour ?? {}).length}
                                empty="لا توجد حركات بالساعة."
                            >
                                {Object.entries(close.by_hour ?? {}).map(([hour, item]) => (
                                    <Row key={hour}>
                                        <Cell ltr>{hour}</Cell>
                                        <Cell numeric>{formatInt(Number(item.invoices) || 0)}</Cell>
                                        <Cell numeric>{moneyText(item.revenue)}</Cell>
                                    </Row>
                                ))}
                            </DataGrid>
                            <DataGrid
                                label="أصناف التقفيل"
                                headers={['الصنف', 'الكمية', 'الإجمالي']}
                                rows={close.top_items?.length ?? 0}
                                empty="لا توجد أصناف مسجلة."
                            >
                                {(close.top_items ?? []).map((item, index) => (
                                    <Row key={`${String(item.name ?? '')}-${String(index)}`}>
                                        <Cell>{item.name || '—'}</Cell>
                                        <Cell numeric>{moneyText(item.qty)}</Cell>
                                        <Cell numeric>{moneyText(item.total)}</Cell>
                                    </Row>
                                ))}
                            </DataGrid>
                        </>
                    ) : null}
                </Section>
            ) : null}

            <Dialog
                open={detailDoc !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setDetailDoc(null);
                    }
                }}
                title={`الأوردر ${detailDoc ?? ''}`}
                size="lg"
            >
                {detailQuery.isPending ? <StateLoading label="جارٍ جلب تفاصيل الأوردر…" /> : null}
                {detailQuery.isError ? (
                    <QueryError
                        message={writeErrorMessage(detailQuery.error)}
                        onRetry={() => {
                            void detailQuery.refetch();
                        }}
                    />
                ) : null}
                {detail ? (
                    <>
                        <p className="text-body-sm text-ink">
                            الكاشير {detail.cashier_no == null ? '—' : String(detail.cashier_no)} · التاريخ {detail.doc_date || '—'}{' '}
                            {detail.doc_time || ''} · الإجمالي {moneyText(detail.total)} · الصافي {moneyText(detail.net)}
                        </p>
                        <DataGrid
                            label="أصناف الأوردر"
                            headers={['كود الصنف', 'الصنف', 'الكمية', 'السعر', 'الإجمالي']}
                            rows={detail.lines?.length ?? 0}
                            empty="لا توجد تفاصيل أصناف محفوظة."
                        >
                            {(detail.lines ?? []).map((line, index) => (
                                <Row key={`${String(line.code ?? '')}-${String(index)}`}>
                                    <Cell ltr>{line.code || '—'}</Cell>
                                    <Cell>{line.name || '—'}</Cell>
                                    <Cell numeric>{moneyText(line.qty)}</Cell>
                                    <Cell numeric>{moneyText(line.price)}</Cell>
                                    <Cell numeric>{moneyText(line.total)}</Cell>
                                </Row>
                            ))}
                        </DataGrid>
                    </>
                ) : null}
            </Dialog>
        </>
    );
}

/* ─── الشاشة ────────────────────────────────────────────────────────────── */

export function YarasoftWorkbench() {
    const [tab, setTab] = useState<TabKey>('status');

    return (
        <>
            <div
                role="tablist"
                aria-label="أقسام تكامل قاعدة الكاشير"
                className="flex overflow-x-auto border-b border-hairline px-sm py-xs"
            >
                <div className="flex min-w-max gap-xs">
                    {TABS.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.key}
                            onClick={() => setTab(item.key)}
                            className={`rounded-md px-md py-xs text-button-md ${
                                tab === item.key ? 'bg-primary text-on-primary' : 'bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-sm p-sm">
                {tab === 'status' ? <StatusPanel /> : null}
                {tab === 'review' ? <ReviewPanel /> : null}
                {tab === 'sections' ? <SectionsPanel /> : null}
                {tab === 'mappings' ? <MappingsPanel /> : null}
                {tab === 'oracle' ? <OraclePanel /> : null}
                {tab === 'quality' ? <QualityPanel /> : null}
                {tab === 'tools' ? <ToolsPanel /> : null}
                {tab === 'mirror' ? <MirrorPanel /> : null}
            </div>
        </>
    );
}
