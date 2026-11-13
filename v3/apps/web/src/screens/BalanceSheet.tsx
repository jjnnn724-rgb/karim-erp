import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { accountAmount, type BalanceSheetAccount, fetchBalanceSheet, sumAccounts } from '../lib/balance-sheet';
import { errorMessage, moneyOf, num } from '../lib/reporting';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './BalanceSheet.premium.css';

/**
 * قائمة المركز المالي — قراءة فقط من الخادم (معادلة: أصول = خصوم + حقوق الملكية).
 *
 * الخادم يولّد القائمة من الأستاذ العام؛ الواجهة تعرض ولا تحسب شيئًا.
 * رصيد الحساب يُعرض كما هو؛ `variance` في «المطابقة» تكشف أي فرق.
 */

function todayLocal(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function AccountRow({ row }: { row: BalanceSheetAccount }) {
    return (
        <tr>
            <td className="border-b border-hairline px-sm py-xxs text-start erp-numeric" dir="ltr">
                {row.code}
            </td>
            <td className="border-b border-hairline px-sm py-xxs text-ink">{row.name_ar}</td>
            <td dir="ltr" className="border-b border-hairline px-sm py-xxs text-end text-ink erp-numeric">
                {row.balance >= 0 ? moneyOf(row.balance) : `(${moneyOf(Math.abs(row.balance))})`}
            </td>
        </tr>
    );
}

function AccountGroup({ title, rows, total }: { title: string; rows: readonly BalanceSheetAccount[]; total: number }) {
    return (
        <section className="bs-section" aria-label={title}>
            <h3 className="bs-section__title">{title}</h3>
            {rows.length ? (
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <caption className="sr-only">{title}</caption>
                        <thead>
                            <tr>
                                {['الحساب', 'البيان', 'الرصيد'].map((label, index) => (
                                    <th
                                        key={label}
                                        scope="col"
                                        className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                            index === 2 ? 'text-end' : 'text-start'
                                        }`}
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <AccountRow key={row.code} row={row} />
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th scope="row" colSpan={2} className="px-sm py-xs text-start text-label-md font-bold text-ink">
                                    المجموع
                                </th>
                                <td dir="ltr" className="px-sm py-xs text-end font-bold text-ink erp-numeric">
                                    {moneyOf(total)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <p className="text-body-sm text-muted">لا حسابات في هذا القسم.</p>
            )}
        </section>
    );
}

export function BalanceSheet() {
    const [asOf, setAsOf] = useState(todayLocal);
    const [problem, setProblem] = useState('');

    const query = useQuery({
        queryKey: ['balance-sheet', asOf],
        queryFn: ({ signal }) => fetchBalanceSheet(asOf, signal),
        retry: false,
    });

    const report = query.data;
    const totals = useMemo(
        () =>
            report
                ? {
                      currentAssets: sumAccounts(report.assets.current_assets),
                      nonCurrentAssets: sumAccounts(report.assets.non_current_assets),
                      currentLiabilities: sumAccounts(report.liabilities.current_liabilities),
                      nonCurrentLiabilities: sumAccounts(report.liabilities.non_current_liabilities),
                      capital: report.equity.current_period_net_income + sumAccounts(report.equity.capital_and_reserves),
                  }
                : null,
        [report],
    );

    function apply() {
        const message = /^\d{4}-\d{2}-\d{2}$/.test(asOf.trim()) ? '' : 'أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD.';
        setProblem(message);
    }

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="قائمة المركز المالي"
                english="Balance Sheet"
                description="قائمة مركزية من الأستاذ العام — للقراءة فقط، لا تعديل ولا ترحيل. تُولَّد من القيود المرحّلة مباشرة."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />
            <div data-erp-print-hide className="flex flex-wrap items-center gap-sm">
                <PrintActions title={`قائمة المركز المالي — ${asOf}`} />
            </div>
            <SectionCard title="تاريخ القائمة" english="As-of date">
                <div className="flex flex-wrap items-end gap-sm p-sm">
                    <Input
                        label="كما في تاريخ"
                        type="date"
                        value={asOf}
                        onChange={(event) => {
                            setAsOf(event.target.value);
                        }}
                        containerClassName="w-48"
                        hint="YYYY-MM-DD"
                    />
                    <Button variant="secondary" loading={query.isFetching} onClick={apply}>
                        تطبيق
                    </Button>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {query.isPending ? <StateLoading label="جارٍ استخراج قائمة المركز المالي من الأستاذ…" /> : null}
            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {report && totals ? (
                <>
                    <div className="grid gap-sm sm:grid-cols-3">
                        <KpiCard
                            label="إجمالي الأصول"
                            english="Total assets"
                            value={moneyOf(report.assets.total_assets)}
                            hint="متداولة + غير متداولة"
                        />
                        <KpiCard
                            label="إجمالي الخصوم وحقوق الملكية"
                            english="Liabilities + equity"
                            value={moneyOf(report.reconciliation.total_liabilities_and_equity)}
                            hint={report.reconciliation.balanced ? 'مطابقة تمامًا' : 'فروق! راجع المطابقة'}
                            tone={report.reconciliation.balanced ? 'neutral' : 'warning'}
                        />
                        <KpiCard
                            label="فرق المطابقة"
                            english="Variance"
                            value={accountAmount(report.reconciliation.variance)}
                            hint={report.reconciliation.balanced ? 'صفر — متزنة' : 'غير متزنة — راجع القيود'}
                            tone={report.reconciliation.balanced ? 'neutral' : 'danger'}
                        />
                    </div>

                    <div className="grid gap-md lg:grid-cols-2">
                        <div className="flex flex-col gap-md">
                            <AccountGroup title="الأصول المتداولة" rows={report.assets.current_assets} total={totals.currentAssets} />
                            <AccountGroup
                                title="الأصول غير المتداولة"
                                rows={report.assets.non_current_assets}
                                total={totals.nonCurrentAssets}
                            />
                        </div>
                        <div className="flex flex-col gap-md">
                            <AccountGroup
                                title="الخصوم المتداولة"
                                rows={report.liabilities.current_liabilities}
                                total={totals.currentLiabilities}
                            />
                            <AccountGroup
                                title="الخصوم غير المتداولة"
                                rows={report.liabilities.non_current_liabilities}
                                total={totals.nonCurrentLiabilities}
                            />
                            <AccountGroup title="حقوق الملكية" rows={report.equity.capital_and_reserves} total={num(totals.capital)} />
                            <SectionCard title="دخل الفترة الحالية" english="Current period net income">
                                <div className="flex items-center justify-between gap-sm p-sm">
                                    <span className="text-body-sm text-muted">دخل هذا العام</span>
                                    <strong dir="ltr" className="erp-numeric text-heading-md">
                                        {moneyOf(report.equity.current_period_net_income)}
                                    </strong>
                                </div>
                            </SectionCard>
                        </div>
                    </div>

                    <p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
                        الأرقام من القيود المرحّلة فقط. هذا العرض قراءة رسمية، ولا يشمل أي تعديل أو ترحيل؛ أي خلل في «فرق المطابقة» يعني قيدًا
                        ناقصًا أو حسابًا غير متوازن — راجع المحاسب.
                    </p>
                </>
            ) : null}
        </div>
    );
}
