import { useCallback, useEffect, useState } from 'react';
import { queuedSaleConflicts, resolveQueuedSale } from '../lib/pos-offline';

/** تعارضات 409 (مثلاً تجاوز الرصيد) لا تُحل تلقائيًا — قرار بشري صريح. */
export function OfflineConflictBanner() {
    const [conflicts, setConflicts] = useState<string[]>([]);

    const refresh = useCallback(() => {
        void queuedSaleConflicts().then((rows) => setConflicts(rows.map((row) => row.local_transaction_uuid)));
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const resolve = (uuid: string, action: 'retry' | 'discard') => {
        void resolveQueuedSale(uuid, action).then(() => refresh());
    };

    if (conflicts.length === 0) {return null;}
    return (
        <section className="erp-card erp-card__body" role="status" aria-label="مبيعات معلّقة تحتاج قرارًا" data-testid="offline-conflict-banner">
            <p className="text-body-sm text-ink">
                {conflicts.length} عملية معلّقة بتعارض الرصيد — اختر إعادة الإرسال أو الإلغاء.
            </p>
            <ul className="mt-xs flex flex-wrap gap-xs">
                {conflicts.map((uuid) => (
                    <li key={uuid} className="flex items-center gap-xxs rounded-md border border-hairline px-sm py-xxs">
                        <span className="erp-numeric text-caption text-muted" dir="ltr">{uuid}</span>
                        <button type="button" className="text-button-sm text-primary" onClick={() => resolve(uuid, 'retry')}>إعادة</button>
                        <button type="button" className="text-button-sm text-danger-text" onClick={() => resolve(uuid, 'discard')}>إلغاء</button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
