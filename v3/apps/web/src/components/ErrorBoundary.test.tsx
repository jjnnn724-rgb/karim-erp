import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, RouteError } from './ErrorBoundary';

/**
 * حارس شبكة الأمان: الانهيار يعرض رسالةً عربية قابلة للتصرف لا شاشةً بيضاء،
 * و«إعادة المحاولة» تعيد تركيب الشجرة فعليًا بعد إصلاح السبب.
 */

let crash = true;

function Bomb() {
    if (crash) {
        throw new Error('boom-detail');
    }
    return <p>المحتوى سليم</p>;
}

beforeEach(() => {
    crash = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('حدود الخطأ', () => {
    it('تعرض الأبناء عادةً حين لا خطأ', () => {
        crash = false;
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>,
        );
        expect(screen.getByText('المحتوى سليم')).toBeTruthy();
    });

    it('تعرض شاشة عربية عند انهيار العرض وتسجّل الخطأ', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>,
        );

        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('وقعت مشكلة غير متوقعة');
        expect(alert.textContent).toContain('لم تتأثر بياناتك');
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'العودة إلى الرئيسية' })).toBeTruthy();
        expect(console.error).toHaveBeenCalledWith('[v3] انهيار في العرض —', expect.any(Error), expect.anything());
    });

    it('«إعادة المحاولة» تعيد التركيب بعد إزالة سبب الانهيار', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>,
        );
        expect(screen.getByRole('alert')).toBeTruthy();

        crash = false;
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('المحتوى سليم')).toBeTruthy();
    });

    it('تقبل بديلًا مخصّصًا يستلم الخطأ وإعادة الضبط', () => {
        const fallback = vi.fn((_error: unknown, reset: () => void) => (
            <button type="button" onClick={reset}>
                بديل
            </button>
        ));
        render(
            <ErrorBoundary fallback={fallback}>
                <Bomb />
            </ErrorBoundary>,
        );

        expect(fallback).toHaveBeenCalledWith(expect.any(Error), expect.any(Function));
        crash = false;
        fireEvent.click(screen.getByRole('button', { name: 'بديل' }));
        expect(screen.getByText('المحتوى سليم')).toBeTruthy();
    });

    it('RouteError يسجّل الانهيار ويمرّر إعادة الضبط إلى زر المحاولة', () => {
        const reset = vi.fn();
        render(<RouteError error={new Error('route-crash')} reset={reset} />);
        expect(console.error).toHaveBeenCalledWith('[v3] انهيار في المسار —', expect.any(Error));
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
        expect(reset).toHaveBeenCalledTimes(1);
    });
});
