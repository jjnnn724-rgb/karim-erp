import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { HrDepartments } from './HrDepartments';

const mocks = vi.hoisted(() => ({
    role: 'hr',
    fetchHrDepartments: vi.fn(),
    fetchHrEmployees: vi.fn(),
    createHrDepartment: vi.fn(),
    updateHrDepartment: vi.fn(),
    deleteHrDepartment: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'HR Test', username: 'hr', role: mocks.role },
    }),
}));

vi.mock('../lib/hr-departments', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/hr-departments')>();
    return {
        ...original,
        fetchHrDepartments: mocks.fetchHrDepartments,
        fetchHrEmployees: mocks.fetchHrEmployees,
        createHrDepartment: mocks.createHrDepartment,
        updateHrDepartment: mocks.updateHrDepartment,
        deleteHrDepartment: mocks.deleteHrDepartment,
    };
});

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <HrDepartments />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.role = 'hr';
    mocks.fetchHrDepartments.mockResolvedValue([
        { id: '2', code: 'HRD-2', name: 'الموارد البشرية', manager: 'مدير الموارد' },
        { id: '3', code: 'ACCT', name: 'الحسابات', manager: '—' },
    ]);
    mocks.fetchHrEmployees.mockResolvedValue([
        { id: '10', department: 'HRD-2' },
        { id: '11', department: 'HRD-2' },
    ]);
    mocks.createHrDepartment.mockResolvedValue(undefined);
    mocks.updateHrDepartment.mockResolvedValue(undefined);
    mocks.deleteHrDepartment.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('أقسام الموظفين', () => {
    it('يعرض أعداد الموظفين والبحث ولا يفتح الكتابة بلا العلم', async () => {
        renderScreen();
        await screen.findByText('الموارد البشرية');
        expect(screen.getByText('2', { selector: 'td' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'إضافة قسم' })).toBeNull();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ACCT' } });
        expect(screen.getByText('الحسابات')).toBeTruthy();
        expect(screen.queryByText('الموارد البشرية')).toBeNull();
    });

    it('ينشئ قسمًا بكود لاتيني مولّد عند ترك الكود فارغًا', async () => {
        window.localStorage.setItem('karim_v2_hr_department_write', '1');
        renderScreen();
        await screen.findByText('الموارد البشرية');
        fireEvent.click(screen.getByRole('button', { name: 'إضافة قسم' }));
        fireEvent.change(screen.getByLabelText('اسم القسم *'), { target: { value: 'خدمات العملاء' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ القسم' }));

        await waitFor(() => expect(mocks.createHrDepartment).toHaveBeenCalledOnce());
        expect(mocks.createHrDepartment.mock.calls[0]?.[0]).toMatchObject({
            name: 'خدمات العملاء',
            code: /^HRD-[A-Z0-9]+$/,
            manager: null,
        });
    });

    it('يعدّل الاسم والمدير فقط ويبقي رمز القسم ثابتًا', async () => {
        window.localStorage.setItem('karim_v2_hr_department_write', '1');
        renderScreen();
        await screen.findByText('الموارد البشرية');
        const [editButton] = screen.getAllByRole('button', { name: 'تعديل' });
        if (!editButton) {
            throw new Error('زر تعديل القسم غير موجود');
        }
        fireEvent.click(editButton);
        fireEvent.change(screen.getByLabelText('اسم القسم *'), { target: { value: 'شؤون الموظفين' } });
        fireEvent.change(screen.getByLabelText('المدير'), { target: { value: 'مدير جديد' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ القسم' }));

        await waitFor(() =>
            expect(mocks.updateHrDepartment).toHaveBeenCalledWith('2', {
                name: 'شؤون الموظفين',
                manager: 'مدير جديد',
            }),
        );
    });

    it('يؤكد الحذف ويترك رفض الخادم ظاهرًا عند وجود ارتباطات', async () => {
        window.localStorage.setItem('karim_v2_hr_department_write', '1');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mocks.deleteHrDepartment.mockRejectedValue(new Error('لا يمكن حذف قسم مرتبط بموظفين'));
        renderScreen();
        await screen.findByText('الموارد البشرية');
        const [deleteButton] = screen.getAllByRole('button', { name: 'حذف' });
        if (!deleteButton) {
            throw new Error('زر حذف القسم غير موجود');
        }
        fireEvent.click(deleteButton);

        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('لا يمكن حذف قسم مرتبط بموظفين'));
        expect(mocks.deleteHrDepartment).toHaveBeenCalledWith('2');
    });
});
