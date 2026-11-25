import { useQuery } from '@tanstack/react-query';
import { ScreenHero } from '../ui';
import { useMemo, useState } from 'react';
import './Kitchen.premium.css';
import { KitchenStudio } from '../components/KitchenStudio';
import { BarList, KpiCard, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    BATCH_STATUS_AR,
    capNote,
    costRatioTone,
    fetchKitchenCostCards,
    fetchKitchenOverview,
    POLICY_MODE_AR,
    riyadhMonthStart,
    riyadhToday,
    summarizeKitchen,
    type KitchenCostCard,
    topDistributions,
} from '../lib/kitchen';
import { canReviewKitchenExceptions, canWriteKitchenOps, reviewKitchenException } from '../lib/kitchen-ops';
import { printOfficialSheet, type OfficialSheetSection } from '../lib/official-print';
import { errorMessage, intOf, moneyOf, pctOf, qtyOf, shareOf, textOf } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

/** المطبخ — نظرة التشغيل + استوديو التشغيل الكامل (استلام/إنتاج/جرد/مستندات). */
/** يترجم أنواع الخادم المختلطة (boolean / 'true' / 1) إلى نعم/لا. */
function boolYes(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === null || value === undefined) {
        return false;
    }
    const text = String(value).trim().toLowerCase();
    return text === 'true' || text === 't' || text === '1' || text === 'yes' || text === 'y';
}

const POLICY_MODE_TONE: Record<string, string> = {
    flexible: 'text-success-text',
    monitor: 'text-warning-text',
    strict: 'text-danger-text',
};

const BATCH_FILTERS = [
    ['all', 'الكل'],
    ['open', 'مفتوحة'],
    ['closed', 'مغلقة'],
    ['cancelled', 'ملغاة'],
] as const;

type BatchFilter = (typeof BATCH_FILTERS)[number][0];

export function Kitchen() {
    const auth = useAuthState();
    const canWrite = canWriteKitchenOps(auth.user?.role);
    const canReview = canReviewKitchenExceptions(auth.user?.role);
    const [studioOpen, setStudioOpen] = useState(false);
    const { toast } = useToast();

    const [costFrom, setCostFrom] = useState(() => riyadhMonthStart());
    const [costTo, setCostTo] = useState(() => riyadhToday());
    const costRangeInvalid = costFrom > costTo;

    const overviewQuery = useQuery({
        queryKey: ['kitchen', 'overview'],
        queryFn: ({ signal }) => fetchKitchenOverview(signal),
    });

    const costCardsQuery = useQuery({
        queryKey: ['kitchen', 'cost-cards', costFrom, costTo],
        queryFn: ({ signal }) => fetchKitchenCostCards(costFrom, costTo, signal),
        enabled: !costRangeInvalid,
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
    const policies = overview?.policies ?? [];
    const [batchFilter, setBatchFilter] = useState<BatchFilter>('all');
    const openStatuses = useMemo(() => new Set(['draft', 'open']), []);
    const batchCounts = useMemo(() => {
        const counts = { all: batches.length, open: 0, closed: 0, cancelled: 0 };
        for (const batch of batches) {
            const status = String(batch.status ?? '');
            if (openStatuses.has(status)) {
                counts.open += 1;
            } else if (status === 'closed') {
                counts.closed += 1;
            } else if (status === 'cancelled') {
                counts.cancelled += 1;
            }
        }
        return counts;
    }, [batches, openStatuses]);
    const filteredBatches = useMemo(() => {
        if (batchFilter === 'all') {
            return batches;
        }
        if (batchFilter === 'open') {
            return batches.filter((batch) => openStatuses.has(String(batch.status ?? '')));
        }
        if (batchFilter === 'closed') {
            return batches.filter((batch) => String(batch.status ?? '') === 'closed');
        }
        return batches.filter((batch) => String(batch.status ?? '') === 'cancelled');
    }, [batches, batchFilter, openStatuses]);
    const top = overview ? topDistributions(overview) : [];
    const maxQty = top.reduce((max, row) => Math.max(max, row.qty), 0);
    const costCards = costCardsQuery.data?.cards ?? [];

    /** طباعة «بطاقة تكلفة» رسمية — هوية الكربون والذهبي عبر المستند الرسمي. */
    function printCostCard(card: KitchenCostCard): void {
        const cons = card.consumption;
        const prod = card.production;
        const items = Array.isArray(cons?.items) ? cons.items : [];
        const lines = Array.isArray(prod?.lines) ? prod.lines : [];
        const from = String(card.from ?? costFrom);
        const to = String(card.to ?? costTo);
        const consumptionNet = Number(cons?.gross ?? 0);
        const returned = Number(cons?.returned ?? 0);
        const productionCost = Number(prod?.cost ?? 0);
        const revenue = Number(card.revenue ?? 0);
        const net = Number(card.net ?? 0);
        const ratio = card.costRatio == null ? null : Number(card.costRatio);
        const ratioText = ratio == null || Number.isNaN(ratio) ? '—' : `${ratio.toFixed(1)}%`;
        const itemsTotal = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
        const printedItems = items.slice(0, 100);
        const printedLines = lines.slice(0, 60);
        const productionSection: OfficialSheetSection = {
            heading: 'بنود الإنتاج الموزّعة على هذا الاتجاه',
            columns: [
                { key: 'name', header: 'الصنف' },
                { key: 'allocated', header: 'مخصص / مخطط', align: 'center' },
                { key: 'batchCost', header: 'تكلفة الخطة', align: 'end' },
                { key: 'cost', header: 'التكلفة المخصصة', align: 'end' },
                { key: 'date', header: 'التاريخ', align: 'center' },
            ],
            rows: printedLines.map((line) => ({
                name: String(line.product_name ?? `دفعة #${String(line.batch_id ?? '—')}`),
                allocated: `${qtyOf(line.allocated_qty)} / ${qtyOf(line.planned_qty)}`,
                batchCost: moneyOf(line.batch_cost),
                cost: moneyOf(line.cost),
                date: String(line.prod_date ?? '').slice(0, 10),
            })),
        };
        if (lines.length > 0) {
            productionSection.totalsRow = [{
                name: lines.length > printedLines.length ? `الإجمالي (أول ${String(printedLines.length)} من ${String(lines.length)} بند)` : 'الإجمالي',
                allocated: '',
                batchCost: '',
                cost: moneyOf(productionCost),
                date: '',
            }];
        } else {
            productionSection.note = 'لا توجد بنود إنتاج موزّعة خلال الفترة.';
        }
        const consumptionSection: OfficialSheetSection = {
            heading: 'الأصناف المصروفة من المخازن',
            columns: [
                { key: 'name', header: 'الصنف' },
                { key: 'qty', header: 'الكمية', align: 'end' },
                { key: 'cost', header: 'تكلفة الوحدة', align: 'end' },
                { key: 'value', header: 'القيمة', align: 'end' },
                { key: 'date', header: 'التاريخ', align: 'center' },
                { key: 'dispatch', header: 'رقم الطلب', align: 'center' },
            ],
            rows: printedItems.map((item) => ({
                name: String(item.name ?? '—'),
                qty: `${qtyOf(item.qty)} ${String(item.unit ?? '')}`,
                cost: moneyOf(item.cost),
                value: moneyOf(item.value),
                date: String(item.date ?? '').slice(0, 10),
                dispatch: item.dispatch_no != null ? `#${String(item.dispatch_no)}` : '—',
            })),
        };
        if (items.length > 0) {
            consumptionSection.totalsRow = [{
                name: items.length > printedItems.length ? `الإجمالي (أول ${String(printedItems.length)} من ${String(items.length)} بند)` : 'الإجمالي',
                qty: '',
                cost: '',
                value: moneyOf(itemsTotal),
                date: '',
                dispatch: '',
            }];
        } else {
            consumptionSection.note = 'لا توجد أصناف مصروفة خلال الفترة.';
        }
        const ok = printOfficialSheet({
            title: `بطاقة تكلفة — ${String(card.name ?? card.code ?? '')}`,
            englishTitle: 'COST CARD',
            subtitle: 'استهلاك المطبخ من المخازن وتكلفة الإنتاج مقابل الإيرادات',
            from,
            to,
            kpis: [
                { label: 'استهلاك المطبخ (بعد المرتجعات)', value: moneyOf(consumptionNet), hint: `المرتجعات: ${moneyOf(returned)}` },
                { label: 'تكلفة الإنتاج المخصصة', value: moneyOf(productionCost), hint: `${String(lines.length)} بند موزّع` },
                { label: 'إيرادات المبيعات', value: moneyOf(revenue), hint: 'الإيرادات المسجلة في الفترة' },
                { label: 'نسبة التكلفة / الصافي', value: ratioText, hint: `صافي: ${moneyOf(net)}` },
            ],
            sections: [productionSection, consumptionSection],
            notes: [
                `الاستهلاك الصافي = إجمالي المصروف من المخازن (${moneyOf(itemsTotal)} عبر ${String(items.length)} بندًا) مطروحًا منه المرتجعات (${moneyOf(returned)}).`,
                'نسبة التكلفة = (الاستهلاك بعد المرتجعات + تكلفة الإنتاج المخصصة) ÷ إيراد نقاط البيع خلال الفترة نفسها.',
                'الأرقام على نافذة الخادم: أحدث 400 بند صرف — أي حركة أقدم خارجها غير مشمولة هنا.',
            ],
            signatures: [{ role: 'إعداد المخزن' }, { role: 'مراجعة المطبخ' }, { role: 'اعتماد المدير' }],
        });
        if (!ok) {
            toast({ title: 'تعذر فتح نافذة الطباعة', variant: 'error' });
        }
    }

    return (
        <div className="erp-premium-screen erp-premium-screen--kitchen flex flex-col gap-md">

<ScreenHero
                title="المطبخ"
                english="Kitchen Overview"
                description="أوامر الإنتاج والاستثناءات والتوزيعات والسياسات — على نافذة الخادم المعلنة، لا ادعاء اكتمال خارجها."
                actions={
                    <>
                        <button
                            type="button"
                            onClick={() => { () => {
                    void overviewQuery.refetch();
                    if (!costRangeInvalid) {
                        void costCardsQuery.refetch();
                    }
                } }}
                            disabled={overviewQuery.isFetching || costCardsQuery.isFetching}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            تحديث
                        </button>
                    </>
                }
            />

            <div className="flex flex-wrap items-center justify-end gap-sm">
                <span className="me-auto text-caption text-muted">
                    {canWrite
                        ? 'الاستلام والإنتاج والجرد تُسجَّل على الخادم وتظهر في الدفتر فورًا.'
                        : 'عرض فقط لدورك — التشغيل متاح للمخزن والمطبخ والمدير.'}
                </span>
                <Button
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => setStudioOpen(true)}
                    disabled={!canWrite}
                    title={canWrite ? undefined : 'التشغيل متاح للمخزن والمطبخ والإدارة فقط'}
                >
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
                                <fieldset className="flex flex-wrap items-center gap-xs" aria-label="تصفية الأوامر حسب الحالة">
                                    {BATCH_FILTERS.map(([key, label]) => {
                                        const isActive = batchFilter === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                aria-pressed={isActive}
                                                onClick={() => setBatchFilter(key)}
                                                className={`rounded-md border border-hairline-strong px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover ${
                                                    isActive ? 'bg-surface-sunken font-medium' : 'bg-surface'
                                                }`}
                                            >
                                                {`${label} (${intOf(batchCounts[key])})`}
                                            </button>
                                        );
                                    })}
                                </fieldset>
                            }
                        >
                            {batches.length === 0 ? (
                                <StateEmpty title="لا أوامر إنتاج" hint="لم يُنشأ أمر إنتاج بعد." />
                            ) : filteredBatches.length === 0 ? (
                                <StateEmpty title="لا أوامر مطابقة للمرشح" hint="غيّر المرشح أعلاه." />
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
                                            {filteredBatches.map((batch) => (
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

                    <SectionCard
                        title="سياسات الأقسام"
                        english="Department policies"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(policies.length)} سياسة`}
                            </span>
                        }
                    >
                        {policies.length === 0 ? (
                            <StateEmpty title="لا توجد سياسات أقسام" hint="تُضبط سياسات الأقسام من استوديو التشغيل (الوضع/التجاوز/السبب)." />
                        ) : (
                            <TableScroll label="سياسات الأقسام في المطبخ">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                القسم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                موقع المطبخ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الوضع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                السماح بالتجاوز
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                السبب إلزامي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                آخر تحديث
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {policies.map((policy, policyIndex) => {
                                            const mode = String(policy.operation_mode ?? '');
                                            return (
                                                <tr key={String(policy.id ?? policyIndex)} className="border-b border-hairline hover:bg-surface-hover">
                                                    <td className="px-sm py-xxs text-ink">
                                                        {textOf(policy.department_name) || `#${String(policy.department_id ?? '—')}`}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {textOf(policy.kitchen_location_name) || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm font-semibold">
                                                        <span className={POLICY_MODE_TONE[mode] ?? 'text-muted'}>
                                                            {POLICY_MODE_AR[mode] ?? textOf(policy.operation_mode) ?? '—'}
                                                        </span>
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {boolYes(policy.allow_fallback) ? 'نعم' : 'لا'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {boolYes(policy.require_reason) ? 'إلزامي' : 'اختياري'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                        {textOf(policy.updated_at).slice(0, 10) || '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    {capNote(summary) ? (
                        <p className="text-caption text-warning-text" role="status">
                            {`نافذة مقصوصة: ${capNote(summary)}`}
                        </p>
                    ) : null}
                </>
            ) : null}

            <SectionCard
                title="بطاقات التكلفة"
                english="Cost Cards"
                actions={
                    <div className="flex flex-wrap items-center gap-xs">
                        <label className="flex items-center gap-xxs text-caption text-muted">
                            من
                            <input
                                type="date"
                                value={costFrom}
                                max={costTo || undefined}
                                onChange={(event) => setCostFrom(event.target.value)}
                                className="rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm text-ink"
                                dir="ltr"
                            />
                        </label>
                        <label className="flex items-center gap-xxs text-caption text-muted">
                            إلى
                            <input
                                type="date"
                                value={costTo}
                                min={costFrom || undefined}
                                onChange={(event) => setCostTo(event.target.value)}
                                className="rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm text-ink"
                                dir="ltr"
                            />
                        </label>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                void costCardsQuery.refetch();
                            }}
                        >
                            تحديث
                        </Button>
                    </div>
                }
            >
                <div className="flex flex-col gap-sm p-sm">
                    <p className="text-caption text-muted">
                        استهلاك كل اتجاه من المخازن، وتكلفة ما أُنتج له، مقابل الإيرادات المسجّلة — كل رقم من الخادم على الفترة.
                    </p>
                    {costRangeInvalid ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            تاريخ «من» بعد تاريخ «إلى» — صحّح الفترة.
                        </p>
                    ) : null}
                    {costCardsQuery.isPending && !costRangeInvalid ? <StateLoading label="جارٍ قراءة بطاقات التكلفة…" /> : null}
                    {costCardsQuery.isError && !costRangeInvalid ? (
                        <StateError
                            message={errorMessage(costCardsQuery.error)}
                            onRetry={() => {
                                void costCardsQuery.refetch();
                            }}
                        />
                    ) : null}
                    {costCardsQuery.data && !costRangeInvalid ? (
                        costCards.length === 0 ? (
                            <StateEmpty title="لا توجد بطاقات تكلفة" hint="لا توجد حركة مخزن أو إنتاج في الفترة المحددة." />
                        ) : (
                            costCards.map((card, index) => {
                                const cons = card.consumption;
                                const prod = card.production;
                                const items = Array.isArray(cons?.items) ? cons.items : [];
                                const lines = Array.isArray(prod?.lines) ? prod.lines : [];
                                const returned = Number(cons?.returned ?? 0);
                                const ratio = card.costRatio == null ? null : Number(card.costRatio);
                                const tone = costRatioTone(ratio) ?? 'neutral';
                                return (
                                    <article
                                        key={String(card.code ?? index)}
                                        className="overflow-hidden rounded-lg border border-hairline bg-surface-sunken"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline px-sm py-xs">
                                            <div className="flex items-center gap-sm">
                                                <span
                                                    className="h-3 w-3 rounded-full"
                                                    style={{ backgroundColor: String(card.color ?? '#c8a24a') }}
                                                    aria-hidden="true"
                                                />
                                                <h3 className="text-heading-sm text-ink">{String(card.name ?? card.code ?? 'بطاقة')}</h3>
                                                <span className="text-caption text-muted" dir="ltr">
                                                    {String(card.from ?? costFrom)} ← {String(card.to ?? costTo)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-xs">
                                                <span className="text-caption text-muted">{`${intOf(items.length)} بند صرف · ${intOf(lines.length)} بند إنتاج`}</span>
                                                <Button type="button" size="sm" variant="secondary" onClick={() => printCostCard(card)}>
                                                    طباعة البطاقة
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-sm p-sm xl:grid-cols-4">
                                            <KpiCard
                                                label="استهلاك المطبخ (بعد المرتجعات)"
                                                english="Net consumption"
                                                value={moneyOf(cons?.gross ?? 0)}
                                                hint={returned > 0 ? `المرتجعات: ${moneyOf(returned)}` : 'لا مرتجعات في الفترة'}
                                            />
                                            <KpiCard
                                                label="تكلفة الإنتاج المخصصة"
                                                english="Production"
                                                value={moneyOf(prod?.cost ?? 0)}
                                                hint={`${intOf(lines.length)} بند موزّع`}
                                            />
                                            <KpiCard
                                                label="إيرادات المبيعات"
                                                english="Revenue"
                                                value={moneyOf(card.revenue ?? 0)}
                                                hint="الإيرادات المسجّلة في الفترة"
                                            />
                                            <KpiCard
                                                label="نسبة التكلفة"
                                                english="Cost ratio"
                                                value={ratio == null || Number.isNaN(ratio) ? '—' : pctOf(ratio)}
                                                hint={`صافي: ${moneyOf(card.net ?? 0)}`}
                                                tone={tone}
                                            />
                                        </div>
                                        <details className="border-t border-hairline px-sm py-xs">
                                            <summary className="cursor-pointer text-body-sm text-ink hover:text-primary">
                                                بنود الإنتاج والأصناف المصروفة
                                            </summary>
                                            <div className="mt-xs flex flex-col gap-sm">
                                                {lines.length > 0 ? (
                                                    <TableScroll label="بنود الإنتاج الموزعة على هذا الاتجاه">
                                                        <table className="w-full border-collapse text-body-md">
                                                            <thead>
                                                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                                    <th scope="col" className="px-sm py-xs text-start font-medium">الصنف</th>
                                                                    <th scope="col" className="px-sm py-xs text-start font-medium">مخصص / مخطط</th>
                                                                    <th scope="col" className="px-sm py-xs text-start font-medium">تكلفة الخطة</th>
                                                                    <th scope="col" className="px-sm py-xs text-start font-medium">التكلفة المخصصة</th>
                                                                    <th scope="col" className="px-sm py-xs text-start font-medium">التاريخ</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {lines.map((line, lineIndex) => (
                                                                    <tr key={String(line.batch_id ?? lineIndex)} className="border-b border-hairline">
                                                                        <td className="px-sm py-xxs text-ink">
                                                                            {String(line.product_name ?? `دفعة #${String(line.batch_id ?? '—')}`)}
                                                                        </td>
                                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                                            {`${qtyOf(line.allocated_qty)} / ${qtyOf(line.planned_qty)}`}
                                                                        </td>
                                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">{moneyOf(line.batch_cost)}</td>
                                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">{moneyOf(line.cost)}</td>
                                                                        <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                                            {String(line.prod_date ?? '').slice(0, 10)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </TableScroll>
                                                ) : (
                                                    <p className="text-body-sm text-muted">لا توجد بنود إنتاج موزّعة خلال الفترة.</p>
                                                )}
                                                {items.length > 0 ? (
                                                    <>
                                                        <TableScroll label="الأصناف المصروفة من المخازن — أحدث 25 بندًا">
                                                            <table className="w-full border-collapse text-body-md">
                                                                <thead>
                                                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">الصنف</th>
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">الكمية</th>
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">تكلفة الوحدة</th>
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">القيمة</th>
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">التاريخ</th>
                                                                        <th scope="col" className="px-sm py-xs text-start font-medium">رقم الطلب</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {items.slice(0, 25).map((item, itemIndex) => (
                                                                        <tr key={`${String(item.dispatch_no ?? '')}-${String(item.date ?? '')}-${String(itemIndex)}`} className="border-b border-hairline">
                                                                            <td className="px-sm py-xxs text-ink">{String(item.name ?? '—')}</td>
                                                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                                                {`${qtyOf(item.qty)} ${String(item.unit ?? '')}`}
                                                                            </td>
                                                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">{moneyOf(item.cost)}</td>
                                                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">{moneyOf(item.value)}</td>
                                                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                                                {String(item.date ?? '').slice(0, 10)}
                                                                            </td>
                                                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                                                {item.dispatch_no != null ? `#${String(item.dispatch_no)}` : '—'}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </TableScroll>
                                                        {items.length > 25 ? (
                                                            <p className="text-caption text-muted">{`يعرض أحدث 25 بندًا من ${intOf(items.length)} — النسخة المطبوعة تحمل حتى 100 بند.`}</p>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    <p className="text-body-sm text-muted">لا توجد أصناف مصروفة خلال الفترة.</p>
                                                )}
                                            </div>
                                        </details>
                                    </article>
                                );
                            })
                        )
                    ) : null}
                </div>
            </SectionCard>

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
