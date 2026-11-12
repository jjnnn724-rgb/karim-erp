import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';
import { clearTheme, expectNoAxeViolations, installDomPolyfills, mockMatchMedia } from './test-utils';
import { THEME_STORAGE_KEY } from './theme';

installDomPolyfills();

function renderToggle() {
    return render(
        <ThemeProvider>
            <ThemeToggle />
        </ThemeProvider>,
    );
}

beforeEach(() => {
    clearTheme();
});

afterEach(() => {
    clearTheme();
});

describe('ThemeProvider + ThemeToggle', () => {
    it('الافتراضي system ويتبع تفضيل النظام الداكن', () => {
        mockMatchMedia(true);
        renderToggle();

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.dataset['theme']).toBe('system');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(screen.getByRole('button', { name: 'النظام' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('الاختيار الصريح يُطبَّق ويُحفظ في karim_theme_v1', () => {
        mockMatchMedia(false);
        renderToggle();

        fireEvent.click(screen.getByRole('button', { name: 'داكن' }));

        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(screen.getByRole('button', { name: 'داكن' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'فاتح' }).getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: 'فاتح' }));
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('system يتابع تغيّر تفضيل النظام بعد التحميل', () => {
        const media = mockMatchMedia(false);
        renderToggle();
        expect(document.documentElement.classList.contains('dark')).toBe(false);

        act(() => {
            media.setMatches(true);
        });
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        act(() => {
            media.setMatches(false);
        });
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('يقرأ تفضيلًا محفوظًا مسبقًا (توافق karim_theme_v1)', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        mockMatchMedia(false);
        renderToggle();

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(screen.getByRole('button', { name: 'داكن' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('لا يتابع النظام عندما يكون الاختيار صريحًا', () => {
        const media = mockMatchMedia(false);
        renderToggle();
        fireEvent.click(screen.getByRole('button', { name: 'فاتح' }));

        act(() => {
            media.setMatches(true);
        });
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('بلا مخالفات axe', async () => {
        mockMatchMedia(false);
        const { container } = renderToggle();
        await expectNoAxeViolations(container);
    });
});
