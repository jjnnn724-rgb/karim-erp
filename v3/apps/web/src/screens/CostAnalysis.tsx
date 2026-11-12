import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { BarList, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchCostAnalysis, topCostRows } from '../lib/cost-analysis';
import { errorMessage, intOf, moneyOf, pctOf, presetRange, rangeProblem, shareOf, textOf } from '../lib/reporting';
import { FilterBar, StatCard } from '../ui';

/**
 * تحليل التكاليف — تكلفة كل قسم مقابل إيراده من `finance-routes`.
 * النسبة والتكلفة والصافي كلها أرقام الخادم؛ الواجهة ترتّب وتعرض فقط.
 */
export function CostAnalysis() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const analysisQuery = useQuery({
        queryKey: ['finance', 'cost-analysis', range.from, range.to],
        queryFn: ({ signal }) => fetchCostAnalysis(range.from, range.to, signal),
    });

    const analysis = analysisQuery.data;
    const totals = analysis?.totals;
    const rows = [...(analysis?.rows ?? [])].sort((a, b) => Number(b.exp ?? 0) - Number(a.exp ?? 0));
    const expensive = topCostRows(analysis, 6);
    const maxCost = expensive.reduce((max, row) => Math.max(max, Number(row.exp ?? 0)), 0);
    const expenseTotal = Number(totals?.exp ?? 0);

    // بحث نصي من الواجهة الأمامية على جدول تكلفة الأقسام
    const [costQ, setCostQ] = useState('');
    const filteredRows = useMemo(() => {
        return rows.filter((row) => {
            const name = textOf(row.name) || textOf(row.code) || '';
            return costQ ? name.includes(costQ) : true;
        });
    }, [rows, costQ]);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="تحليل التكاليف"
                english="Cost Analysis"
                description="تكلفة كل قسم — مواد وصرف مخزني وتحويلات وتسوية جرد ومصروفات تشغيلية مقابل إيراده، بنسبة التكلفة من الخادم."
                pending={analysisQuery.isFetching}
                onRefresh={() => {
                    void analysisQuery.refetch();
                }}
            />
            <PrintActions title="تحليل التكاليف" />

            <FilterBar
                id="cost-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث حسب القسم"
                searchPlaceholder="ابحث باسم القسم…"
                searchValue={costQ}
                onSearchChange={(next: string) => setCostQ(next)}
                pending={analysisQuery.isFetching}
                error={problem}
                data-testid="cost-filter-bar"
            />

            {analysisQuery.isPending ? <StateLoading label="جارٍ تحليل التكاليف…" /> : null}

            {analysisQuery.isError ? (
                <StateError
                    message={errorMessage(analysisQuery.error)}
                    onRetry={() => {
                        void analysisQuery.refetch();
                    }}
                />
            ) : null}

            {analysis ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات تحليل التكاليف">
                        <StatCard label="الإيراد" english="Revenue" value={moneyOf(totals?.rev)} hint="إيراد الفترة من الأقسام والقنوات" />
                        <StatCard
                            label="إجمالي التكلفة"
                            english="Total cost"
                            value={moneyOf(totals?.exp)}
                            hint={`مواد ${moneyOf(totals?.mat)} · تشغيل ${moneyOf(totals?.ops)}`}
                            tone="warning"
                        />
                        <StatCard
                            label="نسبة التكلفة"
                            english="Cost ratio"
                            value={pctOf(totals?.avgCost)}
                            hint="التكلفة إلى الإيراد كما حسبها الخادم"
                            tone={Number(totals?.avgCost ?? 0) > 100 ? 'danger' : 'neutral'}
                        />
                        <StatCard
                            label="أقسام في التحليل"
                            english="Departments"
                            value={intOf(rows.length)}
                            hint={
                                textOf(analysis.period?.from)
                                    ? `من ${textOf(analysis.period?.from)} إلى ${textOf(analysis.period?.to)}`
                                    : 'الفترة الحالية'
                            }
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="تركيب التكلفة" english="Cost composition">
                            <BarList
                                ariaLabel="تركيب التكلفة حسب الوعاء"
                                emptyText="لا تكلفة مسجلة في الفترة."
                                items={[
                                    {
                                        label: 'مواد وصرف مخزني',
                                        value: moneyOf(totals?.mat),
                                        share: shareOf(Number(totals?.mat ?? 0), expenseTotal),
                                    },
                                    {
                                        label: 'تحويلات جردية',
                                        value: moneyOf(totals?.trn),
                                        share: shareOf(Number(totals?.trn ?? 0), expenseTotal),
                                    },
                                    {
                                        label: 'تسوية جرد',
                                        value: moneyOf(totals?.cnt),
                                        share: shareOf(Number(totals?.cnt ?? 0), expenseTotal),
                                    },
                                    {
                                        label: 'مصروفات تشغيلية',
                                        value: moneyOf(totals?.ops),
                                        share: shareOf(Number(totals?.ops ?? 0), expenseTotal),
                                    },
                                ]}
                            />
                        </SectionCard>

                        <SectionCard title="أعلى الأقسام تكلفةً" english="Top departments">
                            <BarList
                                ariaLabel="أعلى الأقسام تكلفة"
                                emptyText="لا أقسام في النافذة."
                                items={expensive.map((row) => ({
                                    label: textOf(row.name) || textOf(row.code) || '—',
                                    value: moneyOf(row.exp),
                                    share: shareOf(Number(row.exp ?? 0), maxCost),
                                }))}
                            />
                        </SectionCard>
                    </div>

                    <SectionCard
                        title="تكلفة الأقسام"
                        english="Department costs"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(rows.length)} قسمًا`}
                            </span>
                        }
                    >
                        {filteredRows.length === 0 ? (
                            <StateEmpty title="لا بيانات تكلفة" hint="اختر فترة أوسع أو راجع ترحيل القيود." />
                        ) : (
                            <TableScroll label="جدول تكلفة الأقسام">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                القسم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإيراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التكلفة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                نسبة التكلفة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                مواد / تحويلات
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                تسوية / تشغيل
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredRows.map((row) => (
                                            <tr
                                                key={textOf(row.code) || textOf(row.name)}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="px-sm py-xxs text-ink">
                                                    {textOf(row.name) || textOf(row.code) || '—'}{' '}
                                                    {row.channel ? <span className="text-caption text-faint">قناة بيع</span> : null}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.rev)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.exp)}
                                                </td>
                                                <td
                                                    className={`erp-numeric px-sm py-xxs ${
                                                        Number(row.profit ?? 0) < 0 ? 'text-danger-text' : ''
                                                    }`}
                                                    dir="ltr"
                                                >
                                                    {moneyOf(row.profit)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {pctOf(row.costRatio)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {`${moneyOf(row.materials)} / ${moneyOf(row.transfers)}`}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {`${moneyOf(row.countAdj)} / ${moneyOf(row.operating)}`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
