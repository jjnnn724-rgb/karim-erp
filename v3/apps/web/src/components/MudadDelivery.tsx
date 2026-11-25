import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    ageText,
    eventDirectionLabel,
    eventOutcomeLabel,
    fetchIntegrationEvents,
    fetchIntegrationHealth,
    fetchIntegrationOutbox,
    type IntegrationEvent,
    type IntegrationProvider,
    OUTBOX_STATUSES,
    type OutboxRow,
    outboxRetryable,
    outboxReviewable,
    outboxStatusLabel,
    providerToggleAllowed,
    providerVerification,
    type ReviewDecision,
    retryIntegrationRow,
    reviewIntegrationRow,
    setIntegrationProviderEnabled,
} from '../lib/integration-ops';
import { formatInt } from '../lib/inventory-register';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * تشغيل التكامل داخل شاشة الامتثال — نفس أقسام V2 `compliance.js`:
 * سجل المزوّدين (التحقق وتفعيله للموثّق فقط)، صندوق الصادر (عدّادات +
 * صفوف dead_letter بإعادة/اعتماد/إلغاء)، وآخر الأحداث. لا إرسال خارجي هنا.
 */

/** دورة المراقبة الحيّة — قراءة فقط. */
const MONITOR_INTERVAL_MS = 30_000;

function dateText(value: string | null | undefined): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function clockText(value: string | null | undefined): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SectionHead({ title, description }: { title: string; description: string }) {
    return (
        <div className="border-b border-hairline px-sm py-xs">
            <h2 className="text-heading-md text-ink">{title}</h2>
            <p className="text-body-sm text-muted">{description}</p>
        </div>
    );
}

function ProviderCard({
    provider,
    writable,
    onToggle,
}: {
    provider: IntegrationProvider;
    writable: boolean;
    onToggle: (provider: IntegrationProvider, enabled: boolean) => void;
}) {
    const verification = providerVerification(provider.verification);
    const allowed = providerToggleAllowed(provider);
    return (
        <article className="flex min-w-0 flex-col gap-xs rounded-lg border border-hairline bg-surface p-sm shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-xs">
                <div className="min-w-0">
                    <p className="text-body-md font-semibold text-ink">{provider.name_ar || provider.code}</p>
                    <p className="text-caption text-faint" dir="ltr" lang="en">
                        {provider.name_en || provider.code}
                    </p>
                </div>
                <Badge variant={verification.tone}>{verification.label}</Badge>
            </div>
            <p className="text-body-sm text-muted">{provider.evidence_note || 'لا يوجد دليل مسجّل.'}</p>
            <p className="text-caption text-muted">آخر تحقق: {dateText(provider.last_verified_at)}</p>
            {allowed ? (
                <label className="flex items-center gap-xs text-body-sm text-ink">
                    <input
                        type="checkbox"
                        checked={Boolean(provider.is_enabled)}
                        disabled={!writable}
                        onChange={(event) => onToggle(provider, event.target.checked)}
                    />
                    مفعّل
                </label>
            ) : (
                <p className="text-caption text-muted">التفعيل يتطلب تحققًا موثّقًا.</p>
            )}
        </article>
    );
}

export function MudadDelivery({ writable }: { writable: boolean }) {
    const [pendingToggle, setPendingToggle] = useState<{ provider: IntegrationProvider; enabled: boolean } | null>(null);
    const [review, setReview] = useState<{ row: OutboxRow; decision: ReviewDecision } | null>(null);
    const [reason, setReason] = useState('');
    const [reviewError, setReviewError] = useState('');
    const [outboxStatus, setOutboxStatus] = useState<(typeof OUTBOX_STATUSES)[number] | ''>('dead_letter');

    const healthQuery = useQuery({
        queryKey: ['integration', 'health'],
        queryFn: ({ signal }) => fetchIntegrationHealth(signal),
        refetchInterval: MONITOR_INTERVAL_MS,
        refetchOnWindowFocus: true,
    });
    const outboxQuery = useQuery({
        queryKey: ['integration', 'outbox', outboxStatus],
        queryFn: ({ signal }) => fetchIntegrationOutbox(outboxStatus, signal),
        refetchInterval: MONITOR_INTERVAL_MS,
        refetchOnWindowFocus: true,
    });
    const eventsQuery = useQuery({
        queryKey: ['integration', 'events'],
        queryFn: ({ signal }) => fetchIntegrationEvents(20, signal),
        refetchInterval: MONITOR_INTERVAL_MS,
        refetchOnWindowFocus: true,
    });

    const toggleMutation = useWriteMutation<{ provider: IntegrationProvider; enabled: boolean }, unknown>({
        mutationFn: ({ provider, enabled }) => setIntegrationProviderEnabled(provider.code, enabled),
        successTitle: ({ enabled }) => (enabled ? 'تم تفعيل المزوّد' : 'تم تعطيل المزوّد'),
        errorTitle: 'تعذّر تغيير حالة المزوّد',
        invalidate: [['integration']],
        onSuccess: () => setPendingToggle(null),
    });

    const retryMutation = useWriteMutation<string, unknown>({
        mutationFn: (id) => retryIntegrationRow(id),
        successTitle: 'أُنشئت إعادة المحاولة',
        successDescription: 'الصف الجديد في الطابور ومسجَّل في الأحداث.',
        errorTitle: 'تعذّرت إعادة المحاولة',
        invalidate: [['integration']],
    });

    const reviewMutation = useWriteMutation<{ id: string; decision: ReviewDecision; reason: string }, unknown>({
        mutationFn: ({ id, decision, reason: text }) => reviewIntegrationRow(id, decision, text),
        successTitle: 'تم تسجيل المراجعة',
        errorTitle: 'تعذّرت مراجعة الصف',
        invalidate: [['integration']],
        silentError: true,
        onSuccess: () => {
            setReview(null);
            setReason('');
            setReviewError('');
        },
        onError: (error) => setReviewError(writeErrorMessage(error)),
    });

    function refreshAll() {
        void healthQuery.refetch();
        void outboxQuery.refetch();
        void eventsQuery.refetch();
    }

    function openReview(row: OutboxRow, decision: ReviewDecision) {
        setReview({ row, decision });
        setReason('مراجعة يدوية من شاشة الامتثال');
        setReviewError('');
    }

    async function submitReview() {
        if (!review) {
            return;
        }
        if (reason.trim().length < 3) {
            setReviewError('سبب المراجعة مطلوب — 3 أحرف على الأقل.');
            return;
        }
        try {
            await reviewMutation.mutateAsync({ id: review.row.id, decision: review.decision, reason });
        } catch {
            // الرسالة تُعرض داخل النافذة عبر onError.
        }
    }

    const health = healthQuery.data;
    const counts = health?.outbox ?? null;
    const deadRows = outboxQuery.data ?? [];
    const events = eventsQuery.data ?? [];

    return (
        <>
            <Card className="mudad-section">
                <SectionHead title="مزوّدو التكامل" description="التصنيف كما هو في السجل — التفعيل لا يُتاح قبل تحقق موثّق." />
                <div className="mudad-section__body flex flex-col gap-sm">
                    <div className="flex flex-wrap items-center justify-between gap-sm">
                        <p className="text-body-sm text-muted">
                            {health
                                ? `${formatInt(health.providers.length)} مزوّدًا · ${formatInt(
                                      health.providers.filter((provider) => provider.is_enabled).length,
                                  )} مفعّلًا`
                                : 'جارٍ قراءة سجل المزوّدين…'}
                        </p>
                        <Button type="button" size="sm" variant="secondary" onClick={refreshAll}>
                            تحديث
                        </Button>
                    </div>
                    {healthQuery.isError ? (
                        <StateError
                            message={healthQuery.error instanceof Error ? healthQuery.error.message : 'تعذّرت قراءة حالة التكامل'}
                            onRetry={() => {
                                void healthQuery.refetch();
                            }}
                        />
                    ) : null}
                    {healthQuery.isPending ? <TableSkeleton rows={2} columns={3} /> : null}
                    {health ? (
                        <div className="grid gap-sm md:grid-cols-2 xl:grid-cols-3">
                            {health.providers.map((provider) => (
                                <ProviderCard
                                    key={provider.code}
                                    provider={provider}
                                    writable={writable}
                                    onToggle={(target, enabled) => setPendingToggle({ provider: target, enabled })}
                                />
                            ))}
                        </div>
                    ) : null}
                    {health?.infra && health.infra.migration_145 === false ? (
                        <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-warning-text">
                            صندوق الصادر غير مثبَّت على هذه القاعدة — هجرة 145 غير مطبقة.
                        </p>
                    ) : null}
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead
                    title="صندوق الصادر"
                    description="مراقبة حيّة لصفوف الصادر بحمولة مخفية — لا تُعرض الحمولة ولا يُرسل شيء خارجي."
                />
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end justify-between gap-sm">
                        <div className="flex flex-wrap items-center gap-xs">
                            <Badge variant="success" dot>
                                مباشر
                            </Badge>
                            <span className="text-caption text-muted">
                                آخر تحديث:{' '}
                                <span className="erp-numeric" dir="ltr">
                                    {clockText(health?.generated_at)}
                                </span>{' '}
                                · {outboxQuery.isFetching ? 'جارٍ التحديث…' : `كل ${MONITOR_INTERVAL_MS / 1000} ثانية`}
                            </span>
                        </div>
                        <Select
                            label="حالة الصف"
                            size="sm"
                            containerClassName="min-w-[180px]"
                            value={outboxStatus}
                            options={[
                                { value: '', label: 'كل الحالات' },
                                ...OUTBOX_STATUSES.map((status) => ({ value: status, label: outboxStatusLabel(status) })),
                            ]}
                            onValueChange={(next) => {
                                setOutboxStatus(next as (typeof OUTBOX_STATUSES)[number] | '');
                            }}
                        />
                    </div>
                    {counts ? (
                        <p className="flex flex-wrap items-center gap-xs text-body-sm text-ink">
                            <Badge variant="neutral">معلّق: {formatInt(counts.pending)}</Badge>
                            <Badge variant="warning">فاشل: {formatInt(counts.failed)}</Badge>
                            <Badge variant="danger">ميت: {formatInt(counts.dead_letter)}</Badge>
                            <span className="text-muted">أقدم انتظار: {ageText(counts.oldest_pending_age_seconds)}</span>
                        </p>
                    ) : null}
                    {outboxQuery.isError ? (
                        <StateError
                            message={outboxQuery.error instanceof Error ? outboxQuery.error.message : 'تعذّرت قراءة صندوق الصادر'}
                            onRetry={() => {
                                void outboxQuery.refetch();
                            }}
                        />
                    ) : null}
                    {outboxQuery.isPending ? (
                        <div aria-busy="true">
                            <StateLoading label="جارٍ تحميل صفوف الصادر" />
                            <TableSkeleton rows={3} columns={5} />
                        </div>
                    ) : null}
                    {outboxQuery.isSuccess && deadRows.length === 0 ? (
                        <StateEmpty
                            title="لا صفوف في هذه الحالة"
                            hint={outboxStatus ? 'لا صفوف بهذه الحالة الآن — جرّب حالة أخرى من المرشّح.' : 'صندوق الصادر فارغ.'}
                        />
                    ) : null}
                    {deadRows.length ? (
                        <TableScroll label="صفوف صندوق الصادر الميتة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الوقت
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            المزوّد
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الحدث
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الحالة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            المحاولات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            آخر خطأ
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            إجراء
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {deadRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-body-sm text-muted">{dateText(row.created_at)}</td>
                                            <td className="px-sm py-xxs text-ink" dir="ltr">
                                                {row.provider_code || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-ink" dir="ltr">
                                                {row.event_type || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{outboxStatusLabel(row.status)}</td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {formatInt(row.attempts)}/{formatInt(row.max_attempts)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.last_error_code || '—'}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <div className="flex flex-wrap gap-xs">
                                                    {writable && outboxRetryable(row.status) ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            disabled={retryMutation.isPending}
                                                            onClick={() => retryMutation.mutate(row.id)}
                                                        >
                                                            إعادة
                                                        </Button>
                                                    ) : null}
                                                    {writable && outboxReviewable(row.status) ? (
                                                        <>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => openReview(row, 'retry')}
                                                            >
                                                                اعتماد إعادة
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                onClick={() => openReview(row, 'abandon')}
                                                            >
                                                                إلغاء
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                    {!writable ? <span className="text-caption text-muted">—</span> : null}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : null}
                </div>
            </Card>

            <Card className="mudad-section">
                <SectionHead title="آخر الأحداث" description="سجل المحاولات المنقّى — آخر 20 حدثًا." />
                <div className="flex flex-col gap-sm p-sm">
                    {eventsQuery.isError ? (
                        <StateError
                            message={eventsQuery.error instanceof Error ? eventsQuery.error.message : 'تعذّرت قراءة الأحداث'}
                            onRetry={() => {
                                void eventsQuery.refetch();
                            }}
                        />
                    ) : null}
                    {eventsQuery.isPending ? <TableSkeleton rows={3} columns={5} /> : null}
                    {eventsQuery.isSuccess && events.length === 0 ? (
                        <StateEmpty title="لا أحداث" hint="لم يسجّل التكامل أي حدث بعد." />
                    ) : null}
                    {events.length ? (
                        <TableScroll label="أحداث التكامل">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الوقت
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            المزوّد
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الاتجاه
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            النتيجة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الخطأ
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.map((event: IntegrationEvent) => (
                                        <tr key={event.id} className="border-b border-hairline">
                                            <td className="px-sm py-xxs text-body-sm text-muted">{dateText(event.occurred_at)}</td>
                                            <td className="px-sm py-xxs text-ink" dir="ltr">
                                                {event.provider_code || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{eventDirectionLabel(event.direction)}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{eventOutcomeLabel(event.outcome)}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {event.error_code || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : null}
                </div>
            </Card>

            <Dialog
                open={pendingToggle !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingToggle(null);
                    }
                }}
                title={pendingToggle?.enabled ? 'تفعيل المزوّد' : 'تعطيل المزوّد'}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPendingToggle(null)}>
                            إلغاء
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            loading={toggleMutation.isPending}
                            onClick={() => {
                                if (pendingToggle) {
                                    toggleMutation.mutate(pendingToggle);
                                }
                            }}
                        >
                            تأكيد
                        </Button>
                    </>
                }
            >
                <p className="text-body-md text-ink">
                    {pendingToggle
                        ? `${pendingToggle.enabled ? 'تفعيل' : 'تعطيل'} «${pendingToggle.provider.name_ar ?? pendingToggle.provider.code}»؟`
                        : ''}
                </p>
            </Dialog>

            <Dialog
                open={review !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setReview(null);
                        setReason('');
                        setReviewError('');
                    }
                }}
                title={review?.decision === 'abandon' ? 'إلغاء المحاولة نهائيًا' : 'اعتماد إعادة الإرسال'}
                size="md"
                footer={
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setReview(null);
                                setReason('');
                                setReviewError('');
                            }}
                        >
                            إلغاء
                        </Button>
                        <Button type="button" size="sm" loading={reviewMutation.isPending} onClick={() => void submitReview()}>
                            تأكيد المراجعة
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <p className="text-body-md text-ink">
                        {review?.decision === 'abandon'
                            ? `صف الصادر #${review.row.id} لن يُرسل مرة أخرى.`
                            : `سيُنشأ صف إعادة إرسال جديد من الصف #${review?.row.id ?? ''}.`}
                    </p>
                    <Input label="سبب المراجعة" name="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                    {reviewError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {reviewError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
