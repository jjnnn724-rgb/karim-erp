import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../components/ConfirmProvider';
import { ToastProvider } from '../../ui/Toast';
import { installDomPolyfills } from '../../ui/test-utils';
import { PunchSection } from './PunchSection';

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مدير النظام', username: 'admin', role: mocks.role },
    }),
}));

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const settingsBody = {
    ok: true,
    settings: [
        { key: 'punch_portal_enabled', value: 'true', updated_at: '', updated_by: 'admin' },
        { key: 'punch_geofence_enabled', value: 'true', updated_at: '', updated_by: 'admin' },
        { key: 'punch_geo_exempt_user_ids', value: '111', updated_at: '', updated_by: 'admin' },
    ],
};

const usersBody = {
    data: [
        { id: 111, username: 'youssef', name: 'يوسف صالح' },
        { id: 222, username: 'ayman', name: 'أيمن محمد' },
    ],
    pagination: { totalPages: 1 },
};

let putBodies: Array<Record<string, unknown>> = [];

function stubFetch(): void {
    putBodies = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            const method = String(init?.method ?? 'GET').toUpperCase();
            if (url.includes('/api/attendance/portal/settings-admin')) {
                if (method === 'PUT' && init?.body) {
                    try {
                        putBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                    } catch {
                        /* تجاهل حمولات غير قابلة للتحليل */
                    }
                }
                if (method === 'PUT') {
                    return json(settingsBody);
                }
                return json(settingsBody);
            }
            if (url.includes('/api/attendance/portal/punch-devices')) {
                return json({ devices: [] });
            }
            if (url.includes('/api/attendance/portal/face/list')) {
                return json({ faces: [] });
            }
            if (url.includes('/api/attendance/portal/attempts')) {
                return json({ attempts: [], summary: {} });
            }
            if (url.includes('/api/users')) {
                return json(usersBody);
            }
            return json({ error: 'NOT_FOUND', message: 'غير موجود' }, 404);
        }),
    );
}

function renderSection() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <PunchSection />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('إعدادات البصمة — استثناء الموقع الجغرافي', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        installDomPolyfills();
        stubFetch();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('يعرض بطاقة الاستثناء للأدمن مع المستثنى الحالي', async () => {
        renderSection();

        expect(await screen.findByText('استثناء الموقع الجغرافي')).toBeTruthy();
        expect(screen.getByText(/يوسف صالح/)).toBeTruthy();
    });

    it('يضيف مستخدمًا للاستثناء ويحفظ القائمة المدمجة', async () => {
        renderSection();
        await screen.findByText('استثناء الموقع الجغرافي');

        fireEvent.click(screen.getByRole('combobox', { name: 'الموظف' }));
        fireEvent.click(await screen.findByRole('option', { name: 'أيمن محمد (ayman)' }));
        fireEvent.click(screen.getByRole('button', { name: 'استثناء' }));

        await waitFor(() => {
            expect(putBodies.length).toBeGreaterThan(0);
        });
        const last = putBodies[putBodies.length - 1];
        expect(String(last?.punch_geo_exempt_user_ids ?? '')).toBe('111,222');
    });

    it('يزيل المستثنى بإرسال القائمة المتبقية', async () => {
        renderSection();
        await screen.findByText('استثناء الموقع الجغرافي');

        fireEvent.click(screen.getByRole('button', { name: 'إزالة 111 من الاستثناء' }));

        await waitFor(() => {
            expect(putBodies.length).toBeGreaterThan(0);
        });
        const last = putBodies[putBodies.length - 1];
        expect(String(last?.punch_geo_exempt_user_ids ?? '')).toBe('');
    });

    it('لا يعرض بطاقة الاستثناء إلا للأدمن', async () => {
        mocks.role = 'manager';
        renderSection();
        expect(await screen.findByText('الموقع والتحقق')).toBeTruthy();
        expect(screen.queryByText('استثناء الموقع الجغرافي')).toBeNull();
    });
});
