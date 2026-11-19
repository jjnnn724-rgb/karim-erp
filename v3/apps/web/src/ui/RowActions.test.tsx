import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RowActions } from './RowActions';
import { installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('RowActions', () => {
    it('does not render a menu trigger when every action is hidden', () => {
        const { container } = render(
            <RowActions
                label="إجراءات الصنف"
                actions={[{ key: 'edit', label: 'تعديل', onSelect: vi.fn(), hidden: true }]}
            />,
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders visible actions and invokes the selected action', async () => {
        const onSelect = vi.fn();
        render(<RowActions label="إجراءات الصنف" actions={[{ key: 'edit', label: 'تعديل', onSelect }]} />);

        const trigger = screen.getByRole('button', { name: 'إجراءات الصنف' });
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

        const action = await screen.findByRole('menuitem', { name: 'تعديل' });
        fireEvent.click(action);

        expect(onSelect).toHaveBeenCalledOnce();
    });
});
