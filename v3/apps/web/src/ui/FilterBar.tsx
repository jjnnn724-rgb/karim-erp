import { Combobox } from './Combobox';
import { RangeControls } from '../components/Reports';

/**
 * شريط فلترة موحد — نطاق تاريخ + بحث نصي.
 * يُستبدل التكرار المتطابق في AccountantDashboard/CashierSales/CostAnalysis.
 *
 * الحالات: idle / error (نطاق غير صالح) / applying.
 * RTL آمن: جميع الخصائص منطقية (لا left/right).
 */
export interface FilterBarProps {
    from: string;
    to: string;
    onFrom: (value: string) => void;
    onTo: (value: string) => void;
    onApply: () => void;
    searchLabel?: string;
    searchPlaceholder?: string;
    searchValue: string;
    onSearchChange: (value: string) => void;
    pending?: boolean;
    error?: string;
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
    id,
    'data-testid': testId,
}: FilterBarProps) {
    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <div className="flex flex-col gap-sm p-md">
                <div className="flex flex-wrap gap-sm items-end">
                    <RangeControls
                        from={from}
                        to={to}
                        onFrom={onFrom}
                        onTo={onTo}
                        onApply={onApply}
                        pending={pending}
                    />
                    {error ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                    <Combobox
                        id={id ?? 'filter-search'}
                        data-testid={testId ?? ''}
                        options={[]}
                        label={searchLabel}
                        placeholder={searchPlaceholder}
                        value={searchValue}
                        onValueChange={onSearchChange}
                    />
                </div>
            </div>
        </section>
    );
}
