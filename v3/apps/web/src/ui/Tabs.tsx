import { Tabs as ShadcnTabs, TabsContent as ShadcnContent, TabsList as ShadcnList, TabsTrigger as ShadcnTrigger } from '@/components/ui/tabs';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';

/**
 * تبويبات — فوق **shadcn/ui** (`@/components/ui/tabs`): `role="tablist"`، أسهم
 * لوحة المفاتيح، `aria-selected`، وربط `aria-controls`/`aria-labelledby` تلقائيًا.
 * نمط DESIGN.md: شريط غائر والتبويب النشط سطحٌ مرتفع (لا لون وحده: السطح +
 * الوزن + aria-selected).
 */

export interface TabsProps extends ComponentPropsWithRef<typeof ShadcnTabs> {
    children: ReactNode;
}

export function Tabs({ className, children, ...rest }: TabsProps) {
    return (
        <ShadcnTabs className={cn('flex flex-col gap-sm', className)} {...rest}>
            {children}
        </ShadcnTabs>
    );
}

export function TabsList({ className, children, ...rest }: ComponentPropsWithRef<typeof ShadcnList>) {
    return (
        <ShadcnList
            className={cn(
                'inline-flex w-fit max-w-full items-center gap-xxs overflow-x-auto rounded-md bg-surface-sunken p-xxs',
                className,
            )}
            {...rest}
        >
            {children}
        </ShadcnList>
    );
}

export function TabsTrigger({ className, children, ...rest }: ComponentPropsWithRef<typeof ShadcnTrigger>) {
    return (
        <ShadcnTrigger
            className={cn(
                'inline-flex items-center justify-center gap-xxs whitespace-nowrap rounded-sm px-sm py-xs text-body-sm text-muted transition-colors duration-[var(--erp-motion-fast)] ease-standard hover:text-ink data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-card disabled:pointer-events-none disabled:opacity-50',
                className,
            )}
            {...rest}
        >
            {children}
        </ShadcnTrigger>
    );
}

export function TabsContent({ className, children, ...rest }: ComponentPropsWithRef<typeof ShadcnContent>) {
    return (
        <ShadcnContent className={cn('text-body-md text-ink outline-none', className)} {...rest}>
            {children}
        </ShadcnContent>
    );
}
