import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import './InventoryInquiryPro.premium.css';
import { ItemDossier } from '../components/ItemDossier';
import { PrintActions } from '../components/PrintActions';
import { RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { Card, StateEmpty, StateError } from '../components/TableState';
import { fetchInquiryExport, fetchInquiryItems, type InquiryRow, saveDownload } from '../lib/inventory-inquiry';
import { errorMessage, intOf, presetRange, rangeProblem, textOf } from '../lib/reporting';

/**
 * البطاقة الفاخرة — منتقي صنف مباشر يفتح بطاقة الصنف الكاملة.
 *
 * نفس باب v2 (`inventory-inquiry-pro.js`): قائمة الأصناف من `/items` ببحث
 * الخادم (لا تحميل كل الأصناف في المتصفح)، والبطاقة من `/item/:id`.
 * لا حساب هنا — المكوّن `ItemDossier` هو نفسه المستخدم في المحرك.
 */
export function InventoryInquiryPro() {
    const initial = presetRange('month');
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [search, setSearch] = useState('');
    const [applied, setApplied] = useState({ from: initial.from, to: initial.to, q: '' });
    const [selected, setSelected] = useState('');

    const problem = rangeProblem(applied.from, applied.to, 93);
    const itemsQuery = useQuery({
        queryKey: ['inquiry-pro-items', applied],
        queryFn: ({ signal }) =>
            fetchInquiryItems({ from: applied.from, to: applied.to, q: applied.q, sort: 'movements', limit: 200 }, signal),
        enabled: problem === '',
    });

    // تصدير القائمة الحالية من الخادم — نفس بحث الشاشة، وبلا مكتبة في المتصفح.
    const exportFile = useMutation({
        mutationFn: () => fetchInquiryExport({ from: applied.from, to: applied.to, q: applied.q, sort: 'movements', limit: 200 }),
        onSuccess: (file) => {
            saveDownload(file);
        },
    });

    const rows: InquiryRow[] = itemsQuery.data?.rows ?? [];
    const activeId = selected || (rows[0] ? String(rows[0].itemId) : '');

    return (
        <div className="erp-premium-screen erp-premium-screen--inventory-inquiry-pro flex flex-col gap-md">
            <ReportHeader
                title="البطاقة الفاخرة"
                english="Professional Item Card"
                description="بطاقة الصنف الكاملة: الكاردكس، المشتريات، أقسام الصرف، الدُفعات، وأسطر نقطة البيع."
                pending={itemsQuery.isFetching}
                onRefresh={() => {
                    void itemsQuery.refetch();
                }}
            />

            <Card>
                <div className="flex flex-col gap-sm p-sm">
                    <RangeControls
                        from={from}
                        to={to}
                        onFrom={setFrom}
                        onTo={setTo}
                        onApply={() => {
                            setSelected('');
                            setApplied({ from, to, q: search.trim() });
                        }}
                        pending={itemsQuery.isFetching}
                    />
                    <div className="flex flex-wrap items-end gap-sm">
                        <label className="flex min-w-48 flex-1 flex-col gap-xxs text-label-md text-ink-secondary">
                            ابحث عن صنف
                            <input
                                type="search"
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        setSelected('');
                                        setApplied({ from, to, q: search.trim() });
                                    }
                                }}
                                placeholder="اسم أو تصنيف أو باركود"
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            />
                        </label>
                        <label className="flex min-w-48 flex-1 flex-col gap-xxs text-label-md text-ink-secondary">
                            الصنف
                            <select
                                value={activeId}
                                onChange={(event) => {
                                    setSelected(event.target.value);
                                }}
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                disabled={rows.length === 0}
                            >
                                {rows.length === 0 ? <option value="">لا صنف يطابق البحث</option> : null}
                                {rows.map((row) => (
                                    <option key={String(row.itemId)} value={String(row.itemId)}>
                                        {textOf(row.itemName) || `#${String(row.itemId)}`}
                                        {row.category ? ` — ${textOf(row.category)}` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-sm" data-erp-print-hide>
                        <button
                            type="button"
                            onClick={() => {
                                exportFile.mutate();
                            }}
                            disabled={exportFile.isPending || rows.length === 0}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            {exportFile.isPending ? 'جارٍ التصدير…' : 'تصدير Excel'}
                        </button>
                        <PrintActions title="البطاقة الفاخرة" />
                        {exportFile.isError ? (
                            <span role="alert" className="text-caption text-danger-text">
                                {errorMessage(exportFile.error)}
                            </span>
                        ) : null}
                        {exportFile.isSuccess ? (
                            <span role="status" className="text-caption text-success-text">
                                تم تصدير الملف
                            </span>
                        ) : null}
                    </div>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                    <p className="text-caption text-muted" role="status">
                        {rows.length === 0 ? 'لا نتائج' : `${intOf(rows.length)} صنفًا في نتائج البحث`}
                    </p>
                </div>
            </Card>

            {itemsQuery.isError ? (
                <StateError
                    message={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                />
            ) : null}

            <SectionCard title="بطاقة الصنف" english="Item dossier">
                {activeId === '' ? (
                    <StateEmpty title="لا صنف مختار" hint="اكتب اسم صنف أو امسح البحث لعرض القائمة." />
                ) : (
                    <ItemDossier itemId={activeId} from={applied.from} to={applied.to} />
                )}
            </SectionCard>
        </div>
    );
}
