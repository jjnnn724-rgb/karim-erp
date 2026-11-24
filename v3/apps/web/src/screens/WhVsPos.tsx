import './WhVsPos.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { errorMessage, intOf, moneyOf, pctOf, presetRange, qtyOf, rangeProblem, textOf } from '../lib/reporting';
import { fetchWhVsPos, isTruthyFlag, WH_VS_POS_STATUS_AR, YARA_MAX_DAYS } from '../lib/yara-reports';

const numOf = (value: unknown): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * مقارنة المخزن بنقطة البيع — كميات الصرف مقابل المبيع لكل صنف،
 * والفرق ونسبته وحالته كما حسبها الخادم.
 */
export function WhVsPos() {
    const [draft, setDraft] = useState(() => presetRange('week'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const compareQuery = useQuery({
        queryKey: ['yara', 'wh-vs-pos', range.from, range.to],
        queryFn: ({ signal }) => fetchWhVsPos(range.from, range.to, signal),
    });

    const data = compareQuery.data;
    const rows = data?.rows ?? [];
    const matched = rows.filter((row) => Math.abs(numOf(row.diff)) <= 0.0001).length;
    const drifted = rows.length - matched;
    const live = isTruthyFlag(data?.liveSynced);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, YARA_MAX_DAYS);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="screen-premium flex flex-col gap-md">
            <ReportHeader
                title="مقارنة المخزن بنقطة البيع"
                english="Warehouse vs POS"
                description="كمية الصرف المخزني مقابل المسجَّل مبيعًا لكل صنف — الفرق ونسبته وحالته من الخادم."
                pending={compareQuery.isFetching}
                onRefresh={() => {
                    void compareQuery.refetch();
                }}
            />
            <PrintActions title="مقارنة المخزن بنقطة البيع" />

            <SectionCard title="الفترة" english="Period">
                <div className="p-sm">
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
                        pending={compareQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {compareQuery.isPending ? <StateLoading label="جارٍ مقارنة المخزن بالمبيعات…" /> : null}

            {compareQuery.isError ? (
                <StateError
                    message={errorMessage(compareQuery.error)}
                    onRetry={() => {
                        void compareQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المقارنة">
                        <KpiCard label="أصناف مقارنة" english="Items" value={intOf(rows.length)} hint="في النافذة" />
                        <KpiCard
                            label="مطابقة"
                            english="Matched"
                            value={intOf(matched)}
                            hint={`${intOf(drifted)} صنفًا بفرق`}
                            tone={drifted === 0 ? 'success' : 'neutral'}
                        />
                        <KpiCard
                            label="أصناف بفرق"
                            english="Drifted"
                            value={intOf(drifted)}
                            hint="تحتاج مراجعة صرف أو بيع"
                            tone={drifted > 0 ? 'warning' : 'success'}
                        />
                        <KpiCard
                            label="مزامنة المرآة"
                            english="Live sync"
                            value={live ? 'محدّثة' : 'غير محدّثة'}
                            hint={textOf(data.lastSyncAt) || 'لا وقت مزامنة معلن'}
                            tone={live ? 'success' : 'warning'}
                        />
                    </ul>

                    <SectionCard
                        title="الفروق"
                        english="Differences"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(rows.length)} صنفًا`}
                            </span>
                        }
                    >
                        {rows.length === 0 ? (
                            <StateEmpty title="لا صفوف مقارنة" hint="لا صرف ولا مبيعات في هذه الفترة." />
                        ) : (
                            <TableScroll label="جدول مقارنة المخزن بنقطة البيع">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                القسم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                المخزن
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                نقطة البيع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الفرق
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                النسبة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                صافي المبيع
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr
                                                key={textOf(row.name) || textOf(row.dept)}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="px-sm py-xxs text-ink">{textOf(row.name) || '—'}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {textOf(row.dept) || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {qtyOf(row.wh_qty)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {qtyOf(row.pos_qty)}
                                                </td>
                                                <td
                                                    className={`erp-numeric px-sm py-xxs ${
                                                        numOf(row.diff) > 0
                                                            ? 'text-warning-text'
                                                            : numOf(row.diff) < 0
                                                              ? 'text-danger-text'
                                                              : 'text-muted'
                                                    }`}
                                                    dir="ltr"
                                                >
                                                    {qtyOf(row.diff)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {pctOf(row.pct)}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm">
                                                    <span
                                                        className={
                                                            Math.abs(numOf(row.diff)) <= 0.0001
                                                                ? 'text-success-text'
                                                                : 'text-warning-text'
                                                        }
                                                    >
                                                        {WH_VS_POS_STATUS_AR[textOf(row.status)] ??
                                                            textOf(row.status) ??
                                                            '—'}
                                                    </span>
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {moneyOf(row.pos_net)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        <p className="border-t border-hairline px-sm py-xs text-caption text-muted" role="status">
                            {`سقف الفترة ${intOf(YARA_MAX_DAYS)} يومًا · الحالة والفرق من الخادم`}
                        </p>
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
