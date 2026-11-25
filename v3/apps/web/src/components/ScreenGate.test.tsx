import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_APP_URL } from '../lib/screens';
import { ScreenGate } from './ScreenGate';

function declareScreens(content: string): void {
    const meta = document.createElement('meta');
    meta.name = 'v3-screens';
    meta.content = content;
    document.head.appendChild(meta);
}

function renderScreen(node: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
    document.head.querySelector('meta[name="v3-screens"]')?.remove();
});

describe('حارس الشاشة', () => {
    it('شاشة مفعّلة ⇒ المحتوى كما هو', () => {
        declareScreens('accounts');
        renderScreen(
            <ScreenGate screen="accounts">
                <p>محتوى v3</p>
            </ScreenGate>,
        );
        expect(screen.getByText('محتوى v3')).toBeTruthy();
        expect(screen.queryByRole('link', { name: /النسخة القديمة/ })).toBeNull();
    });

    it('شاشة مطفأة ⇒ دعوة صريحة للقديم بلا محتوى', () => {
        declareScreens('accounts');
        renderScreen(
            <ScreenGate screen="journal">
                <p>محتوى v3</p>
            </ScreenGate>,
        );
        expect(screen.queryByText('محتوى v3')).toBeNull();
        expect(screen.getByRole('link', { name: /النسخة القديمة/ }).getAttribute('href')).toBe(LEGACY_APP_URL);
    });
});
