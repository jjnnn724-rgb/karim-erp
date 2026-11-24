import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/**
 * تأكيد الإجراء — نظير `js/v2/confirm.js` في V3.
 *
 * عقد V2 الذي نُقل:
 *  • الدالة غير متزامنة: `await confirm(message, opts) → boolean`، فتُستدعى من
 *    معالجات الأحداث كما هي بدل `window.confirm` (نافذة نظام لا تُترجم ولا
 *    تحمل دلالة خطر، وتحجب الخيط على أندرويد).
 *  • النصّ الافتراضي: العنوان «تأكيد الإجراء»، زر التأكيد «تأكيد»، زر الإلغاء «إلغاء».
 *  • الدلالة تُستنتج من نصّ نكتبه نحن (كلمات الحذف/التعطيل) لا من بيانات مستخدم.
 *  • كل مسار غامض يُغلق بالفشل: Esc، النقر خارج النافذة، ونداء ثانٍ فوق الأوّل
 *    كلها تعيد `false`. التركيز الابتدائي على «إلغاء» كي لا يؤكّد Enter عملية
 *    مدمّرة بالخطأ.
 *  • نصّ الرسالة يُدخل كنصّ (React escaping) — لا HTML.
 */

const MAX_TEXT = 400;

/** كلمات تُقرأ كإجراء لا رجعة فيه — تُلوّن الزر فقط، ولا تغيّر سلوكه (مثل V2). */
const DANGER_WORDS = ['حذف', 'مسح', 'إزالة', 'إسقاط', 'تعطيل', 'إيقاف', 'استعادة', 'فك ربط', 'تصفير'];

export type ConfirmTone = 'danger' | 'warning';

export interface ConfirmOptions {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

interface ConfirmRequest {
    message: string;
    options: ConfirmOptions;
    resolve: (answer: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** الدلالة من نصّنا المكتوب — نفس قائمة V2. */
export function inferConfirmTone(message: string): ConfirmTone {
    const text = String(message ?? '');
    return DANGER_WORDS.some((word) => text.includes(word)) ? 'danger' : 'warning';
}

/** قصّ النصّ مع إبقاء المعنى؛ النصّ لا يُفسَّر كـHTML في أي حال. */
export function clampConfirmText(value: unknown): string {
    const text = value == null ? '' : String(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const queue = useRef<ConfirmRequest[]>([]);
    const [, setTick] = useState(0);
    const bump = useCallback(() => {
        setTick((value) => value + 1);
    }, []);

    const confirm = useCallback<ConfirmFn>(
        (message, options = {}) => {
            return new Promise<boolean>((resolve) => {
                queue.current.push({ message: clampConfirmText(message), options, resolve });
                bump();
            });
        },
        [bump],
    );

    const settle = useCallback(
        (answer: boolean) => {
            const head = queue.current.shift();
            if (!head) {
                return;
            }
            head.resolve(answer);
            bump();
        },
        [bump],
    );

    const current = queue.current[0] ?? null;
    const tone = current ? (current.options.tone ?? inferConfirmTone(current.message)) : 'warning';

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <Dialog
                open={current !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        settle(false);
                    }
                }}
                title={current?.options.title ?? 'تأكيد الإجراء'}
                size="sm"
                closeLabel="إغلاق"
                footer={
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            autoFocus
                            onClick={() => {
                                settle(false);
                            }}
                        >
                            {current?.options.cancelLabel ?? 'إلغاء'}
                        </Button>
                        <Button
                            type="button"
                            variant={tone === 'danger' ? 'danger' : 'primary'}
                            size="sm"
                            onClick={() => {
                                settle(true);
                            }}
                        >
                            {current?.options.confirmLabel ?? 'تأكيد'}
                        </Button>
                    </>
                }
            >
                {current ? <p className="text-body-md text-ink">{current.message}</p> : null}
            </Dialog>
        </ConfirmContext.Provider>
    );
}

/**
 * دالة التأكيد من أي مكوّن داخل `<ConfirmProvider>` (مثبّت في `App`).
 * تُرمى بوضوح خارج المزوّد بدل تأكيد صامت.
 */
export function useConfirm(): ConfirmFn {
    const value = useContext(ConfirmContext);
    if (!value) {
        throw new Error('useConfirm يجب أن يُستخدم داخل <ConfirmProvider>.');
    }
    return value;
}
