import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Button', () => {
    it('يرسم النص ويستدعي onClick', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>حفظ</Button>);

        fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('وضع loading يضبط aria-busy ويعطّل الزر ويمنع النقر', () => {
        const onClick = vi.fn();
        render(
            <Button loading onClick={onClick}>
                حفظ
            </Button>,
        );

        const button = screen.getByRole('button', { name: /حفظ/ });
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.hasAttribute('disabled')).toBe(true);
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('disabled يمنع النقر ويُعلن للمساعدات', () => {
        const onClick = vi.fn();
        render(
            <Button disabled onClick={onClick}>
                حفظ
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'حفظ' });
        expect(button.hasAttribute('disabled')).toBe(true);
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('يحترم النوع الافتراضي button كي لا يُرسل نموذجًا', () => {
        render(<Button>إجراء</Button>);
        expect(screen.getByRole('button', { name: 'إجراء' }).getAttribute('type')).toBe('button');
    });

    it('بلا مخالفات axe في الحالات الأساسية', async () => {
        const { container } = render(
            <div className="flex flex-col gap-sm">
                <Button>أساسي</Button>
                <Button variant="secondary">ثانوي</Button>
                <Button variant="ghost">شبح</Button>
                <Button variant="danger">خطِر</Button>
                <Button disabled>معطّل</Button>
                <Button loading>تحميل</Button>
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('الحجم lg يُRender taller وtext أكبر', () => {
        render(<Button size="lg">كبير</Button>);
        expect(screen.getByRole('button', { name: 'كبير' }).className).toContain('h-11');
    });

    it('الأيقونة البداية والنهاية تُRender', () => {
        render(
            <Button iconStart={<span aria-hidden="true">+</span>} iconEnd={<span aria-hidden="true">→</span>}>
                إجراء
            </Button>,
        );
        expect(screen.getByText('إجراء')).toBeTruthy();
        expect(screen.getByText('+')).toBeTruthy();
        expect(screen.getByText('→')).toBeTruthy();
    });

    it('fullWidth يضبط w-full', () => {
        render(<Button fullWidth>عريض</Button>);
        expect(screen.getByRole('button', { name: 'عريض' }).className).toContain('w-full');
    });
});
