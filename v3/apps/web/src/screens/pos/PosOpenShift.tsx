import { useState } from 'react';
import type { DeptCashierLink, PosDepartment } from '../../lib/pos';
import { parsePosMoney } from '../../lib/pos-pricing';
import { Button, Input } from '../../ui';
import { PosCashierPicker } from './PosCashierPicker';
import { moneyText } from './pos-ui';

export interface PosOpenShiftProps {
    departments: readonly PosDepartment[];
    /** روابط القسم ↔ الكاشير — تُرتّب اختيار الكاشير حسب القسم */
    cashierLinks: readonly DeptCashierLink[];
    canSell: boolean;
    busy: boolean;
    error: string;
    loading: boolean;
    onOpen: (departmentId: string, openingBalance: number) => void;
}

/** فتح وردية — نفس حقلي V2: القسم والعهدة الافتتاحية، بلا تخمين قسم. */
export function PosOpenShift({ departments, cashierLinks, canSell, busy, error, loading, onOpen }: PosOpenShiftProps) {
    const [departmentId, setDepartmentId] = useState('');
    const [opening, setOpening] = useState('0');
    const parsed = parsePosMoney(opening);
    const valid = Number.isInteger(Number(departmentId)) && Number(departmentId) > 0 && Number.isFinite(parsed) && parsed >= 0;

    return (
        <section className="erp-card pos-open" aria-labelledby="pos-open-title">
            <div className="erp-card__body flex flex-col gap-sm">
                <div>
                    <h2 id="pos-open-title" className="erp-card__title">
                        فتح وردية
                    </h2>
                    <p className="text-body-sm text-muted">
                        القسم يحدد الأصناف والصلاحيات؛ الخادم يرفض وردية ثانية لنفس الحساب أو يوماً مقفلاً بـZ.
                    </p>
                </div>
                <div className="pos-open__picker">
                    <span className="pos-open__picker-label">اختر الكاشير (مرتّب حسب القسم)</span>
                    {loading ? (
                        <p className="text-body-sm text-muted">جارٍ تحميل الأقسام والكاشيرين…</p>
                    ) : (
                        <PosCashierPicker
                            departments={departments}
                            links={cashierLinks}
                            selectedId={departmentId}
                            onSelect={setDepartmentId}
                            busy={busy}
                            disabled={!canSell}
                        />
                    )}
                </div>
                <Input
                    label="العهدة الافتتاحية"
                    inputMode="decimal"
                    dir="ltr"
                    value={opening}
                    onChange={(event) => setOpening(event.target.value)}
                    hint={`النقد المتوقع لاحقاً = العهدة + داخل نقدي − خارج نقدي (${moneyText(parsed)} الآن)`}
                    disabled={busy || !canSell}
                />
                <div className="flex flex-wrap items-center gap-sm">
                    <Button variant="primary" loading={busy} disabled={!canSell || !valid} onClick={() => onOpen(departmentId, parsed)}>
                        فتح الوردية
                    </Button>
                    {!canSell ? <p className="text-body-sm text-muted">هذا الحساب للقراءة فقط ولا يمكنه فتح وردية أو البيع.</p> : null}
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
