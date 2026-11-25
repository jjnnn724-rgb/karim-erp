import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PosProductImage } from './PosProductImage';

describe('PosProductImage', () => {
    it('يعرض واجهة بديلة بأول حرف من اسم الصنف عند غياب الصورة', () => {
        render(<PosProductImage src="" name="قهوة" />);

        expect(screen.getByRole('img', { name: 'صورة قهوة غير متاحة' })).toBeTruthy();
        expect(screen.getByText('ق')).toBeTruthy();
    });

    it('يستبدل الصورة التالفة بالواجهة البديلة بلا ترك صورة مكسورة', () => {
        const { container } = render(<PosProductImage src="/uploads/menu/product-42-1-abc.webp" name="قهوة" />);

        const img = container.querySelector('img');
        if (!(img instanceof HTMLImageElement)) {
            throw new Error('missing product image');
        }
        fireEvent.error(img);

        expect(screen.getByRole('img', { name: 'صورة قهوة غير متاحة' })).toBeTruthy();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('ق')).toBeTruthy();
    });

    it('يعرض صورة الصنف الصحيحة كما هي', () => {
        const { container } = render(<PosProductImage src="/uploads/menu/product-42-1-abc.webp" name="قهوة" />);

        expect(container.querySelector('img')?.getAttribute('src')).toBe('/uploads/menu/product-42-1-abc.webp');
        expect(screen.queryByRole('img', { name: 'صورة قهوة غير متاحة' })).toBeNull();
    });
});
