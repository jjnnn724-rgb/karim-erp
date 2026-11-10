import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartCaptureBody } from './test-fixtures/captures';

// المسار قبل استيراد `App`: المُوجِّه يقرأ الموقع عند الإنشاء، و`basepath` هو `/v3`.
vi.hoisted(() => {
    window.history.replaceState({}, '', '/v3/accounts');
});

const chart = chartCaptureBody;

function stubFetch(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (String(url).includes('/api/v3/accounting/chart')) {
                return new Response(JSON.stringify(chart), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing Bearer token.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }),
    );
}

beforeEach(() => {
    window.localStorage.clear();
    stubFetch();
});

afterEach(() => {
    window.localStorage.clear();
    document.head.querySelector('meta[name="v3-screens"]')?.remove();
    vi.unstubAllGlobals();
});

describe('تطبيق v3', () => {
    it('بلا جلسة ⇒ شاشة الدخول', async () => {
        const { App } = await import('./App');
        render(<App />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Karim ERP — الإصدار الثالث');
        });
        expect(screen.getByLabelText('اسم المستخدم')).toBeTruthy();
        expect(screen.getByLabelText('كلمة المرور')).toBeTruthy();
    });

    it('مع جلسة ⇒ القشرة وشاشة شجرة الحسابات', async () => {
        window.localStorage.setItem('karim_access_v1', 'test-token');
        const { App } = await import('./App');
        render(<App />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('شجرة الحسابات');
        });

        // القشرة: رابط لكل شاشة + شارة «للقراءة فقط».
        expect(screen.getAllByRole('link', { name: /شجرة الحسابات/ }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: /القيود اليومية/ }).length).toBeGreaterThan(0);
        expect(screen.getByText('للقراءة فقط — بلا كتابة')).toBeTruthy();
    });

    it('شاشة مطفأة في الوسم ⇒ لا رابط لها في التنقّل', async () => {
        const meta = document.createElement('meta');
        meta.name = 'v3-screens';
        meta.content = 'accounts';
        document.head.appendChild(meta);
        window.localStorage.setItem('karim_access_v1', 'test-token');

        const { App } = await import('./App');
        render(<App />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('شجرة الحسابات');
        });
        expect(screen.getAllByRole('link', { name: /شجرة الحسابات/ }).length).toBeGreaterThan(0);
        expect(screen.queryAllByRole('link', { name: /القيود اليومية/ })).toHaveLength(0);
    });
});
