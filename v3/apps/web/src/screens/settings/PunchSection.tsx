import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useMemo, useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider';
import { TableScroll } from '../../components/TableState';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import {
    entityPageSchema,
    type PunchAttempts,
    type PunchDevice,
    type PunchFace,
    type PunchSettings,
    punchAttemptsSchema,
    punchDevicesSchema,
    punchFacesSchema,
    punchSettingsSchema,
} from '../../lib/settings';
import {
    enrollFaceV2,
    PUNCH_ROLES,
    punchVisible,
    removeFace,
    roleIn,
    savePunchSettings,
    unbindPunchDevice,
} from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { useToast } from '../../ui/Toast';
import { FieldGrid, formatNumber, formatStamp, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, useDraftForm } from './shared';

type FieldKind = 'bool' | 'int' | 'float' | 'coord';

interface PunchField {
    key: string;
    label: string;
    kind: FieldKind;
    def: string;
    min?: number;
    max?: number;
    step?: number;
}

const FIELDS: readonly PunchField[] = [
    { key: 'punch_portal_enabled', label: 'تفعيل البصمة الذاتية', kind: 'bool', def: 'false' },
    { key: 'punch_geofence_enabled', label: 'قيد الموقع (Geofence)', kind: 'bool', def: 'false' },
    { key: 'punch_device_binding', label: 'ربط جهاز واحد', kind: 'bool', def: 'false' },
    { key: 'punch_device_auto_rebind', label: 'الربط التلقائي للجهاز', kind: 'bool', def: 'true' },
    { key: 'punch_selfie_enabled', label: 'لقطة تحقق', kind: 'bool', def: 'false' },
    { key: 'punch_face_enabled', label: 'محرك الوجه الأساسي', kind: 'bool', def: 'false' },
    { key: 'punch_face_v2_enabled', label: 'الوجه المتقدم ArcFace', kind: 'bool', def: 'false' },
    { key: 'punch_face_threshold', label: 'عتبة الأساسي', kind: 'float', def: '0.55', min: 0.3, max: 0.9, step: 0.01 },
    { key: 'punch_face_v2_threshold', label: 'عتبة المتقدم', kind: 'float', def: '0.42', min: 0.2, max: 0.8, step: 0.01 },
    { key: 'punch_radius_meters', label: 'النطاق (م)', kind: 'int', def: '120', min: 50, max: 500 },
    { key: 'punch_max_accuracy_m', label: 'دقة الموقع (م)', kind: 'int', def: '50', min: 10, max: 200 },
    { key: 'punch_max_fix_age_s', label: 'قدم GPS (ث)', kind: 'int', def: '30', min: 5, max: 120 },
    { key: 'punch_teleport_check', label: 'فحص التنقل المستحيل', kind: 'bool', def: 'true' },
    { key: 'punch_max_teleport_kmh', label: 'أقصى سرعة (كم/س)', kind: 'int', def: '250', min: 50, max: 1000 },
    { key: 'punch_geo_strict_multi_fix', label: 'صرامة GPS: قراءة واحدة لا تكفي', kind: 'bool', def: 'false' },
    { key: 'punch_strict_geofence', label: 'منطقة الغموض مرفوضة', kind: 'bool', def: 'false' },
    { key: 'punch_max_clock_skew_s', label: 'أقصى انحراف ساعة (ث)', kind: 'int', def: '120', min: 10, max: 600 },
    { key: 'punch_face_strict', label: 'صرامة الوجه: كاميرا متعددة والتحقق من الخادم', kind: 'bool', def: 'false' },
    { key: 'punch_face_min_samples', label: 'أقل عينات الوجه', kind: 'int', def: '2', min: 1, max: 5 },
    { key: 'punch_face_replay_min_distance', label: 'أدنى مسافة إعادة تشغيل', kind: 'float', def: '0.004', min: 0, max: 0.2, step: 0.001 },
    { key: 'punch_restaurant_lat', label: 'خط العرض', kind: 'coord', def: '' },
    { key: 'punch_restaurant_lng', label: 'خط الطول', kind: 'coord', def: '' },
];

const BOOL_FIELDS = FIELDS.filter((field) => field.kind === 'bool');
const NUMBER_FIELDS = FIELDS.filter((field) => field.kind !== 'bool' && field.kind !== 'coord');
const COORD_FIELDS = FIELDS.filter((field) => field.kind === 'coord');

interface PunchForm {
    values: Record<string, string>;
}

function valuesFrom(settings: PunchSettings): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of FIELDS) {
        const stored = settings.values[field.key];
        values[field.key] = stored === undefined || stored === '' ? field.def : stored;
    }
    return values;
}

function changedPatch(value: Record<string, string>, base: Record<string, string>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const field of FIELDS) {
        const next = value[field.key] ?? field.def;
        if (next === (base[field.key] ?? field.def)) {
            continue;
        }
        if (field.kind === 'bool') {
            patch[field.key] = next === 'true';
        } else if (field.kind === 'coord') {
            patch[field.key] = next.trim() === '' ? null : next.trim();
        } else {
            patch[field.key] = next;
        }
    }
    return patch;
}

const ATTEMPT_DECISION: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
    accepted: { label: 'مقبولة', tone: 'success' },
    rejected: { label: 'مرفوضة', tone: 'danger' },
};

/**
 * قراءة صورة الوجه لرفعها — تُصغَّر إلى 480px كحد أقصى وتُضغط JPEG ‎0.85.
 * الصورة الأصلية من كاميرا الهاتف (عدة MB) + base64 تتجاوز حد جسم الطلب العام
 * (2MB) فيفشل التسجيل بـ HTTP 413 قبل أن يصل إلى الخادم.
 */
function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!/^image\//.test(file.type)) {
            reject(new Error('الملف المختار ليس صورة — اختر صورة واضحة للوجه'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
            image.onload = () => {
                const max = 480;
                const scale = Math.min(1, max / Math.max(image.width || max, image.height || max));
                const w = Math.max(1, Math.round((image.width || max) * scale));
                const h = Math.max(1, Math.round((image.height || max) * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d')?.drawImage(image, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    });
}

export function PunchSection() {
    const auth = useAuthState();
    const canWrite = punchVisible(auth.user?.role);
    const isAdmin = auth.user?.role === 'admin';
    const { toast } = useToast();
    const confirm = useConfirm();

    const [error, setError] = useState('');
    const [filter, setFilter] = useState('');
    const [enrollOpen, setEnrollOpen] = useState(false);
    const [targetUser, setTargetUser] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [enrollError, setEnrollError] = useState('');
    const [locating, setLocating] = useState(false);

    const settingsQuery = useQuery({
        queryKey: ['settings', 'punch'],
        queryFn: ({ signal }) => fetchJson(punchSettingsSchema, '/api/attendance/portal/settings-admin', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });
    const devicesQuery = useQuery({
        queryKey: ['settings', 'punch-devices'],
        queryFn: ({ signal }) => fetchJson(punchDevicesSchema, '/api/attendance/portal/punch-devices', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });
    const facesQuery = useQuery({
        queryKey: ['settings', 'punch-faces'],
        queryFn: ({ signal }) => fetchJson(punchFacesSchema, '/api/attendance/portal/face/list', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });
    const attemptsQuery = useQuery({
        queryKey: ['settings', 'punch-attempts', filter],
        queryFn: ({ signal }) => {
            const params = new URLSearchParams({ limit: '100' });
            if (filter) {
                params.set('decision', filter);
            }
            return fetchJson(punchAttemptsSchema, `/api/attendance/portal/attempts?${params.toString()}`, getAccessToken(), { signal });
        },
        refetchOnWindowFocus: false,
    });
    const usersQuery = useQuery({
        queryKey: ['settings', 'punch-users'],
        queryFn: ({ signal }) => fetchJson(entityPageSchema, '/api/users?limit=1000&page=1', getAccessToken(), { signal }),
        enabled: isAdmin,
        refetchOnWindowFocus: false,
    });

    const data = settingsQuery.data ?? null;
    const signature = useMemo(() => (data ? JSON.stringify(data.values) : ''), [data]);
    const draft = useDraftForm<PunchForm>(data ? { values: valuesFrom(data) } : null, signature);

    const save = useWriteMutation<Record<string, unknown>, void>({
        mutationFn: (patch) => savePunchSettings(patch),
        successTitle: () => 'تم حفظ إعدادات البصمة',
        invalidate: [['settings', 'punch']],
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ إعدادات البصمة'));
        },
    });

    const unbind = useWriteMutation<string, void>({
        mutationFn: (userId) => unbindPunchDevice(userId),
        successTitle: () => 'تم فك ربط الجهاز',
        invalidate: [['settings', 'punch-devices']],
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر فك الربط', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const dropFace = useWriteMutation<string, void>({
        mutationFn: (userId) => removeFace(userId),
        successTitle: () => 'تم حذف قالب الوجه',
        invalidate: [['settings', 'punch-faces']],
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر حذف القالب', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    const enroll = useWriteMutation<void, void>({
        mutationFn: async () => {
            const images: string[] = [];
            for (const file of files) {
                images.push(await readFile(file));
            }
            await enrollFaceV2(targetUser, images);
        },
        successTitle: () => 'تم تسجيل الوجه',
        invalidate: [['settings', 'punch-faces']],
        silentError: true,
        onSuccess: () => {
            setEnrollOpen(false);
            setFiles([]);
            setTargetUser('');
            setEnrollError('');
        },
        onError: (cause) => {
            setEnrollError(writeErrorMessage(cause, 'تعذّر تسجيل الوجه'));
        },
    });

    if (!draft || !data) {
        return (
            <QueryBoundary pending={settingsQuery.isPending} error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    const users = (usersQuery.data?.data ?? [])
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : {}))
        .filter((row) => row.active !== false && row.id !== undefined && row.id !== null)
        .map((row) => ({
            value: String(row.id),
            label: `${String(row.name || row.username || '')} (${String(row.username || '')})`,
        }));

    const patch = changedPatch(draft.value.values, draft.base.values);
    const dirtyKeys = Object.keys(patch);
    const devices: PunchDevice[] = devicesQuery.data ?? [];
    const faces: PunchFace[] = facesQuery.data ?? [];
    const attempts: PunchAttempts | null = attemptsQuery.data ?? null;

    const setField = (key: string, next: string) => {
        draft.set('values', { ...draft.value.values, [key]: next });
    };

    const captureLocation = () => {
        if (!navigator.geolocation) {
            toast({ title: 'الجهاز لا يدعم تحديد الموقع', variant: 'error' });
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setField('punch_restaurant_lat', position.coords.latitude.toFixed(7));
                setField('punch_restaurant_lng', position.coords.longitude.toFixed(7));
                setLocating(false);
            },
            () => {
                setLocating(false);
                toast({ title: 'تعذّر التقاط الموقع', variant: 'error' });
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
    };

    const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        const next = [...files, ...picked].slice(0, 8);
        if (!next.every((file) => file.type.startsWith('image/'))) {
            setEnrollError('اختر ملفات صور فقط');
            return;
        }
        setEnrollError('');
        setFiles(next);
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="بوابة البصمة"
                english="Self Punch Portal"
                badge={
                    <Badge variant={draft.value.values.punch_portal_enabled === 'true' ? 'success' : 'neutral'} dot>
                        {draft.value.values.punch_portal_enabled === 'true' ? 'مفعّلة' : 'موقوفة'}
                    </Badge>
                }
                actions={<ReadOnlyBadge visible={canWrite} />}
            >
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    {BOOL_FIELDS.filter((field) =>
                        ['punch_portal_enabled', 'punch_device_binding', 'punch_device_auto_rebind', 'punch_selfie_enabled'].includes(
                            field.key,
                        ),
                    ).map((field) => (
                        <Checkbox
                            key={field.key}
                            label={field.label}
                            checked={draft.value.values[field.key] === 'true'}
                            disabled={!canWrite}
                            onCheckedChange={(checked) => {
                                setField(field.key, checked === true ? 'true' : 'false');
                            }}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard title="الموقع والتحقق" english="Location & Trust" badge={<ReadOnlyBadge visible={canWrite} />}>
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    {BOOL_FIELDS.filter((field) =>
                        ['punch_geofence_enabled', 'punch_teleport_check', 'punch_geo_strict_multi_fix', 'punch_strict_geofence'].includes(
                            field.key,
                        ),
                    ).map((field) => (
                        <Checkbox
                            key={field.key}
                            label={field.label}
                            checked={draft.value.values[field.key] === 'true'}
                            disabled={!canWrite}
                            onCheckedChange={(checked) => {
                                setField(field.key, checked === true ? 'true' : 'false');
                            }}
                        />
                    ))}
                </div>
                <FieldGrid columns={3}>
                    {NUMBER_FIELDS.filter((field) =>
                        [
                            'punch_radius_meters',
                            'punch_max_accuracy_m',
                            'punch_max_fix_age_s',
                            'punch_max_teleport_kmh',
                            'punch_max_clock_skew_s',
                        ].includes(field.key),
                    ).map((field) => (
                        <Input
                            key={field.key}
                            label={field.label}
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            dir="ltr"
                            value={draft.value.values[field.key] ?? ''}
                            disabled={!canWrite}
                            onChange={(event) => {
                                setField(field.key, event.target.value);
                            }}
                        />
                    ))}
                </FieldGrid>
                <div className="flex flex-wrap items-end gap-sm">
                    {COORD_FIELDS.map((field) => (
                        <Input
                            key={field.key}
                            label={field.label}
                            dir="ltr"
                            containerClassName="w-44"
                            value={draft.value.values[field.key] ?? ''}
                            disabled={!canWrite}
                            onChange={(event) => {
                                setField(field.key, event.target.value);
                            }}
                        />
                    ))}
                    <Button variant="secondary" size="sm" loading={locating} disabled={!canWrite || locating} onClick={captureLocation}>
                        التقط الموقع
                    </Button>
                </div>
            </SectionCard>

            <SectionCard title="التحقق بالوجه" english="Face Verification" badge={<ReadOnlyBadge visible={canWrite} />}>
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    {BOOL_FIELDS.filter((field) =>
                        ['punch_face_enabled', 'punch_face_v2_enabled', 'punch_face_strict'].includes(field.key),
                    ).map((field) => (
                        <Checkbox
                            key={field.key}
                            label={field.label}
                            checked={draft.value.values[field.key] === 'true'}
                            disabled={!canWrite}
                            onCheckedChange={(checked) => {
                                setField(field.key, checked === true ? 'true' : 'false');
                            }}
                        />
                    ))}
                </div>
                <FieldGrid columns={3}>
                    {NUMBER_FIELDS.filter((field) =>
                        [
                            'punch_face_threshold',
                            'punch_face_v2_threshold',
                            'punch_face_min_samples',
                            'punch_face_replay_min_distance',
                        ].includes(field.key),
                    ).map((field) => (
                        <Input
                            key={field.key}
                            label={field.label}
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            dir="ltr"
                            value={draft.value.values[field.key] ?? ''}
                            disabled={!canWrite}
                            onChange={(event) => {
                                setField(field.key, event.target.value);
                            }}
                        />
                    ))}
                </FieldGrid>
            </SectionCard>

            <SaveBar
                dirty={dirtyKeys.length > 0}
                saving={save.isPending}
                {...(error ? { error } : {})}
                label={dirtyKeys.length ? `حفظ ${String(dirtyKeys.length)} تغيير` : 'حفظ التغييرات'}
                onSave={() => {
                    if (dirtyKeys.length === 0) {
                        return;
                    }
                    const coordsMissing =
                        draft.value.values.punch_geofence_enabled === 'true' &&
                        (!draft.value.values.punch_restaurant_lat || !draft.value.values.punch_restaurant_lng);
                    if (coordsMissing) {
                        setError('قيد الموقع مفعّل بلا إحداثيات — البصمة ستُرفض');
                        return;
                    }
                    setError('');
                    save.mutate(patch);
                }}
                onReset={() => {
                    setError('');
                    draft.reset();
                }}
                disabled={!canWrite}
            />

            <SectionCard
                title="الأجهزة المربوطة"
                english="Bound Devices"
                badge={<Badge variant="neutral">{formatNumber(devices.length)} جهاز</Badge>}
                actions={
                    <Button variant="ghost" size="sm" onClick={() => void devicesQuery.refetch()}>
                        تحديث
                    </Button>
                }
            >
                {devicesQuery.isPending ? (
                    <p className="text-body-sm text-muted">جارٍ التحميل…</p>
                ) : devicesQuery.error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {writeErrorMessage(devicesQuery.error, 'تعذّر تحميل الأجهزة')}
                    </p>
                ) : devices.length === 0 ? (
                    <p className="text-body-sm text-muted">لا أجهزة مربوطة.</p>
                ) : (
                    <TableScroll label="أجهزة البصمة المربوطة">
                        <table className="erp-table__grid">
                            <thead>
                                <tr>
                                    <th scope="col">الموظف</th>
                                    <th scope="col">الجهاز</th>
                                    <th scope="col">IP</th>
                                    <th scope="col">آخر ظهور</th>
                                    <th scope="col">إجراء</th>
                                </tr>
                            </thead>
                            <tbody>
                                {devices.map((device) => (
                                    <tr key={`${device.user_id}-${device.device_id}`}>
                                        <td>{device.name || device.username || device.user_id}</td>
                                        <td>
                                            <span className="erp-numeric" dir="ltr">
                                                {device.device_id.slice(0, 16) || '—'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="erp-numeric" dir="ltr">
                                                {device.bound_ip || '—'}
                                            </span>
                                        </td>
                                        <td>{formatStamp(device.last_seen_at)}</td>
                                        <td>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                loading={unbind.isPending}
                                                disabled={!canWrite || unbind.isPending}
                                                onClick={async () => {
                                                    const ok = await confirm(
                                                        `فك ربط جهاز ${device.name || device.username || device.user_id}؟`,
                                                    );
                                                    if (ok) {
                                                        unbind.mutate(device.user_id);
                                                    }
                                                }}
                                            >
                                                فك الربط
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            <SectionCard
                title="قوالب الوجه"
                english="Face Templates"
                badge={<Badge variant="neutral">{formatNumber(faces.length)} قالب</Badge>}
                actions={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => void facesQuery.refetch()}>
                            تحديث
                        </Button>
                        {isAdmin ? (
                            <Button
                                variant="primary"
                                size="sm"
                                disabled={!canWrite}
                                onClick={() => {
                                    setEnrollError('');
                                    setEnrollOpen(true);
                                }}
                            >
                                تسجيل وجه
                            </Button>
                        ) : null}
                    </>
                }
            >
                {facesQuery.isPending ? (
                    <p className="text-body-sm text-muted">جارٍ التحميل…</p>
                ) : facesQuery.error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {writeErrorMessage(facesQuery.error, 'تعذّر تحميل القوالب')}
                    </p>
                ) : faces.length === 0 ? (
                    <p className="text-body-sm text-muted">لا قوالب وجه مسجّلة.</p>
                ) : (
                    <TableScroll label="قوالب الوجه المسجلة">
                        <table className="erp-table__grid">
                            <thead>
                                <tr>
                                    <th scope="col">الموظف</th>
                                    <th scope="col">المحرك</th>
                                    <th scope="col">سُجّل في</th>
                                    <th scope="col">بواسطة</th>
                                    <th scope="col">إجراء</th>
                                </tr>
                            </thead>
                            <tbody>
                                {faces.map((face) => (
                                    <tr key={`${face.user_id}-${face.engine}`}>
                                        <td>{face.name || face.username || face.user_id}</td>
                                        <td>
                                            <Badge variant={face.engine === 'v2' ? 'success' : 'neutral'}>{face.engine}</Badge>
                                        </td>
                                        <td>{formatStamp(face.enrolled_at)}</td>
                                        <td>{face.enrolled_by || '—'}</td>
                                        <td>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                loading={dropFace.isPending}
                                                disabled={!canWrite || dropFace.isPending}
                                                onClick={async () => {
                                                    const ok = await confirm(`حذف قالب وجه ${face.name || face.username || face.user_id}؟`);
                                                    if (ok) {
                                                        dropFace.mutate(face.user_id);
                                                    }
                                                }}
                                            >
                                                حذف
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            <SectionCard
                title="سجل المحاولات"
                english="Punch Attempts"
                actions={
                    <div className="flex items-center gap-xs">
                        <Select
                            options={[
                                { value: '', label: 'الكل' },
                                { value: 'accepted', label: 'المقبولة' },
                                { value: 'rejected', label: 'المرفوضة' },
                            ]}
                            value={filter}
                            size="sm"
                            containerClassName="w-36"
                            onValueChange={(next) => {
                                setFilter(next);
                            }}
                        />
                        <Button variant="ghost" size="sm" onClick={() => void attemptsQuery.refetch()}>
                            تحديث
                        </Button>
                    </div>
                }
            >
                {attempts ? (
                    <div className="flex flex-wrap gap-xs">
                        <Badge variant="success">مقبولة 24س: {formatNumber(attempts.summary.accepted_24h)}</Badge>
                        <Badge variant="danger">مرفوضة 24س: {formatNumber(attempts.summary.rejected_24h)}</Badge>
                        <Badge variant="warning">خارج النطاق 7ي: {formatNumber(attempts.summary.out_of_range_7d)}</Badge>
                        <Badge variant="warning">جهاز مختلف 7ي: {formatNumber(attempts.summary.device_mismatch_7d)}</Badge>
                    </div>
                ) : null}
                {attemptsQuery.isPending ? (
                    <p className="text-body-sm text-muted">جارٍ التحميل…</p>
                ) : attemptsQuery.error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {writeErrorMessage(attemptsQuery.error, 'تعذّر تحميل السجل')}
                    </p>
                ) : !attempts || attempts.attempts.length === 0 ? (
                    <p className="text-body-sm text-muted">لا محاولات مسجّلة.</p>
                ) : (
                    <TableScroll label="سجل محاولات البصمة">
                        <table className="erp-table__grid">
                            <thead>
                                <tr>
                                    <th scope="col">الوقت</th>
                                    <th scope="col">المستخدم</th>
                                    <th scope="col">القرار</th>
                                    <th scope="col">السبب</th>
                                    <th scope="col">المسافة</th>
                                    <th scope="col">الدقة</th>
                                    <th scope="col">السرعة</th>
                                    <th scope="col">IP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {attempts.attempts.map((attempt) => {
                                    const decision = ATTEMPT_DECISION[attempt.decision] ?? {
                                        label: attempt.decision,
                                        tone: 'neutral' as const,
                                    };
                                    return (
                                        <tr key={attempt.id}>
                                            <td>{formatStamp(attempt.attempted_at)}</td>
                                            <td>{attempt.username || '—'}</td>
                                            <td>
                                                <Badge variant={decision.tone}>{decision.label}</Badge>
                                            </td>
                                            <td className="text-muted">{attempt.reject_code || '—'}</td>
                                            <td>
                                                <span className="erp-numeric" dir="ltr">
                                                    {attempt.distance_m === null ? '—' : String(Math.round(attempt.distance_m))}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="erp-numeric" dir="ltr">
                                                    {attempt.accuracy_m === null ? '—' : String(Math.round(attempt.accuracy_m))}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="erp-numeric" dir="ltr">
                                                    {attempt.teleport_kmh === null ? '—' : String(Math.round(attempt.teleport_kmh))}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="erp-numeric" dir="ltr">
                                                    {attempt.remote_ip || '—'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            <Dialog
                open={enrollOpen}
                onOpenChange={setEnrollOpen}
                title="تسجيل وجه"
                size="lg"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setEnrollOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            loading={enroll.isPending}
                            disabled={enroll.isPending || !targetUser || files.length === 0}
                            onClick={() => enroll.mutate()}
                        >
                            تسجيل
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label="الموظف"
                        options={users}
                        placeholder="اختر الموظف"
                        value={targetUser}
                        onValueChange={(next) => {
                            setTargetUser(next);
                        }}
                    />
                    <Input label="لقطات الوجه" type="file" accept="image/*" capture="user" multiple onChange={pickFiles} />
                    {files.length ? <p className="text-body-sm text-muted">{String(files.length)} لقطة</p> : null}
                    {enrollError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {enrollError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </div>
    );
}

export function canOpenPunch(role: string | null | undefined): boolean {
    return roleIn(role, PUNCH_ROLES);
}
