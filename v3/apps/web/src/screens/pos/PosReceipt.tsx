import { useEffect, useState } from 'react';
import type { PosSaleResult } from '../../lib/pos';
import { PRINT_LOGO_FALLBACK, usePrintBrand } from '../../lib/print';
import { Badge, Button } from '../../ui';
import { escapeHtml, moneyText, openPrintWindow, qrDataUrl } from './pos-ui';

export interface PosReceiptProps {
    receipt: PosSaleResult;
    buffet: boolean;
    canReprint: boolean;
    busy: boolean;
    onReprint: (orderId: string) => void;
    onKot: (orderId: string, counter: number | null) => void;
    onDismiss: () => void;
}

const THERMAL_CSS =
    '@page{size:80mm auto;margin:0}' +
    '*,*::before,*::after{box-sizing:border-box}' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    "body{width:80mm;max-width:100%;font-family:'Tajawal','Segoe UI',Tahoma,sans-serif;font-size:11px;line-height:1.45;padding:3mm 3mm 6mm;overflow-wrap:anywhere}" +
    '.brand{text-align:center;margin:0 0 2mm}' +
    '.brand img{max-height:16mm;max-width:32mm;object-fit:contain}' +
    '.brand h1{font-size:14px;margin:1mm 0 0}' +
    '.brand small{font-size:9px;color:#333}' +
    '.rule{border:0;border-top:1px dashed #000;margin:2mm 0}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;border:0}' +
    'th,td{border:0;background:transparent;padding:0.6mm 0;vertical-align:top}' +
    'td:last-child{text-align:left;font-variant-numeric:tabular-nums}' +
    '.totals td{padding:0.8mm 0}' +
    '.totals tr.grand td{font-size:14px;font-weight:700;border-top:1px solid #000;padding-top:1.5mm}' +
    '.meta{font-size:9px;color:#222;word-break:break-all}' +
    '.qr{text-align:center;margin:2mm 0}' +
    '.qr img{width:34mm;height:34mm}' +
    '.thanks{text-align:center;font-size:10px;margin-top:2mm}' +
    '.vat{font-size:9px;text-align:center;color:#333}';

export function receiptPrintHtml(receipt: PosSaleResult, qr: string | null, brand: ReturnType<typeof usePrintBrand>): string {
    const logo = /^(?:\/(?!\/)|https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(brand.logoSrc)
        ? brand.logoSrc
        : PRINT_LOGO_FALLBACK;
    const row = (label: string, value: string) => `<tr><td>${escapeHtml(label)}</td><td dir="ltr">${escapeHtml(value)}</td></tr>`;
    const buffetRows = (receipt.buffet?.tiers ?? [])
        .map(
            (tier) =>
                `<tr><td>${escapeHtml(tier.name ?? 'فئة')}</td><td dir="ltr">${escapeHtml(tier.persons)}</td>` +
                `<td dir="ltr">${moneyText(tier.amount)}</td></tr>`,
        )
        .join('');
    return (
        `<style>${THERMAL_CSS}</style>` +
        '<div class="brand">' +
        (brand.logoSrc ? `<img src="${escapeHtml(logo)}" alt="">` : '') +
        `<h1>${escapeHtml(brand.name)}</h1>` +
        '<small>فاتورة ضريبية مبسطة</small></div>' +
        '<div class="rule"></div>' +
        '<table class="meta"><tbody>' +
        row('رقم الفاتورة', `#${String(receipt.invoice_counter ?? '—')}`) +
        row('UUID', receipt.invoice_uuid ?? '—') +
        '</tbody></table><div class="rule"></div>' +
        '<table class="totals"><tbody>' +
        row('قبل الضريبة', moneyText(receipt.subtotal)) +
        row('الخصم', moneyText(receipt.discount_total)) +
        row('ضريبة القيمة المضافة', moneyText(receipt.tax_total)) +
        '</tbody></table><div class="rule"></div>' +
        '<table class="totals"><tbody>' +
        `<tr class="grand"><td>الإجمالي</td><td dir="ltr">${moneyText(receipt.total_amount)}</td></tr>` +
        row('المدفوع', moneyText(receipt.paid)) +
        row('الباقي', moneyText(receipt.change)) +
        (receipt.party_name ? row('الاسم', receipt.party_name) : '') +
        (receipt.buffet ? row('عدد الأفراد', String(receipt.buffet.persons_total)) : '') +
        `</tbody></table>` +
        (buffetRows
            ? '<div class="rule"></div><table><caption>فئات البوفيه</caption><thead><tr><th>الفئة</th><th>أفراد</th><th>المبلغ</th></tr></thead>' +
              `<tbody>${buffetRows}</tbody></table>`
            : '') +
        (qr ? `<div class="qr"><img src="${escapeHtml(qr)}" alt="رمز الفاتورة الضريبي"></div>` : '') +
        '<p class="vat">إيصال البيع الإلكتروني</p>' +
        '<p class="thanks">شكراً لزيارتكم</p>'
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
