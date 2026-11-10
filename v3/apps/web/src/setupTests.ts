import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';

/**
 * `window.scrollTo` غير منفَّذ في jsdom، واستعادة التمرير في TanStack Router
 * تستدعيه — فنُطفئ ضجيجه بدل أن يملأ سجلّ الاختبار.
 */
beforeAll(() => {
    Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
});

/**
 * التنظيف بين الاختبارات — `globals` معطّل في Vitest هنا، فالتنظيف التلقائي
 * لـTesting Library لا يسجّل نفسه: بلا هذا يبقى DOM الاختبار السابق في الصفحة.
 */
afterEach(() => {
    cleanup();
});
