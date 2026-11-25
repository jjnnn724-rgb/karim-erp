import { useState } from 'react';
import { Card, StateError } from '../components/TableState';
import {
    CREDENTIAL_VALUE_MAX,
    CREDENTIAL_VALUE_MIN,
    INTEGRATION_PROVIDER_CODES,
    type IntegrationProviderCode,
    rotateIntegrationCredential,
    validateCredentialForm,
} from '../lib/integration-ops';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * تدوير اعتمادات التكامل — `PUT /api/integration/credentials/:provider/:key`.
 *
 * الكتابة فقط: القيمة تُرسَل ولا تُقرأ ولا تُحفظ في المتصفح بعد الإرسال،
 * والخادم يبطل الاعتماد السابق ويسجّل الحدث `credential.rotated`.
 * للاستخدام من الأدمن وحده (`compliance.configure`).
 */

const PROVIDER_LABELS: Record<IntegrationProviderCode, string> = {
    zatca: 'هيئة الزكاة والضريبة والجمارك',
    mudad: 'نظام حماية الأجور',
    gosi: 'التأمينات الاجتماعية',
    qiwa: 'منصة قوى',
};

function stamp(value: string | null | undefined): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

export function MudadCredentials() {
    const [provider, setProvider] = useState<IntegrationProviderCode>('zatca');
    const [key, setKey] = useState('');
    const [value, setValue] = useState('');
    const [formError, setFormError] = useState('');

    const rotate = useWriteMutation<{ provider: IntegrationProviderCode; key: string; value: string }, unknown>({
        mutationFn: ({ provider: code, key: keyName, value: secret }) => rotateIntegrationCredential(code, keyName, secret),
        successTitle: 'تم تدوير الاعتماد',
        successDescription: 'أُبطل الاعتماد السابق وسُجّل الحدث في سجل التكامل.',
        silentError: true,
        invalidate: [['integration']],
        onSuccess: () => {
            setValue('');
            setFormError('');
        },
        onError: (error) => {
            setFormError(writeErrorMessage(error, 'تعذّر تدوير الاعتماد'));
        },
    });

    function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const validated = validateCredentialForm({ key, value });
        if (!validated.ok) {
            setFormError(validated.message);
            return;
        }
        setFormError('');
        rotate.mutate({ provider, key: validated.key, value: validated.value });
    }

    const result = rotate.data as { key_name?: string; rotated_at?: string; rotated?: boolean } | undefined;

    return (
        <Card className="mudad-section">
            <div className="border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">تدوير اعتمادات التكامل</h2>
                <p className="text-body-sm text-muted">
                    كتابة فقط — لا تُقرأ القيم من الخادم ولا تُحفظ في المتصفح. الإرسال يبطل الاعتماد السابق ويسجّل الحدث.
                </p>
            </div>
            <form onSubmit={submit} className="flex flex-col gap-sm p-sm">
                <div className="grid gap-sm md:grid-cols-3">
                    <Select
                        label="المزوّد"
                        options={INTEGRATION_PROVIDER_CODES.map((code) => ({ value: code, label: PROVIDER_LABELS[code] }))}
                        value={provider}
                        onValueChange={(next) => {
                            setProvider(next as IntegrationProviderCode);
                        }}
                    />
                    <Input
                        label="اسم المفتاح"
                        dir="ltr"
                        maxLength={64}
                        placeholder="e.g. mudad.client_secret"
                        value={key}
                        onChange={(event) => {
                            setKey(event.target.value);
                        }}
                        hint="حرف لاتيني صغير أولًا، ثم أحرف أو أرقام أو . _"
                    />
                    <Input
                        label="القيمة الجديدة"
                        type="password"
                        dir="ltr"
                        autoComplete="new-password"
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                        }}
                        hint={`${CREDENTIAL_VALUE_MIN}–${CREDENTIAL_VALUE_MAX} حرفًا`}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-sm">
                    <Button type="submit" size="sm" loading={rotate.isPending} disabled={rotate.isPending}>
                        تدوير الاعتماد
                    </Button>
                    {result ? (
                        <>
                            <Badge variant={result.rotated ? 'success' : 'neutral'}>
                                {result.rotated ? 'أُبطل الاعتماد السابق' : 'أول قيمة لهذا المفتاح'}
                            </Badge>
                            <span className="text-caption text-muted">
                                {result.key_name ?? key} · {stamp(result.rotated_at)}
                            </span>
                        </>
                    ) : null}
                </div>
                {formError ? <StateError message={formError} onRetry={() => setFormError('')} /> : null}
            </form>
        </Card>
    );
}
