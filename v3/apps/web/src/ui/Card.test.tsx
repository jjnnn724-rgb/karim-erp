import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from './Card';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('Card', () => {
    it('يركّب الرأس والجسم والتذييل بعناوين صحيحة', () => {
        render(
            <Card>
                <CardHeader actions={<button type="button">إجراء</button>}>
                    <CardTitle>ملخص المبيعات</CardTitle>
                    <CardDescription>آخر 30 يومًا</CardDescription>
                </CardHeader>
                <CardBody>120,000.00 SAR</CardBody>
                <CardFooter>
                    <span>محدّث الآن</span>
                </CardFooter>
            </Card>,
        );

        expect(screen.getByRole('heading', { name: 'ملخص المبيعات', level: 3 })).toBeTruthy();
        expect(screen.getByText('آخر 30 يومًا')).toBeTruthy();
        expect(screen.getByText('120,000.00 SAR')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إجراء' })).toBeTruthy();
    });

    it('يدعم مستوى عنوانًا مختلفًا', () => {
        render(
            <Card>
                <CardTitle as="h2">عنوان ثانٍ</CardTitle>
            </Card>,
        );
        expect(screen.getByRole('heading', { name: 'عنوان ثانٍ', level: 2 })).toBeTruthy();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(
            <Card>
                <CardHeader>
                    <CardTitle>بطاقة</CardTitle>
                    <CardDescription>وصف البطاقة</CardDescription>
                </CardHeader>
                <CardBody>محتوى</CardBody>
                <CardFooter>تذييل</CardFooter>
            </Card>,
        );

        await expectNoAxeViolations(container);
    });

    it('يُطبّق className مخصص على البطاقة', () => {
        render(<Card className="border-2 border-danger">محتوى خطر</Card>);
        expect(screen.getByText('محتوى خطر').closest('section')?.className).toContain('border-2');
    });

    it('يدعم تغيير العنصر الجذر عبر prop as', () => {
        render(<Card as="div">محتوى dividing</Card>);
        expect(screen.getByText('محتوى dividing').closest('div')).toBeTruthy();
    });

    it('يُRender إجراءات الهيدر ويستجيب للنقر', () => {
        const onClick = vi.fn();
        render(
            <Card>
                <CardHeader
                    actions={
                        <button type="button" onClick={onClick}>
                            إجراء
                        </button>
                    }
                >
                    <CardTitle>عنوان</CardTitle>
                </CardHeader>
            </Card>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'إجراء' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('يُRender بطاقة فارغة بدون أطفال دون خطأ', () => {
        const { container } = render(<Card>محتوى فارغ</Card>);
        expect(container.firstChild).toBeTruthy();
    });

    it('بلا مخالفات axe مع heading niveau مختلف وإجراءات', async () => {
        const { container } = render(
            <Card>
                <CardHeader actions={<button type="button">حذف</button>}>
                    <CardTitle as="h2">عنوان كبير</CardTitle>
                    <CardDescription>وصف</CardDescription>
                </CardHeader>
                <CardBody>محتوى</CardBody>
                <CardFooter>تذييل</CardFooter>
            </Card>,
        );

        await expectNoAxeViolations(container);
    });
});
