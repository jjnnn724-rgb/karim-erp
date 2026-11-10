import { Link } from '@tanstack/react-router';
import { groupForPath, HOME_PATH, HOME_TITLE, titleForPath } from '../lib/navigation';

/**
 * مسار التنقّل (Breadcrumbs) — من خريطة المسارات/العناوين في
 * `lib/navigation.ts`، لا من نصٍّ يكتبه كل شاشة.
 *
 * الشكل: `الرئيسية › {المجموعة} › {الشاشة}`. المجموعة ليست رابطًا (لا مسار
 * لها)، والشاشة الحالية `aria-current="page"` بلا رابط. الفاصل زخرفي
 * (`aria-hidden`)، والعنصر النشط لا يُلوَّن وحده — النصّ والموقع يكفيان.
 *
 * `pathname` يُمرَّر صراحةً (لا `useRouterState`) فتُختبر الوحدة بلا مُوجِّه،
 * والقشرة تمرّر المسار الحالي.
 */

export interface BreadcrumbsProps {
    readonly pathname: string;
    /** إخفاء «الرئيسية» حين تكون هي الصفحة الحالية (افتراضي: تُعرض). */
    readonly showHome?: boolean;
}

interface Crumb {
    readonly label: string;
    /** الرابط مسموح للرئيسية وحدها — بقية العناصر نصّ لا رابط. */
    readonly to: '/' | null;
}

function buildCrumbs(pathname: string): Crumb[] {
    const title = titleForPath(pathname);
    if (!title) {
        return [];
    }
    if (title === HOME_TITLE) {
        return [{ label: HOME_TITLE, to: null }];
    }
    const group = groupForPath(pathname);
    const crumbs: Crumb[] = [{ label: HOME_TITLE, to: HOME_PATH }];
    if (group) {
        crumbs.push({ label: group.label, to: null });
    }
    crumbs.push({ label: title, to: null });
    return crumbs;
}

export function Breadcrumbs({ pathname, showHome = true }: BreadcrumbsProps) {
    const crumbs = buildCrumbs(pathname);
    if (crumbs.length === 0) {
        return null;
    }
    return (
        <nav aria-label="مسار التنقّل" className="mb-sm" data-erp-print-hide>
            <ol className="flex list-none flex-wrap items-center gap-xxs p-0 text-caption text-muted">
                {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1;
                    return (
                        <li key={`${crumb.label}-${String(index)}`} className="flex items-center gap-xxs">
                            {index > 0 ? (
                                <span aria-hidden="true" className="text-faint">
                                    ›
                                </span>
                            ) : null}
                            {isLast ? (
                                <span aria-current="page" className="text-ink-secondary">
                                    {crumb.label}
                                </span>
                            ) : crumb.to && (showHome || crumb.to !== HOME_PATH) ? (
                                <Link to={crumb.to} className="rounded-sm text-muted hover:text-ink-secondary">
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className="text-muted">{crumb.label}</span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
