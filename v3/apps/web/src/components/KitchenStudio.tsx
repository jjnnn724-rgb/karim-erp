import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import {
    approveKitchenAudit,
    canReviewKitchenExceptions,
    canWriteKitchenOps,
    createKitchenAudit,
    createKitchenProduction,
    fetchKitchenAudits,
    fetchKitchenDestinations,
    fetchKitchenDocuments,
    fetchKitchenMaterials,
    fetchKitchenStock,
    formatKitchenQty,
    KITCHEN_AUDIT_PERIOD_AR,
    KITCHEN_AUDIT_PERIODS,
    KITCHEN_AUDIT_STATUS_AR,
    KITCHEN_CHANNELS,
    type KitchenAudit,
    type KitchenAuditPeriod,
    kitchenAuditStatusTone,
    kitchenPeriodStart,
    kitchenSignatureError,
    kitchenToday,
    receiveKitchenTransfer,
    saveKitchenAuditCounts,
    submitKitchenAudit,
    validateKitchenProduction,
} from '../lib/kitchen-ops';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SignaturePad } from '../ui/SignaturePad';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { StateEmpty, StateError, StateLoading, TableScroll } from './TableState';

/**
 * استوديو تشغيل المطبخ — يغلق فجوة V2→V3 في شاشة المطبخ
 * (`docs/phase-0/v3-parity-audit.md`).
 *
 * أربع دورات كاملة على مسارات الخادم نفسها، بلا رجوع للقديم:
 *  1. استلام مواد من المخزن الرئيسي (قيد مزدوج + حماية التكرار).
 *  2. أمر إنتاج يدوي موزّع على الأقسام/القنوات (يستهلك المطبخ ذرّيًا).
 *  3. جرد المطبخ: مسودة → عدّ → إرسال موقّع → اعتماد يترحّل الفروق.
 *  4. مستندات التحويل داخل/خارج المطبخ.
 *
 * الشاشة لا تحسب أرصدة ولا ترحّل شيئًا محليًّا؛ كل رقم يُقرأ من الخادم.
 */

const FIELD_CLASS = 'h-9 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink';

const SECONDARY_BUTTON_CLASS =
    'rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50';
const DANGER_BUTTON_CLASS =
    'rounded-md border border-danger/50 bg-surface px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft disabled:opacity-50';

const STATUS_TEXT_CLASS: Record<'info' | 'success' | 'warning' | 'danger', string> = {
    info: 'text-ink-secondary',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
};

type TabKey = 'receive' | 'production' | 'audits' | 'documents';

interface ReceiveLine {
    inventoryId: number;
    name: string;
    unit: string;
    available: number;
    qty: string;
    packaging: string;
}

interface MaterialLine {
    key: string;
    inventoryId: number;
    name: string;
    unit: string;
    available: number;
    qty: string;
    waste: string;
}

interface DistributionLine {
    key: string;
    kind: 'channel' | 'department';
    code: string;
    departmentId: number | null;
    label: string;
    qty: string;
}

export interface KitchenStudioProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function KitchenStudio({ open, onOpenChange }: KitchenStudioProps) {
    const auth = useAuthState();
    const role = auth.user?.role;
    const signerName = String(auth.user?.name ?? auth.user?.username ?? '').trim();
    const canWrite = canWriteKitchenOps(role);
    const canReview = canReviewKitchenExceptions(role);

    const [tab, setTab] = useState<TabKey>('receive');

    const stockQuery = useQuery({
        queryKey: ['kitchen', 'stock'],
        queryFn: ({ signal }) => fetchKitchenStock(signal),
        enabled: open && tab === 'receive' && canWrite,
        staleTime: 30_000,
    });

    const materialsQuery = useQuery({
        queryKey: ['kitchen', 'production-materials'],
        queryFn: ({ signal }) => fetchKitchenMaterials(signal),
        enabled: open && tab === 'production' && canWrite,
        staleTime: 30_000,
    });

    const destinationsQuery = useQuery({
        queryKey: ['kitchen', 'production-destinations'],
        queryFn: ({ signal }) => fetchKitchenDestinations(signal),
        enabled: open && tab === 'production' && canWrite,
        staleTime: 5 * 60_000,
    });

    const auditsQuery = useQuery({
        queryKey: ['kitchen', 'audits'],
        queryFn: ({ signal }) => fetchKitchenAudits(signal),
        enabled: open && tab === 'audits',
        staleTime: 20_000,
    });

    const documentsQuery = useQuery({
        queryKey: ['kitchen', 'documents'],
        queryFn: ({ signal }) => fetchKitchenDocuments(signal),
        enabled: open && tab === 'documents',
        staleTime: 30_000,
    });

    useEffect(() => {
        if (!open) {
            setTab('receive');
            setReceiveLines({});
            setReceiveReference('');
            setReceiveError('');
            setProductionDraft(null);
            setAuditId(null);
            setSignature(null);
            setIsCounting(false);
        }
    }, [open]);

    /* ── 1) الاستلام ─────────────────────────────────────────────────── */

    const [receiveLines, setReceiveLines] = useState<Record<string, ReceiveLine>>({});
    const [receiveReference, setReceiveReference] = useState('');
    const [receiveError, setReceiveError] = useState('');
    const [receiveSearch, setReceiveSearch] = useState('');

    const stockItems = stockQuery.data?.items ?? [];
    const filteredStock = useMemo(() => {
        const needle = receiveSearch.trim().toLowerCase();
        if (!needle) {
            return stockItems;
        }
        return stockItems.filter(
            (item) =>
                String(item.name ?? '')
                    .toLowerCase()
                    .includes(needle) || String(item.inventory_id).includes(needle),
        );
    }, [receiveSearch, stockItems]);

    const receiveSelected = Object.values(receiveLines);

    const receiveMutation = useWriteMutation<
        { items: { inventoryId: number; qty: number; packagingQty: number | null }[]; reference: string },
        void
    >({
        mutationFn: (input) =>
            receiveKitchenTransfer({
                ...(input.reference ? { reference: input.reference } : {}),
                items: input.items.map((line) => ({
                    inventoryId: line.inventoryId,
                    qty: line.qty,
                    ...(line.packagingQty != null ? { packagingQty: line.packagingQty } : {}),
                })),
            }),
        successTitle: (vars) => `تم استلام ${formatKitchenQty(vars.items.length)} صنفًا في مخزن المطبخ`,
        invalidate: [
            ['kitchen', 'stock'],
            ['kitchen', 'production-materials'],
            ['kitchen', 'audits'],
            ['kitchen', 'documents'],
        ],
        onSuccess: () => {
            setReceiveLines({});
            setReceiveReference('');
            setReceiveError('');
        },
    });

    function submitReceive() {
        const lines = Object.values(receiveLines)
            .map((line) => ({
                inventoryId: line.inventoryId,
                qty: Number(line.qty),
                packagingQty: line.packaging.trim() === '' ? null : Number(line.packaging),
            }))
            .filter((line) => Number.isFinite(line.qty) && line.qty > 0);
        if (lines.length === 0) {
            setReceiveError('أدخل كمية أكبر من صفر لصنف واحد على الأقل.');
            return;
        }
        if (lines.some((line) => line.packagingQty != null && (!Number.isFinite(line.packagingQty) || line.packagingQty < 0))) {
            setReceiveError('عدد الكراتين غير صحيح.');
            return;
        }
        const over = Object.values(receiveLines).find((line) => Number(line.qty) > 0 && Number(line.qty) > line.available + 0.0001);
        if (over) {
            setReceiveError(`الكمية تتجاوز المتاح في الرئيسي: ${over.name} (المتاح ${formatKitchenQty(over.available)}).`);
            return;
        }
        setReceiveError('');
        receiveMutation.mutate({ items: lines, reference: receiveReference.trim() });
    }

    /* ── 2) الإنتاج ──────────────────────────────────────────────────── */

    const [productionDraft, setProductionDraft] = useState<{
        productName: string;
        productUnit: string;
        qty: string;
        notes: string;
        materials: MaterialLine[];
        distributions: DistributionLine[];
    } | null>(null);
    const [materialPick, setMaterialPick] = useState('');
    const [distributionPick, setDistributionPick] = useState('');
    const [productionError, setProductionError] = useState('');

    const materials = materialsQuery.data ?? [];
    const destinations = destinationsQuery.data ?? [];

    const draft = productionDraft ?? {
        productName: '',
        productUnit: 'وحدة',
        qty: '',
        notes: '',
        materials: [] as MaterialLine[],
        distributions: [] as DistributionLine[],
    };

    function updateDraft(patch: Partial<typeof draft>) {
        setProductionDraft({ ...draft, ...patch });
    }

    function addMaterial() {
        const selected = materials.find((row) => String(row.inventory_id) === materialPick);
        if (!selected) {
            return;
        }
        if (draft.materials.some((line) => line.inventoryId === Number(selected.inventory_id))) {
            setMaterialPick('');
            return;
        }
        updateDraft({
            materials: [
                ...draft.materials,
                {
                    key: `m-${String(selected.inventory_id)}`,
                    inventoryId: Number(selected.inventory_id),
                    name: String(selected.name ?? ''),
                    unit: String(selected.unit ?? ''),
                    available: Number(selected.available ?? 0),
                    qty: '',
                    waste: '0',
                },
            ],
        });
        setMaterialPick('');
    }

    function addDistribution() {
        if (!distributionPick) {
            return;
        }
        if (distributionPick.startsWith('channel:')) {
            const code = distributionPick.slice('channel:'.length);
            const channel = KITCHEN_CHANNELS.find((row) => row.code === code);
            if (!channel) {
                return;
            }
            updateDraft({
                distributions: [
                    ...draft.distributions,
                    { key: `c-${code}`, kind: 'channel', code, departmentId: null, label: channel.label, qty: '' },
                ],
            });
        } else if (distributionPick.startsWith('department:')) {
            const id = distributionPick.slice('department:'.length);
            const department = destinations.find((row) => String(row.id) === id);
            if (!department) {
                return;
            }
            updateDraft({
                distributions: [
                    ...draft.distributions,
                    {
                        key: `d-${id}`,
                        kind: 'department',
                        code: String(department.code ?? id),
                        departmentId: Number(department.id),
                        label: String(department.name ?? `قسم ${id}`),
                        qty: '',
                    },
                ],
            });
        }
        setDistributionPick('');
    }

    function distributeRemainder() {
        const total = Number(draft.qty);
        if (!Number.isFinite(total) || total <= 0) {
            setProductionError('اكتب الكمية المنتجة أولًا ثم وزّعها.');
            return;
        }
        const used = draft.distributions.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
        const remaining = Number((total - used).toFixed(3));
        if (remaining <= 0) {
            setProductionError('التوزيع مكتمل بالفعل.');
            return;
        }
        if (draft.distributions.length === 0) {
            const channel = KITCHEN_CHANNELS[0];
            if (!channel) {
                return;
            }
            updateDraft({
                distributions: [
                    {
                        key: `c-${channel.code}`,
                        kind: 'channel',
                        code: channel.code,
                        departmentId: null,
                        label: channel.label,
                        qty: String(remaining),
                    },
                ],
            });
            setProductionError('');
            return;
        }
        const updated = [...draft.distributions];
        const last = updated[updated.length - 1];
        if (!last) {
            return;
        }
        updated[updated.length - 1] = { ...last, qty: String(Number(last.qty || 0) + remaining) };
        updateDraft({ distributions: updated });
        setProductionError('');
    }

    const productionMutation = useWriteMutation<
        { productName: string; productUnit: string; producedQty: number; notes: string; draft: typeof draft },
        void
    >({
        mutationFn: (input) =>
            createKitchenProduction({
                productName: input.productName,
                productUnit: input.productUnit,
                producedQty: input.producedQty,
                materials: input.draft.materials.map((line) => ({
                    inventoryId: line.inventoryId,
                    quantity: Number(line.qty),
                    wastePercent: Number(line.waste || 0),
                })),
                distributions: input.draft.distributions.map((line) => ({
                    kind: line.kind,
                    code: line.code,
                    quantity: Number(line.qty),
                    ...(line.kind === 'department' ? { departmentId: line.departmentId } : {}),
                })),
                notes: input.notes,
            }),
        successTitle: 'تم تسجيل أمر الإنتاج وتوزيعه',
        invalidate: [
            ['kitchen', 'overview'],
            ['kitchen', 'production-materials'],
            ['kitchen', 'stock'],
        ],
        onSuccess: () => {
            setProductionDraft(null);
            setProductionError('');
        },
    });

    function submitProduction() {
        const producedQty = Number(draft.qty);
        const check = validateKitchenProduction({
            productName: draft.productName,
            producedQty,
            materials: draft.materials.map((line) => ({
                inventoryId: line.inventoryId,
                quantity: Number(line.qty),
                wastePercent: Number(line.waste || 0),
            })),
            distributions: draft.distributions.map((line) => ({
                kind: line.kind,
                code: line.code,
                quantity: Number(line.qty),
            })),
        });
        const over = draft.materials.find((line) => {
            const required = Number(line.qty || 0) * (1 + Number(line.waste || 0) / 100);
            return Number(line.qty) > 0 && required > line.available + 0.0001;
        });
        if (over) {
            setProductionError(`المكوّن لا يكفي في مخزن المطبخ: ${over.name} (المتاح ${formatKitchenQty(over.available)}).`);
            return;
        }
        if (!check.ok) {
            setProductionError(check.errors[0] ?? 'تحقق من بيانات أمر الإنتاج.');
            return;
        }
        setProductionError('');
        productionMutation.mutate({
            productName: draft.productName.trim(),
            productUnit: draft.productUnit.trim() || 'وحدة',
            producedQty,
            notes: draft.notes,
            draft,
        });
    }

    /* ── 3) جرد المطبخ ──────────────────────────────────────────────── */

    const [auditId, setAuditId] = useState<string | null>(null);
    const [isCounting, setIsCounting] = useState(false);
    const [counts, setCounts] = useState<Record<string, string>>({});
    const [signature, setSignature] = useState<string | null>(null);
    const [auditError, setAuditError] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [newPeriod, setNewPeriod] = useState<KitchenAuditPeriod>('weekly');
    const [newStart, setNewStart] = useState(kitchenPeriodStart('weekly'));
    const [newEnd, setNewEnd] = useState(kitchenToday());
    const [newNotes, setNewNotes] = useState('');

    const audits = auditsQuery.data ?? [];
    const selectedAudit: KitchenAudit | undefined = audits.find((row) => String(row.id) === auditId);

    useEffect(() => {
        if (!selectedAudit) {
            return;
        }
        const next: Record<string, string> = {};
        for (const item of selectedAudit.items ?? []) {
            next[String(item.id)] = formatKitchenQty(Number(item.counted_qty));
        }
        setCounts(next);
        setSignature(null);
        setAuditError('');
        setIsCounting(false);
    }, [selectedAudit]);

    const createAuditMutation = useWriteMutation<{ period: KitchenAuditPeriod; start: string; end: string; notes: string }, void>({
        mutationFn: (input) =>
            createKitchenAudit({
                period: input.period,
                periodStart: input.start,
                periodEnd: input.end,
                notes: input.notes,
            }),
        successTitle: 'تم بدء جلسة جرد المطبخ',
        invalidate: [['kitchen', 'audits']],
        onSuccess: () => {
            setCreateOpen(false);
            setNewNotes('');
        },
    });

    const countMutation = useWriteMutation<{ audit: KitchenAudit; lines: { id: number; countedQty: number }[] }, void>({
        mutationFn: (input) => saveKitchenAuditCounts(String(input.audit.id), input.lines),
        successTitle: (vars) => `تم حفظ عدّ ${formatKitchenQty(vars.lines.length)} صنفًا`,
        invalidate: [['kitchen', 'audits']],
        silentError: true,
        onSuccess: () => {
            setAuditError('');
            setIsCounting(false);
        },
        onError: (error) => setAuditError(writeErrorMessage(error, 'تعذّر حفظ العدّ')),
    });

    const submitMutation = useWriteMutation<{ audit: KitchenAudit; signature: string }, void>({
        mutationFn: (input) => submitKitchenAudit(String(input.audit.id), { signatureData: input.signature, signerName }),
        successTitle: 'أُرسل جرد المطبخ للمراجعة',
        invalidate: [['kitchen', 'audits']],
        silentError: true,
        onSuccess: () => {
            setSignature(null);
            setAuditError('');
        },
        onError: (error) => setAuditError(writeErrorMessage(error, 'تعذّر إرسال الجرد')),
    });

    const approveMutation = useWriteMutation<{ audit: KitchenAudit; signature: string }, void>({
        mutationFn: (input) => approveKitchenAudit(String(input.audit.id), { signatureData: input.signature, signerName }),
        successTitle: 'اعتُمِد جرد المطبخ ورُحّلت الفروق',
        invalidate: [
            ['kitchen', 'audits'],
            ['kitchen', 'overview'],
            ['kitchen', 'production-materials'],
        ],
        silentError: true,
        onSuccess: () => {
            setSignature(null);
            setAuditError('');
        },
        onError: (error) => setAuditError(writeErrorMessage(error, 'تعذّر اعتماد الجرد')),
    });

    function saveCounts(audit: KitchenAudit) {
        const lines = (audit.items ?? [])
            .map((item) => ({ id: Number(item.id), countedQty: Number(counts[String(item.id)] ?? item.counted_qty) }))
            .filter((line) => Number.isFinite(line.countedQty) && line.countedQty >= 0);
        if (lines.length === 0) {
            setAuditError('لا بنود قابلة للحفظ — أدخل أعدادًا صحيحة.');
            return;
        }
        setAuditError('');
        countMutation.mutate({ audit, lines });
    }

    function requireSignature(): string | null {
        const error = kitchenSignatureError(signature, signerName);
        if (error) {
            setAuditError(error);
            return null;
        }
        return signature;
    }

    /* ── 4) المستندات + الاستثناءات ─────────────────────────────────── */

    const documents = documentsQuery.data ?? [];

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="تشغيل المطبخ"
            description="استلام مواد، أمر إنتاج موزّع، جرد موقّع، ومستندات التحويل — كلها على الخادم."
            size="lg"
        >
            <Tabs
                value={tab}
                onValueChange={(value) => {
                    setTab(value as TabKey);
                    setAuditId(null);
                }}
            >
                <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="receive">استلام مواد</TabsTrigger>
                    <TabsTrigger value="production">أمر إنتاج</TabsTrigger>
                    <TabsTrigger value="audits">جرد المطبخ</TabsTrigger>
                    <TabsTrigger value="documents">المستندات</TabsTrigger>
                </TabsList>

                {/* ── استلام مواد ─────────────────────────────────────── */}
                <TabsContent value="receive" className="mt-md flex flex-col gap-sm">
                    {stockQuery.isPending ? <StateLoading label="جارٍ قراءة أرصدة المخزن الرئيسي…" /> : null}
                    {stockQuery.isError ? (
                        <StateError
                            message={writeErrorMessage(stockQuery.error, 'تعذّر قراءة أرصدة المخزن')}
                            onRetry={() => void stockQuery.refetch()}
                        />
                    ) : null}
                    {stockQuery.data ? (
                        <>
                            <div className="flex flex-wrap items-end gap-sm">
                                <label className="flex min-w-[12rem] flex-1 flex-col gap-xxs">
                                    <span className="text-caption text-muted">بحث عن صنف</span>
                                    <input
                                        className={FIELD_CLASS}
                                        value={receiveSearch}
                                        onChange={(event) => setReceiveSearch(event.target.value)}
                                        placeholder="اسم الصنف أو رقمه"
                                    />
                                </label>
                                <label className="flex min-w-[12rem] flex-1 flex-col gap-xxs">
                                    <span className="text-caption text-muted">مرجع التحويل (اختياري)</span>
                                    <input
                                        className={FIELD_CLASS}
                                        value={receiveReference}
                                        onChange={(event) => setReceiveReference(event.target.value)}
                                        placeholder="مثال: صرف 1203"
                                        dir="auto"
                                    />
                                </label>
                            </div>
                            <p className="text-caption text-muted">
                                {`من ${String(stockQuery.data.source?.name_ar ?? 'المخزن الرئيسي')} إلى ${String(
                                    stockQuery.data.destination?.name_ar ?? 'مخزن المطبخ',
                                )} — الأدوار: مخزن/مطبخ/مدير.`}
                            </p>
                            {stockItems.length === 0 ? (
                                <StateEmpty title="لا أصناف متاحة" hint="المخزن الرئيسي بلا أرصدة موجبة الآن." />
                            ) : (
                                <TableScroll label="أصناف المخزن الرئيسي القابلة للتحويل">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصنف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-end font-medium">
                                                    المتاح
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الكمية
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    كراتين
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredStock.slice(0, 200).map((item) => {
                                                const key = String(item.inventory_id);
                                                const line = receiveLines[key];
                                                return (
                                                    <tr key={key} className="border-b border-hairline hover:bg-surface-hover">
                                                        <td className="px-sm py-xxs text-ink">
                                                            <span className="block break-words">{String(item.name ?? `#${key}`)}</span>
                                                            <span className="block text-caption text-faint" dir="ltr">
                                                                {String(item.unit ?? '')}
                                                            </span>
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-end text-body-sm" dir="ltr">
                                                            {formatKitchenQty(Number(item.available ?? 0))}
                                                        </td>
                                                        <td className="px-sm py-xxs">
                                                            <input
                                                                className={FIELD_CLASS}
                                                                inputMode="decimal"
                                                                value={line?.qty ?? ''}
                                                                placeholder="0"
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    setReceiveLines((current) => ({
                                                                        ...current,
                                                                        [key]: {
                                                                            inventoryId: Number(item.inventory_id),
                                                                            name: String(item.name ?? ''),
                                                                            unit: String(item.unit ?? ''),
                                                                            available: Number(item.available ?? 0),
                                                                            qty: value,
                                                                            packaging: current[key]?.packaging ?? '',
                                                                        },
                                                                    }));
                                                                }}
                                                            />
                                                        </td>
                                                        <td className="px-sm py-xxs">
                                                            <input
                                                                className={FIELD_CLASS}
                                                                inputMode="numeric"
                                                                value={line?.packaging ?? ''}
                                                                placeholder="—"
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    setReceiveLines((current) => ({
                                                                        ...current,
                                                                        [key]: {
                                                                            inventoryId: Number(item.inventory_id),
                                                                            name: String(item.name ?? ''),
                                                                            unit: String(item.unit ?? ''),
                                                                            available: Number(item.available ?? 0),
                                                                            qty: current[key]?.qty ?? '',
                                                                            packaging: value,
                                                                        },
                                                                    }));
                                                                }}
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                            {receiveError ? (
                                <p
                                    role="alert"
                                    className="rounded-md border border-danger/30 bg-danger-soft p-sm text-body-sm text-danger-text"
                                >
                                    {receiveError}
                                </p>
                            ) : null}
                            <div className="flex flex-wrap items-center justify-between gap-sm">
                                <span className="text-body-sm text-muted" role="status">
                                    {`أصناف مُدخلة: ${formatKitchenQty(receiveSelected.filter((line) => Number(line.qty) > 0).length)}`}
                                </span>
                                <Button type="button" size="sm" loading={receiveMutation.isPending} onClick={submitReceive}>
                                    استلام في مخزن المطبخ
                                </Button>
                            </div>
                        </>
                    ) : null}
                </TabsContent>

                {/* ── أمر إنتاج ───────────────────────────────────────── */}
                <TabsContent value="production" className="mt-md flex flex-col gap-sm">
                    {materialsQuery.isPending || destinationsQuery.isPending ? (
                        <StateLoading label="جارٍ قراءة مكونات المطبخ وجهات التوزيع…" />
                    ) : null}
                    {materialsQuery.isError ? (
                        <StateError
                            message={writeErrorMessage(materialsQuery.error, 'تعذّر قراءة مكونات المطبخ')}
                            onRetry={() => void materialsQuery.refetch()}
                        />
                    ) : null}
                    <div className="grid gap-sm sm:grid-cols-3">
                        <label className="flex flex-col gap-xxs">
                            <span className="text-caption text-muted">المنتج النهائي</span>
                            <input
                                className={FIELD_CLASS}
                                value={draft.productName}
                                onChange={(event) => updateDraft({ productName: event.target.value })}
                                placeholder="مثال: كيك شوكولاتة"
                            />
                        </label>
                        <label className="flex flex-col gap-xxs">
                            <span className="text-caption text-muted">وحدة المنتج</span>
                            <input
                                className={FIELD_CLASS}
                                value={draft.productUnit}
                                onChange={(event) => updateDraft({ productUnit: event.target.value })}
                                placeholder="قطعة / كيلو"
                            />
                        </label>
                        <label className="flex flex-col gap-xxs">
                            <span className="text-caption text-muted">الكمية المنتجة</span>
                            <input
                                className={FIELD_CLASS}
                                inputMode="decimal"
                                value={draft.qty}
                                onChange={(event) => updateDraft({ qty: event.target.value })}
                                placeholder="0"
                            />
                        </label>
                    </div>

                    <section className="rounded-md border border-hairline p-sm">
                        <div className="flex flex-wrap items-end justify-between gap-sm">
                            <h3 className="text-body-md text-ink">المكونات (من مخزن المطبخ)</h3>
                            <div className="flex min-w-[14rem] flex-1 items-end gap-xs">
                                <Select
                                    containerClassName="flex-1"
                                    placeholder="اختر مكوّنًا"
                                    value={materialPick}
                                    onValueChange={setMaterialPick}
                                    options={materials.map((row) => ({
                                        value: String(row.inventory_id),
                                        label: `${String(row.name ?? '')} — متاح ${formatKitchenQty(Number(row.available ?? 0))}`,
                                    }))}
                                />
                                <Button type="button" variant="secondary" size="sm" onClick={addMaterial} disabled={!materialPick}>
                                    إضافة
                                </Button>
                            </div>
                        </div>
                        {draft.materials.length === 0 ? (
                            <p className="mt-sm text-body-sm text-muted">لم تُضف مكونات بعد.</p>
                        ) : (
                            <ul className="mt-sm flex list-none flex-col gap-xs">
                                {draft.materials.map((line) => (
                                    <li key={line.key} className="grid items-end gap-xs sm:grid-cols-[1fr_5rem_5rem_auto]">
                                        <span className="text-body-sm text-ink">
                                            {line.name}
                                            <span className="ms-xs text-caption text-faint" dir="ltr">
                                                {line.unit}
                                            </span>
                                        </span>
                                        <input
                                            className={FIELD_CLASS}
                                            inputMode="decimal"
                                            placeholder="الكمية"
                                            value={line.qty}
                                            onChange={(event) =>
                                                updateDraft({
                                                    materials: draft.materials.map((row) =>
                                                        row.key === line.key ? { ...row, qty: event.target.value } : row,
                                                    ),
                                                })
                                            }
                                        />
                                        <input
                                            className={FIELD_CLASS}
                                            inputMode="decimal"
                                            placeholder="هالك %"
                                            value={line.waste}
                                            onChange={(event) =>
                                                updateDraft({
                                                    materials: draft.materials.map((row) =>
                                                        row.key === line.key ? { ...row, waste: event.target.value } : row,
                                                    ),
                                                })
                                            }
                                        />
                                        <button
                                            type="button"
                                            className={DANGER_BUTTON_CLASS}
                                            onClick={() =>
                                                updateDraft({ materials: draft.materials.filter((row) => row.key !== line.key) })
                                            }
                                        >
                                            حذف
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section className="rounded-md border border-hairline p-sm">
                        <div className="flex flex-wrap items-end justify-between gap-sm">
                            <h3 className="text-body-md text-ink">جهات التوزيع</h3>
                            <div className="flex min-w-[14rem] flex-1 items-end gap-xs">
                                <Select
                                    containerClassName="flex-1"
                                    placeholder="قناة أو قسم"
                                    value={distributionPick}
                                    onValueChange={setDistributionPick}
                                    options={[
                                        ...KITCHEN_CHANNELS.map((row) => ({ value: `channel:${row.code}`, label: row.label })),
                                        ...destinations.map((row) => ({
                                            value: `department:${String(row.id)}`,
                                            label: `${String(row.icon ?? '')} ${String(row.name ?? '')}`.trim(),
                                        })),
                                    ]}
                                />
                                <Button type="button" variant="secondary" size="sm" onClick={addDistribution} disabled={!distributionPick}>
                                    إضافة
                                </Button>
                            </div>
                        </div>
                        {draft.distributions.length === 0 ? (
                            <p className="mt-sm text-body-sm text-muted">لم تُضف جهات بعد — الزر أدناه يوزّع كل الكمية.</p>
                        ) : (
                            <ul className="mt-sm flex list-none flex-col gap-xs">
                                {draft.distributions.map((line) => (
                                    <li key={line.key} className="grid items-end gap-xs sm:grid-cols-[1fr_6rem_auto]">
                                        <span className="text-body-sm text-ink">
                                            {line.label}
                                            <span className="ms-xs text-caption text-faint">
                                                {line.kind === 'department' ? 'قسم' : 'قناة'}
                                            </span>
                                        </span>
                                        <input
                                            className={FIELD_CLASS}
                                            inputMode="decimal"
                                            placeholder="الكمية"
                                            value={line.qty}
                                            onChange={(event) =>
                                                updateDraft({
                                                    distributions: draft.distributions.map((row) =>
                                                        row.key === line.key ? { ...row, qty: event.target.value } : row,
                                                    ),
                                                })
                                            }
                                        />
                                        <button
                                            type="button"
                                            className={DANGER_BUTTON_CLASS}
                                            onClick={() =>
                                                updateDraft({
                                                    distributions: draft.distributions.filter((row) => row.key !== line.key),
                                                })
                                            }
                                        >
                                            حذف
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="mt-sm flex flex-wrap items-center gap-sm">
                            <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={distributeRemainder}>
                                وزّع المتبقي
                            </button>
                            <span className="text-caption text-muted">
                                {`إجمالي التوزيع: ${formatKitchenQty(
                                    draft.distributions.reduce((sum, line) => sum + (Number(line.qty) || 0), 0),
                                )} / الإنتاج ${formatKitchenQty(Number(draft.qty) || 0)}`}
                            </span>
                        </div>
                    </section>

                    <label className="flex flex-col gap-xxs">
                        <span className="text-caption text-muted">ملاحظات (اختياري)</span>
                        <textarea
                            className="min-h-16 w-full rounded-md border border-hairline-strong bg-surface p-sm text-body-md text-ink"
                            value={draft.notes}
                            onChange={(event) => updateDraft({ notes: event.target.value })}
                        />
                    </label>

                    {productionError ? (
                        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-sm text-body-sm text-danger-text">
                            {productionError}
                        </p>
                    ) : null}

                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            loading={productionMutation.isPending}
                            onClick={submitProduction}
                            disabled={!canWrite}
                        >
                            تسجيل أمر الإنتاج
                        </Button>
                    </div>
                </TabsContent>

                {/* ── جرد المطبخ ──────────────────────────────────────── */}
                <TabsContent value="audits" className="mt-md flex flex-col gap-sm">
                    {auditsQuery.isPending ? <StateLoading label="جارٍ قراءة جرد المطبخ…" /> : null}
                    {auditsQuery.isError ? (
                        <StateError
                            message={writeErrorMessage(auditsQuery.error, 'تعذّر قراءة جرد المطبخ')}
                            onRetry={() => void auditsQuery.refetch()}
                        />
                    ) : null}

                    {!selectedAudit ? (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-sm">
                                <p className="text-body-sm text-muted">
                                    الجلسة تُبنى من أرصدة مخزن المطبخ، والاعتماد يترحّل الفروق إلى الدفتر.
                                </p>
                                <Button type="button" size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
                                    بدء جلسة جرد
                                </Button>
                            </div>
                            {audits.length === 0 ? (
                                <StateEmpty title="لا جلسات جرد" hint="ابدأ جلسة جديدة لعدّ مخزن المطبخ." />
                            ) : (
                                <TableScroll label="جلسات جرد المطبخ">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الجلسة
                                                </th>
                                                <th scope="col" className="hidden px-sm py-xs text-start font-medium sm:table-cell">
                                                    الفترة
                                                </th>
                                                <th scope="col" className="hidden px-sm py-xs text-end font-medium sm:table-cell">
                                                    البنود
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-end font-medium">
                                                    —
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {audits.map((audit) => {
                                                const tone = kitchenAuditStatusTone(String(audit.status ?? ''));
                                                const from = String(audit.period_start ?? '').slice(0, 10) || '—';
                                                const to = String(audit.period_end ?? '').slice(0, 10) || '—';
                                                // الهاتف: MM-DD يكفي داخل عمود ضيق؛ السنة الكاملة على الشاشات الأوسع.
                                                const shortRange =
                                                    from.length === 10 && to.length === 10 && from.slice(0, 4) === to.slice(0, 4)
                                                        ? `${from.slice(5)} ← ${to.slice(5)}`
                                                        : `${from} ← ${to}`;
                                                return (
                                                    <tr key={String(audit.id)} className="border-b border-hairline hover:bg-surface-hover">
                                                        <td className="px-sm py-xxs text-ink">
                                                            <span className="block" dir="ltr">
                                                                {String(audit.audit_number ?? `#${String(audit.id)}`)}
                                                            </span>
                                                            <span className="block text-caption text-faint sm:hidden" dir="ltr">
                                                                {shortRange}
                                                            </span>
                                                        </td>
                                                        <td className="hidden px-sm py-xxs text-body-sm text-muted sm:table-cell" dir="ltr">
                                                            {`${from} ← ${to}`}
                                                        </td>
                                                        <td
                                                            className="erp-numeric hidden px-sm py-xxs text-end text-body-sm sm:table-cell"
                                                            dir="ltr"
                                                        >
                                                            {formatKitchenQty(Number(audit.total_items ?? (audit.items ?? []).length))}
                                                        </td>
                                                        <td
                                                            className={`px-sm py-xxs text-body-sm whitespace-nowrap ${STATUS_TEXT_CLASS[tone]}`}
                                                        >
                                                            {KITCHEN_AUDIT_STATUS_AR[String(audit.status ?? '')] ??
                                                                String(audit.status ?? '—')}
                                                        </td>
                                                        <td className="px-sm py-xxs text-end">
                                                            <button
                                                                type="button"
                                                                className={SECONDARY_BUTTON_CLASS}
                                                                onClick={() => setAuditId(String(audit.id))}
                                                            >
                                                                فتح
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-sm">
                                <div>
                                    <p className="text-body-md text-ink" dir="ltr">
                                        {String(selectedAudit.audit_number ?? `#${String(selectedAudit.id)}`)}
                                    </p>
                                    <p className="text-caption text-muted">
                                        {`${KITCHEN_AUDIT_PERIOD_AR[String(selectedAudit.period ?? '')] ?? String(selectedAudit.period ?? '')} · ${
                                            KITCHEN_AUDIT_STATUS_AR[String(selectedAudit.status ?? '')] ??
                                            String(selectedAudit.status ?? '')
                                        }`}
                                    </p>
                                </div>
                                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setAuditId(null)}>
                                    رجوع للقائمة
                                </button>
                            </div>

                            <TableScroll label="بنود جرد المطبخ">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                النظام
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                العدّ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                الفرق
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedAudit.items ?? []).slice(0, 300).map((item) => {
                                            const variance =
                                                Number(counts[String(item.id)] ?? item.counted_qty) - Number(item.system_qty ?? 0);
                                            return (
                                                <tr key={String(item.id)} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">
                                                        <span className="block break-words">
                                                            {String(item.item_name ?? `#${String(item.inventory_id)}`)}
                                                        </span>
                                                        <span className="block text-caption text-faint" dir="ltr">
                                                            {String(item.unit ?? '')}
                                                        </span>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-end text-body-sm" dir="ltr">
                                                        {formatKitchenQty(Number(item.system_qty ?? 0))}
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        <input
                                                            className={FIELD_CLASS}
                                                            inputMode="decimal"
                                                            disabled={!isCounting || String(selectedAudit.status) !== 'draft'}
                                                            value={
                                                                counts[String(item.id)] ?? formatKitchenQty(Number(item.counted_qty ?? 0))
                                                            }
                                                            onChange={(event) =>
                                                                setCounts((current) => ({
                                                                    ...current,
                                                                    [String(item.id)]: event.target.value,
                                                                }))
                                                            }
                                                        />
                                                    </td>
                                                    <td
                                                        className={`erp-numeric px-sm py-xxs text-end text-body-sm ${
                                                            Math.abs(variance) < 0.0005
                                                                ? 'text-muted'
                                                                : variance > 0
                                                                  ? 'text-success-text'
                                                                  : 'text-danger-text'
                                                        }`}
                                                        dir="ltr"
                                                    >
                                                        {formatKitchenQty(variance)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>

                            {String(selectedAudit.status) === 'draft' || String(selectedAudit.status) === 'submitted' ? (
                                <div className="rounded-md border border-hairline p-sm">
                                    <SignaturePad
                                        label="توقيع صاحب الحساب"
                                        name="kitchen-audit-signature"
                                        onChange={setSignature}
                                        testId="kitchen-audit-signature"
                                    />
                                    <p className="mt-xs text-caption text-muted">{`يُوقّع باسم: ${signerName || '—'} — لا يُقبل اسم آخر.`}</p>
                                </div>
                            ) : null}

                            {auditError ? (
                                <p
                                    role="alert"
                                    className="rounded-md border border-danger/30 bg-danger-soft p-sm text-body-sm text-danger-text"
                                >
                                    {auditError}
                                </p>
                            ) : null}

                            <div className="flex flex-wrap justify-end gap-sm">
                                {String(selectedAudit.status) === 'draft' ? (
                                    <>
                                        <button
                                            type="button"
                                            className={SECONDARY_BUTTON_CLASS}
                                            onClick={() => setIsCounting((current) => !current)}
                                            disabled={!canWrite}
                                        >
                                            {isCounting ? 'إيقاف التعديل' : 'بدء العدّ'}
                                        </button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            loading={countMutation.isPending}
                                            onClick={() => saveCounts(selectedAudit)}
                                            disabled={!canWrite}
                                        >
                                            حفظ العدّ
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            loading={submitMutation.isPending}
                                            onClick={() => {
                                                const value = requireSignature();
                                                if (value) {
                                                    submitMutation.mutate({ audit: selectedAudit, signature: value });
                                                }
                                            }}
                                            disabled={!canWrite}
                                        >
                                            إرسال للمراجعة
                                        </Button>
                                    </>
                                ) : null}
                                {['draft', 'submitted'].includes(String(selectedAudit.status)) ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        loading={approveMutation.isPending}
                                        onClick={() => {
                                            const value = requireSignature();
                                            if (value) {
                                                approveMutation.mutate({ audit: selectedAudit, signature: value });
                                            }
                                        }}
                                        disabled={!canReview}
                                    >
                                        اعتماد وترحيل الفروق
                                    </Button>
                                ) : null}
                            </div>
                        </>
                    )}

                    {createOpen ? (
                        <section className="rounded-md border border-hairline-strong bg-surface-sunken p-sm">
                            <h3 className="text-body-md text-ink">جلسة جرد جديدة للمطبخ</h3>
                            <p className="mt-xxs text-caption text-muted">
                                تُبنى البنود من أرصدة مخزن المطبخ لحظة الإنشاء — العدّ الفعلي يبدأ مساويًا لرصيد النظام.
                            </p>
                            <div className="mt-sm grid gap-sm sm:grid-cols-2">
                                <Select
                                    label="الدورة"
                                    value={newPeriod}
                                    onValueChange={(value) => {
                                        const period = value as KitchenAuditPeriod;
                                        setNewPeriod(period);
                                        setNewStart(kitchenPeriodStart(period));
                                    }}
                                    options={KITCHEN_AUDIT_PERIODS.map((period) => ({
                                        value: period,
                                        label: KITCHEN_AUDIT_PERIOD_AR[period] ?? period,
                                    }))}
                                />
                                <Input
                                    label="من تاريخ"
                                    type="date"
                                    value={newStart}
                                    onChange={(event) => setNewStart(event.target.value)}
                                />
                                <Input label="إلى تاريخ" type="date" value={newEnd} onChange={(event) => setNewEnd(event.target.value)} />
                                <Input label="ملاحظات" value={newNotes} onChange={(event) => setNewNotes(event.target.value)} />
                            </div>
                            <div className="mt-sm flex flex-wrap justify-end gap-sm">
                                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setCreateOpen(false)}>
                                    إلغاء
                                </button>
                                <Button
                                    type="button"
                                    size="sm"
                                    loading={createAuditMutation.isPending}
                                    onClick={() =>
                                        createAuditMutation.mutate({
                                            period: newPeriod,
                                            start: newStart,
                                            end: newEnd,
                                            notes: newNotes,
                                        })
                                    }
                                    disabled={!newStart || !newEnd || newEnd < newStart}
                                >
                                    بدء الجلسة
                                </Button>
                            </div>
                        </section>
                    ) : null}
                </TabsContent>

                {/* ── المستندات ───────────────────────────────────────── */}
                <TabsContent value="documents" className="mt-md flex flex-col gap-sm">
                    {documentsQuery.isPending ? <StateLoading label="جارٍ قراءة مستندات التحويل…" /> : null}
                    {documentsQuery.isError ? (
                        <StateError
                            message={writeErrorMessage(documentsQuery.error, 'تعذّر قراءة مستندات المطبخ')}
                            onRetry={() => void documentsQuery.refetch()}
                        />
                    ) : null}
                    {documentsQuery.data && documents.length === 0 ? (
                        <StateEmpty title="لا مستندات" hint="لم يُسجَّل تحويل داخل أو خارج مخزن المطبخ بعد." />
                    ) : null}
                    {documents.length > 0 ? (
                        <TableScroll label="مستندات تحويل المطبخ">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المستند
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            من ← إلى
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            الأصناف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الحالة
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {documents.map((document) => (
                                        <tr key={String(document.id)} className="border-b border-hairline">
                                            <td className="px-sm py-xxs text-ink" dir="ltr">
                                                {String(document.id)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {`${String(document.source_name ?? '—')} ← ${String(document.destination_name ?? '—')}`}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm" dir="ltr">
                                                {formatKitchenQty((document.items ?? []).length)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{String(document.status ?? '—')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : null}
                </TabsContent>
            </Tabs>
        </Dialog>
    );
}
