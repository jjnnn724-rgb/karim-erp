import type { ReactNode } from 'react';
import { RangeControls } from '../components/Reports';
import { SearchInput } from './SearchInput';

/**
 * شريط فلترة موحد — نطاق تاريخ + بحث نصي.
 * يُستبدل التكرار المتطابق في AccountantDashboard/CashierSales/CostAnalysis.
 *
 * الحالات: idle / error (نطاق غير صالح) / applying.
 * RTL آمن: جميع الخصائص منطقية (لا left/right).
 */
export interface FilterBarProps {
    /** نطاق التاريخ اختياري: شاشات البحث فقط (بلا فترة) تتجاهله. */
    from?: string;
    to?: string;
    onFrom?: (value: string) => void;
    onTo?: (value: string) => void;
    onApply?: () => void;
    searchLabel?: string;
    searchPlaceholder?: string;
    searchValue: string;
    onSearchChange: (value: string) => void;
    pending?: boolean;
    error?: string;
    /** مرشّحات متخصصة إضافية تُعرض مع نطاق التاريخ والبحث. */
    advancedFilters?: ReactNode;
    /** محتوى إضافي أسفل الصف (عدّاد نتائج، ملاحظة تطبيع البحث…). */
    footer?: ReactNode;
    /** بلا حاوية بطاقة — عند التضمين داخل بطاقة الشاشة. */
    bare?: boolean;
    onReset?: () => void;
    resetDisabled?: boolean;
    id?: string;
    'data-testid'?: string;
}

export function FilterBar({
    from,
    to,
    onFrom,
    onTo,
    onApply,
    searchLabel = 'بحث',
    searchPlaceholder = 'ابحث…',
    searchValue,
    onSearchChange,
    pending = false,
    error,
    advancedFilters,
    footer,
    bare = false,
    onReset,
    resetDisabled = false,
    id,
    'data-testid': testId,
}: FilterBarProps) {
    const hasRange = Boolean(onFrom && onTo && onApply);
    return (
        <section className={bare ? 'min-w-0' : 'rounded-lg border border-hairline bg-surface shadow-card'}>
            <div className="flex flex-col gap-sm p-md">
                <div className="flex flex-wrap gap-sm items-end">
                    {hasRange ? (
                        <RangeControls
                            from={from ?? ''}
                            to={to ?? ''}
                            onFrom={(value) => onFrom?.(value)}
                            onTo={(value) => onTo?.(value)}
                            onApply={() => onApply?.()}
                            pending={pending}
                        />
                    ) : null}
                    {error ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                    <SearchInput
                        id={id ?? 'filter-search'}
                        label={searchLabel}
                        placeholder={searchPlaceholder}
                        value={searchValue}
                        onChange={onSearchChange}
                        {...(testId ? { 'data-testid': testId } : {})}
                    />
                    {onReset ? (
                        <button
                            type="button"
                            onClick={onReset}
                            disabled={resetDisabled}
                            className="rounded-md border border-hairline px-sm py-xs text-label-md text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                            مسح المرشّحات
                        </button>
                    ) : null}
                </div>
                {advancedFilters ? <div className="flex flex-wrap items-end gap-sm">{advancedFilters}</div> : null}
                {footer ? <div className="flex flex-wrap items-center gap-sm">{footer}</div> : null}
            </div>
        </section>
    );
}
