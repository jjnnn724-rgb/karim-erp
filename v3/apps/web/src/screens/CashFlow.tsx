import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateError, StateLoading } from '../components/TableState';
import { fetchCashFlow } from '../lib/cash-flow';
import { errorMessage, moneyOf, presetRange, rangeProblem } from '../lib/reporting';

/**
 * قائمة التدفقات النقدية — من الأستاذ الفعلي (حركات حسابَي النقد/البنك
 * مصنّفة حسب الحساب المقابل). قراءة فقط — لا ترحيل ولا تعديل.
 *
 * `opening_available=false` يعني أن رصيد ما قبل الفترة غير متاح — يُعرض «—» لا صفرًا.
 */
export function CashFlow() {
    const [draft, setDraft] = useState(() => {
        const preset = presetRange('month');
        return { from: preset.from, to: preset.to };
    });
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const query = useQuery({
        queryKey: ['cash-flow', range.from, range.to],
        queryFn: ({ signal }) => fetchCashFlow(range.from, range.to, signal),
        retry: false,
    });

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    const report = query.data;
    const openingAvailable = report?.opening_available ?? true;

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="قائمة التدفقات النقدية"
                english="Cash Flow"
                description="مقبوضات ومدفوعات على حسابات النقد والبنك — قراءة من الأستاذ المرحّل فقط."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />
            <div data-erp-print-hide className="flex flex-wrap items-center gap-sm">
                <PrintActions title={`التدفقات النقدية — ${range.from} إلى ${range.to}`} />
            </div>
            <SectionCard title="الفترة" english="Period">
                <div className="flex flex-col gap-sm p-sm">
                    <RangeControls
                        from={draft.from}
                        to={draft.to}
                        onFrom={(value) => {
                            setDraft((current) => ({ ...current, from: value }));
                        }}
                        onTo={(value) => {
                            setDraft((current) => ({ ...current, to: value }));
                        }}
                        onApply={apply}
                        pending={query.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {query.isPending ? <StateLoading label="جارٍ تجميع حركات النقد من الأستاذ…" /> : null}
            {query.isError ? (
                <StateError
                    message={errorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            ) : null}

            {report ? (
                <>
                    <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                        <KpiCard
                            label="رصيد الافتتاح"
                            english="Opening balance"
                            value={openingAvailable ? moneyOf(report.opening) : '—'}
                            hint={openingAvailable ? `حتى ${report.from}` : 'تعذّر احتساب رصيد ما قبل الفترة'}
                            tone={openingAvailable ? 'neutral' : 'warning'}
                        />
                        <KpiCard
                            label="مقبوضات الفترة"
                            english="Inflows"
                            value={moneyOf(report.inflow)}
                            hint="حركات نقدية داخلة على الحساب"
                            tone="neutral"
                        />
                        <KpiCard
                            label="مدفوعات الفترة"
                            english="Outflows"
                            value={moneyOf(report.outflow)}
                            hint="حركات نقدية خارجة من الحساب"
                            tone="warning"
                        />
                        <KpiCard
                            label="صافي التدفق"
                            english="Net flow"
                            value={moneyOf(report.net)}
                            hint={report.net >= 0 ? 'فائض في الفترة' : 'عجز في الفترة'}
                            tone={report.net >= 0 ? 'neutral' : 'danger'}
                        />
                    </div>
                    <SectionCard title="رصيد الإقفال" english="Closing balance">
                        <div className="flex items-center justify-between gap-sm p-sm">
                            <span className="text-body-sm text-muted">رصيد النقدية حتى {report.to}</span>
                            <strong dir="ltr" className="erp-numeric text-heading-md text-ink">
                                {moneyOf(report.closing)}
                            </strong>
                        </div>
                    </SectionCard>
                    <SectionCard title="الحركة حسب الطرف المقابل" english="Movement by counterparty">
                        {report.byCounterparty.length ? (
                            <div className="overflow-x-auto p-sm">
                                <table className="w-full border-collapse">
                                    <caption className="sr-only">حركات النقد حسب الحساب المقابل</caption>
                                    <thead>
                                        <tr>
                                            {['الطرف المقابل', 'الصافي'].map((label, index) => (
                                                <th
                                                    key={label}
                                                    scope="col"
                                                    className={`border-b border-hairline bg-surface-sunken px-sm py-xs text-label-md font-medium text-ink-secondary ${
                                                        index === 1 ? 'text-end' : 'text-start'
                                                    }`}
                                                >
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.byCounterparty.map((row) => (
                                            <tr key={row.account}>
                                                <td className="border-b border-hairline px-sm py-xxs text-ink">{row.account}</td>
                                                <td
                                                    dir="ltr"
                                                    className={`border-b border-hairline px-sm py-xxs text-end erp-numeric ${
                                                        row.net >= 0 ? 'text-success-text' : 'text-danger-text'
                                                    }`}
                                                >
                                                    {moneyOf(row.net)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="p-sm text-body-sm text-muted">لا حركات نقدية في هذه الفترة.</p>
                        )}
                    </SectionCard>
                    <p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
                        الأرقام من الأستاذ المرحّل فقط؛ «الصافي» السالب يعني نقد خرج للحساب المقابل، والموجب يعني نقد دخل منه. رصيد الافتتاح
                        يعرض «—» لو تعذر احتساب الحركات السابقة لهذه الفترة — راجع المحاسب إن لزم.
                    </p>
                </>
            ) : null}
        </div>
    );
}
