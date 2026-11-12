import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import { intOf, num } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import type { ZkDeviceRow } from '../lib/zkteco';
import {
    autoLinkZkMappings,
    fetchZkMappings,
    fetchZkStoredUsers,
    importZkUsers,
    scanZkNetwork,
    setZkMapping,
    type ZkMappingEmployee,
    type ZkScanResult,
    zkScanDeviceName,
} from '../lib/zkteco-admin';
import { canWriteZk, createZkDevice, type ZkDeviceForm } from '../lib/zkteco-write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';
import { SectionCard } from './Reports';
import { StateEmpty, StateError, TableScroll } from './TableState';

/**
 * أدوات V2 المتبقية لأجهزة البصمة: مسح الشبكة، استيراد مستخدمي الجهاز
 * كموظفين، والربط التلقائي/اليدوي للأرقام. الأدوار من الخادم حرفيًّا
 * (`admin|hr` كتابةً، والباقي قراءة).
 */

export function ZktecoAdmin({ devices }: { devices: readonly ZkDeviceRow[] }) {
    const auth = useAuthState();
    const writable = canWriteZk(auth.user?.role);
    const confirm = useConfirm();
    const { toast } = useToast();

    const mappingsQuery = useQuery({
        queryKey: ['zkteco', 'mappings'],
        queryFn: ({ signal }) => fetchZkMappings(signal),
    });

    const [filter, setFilter] = useState('');
    const [scanOpen, setScanOpen] = useState(false);
    const [scanResult, setScanResult] = useState<ZkScanResult | null>(null);

    const [importOpen, setImportOpen] = useState(false);
    const [importDeviceId, setImportDeviceId] = useState('');
    const [importDept, setImportDept] = useState('');
    const [importError, setImportError] = useState('');

    const storedUsersQuery = useQuery({
        queryKey: ['zkteco', 'stored-users', importDeviceId],
        queryFn: ({ signal }) => fetchZkStoredUsers(importDeviceId, signal),
        enabled: importOpen && importDeviceId !== '',
    });

    const [mappingTarget, setMappingTarget] = useState<ZkMappingEmployee | null>(null);
    const [mappingValue, setMappingValue] = useState('');
    const [mappingError, setMappingError] = useState('');

    const scanMutation = useWriteMutation<void, ZkScanResult>({
        mutationFn: async () => {
            const result = await scanZkNetwork();
            setScanResult(result);
            toast({
                title: 'مسح الشبكة',
                description: result.message ?? (result.found?.length ? 'وُجدت أجهزة' : 'لا أجهزة'),
                variant: 'info',
            });
            return result;
        },
        invalidate: [['zkteco', 'status']],
    });

    const importMutation = useWriteMutation<void, { created: number; message: string }>({
        mutationFn: async () => {
            const department = importDept.trim();
            const result = await importZkUsers(importDeviceId, department ? { department } : {});
            return { created: result.created, message: result.message };
        },
        invalidate: [
            ['zkteco', 'status'],
            ['zkteco', 'mappings'],
            ['zkteco', 'coverage'],
        ],
        silentError: true,
        onError: (cause) => setImportError(writeErrorMessage(cause, 'تعذّر الاستيراد من الجهاز')),
        onSuccess: (result) => {
            setImportError('');
            toast({
                title: result.created > 0 ? 'تم الاستيراد' : 'لا جديد',
                description: result.message || `أُنشئ ${String(result.created)} موظفًا`,
                variant: result.created > 0 ? 'success' : 'info',
            });
        },
    });

    const autoMutation = useWriteMutation<void, { linked: number; message: string }>({
        mutationFn: async () => {
            const result = await autoLinkZkMappings();
            return { linked: result.linked, message: result.message };
        },
        invalidate: [
            ['zkteco', 'status'],
            ['zkteco', 'mappings'],
            ['zkteco', 'coverage'],
        ],
        onSuccess: (result) => {
            toast({
                title: result.linked > 0 ? 'تم الربط التلقائي' : 'لا تغيير',
                description: result.message || `رُبط ${String(result.linked)} موظفًا`,
                variant: result.linked > 0 ? 'success' : 'info',
            });
        },
    });

    const saveMappingMutation = useWriteMutation<void, { name: string; attached: number }>({
        mutationFn: async () => {
            if (!mappingTarget) {
                throw new Error('لم يُحدَّد موظف');
            }
            const result = await setZkMapping(mappingTarget.id, mappingValue);
            return { name: result.name || String(mappingTarget.name ?? ''), attached: result.attached };
        },
        invalidate: [
            ['zkteco', 'status'],
            ['zkteco', 'mappings'],
            ['zkteco', 'coverage'],
        ],
        silentError: true,
        onError: (cause) => setMappingError(writeErrorMessage(cause, 'تعذّر حفظ الربط')),
        onSuccess: (result) => {
            setMappingTarget(null);
            setMappingError('');
            toast({
                title: 'حُفظ الربط',
                description:
                    result.attached > 0 ? `${result.name}: أُسندت ${String(result.attached)} بصمة سابقة` : `${result.name}: حُدّث رقم البصمة`,
                variant: 'success',
            });
        },
    });

    const addScannedDevice = async (hit: NonNullable<ZkScanResult['found']>[number]): Promise<void> => {
        const name = zkScanDeviceName(hit);
        const accepted = await confirm(`إضافة الجهاز «${name}» على ${hit.ip}؟`);
        if (!accepted) {
            return;
        }
        const form: ZkDeviceForm = {
            name,
            ipAddress: hit.ip,
            port: String(hit.port ?? 4370),
            commKey: '0',
            syncIntervalSeconds: '30',
            enabled: true,
        };
        try {
            await createZkDevice(form);
            toast({ title: 'أُضيف الجهاز', description: `${name} · ${hit.ip}`, variant: 'success' });
        } catch (cause) {
            toast({ title: 'تعذّرت إضافة الجهاز', description: writeErrorMessage(cause), variant: 'error' });
        }
    };

    const employees = mappingsQuery.data?.employees ?? [];
    const unmapped = mappingsQuery.data?.unmapped ?? [];
    const filtered = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (!needle) {
            return employees;
        }
        return employees.filter(
            (row) =>
                String(row.name ?? '')
                    .toLowerCase()
                    .includes(needle) ||
                String(row.employeeId ?? '')
                    .toLowerCase()
                    .includes(needle) ||
                String(row.deviceUserId ?? '')
                    .toLowerCase()
                    .includes(needle),
        );
    }, [employees, filter]);
    const linkedCount = employees.filter((row) => String(row.deviceUserId ?? '').trim() !== '').length;

    return (
        <>
            {writable ? (
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={scanMutation.isPending}
                        onClick={() => {
                            setScanResult(null);
                            setScanOpen(true);
                            if (!scanMutation.isPending) {
                                scanMutation.mutate();
                            }
                        }}
                    >
                        {scanMutation.isPending ? 'جارٍ مسح الشبكة…' : 'مسح الشبكة'}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={devices.length === 0}
                        onClick={() => {
                            setImportError('');
                            setImportDeviceId(devices[0]?.id ?? '');
                            setImportDept('');
                            setImportOpen(true);
                        }}
                    >
                        استيراد مستخدمي الجهاز
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={autoMutation.isPending}
                        onClick={() => autoMutation.mutate()}
                    >
                        {autoMutation.isPending ? 'جارٍ الربط…' : 'ربط تلقائي بالأرقام الوظيفية'}
                    </Button>
                </div>
            ) : null}

            <SectionCard
                title="ربط الموظفين بأرقام البصمة"
                english="Employee mappings"
                actions={
                    <span className="text-body-sm text-muted" role="status">
                        {`مربوط ${intOf(linkedCount)} من ${intOf(employees.length)} · غير مربوط على الجهاز ${intOf(unmapped.length)}`}
                    </span>
                }
            >
                {mappingsQuery.isError ? (
                    <StateError
                        message={writeErrorMessage(mappingsQuery.error, 'تعذّر جلب الربط')}
                        onRetry={() => {
                            void mappingsQuery.refetch();
                        }}
                    />
                ) : employees.length === 0 ? (
                    <StateEmpty title="لا موظفين" hint="تعذّر قراءة قائمة الموظفين أو لا يوجد موظفون." />
                ) : (
                    <div className="flex flex-col gap-sm">
                        <Input
                            label="بحث"
                            value={filter}
                            placeholder="بالاسم أو الرقم الوظيفي أو رقم البصمة"
                            onChange={(event) => setFilter(event.target.value)}
                        />
                        <TableScroll label="جدول ربط الموظفين بأرقام البصمة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الموظف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الرقم الوظيفي
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            رقم البصمة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            بصمات اليوم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            30 يومًا
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            ملاحظة
                                        </th>
                                        {writable ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                إجراء
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((row) => {
                                        const number = String(row.deviceUserId ?? '').trim();
                                        return (
                                            <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="px-sm py-xxs text-ink">
                                                    {String(row.name ?? '') || `#${row.id}`}
                                                    {row.department ? (
                                                        <span className="text-caption text-faint"> · {row.department}</span>
                                                    ) : null}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {String(row.employeeId ?? '') || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {number ? number : <Badge variant="warning">بلا رقم</Badge>}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {intOf(num(row.todayPunches))}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {intOf(num(row.punches30d))}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm">
                                                    {row.altOwnedBy ? (
                                                        <span className="text-danger-text">
                                                            {`الرقم البديل مملوك لـ ${row.altOwnedBy}`}
                                                        </span>
                                                    ) : row.deviceAccountName ? (
                                                        <span className="text-muted">{row.deviceAccountName}</span>
                                                    ) : (
                                                        <span className="text-faint">—</span>
                                                    )}
                                                </td>
                                                {writable ? (
                                                    <td className="px-sm py-xxs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                setMappingError('');
                                                                setMappingValue(number);
                                                                setMappingTarget(row);
                                                            }}
                                                        >
                                                            {number ? 'تعديل الربط' : 'ربط'}
                                                        </Button>
                                                    </td>
                                                ) : null}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </TableScroll>
                        {filtered.length === 0 ? (
                            <p className="text-body-sm text-muted" role="status">
                                لا نتائج مطابقة للبحث.
                            </p>
                        ) : null}
                    </div>
                )}

                {unmapped.length > 0 ? (
                    <div className="mt-sm rounded-md border border-warning bg-surface p-sm">
                        <p className="text-body-sm text-warning-text">
                            {`${intOf(unmapped.length)} رقمًا على الجهاز بلا موظف — اربط كل رقم من عمود «رقم البصمة» أعلاه.`}
                        </p>
                        <ul className="mt-xs flex flex-wrap gap-xxs">
                            {unmapped.slice(0, 20).map((row) => (
                                <li
                                    key={String(row.deviceUserId)}
                                    className="erp-numeric rounded-sm border border-hairline px-xs py-xxs text-caption text-muted"
                                >
                                    {`${String(row.deviceUserId ?? '')} · ${intOf(num(row.punches))} بصمة`}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </SectionCard>

            <Dialog
                open={scanOpen}
                onOpenChange={setScanOpen}
                title="مسح الشبكة"
                description="يفحص شبكات الخادم المحلية على منفذ 4370 ويصافح أجهزة ZKTeco."
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setScanOpen(false)}>
                        إغلاق
                    </Button>
                }
            >
                {scanMutation.isPending ? (
                    <p className="text-body-sm text-muted" role="status">
                        المسح جارٍ… قد يستغرق دقائق على الشبكات الواسعة.
                    </p>
                ) : scanMutation.isError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {writeErrorMessage(scanMutation.error, 'تعذّر مسح الشبكة')}
                    </p>
                ) : scanResult && (scanResult.found?.length ?? 0) > 0 ? (
                    <ul className="flex flex-col gap-xs">
                        {scanResult.found?.map((hit) => (
                            <li
                                key={`${hit.ip}:${String(hit.port ?? '')}`}
                                className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline pb-xs last:border-0 last:pb-0"
                            >
                                <span className="text-body-md text-ink">
                                    {zkScanDeviceName(hit)}
                                    <small className="erp-numeric ms-xs text-caption text-muted" dir="ltr">
                                        {`${hit.ip}:${String(hit.port ?? 4370)}`}
                                        {hit.serial ? ` · S/N ${hit.serial}` : ''}
                                    </small>
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        void addScannedDevice(hit);
                                    }}
                                >
                                    إضافة الجهاز
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : scanResult ? (
                    <p className="text-body-sm text-muted" role="status">
                        {scanResult.message ?? 'لا أجهزة بصمة على الشبكة.'}
                    </p>
                ) : (
                    <p className="text-body-sm text-muted">اضغط «مسح الشبكة» للبدء.</p>
                )}
            </Dialog>

            <Dialog
                open={importOpen}
                onOpenChange={(next) => {
                    if (!next && importMutation.isPending) {
                        return;
                    }
                    setImportOpen(next);
                }}
                title="استيراد مستخدمي الجهاز"
                description="يُنشئ موظفًا لكل مستخدم جديد على الجهاز، والرقم الوظيفي = رقم البصمة. الموجود يُتخطى تلقائيًا."
                size="md"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setImportOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={importDeviceId === '' || importMutation.isPending}
                            onClick={() => {
                                setImportError('');
                                importMutation.mutate();
                            }}
                        >
                            {importMutation.isPending ? 'جارٍ الاستيراد…' : 'استيراد'}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label="الجهاز"
                        options={devices.map((device) => ({ value: device.id, label: device.name }))}
                        value={importDeviceId}
                        onValueChange={(value) => setImportDeviceId(value)}
                    />
                    <Input
                        label="كود القسم (اختياري)"
                        value={importDept}
                        placeholder="قسم يُسند للموظفين الجدد"
                        onChange={(event) => setImportDept(event.target.value)}
                    />
                    {storedUsersQuery.isPending && importDeviceId !== '' ? (
                        <p className="text-body-sm text-muted" role="status">
                            جارٍ قراءة مستخدمي الجهاز…
                        </p>
                    ) : storedUsersQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(storedUsersQuery.error, 'تعذّرت قراءة مستخدمي الجهاز')}
                        </p>
                    ) : storedUsersQuery.data ? (
                        <p className="text-body-sm text-muted" role="status">
                            {`على الجهاز ${intOf(num(storedUsersQuery.data.count))} مستخدمًا — غير المرتبطين بموظف: ${intOf(
                                (storedUsersQuery.data.users ?? []).filter((user) => user.employeeId == null).length,
                            )}`}
                        </p>
                    ) : null}
                    {importError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {importError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={mappingTarget !== null}
                onOpenChange={(next) => {
                    if (!next && saveMappingMutation.isPending) {
                        return;
                    }
                    if (!next) {
                        setMappingTarget(null);
                    }
                }}
                title="رقم البصمة للموظف"
                description={String(mappingTarget?.name ?? '')}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setMappingTarget(null)}>
                            إغلاق
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={saveMappingMutation.isPending}
                            onClick={() => {
                                setMappingError('');
                                saveMappingMutation.mutate();
                            }}
                        >
                            {saveMappingMutation.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Input
                        label="رقم البصمة على الجهاز"
                        value={mappingValue}
                        dir="ltr"
                        maxLength={64}
                        hint="اتركه فارغًا لفكّ الربط. رقم واحد لموظف واحد."
                        onChange={(event) => setMappingValue(event.target.value)}
                    />
                    {mappingValue.trim() !== '' ? (
                        <p className="text-caption text-muted" role="status">
                            ستُنسب البصمات السابقة لهذا الرقم إلى هذا الموظف عند الحفظ.
                        </p>
                    ) : null}
                    {mappingError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {mappingError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
