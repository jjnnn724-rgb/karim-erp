import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { ADJUSTMENT_AR, BUCKET_AR, fetchCostAnalysis, fetchDeptCostDetail, selectableDepts } from '../lib/cost-analysis';
import { errorMessage, intOf, moneyOf, presetRange, rangeProblem, textOf } from '../lib/reporting';

/** حد نافذة بنود القسم على الخادم (`LIMIT 800`) — يُعلَن لا يُخفى. */
const ITEM_WINDOW = 800;

/**
 * مركز التكلفة — بنود قسمٍ واحد خلف رقمه (`/finance/cost-analysis/dept`).
 * الاختيار من قائمة الأقسام التي يرجعها التحليل نفسه، لا من قائمة مكتوبة هنا.
 */
export function CostCenter() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [code, setCode] = useState('');
    const [problem, setProblem] = useState('');

    const analysisQuery = useQuery({
        queryKey: ['finance', 'cost-analysis', range.from, range.to, 'depts'],
        queryFn: ({ signal }) => fetchCostAnalysis(range.from, range.to, signal),
    });

    const depts = selectableDepts(analysisQuery.data);
    const activeCode = code || depts[0]?.code || '';

    const detailQuery = useQuery({
        queryKey: ['finance', 'cost-analysis', 'dept', activeCode, range.from, range.to],
        queryFn: ({ signal }) => fetchDeptCostDetail(activeCode, range.from, range.to, signal),
        enabled: activeCode.length > 0,
    });

    const detail = detailQuery.data;
    const buckets = detail?.buckets;
    const items = detail?.items ?? [];

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
                title="مركز التكلفة"
                english="Cost Center"
                description="بنود قسمٍ واحد خلف رقمه — صرف مخزني وتحويلات وتسوية جرد وتشغيلية، بأحدث 800 بند من الخادم."
                pending={detailQuery.isFetching || analysisQuery.isFetching}
                onRefresh={() => {
                    void analysisQuery.refetch();
                    if (activeCode) {
                        void detailQuery.refetch();
                    }
                }}
            />
            <PrintActions title="مركز التكلفة" />

            <SectionCard title="النطاق" english="Scope">
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
                        pending={analysisQuery.isFetching || detailQuery.isFetching}
                    />
                    <label className="flex max-w-md flex-col gap-xxs text-label-md text-ink-secondary">
                        القسم
                        <select
                            value={activeCode}
                            onChange={(event) => {
                                setCode(event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            disabled={depts.length === 0}
                        >
                            {depts.length === 0 ? <option value="">لا أقسام تشغيلية</option> : null}
                            {depts.map((dept) => (
                                <option key={dept.code} value={dept.code}>
                                    {dept.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {detailQuery.isPending ? <StateLoading label="جارٍ قراءة بنود القسم…" /> : null}

            {detailQuery.isError ? (
                <StateError
                    message={errorMessage(detailQuery.error)}
                    onRetry={() => {
                        void detailQuery.refetch();
                    }}
                />
            ) : null}

            {detail ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-5" aria-label="أوعية تكلفة القسم">
                        <KpiCard
                            label="إجمالي القسم"
                            english="Total"
                            value={moneyOf(detail.total)}
                            hint={`${intOf(items.length)} بندًا في النافذة`}
                            tone="warning"
                        />
                        <KpiCard
                            label={BUCKET_AR.materials}
                            english="Materials"
                            value={moneyOf(buckets?.materials)}
                            hint="صرف واستلام ومرتجعات"
                        />
                        <KpiCard
                            label={BUCKET_AR.transfers}
                            english="Transfers"
                            value={moneyOf(buckets?.transfers)}
                            hint="تحويلات جردية بين الأقسام"
                        />
                        <KpiCard
                            label={BUCKET_AR.countAdj}
                            english="Count adjustment"
                            value={moneyOf(buckets?.countAdj)}
                            hint="فروق الجرد"
                        />
                        <KpiCard
                            label={BUCKET_AR.operating}
                            english="Operating"
                            value={moneyOf(buckets?.operating)}
                            hint="مصروفات تشغيلية مباشرة"
                        />
                    </ul>

                    <SectionCard
                        title="البنود"
                        english="Items"
                        actions={
                            <span className="text-body-sm text-muted" dir="ltr">
                                {`${textOf(detail.period?.from)} → ${textOf(detail.period?.to)}`}
                            </span>
                        }
                    >
                        {items.length === 0 ? (
                            <StateEmpty title="لا بنود للقسم" hint="لا حركة تكلفة لهذا القسم في الفترة." />
                        ) : (
                            <TableScroll label="جدول بنود تكلفة القسم">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التاريخ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                البيان
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                النوع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الفرع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                المبلغ
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item) => (
                                            <tr key={item.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {textOf(item.date) || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-ink">
                                                    {textOf(item.description) || '—'}
                                                    {item.autoGenerated ? <span className="ms-xs text-caption text-faint">آلي</span> : null}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {ADJUSTMENT_AR[textOf(item.adjustmentType)] ?? textOf(item.category) ?? '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {textOf(item.deptName) || textOf(item.deptCode) || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(item.amount)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        {items.length >= ITEM_WINDOW ? (
                            <p className="border-t border-hairline px-sm py-xs text-caption text-warning-text" role="status">
                                {`النافذة مقصوصة عند ${intOf(ITEM_WINDOW)} بندًا — الأحدث بالأثر المالي أولًا.`}
                            </p>
                        ) : null}
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
