import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Settings } from './Settings';

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../lib/auth', () => ({
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

const mainSettings = {
    id: 'main_settings',
    name: 'مطعم كريم',
    currency: 'SAR',
    workStartHour: 6,
    opening_balance_visible: true,
    pos_legacy_mode: 'off',
    pos_official_path: '/v3/pos-entry',
};

const zatcaSettings = {
    config: {
        enabled: true,
        environment: 'simulation',
        seller_name: 'مؤسسة كريم',
        vat_number: '310123456700003',
        crn: '1010101010',
        branch_name: 'الفرع الرئيسي',
        address: 'الرياض',
        has_csid: true,
        csid_masked: 'CSID-****-1234',
        max_attempts: 5,
        poll_in_server: true,
        environments: [],
    },
    queue: { pending: 0, failed: 0, sent_24h: 3 },
    engine: { mode: 'sql_poller', poller_in_server: true, poll_interval_ms: 60000 },
};

const kotSettings = { kot_enabled: true, kot_copies: 2, kot_include_notes: true };

function stubFetch(): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            urls.push(url);
            if (url.includes('/api/zatca/settings')) {
                return json(zatcaSettings);
            }
            if (url.includes('/api/zatca/queue')) {
                return json({ ok: true, rows: [], queue: zatcaSettings.queue });
            }
            if (url.includes('/api/pos/kot/settings')) {
                return json(kotSettings);
            }
            if (url.includes('/api/settings')) {
                return json(mainSettings);
            }
            return json({ error: 'NOT_FOUND', message: 'غير موجود' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Settings />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    mocks.role = 'admin';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('إعدادات النظام', () => {
    it('يعرض الأقسام الثمانية وبيانات المنشأة للمدير', async () => {
        stubFetch();
        renderScreen();

        expect(await screen.findByLabelText('اسم المطعم')).toHaveValue('مطعم كريم');
        expect(screen.getByLabelText('العملة')).toHaveValue('SAR');

        const rail = screen.getByRole('navigation', { name: 'أقسام الإعدادات' });
        for (const label of [
            'عام',
            'القائمة الجانبية',
            'الفاتورة الضريبية',
            'تذاكر المطبخ',
            'بطاقات الموظفين',
            'البصمة الذاتية',
            'النسخ الاحتياطي',
            'التصدير والتصفير',
        ]) {
            expect(within(rail).getByRole('button', { name: new RegExp(label) })).toBeTruthy();
        }
    });

    it('ينتقل إلى ZATCA وتذاكر المطبخ ويحمّل بيانات كل قسم', async () => {
        stubFetch();
        renderScreen();

        fireEvent.click(screen.getByRole('button', { name: /الفاتورة الضريبية/ }));
        await waitFor(() => {
            expect(screen.getByLabelText('الرقم الضريبي')).toHaveValue('310123456700003');
        });
        expect(screen.getByText('الربط الضريبي')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /تذاكر المطبخ/ }));
        expect(await screen.findByText('إظهار اسم الضيف والملاحظات')).toBeTruthy();
    });

    it('يخفي أقسام الإدارة الحساسة عن المحاسب ويُقفل الحقول', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();

        expect(await screen.findByLabelText('اسم المطعم')).toBeDisabled();
        const rail = screen.getByRole('navigation', { name: 'أقسام الإعدادات' });
        expect(within(rail).queryByRole('button', { name: /البصمة الذاتية/ })).toBeNull();
        expect(within(rail).queryByRole('button', { name: /النسخ الاحتياطي/ })).toBeNull();
        expect(within(rail).queryByRole('button', { name: /التصدير والتصفير/ })).toBeNull();
        expect(within(rail).getByRole('button', { name: /الفاتورة الضريبية/ })).toBeTruthy();
    });
});
