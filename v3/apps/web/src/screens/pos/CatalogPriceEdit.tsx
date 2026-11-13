import { useEffect, useState } from 'react';
import { updatePosProductPrice } from '../../lib/pos';
import { Button, Input } from '../../ui';
import { useToast } from '../../ui/Toast';
import { type CatalogItem, moneyText } from './pos-ui';

interface CatalogPriceEditProps {
    /** الصنف المطلوب تعديل سعره — غائب = مغلق. */
    product: CatalogItem | null;
    onClose: () => void;
    /** يُستدعى بعد نجاح الحفظ لتحديث الكاش محليًا (بلا إعادة تحميل). */
    onSaved: (productId: string, price: number) => void;
}

/**
 * محرر سعر البيع لكتالوج المنتج — يظهر في بطاقة الصنف للمدير/المسؤول.
 * لا يرفع السعر بلا تأكيد صريح: أي قيمة سالبة أو فارغة تُمنع قبل وصول الخادم،
 * والخادم يفرض manager/admin ويسجل التعديل في سجل التدقيق باسم المنفِّذ.
 */
export function CatalogPriceEdit({ product, onClose, onSaved }: CatalogPriceEditProps) {
    const { toast } = useToast();
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (product) {
            setValue(String(product.price));
            setBusy(false);
        }
    }, [product]);

    useEffect(() => {
        if (!product) {
            return undefined;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
        };
    }, [product, onClose]);

    if (!product) {
        return null;
    }

    const parsed = Number(value);
    const valid = Number.isFinite(parsed) && parsed >= 0;
    const changed = valid && parsed !== product.price;

    const save = async () => {
        if (!valid || busy) {
            return;
        }
        setBusy(true);
        try {
            const result = await updatePosProductPrice(product.id, Math.round(parsed * 100) / 100);
            onSaved(String(result.id), result.price);
            toast({ title: `تم تعديل سعر «${result.name_ar}» إلى ${moneyText(result.price)}`, variant: 'success' });
            onClose();
        } catch (error) {
            toast({ title: `تعذّر تعديل السعر: ${error instanceof Error ? error.message : String(error)}`, variant: 'error' });
            setBusy(false);
        }
    };

    return (
        <div className="catalog-price-edit" role="dialog" aria-modal="false" aria-label={`تعديل سعر ${product.name}`}>
            <div className="catalog-price-edit__head">
                <strong>تعديل سعر البيع</strong>
                <button type="button" className="catalog-price-edit__close" aria-label="إغلاق" onClick={onClose}>
                    ×
                </button>
            </div>
            <p className="catalog-price-edit__name" title={product.name}>
                {product.name}
            </p>
            <p className="catalog-price-edit__current">السعر الحالي: {moneyText(product.price)}</p>
            <Input
                label="السعر الجديد"
                inputMode="decimal"
                dir="ltr"
                autoFocus
                value={value}
                disabled={busy}
                onFocus={(event) => {
                    event.currentTarget.select();
                }}
                onChange={(event) => {
                    setValue(event.target.value);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void save();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onClose();
                    }
                }}
            />
            <div className="catalog-price-edit__actions">
                <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
                    إلغاء
                </Button>
                <Button size="sm" variant="primary" disabled={!valid || !changed || busy} onClick={() => void save()}>
                    {busy ? 'جارٍ الحفظ…' : 'حفظ السعر'}
                </Button>
            </div>
            <p className="catalog-price-edit__note">يُسجَّل التعديل في سجل التدقيق باسمك.</p>
        </div>
    );
}
