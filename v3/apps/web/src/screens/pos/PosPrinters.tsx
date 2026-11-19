import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
    autoLinkPosPrinter,
    discoverPosPrinters,
    fetchPosPrinters,
    type PosLocalPrintQueue,
    type PosNetworkPrinter,
    type PosPrinter,
    type PosPrinterDiscovery,
    probePosPrinter,
} from '../../lib/pos';
import { errorMessage } from '../../lib/reporting';
import { Badge, Button, Dialog, useToast } from '../../ui';

export interface PosPrintersProps {
    open: boolean;
    departmentId: string;
    onClose: () => void;
}

function statusTone(online: boolean | null | undefined): 'success' | 'danger' {
    return online ? 'success' : 'danger';
}

function printerLabel(printer: PosPrinter): string {
    return printer.name || printer.address || printer.id;
}

function connectionLabel(type: string | null | undefined): string {
    return (
        (
            {
                network: 'شبكة',
                windows_share: 'مشاركة ويندوز',
                windows_local: 'طابعة ويندوز محلية',
                usb: 'USB',
            } as Record<string, string>
        )[String(type ?? '')] ?? String(type ?? '—')
    );
}

/**
 * لوحة الطابعة الحرارية داخل الكاشير.
 *
 * الخادم هو من يكتشف: طوابير الطباعة المثبتة على ويندوز (USB) وطابعات الشبكة
 * على منفذ 9100. الربط التلقائي يسجّل أفضل طابعة إيصالات بالقسم الحالي، فيصبح
 * كل بيع جديد في طابور الطباعة ويخرج من نفسه بلا نافذة متصفح.
 */
export function PosPrinters({ open, departmentId, onClose }: PosPrintersProps) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [discovery, setDiscovery] = useState<PosPrinterDiscovery | null>(null);
    const [discovering, setDiscovering] = useState(false);
    const [busyId, setBusyId] = useState('');
    const [note, setNote] = useState('');

    const printersQuery = useQuery({
        queryKey: ['pos-printers'],
        queryFn: ({ signal }) => fetchPosPrinters(signal),
        enabled: open,
        staleTime: 15_000,
        retry: 0,
    });

    const registered = printersQuery.data ?? discovery?.registered ?? [];
    const targetId = departmentId ? `pos-${String(departmentId)}` : '';
    const target = registered.find((printer) => printer.id === targetId) ?? null;
    const receiptPrinters = registered.filter((printer) => (printer.kind ?? '').startsWith('receipt') || !printer.kind);

    const runDiscovery = useCallback(
        async (scan: boolean): Promise<void> => {
            setDiscovering(true);
            setNote('');
            try {
                const result = await discoverPosPrinters(scan);
                setDiscovery(result);
                if (result.local_error) {
                    setNote(
                        `تعذّر سرد طابعات ويندوز (${result.local_error})؛ يمكنك ربط طابعة الشبكة بالعنوان أو تشغيل النظام كمسؤول.`,
                    );
                }
                queryClient.setQueryData(['pos-printers'], result.registered);
            } catch (error) {
                setNote(`تعذّر الاكتشاف: ${errorMessage(error)}`);
            } finally {
                setDiscovering(false);
            }
        },
        [queryClient],
    );

    // الاكتشاف يعمل مرة عند كل فتح — مسح الشبكة عند الطلب فقط.
    useEffect(() => {
        if (!open) {
            return;
        }
        void runDiscovery(false);
    }, [open, runDiscovery]);

    async function link(address: string, connectionType: 'network' | 'windows_share' | 'windows_local', name: string) {
        setBusyId(address);
        setNote('');
        try {
            const result = await autoLinkPosPrinter({
                departmentId: departmentId || null,
                kind: 'receipt',
                address,
                connectionType,
                name,
            });
            toast({ title: result.note || 'تم ربط الطابعة.', variant: result.probe?.reachable ? 'success' : 'info' });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pos-printers'] }),
                queryClient.invalidateQueries({ queryKey: ['pos-active-shift'] }),
            ]);
            await runDiscovery(false);
        } catch (error) {
            setNote(`تعذّر ربط الطابعة: ${errorMessage(error)}`);
        } finally {
            setBusyId('');
        }
    }

    async function autoLink() {
        setBusyId('auto');
        setNote('');
        try {
            const result = await autoLinkPosPrinter({ departmentId: departmentId || null, kind: 'receipt' });
            toast({
                title: result.note || 'تم ربط الطابعة تلقائيًا.',
                variant: result.probe?.reachable ? 'success' : 'info',
            });
            await queryClient.invalidateQueries({ queryKey: ['pos-printers'] });
            await runDiscovery(false);
        } catch (error) {
            setNote(errorMessage(error));
        } finally {
            setBusyId('');
        }
    }

    async function probe(printer: PosPrinter) {
        setBusyId(`probe-${printer.id}`);
        try {
            const result = await probePosPrinter(printer.id);
            toast({
                title: result.reachable
                    ? `${printerLabel(printer)} متصلة${result.latency_ms ? ` — ${String(result.latency_ms)}ms` : ''}.`
                    : `تعذّر الوصول إلى ${printerLabel(printer)}.`,
                variant: result.reachable ? 'success' : 'error',
            });
            await queryClient.invalidateQueries({ queryKey: ['pos-printers'] });
        } catch (error) {
            setNote(`تعذّر فحص الطابعة: ${errorMessage(error)}`);
        } finally {
            setBusyId('');
        }
    }

    const localQueues: PosLocalPrintQueue[] = discovery?.local ?? [];
    const networkPrinters: PosNetworkPrinter[] = discovery?.network ?? [];

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title="الطابعة الحرارية"
            description="اكتشاف تلقائي لطابعة الكاشير وربطها بمهام الإيصالات — ESC/POS 80mm."
            size="md"
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        إغلاق
                    </Button>
                    <Button
                        size="sm"
                        loading={busyId === 'auto'}
                        disabled={discovering}
                        onClick={() => void autoLink()}
                    >
                        ربط تلقائي
                    </Button>
                </>
            }
        >
            <div className="pos-printers">
                <div className="pos-printer-status">
                    <span
                        className={`pos-printer-status__dot${target?.is_online ? ' is-on' : ''}`}
                        aria-hidden="true"
                    />
                    <div className="pos-printer-status__copy">
                        <strong>{target ? printerLabel(target) : 'لا طابعة مرتبطة بهذا القسم'}</strong>
                        <small>
                            {target
                                ? `${connectionLabel(target.connection_type)} · ${target.address || '—'} · معرف ${target.id}`
                                : 'كل بيع سيُضاف إلى طابور الطباعة، لكن لن يخرج إيصال حتى تُربط طابعة.'}
                        </small>
                    </div>
                    {target ? (
                        <Badge variant={statusTone(target.is_online)}>{target.is_online ? 'متصلة' : 'غير متصلة'}</Badge>
                    ) : (
                        <Badge variant="warning">غير مربوطة</Badge>
                    )}
                </div>

                {note ? (
                    <p className="pos-printers__note" role="status">
                        {note}
                    </p>
                ) : null}

                <div className="pos-printers__head">
                    <strong>طابعات هذا الجهاز</strong>
                    <Button size="sm" variant="ghost" loading={discovering} onClick={() => void runDiscovery(true)}>
                        مسح الشبكة
                    </Button>
                </div>

                {discovering && !discovery ? (
                    <p className="text-body-sm text-muted">جارٍ قراءة طوابير الطباعة…</p>
                ) : null}

                {localQueues.length ? (
                    <ul className="pos-printers__list">
                        {localQueues.map((queue) => (
                            <li key={queue.name} className="pos-printer-row">
                                <div className="pos-printer-row__copy">
                                    <strong>{queue.name}</strong>
                                    <small>
                                        {queue.driver || 'سائق غير معروف'}
                                        {queue.is_default ? ' · الافتراضية في ويندوز' : ''}
                                        {queue.thermal ? ' · حرارية' : ''}
                                    </small>
                                </div>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={busyId === queue.name}
                                    disabled={Boolean(busyId) || !queue.name}
                                    onClick={() => {
                                        void link(queue.name, 'windows_local', queue.name);
                                    }}
                                >
                                    ربط
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-body-sm text-muted">
                        لا توجد طابعات مرئية من الخادم. وصّل الطابعة USB وثبّت سائقها في ويندوز ثم أعد المحاولة.
                    </p>
                )}

                {networkPrinters.length ? (
                    <>
                        <div className="pos-printers__head">
                            <strong>طابعات الشبكة</strong>
                            <small className="text-muted">
                                {discovery?.subnet ? `${discovery.subnet} على المنفذ 9100` : ''}
                            </small>
                        </div>
                        <ul className="pos-printers__list">
                            {networkPrinters.map((candidate) => {
                                const address =
                                    candidate.address || `${candidate.ip ?? ''}:${String(candidate.port ?? 9100)}`;
                                return (
                                    <li key={address} className="pos-printer-row">
                                        <div className="pos-printer-row__copy">
                                            <strong dir="ltr">{address}</strong>
                                            <small>
                                                {candidate.latency_ms ? `${String(candidate.latency_ms)}ms` : 'متصلة'}
                                            </small>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            loading={busyId === address}
                                            disabled={Boolean(busyId)}
                                            onClick={() => {
                                                void link(address, 'network', `طابعة ${candidate.ip ?? ''}`.trim());
                                            }}
                                        >
                                            ربط
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                ) : null}

                <section className="pos-printers__registered">
                    <strong>المسجّلة في النظام</strong>
                    {printersQuery.isError ? (
                        <p className="text-body-sm text-danger" role="alert">
                            {errorMessage(printersQuery.error)}
                        </p>
                    ) : null}
                    {receiptPrinters.length ? (
                        <ul className="pos-printers__list">
                            {receiptPrinters.map((printer) => (
                                <li key={printer.id} className="pos-printer-row">
                                    <div className="pos-printer-row__copy">
                                        <strong>
                                            {printerLabel(printer)}{' '}
                                            {printer.id === targetId ? <Badge variant="info">هذا القسم</Badge> : null}
                                        </strong>
                                        <small>
                                            {connectionLabel(printer.connection_type)} ·{' '}
                                            <span dir="ltr">{printer.address}</span>
                                        </small>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        loading={busyId === `probe-${printer.id}`}
                                        disabled={Boolean(busyId)}
                                        onClick={() => {
                                            void probe(printer);
                                        }}
                                    >
                                        فحص
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-body-sm text-muted">لا طابعات مسجلة بعد.</p>
                    )}
                </section>

                <p className="pos-printers__hint">
                    الطابعة المحلية تُرسل إليها ESC/POS خام عبر طابور ويندوز، فلا حاجة لمشاركة الشبكة. تحتاج إلى عامل
                    الطباعة <code dir="ltr">npm run print-worker</code> ليخرج الإيصال تلقائيًا بعد كل بيع.
                </p>
            </div>
        </Dialog>
    );
}
