import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Badge', () => {
    it('يحمل نصًّا دائمًا ويعلن نوعه', () => {
        render(<Badge variant="success">مرحّل</Badge>);

        const badge = screen.getByText('مرحّل');
        expect(badge.getAttribute('data-variant')).toBe('success');
    });

    it('القيمة غير المعروفة تُعلَّم بحدّ متقطّع', () => {
        render(<Badge unknown>غير معروف</Badge>);
        expect(screen.getByText('غير معروف').getAttribute('data-unknown')).toBe('true');
    });

    it('يدعم الحبّة النقطية والنسخة الصلبة', () => {
        const { rerender } = render(
            <Badge dot variant="danger">
                متأخر
            </Badge>,
        );
        expect(screen.getByText('متأخر').querySelector('span[aria-hidden="true"]')).toBeTruthy();

        rerender(
            <Badge soft={false} variant="info">
                معلومة
            </Badge>,
        );
        expect(screen.getByText('معلومة').getAttribute('data-variant')).toBe('info');
    });

    it('بلا مخالفات axe في كل النبرات', async () => {
        const { container } = render(
            <div className="flex flex-wrap gap-xs">
                <Badge>محايد</Badge>
                <Badge variant="success">نجاح</Badge>
                <Badge variant="warning">تحذير</Badge>
                <Badge variant="danger">خطأ</Badge>
                <Badge variant="info">معلومة</Badge>
                <Badge variant="success" soft={false}>
                    صلب
                </Badge>
            </div>,
        );

        await expectNoAxeViolations(container);
    });

    it('النبرة neutral تُRender خلفية محايدة', () => {
        render(<Badge variant="neutral">محايد</Badge>);
        expect(screen.getByText('محايد').getAttribute('data-variant')).toBe('neutral');
    });

    it('النسخة الصلبة solid تُRender بدون خلفية ناعمة', () => {
        render(
            <Badge variant="danger" soft={false}>
                خطير
            </Badge>,
        );
        expect(screen.getByText('خطير').className).toContain('bg-danger');
    });

    it('className مخصص يُطبق على الشارة', () => {
        render(<Badge className="border-2">مخصص</Badge>);
        expect(screen.getByText('مخصص').className).toContain('border-2');
    });

    it('بدون dot لا يُRenderspan مؤشر', () => {
        render(<Badge>بلا نقطة</Badge>);
        expect(screen.getByText('بلا نقطة').querySelector('span[aria-hidden="true"]')).toBeNull();
    });
});
