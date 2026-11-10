import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

function Harness() {
    const { toast } = useToast();
    return (
        <div className="flex gap-sm">
            <button type="button" onClick={() => toast({ title: 'تم الحفظ', variant: 'success' })}>
                نجاح
            </button>
            <button type="button" onClick={() => toast({ title: 'فشل الحفظ', description: 'حاول مجددًا', variant: 'error' })}>
                خطأ
            </button>
            <button type="button" onClick={() => toast({ title: 'معلومة', duration: 1000 })}>
                معلومة
            </button>
        </div>
    );
}

function renderHarness() {
    return render(
        <ToastProvider>
            <Harness />
        </ToastProvider>,
    );
}

afterEach(() => {
    vi.useRealTimers();
});

describe('Toast', () => {
    it('يُعلن النجاح في منطقة live كـstatus', () => {
        renderHarness();
        fireEvent.click(screen.getByRole('button', { name: 'نجاح' }));

        const status = screen.getByRole('status');
        expect(status.textContent).toContain('تم الحفظ');
    });

    it('الخطأ يستخدم role=alert مع الوصف', () => {
        renderHarness();
        fireEvent.click(screen.getByRole('button', { name: 'خطأ' }));

        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('فشل الحفظ');
        expect(alert.textContent).toContain('حاول مجددًا');
    });

    it('يُغلق تلقائيًا بعد المدة', () => {
        vi.useFakeTimers();
        renderHarness();
        fireEvent.click(screen.getByRole('button', { name: 'معلومة' }));
        expect(screen.getByRole('status').textContent).toContain('معلومة');

        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('يُغلق يدويًا بزر الإغلاق', () => {
        renderHarness();
        fireEvent.click(screen.getByRole('button', { name: 'نجاح' }));

        fireEvent.click(screen.getByRole('button', { name: 'إغلاق التنبيه' }));
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = renderHarness();
        fireEvent.click(screen.getByRole('button', { name: 'نجاح' }));

        await expectNoAxeViolations(container);
    });
});
