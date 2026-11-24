import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react';
import { ErrorScreen } from './ErrorScreen';

/**
 * حدود الخطأ — شبكة أمان العرض في React 19 (لا خطّاف بعد).
 *
 * موضعان مقصودان:
 *   1. حول `RouterProvider` في `App` — أي انهيار في المزوّدات أو القشرة.
 *   2. `defaultErrorComponent` للمُوجِّه — انهيار شاشةٍ يبقي التنقّل حيًّا،
 *      فتظهر `RouteError` داخل المسار بدل بياضٍ في الصفحة كاملة.
 *
 * `componentDidCatch` يسجّل في الكونسول العلامة `[v3]` ليكون الانهيار قابلًا
 * للبحث في سجلّ المتصفح دون أي إرسالٍ خارجي.
 */

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
    }, [error]);
    return <ErrorScreen error={error} onRetry={reset} />;
}
