import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` الرسمية في shadcn/ui — دمج أصناف Tailwind بلا تعارض.
 * المشروع يعتمد على الرموز المخصصة (`src/ui/cn.ts` بلا tailwind-merge
 * عن قصد) — أما مكوّنات shadcn فتستخدم هذه. الاستيراد عبر `@/lib/utils`.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
