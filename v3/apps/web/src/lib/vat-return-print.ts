import { intText, moneyText } from './cash-register';
import {
    type VatReturn,
    type VatSettlement,
    type VatWorksheetRow,
    type VatWorksheetStatus,
    vatFilingDeadline,
    vatReviewFlags,
    vatWorksheet,
} from './vat-return';

/**
 * ورقة مراجعة ضريبة القيمة المضافة — A4 واحدة تجمع كل أرقام الفترة
 * بما فيها خطة التصفية، لتُطبع وتُوقَّع وتُرفق بملف المراجعة.
 *
 * الأرقام كلها من `GET /api/accounting/vat-return` و
 * `POST /api/accounting/vat-settlement` — لا حساب هنا ولا تقريب.
 */

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function amount(value: unknown, currency: string): string {
    return escapeHtml(moneyText(value, currency));
}

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export type VatReviewPrintOptions = {
    byName: string;
    currency?: string;
    generatedAt?: Date;
    settlement?: VatSettlement | null;
};

function figure(label: string, value: unknown, currency: string, hint: string): string {
    return (
        `<div class="fig"><div class="fig-l">${escapeHtml(label)}</div>` +
        `<div class="fig-v">${amount(value, currency)}</div>` +
        `<div class="fig-h">${escapeHtml(hint)}</div></div>`
    );
}

/** عدّاد — بلا كسور ولا عملة (فواتير مرحّلة، حركات غير مصنّفة). */
function counter(label: string, value: unknown, hint: string): string {
    return (
        `<div class="fig"><div class="fig-l">${escapeHtml(label)}</div>` +
        `<div class="fig-v">${escapeHtml(intText(value))}</div>` +
        `<div class="fig-h">${escapeHtml(hint)}</div></div>`
    );
}

const WORKSHEET_STATUS_TEXT: Record<VatWorksheetStatus, string> = {
    ready: 'جاهزة',
    review: 'تحتاج مراجعة',
    missing: 'بيانات ناقصة',
    unavailable: 'غير مسجّلة',
};

/** صفوف خانات الإقرار — «—» لغير المسجّل، لا صفر. */
function worksheetRows(rows: readonly VatWorksheetRow[], available: boolean, currency: string): string {
    return rows
        .map(
            (row) =>
                `<tr><td class="c">${row.box === null ? '—' : escapeHtml(row.box)}</td>` +
                `<td>${escapeHtml(row.label)}${row.status === 'ready' ? '' : `<div class="muted">${escapeHtml(row.note)}</div>`}</td>` +
                `<td class="n">${row.base === null ? '—' : amount(row.base, currency)}</td>` +
                `<td class="n">${row.vat === null ? '—' : amount(row.vat, currency)}</td>` +
                `<td class="c">${available ? escapeHtml(row.documents) : '—'}</td>` +
                `<td class="c">${WORKSHEET_STATUS_TEXT[row.status]}</td></tr>`,
        )
        .join('');
}

function worksheetTable(title: string, rows: readonly VatWorksheetRow[], available: boolean, currency: string): string {
    return `<h3>${escapeHtml(title)}</h3>
        <table><thead><tr><th class="c">الخانة</th><th>البند</th><th class="n">الوعاء</th><th class="n">الضريبة</th>
        <th class="c">المستندات</th><th class="c">الحالة</th></tr></thead>
        <tbody>${worksheetRows(rows, available, currency)}</tbody></table>`;
}

export function vatReviewPrintHtml(report: VatReturn, options: VatReviewPrintOptions): string {
    const currency = String(options.currency ?? '');
    const flags = vatReviewFlags(report);
    const settlement = options.settlement ?? null;
    const generated = (options.generatedAt ?? new Date()).toLocaleString('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });

    const settlementRows = (settlement?.lines ?? [])
        .map(
            (line) =>
                `<tr><td class="c">${escapeHtml(line.account_code)}</td><td>${escapeHtml(line.memo)}</td>` +
                `<td class="n">${amount(line.debit, currency)}</td><td class="n">${amount(line.credit, currency)}</td></tr>`,
        )
        .join('');

    const settlementBlock = settlement
        ? `<div class="sec"><h2>خطة تصفية الضريبة — ${escapeHtml(settlement.month)}</h2>
             <div class="figs">
               ${figure('قيمة التصفية', settlement.clearing, currency, 'Dr 2100 / Cr 1150')}
               ${figure('المستحق بعد التصفية', settlement.net_payable_after, currency, 'رصيد 2100')}
               ${figure('الرصيد المُرحَّل بعد التصفية', settlement.carry_forward_after, currency, 'رصيد 1150')}
             </div>
             ${
                 settlement.lines.length
                     ? `<table><thead><tr><th class="c">الحساب</th><th>البيان</th><th class="n">مدين</th><th class="n">دائن</th></tr></thead><tbody>${settlementRows}</tbody></table>`
                     : '<p class="muted">لا سطور تصفية — لا رصيد يستحق الإقفال.</p>'
             }
             ${
                 settlement.settled
                     ? `<p class="ok">مُرحَّلة مسبقًا بالقيد <b>${escapeHtml(settlement.settled.entry_no)}</b> بتاريخ ${escapeHtml(settlement.settled.date)}.</p>`
                     : '<p class="muted">لم تُرحَّل تصفية هذا الشهر بعد.</p>'
             }</div>`
        : '';

    const reviewBanner = flags.blocked
        ? '<div class="banner warn">المراجعة موقوفة: حركات ضريبية غير مصنّفة أو فرق بين ضريبة فواتير الشراء والأستاذ — عالجها قبل أي استخدام للأرقام.</div>'
        : '<div class="banner ok">لا حركات غير مصنّفة ولا فرق في مطابقة الفواتير — الأرقام جاهزة للمراجعة البشرية.</div>';

    const sheet = vatWorksheet(report);
    const deadline = vatFilingDeadline(report.filing_period_validation?.frequency ?? '', report.to);
    const worksheetBlock = `<div class="sec"><h2>ورقة عمل الإقرار — خانات النموذج</h2>
      <p class="muted">«—» تعني أن النظام لا يسجّل هذه الخانة، وليست صفرًا. الموعد الإرشادي للتقديم: ${
          deadline ? escapeHtml(deadline) : 'غير محدد'
      }.</p>
      ${worksheetTable('المبيعات — ضريبة المخرجات', sheet.sales, sheet.hasSalesDetail, currency)}
      ${worksheetTable('المشتريات — ضريبة المدخلات', sheet.purchases, sheet.hasPurchaseDetail, currency)}
      <p class="muted">صافي المستندات قبل التسويات: ${
          sheet.hasSalesDetail && sheet.hasPurchaseDetail ? amount(sheet.net, currency) : '—'
      } — مستندات تحتاج تصنيفًا يدويًا: ${escapeHtml(sheet.reviewDocuments)}</p>
      </div>`;

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مسودة مراجعة ضريبة القيمة المضافة ${escapeHtml(report.from)} — ${escapeHtml(report.to)}</title>
<style>
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#172b3b;background:#fff;margin:0;padding:28px;direction:rtl}
.sheet{max-width:820px;margin:auto}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:12px}
.brand h1{margin:0;color:#0f766e;font-size:21px}.brand p{margin:4px 0 0;color:#596e80;font-size:12px}
.docno{text-align:left}.docno .no{display:inline-block;border:2px solid #0f766e;border-radius:10px;padding:6px 14px;font-size:15px;font-weight:800;direction:ltr}
.docno .dt{margin-top:6px;color:#596e80;font-size:12px}
.title{background:#102a43;color:#f0f6fa;text-align:center;font-size:17px;font-weight:800;padding:9px;border-radius:10px;margin:14px 0}
.banner{border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:12px}
.banner.warn{background:#fce8e6;border:1px solid #b3261e;color:#8e1f16;font-weight:700}
.banner.ok{background:#e8f6ee;border:1px solid #16834a;color:#12633a;font-weight:700}
.sec{margin-top:14px}.sec h2{font-size:14px;color:#102a43;margin:0 0 7px;border-right:4px solid #0f766e;padding-right:8px}
.sec h3{font-size:12.5px;color:#0f766e;margin:8px 0 2px}
.figs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.fig{background:#f3f6fa;border:1px solid #dce5ec;border-radius:9px;padding:8px 10px}
.fig-l{font-size:11.5px;color:#596e80}.fig-v{font-size:16px;font-weight:800;margin:2px 0}
.fig-h{font-size:10.5px;color:#8496a5}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{background:#eaf0f5;color:#102a43;padding:7px 6px;font-size:12px;border:1px solid #dce5ec}
td{border:1px solid #dce5ec;padding:6px 8px;font-size:12.5px}
td.c{text-align:center}td.n{direction:ltr;unicode-bidi:embed;text-align:right}
.muted{color:#596e80;font-size:12.5px}.ok{color:#12633a;font-size:12.5px;font-weight:700}
.signs{display:flex;gap:24px;margin-top:34px}
.sign{flex:1;text-align:center}.sign .line{border-top:2px dotted #8496a5;margin-top:44px;padding-top:6px;font-weight:700;font-size:12.5px}
.sign .who{color:#596e80;font-size:11.5px}
.foot{border-top:2px solid #0f766e;margin-top:24px;padding-top:8px;display:flex;justify-content:space-between;color:#596e80;font-size:10.5px}
.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#0f766e;color:#fff}
.controls button.secondary{background:#555}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:13mm}}
</style></head><body>
<div class="controls"><button type="button" data-vat-print>طباعة</button><button type="button" class="secondary" data-vat-close>إغلاق</button></div>
<main class="sheet">
<header class="head">
<div class="brand"><h1>مسودة مراجعة ضريبة القيمة المضافة</h1><p>نظام Karim ERP — المراجعة الداخلية قبل أي إقرار رسمي</p></div>
<div class="docno"><div class="no">${escapeHtml(report.from)} ← ${escapeHtml(report.to)}</div><div class="dt">${escapeHtml(generated)}</div></div>
</header>
<div class="title">مراجعة ضريبة القيمة المضافة — ${escapeHtml(report.from)} إلى ${escapeHtml(report.to)}</div>
${reviewBanner}
${worksheetBlock}
<div class="sec"><h2>أرقام الفترة المرحّلة</h2><div class="figs">
${figure('ضريبة المخرجات', report.output_vat, currency, 'ائتمانات 2100')}
${figure('عكس مبيعات ملغاة', report.output_vat_reversals, currency, 'مدين قيود الإلغاء')}
${figure('ضريبة المدخلات', report.input_vat, currency, 'مدين 1150')}
${figure('تعديلات المدخلات', report.input_vat_adjustments, currency, 'إشعارات المورد')}
${figure('صافي مستحق مبدئي', report.net_payable, currency, 'للمراجعة فقط')}
${figure('رصيد دائن مبدئي', report.carry_forward_credit, currency, 'ترحيل للفترة التالية')}
</div></div>
<div class="sec"><h2>مطابقة فواتير الشراء</h2><div class="figs">
${counter('فواتير مرحّلة', report.purchases_crosscheck.count, 'لا فواتير افتتاحية')}
${figure('صافي المشتريات', report.purchases_crosscheck.net, currency, 'من الفواتير المرحّلة')}
${figure('فرق الضريبة عن الأستاذ', flags.invoiceDifference, currency, 'صفر = مطابقة')}
</div></div>
<div class="sec"><h2>أرصدة حسابات الضريبة حتى نهاية الفترة</h2><div class="figs">
${figure('رصيد حساب المخرجات', report.payable_balance, currency, 'الرصيد المرحّل 2100')}
${figure('رصيد حساب المدخلات', report.recoverable_balance, currency, 'الرصيد المرحّل 1150')}
${counter('حركات غير مصنّفة', flags.unclassified, 'مدين غير مصنّف + دائن غير مصنّف')}
</div></div>
${settlementBlock}
<div class="signs">
<div class="sign"><div class="line"></div><div class="who">المحاسب — إعداد</div></div>
<div class="sign"><div class="line"></div><div class="who">المراجع — اعتماد المراجعة الداخلية</div></div>
</div>
<div class="foot">
<div>طُبعت من نظام Karim ERP بواسطة ${escapeHtml(options.byName)} — ${escapeHtml(generated)}</div>
<div>مسودة داخلية — ليست إقرارًا رسميًا ولا تُرسل إلى زاتكا</div>
</div>
</main></body></html>`;
}

/** ملخّص CSV للمراجعة — نفس أرقام الورقة، للجداول والمشاركة مع المحاسب. */
export function vatReviewCsv(report: VatReturn, settlement?: VatSettlement | null): string {
    const rows: string[][] = [
        ['البند', 'القيمة'],
        ['الفترة من', report.from],
        ['الفترة إلى', report.to],
        ['ضريبة المخرجات المرحّلة', String(report.output_vat)],
        ['عكس مبيعات ملغاة', String(report.output_vat_reversals)],
        ['ضريبة المدخلات المرحّلة', String(report.input_vat)],
        ['تعديلات ضريبة المدخلات', String(report.input_vat_adjustments)],
        ['صافي مستحق مبدئي', String(report.net_payable)],
        ['رصيد دائن مبدئي', String(report.carry_forward_credit)],
        ['رصيد حساب المخرجات', String(report.payable_balance)],
        ['رصيد حساب المدخلات', String(report.recoverable_balance)],
        ['فواتير شراء مرحّلة', String(report.purchases_crosscheck.count)],
        ['صافي المشتريات', String(report.purchases_crosscheck.net)],
        ['ضريبة فواتير الشراء', String(report.purchases_crosscheck.vat)],
        ['فرق الضريبة عن الأستاذ', String(vatReviewFlags(report).invoiceDifference)],
        ['حركات غير مصنّفة', String(vatReviewFlags(report).unclassified)],
    ];
    const sheet = vatWorksheet(report);
    for (const row of [...sheet.sales, ...sheet.purchases]) {
        rows.push([
            `خانة ${row.box === null ? '—' : String(row.box)} — ${row.label}`,
            row.base === null
                ? `غير مسجّلة — ${WORKSHEET_STATUS_TEXT[row.status]}`
                : `${row.base} / ضريبة ${row.vat ?? 0} — مستندات ${row.documents}`,
        ]);
    }
    rows.push(['صافي المستندات قبل التسويات', sheet.hasSalesDetail && sheet.hasPurchaseDetail ? String(sheet.net) : 'غير متاح']);
    if (settlement) {
        rows.push(
            ['شهر التصفية', settlement.month],
            ['قيمة التصفية', String(settlement.clearing)],
            ['المستحق بعد التصفية', String(settlement.net_payable_after)],
            ['الرصيد المُرحَّل بعد التصفية', String(settlement.carry_forward_after)],
        );
        for (const line of settlement.lines) {
            rows.push([`سطر التصفية ${line.account_code}`, `${line.memo} — مدين ${line.debit} / دائن ${line.credit}`]);
        }
    }
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

/** اسم ملف موحّد للمراجعة — الشهر من الفترة. */
export function vatReviewFilename(from: string, to: string): string {
    return `مراجعة-ضريبة-القيمة-المضافة-${from}_${to}.csv`;
}
