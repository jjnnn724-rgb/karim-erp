import type { V3ChartAccount } from '@karim/shared';
import type { AccountChartTypeFilter } from '../lib/account-chart';
import { SearchInput, Select } from '../ui';

const ACCOUNT_TYPE_OPTIONS = [
    { value: 'asset', label: 'أصول' },
    { value: 'liability', label: 'التزامات' },
    { value: 'equity', label: 'حقوق ملكية' },
    { value: 'revenue', label: 'إيرادات' },
    { value: 'cogs', label: 'تكلفة مبيعات' },
    { value: 'expense', label: 'مصروفات' },
] as const satisfies readonly { value: V3ChartAccount['type']; label: string }[];

const ALL_TYPES_OPTION = { value: 'all', label: 'كل الأنواع' } as const;
const ALL_LEVELS_OPTION = { value: 'all', label: 'كل المستويات' } as const;

export interface AccountChartFilterDraft {
    search: string;
    type: AccountChartTypeFilter;
    level: number | null;
}

function isAccountType(value: string): value is V3ChartAccount['type'] {
    return ACCOUNT_TYPE_OPTIONS.some((option) => option.value === value);
}

export interface AdvancedFiltersProps {
    value: AccountChartFilterDraft;
    levels: readonly number[];
    onTypeChange: (type: AccountChartTypeFilter) => void;
    onLevelChange: (level: number | null) => void;
}

export function AdvancedFilters({ value, levels, onTypeChange, onLevelChange }: AdvancedFiltersProps) {
    const levelOptions = [ALL_LEVELS_OPTION, ...levels.map((level) => ({ value: String(level), label: `المستوى ${String(level)}` }))];

    return (
        <div className="grid gap-sm sm:grid-cols-3">
            <Select
                label="نوع الحساب"
                value={value.type}
                options={[ALL_TYPES_OPTION, ...ACCOUNT_TYPE_OPTIONS]}
                onValueChange={(next) => {
                    if (next === 'all' || isAccountType(next)) {
                        onTypeChange(next);
                    }
                }}
            />
            <Select
                label="مستوى الحساب"
                value={value.level === null ? 'all' : String(value.level)}
                options={levelOptions}
                onValueChange={(next) => {
                    const level = Number(next);
                    onLevelChange(next === 'all' ? null : Number.isInteger(level) && levels.includes(level) ? level : null);
                }}
            />
            <Select
                label="الفرع"
                options={[]}
                disabled
                placeholder="غير متاح حاليًا"
                hint="واجهة الحسابات الحالية لا تتضمن ارتباطًا بالفرع."
            />
        </div>
    );
}

export interface SearchToolbarProps {
    value: AccountChartFilterDraft;
    levels: readonly number[];
    onChange: (value: AccountChartFilterDraft) => void;
    onApply: () => void;
    onReset: () => void;
}

export function SearchToolbar({ value, levels, onChange, onApply, onReset }: SearchToolbarProps) {
    return (
        <form
            className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md"
            onSubmit={(event) => {
                event.preventDefault();
                onApply();
            }}
        >
            <SearchInput
                label="بحث في الحسابات"
                value={value.search}
                placeholder="رمز الحساب أو اسمه"
                onChange={(search) => {
                    onChange({ ...value, search });
                }}
            />
            <AdvancedFilters
                value={value}
                levels={levels}
                onTypeChange={(type) => {
                    onChange({ ...value, type });
                }}
                onLevelChange={(level) => {
                    onChange({ ...value, level });
                }}
            />
            <div className="flex flex-wrap gap-xs">
                <button
                    type="submit"
                    className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    تطبيق المرشّحات
                </button>
                <button
                    type="button"
                    onClick={onReset}
                    className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    مسح المرشّحات
                </button>
            </div>
        </form>
    );
}
