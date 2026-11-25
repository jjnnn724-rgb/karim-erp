import { useMemo, useState } from 'react';
import {
    type BulkReceiptOutcome,
    type BulkReceiptRow,
    bulkOutcomeText,
    bulkRowError,
    emptyBulkRow,
    submitBulkReceipt,
    validBulkRows,
} from '../lib/inventory-bulk';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/**
 * الاستلام المجمّع — «استلام مجمّع» منقولة من V2
 * (`frontend/app/js/v2/screens/warehouse.js:823-835`، `data-v2-bulk-*`).
 *
 * V2 كان يستورد من Excel؛ V3 يبني الشبكة يدويًا لأن Excel يحتاج منسوبًا
 * (المكتبة `xlsx` غير موجودة في V3 ولا يُضاف اعتماد جديد بلا موافقة).
 * المدخلات والنوافذ نفسها كما في V2: سبعة حقول لكل صف (الصنف، الفئة،
 * الوحدة، الكمية، السعر، الحد الأدنى، الصلاحية)، الافتراضيات عام/قطعة/5.
 *
 * الفرق الجوهري: الخادم يعالج الدفعة ذرّية (`returns-routes.js:362-420`)،
 * فخطأ صف يُسقط دفعته. لذلك الإرسال على دفعات من 20 صفًا (نفس
 * `BULK_CHUNK` في V2) مع إظهار ما فشل بدل ابتلاعه.
 */

const FIELD_CLASS = 'h-9 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink';

export interface BulkReceiptDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** ينبّه الشاشة بأن الرصيد تغيّر — يُبطل استعلامات المخزون. */
    onImported?: (outcome: BulkReceiptOutcome) => void;
}

interface FieldSpec {
    key: keyof BulkReceiptRow;
    label: string;
    placeholder: string;
    type: 'text' | 'number' | 'date';
}

const FIELDS: FieldSpec[] = [
    { key: 'name', label: 'الصنف', placeholder: 'الصنف', type: 'text' },
    { key: 'category', label: 'الفئة', placeholder: 'الفئة (عام)', type: 'text' },
    { key: 'unit', label: 'الوحدة', placeholder: 'الوحدة (قطعة)', type: 'text' },
    { key: 'qty', label: 'الكمية', placeholder: 'الكمية', type: 'number' },
    { key: 'price', label: 'السعر', placeholder: 'السعر', type: 'number' },
    { key: 'minQty', label: 'الحد الأدنى', placeholder: 'الحد الأدنى (5)', type: 'number' },
    { key: 'expiryDate', label: 'تاريخ الصلاحية', placeholder: 'تاريخ الصلاحية', type: 'date' },
];

export function BulkReceiptDialog({ open, onOpenChange, onImported }: BulkReceiptDialogProps) {
    const [rows, setRows] = useState<BulkReceiptRow[]>([emptyBulkRow()]);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [outcome, setOutcome] = useState<BulkReceiptOutcome | null>(null);

    const rowErrors = useMemo(() => rows.map((row) => bulkRowError(row)), [rows]);
    const ready = validBulkRows(rows).length;

    function update(index: number, key: keyof BulkReceiptRow, value: string): void {
        setRows((previous) => previous.map((row, position) => (position === index ? { ...row, [key]: value } : row)));
    }

    function addRow(): void {
        setRows((previous) => [...previous, emptyBulkRow()]);
    }

    function removeRow(index: number): void {
        setRows((previous) => (previous.length === 1 ? [emptyBulkRow()] : previous.filter((_, position) => position !== index)));
    }

    async function submit(): Promise<void> {
        if (pending) {
            return;
        }
        setError('');
        const firstInvalid = rowErrors.findIndex((message) => message !== '');
        if (firstInvalid >= 0) {
            setError(rowErrors[firstInvalid] ?? 'راجع الصفوف قبل الإرسال');
            return;
        }
        if (!ready) {
            setError('لا توجد أصناف صالحة للإرسال');
            return;
        }
        setPending(true);
        try {
            const result = await submitBulkReceipt(rows);
            setOutcome(result);
            onImported?.(result);
            if (!result.failures.length) {
                setRows([emptyBulkRow()]);
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'تعذّر تسجيل الاستيراد');
        } finally {
            setPending(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title="استلام مجمّع"
            description="استيراد دفعة أصناف دفعة واحدة — كل دفعة تُسجَّل ذرّية، ونقص الدفعة يُعرض كما هو."
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                        إغلاق
                    </Button>
                    <Button type="button" size="sm" loading={pending} onClick={() => void submit()}>
                        {`استلام ${ready} صنف`}
                    </Button>
                </>
            }
        >
            <div className="flex min-w-0 flex-col gap-sm">
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}

                {outcome ? (
                    <div
                        role="status"
                        className={
                            outcome.failures.length
                                ? 'rounded-lg border border-warning bg-surface p-sm text-body-sm text-warning-text'
                                : 'rounded-lg border border-success bg-surface p-sm text-body-sm text-success-text'
                        }
                    >
                        <p>{bulkOutcomeText(outcome)}</p>
                        {outcome.failures.map((failure) => (
                            <p key={failure.names.join('|')} className="mt-xxs">
                                {`${failure.names.slice(0, 5).join('، ')} — ${failure.message}`}
                            </p>
                        ))}
                    </div>
                ) : null}

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-body-sm">
                        <thead>
                            <tr className="border-b border-hairline text-caption text-muted">
                                {FIELDS.map((field) => (
                                    <th key={field.key} scope="col" className="px-xs py-xxs text-start font-medium">
                                        {field.label}
                                    </th>
                                ))}
                                <th scope="col" className="px-xs py-xxs text-start font-medium">
                                    <span className="sr-only">إزالة الصف</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={row.id} className="border-b border-hairline last:border-0">
                                    {FIELDS.map((field) => (
                                        <td key={field.key} className="px-xs py-xxs">
                                            <input
                                                type={field.type}
                                                value={row[field.key]}
                                                step={field.type === 'number' ? '0.001' : undefined}
                                                min={field.type === 'number' ? 0 : undefined}
                                                placeholder={field.placeholder}
                                                aria-label={`${field.label} — صف ${index + 1}`}
                                                onChange={(event) => {
                                                    update(index, field.key, event.target.value);
                                                }}
                                                className={FIELD_CLASS}
                                            />
                                        </td>
                                    ))}
                                    <td className="px-xs py-xxs">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                removeRow(index);
                                            }}
                                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                                        >
                                            إزالة
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {rowErrors.some((message) => message !== '') ? (
                    <ul className="flex flex-col gap-xxs text-body-sm text-danger-text">
                        {rowErrors.map((message, index) =>
                            message ? <li key={rows[index]?.id ?? index}>{`الصف ${index + 1}: ${message}`}</li> : null,
                        )}
                    </ul>
                ) : null}

                <div className="flex flex-wrap items-center gap-sm">
                    <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                        إضافة صف
                    </Button>
                    <span className="text-caption text-muted">{`${rows.length} صف — ${ready} صالح للإرسال`}</span>
                </div>
            </div>
        </Dialog>
    );
}
