import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { type HrCardSettings, hrCardSettingsSchema } from '../../lib/settings';
import { saveHrCardSettings, settingsWriteVisible } from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Input } from '../../ui/Input';
import { FieldGrid, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, useDraftForm } from './shared';

export function CardsSection() {
    const auth = useAuthState();
    const canWrite = settingsWriteVisible(auth.user?.role);
    const [error, setError] = useState('');

    const query = useQuery({
        queryKey: ['settings', 'hr-card'],
        queryFn: ({ signal }) => fetchJson(hrCardSettingsSchema, '/api/hr/card-settings', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const data: HrCardSettings | null = query.data ?? null;
    const signature = data ? JSON.stringify(data) : '';
    const draft = useDraftForm<HrCardSettings>(data, signature);

    const save = useWriteMutation<HrCardSettings, void>({
        mutationFn: (form) => saveHrCardSettings(form),
        successTitle: () => 'تم حفظ إعدادات البطاقات',
        invalidate: [['settings', 'hr-card']],
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ إعدادات البطاقات'));
        },
    });

    if (!draft || !data) {
        return (
            <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    const submit = () => {
        const verifyBase = draft.value.verifyBase.trim();
        if (verifyBase && !/^https?:\/\//i.test(verifyBase)) {
            setError('رابط التحقق يجب أن يبدأ بـ http:// أو https://');
            return;
        }
        if (draft.value.emergencyPhone.length > 30) {
            setError('رقم الطوارئ أطول من 30 حرفًا');
            return;
        }
        setError('');
        save.mutate({ verifyBase, emergencyPhone: draft.value.emergencyPhone.trim() });
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard title="بطاقات الموظفين" english="Employee Cards" badge={<ReadOnlyBadge visible={canWrite} />}>
                <FieldGrid>
                    <Input
                        label="رابط التحقق (QR)"
                        placeholder="https://192.168.1.165:5000"
                        dir="ltr"
                        maxLength={255}
                        value={draft.value.verifyBase}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('verifyBase', event.target.value);
                        }}
                    />
                    <Input
                        label="هاتف الطوارئ"
                        placeholder="+966-5X-XXX-XXXX"
                        dir="ltr"
                        maxLength={30}
                        value={draft.value.emergencyPhone}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('emergencyPhone', event.target.value);
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
