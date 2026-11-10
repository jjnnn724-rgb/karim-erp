import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons';

/**
 * تنبيهات عابرة (Toast) — منطقة `aria-live="polite"` واحدة، وكل تنبيه
 * يحمل `role="status"` (نجاح/معلومة) أو `role="alert"` (خطأ) فيُعلن فورًا.
 * الإغلاق اليدوي متاح دائمًا، والمدّة الافتراضية 5 ثوانٍ (8 للخطأ).
 *
 * لا اعتماد على اللون وحده: أيقونة + نصّ النتيجة، والوصف يشرح الخطوة التالية.
 */

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastOptions {
    title: string;
    description?: string;
    variant?: ToastVariant;
    /** بالمللي ثانية؛ الافتراضي 5000 (8000 للأخطاء). */
    duration?: number;
}

interface ToastRecord extends ToastOptions {
    id: number;
}

export interface ToastContextValue {
    toast: (options: ToastOptions) => void;
    dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 8000;

const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
    info: <InfoIcon className="size-4" />,
    success: <CheckCircleIcon className="size-4" />,
    error: <AlertTriangleIcon className="size-4" />,
};

const VARIANT_CLASS: Record<ToastVariant, string> = {
    info: 'border-info/40 bg-info-soft text-info-text',
    success: 'border-success/40 bg-success-soft text-success-text',
    error: 'border-danger/40 bg-danger-soft text-danger-text',
};

function ToastItem({ record, onDismiss }: { record: ToastRecord; onDismiss: (id: number) => void }) {
    const variant = record.variant ?? 'info';
    const duration = record.duration ?? (variant === 'error' ? ERROR_DURATION : DEFAULT_DURATION);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            onDismiss(record.id);
        }, duration);
        return () => {
            window.clearTimeout(timer);
        };
    }, [duration, onDismiss, record.id]);

    return (
        <div
            role={variant === 'error' ? 'alert' : 'status'}
            data-variant={variant}
            className={cn(
                'flex items-start gap-sm rounded-lg border bg-surface-raised p-sm text-ink shadow-pop',
                VARIANT_CLASS[variant],
            )}
        >
            <span aria-hidden="true" className="mt-0.5 shrink-0">
                {VARIANT_ICON[variant]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-xxs">
                <p className="text-heading-sm text-ink">{record.title}</p>
                {record.description ? <p className="text-body-sm text-muted">{record.description}</p> : null}
            </div>
            <IconButton
                label="إغلاق التنبيه"
                icon={<XIcon />}
                size="sm"
                onClick={() => {
                    onDismiss(record.id);
                }}
            />
        </div>
    );
}

export interface ToastProviderProps {
    children: ReactNode;
    className?: string;
}

export function ToastProvider({ children, className }: ToastProviderProps) {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);
    const counter = useRef(0);

    const dismiss = useCallback((id: number) => {
        setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, []);

    const toast = useCallback((options: ToastOptions) => {
        counter.current += 1;
        const id = counter.current;
        setToasts((previous) => [...previous, { ...options, id }]);
    }, []);

    const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div
                aria-live="polite"
                aria-atomic="false"
                data-erp-print-hide
                className={cn(
                    'pointer-events-none fixed end-md bottom-md z-[var(--erp-z-toast)] flex w-[min(92vw,22rem)] flex-col gap-xs',
                    className,
                )}
            >
                {toasts.map((record) => (
                    <div key={record.id} className="pointer-events-auto">
                        <ToastItem record={record} onDismiss={dismiss} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const value = useContext(ToastContext);
    if (!value) {
        // صامت بدل رمي استثناء عند غياب المزوّد — يحمي Shallow Tests والشاشات
        // المعروضة بلا App Root (لا منطقة عرض في هذه الحالة أصلًا).
        // eslint-disable-next-line no-console
        if (typeof console !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            console.warn('useToast خارج <ToastProvider> — لا منطقة تنبيهات معروضة.');
        }
        return {
            toast: () => undefined,
            dismiss: () => undefined,
        };
    }
    return value;
}
