import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { readSavedViews, type SavedView, type ViewStorage, writeSavedViews } from '../lib/saved-views';
import { printRegisterTwin, type RegisterTwinInput } from '../lib/screen-document';
import { cn } from './cn';

/**
 * RegisterShell — غلاف السجل الموحّد (نمط توقيعي، 2026-11-21).
 * ────────────────────────────────────────────────────────────────────────────
 * «كل قائمة في النظام بنفس التشريح»: شريط علوي واحد يجمع
 *   العرضات المحفوظة (karim:views:<viewKey>) + فتحة الفلاتر + فتحة الملخص
 *   + التوأم الورقي (printRegisterTwin على OfficialSheetInput) + الأطفال.
 *
 * الجدول نفسه يبقى ملك الشاشة (الأطفال كما هم) — النمط لا يفرض هجرة
 * DataTable؛ يعطي السجلَ عرْنه: عرضة باسم تُستدعى بضغطة، وورقة تُطبع
 * بنفس الهوية، ومكان ثابت لكل شيء.
 *
 * العقد: تطبيق عرضة = `onApplyView(filters)` — الشاشة تملك حالة مرشّحاتها
 * وتحوّل النصوص لأنواعها (الأرقام والتواريخ حالة شاشة).
 */
export interface RegisterShellProps {
    /** مفتاح تخزين فريد للسجل — يصبح `karim:views:<viewKey>`. */
    viewKey: string;
    /** مرشّحات الشاشة الحالية — تُحفظ داخل العرضات وتُقرأ عند التسمية. */
    currentFilters?: Record<string, string>;
    /** يطبّق مرشّحات عرضة محفوظة على حالة الشاشة. */
    onApplyView?: (filters: Record<string, string>) => void;
    /** فتحة الفلاتر (SearchInput/Select/RangeControls…) — سطرها الثابت. */
    filters?: ReactNode;
    /** سطر الملخص الحيّ (عدد الصفوف/النطاق) — نمط Warehouse المثبَّت. */
    summary?: ReactNode;
    /** مواصفة التوأم الورقي — وجودها يُظهر زر «الورقة الرسمية». */
    twin?: () => RegisterTwinInput | null;
    /** إجراءات إضافية بجانب التوأم (تصدير/طباعة الشاشة…) */
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    /** بديل تخزين للاختبارات — الافتراضي localStorage. */
    storage?: ViewStorage | null;
}

const MAX_NAME = 60;

export function RegisterShell({
    viewKey,
    currentFilters = {},
    onApplyView,
    filters,
    summary,
    twin,
    actions,
    children,
    className,
    storage = null,
}: RegisterShellProps) {
    const defaultStorage = useMemo(() => {
        try {
            return typeof window === 'undefined' ? null : window.localStorage;
        } catch {
            return null;
        }
    }, []);
    const effectiveStorage = storage ?? defaultStorage;
    const [views, setViews] = useState<SavedView[]>(() => readSavedViews(viewKey, effectiveStorage));
    const [savingName, setSavingName] = useState('');
    const [savingOpen, setSavingOpen] = useState(false);
    const [busyTwin, setBusyTwin] = useState(false);

    const persist = useCallback(
        (next: SavedView[]) => {
            setViews(next);
            writeSavedViews(viewKey, next, effectiveStorage);
        },
        [viewKey, effectiveStorage],
    );

    function saveCurrent() {
        const name = savingName.trim().slice(0, MAX_NAME);
        if (!name) {
            return;
        }
        const next = [...views.filter((view) => view.name !== name), { name, filters: { ...currentFilters } }];
        persist(next.slice(-12));
        setSavingName('');
        setSavingOpen(false);
    }

    function removeView(name: string) {
        persist(views.filter((view) => view.name !== name));
    }

    function applyView(view: SavedView) {
        onApplyView?.({ ...view.filters });
    }

    function runTwin() {
        if (!twin || busyTwin) {
            return;
        }
        setBusyTwin(true);
        try {
            const input = twin();
            if (input) {
                printRegisterTwin(input);
            }
        } finally {
            setBusyTwin(false);
        }
    }

    const hasFilters = Object.keys(currentFilters).length > 0;

    return (
        <section className={cn('flex flex-col gap-sm', className)} data-testid={`register-${viewKey}`}>
            <div
                className="flex flex-wrap items-center gap-xs rounded-lg border border-hairline bg-surface px-sm py-xs"
                data-erp-print-hide
            >
                {views.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-xxs" role="group" aria-label="العرضات المحفوظة">
                        {views.map((view) => (
                            <span key={view.name} className="inline-flex items-center gap-xxs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        applyView(view);
                                    }}
                                    title="طبّق هذه العرضة"
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-button-md text-ink hover:bg-surface-hover"
                                >
                                    {view.name}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`حذف العرضة ${view.name}`}
                                    title="حذف العرضة"
                                    onClick={() => {
                                        removeView(view.name);
                                    }}
                                    className="rounded-md px-xxs py-xxs text-caption text-faint hover:text-danger-text"
                                >
                                    ✕
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                {savingOpen ? (
                    <span className="inline-flex items-center gap-xxs">
                        <input
                            type="text"
                            value={savingName}
                            onChange={(event) => {
                                setSavingName(event.target.value);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    saveCurrent();
                                }
                            }}
                            placeholder="اسم العرضة"
                            aria-label="اسم العرضة المحفوظة"
                            maxLength={MAX_NAME}
                            className="h-8 w-40 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                        <button
                            type="button"
                            onClick={saveCurrent}
                            disabled={!savingName.trim()}
                            className="rounded-md bg-primary px-sm py-xxs text-button-md text-on-primary disabled:opacity-50"
                        >
                            حفظ
                        </button>
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            setSavingOpen(true);
                        }}
                        disabled={!hasFilters}
                        title={hasFilters ? 'احفظ المرشّحات الحالية كعرضة' : 'لا مرشّحات لحفظها'}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-button-md text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                    >
                        ⭐ حفظ عرضة
                    </button>
                )}
                {filters ? <div className="flex flex-wrap items-center gap-xs">{filters}</div> : null}
                <div className="ms-auto flex flex-wrap items-center gap-xs">
                    {summary}
                    {actions}
                    {twin ? (
                        <button
                            type="button"
                            onClick={runTwin}
                            disabled={busyTwin}
                            title="اطبع الورقة الرسمية لهذا السجل"
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            {busyTwin ? 'جارٍ التجهيز…' : '🧾 الورقة الرسمية'}
                        </button>
                    ) : null}
                </div>
            </div>
            {children}
        </section>
    );
}
