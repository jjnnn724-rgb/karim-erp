import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Tooltip', () => {
    it('يفتح بالتركيز ويُعلن محتواه', async () => {
        render(
            <Tooltip content="تصدير إلى Excel" delayDuration={0}>
                <Button variant="secondary">تصدير</Button>
            </Tooltip>,
        );

        fireEvent.focus(screen.getByRole('button', { name: 'تصدير' }));
        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip.textContent).toContain('تصدير إلى Excel');
    });

    it('يفتح بالتمرير (hover) ويُغلق بالخروج', async () => {
        render(
            <Tooltip content="الوضع الداكن" delayDuration={0}>
                <Button variant="ghost">الوضع</Button>
            </Tooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'الوضع' });
        fireEvent.pointerEnter(trigger);
        fireEvent.pointerMove(trigger);
        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip.textContent).toContain('الوضع الداكن');

        fireEvent.pointerLeave(trigger);
        fireEvent.blur(trigger);
        fireEvent.mouseLeave(trigger);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <Tooltip content="تلميح" delayDuration={0}>
                <Button>زر</Button>
            </Tooltip>,
        );
        await expectNoAxeViolations(container);
    });
});
