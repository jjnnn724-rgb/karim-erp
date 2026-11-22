import { type FormEvent, useState } from 'react';
import type { Dispatch } from '../lib/dispatches';
import {
    DISPATCH_TEXT,
    type ReceiveDraft,
    type ReceivedItemPayload,
    type SignedDecision,
    decisionSignatureError,
    dispatchItemLines,
    receiveDraftError,
    receiveSourceItems,
    receivedItemsPayload,
} from '../lib/dispatches-write';
import { writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { SignaturePad } from '../ui/SignaturePad';
import { Textarea } from '../ui/Textarea';

const FORM_ID = 'erp-dispatch-receive-form';

interface ReceiveRow extends ReceiveDraft {
    readonly name: string;
    readonly approvedQty: number;
    readonly catchWeight: boolean;
    readonly approvedPackagingQty: number;
    readonly receivedQty: string;
    readonly receivedPackagingQty: string;
}

export type DispatchReceiveBody = {
    items: ReceivedItemPayload[];
    notes: string;
} & SignedDecision;

/**
 * استلام إذن الصرف — نسخة لوحة رئيس القسم.
 *
 * نفس عقد الخادم ونفس دوال التحقق في `dispatches-write`، بلا نسخ منطق:
 * الكميات المعتمدة تُعرض للمراجعة، والتوقيع باسم حساب الجلسة فقط،
 * وإرسال واحد لا يتكرر أثناء الانتظار.
 */
export function DispatchReceiveDialog({
    dispatch,
    signerName,
    pending,
    onClose,
    onSubmit,
}: {
    dispatch: Dispatch;
    signerName: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (body: DispatchReceiveBody) => Promise<unknown>;
}) {
    const lines = dispatchItemLines(receiveSourceItems(dispatch), { approved: true });
    const [rows, setRows] = useState<ReceiveRow[]>(() =>
        lines.map((line) => ({
            name: line.name,
            approvedQty: line.qty,
            catchWeight: line.catchWeight,
            approvedPackagingQty: line.packagingQty,
            receivedQty: String(line.qty),
            receivedPackagingQty: line.catchWeight ? String(line.packagingQty) : '',
        })),
    );
    const [notes, setNotes] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setError] = useState('');

    function update(index: number, field: 'receivedQty' | 'receivedPackagingQty', value: string): void {
        setRows((previous) => previous.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
    }

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        const message = receiveDraftError(rows) || decisionSignatureError(signature, signerName);
        if (message) {
            setError(message);
            return;
        }
        setError('');
        try {
            await onSubmit({
                items: receivedItemsPayload(rows),
                notes,
                signatureData: signature ?? '',
                signerName,
            });
        } catch (cause) {
            setError(writeErrorMessage(cause, DISPATCH_TEXT.receiveFailed));
        }
    }

    const dept = String(dispatch.deptName ?? dispatch.deptCode ?? '—');

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={`استلام إذن الصرف #${dispatch.id} — ${dept}`}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        إلغاء
                    </Button>
                    <Button type="submit" form={FORM_ID} size="sm" loading={pending}>
                        تأكيد الاستلام والتوقيع
                    </Button>
                </>
            }
        >
            <form id={FORM_ID} onSubmit={(event) => void submit(event)} className="flex flex-col gap-md">
                <dl className="grid grid-cols-2 gap-xs rounded-md border border-hairline bg-surface-sunken p-sm sm:grid-cols-3">
                    <div>
                        <dt className="text-label-md text-muted">رقم الإذن</dt>
                        <dd className="erp-numeric text-body-md text-ink" dir="ltr">
                            DIS-{dispatch.id}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-label-md text-muted">التاريخ</dt>
                        <dd className="erp-numeric text-body-md text-ink" dir="ltr">
                            {String(dispatch.date ?? '—').slice(0, 10)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-label-md text-muted">القسم</dt>
                        <dd className="text-body-md text-ink">{dept}</dd>
                    </div>
                </dl>

                <p className="rounded-md border border-info/40 bg-info-soft p-sm text-body-sm text-ink">
                    الاستلام والتوقيع باسم حسابك فقط (<strong>{signerName || '—'}</strong>) — لا يمكن توقيع اسم آخر، ولا تسجيل الاستلام مرتين.
                    راجع الكميات المعتمدة ثم أكّد.
                </p>

                <ul className="flex flex-col gap-xs">
                    {rows.map((row, index) => (
                        <li
                            key={`${row.name}-${String(index)}`}
                            className="flex flex-wrap items-end gap-sm rounded-md border border-hairline bg-surface p-sm"
                        >
                            <div className="min-w-40 flex-1">
                                <p className="text-body-sm font-medium text-ink">{row.name}</p>
                                <p className="mt-xxs text-caption text-muted">
                                    المعتمد:{' '}
                                    <span className="erp-numeric" dir="ltr">
                                        {row.approvedQty.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                    </span>
                                    {row.catchWeight && row.approvedPackagingQty > 0
                                        ? ` · ${row.approvedPackagingQty.toLocaleString('en-US')} كرتون`
                                        : ''}
                                </p>
                            </div>
                            <Input
                                label={row.catchWeight ? 'الوزن المستلم (كجم)' : 'الكمية المستلمة'}
                                name={`received-${String(index)}`}
                                type="number"
                                min={0}
                                max={row.approvedQty}
                                step={0.001}
                                containerClassName="w-40"
                                value={row.receivedQty}
                                onChange={(event) => update(index, 'receivedQty', event.target.value)}
                            />
                            {row.catchWeight ? (
                                <Input
                                    label="عدد الكراتين"
                                    name={`received-boxes-${String(index)}`}
                                    type="number"
                                    min={0}
                                    step={1}
                                    containerClassName="w-36"
                                    value={row.receivedPackagingQty}
                                    onChange={(event) => update(index, 'receivedPackagingQty', event.target.value)}
                                />
                            ) : null}
                        </li>
                    ))}
                </ul>

                <Textarea
                    label="ملاحظات الاستلام (اختياري)"
                    name="notes"
                    rows={2}
                    placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                />
                <SignaturePad label={`توقيع المستلم — ${signerName || '—'}`} name={signerName} testId="dispatch-signature" onChange={setSignature} />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}
