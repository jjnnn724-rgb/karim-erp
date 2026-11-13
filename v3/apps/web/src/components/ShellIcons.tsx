import type { NavGroupId } from '../lib/navigation';

const paths = {
    home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
    finance: 'm3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18',
    cart: 'M3 3h2l2 12h12l2-8H6M9 20h.01M18 20h.01',
    box: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v9M7.5 5.5l9 5',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    kitchen: 'M4 3v5a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-4 2-5 7-5 11h5',
    chart: 'M4 3v18h17M8 16v-5m5 5V7m5 9V4',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
    grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    wallet: 'M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1 0-4M20 12h-5v5h5M16 14.5h.01',
    calendar: 'M8 2v4m8-4v4M3 10h18M3 5h18v17H3V5Zm5 9h3m-3 4h7',
    document: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6',
    shield: 'm12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6l8-3Zm-4 9 3 3 5-6',
    layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
    arrows: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
    returns: 'm8 3-5 5 5 5M3 8h11a7 7 0 0 1 0 14h-4',
    monitor: 'M3 3h18v14H3V3Zm9 14v4m-5 0h10M7 7h5m-5 4h9',
    message: 'M21 3H3v14h5l4 4 4-4h5V3ZM7 8h10m-10 4h7',
    database: 'M21 6c0 2-4 3-9 3S3 8 3 6s4-3 9-3 9 1 9 3Zm0 0v12c0 2-4 3-9 3s-9-1-9-3V6m0 6c0 2 4 3 9 3s9-1 9-3',
    scan: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8v8m3-8v8m4-8v8m3-8v8',
    scale: 'M12 3v18M5 21h14M4 7h16M7 7l-4 8h8L7 7Zm10 0-4 8h8l-4-8Z',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'm6 6 12 12M6 18 18 6',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    panel: 'M3 3h18v18H3V3Zm12 0v18m-7-9 3-3m-3 3 3 3',
    logout: 'M9 3H3v18h6m5-14 5 5-5 5m-7-5h12',
} as const;

export type ShellIconName = keyof typeof paths;

export const SHELL_GROUP_ICONS: Record<NavGroupId, ShellIconName> = {
    finance: 'finance',
    procurement: 'cart',
    inventory: 'box',
    hr: 'users',
    operations: 'kitchen',
    analytics: 'chart',
    system: 'settings',
};

/** Symbols remain recognisable in compact mode; accessible names come from links. */
export function shellIconForPath(path: string): ShellIconName {
    if (path === '/') return 'home';
    if (/inventory-inquiry/.test(path)) return 'search';
    if (/dashboard|executive|briefing|command-center/.test(path)) return 'grid';
    if (/bank-rec/.test(path)) return 'wallet';
    if (/reports|analyzer|inquiry|cost-|pnl|cfo|comparison|wh-vs-pos/.test(path)) return 'chart';
    if (/payments|revenues|expenses|payroll|cash-register|cashier-sales/.test(path)) return 'wallet';
    if (/kitchen|recipes|menu-board/.test(path)) return 'kitchen';
    if (/goods-scan/.test(path)) return 'scan';
    if (/weight/.test(path)) return 'scale';
    if (/attendance|roster|leaves|daily-locks/.test(path)) return 'calendar';
    if (/compliance/.test(path)) return 'shield';
    if (/users|employees|employee-portal/.test(path)) return 'users';
    if (/returns/.test(path)) return 'returns';
    if (/moves|transfers/.test(path)) return 'arrows';
    if (/branches|departments|shelves|accounts/.test(path)) return 'layers';
    if (/invoices|journal|dispatch|prs|requests/.test(path)) return 'document';
    if (/sessions|zkteco|cashier-monitor/.test(path)) return 'monitor';
    if (/whatsapp/.test(path)) return 'message';
    if (/oracle-data/.test(path)) return 'database';
    if (/settings/.test(path)) return 'settings';
    if (/procurement/.test(path)) return 'cart';
    return 'box';
}

export function ShellIcon({ name, className = 'erp-shell__icon' }: { name: ShellIconName; className?: string }) {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d={paths[name]} />
        </svg>
    );
}

/** A faceted jewel frame and a drawn K: a local vector, never an external asset. */
export function ShellBrandMark() {
    return (
        <span className="erp-shell__brand-mark" aria-hidden="true">
            <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 40 40"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path className="erp-shell__brand-facet" d="m20 3 14 8v18l-14 8-14-8V11l14-8Z" />
                <path className="erp-shell__brand-facet" d="m6 11 14 9 14-9M20 20v17" />
                <path strokeWidth="2.6" d="M14 12v16m1-8 11-8m-11 8 11 8" />
            </svg>
        </span>
    );
}
