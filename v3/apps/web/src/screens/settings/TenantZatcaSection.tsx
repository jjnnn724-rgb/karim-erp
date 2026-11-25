import { useState } from 'react';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Input } from '../../ui/Input';
import { useToast } from '../../ui/Toast';
import { SectionCard } from './shared';

/** إعدادات ZATCA على مستوى المستأجر — كل شركة تُدخل بياناتها بنفسها. */
export function TenantZatcaSection() {
    const { user } = useAuthState();
    const { toast } = useToast();
    const tenantId = Number((user as unknown as { tenantId?: number } | null)?.tenantId || 0);
    const [vatNumber, setVat] = useState('');
    const [crNumber, setCr] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [sandbox, setSandbox] = useState(true);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!tenantId) {
            toast({ title: 'تعذّر تحديد المستأجر.', variant: 'error' });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/zatca`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken() || ''}` },
                body: JSON.stringify({ vatNumber, crNumber, enabled, sandbox }),
            });
            const body = await res.json() as { ok?: boolean; error?: string; details?: string[] };
            if (!res.ok || !body.ok) {
                toast({ title: body.error || 'فشل الحفظ', variant: 'error' });
                return;
            }
            toast({ title: 'تم حفظ إعدادات ZATCA للمستأجر.', variant: 'success' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SectionCard title="إعدادات ZATCA للمستأجر">
            <div className="flex flex-col gap-sm">
                <p className="text-caption text-muted">الرقم الضريبي والسجل التجاري خاصّان بكل شركة.</p>
                <label className="flex flex-col gap-xxs">
                    <span className="text-body-sm">الرقم الضريبي (15 رقمًا)</span>
                    <Input value={vatNumber} onChange={(e) => setVat(e.target.value)} inputMode="numeric" aria-label="الرقم الضريبي" />
                </label>
                <label className="flex flex-col gap-xxs">
                    <span className="text-body-sm">السجل التجاري (10 أرقام)</span>
                    <Input value={crNumber} onChange={(e) => setCr(e.target.value)} inputMode="numeric" aria-label="السجل التجاري" />
                </label>
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} label="تفعيل ZATCA" />
                <Checkbox checked={sandbox} onCheckedChange={(v) => setSandbox(v === true)} label="وضع sandbox" />
                <Button type="button" disabled={saving} onClick={() => void save()}>حفظ الإعدادات</Button>
                <p className="text-caption text-muted">لا يُرسل أي شيء إلى ZATCA بدون بيانات اعتمادك الخاصة.</p>
            </div>
        </SectionCard>
    );
}
