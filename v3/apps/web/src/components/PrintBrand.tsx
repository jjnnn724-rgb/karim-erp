import { useEffect, useState } from 'react';
import { PRINT_COMPANY_EN, printRunnerTitle, printStamp, usePrintBrand } from '../lib/print';

/**
 * ترويسة الطباعة الموحّدة — شعار + اسم الشركة + سطره الإنجليزي.
 *
 * تُرسم مرة واحدة في قشرة التطبيق (بعد `breadcrumbs` وقبل الشاشة)، مخفية على
 * الشاشة (`display:none` في `print.css`، فلا يقرؤها قارئ الشاشة أصلًا) وظاهرة
 * فقط داخل `@media print` — نفس موضع `injectBrand` في `core/print-system.js`
 * (أول عنصر داخل ورقة المستند). لا تُكرَّر في الشاشات: شاشة تحمل شعارها الخاص
 * ستُظهر شعارين لو أضفناها هنا مرة أخرى.
 */
export function PrintBrand() {
    const { name, logoSrc } = usePrintBrand();
    return (
        <header className="erp-print-brand" data-erp-print-brand>
            <img className="erp-print-brand__logo" src={logoSrc} alt="" width={60} height={60} />
            <div className="erp-print-brand__text">
                <strong className="erp-print-brand__name">{name}</strong>
                <span className="erp-print-brand__en">{PRINT_COMPANY_EN}</span>
            </div>
        </header>
    );
}

/** ختم الطباعة يتجدّد عند `beforeprint` كي لا يطبع تاريخًا قديمًا بعد ساعات. */
function usePrintStamp(): string {
    const [stamp, setStamp] = useState(() => printStamp());
    useEffect(() => {
        const refresh = (): void => {
            setStamp(printStamp());
        };
        window.addEventListener('beforeprint', refresh);
        return () => {
            window.removeEventListener('beforeprint', refresh);
        };
    }, []);
    return stamp;
}

/**
 * تذييل الطباعة — نفس محتوى `injectRunner` في V2: اسم الشركة، عنوان الشاشة،
 * وختم «طُبع …». يُرسم مرة واحدة في نهاية محتوى الصفحة المطبوعة.
 */
export function PrintRunner({ title }: { title?: string | null }) {
    const { name } = usePrintBrand();
    const stamp = usePrintStamp();
    return (
        <div className="erp-print-runner" data-erp-print-runner>
            <span>{name}</span>
            <span>{printRunnerTitle(title)}</span>
            <span>{stamp}</span>
        </div>
    );
}
