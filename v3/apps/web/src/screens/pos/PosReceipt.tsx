import { useEffect, useState } from 'react';
import type { PosReceiptData } from '../../lib/pos';
import { PRINT_LOGO_FALLBACK, usePrintBrand } from '../../lib/print';
import { Badge, Button } from '../../ui';
import { CARD_BRANDS, escapeHtml, moneyText, openPrintWindow, qrDataUrl } from './pos-ui';

export interface PosReceiptProps {
    receipt: PosReceiptData;
    buffet: boolean;
    canReprint: boolean;
    busy: boolean;
    onReprint: (orderId: string) => void;
    onKot: (orderId: string, counter: number | null) => void;
    onDismiss: () => void;
}

const METHOD_LABELS: Record<string, string> = {
    cash: 'نقدي',
    card: 'بطاقة',
    wallet: 'محفظة',
    bank_transfer: 'تحويل بنكي',
    voucher: 'قسيمة',
    loyalty: 'نقاط ولاء',
};

const THERMAL_CSS =
    '@page{size:80mm auto;margin:0}' +
    '*,*::before,*::after{box-sizing:border-box}' +
    'html,body{margin:0;padding:0;background:#fff;color:#111}' +
    "body{width:80mm;max-width:100%;font-family:'Tajawal','Segoe UI',Tahoma,sans-serif;font-size:11px;line-height:1.45;padding:4mm 3mm 6mm;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    '.rule{border:0;border-top:1px dashed #8a857c;margin:2mm 0}' +
    '.rule.double{border-top:3px double #8a3c07;margin:2.4mm 0}' +
    '.brand{text-align:center;margin:0 0 1.5mm}' +
    '.brand .mark{display:inline-flex;align-items:center;justify-content:center;width:16mm;height:16mm;border:1px solid #8a3c07;border-radius:50%;outline:2.4mm double #8a3c07;outline-offset:1mm;background:#fff}' +
    '.brand img{width:11mm;height:11mm;object-fit:contain}' +
    '.brand h1{font-size:14.5px;font-weight:900;margin:1.6mm 0 0;letter-spacing:0}' +
    '.brand small{font-size:8px;color:#8a3c07;letter-spacing:2px;text-transform:uppercase;font-weight:700}' +
    '.doc-type{display:inline-block;margin:1.6mm auto 0;padding:0.8mm 5mm 1mm;border:1.2px solid #8a3c07;border-radius:999px;color:#8a3c07;font-size:8.5px;font-weight:800}' +
    '.meta{display:flex;flex-direction:column;gap:0.6mm;background:#fdf8ee;border-inline-start:2.4px solid #b45309;border-radius:2mm;padding:2mm 2.2mm;margin:1.5mm 0 2mm;font-size:8.5px}' +
    '.meta .r{display:flex;justify-content:space-between;gap:6px}' +
    '.meta .k{color:#57534e}.meta .v{font-weight:700}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;border:0;font-size:10.5px}' +
    'th{font-size:8px;font-weight:800;color:#fff;background:#8a3c07;padding:1.2mm 1mm;text-align:right;letter-spacing:.4px}' +
    'td{padding:1.2mm 1mm;vertical-align:top;border-bottom:1px solid #efeadd}' +
    'td:last-child{text-align:left;font-variant-numeric:tabular-nums}' +
    '.qty{width:16%;text-align:center}.price{width:26%;text-align:center}.total{width:30%}' +
    'tr:last-child td{border-bottom:0}' +
    '.tot{width:100%;margin-top:1.5mm}' +
    '.tot td{border:0;padding:0.8mm 0}' +
    '.tot .k{color:#57534e}.tot .v{font-weight:700}' +
    '.tot tr.grand td{background:#8a3c07;color:#fff;font-size:14px;font-weight:900;padding:1.6mm 2mm;border-radius:2mm}' +
    '.tot tr.grand .v{color:#ffe9c7}' +
    '.pay td{border-bottom:1px dotted #efeadd;padding:1mm 0}' +
    '.pay .m{color:#57534e;font-weight:600}' +
    '.pay .ref{font-size:8px;color:#a8a29e}' +
    '.pay tr:last-child td{border-bottom:0}' +
    '.change td{color:#047857;font-weight:800}' +
    '.qr{text-align:center;margin:2mm 0 1mm}' +
    '.qr .frame{display:inline-block;border:1.2px solid #8a3c07;outline:2mm double #8a3c07;outline-offset:0.8mm;border-radius:2mm;padding:2mm;background:#fff}' +
    '.qr img{width:32mm;height:32mm}' +
    '.qr-cap{font-size:8px;color:#57534e;letter-spacing:.5px;margin-top:1.2mm;font-weight:600}' +
    '.thanks{text-align:center;font-size:12px;font-weight:900;color:#8a3c07;margin-top:2.5mm}' +
    '.legal{text-align:center;font-size:7.5px;color:#a8a29e;margin-top:1mm}' +
    '.brandline{text-align:center;font-size:6.5px;color:#c7c0b2;letter-spacing:2px;margin-top:1mm;text-transform:uppercase}' +
    '@media print{' +
    'html,body{background:#fff}' +
    '.brand .mark{outline:none;border-color:#000}' +
    'h1,.doc-type{color:#000 !important;background:#fff !important;border-color:#000 !important}' +
    'th{background:#000 !important;color:#fff !important}' +
    '.tot tr.grand td{background:#000 !important;color:#fff !important;border-radius:0}' +
    '.meta{background:#fff !important;border-inline-start:2.4px solid #000}' +
    '.rule.double{border-color:#000}' +
    '}';

export function receiptPrintHtml(receipt: PosReceiptData, qr: string | null, brand: ReturnType<typeof usePrintBrand>): string {
    const logo = /^(?:\/(?!\/)|https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(brand.logoSrc)
        ? brand.logoSrc
        : PRINT_LOGO_FALLBACK;
    const row = (label: string, value: string) => `<tr><td>${escapeHtml(label)}</td><td dir="ltr">${escapeHtml(value)}</td></tr>`;
    const itemRow = (line: { name: string; quantity: number; unit_price: number; line_total: number }) =>
        `<tr><td>${escapeHtml(line.name)}</td><td class="qty">${escapeHtml(String(line.quantity))}</td>` +
        `<td class="price">${escapeHtml(moneyText(line.unit_price))}</td><td class="total">${escapeHtml(moneyText(line.line_total))}</td></tr>`;
    const itemLines = (receipt.cartLines ?? []).map(itemRow).join('');
    const vatRates = [...new Set((receipt.cartLines ?? []).map((line) => line.vat_rate).filter((v) => Number.isFinite(v)))];
    const vatLabel =
        vatRates.length === 1 ? `ضريبة القيمة المضافة (${String(Math.round((vatRates[0] ?? 0) * 100))}%)` : 'ضريبة القيمة المضافة';
    const paymentLines = (receipt.paymentLines ?? [])
        .map((payment) => {
            const methodLabel = METHOD_LABELS[payment.method] ?? String(payment.method);
            const brandLabel = payment.brand
                ? (CARD_BRANDS.find((entry) => entry.value === payment.brand)?.label ?? String(payment.brand))
                : '';
            const cardSuffix = brandLabel ? ` · ${escapeHtml(brandLabel)}${payment.last4 ? ` ····${escapeHtml(payment.last4)}` : ''}` : '';
            const ref = payment.reference ? `<span class="ref">#${escapeHtml(payment.reference)}</span>` : '';
            return `<tr><td class="m">${escapeHtml(methodLabel)}${cardSuffix} ${ref}</td><td dir="ltr">${escapeHtml(moneyText(payment.amount))}</td></tr>`;
        })
        .join('');
    const changeLine =
        receipt.change > 0.009
            ? `<tr class="change"><td>الباقي للعميل / Change due</td><td dir="ltr">${escapeHtml(moneyText(receipt.change))}</td></tr>`
            : '';
    const buffetRows = (receipt.buffet?.tiers ?? [])
        .map(
            (tier) =>
                `<tr><td>${escapeHtml(tier.name ?? 'فئة')}</td><td dir="ltr">${escapeHtml(String(tier.persons))}</td>` +
                `<td dir="ltr">${escapeHtml(moneyText(tier.amount))}</td></tr>`,
        )
        .join('');
    const hasItems = itemLines.length > 0;
    const itemsTable = hasItems
        ? '<table><thead><tr><th>الصنف / Item</th><th class="qty">الكمية</th><th class="price">السعر</th><th class="total">الإجمالي</th></tr></thead>' +
          `<tbody>${itemLines}</tbody></table>`
        : '';
    const paymentsTable = paymentLines
        ? '<table class="pay"><tbody>' + paymentLines + changeLine + '</tbody></table>'
        : changeLine
          ? '<table class="pay"><tbody>' + changeLine + '</tbody></table>'
          : '';
    return (
        `<style>${THERMAL_CSS}</style>` +
        '<hr class="rule double">' +
        '<div class="brand">' +
        (brand.logoSrc ? `<div class="mark"><img src="${escapeHtml(logo)}" alt=""></div>` : '') +
        `<h1>${escapeHtml(brand.name)}</h1>` +
        '<small>Simplified Tax Invoice</small>' +
        '<div class="doc-type">فاتورة ضريبية مبسطة</div></div>' +
        '<hr class="rule double">' +
        '<div class="meta">' +
        `<div class="r"><span class="k">رقم الفاتورة / No.</span><span class="v" dir="ltr">#${escapeHtml(String(receipt.invoice_counter ?? '—'))}</span></div>` +
        (receipt.cashierName
            ? `<div class="r"><span class="k">الكاشير / Cashier</span><span class="v">${escapeHtml(receipt.cashierName)}</span></div>`
            : '') +
        (receipt.session_id
            ? `<div class="r"><span class="k">الوردية / Shift</span><span class="v" dir="ltr">${escapeHtml(String(receipt.session_id))}</span></div>`
            : '') +
        `<div class="r"><span class="k">UUID</span><span class="v" dir="ltr" style="font-family:Consolas,monospace;font-size:7px">${escapeHtml(String(receipt.invoice_uuid ?? '—'))}</span></div>` +
        '</div>' +
        (itemsTable ? `<hr class="rule">${itemsTable}` : '') +
        `<table class="tot"><tbody>` +
        row('المجموع قبل الضريبة / Subtotal', moneyText(receipt.subtotal)) +
        (receipt.discount_total > 0 ? row('الخصم / Discount', `−${moneyText(receipt.discount_total)}`) : '') +
        row(`${vatLabel} / VAT`, moneyText(receipt.tax_total)) +
        '</tbody></table>' +
        `<table class="tot"><tbody>` +
        `<tr class="grand"><td>الإجمالي / TOTAL</td><td dir="ltr" class="v">${escapeHtml(moneyText(receipt.total_amount))}</td></tr>` +
        '</tbody></table>' +
        (paymentsTable ? `<hr class="rule">${paymentsTable}` : '') +
        (buffetRows
            ? '<hr class="rule"><table><caption>فئات البوفيه</caption><thead><tr><th>الفئة</th><th>أفراد</th><th>المبلغ</th></tr></thead>' +
              `<tbody>${buffetRows}</tbody></table>`
            : '') +
        (receipt.party_name
            ? `<hr class="rule"><div class="r" style="display:flex;justify-content:space-between;font-size:10px"><span class="k">الاسم</span><span class="v">${escapeHtml(receipt.party_name)}</span></div>`
            : '') +
        (receipt.buffet
            ? `<div class="r" style="display:flex;justify-content:space-between;font-size:10px"><span class="k">عدد الأفراد</span><span class="v">${escapeHtml(String(receipt.buffet.persons_total))}</span></div>`
            : '') +
        (qr
            ? `<div class="qr"><div class="frame"><img src="${escapeHtml(qr)}" alt="رمز الفاتورة الضريبي"></div><div class="qr-cap">رمز التحقق الضريبي — ZATCA</div></div>`
            : '') +
        '<p class="thanks">✦ شكرًا لزيارتكم ✦</p>' +
        '<p class="legal">فاتورة إلكترونية صادرة وفق هيئة الزكاة والضريبة والجمارك — لا تحتاج ختمًا أو توقيعًا</p>' +
        '<p class="brandline">Simplified Tax Invoice · Karim ERP</p>'
    );
}

/** إيصال ما بعد البيع: أرقام الخادم، رمز QR، إعادة الطباعة وتذاكر المطبخ. */
export function PosReceipt({ receipt, buffet, canReprint, busy, onReprint, onKot, onDismiss }: PosReceiptProps) {
    const [qr, setQr] = useState<string | null>(null);
    const [qrError, setQrError] = useState('');
    const [printError, setPrintError] = useState('');
    const brand = usePrintBrand();

    useEffect(() => {
        let active = true;
        setQr(null);
        setQrError('');
        if (!receipt.qr_payload) {
            return () => {
                active = false;
            };
        }
        void qrDataUrl(receipt.qr_payload).then((dataUrl) => {
            if (!active) {
                return;
            }
            if (dataUrl) {
                setQr(dataUrl);
            } else {
                setQrError('تعذّر تحميل مولّد رمز الفاتورة؛ يمكنك طباعة التفاصيل دون الرمز.');
            }
        });
        return () => {
            active = false;
        };
    }, [receipt.qr_payload]);

    return (
        <section className="erp-card pos-receipt" aria-labelledby="pos-receipt-title">
            <div className="erp-card__body pos-receipt__body">
                <div className="pos-receipt__head">
                    <h2 id="pos-receipt-title" className="erp-card__title">
                        إيصال البيع <Badge variant="success">صادرة</Badge>
                    </h2>
                    <Button size="sm" variant="ghost" onClick={onDismiss}>
                        إخفاء
                    </Button>
                </div>

                <dl className="pos-receipt__facts">
                    <div>
                        <dt>رقم الفاتورة</dt>
                        <dd>#{String(receipt.invoice_counter ?? '—')}</dd>
                    </div>
                    <div>
                        <dt>UUID</dt>
                        <dd dir="ltr">{receipt.invoice_uuid || '—'}</dd>
                    </div>
                    <div>
                        <dt>الإجمالي</dt>
                        <dd>{moneyText(receipt.total_amount)}</dd>
                    </div>
                    <div>
                        <dt>المدفوع</dt>
                        <dd>{moneyText(receipt.paid)}</dd>
                    </div>
                    <div>
                        <dt>الباقي</dt>
                        <dd>{moneyText(receipt.change)}</dd>
                    </div>
                    <div>
                        <dt>الطباعة</dt>
                        <dd>{receipt.print_job_id ? 'أُضيف الإيصال إلى الطابور' : 'لا توجد مهمة طباعة مؤكدة'}</dd>
                    </div>
                    <div>
                        <dt>ZATCA</dt>
                        <dd>{receipt.zatca_queued ? 'أُضيف إلى الطابور' : 'غير مؤكد من الخادم'}</dd>
                    </div>
                    <div>
                        <dt>تذاكر المطبخ</dt>
                        <dd>
                            {receipt.kot_enabled
                                ? `${String(Array.isArray(receipt.kot_jobs) ? receipt.kot_jobs.length : 0)} مهمة`
                                : 'متوقفة من إعداد الخادم'}
                        </dd>
                    </div>
                    {buffet ? (
                        <div>
                            <dt>عدد الأفراد</dt>
                            <dd>{String(receipt.buffet?.persons_total ?? 0)}</dd>
                        </div>
                    ) : null}
                    {receipt.party_name ? (
                        <div>
                            <dt>الاسم</dt>
                            <dd>{receipt.party_name}</dd>
                        </div>
                    ) : null}
                </dl>

                {qr ? (
                    <img className="pos-receipt__qr" src={qr} alt="رمز الفاتورة الضريبي" />
                ) : qrError ? (
                    <p className="text-body-sm text-muted">{qrError}</p>
                ) : null}

                <div className="pos-receipt__actions">
                    {canReprint ? (
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                                onReprint(receipt.order_id);
                            }}
                        >
                            إعادة طباعة الإيصال
                        </Button>
                    ) : null}
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                            onKot(receipt.order_id, receipt.invoice_counter);
                        }}
                    >
                        تذاكر المطبخ
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            setPrintError('');
                            const opened = openPrintWindow(
                                `إيصال البيع — #${String(receipt.invoice_counter ?? '')}`,
                                receiptPrintHtml(receipt, qr, brand),
                            );
                            if (!opened) {
                                setPrintError('حجب المتصفح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
                            }
                        }}
                    >
                        طباعة الإيصال
                    </Button>
                </div>
                {printError ? (
                    <p className="text-body-sm text-danger" role="alert">
                        {printError}
                    </p>
                ) : null}
            </div>
        </section>
    );
}
