import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineConflictBanner } from './OfflineConflictBanner';

const mocks = vi.hoisted(() => ({
    conflicts: vi.fn(),
    resolve: vi.fn(),
}));

vi.mock('../lib/pos-offline', () => ({
    queuedSaleConflicts: mocks.conflicts,
    resolveQueuedSale: mocks.resolve,
}));

beforeEach(() => {
    mocks.conflicts.mockReset();
    mocks.resolve.mockReset();
});

describe('OfflineConflictBanner — manual 409 resolution', () => {
    it('لا يعرض شيئًا بلا تعارضات', async () => {
        mocks.conflicts.mockResolvedValue([]);
        render(<OfflineConflictBanner />);
        await waitFor(() => expect(mocks.conflicts).toHaveBeenCalled());
        expect(screen.queryByTestId('offline-conflict-banner')).toBeNull();
    });

    it('يعرض التعارض ويسمح بإعادة الإرسال أو الإلغاء صراحةً', async () => {
        mocks.conflicts.mockResolvedValue([{ local_transaction_uuid: 'sale-409' }]);
        mocks.resolve.mockResolvedValue(null);
        render(<OfflineConflictBanner />);
        const banner = await screen.findByTestId('offline-conflict-banner');
        expect(banner.getAttribute('aria-label')).toContain('قرار');
        fireEvent.click(screen.getByRole('button', { name: 'إعادة' }));
        expect(mocks.resolve).toHaveBeenCalledWith('sale-409', 'retry');
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        expect(mocks.resolve).toHaveBeenCalledWith('sale-409', 'discard');
    });
});
