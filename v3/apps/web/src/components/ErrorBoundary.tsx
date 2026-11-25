import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react';
import { ErrorScreen } from './ErrorScreen';

/**
 * بلاغ أخطاء React/المتصفح — يرسل إلى الخادم (POST /api/security/client-error)
 * بصيغة fire-and-forget: لا يلوث خطّ الخطأ الأصلي، ولا يعتمد على الشبكة
 * بعد لحظة الفشل. Idempotent قدر الإمكان — لا يُرسل أكثر من مرّة/ثانيتين.
 */
let lastReportAt = 0;
function reportClientError(kind: string, error: unknown): void {
    const now = Date.now();
    if (now - lastReportAt < 2_000) {return;}
    lastReportAt = now;
    try {
        const err = error instanceof Error ? error : new Error(String(error));
        const message = String((err as Error).message || error).slice(0, 280);
        if (!message) {return;}
        const payload = {
            kind,
            message,
            stack: String((err as Error).stack || '').slice(0, 1800),
            page: typeof window !== 'undefined' ? String(window.location.pathname || '').slice(0, 190) : '',
            version: 'v3',
        };
        const body = JSON.stringify(payload);
        const sent = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
            && navigator.sendBeacon('/api/security/client-error', new Blob([body], { type: 'application/json' }));
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
}

export function reportReactError(error: unknown): void {
    reportClientError('react', error);
}

// تثبيت window.onerror + unhandledrejection مرة واحدة عند تحميل الموديول
if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        reportClientError('window', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        reportClientError('unhandledrejection', event.reason);
    });
}

export interface ErrorBoundaryProps {
    readonly children: ReactNode;
    readonly fallback?: (error: unknown, reset: () => void) => ReactNode;
    readonly onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    readonly failed: boolean;
    readonly error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    override state: ErrorBoundaryState = { failed: false, error: null };

    static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
        return { failed: true, error };
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
        console.error('[v3] انهيار في العرض —', error, info.componentStack);
        this.props.onError?.(error, info);
        reportReactError(error);
    }

    private reset = (): void => {
        this.setState({ failed: false, error: null });
    };

    override render(): ReactNode {
        if (!this.state.failed) {
            return this.props.children;
        }
        if (this.props.fallback) {
            return this.props.fallback(this.state.error, this.reset);
        }
        return <ErrorScreen error={this.state.error} onRetry={this.reset} />;
    }
}

/**
 * الخطأ على مستوى المسار — يطابق توقيع `ErrorRouteComponent` في TanStack Router.
 *
 * الوسم يُسجَّل هنا لا في `componentDidCatch`: المُوجِّه يلتقط أخطاء الشاشات في
 * حدوده الخاصة، فلا يصل انهيار المسار إلى الحدّ الخارجي.
 */
export function RouteError({ error, reset }: { readonly error: unknown; readonly reset: () => void }) {
    useEffect(() => {
        console.error('[v3] انهيار في المسار —', error);
        reportReactError(error);
    }, [error]);
    return <ErrorScreen error={error} onRetry={reset} />;
}
