import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { CARD_ACCENTS, type HrCardSettings, hrCardSettingsSchema } from '../../lib/settings';
import { saveHrCardSettings, settingsWriteVisible } from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Checkbox } from '../../ui/Checkbox';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { FieldGrid, QueryBoundary, ReadOnlyBadge, SaveBar, SectionCard, ToggleGrid, useDraftForm } from './shared';

/**
 * إعدادات البطاقة — كل ما يظهر على البطاقة المطبوعة قابل للتعديل هنا:
 * هوية المنشأة، عنوان البطاقة، الشعار النصي، الملاحظة القانونية، شارة الصورة،
 * لوحة الألوان، وإظهار فصيلة الدم/الـMRZ. الخادم يخزّنها في `hr_card_settings`
 * والمولّد يقرأها في كل طبعة — لا قيمة تصميم مثبّتة في الكود.
 */
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
        if (!draft.value.orgNameAr.trim()) {
            setError('اسم المنشأة بالعربية مطلوب');
            return;
        }
        if (!draft.value.cardTitle.trim()) {
            setError('عنوان البطاقة مطلوب');
            return;
        }
        setError('');
        save.mutate({
            verifyBase,
            emergencyPhone: draft.value.emergencyPhone.trim(),
            orgNameAr: draft.value.orgNameAr.trim(),
            orgNameEn: draft.value.orgNameEn.trim(),
            cardTitle: draft.value.cardTitle.trim(),
            slogan: draft.value.slogan.trim(),
            footerNote: draft.value.footerNote.trim(),
            badgeText: draft.value.badgeText.trim(),
            accent: draft.value.accent,
            showBlood: draft.value.showBlood,
            showMrz: draft.value.showMrz,
        });
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard title="بطاقات الموظفين" english="Employee Cards" badge={<ReadOnlyBadge visible={canWrite} />}>
                <FieldGrid>
                    <Input
                        label="اسم المنشأة (عربي)"
                        placeholder="مطاعم الشرفه العالمي"
                        maxLength={80}
                        value={draft.value.orgNameAr}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('orgNameAr', event.target.value);
                        }}
                    />
                    <Input
                        label="اسم المنشأة (إنجليزي)"
                        placeholder="AL SHURFA AL ALAMI RESTAURANTS"
                        dir="ltr"
                        maxLength={80}
                        value={draft.value.orgNameEn}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('orgNameEn', event.target.value);
                        }}
                    />
                    <Input
                        label="عنوان البطاقة"
                        placeholder="بطاقة هوية رسمية"
                        maxLength={60}
                        value={draft.value.cardTitle}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('cardTitle', event.target.value);
                        }}
                    />
                    <Input
                        label="السطر التعريفي"
                        placeholder="مجمع برج الساعة"
                        maxLength={60}
                        value={draft.value.slogan}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('slogan', event.target.value);
                        }}
                    />
                    <Input
                        label="شارة الصورة"
                        placeholder="OFFICIAL EXECUTIVE"
                        dir="ltr"
                        maxLength={30}
                        value={draft.value.badgeText}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('badgeText', event.target.value);
                        }}
                    />
                    <Select
                        label="لوحة ألوان البطاقة"
                        value={draft.value.accent}
                        disabled={!canWrite}
                        options={CARD_ACCENTS.map((accent) => ({ value: accent.value, label: accent.label }))}
                        onValueChange={(value) => {
                            draft.set('accent', value);
                        }}
                    />
                    <Input
                        label="الملاحظة القانونية"
                        placeholder="يتحمل حاملها المسؤولية القانونية كاملة عن استخدامها."
                        maxLength={160}
                        value={draft.value.footerNote}
                        disabled={!canWrite}
                        onChange={(event) => {
                            draft.set('footerNote', event.target.value);
                        }}
                    />
                </FieldGrid>
                <ToggleGrid>
                    <Checkbox
                        label="إظهار فصيلة الدم"
                        description="تُطبع في جدول بيانات الوجه الخلفي إن كانت مسجّلة للموظف."
                        checked={draft.value.showBlood}
                        disabled={!canWrite}
                        onCheckedChange={(checked) => {
                            draft.set('showBlood', checked === true);
                        }}
                    />
                    <Checkbox
                        label="إظهار رمز MRZ"
                        description="سطران بمعيار ICAO 9303 للقراءة الآلية."
                        checked={draft.value.showMrz}
                        disabled={!canWrite}
                        onCheckedChange={(checked) => {
                            draft.set('showMrz', checked === true);
                        }}
                    />
                </ToggleGrid>
            </SectionCard>

            <SectionCard title="التحقق والطوارئ" english="Verification & Emergency">
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
