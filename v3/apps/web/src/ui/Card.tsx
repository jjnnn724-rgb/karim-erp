import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

/**
 * بطاقة — فوق **shadcn/ui**: نفس توكنز shadcn (`bg-card`/`text-card-foreground`/
 * `border-border`) مُعرَّفة في `styles.css` على بدائيات ERP، وهوية DESIGN.md:
 * أوفى بياضًا من الكانفس، حدّ شعرة، ظل دافئ منخفض.
 * مكوّنات مركّبة (`CardHeader`/`CardTitle`/`CardBody`/`CardFooter`) لأن
 * البطاقات في الشاشات تتفاوت: بعضها برأس وإجراءات، وبعضها جسم فقط.
 *
 * فاصل واحد فقط بين الرأس والجسم (DESIGN.md: «لا فواصل متداخلة»).
 */

export interface CardProps {
    children: ReactNode;
    className?: string;
    as?: ElementType;
}

export function Card({ children, className, as: Component = 'section' }: CardProps) {
    return (
        <Component
            className={cn(
                'erp-card flex flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm',
                'rounded-lg border-hairline bg-surface shadow-card',
                className,
            )}
        >
            {children}
        </Component>
    );
}

export interface CardHeaderProps {
    children: ReactNode;
    actions?: ReactNode;
    className?: string;
}

export function CardHeader({ children, actions, className }: CardHeaderProps) {
    return (
        <div
            data-slot="card-header"
            className={cn('flex flex-row items-start justify-between gap-sm border-b border-hairline p-md', className)}
        >
            <div className="flex min-w-0 flex-col gap-xxs">{children}</div>
            {actions ? <div className="flex shrink-0 items-center gap-xs">{actions}</div> : null}
        </div>
    );
}

export interface CardTitleProps {
    children: ReactNode;
    as?: 'h1' | 'h2' | 'h3' | 'h4';
    className?: string;
}

export function CardTitle({ children, as: Component = 'h3', className }: CardTitleProps) {
    return (
        <div data-slot="card-title">
            <Component className={cn('text-heading-md font-semibold text-ink', className)}>{children}</Component>
        </div>
    );
}

export interface CardDescriptionProps {
    children: ReactNode;
    className?: string;
}

export function CardDescription({ children, className }: CardDescriptionProps) {
    return (
        <div
            data-slot="card-description"
            className={cn('text-body-sm text-muted', className)}
        >
            {children}
        </div>
    );
}

export interface CardBodyProps {
    children: ReactNode;
    className?: string;
}

export function CardBody({ children, className }: CardBodyProps) {
    return (
        <div data-slot="card-content" className={cn('block p-md', className)}>
            {children}
        </div>
    );
}

export interface CardFooterProps {
    children: ReactNode;
    className?: string;
}

export function CardFooter({ children, className }: CardFooterProps) {
    return (
        <div
            data-slot="card-footer"
            className={cn('flex items-center justify-between gap-sm border-t border-hairline p-md', className)}
        >
            {children}
        </div>
    );
}
