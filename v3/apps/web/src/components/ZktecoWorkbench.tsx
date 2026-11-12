import { useState } from 'react';
import { useAuthState } from '../lib/auth';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import type { ZkDeviceRow } from '../lib/zkteco';
import {
    canControlZk,
    canWriteZk,
    createZkDevice,
    deleteZkDevice,
    emptyZkDeviceForm,
    syncZkDevice,
    testZkDevice,
    updateZkDevice,
    validateZkDeviceForm,
    ZK_ENGINE_ACTIONS,
    ZK_WRITE_TEXT,
    type ZkDeviceField,
    type ZkDeviceForm,
    type ZkEngineAction,
    zkEngineAction,
    zkEngineReasonError,
} from '../lib/zkteco-write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';

/**
 * إدارة أجهزة البصمة: إضافة/تعديل/حذف، فحص الاتصال، المزامنة الفورية،
 * والتحكم في محرك المزامنة بسببٍ إلزامي. كلها تمرّ على بوابات الخادم نفسها
 * (`admin|hr` للكتابة، `admin|owner` للتحكم).
 */

interface ZktecoWorkbenchProps {
    devices: readonly ZkDeviceRow[];
    running: boolean;
}

export function ZktecoWorkbench({ devices, running }: ZktecoWorkbenchProps) {
    const auth = useAuthState();
    const writable = canWriteZk(auth.user?.role);
    const controllable = canControlZk(auth.user?.role);
    const confirm = useConfirm();
    const { toast } = useToast();

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ZkDeviceRow | null>(null);
    const [form, setForm] = useState<ZkDeviceForm>(emptyZkDeviceForm);
    const [formError, setFormError] = useState<{ field?: ZkDeviceField; message: string } | null>(null);

    const [engineOpen, setEngineOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [engineError, setEngineError] = useState('');

    const saveMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const errors = validateZkDeviceForm(form);
            if (errors.length > 0) {
                throw new Error(errors[0]?.message ?? ZK_WRITE_TEXT.saveFailed);
            }
            if (editing) {
                await updateZkDevice(editing.id, form);
            } else {
                await createZkDevice(form);
            }
        },
        successTitle: editing ? ZK_WRITE_TEXT.updated : ZK_WRITE_TEXT.created,
        invalidate: [['zkteco', 'status']],
        silentError: true,
        onError: (cause) => {
            setFormError({ message: writeErrorMessage(cause, ZK_WRITE_TEXT.saveFailed) });
        },
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const deleteMutation = useWriteMutation<ZkDeviceRow, void>({
        mutationFn: async (device) => {
            await deleteZkDevice(device.id);
        },
        successTitle: ZK_WRITE_TEXT.deleted,
        invalidate: [['zkteco', 'status']],
    });

    const testMutation = useWriteMutation<string, void>({
        mutationFn: async (id) => {
            const result = await testZkDevice(id);
            toast({ title: 'تم فحص الاتصال', description: result.message, variant: 'success' });
        },
        invalidate: [['zkteco', 'status']],
    });

    const syncMutation = useWriteMutation<string, void>({
        mutationFn: async (id) => {
            const result = await syncZkDevice(id);
            toast({ title: 'تمت المزامنة', description: result.message, variant: 'success' });
        },
        invalidate: [['zkteco', 'status']],
    });

    const engineMutation = useWriteMutation<ZkEngineAction, void>({
        mutationFn: async (action) => {
            const error = zkEngineReasonError(reason);
            if (error) {
                throw new Error(error);
            }
            const result = await zkEngineAction(action, reason);
            toast({
                title: ZK_WRITE_TEXT.engineDone,
                description: result.message || (result.running ? 'المحرك يعمل' : 'المحرك متوقف'),
                variant: 'success',
            });
        },
        invalidate: [['zkteco', 'status']],
        silentError: true,
        onError: (cause) => setEngineError(writeErrorMessage(cause, ZK_WRITE_TEXT.engineFailed)),
        onSuccess: () => {
            setEngineOpen(false);
            setReason('');
            setEngineError('');
        },
    });

    if (!writable && !controllable) {
        return null;
    }

    function openAdd(): void {
        setEditing(null);
        setForm(emptyZkDeviceForm());
        setFormError(null);
        setFormOpen(true);
    }

    function openEdit(device: ZkDeviceRow): void {
        setEditing(device);
        setForm({
            name: device.name,
            ipAddress: device.ip,
            port: device.port || '4370',
            commKey: '',
            syncIntervalSeconds: '30',
            enabled: device.enabled,
        });
        setFormError(null);
        setFormOpen(true);
    }

    async function handleDelete(device: ZkDeviceRow): Promise<void> {
        const answer = await confirm(ZK_WRITE_TEXT.deleteConfirm(device.name));
        if (!answer) {
            return;
        }
        deleteMutation.mutate(device);
    }

    const errorProps = (field: ZkDeviceField): { error?: string } => {
        const message = formError?.field === field ? formError.message : undefined;
        return message === undefined ? {} : { error: message };
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                {writable ? (
                    <Button type="button" size="sm" onClick={openAdd}>
                        {ZK_WRITE_TEXT.add}
                    </Button>
                ) : null}
                {controllable ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            setEngineError('');
                            setEngineOpen(true);
                        }}
                    >
                        {running ? ZK_WRITE_TEXT.stop : ZK_WRITE_TEXT.start}
                    </Button>
                ) : null}
            </div>

            {writable && devices.length > 0 ? (
                <section aria-label="إدارة أجهزة البصمة" className="rounded-lg border border-hairline bg-surface p-sm" data-erp-print-hide>
                    <h2 className="text-heading-sm text-ink">إدارة الأجهزة</h2>
                    <ul className="mt-xs flex flex-col gap-xs">
                        {devices.map((device) => (
                            <li
                                key={device.id}
                                className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline pb-xs last:border-0 last:pb-0"
                            >
                                <span className="text-body-md text-ink">
                                    {device.name}
                                    <small className="erp-numeric ms-xs text-caption text-muted" dir="ltr">
                                        {device.ip ? `${device.ip}:${device.port}` : '—'}
                                    </small>
                                </span>
                                <span className="flex flex-wrap items-center gap-xxs">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={testMutation.isPending}
                                        onClick={() => testMutation.mutate(device.id)}
                                    >
                                        {ZK_WRITE_TEXT.test}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={syncMutation.isPending}
                                        onClick={() => syncMutation.mutate(device.id)}
                                    >
                                        {ZK_WRITE_TEXT.sync}
                                    </Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(device)}>
                                        {ZK_WRITE_TEXT.edit}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="danger"
                                        disabled={deleteMutation.isPending}
                                        onClick={() => void handleDelete(device)}
                                    >
                                        {ZK_WRITE_TEXT.delete}
                                    </Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <Dialog
                open={formOpen}
                onOpenChange={(next) => {
                    if (!next && saveMutation.isPending) {
                        return;
                    }
                    setFormOpen(next);
                }}
                title={editing ? ZK_WRITE_TEXT.editTitle : ZK_WRITE_TEXT.addTitle}
                size="md"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setFormOpen(false)}>
                            {ZK_WRITE_TEXT.cancel}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={saveMutation.isPending}
                            onClick={() => {
                                setFormError(null);
                                saveMutation.mutate();
                            }}
                        >
                            {saveMutation.isPending ? 'جارٍ الحفظ…' : ZK_WRITE_TEXT.save}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Input
                        label={ZK_WRITE_TEXT.name}
                        value={form.name}
                        maxLength={100}
                        required
                        requiredMark
                        {...errorProps('name')}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                    <Input
                        label={ZK_WRITE_TEXT.ip}
                        value={form.ipAddress}
                        dir="ltr"
                        placeholder="192.168.1.201"
                        required
                        requiredMark
                        {...errorProps('ipAddress')}
                        onChange={(event) => setForm({ ...form, ipAddress: event.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-sm">
                        <Input
                            label={ZK_WRITE_TEXT.port}
                            type="number"
                            min={1}
                            max={65535}
                            value={form.port}
                            {...errorProps('port')}
                            onChange={(event) => setForm({ ...form, port: event.target.value })}
                        />
                        <Input
                            label={ZK_WRITE_TEXT.commKey}
                            type="number"
                            min={0}
                            max={65535}
                            value={form.commKey}
                            hint={editing ? 'اتركه فارغًا للإبقاء على المفتاح الحالي' : '0 إن لم يكن للجهاز مفتاح'}
                            {...errorProps('commKey')}
                            onChange={(event) => setForm({ ...form, commKey: event.target.value })}
                        />
                    </div>
                    <Input
                        label={ZK_WRITE_TEXT.syncInterval}
                        type="number"
                        min={5}
                        max={86400}
                        value={form.syncIntervalSeconds}
                        {...errorProps('syncIntervalSeconds')}
                        onChange={(event) => setForm({ ...form, syncIntervalSeconds: event.target.value })}
                    />
                    <label className="flex items-center gap-xs text-body-md text-ink">
                        <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                        />
                        {ZK_WRITE_TEXT.enabled}
                    </label>
                    {formError && formError.field === undefined ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {formError.message}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            {controllable ? (
                <Dialog
                    open={engineOpen}
                    onOpenChange={setEngineOpen}
                    title={ZK_WRITE_TEXT.engineTitle}
                    description={ZK_WRITE_TEXT.engineHint}
                    size="sm"
                    footer={
                        <>
                            <Button type="button" variant="secondary" size="sm" onClick={() => setEngineOpen(false)}>
                                {ZK_WRITE_TEXT.cancel}
                            </Button>
                            {ZK_ENGINE_ACTIONS.map((action) => (
                                <Button
                                    key={action}
                                    type="button"
                                    size="sm"
                                    variant={action === 'stop' ? 'danger' : 'secondary'}
                                    disabled={engineMutation.isPending}
                                    onClick={() => {
                                        setEngineError('');
                                        engineMutation.mutate(action);
                                    }}
                                >
                                    {action === 'start'
                                        ? ZK_WRITE_TEXT.start
                                        : action === 'stop'
                                          ? ZK_WRITE_TEXT.stop
                                          : ZK_WRITE_TEXT.restart}
                                </Button>
                            ))}
                        </>
                    }
                >
                    <div className="flex flex-col gap-sm">
                        <p className="text-body-sm text-muted">الحالة الآن: {running ? 'يعمل' : 'متوقف'}</p>
                        <Input
                            label={ZK_WRITE_TEXT.reason}
                            value={reason}
                            maxLength={200}
                            placeholder={ZK_WRITE_TEXT.reasonPlaceholder}
                            onChange={(event) => setReason(event.target.value)}
                        />
                        {engineError ? (
                            <p role="alert" className="text-body-sm text-danger-text">
                                {engineError}
                            </p>
                        ) : null}
                    </div>
                </Dialog>
            ) : null}
        </>
    );
}
