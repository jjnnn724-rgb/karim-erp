import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { logout } from '../lib/auth';
import { LEGACY_APP_URL } from '../lib/screens';

/**
 * لوحة الأوامر (Ctrl/⌘+K) — بحث ضبابي، آخر العناصر، إجراءات، وإدارة تركيز.
 *
 *  · **البحث ضبابي بسيط**: `contains` مُرجَّح أولًا، ثم تسلسل حروف (subsequence)
 *    مع مكافأة التتابع. التطبيع العربي (همزات/تاء مربوطة/تشكيل) محلي هنا
 *    كي لا تُدخل اللوحة تبعيةً في حزمة البداية.
 *  · **آخر العناصر** في `localStorage` (آخر 5)، وتُعرض قبل غيرها حين لا بحث.
 *  · **إجراءات** لا شاشات: تبديل الوضع، فتح الواجهة القديمة (v2)، تسجيل الخروج.
 *  · **التركيز**: يُحفظ العنصر النشط قبل الفتح ويُستعاد عند الإغلاق، وTab
 *    محصور داخل اللوحة (حقل + إغلاق)، وEsc يُغلق من أي عنصر داخلها.
 *  · **ARIA**: `combobox` + `listbox` + `aria-activedescendant` + `aria-selected`.
 *
 * العناصر تصل من القشرة (`items`) لا من قائمة موازية، والإجراء الافتراضي
 * يُنفّذ فعلًا حقيقيًا (لا شاشة كاذبة).
 */

export interface CommandItem {
    to: string;
    label: string;
    hint: string;
}

export interface CommandAction {
    id: string;
    label: string;
    hint: string;
    run: () => void;
}

export const PALETTE_RECENT_KEY = 'karim_palette_recent_v1';
const RECENT_LIMIT = 5;
const MAX_RESULTS = 8;

/** تطبيع عربي مبسّط لبحثٍ لا يتأثر بالهمزات والتشكيل. */
export function foldArabic(value: string): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىی]/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * درجة تطابق: `-1` لا تطابق، والأعلى أفضل.
 * `contains` يتقدّم على التسلسل، والتتابع المتصل يُكافأ أكثر من المتقطع.
 */
export function fuzzyScore(text: string, query: string): number {
    const needle = foldArabic(query);
    if (!needle) {
        return 0;
    }
    const haystack = foldArabic(text);
    const direct = haystack.indexOf(needle);
    if (direct >= 0) {
        return 200 - Math.min(50, direct);
    }
    let cursor = 0;
    let score = 0;
    let streak = 0;
    let first = -1;
    for (const character of needle) {
        const at = haystack.indexOf(character, cursor);
        if (at < 0) {
            return -1;
        }
        if (first < 0) {
            first = at;
        }
        if (at === cursor) {
            streak += 1;
            score += streak * 6;
        } else {
            streak = 0;
            score += 1;
        }
        cursor = at + 1;
    }
    return score - Math.min(20, first);
}

/** عنصر قابل للترتيب بالبحث — شاشة أو إجراء (الإجراء بلا مسار). */
export interface RankableCommand {
    readonly label: string;
    readonly hint: string;
    readonly to?: string;
}

/** ترتيب العناصر بالبحث: بلا استعلام تُعاد كما هي (الترتيب الرسمي). */
export function rankCommandItems<T extends RankableCommand>(items: readonly T[], query: string): T[] {
    const needle = query.trim();
    if (!needle) {
        return [...items];
    }
    return items
        .map((item, index) => ({
            item,
            index,
            score: Math.max(
                fuzzyScore(item.label, needle),
                fuzzyScore(item.hint, needle),
                item.to ? fuzzyScore(item.to, needle) : -1,
            ),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.item);
}

function readRecentPaths(): string[] {
    try {
        const raw = window.localStorage.getItem(PALETTE_RECENT_KEY);
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, RECENT_LIMIT);
    } catch {
        return [];
    }
}

function writeRecentPath(path: string): void {
    try {
        const next = [path, ...readRecentPaths().filter((entry) => entry !== path)].slice(0, RECENT_LIMIT);
        window.localStorage.setItem(PALETTE_RECENT_KEY, JSON.stringify(next));
    } catch {
        // تخزين معطّل — لا آخر عناصر في هذه الجلسة.
    }
}

/**
 * الإجراءات الافتراضية في اللوحة المستقلة — حقيقية لا وهمية.
 * «تبديل الوضع» يضيفه `Shell` (فمصدر الثيم `ui-kit`/`ThemeProvider`)، فيبقى
 * هذا الملف بلا تبعية مزوّد ويُختبر وحده.
 */
export const DEFAULT_COMMAND_ACTIONS: readonly CommandAction[] = [
    {
        id: 'legacy',
        label: 'فتح الواجهة القديمة',
        hint: 'v2',
        run: () => {
            window.location.assign(LEGACY_APP_URL);
        },
    },
    {
        id: 'logout',
        label: 'تسجيل الخروج',
        hint: 'Logout',
        run: () => {
            logout();
        },
    },
];

type PaletteOption =
    | { kind: 'item'; id: string; label: string; hint: string; to: string }
    | { kind: 'action'; id: string; label: string; hint: string; run: () => void };

export function CommandPalette({
    open,
    items,
    actions = DEFAULT_COMMAND_ACTIONS,
    onClose,
    onSelect,
}: {
    open: boolean;
    items: readonly CommandItem[];
    actions?: readonly CommandAction[];
    onClose: () => void;
    onSelect: (to: string) => void;
}) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [recentPaths, setRecentPaths] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    // الفتح: تذكّر العنصر النشط، صفّر البحث، وركّز الحقل. الإغلاق: استعادة التركيز.
    useEffect(() => {
        if (!open) {
            return;
        }
        const previous = document.activeElement;
        restoreFocusRef.current = previous instanceof HTMLElement ? previous : null;
        setQuery('');
        setActive(0);
        setRecentPaths(readRecentPaths());
        inputRef.current?.focus();
        return () => {
            const target = restoreFocusRef.current;
            restoreFocusRef.current = null;
            if (target?.isConnected && typeof target.focus === 'function') {
                target.focus();
            }
        };
    }, [open]);

    useEffect(() => {
        setActive(0);
    }, [query]);

    const options = useMemo<PaletteOption[]>(() => {
        const trimmed = query.trim();
        // بلا بحث: آخر العناصر (المستخدمة فعلًا) في الأعلى، ثم بقية القائمة، ثم الإجراءات.
        let recentItems: CommandItem[] = [];
        if (!trimmed) {
            const known = new Set(items.map((item) => item.to));
            recentItems = recentPaths
                .filter((path) => known.has(path))
                .map((path) => items.find((item) => item.to === path))
                .filter((item): item is CommandItem => Boolean(item))
                .slice(0, RECENT_LIMIT);
        }
        const recentSet = new Set(recentItems.map((item) => item.to));
        const pool = trimmed ? items : items.filter((item) => !recentSet.has(item.to));
        const visibleItems = rankCommandItems(pool, trimmed).slice(0, MAX_RESULTS);
        const itemOptions: PaletteOption[] = visibleItems.map((item) => ({
            kind: 'item',
            id: `item:${item.to}`,
            label: item.label,
            hint: item.hint,
            to: item.to,
        }));
        const recentOptions: PaletteOption[] = recentItems.map((item) => ({
            kind: 'item',
            id: `recent:${item.to}`,
            label: item.label,
            hint: 'آخر العناصر',
            to: item.to,
        }));
        if (trimmed) {
            const actionOptions: PaletteOption[] = rankCommandItems(actions, trimmed)
                .slice(0, MAX_RESULTS)
                .map((action) => ({
                    kind: 'action',
                    id: `action:${action.id}`,
                    label: action.label,
                    hint: action.hint,
                    run: action.run,
                }));
            return [...itemOptions, ...actionOptions];
        }
        const actionOptions: PaletteOption[] = actions.map((action) => ({
            kind: 'action',
            id: `action:${action.id}`,
            label: action.label,
            hint: action.hint,
            run: action.run,
        }));
        return [...recentOptions, ...itemOptions, ...actionOptions];
    }, [actions, items, query, recentPaths]);

    const choose = (index: number) => {
        const option = options[index];
        if (!option) {
            return;
        }
        onClose();
        if (option.kind === 'action') {
            option.run();
            return;
        }
        writeRecentPath(option.to);
        onSelect(option.to);
    };

    if (!open) {
        return null;
    }

    const move = (delta: number) => {
        setActive((current) => {
            if (options.length === 0) {
                return 0;
            }
            return (current + delta + options.length) % options.length;
        });
    };

    const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        // حصر التركيز: حقل البحث ↔ زر الإغلاق فقط (النافذة مشروطة التركيز).
        const first = inputRef.current;
        const last = closeRef.current;
        if (!first || !last) {
            return;
        }
        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-start justify-center bg-sidebar/50 p-md pt-[12vh]"
            role="presentation"
            onMouseDown={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="البحث الشامل في شاشات النظام"
                className="w-full max-w-xl overflow-hidden rounded-lg border border-hairline bg-surface shadow-drawer"
                onKeyDown={onDialogKeyDown}
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
            >
                <div className="flex items-center gap-xs border-b border-hairline pe-xs">
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                move(1);
                            } else if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                move(-1);
                            } else if (event.key === 'Home') {
                                event.preventDefault();
                                setActive(0);
                            } else if (event.key === 'End') {
                                event.preventDefault();
                                setActive(Math.max(0, options.length - 1));
                            } else if (event.key === 'Enter') {
                                event.preventDefault();
                                choose(active);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                onClose();
                            }
                        }}
                        role="combobox"
                        aria-expanded="true"
                        aria-autocomplete="list"
                        aria-controls="erp-command-results"
                        aria-activedescendant={options.length > 0 ? `erp-command-${String(active)}` : undefined}
                        placeholder="ابحث عن شاشة أو إجراء… (Esc للإغلاق)"
                        aria-label="بحث الشاشات"
                        className="min-w-0 flex-1 bg-surface px-md py-sm text-body-md text-ink outline-none"
                    />
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label="إغلاق البحث"
                        className="rounded-sm px-sm py-xxs text-caption text-muted hover:bg-surface-hover hover:text-ink"
                    >
                        إغلاق
                    </button>
                </div>
                <ul
                    id="erp-command-results"
                    role="listbox"
                    aria-label="نتائج البحث"
                    className="max-h-80 overflow-auto p-xs"
                >
                    {options.length === 0 ? (
                        <li className="px-sm py-xs text-body-sm text-muted">لا شاشة أو إجراء يطابق هذا البحث.</li>
                    ) : (
                        options.map((option, index) => (
                            <li
                                key={option.id}
                                id={`erp-command-${String(index)}`}
                                role="option"
                                aria-selected={index === active}
                                className={`flex cursor-pointer items-center justify-between gap-sm rounded-md px-sm py-xs text-body-md ${
                                    index === active ? 'bg-surface-hover text-ink' : 'text-ink-secondary'
                                }`}
                                onMouseEnter={() => {
                                    setActive(index);
                                }}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    choose(index);
                                }}
                            >
                                <span className="flex items-center gap-xs">
                                    {option.kind === 'action' ? (
                                        <span
                                            aria-hidden="true"
                                            className="rounded-sm border border-hairline px-xxs text-caption text-muted"
                                        >
                                            إجراء
                                        </span>
                                    ) : null}
                                    <span>{option.label}</span>
                                </span>
                                <span className="text-caption text-faint" dir="ltr">
                                    {option.hint}
                                </span>
                            </li>
                        ))
                    )}
                </ul>
                <p className="border-t border-hairline px-sm py-xxs text-caption text-faint">
                    ↑ ↓ للتنقّل · Enter للفتح · Esc للإغلاق
                </p>
            </div>
        </div>
    );
}
