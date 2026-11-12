/**
 * واجهة نظام التصميم — نقطة الاستيراد الواحدة لمكوّنات `src/ui/`.
 *
 * قاعدة الحزمة (ADR-003): هذه الواجهة لا تسحب أي مكتبة رسوم إلى الحزمة
 * الأولية. `Chart` هنا غلاف فقط، والتنفيذ الثقيل يُحمَّل ديناميكيًا.
 */

export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export {
    Button,
    type ButtonProps,
    type ButtonSize,
    type ButtonVariant,
} from './Button';
export type {
    CardBodyProps,
    CardDescriptionProps,
    CardFooterProps,
    CardHeaderProps,
    CardProps,
    CardTitleProps,
} from './Card';
export {
    Card,
    CardBody,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from './Card';
export {
    Chart,
    type ChartKind,
    type ChartProps,
    type ChartRow,
    type ChartSeries,
} from './Chart';
export { Checkbox, type CheckboxProps, type CheckedState } from './Checkbox';
export { Combobox, type ComboboxOption, type ComboboxProps } from './Combobox';
export { type ClassValue, cn } from './cn';
export {
    DataTable,
    type DataTableColumn,
    type DataTablePagination,
    type DataTableProps,
    type DataTableState,
} from './DataTable';
export { Dialog, type DialogProps, type DialogSize } from './Dialog';
export { Drawer, type DrawerProps, type DrawerSide } from './Drawer';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { FilterBar, type FilterBarProps } from './FilterBar';
export {
    IconButton,
    type IconButtonProps,
    type IconButtonSize,
    type IconButtonVariant,
} from './IconButton';
export { type ControlSize, Input, type InputProps } from './Input';
export {
    KpiTile,
    type KpiTileProps,
    type KpiTone,
    type KpiTrend,
} from './KpiTile';
export {
    AppPageHeader,
    type AppPageHeaderProps,
    PageHeader,
    type PageHeaderProps,
} from './PageHeader';
export {
    Pagination,
    type PaginationLabels,
    type PaginationProps,
} from './Pagination';
export {
    Radio,
    RadioGroup,
    type RadioGroupProps,
    type RadioOption,
    type RadioProps,
} from './Radio';
export { type RowAction, RowActions, type RowActionsProps } from './RowActions';
export { SearchInput, type SearchInputProps } from './SearchInput';
export {
    SegmentedControl,
    type SegmentedControlProps,
    type SegmentedOption,
    type SegmentedSize,
} from './SegmentedControl';
export {
    Select,
    type SelectOption,
    SelectParts,
    type SelectProps,
} from './Select';
export { Skeleton, type SkeletonProps, type SkeletonVariant } from './Skeleton';
export { StatCard, type StatCardProps } from './StatCard';
export { Switch, type SwitchProps } from './Switch';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
export { Textarea, type TextareaProps } from './Textarea';
export {
    type ThemeContextValue,
    ThemeProvider,
    type ThemeProviderProps,
    useTheme,
} from './ThemeProvider';
export { ThemeToggle, type ThemeToggleProps } from './ThemeToggle';
export {
    type ToastContextValue,
    type ToastOptions,
    ToastProvider,
    type ToastProviderProps,
    type ToastVariant,
    useToast,
} from './Toast';
export { Tooltip, type TooltipProps, type TooltipSide } from './Tooltip';
export {
    applyTheme,
    getSystemTheme,
    type ResolvedTheme,
    readStoredTheme,
    resolveTheme,
    THEME_STORAGE_KEY,
    type Theme,
} from './theme';
