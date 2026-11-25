import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { useAuthState } from '../lib/auth';

/** وحدة التحميل الكسول لمصدر البيانات. */
function LegacySourcePage() {
    const auth = useAuthState();
    if (auth.user?.role !== 'admin') {
        return (
            <section className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-lg text-ink">
                <h1 className="text-heading-md">إعدادات مصدر البيانات للأدمن فقط</h1>
                <p className="mt-xs text-body-md text-muted">
                    تغيير اتصال النظام بمصادر البيانات القديمة إجراء تشغيلي حساس.
                </p>
            </section>
        );
    }
    return (
        <section className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-lg text-ink">
            <h1 className="text-heading-md">إدارة مصدر البيانات غير متاحة بعد</h1>
            <p className="mt-xs text-body-md text-muted">
                الخادم الحالي لا يوفّر واجهة التحكم المطلوبة. أُخفيت هذه الأداة حتى يُنفّذ الخادم إيقاف وتشغيل مزامنة
                Yarasoft وOracle بأمان ويحفظ الحالة.
            </p>
        </section>
    );
}

export const Route = createLazyRoute('/integrations')({
    component: () => (
        <ScreenGate screen="oracle-data">
            <LegacySourcePage />
        </ScreenGate>
    ),
});
