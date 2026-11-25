import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAuthState } from '../../lib/auth';
import { formatBytes, type ResetResult } from '../../lib/settings';
import {
    clearAppState,
    downloadJson,
    EXPORT_ENTITIES,
    type ExportProgress,
    exportAllData,
    fetchAppState,
    resetAllSystem,
    settingsWriteVisible,
} from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { useToast } from '../../ui/Toast';
import { QueryBoundary, SectionCard } from './shared';

/**
 * التصدير والتصفير — نظير V2: تصدير JSON لكل الكيانات، مسح بيانات الحالة
 * (`DELETE /api/state`)، والتصفير الكامل للمستودع بعبارة تأكيد مكتوبة وسبب
 * إلزامي — كلها admin.
 */

const RESET_PHRASE = 'CONFIRM PRODUCTION RESET';

export function MaintenanceSection() {
    const auth = useAuthState();
    const canUse = settingsWriteVisible(auth.user?.role);
    const confirm = useConfirm();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [exportError, setExportError] = useState('');

    const [resetOpen, setResetOpen] = useState(false);
    const [resetPhrase, setResetPhrase] = useState('');
    const [resetReason, setResetReason] = useState('');
    const [resetForce, setResetForce] = useState(false);
    const [resetError, setResetError] = useState('');

    const stateQuery = useQuery({
        queryKey: ['settings', 'app-state'],
        queryFn: () => fetchAppState(),
        refetchOnWindowFocus: false,
        enabled: canUse,
    });

    const stateGroups =
        stateQuery.data && typeof stateQuery.data === 'object' && !Array.isArray(stateQuery.data)
            ? Object.keys(stateQuery.data as Record<string, unknown>).length
            : 0;
    const stateBytes = stateQuery.data === undefined ? 0 : JSON.stringify(stateQuery.data).length;

    const clearState = useWriteMutation<void, void>({
        mutationFn: () => clearAppState(),
        successTitle: 'تم مسح بيانات الحالة',
        silentError: true,
        onSuccess: async () => {
            await queryClient.invalidateQueries();
        },
        onError: (cause) => {
            toast({ variant: 'error', title: 'تعذّر مسح بيانات الحالة', description: writeErrorMessage(cause) });
        },
    });

    const reset = useWriteMutation<{ reason: string; force: boolean }, ResetResult>({
        mutationFn: (vars) => resetAllSystem(vars.reason, vars.force),
        invalidate: [],
        silentError: true,
        onSuccess: async (result) => {
            toast({
                variant: 'success',
                title: 'تم تصفير المستودع',
                ...(result.resetNumber ? { description: `رقم التصفير ${result.resetNumber}` } : {}),
            });
            closeReset();
            await queryClient.invalidateQueries();
        },
        onError: (cause) => {
            setResetError(writeErrorMessage(cause, 'تعذّر التصفير'));
        },
    });

    async function runExport(): Promise<void> {
        if (exporting) {
            return;
        }
        setExporting(true);
        setExportError('');
        setProgress(null);
        try {
            const bundle = await exportAllData(setProgress);
            const total = Object.values(bundle.totals).reduce((sum, count) => sum + count, 0);
            const stamp = bundle.exportDate.slice(0, 10);
            downloadJson(`karim-erp-export-${stamp}.json`, bundle);
            toast({ variant: 'success', title: 'تم تجهيز التصدير', description: `${total.toLocaleString('en-US')} صفًا` });
        } catch (cause) {
            setExportError(writeErrorMessage(cause, 'تعذّر التصدير'));
        } finally {
            setExporting(false);
            setProgress(null);
        }
    }

    function closeReset(): void {
        setResetOpen(false);
        setResetPhrase('');
        setResetReason('');
        setResetForce(false);
        setResetError('');
    }

    const phraseOk = resetPhrase.trim() === RESET_PHRASE;
    const reasonOk = resetReason.trim().length >= 10;

    if (!canUse) {
        return null;
    }

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="تصدير البيانات"
                english="JSON Export"
                badge={
                    <Badge variant="neutral" dot>
                        {EXPORT_ENTITIES.length} مجموعة
                    </Badge>
                }
                actions={
                    <Button variant="secondary" size="sm" loading={exporting} onClick={() => void runExport()}>
                        تصدير JSON
                    </Button>
                }
            >
                <p className="text-body-sm text-muted">
                    {exporting && progress
                        ? `جارٍ التصدير: ${progress.entity} (${String(progress.index)}/${String(progress.total)}) — ${progress.rows.toLocaleString('en-US')} صفًا`
                        : 'كل مجموعات البيانات في ملف واحد قابل للاستيراد.'}
                </p>
                {exportError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {exportError}
                    </p>
                ) : null}
            </SectionCard>

            <SectionCard
                title="بيانات الحالة"
                english="Application State"
                badge={
                    <Badge variant={stateGroups > 0 ? 'warning' : 'neutral'} dot>
                        {stateGroups > 0 ? `${String(stateGroups)} مجموعة` : 'فارغة'}
                    </Badge>
                }
                actions={
                    <Button
                        variant="danger"
                        size="sm"
                        loading={clearState.isPending}
                        disabled={stateGroups === 0}
                        onClick={() => {
                            void (async () => {
                                const ok = await confirm('مسح بيانات الحالة (الدفاتر والأرصدة المؤقتة) نهائيًا؟', {
                                    title: 'مسح بيانات الحالة',
                                    confirmLabel: 'مسح',
                                });
                                if (ok) {
                                    clearState.mutate();
                                }
                            })();
                        }}
                    >
                        مسح بيانات الحالة
                    </Button>
                }
            >
                <QueryBoundary pending={stateQuery.isPending} error={stateQuery.error} onRetry={() => void stateQuery.refetch()}>
                    <p className="text-body-sm text-muted" dir="ltr">
                        {stateGroups} groups — {formatBytes(stateBytes)}
                    </p>
                </QueryBoundary>
            </SectionCard>

            <SectionCard
                title="تصفير المستودع"
                english="Production Reset"
                badge={
                    <Badge variant="danger" dot>
                        إجراء نهائي
                    </Badge>
                }
                actions={
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                            setResetOpen(true);
                            setResetError('');
                        }}
                    >
                        تصفير كامل
                    </Button>
                }
            >
                <p className="text-body-sm text-muted">يُفرّغ حركات المستودع والأرصدة ويُعيد الترقيم — البيانات المالية والفواتير تبقى.</p>
            </SectionCard>

            <Dialog
                open={resetOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        closeReset();
                    }
                }}
                title="تصفير المستودع"
                description="أدخل العبارة والسبب لتفعيل التصفير"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={closeReset} disabled={reset.isPending}>
                            إلغاء
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            loading={reset.isPending}
                            disabled={!phraseOk || !reasonOk}
                            onClick={() => {
                                setResetError('');
                                reset.mutate({ reason: resetReason.trim(), force: resetForce });
                            }}
                        >
                            تنفيذ التصفير
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-md">
                    <Input
                        label={`اكتب ${RESET_PHRASE} للتأكيد`}
                        dir="ltr"
                        autoComplete="off"
                        value={resetPhrase}
                        onChange={(event) => setResetPhrase(event.target.value)}
                        {...(resetPhrase.length > 0 && !phraseOk ? { error: 'العبارة غير مطابقة' } : {})}
                    />
                    <Textarea
                        label="السبب (10 أحرف على الأقل)"
                        rows={3}
                        value={resetReason}
                        onChange={(event) => setResetReason(event.target.value)}
                        {...(resetReason.length > 0 && !reasonOk ? { error: 'اكتب سببًا لا يقل عن 10 أحرف' } : {})}
                    />
                    <Checkbox
                        label="تصفير قسري حتى مع وجود حركات معلّقة"
                        checked={resetForce}
                        onCheckedChange={(checked) => setResetForce(checked === true)}
                    />
                    {resetError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {resetError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </div>
    );
}
