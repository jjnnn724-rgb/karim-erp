import { I18nProvider } from '@heroui/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './App';
import { applyInitialTheme } from './ui/theme';
import './styles.css';
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

createRoot(container).render(
    <StrictMode>
        <I18nProvider locale="ar-SA">
            <TooltipProvider delayDuration={200}>
                <App />
            </TooltipProvider>
        </I18nProvider>
    </StrictMode>,
);
