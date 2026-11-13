import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { ComplianceCenter } from './ComplianceCenter';

const mocks = vi.hoisted(() => ({
    role: 'admin',
    fetchComplianceReport: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'محاسب اختبار', username: 'test', role: mocks.role },
    }),
}));

vi.mock('../lib/compliance-report', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/compliance-report')>();
    return { ...original, fetchComplianceReport: mocks.fetchComplianceReport };
});

vi.mock('../components/PrintActions', () => ({ PrintActions: () => null }));

const report = {
    ok: true,
    report: {
        month: '2026-10',
        generated_at: '2026-11-01T00:00:00.000Z',
        employer: { crn: 'CRN123', name: 'منشأة' },
        payroll: {
            active_employees: 137,
            employees_with_line: 120,
            employees_without_line: 17,
            totals: { basic: 500000, allowances: 100000, deductions: 20000, net: 580000 },
            posted: true,
        },
        readiness: { percent: 92, export_ready: true, blockers: [], summary: { ready: 126 } },
        global_blockers: [],
        export_ready: true,
        gosi: { rate_set_required: true, note: 'لم تُحدّد مجموعة النسب.' },
        qiwa: { checks: [{ id: 'crn', label_ar: 'السجل التجاري', ok: true, detail: 'CRN123' }], ready: true },
    },
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ComplianceCenter />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('لوحة الامتثال الشهري', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        mocks.fetchComplianceReport.mockResolvedValue(report);
    });

    it('تعرض الرواتب والجاهزية والموانع من بيانات النظام', async () => {
        renderScreen();

        expect(await screen.findByRole('heading', { name: /لوحة الامتثال الشهري/ })).toBeTruthy();
        expect(await screen.findByText('137')).toBeTruthy();
        expect(screen.getByText('92%')).toBeTruthy();
        expect(screen.getByText('جاهزة')).toBeTruthy();
        expect(screen.getByText('CRN123')).toBeTruthy();
    });
});
