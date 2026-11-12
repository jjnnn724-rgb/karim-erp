import { useEffect, useState } from 'react';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../../components/TableState';
import type { BuffetInvoiceRow, BuffetReport, BuffetTier } from '../../lib/pos';
import { parsePosMoney } from '../../lib/pos-pricing';
import { intOf } from '../../lib/reporting';
import { Badge, Button, Input } from '../../ui';
import { buffetPriceKey, escapeHtml, moneyText, openPrintWindow, orderStatusLabel, paymentMethodLabel } from './pos-ui';

interface TierDraft {
    name: string;
    price: string;
}

export interface PosBuffetPricesProps {
    tiers: readonly BuffetTier[];
    canManage: boolean;
    busy: boolean;
    onBack: () => void;
    onSave: (prices: Record<string, number>, renames: Array<{ id: string; name: string }>) => void;
    onAdd: (name: string, price: number) => void;
    onToggle: (tier: BuffetTier) => void;
}

/** قائمة أسعار البوفيه — السعر يسري على الفواتير الجديدة فقط. */
export function PosBuffetPrices({ tiers, canManage, busy, onBack, onSave, onAdd, onToggle }: PosBuffetPricesProps) {
    const [draft, setDraft] = useState<Record<string, TierDraft>>({});
    const [newName, setNewName] = useState('');
    const [newPrice, setNewPrice] = useState('0');
    const [error, setError] = useState('');

    useEffect(() => {
        const next: Record<string, TierDraft> = {};
        tiers.forEach((tier) => {
            next[tier.id] = { name: String(tier.name_ar ?? ''), price: Number(tier.price).toFixed(2) };
        });
        setDraft(next);
        setError('');
    }, [tiers]);

    function update(id: string, patch: Partial<TierDraft>) {
        setDraft((current) => ({ ...current, [id]: { ...current[id], ...patch } as TierDraft }));
    }

    function save() {
        const prices: Record<string, number> = {};
        const renames: Array<{ id: string; name: string }> = [];
        for (const tier of tiers) {
            const row = draft[tier.id];
            if (!row) {
                continue;
            }
            const active = tier.is_active !== false;
            if (!active) {
                continue;
            }
            const price = parsePosMoney(row.price);
            if (!Number.isFinite(price)) {
                setError('كل الأسعار يجب أن تكون أرقامًا موجبة أو صفرًا.');
                return;
            }
            prices[buffetPriceKey(tier)] = price;
            if (tier.is_core !== true) {
                const name = row.name.trim();
                if (!name) {
                    setError('اسم الفئة مطلوب.');
                    return;
                }
                if (name !== String(tier.name_ar ?? '')) {
                    renames.push({ id: tier.id, name });
                }
            }
        }
        if (!Object.keys(prices).length) {
            setError('لا توجد أسعار لحفظها.');
            return;
        }
        setError('');
        onSave(prices, renames);
    }

    function add() {
        const name = newName.trim();
        const price = parsePosMoney(newPrice);
        if (!name) {
            setError('أدخل اسم الفئة الجديدة.');
            return;
        }
        if (!Number.isFinite(price)) {
            setError('السعر يجب أن يكون رقمًا موجبًا أو صفرًا.');
            return;
        }
        setError('');
        onAdd(name, price);
        setNewName('');
        setNewPrice('0');
    }

    return (
        <section className="erp-card pos-buffet-prices" aria-labelledby="pos-buffet-prices-title">
            <div className="erp-card__head">
                <h2 id="pos-buffet-prices-title" className="erp-card__title">
                    قائمة أسعار البوفيه
                </h2>
                <span className="erp-grow" />
                <Button size="sm" variant="secondary" onClick={onBack}>
                    العودة إلى الكاشير
                </Button>
            </div>
            <div className="erp-card__body erp-stack">
                <p className="text-body-sm text-muted">
                    التعديل يسري على الفواتير الجديدة فقط. فئات كبير/صغير/ضيافة أساسية يمكن تعديل سعرها فقط، وإضافة فئات جديدة متاحة دائمًا.
                </p>

                {tiers.length === 0 ? (
                    <StateEmpty title="لا توجد فئات بعد" hint="أضف فئة جديدة من الحقول أدناه لبدء البيع." />
                ) : (
                    <div className="pos-buffet-prices__rows">
                        {tiers.map((tier) => {
                            const active = tier.is_active !== false;
                            const core = tier.is_core === true;
                            const row = draft[tier.id] ?? { name: String(tier.name_ar ?? ''), price: '0.00' };
                            return (
                                <div key={tier.id} className={`pos-buffet-prices__row${active ? '' : ' is-inactive'}`}>
                                    <div className="pos-buffet-prices__name">
                                        {core ? (
                                            <>
                                                <strong>{tier.name_ar}</strong>
                                                <Badge variant="info">فئة أساسية</Badge>
                                            </>
                                        ) : (
                                            <Input
                                                aria-label="اسم الفئة"
                                                maxLength={100}
                                                value={row.name}
                                                disabled={!active || !canManage || busy}
                                                onChange={(event) => {
                                                    update(tier.id, { name: event.target.value });
                                                }}
                                            />
                                        )}
                                        {!active ? <Badge variant="warning">معطّلة</Badge> : null}
                                    </div>
                                    <Input
                                        label="السعر لكل فرد"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        dir="ltr"
                                        value={row.price}
                                        disabled={!active || !canManage || busy}
                                        onChange={(event) => {
                                            update(tier.id, { price: event.target.value });
                                        }}
                                    />
                                    <span className="text-body-sm text-muted">ضريبة {intOf(tier.vat_rate)}%</span>
                                    {core ? (
                                        <span aria-hidden="true" />
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={!canManage || busy}
                                            onClick={() => {
                                                onToggle(tier);
                                            }}
                                        >
                                            {active ? 'تعطيل' : 'تفعيل'}
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="pos-buffet-prices__new">
                    <Input
                        label="فئة جديدة"
                        maxLength={100}
                        placeholder="مثال: بوفيه عائلي"
                        value={newName}
                        disabled={!canManage || busy}
                        onChange={(event) => {
                            setNewName(event.target.value);
                        }}
                    />
                    <Input
                        label="السعر"
                        type="number"
                        min="0"
                        step="0.01"
                        dir="ltr"
                        value={newPrice}
                        disabled={!canManage || busy}
                        onChange={(event) => {
                            setNewPrice(event.target.value);
                        }}
                    />
                    <Button size="sm" variant="secondary" disabled={!canManage || busy} onClick={add}>
                        إضافة الفئة
                    </Button>
                    <Button variant="primary" loading={busy} disabled={!canManage || !tiers.length} onClick={save}>
                        حفظ الأسعار والأسماء
                    </Button>
                </div>
                {error ? (
                    <p className="text-body-sm text-danger" role="alert">
                        {error}
                    </p>
                ) : null}
            </div>
        </section>
    );
}

export interface PosBuffetReportProps {
    date: string;
    onDate: (date: string) => void;
    report: BuffetReport | undefined;
    invoices: readonly BuffetInvoiceRow[];
    loading: boolean;
    error: string;
    onRetry: () => void;
    onBack: () => void;
}

function coverSummary(invoice: BuffetInvoiceRow): string {
    const tiers = invoice.covers?.tiers;
    if (!tiers) {
        return '—';
    }
    return (
        Object.values(tiers)
            .map((tier) => `${String(tier.name ?? 'فئة')}: ${intOf(tier.covers ?? 0)}`)
            .join(' • ') || '—'
    );
}

function reportHtml(report: BuffetReport, invoices: readonly BuffetInvoiceRow[]): string {
    const total = report.totals;
    const cards: Array<[string, string]> = [
        ['إجمالي الأفراد', intOf(total.covers_total ?? 0)],
        ['الإيراد المحصل', moneyText(total.revenue ?? 0)],
        ['ضريبة القيمة المضافة', moneyText(total.vat_total ?? 0)],
        ['صافي الإيراد', moneyText(total.net_revenue ?? 0)],
        ['الفواتير', intOf(total.invoices ?? 0)],
        ['متوسط الفرد', moneyText(total.revenue_per_cover ?? 0)],
        ['فواتير ملغاة', `${intOf(total.voided?.count ?? 0)} (${moneyText(total.voided?.amount ?? 0)})`],
        ['معلقة بالكاشير', `${intOf(total.still_held?.count ?? 0)} (${moneyText(total.still_held?.amount ?? 0)})`],
    ];
    const tierRows = report.tiers
        .map(
            (tier) =>
                `<tr><td>${escapeHtml(tier.name ?? '—')}</td><td>${intOf(tier.covers ?? 0)}</td>` +
                `<td>${moneyText(tier.revenue ?? 0)}</td><td>${moneyText(tier.avg_price ?? 0)}</td>` +
                `<td>${intOf(tier.invoices ?? 0)}</td></tr>`,
        )
        .join('');
    const hourlyRows = report.hourly
        .map(
            (row) =>
                `<tr><td>${String(row.hour ?? 0).padStart(2, '0')}:00</td><td>${intOf(row.invoices ?? 0)}</td>` +
                `<td>${intOf(row.covers ?? 0)}</td><td>${moneyText(row.revenue ?? 0)}</td></tr>`,
        )
        .join('');
    const paymentRows = report.payments
        .map(
            (row) =>
                `<tr><td>${escapeHtml(paymentMethodLabel(row.method))}</td><td>${intOf(row.count ?? 0)}</td>` +
                `<td>${moneyText(row.total ?? 0)}</td></tr>`,
        )
        .join('');
    const cashierRows = report.cashiers
        .map(
            (row) =>
                `<tr><td>${escapeHtml(row.cashier ?? '—')}</td><td>${intOf(row.invoices ?? 0)}</td>` +
                `<td>${moneyText(row.revenue ?? 0)}</td></tr>`,
        )
        .join('');
    const invoiceRows = invoices
        .map(
            (invoice) =>
                `<tr><td>#${escapeHtml(invoice.invoice_counter ?? invoice.id)}</td>` +
                `<td dir="ltr">${escapeHtml(invoice.created_at ?? '—')}</td>` +
                `<td>${intOf(invoice.covers?.covers_total ?? 0)}</td><td>${escapeHtml(coverSummary(invoice))}</td>` +
                `<td>${moneyText(invoice.total_amount)}</td><td>${escapeHtml(orderStatusLabel(invoice.status))}</td>` +
                `<td>${escapeHtml(invoice.cashier_name ?? '—')}</td></tr>`,
        )
        .join('');

    return (
        `<h1>تقرير البوفيه المفتوح — ${escapeHtml(report.date)}</h1>` +
        '<div class="cards">' +
        cards
            .map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
            .join('') +
        '</div>' +
        '<h2>حسب الفئة</h2><table><thead><tr><th>الفئة</th><th>أفراد</th><th>الإيراد الصافي</th><th>متوسط الفرد</th><th>فواتير</th></tr></thead>' +
        `<tbody>${tierRows || '<tr><td colspan="5">لا مبيعات</td></tr>'}</tbody></table>` +
        '<h2>التوزيع الساعي</h2><table><thead><tr><th>الساعة</th><th>فواتير</th><th>أفراد</th><th>الإيراد</th></tr></thead>' +
        `<tbody>${hourlyRows || '<tr><td colspan="4">—</td></tr>'}</tbody></table>` +
        '<h2>طرق الدفع</h2><table><thead><tr><th>الطريقة</th><th>عدد</th><th>المبلغ</th></tr></thead>' +
        `<tbody>${paymentRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>` +
        '<h2>أداء الكاشيرين</h2><table><thead><tr><th>الكاشير</th><th>فواتير</th><th>الإيراد</th></tr></thead>' +
        `<tbody>${cashierRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>` +
        '<h2>فواتير البوفيه</h2><table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>أفراد</th><th>الفئات</th><th>الإجمالي</th><th>الحالة</th><th>الكاشير</th></tr></thead>' +
        `<tbody>${invoiceRows || '<tr><td colspan="7">لا فواتير</td></tr>'}</tbody></table>`
    );
}

/** تقرير البوفيه اليومي — أرقام الخادم كما هي، وطباعة محلية للعرض. */
export function PosBuffetReport({ date, onDate, report, invoices, loading, error, onRetry, onBack }: PosBuffetReportProps) {
    const [draftDate, setDraftDate] = useState(date);
    const [problem, setProblem] = useState('');
    const [printError, setPrintError] = useState('');

    useEffect(() => {
        setDraftDate(date);
    }, [date]);

    function run() {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draftDate)) {
            setProblem('تاريخ التقرير غير صالح.');
            return;
        }
        setProblem('');
        // نفس اليوم يعني إعادة قراءة الخادم، لا تغيير مفتاح بلا طلب.
        if (draftDate === date) {
            onRetry();
        } else {
            onDate(draftDate);
        }
    }

    const total = report?.totals;

    return (
        <section className="erp-card pos-buffet-report" aria-labelledby="pos-buffet-report-title">
            <div className="erp-card__head">
                <h2 id="pos-buffet-report-title" className="erp-card__title">
                    تقرير البوفيه المفتوح
                </h2>
                <span className="erp-grow" />
                <Button size="sm" variant="secondary" onClick={onBack}>
                    العودة إلى الكاشير
                </Button>
            </div>
            <div className="erp-card__body erp-stack">
                <div className="pos-buffet-report__filters">
                    <Input
                        label="تاريخ التقرير"
                        type="date"
                        dir="ltr"
                        value={draftDate}
                        onChange={(event) => {
                            setDraftDate(event.target.value);
                        }}
                    />
                    <Button variant="primary" size="sm" loading={loading} onClick={run}>
                        عرض التقرير
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={!report}
                        onClick={() => {
                            setPrintError('');
                            if (!report) {
                                return;
                            }
                            const opened = openPrintWindow(`تقرير البوفيه — ${report.date}`, reportHtml(report, invoices));
                            if (!opened) {
                                setPrintError('حجب المتصفح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
                            }
                        }}
                    >
                        طباعة التقرير
                    </Button>
                </div>
                {problem ? (
                    <p className="text-body-sm text-danger" role="alert">
                        {problem}
                    </p>
                ) : null}
                {printError ? (
                    <p className="text-body-sm text-danger" role="alert">
                        {printError}
                    </p>
                ) : null}

                {loading ? <StateLoading label="جارٍ توليد تقرير البوفيه…" /> : null}
                {error ? <StateError message={error} onRetry={onRetry} /> : null}

                {report && !loading && !error ? (
                    <>
                        <ul className="pos-report__kpis" aria-label="مؤشرات تقرير البوفيه">
                            {[
                                ['إجمالي الأفراد', intOf(total?.covers_total ?? 0)],
                                ['الإيراد المحصل', moneyText(total?.revenue ?? 0)],
                                ['ضريبة القيمة المضافة', moneyText(total?.vat_total ?? 0)],
                                ['صافي الإيراد', moneyText(total?.net_revenue ?? 0)],
                                ['الفواتير', intOf(total?.invoices ?? 0)],
                                ['متوسط الفرد', moneyText(total?.revenue_per_cover ?? 0)],
                                ['ملغاة', `${intOf(total?.voided?.count ?? 0)} · ${moneyText(total?.voided?.amount ?? 0)}`],
                                [
                                    'معلقة بالكاشير',
                                    `${intOf(total?.still_held?.count ?? 0)} · ${moneyText(total?.still_held?.amount ?? 0)}`,
                                ],
                            ].map(([label, value]) => (
                                <li key={label}>
                                    <span>{label}</span>
                                    <strong>{value}</strong>
                                </li>
                            ))}
                        </ul>

                        <h3 className="text-heading-sm text-ink">حسب الفئة</h3>
                        {report.tiers.length ? (
                            <TableScroll label="تقرير البوفيه حسب الفئة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الفئة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                أفراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإيراد الصافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                متوسط الفرد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.tiers.map((tier, index) => (
                                            <tr key={`${String(tier.name)}-${String(index)}`} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">{tier.name || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(tier.covers ?? 0)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(tier.revenue ?? 0)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(tier.avg_price ?? 0)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(tier.invoices ?? 0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="text-body-sm text-muted">لا مبيعات في هذا اليوم.</p>
                        )}

                        <h3 className="text-heading-sm text-ink">التوزيع الساعي</h3>
                        {report.hourly.length ? (
                            <TableScroll label="تقرير البوفيه حسب الساعة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الساعة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                أفراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإيراد
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.hourly.map((row) => (
                                            <tr key={String(row.hour ?? 0)} className="border-b border-hairline">
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {`${String(row.hour ?? 0).padStart(2, '0')}:00`}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(row.invoices ?? 0)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(row.covers ?? 0)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(row.revenue ?? 0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="text-body-sm text-muted">—</p>
                        )}

                        <div className="pos-report__split">
                            <div>
                                <h3 className="text-heading-sm text-ink">طرق الدفع</h3>
                                {report.payments.length ? (
                                    <TableScroll label="طرق دفع البوفيه">
                                        <table className="w-full border-collapse text-body-md">
                                            <thead>
                                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        الطريقة
                                                    </th>
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        عدد
                                                    </th>
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        المبلغ
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {report.payments.map((row, index) => (
                                                    <tr key={`${String(row.method)}-${String(index)}`} className="border-b border-hairline">
                                                        <td className="px-sm py-xxs text-ink">{paymentMethodLabel(row.method)}</td>
                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                            {intOf(row.count ?? 0)}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                            {moneyText(row.total ?? 0)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </TableScroll>
                                ) : (
                                    <p className="text-body-sm text-muted">—</p>
                                )}
                            </div>
                            <div>
                                <h3 className="text-heading-sm text-ink">أداء الكاشيرين</h3>
                                {report.cashiers.length ? (
                                    <TableScroll label="أداء كاشيري البوفيه">
                                        <table className="w-full border-collapse text-body-md">
                                            <thead>
                                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        الكاشير
                                                    </th>
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        فواتير
                                                    </th>
                                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                                        الإيراد
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {report.cashiers.map((row, index) => (
                                                    <tr
                                                        key={`${String(row.cashier)}-${String(index)}`}
                                                        className="border-b border-hairline"
                                                    >
                                                        <td className="px-sm py-xxs text-ink">{row.cashier || '—'}</td>
                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                            {intOf(row.invoices ?? 0)}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                            {moneyText(row.revenue ?? 0)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </TableScroll>
                                ) : (
                                    <p className="text-body-sm text-muted">—</p>
                                )}
                            </div>
                        </div>

                        <h3 className="text-heading-sm text-ink">فواتير البوفيه</h3>
                        {invoices.length ? (
                            <TableScroll label="فواتير البوفيه">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                رقم الفاتورة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التاريخ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                أفراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الفئات
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإجمالي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكاشير
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.map((invoice) => (
                                            <tr key={invoice.id} className="border-b border-hairline">
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    #{String(invoice.invoice_counter ?? invoice.id)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {invoice.created_at || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(invoice.covers?.covers_total ?? 0)}
                                                </td>
                                                <td className="px-sm py-xxs text-muted">{coverSummary(invoice)}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyText(invoice.total_amount)}
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Badge variant={invoice.status === 'cancelled' ? 'danger' : 'success'}>
                                                        {orderStatusLabel(invoice.status)}
                                                    </Badge>
                                                </td>
                                                <td className="px-sm py-xxs text-ink">{invoice.cashier_name || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="text-body-sm text-muted">لا فواتير بوفيه في هذا اليوم.</p>
                        )}
                    </>
                ) : null}
            </div>
        </section>
    );
}
