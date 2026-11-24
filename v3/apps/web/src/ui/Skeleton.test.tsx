import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Skeleton', () => {
    it('يحجز عدد الأسطر المطلوب ويبقى زخرفيًا', () => {
        const { container } = render(<Skeleton lines={3} />);
        expect(container.querySelectorAll('.erp-skeleton').length).toBe(3);
        expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    });

    it('label يعلن التحميل لقارئ الشاشة', () => {
        render(<Skeleton label="جارٍ تحميل القيود" />);
        expect(screen.getByRole('status').textContent).toContain('جارٍ تحميل القيود');
    });

    it('يدعم الدائرة والمستطيل', () => {
        const { container } = render(
            <div>
                <Skeleton variant="circle" />
                <Skeleton variant="rect" />
            </div>,
        );
        expect(container.querySelectorAll('.erp-skeleton').length).toBe(2);
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <div className="flex flex-col gap-md">
                <Skeleton lines={2} label="تحميل" />
                <Skeleton variant="circle" />
                <Skeleton variant="rect" />
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('النوع text يُRender سkeleton زخرفيًا', () => {
        render(<Skeleton variant="text" />);
        const skeleton = document.querySelector('.erp-skeleton');
        expect(skeleton).toBeTruthy();
        expect(skeleton?.className).toContain('h-3');
        expect(skeleton?.className).toContain('w-full');
    });

    it('lines=1 يُRender سطر واحد فقط', () => {
        render(<Skeleton lines={1} />);
        const skeletons = document.querySelectorAll('.erp-skeleton');
        expect(skeletons.length).toBe(1);
    });

    it('بدون label لا يُعلن دور تحميل', () => {
        const { container } = render(<Skeleton />);
        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('className مخصص يُطبق على الحاوية', () => {
        render(<Skeleton className="h-5" />);
        const wrapper = document.querySelector('.h-5');
        expect(wrapper).toBeTruthy();
        expect(wrapper?.className).toContain('h-5');
    });
});
