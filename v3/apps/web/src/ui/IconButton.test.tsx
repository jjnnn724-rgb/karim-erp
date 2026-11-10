import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import { SearchIcon } from './icons';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('IconButton', () => {
    it('يأخذ اسمه المفهوم من label', () => {
        render(<IconButton label="بحث" icon={<SearchIcon />} />);

        const button = screen.getByRole('button', { name: 'بحث' });
        expect(button.getAttribute('aria-label')).toBe('بحث');
    });

    it('يستجيب للنقر وعلى وضع loading يُعطَّل', () => {
        const onClick = vi.fn();
        const { rerender } = render(<IconButton label="بحث" icon={<SearchIcon />} onClick={onClick} />);

        fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
        expect(onClick).toHaveBeenCalledTimes(1);

        rerender(<IconButton label="بحث" icon={<SearchIcon />} onClick={onClick} loading />);
        const loadingButton = screen.getByRole('button', { name: 'بحث' });
        expect(loadingButton.hasAttribute('disabled')).toBe(true);
        expect(loadingButton.getAttribute('aria-busy')).toBe('true');
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex gap-sm">
                <IconButton label="بحث" icon={<SearchIcon />} />
                <IconButton label="بحث" icon={<SearchIcon />} variant="secondary" />
                <IconButton label="بحث" icon={<SearchIcon />} disabled />
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('الثانوي يُRender بلونه الخاص', () => {
        render(<IconButton label="ثانوي" icon={<SearchIcon />} variant="secondary" />);
        expect(screen.getByRole('button', { name: 'ثانوي' }).className).toContain('text-ink-secondary');
    });

    it('الحجم كبير يُRender taller', () => {
        render(<IconButton label="كبير" icon={<SearchIcon />} size="lg" />);
        expect(screen.getByRole('button', { name: 'كبير' }).className).toContain('size-11');
    });

    it('className مخصص يُطبق على الزر', () => {
        render(<IconButton label="مخصص" icon={<SearchIcon />} className="border-2" />);
        expect(screen.getByRole('button', { name: 'مخصص' }).className).toContain('border-2');
    });
});
