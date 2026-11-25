import { useEffect, useState } from 'react';

/**
 * usePrefersReducedMotion — هل طلب المستخدم تقليل الحركة؟ (توكنز DESIGN.md:
 * الحركة 120–260ms وإلغاؤها إلزامي مع prefers-reduced-motion).
 *
 * مستخرج 2026-11-21 من الصورة المحلية في screens/Home.tsx:33-60 ليصبح
 * مصدرًا وحيدًا للنظام كله (AnswerStrip وcount-up وكل نمط لاحق).
 */
export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => {
        try {
            return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
        } catch {
            return false;
        }
    });
    useEffect(() => {
        try {
            if (typeof window.matchMedia !== 'function') {
                return;
            }
            const media = window.matchMedia('(prefers-reduced-motion: reduce)');
            const onChange = () => {
                setReduced(media.matches);
            };
            media.addEventListener('change', onChange);
            return () => {
                media.removeEventListener('change', onChange);
            };
        } catch {
            return;
        }
    }, []);
    return reduced;
}
