import { createLazyRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { DesignGallery } from './DesignGallery';

/** المعرض بيانات وهمية؛ في البناء الإنتاجي يعيد إلى الرئيسية بلا وميض. */
function DevOnlyGallery() {
    const navigate = useNavigate();
    const dev = import.meta.env.DEV;

    useEffect(() => {
        if (!dev) {
            void navigate({ to: '/' });
        }
    }, [dev, navigate]);

    return dev ? <DesignGallery /> : null;
}

/**
 * مسار المعرض `/design` — كسول (ADR-002)، تسجيله في `routes.tsx` ملك Lead.
 * المسار أداة تطوير: في البناء الإنتاجي يعيد إلى `/`، ولا يظهر في التنقّل.
 */
export const Route = createLazyRoute('/design')({
    component: DevOnlyGallery,
});
