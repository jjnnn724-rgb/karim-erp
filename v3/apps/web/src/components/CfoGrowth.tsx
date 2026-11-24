import { useQuery } from '@tanstack/react-query';
import { SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    type ApAging as ApAgingData,
    type FixedAsset,
    fetchAlertsLog,
    fetchApAging,
    fetchBankRec,
    fetchBudgetVsActual,
    fetchCustody,
    fetchFixedAssets,
    fetchProfitByCc,
} from '../lib/cfo-growth';
import { errorMessage, intOf, moneyOf, num, pctOf, textOf } from '../lib/reporting';
import { DataTable, type DataTableColumn } from '../ui';

/**
 * تبويبات نمو المدير المالي السبعة (مرآة `cfo.js` في v2) — قراءة فقط.
 * كل جدول يعرض أرقام الخادم كما هي، وله حالاته الأربع (DESIGN.md):
 * تحميل/خطأ بإعادة المحاولة/فراغ بتلميح/بيانات.
 *
 * جدولا أعمار الذمم والأصول غير مقيّدين بعدد صفوف صغير (الخادم بلا سقف
 * للذمم، وسقف الأصول 500) — DataTable يتكفّل بالتمرير الافتراضي فوق 200 صف
 * (PLAN §3.4). بقية الجداول محدودة بسقف خادم ≤ 100 أو ببنية البيانات نفسها
 * (مراكز التكلفة/الموازنات/التنبيهات) وتبقى كما هي.
 */

export type CfoGrowthView = 'cc' | 'aging' | 'bank' | 'assets' | 'custody' | 'budgets' | 'alerts';

export const CFO_GROWTH_TABS: { key: CfoGrowthView; label: string; english: string }[] = [
    { key: 'cc', label: 'ربحية المراكز', english: 'Cost centers' },
    { key: 'aging', label: 'أعمار الذمم', english: 'AP aging' },
    { key: 'bank', label: 'التسوية البنكية', english: 'Bank rec' },
    { key: 'assets', label: 'الأصول والإهلاك', english: 'Fixed assets' },
    { key: 'custody', label: 'العهد', english: 'Custody' },
    { key: 'budgets', label: 'الموازنات', english: 'Budgets' },
    { key: 'alerts', label: 'سجل التنبيهات', english: 'Alerts' },
];

const TH =
    'border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary';
const TH_END = `${TH} text-end`;
const TD = 'border-b border-hairline px-sm py-xxs text-ink';
const TD_NUM = `${TD} erp-numeric`;

type AgingRow = NonNullable<ApAgingData['aging']>[number];

/** أعمدة أعمار الذمم — المبالغ لاتينية معزولة الاتجاه، والمتأخر > 90 يومًا بلون الخطر كما كان. */
const AGING_COLUMNS: DataTableColumn<AgingRow>[] = [
    {
        key: 'supplier',
        header: 'المورد',
        className: 'text-ink',
        cell: (row) => textOf(row.supplier) || 'غير محدد',
        sortValue: (row) => textOf(row.supplier) || null,
    },
    {
        key: 'total',
        header: 'الإجمالي',
        numeric: true,
        className: 'text-ink',
        cell: (row) => <span dir="ltr">{moneyOf(row.total)}</span>,
        sortValue: (row) => num(row.total),
    },
    {
        key: 'current',
        header: 'غير مؤرخ',
        numeric: true,
        className: 'text-ink',
        cell: (row) => <span dir="ltr">{moneyOf(row.current)}</span>,
        sortValue: (row) => num(row.current),
    },
    {
        key: 'd30',
        header: '0-30',
        numeric: true,
        className: 'text-ink',
        cell: (row) => <span dir="ltr">{moneyOf(row.d30)}</span>,
        sortValue: (row) => num(row.d30),
    },
    {
        key: 'd60',
        header: '31-60',
        numeric: true,
        className: 'text-ink',
        cell: (row) => <span dir="ltr">{moneyOf(row.d60)}</span>,
        sortValue: (row) => num(row.d60),
    },
    {
        key: 'd90',
        header: '61-90',
        numeric: true,
        className: 'text-ink',
        cell: (row) => (
            <span dir="ltr" className={num(row.d90) > 0 ? 'text-danger-text' : undefined}>
                {moneyOf(row.d90)}
            </span>
        ),
        sortValue: (row) => num(row.d90),
    },
    {
        key: 'over90',
        header: '+90',
        numeric: true,
        className: 'text-ink',
        cell: (row) => (
            <span dir="ltr" className={num(row.over90) > 0 ? 'text-danger-text' : undefined}>
                {moneyOf(row.over90)}
            </span>
        ),
        sortValue: (row) => num(row.over90),
    },
];

/** أعمدة الأصول — الاسم مع التصنيف سطرًا ثانويًا، والمبالغ لاتينية معزولة الاتجاه. */
const ASSET_COLUMNS: DataTableColumn<FixedAsset>[] = [
    {
        key: 'name',
        header: 'الأصل',
        className: 'text-ink',
        cell: (asset) => (
            <>
                {textOf(asset.name) || '—'}
                {asset.category ? (
                    <span className="block text-caption text-muted">{textOf(asset.category)}</span>
                ) : null}
            </>
        ),
        sortValue: (asset) => textOf(asset.name) || null,
    },
    {
        key: 'cost',
        header: 'التكلفة',
        numeric: true,
        className: 'text-ink',
        cell: (asset) => <span dir="ltr">{moneyOf(asset.cost)}</span>,
        sortValue: (asset) => num(asset.cost),
    },
    {
        key: 'monthly',
        header: 'الشهري',
        numeric: true,
        className: 'text-ink',
        cell: (asset) => <span dir="ltr">{moneyOf(asset.monthly)}</span>,
        sortValue: (asset) => num(asset.monthly),
    },
    {
        key: 'accumulated',
        header: 'المتراكم',
        numeric: true,
        className: 'text-ink',
        cell: (asset) => <span dir="ltr">{moneyOf(asset.accumulated)}</span>,
        sortValue: (asset) => num(asset.accumulated),
    },
    {
        key: 'remaining',
        header: 'المتبقي',
        numeric: true,
        className: 'text-ink',
        cell: (asset) => <span dir="ltr">{moneyOf(asset.remaining)}</span>,
        sortValue: (asset) => num(asset.remaining),
    },
    {
        key: 'lastMonth',
        header: 'آخر إهلاك',
        className: 'erp-numeric text-muted',
        cell: (asset) => <span dir="ltr">{textOf(asset.last_month) || '—'}</span>,
        sortValue: (asset) => textOf(asset.last_month) || null,
    },
];

function Pending({ label }: { label: string }) {
    return (
        <>
            <StateLoading label={label} />
            <TableSkeleton rows={5} columns={4} />
        </>
    );
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
    return <StateError message={errorMessage(error)} onRetry={retry} />;
}

export function CfoGrowth({ view, from, to }: { view: CfoGrowthView; from: string; to: string }) {
    if (view === 'cc') {
        return <CostCenters from={from} to={to} />;
    }
    if (view === 'aging') {
        return <ApAging />;
    }
    if (view === 'bank') {
        return <BankRec from={from} to={to} />;
    }
    if (view === 'assets') {
        return <Assets />;
    }
    if (view === 'custody') {
        return <Custody />;
    }
    if (view === 'budgets') {
        return <Budgets from={from} to={to} />;
    }
    return <Alerts />;
}

function CostCenters({ from, to }: { from: string; to: string }) {
    const query = useQuery({
        queryKey: ['cfo', 'cc', from, to],
        queryFn: ({ signal }) => fetchProfitByCc(from, to, signal),
    });
    const centers = query.data?.centers ?? [];
    return (
        <SectionCard
            title="ربحية مراكز التكلفة"
            english="Profit by cost center"
            actions={
                <span className="text-body-sm text-muted" dir="ltr">
                    {`${from} → ${to}`}
                </span>
            }
        >
            {query.isPending ? <Pending label="جارٍ جلب ربحية المراكز…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {query.data && centers.length === 0 ? (
                <StateEmpty
                    title="لا حركة على المراكز"
                    hint="وزّع القيود على مراكز التكلفة من شاشة القيد في v2 — حقلٌ اختياري."
                />
            ) : null}
            {centers.length > 0 ? (
                <TableScroll label="جدول ربحية مراكز التكلفة">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    المركز
                                </th>
                                <th scope="col" className={TH_END}>
                                    إيراد
                                </th>
                                <th scope="col" className={TH_END}>
                                    تكلفة
                                </th>
                                <th scope="col" className={TH_END}>
                                    مصروف
                                </th>
                                <th scope="col" className={TH_END}>
                                    الصافي
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {centers.map((center) => (
                                <tr key={textOf(center.cc)} className="hover:bg-surface-hover">
                                    <td className={TD}>
                                        <span className="erp-numeric" dir="ltr">
                                            {textOf(center.cc) || '—'}
                                        </span>
                                        {center.cc_name ? (
                                            <span className="block text-caption text-muted">
                                                {textOf(center.cc_name)}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(center.revenue)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(center.cogs)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(center.expense)}
                                    </td>
                                    <td
                                        className={`${TD_NUM} text-end ${num(center.net) < 0 ? 'text-danger-text' : 'text-success-text'}`}
                                        dir="ltr"
                                    >
                                        {moneyOf(center.net)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            ) : null}
        </SectionCard>
    );
}

function ApAging() {
    const query = useQuery({
        queryKey: ['cfo', 'aging'],
        queryFn: ({ signal }) => fetchApAging(signal),
    });
    const rows = query.data?.aging ?? [];
    return (
        <SectionCard
            title="أعمار ذمم الموردين"
            english="AP aging"
            actions={
                <span className="text-body-sm text-muted">
                    {`الإجمالي ${moneyOf(query.data?.total)} · ${intOf(query.data?.count)} موردًا`}
                </span>
            }
        >
            <DataTable<AgingRow>
                caption="جدول أعمار ذمم الموردين"
                columns={AGING_COLUMNS}
                rows={rows}
                rowKey={(row) => textOf(row.supplier)}
                state={query.isPending ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : 'data'}
                emptyTitle="لا ذمم مستحقة"
                emptyDescription="كل فواتير الموردين مسددة حتى تاريخ اليوم."
                errorMessage={errorMessage(query.error)}
                onRetry={() => void query.refetch()}
                // الذمم بلا سقف خادم — عتبة 50 لمنطقة تمرير ثابتة الارتفاع.
                virtualizeThreshold={50}
                loadingRows={15}
            />
        </SectionCard>
    );
}

function BankRec({ from, to }: { from: string; to: string }) {
    const query = useQuery({
        queryKey: ['cfo', 'bank', from, to],
        queryFn: ({ signal }) => fetchBankRec('1010', from, to, signal),
    });
    const data = query.data;
    const unmatched = data?.unmatched ?? [];
    return (
        <>
            <SectionCard
                title={`التسوية البنكية (${textOf(data?.account) || '1010'})`}
                english="Bank reconciliation"
                actions={
                    <span className="text-body-sm text-muted" dir="ltr">
                        {`${from} → ${to}`}
                    </span>
                }
            >
                {query.isPending ? <Pending label="جارٍ جلب التسوية البنكية…" /> : null}
                {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
                {data ? (
                    <dl className="grid gap-sm p-sm text-body-sm sm:grid-cols-3">
                        <div>
                            <dt className="text-muted">رصيد الدفتر</dt>
                            <dd className="erp-numeric text-ink" dir="ltr">
                                {moneyOf(data.book)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted">رصيد الكشف</dt>
                            <dd className="erp-numeric text-ink" dir="ltr">
                                {moneyOf(data.statement)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted">الفرق</dt>
                            <dd
                                className={`erp-numeric ${num(data.diff) === 0 ? 'text-success-text' : 'text-danger-text'}`}
                                dir="ltr"
                            >
                                {moneyOf(data.diff)}
                            </dd>
                        </div>
                    </dl>
                ) : null}
            </SectionCard>

            {data ? (
                <SectionCard title="بنود الكشف غير المطابقة" english="Unmatched statement rows">
                    {unmatched.length === 0 ? (
                        <StateEmpty title="لا بنود معلقة" hint="كل سطور الكشف مرتبطة بقيود — التسوية نظيفة." />
                    ) : (
                        <TableScroll label="جدول بنود الكشف غير المطابقة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr>
                                        <th scope="col" className={TH}>
                                            التاريخ
                                        </th>
                                        <th scope="col" className={TH}>
                                            البيان
                                        </th>
                                        <th scope="col" className={TH_END}>
                                            المبلغ
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {unmatched.map((row, index) => (
                                        <tr
                                            key={textOf(row.id) || `${textOf(row.stmt_date)}-${String(index)}`}
                                            className="hover:bg-surface-hover"
                                        >
                                            <td className={`${TD_NUM} text-muted`} dir="ltr">
                                                {textOf(row.stmt_date).slice(0, 10) || '—'}
                                            </td>
                                            <td className={TD}>{textOf(row.description) || '—'}</td>
                                            <td
                                                className={`${TD_NUM} text-end ${num(row.amount) < 0 ? 'text-danger-text' : 'text-success-text'}`}
                                                dir="ltr"
                                            >
                                                {moneyOf(row.amount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                </SectionCard>
            ) : null}
        </>
    );
}

function createMessage(assets: FixedAsset[]): string {
    const active = assets.filter((asset) => asset.status === 'active').length;
    const disposed = assets.length - active;
    return disposed > 0 ? `${intOf(active)} نشطًا · ${intOf(disposed)} مستبعدًا` : `${intOf(active)} أصلًا نشطًا`;
}

function Assets() {
    const query = useQuery({
        queryKey: ['cfo', 'assets'],
        queryFn: ({ signal }) => fetchFixedAssets(signal),
    });
    const assets = query.data?.assets ?? [];
    const active = assets.filter((asset) => asset.status === 'active');
    return (
        <SectionCard
            title="الأصول الثابتة والإهلاك"
            english="Fixed assets"
            actions={<span className="text-body-sm text-muted">{createMessage(assets)}</span>}
        >
            <DataTable<FixedAsset>
                caption="جدول الأصول الثابتة"
                columns={ASSET_COLUMNS}
                rows={active}
                rowKey={(asset) => String(asset.id)}
                state={query.isPending ? 'loading' : query.isError ? 'error' : active.length === 0 ? 'empty' : 'data'}
                emptyTitle="لا أصول نشطة"
                emptyDescription="سجّل معدات المطبخ والتجهيزات من الأصول في v2 — الإهلاك الشهري يعمل من هناك."
                errorMessage={errorMessage(query.error)}
                onRetry={() => void query.refetch()}
                // خلية الاسم سطران (الاسم + التصنيف) — ارتفاع صف يحجز مكانه.
                rowHeight={52}
                // سقف الخادم 500 أصل — عتبة 50 تُبقي منطقة التمرير ثابتة الارتفاع.
                virtualizeThreshold={50}
                loadingRows={10}
            />
        </SectionCard>
    );
}

function Custody() {
    const query = useQuery({
        queryKey: ['cfo', 'custody'],
        queryFn: ({ signal }) => fetchCustody(signal),
    });
    const data = query.data;
    const rows = data?.rows ?? [];
    return (
        <SectionCard
            title="عهد الكاشير"
            english="Cash custody"
            actions={
                <span className="text-body-sm text-muted">
                    {`اليوم ${textOf(data?.date) || '—'} · لديك ${intOf(data?.myPending)} عهدة معلقة`}
                </span>
            }
        >
            {query.isPending ? <Pending label="جارٍ جلب العهد…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {data && rows.length === 0 ? (
                <StateEmpty title="لا عهد اليوم" hint="تُسجَّل عهد الكاشير من شاشة العهد في v2." />
            ) : null}
            {rows.length > 0 ? (
                <TableScroll label="جدول عهد الكاشير">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    من
                                </th>
                                <th scope="col" className={TH}>
                                    إلى
                                </th>
                                <th scope="col" className={TH_END}>
                                    المبلغ
                                </th>
                                <th scope="col" className={TH}>
                                    ملاحظة
                                </th>
                                <th scope="col" className={TH}>
                                    الحالة
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={String(row.id)} className="hover:bg-surface-hover">
                                    <td className={TD}>{`@${textOf(row.from_name)}`}</td>
                                    <td className={TD}>{`@${textOf(row.to_name)}`}</td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.amount)}
                                    </td>
                                    <td className={`${TD} text-muted`}>{textOf(row.note) || '—'}</td>
                                    <td className={TD}>
                                        {row.ack_at ? (
                                            <span className="text-success-text">مُستلمة</span>
                                        ) : (
                                            <span className="text-warning-text">معلقة</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            ) : null}
        </SectionCard>
    );
}

function Budgets({ from, to }: { from: string; to: string }) {
    const period = (to || from).slice(0, 7);
    const query = useQuery({
        queryKey: ['cfo', 'budgets', period],
        queryFn: ({ signal }) => fetchBudgetVsActual(period, signal),
    });
    const rows = query.data?.rows ?? [];
    return (
        <SectionCard
            title="الموازنات مقابل الفعلي"
            english="Budget vs actual"
            actions={
                <span className="text-body-sm text-muted" dir="ltr">
                    {textOf(query.data?.period) || period}
                </span>
            }
        >
            {query.isPending ? <Pending label="جارٍ جلب الموازنات…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {query.data && rows.length === 0 ? (
                <StateEmpty
                    title="لا موازنات لهذا الشهر"
                    hint="أضف سقوف المصروفات من شاشة الموازنات في v2 — التجاوز يُنبَّه تلقائيًا."
                />
            ) : null}
            {rows.length > 0 ? (
                <TableScroll label="جدول الموازنات مقابل الفعلي">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    البند
                                </th>
                                <th scope="col" className={TH}>
                                    الحساب
                                </th>
                                <th scope="col" className={TH_END}>
                                    الموازنة
                                </th>
                                <th scope="col" className={TH_END}>
                                    الفعلي
                                </th>
                                <th scope="col" className={TH_END}>
                                    الانحراف
                                </th>
                                <th scope="col" className={TH_END}>
                                    النسبة
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={String(row.id)} className="hover:bg-surface-hover">
                                    <td className={TD}>
                                        {textOf(row.label) ||
                                            textOf(row.account_name) ||
                                            textOf(row.account_code) ||
                                            '—'}
                                    </td>
                                    <td className={`${TD} erp-numeric text-muted`} dir="ltr">
                                        {textOf(row.account_code) || '—'}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.budget)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.actual)}
                                    </td>
                                    <td
                                        className={`${TD_NUM} text-end ${row.alert ? 'text-danger-text' : 'text-success-text'}`}
                                        dir="ltr"
                                    >
                                        {moneyOf(row.variance)}
                                    </td>
                                    <td className={`${TD_NUM} text-end text-muted`} dir="ltr">
                                        {pctOf(row.pct)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            ) : null}
        </SectionCard>
    );
}

function Alerts() {
    const query = useQuery({
        queryKey: ['cfo', 'alerts'],
        queryFn: ({ signal }) => fetchAlertsLog(signal),
    });
    const rows = query.data?.log ?? [];
    return (
        <SectionCard title="سجل التنبيهات" english="Alerts log">
            <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                الفحص التلقائي كل 30 دقيقة — التنبيه الواحد يُرسل مرة كل 24 ساعة.
            </p>
            {query.isPending ? <Pending label="جارٍ جلب سجل التنبيهات…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {query.data && rows.length === 0 ? (
                <StateEmpty title="لا تنبيهات مُرسلة" hint="كل القواعد داخل الحدود — الوضع هادئ." />
            ) : null}
            {rows.length > 0 ? (
                <TableScroll label="جدول سجل التنبيهات">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    القاعدة
                                </th>
                                <th scope="col" className={TH}>
                                    آخر تنبيه
                                </th>
                                <th scope="col" className={TH}>
                                    الوقت
                                </th>
                                <th scope="col" className={TH_END}>
                                    المرات
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={textOf(row.key)} className="hover:bg-surface-hover">
                                    <td className={`${TD} erp-numeric text-muted`} dir="ltr">
                                        {textOf(row.key) || '—'}
                                    </td>
                                    <td className={TD}>{textOf(row.last_title) || '—'}</td>
                                    <td className={`${TD_NUM} text-muted`} dir="ltr">
                                        {textOf(row.last_sent_at).replace('T', ' ').slice(0, 19) || '—'}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">{`${intOf(row.times_sent)}×`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroll>
            ) : null}
        </SectionCard>
    );
}
