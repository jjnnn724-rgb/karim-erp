import { v3ErrorSchema } from '@karim/shared';
import type { z } from 'zod';
import { getAppKey } from './auth';

/**
 * عميل الـAPI — طبقة واحدة تعبرها كل نداءات القراءة.
 *
 * ثلاث قواعد هنا:
 *  1. **التحقق من الاستجابة**: كل استجابة تُمرَّر على مخطط Zod من
 *     `@karim/shared` قبل أن تُلمس في الواجهة. استجابةٌ تكسر العقد
 *     استثناءٌ صريح لا بياناتٌ مشوهة في جدول.
 *  2. **لا `any`**: Biome يمنع `noExplicitAny`، والعقد نوعي.
 *  3. **الأخطاء**: كل خطأٍ يصير `ApiError` يحمل `status` و`error` و`message`
 *     كما في القديم `{error, message}`.
 */

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }

    /** 401/403 = المستخدم يحتاج صلاحية أو جلسة؛ غيرهما خطأ خادم. */
    get isAuthProblem(): boolean {
        return this.status === 401 || this.status === 403;
    }
}

export interface FetchOptions {
    signal?: AbortSignal;
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    /** ترويسات إضافية تفرضها بوابة قديمة — مثل `Idempotency-Key` في البيع. */
    headers?: Record<string, string>;
}

function buildHeaders(token: string | null, withBody: boolean, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra, Accept: 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    // مفتاح التطبيق — `apiKeyMiddleware` في القديم يرفض أي `/api/*` بلا
    // `x-api-key` قبل المصادقة، فطلبه ناقصٌ = 401 لا شاشة بيانات.
    const appKey = getAppKey();
    if (appKey) {
        headers['x-api-key'] = appKey;
    }
    if (withBody) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

async function parseError(response: Response): Promise<ApiError> {
    let code = `HTTP_${response.status}`;
    let message = `تعذّر الاتصال بالخادم (${response.status})`;
    try {
        const body: unknown = await response.json();
        const parsed = v3ErrorSchema.safeParse(body);
        if (parsed.success) {
            code = parsed.data.error;
            message = parsed.data.message;
        }
    } catch {
        // جسم غير JSON — تبقى الرسالة الافتراضية.
    }
    return new ApiError(response.status, code, message);
}

/**
 * `fetcher` لـTanStack Query: يُعيد البيانات بعد التحقق، أو يرمي `ApiError`.
 */
export async function fetchJson<T>(schema: z.ZodType<T>, url: string, token: string | null, options: FetchOptions = {}): Promise<T> {
    const headers = buildHeaders(token, options.body !== undefined, options.headers);
    const init: RequestInit = {
        headers,
        ...(options.method ? { method: options.method } : {}),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
    };
    const response = await fetch(url, init);
    if (!response.ok) {
        throw await parseError(response);
    }
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw new ApiError(response.status, 'CONTRACT_VIOLATION', 'استجابة الخادم تخالف العقد المعلَن');
    }
    return parsed.data;
}

/**
 * نصّ خام من الخادم (ورقة HTML مطبوعة) بنفس المصادقة — بلا تحقق عقد:
 * الورقة تُكتب في نافذة الطباعة كما هي. أي رد غير 2xx يرمي `ApiError`.
 */
export async function fetchText(url: string, token: string | null, options: FetchOptions = {}): Promise<string> {
    const headers = buildHeaders(token, false, options.headers);
    headers.Accept = 'text/html';
    const response = await fetch(url, {
        headers,
        ...(options.method ? { method: options.method } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
        throw await parseError(response);
    }
    return response.text();
}

export interface FileResponse {
    blob: Blob;
    filename: string;
}

/**
 * اسم الملف من `Content-Disposition` — يدعم الصيغة المشفّرة `filename*=UTF-8''`
 * التي يستخدمها الخادم للأسماء العربية، مع سقوط آمن للاسم الصريح.
 */
export function filenameFromDisposition(disposition: string | null, fallback: string): string {
    if (!disposition) {
        return fallback;
    }
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (encoded?.[1]) {
        try {
            return decodeURIComponent(encoded[1].trim());
        } catch {
            // ترميز تالف — يكفي الاسم الصريح أدناه.
        }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
    return plain?.[1]?.trim() || fallback;
}

/**
 * تنزيل ملف من الخادم: نفس مصادقة `fetchJson`، لكن الجسم بايتات لا JSON.
 * أي رد غير 2xx يمرّ على `parseError` فيبقى `{error,message}` مقروءًا.
 */
export async function fetchFile(
    url: string,
    token: string | null,
    fallbackName: string,
    options: FetchOptions = {},
): Promise<FileResponse> {
    const headers = buildHeaders(token, false);
    headers.Accept =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream;q=0.9, application/json;q=0.5';
    const response = await fetch(url, {
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
        throw await parseError(response);
    }
    return {
        blob: await response.blob(),
        filename: filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName),
    };
}
