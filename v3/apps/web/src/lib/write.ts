import { type QueryKey, type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useToast } from '../ui/Toast';
import { ApiError, fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * طبقة الكتابة المشتركة في V3 — تُستخدم من كل شاشة تُضيف/تعدّل/تحذف مثل V2.
 *
 * القواعد المنقولة من V2 حرفيًّا:
 *  1. **نفس البوابة**: كل كتابة تمرّ على `fetchJson` (فهم يتحقق Zod من الاستجابة،
 *     ويحوّل أي خطأ إلى `ApiError` يحمل `error`/`message` كما في القديم).
 *  2. **نفس الأدوار**: `roleIn` في V2 = `list.includes(role)` حرفيًّا — و`admin`
 *     ليس بديلًا ضمنيًّا عن أي دور؛ كل قائمة تكتب `admin` صراحةً. لذلك
 *     `isWriteRole` هنا مطابقة حرفية، لا «admin يملك كل شيء» محليًّا.
 *  3. **لا توست للخطأ داخل النماذج**: بعض شاشات V2 تكتب رسالة الخطأ داخل النموذج
 *     وتُبقي الحقول كما هي (fail(form) + focus). لذلك `silentError` متاح،
 *     والافتراضي توست خطأ عربي يحمل رسالة الخادم.
 *  4. **إبطال الاستعلامات بعد النجاح**: الشاشة تقرّر المفاتيح (`invalidate`)،
 *     والمُساعد ينفّذ. لا إعادة تحميل كامل إلا إن طلبتها الشاشة.
 */

/** أي استجابة كتابة مقبولة — بعض بوابات V2 تعيد `{ok:true}` وبعضها يعيد الكيان. */
export const writeAckSchema = z.object({}).passthrough();
export type WriteAck = z.infer<typeof writeAckSchema>;

export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** كتابة JSON واحدة — نفس `fetchJson` لكن بلا تكرار التوكن والمفتاح. */
export async function writeJson<T>(schema: z.ZodType<T>, url: string, method: WriteMethod, body?: unknown): Promise<T> {
    return fetchJson(schema, url, getAccessToken(), {
        method,
        ...(body === undefined ? {} : { body }),
    });
}

/** كتابة لا يهمّ شكل مردودها بعد التحقق (POST/PUT/DELETE عام في القديم). */
export async function writeAck(url: string, method: WriteMethod, body?: unknown): Promise<WriteAck> {
    return writeJson(writeAckSchema, url, method, body);
}

/**
 * مطابقة الأدوار حرفيًّا كما في V2 (`list.includes(role)`).
 * لا تُضِف `admin` هنا — من يحتاجه يذكره في قائمته، كما تفعل قوائم V2.
 */
export function isWriteRole(role: string | null | undefined, allowed: readonly string[]): boolean {
    return allowed.includes(String(role ?? '').trim());
}

/** رسالة خطأ عربية من أي شكل خطأ — رسالة الخادم أولًا (مثل V2). */
export function writeErrorMessage(error: unknown, fallback = 'تعذّر إتمام العملية'): string {
    if (error instanceof ApiError) {
        return error.message || fallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    return fallback;
}

function callable<T>(value: string | ((vars: T) => string) | undefined, vars: T): string | null {
    if (typeof value === 'string') {
        return value;
    }
    return value ? value(vars) : null;
}

export interface WriteMutationOptions<TVars, TData> {
    mutationFn: (vars: TVars) => Promise<TData>;
    /** عنوان توست النجاح — نص ثابت أو دالة في متغيرات الكتابة. */
    successTitle?: string | ((vars: TVars) => string);
    successDescription?: string | ((vars: TVars) => string);
    /** مفاتيح الاستعلامات التي تُبطَل بعد النجاح (أو دالة تبنيها). */
    invalidate?: readonly QueryKey[] | ((vars: TVars, data: TData) => readonly QueryKey[]);
    /** عنوان توست الخطأ؛ الافتراضي «تعذّر إتمام العملية». */
    errorTitle?: string;
    /** تعطيل توست الخطأ — للشاشات التي تعرض الخطأ داخل النموذج (نمط V2). */
    silentError?: boolean;
    onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
    onError?: (error: unknown, vars: TVars) => void;
}

export type WriteMutationResult<TVars, TData> = UseMutationResult<TData, unknown, TVars>;

/**
 * `useMutation` بعقد الكتابة الموحّد: توست نجاح عربي + إبطال الاستعلامات،
 * وتوست خطأ يحمل رسالة الخادم. مكوّنات الاختبار تُغلّفها بـ`ToastProvider`.
 */
export function useWriteMutation<TVars, TData>(
    options: WriteMutationOptions<TVars, TData>,
): WriteMutationResult<TVars, TData> {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation<TData, unknown, TVars>({
        mutationFn: options.mutationFn,
        onSuccess: async (data, vars) => {
            const title = callable(options.successTitle, vars);
            if (title) {
                const description = callable(options.successDescription, vars);
                toast({
                    title,
                    ...(description ? { description } : {}),
                    variant: 'success',
                });
            }
            const keys =
                typeof options.invalidate === 'function' ? options.invalidate(vars, data) : (options.invalidate ?? []);
            await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
            await options.onSuccess?.(data, vars);
        },
        onError: (error, vars) => {
            if (!options.silentError) {
                toast({
                    title: options.errorTitle ?? 'تعذّر إتمام العملية',
                    description: writeErrorMessage(error),
                    variant: 'error',
                });
            }
            options.onError?.(error, vars);
        },
    });
}
