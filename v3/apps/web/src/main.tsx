import { I18nProvider } from '@heroui/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './App';
import { registerCashierPwa } from './lib/pwa';
import { applyInitialTheme } from './ui/theme';
import './styles.css';
import './mobile.css';
// بعد `styles.css` كي تتقدّم قواعد `@media print` على قواعد الشاشة.
import './print.css';

const container = document.getElementById('root');
if (!container) {
    throw new Error('جذر التطبيق #root غير موجود');
}

/*
 * الوضع (فاتح/داكن/تلقائي) قبل أول رسم — في JS لا بسكربتٍ داخلي (سياسة CSP
 * بلا `unsafe-inline`). `applyInitialTheme` (ui-kit) يقرؤ التفضيل المحفوظ
 * و`prefers-color-scheme` ويضع الصنف على `<html>` قبل الرسم فلا وميض.
 */
applyInitialTheme();
registerCashierPwa();

/*
 * بلاغ أخطاء الإنتاج أولًا بأول — بدل أن تموت الواجهة بصمت عند العميل:
 * أي استثناء غير معالج أو promise مرفوض يُرسل (fire-and-forget) إلى
 * /api/security/client-error — بدون PII وبدون جسم كبير. لا يعتمد على
 * React ولا على الشبكة بعد لحظة الفشل (sendBeacon أولًا، fetch بديلًا).
 */
(function installClientErrorBeacon() {
    const report = (kind: string, error: unknown): void => {
        try {
            const err = error instanceof Error ? error : new Error(String(error));
            const message = String((err as Error).message || error).slice(0, 280);
            if (!message) { return; }
            const payload = {
                kind,
                message,
                stack: String((err as Error).stack || '').slice(0, 1800),
                page: String(window.location?.pathname || '').slice(0, 190),
                version: 'v3',
            };
            const body = JSON.stringify(payload);
            const sent = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
                ? navigator.sendBeacon('/api/security/client-error', new Blob([body], { type: 'application/json' }))
                : false;
            if (!sent) {
                void fetch('/api/security/client-error', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                }).catch(() => undefined);
            }
        } catch {
            // البلاغ نفسه لا يجوز أن يكسر التطبيق
        }
    };
    window.addEventListener('error', (event) => {
        report('error', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        report('unhandledrejection', event.reason);
    });
})();

createRoot(container).render(
    <StrictMode>
        <I18nProvider locale="ar-SA">
            <TooltipProvider delayDuration={200}>
                <App />
            </TooltipProvider>
        </I18nProvider>
    </StrictMode>,
);
