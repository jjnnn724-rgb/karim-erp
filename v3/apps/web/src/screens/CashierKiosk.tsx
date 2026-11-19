import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import './CashierKiosk.css';
import { ThemeToggle } from '../components/ThemeToggle';
import { logout, useAuthState } from '../lib/auth';
import { useDocumentMeta } from '../lib/page-meta';
import { useCashierInstallPrompt } from '../lib/pwa';
import { PosEntry } from './PosEntry';
import { roleIn, SELL_ROLES } from './pos/pos-ui';

/**
 * وضع الكاشير المستقل — بلا قائمة إدارة أو بيانات خارج الوردية.
 * نقطة البيع نفسها هي المحتوى الوحيد، والهوية الظاهرة هي هوية الكاشير.
 */
export function CashierKiosk() {
    const auth = useAuthState();
    const { canInstall, install } = useCashierInstallPrompt();
    const canSell = roleIn(auth.user?.role, SELL_ROLES);
    // صفحة الكاشير داخل النظام نفسه: من يملك النظام كاملًا يستطيع الرجوع للقشرة.
    const canLeaveKiosk = !roleIn(auth.user?.role, ['cashier']);
    const [full, setFull] = useState(false);
    useDocumentMeta('كاشير');

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                setFull(false);
            } else {
                await document.documentElement.requestFullscreen();
                setFull(true);
            }
        } catch {
            setFull(Boolean(document.fullscreenElement));
        }
    }

    return (
        <div className="pos-kiosk" dir="rtl">
            <header className="pos-kiosk__bar">
                <div className="pos-kiosk__brand">
                    <span className="pos-kiosk__mark" aria-hidden="true">
                        K
                    </span>
                    <div>
                        <strong>Karim POS</strong>
                        <small>نقطة البيع</small>
                    </div>
                </div>
                <div className="pos-kiosk__session">
                    <span className="pos-kiosk__user">{auth.user?.name ?? 'كاشير'}</span>
                    {auth.user?.username ? (
                        <span className="pos-kiosk__username" dir="ltr">
                            {auth.user.username}
                        </span>
                    ) : null}
                    <button type="button" className="pos-kiosk__install" onClick={() => void toggleFullscreen()}>
                        {full ? 'إنهاء الملء' : 'ملء الشاشة'}
                    </button>
                    {canInstall ? (
                        <button type="button" className="pos-kiosk__install" onClick={() => void install()}>
                            تثبيت
                        </button>
                    ) : null}
                    {canLeaveKiosk ? (
                        <Link to="/" className="pos-kiosk__install">
                            رجوع للنظام
                        </Link>
                    ) : null}
                    <ThemeToggle iconOnly />
                    <button type="button" className="pos-kiosk__logout" onClick={() => logout()}>
                        خروج
                    </button>
                </div>
            </header>
            <main className="pos-kiosk__main">
                {canSell ? (
                    <PosEntry />
                ) : (
                    <section className="pos-kiosk__denied" role="alert">
                        <h1>هذا الكشك مخصّص للكاشير</h1>
                        <p>دور حسابك الحالي للقراءة فقط. سجّل الخروج واستخدم حساب كاشير لبدء الوردية.</p>
                    </section>
                )}
            </main>
        </div>
    );
}
