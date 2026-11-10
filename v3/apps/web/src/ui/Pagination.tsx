import { cn } from './cn';
import { ChevronEndIcon, ChevronStartIcon } from './icons';

/**
 * ترقيم صفحات — أزرار أصلية، الصفحة الحالية `aria-current="page"`، وزرّا
 * السابق/التالي يُعطَّلان عند الحدّين. الصفحات الناقصة تُختصر بـ`…` مع
 * `aria-hidden` (ليست صفحة) وتُبقي أول/آخر صفحة مرئيتين.
 *
 * الأرقام لاتينية وجدولة ثابتة (DESIGN.md).
 */

export interface PaginationLabels {
    previous: string;
    next: string;
    page: (page: number) => string;
    summary: (from: number, to: number, total: number) => string;
}

const DEFAULT_LABELS: PaginationLabels = {
    previous: 'السابق',
    next: 'التالي',
    page: (page) => `الصفحة ${String(page)}`,
    summary: (from, to, total) => `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} من ${total.toLocaleString('en-US')}`,
};

export interface PaginationProps {
    /** رقم الصفحة الحالي (1-based). */
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    siblingCount?: number;
    className?: string;
    labels?: Partial<PaginationLabels>;
}

function buildPages(page: number, totalPages: number, siblingCount: number): Array<number | 'gap-start' | 'gap-end'> {
    const visible = 5 + siblingCount * 2;
    if (totalPages <= visible) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const start = Math.max(2, page - siblingCount);
    const end = Math.min(totalPages - 1, page + siblingCount);
    const pages: Array<number | 'gap-start' | 'gap-end'> = [1];

    if (start > 2) {
        pages.push('gap-start');
    }
    for (let current = start; current <= end; current += 1) {
        pages.push(current);
    }
    if (end < totalPages - 1) {
        pages.push('gap-end');
    }
    pages.push(totalPages);
    return pages;
}

export function Pagination({ page, pageSize, total, onPageChange, siblingCount = 1, className, labels }: PaginationProps) {
    const text = { ...DEFAULT_LABELS, ...labels };
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const to = Math.min(currentPage * pageSize, total);
    const pages = buildPages(currentPage, totalPages, siblingCount);

    return (
        <nav aria-label="ترقيم الصفحات" className={cn('flex flex-wrap items-center justify-between gap-sm', className)}>
            <p className="text-body-sm text-muted">{text.summary(from, to, total)}</p>
            <div className="flex items-center gap-xxs">
                <button
                    type="button"
                    aria-label={text.previous}
                    disabled={currentPage <= 1}
                    onClick={() => {
                        onPageChange(currentPage - 1);
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-surface text-ink transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ChevronStartIcon className="size-4" />
                </button>
                {pages.map((entry) =>
                    typeof entry === 'number' ? (
                        <button
                            key={`page-${String(entry)}`}
                            type="button"
                            aria-label={text.page(entry)}
                            aria-current={entry === currentPage ? 'page' : undefined}
                            onClick={() => {
                                onPageChange(entry);
                            }}
                            className={cn(
                                'inline-flex size-8 items-center justify-center rounded-sm border text-body-sm tabular-nums transition-colors duration-[var(--erp-motion-fast)]',
                                entry === currentPage
                                    ? 'border-primary bg-primary font-semibold text-on-primary'
                                    : 'border-hairline bg-surface text-ink hover:bg-surface-hover',
                            )}
                        >
                            {entry}
                        </button>
                    ) : (
                        <span key={entry} aria-hidden="true" className="px-xxs text-muted">
                            …
                        </span>
                    ),
                )}
                <button
                    type="button"
                    aria-label={text.next}
                    disabled={currentPage >= totalPages}
                    onClick={() => {
                        onPageChange(currentPage + 1);
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-surface text-ink transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ChevronEndIcon className="size-4" />
                </button>
            </div>
        </nav>
    );
}
