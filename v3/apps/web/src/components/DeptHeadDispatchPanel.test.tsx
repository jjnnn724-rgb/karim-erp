import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch } from '../lib/dispatches';
import { ToastProvider } from '../ui/Toast';
import { DeptHeadDispatchPanel } from './DeptHeadDispatchPanel';

const mocks = vi.hoisted(() => ({
    printDispatchDocument: vi.fn(async (_row: unknown, _printedBy?: string) => undefined),
    receiveDispatch: vi.fn(async () => undefined),
}));

vi.mock('../lib/dispatch-print', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/dispatch-print')>();
    return { ...actual, printDispatchDocument: mocks.printDispatchDocument };
});

vi.mock('../lib/dispatches-write', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/dispatches-write')>();
    return { ...actual, receiveDispatch: mocks.receiveDispatch };
});

function row(id: string, status: string, deptCode: string): Dispatch {
    return {
        id,
        deptCode,
        deptName: deptCode === 'KITCHEN' ? 'المطبخ' : 'السلطات',
        status,
        date: '2026-11-20',
        createdBy: 'محاسب',
        items: [{ itemName: 'أرز بسمتي', qty: 10, approvedQty: 10, unit: 'كجم' }],
        needsChefApproval: false,
    };
}

function renderPanel(rows: Dispatch[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <DeptHeadDispatchPanel
                    rows={rows}
                    role="dept_head"
                    gateUser={{ id: '9002', deptCode: 'KITCHEN' }}
                    signerName="رئيس المطبخ"
                    query=""
                    loading={false}
                    onRetry={() => undefined}
                    onReceived={() => undefined}
                />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    mocks.printDispatchDocument.mockClear();
    mocks.receiveDispatch.mockClear();
});

describe('مساحة أذون رئيس القسم', () => {
    it('الطباعة لكل إذن، والاستلام فقط للإذن المعتمد لقسمه', () => {
        renderPanel([row('101', 'approved', 'KITCHEN'), row('102', 'received', 'KITCHEN'), row('103', 'approved', 'SALADS')]);

        expect(screen.getAllByRole('button', { name: /طباعة إذن الصرف/ }).length).toBe(3);
        const receiveButtons = screen.getAllByRole('button', { name: /استلام إذن الصرف/ });
        expect(receiveButtons.length).toBe(1);
        expect(receiveButtons[0]?.getAttribute('aria-label')).toContain('101');

        fireEvent.click(screen.getByRole('button', { name: 'طباعة إذن الصرف DIS-101' }));
        expect(mocks.printDispatchDocument).toHaveBeenCalledTimes(1);
        expect(mocks.printDispatchDocument.mock.calls[0]?.[0]).toMatchObject({ id: '101' });
    });

    it('فلتر «بانتظار الاستلام» يخفي الإذون المستلمة والمختلفة', () => {
        renderPanel([row('101', 'approved', 'KITCHEN'), row('102', 'received', 'KITCHEN'), row('103', 'approved', 'SALADS')]);

        fireEvent.click(screen.getByRole('button', { name: 'بانتظار الاستلام فقط' }));
        expect(screen.getByText('DIS-101')).toBeTruthy();
        expect(screen.queryByText('DIS-102')).toBeNull();
        expect(screen.queryByText('DIS-103')).toBeNull();
    });

    it('زر الاستلام يفتح نموذج التوقيع باسم حساب الجلسة', () => {
        renderPanel([row('101', 'approved', 'KITCHEN')]);

        fireEvent.click(screen.getByRole('button', { name: 'استلام إذن الصرف DIS-101' }));
        expect(screen.getByText(/استلام إذن الصرف #101/)).toBeTruthy();
        expect(screen.getByText(/باسم حسابك فقط/)).toBeTruthy();
        expect(screen.getByText('رئيس المطبخ')).toBeTruthy();
    });
});
