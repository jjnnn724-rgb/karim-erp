import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useRef, useState } from 'react';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { type MainSettings, mainSettingsSchema, type PosLegacyMode } from '../../lib/settings';
import { SETTINGS_TEXT, saveMainSettings, settingsWriteVisible } from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { FieldGrid, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, ToggleGrid, useDraftForm } from './shared';

interface GeneralForm {
    name: string;
    currency: string;
    workStartHour: string;
    opening_balance_visible: boolean;
    pos_legacy_mode: PosLegacyMode;
    pos_official_path: string;
}

const POS_MODES = [
    { value: 'off', label: 'إيقاف — كل المسارات تعمل كما هي' },
    { value: 'banner', label: 'تنبيه على الشاشة القديمة «ستُوقف قريبًا»' },
    { value: 'redirect', label: 'تحويل الشاشة القديمة إلى الواجهة الرسمية' },
] as const;

function toForm(main: MainSettings): GeneralForm {
    return {
        name: main.name,
        currency: main.currency,
        workStartHour: String(main.workStartHour),
        opening_balance_visible: main.opening_balance_visible,
        pos_legacy_mode: main.pos_legacy_mode,
        pos_official_path: main.pos_official_path,
    };
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function GeneralSection() {
    const auth = useAuthState();
    const canWrite = settingsWriteVisible(auth.user?.role);
    const [error, setError] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const query = useQuery({
        queryKey: ['settings', 'main'],
        queryFn: ({ signal }) => fetchJson(mainSettingsSchema, '/api/settings', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const data = query.data ?? null;
    const signature = data ? JSON.stringify(data) : '';
    const draft = useDraftForm<GeneralForm>(data ? toForm(data) : null, signature);

    const save = useWriteMutation<GeneralForm & { id: string }, void>({
        mutationFn: (form) =>
            saveMainSettings(form.id, {
                name: form.name.trim(),
                currency: form.currency.trim() || 'SAR',
                workStartHour: Number(form.workStartHour),
                opening_balance_visible: form.opening_balance_visible,
                pos_legacy_mode: form.pos_legacy_mode,
                pos_official_path: form.pos_official_path.trim(),
            }),
        successTitle: () => SETTINGS_TEXT.saveSuccess,
        invalidate: [['settings', 'main']],
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, SETTINGS_TEXT.saveFailed));
        },
    });

    const logoSave = useWriteMutation<{ logoB64: string | null }, void>({
        mutationFn: (payload) => saveMainSettings(data?.id ?? 'main_settings', payload),
        successTitle: () => 'تم حفظ الشعار',
        invalidate: [['settings', 'main']],
        silentError: true,
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ الشعار'));
        },
    });

    if (!draft || !data) {
        return (
            <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    const value = draft.value;
    const logo = data.logoB64;

    const submit = () => {
        const name = value.name.trim();
        if (!name) {
            setError('اسم المنشأة مطلوب');
            return;
        }
        const hour = Number(value.workStartHour);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            setError('بداية الدوام يجب أن تكون ساعة صحيحة بين 0 و23');
            return;
        }
        setError('');
        save.mutate({ ...value, id: data.id });
    };

    const pickLogo = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        if (!file.type.startsWith('image/')) {
            setError('اختر ملف صورة');
            return;
        }
        if (file.size > MAX_LOGO_BYTES) {
            setError('حجم الصورة أكبر من 2 ميجابايت');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            if (!result) {
                setError('تعذّرت قراءة الصورة');
                return;
            }
            setError('');
            logoSave.mutate({ logoB64: result });
        };
        reader.onerror = () => {
            setError('تعذّرت قراءة الصورة');
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard title="بيانات المنشأة" english="Identity" badge={<ReadOnlyBadge visible={canWrite} />}>
                <FieldGrid columns={3}>
                    <Input
                        label="اسم المطعم"
                        value={value.name}
                        maxLength={255}
                        autoComplete="organization"
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('name', event.target.value);
                        }}
                    />
                    <Input
                        label="العملة"
                        value={value.currency}
                        maxLength={3}
                        dir="ltr"
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('currency', event.target.value);
                        }}
                    />
                    <Input
                        label="بداية الدوام"
                        hint="ساعة من 0 إلى 23"
                        type="number"
                        min={0}
                        max={23}
                        dir="ltr"
                        value={value.workStartHour}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('workStartHour', event.target.value);
                        }}
                    />
                </FieldGrid>

                <div className="flex flex-wrap items-center gap-md rounded-lg border border-hairline bg-surface-sunken p-sm">
                    {logo ? (
                        <img src={logo} alt="شعار المنشأة" className="size-20 rounded-lg border border-hairline object-cover" />
                    ) : (
                        <span className="flex size-20 items-center justify-center rounded-lg border border-dashed border-hairline-strong text-caption text-faint">
                            بلا شعار
                        </span>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickLogo} />
                    <div className="flex flex-wrap items-center gap-xs">
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={!canWrite || logoSave.isPending}
                            loading={logoSave.isPending}
                            onClick={() => {
                                fileRef.current?.click();
                            }}
                        >
                            رفع الشعار
                        </Button>
                        {logo ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={!canWrite || logoSave.isPending}
                                onClick={() => {
                                    logoSave.mutate({ logoB64: null });
                                }}
                            >
                                إزالة الشعار
                            </Button>
                        ) : null}
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="لوحة المخزون" english="Inventory Options" badge={<ReadOnlyBadge visible={canWrite} />}>
                <ToggleGrid>
                    <Checkbox
                        label="إظهار زر الرصيد الافتتاحي في شاشة المخزون"
                        checked={value.opening_balance_visible}
                        disabled={!canWrite}
                        onCheckedChange={(checked) => {
                            draft.set('opening_balance_visible', checked === true);
                        }}
                    />
                </ToggleGrid>
            </SectionCard>

            <SectionCard title="نقطة البيع" english="POS Routing" badge={<ReadOnlyBadge visible={canWrite} />}>
                <FieldGrid>
                    <Select
                        label="مسار الشاشة القديمة"
                        options={POS_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                        value={value.pos_legacy_mode}
                        disabled={!canWrite}
                        onValueChange={(next) => {
                            draft.set('pos_legacy_mode', next === 'banner' || next === 'redirect' ? next : 'off');
                        }}
                    />
                    <Input
                        label="المسار الرسمي"
                        placeholder="/app/cashier/"
                        maxLength={255}
                        dir="ltr"
                        value={value.pos_official_path}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('pos_official_path', event.target.value);
                        }}
                    />
                </FieldGrid>
            </SectionCard>

            <SaveBar
                dirty={draft.dirty}
                saving={save.isPending}
                {...(error ? { error } : {})}
                onSave={submit}
                onReset={() => {
                    setError('');
                    draft.reset();
                }}
                disabled={!canWrite}
            />
        </div>
    );
}
