import { ClipboardCheck, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Dispatch } from '../lib/dispatches';
import { itemsSummary, statusOf } from '../lib/dispatches';
import { printDispatchDocument } from '../lib/dispatch-print';
import { type GateUser, dispatchGate, receiveDispatch, receiveVisible } from '../lib/dispatches-write';
import { DISPATCH_TEXT } from '../lib/dispatches-write';
import { useWriteMutation } from '../lib/write';
import { Button } from '../ui/Button';
import { StateEmpty, StateError, TableScroll, TableSkeleton } from './TableState';
import { DispatchReceiveDialog, type DispatchReceiveBody } from './DispatchReceiveDialog';

const TONE: Record<string, string> = {
    warning: 'text-warning-text',
    info: 'text-primary',
    success: 'text-success-text',
    danger: 'text-danger-text',
    neutral: 'text-muted',
};

/**
 * أذون قسم رئيس القسم — مساحة عمل واحدة للطباعة والاستلام.
 *
 * الصفوف قادمة من `/api/warehouse/dept-panel` المقفول على نطاق القسم، لا من
 * قائمة الأذون العامة. الطباعة تجلب السجل الكامل (ورقة A4 بالتوقيعات)،
 * والاستلام يمرّ بنفس بوابة `receiveVisible` وبنفس عقد الخادم في الشاشة العامة —
 * رئيس القسم يستلم إذن قسمه فقط، وبتوقيع حسابه.
 */
export function DeptHeadDispatchPanel({
    rows,
    role,
    gateUser,
    signerName,
    query,
    loading,
    error,
    onRetry,
    onReceived,
}: {
    rows: readonly Dispatch[];
    role: string;
    gateUser: GateUser;
    signerName: string;
    query: string;
    loading: boolean;
    error?: string | undefined;
    onRetry: () => void;
    onReceived: () => void;
}) {
    const [onlyReceivable, setOnlyReceivable] = useState(false);
    const [printingId, setPrintingId] = useState<string | null>(null);
    const [active, setActive] = useState<Dispatch | null>(null);

    const receiveMutation = useWriteMutation<{ dispatch: Dispatch; body: DispatchReceiveBody }, void>({
        mutationFn: ({ dispatch, body }) => receiveDispatch(dispatch.id, body),
        successTitle: DISPATCH_TEXT.received,
        invalidate: [
            ['dashboard', 'dept-head'],
            ['dispatches'],
            ['inventory'],
        ],
        silentError: true,
        onSuccess: () => {
            setActive(null);
            onReceived();
        },
    });

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (onlyReceivable && !receiveVisible(role, dispatchGate(row), gateUser)) {
                return false;
            }
            if (!needle) {
                return true;
            }
            return `${row.id} ${row.deptCode ?? ''} ${row.deptName ?? ''} ${itemsSummary(row.items)} ${statusOf(String(row.status ?? '')).label}`
                .toLowerCase()
                .includes(needle);
        });
    }, [rows, role, gateUser, query, onlyReceivable]);

    async function print(row: Dispatch): Promise<void> {
        setPrintingId(row.id);
        try {
            await printDispatchDocument(row, signerName || undefined);
        } finally {
            setPrintingId(null);
        }
    }

    return (
        <section className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md shadow-card" aria-labelledby="dept-head-dispatch-title">
            <div className="flex flex-wrap items-end justify-between gap-sm">
                <div className="min-w-0">
                    <h2 id="dept-head-dispatch-title" className="text-heading-sm text-ink">
                        أذون قسمي — طباعة واستلام
                    </h2>
                    <p className="mt-xxs text-body-sm text-muted">
                        أذون الصرف المعتمدة لقسمك. اطبع الورقة الرسمية أو استلم الصنف بتوقيع حسابك — {rows.length} إذن معروض.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    <button
                        type="button"
                        onClick={() => setOnlyReceivable((current) => !current)}
                        aria-pressed={onlyReceivable}
                        className={`rounded-md border px-sm py-xxs text-button-md ${
                            onlyReceivable
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-hairline-strong bg-surface text-muted hover:bg-surface-hover hover:text-ink'
                        }`}
                    >
                        بانتظار الاستلام فقط
                    </button>
                </div>
            </div>

            {loading ? <TableSkeleton rows={4} columns={5} /> : null}
            {error ? <StateError message={error} onRetry={onRetry} /> : null}
            {!loading && !error && visible.length === 0 ? (
                <StateEmpty
                    title={rows.length === 0 ? 'لا أذون لقسمك في هذه الفترة' : 'لا نتائج مطابقة'}
                    hint={rows.length === 0 ? 'تظهر هنا أذون الصرف بعد اعتماد المخازن لها.' : 'امسح البحث أو ألغِ فلتر «بانتظار الاستلام». '}
                />
            ) : null}

            {!loading && !error && visible.length > 0 ? (
                <TableScroll label="أذون قسمي">
                    <table className="w-full border-collapse text-body-md">
                        <thead>
                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                <th scope="col" className="px-sm py-xs text-start font-medium">الإذن</th>
                                <th scope="col" className="px-sm py-xs text-start font-medium">التاريخ</th>
                                <th scope="col" className="px-sm py-xs text-start font-medium">الأصناف</th>
                                <th scope="col" className="px-sm py-xs text-center font-medium">الحالة</th>
                                <th scope="col" className="px-sm py-xs text-start font-medium">المستلم</th>
                                <th scope="col" className="px-sm py-xs text-center font-medium" data-erp-print-hide>الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((row) => {
                                const status = statusOf(String(row.status ?? ''));
                                const canReceive = receiveVisible(role, dispatchGate(row), gateUser);
                                return (
                                    <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                            DIS-{row.id}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs whitespace-nowrap text-body-sm text-muted" dir="ltr">
                                            {String(row.date ?? '—').slice(0, 10)}
                                        </td>
                                        <td className="px-sm py-xxs text-body-sm text-ink">
                                            <span className="line-clamp-2">{itemsSummary(row.items) || '—'}</span>
                                            <span className="mt-xxs block text-caption text-muted">
                                                {row.items?.length ?? 0} صنف
                                            </span>
                                        </td>
                                        <td className={`px-sm py-xxs text-center text-body-sm font-medium ${TONE[status.tone] ?? 'text-ink'}`}>
                                            {status.label}
                                        </td>
                                        <td className="px-sm py-xxs text-body-sm text-muted">{row.kitchenReceivedBy || '—'}</td>
                                        <td className="px-sm py-xxs" data-erp-print-hide>
                                            <div className="flex flex-wrap justify-center gap-xxs">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={printingId === row.id}
                                                    aria-label={`طباعة إذن الصرف DIS-${row.id}`}
                                                    onClick={() => void print(row)}
                                                >
                                                    <Printer aria-hidden="true" />
                                                    طباعة
                                                </Button>
                                                {canReceive ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        aria-label={`استلام إذن الصرف DIS-${row.id}`}
                                                        onClick={() => setActive(row)}
                                                    >
                                                        <ClipboardCheck aria-hidden="true" />
                                                        استلام
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </TableScroll>
            ) : null}

            {active ? (
                <DispatchReceiveDialog
                    dispatch={active}
                    signerName={signerName}
                    pending={receiveMutation.isPending}
                    onClose={() => setActive(null)}
                    onSubmit={(body) => receiveMutation.mutateAsync({ dispatch: active, body })}
                />
            ) : null}
        </section>
    );
}
