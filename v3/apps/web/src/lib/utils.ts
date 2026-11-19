import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `cn` الرسمية في shadcn/ui — دمج أصناف Tailwind بلا تعارض.
 * المشروع يعتمد على الرموز المخصصة (`src/ui/cn.ts` بلا tailwind-merge
 * عن قصد) — أما مكوّنات shadcn فتستخدم هذه. الاستيراد عبر `@/lib/utils`.
 *
 * **سبب التوسيع**: `tailwind-merge` لا يعرف أحجام الخطوط المخصصة
 * (`text-body-sm`, `text-button-md`, …) فيصنّفها كألوان نص، فتتعارض مع
 * `text-on-primary` ويُحذف اللون الصحيح (زر أساسي بنص داكن غير مقروء).
 * بتسجيلها في مجموعة `font-size` يبقى لون النص مستقلاً عن حجمه.
 */
const FONT_SIZE_TOKENS = [
    'body-md',
    'body-sm',
    'button-md',
    'caption',
    'display-lg',
    'heading-lg',
    'heading-md',
    'heading-sm',
    'label-md',
    'numeric',
];

const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            'font-size': [{ text: FONT_SIZE_TOKENS }],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
