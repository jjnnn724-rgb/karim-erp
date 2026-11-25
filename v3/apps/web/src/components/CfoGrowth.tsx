import { useQuery } from '@tanstack/react-query';
import { SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
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

/**
 * تبويبات نمو المدير المالي السبعة (مرآة `cfo.js` في v2) — قراءة فقط.
 * كل جدول يعرض أرقام الخادم كما هي، وله حالاته الأربع (DESIGN.md):
 * تحميل/خطأ بإعادة المحاولة/فراغ بتلميح/بيانات.
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

const TH = 'border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary';
const TH_END = `${TH} text-end`;
const TD = 'border-b border-hairline px-sm py-xxs text-ink';
const TD_NUM = `${TD} erp-numeric`;

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
                <StateEmpty title="لا حركة على المراكز" hint="وزّع القيود على مراكز التكلفة من شاشة القيد في v2 — حقلٌ اختياري." />
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
                                            <span className="block text-caption text-muted">{textOf(center.cc_name)}</span>
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
            {query.isPending ? <Pending label="جارٍ جلب أعمار الذمم…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {query.data && rows.length === 0 ? <StateEmpty title="لا ذمم مستحقة" hint="كل فواتير الموردين مسددة حتى تاريخ اليوم." /> : null}
            {rows.length > 0 ? (
                <TableScroll label="جدول أعمار ذمم الموردين">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    المورد
                                </th>
                                <th scope="col" className={TH_END}>
                                    الإجمالي
                                </th>
                                <th scope="col" className={TH_END}>
                                    غير مؤرخ
                                </th>
                                <th scope="col" className={TH_END}>
                                    0-30
                                </th>
                                <th scope="col" className={TH_END}>
                                    31-60
                                </th>
                                <th scope="col" className={TH_END}>
                                    61-90
                                </th>
                                <th scope="col" className={TH_END}>
                                    +90
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={textOf(row.supplier)} className="hover:bg-surface-hover">
                                    <td className={TD}>{textOf(row.supplier) || 'غير محدد'}</td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.total)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.current)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.d30)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(row.d60)}
                                    </td>
                                    <td className={`${TD_NUM} text-end ${num(row.d90) > 0 ? 'text-danger-text' : 'text-ink'}`} dir="ltr">
                                        {moneyOf(row.d90)}
                                    </td>
                                    <td className={`${TD_NUM} text-end ${num(row.over90) > 0 ? 'text-danger-text' : 'text-ink'}`} dir="ltr">
                                        {moneyOf(row.over90)}
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
                            <dd className={`erp-numeric ${num(data.diff) === 0 ? 'text-success-text' : 'text-danger-text'}`} dir="ltr">
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
            {query.isPending ? <Pending label="جارٍ جلب الأصول الثابتة…" /> : null}
            {query.isError ? <Failed error={query.error} retry={() => void query.refetch()} /> : null}
            {query.data && active.length === 0 ? (
                <StateEmpty title="لا أصول نشطة" hint="سجّل معدات المطبخ والتجهيزات من الأصول في v2 — الإهلاك الشهري يعمل من هناك." />
            ) : null}
            {active.length > 0 ? (
                <TableScroll label="جدول الأصول الثابتة">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>
                                    الأصل
                                </th>
                                <th scope="col" className={TH_END}>
                                    التكلفة
                                </th>
                                <th scope="col" className={TH_END}>
                                    الشهري
                                </th>
                                <th scope="col" className={TH_END}>
                                    المتراكم
                                </th>
                                <th scope="col" className={TH_END}>
                                    المتبقي
                                </th>
                                <th scope="col" className={TH}>
                                    آخر إهلاك
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.map((asset) => (
                                <tr key={String(asset.id)} className="hover:bg-surface-hover">
                                    <td className={TD}>
                                        {textOf(asset.name) || '—'}
                                        {asset.category ? (
                                            <span className="block text-caption text-muted">{textOf(asset.category)}</span>
                                        ) : null}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(asset.cost)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(asset.monthly)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(asset.accumulated)}
                                    </td>
                                    <td className={`${TD_NUM} text-end`} dir="ltr">
                                        {moneyOf(asset.remaining)}
                                    </td>
                                    <td className={`${TD_NUM} text-muted`} dir="ltr">
                                        {textOf(asset.last_month) || '—'}
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
            {data && rows.length === 0 ? <StateEmpty title="لا عهد اليوم" hint="تُسجَّل عهد الكاشير من شاشة العهد في v2." /> : null}
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
                <StateEmpty title="لا موازنات لهذا الشهر" hint="أضف سقوف المصروفات من شاشة الموازنات في v2 — التجاوز يُنبَّه تلقائيًا." />
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
                                        {textOf(row.label) || textOf(row.account_name) || textOf(row.account_code) || '—'}
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
                                    <td className={`${TD_NUM} text-end ${row.alert ? 'text-danger-text' : 'text-success-text'}`} dir="ltr">
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
            {query.data && rows.length === 0 ? <StateEmpty title="لا تنبيهات مُرسلة" hint="كل القواعد داخل الحدود — الوضع هادئ." /> : null}
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
