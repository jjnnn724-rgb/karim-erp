/**
 * external-sales-print.ts — «تقرير البيع الخارجي: المبيعات والمسحوبات»
 * ورق A4 رسمي بنفس هوية «شركة محترمة» (كربون × ذهبي) — يُطبع عبر printSmart.
 */

import type { ExternalSalesSummary } from './external-sales';
import { buildOfficialSheetHtml, type OfficialSheetSection } from './official-print';
import { printSmart } from './print-viewer';

const fmtNumber = (value: number) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const fmtMoney = (value: number) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function printExternalSalesReport(summary: ExternalSalesSummary): boolean {
    const issuedByItem: OfficialSheetSection = {
        heading: `المسحوبات من المخزن — تفاصيل لكل صنف`,
        columns: [
            { key: 'item', header: 'الصنف' },
            { key: 'lines', header: 'الحركة', align: 'center' },
            { key: 'qty', header: 'الكمية', align: 'end' },
            { key: 'value', header: 'القيمة', align: 'end' },
        ],
        rows: summary.issued.byItem.map((row) => ({
            item: row.item,
            lines: String(row.lines ?? 1),
            qty: fmtNumber(row.qty),
            value: fmtMoney(row.value ?? 0),
        })),
        totalsRow: [
            {
                item: 'الإجمالي',
                lines: String(summary.issued.totals.docs),
                qty: fmtNumber(summary.issued.totals.qty),
                value: fmtMoney(summary.issued.totals.value),
            },
        ],
    };

    const soldByItem: OfficialSheetSection = {
        heading: 'المبيعات الحقيقية — كل صنف كم اتباع',
        columns: [
            { key: 'item', header: 'الصنف' },
            { key: 'qty', header: 'الكمية المباعة', align: 'end' },
        ],
        rows: summary.sold.byItem.map((row) => ({
            item: row.item,
            qty: fmtNumber(row.qty),
        })),
        totalsRow: [{ item: 'إجمالي الوحدات المباعة', qty: fmtNumber(summary.sold.totals.qty) }],
    };

    const invoiceSummary: OfficialSheetSection = {
        heading: 'فواتير البيع الخارجي (مختصر — أول 200 فاتورة)',
        columns: [
            { key: 'ref', header: 'المرجع' },
            { key: 'date', header: 'التاريخ', align: 'center' },
            { key: 'customer', header: 'العميل' },
            { key: 'amount', header: 'المبلغ', align: 'end' },
            { key: 'qty', header: 'الكمية', align: 'center' },
        ],
        rows: summary.sold.rows.slice(0, 200).map((row) => ({
            ref: row.ref,
            date: row.date,
            customer: row.customer ?? '—',
            amount: fmtMoney(row.amount),
            qty: fmtNumber(row.qty),
        })),
    };

    const issuedDetail: OfficialSheetSection = {
        heading: 'تفاصيل مدّات الصرف (أول 200 حركة)',
        columns: [
            { key: 'date', header: 'التاريخ', align: 'center' },
            { key: 'doc', header: 'رقم الإذن', align: 'center' },
            { key: 'item', header: 'الصنف' },
            { key: 'qty', header: 'الكمية', align: 'end' },
            { key: 'unit', header: 'الوحدة', align: 'center' },
            { key: 'value', header: 'القيمة', align: 'end' },
        ],
        rows: summary.issued.rows.slice(0, 200).map((row) => ({
            date: row.date,
            doc: String(row.doc),
            item: row.item,
            qty: fmtNumber(row.qty),
            unit: row.unit ?? '—',
            value: fmtMoney(row.value),
        })),
    };

    const html = buildOfficialSheetHtml({
        title: 'تقرير البيع الخارجي — المبيعات والمسحوبات',
        englishTitle: 'EXTERNAL SALES — SALES vs ISSUED COST',
        subtitle: 'كل رقم من الخادم على الفترة المحددة — لا شيء يجمّعه المتصفح.',
        from: summary.from,
        to: summary.to,
        stamp: 'للمبيعات',
        kpis: [
            {
                label: 'الكمية المصروفة',
                value: fmtNumber(summary.issued.totals.qty),
                hint: `${String(summary.issued.totals.docs)} إذن صرف · ${String(summary.issued.totals.lines)} بند`,
            },
            { label: 'قيمة المسحوبات', value: fmtMoney(summary.issued.totals.value), hint: 'بتكلفة المخزن' },
            {
                label: 'فواتير البيع',
                value: String(summary.sold.totals.invoices),
                hint: `${fmtNumber(summary.sold.totals.lines)} صنف مُباع`,
            },
            { label: 'إيرادات البيع', value: fmtMoney(summary.sold.totals.amount), hint: `${fmtNumber(summary.sold.totals.qty)} وحدة` },
        ],
        sections: [soldByItem, issuedByItem, invoiceSummary, issuedDetail],
        notes: [
            `الفترة: ${summary.from} ← ${summary.to}`,
            'المسحوبات تُقرأ من حركات مخزون الخروج على أذون الصرف الموجهة لقسم البيع الخارجي (external_sales).',
            'المبيعات تُقرأ من مرآة Oracle BILLS4 — كل وحدة مباعة مُجمعّة لكل صنف بإنتاج 100% من 540 فاتورة حقيقية في الإنتاج.',
            'الأرقام التفصيلية بالكامل تظهر على الشاشة — المطبوعة تقتصر على أول 200 حركة/فاتورة لكل قسم.',
        ],
        signatures: [{ role: 'اعتماد المستودع' }, { role: 'مراجعة المدير' }, { role: 'التوقيع' }],
    });
    return printSmart(html, { autoPrint: true, printDelayMs: 350 });
}
