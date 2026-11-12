import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import './Kitchen.premium.css';
import { KitchenStudio } from '../components/KitchenStudio';
import { PrintActions } from '../components/PrintActions';
import { BarList, KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { BATCH_STATUS_AR, capNote, fetchKitchenOverview, POLICY_MODE_AR, summarizeKitchen, topDistributions } from '../lib/kitchen';
import { canReviewKitchenExceptions, canWriteKitchenOps, reviewKitchenException } from '../lib/kitchen-ops';
import { errorMessage, intOf, qtyOf, shareOf, textOf } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';

/** المطبخ — نظرة التشغيل + استوديو التشغيل الكامل (استلام/إنتاج/جرد/مستندات). */
export function Kitchen() {
    const auth = useAuthState();
    const canWrite = canWriteKitchenOps(auth.user?.role);
    const canReview = canReviewKitchenExceptions(auth.user?.role);
    const [studioOpen, setStudioOpen] = useState(false);

    const overviewQuery = useQuery({
        queryKey: ['kitchen', 'overview'],
        queryFn: ({ signal }) => fetchKitchenOverview(signal),
    });

    const reviewMutation = useWriteMutation<{ id: string; status: 'reviewed' | 'dismissed' }, void>({
        mutationFn: (input) => reviewKitchenException(input.id, input.status),
        successTitle: (vars) => (vars.status === 'dismissed' ? 'استُبعد الاستثناء' : 'روجِع الاستثناء'),
        invalidate: [['kitchen', 'overview']],
    });

    const overview = overviewQuery.data;
    const summary = overview ? summarizeKitchen(overview) : null;
    const batches = overview?.batches ?? [];
    const exceptions = overview?.exceptions ?? [];
    const top = overview ? topDistributions(overview) : [];
    const maxQty = top.reduce((max, row) => Math.max(max, row.qty), 0);

    return (
        <div className="erp-premium-screen erp-premium-screen--kitchen flex flex-col gap-md">
            <PrintActions title="المطبخ" />

            <ReportHeader
                title="المطبخ"
                english="Kitchen Overview"
                description="أوامر الإنتاج والاستثناءات والتوزيعات والسياسات — على نافذة الخادم المعلنة، لا ادعاء اكتمال خارجها."
                pending={overviewQuery.isFetching}
                onRefresh={() => {
                    void overviewQuery.refetch();
                }}
            />

            <div className="flex flex-wrap items-center justify-end gap-sm">
                <span className="me-auto text-caption text-muted">
                    {canWrite
                        ? 'الاستلام والإنتاج والجرد تُسجَّل على الخادم وتظهر في الدفتر فورًا.'
                        : 'عرض فقط لدورك — التشغيل متاح للمخزن والمطبخ والمدير.'}
                </span>
                <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => setStudioOpen(true)}>
                    تشغيل المطبخ
                </Button>
            </div>

            {overviewQuery.isPending ? <StateLoading label="جارٍ قراءة نظرة المطبخ…" /> : null}

            {overviewQuery.isError ? (
                <StateError
                    message={errorMessage(overviewQuery.error)}
                    onRetry={() => {
                        void overviewQuery.refetch();
                    }}
                />
            ) : null}

            {overview && summary ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المطبخ">
                        <KpiCard
                            label="أوامر مفتوحة"
                            english="Open batches"
                            value={intOf(summary.open)}
                            hint={`${intOf(summary.closed)} أمرًا مغلقًا`}
                            tone={summary.open > 0 ? 'warning' : 'neutral'}
                        />
                        <KpiCard
                            label="مخطط الإنتاج"
                            english="Planned"
                            value={qtyOf(summary.planned)}
                            hint={`منتج ${qtyOf(summary.produced)} · متبقٍ ${qtyOf(summary.remaining)}`}
                        />
                        <KpiCard
                            label="استثناءات مفتوحة"
                            english="Open exceptions"
                            value={intOf(summary.exceptions)}
                            hint="تحتاج مراجعة السياسة"
                            tone={summary.exceptions > 0 ? 'danger' : 'success'}
                        />
                        <KpiCard label=" سياسات الأقسام" english="Policies" value={intOf(summary.policies)} hint="مرن / مراقب / صارم" />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard
                            title="أوامر الإنتاج"
                            english="Production batches"
                            actions={
                                <span className="text-body-sm text-muted" role="status">
                                    {`${intOf(batches.length)} أمرًا`}
                                </span>
                            }
                        >
                            {batches.length === 0 ? (
                                <StateEmpty title="لا أوامر إنتاج" hint="لم يُنشأ أمر إنتاج بعد." />
                            ) : (
                                <TableScroll label="جدول أوامر إنتاج المطبخ">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصنف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الموقع
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    مخطط / منتج
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {batches.map((batch) => (
                                                <tr key={batch.id} className="border-b border-hairline hover:bg-surface-hover">
                                                    <td className="px-sm py-xxs text-ink">
                                                        {textOf(batch.product_name) || `#${batch.id}`}{' '}
                                                        <span className="text-caption text-faint" dir="ltr">
                                                            {textOf(batch.product_unit)}
                                                        </span>
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {textOf(batch.location_name) || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                        {`${qtyOf(batch.planned_qty)} / ${qtyOf(batch.produced_qty)}`}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm">
                                                        <span
                                                            className={
                                                                String(batch.status ?? '') === 'closed' ? 'text-muted' : 'text-warning-text'
                                                            }
                                                        >
                                                            {BATCH_STATUS_AR[String(batch.status ?? '')] ?? textOf(batch.status) ?? '—'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>

                        <SectionCard title="أعلى التوزيعات" english="Top distributions">
                            <BarList
                                ariaLabel="أعلى أصناف التوزيع"
                                emptyText="لا توزيعات في النافذة."
                                items={top.map((row) => ({
                                    label: row.label,
                                    value: qtyOf(row.qty),
                                    share: shareOf(row.qty, maxQty),
                                }))}
                            />
                        </SectionCard>
                    </div>

                    <SectionCard
                        title="استثناءات السياسة"
                        english="Policy exceptions"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(exceptions.length)} استثناءً`}
                            </span>
                        }
                    >
                        {exceptions.length === 0 ? (
                            <StateEmpty title="لا استثناءات مفتوحة" hint="كل الأوامر داخل سياسة قسمها." />
                        ) : (
                            <ul className="flex list-none flex-col gap-xs p-sm">
                                {exceptions.map((row) => (
                                    <li key={row.id} className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm">
                                        <p className="text-ink">
                                            {textOf(row.product_name) || `#${row.id}`}{' '}
                                            <span className="erp-numeric text-muted" dir="ltr">
                                                {qtyOf(row.quantity)}
                                            </span>{' '}
                                            <span className="text-caption text-faint">
                                                {POLICY_MODE_AR[String(row.operation_mode ?? '')] ?? textOf(row.operation_mode)}
                                            </span>
                                        </p>
                                        <p className="mt-xxs text-muted">
                                            {textOf(row.reason) || 'بلا سبب مسجل'}
                                            {row.department_name ? ` · ${textOf(row.department_name)}` : ''}
                                        </p>
                                        {canReview ? (
                                            <div className="mt-xs flex flex-wrap gap-xs">
                                                <button
                                                    type="button"
                                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                                    disabled={reviewMutation.isPending}
                                                    onClick={() => reviewMutation.mutate({ id: String(row.id), status: 'reviewed' })}
                                                >
                                                    رواجع
                                                </button>
                                                <button
                                                    type="button"
                                                    className="rounded-md border border-danger/50 bg-surface px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft disabled:opacity-50"
                                                    disabled={reviewMutation.isPending}
                                                    onClick={() => reviewMutation.mutate({ id: String(row.id), status: 'dismissed' })}
                                                >
                                                    استبعاد
                                                </button>
                                            </div>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SectionCard>

                    {capNote(summary) ? (
                        <p className="text-caption text-warning-text" role="status">
                            {`نافذة مقصوصة: ${capNote(summary)}`}
                        </p>
                    ) : null}
                </>
            ) : null}

            {overviewQuery.isPending ? (
                <SectionCard title="أوامر الإنتاج" english="Production batches">
                    <TableSkeleton rows={5} columns={4} />
                </SectionCard>
            ) : null}

            {reviewMutation.isError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {writeErrorMessage(reviewMutation.error, 'تعذّرت مراجعة الاستثناء')}
                </p>
            ) : null}

            <KitchenStudio open={studioOpen} onOpenChange={setStudioOpen} />
        </div>
    );
}
