import { useState } from 'react';
import './MenuBoard.premium.css';
import { ReportHeader, SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';

/**
 * شاشات المنيو — مضيفةٌ لإدارة المنيو القديمة داخل إطار، كما في V2 حرفيًا
 * (`frontend/app/js/v2/screens/menu-board.js`): صفحة الإدارة لها عقدها
 * الخاص (مسرح ثابت و`fitStage`) ولم تُعَد كتابتها هنا — تُستضاف فقط.
 *
 * الإطار من نفس الأصل، وCSP لـ/v3 يسمح بـ`frame-src 'self'`.
 */
export function MenuBoard() {
    const [nonce, setNonce] = useState(0);

    return (
        <div className="erp-premium-screen erp-premium-screen--menu-board flex flex-col gap-md">
            <ReportHeader
                title="شاشات المنيو"
                english="Menu Boards"
                description="لوحة تحكم شاشات العرض — نفس صفحة الإدارة الحالية داخل الإطار."
                pending={false}
                onRefresh={() => {
                    setNonce((value) => value + 1);
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="شاشات المنيو" />
            </div>

            <SectionCard
                title="إدارة المنيو"
                english="Menu admin"
                actions={
                    <a
                        href="/app/menu-board.html"
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        عرض شاشة العرض
                    </a>
                }
            >
                <div className="p-sm">
                    <iframe
                        key={nonce}
                        src="/app/menu-admin.html"
                        title="شاشات المنيو"
                        className="h-[calc(100vh-260px)] min-h-[480px] w-full rounded-lg border border-hairline bg-canvas"
                    />
                </div>
            </SectionCard>

            <p className="text-caption text-muted">
                الصفحة المستضافة تعمل بقواعدها القديمة نفسها؛ التحديث يعيد تحميل الإطار فقط.
            </p>
        </div>
    );
}
