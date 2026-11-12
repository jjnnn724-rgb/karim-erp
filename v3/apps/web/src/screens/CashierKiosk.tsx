import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { PrintBrand, PrintRunner } from '../components/PrintBrand';
import { ThemeToggle } from '../components/ThemeToggle';
import { logout, useAuthState } from '../lib/auth';
import { titleForPath } from '../lib/navigation';
import { useDocumentMeta } from '../lib/page-meta';
import './CashierKiosk.css';

/** Full-screen POS shell — used for every visit to the POS surface (admin or cashier). */
export function CashierKiosk({ children }: { children: ReactNode }) {
    const auth = useAuthState();
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const [full, setFull] = useState(false);
    const [fullscreenError, setFullscreenError] = useState('');
    useDocumentMeta('نقطة البيع');

    useEffect(() => {
        const syncFullscreen = (): void => {
            setFull(Boolean(document.fullscreenElement));
        };
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => {
            document.removeEventListener('fullscreenchange', syncFullscreen);
        };
    }, []);

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen();
            }
            setFullscreenError('');
            setFull(Boolean(document.fullscreenElement));
        } catch {
            setFullscreenError('تعذر تفعيل وضع ملء الشاشة من هذا المتصفح.');
        }
    }

    return (
        <div className="pos-kiosk" dir="rtl">
            <header className="pos-kiosk__bar" data-erp-print-hide>
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
                    <button type="button" className="pos-kiosk__control" onClick={() => void toggleFullscreen()}>
                        {full ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
                    </button>
                    <ThemeToggle iconOnly />
                    <button type="button" className="pos-kiosk__logout" onClick={() => void logout()}>
                        خروج
                    </button>
                </div>
            </header>
            {fullscreenError ? (
                <p className="pos-kiosk__error" role="status" data-erp-print-hide>
                    {fullscreenError}
                </p>
            ) : null}
            <main className="pos-kiosk__main">
                <PrintBrand title={titleForPath(pathname)} />
                {children}
                <PrintRunner title={titleForPath(pathname)} />
            </main>
        </div>
    );
}
