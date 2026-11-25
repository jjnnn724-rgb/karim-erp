/**
 * أيقونات مكوّنات `src/ui/` — SVG داخلي، لا إيموجي (DESIGN.md).
 *
 * أيقونات القشرة الحالية تُعاد تصديرها من `components/icons` (قراءةً فقط،
 * مصدرٌ واحد للحقيقة)، والجديدة تُضاف هنا لأن نطاق هذه المهمة هو `src/ui/`.
 *
 * كل أيقونة زخرفية (`aria-hidden`): المعنى من النص المجاور أو `aria-label`
 * على الزر الحامل. الأيقونات الاتجاهية تُقلَب تلقائيًا في RTL بـ`rtl:rotate-180`.
 */

import type { ReactElement } from 'react';

export { AlertTriangleIcon, ChevronIcon, InboxIcon, ListTreeIcon } from '../components/icons';

interface IconProps {
    className?: string | undefined;
}

function Svg({ className = 'size-4', children }: IconProps & { children: ReactElement | ReactElement[] }) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {children}
        </svg>
    );
}

export function SearchIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
        </Svg>
    );
}

export function XIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </Svg>
    );
}

export function CheckIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="m5 12.5 4.2 4.2L19 7" />
        </Svg>
    );
}

export function MinusIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M5 12h14" />
        </Svg>
    );
}

export function SunIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.9 4.9 1.4 1.4" />
            <path d="m17.7 17.7 1.4 1.4" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m4.9 19.1 1.4-1.4" />
            <path d="m17.7 6.3 1.4-1.4" />
        </Svg>
    );
}

export function MoonIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M12 3a7 7 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </Svg>
    );
}

export function MonitorIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
        </Svg>
    );
}

export function LoaderIcon({ className = 'size-4' }: IconProps) {
    return (
        <Svg className={`${className} animate-spin`}>
            <path d="M21 12a9 9 0 1 1-6.2-8.56" />
        </Svg>
    );
}

export function ArrowUpIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
        </Svg>
    );
}

export function ArrowDownIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M12 5v14" />
            <path d="m5 12 7 7 7-7" />
        </Svg>
    );
}

export function ArrowFlatIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M5 12h14" />
            <path d="m15 8 4 4-4 4" />
        </Svg>
    );
}

export function ChevronStartIcon({ className = 'size-4' }: IconProps) {
    return (
        <Svg className={`${className} rtl:rotate-180`}>
            <path d="m15 18-6-6 6-6" />
        </Svg>
    );
}

export function ChevronEndIcon({ className = 'size-4' }: IconProps) {
    return (
        <Svg className={`${className} rtl:rotate-180`}>
            <path d="m9 18 6-6-6-6" />
        </Svg>
    );
}

export function InfoIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
        </Svg>
    );
}

export function CheckCircleIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.4 2.4 4.6-5.3" />
        </Svg>
    );
}

export function AlertCircleIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
        </Svg>
    );
}

export function MenuIcon({ className }: IconProps) {
    return (
        <Svg className={className}>
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
        </Svg>
    );
}
