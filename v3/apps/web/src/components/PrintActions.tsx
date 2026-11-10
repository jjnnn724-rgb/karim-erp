import { useState } from 'react';
import { type ExportMode, exportElementPdf } from '../lib/pdf-share';
import { useToast } from '../ui/Toast';

/**
 * أزرار الطباعة والتصدير — نفس أزرار V2 الثلاثة (طباعة · تحميل PDF · مشاركة PDF)
 * مع نفس ترتيب الأحداث: التوليد عند الطلب، وحالة انتظار على الزر نفسه،
 * ورسالة عربية عند كل نتيجة (تم/تعذّر/أُلغيت المشاركة).
 *
 * المستند الملتقَط هو `#erp-v3-main` — يحتوي ترويسة الطباعة (شعار + اسم)
 * والتذييل، فيخرج PDF كما تخرج الورقة تمامًا. الأزرار نفسها مستبعدة من الطباعة
 * (`data-erp-print-hide`).
 */
export function PrintActions({ title }: { title: string }) {
    const { toast } = useToast();
    const [pending, setPending] = useState<ExportMode | null>(null);

    async function run(mode: ExportMode): Promise<void> {
        if (pending) {
            return;
        }
        setPending(mode);
        try {
            const target = document.getElementById('erp-v3-main');
            const result = await exportElementPdf(target, title, { mode });
            if (!result.ok) {
                toast({
                    variant: 'error',
                    title: 'تعذّر تصدير PDF',
                    description: result.error ?? 'تحقق من الاتصال ثم أعد المحاولة',
                });
                return;
            }
            if (mode === 'share') {
                if (result.mode === 'shared') {
                    toast({ variant: 'success', title: 'تمت مشاركة PDF' });
                } else if (result.mode === 'cancelled') {
                    // المستخدم أغلق ورقة المشاركة — ليس فشلًا.
                } else if (result.mode === 'retry') {
                    toast({ variant: 'info', title: 'اضغط «مشاركة PDF» مرة أخرى — الملف جاهز الآن' });
                } else {
                    toast({
                        variant: 'success',
                        title: 'تم تنزيل PDF',
                        description: 'لا مشاركة ملفات على هذا الجهاز — شارك الملف من التنزيلات.',
                    });
                }
                return;
            }
            toast({ variant: 'success', title: 'تم تنزيل PDF' });
        } finally {
            setPending(null);
        }
    }

    const buttonClass =
        'erp-print-action rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
            <button type="button" className={buttonClass} onClick={() => window.print()}>
                طباعة
            </button>
            <button
                type="button"
                className={buttonClass}
                disabled={pending !== null}
                onClick={() => {
                    void run('download');
                }}
            >
                {pending === 'download' ? 'جارٍ تجهيز PDF…' : 'تحميل PDF'}
            </button>
            <button
                type="button"
                className={buttonClass}
                disabled={pending !== null}
                onClick={() => {
                    void run('share');
                }}
            >
                {pending === 'share' ? 'جارٍ تجهيز PDF…' : 'مشاركة PDF'}
            </button>
        </div>
    );
}
