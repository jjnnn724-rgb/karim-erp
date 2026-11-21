import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * useCountUp — كشف الرقم تدريجيًا **عند تغيّره فقط** («الحركة بمعنى»: العين
 * تلاحظ الاتجاه قبل الرقم). أول ظهور للقيمة يُعرض فورًا — العدّ على كل
 * تحميل صفحة يصبح لعبة ولا يُقرأ بيانًا؛ الحركة للتحوّل بين قيمتين.
 *
 * ليس انتقالًا بين حالات الواجهة (ميزانية DESIGN.md 120–260ms للانتقالات)
 * بل كشف بيانات — مدته 700ms الافتراضية، وتُلغى كليًا مع
 * prefers-reduced-motion (يعيد الهدف فورًا).
 *
 * العقد:
 *  - يعيد العدد المعروض (لا سلاسل) — التنسيق مسؤولية المستدعي.
 *  - القيم غير المنتهية (NaN/Infinity) تُعاد كما هي بلا حركة.
 *  - التغيير أثناء الحركة يعيد البدء من القيمة المعروضة الحالية (لا قفزة).
 */
export function useCountUp(target: number, options?: { duration?: number }): number {
    const { duration = 700 } = options ?? {};
    const reduced = usePrefersReducedMotion();
    const [display, setDisplay] = useState(() => (Number.isFinite(target) ? target : 0));
    const displayRef = useRef(display);
    displayRef.current = display;
    /** أول هدف يُعرض فورًا؛ الحركة تبدأ من الهدف الثاني فصاعدًا. */
    const seenTargetRef = useRef<number | null>(null);

    useEffect(() => {
        if (!Number.isFinite(target)) {
            setDisplay(target);
            return;
        }
        const isFirstReveal = seenTargetRef.current === null;
        seenTargetRef.current = target;
        if (isFirstReveal || reduced || duration <= 0) {
            setDisplay(target);
            return;
        }
        const from = Number.isFinite(displayRef.current) ? displayRef.current : 0;
        if (from === target) {
            return;
        }
        let frame = 0;
        const startedAt = performance.now();
        const tick = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic — نفس إحساس --erp-ease-standard
            setDisplay(from + (target - from) * eased);
            if (progress < 1) {
                frame = requestAnimationFrame(tick);
            } else {
                setDisplay(target);
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target, duration, reduced]);

    return display;
}
