import type { ReactNode } from 'react';
import { useAllowedMenus } from '../lib/my-menus';
import { isScreenEnabled, LEGACY_APP_URL, type V3Screen } from '../lib/screens';

/**
 * حارس الشاشة داخل v3 — دفاعٌ ثانٍ بعد تحويل الخادم لرابط الشاشة المعطّلة.
 * لا يمسّ أي منطق قراءة: إما المحتوى كما هو، أو دعوة صريحة للقديم.
 * ويحرس الدور مرآة V2 (`allowedMenus`): الوصول المباشر بالرابط لشاشة
 * خارج قوائم الدور يعرض «لا صلاحية» صريحًا بدل 403 خام من الخادم —
 * فالـ sous_chef مثلًا لا يرى شاشات المالية في القائمة أصلًا (V2).
 */
export function ScreenGate({ screen, children }: { screen: V3Screen; children: ReactNode }) {
    const allowedMenusSet = useAllowedMenus();
    if (!isScreenEnabled(screen)) {
        return (
            <section className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-lg text-ink">
                <h1 className="text-heading-md">هذه الشاشة ما زالت على النسخة القديمة</h1>
                <p className="mt-xs text-body-md text-muted">
                    لم تُقلب بعد في الإصدار الثالث. البيانات كاملة في القديم، ولا شيء ناقص هناك.
                </p>
                <a className="mt-md inline-block rounded-md bg-primary px-md py-xs text-on-primary" href={LEGACY_APP_URL}>
                    انتقل إلى النسخة القديمة
                </a>
            </section>
        );
    }
    // null = لا دور/لا جلسة ⇒ لا حظر هنا (الخادم يحكم أيضًا).
    if (allowedMenusSet && !allowedMenusSet.includes(screen)) {
        return (
            <section className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-lg text-ink">
                <h1 className="text-heading-md">لا تملك صلاحية الوصول إلى هذه الشاشة</h1>
                <p className="mt-xs text-body-md text-muted">
                    دورك الحالي لا يشمل هذه الشاشة في قوائم النظام. راجع مدير النظام إن كنت تعتقد أن
                    لديك صلاحية، أو ارجع إلى لوحة الإدارة الخاصة بك.
                </p>
                <a className="mt-md inline-block rounded-md bg-primary px-md py-xs text-on-primary" href={LEGACY_APP_URL}>
                    انتقل إلى النسخة القديمة
                </a>
            </section>
        );
    }
    return <>{children}</>;
}
