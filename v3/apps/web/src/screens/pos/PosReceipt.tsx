import { useEffect, useState } from 'react';
import type { PosSaleResult } from '../../lib/pos';
import { fetchPosOrderReceiptHtml } from '../../lib/pos';
import { Badge, Button } from '../../ui';
import { moneyText, openServerHtmlWindow, qrDataUrl } from './pos-ui';

export interface PosReceiptProps {
    receipt: PosSaleResult;
    buffet: boolean;
    canReprint: boolean;
    busy: boolean;
    onReprint: (orderId: string) => void;
    onKot: (orderId: string, counter: number | null) => void;
    onDismiss: () => void;
}

export function PosReceipt({ receipt, buffet, canReprint, busy, onReprint, onKot, onDismiss }: PosReceiptProps) {
    const [qr, setQr] = useState<string | null>(null);
    const [qrError, setQrError] = useState('');
    const [printError, setPrintError] = useState('');
    const [printPending, setPrintPending] = useState(false);

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
                        disabled={busy || printPending}
                        onClick={() => {
                            setPrintError('');
                            setPrintPending(true);
                            fetchPosOrderReceiptHtml(receipt.order_id)
                                .then((html) => {
                                    setPrintPending(false);
                                    const opened = openServerHtmlWindow(html, `فاتورة — #${String(receipt.invoice_counter ?? '')}`, 'width=460,height=840,noopener');
                                    if (!opened) {
                                        setPrintError('حجب المتصفح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
                                    }
                                })
                                .catch((cause: unknown) => {
                                    setPrintPending(false);
                                    const message = cause instanceof Error ? cause.message : String(cause);
                                    setPrintError(`تعذّرت طباعة الإيصال من الخادم: ${message}`);
                                });
                        }}
                    >
                        {printPending ? 'جارٍ تجهيز الإيصال…' : 'طباعة الإيصال'}
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
