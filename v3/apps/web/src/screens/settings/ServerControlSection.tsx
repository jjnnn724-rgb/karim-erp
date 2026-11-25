import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider';
import { TableScroll } from '../../components/TableState';
import { useAuthState } from '../../lib/auth';
import {
    CONTROL_ACTIONS,
    type ControlAction,
    controlActionName,
    controlConfirmError,
    controlMaintenanceName,
    controlServiceStateName,
    controlUptimeText,
    fetchControlStatus,
    runControlAction,
} from '../../lib/server-control';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { useToast } from '../../ui/Toast';
import { formatNumber, formatStamp, SectionCard } from './shared';

/**
 * تحكم الخادم — نسخة V3 من مركز التحكم في V2: حالة خدمة ERP والخدمة المرافقة
 * وراية الصيانة، وأوامر تشغيل/إيقاف/إعادة تشغيل عبر البروكسي المحروس.
 * الإيقاف وإعادة التشغيل يتطلبان كتابة العبارة الحرفية، ولا تُنفَّذ إلا بنقر
 * صريح من مدير النظام — لا شيء يُشغَّل تلقائيًا من هذه الشاشة.
 */

function valueText(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    return String(value);
}

export function ServerControlSection() {
    const auth = useAuthState();
    const isAdmin = auth.user?.role === 'admin';
    const { toast } = useToast();
    const confirm = useConfirm();

    const statusQuery = useQuery({
        queryKey: ['settings', 'server-control'],
        queryFn: ({ signal }) => fetchControlStatus(signal),
        enabled: isAdmin,
        refetchOnWindowFocus: false,
    });

    const [action, setAction] = useState<ControlAction | null>(null);
    const [phrase, setPhrase] = useState('');
    const [actionError, setActionError] = useState('');

    const run = useWriteMutation<ControlAction, { message: string }>({
        mutationFn: async (next) => {
            const error = controlConfirmError(next, phrase);
            if (error) {
                throw new Error(error);
            }
            const result = await runControlAction(next, phrase);
            return { message: String(result.message ?? '') };
        },
        invalidate: [['settings', 'server-control']],
        silentError: true,
        onError: (cause) => setActionError(writeErrorMessage(cause, 'تعذّر تنفيذ الأمر')),
        onSuccess: (result, next) => {
            setAction(null);
            setPhrase('');
            setActionError('');
            toast({
                title: 'نُفّذ الأمر',
                description: result.message || controlActionName(next),
                variant: 'success',
            });
        },
    });

    if (!isAdmin) {
        return null;
    }

    const data = statusQuery.data;
    const available = data?.available === true;
    const actionsEnabled = data?.control?.actionsEnabled !== false && data?.control?.dryRun !== true;
    const erpHealthy = data?.erp?.healthy === true;
    const maintenance = data?.maintenance ?? null;
    const lastOperation = data?.lastOperation ?? null;
    const audit = data?.audit ?? [];

    const openAction = async (next: ControlAction): Promise<void> => {
        if (next === 'start') {
            const accepted = await confirm('تشغيل خدمة ERP؟ سيستغرق الإقلاع بعض الثواني.');
            if (!accepted) {
                return;
            }
            setActionError('');
            setPhrase('');
            setAction('start');
            return;
        }
        setActionError('');
        setPhrase('');
        setAction(next);
    };

    return (
        <SectionCard
            title="تحكم الخادم"
            english="Server Control"
            badge={
                available ? (
                    <Badge variant={erpHealthy ? 'success' : 'danger'} dot>
                        {erpHealthy ? 'ERP يعمل' : 'ERP لا يستجيب'}
                    </Badge>
                ) : (
                    <Badge variant="warning" dot>
                        غير متاح
                    </Badge>
                )
            }
            actions={
                <Button variant="ghost" size="sm" onClick={() => void statusQuery.refetch()}>
                    تحديث
                </Button>
            }
        >
            {statusQuery.isPending ? (
                <p className="text-body-sm text-muted" role="status">
                    جارٍ قراءة حالة الخادم…
                </p>
            ) : statusQuery.error ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {writeErrorMessage(statusQuery.error, 'تعذّرت قراءة حالة الخادم')}
                </p>
            ) : !available ? (
                <div className="flex flex-col gap-xs">
                    <p role="status" className="text-body-md text-warning-text">
                        {data?.message ?? 'خدمة التحكم غير متاحة.'}
                    </p>
                    {data?.controlUrl ? (
                        <p className="text-caption text-muted" dir="ltr">
                            {`لوحة التحكم المستقلة: ${data.controlUrl}`}
                        </p>
                    ) : null}
                </div>
            ) : (
                <div className="flex flex-col gap-sm">
                    <dl className="grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-md border border-hairline bg-surface p-sm">
                            <dt className="text-caption text-faint">خدمة ERP</dt>
                            <dd className="text-body-md text-ink">
                                {valueText(data?.erp?.status)}
                                {data?.erp?.latencyMs !== null && data?.erp?.latencyMs !== undefined ? (
                                    <span className="erp-numeric ms-xs text-caption text-muted" dir="ltr">
                                        {`${String(Math.round(Number(data.erp.latencyMs)))}ms`}
                                    </span>
                                ) : null}
                            </dd>
                        </div>
                        <div className="rounded-md border border-hairline bg-surface p-sm">
                            <dt className="text-caption text-faint">خدمة النظام (Windows)</dt>
                            <dd className="text-body-md text-ink">
                                {controlServiceStateName(data?.service?.state)}
                                {data?.service?.pid ? (
                                    <span className="erp-numeric ms-xs text-caption text-muted" dir="ltr">
                                        {`PID ${String(data.service.pid)}`}
                                    </span>
                                ) : null}
                            </dd>
                        </div>
                        <div className="rounded-md border border-hairline bg-surface p-sm">
                            <dt className="text-caption text-faint">خدمة التحكم</dt>
                            <dd className="text-body-md text-ink">
                                {`v${valueText(data?.control?.version)} · ${controlUptimeText(data?.control?.uptimeSec)}`}
                            </dd>
                        </div>
                        <div className="rounded-md border border-hairline bg-surface p-sm">
                            <dt className="text-caption text-faint">أوامر الخادم</dt>
                            <dd className="text-body-md">
                                {actionsEnabled ? (
                                    <span className="text-success-text">متاحة</span>
                                ) : (
                                    <span className="text-warning-text">معطّلة في وضع المعاينة</span>
                                )}
                            </dd>
                        </div>
                    </dl>

                    {maintenance ? (
                        <p className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text" role="status">
                            {`راية الصيانة: ${controlMaintenanceName(maintenance.state)}${maintenance.by ? ` — بواسطة ${String(maintenance.by)}` : ''}${maintenance.reason ? ` · ${String(maintenance.reason)}` : ''}`}
                        </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                        {CONTROL_ACTIONS.map((next) => (
                            <Button
                                key={next}
                                type="button"
                                size="sm"
                                variant={next === 'start' ? 'secondary' : 'danger'}
                                disabled={!actionsEnabled || run.isPending}
                                onClick={() => {
                                    void openAction(next);
                                }}
                            >
                                {controlActionName(next)}
                            </Button>
                        ))}
                        <span className="text-caption text-muted">4 أوامر كحد أقصى كل دقيقتين.</span>
                    </div>

                    {lastOperation ? (
                        <p className="text-body-sm text-muted" role="status">
                            {`آخر عملية: ${valueText(lastOperation.action)} · ${valueText(lastOperation.state)} · ${valueText(lastOperation.actor)} · ${formatStamp(valueText(lastOperation.finishedAt ?? lastOperation.startedAt))}`}
                            {lastOperation.error ? ` · ${String(lastOperation.error)}` : ''}
                        </p>
                    ) : null}

                    {audit.length > 0 ? (
                        <TableScroll label="سجل أوامر الخادم">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الوقت
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الإجراء
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المنفّذ
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            النتيجة
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {audit.slice(0, 8).map((row, index) => (
                                        <tr key={String(row.id ?? index)} className="border-b border-hairline">
                                            <td className="erp-numeric px-sm py-xxs text-caption text-faint" dir="ltr">
                                                {formatStamp(String(row.at ?? row.createdAt ?? ''))}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{valueText(row.action)}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{valueText(row.actor)}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{valueText(row.result)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : null}

                    <p className="text-caption text-faint" role="status">
                        {`آخر قراءة: ${formatStamp(valueText(data?.serverTime))} · ${formatNumber(audit.length)} إجراءً حديثًا`}
                    </p>
                </div>
            )}

            <Dialog
                open={action !== null}
                onOpenChange={(next) => {
                    if (!next && run.isPending) {
                        return;
                    }
                    if (!next) {
                        setAction(null);
                    }
                }}
                title={action ? controlActionName(action) : ''}
                description="هذه العملية تمس خدمة ERP الحيّة على السيرفر."
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setAction(null)}>
                            إغلاق
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={run.isPending}
                            onClick={() => {
                                if (action) {
                                    setActionError('');
                                    run.mutate(action);
                                }
                            }}
                        >
                            {run.isPending ? 'جارٍ التنفيذ…' : action ? controlActionName(action) : 'تنفيذ'}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <p className="text-body-sm text-muted">
                        {action === 'stop'
                            ? 'سيُقطع ERP عن المستخدمين حتى يُشغَّل يدويًا. اكتب العبارة للتأكيد.'
                            : 'ستُعاد خدمة ERP — ستنقطع الجلسات لثوانٍ. اكتب العبارة للتأكيد.'}
                    </p>
                    <Input
                        label={`اكتب ${action === 'stop' ? 'STOP' : 'RESTART'}`}
                        value={phrase}
                        dir="ltr"
                        placeholder={action === 'stop' ? 'STOP' : 'RESTART'}
                        onChange={(event) => setPhrase(event.target.value)}
                    />
                    {actionError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {actionError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </SectionCard>
    );
}
