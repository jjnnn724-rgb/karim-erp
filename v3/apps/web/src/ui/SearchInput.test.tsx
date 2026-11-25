import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchInput } from './SearchInput';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('SearchInput', () => {
    it('حقل بحث باسم مفهوم وقابل للكتابة', () => {
        const onChange = vi.fn();
        render(<SearchInput value="" onChange={onChange} label="بحث الفواتير" />);

        const input = screen.getByLabelText('بحث الفواتير');
        fireEvent.change(input, { target: { value: 'INV' } });
        expect(onChange).toHaveBeenCalledWith('INV');
    });

    it('زر المسح يظهر عند وجود نص ويمسح القيمة', () => {
        const onChange = vi.fn();
        render(<SearchInput value="INV-1" onChange={onChange} onClear={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'مسح البحث' }));
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('لا زر مسح عندما يكون الحقل فارغًا', () => {
        render(<SearchInput value="" onChange={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'مسح البحث' })).toBeNull();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<SearchInput value="INV-1" onChange={vi.fn()} />);
        await expectNoAxeViolations(container);
    });

    it('id المخصص يُطبَّق على الحقل', () => {
        render(<SearchInput label="بحث" id="custom-search-id" value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('بحث').id).toBe('custom-search-id');
    });

    it('disabled يمنع onChange', () => {
        const onChange = vi.fn();
        render(<SearchInput label="معطّل" disabled value="" onChange={onChange} />);
        expect((screen.getByLabelText('معطّل') as HTMLInputElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('معطّل'), { target: { value: 'x' } });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('placeholder يُRender على الحقل', () => {
        render(<SearchInput label="بحث" placeholder="اكتب هنا" value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('بحث').getAttribute('placeholder')).toBe('اكتب هنا');
    });
});
