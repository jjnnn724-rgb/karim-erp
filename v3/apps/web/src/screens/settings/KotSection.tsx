import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { type KotSettings, kotSettingsSchema } from '../../lib/settings';
import { kotWriteVisible, saveKotSettings } from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Checkbox } from '../../ui/Checkbox';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { FieldGrid, formatStamp, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, useDraftForm } from './shared';

interface KotForm {
    enabled: boolean;
    copies: string;
    include_notes: boolean;
}

function toForm(kot: KotSettings): KotForm {
    return {
        enabled: kot.enabled,
        copies: String(kot.copies),
        include_notes: kot.include_notes,
    };
}

export function KotSection() {
    const auth = useAuthState();
    const canWrite = kotWriteVisible(auth.user?.role);
    const [error, setError] = useState('');

    const query = useQuery({
        queryKey: ['settings', 'kot'],
        queryFn: ({ signal }) => fetchJson(kotSettingsSchema, '/api/pos/kot/settings', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const data = query.data ?? null;
    const signature = data ? JSON.stringify(data) : '';
    const draft = useDraftForm<KotForm>(data ? toForm(data) : null, signature);

    const save = useWriteMutation<KotForm, void>({
        mutationFn: (form) =>
            saveKotSettings({
                enabled: form.enabled,
                copies: Number(form.copies),
                include_notes: form.include_notes,
            }),
        successTitle: () => 'تم حفظ إعدادات التذاكر',
        invalidate: [['settings', 'kot']],
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ إعدادات التذاكر'));
        },
    });

    if (!draft || !data) {
        return (
            <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="تذاكر المطبخ"
                english="Kitchen Order Tickets"
                badge={
                    <Badge variant={data.enabled ? 'success' : 'neutral'} dot>
                        {data.enabled ? 'مفعّلة' : 'موقوفة'}
                    </Badge>
                }
                actions={<ReadOnlyBadge visible={canWrite} />}
            >
                <Switch
                    label="تفعيل التذاكر عند البيع"
                    checked={draft.value.enabled}
                    disabled={!canWrite}
                    onCheckedChange={(checked) => {
                        draft.set('enabled', checked);
                    }}
                />
                <FieldGrid>
                    <Select
                        label="عدد النسخ"
                        options={[1, 2, 3].map((count) => ({
                            value: String(count),
                            label: `${String(count)} ${count === 1 ? 'نسخة' : 'نسخ'}`,
                        }))}
                        value={draft.value.copies}
                        disabled={!canWrite}
                        onValueChange={(next) => {
                            draft.set('copies', next);
                        }}
                    />
                    <div className="flex items-end">
                        <Checkbox
                            label="إظهار اسم الضيف والملاحظات"
                            checked={draft.value.include_notes}
                            disabled={!canWrite}
                            onCheckedChange={(checked) => {
                                draft.set('include_notes', checked === true);
                            }}
                        />
                    </div>
                </FieldGrid>
                {data.updated_at ? (
                    <p className="text-caption text-faint">
                        آخر تحديث {formatStamp(data.updated_at)}
                        {data.updated_by ? ` — ${data.updated_by}` : ''}
                    </p>
                ) : null}
            </SectionCard>

            <SaveBar
                dirty={draft.dirty}
                saving={save.isPending}
                {...(error ? { error } : {})}
                onSave={() => {
                    setError('');
                    save.mutate(draft.value);
                }}
                onReset={() => {
                    setError('');
                    draft.reset();
                }}
                disabled={!canWrite}
            />
        </div>
    );
}
