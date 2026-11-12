import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PosProductImage } from './PosProductImage';

describe('PosProductImage', () => {
    it('shows a branded placeholder when an image is absent', () => {
        render(<PosProductImage src="" name="قهوة" />);

        expect(screen.getByRole('img', { name: 'صورة قهوة غير متاحة' })).toBeTruthy();
        expect(screen.getByText('Karim POS')).toBeTruthy();
    });

    it('replaces a broken image with the branded placeholder', () => {
        const { container } = render(<PosProductImage src="/uploads/menu/42.webp" name="قهوة" />);

        fireEvent.error(container.querySelector('img')!);

        expect(screen.getByRole('img', { name: 'صورة قهوة غير متاحة' })).toBeTruthy();
        expect(container.querySelector('img')).toBeNull();
    });
});
