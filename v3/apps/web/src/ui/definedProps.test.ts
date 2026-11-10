import { describe, expect, it, vi } from 'vitest';
import { definedProps } from './definedProps';

describe('HeroUI native prop adapter', () => {
    it('removes explicit undefined without removing meaningful falsy values', () => {
        expect(
            definedProps({ optional: undefined, disabled: false, value: 0, placeholder: '', name: 'quantity' }),
        ).toEqual({ disabled: false, value: 0, placeholder: '', name: 'quantity' });
    });

    it('preserves callback and ref identity without mutating caller props', () => {
        const onChange = vi.fn();
        const ref = { current: null };
        const original = { onChange, ref, title: undefined };
        const adapted = definedProps(original);
        expect(adapted.onChange).toBe(onChange);
        expect(adapted.ref).toBe(ref);
        expect(original).toHaveProperty('title');
        expect(adapted).not.toHaveProperty('title');
    });
});
